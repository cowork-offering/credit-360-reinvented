import { describe, expect, it } from "vitest";
import { normaliseBoom } from "../../../client-360/render/boom-normalise.mjs";
import { isProvisionalPeriod, newPeriodOf, publishSpread } from "./publishSpread";
import { adaptBoomSpread } from "../memo/dossier";
import type { BoomFinancialStatement } from "./types";
import type { Boom } from "../data/contract";

/* =============================================================================
   ITEM 18: THE SPREAD LANDS IN THE BOOK.

   `publishSpread` is the whole of what the Spreading room adds to the cockpit's
   own object, so what it may and may not do is what these tests hold:

     IT APPENDS THE PERIOD, ONCE. Twice is a duplicated column in the Financials
     tab and a second point on the trend for one filing.
     IT INVENTS NO RATIO. Boom's account-code chart carries no depreciation and
     amortisation line, so EBITDA, leverage and interest coverage cannot be
     recomputed from statements alone. They travel through unchanged, `asOf`
     included, and the new period stays silent on them rather than printing a
     figure nothing supports.
     IT SAYS WHERE THE PERIOD CAME FROM. A period the stub produced is marked
     provisional; a period Boom produced is not.
     IT NEVER CLEARS. Nothing to publish leaves the book exactly as it was.

   The figures are Piedmont's own, from client-360/assets/boom-spread.json: the
   FY2023 and FY2024 columns are the book, and the FY2025 column is what the
   banker drops.
   ============================================================================= */

const period = (id: string, endDate: string) => ({ id, endDate, periodType: "annual" as const });

const line = (id: string, name: string, accountCode: string | null, values: Record<string, number>) => ({
  id,
  name,
  hierarchy: "line_item" as const,
  accountCode,
  flipSign: false,
  periodValues: values,
});

/** The book: Piedmont as Boom spread it through FY2024. */
function bookThroughFy2024(): Boom {
  const raw = {
    ratios: {
      asOf: "2024-12-31",
      raw: {
        revenue: 56_266_000,
        ebitda: 6_874_000,
        ebitdaMargin: 0.1222,
        totalDebt: 15_187_000,
        leverage: 2.21,
        interestCoverage: 4.95,
      },
    },
    spread: {
      file: {
        id: "file-on-book",
        fileName: "Piedmont_Precision_Components_Financials_FY2023-2024.xlsx",
        financialStatements: [
          {
            id: "book-is",
            statementType: "income_statement",
            endDate: "2024-12-31",
            validationStatus: "validated",
            periods: [period("book-p2023", "2023-12-31"), period("book-p2024", "2024-12-31")],
            lineItems: [
              line("book-is-1", "Net Sales", "net_sales_revenue", { "book-p2023": 59_915_000, "book-p2024": 56_266_000 }),
              line("book-is-2", "Gross Profit", "gross_profit", { "book-p2023": 14_544_000, "book-p2024": 15_437_000 }),
              line("book-is-3", "Income from Operations", "operating_profit", { "book-p2023": 3_555_000, "book-p2024": 4_685_000 }),
              line("book-is-4", "Interest Expense", "interest_expense", { "book-p2023": -1_019_000, "book-p2024": -947_000 }),
            ],
          },
        ],
      },
    },
  };
  return normaliseBoom(raw) as Boom;
}

/** What the adapter hands back for the dropped FY2025 statements. */
function fy2025(idPrefix = "drop"): BoomFinancialStatement[] {
  return [
    {
      id: `${idPrefix}-s1`,
      statementType: "income_statement",
      endDate: "2025-12-31",
      validationStatus: "not_validated",
      periods: [period(`${idPrefix}-s1-p1`, "2025-12-31")],
      lineItems: [
        line(`${idPrefix}-s1-l1`, "Net Sales", "net_sales_revenue", { [`${idPrefix}-s1-p1`]: 64_486_000 }),
        line(`${idPrefix}-s1-l2`, "Gross Profit", "gross_profit", { [`${idPrefix}-s1-p1`]: 14_064_000 }),
        line(`${idPrefix}-s1-l3`, "Income from Operations", "operating_profit", { [`${idPrefix}-s1-p1`]: 2_838_000 }),
        line(`${idPrefix}-s1-l4`, "Interest Expense", "interest_expense", { [`${idPrefix}-s1-p1`]: -1_076_000 }),
      ],
    },
    {
      id: `${idPrefix}-s2`,
      statementType: "balance_sheet",
      endDate: "2025-12-31",
      validationStatus: "not_validated",
      periods: [period(`${idPrefix}-s2-p1`, "2025-12-31")],
      lineItems: [
        line(`${idPrefix}-s2-l1`, "Total Assets", "total_assets", { [`${idPrefix}-s2-p1`]: 46_761_000 }),
        line(`${idPrefix}-s2-l2`, "Long-Term Debt", "long_term_debt_bank", { [`${idPrefix}-s2-p1`]: 14_456_000 }),
      ],
    },
  ];
}

const keys = (boom: Boom | null) => (boom?.spread?.periods ?? []).map((p) => p.period);

describe("the new period lands on the book", () => {
  it("appends it once, after the periods already there", () => {
    const before = bookThroughFy2024();
    expect(keys(before)).toEqual(["FY2023", "FY2024"]);
    const after = publishSpread({ onFile: before, statements: fy2025(), provenance: "stub-provisional" });
    expect(keys(after)).toEqual(["FY2023", "FY2024", "FY2025"]);
  });

  it("is idempotent: the same spread published twice adds one period, not two", () => {
    const before = bookThroughFy2024();
    const once = publishSpread({ onFile: before, statements: fy2025(), provenance: "stub-provisional" });
    const twice = publishSpread({ onFile: once, statements: fy2025(), provenance: "stub-provisional" });
    expect(keys(twice)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(twice?.spread?.periods).toEqual(once?.spread?.periods);
  });

  it("moves the income statement's LTM column to the new period and the prior to the old one", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const revenue = (after?.spread?.lineItems ?? []).find((r) => r.line === "Revenue");
    expect(revenue?.ltm).toBe(64_486_000);
    expect(revenue?.priorFy).toBe(56_266_000);
  });

  it("names the period it added", () => {
    const before = bookThroughFy2024();
    const after = publishSpread({ onFile: before, statements: fy2025(), provenance: "stub-provisional" });
    expect(newPeriodOf(before, after)).toBe("FY2025");
    expect(newPeriodOf(after, after)).toBeNull();
  });

  it("builds the book from the spread alone where the relationship had none", () => {
    const after = publishSpread({ onFile: null, statements: fy2025(), provenance: "stub-provisional" });
    expect(keys(after)).toEqual(["FY2025"]);
    expect(after?.ratios).toBeUndefined();
  });
});

describe("the consumers of bundle.boom all see it", () => {
  /* THE MEMO'S BOOM GRAPH picks the RICHEST statement of each type rather than
     the union of them (`memo/dossier.ts`, `adaptBoomSpread`), which is exactly
     why the new period is merged INTO the statement on file instead of being
     appended as a sibling. A sibling carrying one period would lose the pick
     and the memo would keep drawing the old graph. */
  it("puts the new period on the statement the memo's Boom graph reads", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const { spread } = adaptBoomSpread(after?.spread?.file);
    expect(spread.periods).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(spread.incomeStatement.sales_revenue.FY2025).toBe(64_486_000);
    expect(spread.incomeStatement.sales_revenue.FY2024).toBe(56_266_000);
    expect(spread.balanceSheet.total_assets.FY2025).toBe(46_761_000);
  });

  it("keeps one statement per type, the shape Boom's own read returns", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const file = after?.spread?.file as { financialStatements: Array<{ statementType: string }> };
    expect(file.financialStatements.map((s) => s.statementType)).toEqual(["income_statement", "balance_sheet"]);
  });

  it("never leaves a merged statement claiming a validation it no longer has", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const file = after?.spread?.file as { financialStatements: Array<{ validationStatus: string }> };
    expect(file.financialStatements.every((s) => s.validationStatus === "not_validated")).toBe(true);
  });
});

describe("no ratio is invented", () => {
  it("leaves the on-file ratios and their asOf exactly where they were", () => {
    const before = bookThroughFy2024();
    const after = publishSpread({ onFile: before, statements: fy2025(), provenance: "stub-provisional" });
    expect(after?.ratios).toEqual(before.ratios);
    expect(after?.ratios?.asOf).toBe("2024-12-31");
  });

  it("prints no EBITDA and no margin on the new period, because nothing supports one", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const added = (after?.spread?.periods ?? []).find((p) => p.period === "FY2025");
    expect(added?.revenue).toBe(64_486_000);
    expect(added?.ebitda).toBeUndefined();
    expect(added?.margin).toBeUndefined();
  });

  it("keeps EBITDA on the one period the ratios are computed for", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const withEbitda = (after?.spread?.periods ?? []).filter((p) => p.ebitda != null);
    expect(withEbitda.map((p) => p.period)).toEqual(["FY2024"]);
  });
});

describe("the period says where it came from", () => {
  it("marks a stub period provisional, and only that period", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "stub-provisional" });
    const periods = after?.spread?.periods ?? [];
    expect(periods.filter((p) => isProvisionalPeriod(p)).map((p) => p.period)).toEqual(["FY2025"]);
  });

  it("marks nothing when the spread came from Boom itself", () => {
    const after = publishSpread({ onFile: bookThroughFy2024(), statements: fy2025(), provenance: "boom" });
    expect((after?.spread?.periods ?? []).some((p) => isProvisionalPeriod(p))).toBe(false);
  });
});

describe("it never clears the book", () => {
  it("returns what was on file when the spread carried no statement", () => {
    const before = bookThroughFy2024();
    expect(publishSpread({ onFile: before, statements: [], provenance: "stub-provisional" })).toBe(before);
  });

  it("returns null only where there was nothing on file and nothing to add", () => {
    expect(publishSpread({ onFile: null, statements: [], provenance: "boom" })).toBeNull();
  });
});
