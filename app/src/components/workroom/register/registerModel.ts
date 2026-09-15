/* =============================================================================
   THE STATEMENT REGISTER, AS PURE FUNCTIONS.

   Everything the register draws is derived here and nowhere else, so a cell, a
   column header and the line under the controls can never disagree about the
   same figure. Ported from Noland's Boom MCP widget (boom-mcp/src/workspace.js
   `familyOf` / `shapeStatements`, boom-mcp/widget/workspace.html `money`,
   `varianceCells`) onto the cockpit's own `BoomFinancialStatement` shape.

   WHAT WAS PORTED AND WHAT WAS NOT.
     ported   the eleven account-code chip families and their abbreviations, the
              statement order, the variance pair and its "n/m" honesty, the unit
              scale, the per-period coverage mark.
     changed  negatives read with a leading minus, never parentheses and never
              red (cockpit rule: status colour is reserved for state).
     changed  flipSign is APPLIED. Boom sends "Provision for Income Taxes" as
              +427,000 on `periodValues` and -427,000 on its own
              `aggregatedFinancials`, and `flipSign: true` is the marker that
              tells the two apart. Applying it is what makes the column foot.
     dropped  the row letters (A, B, C) and the derived metric set: the room
              already carries the figures, and a second copy of them here would
              be the same fact twice.
   ============================================================================= */

import type { BoomFinancialStatement, BoomRatioSupportLine, StatementType } from "../../../spread/types";

/** The unit scale the banker reads the grid at. */
export type Unit = "full" | "k" | "m";

/** The account-code chip families, Boom's own product language. */
export type ChipFamily = "ca" | "cl" | "lta" | "ltl" | "eq" | "rev" | "exp" | "tot" | "none";

/** One line of `boom_get_ratios` `support.lines`, the lane's own shape: which
 *  spread line fed which figure. */
export type RatioSupportLine = BoomRatioSupportLine;

export interface RegisterPeriod {
  id: string;
  endDate: string | null;
  /** "FY2025" for an annual period, the bare end date for anything else. */
  label: string;
}

export interface RegisterRow {
  id: string;
  name: string;
  hierarchy: "header" | "line_item" | "subtotal" | "total";
  code: string | null;
  family: ChipFamily;
  abbr: string;
  /** A line item Boom placed no account code on, so it is outside Boom's aggregate. */
  mismapped: boolean;
  /** One per period of the statement, in the statement's own period order. */
  values: Array<number | null>;
  /** The headline figures this line feeds, from the ratios' support lines. */
  feeds: string[];
}

export interface RegisterStatement {
  id: string;
  type: StatementType;
  label: string;
  validated: boolean;
  periods: RegisterPeriod[];
  rows: RegisterRow[];
  /** Lines carrying a Boom account code, over the lines that could carry one. */
  mapped: number;
  mappable: number;
}

/* ------------------------------------------------------------- the families */

const FAMILY_BY_CODE = new Map<string, ChipFamily>(
  (
    Object.entries({
      ca: [
        "cash_and_equivalents", "cash", "accounts_receivable_trade", "accounts_receivable",
        "total_inventory", "inventory", "other_current_assets", "prepaid_and_other_current_assets",
        "total_current_assets",
      ],
      lta: ["ppe_machinery", "ppe_net", "other_non_current_assets", "other_lt_assets", "goodwill"],
      cl: [
        "accounts_payable_trade", "accounts_payable", "st_loans_payable_bank", "other_accruals",
        "accrued_expenses", "current_portion_ltd", "total_current_liabilities",
      ],
      ltl: ["long_term_debt_bank", "long_term_debt", "operating_current_liabilities", "total_debt"],
      eq: ["total_equity"],
      rev: ["net_sales_revenue", "sales_revenue", "other_income"],
      exp: [
        "cost_of_sales", "total_operating_expenses", "selling_marketing_expense",
        "general_and_admin_expenses", "interest_expense", "current_income_tax", "income_tax_expense",
        "depreciation_amortization",
      ],
      tot: [
        "gross_profit", "operating_profit", "adjusted_ebitda", "profit_before_taxes", "pretax_income",
        "net_income", "total_assets", "total_liabilities", "total_liabilities_and_equity",
      ],
    }) as Array<[ChipFamily, string[]]>
  ).flatMap(([fam, codes]) => codes.map((c) => [c, fam] as [string, ChipFamily])),
);

const FAMILY_BY_KEYWORD: Array<[RegExp, ChipFamily]> = [
  [/^(net_)?cash|receivab|inventor|prepaid|current_asset/, "ca"],
  [/ppe|goodwill|intangible|lt_asset|non_current_asset/, "lta"],
  [/payable|accrued|accrual|current_portion|current_liab/, "cl"],
  [/long_term_debt|lt_debt|capital_lease|subordinated|total_debt/, "ltl"],
  [/equity|retained|common_stock|paid_in/, "eq"],
  [/revenue|sales/, "rev"],
  [/cost_of|expense|tax|interest|depreciat|amortiz/, "exp"],
];

const ABBR: Record<ChipFamily, string> = {
  ca: "CA", cl: "CL", lta: "LTA", ltl: "LTL", eq: "EQ",
  rev: "REV", exp: "EXP", tot: "TOT", none: "NONE",
};

/** The chip family of a Boom account code: exact code first, hierarchy second,
 *  keyword last. An unmapped line is its own deliberately mute state. */
export function chipFamily(code: string | null | undefined, hierarchy?: string): ChipFamily {
  if (!code) return "none";
  const exact = FAMILY_BY_CODE.get(code);
  if (exact) return exact;
  if (hierarchy === "total" || hierarchy === "subtotal") return "tot";
  for (const [re, fam] of FAMILY_BY_KEYWORD) if (re.test(code)) return fam;
  return "tot";
}

export function chipAbbr(family: ChipFamily): string {
  return ABBR[family];
}

/* ------------------------------------------------------------- the periods */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** The cockpit's own period label (client-360/render/boom-normalise.mjs): a
 *  fiscal year only where the period is annual, because "FY2025" over a quarter
 *  asserts a period the spread does not carry. */
export function periodLabel(endDate: string | null | undefined, periodType?: string | null): string {
  const s = String(endDate ?? "");
  if (!ISO_DAY.test(s)) return s;
  const annual = periodType == null || periodType === "annual";
  return annual ? `FY${s.slice(0, 4)}` : s.slice(0, 10);
}

/** Oldest left, newest right. Boom returns the live payload newest first, which
 *  is the opposite of the way a spreadsheet reads. */
export function periodsSorted(statement: BoomFinancialStatement): RegisterPeriod[] {
  return (statement.periods ?? [])
    .map((p) => ({ id: p.id, endDate: p.endDate ?? null, label: periodLabel(p.endDate, p.periodType) }))
    .sort((a, b) => String(a.endDate ?? a.id).localeCompare(String(b.endDate ?? b.id)));
}

/** The room's own convention: `newPeriodEnd` can arrive as a fiscal label or as
 *  a raw end date, and both have to mark the same column. */
export function isNewPeriod(endDate: string | null | undefined, newPeriodEnd: string | null | undefined): boolean {
  if (!endDate || !newPeriodEnd) return false;
  return endDate === newPeriodEnd || `FY${String(endDate).slice(0, 4)}` === newPeriodEnd;
}

/* -------------------------------------------------------------- the values */

type LineItem = BoomFinancialStatement["lineItems"][number];

/** Adjusted reads Boom's analyst-allowed figure and falls back to the figure as
 *  given; as-given reads `periodValues` and nothing else. */
export function pickValue(line: LineItem, periodId: string, adjusted: boolean): number | null {
  if (adjusted) {
    const adj = line.adjustedPeriodValues?.[periodId];
    if (adj) return adj.asAllowed ?? adj.asGiven ?? null;
  }
  return line.periodValues?.[periodId] ?? null;
}

/** Boom flags the lines whose printed sign is not the sign its own aggregate
 *  carries. Applying the flag is what makes a column foot. */
export function applyFlipSign(value: number | null, flipSign: boolean | undefined): number | null {
  if (value == null || !flipSign) return value;
  return value === 0 ? 0 : -value;
}

/* ------------------------------------------------------------ the variance */

/** Newest minus prior. Null where either side is missing. */
export function variance(latest: number | null, prior: number | null): number | null {
  if (latest == null || prior == null) return null;
  return latest - prior;
}

/** Noland's rule, kept exactly: a percentage on a zero or negative base is not
 *  meaningful, and saying so is the honest answer where a made-up figure is not. */
export function variancePct(latest: number | null, prior: number | null): number | null {
  const v = variance(latest, prior);
  if (v == null || prior == null || prior <= 0) return null;
  return (v / prior) * 100;
}

export const NOT_MEANINGFUL = "n/m";

/** The two variance cells as the grid prints them. */
export function varianceText(latest: number | null, prior: number | null, unit: Unit): { value: string; pct: string } {
  const v = variance(latest, prior);
  if (v == null) return { value: "", pct: "" };
  const pct = variancePct(latest, prior);
  return {
    value: fmtCell(v, unit),
    pct: pct == null ? NOT_MEANINGFUL : `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(1)}%`,
  };
}

/* -------------------------------------------------------------- the coverage */

/** A period is covered where every rendered line carries a figure for it.
 *  Headers carry no figure by construction and are not counted. */
export function coverage(rows: RegisterRow[], periodCount: number): boolean[] {
  const body = rows.filter((r) => r.hierarchy !== "header");
  return Array.from({ length: periodCount }, (_, i) => body.length > 0 && body.every((r) => r.values[i] != null));
}

/* ----------------------------------------------------------------- the units */

const SCALE: Record<Unit, { div: number; dp: number; cap: string }> = {
  full: { div: 1, dp: 0, cap: "$ in dollars" },
  k: { div: 1e3, dp: 0, cap: "$ in thousands" },
  m: { div: 1e6, dp: 1, cap: "$ in millions" },
};

export function unitCaption(unit: Unit): string {
  return SCALE[unit].cap;
}

export function scaleValue(value: number, unit: Unit): number {
  return value / SCALE[unit].div;
}

/** Tabular, thousands separated, a LEADING MINUS and never parentheses (the
 *  cockpit's own accounting voice). An absent figure is an empty cell, because
 *  a dash in a money column reads as a value. */
export function fmtCell(value: number | null | undefined, unit: Unit): string {
  if (value == null) return "";
  const u = SCALE[unit];
  const n = scaleValue(value, unit);
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: u.dp,
    maximumFractionDigits: u.dp,
  });
  /* -0.0 is not a figure a banker ever wrote. */
  return Number(n.toFixed(u.dp)) < 0 ? `-${body}` : body;
}

/* --------------------------------------------------------------- the support */

/* THE MARKER LANDS ON THE LINES A BANKER ACTS ON, AND ON NO OTHERS (gate note
   (a), 2026-09-15). Boom's `support.lines` names every input it struck a figure
   from, cost of sales, gross profit and operating expenses included, and a
   marker on ten of eleven rows is decoration rather than a finding. What earns
   one is a line behind a HEADLINE ratio: revenue and its prior read, operating
   income, interest expense, D and A (which is what makes EBITDA), and the debt
   lines that make leverage. Anything else Boom cites is left unmarked, and the
   grid carries it as the line it is. */
const HEADLINE_FIGURE: Record<string, string> = {
  revenue: "revenue",
  /* The prior-period read of the same line is the same figure. */
  revenuePrior: "revenue",
  operatingIncome: "operating income",
  interestExpense: "interest expense",
  depreciationAmortization: "D and A",
  totalDebt: "total debt",
};

/** Which headline figures each spread line feeds, keyed by statement and by the
 *  account code where Boom gave one, by name where it did not. The register
 *  names the figure and never prints its value: the room already carries it. */
export function supportIndex(lines: RatioSupportLine[] | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of lines ?? []) {
    const word = HEADLINE_FIGURE[l.figure];
    if (!word) continue;
    const key = `${l.statement}|${l.accountCode ?? l.name}`;
    const at = out.get(key);
    if (!at) out.set(key, [word]);
    else if (!at.includes(word)) at.push(word);
  }
  return out;
}

/* ------------------------------------------------------------ the statements */

const LABEL: Partial<Record<StatementType, string>> = {
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow_statement: "Cash flow",
};
const ORDER: StatementType[] = ["income_statement", "balance_sheet", "cash_flow_statement"];

/** Boom's own statement-level title row, "Income Statement [Abstract]": XBRL's
 *  abstract element, carried through as a header with no figure under it on any
 *  period. The register is already titled by the statement select, so the row is
 *  DROPPED (gate note (b), 2026-09-15). A real section header, "Assets" or
 *  "Cash Flows from Operating Activities", is kept: it tells a banker where they
 *  are in the statement. */
export function isAbstractHeader(row: { name: string; hierarchy: string }): boolean {
  return row.hierarchy === "header" && /\[Abstract\]\s*$/.test(row.name);
}

/** The file's statements, in a banker's reading order, shaped for the grid.
 *  Only the three the register draws; a shareholders-equity or personal
 *  statement is carried by the file and is not this surface's business. */
export function registerStatements(
  statements: BoomFinancialStatement[] | null | undefined,
  opts: { adjusted: boolean; support?: RatioSupportLine[] | null },
): RegisterStatement[] {
  const support = supportIndex(opts.support);
  return (statements ?? [])
    .filter((s) => LABEL[s.statementType])
    .map((s) => {
      const periods = periodsSorted(s);
      const rows: RegisterRow[] = (s.lineItems ?? [])
        .map((li) => {
          const hierarchy = (li.hierarchy ?? "line_item") as RegisterRow["hierarchy"];
          const code = li.accountCode || null;
          const family = chipFamily(code, hierarchy);
          return {
            id: li.id,
            name: li.name,
            hierarchy,
            code,
            family,
            abbr: chipAbbr(family),
            mismapped: !code && hierarchy === "line_item",
            values: periods.map((p) => applyFlipSign(pickValue(li, p.id, opts.adjusted), li.flipSign)),
            feeds: support.get(`${s.statementType}|${code ?? li.name}`) ?? [],
          };
        })
        .filter((r) => !isAbstractHeader(r));
      const body = rows.filter((r) => r.hierarchy !== "header");
      return {
        id: s.id,
        type: s.statementType,
        label: LABEL[s.statementType] as string,
        validated: s.validationStatus === "validated",
        periods,
        rows,
        mapped: body.filter((r) => r.code).length,
        mappable: body.length,
      };
    })
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

/** "13 of 13 lines carry a Boom account code". */
export function codeCoverageLine(mapped: number, mappable: number): string {
  return `${mapped} of ${mappable} lines carry a Boom account code`;
}

export const VALIDATED = "Validated in Boom";
export const NOT_VALIDATED = "Not validated in Boom";
