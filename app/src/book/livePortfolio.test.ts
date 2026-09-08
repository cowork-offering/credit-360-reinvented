import { describe, expect, it } from "vitest";
import type { C360Data, Portfolio } from "../data/contract";
import { mergeLivePortfolio, portfolioSignature } from "./livePortfolio";

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
