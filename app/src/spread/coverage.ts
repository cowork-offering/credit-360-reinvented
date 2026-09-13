/* =============================================================================
   INTEREST COVERAGE: ONE DEFINITION, ONE MODULE.

   The standing rule is that a derived ratio is cross-checked against the source
   system's own ratio set before it is printed, and that one ratio has ONE
   definition on the page. Interest coverage had two figures: the Spreading
   room's panel printed the drop's ratio and the Financials tab's Key ratios
   printed the book's, for the same provisional period, on the same page. This
   module is the definition every surface now reads.

   THE DEFINITION IS BOOM'S OWN, DERIVED FROM BOOM'S OWN NUMBERS.

     OPERATING PROFIT OVER INTEREST EXPENSE.

   NOT EBITDA over interest expense, which is the definition a reader expects
   and which Boom does not use. The proof is the Boom snapshot the cockpit
   ships, `client-360/assets/boom-spread.json` beside `boom-ratios.json`, for
   Piedmont's FY2025:

     operating profit                     2,838,000   (income statement)
     depreciation and amortisation        2,396,000   (cash-flow statement)
     interest expense                    -1,076,000   (income statement)
     Boom's `raw.ebitda`                  5,234,000 = 2,838,000 + 2,396,000
     Boom's `raw.interestCoverage`  2.637546468401487 = 2,838,000 / 1,076,000

   Boom's own EBITDA is the operating profit plus that depreciation row, to the
   dollar, and its own coverage is struck WITHOUT it: EBITDA over the same
   interest expense is 4.86, which is not the figure Boom publishes. So the
   numerator is the operating profit, and a module that reached for EBITDA
   because the name suggests it would disagree with the source system by two
   turns on the one relationship that carries both figures.

   THE SIGN IS NOT READ. Boom writes interest expense negative on one book and
   positive on another; a coverage ratio is a magnitude either way, so the
   denominator is the absolute value, and a zero denominator is no ratio at all.
   ============================================================================= */

import type { BoomFinancialStatement } from "./types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** THE RATIO. Null where either input is missing or the interest expense is
 *  zero, because a coverage figure resting on an invented input is worse than
 *  no coverage figure. */
export function interestCoverageOf(operatingProfit: number | null, interestExpense: number | null): number | null {
  if (operatingProfit === null || interestExpense === null) return null;
  const interest = Math.abs(interestExpense);
  if (!(interest > 0)) return null;
  return operatingProfit / interest;
}

/** The newest period end date these statements carry, or null where none of
 *  them dates a period. ISO dates, so string order is date order. */
export function newestEndDate(statements: readonly BoomFinancialStatement[]): string | null {
  let best: string | null = null;
  for (const statement of statements) {
    for (const period of statement.periods) {
      const end = period.endDate;
      if (typeof end !== "string" || !end) continue;
      if (!best || end.localeCompare(best) > 0) best = end;
    }
  }
  return best;
}

/** The first value any statement prints for `endDate` on that account code. */
function valueAt(statements: readonly BoomFinancialStatement[], endDate: string, accountCode: string): number | null {
  for (const statement of statements) {
    const ids = statement.periods.filter((p) => p.endDate === endDate).map((p) => p.id);
    if (!ids.length) continue;
    for (const line of statement.lineItems) {
      if (line.accountCode !== accountCode) continue;
      for (const id of ids) if (isNum(line.periodValues[id])) return line.periodValues[id] as number;
    }
  }
  return null;
}

/** Interest coverage for one period of a Boom-shaped spread, or null where the
 *  statements do not carry both inputs. */
export function interestCoverageAt(statements: readonly BoomFinancialStatement[], endDate: string): number | null {
  return interestCoverageOf(valueAt(statements, endDate, "operating_profit"), valueAt(statements, endDate, "interest_expense"));
}
