// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callTool,
  describeFailure,
  isRetryableRead,
  isRetryableWrite,
  laneTimeout,
  retryDelayMs,
  RETRY_ATTEMPTS,
  RETRY_BUDGET_MS,
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  SERVERS,
  TOOLS,
  watchTool,
  WRITE_RETRY_ATTEMPTS,
  WRITE_RETRY_BUDGET_MS,
  WRITE_RETRY_MAX_MS,
  WRITE_RETRY_MIN_MS,
} from "./mcp";
import { __resetLaneHealthForTests, laneCalls, laneOf } from "./laneHealth";

/* =============================================================================
   THE ONE RETRY POLICY, for READS and for WATCHES.

   The defect this closes: the Salesforce-hosted MCP session expires on idle, so
   the first call after a pause fails `server_unavailable` (retryable) and the
   connector re-handshakes a few seconds later. The home view's watch had no
   retry and no polling, so that one failure was the LAST event it delivered and
   "Customer 360 is briefly unreachable" stood until the view remounted.

   THE POLICY WIDENED ON 2026-09-05, and the reason is the 2026-09-03 outage:
   the artifact-to-connector relay lost its Salesforce session for two hours and
   answered the PAGE `server_unavailable: request failed (502)` while the same
   tools answered normally in chat. One retry 500-1500ms later lands inside the
   same dead window, and a `server_unavailable` arriving WITHOUT the platform's
   `retryable` stamp was not retried at all. So: three attempts, the delay
   doubling between them, and `server_unavailable` retryable on its own code.

   What must stay true, and is asserted below: reads only, never a write, never
   a denial, and one retry chain per user-visible refresh.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

function installMcp(impl: Record<string, unknown>) {
  w.claude = { mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn(), ...impl } };
  return w.claude!.mcp as Record<string, ReturnType<typeof vi.fn>>;
}

/** A watch stub that hands the registered handler back to the test. */
function installWatch(callTool: ReturnType<typeof vi.fn>) {
  const captured: { handler?: (ev: unknown) => void; opts?: Record<string, unknown> } = {};
  const unsub = vi.fn();
  installMcp({
    callTool,
    watchTool: vi.fn().mockImplementation((_s, _t, _i, h, o) => {
      captured.handler = h as (ev: unknown) => void;
      captured.opts = o as Record<string, unknown>;
      return unsub;
    }),
  });
  return { captured, unsub };
}

const UNAVAILABLE = { code: "server_unavailable", message: "session expired", retryable: true };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete w.claude;
  vi.restoreAllMocks();
});

describe("the delay is randomised inside one window", () => {
  it("lands between 500 and 1500ms", () => {
    for (const r of [0, 0.5, 0.999999]) {
      const ms = retryDelayMs({}, () => r);
      expect(ms).toBeGreaterThanOrEqual(RETRY_MIN_MS);
      expect(ms).toBeLessThanOrEqual(RETRY_MAX_MS);
    }
  });

  it("varies: two draws off different randoms differ", () => {
    expect(retryDelayMs({}, () => 0)).not.toBe(retryDelayMs({}, () => 0.99));
  });

  it("never retries EARLIER than the platform's own retryAfterMs, and never past a minute", () => {
    expect(retryDelayMs({ retryAfterMs: 9_000 }, () => 0)).toBe(9_000);
    expect(retryDelayMs({ retryAfterMs: 600_000 }, () => 0)).toBe(60_000);
    // A retryAfterMs inside the window does not shorten the wait.
    expect(retryDelayMs({ retryAfterMs: 10 }, () => 0)).toBe(RETRY_MIN_MS);
  });
});

describe("what may be retried at all", () => {
  it("on the platform's stamp, and on server_unavailable with or without one", () => {
    // The shape that stood for two hours on 2026-09-03: the relay's own 502,
    // arriving with no retryable stamp on it.
    expect(isRetryableRead(describeFailure({ code: "server_unavailable" }, "S", "T"))).toBe(true);
    expect(isRetryableRead(describeFailure(UNAVAILABLE, "S", "T"))).toBe(true);
    expect(isRetryableRead(describeFailure({ code: "tool_error" }, "S", "T"))).toBe(false);
    expect(isRetryableRead(describeFailure({ code: "bad_request" }, "S", "T"))).toBe(false);
  });

  it("never an authz denial, however it was stamped", () => {
    for (const code of ["needs_reauth", "server_not_connected", "blocked_by_policy", "approval_required"]) {
      expect(isRetryableRead(describeFailure({ code, retryable: true }, "S", "T")), code).toBe(false);
    }
  });

  it("never a view with no connector bridge at all", () => {
    expect(isRetryableRead(describeFailure({ code: "capability_disabled", retryable: true }, "S", "T"))).toBe(false);
  });
});

describe("callTool: reads retry to the budget, writes never", () => {
  it("retries a read after the randomised delay and resolves on the second answer", async () => {
    const fn = vi.fn().mockRejectedValueOnce(UNAVAILABLE).mockResolvedValue({ payload: "ok" });
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, { read: true });
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    await expect(p).resolves.toMatchObject({ payload: "ok" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("surfaces the failure only once the whole budget is spent, and no attempt more", async () => {
    const fn = vi.fn().mockRejectedValue(UNAVAILABLE);
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, { read: true });
    const seen = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    expect(await seen).toMatchObject({ code: "server_unavailable" });
    expect(fn).toHaveBeenCalledTimes(RETRY_ATTEMPTS);
  });

  it("keeps the whole budget inside the twelve seconds a banker will sit through", () => {
    expect(RETRY_BUDGET_MS).toBeLessThanOrEqual(12_000);
  });

  it("recovers on the THIRD attempt without anyone touching the page", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(UNAVAILABLE)
      .mockRejectedValueOnce(UNAVAILABLE)
      .mockResolvedValue({ payload: "ok" });
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, { read: true });
    await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    await expect(p).resolves.toMatchObject({ payload: "ok" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("a write WITHOUT the idempotent flag falls straight through: an ambiguous rejection is not proof the tool did not run", async () => {
    const fn = vi.fn().mockRejectedValue(UNAVAILABLE);
    installMcp({ callTool: fn });
    for (const tool of [TOOLS.stageLoanModification, TOOLS.executeLoanModification, TOOLS.executeAnnualReview]) {
      const seen = callTool(SERVERS.customer360, tool, { inputs: [{}] }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
      expect(await seen, tool).toMatchObject({ ambiguous: true });
    }
    // One attempt each, and not one more: three calls for three tools.
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

/* ===================================================== the idempotent write

   THE RULE THAT MOVED (2026-09-13). "Never auto-retry a write" was written
   before the keys existed and is wrong for the two governed tools: a stage under
   one idempotencyKey returns the row the org already holds, and an execute under
   one stagingId + token reports the run already made. So a caller that can
   promise the same key goes back out says `idempotent: true` and gets three
   attempts on a LOST answer only. Everything else is unchanged, and the tests
   above still hold the line for every write that does not claim the flag. */

describe("callTool: an idempotent write is re-asked under the same key", () => {
  const IDEMPOTENT = { cache: false as const, idempotent: true };

  it("re-asks on the relay's own 502 and resolves on the second answer", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: "server_unavailable", message: "request failed (502)" }).mockResolvedValue({ payload: "ok" });
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, { inputs: [{ idempotencyKey: "k1" }] }, IDEMPOTENT);
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    await expect(p).resolves.toMatchObject({ payload: "ok", attempts: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("sends the SAME payload on every attempt: a new key would be a second row", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "server_unavailable" });
    installMcp({ callTool: fn });
    const input = { inputs: [{ idempotencyKey: "k1", rationale: "one plan" }] };
    const seen = callTool(SERVERS.customer360, TOOLS.stageLoanModification, input, IDEMPOTENT).catch((e) => e);
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    await seen;
    expect(fn).toHaveBeenCalledTimes(WRITE_RETRY_ATTEMPTS);
    for (const call of fn.mock.calls) expect(call[2]).toEqual(input);
  });

  it("counts its attempts on the answer and on the failure", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "server_unavailable" });
    installMcp({ callTool: fn });
    const seen = callTool(SERVERS.customer360, TOOLS.executeLoanModification, { inputs: [{}] }, IDEMPOTENT).catch((e) => e);
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    expect(await seen).toMatchObject({ code: "server_unavailable", attempts: WRITE_RETRY_ATTEMPTS });
  });

  it("never re-asks a refusal the org actually made", async () => {
    for (const code of ["tool_error", "bad_request", "needs_reauth", "not_in_manifest"]) {
      const fn = vi.fn().mockRejectedValue({ code });
      installMcp({ callTool: fn });
      const seen = callTool(SERVERS.customer360, TOOLS.stageLoanModification, { inputs: [{}] }, IDEMPOTENT).catch((e) => e);
      await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
      expect(await seen, code).toMatchObject({ code });
      expect(fn, code).toHaveBeenCalledTimes(1);
    }
  });

  it("re-asks the page's own deadline, which is a lost answer and not a refusal", async () => {
    expect(isRetryableWrite(laneTimeout({ server: "S", tool: "T", ms: 10, ambiguous: true }))).toBe(true);
    expect(isRetryableWrite(describeFailure({ code: "server_unavailable" }, "S", "T"))).toBe(true);
    expect(isRetryableWrite(describeFailure({ code: "upstream_error" }, "S", "T"))).toBe(true);
    expect(isRetryableWrite(describeFailure({ code: "tool_error", retryable: true }, "S", "T"))).toBe(false);
    expect(isRetryableWrite(describeFailure({ code: "needs_reauth" }, "S", "T"))).toBe(false);
  });

  it("waits longer than a read does before it asks again", () => {
    const window = { minMs: WRITE_RETRY_MIN_MS, maxMs: WRITE_RETRY_MAX_MS };
    expect(retryDelayMs({}, () => 0.5, 0, window)).toBeGreaterThanOrEqual(WRITE_RETRY_MIN_MS);
    expect(retryDelayMs({}, () => 0.999999, 0, window)).toBeLessThanOrEqual(WRITE_RETRY_MAX_MS);
    // Doubling, the same as a read's: roughly 1.5s then 3s.
    expect(retryDelayMs({}, () => 0.5, 1, window)).toBeGreaterThan(retryDelayMs({}, () => 0.5, 0, window));
    // Randomised, so two page sessions do not knock in lockstep.
    expect(retryDelayMs({}, () => 0, 0, window)).not.toBe(retryDelayMs({}, () => 0.99, 0, window));
  });

  it("lets a caller veto the next ask, and stops there", async () => {
    const fn = vi.fn().mockRejectedValue({ code: "server_unavailable" });
    installMcp({ callTool: fn });
    const seen = callTool(
      SERVERS.customer360,
      TOOLS.executeLoanModification,
      { inputs: [{}] },
      { ...IDEMPOTENT, beforeRetry: () => false },
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    expect(await seen).toMatchObject({ attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("tells the caller it is asking again, before it waits", async () => {
    const fn = vi.fn().mockRejectedValueOnce({ code: "server_unavailable" }).mockResolvedValue({ payload: "ok" });
    installMcp({ callTool: fn });
    const asked: number[] = [];
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, { inputs: [{}] }, { ...IDEMPOTENT, onAttempt: (i) => asked.push(i.attempt) });
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    await p;
    expect(asked).toEqual([2]);
  });

  it("puts every attempt on the lane's own history, and leaves the lane live when one answers", async () => {
    __resetLaneHealthForTests();
    const fn = vi.fn().mockRejectedValueOnce({ code: "server_unavailable" }).mockResolvedValue({ payload: "ok" });
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, { inputs: [{}] }, IDEMPOTENT);
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);
    await p;
    const calls = laneCalls(SERVERS.customer360);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.ok)).toEqual([false, true]);
    expect(laneOf(SERVERS.customer360)?.state).toBe("live");
  });
});

describe("watchTool: the banner waits for the retry", () => {
  it("does NOT report a retryable failure; it re-reads and delivers the data", async () => {
    const callToolFn = vi.fn().mockResolvedValue({ payload: { x: 1 }, cache: { storedAt: 42, revalidating: false } });
    const { captured } = installWatch(callToolFn);
    const events: Array<Record<string, unknown>> = [];
    watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, (e) => events.push(e));

    captured.handler!({ type: "error", error: UNAVAILABLE });
    // NOTHING is shown yet: this is the failure the banker used to be told about.
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(callToolFn).toHaveBeenCalledTimes(1);
    expect(callToolFn.mock.calls[0][3]).toMatchObject({ cache: { refresh: true } });
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ payload: { x: 1 } });
    expect(events.some((e) => e.failure)).toBe(false);
  });

  it("reports the failure once the whole budget is spent", async () => {
    const callToolFn = vi.fn().mockRejectedValue(UNAVAILABLE);
    const { captured } = installWatch(callToolFn);
    const events: Array<Record<string, unknown>> = [];
    watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, (e) => events.push(e));

    captured.handler!({ type: "error", error: UNAVAILABLE });
    // Still nothing at the end of the FIRST wait: the chain has more to spend.
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    expect(events).toHaveLength(1);
    expect(events[0].failure).toMatchObject({ code: "server_unavailable", retract: false });
    // The watch event itself is attempt one; the re-reads are the other two.
    expect(callToolFn).toHaveBeenCalledTimes(RETRY_ATTEMPTS - 1);
  });

  it("runs ONE chain per refresh: a second error while it runs starts nothing", async () => {
    const callToolFn = vi.fn().mockResolvedValue({ payload: { x: 1 } });
    const { captured } = installWatch(callToolFn);
    watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, () => {});

    captured.handler!({ type: "error", error: UNAVAILABLE });
    captured.handler!({ type: "error", error: UNAVAILABLE });
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(callToolFn).toHaveBeenCalledTimes(1);
  });

  it("reports an authz denial IMMEDIATELY: a retry could not fix it", async () => {
    const callToolFn = vi.fn();
    const { captured } = installWatch(callToolFn);
    const events: Array<Record<string, unknown>> = [];
    watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, (e) => events.push(e));

    captured.handler!({ type: "error", error: { code: "needs_reauth", retryable: true } });
    expect(events[0].failure).toMatchObject({ code: "needs_reauth", retract: true });
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(callToolFn).not.toHaveBeenCalled();
  });

  it("a live event that arrives first cancels the pending retry", async () => {
    const callToolFn = vi.fn().mockResolvedValue({ payload: { x: 2 } });
    const { captured } = installWatch(callToolFn);
    const events: Array<Record<string, unknown>> = [];
    watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, (e) => events.push(e));

    captured.handler!({ type: "error", error: UNAVAILABLE });
    captured.handler!({ type: "data", result: { payload: { x: 9 } } });
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(callToolFn).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ payload: { x: 9 } });
  });

  it("unsubscribing cancels a pending retry and silences the handler", async () => {
    const callToolFn = vi.fn().mockResolvedValue({ payload: { x: 1 } });
    const { captured, unsub } = installWatch(callToolFn);
    const events: Array<Record<string, unknown>> = [];
    const stop = watchTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{}] }, (e) => events.push(e));

    captured.handler!({ type: "error", error: UNAVAILABLE });
    stop();
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS + 50);
    expect(unsub).toHaveBeenCalled();
    expect(callToolFn).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });
});
