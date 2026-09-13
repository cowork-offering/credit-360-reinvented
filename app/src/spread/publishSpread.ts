/* =============================================================================
   THE SPREAD LANDS IN THE COCKPIT (item 18).

   A spread that only exists inside the Spreading room is a demo. The whole
   point of the flow is that the new period reaches the surfaces a banker
   already reads: the Financials tab, the memo's Boom graph, the covenant
   challenge. All three read ONE object — `bundle.boom` — so this module turns
   what Boom returned into the next `bundle.boom` and nothing else touches it.

   THE MERGE HAPPENS ON THE RAW SHAPE, NOT ON THE DISPLAY SHAPE. `bundle.boom`
   carries `spread.file` verbatim (boom_get_spread's own `file`) underneath its
   display fields, and `client-360/render/boom-normalise.mjs` is the one seam
   that derives the display fields from it. So the new period is merged into the
   RAW file and the whole thing is normalised again, producing exactly what a
   real re-read of Boom would produce. The normaliser is called, never copied: a
   second implementation of `periods[]` and `lineItems[]` is how the two
   consumers disagreed in the first place, which is the defect that module
   exists to fix.

   AND WHERE THE BOOK CARRIES NO RAW FILE, THE MERGE ALSO HAPPENS ON THE DISPLAY
   SHAPE. Most relationships hold a hand-shaped `boom` with display periods and
   no statements under them, and the normaliser derives `periods[]` from the raw
   file alone the moment one exists. Merging raw only therefore REPLACED those
   periods with the drop's. See `mergeDisplayPeriods` below for the union that
   fixes it and why the raw path and the display path resolve a collision
   differently.

   AND THE MERGE IS INTO THE STATEMENT, not beside it. Boom returns ONE income
   statement with every period as a column, and the memo's dossier picks the
   richest statement of each type rather than the union of them, so a sibling
   statement carrying a single period would never reach the memo's Boom graph.
   See `mergeStatement` below.

   WHAT IS NOT RECOMPUTED, AND WHY. `ratios` travels through UNCHANGED, `asOf`
   included. Boom's account-code chart carries no depreciation and amortisation
   line, so EBITDA is not derivable from statements alone; leverage and interest
   coverage are derived from EBITDA. Recomputing any of the three here would
   print a figure nothing in the spread supports. The normaliser already puts
   EBITDA on the ratios' own period and on no other, so the new period shows the
   revenue the statements DO carry and stays silent on the rest.

   IDEMPOTENT ON THE PERIOD. A period is merged in by its own id and its own end
   date, so publishing the same spread twice adds one column and not two. The
   stub derives its ids from the file's sha256, so the same file re-dropped is
   the same period all the way down, which is what Boom is asked to guarantee on
   its side (`File.externalUniqueId`).

   PROVENANCE IS CARRIED, NOT IMPLIED. A spread that came from the stub is
   marked `provisional` on the period it added, and the Financials tab says so
   in words. Nothing here may make a stub spread look like Boom's.

   THE NEWEST SPREAD IS THE LATEST POINT; AN LTM OLDER THAN A SPREAD YEAR-END
   SITS BEFORE IT (founder review, 2026-09-13). The book's own order stands for
   everything the book already held, but a fiscal year THIS spread moved is
   placed last whenever every row behind it is a non-fiscal one (LTM, TTM). A
   trailing-twelve-months window closed before the year-end just spread, so
   leaving it after the spread drew the trend dipping into an older figure and
   put an older figure in the tab's headline. Nothing is reordered where no
   period moved. See `mergeDisplayPeriods` below.
   ============================================================================= */

import { normaliseBoom } from "../../../client-360/render/boom-normalise.mjs";
import type { Boom, BoomPeriod } from "../data/contract";
import type { BoomFinancialStatement } from "./types";

/** Where a published spread came from. The stub's spread is built from the
 *  pre-read and is NOT Boom's; the difference is visible on the glass. */
export type SpreadProvenance = "boom" | "stub-provisional";

/**
 * A period the cockpit added from a spread Boom has not verified.
 *
 * `NormalisedBoomPeriod` is the node assembler's shape and is not ours to
 * widen (`client-360/render/boom-normalise.d.mts` is the plugin's file), so the
 * flag rides beside it as an optional property and is read through the helper
 * below rather than by reaching into the object at each call site.
 */
export type ProvisionalBoomPeriod = BoomPeriod & { provisional?: boolean };

/** TRUE where this period was added by a spread Boom has not verified. */
export function isProvisionalPeriod(period: BoomPeriod | null | undefined): boolean {
  return (period as ProvisionalBoomPeriod | null | undefined)?.provisional === true;
}

/** The raw `file` shape Boom returns and `bundle.boom.spread.file` carries. */
interface RawSpreadFile {
  id?: string;
  fileName?: string;
  financialStatements: BoomFinancialStatement[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The raw statements already on file, or none. */
function onFileStatements(file: unknown): BoomFinancialStatement[] {
  if (!isObj(file) || !Array.isArray(file.financialStatements)) return [];
  return file.financialStatements as BoomFinancialStatement[];
}

type RawLineItem = BoomFinancialStatement["lineItems"][number];

/** How a line is recognised across two spreads of the same statement: the
 *  account code Boom mapped it to, and its printed name where it mapped none. */
const lineKey = (line: RawLineItem): string => line.accountCode ?? `name:${line.name.trim().toLowerCase()}`;

/**
 * ONE STATEMENT PER TYPE, WITH BOTH SPREADS' PERIODS ON IT.
 *
 * The new period is merged INTO the statement already on file rather than
 * appended as a second income statement beside it, because that is the shape
 * Boom itself returns: its own `boom_get_spread` carries one income statement
 * with every period as a column (client-360/assets/boom-spread.json). It also
 * matters downstream — the memo's dossier picks the RICHEST statement of each
 * type (`memo/dossier.ts`, `adaptBoomSpread`) rather than the union, so a
 * sibling statement carrying one period would simply lose to the one on file
 * and the memo's Boom graph would never see the new column.
 *
 * THE FILE ON BOOK IS AUTHORITATIVE about everything except the values: its
 * line ids, names and hierarchy stand, and only period columns are added. The
 * one thing that moves the other way is validation, which only ever goes DOWN:
 * a statement that now carries a period nobody has signed off is not a
 * validated statement.
 */
function mergeStatement(book: BoomFinancialStatement, next: BoomFinancialStatement): BoomFinancialStatement {
  const seen = new Set(book.periods.map((p) => p.id));
  const dates = new Set(book.periods.map((p) => p.endDate).filter(Boolean));
  const added = next.periods.filter((p) => !seen.has(p.id) && !(p.endDate && dates.has(p.endDate)));
  const addedIds = new Set(added.map((p) => p.id));

  const byKey = new Map(next.lineItems.map((l) => [lineKey(l), l]));
  const lineItems: RawLineItem[] = book.lineItems.map((line) => {
    const incoming = byKey.get(lineKey(line));
    if (!incoming) return line;
    byKey.delete(lineKey(line));
    const values: Record<string, number | null> = { ...line.periodValues };
    for (const id of addedIds) values[id] = incoming.periodValues[id] ?? null;
    return { ...line, periodValues: values };
  });
  // A line the new spread carries and the book does not: it joins, with columns
  // only for the periods it actually printed.
  for (const line of byKey.values()) {
    const values: Record<string, number | null> = {};
    for (const id of addedIds) values[id] = line.periodValues[id] ?? null;
    lineItems.push({ ...line, periodValues: values });
  }

  const endDates = [book.endDate, next.endDate].filter((d): d is string => typeof d === "string").sort();
  return {
    ...book,
    endDate: endDates.length ? endDates[endDates.length - 1] : book.endDate,
    validationStatus:
      book.validationStatus === "validated" && next.validationStatus === "validated" ? "validated" : "not_validated",
    periods: [...book.periods, ...added],
    lineItems,
  };
}

/** The book's statements with this spread merged in, type by type. */
function mergeStatements(
  book: BoomFinancialStatement[],
  incoming: BoomFinancialStatement[],
): BoomFinancialStatement[] {
  const out = [...book];
  for (const statement of incoming) {
    // The richest statement of that type is the one the book reasons on and the
    // one the memo picks, so it is the one that gains the column.
    let at = -1;
    for (let i = 0; i < out.length; i += 1) {
      if (out[i].statementType !== statement.statementType) continue;
      if (at < 0 || (out[i].lineItems?.length ?? 0) > (out[at].lineItems?.length ?? 0)) at = i;
    }
    if (at < 0) out.push(statement);
    else out[at] = mergeStatement(out[at], statement);
  }
  return out;
}

/* ================================================== the display-level merge

   A BOOK THAT CARRIES NO RAW FILE STILL CARRIES PERIODS, and most of them do.
   `bundle.boom` is allowed to be a hand-shaped display object — `spread.periods`
   and `spread.lineItems` with no statements underneath — and in
   `artifact/live-data.json` only Piedmont carries a raw `spread.file`. Hartwell,
   Brightwater, Sterling and Kingsley carry the display shape alone.

   `normaliseBoom` derives `periods[]` from the raw file the MOMENT there is one
   and ignores the display periods beside it (boom-normalise.mjs `spreadFrom`).
   So merging only at the raw level handed the normaliser a file built from the
   drop alone, and four on-file periods were replaced by the two it carried.
   That is what a browser run on Hartwell showed on 2026-09-12: "Boom · 1 period"
   on a book holding FY2023, FY2024, FY2025 and LTM.

   SO THE BOOK'S DISPLAY PERIODS ARE RE-JOINED and the result is the UNION of the
   two, keyed on the period label, in the book's own order with anything new
   appended. The alternative — synthesising raw statements for the display
   periods so the raw merge could see them — needs an END DATE per period and the
   display rows carry none: "FY2023" would have to become 2023-12-31 and "LTM"
   some date nobody printed. `spread/periods.ts` forbids exactly that invention
   ("a guessed one would fork a borrower's history"), so the merge happens where
   the data actually is.

   WHERE BOTH SIDES CARRY THE LABEL, THE SPREAD TAKES THE ROW. The book's display
   row is a projection with nothing behind it; the incoming row is a spread of a
   file the banker dropped and confirmed, and it says in words that it is
   provisional. This is the one place the display merge differs from the raw
   merge above, where an end date already on file is NOT re-taken: there the
   book's column is itself a Boom spread with its own line ids and hierarchy, and
   the same end date arriving again is that spread re-read rather than a second
   reading of it.
   ============================================================================= */

/** The figures a period prints. `provisional` is not one of them: a period that
 *  only gained its word did not gain a figure. */
function samePeriodFigures(a: BoomPeriod | undefined, b: BoomPeriod | undefined): boolean {
  if (!a || !b) return false;
  return a.revenue === b.revenue && a.ebitda === b.ebitda && a.margin === b.margin;
}

/**
 * The book's display periods with the spread's own merged in, once each.
 *
 * Order is the BOOK's, because the book's order is the order Boom or the
 * assembler put those periods in and nothing here knows better: a display row
 * carries no end date to sort on. Periods the book does not hold are appended,
 * in the order the normaliser derived them, which is by end date ascending.
 *
 * EXPORTED FOR THE SPREADING ROOM'S OWN TREND (founder, 2026-09-13: the axis
 * read FY2023, FY2024, FY2025, LTM, FY2025). The room was appending its new
 * point to the book's periods instead of merging by label, so a re-spread of a
 * year already on file drew that year twice. It is the same merge and it is
 * called, never copied.
 *
 * AND THE PERIOD THIS SPREAD MOVED ENDS THE SERIES where the only rows behind
 * it are non-fiscal, so the newest spread is the latest point. See the module
 * header and `newestSpreadLast` below.
 */
export function mergeDisplayPeriods(book: BoomPeriod[], derived: BoomPeriod[]): BoomPeriod[] {
  if (!book.length) return derived;
  const byKey = new Map<string, BoomPeriod>();
  for (const p of derived) if (p.period) byKey.set(p.period, p);

  const taken = new Set<string>();
  const out: BoomPeriod[] = [];
  for (const held of book) {
    const incoming = held.period ? byKey.get(held.period) : undefined;
    if (incoming && held.period) {
      out.push(incoming);
      taken.add(held.period);
    } else {
      out.push(held);
    }
  }
  for (const p of derived) if (!p.period || !taken.has(p.period)) out.push(p);
  return newestSpreadLast(out, byKey);
}

/** A fiscal year-end label. "LTM" and "TTM" are windows, not fiscal years, and
 *  that is the whole distinction the rule below turns on. */
const FISCAL_YEAR = /^FY\s?(?:19|20)\d{2}$/i;

/**
 * THE NEWEST SPREAD, LAST.
 *
 * `moved` is keyed on the labels this spread carried, so a call with nothing
 * incoming reorders nothing at all. The period picked is the LAST fiscal year
 * among them, which on a multi-period drop is the newest one the banker just
 * spread, and it only travels when every row behind it is non-fiscal: a later
 * fiscal year on the book is newer than this spread and keeps its place.
 */
function newestSpreadLast(periods: BoomPeriod[], moved: Map<string, BoomPeriod>): BoomPeriod[] {
  if (!moved.size) return periods;
  let at = -1;
  for (let i = 0; i < periods.length; i += 1) {
    const key = periods[i].period;
    if (key && moved.has(key) && FISCAL_YEAR.test(key)) at = i;
  }
  if (at < 0 || at === periods.length - 1) return periods;
  const behind = periods.slice(at + 1);
  if (!behind.every((p) => p.period && !FISCAL_YEAR.test(p.period))) return periods;
  return [...periods.slice(0, at), ...behind, periods[at]];
}

export interface PublishSpreadArgs {
  /** The spread on file, normalised, as `bundle.boom` holds it. */
  onFile: Boom | null | undefined;
  /** What the adapter returned, Boom-shaped. */
  statements: BoomFinancialStatement[];
  provenance: SpreadProvenance;
}

/**
 * The next `bundle.boom`, with this spread's period in it.
 *
 * Returns the object on file UNCHANGED where there is nothing to add: a spread
 * that returned no statement is not a reason to move what a banker is reading.
 * Never returns null when something was on file — last-good semantics all the
 * way down.
 */
export function publishSpread(args: PublishSpreadArgs): Boom | null {
  const { onFile, statements, provenance } = args;
  if (!statements.length) return onFile ?? null;

  const existingFile = onFile?.spread?.file;
  const merged: RawSpreadFile = {
    ...(isObj(existingFile) ? (existingFile as unknown as RawSpreadFile) : {}),
    financialStatements: mergeStatements(onFileStatements(existingFile), statements),
  };

  const onFilePeriods = onFile?.spread?.periods ?? [];
  const onFileByKey = new Map<string, BoomPeriod>();
  for (const p of onFilePeriods) if (p.period) onFileByKey.set(p.period, p);
  /* A FLAG ALREADY ON THE BOOK IS CARRIED FORWARD. Normalising rebuilds
     `periods[]` from the raw file, which knows nothing about provenance, so a
     period an earlier stub publish marked would silently lose its word on the
     next publish. That is also what makes publishing the same spread twice
     produce the same object. */
  const alreadyProvisional = new Set(onFilePeriods.filter(isProvisionalPeriod).map((p) => p.period));

  /* THROUGH THE ONE SEAM. `normaliseBoom` accepts the raw payloads and the
     already-normalised shape alike and is idempotent, so handing it the
     untouched `ratios` beside the merged `file` is exactly the re-read a live
     Boom would produce. */
  const next = normaliseBoom({
    ...(onFile ?? {}),
    ratios: onFile?.ratios,
    spread: { ...(onFile?.spread ?? {}), file: merged },
  });
  if (!next) return onFile ?? null;
  if (!next.spread?.periods?.length) return next;

  const periods = mergeDisplayPeriods(onFilePeriods, next.spread.periods);
  /* LAST GOOD, DOWN TO THE TABLE. The income statement is taken WHOLE from the
     merged file rather than row-merged with the book's, because a table whose
     Revenue row came from the dropped file and whose Free Cash Flow row came
     from the last one is a table with two sources and one header. Where the
     merged file supports no row at all the book's table stands; nothing on this
     tab is ever emptied by a publish. */
  const lineItems = next.spread.lineItems?.length ? next.spread.lineItems : onFile?.spread?.lineItems;
  const spread = {
    ...next.spread,
    periods,
    ...(lineItems?.length ? { lineItems } : {}),
  };

  /* THE PERIOD SAYS WHERE IT CAME FROM. A period is marked where THIS spread
     both carried it and moved it, plus whatever the book already carried the
     word on. Both halves matter:
       CARRIED IT — the display keys the incoming statements normalise to on
       their own, read through the same seam rather than re-derived here.
       MOVED IT — on the raw path a period whose end date is already on file is
       not re-taken by `mergeStatement`, so the figure on the glass is still
       Boom's own and marking it provisional would be a lie about the book.
     A period that was Boom's before this room opened and stays Boom's after is
     not made provisional by a stub spread landing beside it. */
  const contributed = new Set(
    (normaliseBoom({ spread: { file: { financialStatements: statements } } })?.spread?.periods ?? [])
      .map((p) => p.period)
      .filter((key): key is string => Boolean(key)),
  );
  const mark = (p: BoomPeriod): boolean => {
    const key = p.period;
    if (!key) return false;
    if (alreadyProvisional.has(key)) return true;
    if (provenance !== "stub-provisional" || !contributed.has(key)) return false;
    return !samePeriodFigures(onFileByKey.get(key), p);
  };
  if (!periods.some(mark)) return { ...next, spread };

  const marked: ProvisionalBoomPeriod[] = periods.map((p) => (mark(p) ? { ...p, provisional: true } : p));
  return { ...next, spread: { ...spread, periods: marked } };
}

/**
 * The period this publish put on the book, or null where it put none.
 *
 * The NEWEST one, where a spread moved several: the room names it in the
 * activity trail and it is the period a banker is being told about. A period
 * counts as moved where the book did not hold that label at all OR where it
 * held it with different figures, because a spread that restates a period the
 * book already displays has still changed what the banker reads.
 */
export function newPeriodOf(before: Boom | null | undefined, after: Boom | null | undefined): string | null {
  const had = new Map<string, BoomPeriod>();
  for (const p of before?.spread?.periods ?? []) if (p.period) had.set(p.period, p);
  let moved: string | null = null;
  for (const p of after?.spread?.periods ?? []) {
    if (p.period && !samePeriodFigures(had.get(p.period), p)) moved = p.period;
  }
  return moved;
}
