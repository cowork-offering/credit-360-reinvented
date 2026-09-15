import { describe, expect, it } from "vitest";
import {
  applyFlipSign,
  chipAbbr,
  chipFamily,
  codeCoverageLine,
  coverage,
  fmtCell,
  isNewPeriod,
  periodLabel,
  periodsSorted,
  pickValue,
  registerStatements,
  scaleValue,
  supportIndex,
  unitCaption,
  variance,
  variancePct,
  varianceText,
} from "./registerModel";
import type { BoomFinancialStatement } from "../../../spread/types";
import spreadLive from "../../../__fixtures__/boom-live/spread-piedmont.json";
import ratiosLive from "../../../__fixtures__/boom-live/ratios-piedmont.json";

/* =============================================================================
   THE REGISTER'S ARITHMETIC, ON THE LIVE SPREAD AND NOTHING ELSE.

   Every figure asserted here was read off Boom's own server on 2026-09-15
   (file cf677dcc, Piedmont Precision Components). A hand-typed fixture would
   have let the model agree with itself about a shape Boom does not send, which
   is exactly the class of bug the live capture exists to catch: the live
   payload arrives NEWEST PERIOD FIRST, the cash flow statement carries no
   account codes at all, and exactly one line carries `flipSign`.
   ============================================================================= */

const statements = (spreadLive as { spread: { financialStatements: BoomFinancialStatement[] } })
  .spread.financialStatements;
const support = (ratiosLive as { support: { lines: Parameters<typeof supportIndex>[0] } }).support.lines;

const shaped = registerStatements(statements, { adjusted: true, support });
const income = shaped.find((s) => s.type === "income_statement")!;
const balance = shaped.find((s) => s.type === "balance_sheet")!;
const cash = shaped.find((s) => s.type === "cash_flow_statement")!;
const row = (s: typeof income, name: string) => s.rows.find((r) => r.name === name)!;

describe("statements from the spread", () => {
  it("carries the three statements the file holds, in a banker's reading order", () => {
    expect(shaped.map((s) => s.label)).toEqual(["Income statement", "Balance sheet", "Cash flow"]);
  });

  it("reads the validation status off the statement", () => {
    expect(shaped.every((s) => s.validated)).toBe(true);
  });

  it("drops Boom's [Abstract] title row and keeps the real section headers", () => {
    /* "Statement of Cash Flows [Abstract]" is XBRL's abstract element: a header
       with no figure under it on any period, and the statement select already
       says which statement this is. A section header a banker navigates by
       stays. */
    expect(cash.rows.some((r) => r.name.endsWith("[Abstract]"))).toBe(false);
    expect(income.rows.some((r) => r.name.endsWith("[Abstract]"))).toBe(false);
    expect(balance.rows.some((r) => r.name.endsWith("[Abstract]"))).toBe(false);
    expect(cash.rows.filter((r) => r.hierarchy === "header").map((r) => r.name)).toEqual([
      "Cash Flows from Operating Activities",
      "Cash Flows from Investing Activities",
      "Cash Flows from Financing Activities",
    ]);
    expect(balance.rows.filter((r) => r.hierarchy === "header").map((r) => r.name)).toEqual([
      "Assets",
      "Liabilities and Stockholders' Equity",
    ]);
  });

  it("counts the lines carrying a Boom account code, headers excluded", () => {
    expect(codeCoverageLine(income.mapped, income.mappable)).toBe("10 of 10 lines carry a Boom account code");
    /* Boom mapped NOTHING on the cash flow statement, and the register says so
       rather than implying a mapping it does not have. */
    expect(codeCoverageLine(cash.mapped, cash.mappable)).toBe("0 of 11 lines carry a Boom account code");
  });
});

describe("periods", () => {
  it("sorts oldest left and newest right, against a payload that arrives newest first", () => {
    expect(statements[1].periods.map((p) => p.endDate)).toEqual(["2025-12-31", "2024-12-31", "2023-12-31"]);
    expect(income.periods.map((p) => p.label)).toEqual(["FY2023", "FY2024", "FY2025"]);
  });

  it("labels an annual period as a fiscal year and anything else by its end date", () => {
    expect(periodLabel("2025-12-31", "annual")).toBe("FY2025");
    expect(periodLabel("2025-06-30", "quarterly")).toBe("2025-06-30");
    expect(periodLabel(null)).toBe("");
  });

  it("marks the new column on either the fiscal label or the raw end date", () => {
    expect(isNewPeriod("2025-12-31", "FY2025")).toBe(true);
    expect(isNewPeriod("2025-12-31", "2025-12-31")).toBe(true);
    expect(isNewPeriod("2024-12-31", "FY2025")).toBe(false);
    expect(isNewPeriod(null, "FY2025")).toBe(false);
  });

  it("keeps the sort stable where a statement gives no end date", () => {
    const odd = { periods: [{ id: "b", endDate: null }, { id: "a", endDate: null }] } as BoomFinancialStatement;
    expect(periodsSorted(odd).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("value pick", () => {
  const is = statements.find((s) => s.statementType === "income_statement")!;
  const netSales = is.lineItems.find((l) => l.accountCode === "net_sales_revenue")!;
  const grossProfit = is.lineItems.find((l) => l.accountCode === "gross_profit")!;
  const latest = is.periods.find((p) => p.endDate === "2025-12-31")!.id;

  it("reads the analyst-allowed figure when adjusted", () => {
    expect(pickValue(netSales, latest, true)).toBe(64486000);
  });

  it("falls back to as-given where Boom allowed nothing", () => {
    expect(grossProfit.adjustedPeriodValues?.[latest]?.asAllowed).toBeNull();
    expect(pickValue(grossProfit, latest, true)).toBe(14064000);
  });

  it("reads periodValues and nothing else when as-given", () => {
    expect(pickValue(netSales, latest, false)).toBe(64486000);
    expect(pickValue(grossProfit, latest, false)).toBe(14064000);
  });

  it("returns null for a period the line does not carry", () => {
    expect(pickValue(netSales, "no-such-period", true)).toBeNull();
  });
});

describe("flipSign", () => {
  it("flips the one line Boom flagged, so the column agrees with Boom's own aggregate", () => {
    const tax = row(income, "Provision for Income Taxes");
    /* periodValues prints +427,000; aggregatedFinancials carries -427,000. */
    expect(tax.values[2]).toBe(-427000);
  });

  it("leaves an unflagged line alone and never manufactures a negative zero", () => {
    expect(applyFlipSign(64486000, false)).toBe(64486000);
    expect(applyFlipSign(0, true)).toBe(0);
    expect(applyFlipSign(null, true)).toBeNull();
  });
});

describe("variance and variance percent", () => {
  it("strikes the newest against the prior period", () => {
    const sales = row(income, "Net Sales");
    expect(variance(sales.values[2], sales.values[1])).toBe(4571000);
    expect(variancePct(sales.values[2], sales.values[1])).toBeCloseTo(7.63, 2);
    expect(varianceText(sales.values[2], sales.values[1], "k")).toEqual({ value: "4,571", pct: "+7.6%" });
  });

  it("reads a fall as a leading minus, never as a parenthesis", () => {
    const gp = row(income, "Gross Profit");
    expect(varianceText(gp.values[2], gp.values[1], "k")).toEqual({ value: "-480", pct: "-3.3%" });
  });

  it("says n/m rather than a figure where the prior period is zero or negative", () => {
    const interest = row(income, "Interest Expense");
    expect(interest.values[1]).toBe(-1019000);
    expect(variancePct(interest.values[2], interest.values[1])).toBeNull();
    expect(varianceText(interest.values[2], interest.values[1], "k").pct).toBe("n/m");
    expect(varianceText(100, 0, "k").pct).toBe("n/m");
  });

  it("prints nothing at all where either side is missing", () => {
    expect(varianceText(null, 100, "k")).toEqual({ value: "", pct: "" });
    expect(varianceText(100, null, "k")).toEqual({ value: "", pct: "" });
  });
});

describe("coverage", () => {
  it("marks a period where every rendered line carries a figure", () => {
    expect(coverage(income.rows, income.periods.length)).toEqual([true, true, true]);
    expect(coverage(balance.rows, balance.periods.length)).toEqual([true, true, true]);
  });

  it("drops the mark where one line has no figure, and on an empty statement", () => {
    const rows = [
      { ...row(income, "Net Sales"), values: [1, null, 3] },
      { ...row(income, "Cost of Sales") },
    ];
    expect(coverage(rows, 3)).toEqual([true, false, true]);
    expect(coverage([], 2)).toEqual([false, false]);
  });
});

describe("chip families", () => {
  it("resolves the codes the live file carries", () => {
    expect(chipFamily("net_sales_revenue")).toBe("rev");
    expect(chipFamily("cost_of_sales")).toBe("exp");
    expect(chipFamily("gross_profit")).toBe("tot");
    expect(chipFamily("cash_and_equivalents")).toBe("ca");
    expect(chipFamily("accounts_payable_trade")).toBe("cl");
    expect(chipFamily("ppe_machinery")).toBe("lta");
    expect(chipFamily("long_term_debt_bank")).toBe("ltl");
    expect(chipFamily("total_equity")).toBe("eq");
  });

  it("falls back to the hierarchy, then to a keyword, then to a total", () => {
    expect(chipFamily("some_unknown_subtotal", "subtotal")).toBe("tot");
    expect(chipFamily("deferred_revenue_x")).toBe("rev");
    expect(chipFamily("entirely_unknown_code")).toBe("tot");
  });

  it("gives an unmapped line its own mute family and abbreviation", () => {
    expect(chipFamily(null)).toBe("none");
    expect(chipAbbr("none")).toBe("NONE");
    expect(chipAbbr("rev")).toBe("REV");
  });

  it("flags a line item Boom left unmapped, and never a header", () => {
    expect(row(cash, "Net Income").mismapped).toBe(true);
    expect(row(cash, "Cash Flows from Operating Activities").mismapped).toBe(false);
    expect(row(income, "Net Sales").mismapped).toBe(false);
  });
});

describe("units and formatting", () => {
  it("captions the scale in the banker's own words", () => {
    expect(unitCaption("full")).toBe("$ in dollars");
    expect(unitCaption("k")).toBe("$ in thousands");
    expect(unitCaption("m")).toBe("$ in millions");
  });

  it("scales the live revenue to each unit", () => {
    expect(scaleValue(64486000, "full")).toBe(64486000);
    expect(scaleValue(64486000, "k")).toBe(64486);
    expect(scaleValue(64486000, "m")).toBe(64.486);
    expect(fmtCell(64486000, "full")).toBe("64,486,000");
    expect(fmtCell(64486000, "k")).toBe("64,486");
    expect(fmtCell(64486000, "m")).toBe("64.5");
  });

  it("prints a negative with a leading minus and never a parenthesis", () => {
    expect(fmtCell(-1076000, "k")).toBe("-1,076");
    expect(fmtCell(-1076000, "k")).not.toContain("(");
  });

  it("prints an absent figure as an empty cell and never manufactures a minus zero", () => {
    expect(fmtCell(null, "k")).toBe("");
    expect(fmtCell(undefined, "k")).toBe("");
    expect(fmtCell(-10, "m")).toBe("0.0");
  });
});

describe("ratio support", () => {
  it("names the figures a line feeds, by account code where Boom gave one", () => {
    expect(row(income, "Net Sales").feeds).toContain("revenue");
    expect(row(income, "Interest Expense").feeds).toContain("interest expense");
  });

  it("falls back to the line name where Boom placed no code", () => {
    expect(row(cash, "Depreciation and Amortization").feeds).toContain("D and A");
  });

  it("marks only the lines behind a headline ratio, and leaves the rest alone", () => {
    /* Boom cites cost of sales, gross profit and operating expenses on its own
       support lines. None of them is a figure a banker acts on, so none of them
       is marked: a marker on ten rows of eleven is decoration. */
    expect(row(income, "Income from Operations").feeds).toEqual(["operating income"]);
    expect(row(income, "Cost of Sales").feeds).toEqual([]);
    expect(row(income, "Gross Profit").feeds).toEqual([]);
    expect(row(income, "Operating Expenses").feeds).toEqual([]);
    expect(row(balance, "Line of Credit and Current Portion of Long-Term Debt").feeds).toEqual(["total debt"]);
    expect(row(balance, "Long-Term Debt, Net of Current Portion").feeds).toEqual(["total debt"]);
    expect(row(balance, "Total Assets").feeds).toEqual([]);
  });

  it("indexes nothing from an absent support block", () => {
    expect(supportIndex(null).size).toBe(0);
  });
});
