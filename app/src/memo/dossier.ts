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

import type { BorrowerBundle, Covenant, Facility } from "../data/contract";
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

/** The first line item matching one of `codes`, else the first whose name matches. */
function series(st: RawStatement | undefined, codes: string[], nameRe?: RegExp): MemoSeries {
  if (!st) return {};
  const li = (st.lineItems ?? []).find(
    (x) => (codes.length > 0 && x.accountCode != null && codes.includes(x.accountCode)) || (nameRe ? nameRe.test(x.name ?? "") : false),
  );
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
    spread,
    boom: {
      files: {
        f: {
          _source: "C360-BOOM-ADAPTED",
          financialStatements: [
            stmt("income_statement", spread.incomeStatement),
            stmt("balance_sheet", spread.balanceSheet),
            stmt("cash_flow_statement", spread.cashFlow),
          ],
        },
      },
    },
  };
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
      // across quarters the org never returned would be a drawn guess.
      quarters: [asOf],
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
  const existing = created
    ? { commitment: 0 as Figure, outstanding: 0 as Figure, maturity: null }
    : {
        commitment: firstBefore ? fig(firstBefore.commitment) : proposed.commitment,
        outstanding: firstBefore ? fig(firstBefore.outstanding) : proposed.outstanding,
        maturity: firstBefore && "maturity" in firstBefore ? str(firstBefore.maturity) : proposed.maturity,
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

function collateralRecords(facilities: Facility[]): MemoCollateralRecord[] {
  return facilities.flatMap((f) =>
    (f.collateral ?? []).map((c) => ({
      loan: f.name,
      description: str(c.collateralDescription) ?? str(c.collateralName) ?? NOT_IN_SOURCE,
      // The whole asset's lendable value, never the summed pledges: a
      // cross-pledged asset repeats its lendable value on every pledge row.
      value: num(c.currentLendableValue) ?? num(c.collateralValue),
      // The read carries an ADVANCE RATE, which is not a coverage percentage.
      // Rendering one as the other would be a wrong figure, so this stays empty
      // and the renderer prints an em dash.
      coveragePct: null,
      lienPosition: text(c.lienPosition),
    })),
  );
}

function guarantorFrom(bundle: BorrowerBundle): MemoGuarantor | null {
  const entity = (bundle.graph?.legalEntities ?? []).find((e) => /guarantor/i.test(e.borrowerType ?? ""));
  if (!entity) return null;
  return {
    type: /personal|individual/i.test(entity.relationshipType ?? "") ? "individual" : "entity",
    name: entity.accountName ?? NOT_IN_SOURCE,
    guarantyType: text(entity.relationshipType),
  };
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
  const collateral = collateralRecords(facilities);
  const guarantor = guarantorFrom(bundle);
  const { spread, boom } = adaptBoomSpread(bundle.boom?.spread?.file);
  const ratios = ratiosFrom(bundle);

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
        // No read carries a borrower profile / business description today.
        profile: NOT_IN_SOURCE,
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
      supportingDocuments: [],
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
