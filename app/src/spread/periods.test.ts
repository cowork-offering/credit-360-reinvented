import { describe, expect, it } from "vitest";
import { detectCurrency, detectPeriods, detectQuality, detectStatementTypes, detectUnits, periodKey } from "./periods";

/* =============================================================================
   THE DETERMINISTIC READ, HELD TO THE PAGE.

   Every case here is a phrase a real statement prints. The rule under test in
   all of them is the same one: a period comes back with the end date the file
   printed, or with no end date at all. A date this module invented would fork
   a borrower's history in Boom, which keys its periods on that date.
   ============================================================================= */

const keys = (text: string): string[] => detectPeriods(text).map((p) => p.key);

describe("detectPeriods", () => {
  it("reads a fiscal year with its end date", () => {
    const [period] = detectPeriods("Consolidated Statements of Income for the fiscal year ended December 31, 2025");
    expect(period).toEqual({ key: "FY2025", endDate: "2025-12-31", periodType: "annual" });
  });

  it("reads a numeric year end", () => {
    const [period] = detectPeriods("Year ended 12/31/2025");
    expect(period).toEqual({ key: "FY2025", endDate: "2025-12-31", periodType: "annual" });
  });

  it("reads the comparative years a balance sheet prints beside its date", () => {
    expect(keys("Balance Sheets as of December 31, 2025 and 2024")).toEqual(["FY2025", "FY2024"]);
    expect(detectPeriods("December 31, 2025 and 2024")[1].endDate).toBe("2024-12-31");
  });

  it("reads six months as a semi-annual period", () => {
    const [period] = detectPeriods("Six months ended June 30, 2026");
    expect(period).toEqual({ key: "H1 2026", endDate: "2026-06-30", periodType: "semi_annual" });
  });

  it("reads three months as a quarter and nine months as a year to date", () => {
    expect(detectPeriods("Three months ended March 31, 2026")[0]).toEqual({
      key: "Q1 2026",
      endDate: "2026-03-31",
      periodType: "quarterly",
    });
    expect(detectPeriods("Nine months ended September 30, 2026")[0]).toEqual({
      key: "YTD Sep 2026",
      endDate: "2026-09-30",
      periodType: "year_to_date",
    });
  });

  it("reads a bare quarter with NO end date, because the file printed none", () => {
    const [period] = detectPeriods("Q2 2026 management accounts");
    expect(period).toEqual({ key: "Q2 2026", endDate: null, periodType: "quarterly" });
  });

  it("reads the trailing twelve months, bare and dated", () => {
    expect(detectPeriods("TTM revenue")[0]).toEqual({ key: "TTM", endDate: null, periodType: "trailing_twelve_months" });
    expect(detectPeriods("Trailing twelve months ended June 30, 2026")[0]).toEqual({
      key: "TTM Jun 2026",
      endDate: "2026-06-30",
      periodType: "trailing_twelve_months",
    });
  });

  it("reads a column header run of fiscal years, newest first", () => {
    expect(keys("Net Sales\n2025 2024 2023\n")).toEqual(["FY2025", "FY2024", "FY2023"]);
  });

  it("ignores four digit numbers on a line that are not a stepped year run", () => {
    expect(keys("Suite 4100 2025 1890")).toEqual([]);
  });

  it("gives a bare FY the full date the same file prints for that year", () => {
    const [period] = detectPeriods("FY2025 summary\nPrepared as of December 31, 2025");
    expect(period).toEqual({ key: "FY2025", endDate: "2025-12-31", periodType: "annual" });
  });

  it("dedupes on the key and keeps the reading that carries a date", () => {
    expect(keys("FY2025 results for the year ended December 31, 2025")).toEqual(["FY2025"]);
  });

  it("returns nothing for text that prints no period", () => {
    expect(detectPeriods("Notes to the financial statements")).toEqual([]);
  });
});

describe("periodKey", () => {
  it("names each period type the way the room prints it", () => {
    expect(periodKey("annual", "2025-12-31")).toBe("FY2025");
    expect(periodKey("quarterly", "2026-06-30")).toBe("Q2 2026");
    expect(periodKey("semi_annual", "2026-06-30")).toBe("H1 2026");
    expect(periodKey("semi_annual", "2026-09-30")).toBe("6M Sep 2026");
    expect(periodKey("trailing_twelve_months", null)).toBe("TTM");
  });
});

describe("detectUnits", () => {
  it("reads thousands", () => {
    expect(detectUnits("(in thousands, except per share amounts)")).toBe(1000);
    expect(detectUnits("Amounts in $000s")).toBe(1000);
  });

  it("reads millions, and reads them first where a statement says both", () => {
    expect(detectUnits("(in millions)")).toBe(1_000_000);
    expect(detectUnits("in millions, except per share amounts in thousands")).toBe(1_000_000);
  });

  it("defaults to absolute dollars where the statement states no scale", () => {
    expect(detectUnits("Net Sales 64,486,000")).toBe(1);
  });
});

describe("detectStatementTypes", () => {
  it("reads the three statements an annual report carries", () => {
    const text = "Statements of Operations\nBalance Sheets\nStatements of Cash Flows";
    expect(detectStatementTypes(text)).toEqual(["income_statement", "balance_sheet", "cash_flow_statement"]);
  });

  it("reads a statement of financial position as a balance sheet", () => {
    expect(detectStatementTypes("Statement of Financial Position")).toEqual(["balance_sheet"]);
  });

  it("reads equity and personal statements", () => {
    expect(detectStatementTypes("Statement of Changes in Stockholders' Equity")).toEqual(["shareholders_equity"]);
    expect(detectStatementTypes("Personal Financial Statement")).toEqual(["personal_statement"]);
  });
});

describe("detectQuality", () => {
  it("reads an auditor's report as audited and quotes the words", () => {
    const { quality, grounding } = detectQuality("Report of Independent Certified Public Accountants. We have audited the accompanying balance sheets.");
    expect(quality).toBe("cpa_audited");
    expect(grounding).toContain("Independent Certified Public Accountants");
  });

  it("reads a review report and a compilation report", () => {
    expect(detectQuality("Accountant's Review Report").quality).toBe("cpa_reviewed");
    expect(detectQuality("We have compiled the accompanying statements. Compilation report follows.").quality).toBe("cpa_compiled");
  });

  it("reads management prepared and unaudited as internal", () => {
    expect(detectQuality("These statements were prepared by management.").quality).toBe("internal");
    expect(detectQuality("Unaudited interim statements").quality).toBe("internal");
  });

  it("lets the audit report win over an unaudited interim note in the same file", () => {
    expect(detectQuality("Independent Auditors' Report ... the unaudited interim data in Note 14").quality).toBe("cpa_audited");
  });

  it("reads the singular possessive a single company's report actually prints", () => {
    // The 2026-09-12 browser run: the file printed "Independent Auditor's
    // Report" and the room asked the banker for a quality the file states.
    for (const said of [
      "Independent Auditor's Report",
      "Independent Auditor’s Report",
      "Independent Auditors' Report",
      "Independent Auditors Report",
      "Report of Independent Certified Public Accountant's opinion",
    ]) {
      expect(detectQuality(said).quality).toBe("cpa_audited");
    }
  });

  it("quotes the line the words sit on, not the page above it", () => {
    // A statement's lines end in figures, not in full stops, so a grounding
    // bounded only by the full stop walked back up to the company name.
    const text = ["Total equity 20,000 18,500", "Independent Auditor's Report: In our opinion, the statements present fairly."].join("\n");
    expect(detectQuality(text).grounding).toBe("Independent Auditor's Report: In our opinion, the statements present fairly.");
  });

  it("proposes nothing where the file says nothing", () => {
    expect(detectQuality("Balance Sheets")).toEqual({ quality: null, grounding: null });
  });
});

describe("detectCurrency", () => {
  it("defaults to dollars and reads a stated currency", () => {
    expect(detectCurrency("Net Sales")).toBe("USD");
    expect(detectCurrency("All amounts in GBP")).toBe("GBP");
  });
});
