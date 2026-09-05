// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { C360Data } from "../data/contract";
import { clearOverlays, dataVersionOf, loadOverlays, saveOverlay, type AccountOverlay } from "./syncOverlay";
import { runSyncSweep, SLOW_TIER_STALE_MS } from "../channel/syncSweep";
import { TOOLS } from "../channel/mcp";
import live from "../../../artifact/live-data.json";

/* =============================================================================
   TWO FOUNDER QUESTIONS, ONE ROUND.

   "Why does it not stay static if I refresh?" — the read overlay is persisted
   and re-applied, at its TRUE age.

   And the graph line kept failing — the heaviest, most id-dense read, on the
   least volatile data. It is now served from cache inside a window, which means
   the flakiest call mostly does not happen at all.
   ============================================================================= */

const DATA = live as unknown as C360Data;
const VERSION = dataVersionOf(DATA.meta);

afterEach(() => {
  clearOverlays();
  vi.restoreAllMocks();
});

const overlay = (over: Partial<AccountOverlay> = {}): AccountOverlay => ({
  patch: { exposure: { totalCommitted: 46_000_000 } },
  activity: [{ id: "mail-1", ts: "2026-07-27T09:00:00Z", kind: "REQUEST_RECEIVED", title: "Test for Hartwell" }],
  history: [],
  storedAt: Date.now() - 20 * 60 * 1000,
  ...over,
});

describe("the overlay survives a reload", () => {
  it("round-trips per account", () => {
    for (const [id] of Object.entries(DATA.borrowers ?? {})) {
      saveOverlay(VERSION, id, overlay());
    }
    const restored = loadOverlays(VERSION);
    expect(Object.keys(restored).sort()).toEqual(Object.keys(DATA.borrowers ?? {}).sort());
    for (const id of Object.keys(DATA.borrowers ?? {})) {
      expect(restored[id].activity[0].title).toBe("Test for Hartwell");
      expect(restored[id].patch.exposure?.totalCommitted).toBe(46_000_000);
    }
  });

  it("keeps the TRUE storedAt, so restored never reads as fresh", () => {
    const twentyMinutesAgo = Date.now() - 20 * 60 * 1000;
    saveOverlay(VERSION, "001X", overlay({ storedAt: twentyMinutesAgo }));
    expect(loadOverlays(VERSION)["001X"].storedAt).toBe(twentyMinutesAgo);
  });

  it("saving one account leaves the others alone", () => {
    saveOverlay(VERSION, "001A", overlay());
    saveOverlay(VERSION, "001B", overlay({ storedAt: 123 }));
    const restored = loadOverlays(VERSION);
    expect(Object.keys(restored).sort()).toEqual(["001A", "001B"]);
    expect(restored["001B"].storedAt).toBe(123);
  });

  it("a fresh sync REPLACES the stored overlay for that account", () => {
    saveOverlay(VERSION, "001X", overlay({ storedAt: 1 }));
    saveOverlay(VERSION, "001X", overlay({ storedAt: 2 }));
    expect(loadOverlays(VERSION)["001X"].storedAt).toBe(2);
  });
});

describe("a new publish invalidates cleanly", () => {
  it("does not restore an overlay built against different data", () => {
    saveOverlay(VERSION, "001X", overlay());
    expect(Object.keys(loadOverlays(VERSION))).toHaveLength(1);
    // A republish changes generatedAt, and last publish's overlay must not be
    // re-applied on top of a bundle that may have a different shape.
    expect(loadOverlays(dataVersionOf({ ...DATA.meta, generatedAt: "2027-01-01T00:00:00Z" }))).toEqual({});
  });

  it("derives the version from the staged data, not from the clock", () => {
    expect(dataVersionOf(DATA.meta)).toBe(dataVersionOf(DATA.meta));
    expect(dataVersionOf(undefined)).toBe("none@none");
  });

  /* The coverage-correctness release changed what `totalLendableValue` MEANS
     without changing its name. A v1 overlay merged over a v2 bundle would put
     the old double-counted figure back on the facility rows, and nothing on
     screen would look wrong. So a stale-schema overlay is discarded, not
     migrated — even when the data version still matches. */
  it("discards an overlay written under the previous schema version", () => {
    const stale = {
      v: 1,
      dataVersion: VERSION,
      savedAt: Date.now(),
      accounts: {
        "001bb00001I7FPNAA3": {
          patch: { exposure: { facilities: [{ loanId: "a4Zbb0000027MaYEAU", totalLendableValue: 13_600_000 }] } },
          activity: [],
        },
      },
    };
    localStorage.setItem("c360:sync-overlay", JSON.stringify(stale));
    expect(loadOverlays(VERSION)).toEqual({});
  });

  it("keeps what the CURRENT schema wrote", () => {
    saveOverlay(VERSION, "001bb00001I7FPNAA3", overlay());
    const raw = JSON.parse(localStorage.getItem("c360:sync-overlay") ?? "{}");
    expect(raw.v).toBe(2);
    expect(Object.keys(loadOverlays(VERSION))).toEqual(["001bb00001I7FPNAA3"]);
  });

  it("carries the new coverage members through a round trip", () => {
    // Additive members must survive persistence: the sweep patches the whole
    // exposure slice verbatim, and a restored overlay that quietly dropped
    // coverageNote would put the blank state back.
    saveOverlay(
      VERSION,
      "001bb00001DLtRMAA1",
      overlay({
        patch: {
          exposure: {
            coverageRatio: 1.65,
            coverageShortfall: false,
            totalUniqueCollateralLendableValue: 14_000_000,
            uniqueCollateralCount: 2,
            facilities: [
              {
                loanId: "a4Zbb000001vavpEAA",
                totalPledgedValue: 0,
                coverageRatio: null,
                coverageShortfall: true,
                coverageNote: "No coverage ratio: all 3 collateral pledges on this facility are flagged Excluded or Abundance-of-Caution, which puts them out of the coverage math.",
                collateral: [],
              },
            ],
          },
        },
      }),
    );
    const restored = loadOverlays(VERSION)["001bb00001DLtRMAA1"].patch.exposure!;
    expect(restored.coverageRatio).toBe(1.65);
    expect(restored.uniqueCollateralCount).toBe(2);
    expect(restored.facilities![0].coverageNote).toContain("Abundance-of-Caution");
    expect(restored.facilities![0].totalPledgedValue).toBe(0);
  });
});

describe("storage that refuses degrades silently", () => {
  it("saves nothing and throws nothing when setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveOverlay(VERSION, "001X", overlay())).not.toThrow();
  });

  it("restores nothing and throws nothing when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => loadOverlays(VERSION)).not.toThrow();
    expect(loadOverlays(VERSION)).toEqual({});
  });

  it("ignores a corrupt blob rather than crashing the page", () => {
    localStorage.setItem("c360:sync-overlay", "{not json");
    expect(loadOverlays(VERSION)).toEqual({});
  });

  it("skips an overlay too large to be worth remembering", () => {
    const huge = overlay({ patch: { exposure: { note: "x".repeat(300_000) } } as never });
    saveOverlay(VERSION, "001X", huge);
    expect(loadOverlays(VERSION)["001X"]).toBeUndefined();
  });

  it("evicts the oldest account when the quota throws mid-write", () => {
    saveOverlay(VERSION, "001OLD", overlay());
    let envelopeWrites = 0;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      // The availability probe must still succeed: a store that refuses the
      // probe is unavailable, which is a different path with its own test.
      if (k !== "c360:sync-overlay") return real.call(this, k, v);
      envelopeWrites += 1;
      // The two-account envelope does not fit; the retry after eviction does.
      if (envelopeWrites === 1) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    });
    saveOverlay(VERSION, "001NEW", overlay({ storedAt: 999 }));
    const restored = loadOverlays(VERSION);
    // The account just synced is the last thing given up.
    expect(restored["001NEW"]?.storedAt).toBe(999);
  });
});

describe("nothing from staging or execution is ever persisted", () => {
  it("the overlay type carries reads only", () => {
    saveOverlay(VERSION, "001X", overlay());
    const raw = localStorage.getItem("c360:sync-overlay") ?? "";
    for (const forbidden of ["decisionToken", "planHash", "stagingId", "idempotencyKey", "approverUserId"]) {
      expect(raw, `${forbidden} must never be persisted`).not.toContain(forbidden);
    }
  });
});

describe("slow-moving reads are served from cache inside the window", () => {
  const envelope = (outputValues: unknown) => ({
    payload: { content: [{ actionName: "t", errors: null, isSuccess: true, outputValues, sortOrder: 0, version: 1 }] },
  });

  const install = () => {
    const calls: string[] = [];
    const callTool = vi.fn(async (_s: string, tool: string) => {
      calls.push(tool);
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return envelope({ entries: [] });
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() },
    };
    return calls;
  };

  const sweep = (fetchedAt: Record<string, number>, now: number) =>
    runSyncSweep({
      accountId: "001X",
      accountName: "Testco",
      generatedAt: "2026-07-27T00:00:00Z",
      slowTierFetchedAt: fetchedAt,
      now: () => now,
      minPace: 0,
      sleep: () => Promise.resolve(),
    });

  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
  });

  it("does NOT call the graph or covenants inside the window", async () => {
    const calls = install();
    const now = 1_000_000;
    await sweep({ graph: now - 60_000, covenants: now - 60_000 }, now);
    expect(calls).not.toContain(TOOLS.graph);
    expect(calls).not.toContain(TOOLS.covenants);
    // Everything else still runs: only the slow tier is cached.
    expect(calls).toContain(TOOLS.snapshot);
    expect(calls).toContain(TOOLS.exposure);
    expect(calls).toContain(TOOLS.mailSearch);
  });

  it("says the line was unchanged rather than pretending it ran", async () => {
    install();
    const now = 1_000_000;
    const out = await sweep({ graph: now - 60_000 }, now);
    const line = out.lines.find((l) => l.id === "graph")!;
    expect(line.state).toBe("done");
    expect(line.detail).toBe("unchanged since the last sync");
  });

  it("DOES call once the window has passed", async () => {
    const calls = install();
    const now = 1_000_000;
    await sweep({ graph: now - SLOW_TIER_STALE_MS - 1, covenants: now - SLOW_TIER_STALE_MS - 1 }, now);
    expect(calls).toContain(TOOLS.graph);
    expect(calls).toContain(TOOLS.covenants);
  });

  it("calls on a first sync, with nothing remembered", async () => {
    const calls = install();
    await sweep({}, 1_000_000);
    expect(calls).toContain(TOOLS.graph);
  });

  it("reports when each slow read actually ran, so the window can be kept", async () => {
    install();
    const out = await sweep({}, 1_000_000);
    expect(out.fetchedAt?.graph).toBe(1_000_000);
    expect(out.fetchedAt?.covenants).toBe(1_000_000);
    // A fast-tier read is not tiered and does not claim a window.
    expect(out.fetchedAt?.exposure).toBeUndefined();
  });

  it("a FAILED slow read still falls back last-good and claims no window", async () => {
    const callTool = vi.fn(async (_s: string, tool: string) => {
      // Both doors: the graph read falls back to the backup lane's `gw_` twin,
      // and a read that "did not come back" is one neither door answered.
      if (tool === TOOLS.graph || tool === `gw_${TOOLS.graph}`) throw { code: "upstream_error", message: "boom" };
      if (tool === TOOLS.mailSearch) return { payload: { value: [] } };
      return envelope({ entries: [] });
    });
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn() },
    };
    const out = await sweep({}, 1_000_000);
    expect(out.lines.find((l) => l.id === "graph")!.state).toBe("failed");
    // Nothing patched, so the previous value stands.
    expect(out.patch.graph).toBeUndefined();
    // And no window is claimed for a read that did not succeed.
    expect(out.fetchedAt?.graph).toBeUndefined();
  });
});
