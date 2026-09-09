// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider } from "./state/appState";
import { __skipBootForTests } from "./channel/useLivePortfolio";
// These tests mount the home only to navigate through it into an account; the
// cold-open skeleton is not what they exercise, so the home opens already
// settled, the way a returning viewer with a warm cache does. See the seam.
__skipBootForTests();
import { AppShell } from "./components/AppShell";
import { AppEntry } from "./test/entry";
import { clearOverlays } from "./state/syncOverlay";
import { acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import { resetCatalog } from "./channel/catalog";
import { clearComposed } from "./workroom/engine";
import { __resetMailArrivalForTests, mailOpening, mailNoteFromEntry, mailWhisperLine, readMailRow } from "./actions/mailRow";
import { carriedMailFor } from "./actions/mailCarry";
import { closeFacilityRoom } from "./components/workroom/roomSession";
import type { ActivityEntry, BorrowerBundle, C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   AN INBOUND EMAIL, ON THE TRAIL AND INTO THE ROOM.

   FOUNDER, 2026-09-03: "in the activity, when an email is coming in: it looks
   pretty bad, it has this long winded text, and the pop up still opens up the
   old loan modification tab, not our workroom. I need it sleek and elegant."

   WHAT THIS PROVES, in the order the banker meets it: a swept message is ONE
   compact row carrying the sender, the subject, the ask in one line and one
   pill, with NO body text in the default DOM at all; the body arrives on a
   click and leaves on the next; the arrival whispers ONE line; and the pill
   opens OUR facility workroom with the message on the greeting envelope and
   the legacy Loan Modification panel nowhere on the page.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIVE = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";

/** Hartwell's own org grew a second package (2026-09-03): opening the room off
 *  a swept mail message does not (yet) infer the package from the facility the
 *  message names, so on the shipped two-package book the room now stops on the
 *  package-ask instead of reaching the greeting or the route question this
 *  file's "Open in workroom" tests are about. Proved instead on a
 *  single-package slice of the same relationship: the six originally-booked
 *  C&I facilities, which is where the $15M line of credit these tests
 *  reference actually lives. */
const HARTWELL_CNI_PACKAGE = "a5Fbb000000IHFJEA4";
const hartwellOnePackage: C360Data = JSON.parse(JSON.stringify(LIVE));
hartwellOnePackage.borrowers![HARTWELL].exposure!.facilities = (
  LIVE.borrowers![HARTWELL].exposure?.facilities ?? []
).filter((f) => f.productPackageId === HARTWELL_CNI_PACKAGE && f.stage === "Booked");

let DATA = LIVE;
const BUNDLE = (LIVE.borrowers ?? {})[HARTWELL] as BorrowerBundle;

/** The observed single-object mail shape: `sender` a plain address, the body
 *  preview under `summary`. Synthetic values, real shape. */
const MAIL = {
  id: "AAMk-ACT-1",
  subject: "Hartwell line increase before quarter end",
  sender: "james@hartwellprecision.com",
  receivedDateTime: "2026-07-27T09:00:00Z",
  summary: "Could we increase the line of credit from 15Mio to 20Mio before quarter end? The Kokomo build is running ahead and we would rather not draw the seasonal line for it.",
  webLink: "https://outlook.office.com/mail/AAMk-ACT-1",
};

/** The same message as the sweep lands it on the trail. */
const ENTRY: ActivityEntry = {
  id: "mail-AAMk-ACT-1",
  ts: "2026-07-27T09:00:00Z",
  kind: "REQUEST_RECEIVED",
  title: MAIL.subject,
  summary: MAIL.summary,
  actor: MAIL.sender,
  sessionLocal: true,
  reference: { kind: "m365-message", id: MAIL.id, webLink: MAIL.webLink },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const openRow = (name: string) =>
  [...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes(name))!;

/**
 * THE CONNECTOR, ANSWERING ONE TOOL.
 *
 * The mailbox answers; every other read THROWS, which is the sweep's own
 * partial path: the section keeps its last-good value. That matters here, a
 * detail tool answering an empty envelope would blank `exposure`, and the ask
 * is derived against the facilities the book holds.
 */
function installConnector(): { calls: string[] } {
  const calls: string[] = [];
  (window as unknown as { claude?: unknown }).claude = {
    mcp: {
      callTool: async (_server: string, tool: string) => {
        if (tool === "outlook_email_search") return { payload: MAIL };
        throw new Error(`no ${tool} in this view`);
      },
      watchTool: vi.fn().mockReturnValue(() => {}),
      listTools: vi.fn(),
      invalidate: vi.fn(),
    },
    use: async (name: string) =>
      name === "sample"
        ? async (input: string, options?: { onText?: (u: { text: string; delta: string }) => void }) => {
            calls.push(input);
            const text = "James has written about the line of credit.";
            options?.onText?.({ text, delta: text });
            return { text, truncated: false, modelTierApplied: "quick" };
          }
        : null,
  };
  return { calls };
}

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={DATA}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
  return container;
}

const settle = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

/** Open Hartwell and sweep. The trail then carries the message.
 *  The sweep paces its own lines and holds its report, so the clock is driven
 *  rather than waited on; the room's own timing then runs on the real one. */
async function sweepIn(): Promise<{ calls: string[] }> {
  const session = installConnector();
  await acquireSample(50);
  vi.useFakeTimers();
  mount();
  await click(openRow("Hartwell Precision"));
  const sync = byText(/^Sync$/);
  if (!sync) throw new Error(`no Sync button; buttons: ${buttons().map((b) => b.textContent).join(" | ")}`);
  await click(sync);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(12_000);
  });
  vi.useRealTimers();
  return session;
}

beforeEach(() => {
  resetSessionDoor();
  __resetMailArrivalForTests();
  closeFacilityRoom();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  DATA = LIVE;
  closeFacilityRoom();
  __resetMailArrivalForTests();
  delete (window as unknown as { claude?: unknown }).claude;
  clearComposed();
  resetCatalog();
  try {
    sessionStorage.clear();
    clearOverlays();
  } catch {
    /* ignore */
  }
});

/* ============================================================== the reading */

describe("the read behind the row", () => {
  it("carries the sender, the subject and the ask in one line", () => {
    const row = readMailRow(ENTRY, BUNDLE)!;
    expect(row.from).toBe("james@hartwellprecision.com");
    expect(row.subject).toBe("Hartwell line increase before quarter end");
    expect(row.ask).toBe("Asks to increase the Line of Credit from $15M to $20M");
    expect(row.askDerived).toBe(true);
    expect(row.ask!.split(" ").length).toBeLessThanOrEqual(14);
    expect(row.route).toBe("modify");
  });

  it("prints no figure the message did not state", () => {
    // The client names the target only. The facility's booked $12.0MM
    // commitment is on the book and stays there.
    const row = readMailRow({ ...ENTRY, summary: "Hartwell would like to increase the construction loan to 20Mio." }, BUNDLE)!;
    expect(row.ask).toBe("Asks to increase the Construction to $20M");
    expect(row.ask).not.toContain("$12M");
  });

  it("falls back to the client's own words, clipped, when nothing is readable", () => {
    const row = readMailRow(
      { ...ENTRY, title: "June certificate", summary: "Could you send over the June covenant certificate when you have a moment?" },
      BUNDLE,
    )!;
    expect(row.askDerived).toBe(false);
    expect(row.ask).toBe("Could you send over the June covenant certificate when you have a moment?");
    expect(row.route).toBeNull();
  });

  it("names no room for a message carrying no credit action", () => {
    const row = readMailRow({ ...ENTRY, title: "Thanks", summary: "Thanks for lunch yesterday." }, BUNDLE)!;
    expect(mailOpening(row)).toBeNull();
  });

  it("offers the route the message names as the room's opening chip", () => {
    const opening = mailOpening(readMailRow(ENTRY, BUNDLE)!)!;
    expect(opening.route).toBe("modify");
    expect(opening.yesLabel).toBe("Open the modification");
    expect(opening.line).toBe("james@hartwellprecision.com asks to increase the Line of Credit from $15M to $20M");
    expect(opening.memberId).toBeNull();
  });

  it("builds the greeting's mail block as a SWEPT read, never as an intent", () => {
    const note = mailNoteFromEntry(ENTRY, BUNDLE, "2026-07-25T21:04:49Z")!;
    expect(note.source).toBe("swept");
    expect(note.from).toBe("james@hartwellprecision.com");
    expect(note.subject).toBe("Hartwell line increase before quarter end");
    expect(note.gist).toContain("Could we increase the line of credit");
    expect(note.route).toBe("modify");
    expect(note.asked).toEqual({ to: "$20M", from: "$15M", facility: BUNDLE.exposure!.facilities![0].name });
    // Newer than the book this room stands on, and the envelope says so.
    expect(note.arrivedAfterBook).toBe(true);
  });

  it("says one sentence for the whisper", () => {
    const line = mailWhisperLine(readMailRow(ENTRY, BUNDLE)!);
    expect(line).toBe(
      "james@hartwellprecision.com asks to increase the Line of Credit from $15M to $20M. Open the modification?",
    );
    expect(line).not.toContain("\n");
  });
});

/* ================================================================= the row */

describe("the row on the trail", () => {
  it("renders the compact shape and NO body text", async () => {
    await sweepIn();
    const row = document.querySelector("[data-mail-row]")!;
    expect(row).toBeTruthy();
    const text = row.textContent ?? "";
    expect(text).toContain("Hartwell line increase before quarter end");
    expect(text).toContain("james@hartwellprecision.com");
    expect(text).toContain("Asks to increase the Line of Credit from $15M to $20M");
    expect(text).toContain("Open in workroom");
    // THE DEFECT ITSELF: the body preview is not on the glass, and neither is
    // the 40-character Graph id the citation used to print beside it.
    expect(text).not.toContain("The Kokomo build is running ahead");
    expect(text).not.toContain("AAMk-ACT-1");
    expect(document.querySelector("[data-mail-body]")).toBeNull();
  });

  it("offers exactly one action, and it is not the old popup", async () => {
    await sweepIn();
    const row = document.querySelector("[data-mail-row]")!;
    expect(row.querySelectorAll("[data-mail-open]")).toHaveLength(1);
    expect(row.textContent).not.toContain("suggested next step");
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it("brings the body back on one click and takes it away on the next", async () => {
    await sweepIn();
    const more = document.querySelector<HTMLButtonElement>("[data-mail-expand]")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(document.querySelector("[data-mail-body]")!.textContent).toContain("The Kokomo build is running ahead");
    await click(document.querySelector("[data-mail-expand]")!);
    expect(document.querySelector("[data-mail-body]")).toBeNull();
  });
});

/* ============================================================= the whisper */

describe("the arrival", () => {
  it("whispers ONE line and offers the room, never a modal", async () => {
    await sweepIn();
    const whispers = [...document.querySelectorAll("[data-mail-whisper]")];
    expect(whispers).toHaveLength(1);
    const said = whispers[0].textContent ?? "";
    expect(said).not.toContain("\n");
    expect(said).toContain(
      "james@hartwellprecision.com asks to increase the Line of Credit from $15M to $20M. Open the modification?",
    );
    expect(document.querySelector("[data-mail-whisper-open]")).toBeTruthy();
    expect(document.querySelector("[data-mail-whisper-later]")).toBeTruthy();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it("is spent once the banker says Later", async () => {
    await sweepIn();
    await click(document.querySelector("[data-mail-whisper-later]")!);
    expect(document.querySelector("[data-mail-whisper]")).toBeNull();
  });
});

/* ================================================================ the room */

describe("Open in workroom", () => {
  it("opens OUR facility room, with the message on the greeting envelope", async () => {
    DATA = hartwellOnePackage;
    const session = await sweepIn();
    const before = session.calls.length;
    await click(document.querySelector("[data-mail-open]")!);
    await settle(0);
    await settle(60);

    // The unified room is on the glass, and the legacy action panel is not.
    expect(document.querySelector(".wk-room")).toBeTruthy();
    expect(
      [...document.querySelectorAll('[role="dialog"]')].some(
        (d) => d.getAttribute("aria-label") === "Loan Modification",
      ),
    ).toBe(false);

    // The message is what the room was opened ON, so the greeting leads with it.
    expect(carriedMailFor(HARTWELL)!.subject).toBe("Hartwell line increase before quarter end");

    const greeting = session.calls.slice(before).find((c) => /The room has just OPENED/.test(c));
    expect(greeting).toBeTruthy();
    expect(greeting).toContain("james@hartwellprecision.com");
    expect(greeting).toContain("Hartwell line increase before quarter end");
    expect(greeting).toMatch(/THE CLIENT HAS WRITTEN/);
    expect(greeting).toContain('"route":"modify"');
  });

  it("opens the room UNBOUND, offering the route rather than choosing it", async () => {
    DATA = hartwellOnePackage;
    await sweepIn();
    await click(document.querySelector("[data-mail-open]")!);
    await settle(0);
    await settle(60);
    const room = document.querySelector(".wk-room")!;
    // The room asks. The chip the message points at is the one on offer, with
    // the way out of it beside it: nothing is bound and nothing is staged.
    const chips = [...room.querySelectorAll(".wk-opt")].map((c) => c.textContent);
    expect(chips).toContain("Open the modification");
    expect(chips).toContain("Something else");
  });

  it("lets the message go when the room closes", async () => {
    await sweepIn();
    await click(document.querySelector("[data-mail-open]")!);
    await settle(0);
    await settle(60);
    expect(carriedMailFor(HARTWELL)).not.toBeNull();
    act(() => closeFacilityRoom());
    expect(carriedMailFor(HARTWELL)).toBeNull();
  });
});
