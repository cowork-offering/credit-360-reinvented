// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HealthLine, laneSentence } from "./components/HealthLine";
import {
  __resetLaneHealthForTests,
  noteLaneBackup,
  noteLaneFailure,
  noteLaneGrant,
  noteLaneStale,
  noteLaneSuccess,
} from "./channel/laneHealth";
import { SERVERS } from "./channel/mcp";

/* =============================================================================
   THE HEALTH LINE'S COPY, in every state it has.

   FOUNDER, 2026-09-03: the relay dropped the Salesforce session for two hours
   and the page's one sentence about it was "Customer 360 is briefly
   unreachable", which names neither the lane, nor the code, nor when the
   figures on screen were last true. Three different failures wear that banner
   and the fix for each is different, so the line has to say which one this is.

   These are the exact words a banker reads. Change them here on purpose or not
   at all.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  __resetLaneHealthForTests();
  delete (window as unknown as { claude?: unknown }).claude;
  vi.restoreAllMocks();
});

/** 2026-09-03T22:14:00Z, and a "now" on the same UTC day. */
const AT = Date.UTC(2026, 8, 3, 22, 14, 0);
const SAME_DAY = Date.UTC(2026, 8, 3, 23, 30, 0);
const NEXT_DAY = Date.UTC(2026, 8, 4, 9, 0, 0);

/** A bridge that answers `listTools()` with the connectors the viewer granted.
 *  The line asks once on mount, and with no bridge at all it says so. */
function installBridge(servers: string[]) {
  (window as unknown as { claude?: unknown }).claude = {
    mcp: {
      callTool: vi.fn(),
      watchTool: vi.fn().mockReturnValue(() => {}),
      listTools: vi.fn().mockResolvedValue({ servers: servers.map((server) => ({ server, authStatus: "connected", tools: [] })) }),
      invalidate: vi.fn(),
    },
  };
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<HealthLine />));
  return container;
}

/** The rendered sentence, rebuilt with its CSS dot separators. */
const line = () => [...container!.querySelectorAll(".hl-lane")].map((s) => s.textContent).join(" · ");

describe("what each lane state says", () => {
  it("live, with the clock it last answered on", () => {
    expect(laneSentence({ server: "S", grant: "granted", state: "live", lastGoodAt: AT }, "Salesforce", SAME_DAY)).toBe(
      "Salesforce live 22:14 UTC",
    );
  });

  it("stale, and it never says live over a stored document", () => {
    expect(laneSentence({ server: "S", grant: "granted", state: "stale", lastGoodAt: AT }, "Salesforce", NEXT_DAY)).toBe(
      "Salesforce stale since 22:14 UTC yesterday",
    );
  });

  it("unreachable, WITH the platform's own code", () => {
    expect(
      laneSentence(
        { server: "S", grant: "granted", state: "unreachable", code: "server_unavailable", lastGoodAt: AT },
        "Salesforce",
        NEXT_DAY,
      ),
    ).toBe("Salesforce unreachable: server_unavailable");
  });

  it("via backup, in the same tokens as live: the org answered, one hop further round", () => {
    expect(laneSentence({ server: "S", grant: "granted", state: "backup", lastGoodAt: AT }, "Salesforce", SAME_DAY)).toBe(
      "Salesforce via backup 22:14 UTC",
    );
  });

  it("not granted, which is a connector to add and not an outage to wait out", () => {
    expect(laneSentence({ server: "S", grant: "not-granted", state: "unreachable" }, "Inbox", NEXT_DAY)).toBe(
      "Inbox not granted",
    );
  });

  it("unavailable, when this view has no connector bridge at all", () => {
    expect(laneSentence({ server: "S", grant: "unavailable", state: "unreachable" }, "Salesforce", NEXT_DAY)).toBe(
      "Salesforce unavailable",
    );
  });

  it("ready, for a granted lane nothing has asked of yet", () => {
    expect(laneSentence(undefined, "AFS", NEXT_DAY)).toBe("AFS ready");
    expect(laneSentence({ server: "S", grant: "granted", state: "idle" }, "AFS", NEXT_DAY)).toBe("AFS ready");
  });
});

describe("the line itself", () => {
  it("renders nothing at all until a lane has something to say", async () => {
    installBridge([SERVERS.customer360, SERVERS.readBackup, SERVERS.gateway, SERVERS.m365, SERVERS.experience, SERVERS.afs]);
    mount();
    await act(async () => {});
    expect(container!.querySelector(".health-line")).toBeNull();
  });

  it("says nothing about the backup while it is granted and idle", async () => {
    // The whole point of a backup is that it is usually not needed. A lane
    // nobody has had to call is not news, and naming it every session would
    // spend the one quiet sentence the chrome has.
    installBridge([SERVERS.customer360, SERVERS.readBackup]);
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    mount();
    await act(async () => {});
    expect(line()).toContain("Salesforce live");
    expect(line()).not.toContain("Backup");
  });

  it("says the Salesforce figures came via the backup, and names the backup as the lane that answered", () => {
    installBridge([SERVERS.customer360, SERVERS.readBackup]);
    act(() => noteLaneFailure(SERVERS.customer360, { code: "server_unavailable", message: "request failed (502)" }));
    act(() => noteLaneSuccess(SERVERS.readBackup, AT));
    act(() => noteLaneBackup(SERVERS.customer360, AT));
    mount();
    expect(line()).toMatch(/^Salesforce via backup .+ · Backup live /);
    // Quiet: nothing is wrong, so nothing carries colour.
    const lane = container!.querySelector('[data-lane-state="backup"]') as HTMLElement;
    expect(lane.style.color).toBe("var(--ink-faint)");
  });

  it("names the backup when the viewer has not added it, which is a connector to add", async () => {
    // The one state an unused backup is worth a word in: with Customer 360 down
    // and no second door granted, the page is on stored documents and the fix
    // is a connector, not a wait.
    installBridge([SERVERS.customer360, SERVERS.gateway, SERVERS.m365, SERVERS.experience, SERVERS.afs]);
    act(() => noteLaneStale(SERVERS.customer360, AT));
    mount();
    await act(async () => {});
    expect(line()).toMatch(/^Salesforce stale since .+ · Backup not granted$/);
  });

  it("lets a live read outrank a backup one, and a backup one outrank a stored document", () => {
    installBridge([SERVERS.customer360]);
    act(() => noteLaneBackup(SERVERS.customer360, AT));
    act(() => noteLaneStale(SERVERS.customer360, AT - 60_000));
    mount();
    expect(line()).toContain("Salesforce via backup");
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    expect(line()).toContain("Salesforce live");
  });

  it("stays quiet about a granted lane nobody has called", () => {
    installBridge([SERVERS.customer360, SERVERS.afs]);
    act(() => noteLaneGrant(SERVERS.afs, true));
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    mount();
    expect(line()).toContain("Salesforce live");
    expect(line()).not.toContain("AFS");
  });

  it("names the lane, the code and the age when the relay drops the session", () => {
    installBridge([SERVERS.customer360]);
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    act(() => noteLaneFailure(SERVERS.customer360, { code: "server_unavailable", message: "request failed (502)" }));
    mount();
    expect(line()).toBe("Salesforce unreachable: server_unavailable");
    const lane = container!.querySelector('[data-lane-state="unreachable"]') as HTMLElement;
    // The banker can read the platform's own message without a console.
    expect(lane.getAttribute("title")).toContain("request failed (502)");
    // A lane that is down is the only thing on this line that carries colour.
    expect(lane.style.color).toBe("var(--warning)");
  });

  it("says stale, not live, while a stored document is on screen", () => {
    installBridge([SERVERS.customer360]);
    act(() => noteLaneStale(SERVERS.customer360, AT));
    mount();
    expect(line()).toContain("Salesforce stale since");
  });

  it("lets a live read outrank a stored one, never the other way round", () => {
    installBridge([SERVERS.customer360]);
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    act(() => noteLaneStale(SERVERS.customer360, AT - 60_000));
    mount();
    expect(line()).toContain("Salesforce live");
  });

  it("collapses to one sentence when the view has no bridge at all", async () => {
    // No `window.claude`: the share link, the local file, the screenshot
    // harness. The grant probe finds no bridge and the line says so itself.
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    mount();
    await act(async () => {});
    expect(line()).toBe("unavailable in this view");
  });

  it("is a footer landmark and NOT a live region: the sync console owns that", () => {
    installBridge([SERVERS.customer360]);
    act(() => noteLaneSuccess(SERVERS.customer360, AT));
    mount();
    const el = container!.querySelector(".health-line")!;
    expect(el.tagName).toBe("FOOTER");
    expect(el.getAttribute("role")).toBeNull();
  });
});
