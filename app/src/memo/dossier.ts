/* =============================================================================
   THE DOSSIER BUILDER — the cockpit's bundle becomes the memo's dossier.

   `vendor/render/assemble-memo.mjs` builds this object from the plugin's own
   bundled nCino stub. This builds the SAME object from the cockpit's live
   BorrowerBundle plus the executed plan steps read back from the org. The
   renderer cannot tell the difference, which is the point: one renderer, two
   producers, and the memo the room shows is the memo the plugin ships.

   TWO RULES GOVERN EVERY FIELD BELOW.

   1. PROVENANCE. Every figure traces to a source system and, where the read
      carries one, to a record id: nCino through `Customer360*`, Boom through
      `bundle.boom`, the executed plan steps through the org's staging rows. The
      renderer stamps the provenance chips and the record deep-links from
      `borrower.instanceUrl` + `salesforceAccountId` + each loan's `ncinoId`, so
      those three are what make the memo's own citations real.

   2. NO ESTIMATES. A figure the bundle does not carry becomes the plugin's own
      marker, `[not in source system; flagged for RM]`, and a whole table the
      bundle cannot fill becomes empty rather than borrowing the plugin's demo
      content. The one thing this builder will not do is produce a number that
      looks sourced and is not.

   The AFS and peers placeholders ARE carried through from the vendored assets,
   because that is what the plugin does and the renderer labels every section
   they feed with a dashed "stub" provenance chip. They announce themselves.
   ============================================================================= */

import type { Boom, BorrowerBundle, CollateralValuationRow, Covenant, Facility } from "../data/contract";
import { fmtMoney } from "../data/format";
import icRaw from "./vendor/plugin-assets/ic_placeholder.json?raw";
import peersRaw from "./vendor/plugin-assets/peers_placeholder.json?raw";
import narrativesRaw from "./vendor/plugin-assets/piedmont-narratives.json?raw";
import {
  NOT_IN_SOURCE,
  type Figure,
  type MemoAfs,
  type MemoAttestation,
  type MemoBoom,
  type MemoChange,
  type MemoCollateralRecord,
  type MemoCovenantCompliance,
  type MemoDossier,
  type MemoFlags,
  type MemoGuarantor,
  type MemoIc,
  type MemoLoan,
  type MemoNarratives,
  type MemoPeers,
  type MemoRatios,
  type MemoRelationshipContext,
  type MemoSeries,
  type MemoSpread,
  type Text,
} from "./types";

/** The plugin's AFS stand-in. Carries the account it was written against. */
const IC_PLACEHOLDER = JSON.parse(icRaw) as MemoIc & { externalUniqueId?: string };
/** The plugin's CapIQ/IBIS stand-in: peer set, medians, industry outlook. */
export const PEERS_PLACEHOLDER = JSON.parse(peersRaw) as MemoPeers;
/**
 * The plugin's written analyst prose.
 *
 * PROSE ABOUT ONE BORROWER. It is applied only to the account the plugin wrote
 * it for — `IC_PLACEHOLDER.externalUniqueId`, which is the same Salesforce
 * account id the cockpit stages — and to every other relationship the narrative
 * keys are simply absent, so the renderer prints its own "pending; complete in
 * the per-section review" gaps. Borrowing one borrower's write-up for another is
 * the single worst thing a memo tool could do.
 */
export const VENDORED_NARRATIVES = JSON.parse(narrativesRaw) as MemoNarratives;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
/** A figure, or the marker. Never a substitute number. */
const fig = (v: unknown): Figure => num(v) ?? NOT_IN_SOURCE;
/** Text, or the marker. */
const text = (v: unknown): Text => str(v) ?? NOT_IN_SOURCE;

/* -----------------------------------------------------------------------------
   BOOM — the UUID-keyed spread file becomes the label-keyed one the renderer reads.

   Ported from assemble-memo.mjs's Boom adapter, rule for rule: the same account
   codes, the same name fallbacks, the same per-statement scale test, the same
   EBITDA = operating profit + D&A and total debt = short-term + long-term. The
   renderer's `li(statementType, accountCode)` reads the result, and the period
   labels it keys on are the ones the Financials tab already shows.
   ----------------------------------------------------------------------------- */

interface RawPeriod {
  id: string;
  endDate: string;
}
interface RawLineItem {
  accountCode: string | null;
  name?: string;
  periodValues?: Record<string, number | null>;
}
interface RawStatement {
  statementType?: string;
  periods?: RawPeriod[];
  lineItems?: RawLineItem[];
}

const fy = (endDate: string): string => {
  const m = String(endDate).match(/(\d{4})/);
  return m ? `FY${m[1]}` : String(endDate);
};

const sortedPeriods = (st: RawStatement | undefined): RawPeriod[] =>
  [...(st?.periods ?? [])].sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));

/**
 * Thousands or units. Boom emits some statements scaled; if nothing on the
 * statement reaches a million, the statement is in thousands. The plugin's rule,
 * kept verbatim so the memo and the plugin scale identically.
 */
function scaleOf(st: RawStatement | undefined): number {
  const vals = (st?.lineItems ?? [])
    .flatMap((li) => Object.values(li.periodValues ?? {}))
    .map((v) => Math.abs(num(v) ?? 0))
    .filter((v) => v > 0);
  const max = vals.length ? Math.max(...vals) : 0;
  return max && max < 1e6 ? 1000 : 1;
}

/**
 * The line item matching one of `codes`, else the first whose name matches.
 *
 * THE CODE WINS OVER THE NAME, AND THAT IS A DIVERGENCE FROM THE PLUGIN
 * (2026-09-13, founder report on the Key Metrics table). The plugin's adapter
 * takes the first line item matching EITHER, which on a real Boom chart is the
 * wrong line: Boom names the short-term line "Line of Credit and Current
 * Portion of Long-Term Debt", the long-term fallback regex matches it, and it
 * sits above the real long-term line. Total debt then double-counted the
 * short-term balance and dropped the long-term one (Piedmont FY2025: $11.35M
 * instead of $20.13M), so the memo printed leverage of 2.17x in Key Metrics
 * while the Executive Summary printed Boom's own 3.85x for the same as of
 * period. An account code is an explicit mapping; a name regex is the fallback
 * for a chart that carries no code, and a fallback must not outrank a mapping.
 */
function series(st: RawStatement | undefined, codes: string[], nameRe?: RegExp): MemoSeries {
  if (!st) return {};
  const items = st.lineItems ?? [];
  const li =
    items.find((x) => x.accountCode != null && codes.includes(x.accountCode)) ??
    (nameRe ? items.find((x) => nameRe.test(x.name ?? "")) : undefined);
  if (!li) return {};
  const k = scaleOf(st);
  const out: MemoSeries = {};
  for (const p of sortedPeriods(st)) {
    const v = num(li.periodValues?.[p.id]);
    out[fy(p.endDate)] = v == null ? null : v * k;
  }
  return out;
}

/** The label-keyed spread, and the Boom payload the renderer indexes into. */
export function adaptBoomSpread(file: unknown): { spread: MemoSpread; boom: MemoBoom } {
  const statements = ((file as { financialStatements?: RawStatement[] } | null)?.financialStatements ?? []) as RawStatement[];
  // Where a type appears twice, the richer statement wins — the plugin's tiebreak.
  const pick = (type: string) =>
    statements
      .filter((s) => s.statementType === type)
      .sort((a, b) => (b.lineItems?.length ?? 0) - (a.lineItems?.length ?? 0))[0];

  const is = pick("income_statement");
  const bs = pick("balance_sheet");
  const cf = pick("cash_flow_statement");
  const periods = sortedPeriods(is ?? bs ?? cf).map((p) => fy(p.endDate));

  const da = (() => {
    for (const st of [cf, is, bs]) {
      const s = series(st, [], /deprecia|amortiz/i);
      if (Object.keys(s).length) return s;
    }
    return {} as MemoSeries;
  })();
  const op = series(is, ["operating_profit"], /income from operations|operating (income|profit)/i);
  const ebitda: MemoSeries = {};
  for (const p of periods) {
    const o = op[p];
    ebitda[p] = o != null ? o + (da[p] ?? 0) : null;
  }

  const stDebt = series(bs, ["st_loans_payable_bank", "short_term_debt"], /line of credit|current portion/i);
  const ltDebt = series(bs, ["long_term_debt_bank", "long_term_debt"], /long.?term debt/i);
  const totalDebt: MemoSeries = {};
  for (const p of periods) {
    const a = stDebt[p];
    const b = ltDebt[p];
    if (a != null || b != null) totalDebt[p] = (a ?? 0) + (b ?? 0);
  }

  const spread: MemoSpread = {
    periods,
    incomeStatement: {
      sales_revenue: series(is, ["net_sales_revenue", "sales_revenue", "total_revenue"], /net sales|sales revenue|^revenue$|total revenue/i),
      cost_of_sales: series(is, ["cost_of_sales"], /cost of (sales|goods)/i),
      gross_profit: series(is, ["gross_profit"], /gross profit/i),
      operating_profit: op,
      depreciation_amortization: da,
      adjusted_ebitda: ebitda,
      interest_expense: series(is, ["interest_expense"], /interest expense/i),
      net_income: series(is, ["net_income"], /^net income$/i),
    },
    balanceSheet: {
      cash_and_equivalents: series(bs, ["cash_and_equivalents"]),
      accounts_receivable: series(bs, ["accounts_receivable_trade"]),
      inventory: series(bs, ["total_inventory"]),
      total_assets: series(bs, ["total_assets"]),
      total_debt: totalDebt,
      total_equity: series(bs, ["total_equity"]),
    },
    cashFlow: {
      operating_cash_flow: series(cf, [], /net cash.*operating/i),
      capital_expenditures: series(cf, [], /purchase[s]? of property|capital expenditure/i),
    },
  };

  return { spread, boom: boomFrom(spread, "C360-BOOM-ADAPTED") };
}

/** The payload `li(statementType, accountCode)` indexes into, built from a spread. */
function boomFrom(spread: MemoSpread, source: string): MemoBoom {
  const stmt = (statementType: string, section: Record<string, MemoSeries>) => ({
    statementType,
    endDate: "",
    periods: spread.periods,
    lineItems: Object.entries(section).map(([accountCode, values]) => ({
      accountCode,
      name: accountCode,
      hierarchy: /total|gross_profit|ebit|net_income|free_cash_flow/.test(accountCode) ? "subtotal" : "line_item",
      periodValues: values,
    })),
  });
  return {
    files: {
      f: {
        _source: source,
        financialStatements: [
          stmt("income_statement", spread.incomeStatement),
          stmt("balance_sheet", spread.balanceSheet),
          stmt("cash_flow_statement", spread.cashFlow),
        ],
      },
    },
  };
}

/* -----------------------------------------------------------------------------
   THE DISPLAY BOOK: a relationship Boom has spread, with no raw file staged.

   `boom.spread.file` is the verbatim `boom_get_spread` payload, and a bundle
   that carries one gets the full adaptation above: three statements, every
   account code, the whole period axis. NOT EVERY BUNDLE CARRIES ONE. Hartwell's
   Boom block stages the DISPLAY form the Financials tab reads — a period series
   (revenue, EBITDA, margin per FY) and a line-item summary (LTM and prior FY) —
   and nothing else.

   Those are figures on the book with a source file named beside them, not
   estimates, so the memo prints them. What it does NOT do is fabricate a Boom
   file to get there: the balance sheet and the cash-flow statement stay EMPTY,
   because a display book carries neither, and the renderer's own gap cells
   ("flagged for RM") are what a reader meets in the rows they would have filled.
   Leverage, cash and free cash flow are gaps on a display-only borrower, and
   they say so.

   THE SOURCE TRAVELS. `_source` names the display book rather than the
   adaptation, so a later reader can tell the two apart. The renderer does not
   print it today; see the vendor-side note in the gap audit.
   ----------------------------------------------------------------------------- */

/** The display book's own line names, to the account codes the renderer reads.
 *  A line that is not here has no cell in the memo and is simply not carried. */
const DISPLAY_LINES: Record<string, string> = {
  "gross profit": "gross_profit",
  "net income": "net_income",
  "interest expense": "interest_expense",
};

function displaySpread(boom: Boom | undefined): { spread: MemoSpread; boom: MemoBoom } | null {
  const rows = (boom?.spread?.periods ?? []).filter((p) => str(p.period));
  if (!rows.length) return null;
  const periods = rows.map((p) => String(p.period));

  const sales_revenue: MemoSeries = {};
  const adjusted_ebitda: MemoSeries = {};
  rows.forEach((p, i) => {
    sales_revenue[periods[i]] = num(p.revenue);
    adjusted_ebitda[periods[i]] = num(p.ebitda);
  });

  // The line-item summary carries TWO columns and the period axis says which
  // two they are: `ltm` is the last period on the axis and `priorFy` the one
  // before it. A one-period axis has no prior column, so only `ltm` lands.
  const ltmLabel = periods[periods.length - 1];
  const priorLabel = periods.length > 1 ? periods[periods.length - 2] : null;
  const incomeStatement: Record<string, MemoSeries> = { sales_revenue, adjusted_ebitda };
  for (const l of boom?.spread?.lineItems ?? []) {
    const code = DISPLAY_LINES[String(l.line ?? "").trim().toLowerCase()];
    if (!code) continue;
    const series: MemoSeries = {};
    if (num(l.ltm) != null) series[ltmLabel] = num(l.ltm);
    if (priorLabel && num(l.priorFy) != null) series[priorLabel] = num(l.priorFy);
    if (Object.keys(series).length) incomeStatement[code] = series;
  }

  const spread: MemoSpread = { periods, incomeStatement, balanceSheet: {}, cashFlow: {} };
  return { spread, boom: boomFrom(spread, "Boom, as displayed on the cockpit's book") };
}

/** The spread the memo's period axis is built from: the raw file where the
 *  bundle stages one, the display book where it does not, empty where neither. */
function financialsFrom(boom: Boom | undefined): { spread: MemoSpread; boom: MemoBoom } {
  const adapted = adaptBoomSpread(boom?.spread?.file);
  if (adapted.spread.periods.length) return adapted;
  return displaySpread(boom) ?? adapted;
}

/* -----------------------------------------------------------------------------
   COVENANTS — nCino's rows become the compliance table the renderer prints.
   ----------------------------------------------------------------------------- */

/**
 * `>=` or `<=`, which decides whether a cushion is headroom or a breach.
 *
 * nCino's read carries the threshold and the actual but not the direction, so it
 * is inferred from the covenant's own name and then CHECKED AGAINST THE ORG'S
 * OWN VERDICT: if nCino says compliant and the inferred operator would call that
 * a breach (or the reverse), the operator is flipped, because the org's
 * evaluation is the authority and the operator is the thing being guessed.
 * Where the org has no verdict to check against, the name-derived answer stands.
 */
export function inferOperator(c: Covenant): ">=" | "<=" {
  const name = c.covenantType ?? "";
  const byName: ">=" | "<=" = /\b(limit|maximum|max\b|not to exceed|debt.to|leverage)\b/i.test(name) ? "<=" : ">=";
  const actual = num(c.actualValue);
  const threshold = num(c.thresholdValue);
  const verdict = c.breached === true ? false : c.breached === false ? true : /compliant/i.test(c.lastEvaluationStatus ?? "") ? true : null;
  if (actual == null || threshold == null || verdict == null) return byName;
  const holds = (op: ">=" | "<=") => (op === ">=" ? actual >= threshold : actual <= threshold);
  if (holds(byName) === verdict) return byName;
  const flipped: ">=" | "<=" = byName === ">=" ? "<=" : ">=";
  return holds(flipped) === verdict ? flipped : byName;
}

/**
 * `$` or `x`. A coverage or leverage covenant is a small multiple; a liquidity
 * or spend covenant is money. Nothing in the org's read says which, and getting
 * it wrong misprints the figure rather than inventing one, so the test is the
 * threshold's own magnitude: no ratio covenant is set in the thousands.
 */
const unitOf = (c: Covenant): "$" | "x" => (Math.abs(num(c.thresholdValue) ?? 0) >= 1000 ? "$" : "x");

function covenantCompliance(covenants: Covenant[], asOf: string): MemoCovenantCompliance[] {
  return covenants.map((c) => {
    const actual = num(c.actualValue);
    const flag = c.breached === true ? "breach" : /compliant/i.test(c.lastEvaluationStatus ?? "") ? "compliant" : "n/a";
    return {
      name: c.covenantType ?? NOT_IN_SOURCE,
      type: "Financial",
      unit: unitOf(c),
      operator: inferOperator(c),
      trigger: num(c.thresholdValue) ?? undefined,
      frequency: c.frequency,
      // ONE period, because the read carries one measured actual. A trend line
      // across quarters the org never returned would be a drawn guess. The
      // period is the covenant's OWN last evaluation date where it has one:
      // four covenants tested on four different dates are four periods, and
      // labelling them all with the spread's as-of date said otherwise.
      quarters: [str(c.lastEvaluationDate) ?? asOf],
      actuals: [actual],
      perPeriod: [{ value: actual, flag, arrow: "" }],
      currentFlag: flag,
      actual,
    };
  });
}

/* -----------------------------------------------------------------------------
   FACILITIES — the org's current state, plus what the executed plan changed.
   ----------------------------------------------------------------------------- */

const REVOLVER = /revolv|rcf|line of credit|working capital/i;
const isRevolver = (f: Facility) => REVOLVER.test(`${f.productType ?? ""} ${f.name ?? ""}`);

/**
 * A facility's before and after.
 *
 * The changes handed in are EXECUTED steps, so the org's current values ARE the
 * after. The before is the step's own `before` block, which is the only place it
 * survives. A facility no step touched has the same figures on both sides, and a
 * step with no `before` created the facility, so its before side is zero rather
 * than a repeat of the after.
 */
function sidesFor(f: Facility, steps: MemoChange[]) {
  const mine = steps.filter((s) => s.target.id && s.target.id === f.loanId);
  const created = mine.some((s) => !s.before);
  const firstBefore = mine.find((s) => s.before)?.before;

  const proposed = {
    commitment: fig(f.committed),
    outstanding: fig(f.outstanding),
    maturity: str(f.maturityDate),
  };
  // A KEY ABSENT FROM `before` WAS NOT PART OF THE CHANGE, which is not the
  // same fact as a key the step set to null (contract.ts, MemoChangeFields). A
  // step that moved the commitment and left the outstanding alone carries no
  // `outstanding`, and the outstanding that did not move is the org's own
  // current figure: writing the gap marker there said the bank does not know a
  // balance it is showing two columns to the right.
  const b = firstBefore;
  const existing = created
    ? { commitment: 0 as Figure, outstanding: 0 as Figure, maturity: null }
    : {
        commitment: b && "commitment" in b ? fig(b.commitment) : proposed.commitment,
        outstanding: b && "outstanding" in b ? fig(b.outstanding) : proposed.outstanding,
        maturity: b && "maturity" in b ? str(b.maturity) : proposed.maturity,
      };

  const before = num(existing.commitment);
  const after = num(proposed.commitment);
  return {
    existing,
    proposed,
    isNewMoney: created,
    isIncrease: !created && before != null && after != null && after > before,
    isRenewal: mine.length > 0 && !created,
  };
}

function toLoan(f: Facility, steps: MemoChange[]): MemoLoan {
  const sides = sidesFor(f, steps);
  return {
    id: f.loanId ?? f.name ?? "facility",
    ncinoId: f.loanId ?? null,
    name: f.name ?? NOT_IN_SOURCE,
    purpose: text(f.productType),
    riskRating: text(f.riskGrade),
    isNewMoney: sides.isNewMoney,
    isIncrease: sides.isIncrease,
    isRenewal: sides.isRenewal,
    existing: sides.existing,
    proposed: sides.proposed,
    productType: f.productType,
  };
}

/* -----------------------------------------------------------------------------
   THE REST OF canon
   ----------------------------------------------------------------------------- */

/**
 * THE VALUATION CLOCK ON ONE ASSET, as one clause.
 *
 * The renderer's collateral table has four columns and none of them is a date,
 * so a credit officer reading it cannot tell a warehouse appraised this quarter
 * from one appraised three years ago. The valuation rides in the description
 * cell instead, verbatim off `bundle.collateralValuations` and never derived:
 * the basis, the date it was struck, who struck it, and the org's own next
 * revaluation date. An asset with no staged valuation gets no clause.
 */
function valuationClause(v: CollateralValuationRow | undefined): string | null {
  if (!v) return null;
  const parts = [
    str(v.valuationDate) ? `valued ${str(v.valuationDate)}` : null,
    str(v.valuationType) ? `${str(v.valuationType)} basis` : null,
    str(v.valuationSource) ? `source ${str(v.valuationSource)}` : null,
    str(v.nextRevaluationDue) ? `next revaluation due ${str(v.nextRevaluationDue)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function collateralRecords(facilities: Facility[], valuations: readonly CollateralValuationRow[]): MemoCollateralRecord[] {
  const byCollateral = new Map(valuations.map((v) => [v.collateralId, v]));
  return facilities.flatMap((f) =>
    (f.collateral ?? []).map((c) => {
      const base = str(c.collateralDescription) ?? str(c.collateralName);
      // The org's autonumber and the valuation clock, appended to the org's own
      // description. Both are facts on the pledge's asset; the description cell
      // is the only place in the renderer's table that can carry them.
      const tail = [str(c.collateralName), valuationClause(byCollateral.get(c.collateralId ?? ""))]
        .filter(Boolean)
        .join("; ");
      return {
        loan: f.name,
        description: base ? (tail ? `${base} (${tail})` : base) : NOT_IN_SOURCE,
        // The whole asset's lendable value, never the summed pledges: a
        // cross-pledged asset repeats its lendable value on every pledge row.
        value: num(c.currentLendableValue) ?? num(c.collateralValue),
        // The read carries an ADVANCE RATE, which is not a coverage percentage.
        // Rendering one as the other would be a wrong figure, so this stays empty
        // and the renderer prints an em dash.
        coveragePct: null,
        lienPosition: text(c.lienPosition),
      };
    }),
  );
}

/**
 * The guarantor, off the package's legal-entity rows.
 *
 * THE GUARANTY TYPE IS `guarantyAmountType`, NOT `relationshipType`. nCino
 * records what the guaranty covers (Unlimited, Limited) on the first and what
 * form it takes (Personal Guaranty) on the second, and Hartwell's rows carry
 * the first and leave the second null — so reading only the second printed an
 * unlimited corporate guaranty as a gap. Both are used where both are present,
 * and the clause says which is which.
 */
function guarantorFrom(bundle: BorrowerBundle): MemoGuarantor | null {
  const entity = (bundle.graph?.legalEntities ?? []).find((e) => /guarantor/i.test(e.borrowerType ?? ""));
  if (!entity) return null;
  const amount = str(entity.guarantyAmountType);
  const relationship = str(entity.relationshipType);
  const guaranty = [amount, relationship].filter(Boolean).join(", ");
  return {
    type: /personal|individual/i.test(relationship ?? "") ? "individual" : "entity",
    name: entity.accountName ?? NOT_IN_SOURCE,
    guarantyType: guaranty || NOT_IN_SOURCE,
  };
}

/**
 * THE DOCUMENTS THE COCKPIT CAN ACTUALLY NAME.
 *
 * The appendix index was empty on every relationship, because nothing on the
 * cockpit's grant reads nCino DocMan. Two things it does read ARE documents:
 * the Boom spread file every figure in the financial section was read off, and
 * each collateral valuation on the book. Naming those two is the difference
 * between an appendix that says nothing and one that says what the memo stands
 * on. Everything else in DocMan stays off this list rather than being guessed.
 */
function supportingDocuments(bundle: BorrowerBundle): Array<{ name: string; status?: string }> {
  const out: Array<{ name: string; status?: string }> = [];
  const spreadFile = str(bundle.boom?.spread?.sourceFile);
  if (spreadFile) out.push({ name: `Boom spread: ${spreadFile}`, status: "On file" });
  for (const v of bundle.collateralValuations ?? []) {
    const clause = valuationClause(v);
    const name = str(v.valuationName) ?? v.collateralId;
    out.push({ name: `Collateral valuation ${name}${clause ? `: ${clause}` : ""}`, status: "On file" });
  }
  return out;
}

/**
 * THE BORROWER, IN THE ACCOUNT RECORD'S OWN FIELDS.
 *
 * `profile` is the floor the Borrower Description module renders under when no
 * analyst prose has been written yet, and it was the marker on every
 * relationship — which read as "the bank knows nothing about this borrower"
 * while the account record carried its industry, its NAICS code and its annual
 * revenue. Those three are stated, in the org's own words and figures, and
 * nothing is inferred from them. A snapshot carrying none of the three is still
 * the marker.
 */
function profileFrom(bundle: BorrowerBundle): Text {
  const s = bundle.snapshot;
  const parts = [
    str(s.industry) ? `Industry ${str(s.industry)} on the account record` : null,
    str(s.naicsCode) ? `NAICS ${str(s.naicsCode)}` : null,
    num(s.annualRevenue) != null ? `annual revenue ${fmtMoney(num(s.annualRevenue))}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : NOT_IN_SOURCE;
}

/**
 * THE FIVE THINGS THE BOOK CARRIES AND THE MEMO HAD NO COLUMN FOR.
 *
 * See `MemoRelationshipContext`. Nothing here reaches the rendered tables: it
 * reaches the FIGURES block the narrative is written against, which is the only
 * way ownership, coverage, structural signals, opportunities and the proof that
 * an executed step landed can get into the memo's prose at all. Every line is
 * one bundle field, stated. A list the bundle cannot fill is absent, not empty.
 */
function relationshipContext(bundle: BorrowerBundle, changes: readonly MemoChange[]): MemoRelationshipContext | undefined {
  const some = (xs: string[]) => (xs.length ? xs : undefined);

  // DEDUPED. The legal-entity read returns one row PER FACILITY, so one
  // guarantor on a nine-facility package arrives nine times, and nine identical
  // lines in a prompt are nine chances to read them as nine parties.
  const ownership = [
    ...new Set([
      ...(bundle.graph?.connections ?? [])
        .filter((c) => str(c.counterpartyName) && num(c.totalOwnershipPercent))
        .map((c) => `${c.counterpartyName}: ${c.role ?? "connected party"}, ${num(c.totalOwnershipPercent)}% ownership.`),
      ...(bundle.graph?.legalEntities ?? [])
        .filter((e) => /guarantor/i.test(e.borrowerType ?? ""))
        .map((e) => `${e.accountName}: ${e.borrowerType}${e.guarantyAmountType ? `, ${e.guarantyAmountType}` : ""}.`),
    ]),
  ];

  const ex = bundle.exposure;
  const coverage = [
    num(ex?.coverageRatio) != null
      ? `Relationship collateral coverage ${num(ex?.coverageRatio)!.toFixed(2)}x over ${ex?.uniqueCollateralCount ?? 0} distinct assets, ${fmtMoney(num(ex?.totalUniqueCollateralLendableValue))} lendable.`
      : null,
    ...(ex?.facilities ?? []).map((f) => (str(f.coverageNote) ? `${f.name}: ${str(f.coverageNote)}` : null)),
  ].filter(Boolean) as string[];

  const sig = bundle.signals;
  const signals = [
    (sig?.modifications ?? []).length
      ? `${sig!.modifications!.length} recorded loan modification${sig!.modifications!.length === 1 ? "" : "s"}${sig?.modificationClusterFlag ? ", flagged as a cluster" : ""}.`
      : null,
    // THE IN-FLIGHT PACKAGE VERSION. A revision open on the package is what a
    // credit officer means by "is something already moving on this deal".
    ...(sig?.renewals ?? []).map(
      (r) =>
        `Package revision ${r.revisionNumber ?? NOT_IN_SOURCE}, status ${r.revisionStatus ?? NOT_IN_SOURCE}${r.hasActiveRenewalLoan ? ", with an active renewal facility" : ""}.`,
    ),
    ...(sig?.maturityWatch ?? []).map((m) => `Maturity watch: ${m.name ?? m.loanId} matures ${m.maturityDate ?? NOT_IN_SOURCE}.`),
    // One line per guarantor, not one per facility, and only where the signal
    // carries something: a grade the org has not set is the ownership list's
    // business, not an early-warning line that says nothing.
    ...[...new Map((sig?.guarantorSignals ?? []).map((g) => [g.guarantorName, g])).values()]
      .filter((g) => g.highestRiskGrade != null || str(g.riskStatus))
      .map(
        (g) =>
          `Guarantor ${g.guarantorName}: ${[
            g.highestRiskGrade != null ? `highest risk grade ${g.highestRiskGrade}` : null,
            str(g.riskStatus) ? `status ${str(g.riskStatus)}` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`,
      ),
  ].filter(Boolean) as string[];

  const opportunities = (bundle.opportunities?.opportunities ?? []).map(
    (o) =>
      `${o.name}: ${o.stage ?? NOT_IN_SOURCE}, ${fmtMoney(num(o.amount))}${o.probability != null ? `, ${o.probability}% probability` : ""}${o.closeDate ? `, close ${String(o.closeDate).slice(0, 10)}` : ""}.`,
  );

  const priorActions = changes.map((c) => `${c.label}${c.verification ? ` (verified: ${c.verification})` : ""}.`);

  const context: MemoRelationshipContext = {
    ownership: some(ownership),
    coverage: some(coverage),
    signals: some(signals),
    opportunities: some(opportunities),
    priorActions: some(priorActions),
  };
  return Object.values(context).some(Boolean) ? context : undefined;
}

function ratiosFrom(bundle: BorrowerBundle): MemoRatios | undefined {
  const r = bundle.boom?.ratios;
  const raw = r?.raw;
  if (!r && !raw) return undefined;
  return {
    revenue: num(raw?.revenue) ?? num(r?.revenue),
    revenueYoYPct: num(raw?.revenueYoY) != null ? (raw!.revenueYoY as number) * 100 : null,
    ebitda: num(raw?.ebitda) ?? num(r?.ebitda),
    // Boom emits the margin as a FRACTION in `raw` and the seam already scaled
    // the display copy to a percent; take the raw one and scale it here so the
    // memo and the Financials tab cannot disagree by a factor of a hundred.
    ebitdaMarginPct: num(raw?.ebitdaMargin) != null ? (raw!.ebitdaMargin as number) * 100 : num(r?.ebitdaMargin),
    grossMarginPct: num(raw?.grossMargin) != null ? (raw!.grossMargin as number) * 100 : null,
    totalLeverage: num(raw?.leverage) ?? num(r?.totalLeverage),
    totalDebt: num(raw?.totalDebt),
    interestCoverage: num(raw?.interestCoverage) ?? num(r?.interestCoverage),
    asOf: str(r?.asOf),
  };
}

/**
 * WHICH COLUMN ON THE PERIOD AXIS THE RATIO SET BELONGS TO.
 *
 * Boom strikes ONE ratio set, for one period, and `asOf` is the date it struck
 * it. The memo's axis is fiscal labels, so the date is resolved to a label and
 * checked against the axis: a set struck on a period the memo does not print
 * belongs to no column and is stated in none of them.
 *
 * WHERE THE SET CARRIES NO DATE the book's own latest period owns it. A display
 * book states its ratios off the last column it carries (Hartwell's LTM), and
 * that is the only column they can honestly be placed in. A ratio set with no
 * date AND no figures owns nothing.
 */
export function ratiosPeriodOf(spread: MemoSpread, ratios: MemoRatios | undefined): string | null {
  if (!ratios) return null;
  const asOf = str(ratios.asOf);
  if (asOf) {
    const label = fy(asOf);
    return spread.periods.includes(label) ? label : null;
  }
  const stated = num(ratios.revenue) != null || num(ratios.ebitda) != null || num(ratios.totalLeverage) != null;
  return stated ? (spread.periods[spread.periods.length - 1] ?? null) : null;
}

/**
 * nCino's collateral type becomes one of the manifest's four.
 *
 * The manifest's Collateral module has no unconditional component: every one of
 * them keys off `collateral_types includes '<tag>'`, and a module whose every
 * component is off is SUPPRESSED WHOLE. So a relationship whose pledges carry
 * nCino's own vocabulary ("UCC-Equipment", "Real Estate-Warehouse") and not the
 * manifest's would lose its collateral section entirely — with the pledges
 * sitting right there in the bundle. Mapping is what keeps the section.
 *
 * WHERE IT IS UNKNOWABLE IT TAKES THE NARROWER READING. A UCC pledge with no
 * description could be a blanket lien or a specific filing; it is tagged
 * `specific_ucc`, because claiming an all-asset lien the read does not evidence
 * would overstate the bank's security.
 */
export function collateralTag(type: string | null, description: string | null): string {
  const t = `${type ?? ""} ${description ?? ""}`;
  if (/real estate|mortgage|\bproperty\b|\bcre\b|warehouse|land|building/i.test(t)) return "real_estate";
  if (/equip|machin/i.test(t)) return "equipment";
  if (/blanket|all (?:present and future |business )?assets/i.test(description ?? "")) return "blanket_lien";
  return "specific_ucc";
}

function flagsFrom(bundle: BorrowerBundle, loans: MemoLoan[], guarantor: MemoGuarantor | null): MemoFlags {
  const facilities = bundle.exposure?.facilities ?? [];
  const types = [
    ...new Set(
      facilities.flatMap((f) =>
        (f.collateral ?? []).map((c) => collateralTag(str(c.collateralType), str(c.collateralDescription))),
      ),
    ),
  ];
  return {
    has_new_money: loans.some((l) => l.isNewMoney || l.isIncrease),
    has_revolver: facilities.some(isRevolver),
    has_revolver_increase: facilities.some((f) => isRevolver(f) && loans.find((l) => l.ncinoId === f.loanId)?.isIncrease === true),
    has_guarantor: guarantor != null,
    guarantor_types: guarantor ? [guarantor.type] : [],
    has_financial_covenants: (bundle.covenants?.covenants ?? []).length > 0,
    collateral_types: types,
    has_real_estate: types.includes("real_estate"),
    // NOT EVIDENCED IN THE BUNDLE. False here switches the module off as
    // SUPPRESSED, which is not a gap: there is nothing for a banker to complete.
    // The day a read carries deposits, syndication or sponsor ownership, these
    // stop being constants.
    has_deposits: false,
    has_retained_earnings_adj: false,
    is_syndicated: false,
    is_peg: false,
    is_lft: false,
    is_public: false,
    exposure_total: num(bundle.exposure?.totalCommitted) ?? 0,
    sbe_threshold_breached: false,
  };
}

/* -----------------------------------------------------------------------------
   THE BUILDER
   ----------------------------------------------------------------------------- */

export interface BuildDossierOptions {
  /** The relationship, as the cockpit staged it. */
  bundle: BorrowerBundle;
  /**
   * The executed plan steps, read back from the org. Phase B supplies these
   * from the staging rows; an empty list is a legitimate state and renders a
   * memo that says no change was executed, rather than one that invents one.
   */
  changes?: MemoChange[];
  /** `meta.instanceUrl`. Without it the memo carries no record deep-links, and says so by omitting them. */
  instanceUrl?: string | null;
  /** The nCino Product Package name. Absent becomes the marker. */
  productPackageName?: string | null;
  /** Manifest credit-event id. Defaults to an existing relationship with a material event. */
  creditEvent?: string;
  /** "core" or "enhanced". */
  tier?: string;
  /** Prior per-section sign-offs, replayed so a re-render never wipes the checklist. */
  attestation?: MemoAttestation;
  /** Analyst prose. Defaults to the vendored narratives, and only for the account they were written for. */
  narratives?: MemoNarratives;
}

/**
 * Build the dossier the plugin's renderer consumes.
 *
 * Nothing here calls a tool or a network. It is a pure function of the bundle,
 * the executed changes and the vendored placeholders, which is what lets the
 * golden parity test hold it to a byte.
 */
export function buildMemoDossier(options: BuildDossierOptions): MemoDossier {
  const { bundle, changes = [], instanceUrl = null, attestation } = options;
  const snapshot = bundle.snapshot;
  const facilities = bundle.exposure?.facilities ?? [];

  const loans = facilities.map((f) => toLoan(f, changes));
  const collateral = collateralRecords(facilities, bundle.collateralValuations ?? []);
  const guarantor = guarantorFrom(bundle);
  const { spread, boom } = financialsFrom(bundle.boom);
  const measured = ratiosFrom(bundle);
  // The ratio set travels with the column it was measured in, so a table can
  // state it there and mark the rest. See `ratiosPeriodOf`.
  const ratios = measured ? { ...measured, period: ratiosPeriodOf(spread, measured) } : undefined;

  // The org's totals are the AFTER, because the steps have executed. The BEFORE
  // is the after less what the steps moved, so the two sides and the delta are
  // one arithmetic rather than three sources that can disagree.
  const delta = loans.reduce((sum, l) => {
    const before = num(l.existing.commitment);
    const after = num(l.proposed.commitment);
    return before != null && after != null ? sum + (after - before) : sum;
  }, 0);
  const proposedCommitment = fig(bundle.exposure?.totalCommitted);
  const proposedOutstanding = fig(bundle.exposure?.totalOutstanding);
  const existingCommitment: Figure = num(proposedCommitment) != null ? (proposedCommitment as number) - delta : NOT_IN_SOURCE;

  const changeNote = changes.length
    ? `${changes.length} executed plan step${changes.length === 1 ? "" : "s"} on this relationship: ${changes.map((c) => c.label).join("; ")}.`
    : "No executed plan step was handed to this memo, so existing and proposed exposure are the same figures.";

  const asOf = str(ratios?.asOf) ?? spread.periods[spread.periods.length - 1] ?? "Latest";

  // The vendored prose belongs to ONE borrower. Applied only to that borrower.
  const narratives =
    options.narratives ??
    (snapshot.accountId && snapshot.accountId === IC_PLACEHOLDER.externalUniqueId ? VENDORED_NARRATIVES : {});

  return {
    canon: {
      borrower: {
        name: snapshot.name ?? NOT_IN_SOURCE,
        naics: text(snapshot.naicsCode),
        // The Customer 360 reads carry the NAICS code and not its description.
        naicsDesc: NOT_IN_SOURCE,
        instanceUrl,
        salesforceAccountId: snapshot.accountId,
        currentRiskRating: text(snapshot.primaryRiskRating),
        // The account record's own industry, NAICS code and annual revenue.
        // No read carries a written business description; see profileFrom().
        profile: profileFrom(bundle),
      },
      creditAction: {
        productPackageName: text(options.productPackageName),
        creditEvent: options.creditEvent ?? "existing_material",
        tier: options.tier ?? "core",
        packageId: snapshot.productPackageId,
        flags: flagsFrom(bundle, loans, guarantor),
      },
      loans,
      exposureSummary: {
        existing: { commitment: existingCommitment, outstanding: proposedOutstanding },
        proposed: { commitment: proposedCommitment, outstanding: proposedOutstanding },
        changeInExposure: { commitment: delta, note: changeNote },
      },
      // Not one of these six fields is on any Customer 360 read today. Every one
      // of them is the marker, and the memo says so in the table where a credit
      // officer looks for them.
      creditApprovalSummary: {
        hrbDesignation: NOT_IN_SOURCE,
        hvcreApplicable: false,
        ureExceptions: NOT_IN_SOURCE,
        pastDueFinancialStatements: NOT_IN_SOURCE,
        csgFeedbackComplete: false,
        csgFlags: false,
      },
      spread,
      ratios,
      collateral,
      guarantor,
      narratives,
      // EMPTY, not the plugin's defaults. The plugin's lists are written
      // assessments of its own demo borrower; rendering them here would put
      // someone else's credit judgement under this borrower's name.
      riskMitigants: [],
      riskRatingFactors: [],
      // NOT empty any more: the spread file and the collateral valuations are
      // documents on the book, and they are the two the cockpit can name.
      supportingDocuments: supportingDocuments(bundle),
      // Read by narrative.ts, never by the renderer. See MemoRelationshipContext.
      context: relationshipContext(bundle, changes),
    },
    boom,
    // Servicing is not on the cockpit's grant. No `revolverUsage` means the
    // usage block does not render at all, which is the honest gap: the memo
    // shows no servicing trend rather than a modelled one.
    afs: { _source: "AFS-NOT-CONNECTED" } satisfies MemoAfs,
    ic: {
      ...IC_PLACEHOLDER,
      // The org's real covenants replace the placeholder's, because the cockpit
      // has them. Everything else in AFS is still the stub, and the renderer
      // chips it as one.
      covenantCompliance: covenantCompliance(bundle.covenants?.covenants ?? [], asOf),
      ratios: ratios?.totalLeverage != null ? [{ period: asOf, totalLeverage: ratios.totalLeverage }] : [],
      // No rating history and no scenario set on any read. Both blocks drop out
      // rather than draw a trend the org never returned.
      riskRatingTrend: { events: [] },
      sensitivity: { scenarios: [] },
    },
    peers: PEERS_PLACEHOLDER,
    attestation,
  };
}
