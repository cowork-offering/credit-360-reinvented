import { describe, expect, it } from "vitest";
import spreadPiedmont from "../../../__fixtures__/boom-live/spread-piedmont.json";
import type { BoomFinancialStatement, FilePreRead, PreReadLine } from "../../../spread/types";
import { registerStatements } from "./registerModel";
import {
  ghostHierarchy,
  ghostStatements,
  mergeRows,
  reconcile,
  registerSources,
  rowKey,
  sourceRows,
  unitOf,
} from "./ghostModel";

/* =============================================================================
   THE GHOST REGISTER AND THE RECONCILIATION IT DERIVES.

   The mapped side is Boom's own live read of Piedmont
   (`__fixtures__/boom-live/spread-piedmont.json`). The ghost side is the same
   statement as the room's pre-read takes it off the page: Boom's ONE mapped
   `total_operating_expenses` line is printed as its two components (the
   cash-flow statement's own D and A line, and SG and A as the remainder), and
   the provision for income taxes is the line Boom flagged `flipSign`.

   The prototype's `gen.py` derived 8 kept, 2 folded into 1 and 1 read with the
   opposite sign from exactly this pair. So does this.
   ============================================================================= */

const K = 1_000;
const PERIODS = [
  { key: "FY2025", endDate: "2025-12-31", periodType: "annual" as const },
  { key: "FY2024", endDate: "2024-12-31", periodType: "annual" as const },
  { key: "FY2023", endDate: "2023-12-31", periodType: "annual" as const },
];

/** One printed line, in thousands as the statement prints it. */
function line(label: string, fy2025: number, fy2024: number, fy2023: number): PreReadLine {
  return {
    label,
    accountCode: null,
    values: { FY2025: fy2025 * K, FY2024: fy2024 * K, FY2023: fy2023 * K },
    confidence: "low",
  };
}

const INCOME_LINES: PreReadLine[] = [
  line("Net Sales", 64486, 59915, 56266),
  line("Cost of Sales", 50422, 45371, 40829),
  line("Gross Profit", 14064, 14544, 15437),
  line("Selling, General and Administrative", 8830, 8800, 8743),
  line("Depreciation and Amortization", 2396, 2189, 2009),
  line("Income from Operations", 2838, 3555, 4685),
  line("Interest Expense", -1076, -1019, -947),
  line("Other Income (Expense), Net", 55, -45, 71),
  line("Income before Income Taxes", 1817, 2491, 3809),
  line("Provision for Income Taxes", -427, -623, -936),
  line("Net Income", 1390, 1868, 2873),
];

function preRead(lines: PreReadLine[], multiplier = K): FilePreRead {
  return {
    fileId: "f1",
    statements: [{ statementType: "income_statement", periods: PERIODS, lines }],
    company: "Piedmont Precision Components, Inc.",
    companyMatchesRelationship: true,
    currency: "USD",
    unitsMultiplier: multiplier,
    statementQuality: "cpa_compiled",
    quality: [],
    confidence: "low",
  };
}

const source = (lines = INCOME_LINES, multiplier = K) => ({
  fileId: "f1",
  fileName: "Compiled Financial Statements December 31, 2025.pdf",
  pre: preRead(lines, multiplier),
});

const BOOM: BoomFinancialStatement[] = (
  spreadPiedmont as unknown as { spread: { financialStatements: BoomFinancialStatement[] } }
).spread.financialStatements;

const boomIncome = () =>
  registerStatements(
    BOOM.filter((s) => s.statementType === "income_statement"),
    { adjusted: false },
  )[0];

describe("the ghost register, off the file's own text", () => {
  it("builds one statement per file and statement type, at the scale the file printed", () => {
    const [ghost] = ghostStatements([source()]);
    expect(ghost.type).toBe("income_statement");
    expect(ghost.label).toBe("Income statement");
    expect(ghost.fileName).toBe("Compiled Financial Statements December 31, 2025.pdf");
    expect(ghost.unit).toBe("k");
    expect(ghost.unitsWord).toBe("thousands, as printed");
  });

  it("carries every printed line, in the order the page prints them", () => {
    const [ghost] = ghostStatements([source()]);
    expect(ghost.rows).toHaveLength(11);
    expect(ghost.rows.map((r) => r.name)).toEqual(INCOME_LINES.map((l) => l.label));
    expect(ghost.rows[0].values).toEqual([56266 * K, 59915 * K, 64486 * K]);
  });

  it("puts the periods oldest left, the order the register draws Boom's own in", () => {
    const [ghost] = ghostStatements([source()]);
    expect(ghost.periods.map((p) => p.key)).toEqual(["FY2023", "FY2024", "FY2025"]);
  });

  it("carries no account code at all: a code is Boom's to give", () => {
    const [ghost] = ghostStatements([source()]);
    const rows = sourceRows({ id: ghost.id, label: ghost.label, lit: false, boom: null, ghost, recon: null });
    expect(rows.every((r) => r.code === null)).toBe(true);
    expect(rows.every((r) => r.family === "none")).toBe(true);
  });

  it("reads the page's own subtotal and total words off the labels", () => {
    expect(ghostHierarchy("Gross Profit")).toBe("subtotal");
    expect(ghostHierarchy("Income before Income Taxes")).toBe("subtotal");
    expect(ghostHierarchy("Net Income")).toBe("total");
    expect(ghostHierarchy("Total Assets")).toBe("total");
    expect(ghostHierarchy("Cost of Sales")).toBe("line_item");
  });

  it("names the scale the file states", () => {
    expect(unitOf(1)).toBe("full");
    expect(unitOf(1_000)).toBe("k");
    expect(unitOf(1_000_000)).toBe("m");
    expect(ghostStatements([source(INCOME_LINES, 1)])[0].unitsWord).toBe("dollars, as printed");
  });

  it("places no statement where the pre-read placed no line", () => {
    expect(ghostStatements([source([])])).toHaveLength(0);
  });
});

describe("the reconciliation, derived from the two sides", () => {
  it("derives 8 kept, 2 folded into 1 and 1 read with the opposite sign on the Piedmont pair", () => {
    const [ghost] = ghostStatements([source()]);
    const recon = reconcile(ghost, boomIncome());
    expect(recon.read).toBe(11);
    expect(recon.kept).toBe(8);
    expect(recon.folded).toBe(2);
    expect(recon.foldedInto).toBe(1);
    expect(recon.sign).toBe(1);
    expect(recon.restated).toBe(0);
    expect(recon.unmatchedGhost).toBe(0);
    expect(recon.unmatchedBoom).toBe(0);
  });

  it("says it in one banker sentence", () => {
    const [ghost] = ghostStatements([source()]);
    expect(reconcile(ghost, boomIncome()).sentence).toBe(
      "Boom kept 8 of the 11 lines this room read off the page as they stand, folded 2 into 1 and read 1 with the opposite sign.",
    );
  });

  it("writes NO sentence where Boom changed nothing", () => {
    /* The balance sheet carries no flagged sign and no fold: read off the page
       line for line, the two sides agree and there is nothing to account for. */
    const boom = registerStatements(
      BOOM.filter((s) => s.statementType === "balance_sheet"),
      { adjusted: false },
    )[0];
    const lines: PreReadLine[] = boom.rows
      .filter((r) => r.hierarchy !== "header")
      .map((r) => ({
        label: r.name,
        accountCode: null,
        values: { FY2023: r.values[0], FY2024: r.values[1], FY2025: r.values[2] },
        confidence: "low" as const,
      }));
    const [ghost] = ghostStatements([
      {
        fileId: "f2",
        fileName: "balance-sheet.pdf",
        pre: { ...preRead([]), statements: [{ statementType: "balance_sheet", periods: PERIODS, lines }] },
      },
    ]);
    const recon = reconcile(ghost, boom);
    expect(recon.read).toBeGreaterThan(0);
    expect(recon.kept).toBe(recon.read);
    expect(recon.unmatchedBoom).toBe(0);
    expect(recon.sentence).toBeNull();
  });

  it("is not a constant: a different page yields different counts", () => {
    const short = INCOME_LINES.filter((l) => !/Depreciation|Selling/.test(l.label));
    const [ghost] = ghostStatements([source(short)]);
    const recon = reconcile(ghost, boomIncome());
    expect(recon.read).toBe(9);
    expect(recon.folded).toBe(0);
    expect(recon.unmatchedBoom).toBe(1);
    expect(recon.sentence).toContain("added 1 line the page does not print");
  });

  it("states a printed line Boom returned nothing for", () => {
    const extra = [...INCOME_LINES, line("Management Fees", 120, 118, 110)];
    const [ghost] = ghostStatements([source(extra)]);
    const recon = reconcile(ghost, boomIncome());
    expect(recon.unmatchedGhost).toBe(1);
    expect(recon.sentence).toContain("left 1 unmatched");
  });

  it("reads a sign mismatch on equal magnitude as the opposite sign", () => {
    const flipped = INCOME_LINES.map((l) =>
      l.label === "Interest Expense"
        ? line("Interest Expense", 1076, 1019, 947)
        : l,
    );
    const [ghost] = ghostStatements([source(flipped)]);
    expect(reconcile(ghost, boomIncome()).sign).toBe(2);
  });

  it("calls a same-named line with a different figure restated, never kept", () => {
    const moved = INCOME_LINES.map((l) =>
      l.label === "Net Sales" ? line("Net Sales", 64000, 59915, 56266) : l,
    );
    const [ghost] = ghostStatements([source(moved)]);
    const recon = reconcile(ghost, boomIncome());
    expect(recon.kept).toBe(7);
    expect(recon.restated).toBe(1);
    expect(recon.sentence).toContain("restated 1");
  });
});

describe("the merge: Boom's lines land on the printed ones", () => {
  it("keeps one row list, with the folded lines gone and the line they became in their place", () => {
    const [ghost] = ghostStatements([source()]);
    const rows = mergeRows(ghost, boomIncome());
    expect(rows.map((r) => r.name)).toEqual([
      "Net Sales",
      "Cost of Sales",
      "Gross Profit",
      "Operating Expenses",
      "Income from Operations",
      "Interest Expense",
      "Other Income (Expense), Net",
      "Income before Income Taxes",
      "Provision for Income Taxes",
      "Net Income",
    ]);
    const folded = rows.find((r) => r.verdict === "fold");
    expect(folded?.code).toBe("total_operating_expenses");
    expect(folded?.note).toBe("Boom folded 2 printed lines into this one.");
  });

  it("holds the printed lines on the glass through the fold beat", () => {
    const [ghost] = ghostStatements([source()]);
    const during = mergeRows(ghost, boomIncome(), { folding: true });
    expect(during.filter((r) => r.folding).map((r) => r.name)).toEqual([
      "Selling, General and Administrative",
      "Depreciation and Amortization",
    ]);
    expect(during.some((r) => r.name === "Operating Expenses")).toBe(false);
  });

  it("gives every landed row Boom's own account code and lights the chip", () => {
    const [ghost] = ghostStatements([source()]);
    const rows = mergeRows(ghost, boomIncome());
    expect(rows.find((r) => r.name === "Net Sales")?.code).toBe("net_sales_revenue");
    expect(rows.find((r) => r.name === "Net Sales")?.abbr).toBe("REV");
    expect(rows.every((r) => r.code !== null)).toBe(true);
  });

  it("strikes the file's figure only where the two actually differ on the glass", () => {
    const [ghost] = ghostStatements([source()]);
    const same = mergeRows(ghost, boomIncome()).find((r) => r.verdict === "sign");
    /* Boom's flipSign is APPLIED in the register, so this row reads the same
       figure on both sides: the note stands, the strike does not. */
    expect(same?.fileValues).toBeNull();
    expect(same?.note).toContain("opposite sign");

    const printedPositive = INCOME_LINES.map((l) =>
      l.label === "Provision for Income Taxes" ? line("Provision for Income Taxes", 427, 623, 936) : l,
    );
    const [other] = ghostStatements([source(printedPositive)]);
    const struck = mergeRows(other, boomIncome()).find((r) => r.verdict === "sign");
    expect(struck?.fileValues).toEqual([936 * K, 623 * K, 427 * K]);
  });

  it("keeps the pin's own key across the beat", () => {
    const [ghost] = ghostStatements([source()]);
    const before = sourceRows({ id: "x", label: "x", lit: false, boom: null, ghost, recon: null });
    const after = mergeRows(ghost, boomIncome());
    const key = rowKey("Net Sales");
    expect(before.some((r) => r.key === key)).toBe(true);
    expect(after.some((r) => r.key === key)).toBe(true);
  });
});

describe("the sources the register draws from", () => {
  it("pairs a ghost with Boom's statement of the same type", () => {
    const [ghost] = ghostStatements([source()]);
    const sources = registerSources({ statements: BOOM, ghost: [ghost], adjusted: false });
    const income = sources.find((s) => s.label === "Income statement");
    expect(income?.lit).toBe(true);
    expect(income?.ghost).toBe(ghost);
    expect(income?.recon?.kept).toBe(8);
    expect(sources.filter((s) => s.recon).length).toBe(1);
  });

  it("carries a ghost Boom never read, and says so in the select", () => {
    const [ghost] = ghostStatements([
      { fileId: "f9", fileName: "management-accounts.xlsx", pre: preRead(INCOME_LINES) },
    ]);
    const balanceOnly = BOOM.filter((s) => s.statementType === "balance_sheet");
    const sources = registerSources({ statements: balanceOnly, ghost: [ghost], adjusted: false });
    expect(sources.map((s) => s.label)).toEqual(["Balance sheet", "Income statement (not read by Boom)"]);
    expect(sources[1].lit).toBe(false);
  });

  it("is Boom's own list, unchanged, where there is no ghost at all", () => {
    const sources = registerSources({ statements: BOOM, adjusted: false });
    expect(sources.map((s) => s.label)).toEqual(["Income statement", "Balance sheet", "Cash flow"]);
    expect(sources.every((s) => s.ghost === null && s.recon === null)).toBe(true);
    const rows = sourceRows(sources[0]);
    expect(rows).toHaveLength(registerStatements(BOOM, { adjusted: false })[0].rows.length);
  });
});
