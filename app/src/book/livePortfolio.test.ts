import { describe, expect, it } from "vitest";
import type { C360Data, Portfolio } from "../data/contract";
import { carriesExposure, confineToBook, mergeLivePortfolio, portfolioSignature } from "./livePortfolio";

const baked = (): C360Data =>
  ({
    meta: { anchorAccountId: "REAL", generatedAt: "2026-07-25T00:00:00Z" },
    portfolio: {
      accounts: [
        { accountId: "REAL", name: "Real", tce: 10 },
        { accountId: "SAMPLE", name: "Sample", tce: 5, _sample_only: true },
      ],
    },
    borrower: { snapshot: { accountId: "REAL", name: "Real" } },
    borrowers: {
      REAL: { snapshot: { accountId: "REAL", name: "Real" } },
      SAMPLE: { snapshot: { accountId: "SAMPLE", name: "Sample" } },
    },
    worklist: { accountIds: ["REAL", "SAMPLE"], reasons: { SAMPLE: ["COVENANT_BREACH"] } },
  }) as unknown as C360Data;

const live: Portfolio = {
  accounts: [
    { accountId: "REAL", name: "Real", tce: 12 },
    { accountId: "NEW", name: "Newly seeded", tce: 3 },
  ],
};

describe("mergeLivePortfolio", () => {
  it("is IDENTITY when no read has landed, so the first paint is the baked one", () => {
    const data = baked();
    expect(mergeLivePortfolio(data, undefined)).toBe(data);
    expect(mergeLivePortfolio(data, { accounts: [] })).toBe(data);
  });

  it("replaces the book, drops the baked membership and takes the samples with it", () => {
    const merged = mergeLivePortfolio(baked(), live);
    expect(merged.portfolio.accounts.map((a) => a.accountId)).toEqual(["REAL", "NEW"]);
    expect(merged.worklist).toBeUndefined();
    expect(Object.keys(merged.borrowers ?? {})).toEqual(["REAL"]);
  });

  it("leaves the anchor bundle alone", () => {
    const merged = mergeLivePortfolio(baked(), live);
    expect(merged.borrower.snapshot?.accountId).toBe("REAL");
  });
});

describe("portfolioSignature", () => {
  it("reads the same for two answers carrying the same book", () => {
    const a: Portfolio = { accounts: [{ accountId: "A", name: "A", tce: 1, outstanding: 0 }], signals: { breachedCount: 2 } };
    const b: Portfolio = { accounts: [{ accountId: "A", name: "A", tce: 1, outstanding: 0 }], signals: { breachedCount: 2 } };
    expect(portfolioSignature(a)).toBe(portfolioSignature(b));
  });

  it("moves when a figure, a rating or a signal moves", () => {
    const base: Portfolio = { accounts: [{ accountId: "A", name: "A", tce: 1 }], signals: { breachedCount: 0 } };
    expect(portfolioSignature({ ...base, accounts: [{ accountId: "A", name: "A", tce: 2 }] })).not.toBe(
      portfolioSignature(base),
    );
    expect(portfolioSignature({ ...base, signals: { breachedCount: 1 } })).not.toBe(portfolioSignature(base));
    expect(portfolioSignature(undefined)).toBe("");
  });
});

/* THE BOOK RULE, against the shape the org actually returned on 2026-09-08:
   ten relationships carrying exposure and a hundred-odd legacy demo rows with
   TCE 0, no stage, no rating, and covenants that fell due in 2025. */
const polluted: Portfolio = {
  accounts: [
    { accountId: "REAL", name: "Real", tce: 12_000_000, outstanding: 5_000_000, riskRating: "5", stage: "Booked" },
    { accountId: "APPROVED", name: "Approved, undrawn", tce: 4_000_000, outstanding: 0, stage: "Booked" },
    { accountId: "GRADED", name: "Graded, between facilities", tce: 0, outstanding: 0, riskRating: "4" },
    { accountId: "LEGACY1", name: "Quantum Partners", tce: 0, outstanding: 0 },
    { accountId: "LEGACY2", name: "Vertex Holdings", tce: 0 },
    { accountId: "LEGACY3", name: "Test Business account", tce: 0, outstanding: 0, stage: "", riskRating: "" },
  ],
  bookTotals: { totalCommitted: 308_000_000, totalOutstanding: 1_090_000_000, accountCount: 115, utilizationPct: 354 },
  signals: {
    breachedCount: 7,
    covenantsDueSoon: [
      { accountId: "LEGACY1", accountName: "Quantum Partners", nextEvaluationDate: "2025-06-12", daysUntilNextEvaluation: -452, overdue: true },
      { accountId: "REAL", accountName: "Real", nextEvaluationDate: "2026-08-19", daysUntilNextEvaluation: -20, overdue: true },
    ],
    maturitiesSoon: [
      { accountId: "LEGACY2", loanId: "L1", maturityDate: "2026-10-01", daysUntilMaturity: 68 },
      { accountId: "APPROVED", loanId: "L2", maturityDate: "2026-12-25", daysUntilMaturity: 153 },
    ],
  },
};

describe("the book rule", () => {
  it("keeps a relationship the org has ANY of TCE, outstanding, a stage or a rating on", () => {
    expect(carriesExposure({ accountId: "a", name: "A", tce: 1 })).toBe(true);
    expect(carriesExposure({ accountId: "a", name: "A", outstanding: 1 })).toBe(true);
    expect(carriesExposure({ accountId: "a", name: "A", stage: "Booked" })).toBe(true);
    expect(carriesExposure({ accountId: "a", name: "A", riskRating: "4" })).toBe(true);
  });

  it("drops a legacy row carrying none of the four, blank strings included", () => {
    expect(carriesExposure({ accountId: "a", name: "A" })).toBe(false);
    expect(carriesExposure({ accountId: "a", name: "A", tce: 0, outstanding: 0 })).toBe(false);
    expect(carriesExposure({ accountId: "a", name: "A", tce: 0, stage: "", riskRating: "  " })).toBe(false);
  });

  it("confines the read to the book, re-sums the totals and drops the legacy signals", () => {
    const p = confineToBook(polluted);
    expect(p.accounts.map((a) => a.accountId)).toEqual(["REAL", "APPROVED", "GRADED"]);
    // The org said 354% against $1.09B drawn. The book says otherwise.
    expect(p.bookTotals).toEqual({
      totalCommitted: 16_000_000,
      totalOutstanding: 5_000_000,
      accountCount: 3,
      utilizationPct: 31.3,
    });
    expect(p.signals?.covenantsDueSoon?.map((c) => c.accountId)).toEqual(["REAL"]);
    expect(p.signals?.maturitiesSoon?.map((m) => m.accountId)).toEqual(["APPROVED"]);
    // breachedCount names nobody, so it stays the org's own book-wide figure.
    expect(p.signals?.breachedCount).toBe(7);
  });

  it("confines the live read on the way into the page", () => {
    const merged = mergeLivePortfolio(baked(), polluted);
    expect(merged.portfolio.accounts.map((a) => a.accountId)).toEqual(["REAL", "APPROVED", "GRADED"]);
    expect(merged.portfolio.bookTotals?.accountCount).toBe(3);
  });

  it("treats a read with no book in it as nothing to merge, rather than blanking the page", () => {
    const data = baked();
    const empty: Portfolio = { accounts: [{ accountId: "LEGACY", name: "Quantum Partners", tce: 0 }] };
    expect(mergeLivePortfolio(data, empty)).toBe(data);
  });
});
