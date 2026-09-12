import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Boom } from "../data/contract";
import {
  figuresAreGrounded,
  figuresFromSpread,
  groundedProse,
  NOT_VERIFIED_LINE,
  numbersIn,
  postRead,
  postReadFacts,
  VERIFIED_LINE,
} from "./postRead";
import type { RelationshipSpreadContext } from "./preRead";
import type { BoomFinancialStatement, PeriodType, StatementType } from "./types";

/* =============================================================================
   THE POST-READ, AGAINST THE REAL SPREAD.

   `after` is client-360/assets/boom-spread.json verbatim, the Piedmont spread
   Boom actually returned (file 8b941a16, FY2023 to FY2025). The figures this
   module derives from it are checked against boom-ratios.json, which is Boom's
   OWN ratio layer over the same file: EBITDA 5,234,000, leverage 3.85x,
   interest coverage 2.64x. If this module and Boom ever disagree about the
   same statements, this is where it shows.
   ============================================================================= */

interface RawStatement {
  statementType: string;
  endDate: string;
  periods: Array<{ id: string; endDate: string }>;
  lineItems: Array<{ accountCode: string | null; name: string; hierarchy: string; periodValues: Record<string, number> }>;
}

const raw = JSON.parse(readFileSync(new URL("../../../client-360/assets/boom-spread.json", import.meta.url), "utf8")) as {
  file: { financialStatements: RawStatement[] };
};

const ratios = JSON.parse(readFileSync(new URL("../../../client-360/assets/boom-ratios.json", import.meta.url), "utf8")) as {
  asOf: string;
  raw: Record<string, number>;
};

/** The on-file spread as the adapter hands it back: Boom's own shape, with the
 *  ids and the validation flag the live payload carries. */
const AFTER: BoomFinancialStatement[] = raw.file.financialStatements.map((s, i) => ({
  id: `st_${i}`,
  statementType: s.statementType as StatementType,
  endDate: s.endDate,
  validationStatus: "not_validated",
  periods: s.periods.map((p) => ({ id: p.id, endDate: p.endDate, periodType: "annual" as PeriodType })),
  lineItems: s.lineItems.map((li, j) => ({
    id: `li_${i}_${j}`,
    name: li.name,
    hierarchy: li.hierarchy as BoomFinancialStatement["lineItems"][number]["hierarchy"],
    accountCode: li.accountCode,
    flipSign: false,
    periodValues: li.periodValues,
  })),
}));

/** The prior year, as the cockpit held it before this spread landed. */
const BEFORE: Boom = {
  ratios: {
    asOf: "2024-12-31",
    raw: {
      revenue: 56_266_000,
      ebitda: 6_874_000,
      totalDebt: 15_187_000,
      leverage: 15_187_000 / 6_874_000,
      interestCoverage: 4_685_000 / 947_000,
    },
  },
};

const COVENANTS: RelationshipSpreadContext["covenants"] = [
  { name: "Interest Coverage Ratio", operator: ">=", threshold: 1.25, current: 4.95, unit: "x" },
  { name: "Total Leverage Ratio", operator: "<=", threshold: 3.5, current: 2.21, unit: "x" },
  { name: "Fixed Charge Coverage Ratio", operator: ">=", threshold: 1.2, current: 1.4, unit: "x" },
];

const args = (over: Partial<Parameters<typeof postReadFacts>[0]> = {}) => ({
  company: "Piedmont Precision Components, Inc.",
  before: BEFORE,
  after: AFTER,
  covenants: COVENANTS,
  validationStatus: "not_validated" as const,
  ...over,
});

describe("figuresFromSpread", () => {
  it("agrees with Boom's own ratio layer over the same file", () => {
    const figures = figuresFromSpread(AFTER);
    expect(figures?.period).toBe("FY2025");
    expect(figures?.revenue).toBe(ratios.raw.revenue);
    expect(figures?.ebitda).toBe(ratios.raw.ebitda);
    expect(figures?.totalDebt).toBe(ratios.raw.totalDebt);
    expect(figures?.leverage).toBeCloseTo(ratios.raw.leverage, 6);
    expect(figures?.interestCoverage).toBeCloseTo(ratios.raw.interestCoverage, 6);
  });

  it("takes the newest period by end date and not by the period id", () => {
    expect(figuresFromSpread(AFTER)?.endDate).toBe("2025-12-31");
  });

  it("comes back with nothing where the spread carries no period", () => {
    expect(figuresFromSpread([])).toBeNull();
  });
});

describe("postReadFacts", () => {
  it("leads with the period Boom spread, for this relationship", () => {
    expect(postReadFacts(args())[0]).toBe("Boom has spread FY2025 for Piedmont Precision Components, Inc.");
  });

  it("states what changed against the period on file", () => {
    const facts = postReadFacts(args());
    expect(facts).toContain("Revenue $64.49M in FY2025 against $56.27M FY2024 on file, up 14.6%.");
    expect(facts).toContain("EBITDA $5.23M in FY2025 against $6.87M FY2024 on file, down 23.9%.");
    expect(facts.some((f) => /Leverage 3\.85x against 2\.21x on file/.test(f))).toBe(true);
  });

  it("moves the covenant tests it can recompute, and says which side of the threshold", () => {
    const facts = postReadFacts(args());
    expect(facts).toContain(
      "Interest Coverage Ratio tests at 2.64x on this spread against its 1.25x floor, above it. The last test nCino carries is 4.95x.",
    );
    expect(facts).toContain(
      "Total Leverage Ratio tests at 3.85x on this spread against its 3.50x ceiling, through it. The last test nCino carries is 2.21x.",
    );
  });

  it("names the tests it cannot recompute rather than implying they moved", () => {
    expect(postReadFacts(args()).some((f) => /Fixed Charge Coverage Ratio is not recomputable/.test(f))).toBe(true);
  });

  it("says the spread is not yet verified in Boom, every time, until it is", () => {
    expect(postReadFacts(args())).toContain(NOT_VERIFIED_LINE);
    expect(NOT_VERIFIED_LINE).toContain("not yet verified in Boom");
    expect(postReadFacts(args({ validationStatus: "validated" }))).toContain(VERIFIED_LINE);
  });

  it("states the figures on their own where nothing is on file yet", () => {
    const facts = postReadFacts(args({ before: null }));
    expect(facts).toContain("Revenue $64.49M in FY2025.");
  });

  it("says so plainly where Boom returned nothing readable", () => {
    const facts = postReadFacts(args({ after: [] }));
    expect(facts[0]).toMatch(/returned no spread/);
    expect(facts).toContain(NOT_VERIFIED_LINE);
  });
});

describe("the number guard", () => {
  it("reads every figure in a sentence, however it is written", () => {
    expect(numbersIn("Revenue $64.49M against 2.64x and 14.6% in FY2025")).toEqual(["64.49m", "2.64x", "14.6%", "2025"]);
  });

  it("passes a paragraph built only from the facts", () => {
    const facts = postReadFacts(args());
    expect(figuresAreGrounded("Revenue reached $64.49M in FY2025 and leverage moved to 3.85x.", facts)).toBe(true);
  });

  it("fails a paragraph that brought a figure of its own", () => {
    const facts = postReadFacts(args());
    expect(figuresAreGrounded("Revenue reached $64.49M and the borrower holds $12.00M of liquidity.", facts)).toBe(false);
  });
});

/* =============================================================================
   THE SENTENCE GUARD, AGAINST WHAT THE DOOR ACTUALLY WROTE.

   `STUB_SENTENCE` is verbatim from design/probes/lib/stub-sample.js, the
   stand-in door the probe harness installs, and it is what rendered under the
   deterministic read in a real browser run of the built page. It carries no
   figure, so the figure guard passed it, and it tells a credit committee the
   borrower sits inside policy, which nothing in the facts says. `BROWSER_FACTS`
   are the deterministic sentences from that same run.
   ============================================================================= */

const COMPANY = "Piedmont Precision Components, Inc.";

const BROWSER_FACTS = [
  `Boom has spread FY2025 for ${COMPANY}`,
  "Revenue $71.20M in FY2025 against $64.20M LTM on file, up 10.9%.",
  "Interest coverage 3.09x against 2.95x on file, operating profit over interest expense.",
  NOT_VERIFIED_LINE,
];

const STUB_SENTENCE =
  "The borrower's leverage stands inside policy and the coverage cushion is intact at the tested quarter.";

describe("the sentence guard", () => {
  it("drops the sentence the stub door wrote, which passed the figure guard carrying no figure", () => {
    expect(figuresAreGrounded(STUB_SENTENCE, BROWSER_FACTS)).toBe(true);
    expect(groundedProse(STUB_SENTENCE, BROWSER_FACTS, COMPANY)).toBe("");
  });

  it("keeps a faithful rephrase of a fact", () => {
    const rephrase = "Revenue rose 10.9% to $71.20M in FY2025 against the LTM figure on file.";
    expect(groundedProse(rephrase, BROWSER_FACTS, COMPANY)).toBe(rephrase);
  });

  it("drops a sentence whose figure is right and whose policy view is its own", () => {
    expect(groundedProse("Interest coverage of 3.09x sits inside policy.", BROWSER_FACTS, COMPANY)).toBe("");
  });

  it("keeps a rephrase that says breach where the facts put the test through its threshold", () => {
    const facts = postReadFacts(args());
    expect(facts.some((f) => /through it/.test(f))).toBe(true);
    const rephrase = "Total Leverage Ratio breaches its 3.50x ceiling at 3.85x on this spread.";
    expect(groundedProse(rephrase, facts, COMPANY)).toBe(rephrase);
  });

  it("drops a sentence about a subject the facts never raised", () => {
    expect(groundedProse("Working capital is seasonal and the revolver carries it.", BROWSER_FACTS, COMPANY)).toBe("");
  });

  it("keeps the grounded sentences of a paragraph and drops the rest", () => {
    const paragraph = `Revenue rose 10.9% to $71.20M in FY2025. ${STUB_SENTENCE}`;
    expect(groundedProse(paragraph, BROWSER_FACTS, COMPANY)).toBe("Revenue rose 10.9% to $71.20M in FY2025.");
  });
});

describe("postRead", () => {
  it("appends the committee paragraph when every figure in it traces to the facts", async () => {
    const ask = vi.fn().mockResolvedValue(
      "Boom has spread FY2025 for Piedmont Precision Components, Inc. Revenue reached $64.49M while EBITDA fell to $5.23M, and leverage moved to 3.85x.",
    );
    const out = await postRead(args(), { ask, available: () => true });
    expect(out[out.length - 1]).toMatch(/^Boom has spread FY2025 for Piedmont/);
    expect(out).toContain(NOT_VERIFIED_LINE);
    expect(String(ask.mock.calls[0][0])).toContain("FACTS:");
  });

  it("discards a paragraph that invented a figure and keeps the deterministic read", async () => {
    const facts = postReadFacts(args());
    const ask = vi.fn().mockResolvedValue("Revenue reached $80.00M and the committee will want the backlog.");
    expect(await postRead(args(), { ask, available: () => true })).toEqual(facts);
  });

  it("discards a paragraph of judgement the facts never made, figures or no figures", async () => {
    const facts = postReadFacts(args());
    const ask = vi.fn().mockResolvedValue(STUB_SENTENCE);
    expect(await postRead(args(), { ask, available: () => true })).toEqual(facts);
  });

  it("tells the door to rephrase the facts and pass no judgement", async () => {
    const ask = vi.fn().mockResolvedValue("");
    await postRead(args(), { ask, available: () => true });
    expect(String(ask.mock.calls[0][0])).toContain("Rephrase the facts and nothing else");
  });

  it("returns the deterministic read when the desk is not connected", async () => {
    const ask = vi.fn();
    expect(await postRead(args(), { ask, available: () => false })).toEqual(postReadFacts(args()));
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns the deterministic read when the door rejects", async () => {
    const ask = vi.fn().mockRejectedValue({ code: "not_granted", message: "declined" });
    expect(await postRead(args(), { ask, available: () => true })).toEqual(postReadFacts(args()));
  });
});
