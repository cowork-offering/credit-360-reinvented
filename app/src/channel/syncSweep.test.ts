// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { reachReport, runSyncSweep } from "./syncSweep";
import { DETAIL_TOOLS, isLaneTimeout, laneTimeout, RETRY_ATTEMPTS, RETRY_BUDGET_MS, SERVERS, TOOLS, withDeadline } from "./mcp";
import { diffBundles, deltaReport } from "../data/delta";
import type { BorrowerBundle } from "../data/contract";
import envelopes from "../data/observed-exposure-envelopes.json";

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
});

const ok = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

/** No pacing in tests: the ORDER and the binding are the contract, not the wait. */
const nopause = () => Promise.resolve();

function installMcp(handler: (server: string, tool: string, input: unknown) => unknown) {
  const callTool = vi.fn(async (server: string, tool: string, input: unknown) => handler(server, tool, input));
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() } };
  return callTool;
}

/** THE SAME READ, ON EITHER DOOR. Every mirrored Customer 360 read now falls
 *  back to the "Salesforce Read Backup" lane, whose tool is the same name with
 *  a `gw_` prefix. A test that means "this read did not come back" therefore
 *  has to shut BOTH doors, or it is quietly testing the fallback instead. */
const eitherDoor = (tool: string, name: string) => tool === name || tool === `gw_${name}`;

const SWEEP = { accountId: "001X", accountName: "Sterling Fabrication Co.", generatedAt: "2026-07-02T09:15:00Z", sleep: nopause };

describe("every line is bound to a real call", () => {
  it("fires one call per line and ticks in order", async () => {
    const calls: string[] = [];
    installMcp((_s, tool) => {
      calls.push(tool);
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return ok({ ok: true });
    });

    const seen: string[][] = [];
    const result = await runSyncSweep({ ...SWEEP, onLines: (lines) => seen.push(lines.map((l) => `${l.id}:${l.state}`)) });

    // One call per detail tool, plus the portfolio read, plus the mail search.
    for (const tool of DETAIL_TOOLS) expect(calls).toContain(tool);
    expect(calls).toContain(TOOLS.portfolio);
    expect(calls).toContain(TOOLS.mailSearch);
    expect(calls).toContain(TOOLS.actionHistory);
    expect(calls).toHaveLength(DETAIL_TOOLS.length + 3);

    // Every line ends settled, and no line ticked before the one before it.
    const order = result.lines.map((l) => l.id);
    expect(order[0]).toBe("portfolio");
    expect(order.at(-1)).toBe("mail");
    for (const l of result.lines) expect(["done", "failed"]).toContain(l.state);

    // A line is never shown as done before it has been shown as running.
    const first = seen.find((s) => s.includes("snapshot:done"));
    expect(seen.findIndex((s) => s.includes("snapshot:running"))).toBeLessThan(seen.indexOf(first!));
  });

  it("never ticks a line before its own call has returned", async () => {
    let releaseExposure: (() => void) | null = null;
    const gate = new Promise<void>((r) => (releaseExposure = r));
    installMcp(async (_s, tool) => {
      if (tool === TOOLS.exposure) await gate;
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return ok({ ok: true });
    });

    let exposureDoneWhileGated = false;
    const run = runSyncSweep({
      ...SWEEP,
      onLines: (lines) => {
        if (lines.find((l) => l.id === "exposure")?.state === "done" && releaseExposure) exposureDoneWhileGated = true;
      },
    });
    await Promise.resolve();
    expect(exposureDoneWhileGated).toBe(false);
    releaseExposure!();
    releaseExposure = null;
    await run;
    expect(exposureDoneWhileGated).toBe(false);
  });

  it("runs on the gesture only: nothing is called until the sweep is invoked", async () => {
    const callTool = installMcp(() => ok({ ok: true }));
    expect(callTool).not.toHaveBeenCalled();
    await runSyncSweep(SWEEP);
    expect(callTool).toHaveBeenCalled();
  });
});

describe("failure keeps the last-good data", () => {
  it("marks the failed line and patches nothing for it", async () => {
    installMcp((_s, tool) => {
      if (eitherDoor(tool, TOOLS.covenants)) throw { code: "upstream_error", message: "boom" };
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return ok({ ok: true, marker: tool });
    });

    const result = await runSyncSweep(SWEEP);
    const line = result.lines.find((l) => l.id === "covenants")!;
    expect(line.state).toBe("failed");
    expect(line.detail).toBeTruthy();
    expect(result.partial).toBe(true);
    // The section is simply absent from the patch, so the view keeps what it had.
    expect(result.patch.covenants).toBeUndefined();
    expect(result.patch.exposure).toBeDefined();
  });

  it("treats a per-element failure inside a good envelope the same way", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.exposure) {
        return { payload: { content: [{ actionName: "t", isSuccess: false, errors: ["no access"], sortOrder: 0, version: 1 }] } };
      }
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return ok({ ok: true });
    });
    const result = await runSyncSweep(SWEEP);
    expect(result.lines.find((l) => l.id === "exposure")!.state).toBe("failed");
    expect(result.patch.exposure).toBeUndefined();
  });
});

describe("the inbox line is opportunistic (A29)", () => {
  it("disappears without a trace when Microsoft 365 is not connected", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) throw { code: "server_not_connected", message: "not connected" };
      return ok({ ok: true });
    });
    const result = await runSyncSweep(SWEEP);
    expect(result.lines.find((l) => l.id === "mail")).toBeUndefined();
    expect(result.lines.some((l) => l.state === "failed")).toBe(false);
    expect(result.partial).toBe(false);
  });

  it("ingests only the messages that clearly name the account", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) {
        return {
          payload: {
            value: [
              { id: "m1", subject: "Sterling Fabrication Co. covenant question", receivedDateTime: "2026-07-01T10:00:00Z" },
              { id: "m2", subject: "Lunch on Thursday", receivedDateTime: "2026-07-01T11:00:00Z" },
            ],
          },
        };
      }
      return ok({ ok: true });
    });
    const result = await runSyncSweep(SWEEP);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].kind).toBe("REQUEST_RECEIVED");
    expect(result.requests[0].id).toContain("m1");
  });

  it("clamps a message dated after the render clock", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) {
        return { payload: { value: [{ id: "m9", subject: "Sterling Fabrication Co. update", receivedDateTime: "2027-01-01T00:00:00Z" }] } };
      }
      return ok({ ok: true });
    });
    const result = await runSyncSweep(SWEEP);
    expect(result.requests[0].ts).toBe(SWEEP.generatedAt);
  });
});

describe("delta detection", () => {
  const before: BorrowerBundle = {
    snapshot: { accountId: "001X", totalCreditExposure: 18_000_000, primaryRiskRating: "5" },
    exposure: {
      totalCommitted: 18_000_000,
      totalOutstanding: 16_900_000,
      facilities: [{ loanId: "a1X1", name: "Revolver", committed: 10_000_000, outstanding: 9_000_000 }],
    },
    covenants: { covenants: [{ covenantId: "cv1", covenantType: "DSCR", actualValue: 1.38, thresholdValue: 1.3 }] },
  };

  it("reports a changed figure with its display id", () => {
    const after = structuredClone(before);
    after.exposure!.totalOutstanding = 17_400_000;
    after.covenants!.covenants![0].actualValue = 1.21;
    const deltas = diffBundles(before, after);
    expect(deltas.map((d) => d.id).sort()).toEqual(["covenant.cv1.actualValue", "exposure.totalOutstanding"]);
    expect(deltaReport(deltas, 0)).toBe("2 figures changed.");
  });

  it("reports nothing when nothing moved", () => {
    expect(diffBundles(before, structuredClone(before))).toEqual([]);
    expect(deltaReport([], 0)).toBe("Everything current, nothing new.");
  });

  it("keys facilities by record id, so a reorder is not a change", () => {
    const after = structuredClone(before);
    after.exposure!.facilities!.unshift({ loanId: "a1X2", name: "Term Loan", committed: 8_000_000, outstanding: 7_900_000 });
    // The new facility was not on screen before, so it is not reported as a
    // change to a figure the banker had already read.
    expect(diffBundles(before, after)).toEqual([]);
  });

  it("counts new client requests alongside the figures", () => {
    expect(deltaReport([], 1)).toBe("1 new client request.");
    const after = structuredClone(before);
    after.snapshot!.primaryRiskRating = "6";
    expect(deltaReport(diffBundles(before, after), 2)).toBe("1 figure changed, 2 new client requests.");
  });
});

describe("budget discipline", () => {
  it("costs one round of reads per sweep, not one per line", async () => {
    const callTool = installMcp((_s, tool) => (tool === TOOLS.mailSearch ? { payload: { value: [] } } : ok({ ok: true })));
    await runSyncSweep(SWEEP);
    expect(callTool.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it("snapshot joins the slow tier: inside its 90s window the tool is not called at all", async () => {
    const { SNAPSHOT_STALE_MS, SLOW_TIER_STALE_MS } = await import("./syncSweep");
    expect(SNAPSHOT_STALE_MS).toBeLessThan(SLOW_TIER_STALE_MS); // headline figures may move sooner than the graph
    const callTool = installMcp((_s, tool) => (tool === TOOLS.mailSearch ? { payload: { value: [] } } : ok({ ok: true })));
    const t0 = 1_000_000;
    await runSyncSweep({
      ...SWEEP,
      now: () => t0,
      slowTierFetchedAt: { snapshot: t0 - (SNAPSHOT_STALE_MS - 1) },
    });
    const toolsCalled = callTool.mock.calls.map((c) => String(c[1]));
    expect(toolsCalled).not.toContain(DETAIL_TOOLS[0]); // snapshot served from cache
    expect(toolsCalled).toContain(DETAIL_TOOLS[2]); // exposure still fetched every sync
  });

  it("snapshot outside its window is fetched again", async () => {
    const { SNAPSHOT_STALE_MS } = await import("./syncSweep");
    const callTool = installMcp((_s, tool) => (tool === TOOLS.mailSearch ? { payload: { value: [] } } : ok({ ok: true })));
    const t0 = 1_000_000;
    await runSyncSweep({
      ...SWEEP,
      now: () => t0,
      slowTierFetchedAt: { snapshot: t0 - (SNAPSHOT_STALE_MS + 1) },
    });
    expect(callTool.mock.calls.map((c) => String(c[1]))).toContain(DETAIL_TOOLS[0]);
  });

  it("reads only: every call is marked read on the connector", async () => {
    const callTool = installMcp((_s, tool) => (tool === TOOLS.mailSearch ? { payload: { value: [] } } : ok({ ok: true })));
    await runSyncSweep(SWEEP);
    for (const call of callTool.mock.calls) {
      expect([SERVERS.customer360, SERVERS.m365]).toContain(String(call[0]));
      expect([TOOLS.mailSearch, TOOLS.portfolio, TOOLS.actionHistory, ...DETAIL_TOOLS]).toContain(String(call[1]));
    }
  });
});

describe("the overlay carries the coverage members the org added", () => {
  /* The sweep patches the exposure slice VERBATIM, so additive members need no
     mapping — which is exactly why it needs a test. A future "tidy" that maps
     the slice field by field would silently drop coverageNote and put the blank
     coverage state back on a live sync. */
  const OBSERVED = envelopes.exposure_read_piedmont_v2[0].outputValues;

  it("passes the observed exposure envelope through untouched", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (tool === TOOLS.exposure) return ok(OBSERVED);
      return ok({ ok: true });
    });

    const result = await runSyncSweep({ ...SWEEP, accountId: "001bb00001DLtRMAA1" });
    expect(result.patch.exposure).toEqual(OBSERVED);

    const exp = result.patch.exposure!;
    expect(exp.coverageRatio).toBe(1.65);
    expect(exp.totalUniqueCollateralLendableValue).toBe(14_000_000);
    expect(exp.uniqueCollateralCount).toBe(2);
    const drawnNoCover = exp.facilities!.filter((f) => f.coverageShortfall);
    expect(drawnNoCover).toHaveLength(2);
    expect(drawnNoCover[0].coverageNote).toContain("no collateral is pledged");
    expect(exp.facilities![2].collateral![0].amountPledged).toBe(5_000_000);
    expect(exp.facilities![2].collateral![0].advanceRateSource).toBe("Collateral type default");
  });
});

describe("reachability is its own sentence on the console", () => {
  /* THE FOUNDER'S SYMPTOM: the covenant position looked like it was "failing on
     Sync". It was not. An idle-expired MCP session failed the covenant read
     transiently, the line degraded correctly, and the summary then said
     "Everything current, nothing new", which reads as an all-clear over a
     section that never came back. Reachability now gets its own sentence, and
     it distinguishes a transient miss from a refusal a retry cannot fix. */

  const allGood = () => installMcp((_s, tool) => (tool === TOOLS.mailSearch ? { payload: { value: [] } } : ok({ ok: true })));

  it("says how many lines refreshed when the org answered", async () => {
    allGood();
    const result = await runSyncSweep(SWEEP);
    expect(result.unreachable).toBe(0);
    expect(result.refreshed).toBe(9); // portfolio + six detail + history + mail
    expect(reachReport(result)).toBe("Reachable, 9 lines refreshed.");
  });

  it("retries a retryable line and says nothing about it when the retry lands", async () => {
    vi.useFakeTimers();
    let covenantAttempts = 0;
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (tool === TOOLS.covenants) {
        covenantAttempts += 1;
        if (covenantAttempts === 1) throw { code: "server_unavailable", message: "session expired", retryable: true };
      }
      return ok({ ok: true });
    });

    const run = runSyncSweep(SWEEP);
    await vi.advanceTimersByTimeAsync(RETRY_BUDGET_MS + 50);
    const result = await run;
    vi.useRealTimers();

    // The retry landed on the second attempt, so the budget was never spent.
    expect(covenantAttempts).toBe(2); // the retry, spent inside callTool
    expect(result.lines.find((l) => l.id === "covenants")!.state).toBe("done");
    expect(result.unreachable).toBe(0);
    expect(reachReport(result)).toBe("Reachable, 9 lines refreshed.");
  });

  it("reports a line STILL unreachable after that retry", async () => {
    vi.useFakeTimers();
    let covenantAttempts = 0;
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (eitherDoor(tool, TOOLS.covenants)) {
        if (tool === TOOLS.covenants) covenantAttempts += 1;
        throw { code: "server_unavailable", message: "session expired", retryable: true };
      }
      return ok({ ok: true });
    });

    const run = runSyncSweep(SWEEP);
    // TWO budgets: the primary spends its three attempts, then the backup lane
    // spends its own on the mirrored name before the line can report anything.
    // Still well inside LANE_DEADLINE_MS, so this is a refusal and not a hang.
    await vi.advanceTimersByTimeAsync(2 * RETRY_BUDGET_MS + 50);
    const result = await run;
    vi.useRealTimers();

    // Three attempts since 2026-09-05: the relay outage's own 502 survived two.
    expect(covenantAttempts).toBe(RETRY_ATTEMPTS);
    const line = result.lines.find((l) => l.id === "covenants")!;
    expect(line.state).toBe("failed");
    expect(line.detail).toContain("briefly unreachable");
    expect(result.unreachable).toBe(1);
    expect(reachReport(result)).toBe("1 line still unreachable after retry.");
    // The section kept its previous value, exactly as before.
    expect(result.patch.covenants).toBeUndefined();
    expect(result.patch.exposure).toBeDefined();
  });

  it("does NOT call a refusal unreachable: only a retryable failure is", async () => {
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (tool === TOOLS.covenants) throw { code: "tool_error", message: "no access to covenants" };
      return ok({ ok: true });
    });
    const result = await runSyncSweep(SWEEP);
    expect(result.lines.find((l) => l.id === "covenants")!.state).toBe("failed");
    expect(result.unreachable).toBe(0);
    expect(reachReport(result)).toBe("Reachable, 8 lines refreshed.");
  });
});

describe("a lane that never answers does not take the sweep with it", () => {
  /* CHAOS SCENARIO sync-lane-hangs. Every lane here is awaited, and nothing
     below promises to come back: a relay that hangs rather than 502s used to
     hold a pacer slot, the console and the Sync button for the life of the
     page. The deadline is the wall clock that makes a hang a failure. */

  it("reports the hung lane as timed out and lets the rest of the sweep finish", async () => {
    vi.useFakeTimers();
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      // Neither door ever answers, and neither ever refuses.
      if (eitherDoor(tool, TOOLS.graph)) return new Promise(() => {});
      return ok({ ok: true });
    });

    const run = runSyncSweep({ ...SWEEP, deadlineMs: 15_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await run;
    vi.useRealTimers();

    const line = result.lines.find((l) => l.id === "graph")!;
    expect(line.state).toBe("failed");
    // The page's own clock, in whichever voice reached the line first: the
    // lane's fifteen seconds and one attempt's fifteen seconds are the same
    // fifteen seconds, and both say they stopped waiting rather than that the
    // tool failed.
    expect(line.detail).toMatch(/did not answer/);
    expect(line.detail).toContain("timeout after 15000ms");
    // Nothing patched for that lane; the section keeps what it had.
    expect(result.patch.graph).toBeUndefined();
    expect(result.fetchedAt?.graph).toBeUndefined();

    // AND EVERY OTHER LANE LANDED. This is the part that was broken: one hung
    // call held both pacer slots' worth of throughput and stopped the rest.
    for (const id of ["portfolio", "snapshot", "exposure", "covenants", "opportunities", "signals", "history", "mail"]) {
      expect(result.lines.find((l) => l.id === id)!.state, id).toBe("done");
    }
    expect(result.patch.exposure).toBeDefined();
  });

  it("counts a hung lane as unreachable, because nothing answered at all", async () => {
    vi.useFakeTimers();
    installMcp((_s, tool) => {
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      if (eitherDoor(tool, TOOLS.graph)) return new Promise(() => {});
      return ok({ ok: true });
    });
    const run = runSyncSweep({ ...SWEEP, deadlineMs: 15_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await run;
    vi.useRealTimers();

    expect(result.partial).toBe(true);
    expect(result.unreachable).toBe(1);
    expect(reachReport(result)).toBe("1 line still unreachable after retry.");
  });

  it("names the timeout so a reader can tell it from an answer the platform gave", () => {
    // The one flag every branch downstream reads. A deadline is the page's own
    // verdict, not the connector's, and must never be mistaken for one.
    expect(isLaneTimeout({ code: "cancelled", timedOut: true })).toBe(true);
    expect(isLaneTimeout({ code: "cancelled" })).toBe(false);
    expect(isLaneTimeout(undefined)).toBe(false);
  });

  it("clears its timer when the call answers in time, and leaves the answer untouched", async () => {
    vi.useFakeTimers();
    const reason = () => laneTimeout({ server: SERVERS.customer360, tool: "t", ms: 15_000, ambiguous: false });
    const out = await withDeadline(Promise.resolve("answered"), 15_000, reason);
    expect(out).toBe("answered");
    // Nothing is left standing: a sweep that leaves nine timers is its own leak.
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
