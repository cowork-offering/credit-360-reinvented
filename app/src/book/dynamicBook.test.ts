// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow, BorrowerBundle, C360Data } from "../data/contract";
import { __setDbForTests } from "../channel/dbDoor";
import { createFakeDb } from "../intent/fakeDb";
import { MIN_QUERY, searchAccounts } from "./search";
import { aggregateBorrower, anchorPackageId, READ_COUNT } from "./aggregate";
import {
  __resetBookForTests,
  bookHas,
  dynamicBook,
  mergeDynamicBook,
  openAccountLive,
} from "./dynamicBook";
import sample from "../../../artifact/sample-data.json";

/* =============================================================================
   THE BOOK IS THE ORG'S BOOK.

   A STUBBED CONNECTOR OF THE OBSERVED SHAPE — the Salesforce invocable
   envelope, positional, one element per input — because a search and eight
   reads that only work against a laxer stub than the org do not work.

   WHAT THIS PROVES: the search reads the observed output; the eight reads run
   at the sweep's own pacing and build a bundle in the shape live-data.json
   stores; the package anchor is derived exactly as the fixture script derives
   it; the merge is IDENTITY when nothing has been read live; the store caches a
   read and serves the next open off it.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

const BRIGHT = "001bb00001BRIGHT01";

const ok = (outputValues: unknown) => ({ payload: { content: [{ isSuccess: true, outputValues }] } });

const FACILITIES = [
  { loanId: "a4Z01", name: "Line of Credit", productPackageId: "a5F01", committed: 15_000_000, stage: "Booked" },
  { loanId: "a4Z02", name: "Equipment Loan", productPackageId: "a5F01", committed: 8_000_000, stage: "Booked" },
];

function installConnector(over: Record<string, unknown> = {}) {
  const calls: Array<{ tool: string; input: unknown }> = [];
  const callTool = vi.fn(async (_server: string, tool: string, input: unknown) => {
    calls.push({ tool, input });
    if (tool === "Customer360SearchAccounts") {
      return ok({
        count: 3,
        results: [
          { accountId: BRIGHT, name: "Bright Horizon Health", industry: "Healthcare", naicsCode: "621111", annualRevenue: 82_000_000 },
          { accountId: "001bb00001BRIGHT02", name: "Bright Meadow Dairy", industry: "Food" },
          { accountId: "001bb00001BRIGHT03", name: "Brightline Logistics" },
          // A row with no id cannot be opened; a row with no name cannot be shown.
          { name: "Bright but nameless id" },
        ],
      });
    }
    if (tool === "Customer360Snapshot") {
      return ok({ accountId: BRIGHT, name: "Bright Horizon Health", industry: "Healthcare", totalCreditExposure: 23_000_000, primaryRiskRating: "5" });
    }
    if (tool === "Customer360Exposure") return ok({ accountId: BRIGHT, totalCommitted: 23_000_000, facilities: FACILITIES });
    if (tool === "Customer360Covenants") return ok({ accountId: BRIGHT, covenants: [{ covenantId: "cv1", covenantType: "DSCR" }] });
    if (tool === "Customer360Opportunities") return ok({ accountId: BRIGHT, opportunities: [] });
    if (tool === "Customer360StructuralSignals") return ok({ accountId: BRIGHT, modifications: [] });
    if (tool === "Customer360RelationshipGraph") return ok({ accountId: BRIGHT, connections: [{ counterpartyName: "Bright Horizon Holdings" }] });
    if (tool === "Customer360Portfolio") return ok({ accounts: [] });
    if (tool === "Customer360ActionHistory") return ok({ accountId: BRIGHT, entries: [] });
    return ok({});
  });
  w.claude = { mcp: { callTool, watchTool: vi.fn(), listTools: vi.fn(), invalidate: vi.fn(), ...over } };
  return { callTool, calls };
}

beforeEach(() => {
  __resetBookForTests();
  __setDbForTests(undefined);
});

afterEach(() => {
  delete w.claude;
  __resetBookForTests();
  __setDbForTests(undefined);
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------- the search */

describe("Customer360SearchAccounts", () => {
  it("reads the observed output and drops a row that cannot be shown", async () => {
    installConnector();
    const res = await searchAccounts("Bright");
    expect(res.count).toBe(3);
    expect(res.results.map((r) => r.name)).toEqual(["Bright Horizon Health", "Bright Meadow Dairy", "Brightline Logistics"]);
    expect(res.results[0].annualRevenue).toBe(82_000_000);
  });

  it("sends the observed input shape", async () => {
    const { calls } = installConnector();
    await searchAccounts("Bright", { industry: "Healthcare", maxResults: 10 });
    expect(calls[0].input).toEqual({ inputs: [{ name: "Bright", industry: "Healthcare", maxResults: 10 }] });
  });

  it("does not call the connector for a query too short to mean anything", async () => {
    const { callTool } = installConnector();
    const res = await searchAccounts("Br");
    expect(res.results).toHaveLength(0);
    expect(callTool).not.toHaveBeenCalled();
    expect(MIN_QUERY).toBe(3);
  });
});

/* ------------------------------------------------------------ the reads */

describe("the eight reads", () => {
  it("builds a bundle in the shape live-data.json stores, at the sweep's pacing", async () => {
    const { calls } = installConnector();
    const progress: number[] = [];
    let readyAt = -1;
    const agg = await aggregateBorrower({
      accountId: BRIGHT,
      onProgress: (p) => progress.push(p.done),
      onReady: () => (readyAt = progress.length),
      sleep: async () => {},
    });

    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(READ_COUNT).toBe(8);
    // The room opens on the fast reads; the graph lands after.
    expect(readyAt).toBe(7);

    expect(Object.keys(agg.bundle).sort()).toEqual(
      ["covenants", "exposure", "graph", "opportunities", "signals", "snapshot"].sort(),
    );
    expect(agg.bundle.snapshot.name).toBe("Bright Horizon Health");
    expect(agg.bundle.exposure?.facilities).toHaveLength(2);
    expect(agg.bundle.graph?.connections).toHaveLength(1);
    expect(agg.missing).toEqual([]);

    // Every account-scoped read carries the account, and the portfolio does not.
    const scoped = calls.filter((c) => c.tool.startsWith("Customer360") && c.tool !== "Customer360Portfolio");
    for (const c of scoped) expect(JSON.stringify(c.input)).toContain(BRIGHT);
    expect(calls.find((c) => c.tool === "Customer360Portfolio")!.input).toEqual({ inputs: [{}] });
  });

  it("derives the package anchor the way the fixture script derives it", () => {
    const one = { snapshot: { accountId: BRIGHT }, exposure: { facilities: FACILITIES } } as BorrowerBundle;
    expect(anchorPackageId(one)).toBe("a5F01");

    const two = {
      snapshot: { accountId: BRIGHT },
      exposure: { facilities: [{ productPackageId: "a5F01" }, { productPackageId: "a5F02" }] },
    } as BorrowerBundle;
    expect(anchorPackageId(two), "two packages is a real ambiguity, not an anchor").toBeUndefined();

    expect(anchorPackageId({ snapshot: { accountId: BRIGHT } } as BorrowerBundle)).toBeUndefined();
  });

  it("puts the derived anchor on the snapshot, where the rooms read it", async () => {
    installConnector();
    const agg = await aggregateBorrower({ accountId: BRIGHT, sleep: async () => {} });
    expect(agg.bundle.snapshot.productPackageId).toBe("a5F01");
  });

  it("names a read that did not come back rather than inventing its slice", async () => {
    installConnector({
      callTool: vi.fn(async (_s: string, tool: string) => {
        // Both doors: the read falls back to the backup lane's `gw_` twin, and
        // a slice is only absent when neither door answered for it.
        if (tool === "Customer360Covenants" || tool === "gw_Customer360Covenants") {
          throw { code: "upstream_error", message: "boom" };
        }
        if (tool === "Customer360Snapshot") return ok({ accountId: BRIGHT, name: "Bright Horizon Health" });
        if (tool === "Customer360Exposure") return ok({ accountId: BRIGHT, facilities: FACILITIES });
        return ok({});
      }),
    });
    const agg = await aggregateBorrower({ accountId: BRIGHT, sleep: async () => {} });
    expect(agg.missing).toContain("covenants");
    expect(agg.bundle.covenants, "an absent slice is absent, never guessed").toBeUndefined();
  });

  it("refuses a relationship the org has nothing readable for", async () => {
    installConnector({ callTool: vi.fn(async () => ok({})) });
    await expect(aggregateBorrower({ accountId: BRIGHT, sleep: async () => {} })).rejects.toMatchObject({
      code: "tool_error",
    });
  });
});

/* -------------------------------------------------------------- the merge */

describe("the merge into the cockpit's data", () => {
  const data = sample as unknown as C360Data;

  it("is IDENTITY when nothing has been read live", () => {
    expect(mergeDynamicBook(data, {})).toBe(data);
  });

  it("adds the relationship to the borrowers, the portfolio and the queue", () => {
    const bundle = { snapshot: { accountId: BRIGHT, name: "Bright Horizon Health" } } as BorrowerBundle;
    const row: AccountRow = { accountId: BRIGHT, name: "Bright Horizon Health" };
    const merged = mergeDynamicBook(data, {
      [BRIGHT]: { accountId: BRIGHT, name: "Bright Horizon Health", bundle, row, readAt: 1_756_800_000_000 },
    });
    expect(merged).not.toBe(data);
    expect(merged.borrowers![BRIGHT]).toBe(bundle);
    const added = merged.portfolio.accounts.find((a) => a.accountId === BRIGHT)!;
    expect(added.name).toBe("Bright Horizon Health");
    expect(added.liveReadAt, "the row carries when it was read").toBe(1_756_800_000_000);
    if (data.worklist?.accountIds?.length) expect(merged.worklist!.accountIds).toContain(BRIGHT);
    // And the baked book is untouched.
    expect(merged.borrowers!["001bb00001DLtRMAA1"]).toBe(data.borrowers!["001bb00001DLtRMAA1"]);
  });

  it("knows what the cockpit can already open", () => {
    expect(bookHas(data, "001bb00001DLtRMAA1")).toBe(true);
    expect(bookHas(data, BRIGHT)).toBe(false);
  });
});

/* -------------------------------------------------------------- the cache */

describe("opening a relationship by name", () => {
  it("registers it live and caches it in the store", async () => {
    installConnector();
    const db = createFakeDb();
    __setDbForTests(db);

    const ok1 = await openAccountLive({ accountId: BRIGHT, name: "Bright Horizon Health" });
    expect(ok1).toBe(true);
    const entry = dynamicBook()[BRIGHT];
    expect(entry.name).toBe("Bright Horizon Health");
    expect(entry.bundle.exposure?.facilities).toHaveLength(2);
    expect(typeof entry.readAt).toBe("number");

    const cached = db.docs.get(`books/${BRIGHT}`) as { storedAt: number; bundle: BorrowerBundle } | undefined;
    expect(cached, "the read is cached under books/<accountId>").toBeTruthy();
    expect(cached!.storedAt).toBe(entry.readAt);
    expect((cached!.bundle as BorrowerBundle).snapshot.name).toBe("Bright Horizon Health");
  });

  it("serves a re-open off the cache and refreshes behind itself", async () => {
    const { callTool } = installConnector();
    const db = createFakeDb();
    __setDbForTests(db);
    await openAccountLive({ accountId: BRIGHT, name: "Bright Horizon Health" });
    const firstRound = callTool.mock.calls.length;

    // A fresh page: the session book is empty, the store's cache is not.
    __resetBookForTests();
    const before = callTool.mock.calls.length;
    await openAccountLive({ accountId: BRIGHT, name: "Bright Horizon Health" });
    expect(dynamicBook()[BRIGHT], "the room opens on the cache immediately").toBeTruthy();
    expect(dynamicBook()[BRIGHT].fromCache).toBe(true);
    expect(callTool.mock.calls.length, "the cache open costs no read of its own").toBe(before);
    expect(firstRound).toBeGreaterThan(0);
  });

  it("with no store, every open is the eight reads and nothing is cached", async () => {
    installConnector();
    __setDbForTests(undefined);
    const ok1 = await openAccountLive({ accountId: BRIGHT, name: "Bright Horizon Health" });
    expect(ok1).toBe(true);
    expect(dynamicBook()[BRIGHT].fromCache).toBeUndefined();
  });

  it("says no rather than registering a relationship the org cannot read", async () => {
    installConnector({ callTool: vi.fn(async () => ok({})) });
    const ok1 = await openAccountLive({ accountId: BRIGHT, name: "Bright Horizon Health" });
    expect(ok1).toBe(false);
    expect(dynamicBook()[BRIGHT]).toBeUndefined();
  });
});
