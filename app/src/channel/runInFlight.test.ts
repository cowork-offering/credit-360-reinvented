// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeAction, EXECUTE_CLOCK_MS, RUN_IN_FLIGHT } from "./writeTools";

/* =============================================================================
   RUN_IN_FLIGHT IS THE ORG SAYING THE RUN IS ALIVE (0.9.33, row 79).

   A retry or a resume that reaches a staging row another transaction still holds
   is refused with this code, having read and written nothing. The write lane
   never hands it on as an error: it watches the org's own trail and settles on
   what the trail says, exactly as it does for a lost answer.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ACCOUNT = "001bb00001DLtRMAA1";
const EXEC = {
  idempotencyKey: "key-stg183",
  stagingId: "a8abb00001Pq183AAB",
  planHash: "3ef3c1b7",
  decisionToken: "dt-183",
  approverUserId: "005bb000001TESTAAA",
};

const ORG_SAYS = "Another transaction holds this run. Nothing was read past the lock and nothing was written.";

/** The org's refusal, in the positional envelope the execute tools answer in. */
const refusedInFlight = {
  content: [
    {
      actionName: "execute_discard_version",
      errors: null,
      isSuccess: true,
      outputValues: { ok: false, result: null, error: { code: RUN_IN_FLIGHT, message: ORG_SAYS } },
      sortOrder: 0,
      version: 1,
    },
  ],
};

const trailRow = (row: Record<string, unknown>) => ({
  content: [
    {
      actionName: "Customer360ActionHistory",
      errors: null,
      isSuccess: true,
      outputValues: { accountId: ACCOUNT, count: 1, entries: [row] },
      sortOrder: 0,
      version: 1,
    },
  ],
});

function installLanes(answer: (tool: string) => unknown) {
  const callTool = vi.fn(async (_s: string, tool: string) => ({ payload: answer(tool) }));
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
  return callTool;
}

describe("execute_*: the org reports the run still going", () => {
  it("is never an error: it watches the trail and settles on the run the org finished", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const callTool = installLanes((tool) => {
      if (tool.startsWith("execute_")) return refusedInFlight;
      reads += 1;
      return trailRow({
        stagingId: EXEC.stagingId,
        actionId: "discard-version",
        status: reads < 3 ? "Executing" : "Completed",
        steps: [{ id: "delete_package", type: "delete", label: "Remove the version package", state: "verified", verification: "Re-query confirms all 1 gone." }],
      });
    });
    const onInFlight = vi.fn();
    const p = executeAction("discard-version", EXEC, { accountId: ACCOUNT, onInFlight });
    await vi.advanceTimersByTimeAsync(20_000);
    const out = await p;

    expect(onInFlight).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recovered).toBe(true);
    expect(out.result.terminalState).toBe("success");
    expect(out.result.steps.map((s) => s.detail)).toEqual(["Re-query confirms all 1 gone."]);
    // ONE execute: the lane reads the trail, it does not ask the org again.
    expect(callTool.mock.calls.filter((c) => String(c[1]).startsWith("execute_"))).toHaveLength(1);
    expect(reads).toBe(3);
  });

  it("hands back pending under its own code, never TRANSPORT, while the trail still reads Executing", async () => {
    vi.useFakeTimers();
    installLanes((tool) =>
      tool.startsWith("execute_")
        ? refusedInFlight
        : trailRow({ stagingId: EXEC.stagingId, actionId: "discard-version", status: "Executing" }),
    );
    const p = executeAction("discard-version", EXEC, { accountId: ACCOUNT });
    await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS + 10_000);
    const out = await p;
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.pending).toBe(true);
    expect(out.error.code).toBe(RUN_IN_FLIGHT);
    expect(out.error.message).toBe(ORG_SAYS);
  });

  it("watches for as long as the caller asks, not the gate's 45 seconds", async () => {
    vi.useFakeTimers();
    let settled = false;
    installLanes((tool) =>
      tool.startsWith("execute_")
        ? refusedInFlight
        : trailRow({ stagingId: EXEC.stagingId, actionId: "discard-version", status: settled ? "Completed" : "Executing" }),
    );
    const p = executeAction("discard-version", EXEC, { accountId: ACCOUNT, inFlightBudgetMs: 300_000 });
    await vi.advanceTimersByTimeAsync(EXECUTE_CLOCK_MS + 30_000);
    settled = true;
    await vi.advanceTimersByTimeAsync(5_000);
    const out = await p;
    expect(out.ok).toBe(true);
  });

  it("with no relationship to read the trail on, says the org's own words and still not an error code", async () => {
    installLanes(() => refusedInFlight);
    const out = await executeAction("discard-version", EXEC);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.pending).toBe(true);
    expect(out.error.code).toBe(RUN_IN_FLIGHT);
  });
});
