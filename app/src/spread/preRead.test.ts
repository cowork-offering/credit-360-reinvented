import { describe, expect, it, vi } from "vitest";
import {
  companyCandidates,
  companyMatch,
  composePreReadPrompt,
  coerceNumber,
  deterministicPreRead,
  DOOR_ABSENT_NOTE,
  MODEL_FAILED_NOTE,
  preReadFile,
  PreReadParseError,
  SCAN_NOTE,
  unitsStated,
  validateModelPreRead,
  type RelationshipSpreadContext,
} from "./preRead";
import { extractDocument, type PdfjsLike } from "./extract";
import type { ExtractedDocument } from "./types";

/* =============================================================================
   THE PRE-READ, HELD TO THE CONTRACT AND TO THE DEGRADE.

   Two things are under test. First, that nothing the model says reaches the
   glass without passing the contract: unknown enums out, figures coerced the
   way a statement prints them, a line with anything else in a value slot
   dropped whole. Second, that every kind of absence still produces a usable
   read with a sentence that says what was not done, because a room that threw
   here would leave the banker holding a file and no next step.
   ============================================================================= */

const CTX: RelationshipSpreadContext = {
  accountId: "001xx",
  company: "Piedmont Precision Components, Inc.",
  onFilePeriods: ["FY2025", "FY2024", "FY2023"],
  covenants: [
    { name: "Interest Coverage Ratio", operator: ">=", threshold: 1.25, current: 2.64, unit: "x" },
    { name: "Total Leverage Ratio", operator: "<=", threshold: 4, current: 3.85, unit: "x" },
  ],
  obligorGroup: [{ name: "Piedmont Holdings LLC", role: "Parent guarantor" }],
};

const TEXT = [
  "PIEDMONT PRECISION COMPONENTS, INC.",
  "Statements of Income",
  "(in thousands)",
  "For the years ended December 31, 2026 and 2025",
  "Report of Independent Certified Public Accountants",
  "Net Sales 71,200 64,486",
].join("\n");

const doc = (over: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  fileId: "f_1",
  kind: "pdf-text",
  text: TEXT,
  tables: [],
  pages: 4,
  isScan: false,
  warnings: [],
  ...over,
});

describe("companyMatch", () => {
  it("matches the relationship through a legal suffix", () => {
    expect(companyMatch("Piedmont Precision Components, Inc.", CTX)).toEqual({ matches: true, member: null });
    expect(companyMatch("PIEDMONT PRECISION COMPONENTS", CTX)).toEqual({ matches: true, member: null });
    expect(companyMatch("Piedmont Precision Components and Subsidiaries", CTX)).toEqual({ matches: true, member: null });
  });

  it("names the obligor group member a statement actually belongs to", () => {
    expect(companyMatch("PIEDMONT HOLDINGS LLC", CTX)).toEqual({
      matches: false,
      member: "Piedmont Holdings LLC (Parent guarantor)",
    });
  });

  it("calls an unrelated borrower a mismatch with no member", () => {
    expect(companyMatch("Hartwell Precision LLC", CTX)).toEqual({ matches: false, member: null });
  });

  it("says nothing where the file prints no name", () => {
    expect(companyMatch(null, CTX)).toEqual({ matches: null, member: null });
  });
});

describe("companyCandidates", () => {
  it("takes the name off the head of the file and skips the statement titles", () => {
    expect(companyCandidates(TEXT)[0]).toBe("PIEDMONT PRECISION COMPONENTS, INC.");
  });
});

describe("deterministicPreRead", () => {
  it("reads the periods, the scale, the quality and the company with no model in the path", () => {
    const read = deterministicPreRead(doc(), CTX);
    expect(read.statements.map((s) => s.statementType)).toEqual(["income_statement"]);
    expect(read.statements[0].periods.map((p) => p.key)).toEqual(["FY2026", "FY2025"]);
    expect(read.unitsMultiplier).toBe(1000);
    expect(read.statementQuality).toBe("cpa_audited");
    expect(read.company).toBe("PIEDMONT PRECISION COMPONENTS, INC.");
    expect(read.companyMatchesRelationship).toBe(true);
    expect(read.confidence).toBe("low");
    /* PIN UPDATED 2026-09-12 (browser e2e of the release build, orchestrator).
       This read used to place no lines at all, which is what made the stub fail
       on every file whenever the session door was absent or answered with junk.
       The deterministic read now places what the text prints, at the statement's
       own scale, against the periods the same text produced. */
    expect(read.statements[0].lines).toEqual([
      {
        label: "Net Sales",
        accountCode: "net_sales_revenue",
        values: { FY2026: 71_200_000, FY2025: 64_486_000 },
        confidence: "medium",
      },
    ]);
  });

  it("says on the card that the statement printed its own scale", () => {
    const read = deterministicPreRead(doc(), CTX);
    expect(read.quality.some((q) => q.text === "Figures in thousands, as the statement says.")).toBe(true);
    expect(unitsStated(read)).toBe(true);
  });

  it("claims no scale where the statement states none", () => {
    const read = deterministicPreRead(doc({ text: "Balance Sheets\nTotal Assets 46,761,000" }), CTX);
    expect(read.unitsMultiplier).toBe(1);
    expect(unitsStated(read)).toBe(false);
  });

  it("says which periods are already on file", () => {
    const read = deterministicPreRead(doc(), CTX);
    expect(read.quality.some((q) => /FY2025 is already on file/.test(q.text))).toBe(true);
  });

  it("names a gap between the on-file spread and the file in hand", () => {
    const read = deterministicPreRead(doc({ text: "Year ended December 31, 2028\nBalance Sheets" }), CTX);
    expect(read.quality.some((q) => q.level === "warn" && /FY2025 and this file starts at FY2028/.test(q.text))).toBe(true);
  });

  it("surfaces a company mismatch rather than passing it through", () => {
    const read = deterministicPreRead(doc({ text: "PIEDMONT HOLDINGS LLC\nBalance Sheets\nYear ended December 31, 2026" }), CTX);
    expect(read.companyMatchesRelationship).toBe(false);
    expect(read.quality.some((q) => q.level === "warn" && /Parent guarantor/.test(q.text))).toBe(true);
  });

  it("asks for the period where the file prints none", () => {
    const read = deterministicPreRead(doc({ text: "Balance Sheets" }), CTX);
    expect(read.quality.some((q) => /No fiscal period is printed/.test(q.text))).toBe(true);
  });
});

describe("coerceNumber", () => {
  it("reads what a statement prints and refuses what it does not", () => {
    expect(coerceNumber(64486)).toBe(64486);
    expect(coerceNumber("64,486")).toBe(64486);
    expect(coerceNumber("$1,019.50")).toBe(1019.5);
    expect(coerceNumber("(1,019)")).toBe(-1019);
    expect(coerceNumber("n/a")).toBeNull();
    expect(coerceNumber(Number.NaN)).toBeNull();
    expect(coerceNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("validateModelPreRead", () => {
  const base = deterministicPreRead(doc(), CTX);

  const good = JSON.stringify({
    statements: [
      {
        statementType: "income_statement",
        periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
        lines: [
          { label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2026: 71200, FY2025: "64,486" }, confidence: "high" },
          { label: "Interest Expense", accountCode: "interest_expense", values: { FY2026: "(1,200)" }, confidence: "medium" },
        ],
      },
    ],
    company: "Piedmont Precision Components, Inc.",
    companyMatchesRelationship: true,
    currency: "USD",
    unitsMultiplier: 1000,
    statementQuality: "cpa_audited",
    quality: [{ level: "warn", text: "The balance sheet is not in this file." }],
    confidence: "high",
  });

  it("scales the printed figures by the statement's own units, once", () => {
    const read = validateModelPreRead(good, base, CTX);
    expect(read.statements[0].lines[0].values).toEqual({ FY2026: 71_200_000, FY2025: 64_486_000 });
    expect(read.statements[0].lines[1].values).toEqual({ FY2026: -1_200_000 });
    expect(read.confidence).toBe("high");
  });

  it("keeps the deterministic findings the model did not mention", () => {
    const read = validateModelPreRead(good, base, CTX);
    expect(read.quality.some((q) => /FY2025 is already on file/.test(q.text))).toBe(true);
    expect(read.quality.some((q) => q.text === "The balance sheet is not in this file.")).toBe(true);
  });

  it("recomputes the company match itself rather than trusting the flag", () => {
    const lying = JSON.stringify({ ...JSON.parse(good), company: "Hartwell Precision LLC", companyMatchesRelationship: true });
    expect(validateModelPreRead(lying, base, CTX).companyMatchesRelationship).toBe(false);
  });

  it("drops a statement type the contract does not carry, and says it did", () => {
    const partial = JSON.stringify({
      ...JSON.parse(good),
      statements: [{ statementType: "tax_return", periods: [], lines: [] }, JSON.parse(good).statements[0]],
    });
    const read = validateModelPreRead(partial, base, CTX);
    expect(read.statements.map((s) => s.statementType)).toEqual(["income_statement"]);
    expect(read.quality.some((q) => /tax_return/.test(q.text))).toBe(true);
  });

  it("drops a line whose value slot holds something that is not a figure", () => {
    const broken = JSON.parse(good);
    broken.statements[0].lines[0].values.FY2026 = "see note 4";
    const read = validateModelPreRead(JSON.stringify(broken), base, CTX);
    expect(read.statements[0].lines.map((l) => l.label)).toEqual(["Interest Expense"]);
  });

  it("drops a line mapped to an account code Boom does not carry", () => {
    const broken = JSON.parse(good);
    broken.statements[0].lines[0].accountCode = "made_up_code";
    const read = validateModelPreRead(JSON.stringify(broken), base, CTX);
    expect(read.statements[0].lines.map((l) => l.label)).toEqual(["Interest Expense"]);
  });

  it("falls back to the deterministic reading for a field the reply got wrong", () => {
    const odd = JSON.stringify({ ...JSON.parse(good), unitsMultiplier: 17, statementQuality: "notarised", currency: "dollars", confidence: "certain" });
    const read = validateModelPreRead(odd, base, CTX);
    expect(read.unitsMultiplier).toBe(1000);
    expect(read.statementQuality).toBe("cpa_audited");
    expect(read.currency).toBe("USD");
    expect(read.confidence).toBe("low");
  });

  it("reads the object out of a reply with a sentence wrapped around it", () => {
    const read = validateModelPreRead("Here is the read:\n```json\n" + good + "\n```", base, CTX);
    expect(read.statements[0].lines).toHaveLength(2);
  });

  it("refuses a reply that is not a read at all", () => {
    expect(() => validateModelPreRead("no idea", base, CTX)).toThrow(PreReadParseError);
    expect(() => validateModelPreRead('{"company":"Piedmont"}', base, CTX)).toThrow(/statements/);
  });

  it("holds a read with no usable lines at low confidence, whatever the reply claimed", () => {
    const empty = JSON.stringify({ ...JSON.parse(good), statements: [{ statementType: "balance_sheet", periods: [], lines: [] }] });
    expect(validateModelPreRead(empty, base, CTX).confidence).toBe("low");
  });
});

describe("composePreReadPrompt", () => {
  it("carries the relationship, the on-file periods and the covenant thresholds", () => {
    const prompt = composePreReadPrompt(doc(), CTX, deterministicPreRead(doc(), CTX));
    expect(prompt).toContain("Piedmont Precision Components, Inc.");
    expect(prompt).toContain("FY2025");
    expect(prompt).toContain("Interest Coverage Ratio");
    expect(prompt).toContain("net_sales_revenue");
    expect(prompt).toContain("Reply with the JSON object and nothing else.");
    expect(prompt).toContain(TEXT);
  });

  it("clips a very long document rather than sending the whole ledger", () => {
    const prompt = composePreReadPrompt(doc({ text: "x".repeat(40_000) }), CTX, deterministicPreRead(doc(), CTX));
    expect(prompt).toContain("[the rest of this file was not carried]");
    expect(prompt.length).toBeLessThan(20_000);
  });
});

describe("preReadFile", () => {
  const good = JSON.stringify({
    statements: [
      {
        statementType: "income_statement",
        periods: [{ key: "FY2026", endDate: "2026-12-31", periodType: "annual" }],
        lines: [{ label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2026: 71200 }, confidence: "high" }],
      },
    ],
    company: "Piedmont Precision Components, Inc.",
    currency: "USD",
    unitsMultiplier: 1000,
    statementQuality: "cpa_audited",
    quality: [],
    confidence: "high",
  });

  it("reads a file through the door and returns the mapped lines", async () => {
    const ask = vi.fn().mockResolvedValue(good);
    const read = await preReadFile(doc(), CTX, { ask, available: () => true });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(read.statements[0].lines[0].values.FY2026).toBe(71_200_000);
    expect(read.confidence).toBe("high");
  });

  it("degrades honestly when the desk is not connected, and invents no line", async () => {
    const ask = vi.fn();
    const read = await preReadFile(doc(), CTX, { ask, available: () => false });
    expect(ask).not.toHaveBeenCalled();
    expect(read.quality[0].text).toBe(DOOR_ABSENT_NOTE);
    expect(read.confidence).toBe("low");
    /* PIN UPDATED 2026-09-12 (browser e2e of the release build, orchestrator).
       "Invents no line" still holds and is the point: every figure below is
       printed in the file. What changed is that the deterministic read now
       PLACES those printed lines instead of handing the room an empty read. */
    expect(read.statements[0].lines[0].accountCode).toBe("net_sales_revenue");
    expect(read.statements[0].lines[0].values.FY2026).toBe(71_200_000);
    // The deterministic read still stands on its own.
    expect(read.statements[0].periods[0].key).toBe("FY2026");
    expect(read.statementQuality).toBe("cpa_audited");
  });

  it("retries once with the reason, and keeps the second reply", async () => {
    const ask = vi.fn().mockResolvedValueOnce("sorry, I cannot do that").mockResolvedValueOnce(good);
    const read = await preReadFile(doc(), CTX, { ask, available: () => true });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(String(ask.mock.calls[1][0])).toContain("Your previous reply could not be used");
    expect(read.statements[0].lines).toHaveLength(1);
  });

  it("stops after the second failure and says the read was not usable", async () => {
    const ask = vi.fn().mockResolvedValue("still not JSON");
    const read = await preReadFile(doc(), CTX, { ask, available: () => true });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(read.quality[0].text).toBe(MODEL_FAILED_NOTE);
    expect(read.confidence).toBe("low");
  });

  it("survives a door that rejects outright", async () => {
    const ask = vi.fn().mockRejectedValue({ code: "not_granted", message: "declined" });
    const read = await preReadFile(doc(), CTX, { ask, available: () => true });
    expect(read.quality[0].text).toBe(MODEL_FAILED_NOTE);
  });

  it("never asks the model about a scan, and asks the banker instead", async () => {
    const ask = vi.fn();
    const read = await preReadFile(doc({ isScan: true, kind: "pdf-scan", text: "" }), CTX, { ask, available: () => true });
    expect(ask).not.toHaveBeenCalled();
    expect(read.statements).toEqual([]);
    expect(read.quality[0].text).toBe(SCAN_NOTE);
  });
});

/* =============================================================================
   THE PDF THE 2026-09-12 BROWSER RUN DROPPED, THROUGH THE REAL READER.

   pdf.js hands a page over as text items, not as lines: a line arrives as
   several spans with the gaps between them as their own " " items, and the
   LAST item of a line carries `hasEOL`. The list below is exactly what
   pdf.js 3.11.174 returned for the one-page statement that run used, and it
   goes through the real `extractDocument` and the real `deterministicPreRead`,
   because the bugs it caught live in the seam between them.
   ============================================================================= */

/** One page of pdf.js items: `[text, ends the line]`. */
const PIEDMONT_PDF_ITEMS: Array<[string, boolean]> = [
  ["Piedmont Precision Components, Inc.", false],
  ["", true],
  ["Consolidated Statements of Income (in thousands)", false],
  ["", true],
  ["Fiscal year ended December 31, 2025 and 2024", false],
  ["", true],
  ["2025", false],
  [" ", false],
  ["2024", false],
  ["", true],
  ["Net sales revenue", false],
  [" ", false],
  ["71,200 64,486", true],
  ["Cost of sales", false],
  [" ", false],
  ["49,840 45,140", true],
  ["Gross profit", false],
  [" ", false],
  ["21,360 19,346", true],
  ["Operating expenses 15,960 14,100", true],
  ["Operating profit", false],
  [" ", false],
  ["5,400", false],
  [" ", false],
  ["5,246", true],
  ["Interest expense", false],
  [" ", false],
  ["1,750", false],
  [" ", false],
  ["1,989", true],
  ["Net income", false],
  [" ", false],
  ["2,700", false],
  [" ", false],
  ["2,400", false],
  ["", true],
  ["Consolidated Balance Sheets (in thousands)", false],
  ["", true],
  ["As of December 31, 2025 and 2024", false],
  ["", true],
  ["2025", false],
  [" ", false],
  ["2024", false],
  ["", true],
  ["Total assets", false],
  [" ", false],
  ["52,000 50,000", true],
  ["Total liabilities 32,000 31,500", true],
  ["Total equity", false],
  [" ", false],
  ["20,000 18,500", false],
  ["", true],
  [
    "Independent Auditor's Report: In our opinion, the financial statements present fairly, in all material respects, the financial position of the Company.",
    false,
  ],
];

const pdfjsReturning = (items: Array<[string, boolean]>): (() => Promise<PdfjsLike>) => () =>
  Promise.resolve({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () =>
          Promise.resolve({
            getTextContent: () => Promise.resolve({ items: items.map(([str, hasEOL]) => ({ str, hasEOL })) }),
          }),
      }),
    }),
  } as PdfjsLike);

const piedmontPdf = (): Promise<ExtractedDocument> =>
  extractDocument(
    {
      id: "f_piedmont",
      name: "piedmont-fy2025.pdf",
      mime: "application/pdf",
      bytes: 4096,
      base64: btoa("%PDF"),
      sha256: "0".repeat(64),
      kind: "pdf-text",
    },
    { pdfjs: pdfjsReturning(PIEDMONT_PDF_ITEMS) },
  );

describe("the dropped PDF, read end to end", () => {
  it("puts every printed line on a line of its own", async () => {
    const read = await piedmontPdf();
    expect(read.text.split("\n")[0]).toBe("Piedmont Precision Components, Inc.");
    expect(read.text).toContain("Net sales revenue 71,200 64,486");
    expect(read.text).toContain("\nIndependent Auditor's Report:");
    expect(read.isScan).toBe(false);
  });

  it("reads the printed name the statement heads itself with", async () => {
    const pre = deterministicPreRead(await piedmontPdf(), CTX);
    expect(pre.company).toBe("Piedmont Precision Components, Inc.");
    expect(pre.companyMatchesRelationship).toBe(true);
  });

  it("reads the auditor's report the file actually carries", async () => {
    const pre = deterministicPreRead(await piedmontPdf(), CTX);
    expect(pre.statementQuality).toBe("cpa_audited");
    expect(pre.quality.map((q) => q.text).join(" ")).toContain("Independent Auditor's Report: In our opinion");
  });

  it("still reads the kind, both statements and both periods", async () => {
    const pre = deterministicPreRead(await piedmontPdf(), CTX);
    expect(pre.statements.map((s) => s.statementType)).toEqual(["income_statement", "balance_sheet"]);
    expect(pre.statements[0].periods.map((p) => p.key)).toEqual(["FY2025", "FY2024"]);
    expect(pre.unitsMultiplier).toBe(1_000);
  });

  it("places the lines off a text layer whose figures share one item", async () => {
    const pre = deterministicPreRead(await piedmontPdf(), CTX);
    const income = pre.statements.find((s) => s.statementType === "income_statement")!;
    const balance = pre.statements.find((s) => s.statementType === "balance_sheet")!;
    const sales = income.lines.find((l) => l.accountCode === "net_sales_revenue")!;
    const assets = balance.lines.find((l) => l.accountCode === "total_assets")!;
    expect(sales.values).toEqual({ FY2025: 71_200_000, FY2024: 64_486_000 });
    expect(assets.values).toEqual({ FY2025: 52_000_000, FY2024: 50_000_000 });
  });
});
