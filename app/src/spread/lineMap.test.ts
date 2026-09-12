import { describe, expect, it } from "vitest";
import {
  accountCodeFor,
  BOOM_ACCOUNT_CODES,
  cellFigure,
  deterministicLines,
  mapLineCodes,
  normaliseLabel,
  rowsOf,
} from "./lineMap";
import { detectPeriods, detectUnits } from "./periods";
import type { ExtractedDocument, PreReadLine } from "./types";

/* =============================================================================
   THE LINES ON THE PAGE, WITH NO MODEL IN THE PATH.

   Three things are under test. THE DICTIONARY: only codes Boom's own chart
   carries, anchored so a phrase that merely contains a synonym never matches.
   THE FIGURES: what a statement prints, including the parenthesis that means a
   negative and the dash that means nothing. And THE ASSEMBLY: a file's own
   column header decides which period a column is, its section headers decide
   which statement a row is on, and a row that is really a header maps nothing.
   ============================================================================= */

const doc = (over: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  fileId: "f_1",
  kind: "csv",
  text: "",
  tables: [],
  isScan: false,
  warnings: [],
  ...over,
});

/** The file the 2026-09-12 browser run dropped into the Spreading room. */
const PIEDMONT_CSV = [
  "Piedmont Precision Components, Inc.",
  "Income Statement (in thousands)",
  "Fiscal year ended December 31,2025,2024",
  "Net sales revenue,71200,64486",
  "Cost of sales,49840,45140",
  "Gross profit,21360,19346",
  "Operating expenses,15960,14100",
  "Operating profit,5400,5246",
  "Interest expense,1750,1989",
  "Net income,2700,2400",
  "",
  "Balance Sheet (in thousands)",
  "As of December 31,2025,2024",
  "Total assets,52000,50000",
  "Total liabilities,32000,31500",
  "Total equity,20000,18500",
];

/** The same rows as a grid, the way `extractDocument` hands a CSV over. */
const piedmontDoc = (): ExtractedDocument => {
  const rows = PIEDMONT_CSV.filter((l) => l !== "").map((l) => l.split(",").map((c) => c.trim()));
  return doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] });
};

describe("accountCodeFor", () => {
  it("places the labels a commercial statement actually prints", () => {
    expect(accountCodeFor("Net sales revenue")).toBe("net_sales_revenue");
    expect(accountCodeFor("Net Sales")).toBe("net_sales_revenue");
    expect(accountCodeFor("Total Revenue")).toBe("net_sales_revenue");
    expect(accountCodeFor("Cost of Goods Sold")).toBe("cost_of_sales");
    expect(accountCodeFor("COGS")).toBe("cost_of_sales");
    expect(accountCodeFor("Gross Margin")).toBe("gross_profit");
    expect(accountCodeFor("Selling, General and Administrative Expenses")).toBe("operating_expenses");
    expect(accountCodeFor("Income from Operations")).toBe("operating_profit");
    expect(accountCodeFor("EBIT")).toBe("operating_profit");
    expect(accountCodeFor("Interest Expense, net")).toBe("interest_expense");
    expect(accountCodeFor("Net Income (Loss)")).toBe("net_income");
    expect(accountCodeFor("Cash and Cash Equivalents")).toBe("cash_and_equivalents");
    expect(accountCodeFor("Accounts Receivable, Net")).toBe("accounts_receivable_trade");
    expect(accountCodeFor("Inventories")).toBe("total_inventory");
    expect(accountCodeFor("Total Assets")).toBe("total_assets");
    expect(accountCodeFor("Total Liabilities")).toBe("total_liabilities");
    expect(accountCodeFor("Line of Credit and Current Portion of LTD")).toBe("st_loans_payable_bank");
    expect(accountCodeFor("Long-Term Debt, Net of Current Portion")).toBe("long_term_debt_bank");
    expect(accountCodeFor("Long-Term Debt Net of Current Portion")).toBe("long_term_debt_bank");
    expect(accountCodeFor("Total Stockholders' Equity")).toBe("total_equity");
    expect(accountCodeFor("Total Stockholders Equity")).toBe("total_equity");
  });

  it("places nothing Boom's chart has no code for", () => {
    // Boom carries no code for these, and both ratio layers find depreciation
    // by name. A line still travels with its label; it just rolls up nowhere.
    expect(accountCodeFor("Depreciation and Amortization")).toBeNull();
    expect(accountCodeFor("Total Current Assets")).toBeNull();
    expect(accountCodeFor("Total Current Liabilities")).toBeNull();
  });

  it("refuses a phrase that merely contains a synonym", () => {
    expect(accountCodeFor("Gain on sale of equipment")).toBeNull();
    expect(accountCodeFor("Interest expense on subordinated notes")).toBeNull();
    expect(accountCodeFor("Net income attributable to noncontrolling interests")).toBeNull();
    expect(accountCodeFor("Total assets of discontinued operations")).toBeNull();
  });

  it("only ever names a code Boom's chart carries", () => {
    const labels = ["Net Sales", "Total Assets", "Term Loan", "Revolving Credit", "Something else entirely"];
    for (const label of labels) {
      const code = accountCodeFor(label);
      if (code) expect(BOOM_ACCOUNT_CODES as readonly string[]).toContain(code);
    }
  });

  it("reduces a label to the words that identify the row", () => {
    expect(normaliseLabel("  Net Income (Loss):  ")).toBe("net income");
    expect(normaliseLabel("Total Stockholders’ Equity")).toBe("total stockholders' equity");
    // A text layer prints the typographic dash and the typographic apostrophe,
    // and a row that reads as prose to a regex is a row nobody places.
    expect(normaliseLabel("Long–Term Debt")).toBe("long-term debt");
    expect(accountCodeFor("Long‐Term Debt")).toBe("long_term_debt_bank");
  });
});

describe("mapLineCodes", () => {
  const line = (label: string, accountCode: string | null): PreReadLine => ({
    label,
    accountCode,
    values: { FY2025: 1 },
    confidence: "high",
  });

  it("fills the codes a read left empty", () => {
    expect(mapLineCodes([line("Total Assets", null)])[0].accountCode).toBe("total_assets");
  });

  it("never overwrites a code the read already placed", () => {
    // The model read the statement; this dictionary did not.
    expect(mapLineCodes([line("Total Assets", "total_equity")])[0].accountCode).toBe("total_equity");
  });

  it("leaves an unrecognised label unplaced and unchanged", () => {
    const [out] = mapLineCodes([line("Deferred rent", null)]);
    expect(out.accountCode).toBeNull();
    expect(out.confidence).toBe("high");
  });
});

describe("cellFigure", () => {
  it("reads what a statement prints", () => {
    expect(cellFigure("71,200")).toBe(71_200);
    expect(cellFigure("$1,019.50")).toBe(1019.5);
    expect(cellFigure("(1,019)")).toBe(-1019);
    expect(cellFigure("-1019")).toBe(-1019);
  });

  it("reads a printed dash as a stated nothing", () => {
    expect(cellFigure("-")).toBeNull();
    expect(cellFigure("—")).toBeNull();
    expect(cellFigure("n/a")).toBeNull();
  });

  it("reads anything else as not a value at all", () => {
    expect(cellFigure("Net Sales")).toBeUndefined();
    expect(cellFigure("")).toBeUndefined();
    expect(cellFigure("12%")).toBeUndefined();
  });
});

describe("rowsOf", () => {
  it("takes the cells a grid already has", () => {
    expect(rowsOf(doc({ tables: [{ rows: [["Total Assets", "52000"]] }] }))).toEqual([["Total Assets", "52000"]]);
  });

  it("splits a text layer on tabs and on runs of spaces", () => {
    expect(rowsOf(doc({ text: "Total Assets\t52,000\t50,000" }))).toEqual([["Total Assets", "52,000", "50,000"]]);
    expect(rowsOf(doc({ text: "Total Assets   52,000   50,000" }))).toEqual([["Total Assets", "52,000", "50,000"]]);
  });

  it("peels the trailing figures off a single-spaced line", () => {
    expect(rowsOf(doc({ text: "Net Sales 71,200 64,486" }))).toEqual([["Net Sales", "71,200", "64,486"]]);
  });
});

describe("deterministicLines", () => {
  const read = (d: ExtractedDocument) => deterministicLines(d, detectPeriods(d.text), detectUnits(d.text));

  it("places both statements of the dropped file, in the file's own order", () => {
    const out = read(piedmontDoc());
    expect(out.map((s) => s.statementType)).toEqual(["income_statement", "balance_sheet"]);
  });

  it("keys the columns off the header the file prints, at the scale it states", () => {
    const [income] = read(piedmontDoc());
    const sales = income.lines.find((l) => l.accountCode === "net_sales_revenue")!;
    expect(sales.label).toBe("Net sales revenue");
    expect(sales.values).toEqual({ FY2025: 71_200_000, FY2024: 64_486_000 });
    expect(sales.confidence).toBe("medium");
  });

  it("files every income line on the income statement and every balance line on the balance sheet", () => {
    const [income, balance] = read(piedmontDoc());
    expect(income.lines.map((l) => l.accountCode)).toEqual([
      "net_sales_revenue",
      "cost_of_sales",
      "gross_profit",
      "operating_expenses",
      "operating_profit",
      "interest_expense",
      "net_income",
    ]);
    expect(balance.lines.map((l) => l.accountCode)).toEqual(["total_assets", "total_liabilities", "total_equity"]);
    expect(balance.lines.find((l) => l.accountCode === "total_assets")!.values.FY2025).toBe(52_000_000);
  });

  it("reads the period order off the header rather than assuming newest first", () => {
    const rows = [
      ["Income Statement"],
      ["Fiscal year ended December 31", "2024", "2025"],
      ["Net sales revenue", "64486", "71200"],
    ];
    const [income] = read(doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] }));
    expect(income.lines[0].values).toEqual({ FY2024: 64_486, FY2025: 71_200 });
  });

  it("falls back to the periods the text printed where the file heads no columns", () => {
    const text = [
      "PIEDMONT PRECISION COMPONENTS, INC.",
      "Statements of Income",
      "(in thousands)",
      "For the years ended December 31, 2026 and 2025",
      "Net Sales 71,200 64,486",
    ].join("\n");
    const [income] = read(doc({ kind: "pdf-text", text }));
    // Newest first, as the statement prints them, and the mis-split header line
    // maps no columns of its own.
    expect(income.lines[0].values).toEqual({ FY2026: 71_200_000, FY2025: 64_486_000 });
  });

  it("carries a printed negative and a printed dash without inventing either", () => {
    const rows = [
      ["Income Statement"],
      ["Fiscal year ended December 31", "2025", "2024"],
      ["Interest expense", "(1,076)", "-"],
    ];
    const [income] = read(doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] }));
    expect(income.lines[0].values).toEqual({ FY2025: -1076, FY2024: null });
  });

  it("keeps an unrecognised line on the statement, unplaced and at low confidence", () => {
    const rows = [
      ["Income Statement"],
      ["Fiscal year ended December 31", "2025"],
      ["Depreciation and Amortization", "1,842"],
    ];
    const [income] = read(doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] }));
    expect(income.lines[0]).toEqual({
      label: "Depreciation and Amortization",
      accountCode: null,
      values: { FY2025: 1842 },
      confidence: "low",
    });
  });

  it("places nothing from a row that is a header, a title or a company name", () => {
    const rows = [
      ["Piedmont Precision Components", "Inc."],
      ["Income Statement (in thousands)"],
      ["Fiscal year ended December 31", "2025", "2024"],
    ];
    expect(read(doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] }))).toEqual([]);
  });

  it("places nothing at all from a file that prints no figures", () => {
    expect(read(doc({ kind: "pdf-text", text: "We have audited the accompanying balance sheets." }))).toEqual([]);
  });

  it("files a line by its code family where the file heads no section", () => {
    const rows = [
      ["As of December 31", "2025"],
      ["Total assets", "52000"],
      ["Total liabilities", "32000"],
    ];
    const out = read(doc({ text: rows.map((r) => r.join("\t")).join("\n"), tables: [{ rows }] }));
    expect(out.map((s) => s.statementType)).toEqual(["balance_sheet"]);
    expect(out[0].lines).toHaveLength(2);
  });
});
