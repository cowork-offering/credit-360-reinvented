// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "../intent/fakeDb";
import { __setDbForTests } from "./dbDoor";
import { __resetLaneHealthForTests } from "./laneHealth";
import { loadLastGood } from "./lastGood";
import { __resetBundleForTests, __resetWarmForTests, bundleAvailable, warmTopAccounts } from "./openBundle";
import { __resetOpenBurstForTests } from "./openBurst";
import { __resetPrefetchForTests, prefetchOpen } from "./openPrefetch";
import { startOpenRefresh } from "./openRefresh";
import { RETRY_BUDGET_MS, TOOLS } from "./mcp";

/* =============================================================================
   THE SIX IN ONE CALL (0.9.36).

   The open asks Customer360Bundle once and lands all six slices through the
   path the six lanes use. Asserted here: one call instead of six on the happy
   path, the same figures and the same last-good documents, a failed slice
   falling back to its own read alone, and a refusal switching the bundle off
   for the session while a transient failure does not.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const KEYS = ["covenants", "exposure", "graph", "opportunities", "signals", "snapshot"];

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const envelope = (outputValues: unknown) => ({
  payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
});

/** What each standalone tool answers: a slice naming its own tool. */
const sliceOf = (tool: string) => ({ accountId: ACCOUNT, from: tool });

/** The bundle's answer: each slice as the JSON string of that tool's outputValues. */
function bundleAnswer(errorsBySlice: string[] = [], drop: string[] = []) {
  const fields: Record<string, string> = {
    snapshot: TOOLS.snapshot,
    relationshipGraph: TOOLS.graph,
    exposure: TOOLS.exposure,
    covenants: TOOLS.covenants,
    opportunities: TOOLS.opportunities,
    structuralSignals: TOOLS.structuralSignals,
  };
  const out: Record<string, unknown> = { accountId: ACCOUNT, errorsBySlice, note: "" };
  for (const [field, tool] of Object.entries(fields)) {
    if (!drop.includes(field)) out[field] = JSON.stringify(sliceOf(tool));
  }
  return envelope(out);
}

function installMcp(callTool: ReturnType<typeof vi.fn>) {
  w.claude = { mcp: { callTool, watchTool: vi.fn().mockReturnValue(() => {}), listTools: vi.fn(), invalidate: vi.fn() } };
}

const toolsCalled = (callTool: ReturnType<typeof vi.fn>) => callTool.mock.calls.map((c) => c[1] as string);

function open() {
  const slices: Array<{ key: string; data: unknown }> = [];
  const failures: Array<{ key: string; code?: string }> = [];
  const stop = startOpenRefresh({
    accountId: ACCOUNT,
    onCached: () => {},
    onSlice: (key, data) => slices.push({ key, data }),
    onFailure: (key, f) => failures.push({ key, code: f?.code }),
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  });
  return { slices, failures, stop };
}

const settle = (ms = 4 * RETRY_BUDGET_MS + 10_000) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  __resetLaneHealthForTests();
  __resetOpenBurstForTests();
  __resetPrefetchForTests();
  __resetBundleForTests();
  __resetWarmForTests();
  __setDbForTests(createFakeDb());
});

afterEach(() => {
  vi.useRealTimers();
  __setDbForTests(undefined);
  delete w.claude;
  __resetLaneHealthForTests();
  __resetOpenBurstForTests();
  __resetPrefetchForTests();
  __resetBundleForTests();
  vi.restoreAllMocks();
});

describe("the open asks once", () => {
  it("lands all six slices off ONE bundle call, with the figures each tool would have given", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === TOOLS.bundle) return bundleAnswer();
      throw new Error(`unexpected ${tool}`);
    });
    installMcp(callTool);

    const run = open();
    await settle();

    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle]);
    expect(run.slices.map((s) => s.key).sort()).toEqual(KEYS);
    expect(run.slices.find((s) => s.key === "exposure")!.data).toEqual(sliceOf(TOOLS.exposure));
    expect(run.slices.find((s) => s.key === "signals")!.data).toEqual(sliceOf(TOOLS.structuralSignals));
    expect(run.failures).toHaveLength(0);
    run.stop();
  });

  it("stores every slice as a last-good document, under the slice's own tool", async () => {
    installMcp(vi.fn(async () => bundleAnswer()));
    const run = open();
    await settle();
    const stored = await loadLastGood(ACCOUNT);
    expect(Object.keys(stored).sort()).toEqual(KEYS);
    expect(stored.covenants.tool).toBe(TOOLS.covenants);
    expect(stored.covenants.payload).toEqual(sliceOf(TOOLS.covenants));
    run.stop();
  });

  it("serves a head start the same way, and the refresh adopts it without asking again", async () => {
    const callTool = vi.fn(async () => bundleAnswer());
    installMcp(callTool);
    prefetchOpen(ACCOUNT);
    const run = open();
    await settle();
    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle]);
    expect(run.slices).toHaveLength(6);
    run.stop();
  });
});

describe("one slice's trouble", () => {
  it("falls back to that slice's own read and nothing else", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === TOOLS.bundle) return bundleAnswer(["covenants: Attempt to de-reference a null object"]);
      return envelope(sliceOf(tool));
    });
    installMcp(callTool);
    const run = open();
    await settle();
    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle, TOOLS.covenants]);
    expect(run.slices.map((s) => s.key).sort()).toEqual(KEYS);
    expect(bundleAvailable()).toBe(true);
    run.stop();
  });

  it("treats a missing slice the same way", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === TOOLS.bundle) return bundleAnswer([], ["exposure"]);
      return envelope(sliceOf(tool));
    });
    installMcp(callTool);
    const run = open();
    await settle();
    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle, TOOLS.exposure]);
    expect(run.slices).toHaveLength(6);
    run.stop();
  });
});

describe("a bundle the page cannot use", () => {
  it("is refused once, the six lanes run, and the session never asks for it again", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === TOOLS.bundle) throw { code: "not_in_manifest", message: "not declared" };
      return envelope(sliceOf(tool));
    });
    installMcp(callTool);

    const first = open();
    await settle();
    expect(first.slices.map((s) => s.key).sort()).toEqual(KEYS);
    expect(bundleAvailable()).toBe(false);
    first.stop();

    callTool.mockClear();
    const second = open();
    await settle();
    expect(toolsCalled(callTool)).not.toContain(TOOLS.bundle);
    expect(toolsCalled(callTool)).toHaveLength(6);
    second.stop();
  });

  it("is NOT switched off by a transient failure: the lanes cover this open, the next open asks again", async () => {
    let bundleCalls = 0;
    const callTool = vi.fn(async (_s: string, tool: string) => {
      if (tool === TOOLS.bundle) {
        bundleCalls += 1;
        throw { code: "server_unavailable", message: "request failed (502)" };
      }
      return envelope(sliceOf(tool));
    });
    installMcp(callTool);
    const run = open();
    await settle();
    expect(run.slices.map((s) => s.key).sort()).toEqual(KEYS);
    expect(bundleAvailable()).toBe(true);
    expect(bundleCalls).toBeGreaterThan(0);
    run.stop();
  });
});

describe("the top of the queue, read before it is clicked", () => {
  const ids = ["001A00000000001AAA", "001A00000000002AAA", "001A00000000003AAA", "001A00000000004AAA"];

  it("reads the first three through ONE bundle call each, and stores every slice", async () => {
    vi.useRealTimers();
    const callTool = vi.fn(async () => bundleAnswer());
    installMcp(callTool);
    const stored: string[] = [];
    await warmTopAccounts(ids, (accountId, key) => stored.push(`${accountId}:${key}`));
    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle, TOOLS.bundle, TOOLS.bundle]);
    expect(stored).toHaveLength(18);
    expect(stored.some((s) => s.startsWith(ids[3]))).toBe(false);
  });

  it("warms a relationship once per page session", async () => {
    vi.useRealTimers();
    const callTool = vi.fn(async () => bundleAnswer());
    installMcp(callTool);
    await warmTopAccounts(ids.slice(0, 1), () => {});
    await warmTopAccounts(ids.slice(0, 1), () => {});
    expect(toolsCalled(callTool)).toEqual([TOOLS.bundle]);
  });

  it("does nothing at all once the bundle has been refused", async () => {
    vi.useRealTimers();
    __resetBundleForTests(false);
    const callTool = vi.fn(async () => bundleAnswer());
    installMcp(callTool);
    await warmTopAccounts(ids, () => {});
    expect(callTool).not.toHaveBeenCalled();
  });
});
