// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, probeConnectorGrants, SERVERS, TOOLS, WRITE_RETRY_ATTEMPTS, WRITE_RETRY_BUDGET_MS } from "./mcp";
import { doorTool, doorToolName, noteWriteDoorServers, resetWriteDoor, WRITE_DOOR_FALLBACK_NAME, writeDoorConnected, writeDoorServer } from "./writeDoor";
import { __resetLaneHealthForTests, laneCalls, laneOf } from "./laneHealth";
import { resetBoomServer } from "./boomLane";
import { DEADLINES } from "../components/workroom/deadline";

/* =============================================================================
   THE WRITE DOOR (0.9.29, SPEC-0.9.29-WRITE-DOOR).

   THE DEFECT IT CLOSES, live during a presentation on 2026-09-15: five
   `stage_loan_modification` attempts answered `server_unavailable` (502) to the
   page within seconds while the org staged every one of them (STG-0000000172 to
   175, Apex Success in 451 to 735 ms). The org's answer carries the single-use
   decision token, so a lost answer is a plan the banker cannot file. The same
   plan staged and executed first try over the REST Actions API from our own box.
   A longer ladder cannot outlast a dead window nobody can measure, so the page
   gains a second door that we run.

   WHAT MUST STAY TRUE, and is asserted below: the door is taken on a LOST
   ANSWER only, never on an answer the org actually gave; the SAME payload under
   the SAME key goes out on both doors; the door is one attempt and not a second
   ladder; the result names the door that carried it; and a door that is not
   connected, or does not serve this tool, changes nothing at all.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

function installMcp(impl: Record<string, unknown>) {
  w.claude = { mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn(), ...impl } };
  return w.claude!.mcp as Record<string, ReturnType<typeof vi.fn>>;
}

/** The connector list a viewer with the door added would produce: the read
 *  gateway serving reads and health, and the door serving the write pairs. */
const DOOR_TOOLS = [
  { name: "gw_StageLoanModification" },
  { name: "gw_ExecuteLoanModification" },
  { name: "gw_StageDiscardVersion" },
  { name: "gw_ExecuteDiscardVersion" },
  { name: "gw_health" },
];

const LISTING = [
  { server: SERVERS.customer360, authStatus: "connected", tools: [{ name: TOOLS.stageLoanModification }] },
  {
    server: SERVERS.readBackup,
    authStatus: "connected",
    tools: [{ name: "gw_Customer360Snapshot" }, { name: "gw_Customer360Covenants" }, { name: "gw_health" }],
  },
  { server: "Write door, as this viewer spelled it", authStatus: "connected", tools: DOOR_TOOLS },
];

const IDEMPOTENT = { cache: false as const, idempotent: true };
const KEY = { inputs: [{ idempotencyKey: "k1", stagingId: "a8a" }] };
const LOST = { code: "server_unavailable", message: "request failed (502)" };

/** Spend the whole write ladder's waiting, then let the door attempt settle. */
const spendLadder = () => vi.advanceTimersByTimeAsync(WRITE_RETRY_BUDGET_MS + 50);

beforeEach(() => {
  vi.useFakeTimers();
  resetWriteDoor();
  resetBoomServer();
  __resetLaneHealthForTests();
});

afterEach(() => {
  vi.useRealTimers();
  delete w.claude;
  vi.restoreAllMocks();
});

describe("the door's name for a tool", () => {
  it("is the Apex invocable class under the gateway's prefix", () => {
    expect(doorToolName(TOOLS.stageLoanModification)).toBe("gw_StageLoanModification");
    expect(doorToolName(TOOLS.executeLoanModification)).toBe("gw_ExecuteLoanModification");
    expect(doorToolName(TOOLS.stageRenewal)).toBe("gw_StageRenewal");
    expect(doorToolName(TOOLS.completeNewFacilityDetail)).toBe("gw_CompleteNewFacilityDetail");
  });

  it("is null for anything that is not a governed write", () => {
    // A read has its own second door and never this one; a name already
    // prefixed is not a cockpit tool name at all.
    expect(doorToolName(TOOLS.snapshot)).toBeNull();
    expect(doorToolName(TOOLS.boomRatios)).toBeNull();
    expect(doorToolName("gw_Customer360Snapshot")).toBeNull();
  });
});

describe("the door is found, not named", () => {
  it("takes the connector serving a staging tool and an execute tool, whatever the viewer called it", () => {
    expect(noteWriteDoorServers(LISTING)).toBe("Write door, as this viewer spelled it");
    expect(writeDoorServer()).toBe("Write door, as this viewer spelled it");
    expect(writeDoorConnected()).toBe(true);
  });

  it("never takes the read gateway, which serves reads and health and no write", () => {
    expect(noteWriteDoorServers(LISTING.slice(0, 2))).toBeNull();
    expect(writeDoorConnected()).toBe(false);
    expect(writeDoorServer()).toBe(WRITE_DOOR_FALLBACK_NAME);
  });

  it("serves only the tools the gateway published: a pair it does not carry is not callable", () => {
    noteWriteDoorServers(LISTING);
    expect(doorTool(TOOLS.stageLoanModification)).toBe("gw_StageLoanModification");
    expect(doorTool(TOOLS.stageAnnualReview)).toBeNull();
    expect(doorTool(TOOLS.snapshot)).toBeNull();
  });

  it("rides the boot probe's own round trip", async () => {
    const listTools = vi.fn().mockResolvedValue({ servers: LISTING });
    installMcp({ listTools });
    await probeConnectorGrants([SERVERS.customer360, SERVERS.writeDoor]);
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(writeDoorServer()).toBe("Write door, as this viewer spelled it");
  });

  it("files the grant under the name the calls will carry, not the fallback label", async () => {
    // A door the viewer added and then let lapse: the health row has to be able
    // to say so against the connector they can actually see in their settings.
    const lapsed = LISTING.map((s) => (s.tools === DOOR_TOOLS ? { ...s, authStatus: "needs_reauth" } : s));
    installMcp({ listTools: vi.fn().mockResolvedValue({ servers: lapsed }) });
    await probeConnectorGrants([SERVERS.customer360, SERVERS.writeDoor]);
    expect(laneOf("Write door, as this viewer spelled it")?.grant).toBe("not-granted");
    expect(laneOf(WRITE_DOOR_FALLBACK_NAME)).toBeUndefined();
  });
});

describe("the ladder falls to the door on a lost answer", () => {
  it("re-sends the SAME payload under the SAME key, once, and says the door carried it", async () => {
    noteWriteDoorServers(LISTING);
    const fn = vi
      .fn()
      .mockImplementation((server: string) =>
        server === SERVERS.customer360 ? Promise.reject(LOST) : Promise.resolve({ payload: { ok: true } }),
      );
    installMcp({ callTool: fn });

    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT);
    await spendLadder();
    await expect(p).resolves.toMatchObject({ payload: { ok: true }, door: "backup", attempts: WRITE_RETRY_ATTEMPTS + 1 });

    expect(fn).toHaveBeenCalledTimes(WRITE_RETRY_ATTEMPTS + 1);
    // Three on the hop the banker added, then one on ours.
    expect(fn.mock.calls.map((c) => c[0])).toEqual([
      SERVERS.customer360,
      SERVERS.customer360,
      SERVERS.customer360,
      "Write door, as this viewer spelled it",
    ]);
    expect(fn.mock.calls[3][1]).toBe("gw_StageLoanModification");
    // THE WHOLE CONTRACT: one key, one staging row, whichever door carries it.
    for (const call of fn.mock.calls) expect(call[2]).toEqual(KEY);
  });

  it("carries a lost EXECUTE answer too, under the same stagingId and token", async () => {
    noteWriteDoorServers(LISTING);
    const fn = vi
      .fn()
      .mockImplementation((server: string) =>
        server === SERVERS.customer360 ? Promise.reject(LOST) : Promise.resolve({ payload: { ran: true } }),
      );
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.executeLoanModification, KEY, IDEMPOTENT);
    await spendLadder();
    await expect(p).resolves.toMatchObject({ door: "backup" });
    expect(fn.mock.calls[3][1]).toBe("gw_ExecuteLoanModification");
  });

  it("is ONE attempt: a door that is down too reports the Salesforce failure, not the door's", async () => {
    noteWriteDoorServers(LISTING);
    const fn = vi.fn().mockImplementation((server: string) =>
      Promise.reject(server === SERVERS.customer360 ? LOST : { code: "server_not_connected", message: "door absent" }),
    );
    installMcp({ callTool: fn });
    const seen = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT).catch((e) => e);
    await spendLadder();
    expect(await seen).toMatchObject({ code: "server_unavailable", attempts: WRITE_RETRY_ATTEMPTS + 1 });
    expect(fn).toHaveBeenCalledTimes(WRITE_RETRY_ATTEMPTS + 1);
  });

  it("says which door answered on the ordinary path too", async () => {
    noteWriteDoorServers(LISTING);
    installMcp({ callTool: vi.fn().mockResolvedValue({ payload: { ok: true } }) });
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT);
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ door: "salesforce", attempts: 1 });
  });
});

describe("the door is never taken on an answer the org gave", () => {
  const refusals = ["tool_error", "bad_request", "needs_reauth", "not_in_manifest", "blocked_by_policy"];

  it.each(refusals)("stays shut on %s", async (code) => {
    noteWriteDoorServers(LISTING);
    const fn = vi.fn().mockRejectedValue({ code, message: code });
    installMcp({ callTool: fn });
    const seen = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT).catch((e) => e);
    await spendLadder();
    expect(await seen).toMatchObject({ code });
    // One attempt, no ladder, no door: a refusal is an answer.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stays shut on a VALIDATION_FAILED, which is a successful invocation the org answered", async () => {
    noteWriteDoorServers(LISTING);
    // The domain refusal rides INSIDE the envelope: the call resolves, and a
    // resolved call never reaches any ladder.
    const refused = {
      payload: { content: [{ isSuccess: true, errors: null, outputValues: { ok: false, error: { code: "VALIDATION_FAILED" } } }] },
    };
    const fn = vi.fn().mockResolvedValue(refused);
    installMcp({ callTool: fn });
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT);
    await vi.advanceTimersByTimeAsync(10);
    await expect(p).resolves.toMatchObject({ door: "salesforce" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stays shut for a write that claimed no idempotency, and for a read", async () => {
    noteWriteDoorServers(LISTING);
    const fn = vi.fn().mockRejectedValue(LOST);
    installMcp({ callTool: fn });

    const write = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, { cache: false }).catch((e) => e);
    await spendLadder();
    await write;
    expect(fn).toHaveBeenCalledTimes(1);

    fn.mockClear();
    const read = callTool(SERVERS.customer360, TOOLS.snapshot, { inputs: [{}] }, { read: true }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    await read;
    // The read climbs its own ladder and stops: its second door is the read
    // gateway's, and it is never this one.
    expect(fn.mock.calls.every((c) => c[0] === SERVERS.customer360)).toBe(true);
  });

  it("stays shut once the caller has vetoed the next ask", async () => {
    noteWriteDoorServers(LISTING);
    const fn = vi.fn().mockRejectedValue(LOST);
    installMcp({ callTool: fn });
    // The execute lane vetoes when the org's trail says the first ask left
    // Staged: Apex has it, the token is spent, and no door may re-enter.
    const seen = callTool(SERVERS.customer360, TOOLS.executeLoanModification, KEY, {
      ...IDEMPOTENT,
      beforeRetry: () => false,
    }).catch((e) => e);
    await spendLadder();
    expect(await seen).toMatchObject({ attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stays shut where no door was discovered, or where the door does not serve the tool", async () => {
    const fn = vi.fn().mockRejectedValue(LOST);
    installMcp({ callTool: fn });
    const nothing = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT).catch((e) => e);
    await spendLadder();
    expect(await nothing).toMatchObject({ attempts: WRITE_RETRY_ATTEMPTS });
    expect(fn).toHaveBeenCalledTimes(WRITE_RETRY_ATTEMPTS);

    fn.mockClear();
    noteWriteDoorServers(LISTING);
    const unserved = callTool(SERVERS.customer360, TOOLS.stageAnnualReview, KEY, IDEMPOTENT).catch((e) => e);
    await spendLadder();
    expect(await unserved).toMatchObject({ attempts: WRITE_RETRY_ATTEMPTS });
    expect(fn).toHaveBeenCalledTimes(WRITE_RETRY_ATTEMPTS);
  });
});

describe("the health line can say which hop filed the plan", () => {
  it("leaves Salesforce reading via backup and the door reading live", async () => {
    noteWriteDoorServers(LISTING);
    installMcp({
      callTool: vi
        .fn()
        .mockImplementation((server: string) =>
          server === SERVERS.customer360 ? Promise.reject(LOST) : Promise.resolve({ payload: { ok: true } }),
        ),
    });
    const p = callTool(SERVERS.customer360, TOOLS.stageLoanModification, KEY, IDEMPOTENT);
    await spendLadder();
    await p;
    expect(laneOf(SERVERS.customer360)?.state).toBe("backup");
    expect(laneOf("Write door, as this viewer spelled it")?.state).toBe("live");
    // Every attempt is on the Salesforce lane's own history, the door's on its.
    expect(laneCalls(SERVERS.customer360).map((c) => c.ok)).toEqual([false, false, false]);
    expect(laneCalls("Write door, as this viewer spelled it").map((c) => c.tool)).toEqual(["gw_StageLoanModification"]);
  });
});

describe("the room's stage budget holds the ladder plus one door attempt", () => {
  it("is 32 seconds: 3 Salesforce attempts and one door attempt at 6s, plus the ladder's own waits", () => {
    const ATTEMPT_ALLOWANCE_MS = 6_000;
    const attempts = WRITE_RETRY_ATTEMPTS + 1;
    expect(attempts * ATTEMPT_ALLOWANCE_MS + WRITE_RETRY_BUDGET_MS).toBe(30_000);
    expect(DEADLINES.stage).toBe(32_000);
    // The room's clock is the one that fires on a ladder; the seam's 60s bounds
    // ONE attempt and the whole ladder still fits inside it.
    expect(attempts * ATTEMPT_ALLOWANCE_MS + WRITE_RETRY_BUDGET_MS).toBeLessThanOrEqual(60_000);
  });
});
