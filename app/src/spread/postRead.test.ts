import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Boom } from "../data/contract";
import {
  committeeQuestions,
  covenantMeasure,
  covenantNotDerivable,
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
import { covenantDirection, covenantUnit } from "../data/finance";
import live from "../../../artifact/live-data.json";

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

/* =============================================================================
   CONNECTING THE DOTS, ON THE REAL RELATIONSHIP (founder, 2026-09-13, after
   driving the shipped room: "it reads the information but is it explaining and
   connecting the dots? it should help you understand the data in full detail").

   `before` is Hartwell Precision Manufacturing LLC's own book out of
   artifact/live-data.json: FY2023, FY2024, FY2025 and LTM on the spread, the
   six covenants nCino carries, the ratios Boom last published. `after` is the
   statement the browser drive actually drops on it (piedmont-fy2025, an FY2025
   income statement and balance sheet with the FY2024 comparative), so every
   sentence below is a sentence the founder can see on the glass.
   ============================================================================= */

const HARTWELL = (live as unknown as { borrowers: Record<string, { boom: Boom; covenants: { covenants: Array<Record<string, unknown>> } }> })
  .borrowers["001bb00001I7FPNAA3"];

/** The covenants exactly as the room maps them (`spreadContextFor`). */
const HARTWELL_COVENANTS: RelationshipSpreadContext["covenants"] = HARTWELL.covenants.covenants.map((c) => ({
  name: (c.covenantType as string) ?? "Covenant",
  operator:
    covenantDirection(c.covenantType as string, c.actualValue as number, c.thresholdValue as number) === "cap" ? "<=" : ">=",
  threshold: (c.thresholdValue as number) ?? null,
  current: (c.actualValue as number) ?? null,
  unit: covenantUnit(c.covenantType as string, (c.actualValue as number) ?? (c.thresholdValue as number)),
}));

const P = (id: string, endDate: string) => ({ id, endDate, periodType: "annual" as PeriodType });

const li = (
  id: string,
  name: string,
  accountCode: string | null,
  values: Record<string, number>,
): BoomFinancialStatement["lineItems"][number] => ({
  id,
  name,
  hierarchy: "line_item",
  accountCode,
  flipSign: false,
  periodValues: values,
});

/** The drive's own file, spread: FY2025 with its FY2024 comparative. */
const DROPPED: BoomFinancialStatement[] = [
  {
    id: "is",
    statementType: "income_statement",
    endDate: "2025-12-31",
    validationStatus: "not_validated",
    periods: [P("is25", "2025-12-31"), P("is24", "2024-12-31")],
    lineItems: [
      li("r", "Net sales revenue", "net_sales_revenue", { is25: 71_200_000, is24: 64_486_000 }),
      li("gp", "Gross profit", "gross_profit", { is25: 21_360_000, is24: 19_346_000 }),
      li("op", "Operating profit", "operating_profit", { is25: 5_400_000, is24: 5_246_000 }),
      li("ie", "Interest expense", "interest_expense", { is25: 1_750_000, is24: 1_989_000 }),
      li("ni", "Net income", "net_income", { is25: 2_700_000, is24: 2_400_000 }),
    ],
  },
  {
    id: "bs",
    statementType: "balance_sheet",
    endDate: "2025-12-31",
    validationStatus: "not_validated",
    periods: [P("bs25", "2025-12-31"), P("bs24", "2024-12-31")],
    lineItems: [
      li("ta", "Total assets", "total_assets", { bs25: 52_000_000, bs24: 50_000_000 }),
      li("tl", "Total liabilities", "total_liabilities", { bs25: 32_000_000, bs24: 31_500_000 }),
      li("te", "Total equity", "total_equity", { bs25: 20_000_000, bs24: 18_500_000 }),
    ],
  },
];

const hartwell = (over: Partial<Parameters<typeof postReadFacts>[0]> = {}) => ({
  company: "Hartwell Precision Manufacturing LLC",
  before: HARTWELL.boom,
  after: DROPPED,
  covenants: HARTWELL_COVENANTS,
  validationStatus: "not_validated" as const,
  ...over,
});

describe("the three-period direction", () => {
  it("puts the top line across the book's own periods and says which way it ran", () => {
    expect(postReadFacts(hartwell())).toContain(
      "Revenue FY2023 $52.40M, FY2024 $58.90M, FY2025 $71.20M: up 12.4%, then up 20.9%.",
    );
  });

  it("drops the period this spread replaces rather than printing that year twice", () => {
    const line = postReadFacts(hartwell()).find((f) => f.startsWith("Revenue FY")) ?? "";
    expect(line.match(/FY2025/g)).toHaveLength(1);
    // And LTM is not a fiscal year, so it is not a point on a fiscal series.
    expect(line).not.toContain("LTM");
  });

  it("falls back to the one period on file where the book carries no series", () => {
    const facts = postReadFacts(hartwell({ before: { ratios: { asOf: "2024-12-31", raw: { revenue: 64_486_000 } } } }));
    expect(facts.some((f) => f.startsWith("Revenue $71.20M in FY2025 against $64.49M FY2024 on file"))).toBe(true);
    expect(facts.some((f) => f.startsWith("Revenue FY"))).toBe(false);
  });
});

describe("the margin, in words and with the numbers", () => {
  it("reads the operating margin against the spread's own prior column where EBITDA is not derivable", () => {
    expect(postReadFacts(hartwell())).toContain("Operating margin 7.6% in FY2025 against 8.1% in FY2024, down 0.6 points.");
  });

  it("reads the EBITDA margin where the file carried a depreciation line", () => {
    const withDa = DROPPED.map((s) =>
      s.id === "is"
        ? { ...s, lineItems: [...s.lineItems, li("da", "Depreciation and amortisation", null, { is25: 2_100_000, is24: 1_900_000 })] }
        : s,
    );
    const facts = postReadFacts(hartwell({ after: withDa }));
    expect(facts.some((f) => /^EBITDA margin 10\.5% in FY2025 against 11\.1% in FY2024/.test(f))).toBe(true);
  });
});

describe("the balance sheet", () => {
  it("states the three totals and what they imply about the borrower's own leverage", () => {
    expect(postReadFacts(hartwell())).toContain(
      "The balance sheet carries total assets $52M, total liabilities $32M and equity $20M, so liabilities are 1.60x equity.",
    );
  });

  it("says nothing at all where the spread carries no balance sheet", () => {
    const facts = postReadFacts(hartwell({ after: [DROPPED[0]] }));
    expect(facts.some((f) => /balance sheet carries/.test(f))).toBe(false);
  });
});

describe("every covenant on the book is spoken to", () => {
  const facts = () => postReadFacts(hartwell());

  it("names all six, once each", () => {
    const said = facts();
    for (const covenant of HARTWELL_COVENANTS) {
      expect(said.filter((f) => f.startsWith(`${covenant.name} `))).toHaveLength(1);
    }
    expect(HARTWELL_COVENANTS).toHaveLength(6);
  });

  it("recomputes debt to worth from the spread's own balance sheet", () => {
    expect(facts()).toContain(
      "Maximum Debt to Worth tests at 1.60x on this spread against its 3.00x ceiling, inside it. The last test nCino carries is 2.42x.",
    );
  });

  it("says why a debt service test cannot be recomputed, and that it stands as nCino tested it", () => {
    expect(facts()).toContain(
      "Debt Service Coverage of Borrower is not recomputable from this spread: it needs a debt service schedule no statement prints. It stands at 1.38x against its 1.25x floor, as nCino last tested it.",
    );
  });

  it("says a borrowing base test is measured on a borrowing base and not on a spread", () => {
    expect(facts().some((f) => /^Accounts Receivable is not recomputable from this spread: it is measured on a borrowing base/.test(f))).toBe(true);
  });

  it("says so where nCino carries no tested value at all", () => {
    expect(facts().some((f) => /^Term Covenants is not recomputable from this spread: .* nCino carries no tested value for it\.$/.test(f))).toBe(true);
  });

  it("leaves a current ratio and a tangible net worth alone, and says which input is missing", () => {
    expect(covenantNotDerivable("Minimum Current Ratio")).toBe("the spread carries no current asset and current liability split");
    expect(covenantNotDerivable("Minimum Tangible Net Worth")).toBe("the spread carries no intangible asset line");
    expect(covenantMeasure("Minimum Tangible Net Worth")).toBeNull();
    expect(covenantMeasure("Minimum Net Worth")).toEqual({ key: "totalEquity", unit: "currency" });
    expect(covenantMeasure("Minimum Liquidity")).toEqual({ key: "cash", unit: "currency" });
  });
});

describe("what the committee will ask", () => {
  it("asks about the margin, because it fell while revenue grew", () => {
    expect(postReadFacts(hartwell())).toContain(
      "The committee will ask why the margin fell from 8.1% to 7.6% while revenue grew from $64.49M to $71.20M.",
    );
  });

  it("asks nothing the figures did not raise", () => {
    const asked = postReadFacts(hartwell()).filter((f) => f.startsWith("The committee will ask"));
    // Coverage ROSE, leverage is not derivable, the sheet foots, and no
    // recomputable covenant is near its threshold. One rule fires, so one
    // question is asked.
    expect(asked).toHaveLength(1);
  });

  it("asks about coverage only where it moved toward a floor it can see", () => {
    const covenants: RelationshipSpreadContext["covenants"] = [
      { name: "Interest Coverage Ratio", operator: ">=", threshold: 2.5, current: 3.4 },
    ];
    const fell = committeeQuestions({
      now: figuresFromSpread(DROPPED)!,
      prior: null,
      before: { interestCoverage: 4.1 },
      covenants,
    });
    expect(fell).toContain("The committee will ask why interest coverage moved from 4.10x to 3.09x against its 2.50x floor.");
    const rose = committeeQuestions({
      now: figuresFromSpread(DROPPED)!,
      prior: null,
      before: { interestCoverage: 2.6 },
      covenants,
    });
    expect(rose.some((q) => /interest coverage/.test(q))).toBe(false);
  });

  it("asks about debt that outran EBITDA, and only when leverage actually rose", () => {
    const now = { ...figuresFromSpread(DROPPED)!, ebitda: 7_500_000, totalDebt: 30_000_000, leverage: 4 };
    expect(
      committeeQuestions({ now, prior: null, before: { leverage: 2.42 }, covenants: [] }),
    ).toContain("The committee will ask why total bank debt of $30M outran EBITDA of $7.50M, taking leverage from 2.42x to 4.00x.");
    expect(committeeQuestions({ now, prior: null, before: { leverage: 4.5 }, covenants: [] })).toEqual([]);
  });

  it("asks about a test that now sits inside a tenth of its threshold", () => {
    const asked = committeeQuestions({
      now: figuresFromSpread(DROPPED)!,
      prior: null,
      before: {},
      covenants: [{ name: "Maximum Debt to Worth", operator: "<=", threshold: 1.7, current: 2.42 }],
    });
    expect(asked).toContain(
      "The committee will ask about Maximum Debt to Worth, which tests at 1.60x on this spread against its 1.70x ceiling, inside a tenth of it.",
    );
  });

  it("asks why a spread does not foot", () => {
    const asked = committeeQuestions({
      now: { ...figuresFromSpread(DROPPED)!, totalEquity: 12_000_000 },
      prior: null,
      before: {},
      covenants: [],
    });
    expect(asked).toContain(
      "The committee will ask why the balance sheet does not foot: total assets $52M against liabilities and equity of $44M.",
    );
  });
});

describe("the post-read reads as one note", () => {
  it("passes its own sentence guard, so the desk's paragraph has real ground to stand on", () => {
    const facts = postReadFacts(hartwell());
    const rephrase =
      "Revenue grew from $58.90M in FY2024 to $71.20M in FY2025 while the operating margin fell to 7.6%, and Maximum Debt to Worth tests at 1.60x against its 3.00x ceiling.";
    expect(groundedProse(rephrase, facts, "Hartwell Precision Manufacturing LLC")).toBe(rephrase);
  });

  it("still drops the judgement the facts never passed, however rich they are", () => {
    const facts = postReadFacts(hartwell());
    expect(groundedProse("Leverage of 1.60x is comfortably inside policy.", facts, "Hartwell Precision Manufacturing LLC")).toBe("");
  });

  it("says nothing with an em dash and nothing with an exclamation", () => {
    for (const fact of postReadFacts(hartwell())) expect(fact).not.toMatch(/—|!/);
  });
});
