/* =============================================================================
   THE POST-READ: WHAT THE SPREAD DID TO THIS RELATIONSHIP.

   Boom has spread the file. Boom knows what the statement says; it does not
   know that this borrower tests interest coverage against a 1.25x floor on a
   term loan that matures next spring. That is the sentence a credit committee
   asks for, and it is the one this module writes.

   THE MODEL NEVER BRINGS A FIGURE, AND NEVER BRINGS A VIEW. The deterministic
   half below computes every number from the spread Boom returned and the read
   already on file, and the session door is handed those facts and asked to say
   them again in a paragraph. Its reply is then checked sentence by sentence
   against the facts it was given: a sentence carrying a figure, a subject or a
   judgement the facts do not carry is dropped and the deterministic sentences
   stand. There is no repair pass, because a half-trusted paragraph is worse
   than a plain one.

   NOT YET VERIFIED IS SAID OUT LOUD. Boom's ladder ends at `verified`, which is
   an analyst signing the spread off in Boom's own page. Until that has
   happened the post-read says so in its own sentence, every time.
   ============================================================================= */

import { askSession, sampleAvailable } from "../channel/sampleDoor";
import type { Boom, BoomPeriod } from "../data/contract";
import { covenantUnit, type CovenantUnit } from "../data/finance";
import { fmtMoney, fmtPct } from "../data/format";
import { sentence, type RelationshipSpreadContext } from "./preRead";
import { interestCoverageOf } from "./coverage";
import { covenantDirection, onFileBoomFigures, thresholdSide, thresholdWord } from "./provisional";
import type { BoomFinancialStatement } from "./types";

export interface PostReadDeps {
  /** The session door, injected. Defaults to `askSession`. */
  ask?: (prompt: string) => Promise<string>;
  /** Whether the door is there at all. Defaults to `sampleAvailable`. */
  available?: () => boolean;
}

export const NOT_VERIFIED_LINE =
  "This spread is not yet verified in Boom, so the figures above are Boom's first pass and an analyst still signs them off.";

export const VERIFIED_LINE = "This spread is verified in Boom.";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ratio = (n: number): string => `${n.toFixed(2)}x`;

const DA_NAME = /deprecia|amorti[sz]/i;
const REVENUE_CODES = ["net_sales_revenue", "sales_revenue", "revenue", "total_revenue"];

/* ------------------------------------------------------------- the index

   Boom keys `periodValues` on the period's own id, and the statement's
   `periods[]` is the only place that id is tied to an end date. Reading the ids
   directly is the defect boom-normalise.mjs documents: a year regex over a UUID
   matched a four-digit fragment of it and picked the wrong period.            */

interface AfterIndex {
  byCode: Record<string, Record<string, number>>;
  byName: Array<{ name: string; values: Record<string, number> }>;
  endDates: string[];
  annual: boolean;
}

const dayOf = (v: string | null | undefined): string | null => {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
};

function indexAfter(statements: BoomFinancialStatement[]): AfterIndex {
  const byCode: Record<string, Record<string, number>> = {};
  const byName: Array<{ name: string; values: Record<string, number> }> = [];
  const endDates = new Set<string>();
  let annual = true;

  for (const statement of statements) {
    const dayById: Record<string, string> = {};
    for (const period of statement.periods ?? []) {
      const day = dayOf(period.endDate);
      if (!day) continue;
      dayById[period.id] = day;
      endDates.add(day);
      if (period.periodType && period.periodType !== "annual") annual = false;
    }
    for (const item of statement.lineItems ?? []) {
      const values: Record<string, number> = {};
      for (const [id, value] of Object.entries(item.periodValues ?? {})) {
        const day = dayById[id];
        if (!day || !isNum(value)) continue;
        values[day] = value;
      }
      if (!Object.keys(values).length) continue;
      if (item.accountCode) {
        const row = (byCode[item.accountCode] ??= {});
        // First writer wins, so a code carried on two statements never has one
        // statement's figure quietly overwritten by the other's.
        for (const [day, value] of Object.entries(values)) if (!(day in row)) row[day] = value;
      }
      byName.push({ name: item.name ?? "", values });
    }
  }
  return { byCode, byName, endDates: [...endDates].sort().reverse(), annual };
}

const pick = (index: AfterIndex, codes: string[], day: string): number | null => {
  for (const code of codes) {
    const v = index.byCode[code]?.[day];
    if (isNum(v)) return v;
  }
  return null;
};

const pickByName = (index: AfterIndex, re: RegExp, day: string): number | null => {
  for (const row of index.byName) {
    if (!re.test(row.name)) continue;
    const v = row.values[day];
    if (isNum(v)) return v;
  }
  return null;
};

export interface PostReadFigures {
  period: string;
  endDate: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  ebitda: number | null;
  interestExpense: number | null;
  totalDebt: number | null;
  leverage: number | null;
  interestCoverage: number | null;
  /** Percent, and null where EBITDA is not derivable from the spread. */
  ebitdaMarginPct: number | null;
  /** Percent. Operating profit over revenue, which the spread always carries
   *  where it carries both, EBITDA or no EBITDA. */
  operatingMarginPct: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cash: number | null;
  /** Total liabilities over total equity, the test a "debt to worth" covenant
   *  measures. Null where either side is missing or equity is not positive. */
  debtToWorth: number | null;
}

const div = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null && b !== 0 ? a / b : null;

const pct = (a: number | null, b: number | null): number | null =>
  a !== null && b !== null && b !== 0 ? (a / b) * 100 : null;

/** Every figure the post-read reads, for ONE period column of the spread. */
function figuresAt(index: AfterIndex, day: string): PostReadFigures {
  const revenue = pick(index, REVENUE_CODES, day);
  const grossProfit = pick(index, ["gross_profit"], day);
  const operatingProfit = pick(index, ["operating_profit"], day);
  const netIncome = pick(index, ["net_income"], day);
  const da = pickByName(index, DA_NAME, day);
  const interest = pick(index, ["interest_expense"], day);
  const shortTerm = pick(index, ["st_loans_payable_bank"], day);
  const longTerm = pick(index, ["long_term_debt_bank"], day);
  const totalAssets = pick(index, ["total_assets"], day);
  const totalLiabilities = pick(index, ["total_liabilities"], day);
  const totalEquity = pick(index, ["total_equity"], day);
  const cash = pick(index, ["cash_and_equivalents"], day);

  const ebitda = operatingProfit !== null && da !== null ? operatingProfit + da : null;
  const totalDebt = shortTerm !== null || longTerm !== null ? (shortTerm ?? 0) + (longTerm ?? 0) : null;

  return {
    period: index.annual ? `FY${day.slice(0, 4)}` : day,
    endDate: day,
    revenue,
    grossProfit,
    operatingProfit,
    netIncome,
    ebitda,
    interestExpense: interest === null ? null : Math.abs(interest),
    totalDebt,
    leverage: ebitda !== null && ebitda > 0 && totalDebt !== null ? totalDebt / ebitda : null,
    interestCoverage: interestCoverageOf(operatingProfit, interest),
    ebitdaMarginPct: pct(ebitda, revenue),
    operatingMarginPct: pct(operatingProfit, revenue),
    totalAssets,
    totalLiabilities,
    totalEquity,
    cash,
    debtToWorth: totalEquity !== null && totalEquity > 0 ? div(totalLiabilities, totalEquity) : null,
  };
}

/** The new period's figures, from the spread Boom returned. EBITDA is derived
 *  here because the spread itself carries the depreciation and amortisation row
 *  the cockpit's chart-level read does not: it has no account code, and it is
 *  found by name, exactly as Boom's own ratio layer finds it. */
export function figuresFromSpread(statements: BoomFinancialStatement[]): PostReadFigures | null {
  const index = indexAfter(statements);
  const day = index.endDates[0];
  return day ? figuresAt(index, day) : null;
}

/**
 * THE COLUMN BESIDE THE NEW ONE, where the spread carries two.
 *
 * A statement almost always prints the comparative year, and that column is the
 * only like-for-like this room has: the book's display periods were spread from
 * a different file by a different pass. A margin that moved inside ONE spread is
 * a fact about the borrower; a margin that moved between two spreads may be a
 * fact about the two spreads.
 */
export function priorFromSpread(statements: BoomFinancialStatement[]): PostReadFigures | null {
  const index = indexAfter(statements);
  const day = index.endDates[1];
  return day ? figuresAt(index, day) : null;
}


/* ------------------------------------------------------- the covenant book

   EVERY COVENANT ON THE BOOK IS SPOKEN TO (founder, 2026-09-13: "it reads the
   information but is it explaining and connecting the dots"). A covenant this
   spread can recompute is recomputed; a covenant it cannot is NAMED, with the
   reason it cannot and the test nCino last carried, rather than left out. A
   covenant left out of the note is a covenant the committee has to go and look
   up, which is the opposite of connecting the dots.

   THIS IS THE POST-READ'S OWN MAP AND NOT `provisional.ts`'s. That one runs
   BEFORE anything is sent, over the handful of lines the browser placed, and is
   deliberately narrower. This one runs over Boom's whole spread, balance sheet
   included, so it reaches tests the pre-read cannot.                          */

/** A numeric figure of the spread a covenant can be tested against. */
type MeasureKey = "interestCoverage" | "leverage" | "debtToWorth" | "totalEquity" | "cash";

export interface CovenantMeasure {
  key: MeasureKey;
  unit: CovenantUnit;
}

/** Why a named covenant cannot be recomputed from a spread. Null where it can. */
export function covenantNotDerivable(name: string): string | null {
  if (/current\s*ratio|working\s*capital\s*ratio/i.test(name)) {
    return "the spread carries no current asset and current liability split";
  }
  if (/tangible/i.test(name)) return "the spread carries no intangible asset line";
  if (/debt\s*service|dscr|fixed\s*charge/i.test(name)) return "it needs a debt service schedule no statement prints";
  if (/receivable|inventory|borrowing\s*base|advance\s*rate/i.test(name)) return "it is measured on a borrowing base and not on a spread";
  return null;
}

/** Which figure of the spread tests this covenant, or null where none does. */
export function covenantMeasure(name: string): CovenantMeasure | null {
  if (covenantNotDerivable(name)) return null;
  if (/interest\s*coverage|times\s*interest/i.test(name)) return { key: "interestCoverage", unit: "ratio" };
  if (/leverage|debt\s*(?:to|\/)\s*ebitda|funded\s*debt/i.test(name)) return { key: "leverage", unit: "ratio" };
  if (/debt\s*to\s*(?:net\s*)?worth|liabilities\s*to\s*(?:net\s*)?worth/i.test(name)) return { key: "debtToWorth", unit: "ratio" };
  if (/net\s*worth|equity/i.test(name)) return { key: "totalEquity", unit: "currency" };
  if (/liquidity|minimum\s*cash/i.test(name)) return { key: "cash", unit: "currency" };
  return null;
}

/**
 * A COVENANT'S NUMBER IN ITS OWN UNIT.
 *
 * An advance test at 80 percent printed "80.00x" and a liquidity floor of five
 * million printed "5000000.00x": both are a different statement rather than a
 * rougher version of the same one. `covenantUnit` is the cockpit's own rule for
 * this (data/finance.ts, validation audit 2026-07-27 finding 6) and the room
 * now carries its answer on the context, so this reads it and falls back to the
 * same rule where a caller did not.
 */
export function unitOfCovenant(covenant: RelationshipSpreadContext["covenants"][number]): CovenantUnit {
  const said = covenant.unit;
  if (said === "ratio" || said === "percent" || said === "currency") return said;
  return covenantUnit(covenant.name, covenant.current ?? covenant.threshold);
}

const say = (value: number, unit: CovenantUnit): string =>
  unit === "currency" ? fmtMoney(value) : unit === "percent" ? `${Number(value.toFixed(2))}%` : ratio(value);

/* --------------------------------------------------------- the three periods

   THE DIRECTION, NOT THE POINT. One period against one period says a figure
   moved; three say whether it is a trend, and that is the sentence a committee
   actually asks for. The book's own display periods are the only three-point
   series either side of this room holds, so the series is theirs with the new
   period on the end of it.                                                   */

interface SeriesPoint {
  period: string;
  value: number;
}

const FISCAL = /^FY\d{4}$/;

/** The book's fiscal periods, with the new one last and the period it replaces
 *  taken out. Fewer than three points is not a direction and returns none. */
export function seriesOf(
  before: Boom | null | undefined,
  read: (p: BoomPeriod) => number | null | undefined,
  now: { period: string; value: number | null },
): SeriesPoint[] {
  if (now.value === null) return [];
  const held: SeriesPoint[] = [];
  for (const period of before?.spread?.periods ?? []) {
    const key = period.period;
    const value = read(period);
    if (!key || !FISCAL.test(key) || key === now.period || !isNum(value)) continue;
    held.push({ period: key, value });
  }
  const out = [...held.slice(-2), { period: now.period, value: now.value }];
  return out.length >= 3 ? out : [];
}

/** "up 12.4% then 20.9%", in the order the periods run. */
function directionWord(points: SeriesPoint[]): string {
  const steps: string[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1].value;
    const move = before === 0 ? 0 : ((points[i].value - before) / Math.abs(before)) * 100;
    steps.push(Math.abs(move) < 0.05 ? "level" : `${move > 0 ? "up" : "down"} ${fmtPct(Math.abs(move))}`);
  }
  return steps.join(", then ");
}

/* ------------------------------------------------------------- the facts */

function deltaWord(now: number, before: number): string {
  if (before === 0) return "";
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.05) return ", level with it";
  return `, ${pct > 0 ? "up" : "down"} ${fmtPct(Math.abs(pct))}`;
}

/** WHAT THE COMMITTEE WILL ASK, by rule and only by rule.
 *
 *  Each question fires on a condition the figures themselves satisfy and names
 *  the figures that made it fire. Nothing here is a view: a question about a
 *  margin that fell while revenue grew is the arithmetic asking it, not this
 *  module. Where no rule fires there is no question, which is a real answer. */
export function committeeQuestions(args: {
  now: PostReadFigures;
  prior: PostReadFigures | null;
  before: Record<string, number | null>;
  covenants: RelationshipSpreadContext["covenants"];
}): string[] {
  const { now, prior, before } = args;
  const out: string[] = [];
  /** The same figure a period earlier: the spread's own prior column first, the
   *  book's on-file read second, and null where neither carries it. */
  const was = <K extends keyof PostReadFigures>(key: K, onFileKey?: string): number | null => {
    const fromSpread = prior ? (prior[key] as number | null) : null;
    if (isNum(fromSpread)) return fromSpread;
    const held = onFileKey ? before[onFileKey] : null;
    return isNum(held) ? held : null;
  };

  const coverageFloor = args.covenants.find(
    (c) => covenantMeasure(c.name)?.key === "interestCoverage" && c.threshold !== null,
  );
  const coverageWas = was("interestCoverage", "interestCoverage");
  if (now.interestCoverage !== null && coverageWas !== null && now.interestCoverage < coverageWas && coverageFloor) {
    out.push(
      `The committee will ask why interest coverage moved from ${ratio(coverageWas)} to ${ratio(now.interestCoverage)} against its ${ratio(coverageFloor.threshold as number)} floor.`,
    );
  }

  const onEbitda = now.ebitdaMarginPct !== null;
  const marginNow = onEbitda ? now.ebitdaMarginPct : now.operatingMarginPct;
  const marginWas = onEbitda ? was("ebitdaMarginPct", "ebitdaMarginPct") : was("operatingMarginPct");
  const revenueWas = was("revenue", "revenue");
  if (
    marginNow !== null &&
    marginWas !== null &&
    marginNow < marginWas &&
    now.revenue !== null &&
    revenueWas !== null &&
    now.revenue > revenueWas
  ) {
    out.push(
      `The committee will ask why the margin fell from ${fmtPct(marginWas)} to ${fmtPct(marginNow)} while revenue grew from ${fmtMoney(revenueWas)} to ${fmtMoney(now.revenue)}.`,
    );
  }

  const leverageWas = was("leverage", "leverage");
  if (now.leverage !== null && leverageWas !== null && now.leverage > leverageWas && now.totalDebt !== null && now.ebitda !== null) {
    out.push(
      `The committee will ask why total bank debt of ${fmtMoney(now.totalDebt)} outran EBITDA of ${fmtMoney(now.ebitda)}, taking leverage from ${ratio(leverageWas)} to ${ratio(now.leverage)}.`,
    );
  }

  for (const covenant of args.covenants) {
    const measure = covenantMeasure(covenant.name);
    const value = measure ? (now[measure.key] as number | null) : null;
    if (!measure || value === null || covenant.threshold === null || covenant.threshold === 0) continue;
    const room = Math.abs(value - covenant.threshold) / Math.abs(covenant.threshold);
    if (room > 0.1) continue;
    out.push(
      `The committee will ask about ${covenant.name}, which tests at ${say(value, measure.unit)} on this spread against its ${say(covenant.threshold, unitOfCovenant(covenant))} ${thresholdWord(covenantDirection(covenant.operator))}, inside a tenth of it.`,
    );
  }

  if (now.totalAssets !== null && now.totalLiabilities !== null && now.totalEquity !== null) {
    const other = now.totalLiabilities + now.totalEquity;
    const tolerance = Math.max(Math.abs(now.totalAssets) * 0.005, 1000);
    if (Math.abs(now.totalAssets - other) > tolerance) {
      out.push(
        `The committee will ask why the balance sheet does not foot: total assets ${fmtMoney(now.totalAssets)} against liabilities and equity of ${fmtMoney(other)}.`,
      );
    }
  }

  return out;
}

/** The deterministic post-read: what changed, which tests move, and where the
 *  spread stands in Boom's own ladder. These sentences are the output when the
 *  door is absent, and the facts the paragraph is composed from when it is not. */
export function postReadFacts(args: {
  company: string;
  before: Boom | null | undefined;
  after: BoomFinancialStatement[];
  covenants: RelationshipSpreadContext["covenants"];
  validationStatus: "not_validated" | "validated";
}): string[] {
  const now = figuresFromSpread(args.after);
  const prior = priorFromSpread(args.after);
  const { figures: before, period: beforePeriod } = onFileBoomFigures(args.before);
  const out: string[] = [];

  if (!now) {
    out.push(sentence(`Boom returned no spread this room could read for ${args.company}`));
    out.push(args.validationStatus === "validated" ? VERIFIED_LINE : NOT_VERIFIED_LINE);
    return out;
  }

  out.push(sentence(`Boom has spread ${now.period} for ${args.company}`));

  const against = (label: string, value: number | null, prior: number | null): void => {
    if (value === null) return;
    if (prior === null || !beforePeriod) {
      out.push(`${label} ${fmtMoney(value)} in ${now.period}.`);
      return;
    }
    out.push(`${label} ${fmtMoney(value)} in ${now.period} against ${fmtMoney(prior)} ${beforePeriod} on file${deltaWord(value, prior)}.`);
  };

  /* THE TOP LINE OVER THREE PERIODS where the book carries them, and against
     the one period on file where it does not. Never both: two sentences about
     the same revenue is the duplication the card was just cured of. */
  const revenueSeries = seriesOf(args.before, (p) => p.revenue, { period: now.period, value: now.revenue });
  if (revenueSeries.length) {
    out.push(
      `Revenue ${revenueSeries.map((p) => `${p.period} ${fmtMoney(p.value)}`).join(", ")}: ${directionWord(revenueSeries)}.`,
    );
  } else {
    against("Revenue", now.revenue, before.revenue);
  }

  against("EBITDA", now.ebitda, before.ebitda);

  /* THE MARGIN, IN WORDS AND WITH THE NUMBERS. EBITDA's margin where the file
     carried a depreciation line, the operating margin where it did not, and the
     comparison is the spread's OWN prior column before the book's, because two
     columns of one spread are the only like-for-like this room has. */
  const onEbitda = now.ebitdaMarginPct !== null;
  const marginNow = onEbitda ? now.ebitdaMarginPct : now.operatingMarginPct;
  const marginWord = onEbitda ? "EBITDA margin" : "Operating margin";
  const fromPrior = (onEbitda ? prior?.ebitdaMarginPct : prior?.operatingMarginPct) ?? null;
  const marginPrior = fromPrior ?? (onEbitda ? (before.ebitdaMarginPct ?? null) : null);
  const marginPeriod = fromPrior !== null ? (prior as PostReadFigures).period : beforePeriod;
  if (marginNow !== null) {
    if (marginPrior !== null && marginPeriod) {
      const points = marginNow - marginPrior;
      const moved =
        Math.abs(points) < 0.05 ? "level with it" : `${points > 0 ? "up" : "down"} ${Math.abs(points).toFixed(1)} points`;
      out.push(`${marginWord} ${fmtPct(marginNow)} in ${now.period} against ${fmtPct(marginPrior)} in ${marginPeriod}, ${moved}.`);
    } else {
      out.push(`${marginWord} ${fmtPct(marginNow)} in ${now.period}.`);
    }
  }

  /* THE BALANCE SHEET, WHICH THE BOOK'S DISPLAY PERIODS DO NOT CARRY AT ALL.
     Where the spread holds one, its three totals and what they imply about the
     borrower's own leverage are facts nothing else on the glass states. */
  if (now.totalAssets !== null && now.totalLiabilities !== null && now.totalEquity !== null) {
    out.push(
      `The balance sheet carries total assets ${fmtMoney(now.totalAssets)}, total liabilities ${fmtMoney(now.totalLiabilities)} and equity ${fmtMoney(now.totalEquity)}` +
        (now.debtToWorth !== null ? `, so liabilities are ${ratio(now.debtToWorth)} equity.` : "."),
    );
  }

  against("Total bank debt", now.totalDebt, before.totalDebt);

  if (now.leverage !== null) {
    out.push(
      before.leverage !== null
        ? `Leverage ${ratio(now.leverage)} against ${ratio(before.leverage)} on file.`
        : `Leverage ${ratio(now.leverage)}, total bank debt over EBITDA.`,
    );
  }
  if (now.interestCoverage !== null) {
    out.push(
      before.interestCoverage !== null
        ? `Interest coverage ${ratio(now.interestCoverage)} against ${ratio(before.interestCoverage)} on file, operating profit over interest expense.`
        : `Interest coverage ${ratio(now.interestCoverage)}, operating profit over interest expense.`,
    );
  }

  /* EVERY COVENANT, ONE SENTENCE EACH. Recomputed where the spread reaches it,
     and where it does not, named with the reason and the test nCino carries so
     the committee reads a book rather than a gap. */
  for (const covenant of args.covenants) {
    const measure = covenantMeasure(covenant.name);
    const value = measure ? (now[measure.key] as number | null) : null;
    if (measure && value !== null && covenant.threshold !== null) {
      const direction = covenantDirection(covenant.operator);
      const word = thresholdWord(direction);
      const where = thresholdSide(direction, value, covenant.threshold);
      const side = where ? `, ${where}` : "";
      const unit = unitOfCovenant(covenant);
      const moved =
        covenant.current !== null && covenant.current !== undefined
          ? ` The last test nCino carries is ${say(covenant.current, unit)}.`
          : "";
      out.push(
        `${covenant.name} tests at ${say(value, measure.unit)} on this spread against its ${say(covenant.threshold, unit)} ${word}${side}.${moved}`,
      );
      continue;
    }
    const why = covenantNotDerivable(covenant.name) ?? "this spread carries no figure that measures it";
    const unit = unitOfCovenant(covenant);
    const stands =
      covenant.current !== null && covenant.current !== undefined && covenant.threshold !== null
        ? ` It stands at ${say(covenant.current, unit)} against its ${say(covenant.threshold, unit)} ${thresholdWord(covenantDirection(covenant.operator))}, as nCino last tested it.`
        : " nCino carries no tested value for it.";
    out.push(`${covenant.name} is not recomputable from this spread: ${why}.${stands}`);
  }

  for (const question of committeeQuestions({ now, prior, before, covenants: args.covenants })) out.push(question);

  out.push(args.validationStatus === "validated" ? VERIFIED_LINE : NOT_VERIFIED_LINE);
  return out;
}

/* ---------------------------------------------------------------- the guard

   THE MODEL REPHRASES THE FACTS. IT DOES NOT ADD TO THEM.

   A figure the model brought of its own was always caught. What the figure
   guard cannot see is the sentence that carries no figure at all: "the
   borrower's leverage stands inside policy and the coverage cushion is intact"
   reads like the desk and is an invention, because nothing handed to the model
   says anything about policy. SR 11-7 draws no line between an invented number
   and an invented judgement, and golden rule C lets the room judge only where
   the facts judge.

   So the guard now runs SENTENCE BY SENTENCE, and a sentence is kept on three
   conditions: every figure in it is a figure from the facts, it is anchored to
   something the facts actually name, and it carries no judgement word the facts
   did not carry first. What fails is dropped. What survives is rephrasing, and
   nothing else. Where nothing survives the deterministic read stands alone,
   which it already does.                                                     */

/** Every figure in a sentence, normalised so "$71.2M" and "71.2M" are the same
 *  token. Years and percentages count: a paragraph that names a period nobody
 *  gave it is as wrong as one that names a figure nobody gave it. */
export function numbersIn(text: string): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?\s*(?:%|x|[KMB]\b)?/gi) ?? [];
  return found.map((t) => t.replace(/[,\s]/g, "").toLowerCase());
}

const wordsIn = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** TRUE where every figure in `text` appears in `facts`. The model is a writer
 *  here and never a source, so anything it brought of its own is the
 *  sentence's problem. */
export function figuresAreGrounded(text: string, facts: string[]): boolean {
  const allowed = new Set(numbersIn(facts.join(" ")));
  return numbersIn(text).every((n) => allowed.has(n));
}

/** What a sentence may be anchored to: the concepts the deterministic read
 *  names. A term counts only where the facts themselves carry it, so this list
 *  is a vocabulary and never a licence. */
const ANCHOR_TERMS = [
  "revenue",
  "sales",
  "ebitda",
  "operating profit",
  "net income",
  "margin",
  "interest coverage",
  "interest expense",
  "coverage",
  "leverage",
  "bank debt",
  "total debt",
  "debt",
  "total assets",
  "total liabilities",
  "equity",
  "cash",
  "working capital",
  "inventory",
  "receivables",
  "fixed charge",
  "covenant",
  "threshold",
  "floor",
  "ceiling",
  "spread",
  "boom",
  "ncino",
];

const LEGAL_SUFFIXES = new Set(["corp", "corporation", "company", "limited", "incorporated", "plc", "gmbh"]);

/** The words that turn a restatement into a credit opinion. None of them is
 *  derivable from a spread, so each is kept out unless the facts said it
 *  first. */
export const JUDGEMENT_WORDS = new Set([
  "acceptable",
  "adequate",
  "aggressive",
  "ample",
  "approval",
  "approve",
  "approved",
  "breach",
  "breached",
  "breaches",
  "comfort",
  "comfortable",
  "comfortably",
  "compliance",
  "compliant",
  "concerning",
  "conservative",
  "cushion",
  "favourable",
  "favorable",
  "headroom",
  "healthy",
  "impressive",
  "manageable",
  "modest",
  "policies",
  "policy",
  "prudent",
  "reassuring",
  "recommend",
  "recommendation",
  "recommended",
  "recommends",
  "robust",
  "safe",
  "satisfactory",
  "should",
  "solid",
  "sound",
  "strength",
  "strong",
  "supportive",
  "weak",
  "weakness",
  "worrying",
]);

/** What the facts permit a sentence to reach for. */
export interface FactAnchors {
  /** Every figure the facts state. */
  numbers: Set<string>;
  /** Every concept, period and name the facts state. */
  terms: string[];
  /** Every word the facts state, which is what licenses a judgement word. */
  words: Set<string>;
  /** TRUE where the deterministic read has already put a test through its
   *  threshold, which is the one thing that lets the prose say "breach". */
  through: boolean;
}

/** The facts, read as the ground a sentence may stand on. */
export function factAnchors(facts: string[], company?: string): FactAnchors {
  const text = facts.join(" ").toLowerCase();
  const terms = ANCHOR_TERMS.filter((term) => text.includes(term));
  for (const period of text.match(/\bfy\d{4}\b/g) ?? []) terms.push(period);
  for (const token of wordsIn(company ?? "")) {
    if (token.length >= 4 && !LEGAL_SUFFIXES.has(token)) terms.push(token);
  }
  return {
    numbers: new Set(numbersIn(text)),
    terms,
    words: new Set(wordsIn(text)),
    through: /\bthrough it\b/.test(text),
  };
}

/** TRUE where a sentence is a rephrasing of the facts: its figures are their
 *  figures, it names something they name, and it passes no judgement they did
 *  not pass. */
export function sentenceIsGrounded(text: string, anchors: FactAnchors): boolean {
  const figures = numbersIn(text);
  if (!figures.every((n) => anchors.numbers.has(n))) return false;

  const lower = text.toLowerCase();
  if (!figures.length && !anchors.terms.some((term) => lower.includes(term))) return false;

  for (const word of wordsIn(lower)) {
    if (!JUDGEMENT_WORDS.has(word)) continue;
    if (anchors.words.has(word)) continue;
    if (word.startsWith("breach") && anchors.through) continue;
    return false;
  }
  return true;
}

/** The model's reply, cut at its sentence ends. */
export function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The paragraph with every ungrounded sentence removed, and "" where nothing
 *  the model wrote survived. */
export function groundedProse(paragraph: string, facts: string[], company?: string): string {
  const anchors = factAnchors(facts, company);
  return splitSentences(paragraph)
    .filter((s) => sentenceIsGrounded(s, anchors))
    .join(" ");
}

/* -------------------------------------------------------------- the prose */

const PARAGRAPH_RULES = [
  "You are the credit desk writing the note a credit committee reads after a new spread lands.",
  "Write ONE paragraph, at most five sentences, in sober banking prose.",
  "Use ONLY the facts below. Every figure in your paragraph must appear in them, exactly as written there.",
  "Never add a figure, a ratio, a period or a name that is not in the facts.",
  "Rephrase the facts and nothing else: no judgement, no view on policy, and no word on whether a figure is comfortable, strong or acceptable.",
  "Say what changed, which tests move and what the committee will ask. No headings, no bullets, no markdown.",
  "No exclamation points, no marketing words, no em dashes.",
];

/**
 * THE POST-READ THE ROOM PRINTS.
 *
 * The deterministic sentences always, and after them whatever the door wrote
 * that is a rephrasing of those sentences: the figures theirs, the subject
 * theirs, the judgement theirs. Never rejects: a door that is absent, declines
 * or writes only inventions leaves the deterministic read exactly as it was.
 */
export async function postRead(
  args: {
    company: string;
    before: Boom | null | undefined;
    after: BoomFinancialStatement[];
    covenants: RelationshipSpreadContext["covenants"];
    validationStatus: "not_validated" | "validated";
  },
  deps: PostReadDeps = {},
): Promise<string[]> {
  const facts = postReadFacts(args);

  const available = deps.available ?? sampleAvailable;
  if (!available()) return facts;

  const ask = deps.ask ?? ((prompt: string) => askSession(prompt, { kind: "reply", tier: "default", rung: 2 }));
  try {
    const paragraph = (await ask([...PARAGRAPH_RULES, "", "FACTS:", ...facts.map((f) => `- ${f}`)].join("\n"))).trim();
    const prose = paragraph ? groundedProse(paragraph, facts, args.company) : "";
    if (!prose) return facts;
    return [...facts, prose];
  } catch {
    // Absence, never an error on the glass. The deterministic read stands.
    return facts;
  }
}
