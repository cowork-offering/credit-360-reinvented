// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOverlays } from "./state/syncOverlay";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider } from "./state/appState";
import { __skipBootForTests } from "./channel/useLivePortfolio";
// These tests mount the home only to navigate through it into an account; the
// cold-open skeleton is not what they exercise, so the home opens already
// settled, the way a returning viewer with a warm cache does. See the seam.
__skipBootForTests();
import { AppShell } from "./components/AppShell";
import { AppEntry, dispatchOpenSheet } from "./test/entry";
import { resetModalStack } from "./components/modalStack";
import sample from "../../artifact/sample-data.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetModalStack();
  delete (window as unknown as { claude?: unknown }).claude;
  vi.useRealTimers();
  vi.restoreAllMocks();
  try {
    sessionStorage.clear();
    // The sync overlay persists to localStorage by design; one test's sync must
    // not restore itself into the next test's mount.
    clearOverlays();
  } catch {
    /* ignore */
  }
});

/** The live shape: a pledge that DOES carry its collateral record id AND a
 *  facility that names its product package, so the valuation is stageable
 *  exactly as it was in Fabian's org. The sample bundle carries neither, which
 *  is why both are patched in rather than assumed. */
function liveData(): C360Data {
  const d = structuredClone(sample) as unknown as C360Data;
  d.meta = { ...d.meta, userId: "005bb00000ftouDAAQ", instanceUrl: "https://bankinggpt.lightning.force.com" };
  const b = (d.borrowers ?? {})["001SAMPLE0000STRL"];
  for (const f of b.exposure?.facilities ?? []) {
    f.productPackageId = "a5FSAMPLE00000STRL";
    for (const c of f.collateral ?? []) c.collateralId = "a34bb00000COL758AAA";
  }
  return d;
}

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

const PLAN = {
  ok: true,
  error: null,
  result: {
    stagingId: "a8abb00001KtalSAAR",
    planHash: "9f2c1d",
    decisionToken: "dt-server-001",
    accountId: "001SAMPLE0000STRL",
    summary: "Files a collateral valuation.",
    warnings: [],
    steps: [
      { id: "s1", type: "write", label: "Create the collateral valuation", objectName: "LLC_BI__Collateral_Valuation__c", fields: ["LLC_BI__Value__c"], state: "pending" },
    ],
  },
};

const EXECUTED = {
  ok: true,
  error: null,
  result: {
    stagingId: "a8abb00001KtalSAAR",
    terminalState: "success",
    outcome: "The valuation was created and verified.",
    valuationId: "a34bb00000399FFAAY",
    recordName: "CV-0000000002",
    anchorName: "COL-000758",
    steps: [{ id: "s1", type: "write", label: "Create the collateral valuation", state: "verified" }],
  },
};

function installMcp(history?: unknown[]) {
  const callTool = vi.fn(async (_server: string, tool: string, _input?: unknown) => {
    if (tool.startsWith("stage_")) return envelope(PLAN);
    if (tool.startsWith("execute_")) return envelope(EXECUTED);
    // OBSERVED: a read tool, so outputValues carries the payload directly.
    if (tool === "Customer360ActionHistory") {
      return envelope({ accountId: "001SAMPLE0000STRL", count: (history ?? []).length, entries: history ?? [] });
    }
    if (tool === "outlook_email_search") return { payload: { value: [] } };
    return envelope({});
  });
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
  };
  return callTool;
}

function mount(data: C360Data) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <AppProvider data={data}>
        <AppShell />
        <AppEntry />
      </AppProvider>,
    );
  });
}

const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const press = (key: string) => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("the durable trail from the org", () => {
  const ROW = {
    stagingId: "a8abb00001PRIORAAA",
    actionId: "collateral-valuation",
    status: "Completed",
    approverUserId: "005bb00000ftouDAAQ",
    // Space-separated, exactly as the org returns it.
    createdDate: "2026-07-25 20:18:36",
    executedAt: "2026-07-25 20:19:02",
    resultRecordId: "a34bb00000PRIOR1AAA",
    resultRecordName: "CV-0000000001",
    planHashPresent: true,
  };

  async function syncWithHistory(rows: unknown[]) {
    installMcp(rows);
    mount(liveData());
    click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);
    click(byText(/^Sync$/)!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
  }

  it("renders actions filed before this session, with zero session entries", async () => {
    vi.useFakeTimers();
    await syncWithHistory([ROW]);
    const rows = [...document.querySelectorAll("[data-origin-detail]")];
    const org = rows.find((r) => /CV-0000000001/.test(r.closest("button")?.textContent ?? ""));
    expect(org, "the org's own trail must render without any session echo").toBeTruthy();
    expect(org!.getAttribute("data-origin-detail")).toBe("org");
    expect(org!.textContent).toContain("On record in Salesforce");
  });

  it("renders a Staged-only row as history in its own right", async () => {
    vi.useFakeTimers();
    await syncWithHistory([
      { ...ROW, stagingId: "a8abb00001STAGEDAAA", status: "Staged", executedAt: null, resultRecordId: null, resultRecordName: null },
    ]);
    const row = [...document.querySelectorAll("button")].find((b) => /staged, never filed/.test(b.textContent ?? ""));
    expect(row, "a staged-but-never-confirmed action is real trail content").toBeTruthy();
    expect(row!.querySelector('[data-origin-detail="org"]')).toBeTruthy();
  });

  it("lets the org row supersede this session's echo of the same execution", async () => {
    vi.useFakeTimers();
    installMcp([{ ...ROW, stagingId: "a8abb00001KtalSAAR", resultRecordName: "CV-0000000002" }]);
    mount(liveData());
    click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);

    // File it in this session first: the echo renders instantly.
    act(() => dispatchOpenSheet());
    click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent?.includes("Collateral Valuation"))!);
    click(byText(/Review the plan/)!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    click(byText(/Confirm and file/)!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    press("Escape");
    press("Escape");
    expect([...document.querySelectorAll('[data-origin-detail="session"]')].length).toBe(1);

    // Then sync: the org's row replaces it, one entry not two.
    click(byText(/^Sync$/)!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    const filed = [...document.querySelectorAll("button")].filter((b) => /CV-0000000002/.test(b.textContent ?? ""));
    expect(filed).toHaveLength(1);
    expect(filed[0].querySelector('[data-origin-detail="org"]')).toBeTruthy();
    expect(filed[0].querySelector('[data-origin-detail="session"]')).toBeNull();
  });

  it("shows no history line at all when the tool is not deployed", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn(async (_server: string, tool: string) => {
      if (tool === "Customer360ActionHistory") throw { code: "not_in_manifest", message: "no such tool" };
      if (tool === "outlook_email_search") return { payload: { value: [] } };
      return envelope({});
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() },
    };
    mount(liveData());
    click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);
    click(byText(/^Sync$/)!);
    // Past the portfolio and the six detail lines, so the history line has had
    // its turn: it removed itself rather than reporting a failure.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600);
    });
    const console = document.querySelector('[role="status"]')!;
    expect(console.textContent).toContain("Your inbox for this relationship");
    expect(console.textContent).not.toContain("Actions filed against this relationship");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
  });
});

describe("an executed action is VISIBLE in the Activity tab (live defect 2026-07-26)", () => {
  it("uses one account key for the writer and the reader", async () => {
    installMcp();
    const data = liveData();
    // The panel used to key the entry off state.accountId alone while the tab
    // read state.accountId with a fallback. Any path that opens an action with
    // no account selected wrote under "" and the entry became unreadable.
    mount(data);
    click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);
    act(() => dispatchOpenSheet());
    click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent?.includes("Collateral Valuation"))!);
    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();
    press("Escape");
    press("Escape");

    // The rendered row, found by the account the tab is actually showing.
    const rows = [...document.querySelectorAll('[data-origin="user"]')];
    expect(rows.some((r) => /CV-0000000002/.test(r.textContent ?? ""))).toBe(true);
  });

  it("renders the entry in the timeline the banker is looking at", async () => {
    installMcp();
    mount(liveData());
    click([...document.querySelectorAll('[role="button"]')].find((r) => r.textContent?.includes("Sterling Fabrication"))!);
    act(() => dispatchOpenSheet());
    click([...document.querySelector('[role="dialog"]')!.querySelectorAll("button")].find((b) => b.textContent?.includes("Collateral Valuation"))!);

    click(byText(/Review the plan/)!);
    await flush();
    click(byText(/Confirm and file/)!);
    await flush();

    // Close the panel and the Client Actions sheet, landing back on the tab.
    press("Escape");
    press("Escape");

    // The ACTUAL RENDERED TIMELINE, not the store behind it.
    const timeline = [...document.querySelectorAll('[data-origin="user"]')];
    const filed = timeline.find((r) => /CV-0000000002/.test(r.textContent ?? ""));
    expect(filed, "no ACTION_EXECUTED row rendered in the Activity tab").toBeTruthy();
    expect(filed!.textContent).toContain("COL-000758");
  });
});
