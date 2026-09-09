// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider } from "./state/appState";
import { KpiBand } from "./components/KpiBand";
import { RETRY_BUDGET_MS } from "./channel/mcp";
import { PORTFOLIO_REFETCH_MS } from "./channel/useLivePortfolio";
import type { C360Data } from "./data/contract";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   "Customer 360 is briefly unreachable", the banner that used to STICK.

   The idle-expired MCP session fails the first call after a pause, the hook
   stored that failure, and with no polling and no retry nothing ever replaced
   it: the banner stood until the view remounted. What is asserted here is the
   banker's side of the fix: the banner appears only after the retry has been
   spent, it quotes the freshness of the data still on screen, it offers a
   gesture, and the next good read takes it away. The read is a `callTool` poll
   since 2026-09-09 (the platform refuses a watch on this connector's tools), so
   the failures here arrive on the page's own clock, not through a watch handler.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  delete w.claude;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PORTFOLIO = "Customer360Portfolio";
const envelope = (data: unknown) => ({ content: [{ isSuccess: true, errors: null, outputValues: data }] });
const BOOK = envelope({ accounts: [{ accountId: "A", tce: 1_000_000, outstanding: 500_000 }] });
const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };
/** 2026-09-03T14:03:00Z, the clock the banner quotes. */
const STORED_AT = Date.UTC(2026, 8, 3, 14, 3, 0);
const GOOD = { payload: BOOK, cache: { storedAt: STORED_AT, revalidating: false } };

/** The connector: the portfolio answers as the test says, everything else is down. */
function mount(portfolio: () => Promise<unknown>) {
  const callTool = vi.fn((_server: string, tool: string) => (tool === PORTFOLIO ? portfolio() : Promise.reject(UNAVAILABLE)));
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <AppProvider data={sample as unknown as C360Data}>
        <KpiBand />
      </AppProvider>,
    ),
  );
  return { callTool, portfolioCalls: () => callTool.mock.calls.filter((c) => c[1] === PORTFOLIO) };
}

const tick = async (ms = 10) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const band = () => container!.querySelector(".kpi-live");
const retryButton = () => [...container!.querySelectorAll("button")].find((b) => /Retry/i.test(b.textContent ?? ""));

describe("the unreachable banner", () => {
  it("stays away while the retry runs, then names the fix, the freshness and a gesture", async () => {
    vi.useFakeTimers();
    let good = true;
    mount(() => (good ? Promise.resolve(GOOD) : Promise.reject(UNAVAILABLE)));
    await tick();
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable");

    good = false;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable"); // the retry is still running

    await tick(RETRY_BUDGET_MS + 50);
    const text = band()?.textContent ?? "";
    expect(text).toContain("briefly unreachable");
    /* THE DAY RIDES WITH THE CLOCK once the stamp is not today's. The
       2026-09-03 outage ran two hours; "last good data, 14:03 UTC" on its own
       cannot say whether that was this morning or last week, which is the one
       thing a banker reading a stale band has to know. */
    expect(text).toMatch(/Last good data, .*14:03 UTC/);
    expect(retryButton()).toBeTruthy();
  });

  it("clears on the next good read, and the figures never blanked", async () => {
    vi.useFakeTimers();
    let good = true;
    mount(() => (good ? Promise.resolve(GOOD) : Promise.reject(UNAVAILABLE)));
    await tick();
    good = false;
    await tick(PORTFOLIO_REFETCH_MS + RETRY_BUDGET_MS + 50);
    expect(band()?.textContent).toContain("briefly unreachable");
    expect(band()?.textContent).toMatch(/14:03 UTC/); // the figures on screen are the last good ones

    good = true;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable");
    expect(retryButton()).toBeUndefined();
  });

  it("Retry reads again now", async () => {
    vi.useFakeTimers();
    let good = false;
    const h = mount(() => (good ? Promise.resolve(GOOD) : Promise.reject(UNAVAILABLE)));
    await tick(RETRY_BUDGET_MS + 50);
    expect(band()?.textContent).toContain("briefly unreachable");
    const before = h.portfolioCalls().length;
    expect(before).toBeGreaterThan(1); // the retry policy was spent first

    good = true;
    act(() => retryButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(retryButton()!.textContent).toContain("Retrying");
    await tick();
    expect(h.portfolioCalls().length).toBe(before + 1);
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable");
  });
});
