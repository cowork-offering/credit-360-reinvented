// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "../intent/fakeDb";
import { __setDbForTests } from "./dbDoor";
import { __resetLaneHealthForTests, laneOf } from "./laneHealth";
import { loadLastGood, MAX_AGE_MS, MAX_DOC_BYTES, putLastGood, readCachedDoc } from "./lastGood";
import { BACKGROUND_RETRY_MS, startOpenRefresh } from "./openRefresh";
import { RETRY_BUDGET_MS, SERVERS, TOOLS } from "./mcp";

/* =============================================================================
   THE OPEN, THE CACHE AND THE LANES.

   THE DEFECT ALL THREE OF THESE ANSWER (2026-09-03): the artifact-to-connector
   relay lost its Salesforce session for two hours. Every call the PAGE made
   came back `server_unavailable: request failed (502)` while the same tools
   answered normally in chat, and the cockpit showed empty modules under a
   banner that named neither the lane nor the code, with no way back except a
   reload. Three scenarios are asserted here, and they are the three the founder
   has to be able to trust:

     1. a lane that 502s for the whole session still paints its stored figures,
        and the health store names the lane AND the code;
     2. a lane that fails twice and answers on the third attempt reaches the
        banker as live data, with no gesture from anyone;
     3. a lane down for three minutes comes back inside a minute of recovering,
        again with no gesture.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const UNAVAILABLE = { code: "server_unavailable", message: "request failed (502)" };

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

/** The six detail reads answer with a slice that names its own tool, so a test
 *  can tell which lane landed which figure. */
const sliceFor = (tool: string) => envelope({ accountId: ACCOUNT, from: tool });

function installMcp(callTool: ReturnType<typeof vi.fn>) {
  w.claude = { mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() } };
}

let store: FakeDb;

beforeEach(() => {
  vi.useFakeTimers();
  __resetLaneHealthForTests();
  store = createFakeDb();
  __setDbForTests(store);
});

afterEach(() => {
  vi.useRealTimers();
  __setDbForTests(undefined);
  delete w.claude;
  __resetLaneHealthForTests();
  vi.restoreAllMocks();
});

/** Drive the refresh with the injected clock the pacer and the timers share. */
function open(opts: Partial<Parameters<typeof startOpenRefresh>[0]> = {}) {
  const slices: Array<{ key: string; data: unknown }> = [];
  const cached: Array<Record<string, unknown>> = [];
  const failures: Array<{ key: string; code?: string }> = [];
  const stop = startOpenRefresh({
    accountId: ACCOUNT,
    onCached: (c) => cached.push(c as unknown as Record<string, unknown>),
    onSlice: (key, data) => slices.push({ key, data }),
    onFailure: (key, f) => failures.push({ key, code: f?.code }),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    ...opts,
  });
  return { slices, cached, failures, stop };
}

/** Long enough for every lane to finish. Six reads at two in flight is three
 *  waves, and a wave that spends the whole retry budget takes RETRY_BUDGET_MS
 *  of waiting on top of its calls, so the floor is three budgets and change. */
const settle = (ms = 4 * RETRY_BUDGET_MS + 10_000) => vi.advanceTimersByTimeAsync(ms);

describe("the stored document", () => {
  it("keeps the payload whole, with its stamp and the tool that produced it", async () => {
    await putLastGood(ACCOUNT, "exposure", TOOLS.exposure, { totalCommitted: 12_500_000 }, 1_700_000_000_000);
    const back = await loadLastGood(ACCOUNT, 1_700_000_001_000);
    expect(back.exposure).toEqual({
      storedAt: 1_700_000_000_000,
      tool: TOOLS.exposure,
      payload: { totalCommitted: 12_500_000 },
    });
  });

  it("refuses a document the shared store handed back malformed", () => {
    const now = Date.now();
    expect(readCachedDoc(null, now)).toBeNull();
    expect(readCachedDoc({ tool: "T", payload: {} }, now)).toBeNull();
    expect(readCachedDoc({ storedAt: now, payload: {} }, now)).toBeNull();
    expect(readCachedDoc({ storedAt: now, tool: "T" }, now)).toBeNull();
    // A stamp from the future is a broken clock, not fresher data.
    expect(readCachedDoc({ storedAt: now + 600_000, tool: "T", payload: {} }, now)).toBeNull();
    // Last week's figures under a banker's eye are worse than an honest gap.
    expect(readCachedDoc({ storedAt: now - MAX_AGE_MS - 1, tool: "T", payload: {} }, now)).toBeNull();
  });

  it("skips a document too big to be worth a quota error on somebody else's write", async () => {
    await putLastGood(ACCOUNT, "graph", TOOLS.graph, { blob: "x".repeat(MAX_DOC_BYTES) });
    expect(await loadLastGood(ACCOUNT)).toEqual({});
  });

  it("writes nothing at all with no store", async () => {
    __setDbForTests(undefined);
    await expect(putLastGood(ACCOUNT, "exposure", TOOLS.exposure, { a: 1 })).resolves.toBeUndefined();
    expect(await loadLastGood(ACCOUNT)).toEqual({});
  });
});

describe("a lane that 502s for the whole session", () => {
  it("paints the stored figures, and the health store names the lane and the code", async () => {
    const storedAt = Date.now() - 60_000;
    await putLastGood(ACCOUNT, "exposure", TOOLS.exposure, { totalCommitted: 12_500_000 }, storedAt);
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    installMcp(callTool);

    const run = open();
    await settle();

    // The banker is looking at real figures, marked with their own age.
    expect(run.cached).toHaveLength(1);
    expect(run.cached[0]).toMatchObject({ exposure: { storedAt, payload: { totalCommitted: 12_500_000 } } });
    // Nothing live landed, and every lane said so rather than blanking.
    expect(run.slices).toHaveLength(0);
    expect(run.failures.map((f) => f.code)).toEqual(Array(6).fill("server_unavailable"));

    const lane = laneOf(SERVERS.customer360)!;
    expect(lane.state).toBe("unreachable");
    expect(lane.code).toBe("server_unavailable");
    expect(lane.message).toContain("502");
    run.stop();
  });
});

describe("a lane that fails twice and then answers", () => {
  it("reaches the banker as live data, with no gesture from anyone", async () => {
    const attempts = new Map<string, number>();
    const callTool = vi.fn(async (_server: string, tool: string) => {
      const n = (attempts.get(tool) ?? 0) + 1;
      attempts.set(tool, n);
      if (n <= 2) throw UNAVAILABLE;
      return sliceFor(tool);
    });
    installMcp(callTool);

    const run = open();
    await settle();

    expect(run.slices.map((s) => s.key).sort()).toEqual(
      ["covenants", "exposure", "graph", "opportunities", "signals", "snapshot"],
    );
    expect(run.failures).toHaveLength(0);
    expect(laneOf(SERVERS.customer360)!.state).toBe("live");
    // Three attempts per lane, and not one more.
    expect([...attempts.values()]).toEqual(Array(6).fill(3));
    run.stop();
  });
});

describe("a lane down for three minutes", () => {
  it("comes back inside a minute of recovering, without a click", async () => {
    let reachable = false;
    const callTool = vi.fn(async (_server: string, tool: string) => {
      if (!reachable) throw UNAVAILABLE;
      return sliceFor(tool);
    });
    installMcp(callTool);

    const run = open();
    // Three minutes of outage: the lanes spend their budget, then knock once a
    // minute. Nothing is on screen but the stored figures and the failure.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(run.slices).toHaveLength(0);
    expect(reachable).toBe(false);
    expect(run.failures.length).toBeGreaterThanOrEqual(6);
    expect(laneOf(SERVERS.customer360)!.state).toBe("unreachable");

    reachable = true;
    await vi.advanceTimersByTimeAsync(BACKGROUND_RETRY_MS + 5_000);

    expect(run.slices.map((s) => s.key).sort()).toEqual(
      ["covenants", "exposure", "graph", "opportunities", "signals", "snapshot"],
    );
    expect(laneOf(SERVERS.customer360)!.state).toBe("live");
    run.stop();
  });

  it("stops knocking the moment the banker leaves the relationship", async () => {
    const callTool = vi.fn().mockRejectedValue(UNAVAILABLE);
    installMcp(callTool);
    const run = open();
    await settle();
    const spent = callTool.mock.calls.length;
    run.stop();
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_RETRY_MS);
    expect(callTool.mock.calls.length).toBe(spent);
  });
});

describe("what the open does NOT do", () => {
  it("never knocks again on a denial a retry could not fix", async () => {
    const callTool = vi.fn().mockRejectedValue({ code: "needs_reauth", message: "reconnect" });
    installMcp(callTool);
    const run = open();
    await settle();
    const spent = callTool.mock.calls.length;
    // Six lanes, one attempt each: an authz denial is not retried at all.
    expect(spent).toBe(6);
    await vi.advanceTimersByTimeAsync(5 * BACKGROUND_RETRY_MS);
    expect(callTool.mock.calls.length).toBe(spent);
    expect(laneOf(SERVERS.customer360)!.state).toBe("unreachable");
    run.stop();
  });

  it("never patches an empty envelope over a staged slice, and never stores one", async () => {
    installMcp(vi.fn(async () => envelope({})));
    const run = open();
    await settle();
    expect(run.slices).toHaveLength(0);
    expect(await loadLastGood(ACCOUNT)).toEqual({});
    // The org ANSWERED, so the lane is live. It simply had nothing to say.
    expect(laneOf(SERVERS.customer360)!.state).toBe("live");
    run.stop();
  });

  it("does not call a slow-tier read that is still inside its window", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => sliceFor(tool));
    installMcp(callTool);
    const run = open({ fetchedAt: { snapshot: Date.now(), graph: Date.now(), covenants: Date.now() } });
    await settle();
    const tools = callTool.mock.calls.map((c) => c[1]);
    expect(tools).not.toContain(TOOLS.snapshot);
    expect(tools).not.toContain(TOOLS.graph);
    expect(tools).not.toContain(TOOLS.covenants);
    expect(tools).toContain(TOOLS.exposure);
    run.stop();
  });

  it("waits rather than patching the bundle under an open room", async () => {
    let reachable = false;
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (!reachable) throw UNAVAILABLE;
      return sliceFor(tool);
    });
    installMcp(callTool);
    const run = open({ busy: () => true });
    await settle();
    reachable = true;
    await vi.advanceTimersByTimeAsync(3 * BACKGROUND_RETRY_MS);
    // The org is reachable again and the refresh has held every patch: a live
    // slice landing here would rebuild the room's engine under the banker.
    expect(run.slices).toHaveLength(0);
    run.stop();
  });
});
