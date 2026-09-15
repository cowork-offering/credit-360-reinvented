// @vitest-environment jsdom
/* THE READ SEAM (0.9.30, backlog row 73, knowledge/SPEC-0.9.30-READ-COALESCING.md).

   ONE PAGE, ONE IN-FLIGHT READ PER QUESTION, and a hosted hop is a shared resource. These are the
   properties that hold the founder's 2026-09-15 burst down: the ladder is climbed once per
   question, lane health is marked once, the Salesforce hop never sees more than four reads at a
   time, and the two governed writes never queue behind a read. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callTool,
  HOSTED_READ_MAX_IN_FLIGHT,
  READ_COALESCE_WINDOW_MS,
  SERVERS,
  TOOLS,
  __resetReadSeamForTests,
} from "./mcp";
import { __resetLaneHealthForTests, laneCalls, laneOf } from "./laneHealth";

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

function installMcp(callTool: unknown) {
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
}

/** A call that never settles until the test lets it. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const READ = { read: true, cache: { staleTime: 15_000 } } as const;
const SNAPSHOT_INPUT = { inputs: [{ accountId: "001A" }] };

beforeEach(() => {
  __resetReadSeamForTests();
  __resetLaneHealthForTests();
});

afterEach(() => {
  delete w.claude;
  __resetReadSeamForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("coalescing", () => {
  it("shares ONE promise and ONE wire call across concurrent callers of one question", async () => {
    const gate = deferred<{ payload: unknown }>();
    const wire = vi.fn().mockReturnValue(gate.promise);
    installMcp(wire);

    const a = callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    const b = callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    const c = callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    gate.resolve({ payload: { ok: 1 } });

    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(ra.payload).toEqual({ ok: 1 });
    expect(rb.payload).toBe(ra.payload);
    expect(rc.payload).toBe(ra.payload);
  });

  it("treats the same fields in a different key order as one question", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: {} });
    installMcp(wire);
    await Promise.all([
      callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{ a: 1, b: 2 }] }, READ),
      callTool(SERVERS.customer360, TOOLS.portfolio, { inputs: [{ b: 2, a: 1 }] }, READ),
    ]);
    expect(wire).toHaveBeenCalledTimes(1);
  });

  it("keeps different arguments apart", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: {} });
    installMcp(wire);
    await Promise.all([
      callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{ accountId: "001A" }] }, READ),
      callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{ accountId: "001B" }] }, READ),
    ]);
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("answers a caller inside the post-resolution window without a second call", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: { n: 1 } });
    installMcp(wire);
    await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    const again = await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    expect(wire).toHaveBeenCalledTimes(1);
    expect(again.payload).toEqual({ n: 1 });
  });

  it("lets the window EXPIRE: the next caller asks the org again", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: {} });
    installMcp(wire);
    await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);

    const settledAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(settledAt + READ_COALESCE_WINDOW_MS);
    await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("never serves an UNCACHED read out of the window, but still shares one in flight", async () => {
    const gate = deferred<{ payload: unknown }>();
    const wire = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue({ payload: {} });
    installMcp(wire);

    const first = callTool(SERVERS.customer360, TOOLS.searchAccounts, { inputs: [{ name: "zz" }] }, { read: true, cache: false });
    const joined = callTool(SERVERS.customer360, TOOLS.searchAccounts, { inputs: [{ name: "zz" }] }, { read: true, cache: false });
    gate.resolve({ payload: {} });
    await Promise.all([first, joined]);
    expect(wire).toHaveBeenCalledTimes(1); // in flight is one live round trip

    await callTool(SERVERS.customer360, TOOLS.searchAccounts, { inputs: [{ name: "zz" }] }, { read: true, cache: false });
    expect(wire).toHaveBeenCalledTimes(2); // the window may not answer for it
  });

  it("does not serve the banker's own gesture out of the window", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: {} });
    installMcp(wire);
    await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, READ);
    await callTool(SERVERS.customer360, TOOLS.snapshot, SNAPSHOT_INPUT, { ...READ, fresh: true });
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("climbs the retry ladder ONCE for a question, however many callers asked it", async () => {
    const wire = vi.fn().mockRejectedValue({ code: "server_unavailable", message: "request failed (502)" });
    installMcp(wire);

    const asks = [
      callTool(SERVERS.customer360, TOOLS.covenants, SNAPSHOT_INPUT, READ).catch((e) => e),
      callTool(SERVERS.customer360, TOOLS.covenants, SNAPSHOT_INPUT, READ).catch((e) => e),
      callTool(SERVERS.customer360, TOOLS.covenants, SNAPSHOT_INPUT, READ).catch((e) => e),
    ];
    const [a, b, c] = await Promise.all(asks);
    // Three attempts for the ladder, and not one more for the two who joined it.
    expect(wire).toHaveBeenCalledTimes(3);
    expect(a.code).toBe("server_unavailable");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("marks a coalesced failure on lane health ONCE, not once per caller", async () => {
    const wire = vi.fn().mockRejectedValue({ code: "tool_error", message: "no" });
    installMcp(wire);
    await Promise.all([
      callTool(SERVERS.customer360, TOOLS.exposure, SNAPSHOT_INPUT, READ).catch(() => {}),
      callTool(SERVERS.customer360, TOOLS.exposure, SNAPSHOT_INPUT, READ).catch(() => {}),
      callTool(SERVERS.customer360, TOOLS.exposure, SNAPSHOT_INPUT, READ).catch(() => {}),
    ]);
    expect(wire).toHaveBeenCalledTimes(1); // tool_error is not retryable
    // ONE row on the lane's history and ONE unreachable verdict, not three.
    expect(laneCalls(SERVERS.customer360).filter((c) => !c.ok)).toHaveLength(1);
    expect(laneOf(SERVERS.customer360)?.state).toBe("unreachable");
  });
});

describe("writes", () => {
  it("are never coalesced: two identical stage calls are two calls", async () => {
    const wire = vi.fn().mockResolvedValue({ payload: { ok: true } });
    installMcp(wire);
    const body = { idempotencyKey: "K1", accountId: "001A" };
    await Promise.all([
      callTool(SERVERS.customer360, TOOLS.stageAnnualReview, body, { cache: false, idempotent: true }),
      callTool(SERVERS.customer360, TOOLS.stageAnnualReview, body, { cache: false, idempotent: true }),
    ]);
    expect(wire).toHaveBeenCalledTimes(2);
  });

  it("never queue behind the read cap", async () => {
    const gates = Array.from({ length: HOSTED_READ_MAX_IN_FLIGHT }, () => deferred<{ payload: unknown }>());
    let read = 0;
    const started: string[] = [];
    const wire = vi.fn().mockImplementation((_server: string, tool: string) => {
      started.push(tool);
      if (tool === TOOLS.executeAnnualReview) return Promise.resolve({ payload: { ok: true } });
      return gates[read++].promise;
    });
    installMcp(wire);

    // Fill every read slot with a call that will not answer.
    const held = Array.from({ length: HOSTED_READ_MAX_IN_FLIGHT }, (_, i) =>
      callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{ accountId: `A${i}` }] }, READ),
    );
    await Promise.resolve();
    // The write goes out while all four reads are still in flight.
    await callTool(SERVERS.customer360, TOOLS.executeAnnualReview, { stagingId: "S1" }, { cache: false, idempotent: true });
    expect(started).toContain(TOOLS.executeAnnualReview);

    gates.forEach((g) => g.resolve({ payload: {} }));
    await Promise.all(held);
  });
});

describe("the hosted hop's cap", () => {
  it("shows the Salesforce hop at most four reads at once and queues the fifth", async () => {
    const gates: Array<ReturnType<typeof deferred<{ payload: unknown }>>> = [];
    const started: string[] = [];
    const wire = vi.fn().mockImplementation((_server: string, _tool: string, input: { inputs: [{ accountId: string }] }) => {
      started.push(input.inputs[0].accountId);
      const g = deferred<{ payload: unknown }>();
      gates.push(g);
      return g.promise;
    });
    installMcp(wire);

    const ids = ["A", "B", "C", "D", "E", "F"];
    const calls = ids.map((id) => callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{ accountId: id }] }, READ));
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toEqual(["A", "B", "C", "D"]);

    // Release one: the FIFO queue hands the slot to E, and only E.
    gates[0].resolve({ payload: {} });
    await calls[0];
    expect(started).toEqual(["A", "B", "C", "D", "E"]);

    gates[1].resolve({ payload: {} });
    await calls[1];
    expect(started).toEqual(["A", "B", "C", "D", "E", "F"]);

    gates.slice(2).forEach((g) => g.resolve({ payload: {} }));
    await Promise.all(calls);
  });

  it("does not ration lanes that are their own hop", async () => {
    const started: string[] = [];
    const gates: Array<ReturnType<typeof deferred<{ payload: unknown }>>> = [];
    const wire = vi.fn().mockImplementation((server: string) => {
      started.push(server);
      const g = deferred<{ payload: unknown }>();
      gates.push(g);
      return g.promise;
    });
    installMcp(wire);

    const held = Array.from({ length: HOSTED_READ_MAX_IN_FLIGHT }, (_, i) =>
      callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{ accountId: `A${i}` }] }, READ),
    );
    const mail = callTool(SERVERS.m365, TOOLS.mailSearch, { query: "acme" }, READ);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toContain(SERVERS.m365);

    gates.forEach((g) => g.resolve({ payload: {} }));
    await Promise.all([...held, mail]);
  });
});
