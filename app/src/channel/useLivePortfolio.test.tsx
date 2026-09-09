// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PORTFOLIO_REFETCH_MS, useLivePortfolio } from "./useLivePortfolio";
import { RETRY_BUDGET_MS, RETRY_MAX_MS } from "./mcp";

/* =============================================================================
   The book's read is a POLL over `callTool`, not a `watchTool` subscription.

   On 2026-09-09 the founder's seat opened to "Salesforce unreachable:
   bad_request" with the platform's reason beside it: "declared-write tools
   cannot be watched". The Salesforce-hosted MCP server declares every Apex
   invocable as a write, reads included, and the runtime allows a watch only on
   a declared read. So the portfolio goes through `callTool` like the other
   reads on the connector, on the page's own two-minute clock. What is asserted
   here is that contract: the first read on mount, the re-read on the clock,
   the retry policy in front of the banner, the retraction on a denial, and the
   clock stopping with the view.
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
const BOOK = envelope({ accounts: [{ accountId: "A" }] });
const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };

/** A connector whose portfolio answer the test owns; every other tool (the
 *  backup lane's one-shot, for one) is unreachable, so only the primary counts. */
function connector(answer: () => Promise<unknown>) {
  const callTool = vi.fn((_server: string, tool: string, _input?: unknown, _options?: unknown) => (tool === PORTFOLIO ? answer() : Promise.reject(UNAVAILABLE)));
  const watchTool = vi.fn();
  w.claude = { mcp: { callTool, watchTool, listTools: vi.fn(), invalidate: vi.fn() } };
  const portfolioCalls = () => callTool.mock.calls.filter((c) => c[1] === PORTFOLIO);
  return { callTool, watchTool, portfolioCalls };
}

function mountHook(enabled = true) {
  let latest: ReturnType<typeof useLivePortfolio> = {};
  function Probe() {
    latest = useLivePortfolio(enabled);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
  return { get value() { return latest; } };
}

const tick = async (ms = 10) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("useLivePortfolio", () => {
  it("reads on mount through callTool, never through a watch, and re-reads on the page's own clock", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 555, revalidating: false } }));
    mountHook();
    await tick();
    expect(c.watchTool).not.toHaveBeenCalled();
    expect(c.portfolioCalls()).toHaveLength(1);
    // The first read may take a cached answer inside the clock; a re-read asks for a fresh one.
    expect(c.portfolioCalls()[0][3]).toMatchObject({ cache: { staleTime: PORTFOLIO_REFETCH_MS } });
    await tick(PORTFOLIO_REFETCH_MS);
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(c.portfolioCalls()[1][3]).toMatchObject({ cache: { refresh: true } });
    expect(PORTFOLIO_REFETCH_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("unwraps the invocable envelope and records freshness: the platform stamp, or the arrival time of an executed read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T09:00:00Z"));
    const c = connector(() => Promise.resolve({ payload: BOOK, cache: { storedAt: 555, revalidating: false } }));
    const h = mountHook();
    await tick();
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(555);

    c.callTool.mockImplementation((_s: string, tool: string, _i?: unknown, _o?: unknown) => (tool === PORTFOLIO ? Promise.resolve({ payload: envelope({ accounts: [{ accountId: "B" }] }) }) : Promise.reject(UNAVAILABLE)));
    const before = Date.now();
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("B");
    // No cache block means EXECUTED for this call, and a declared write is never cached: the arrival is the "as of".
    expect(h.value.storedAt).toBeGreaterThanOrEqual(before);
    expect(h.value.storedAt).toBeLessThanOrEqual(Date.now());
  });

  it("NEVER shows the banner when the retry succeeds", async () => {
    vi.useFakeTimers();
    let first = true;
    const c = connector(() => {
      if (first) {
        first = false;
        return Promise.reject(UNAVAILABLE);
      }
      return Promise.resolve({ payload: BOOK, cache: { storedAt: 777, revalidating: false } });
    });
    const h = mountHook();
    await tick();
    expect(h.value.failure).toBeUndefined(); // the retry is still running
    await tick(RETRY_MAX_MS + 50);
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(h.value.failure).toBeUndefined();
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
    expect(h.value.storedAt).toBe(777);
  });

  it("shows the failure only after every retry has failed too, keeping last-good data", async () => {
    vi.useFakeTimers();
    let good = true;
    const c = connector(() => (good ? Promise.resolve({ payload: BOOK, cache: { storedAt: 111, revalidating: false } }) : Promise.reject(UNAVAILABLE)));
    const h = mountHook();
    await tick();
    expect(h.value.storedAt).toBe(111);

    good = false;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.failure).toBeUndefined(); // retrying, silently
    await tick(RETRY_BUDGET_MS + 50);
    expect(h.value.failure?.code).toBe("server_unavailable");
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A"); // retained
    expect(h.value.storedAt).toBe(111); // the freshness the banner quotes
    expect(c.portfolioCalls().length).toBeGreaterThan(2);
  });

  it("RETRACTS data on an authz denial", async () => {
    vi.useFakeTimers();
    let good = true;
    connector(() => (good ? Promise.resolve({ payload: BOOK }) : Promise.reject({ code: "needs_reauth" })));
    const h = mountHook();
    await tick();
    expect(h.value.portfolio).toBeTruthy();
    good = false;
    await tick(PORTFOLIO_REFETCH_MS);
    expect(h.value.portfolio).toBeUndefined(); // retracted
    expect(h.value.failure?.retract).toBe(true);
  });

  it("Retry reads again now, and the good read is what clears the banner", async () => {
    vi.useFakeTimers();
    let good = false;
    const c = connector(() => (good ? Promise.resolve({ payload: BOOK }) : Promise.reject({ code: "not_in_manifest" })));
    const h = mountHook();
    await tick();
    expect(h.value.failure).toBeTruthy();
    expect(c.portfolioCalls()).toHaveLength(1); // not retryable: one attempt

    good = true;
    act(() => h.value.retry!());
    // The click does not clear the banner. The next good read does.
    expect(h.value.retrying).toBe(true);
    expect(h.value.failure).toBeTruthy();
    await tick();
    expect(c.portfolioCalls()).toHaveLength(2);
    expect(c.portfolioCalls()[1][3]).toMatchObject({ cache: { refresh: true } }); // a restart asks fresh
    expect(h.value.failure).toBeUndefined();
    expect(h.value.retrying).toBe(false);
    expect(h.value.portfolio?.accounts?.[0]?.accountId).toBe("A");
  });

  it("stops the clock on unmount", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK }));
    mountHook();
    await tick();
    act(() => root?.unmount());
    root = null;
    await tick(PORTFOLIO_REFETCH_MS * 3);
    expect(c.portfolioCalls()).toHaveLength(1);
  });

  it("does not read when disabled", async () => {
    vi.useFakeTimers();
    const c = connector(() => Promise.resolve({ payload: BOOK }));
    mountHook(false);
    await tick(PORTFOLIO_REFETCH_MS);
    expect(c.portfolioCalls()).toHaveLength(0);
  });
});
