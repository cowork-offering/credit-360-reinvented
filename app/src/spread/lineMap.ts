/* =============================================================================
   THE LINES ON THE PAGE, PLACED ON BOOM'S CHART, WITH NO MODEL IN THE PATH.

   Boom classifies, extracts and maps, and this layer does not replace it. What
   this module does is read the rows a statement actually prints, so that the
   room has something to show, the provisional read has something to compute
   from, and the stub that STANDS IN for Boom has something to spread. A spread
   that dies whenever the session door is absent or answers with junk is not a
   spread a banker can stand behind on a Monday morning.

   PURE AND DETERMINISTIC. Characters in, lines out. No model, no I/O, no clock,
   no state. Everything here can be held to a fixture.

   THE RULES THAT SHAPE IT.
     A FIGURE IS WHAT THE STATEMENT PRINTS. Thousands separators, a currency
     mark and parentheses-for-negative are read; a dash is an explicit nothing;
     anything else is not a value and the cell is left alone.
     A CODE IS ONLY EVER ONE BOOM ALREADY CARRIES. The dictionary below maps a
     printed label to a code on {@link BOOM_ACCOUNT_CODES} or to null. A wrong
     code is a wrong figure in the right row, which is worse than an unmapped
     line, so the dictionary is deliberately narrow and anchored.
     A LINE BELONGS TO THE STATEMENT ITS HEADER ANNOUNCED. Where a file prints
     no header the code's own family decides it, and where neither does the
     line is dropped rather than filed under a guess.
     NOTHING IS INVENTED. A row with no figure, a column with no period and a
     label with no letters all produce nothing at all.
   ============================================================================= */

import { detectStatementTypes, periodKey } from "./periods";
import type { ExtractedDocument, PeriodRead, PreReadLine, StatementType } from "./types";

/* ------------------------------------------------------------------ the codes

   Boom's own account codes, as the on-file spread uses them
   (client-360/assets/boom-spread.json). Fourteen of the fifteen appear in that
   file; `total_liabilities` is the one Boom's chart carries that Piedmont's own
   spread happens not to print. Nothing outside this list is ever placed.      */

export const BOOM_ACCOUNT_CODES = [
  "net_sales_revenue",
  "cost_of_sales",
  "gross_profit",
  "operating_expenses",
  "operating_profit",
  "interest_expense",
  "net_income",
  "cash_and_equivalents",
  "accounts_receivable_trade",
  "total_inventory",
  "total_assets",
  "total_liabilities",
  "st_loans_payable_bank",
  "long_term_debt_bank",
  "total_equity",
] as const;

export type BoomAccountCode = (typeof BOOM_ACCOUNT_CODES)[number];

/** Which statement a code belongs on, where no header said. Depreciation and
 *  amortisation is deliberately absent from the chart entirely: Boom has no
 *  code for it and both ratio layers find that row by name. */
const INCOME_CODES: readonly string[] = [
  "net_sales_revenue",
  "cost_of_sales",
  "gross_profit",
  "operating_expenses",
  "operating_profit",
  "interest_expense",
  "net_income",
];

/* --------------------------------------------------------- the dictionary

   THE SYNONYMS A COMMERCIAL STATEMENT ACTUALLY PRINTS, anchored end to end so a
   phrase that merely CONTAINS one of them never matches: "gain on sale of
   equipment" is not "net sales", and "interest expense on subordinated notes"
   is a different row from "interest expense". First match wins; the list reads
   top to bottom in the order a statement does.                               */

const DICTIONARY: Array<{ code: BoomAccountCode; re: RegExp }> = [
  { code: "net_sales_revenue", re: /^(?:net |gross |total )?sales(?: revenue)?(?:,? net)?$/ },
  { code: "net_sales_revenue", re: /^(?:total |net |operating )?revenues?(?:,? net)?$/ },
  { code: "net_sales_revenue", re: /^(?:total )?net (?:sales|revenues?)$/ },
  { code: "net_sales_revenue", re: /^(?:net )?sales and revenues?$/ },

  { code: "cost_of_sales", re: /^cost of (?:sales|goods sold|revenues?|sales and services)$/ },
  { code: "cost_of_sales", re: /^cogs$/ },

  { code: "gross_profit", re: /^gross (?:profit|margin)$/ },

  { code: "operating_expenses", re: /^(?:total )?operating expenses$/ },
  { code: "operating_expenses", re: /^sg ?& ?a(?: expenses)?$/ },
  { code: "operating_expenses", re: /^selling,? general and administrative(?: expenses)?$/ },

  { code: "operating_profit", re: /^(?:income|profit|earnings|loss) from operations$/ },
  { code: "operating_profit", re: /^operating (?:income|profit|earnings)$/ },
  { code: "operating_profit", re: /^ebit$/ },

  { code: "interest_expense", re: /^interest(?: and debt)? expense(?:,? net)?$/ },

  { code: "net_income", re: /^net (?:income|profit|earnings)$/ },

  { code: "cash_and_equivalents", re: /^cash$/ },
  { code: "cash_and_equivalents", re: /^cash and (?:cash )?equivalents$/ },
  { code: "cash_and_equivalents", re: /^cash and short-? ?term investments$/ },

  { code: "accounts_receivable_trade", re: /^(?:trade )?accounts receivable(?:,? (?:net|trade))?$/ },
  { code: "accounts_receivable_trade", re: /^trade receivables(?:,? net)?$/ },
  { code: "accounts_receivable_trade", re: /^receivables,? net$/ },

  { code: "total_inventory", re: /^(?:total )?inventor(?:y|ies)(?:,? net)?$/ },

  { code: "total_assets", re: /^total assets$/ },
  { code: "total_liabilities", re: /^total liabilities$/ },

  { code: "st_loans_payable_bank", re: /^line of credit(?: and current portion of (?:ltd|long-? ?term debt))?$/ },
  { code: "st_loans_payable_bank", re: /^revolving (?:line of )?credit$/ },
  { code: "st_loans_payable_bank", re: /^short-? ?term (?:debt|borrowings|loans payable|notes payable)$/ },
  { code: "st_loans_payable_bank", re: /^current portion of long-? ?term debt$/ },
  { code: "st_loans_payable_bank", re: /^notes payable,? current$/ },

  { code: "long_term_debt_bank", re: /^long-? ?term debt(?:,? (?:net of current portion|less current portion|net))?$/ },
  { code: "long_term_debt_bank", re: /^(?:bank debt|term loan)$/ },
  { code: "long_term_debt_bank", re: /^notes payable,? (?:non-? ?current|long-? ?term)$/ },

  { code: "total_equity", re: /^total (?:stockholders|shareholders|members|partners)'? (?:equity|capital)$/ },
  { code: "total_equity", re: /^(?:stockholders|shareholders)'? equity$/ },
  { code: "total_equity", re: /^total equity$/ },
];

/** A printed label reduced to the words that identify the row: lower case, no
 *  parenthetical ("Net income (loss)"), no note reference, no trailing colon. */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9&',. /-]+/g, " ")
    .replace(/[\s.:,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * THE BOOM ACCOUNT CODE FOR A PRINTED LABEL, or null.
 *
 * Null is the honest answer for every row this dictionary does not recognise,
 * and for every row Boom's chart has no code for at all (depreciation and
 * amortisation, current assets, current liabilities). An unmapped line still
 * travels: it keeps its label, its figures and its place on the statement, and
 * Boom maps it when it spreads.
 */
export function accountCodeFor(label: string): string | null {
  const said = normaliseLabel(label);
  if (!said) return null;
  for (const entry of DICTIONARY) if (entry.re.test(said)) return entry.code;
  return null;
}

/** Fill the codes a read left empty, and NEVER overwrite one it placed. Used on
 *  the model's own lines, where the model is the authority on what it read and
 *  this dictionary is only the floor under it. */
export function mapLineCodes(lines: PreReadLine[]): PreReadLine[] {
  return lines.map((line) => (line.accountCode ? line : { ...line, accountCode: accountCodeFor(line.label) }));
}

/* ------------------------------------------------------------- the figures */

/** A cell as a statement prints it: a number, `null` for a printed dash, and
 *  `undefined` where the cell is not a figure at all. The three are distinct
 *  because a dash is a stated nothing and a word is not a value column. */
export function cellFigure(raw: string): number | null | undefined {
  const said = raw.trim();
  if (!said) return undefined;
  if (/^[-‐-―]+$/.test(said) || /^n\/?a$/i.test(said)) return null;
  const negative = /^\(.*\)$/.test(said);
  const bare = said.replace(/[()]/g, "").replace(/[$£€,\s]/g, "");
  if (!/^-?\d*\.?\d+$/.test(bare)) return undefined;
  const n = Number(bare);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -Math.abs(n) : n;
}

/** A bare four-digit year, which is a column header and never a figure on a
 *  commercial statement (a statement prints $2,025, not 2025). */
const isYearCell = (raw: string): boolean => /^(?:19|20)\d{2}$/.test(raw.trim());

/* ----------------------------------------------------------------- the rows */

/** The grid this document offers. A sheet or a CSV already has cells; a text
 *  layer is split on tabs and on runs of spaces, and failing both the trailing
 *  run of figures is peeled off the end of the line ("Net Sales 71,200 64,486"). */
export function rowsOf(doc: ExtractedDocument): string[][] {
  if (doc.tables.length) return doc.tables.flatMap((t) => t.rows);
  return doc.text
    .split("\n")
    .map((line) => cellsOfLine(line))
    .filter((cells) => cells.length > 0);
}

function cellsOfLine(line: string): string[] {
  const said = line.trim();
  if (!said) return [];
  const split = said.split(/\t|\s{2,}/).map((c) => c.trim()).filter((c) => c !== "");
  if (split.length > 1) return split;

  const tokens = said.split(/\s+/);
  const values: string[] = [];
  while (tokens.length > 1 && cellFigure(tokens[tokens.length - 1]) !== undefined) {
    values.unshift(tokens.pop() as string);
  }
  return values.length ? [tokens.join(" "), ...values] : split;
}

/* -------------------------------------------------------------- the headers */

/** The period a header cell names: a bare year, or a key the text already
 *  produced ("FY2025", "Q2 2026"). Anything else is a label, not a column. */
function periodOfCell(raw: string, periods: PeriodRead[]): string | null {
  const said = raw.trim();
  if (!said) return null;
  if (isYearCell(said)) return periodKey("annual", null, Number(said));
  const spelled = said.replace(/\s+/g, " ").toLowerCase();
  return periods.find((p) => p.key.toLowerCase() === spelled)?.key ?? null;
}

/** The period each column carries, where this row is a column header: at least
 *  one cell names a period, no cell carries a figure that does not, and no
 *  OTHER cell carries a year of its own.
 *
 *  That last rule is what keeps a mis-split line out of the column map. A text
 *  layer prints "For the years ended December 31, 2026 and 2025" as one line,
 *  and peeling the trailing figures off it leaves 2026 stranded inside the
 *  label. Read as a column header it would file the 2026 column under FY2025,
 *  which is a whole year of a borrower's history in the wrong column. A row
 *  that cannot be split cleanly maps no columns, and the positional reading
 *  against the periods the text printed stands instead. */
function periodColumns(cells: string[], periods: PeriodRead[]): Array<string | null> | null {
  const out: Array<string | null> = [];
  let named = 0;
  for (const cell of cells) {
    const key = periodOfCell(cell, periods);
    if (key) {
      named += 1;
      out.push(key);
      continue;
    }
    if (cellFigure(cell) !== undefined) return null;
    if (/\b(?:19|20)\d{2}\b/.test(cell)) return null;
    out.push(null);
  }
  if (!named) return null;
  /* A HEADER THAT PRINTS NO LABEL CELL IS STILL A HEADER OF THE LABELLED ROWS
     UNDER IT. A grid heads its year columns off an empty first cell, so the
     columns line up with the data rows by index. A text layer centres the
     years over the figures and prints nothing at all in the label column, so
     the row arrives as ["2025", "2024"] while every row it heads arrives as
     ["Total assets", "52,000", "50,000"]. Read by index that files FY2025
     under the label and FY2024 under the 2025 figure, which is a borrower's
     whole year in the wrong column. The missing label cell is put back. */
  return out[0] === null ? out : [null, ...out];
}

/** The statement a section header announces: one type named, nothing counted. */
function statementHeader(cells: string[]): StatementType | null {
  if (cells.some((c) => cellFigure(c) !== undefined)) return null;
  const types = detectStatementTypes(cells.join(" "));
  return types.length === 1 ? types[0] : null;
}

/* ------------------------------------------------------------- the assembly */

export interface MappedStatement {
  statementType: StatementType;
  lines: PreReadLine[];
}

function lineFrom(
  cells: string[],
  columns: Array<string | null> | null,
  periods: PeriodRead[],
  unitsMultiplier: number,
): PreReadLine | null {
  const label = cells[0]?.trim() ?? "";
  if (label.length < 2 || !/[a-z]/i.test(label)) return null;

  const found: Array<{ index: number; value: number | null }> = [];
  for (let i = 1; i < cells.length; i += 1) {
    const value = cellFigure(cells[i]);
    if (value === undefined) continue;
    found.push({ index: i, value });
  }
  const numbers = found.filter((f) => f.value !== null);
  if (!numbers.length) return null;
  // A row whose only figures are bare years is the column header of a statement
  // that printed its label in the same cell ("For the years ended December 31,
  // 2026 and 2025"), not a line of it.
  if (numbers.every((f) => isYearCell(cells[f.index]))) return null;

  const values: Record<string, number | null> = {};
  found.forEach((f, ordinal) => {
    const key = columns ? columns[f.index] : (periods[ordinal]?.key ?? null);
    if (!key) return;
    values[key] = f.value === null ? null : f.value * unitsMultiplier;
  });
  if (!Object.keys(values).length) return null;

  const accountCode = accountCodeFor(label);
  return { label, accountCode, values, confidence: accountCode ? "medium" : "low" };
}

/**
 * EVERY LINE THIS DOCUMENT PRINTS, PER STATEMENT, IN THE ORDER IT PRINTS THEM.
 *
 * `periods` is the reading `periods.ts` already made of the same text, so the
 * columns this function assigns and the periods the room shows are one set.
 * Where the document prints its own column header that header decides the
 * order; where it does not, the columns are taken in the order the periods were
 * detected, which is newest first, exactly as a statement prints them.
 *
 * `unitsMultiplier` is applied once, here, so every figure downstream is in
 * absolute currency units and nothing multiplies a second time.
 */
export function deterministicLines(
  doc: ExtractedDocument,
  periods: PeriodRead[],
  unitsMultiplier: number,
): MappedStatement[] {
  const only = detectStatementTypes(doc.text);
  let current: StatementType | null = only.length === 1 ? only[0] : null;
  let columns: Array<string | null> | null = null;

  const byType = new Map<StatementType, PreReadLine[]>();
  for (const cells of rowsOf(doc)) {
    if (!cells.length) continue;

    const header = statementHeader(cells);
    if (header) {
      current = header;
      continue;
    }

    const cols = periodColumns(cells, periods);
    if (cols) {
      columns = cols;
      continue;
    }

    const line = lineFrom(cells, columns, periods, unitsMultiplier);
    if (!line) continue;

    const family = line.accountCode
      ? INCOME_CODES.includes(line.accountCode)
        ? ("income_statement" as const)
        : ("balance_sheet" as const)
      : null;
    const type = current ?? family;
    if (!type) continue;
    current = type;

    const held = byType.get(type);
    if (held) held.push(line);
    else byType.set(type, [line]);
  }

  return [...byType].map(([statementType, lines]) => ({ statementType, lines }));
}
