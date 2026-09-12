import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Boom } from "../data/contract";
import { covenantDirection, onFileBoomFigures, provisionalRead, thresholdSide } from "./provisional";
import type { FilePreRead, PreReadLine } from "./types";

/* =============================================================================
   THE PROVISIONAL READ, AGAINST THE SPREAD THAT IS ACTUALLY ON FILE.

   `onFile` here is built from client-360/assets/boom-ratios.json, the Piedmont
   read the cockpit already carries (Boom file 8b941a16, FY2023 to FY2025). The
   dropped file is the year after it. What is under test is that every sentence
   the room prints traces to one of those two places and to nothing else.
   ============================================================================= */

const ratios = JSON.parse(readFileSync(new URL("../../../client-360/assets/boom-ratios.json", import.meta.url), "utf8")) as {
  asOf: string;
  raw: Record<string, number>;
};

/** The shape the cockpit holds in memory: `bundle.boom`, normalised once by
 *  client-360/render/boom-normalise.mjs. Margins are the percent on the display
 *  field and the fraction underneath it, exactly as the seam emits them. */
const ON_FILE: Boom = {
  ratios: {
    revenue: ratios.raw.revenue,
    ebitda: ratios.raw.ebitda,
    ebitdaMargin: ratios.raw.ebitdaMargin * 100,
    totalLeverage: ratios.raw.leverage,
    interestCoverage: ratios.raw.interestCoverage,
    asOf: ratios.asOf,
    raw: ratios.raw,
  },
  spread: { sourceFile: "Piedmont_Precision_Components_Financials_FY2023-2025.xlsx" },
};

const line = (label: string, accountCode: string | null, value: number | null): PreReadLine => ({
  label,
  accountCode,
  values: { FY2026: value },
  confidence: "high",
});

/** The year after the spread on file, as a pre-read would place it. */
const nextYear = (over: PreReadLine[] = []): FilePreRead => ({
  fileId: "f_1",
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
      lines: [
        line("Net Sales", "net_sales_revenue", 71_200_000),
        line("Gross Profit", "gross_profit", 16_200_000),
        line("Income from Operations", "operating_profit", 4_200_000),
        line("Interest Expense", "interest_expense", -1_200_000),
        line("Depreciation and Amortization", null, 2_500_000),
        ...over,
      ],
    },
  ],
  company: "Piedmont Precision Components, Inc.",
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1000,
  statementQuality: "cpa_audited",
  quality: [],
  confidence: "high",
});

const balanceSheet = (assets: number, liabilities: number, equity: number): FilePreRead => ({
  ...nextYear(),
  statements: [
    {
      statementType: "balance_sheet",
      periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
      lines: [
        line("Total Assets", "total_assets", assets),
        line("Total Liabilities", "total_liabilities", liabilities),
        line("Total Stockholders' Equity", "total_equity", equity),
        line("Line of Credit and Current Portion of LTD", "st_loans_payable_bank", 6_000_000),
        line("Long-Term Debt, Net of Current Portion", "long_term_debt_bank", 15_000_000),
      ],
    },
  ],
});

describe("onFileBoomFigures", () => {
  it("reads the on-file period and figures out of the shape the cockpit holds", () => {
    const { figures, period } = onFileBoomFigures(ON_FILE);
    expect(period).toBe("FY2025");
    expect(figures.revenue).toBe(64_486_000);
    expect(figures.ebitda).toBe(5_234_000);
    expect(figures.totalDebt).toBe(20_130_000);
    expect(figures.ebitdaMarginPct).toBeCloseTo(8.12, 2);
  });

  it("carries nothing where no Boom read is on file", () => {
    const { figures, period } = onFileBoomFigures(null);
    expect(period).toBeNull();
    expect(Object.values(figures).every((v) => v === null)).toBe(true);
  });
});

describe("provisionalRead", () => {
  it("binds to the newest period in the drop", () => {
    expect(provisionalRead([nextYear()], ON_FILE)?.period).toBe("FY2026");
  });

  it("derives only what the lines support", () => {
    const read = provisionalRead([nextYear(), balanceSheet(50_000_000, 29_000_000, 21_000_000)], ON_FILE);
    expect(read?.figures.revenue).toBe(71_200_000);
    expect(read?.figures.ebitda).toBe(6_700_000);
    expect(read?.figures.totalDebt).toBe(21_000_000);
    expect(read?.figures.leverage).toBeCloseTo(3.134, 3);
    expect(read?.figures.interestCoverage).toBeCloseTo(3.5, 3);
    expect(read?.provisional).toBe(true);
  });

  it("states every delta against the period on file", () => {
    const read = provisionalRead([nextYear(), balanceSheet(50_000_000, 29_000_000, 21_000_000)], ON_FILE);
    expect(read?.lines[0]).toBe("Revenue $71.20M against $64.49M FY2025 on file, up 10.4%.");
    expect(read?.lines).toContain("EBITDA $6.70M against $5.23M FY2025 on file, up 28.0%.");
    expect(read?.lines).toContain("EBITDA margin 9.4% on revenue of $71.20M.");
    expect(read?.lines).toContain("Provisional leverage 3.13x against 3.85x on file.");
    expect(read?.lines.some((l) => /interest coverage 3\.50x against 2\.64x on file/.test(l))).toBe(true);
  });

  it("says plainly that EBITDA is not stated where the file carries no D and A line", () => {
    const noDa: FilePreRead = {
      ...nextYear(),
      statements: [
        {
          statementType: "income_statement",
          periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
          lines: [line("Net Sales", "net_sales_revenue", 71_200_000), line("Income from Operations", "operating_profit", 4_200_000)],
        },
      ],
    };
    const read = provisionalRead([noDa], ON_FILE);
    expect(read?.figures.ebitda).toBeNull();
    expect(read?.lines.some((l) => /EBITDA is not stated/.test(l))).toBe(true);
    expect(read?.lines.some((l) => /\$4\.20M/.test(l))).toBe(true);
  });

  it("prints the provisional ratio against the test nCino carries", () => {
    const read = provisionalRead([nextYear(), balanceSheet(50_000_000, 29_000_000, 21_000_000)], ON_FILE, [
      { name: "Interest Coverage Ratio", operator: ">=", threshold: 1.25, current: 2.64 },
      { name: "Total Leverage Ratio", operator: "<=", threshold: 4, current: 3.85 },
      { name: "Fixed Charge Coverage Ratio", operator: ">=", threshold: 1.2, current: 1.4 },
    ]);
    expect(read?.lines).toContain("Provisional interest coverage ratio 3.50x against the 1.25x floor nCino carries, above it.");
    expect(read?.lines).toContain("Provisional total leverage ratio 3.13x against the 4.00x ceiling nCino carries, inside it.");
    // The room cannot recompute a fixed charge coverage from a statement, so it
    // says nothing about one rather than implying it moved.
    expect(read?.lines.some((l) => /fixed charge/i.test(l))).toBe(false);
  });

  it("checks that the balance sheet foots, and names the difference where it does not", () => {
    const ok = provisionalRead([balanceSheet(50_000_000, 29_000_000, 21_000_000)], ON_FILE);
    expect(ok?.lines.some((l) => /balance sheet foots/.test(l))).toBe(true);

    const off = provisionalRead([balanceSheet(50_000_000, 29_000_000, 18_000_000)], ON_FILE);
    expect(off?.lines.some((l) => /does not foot.*difference of \$3M/.test(l))).toBe(true);
  });

  it("stays silent on a foot check it only has half of", () => {
    const half: FilePreRead = {
      ...nextYear(),
      statements: [
        {
          statementType: "balance_sheet",
          periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
          lines: [line("Total Assets", "total_assets", 50_000_000)],
        },
      ],
    };
    expect(provisionalRead([half], ON_FILE)?.lines.some((l) => /foot/.test(l))).toBe(false);
  });

  it("reads the figures alone where no Boom spread is on file yet", () => {
    const read = provisionalRead([nextYear()], null);
    expect(read?.onFilePeriod).toBeNull();
    expect(read?.lines[0]).toBe("Revenue $71.20M on this file.");
  });

  it("returns nothing where the pre-read placed nothing", () => {
    expect(provisionalRead([], ON_FILE)).toBeNull();
    expect(provisionalRead([{ ...nextYear(), statements: [] }], ON_FILE)).toBeNull();
  });
});

describe("covenantDirection and thresholdSide", () => {
  it("reads the operator as a symbol or as a word, and refuses to guess", () => {
    expect(covenantDirection(">=")).toBe("floor");
    expect(covenantDirection("Minimum")).toBe("floor");
    expect(covenantDirection("<=")).toBe("ceiling");
    expect(covenantDirection("Maximum")).toBe("ceiling");
    expect(covenantDirection("as agreed")).toBe("unknown");
  });

  it("names the side in the words that kind of test uses", () => {
    expect(thresholdSide("floor", 1.18, 1.25)).toBe("below it");
    expect(thresholdSide("floor", 1.4, 1.25)).toBe("above it");
    expect(thresholdSide("ceiling", 3.1, 4)).toBe("inside it");
    expect(thresholdSide("ceiling", 4.2, 4)).toBe("through it");
    expect(thresholdSide("unknown", 1, 2)).toBeNull();
  });
});
