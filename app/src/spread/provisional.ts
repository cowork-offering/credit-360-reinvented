/* =============================================================================
   THE PROVISIONAL READ: WHAT THIS FILE WOULD DO TO THE RELATIONSHIP.

   Pure, deterministic, and PROVISIONAL in every sentence it produces. Boom has
   not spread anything yet. What this module does is put the lines the pre-read
   could place beside the period already on file, so the banker confirms a plan
   knowing what is in the envelope rather than after the fact.

   EVERY FIGURE TRACES. A figure here comes from exactly one of two places: a
   line the pre-read extracted from the dropped file, or a value the on-file
   Boom read already carries. Nothing is estimated, nothing is annualised, and a
   ratio whose inputs are not both present is null with a sentence that says
   which input is missing.

   THE FORMULAS MIRROR THE ON-FILE READ, deliberately. Boom's own ratio layer
   reports interest coverage as operating profit over interest expense and
   leverage as total debt over EBITDA. The coverage formula is not written here:
   `spread/coverage.ts` is the one definition of it, carrying the proof against
   Boom's own snapshot, and it is read by this module, by the post-read and by
   the publish that lands the spread on the book, so no two surfaces can print
   two figures for one ratio. A provisional figure computed a different way
   would not be comparable with the one it is printed beside, which is the whole
   point of printing them together.
   ============================================================================= */

import type { Boom } from "../data/contract";
import { fmtMoney, fmtPct } from "../data/format";
import { interestCoverageOf } from "./coverage";
import type { RelationshipSpreadContext } from "./preRead";
import type { FilePreRead, PreReadLine, ProvisionalRead } from "./types";

/** Revenue codes in the order the cockpit's own Boom normaliser tries them
 *  (client-360/render/boom-normalise.mjs REVENUE_CODES), so the provisional
 *  revenue and the on-file revenue are the same line. */
const REVENUE_CODES = ["net_sales_revenue", "sales_revenue", "revenue", "total_revenue"];

/** Depreciation and amortisation has NO account code in Boom's chart: its own
 *  ratio layer finds the row by name, and so does this. */
const DA_LABEL = /deprecia|amorti[sz]/i;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const ratio = (n: number): string => `${n.toFixed(2)}x`;

/* --------------------------------------------------------- the new period */

const yearOfKey = (key: string): number => {
  const m = /((?:19|20)\d{2})/.exec(key);
  return m ? Number(m[1]) : 0;
};

/** The period this drop is ABOUT: the newest one any of its statements print.
 *  An end date decides it where there is one; the year in the key decides it
 *  where there is not. */
function newestPeriod(files: FilePreRead[]): string | null {
  let best: { key: string; rank: string } | null = null;
  for (const file of files) {
    for (const statement of file.statements) {
      for (const period of statement.periods) {
        const rank = period.endDate ?? `${String(yearOfKey(period.key)).padStart(4, "0")}-00-00`;
        if (!best || rank.localeCompare(best.rank) > 0) best = { key: period.key, rank };
      }
    }
  }
  return best?.key ?? null;
}

/** Every line the pre-read placed, across every file and statement. */
function allLines(files: FilePreRead[]): PreReadLine[] {
  return files.flatMap((f) => f.statements.flatMap((s) => s.lines));
}

/** The value of the first line matching one of `codes` in `period`, else the
 *  first whose label matches. Absolute currency units: the pre-read already
 *  applied the statement's own scale. */
function valueOf(lines: PreReadLine[], period: string, codes: string[], labelRe?: RegExp): number | null {
  for (const code of codes) {
    const line = lines.find((l) => l.accountCode === code && isNum(l.values[period]));
    if (line) return line.values[period] as number;
  }
  if (labelRe) {
    const line = lines.find((l) => labelRe.test(l.label) && isNum(l.values[period]));
    if (line) return line.values[period] as number;
  }
  return null;
}

/* ------------------------------------------------------------ on the file */

const fyOf = (day: string | undefined): string | null => (day ? `FY${day.slice(0, 4)}` : null);

/** The on-file figures, read from the shape the cockpit already holds
 *  (`bundle.boom`, normalised once by boom-normalise.mjs). `ratios.raw` is
 *  Boom's own numeric contract and is preferred; the display fields beside it
 *  are derived from it. */
export function onFileBoomFigures(onFile: Boom | null | undefined): { figures: Record<string, number | null>; period: string | null } {
  const ratios = onFile?.ratios;
  const raw = ratios?.raw;
  const period =
    fyOf(ratios?.asOf) ??
    (onFile?.spread?.periods?.length ? (onFile.spread.periods[onFile.spread.periods.length - 1].period ?? null) : null);

  const take = (a: unknown, b: unknown): number | null => (isNum(a) ? a : isNum(b) ? b : null);
  return {
    period,
    figures: {
      revenue: take(raw?.revenue, ratios?.revenue),
      ebitda: take(raw?.ebitda, ratios?.ebitda),
      // Boom emits the margin as a fraction; the cockpit's display field is the
      // percent. One of the two is always the percent, and it is this one.
      ebitdaMarginPct: isNum(ratios?.ebitdaMargin) ? ratios.ebitdaMargin : isNum(raw?.ebitdaMargin) ? raw.ebitdaMargin * 100 : null,
      totalDebt: isNum(raw?.totalDebt) ? raw.totalDebt : null,
      leverage: take(raw?.leverage, ratios?.totalLeverage),
      interestCoverage: take(raw?.interestCoverage, ratios?.interestCoverage),
      operatingProfit: isNum(raw?.operatingIncome) ? raw.operatingIncome : null,
    },
  };
}

/* ---------------------------------------------------------- the covenants */

export type CovenantDirection = "floor" | "ceiling" | "unknown";

/** Which side of its threshold a covenant has to stay on. nCino writes the
 *  operator as a symbol on some records and as a word on others, so both are
 *  read, and anything else stays unknown rather than being assumed a floor. */
export function covenantDirection(operator: string): CovenantDirection {
  const said = operator.trim().toLowerCase();
  if (/^(>=|>|min|minimum|at least|not less|no less|floor)/.test(said)) return "floor";
  if (/^(<=|<|max|maximum|not more|no more|ceiling|cap)/.test(said)) return "ceiling";
  return "unknown";
}

/** WHICH SIDE OF ITS THRESHOLD a figure sits on, in the words a banker uses for
 *  that kind of test. Null where the operator did not say which side is safe,
 *  because "inside" would then be this module's opinion and not the covenant's. */
export function thresholdSide(direction: CovenantDirection, value: number, threshold: number): string | null {
  if (direction === "floor") return value >= threshold ? "above it" : "below it";
  if (direction === "ceiling") return value <= threshold ? "inside it" : "through it";
  return null;
}

/** The word for the threshold itself, in the same terms. */
export function thresholdWord(direction: CovenantDirection): string {
  return direction === "ceiling" ? "ceiling" : direction === "floor" ? "floor" : "threshold";
}

/** Which provisional figure, if any, tests this covenant. Anything this room
 *  cannot recompute from the lines it extracted is left alone: a DSCR needs a
 *  debt service schedule no statement prints. */
export function covenantFigureKey(name: string): "interestCoverage" | "leverage" | null {
  if (/interest\s*coverage|times\s*interest/i.test(name)) return "interestCoverage";
  if (/leverage|debt\s*(?:to|\/)\s*ebitda|funded\s*debt/i.test(name)) return "leverage";
  return null;
}

/* ----------------------------------------------------------- the read */

/**
 * THE PROVISIONAL READ, or null where the pre-read placed nothing to read.
 *
 * `covenants` is optional and carries the nCino thresholds where the room has
 * them, so a provisional ratio can be printed against the test it moves. The
 * room passes them; a caller that has none still gets the figures and deltas.
 */
export function provisionalRead(
  files: FilePreRead[],
  onFile: Boom | null | undefined,
  covenants?: RelationshipSpreadContext["covenants"],
): ProvisionalRead | null {
  const period = newestPeriod(files);
  if (!period) return null;

  const lines = allLines(files);
  if (!lines.length) return null;

  const revenue = valueOf(lines, period, REVENUE_CODES, /net sales|^sales$|^revenue$|total revenue/i);
  const grossProfit = valueOf(lines, period, ["gross_profit"], /gross profit/i);
  const operatingProfit = valueOf(lines, period, ["operating_profit"], /income from operations|operating (income|profit)/i);
  const depreciationAmortisation = valueOf(lines, period, [], DA_LABEL);
  const interestExpense = valueOf(lines, period, ["interest_expense"], /interest expense/i);
  const shortTermDebt = valueOf(lines, period, ["st_loans_payable_bank"], /line of credit|current portion/i);
  const longTermDebt = valueOf(lines, period, ["long_term_debt_bank"], /long.?term debt/i);
  const totalAssets = valueOf(lines, period, ["total_assets"], /^total assets$/i);
  const totalLiabilities = valueOf(lines, period, ["total_liabilities"], /^total liabilities$/i);
  const totalEquity = valueOf(lines, period, ["total_equity"], /total (stockholders|shareholders|members).? equity|^total equity$/i);

  const ebitda = operatingProfit !== null && depreciationAmortisation !== null ? operatingProfit + depreciationAmortisation : null;
  const ebitdaMarginPct = ebitda !== null && revenue ? (ebitda / revenue) * 100 : null;
  const totalDebt = shortTermDebt !== null || longTermDebt !== null ? (shortTermDebt ?? 0) + (longTermDebt ?? 0) : null;
  const leverage = ebitda !== null && ebitda > 0 && totalDebt !== null ? totalDebt / ebitda : null;
  const interestCoverage = interestCoverageOf(operatingProfit, interestExpense);

  const figures: Record<string, number | null> = {
    revenue,
    grossProfit,
    operatingProfit,
    depreciationAmortisation,
    ebitda,
    ebitdaMarginPct,
    interestExpense,
    totalDebt,
    leverage,
    interestCoverage,
    totalAssets,
    totalLiabilities,
    totalEquity,
  };

  if (Object.values(figures).every((v) => v === null)) return null;

  const { figures: onFileFigs, period: onFilePeriod } = onFileBoomFigures(onFile);
  const said: string[] = [];

  const delta = (now: number | null, before: number | null): string => {
    if (now === null || before === null || before === 0) return "";
    const pct = ((now - before) / Math.abs(before)) * 100;
    if (Math.abs(pct) < 0.05) return ", level with it";
    return `, ${pct > 0 ? "up" : "down"} ${fmtPct(Math.abs(pct))}`;
  };

  const against = (label: string, now: number | null, before: number | null): string | null => {
    if (now === null) return null;
    if (before === null || !onFilePeriod) return `${label} ${fmtMoney(now)} on this file.`;
    return `${label} ${fmtMoney(now)} against ${fmtMoney(before)} ${onFilePeriod} on file${delta(now, before)}.`;
  };

  const revenueLine = against("Revenue", revenue, onFileFigs.revenue);
  if (revenueLine) said.push(revenueLine);

  if (ebitda !== null) {
    const line = against("EBITDA", ebitda, onFileFigs.ebitda);
    if (line) said.push(line);
    if (ebitdaMarginPct !== null) said.push(`EBITDA margin ${fmtPct(ebitdaMarginPct)} on revenue of ${fmtMoney(revenue)}.`);
  } else if (operatingProfit !== null) {
    said.push(
      `EBITDA is not stated: this file carries no depreciation and amortisation line, so operating profit of ${fmtMoney(operatingProfit)} stands on its own until Boom spreads it.`,
    );
  }

  const debtLine = against("Total bank debt", totalDebt, onFileFigs.totalDebt);
  if (debtLine) said.push(debtLine);

  if (leverage !== null) {
    said.push(
      onFileFigs.leverage !== null
        ? `Provisional leverage ${ratio(leverage)} against ${ratio(onFileFigs.leverage)} on file.`
        : `Provisional leverage ${ratio(leverage)}, total bank debt over EBITDA.`,
    );
  } else if (totalDebt !== null && ebitda === null) {
    said.push("Leverage is not computable here: the file carries the debt but no EBITDA, so Boom's spread settles it.");
  }

  if (interestCoverage !== null) {
    said.push(
      onFileFigs.interestCoverage !== null
        ? `Provisional interest coverage ${ratio(interestCoverage)} against ${ratio(onFileFigs.interestCoverage)} on file, operating profit over interest expense.`
        : `Provisional interest coverage ${ratio(interestCoverage)}, operating profit over interest expense.`,
    );
  }

  for (const line of covenantLines(figures, covenants)) said.push(line);
  const foot = footCheck(totalAssets, totalLiabilities, totalEquity);
  if (foot) said.push(foot);

  return { period, figures, onFile: onFileFigs, onFilePeriod, lines: said, provisional: true };
}

/** The provisional ratios read against the tests nCino carries. A covenant this
 *  room cannot recompute is not mentioned: naming it with no figure would read
 *  as a finding when it is silence. */
function covenantLines(
  figures: Record<string, number | null>,
  covenants: RelationshipSpreadContext["covenants"] | undefined,
): string[] {
  const out: string[] = [];
  for (const covenant of covenants ?? []) {
    const key = covenantFigureKey(covenant.name);
    if (!key) continue;
    const value = figures[key];
    if (value === null || covenant.threshold === null) continue;
    const direction = covenantDirection(covenant.operator);
    const word = thresholdWord(direction);
    const side = thresholdSide(direction, value, covenant.threshold);
    out.push(
      `Provisional ${covenant.name.toLowerCase()} ${ratio(value)} against the ${ratio(covenant.threshold)} ${word} nCino carries${side ? `, ${side}` : ""}.`,
    );
  }
  return out;
}

/** Does the balance sheet balance. Silent where either side is missing: a foot
 *  check on half a balance sheet is not a finding. */
function footCheck(assets: number | null, liabilities: number | null, equity: number | null): string | null {
  if (assets === null || liabilities === null || equity === null) return null;
  const other = liabilities + equity;
  const gap = assets - other;
  // Half a percent of the balance sheet, or a thousand dollars, whichever is
  // larger: statements round, and a rounding difference is not a finding.
  const tolerance = Math.max(Math.abs(assets) * 0.005, 1000);
  if (Math.abs(gap) <= tolerance) {
    return `The balance sheet foots: total assets ${fmtMoney(assets)} against liabilities and equity of ${fmtMoney(other)}.`;
  }
  return `The balance sheet does not foot: total assets ${fmtMoney(assets)} against liabilities and equity of ${fmtMoney(other)}, a difference of ${fmtMoney(Math.abs(gap))}.`;
}
