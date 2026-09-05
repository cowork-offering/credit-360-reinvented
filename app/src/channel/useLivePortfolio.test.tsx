// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PORTFOLIO_REFETCH_MS, useLivePortfolio } from "./useLivePortfolio";
import { RETRY_BUDGET_MS, RETRY_MAX_MS } from "./mcp";

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

/** Renders the hook and exposes the latest value + the captured watch handler. */
function mountHook(enabled = true, callTool: ReturnType<typeof vi.fn> = vi.fn()) {
  const captured: { handler?: (ev: unknown) => void; opts?: Record<string, unknown> } = {};
  const unsub = vi.fn();
  const watch = vi.fn().mockImplementation((_s, _t, _i, h, o) => {
    captured.handler = h as (ev: unknown) => void;
    captured.opts = o as Record<string, unknown>;
    return unsub;
  });
  w.claude = { mcp: { callTool, listTools: vi.fn(), invalidate: vi.fn(), watchTool: watch } };
  let latest: ReturnType<typeof useLivePortfolio> = {};
  function Probe() {
    latest = useLivePortfolio(enabled);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
  return { captured, unsub, watch, callTool, get value() { return latest; } };
}

const envelope = (data: unknown) => ({ content: [{ isSuccess: true, errors: null, outputValues: data }] });
const BOOK = envelope({ accounts: [{ accountId: "A" }] });
const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };

describe("useLivePortfolio", () => {
  it("polls at a minute, the heal for an idle-expired MCP session", () => {
    const h = mountHook();
    /* Polling was removed on 2026-07-25 because a tight loop starved the chat.
       It is back at a minute because without it a single transient failure was
       the last event the watch ever delivered, and the banner stuck. A minute
       is twice the platform's ~30s floor. */
    expect(h.captured.opts?.refetchInterval).toBe(PORTFOLIO_REFETCH_MS);
    expect(PORTFOLIO_REFETCH_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("unwraps the invocable envelope and records cache freshness", () => {
    const h = mountHook();
    act(() =>
      h.captured.handler!({
        type: "data",
        result: { payload: envelope({ accounts: [{ accountId: "A" }] }), cache: { storedAt: 555, revalidating: false } },
      }),
    );
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(555);
  });

  it("NEVER shows the banner when the re-read succeeds", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockResolvedValue({ payload: BOOK, cache: { storedAt: 777, revalidating: false } });
    const h = mountHook(true, callTool);

    act(() => h.captured.handler!({ type: "error", error: UNAVAILABLE }));
    expect(h.value.failure).toBeUndefined(); // the retry is still running

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(h.value.failure).toBeUndefined();
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(777);
  });

  it("shows the failure only after every retry has failed too, keeping last-good data", async () => {
    vi.useFakeTimers();
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    const h = mountHook(true, callTool);

    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK, cache: { storedAt: 111, revalidating: false } } }));
    act(() => h.captured.handler!({ type: "error", error: UNAVAILABLE }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    });

    expect(h.value.failure?.code).toBe("server_unavailable");
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A"); // retained
    expect(h.value.storedAt).toBe(111); // the freshness the banner quotes
  });

  it("RETRACTS data on an authz denial", () => {
    const h = mountHook();
    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK } }));
    act(() => h.captured.handler!({ type: "error", error: { code: "needs_reauth" } }));
    expect(h.value.portfolio).toBeUndefined(); // retracted
    expect(h.value.failure?.retract).toBe(true);
  });

  it("Retry re-registers the watch, and a good event clears the banner", () => {
    const h = mountHook();
    act(() => h.captured.handler!({ type: "error", error: { code: "not_in_manifest" } }));
    expect(h.value.failure).toBeTruthy();
    expect(h.watch).toHaveBeenCalledTimes(1);

    act(() => h.value.retry!());
    expect(h.watch).toHaveBeenCalledTimes(2); // torn down and registered again
    expect(h.unsub).toHaveBeenCalled();
    expect(h.value.retrying).toBe(true);
    // The click does not clear the banner. The next good event does.
    expect(h.value.failure).toBeTruthy();

    act(() => h.captured.handler!({ type: "data", result: { payload: BOOK } }));
    expect(h.value.failure).toBeUndefined();
    expect(h.value.retrying).toBe(false);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
  });

  it("unsubscribes on unmount", () => {
    const h = mountHook();
    act(() => root?.unmount());
    root = null;
    expect(h.unsub).toHaveBeenCalled();
  });

  it("does not register a watch when disabled", () => {
    const h = mountHook(false);
    expect(h.captured.handler).toBeUndefined();
  });
});
