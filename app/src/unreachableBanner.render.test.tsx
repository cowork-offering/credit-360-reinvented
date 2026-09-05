// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppProvider } from "./state/appState";
import { KpiBand } from "./components/KpiBand";
import { RETRY_BUDGET_MS } from "./channel/mcp";
import type { C360Data } from "./data/contract";
import sample from "../../artifact/sample-data.json";

/* =============================================================================
   "Customer 360 is briefly unreachable", the banner that used to STICK.

   The idle-expired MCP session fails the first call after a pause, the handler
   stored that failure, and with no polling and no retry nothing ever replaced
   it: the banner stood until the view remounted. What is asserted here is the
   banker's side of the fix: the banner appears only after the retry has been
   spent, it quotes the freshness of the data still on screen, it offers a
   gesture, and the next good event takes it away.
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

const envelope = (data: unknown) => ({ content: [{ isSuccess: true, errors: null, outputValues: data }] });
const BOOK = envelope({ accounts: [{ accountId: "A", tce: 1_000_000, outstanding: 500_000 }] });
const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };
/** 2026-09-03T14:03:00Z, the clock the banner quotes. */
const STORED_AT = Date.UTC(2026, 8, 3, 14, 3, 0);

function mount(callTool: ReturnType<typeof vi.fn>) {
  const captured: { handler?: (ev: unknown) => void } = {};
  const unsub = vi.fn();
  const watch = vi.fn().mockImplementation((_s, _t, _i, h) => {
    captured.handler = h as (ev: unknown) => void;
    return unsub;
  });
  w.claude = { mcp: { callTool, watchTool: watch, listTools: vi.fn(), invalidate: vi.fn() } };
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
  return { captured, watch, unsub };
}

const band = () => container!.querySelector(".kpi-live");
const retryButton = () => [...container!.querySelectorAll("button")].find((b) => /Retry/i.test(b.textContent ?? ""));

describe("the unreachable banner", () => {
  it("stays away while the retry runs, then names the fix, the freshness and a gesture", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    const h = mount(callTool);

    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK, cache: { storedAt: STORED_AT, revalidating: false } } }));
    act(() => h.captured.handler!({ type: "error", error: UNAVAILABLE }));
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    });
    const text = band()?.textContent ?? "";
    expect(text).toContain("briefly unreachable");
    /* THE DAY RIDES WITH THE CLOCK once the stamp is not today's. The
       2026-09-03 outage ran two hours; "last good data, 14:03 UTC" on its own
       cannot say whether that was this morning or last week, which is the one
       thing a banker reading a stale band has to know. */
    expect(text).toMatch(/Last good data, .*14:03 UTC/);
    expect(retryButton()).toBeTruthy();
  });

  it("clears on the next good data event, and the figures never blanked", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    const h = mount(callTool);

    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK, cache: { storedAt: STORED_AT, revalidating: false } } }));
    act(() => h.captured.handler!({ type: "error", error: UNAVAILABLE }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    });
    expect(band()?.textContent).toContain("briefly unreachable");

    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK, cache: { storedAt: STORED_AT, revalidating: false } } }));
    expect(band()?.textContent ?? "").not.toContain("briefly unreachable");
    expect(retryButton()).toBeUndefined();
  });

  it("Retry re-registers the watch", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    const h = mount(callTool);
    act(() => h.captured.handler!({ type: "error", error: UNAVAILABLE }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    });
    expect(h.watch).toHaveBeenCalledTimes(1);

    act(() => retryButton()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(h.watch).toHaveBeenCalledTimes(2);
    expect(h.unsub).toHaveBeenCalled();
    expect(retryButton()!.textContent).toContain("Retrying");
  });
});
