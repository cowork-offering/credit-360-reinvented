/* =============================================================================
   THE GHOST REGISTER, AS PURE FUNCTIONS.

   The room reads every file's own text before Boom is called at all: the
   statement it announces, the periods it heads its columns with, the scale it
   prints at, and every line it prints with its figures (`spread/lineMap.ts`,
   `spread/preRead.ts`). 0.9.31 spent that on a five-row label table and then
   made the banker watch a clock. Here it becomes THE REGISTER ITSELF, in faint
   ink, standing through the whole wait, and Boom's mapped lines LIGHT IT IN
   PLACE.

   THREE THINGS ARE DERIVED HERE AND NOWHERE ELSE.

   1 THE GHOST. One statement per (file, statement type) the pre-read placed
     lines on, at the scale the file printed, with the periods in the register's
     own order (oldest left, which is the way a spreadsheet reads and the order
     Boom's own statements are already drawn in). The chip column is empty: the
     ghost is the page, and an account code is Boom's to give.

   2 THE RECONCILIATION, by matching Boom's lines to the pre-read's. Never
     invented and never a constant: a line is KEPT where Boom's figure is the
     file's, FOLDED where one Boom line carries the sum of two or more ADJACENT
     printed lines, read with the OPPOSITE SIGN where Boom says so (`flipSign`)
     or where the two figures are equal in magnitude and opposite in sign,
     RESTATED where the same line carries a different figure, and UNMATCHED
     where neither side has a partner. A statement where Boom changed nothing
     gets no sentence at all: written where there is no difference it is
     furniture.

   3 THE MERGE. One row list, always. Boom's answer is applied TO the ghost list
     rather than replacing it, which is what makes "lights in place" true rather
     than a claim: the same row that carried the file's reading carries Boom's.

   FLIP SIGN STAYS APPLIED (0.9.28, `registerModel.applyFlipSign`): it is what
   makes a column foot. So a flagged line's verdict is `sign` because BOOM SAYS
   its sign is not the page's, and the struck figure is drawn only where the two
   figures actually differ on the glass.
   ============================================================================= */

import type { FilePreRead, PreReadLine, StatementType } from "../../../spread/types";
import {
  chipAbbr,
  periodLabel,
  registerStatements,
  type ChipFamily,
  type RatioSupportLine,
  type RegisterRow,
  type RegisterStatement,
  type Unit,
} from "./registerModel";

/* ------------------------------------------------------------------ the copy */

export const GHOST_BADGE = "Not yet mapped by Boom";
const NOT_READ_BY_BOOM = "not read by Boom";
const SIGN_NOTE = "The file prints this the other way round. Boom read it with the opposite sign.";
const RESTATED_NOTE = "Boom read a different figure on this line.";
const UNMATCHED_GHOST_NOTE = "Boom returned no line of its own for this one.";
const UNMATCHED_BOOM_NOTE = "This line is Boom's. The file does not print it.";
const foldNote = (n: number): string => `Boom folded ${n} printed lines into this one.`;

const UNITS_WORD: Record<Unit, string> = {
  full: "dollars, as printed",
  k: "thousands, as printed",
  m: "millions, as printed",
};

const LABEL: Partial<Record<StatementType, string>> = {
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow_statement: "Cash flow statement",
};

const ORDER: StatementType[] = ["income_statement", "balance_sheet", "cash_flow_statement"];

/** "a, b and c". The register's own list voice; a banker reads it as a sentence. */
function andList(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/* ---------------------------------------------------------------- the ghost */

/** One file's pre-read, as the room holds it. */
export interface GhostSource {
  fileId: string;
  fileName: string;
  pre: FilePreRead;
}

export type Hierarchy = RegisterRow["hierarchy"];

export interface GhostRow {
  /** The row's identity across the whole beat: its printed name, normalised. */
  key: string;
  name: string;
  hierarchy: Hierarchy;
  /** One per ghost period, in the ghost's own period order. */
  values: Array<number | null>;
}

export interface GhostPeriod {
  /** The room's display key: "FY2025", "Q2 2026". */
  key: string;
  endDate: string | null;
}

export interface GhostStatement {
  id: string;
  /** The dropped file this statement was read off, so a failure can find it. */
  fileId: string;
  type: StatementType;
  label: string;
  fileName: string;
  /** The columns the file headed its own figures with, oldest left. */
  periods: GhostPeriod[];
  /** The scale the file printed at, which is the scale the ghost is read at. */
  unit: Unit;
  /** "thousands, as printed". */
  unitsWord: string;
  /** As the file printed it: 1, 1_000, 1_000_000. */
  unitsMultiplier: number;
  rows: GhostRow[];
}

/** The scale a printed statement states, as a register unit. */
export function unitOf(multiplier: number): Unit {
  if (multiplier >= 1_000_000) return "m";
  if (multiplier >= 1_000) return "k";
  return "full";
}

/** A printed label reduced to the identity of the row: the key the ghost, Boom
 *  and the pin all agree on. */
export function rowKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* THE WEIGHT A STATEMENT PRINTS ITS OWN SUBTOTALS AND TOTALS AT. The pre-read
   carries no hierarchy (it is a reading of characters, and `PreReadLine` is the
   shared contract with Boom's own shapes), so the ghost reads it off the words
   the page itself uses. Narrow on purpose: a row this list does not recognise
   is a line item, which is what all but a handful of rows are. */
const TOTAL_LINES: RegExp[] = [
  /^total assets$/,
  /^total liabilities and (stockholders|shareholders|members|partners) equity$/,
  /^net (income|profit|earnings|loss)$/,
  /^net change in cash$/,
  /^net cash (provided|used)/,
  /^cash end of (year|period)$/,
];
const SUBTOTAL_LINES: RegExp[] = [
  /^gross (profit|margin)$/,
  /^(income|profit|earnings|loss) from operations$/,
  /^operating (income|profit|earnings)$/,
  /^(income|profit|earnings|loss) before (income )?taxes$/,
  /^total current (assets|liabilities)$/,
  /^total liabilities$/,
  /^total (stockholders|shareholders|members|partners) equity$/,
];

export function ghostHierarchy(name: string): Hierarchy {
  const said = rowKey(name);
  if (TOTAL_LINES.some((re) => re.test(said))) return "total";
  if (SUBTOTAL_LINES.some((re) => re.test(said))) return "subtotal";
  return "line_item";
}

/** OLDEST LEFT, the order the register draws Boom's own periods in. A period the
 *  text dated sorts on its date; one it only named sorts on the year inside its
 *  own label, because "FY2023" against "2025-12-31" as plain strings puts the
 *  newest column first and a register that opens in the wrong order is a
 *  register the banker has to re-read. */
function sortableGhostPeriod(period: GhostPeriod): string {
  if (period.endDate) return period.endDate;
  const year = /(\d{4})/.exec(period.key)?.[1];
  return year ? `${year}-12-31` : period.key;
}

function ghostPeriods(periods: ReadonlyArray<{ key: string; endDate: string | null }>): GhostPeriod[] {
  return periods
    .filter((p) => p.key)
    .map((p) => ({ key: p.key, endDate: p.endDate ?? null }))
    .sort((a, b) => sortableGhostPeriod(a).localeCompare(sortableGhostPeriod(b)));
}

function ghostRows(lines: readonly PreReadLine[], periods: GhostPeriod[]): GhostRow[] {
  return lines
    .filter((l) => l.label.trim().length > 0)
    .map((l) => ({
      key: rowKey(l.label),
      name: l.label.trim(),
      hierarchy: ghostHierarchy(l.label),
      values: periods.map((p) => (p.key in l.values ? l.values[p.key] : null)),
    }));
}

/**
 * THE GHOST REGISTER, from what the room read off the files themselves.
 *
 * One statement per (file, statement type) that placed at least one line: a
 * statement the pre-read named but could put no row under is a label, not a
 * register, and the file's own card says what there is to say about it.
 */
export function ghostStatements(sources: readonly GhostSource[]): GhostStatement[] {
  const out: GhostStatement[] = [];
  for (const src of sources) {
    for (const statement of src.pre.statements) {
      const label = LABEL[statement.statementType];
      if (!label) continue;
      const periods = ghostPeriods(statement.periods);
      if (!periods.length) continue;
      const rows = ghostRows(statement.lines, periods);
      if (!rows.length) continue;
      const unit = unitOf(src.pre.unitsMultiplier);
      out.push({
        id: `ghost:${src.fileId}:${statement.statementType}`,
        fileId: src.fileId,
        type: statement.statementType,
        label,
        fileName: src.fileName,
        periods,
        unit,
        unitsWord: UNITS_WORD[unit],
        unitsMultiplier: src.pre.unitsMultiplier,
        rows,
      });
    }
  }
  return out.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

/* -------------------------------------------------------- the reconciliation */

export type Verdict = "kept" | "fold" | "sign" | "restated" | "unmatched";

export interface Reconciliation {
  /** Lines the room read off the page. */
  read: number;
  kept: number;
  /** Printed lines Boom folded away, and the number of Boom lines they became. */
  folded: number;
  foldedInto: number;
  sign: number;
  restated: number;
  /** Printed lines with no Boom line, and Boom lines with no printed line. */
  unmatchedGhost: number;
  unmatchedBoom: number;
  /** One banker sentence, or null where Boom changed nothing worth saying. */
  sentence: string | null;
}

/** HALF A PRINTED UNIT PER SUMMED LINE. A statement printed in thousands rounds
 *  every line it prints, so a fold of two lines can miss its own total by a
 *  whole unit and still be the same fold. */
function tolerance(unitsMultiplier: number, lines: number): number {
  return Math.max(1, (Math.max(1, unitsMultiplier) / 2) * lines);
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

interface Pairing {
  /** ghost row index -> the Boom row it became. */
  byGhost: Map<number, { boom: number; verdict: Verdict }>;
  /** one entry per fold: where it starts, which printed lines it took, what it became. */
  folds: Array<{ at: number; members: number[]; boom: number }>;
  boomMatched: Set<number>;
  /** ghost column -> Boom column, for the columns both sides carry. */
  cols: Array<{ g: number; b: number }>;
}

/** Which ghost period and which Boom period are the same column, by label. */
function sharedPeriods(ghost: GhostStatement, boom: RegisterStatement): Array<{ g: number; b: number }> {
  const out: Array<{ g: number; b: number }> = [];
  ghost.periods.forEach((gp, g) => {
    const b = boom.periods.findIndex(
      (p) => p.label === gp.key || periodLabel(p.endDate) === gp.key || (gp.endDate != null && p.endDate === gp.endDate),
    );
    if (b >= 0) out.push({ g, b });
  });
  return out;
}

function figuresAgree(
  gv: ReadonlyArray<number | null>,
  bv: ReadonlyArray<number | null>,
  cols: Array<{ g: number; b: number }>,
  tol: number,
): { equal: boolean; flipped: boolean } {
  let compared = 0;
  let equal = true;
  let flipped = true;
  for (const c of cols) {
    const a = gv[c.g];
    const b = bv[c.b];
    if (a == null || b == null) continue;
    compared += 1;
    if (!near(a, b, tol)) equal = false;
    if (!(a !== 0 && b !== 0 && near(a, -b, tol))) flipped = false;
  }
  if (!compared) return { equal: false, flipped: false };
  return { equal, flipped };
}

/** THE PAIRING. By name first, because a line keeps its name; by figure after,
 *  because Boom renames what it maps; by adjacent sum last, which is a fold. */
function pair(ghost: GhostStatement, boom: RegisterStatement): Pairing {
  const cols = sharedPeriods(ghost, boom);
  const units = ghost.unitsMultiplier;
  const tol1 = tolerance(units, 1);
  const body = boom.rows.map((r, i) => ({ r, i })).filter((x) => x.r.hierarchy !== "header");
  const byGhost = new Map<number, { boom: number; verdict: Verdict }>();
  const boomMatched = new Set<number>();

  const verdictOf = (g: GhostRow, b: RegisterRow): Verdict => {
    const agree = figuresAgree(g.values, b.values, cols, tol1);
    if (b.flipSign || agree.flipped) return "sign";
    return agree.equal ? "kept" : "restated";
  };

  const take = (gi: number, bi: number, verdict: Verdict) => {
    byGhost.set(gi, { boom: bi, verdict });
    boomMatched.add(bi);
  };

  ghost.rows.forEach((g, gi) => {
    const hit = body.find((x) => !boomMatched.has(x.i) && rowKey(x.r.name) === g.key);
    if (hit) take(gi, hit.i, verdictOf(g, hit.r));
  });

  ghost.rows.forEach((g, gi) => {
    if (byGhost.has(gi)) return;
    const hit = body.find((x) => !boomMatched.has(x.i) && figuresAgree(g.values, x.r.values, cols, tol1).equal);
    if (hit) take(gi, hit.i, hit.r.flipSign ? "sign" : "kept");
  });

  const folds: Pairing["folds"] = [];
  for (const x of body) {
    if (boomMatched.has(x.i)) continue;
    let found: number[] | null = null;
    for (let start = 0; start < ghost.rows.length && !found; start += 1) {
      if (byGhost.has(start)) continue;
      const members: number[] = [];
      for (let end = start; end < ghost.rows.length; end += 1) {
        if (byGhost.has(end)) break;
        members.push(end);
        if (members.length < 2) continue;
        const tol = tolerance(units, members.length);
        const sums = cols.map((c) => {
          let total: number | null = null;
          for (const m of members) {
            const v = ghost.rows[m].values[c.g];
            if (v == null) continue;
            total = (total ?? 0) + v;
          }
          return total;
        });
        const agrees =
          cols.length > 0 &&
          cols.every((c, ci) => {
            const b = x.r.values[c.b];
            const sum = sums[ci];
            return b != null && sum != null && near(sum, b, tol);
          });
        if (agrees) {
          found = members.slice();
          break;
        }
      }
    }
    if (!found) continue;
    folds.push({ at: found[0], members: found, boom: x.i });
    for (const m of found) byGhost.set(m, { boom: x.i, verdict: "fold" });
    boomMatched.add(x.i);
  }

  return { byGhost, folds, boomMatched, cols };
}

/** The sentence, and the counts it is made of. Derived from the two sides every
 *  time; never a constant, and never written where there is nothing to say. */
export function reconcile(ghost: GhostStatement, boom: RegisterStatement): Reconciliation {
  const p = pair(ghost, boom);
  const verdicts = [...p.byGhost.values()];
  const count = (v: Verdict) => verdicts.filter((x) => x.verdict === v).length;
  const kept = count("kept");
  const sign = count("sign");
  const restated = count("restated");
  const folded = count("fold");
  const unmatchedGhost = ghost.rows.length - p.byGhost.size;
  const unmatchedBoom = boom.rows.filter((r, i) => r.hierarchy !== "header" && !p.boomMatched.has(i)).length;

  const bits: string[] = [];
  if (p.folds.length) bits.push(`folded ${folded} into ${p.folds.length}`);
  if (sign) bits.push(`read ${sign} with the opposite sign`);
  if (restated) bits.push(`restated ${restated}`);
  if (unmatchedGhost) bits.push(`left ${unmatchedGhost} unmatched`);
  if (unmatchedBoom) bits.push(`added ${unmatchedBoom} ${unmatchedBoom === 1 ? "line" : "lines"} the page does not print`);

  return {
    read: ghost.rows.length,
    kept,
    folded,
    foldedInto: p.folds.length,
    sign,
    restated,
    unmatchedGhost,
    unmatchedBoom,
    sentence: bits.length
      ? `Boom kept ${kept} of the ${ghost.rows.length} lines this room read off the page as they stand, ${andList(bits)}.`
      : null,
  };
}

/* ----------------------------------------------------------------- the merge */

export interface MergedRow {
  id: string;
  key: string;
  name: string;
  hierarchy: Hierarchy;
  code: string | null;
  family: ChipFamily;
  abbr: string;
  mismapped: boolean;
  feeds: string[];
  /** What the grid prints: Boom's figures where it has answered, the file's before. */
  values: Array<number | null>;
  /** The file's own figures, for the strike where the two differ on the glass. */
  fileValues: Array<number | null> | null;
  verdict: Verdict | null;
  note: string | null;
  /** This printed line folded away. It dissolves at the beat, then goes. */
  folding: boolean;
}

function ghostMerged(row: GhostRow, index: number, statementId: string): MergedRow {
  return {
    id: `${statementId}:${index}`,
    key: row.key,
    name: row.name,
    hierarchy: row.hierarchy,
    code: null,
    family: "none",
    abbr: chipAbbr("none"),
    mismapped: false,
    feeds: [],
    values: row.values,
    fileValues: null,
    verdict: null,
    note: null,
    folding: false,
  };
}

function boomMerged(row: RegisterRow, verdict: Verdict | null, note: string | null): MergedRow {
  return {
    id: row.id,
    key: rowKey(row.name),
    name: row.name,
    hierarchy: row.hierarchy,
    code: row.code,
    family: row.family,
    abbr: row.abbr,
    mismapped: row.mismapped,
    feeds: row.feeds,
    values: row.values,
    fileValues: null,
    verdict,
    note,
    folding: false,
  };
}

const boomExtra = (row: RegisterRow): MergedRow =>
  row.hierarchy === "header" ? boomMerged(row, null, null) : boomMerged(row, "unmatched", UNMATCHED_BOOM_NOTE);

/** The ghost's rows, before Boom has answered. */
function ghostOnly(ghost: GhostStatement): MergedRow[] {
  return ghost.rows.map((r, i) => ghostMerged(r, i, ghost.id));
}

/** Boom's rows, where the room has no ghost to light: the Financials tab, and a
 *  file whose text this room could place no line from. */
function boomOnly(boom: RegisterStatement): MergedRow[] {
  return boom.rows.map((r) => boomMerged(r, null, null));
}

/**
 * ONE ROW LIST. Boom's lines land ON the printed ones: the same row that
 * carried the file's reading carries Boom's, the folded lines dissolve where
 * they stood and the line they became settles into the gap, and a line only one
 * side has says which side it is.
 *
 * `folding` is the beat between the two: the printed lines are still on the
 * glass and the line they became is not yet in the list. Called without it, the
 * list is the settled one.
 */
export function mergeRows(
  ghost: GhostStatement,
  boom: RegisterStatement,
  opts: { folding?: boolean } = {},
): MergedRow[] {
  const p = pair(ghost, boom);
  const tol = tolerance(ghost.unitsMultiplier, 1);
  const out: MergedRow[] = [];
  const placed = new Set<number>();

  /** Every Boom row before this one that nothing on the page claimed, in Boom's
   *  own order. A section header is one of these. */
  const boomBefore = (boomIndex: number): void => {
    boom.rows.forEach((r, i) => {
      if (i >= boomIndex || placed.has(i) || p.boomMatched.has(i)) return;
      placed.add(i);
      out.push(boomExtra(r));
    });
  };

  ghost.rows.forEach((g, gi) => {
    const hit = p.byGhost.get(gi);
    if (!hit) {
      out.push({ ...ghostMerged(g, gi, ghost.id), verdict: "unmatched", note: UNMATCHED_GHOST_NOTE });
      return;
    }
    const fold = p.folds.find((f) => f.members.includes(gi));
    if (fold) {
      if (opts.folding) {
        out.push({ ...ghostMerged(g, gi, ghost.id), verdict: "fold", folding: true });
        return;
      }
      if (fold.at !== gi) return;
      boomBefore(fold.boom);
      placed.add(fold.boom);
      out.push(boomMerged(boom.rows[fold.boom], "fold", foldNote(fold.members.length)));
      return;
    }
    boomBefore(hit.boom);
    placed.add(hit.boom);
    const br = boom.rows[hit.boom];
    const differs = p.cols.some(({ g: gc, b }) => {
      const a = g.values[gc];
      const bv = br.values[b];
      return a != null && bv != null && !near(a, bv, tol);
    });
    const note = hit.verdict === "sign" ? SIGN_NOTE : hit.verdict === "restated" ? RESTATED_NOTE : null;
    out.push({
      ...boomMerged(br, hit.verdict, note),
      /* THE PIN HOLDS ACROSS THE BEAT. The row's identity is the one the banker
         pinned on the page, whatever Boom went on to call the line. */
      key: g.key,
      fileValues: differs ? g.values : null,
    });
  });

  boom.rows.forEach((r, i) => {
    if (placed.has(i) || p.boomMatched.has(i)) return;
    placed.add(i);
    out.push(boomExtra(r));
  });

  return out;
}

/* ---------------------------------------------------------------- the source

   ONE LIST THE REGISTER DRAWS FROM, whichever of the two sides exists. A room
   before Boom has answered holds ghosts alone; the Financials tab holds Boom
   alone; the arrival holds both, paired by statement type. */

export interface RegisterSource {
  id: string;
  label: string;
  /** Boom's lines have landed on this statement. */
  lit: boolean;
  boom: RegisterStatement | null;
  ghost: GhostStatement | null;
  recon: Reconciliation | null;
}

export function registerSources(args: {
  statements: Parameters<typeof registerStatements>[0];
  ghost?: readonly GhostStatement[] | null;
  adjusted: boolean;
  support?: RatioSupportLine[] | null;
}): RegisterSource[] {
  const boom = registerStatements(args.statements, { adjusted: args.adjusted, support: args.support });
  const ghosts = [...(args.ghost ?? [])];
  const taken = new Set<GhostStatement>();
  const out: RegisterSource[] = [];

  for (const b of boom) {
    const g = ghosts.find((x) => x.type === b.type && !taken.has(x)) ?? null;
    if (g) taken.add(g);
    out.push({ id: b.id, label: b.label, lit: true, boom: b, ghost: g, recon: g ? reconcile(g, b) : null });
  }

  for (const g of ghosts) {
    if (taken.has(g)) continue;
    out.push({
      id: g.id,
      /* A STATEMENT BOOM DID NOT READ SAYS SO IN THE SELECT, because the select
         is where a banker chooses what to look at. */
      label: boom.length ? `${g.label} (${NOT_READ_BY_BOOM})` : g.label,
      lit: false,
      boom: null,
      ghost: g,
      recon: null,
    });
  }

  return out;
}

/** What the grid draws for one source. */
export function sourceRows(source: RegisterSource, folding = false): MergedRow[] {
  if (source.boom && source.ghost) return mergeRows(source.ghost, source.boom, { folding });
  if (source.boom) return boomOnly(source.boom);
  return source.ghost ? ghostOnly(source.ghost) : [];
}
