import { describe, expect, it } from "vitest";
import type { C360Data, Id } from "./contract";
import { bucketOf, deriveQueue, QUEUE_CAP, queueSentence } from "./queue";

/* The queue's own clock. Every date below is stated relative to it, so a test
   reads as "a test due in three days" rather than as a calendar. */
const GEN = "2026-09-08T00:00:00Z";
const day = (n: number) => new Date(Date.parse(GEN) + n * 86_400_000).toISOString().slice(0, 10);

function bundle(id: Id, patch: Record<string, unknown> = {}) {
  return { snapshot: { accountId: id, name: id }, ...patch };
}

function book(
  accounts: Array<{ id: Id; tce?: number; sample?: boolean }>,
  patch: Partial<C360Data> = {},
): C360Data {
  const borrowers: Record<Id, unknown> = {};
  for (const a of accounts) borrowers[a.id] = bundle(a.id);
  return {
    meta: { anchorAccountId: accounts[0]?.id ?? "A", generatedAt: GEN },
    portfolio: {
      accounts: accounts.map((a) => ({
        accountId: a.id,
        name: a.id,
        tce: a.tce ?? 1,
        ...(a.sample ? { _sample_only: true } : {}),
      })),
    },
    borrower: bundle(accounts[0]?.id ?? "A"),
    borrowers,
    ...patch,
  } as unknown as C360Data;
}

describe("deriveQueue — membership", () => {
  it("puts only the relationships carrying a signal on the queue, and the rest below", () => {
    const data = book([{ id: "A", tce: 9 }, { id: "B", tce: 5 }, { id: "C", tce: 7 }], {
      portfolio: {
        accounts: [
          { accountId: "A", name: "A", tce: 9 },
          { accountId: "B", name: "B", tce: 5 },
          { accountId: "C", name: "C", tce: 7 },
        ],
        signals: { covenantsDueSoon: [{ accountId: "B", nextEvaluationDate: day(3) }] },
      },
    } as unknown as Partial<C360Data>);

    const q = deriveQueue(data, true);
    expect(q.worklist.accountIds).toEqual(["B"]);
    // Exposure first, and the queue row is not repeated underneath itself.
    expect(q.quiet).toEqual(["A", "C"]);
    expect(q.summary).toMatchObject({ needsAction: 1, quiet: 2, bookSize: 3, live: true });
  });

  it("keeps the SAMPLE relationships while the page is standing on the snapshot", () => {
    const data = book([{ id: "A" }, { id: "S", sample: true }], {
      worklist: { accountIds: ["A", "S"], reasons: { A: ["COVENANT_DUE"], S: ["COVENANT_BREACH"] } },
    });
    expect([...deriveQueue(data, false).worklist.accountIds].sort()).toEqual(["A", "S"]);
  });

  it("caps the queue and pushes the overflow into the rest of the book", () => {
    const many = Array.from({ length: QUEUE_CAP + 4 }, (_, i) => ({ id: `A${i}`, tce: 100 - i }));
    const data = book(many, {
      portfolio: {
        accounts: many.map((a) => ({ accountId: a.id, name: a.id, tce: a.tce })),
        signals: { covenantsDueSoon: many.map((a) => ({ accountId: a.id, nextEvaluationDate: day(2) })) },
      },
    } as unknown as Partial<C360Data>);

    const q = deriveQueue(data, true);
    expect(q.worklist.accountIds).toHaveLength(QUEUE_CAP);
    expect(q.quiet).toHaveLength(4);
    expect(q.summary.quiet).toBe(4);
  });
});

describe("deriveQueue — severity", () => {
  it("orders breach above an overdue test, and an overdue test above one merely due", () => {
    const data = book([{ id: "DUE" }, { id: "LATE" }, { id: "BREACH" }], {
      portfolio: {
        accounts: [
          { accountId: "DUE", name: "DUE", tce: 3 },
          { accountId: "LATE", name: "LATE", tce: 2 },
          { accountId: "BREACH", name: "BREACH", tce: 1 },
        ],
        signals: {
          covenantsDueSoon: [
            { accountId: "DUE", nextEvaluationDate: day(10), overdue: false },
            { accountId: "LATE", nextEvaluationDate: day(-4), overdue: true },
          ],
        },
      },
      borrowers: {
        DUE: bundle("DUE"),
        LATE: bundle("LATE"),
        BREACH: bundle("BREACH", { covenants: { covenants: [{ breached: true }] } }),
      },
    } as unknown as Partial<C360Data>);

    expect(deriveQueue(data, true).worklist.accountIds).toEqual(["BREACH", "LATE", "DUE"]);
  });

  it("breaks a tie on committed exposure, largest first", () => {
    const data = book([{ id: "SMALL" }, { id: "BIG" }], {
      portfolio: {
        accounts: [
          { accountId: "SMALL", name: "SMALL", tce: 2 },
          { accountId: "BIG", name: "BIG", tce: 40 },
        ],
        signals: {
          maturitiesSoon: [
            { accountId: "SMALL", maturityDate: day(20) },
            { accountId: "BIG", maturityDate: day(60) },
          ],
        },
      },
    } as unknown as Partial<C360Data>);
    expect(deriveQueue(data, true).worklist.accountIds).toEqual(["BIG", "SMALL"]);
  });

  it("leaves a SERVER list in the order the server ranking gave it", () => {
    const data = book([{ id: "A", tce: 9 }, { id: "B", tce: 1 }], {
      portfolio: {
        accounts: [
          { accountId: "A", name: "A", tce: 9 },
          { accountId: "B", name: "B", tce: 1 },
        ],
        signals: { covenantsDueSoon: [{ accountId: "B", nextEvaluationDate: day(-9), overdue: true }] },
      },
      worklist: { accountIds: ["A", "B"], reasons: { A: ["COVENANT_DUE"], B: ["COVENANT_DUE"] } },
    } as unknown as Partial<C360Data>);
    // B's test is overdue, so the LIVE ranking would lift it; the baked paint
    // must not move.
    expect(deriveQueue(data, false).worklist.accountIds).toEqual(["A", "B"]);
  });
});

describe("bucketOf", () => {
  it("tells an overdue test apart from one merely due without a ninth reason code", () => {
    expect(bucketOf(["COVENANT_DUE"], true)).toBe("COVENANT_OVERDUE");
    expect(bucketOf(["COVENANT_DUE"], false)).toBe("COVENANT_DUE");
    expect(bucketOf(["COVENANT_BREACH", "COVENANT_DUE"], true)).toBe("COVENANT_BREACH");
    expect(bucketOf([], false)).toBeNull();
  });
});

describe("queueSentence", () => {
  const s = (patch: Record<string, unknown>) =>
    queueSentence({ needsAction: 0, quiet: 0, bookSize: 0, live: true, byBucket: {}, ...patch } as never);

  it("states the rule with the page's own numbers", () => {
    expect(
      s({
        needsAction: 7,
        quiet: 5,
        bookSize: 12,
        byBucket: { COVENANT_BREACH: 2, COVENANT_OVERDUE: 3, MATURITY_NEAR: 2 },
      }),
    ).toBe("7 relationships need action: 2 breaches, 3 tests overdue, 2 maturities inside 90 days. 5 more are quiet.");
  });

  it("reads singular where the count is one", () => {
    expect(s({ needsAction: 1, quiet: 1, bookSize: 2, byBucket: { COVENANT_BREACH: 1 } })).toBe(
      "1 relationship needs action: 1 breach. 1 more is quiet.",
    );
  });

  it("says nothing about a quiet remainder that does not exist", () => {
    expect(s({ needsAction: 2, quiet: 0, bookSize: 2, byBucket: { MATURITY_NEAR: 2 } })).toBe(
      "2 relationships need action: 2 maturities inside 90 days.",
    );
  });

  it("has an honest empty state on both sides", () => {
    expect(s({ needsAction: 0, quiet: 4, bookSize: 4 })).toBe("Nothing needs action. 4 more are quiet.");
    expect(s({})).toBe("No packaged relationship is on the book yet.");
  });

  it("counts every relationship once, so the buckets sum to the queue", () => {
    const data = {
      meta: { anchorAccountId: "A", generatedAt: GEN },
      portfolio: {
        accounts: [
          { accountId: "A", name: "A", tce: 2 },
          { accountId: "B", name: "B", tce: 1 },
        ],
        signals: {
          covenantsDueSoon: [{ accountId: "A", nextEvaluationDate: day(-1), overdue: true }],
          maturitiesSoon: [{ accountId: "B", maturityDate: day(30) }],
        },
      },
      borrower: bundle("A"),
      borrowers: { A: bundle("A"), B: bundle("B") },
    } as unknown as C360Data;
    const q = deriveQueue(data, true);
    const summed = Object.values(q.summary.byBucket).reduce((n, v) => n + (v ?? 0), 0);
    expect(summed).toBe(q.summary.needsAction);
  });
});
