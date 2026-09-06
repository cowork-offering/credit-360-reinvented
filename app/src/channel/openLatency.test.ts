// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../intent/fakeDb";
import { __setDbForTests } from "./dbDoor";
import { __resetLaneHealthForTests, laneCalls, laneOf, LANE_CALL_HISTORY } from "./laneHealth";
import { __resetPrefetchForTests, prefetchOpen } from "./openPrefetch";
import {
  __resetOpenBurstForTests,
  OPEN_LANE_DEADLINE_MS,
  OPEN_MAX_IN_FLIGHT,
  openInFlightLimit,
  startOpenRefresh,
} from "./openRefresh";
import { callTool, SERVERS, TOOLS } from "./mcp";
import { MAX_IN_FLIGHT } from "./syncSweep";

/* =============================================================================
   THE RELAY BUDGET: what the open costs when the wire is slow.

   FOUNDER, 2026-09-06: "let's make it award winning, sexy and latency free."
   Measured the same day against the read backup's own MCP endpoint, one call
   costs 243-542ms and six issued together answer in 534ms of wall clock TOTAL,
   so the six open reads were paying three round trips for work the transport
   serves in one. Four things are asserted here and each is a way that could
   silently come back:

     1. all six leave together, so a slow relay is paid once and not three times;
     2. `rate_limited` narrows the page, permanently, on the platform's own word
        and on nothing else;
     3. a lane that never answers is FAILED at fifteen seconds, not left holding
        a slot and a spinner for a minute and a half;
     4. a read that left before React did is ADOPTED, not issued a second time.

   And one more, which is the thing that makes any of it checkable from the
   founder's seat: every call's own wall time reaches the lane store.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

function installMcp(callTool: ReturnType<typeof vi.fn>) {
  w.claude = { mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() } };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetLaneHealthForTests();
  __resetOpenBurstForTests();
  __resetPrefetchForTests();
  __setDbForTests(createFakeDb());
});

afterEach(() => {
  vi.useRealTimers();
  __setDbForTests(undefined);
  delete w.claude;
  __resetLaneHealthForTests();
  __resetOpenBurstForTests();
  __resetPrefetchForTests();
  vi.restoreAllMocks();
});

function open(opts: Partial<Parameters<typeof startOpenRefresh>[0]> = {}) {
  const slices: Array<{ key: string; data: unknown }> = [];
  const failures: Array<{ key: string; code?: string }> = [];
  const stop = startOpenRefresh({
    accountId: ACCOUNT,
    onCached: () => {},
    onSlice: (key, data) => slices.push({ key, data }),
    onFailure: (key, f) => failures.push({ key, code: f?.code }),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    ...opts,
  });
  return { slices, failures, stop };
}

describe("the open goes six wide", () => {
  it("issues all six detail reads before any of them has answered", async () => {
    /* THE SHAPE OF THE OLD BUG. Paced two in flight, the third read cannot even
       be ASKED FOR until the first has come back, so a 500ms relay costs 1.5s.
       Nothing here answers, so the only calls that can exist are the ones the
       page was willing to have in flight at once. */
    const inFlight: string[] = [];
    installMcp(
      vi.fn().mockImplementation((_s: string, tool: string) => {
        inFlight.push(tool);
        return new Promise(() => {});
      }),
    );

    const { stop } = open();
    await vi.advanceTimersByTimeAsync(50);

    expect(inFlight).toHaveLength(OPEN_MAX_IN_FLIGHT);
    expect(new Set(inFlight)).toEqual(
      new Set([TOOLS.snapshot, TOOLS.graph, TOOLS.exposure, TOOLS.covenants, TOOLS.opportunities, TOOLS.structuralSignals]),
    );
    stop();
  });

  it("narrows to the sweep's pacing once the platform says rate_limited, and stays narrow", async () => {
    // The first open is refused for being too wide. Every open after it is
    // paced, for the life of the page: a relay rationing calls at 22:34 is
    // still rationing them at 22:35.
    installMcp(vi.fn().mockRejectedValue({ code: "rate_limited", message: "too many" }));

    expect(openInFlightLimit()).toBe(OPEN_MAX_IN_FLIGHT);
    const first = open();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(openInFlightLimit()).toBe(MAX_IN_FLIGHT);
    first.stop();

    // And the next open actually launches at the narrower width.
    const inFlight: string[] = [];
    installMcp(
      vi.fn().mockImplementation((_s: string, tool: string) => {
        inFlight.push(tool);
        return new Promise(() => {});
      }),
    );
    const second = open();
    // The narrow pacing brings back the 200ms launch gap with it, so this has
    // to be given long enough for two launches and not for a third.
    await vi.advanceTimersByTimeAsync(500);
    expect(inFlight).toHaveLength(MAX_IN_FLIGHT);
    second.stop();
  });

  it("does not narrow on any other refusal", async () => {
    installMcp(vi.fn().mockRejectedValue({ code: "server_unavailable", message: "request failed (502)" }));
    const { stop } = open();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(openInFlightLimit()).toBe(OPEN_MAX_IN_FLIGHT);
    stop();
  });
});

describe("a lane that never answers", () => {
  it("is failed on the page's own clock, with the lane's last good time standing", async () => {
    /* CHAOS SHAPE: neither an answer nor a refusal. Without this clock the lane
       holds its slot, its slice reads "still loading" and the health line says
       nothing at all, for as long as the banker stands there. */
    installMcp(vi.fn().mockReturnValue(new Promise(() => {})));

    const { failures, stop } = open();
    await vi.advanceTimersByTimeAsync(OPEN_LANE_DEADLINE_MS - 1_000);
    expect(failures).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(failures).toHaveLength(OPEN_MAX_IN_FLIGHT);
    // `cancelled` is the contract's code for a deadline, and every one of them
    // is the PAGE's clock rather than something the org said.
    expect(failures.every((f) => f.code === "cancelled")).toBe(true);
    // Nothing was blanked: the lane is unreachable, not empty.
    expect(laneOf(SERVERS.customer360)?.state).toBe("unreachable");
    stop();
  });
});

describe("a read that left before React did", () => {
  it("is adopted rather than issued again", async () => {
    const calls: string[] = [];
    installMcp(
      vi.fn().mockImplementation((_s: string, tool: string) => {
        calls.push(tool);
        return Promise.resolve(envelope({ accountId: ACCOUNT, from: tool }));
      }),
    );

    prefetchOpen(ACCOUNT);
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(OPEN_MAX_IN_FLIGHT);

    const { slices, stop } = open();
    await vi.advanceTimersByTimeAsync(1_000);

    // Six answers on the glass, and still only six calls on the wire.
    expect(slices).toHaveLength(OPEN_MAX_IN_FLIGHT);
    expect(calls).toHaveLength(OPEN_MAX_IN_FLIGHT);
    stop();
  });

  it("is spent once, so a lane that fails knocks again for itself", async () => {
    let attempt = 0;
    installMcp(
      vi.fn().mockImplementation((_s: string, tool: string) => {
        attempt += 1;
        // Everything fails while the head start is in flight. The retries the
        // refresh schedules must be REAL calls, not the same dead promise.
        return attempt <= 24
          ? Promise.reject({ code: "server_unavailable", message: "request failed (502)" })
          : Promise.resolve(envelope({ accountId: ACCOUNT, from: tool }));
      }),
    );

    prefetchOpen(ACCOUNT);
    await vi.advanceTimersByTimeAsync(30_000);
    const { slices, stop } = open();
    await vi.advanceTimersByTimeAsync(180_000);

    expect(slices.length).toBeGreaterThan(0);
    stop();
  });
});

describe("what the round trip cost", () => {
  it("reaches the lane store on every call, success and refusal alike", async () => {
    installMcp(
      vi
        .fn()
        .mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(envelope({ ok: true })), 420)))
        .mockImplementationOnce(
          () => new Promise((_r, reject) => setTimeout(() => reject({ code: "tool_error", message: "no" }), 130)),
        ),
    );

    const ok = callTool(SERVERS.customer360, TOOLS.snapshot, {}, { read: true });
    await vi.advanceTimersByTimeAsync(500);
    await ok;
    expect(laneOf(SERVERS.customer360)?.lastMs).toBe(420);

    const bad = callTool(SERVERS.customer360, TOOLS.exposure, {}, { read: false }).catch(() => {});
    await vi.advanceTimersByTimeAsync(200);
    await bad;
    expect(laneOf(SERVERS.customer360)?.lastMs).toBe(130);

    const history = laneCalls(SERVERS.customer360);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ tool: TOOLS.snapshot, ms: 420, ok: true });
    expect(history[1]).toMatchObject({ tool: TOOLS.exposure, ms: 130, ok: false });
  });

  it("keeps the last ten and no more", async () => {
    installMcp(vi.fn().mockResolvedValue(envelope({ ok: true })));
    for (let i = 0; i < LANE_CALL_HISTORY + 4; i += 1) {
      await callTool(SERVERS.customer360, TOOLS.snapshot, {}, { read: true });
    }
    expect(laneCalls(SERVERS.customer360)).toHaveLength(LANE_CALL_HISTORY);
  });
});
