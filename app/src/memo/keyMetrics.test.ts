/* =============================================================================
   THE KEY METRICS TABLE — one column per period the book carries, and every
   figure in the column it was measured in.

   FOUNDER REPORT (Fabian, 2026-09-13, memo opened in the cockpit): the table
   rendered one "as of" ratio set repeated across the period columns and stamped
   "(unchanged)", which reads as four flat years on a borrower whose real Boom
   file carries three different revenues; and its rows mixed source systems
   inside one row, with nCino's last covenant test printed in a fiscal column
   next to Boom spread figures.

   FOUR THINGS THE RENDERER DID, none of them a dossier field:

     THE PRO FORMA COLUMN was printed on every memo, and its Revenue and
     Adjusted EBITDA cells REPEATED the latest fiscal column with "(unchanged)"
     beside them. A memo with no executed step has no pro forma to state.

     THE AXIS WAS CAPPED at three columns (`periodsArr.slice(-3)`), so Hartwell's
     FY2023 fell off the table with nothing saying it had.

     DEBT SERVICE COVERAGE, which is nCino's last covenant test on the
     covenant's own evaluation date, was printed in the LAST FISCAL COLUMN.

     THREE WORDS FOR ONE ABSENCE in one table: "flagged for RM" in a measured
     cell, "not modeled" in a pro forma one, and the doctrine marker written in
     by the seam's `pro_forma_leverage` entry.

   AND ONE THING THAT WAS a dossier field: `series()` in dossier.ts took the
   first line item matching an account code OR a name regex, and Boom names the
   short-term line "Line of Credit and Current Portion of Long-Term Debt". The
   long-term fallback regex matched it, above the real long-term line, so total
   debt double-counted the short-term balance and dropped the long-term one.
   Piedmont FY2025 read $11.35M against a real $20.13M, and the memo printed
   leverage of 2.17x in Key Metrics while the Executive Summary printed Boom's
   own 3.85x for the same as of period.

   THIS FILE IS THE RULE, AS A TEST. Both relationships in `live-data.json` (one
   with a raw Boom file, one with a display-only book), both of the room's
   triggers, rendered and parsed back out of the HTML.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle } from "../data/contract";
import { buildMemoDossier } from "./dossier";
import { applyMemoOverrides, keyMetricsFrom, proFormaLeverageFrom } from "./overrides";
import { renderMemo } from "./renderMemo";
import { NOT_IN_SOURCE, type MemoChange, type MemoDossier } from "./types";

const borrowers = live.borrowers as unknown as Record<string, BorrowerBundle>;
const HARTWELL = borrowers["001bb00001I7FPNAA3"];
const PIEDMONT = borrowers["001bb00001DLtRMAA1"];

/** Hartwell's executed steps, as the trail hands them over. */
const HARTWELL_CHANGES: MemoChange[] = [
  {
    id: "write_loan",
    label: "Increase the line of credit to $15.0M",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb0000027MaYEAU", name: "Line of Credit" },
    before: { commitment: 12_000_000 },
    after: { commitment: 15_000_000 },
    orgId: "a4Zbb0000027MaYEAU",
  },
  {
    id: "write_loan_2",
    label: "Book the equipment term loan",
    target: { kind: "LLC_BI__Loan__c", id: "a4Zbb000002CECXEA4", name: "Equipment" },
    after: { commitment: 3_000_000 },
    orgId: "a4Zbb000002CECXEA4",
  },
];

/** Piedmont's. One step, and it moves a commitment. */
const PIEDMONT_CHANGES: MemoChange[] = [
  {
    id: "step-1",
    label: "Increase the $5.0M revolver to $7.5M",
    target: { kind: "facility", id: "a4Zbb000001zEQTEA2", name: "Line of Credit" },
    before: { commitment: 5_000_000, outstanding: 4_250_000, maturity: "2026-07-15" },
    after: { commitment: 7_500_000, outstanding: 4_250_000, maturity: "2027-07-15" },
    orgId: "a4Zbb000001zEQTEA2",
  },
];

/* -----------------------------------------------------------------------------
   THE FOUR MEMOS, and the table parsed back out of each one.
   ----------------------------------------------------------------------------- */

interface Row {
  label: string;
  cells: string[];
}
interface Table {
  /** Every header after "Metric", in order. */
  columns: string[];
  /** The fiscal headers: every column but the pro forma one. */
  fiscal: string[];
  rows: Row[];
  /** The legend lines printed under the table, in order. */
  notes: string[];
  /** The table and its notes, verbatim. */
  html: string;
}

interface Case {
  name: string;
  bundle: "Hartwell" | "Piedmont";
  trigger: "adhoc" | "modify";
  changes: MemoChange[];
  dossier: MemoDossier;
  html: string;
  table: Table;
}

const PRO_FORMA = "Pro forma";
const GAP = "flagged for RM";
/** The leverage row label, with the division sign written as an escape. */
const LEVERAGE = "Debt \u00f7 EBITDA";

/** Tags out, the four entities the renderer escapes back in, whitespace squeezed. */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The Key Metrics table, read back off the rendered memo.
 *
 * `<th>Metric</th>` appears exactly once in the whole document, which is what
 * makes this anchor safe and what the gap audit already relies on.
 */
function parseTable(html: string): Table {
  const block =
    /<table><thead><tr><th>Metric<\/th>([\s\S]*?)<\/tr><\/thead><tbody>([\s\S]*?)<\/tbody><\/table>((?:\s*<div class="legend">[\s\S]*?<\/div>)*)/.exec(
      html,
    );
  if (!block) throw new Error("no Key Metrics table in the rendered memo");
  const columns = [...block[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textOf(m[1]));
  const rows = [...block[2].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) => {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
    return { label: cells[0], cells: cells.slice(1) };
  });
  const notes = [...block[3].matchAll(/<div class="legend">([\s\S]*?)<\/div>/g)].map((m) => textOf(m[1]));
  return { columns, fiscal: columns.filter((c) => c !== PRO_FORMA), rows, notes, html: block[0] };
}

const caseFor = (bundle: "Hartwell" | "Piedmont", trigger: "adhoc" | "modify"): Case => {
  const b = bundle === "Hartwell" ? HARTWELL : PIEDMONT;
  const changes = trigger === "adhoc" ? [] : bundle === "Hartwell" ? HARTWELL_CHANGES : PIEDMONT_CHANGES;
  const dossier = buildMemoDossier({
    bundle: b,
    changes,
    instanceUrl: live.meta.instanceUrl,
    productPackageName: `${b.snapshot.name} credit package`,
    creditEvent: "existing_material",
  });
  // Exactly what `MemoRoom` hands the seam for this table.
  const html = applyMemoOverrides(renderMemo(dossier).html, {
    proFormaLeverage: proFormaLeverageFrom(dossier),
    keyMetrics: keyMetricsFrom(dossier, changes),
  });
  return { name: `${bundle} ${trigger}`, bundle, trigger, changes, dossier, html, table: parseTable(html) };
};

const CASES: Case[] = [
  caseFor("Piedmont", "adhoc"),
  caseFor("Piedmont", "modify"),
  caseFor("Hartwell", "adhoc"),
  caseFor("Hartwell", "modify"),
];

const rowOf = (t: Table, label: string): Row => {
  const r = t.rows.find((x) => x.label === label);
  if (!r) throw new Error(`no "${label}" row in the Key Metrics table`);
  return r;
};
/** The fiscal cells of a row: everything but the pro forma column. */
const fiscalCells = (t: Table, label: string): string[] => rowOf(t, label).cells.slice(0, t.fiscal.length);
const stated = (cells: string[]): string[] => cells.filter((c) => c !== GAP);

/* -----------------------------------------------------------------------------
   THE COLUMNS
   ----------------------------------------------------------------------------- */

describe("the period axis is the book's own", () => {
  it.each(CASES)("$name: one column per period the spread carries, oldest to newest", (c) => {
    expect(c.table.fiscal).toEqual(c.dossier.canon.spread.periods);
    expect(new Set(c.table.fiscal).size).toBe(c.table.fiscal.length);
    expect(c.table.fiscal.length).toBeGreaterThan(1);
  });

  it("keeps the fourth period the renderer's three-column cap dropped", () => {
    // Hartwell's display book carries FY2023, FY2024, FY2025 and LTM. The
    // renderer printed the last three; the book's own axis is all four.
    const hartwell = CASES.filter((c) => c.bundle === "Hartwell");
    for (const c of hartwell) expect(c.table.fiscal).toEqual(["FY2023", "FY2024", "FY2025", "LTM"]);
    // And Piedmont's raw Boom file carries exactly the three it carries.
    for (const c of CASES.filter((x) => x.bundle === "Piedmont")) {
      expect(c.table.fiscal).toEqual(["FY2023", "FY2024", "FY2025"]);
    }
  });

  it.each(CASES)("$name: no two columns carry the same figures in every row", (c) => {
    // No two source periods on either book are identical, so two identical
    // columns can only mean one period's figures were repeated into another.
    const columns = c.table.columns.map((label, i) => `${label}: ${c.table.rows.map((r) => r.cells[i]).join(" | ")}`);
    const figures = columns.map((s) => s.slice(s.indexOf(": ")));
    expect(new Set(figures).size).toBe(figures.length);
  });
});

/* -----------------------------------------------------------------------------
   THE ROWS
   ----------------------------------------------------------------------------- */

describe("revenue is read per period", () => {
  it("differs across FY2023, FY2024 and FY2025 for Piedmont, as the Boom file does", () => {
    for (const c of CASES.filter((x) => x.bundle === "Piedmont")) {
      expect(fiscalCells(c.table, "Revenue")).toEqual(["$56.3M", "$59.9M", "$64.5M"]);
    }
  });

  it("differs across every period Hartwell's book carries", () => {
    for (const c of CASES.filter((x) => x.bundle === "Hartwell")) {
      const cells = fiscalCells(c.table, "Revenue");
      expect(cells).toEqual(["$52.4M", "$58.9M", "$63.8M", "$64.2M"]);
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it.each(CASES)("$name: every stated revenue traces to the spread's own line", (c) => {
    const series = c.dossier.canon.spread.incomeStatement.sales_revenue;
    c.table.fiscal.forEach((p, i) => {
      const v = series?.[p];
      const cell = rowOf(c.table, "Revenue").cells[i];
      if (v == null) expect(cell).toBe(GAP);
      else expect(cell).toBe(`$${(v / 1e6).toFixed(1)}M`);
    });
  });
});

describe("the ratio set is stated in the one period it was measured in", () => {
  it.each(CASES)("$name: Adjusted EBITDA appears in exactly one fiscal column", (c) => {
    expect(stated(fiscalCells(c.table, "Adjusted EBITDA"))).toHaveLength(1);
  });

  it.each(CASES)("$name: and that column is the one the ratios name", (c) => {
    const period = c.dossier.canon.ratios?.period;
    expect(period).toBeTruthy();
    const i = c.table.fiscal.indexOf(period as string);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(fiscalCells(c.table, "Adjusted EBITDA")[i]).not.toBe(GAP);
    expect(fiscalCells(c.table, LEVERAGE)[i]).not.toBe(GAP);
  });

  it.each(CASES)("$name: leverage appears in exactly one fiscal column too", (c) => {
    expect(stated(fiscalCells(c.table, LEVERAGE))).toHaveLength(1);
  });

  it("prints Boom's own leverage, not a second one computed from a mis-picked debt line", () => {
    // THE REGRESSION. `series()` matched the short-term line by name for the
    // long-term series, so total debt was $11.35M and the table said 2.17x while
    // the Executive Summary said 3.85x off the same ratio set.
    for (const c of CASES.filter((x) => x.bundle === "Piedmont")) {
      const bs = c.dossier.canon.spread.balanceSheet;
      expect(bs.total_debt?.FY2025).toBe(20_130_000);
      expect(bs.total_debt?.FY2025).toBe(c.dossier.canon.ratios?.totalDebt);
      expect(stated(fiscalCells(c.table, LEVERAGE))).toEqual(["3.85x"]);
      expect(c.table.html).not.toContain("2.17x");
    }
  });
});

describe("debt service coverage is never in a fiscal column", () => {
  it.each(CASES)("$name: the row is marked in every column", (c) => {
    expect(stated(rowOf(c.table, "Debt Service Coverage").cells)).toHaveLength(0);
  });

  it.each(CASES)("$name: and the covenant test is stated under the table, on its own date", (c) => {
    const cov = (c.dossier.ic?.covenantCompliance ?? []).find((x) => /debt service/i.test(x.name));
    expect(cov?.actual).toBeTruthy();
    const note = c.table.notes.find((n) => n.startsWith(cov!.name));
    expect(note).toBeTruthy();
    expect(note).toContain(`${cov!.actual!.toFixed(2)}x`);
    expect(note).toContain("as nCino last tested it");
    // The date in the footnote is the covenant's OWN last evaluation date, which
    // is the fact the fiscal column could not carry.
    const [y, m, d] = String(cov!.quarters?.[0]).split("-");
    expect(note).toContain(`${y}`);
    expect(note).toContain(`${Number(d)},`);
    expect(Number(m)).toBeGreaterThan(0);
  });
});

describe("cash and free cash flow are read per period, or marked", () => {
  it.each(CASES)("$name: every stated cell traces to a balance sheet or a cash-flow line", (c) => {
    const bs = c.dossier.canon.spread.balanceSheet;
    const cf = c.dossier.canon.spread.cashFlow;
    c.table.fiscal.forEach((p, i) => {
      const cash = bs.cash_and_equivalents?.[p];
      expect(rowOf(c.table, "Cash & Equivalents").cells[i]).toBe(
        cash == null ? GAP : `$${(cash / 1e6).toFixed(1)}M`,
      );
      const ocf = cf.operating_cash_flow?.[p];
      const capex = cf.capital_expenditures?.[p];
      const fcf = ocf == null || capex == null ? null : ocf + capex;
      expect(rowOf(c.table, "Free Cash Flow").cells[i]).toBe(fcf == null ? GAP : `$${(fcf / 1e6).toFixed(1)}M`);
    });
  });

  it("marks them on a display-only book rather than deriving them", () => {
    // Hartwell's book carries no balance sheet and no cash-flow statement.
    for (const c of CASES.filter((x) => x.bundle === "Hartwell")) {
      expect(stated(rowOf(c.table, "Cash & Equivalents").cells)).toHaveLength(0);
      expect(stated(rowOf(c.table, "Free Cash Flow").cells)).toHaveLength(0);
    }
  });
});

/* -----------------------------------------------------------------------------
   THE PRO FORMA COLUMN
   ----------------------------------------------------------------------------- */

describe("the pro forma column", () => {
  it("is not printed at all on a memo with no executed step", () => {
    for (const c of CASES.filter((x) => x.trigger === "adhoc")) {
      expect(c.table.columns).not.toContain(PRO_FORMA);
      expect(c.table.columns).toEqual(c.dossier.canon.spread.periods);
    }
  });

  it("is printed, last, where a step moved a commitment", () => {
    for (const c of CASES.filter((x) => x.trigger === "modify")) {
      expect(c.table.columns[c.table.columns.length - 1]).toBe(PRO_FORMA);
      expect(c.table.columns.filter((x) => x === PRO_FORMA)).toHaveLength(1);
    }
  });

  it("carries only the leverage the step supports, and marks every other cell", () => {
    const piedmont = CASES.find((c) => c.bundle === "Piedmont" && c.trigger === "modify")!;
    const last = (label: string) => rowOf(piedmont.table, label).cells[piedmont.table.columns.length - 1];
    // ($20.13M total debt + $2.5M of new commitment) over $5.234M adjusted EBITDA.
    expect(last(LEVERAGE)).toBe("4.32x");
    for (const label of ["Revenue", "Adjusted EBITDA", "Cash & Equivalents", "Free Cash Flow", "Debt Service Coverage"]) {
      expect(last(label)).toBe(GAP);
    }
  });

  it("marks the whole column where the book carries no balance sheet to compute it from", () => {
    const hartwell = CASES.find((c) => c.bundle === "Hartwell" && c.trigger === "modify")!;
    const i = hartwell.table.columns.length - 1;
    for (const row of hartwell.table.rows) expect(row.cells[i]).toBe(GAP);
    expect(hartwell.table.notes.some((n) => n.includes("no balance sheet"))).toBe(true);
  });
});

/* -----------------------------------------------------------------------------
   ONE VOCABULARY, AND NOTHING ESTIMATED
   ----------------------------------------------------------------------------- */

describe("the table says one thing when it has nothing to say", () => {
  it.each(CASES)('$name: "(unchanged)" appears nowhere in the memo', (c) => {
    // The only two places the renderer wrote it were the Revenue and Adjusted
    // EBITDA pro forma cells of this table.
    expect(c.html).not.toContain("(unchanged)");
  });

  it.each(CASES)('$name: "not modeled" appears nowhere, so it cannot share a row with a marker', (c) => {
    expect(c.html).not.toContain("not modeled");
    expect(c.table.html).not.toContain(NOT_IN_SOURCE);
  });

  it.each(CASES)("$name: every empty cell in the table reads the same way", (c) => {
    const vocab = new Set(c.table.rows.flatMap((r) => r.cells).filter((v) => !/^[$\d-]/.test(v)));
    expect([...vocab]).toEqual([GAP]);
  });

  it.each(CASES)("$name: the notes name the source of every row and claim no estimate", (c) => {
    const notes = c.table.notes.join(" ");
    expect(notes).toContain("Boom spread");
    expect(notes).toContain("Nothing in this table is estimated");
    // Banker-facing prose carries no em dash (founder's standing style rule).
    expect(c.table.html).not.toContain("—");
  });
});
