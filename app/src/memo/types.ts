/* =============================================================================
   THE MEMO DOSSIER — the plugin's shape, written as TypeScript.

   This file is DESCRIPTIVE, not inventive. Every type here was read off
   `vendor/render/assemble-memo.mjs` (which builds the dossier) and
   `vendor/render/render-memo.mjs` (which consumes it). The renderer is
   data-source-blind by design: it sees the dossier and nothing else, so this
   shape IS the seam between the cockpit and the memo.

     renderMemo({ manifest, shell, ...dossier })
     dossier = { canon, boom, afs, ic, peers, flagOverrides?, attestation?, chartVariants? }

   Fields are optional here wherever the renderer tolerates their absence, and
   required wherever it dereferences them without a guard (`canon.borrower.name`,
   `canon.loans`, `canon.exposureSummary.existing`, `canon.creditApprovalSummary`).
   That distinction is load-bearing: it is the difference between a memo with an
   honest gap in it and a memo that throws.

   THE GAP RULE (references/conditionality.md, SKILL.md line 334). A figure the
   source systems do not carry is written as the marker string, never estimated:

       [not in source system; flagged for RM]

   which is why several fields below are typed `number | string`. A number is a
   figure. A string in a numeric slot is the marker, and the renderer prints it
   verbatim into the cell. Nothing in between.
   ============================================================================= */

/** The marker a figure becomes when no source system carries it. */
export const NOT_IN_SOURCE = "[not in source system; flagged for RM]" as const;

/** A figure, or the honest admission that there is none. Never an estimate. */
export type Figure = number | typeof NOT_IN_SOURCE;
/** Text from a source system, or the marker. */
export type Text = string | typeof NOT_IN_SOURCE;

/* -----------------------------------------------------------------------------
   canon — the nCino/deal half of the dossier
   ----------------------------------------------------------------------------- */

export interface MemoBorrower {
  name: string;
  naics: Text;
  naicsDesc: Text;
  /** Powers the inline Lightning deep-links. Null disables them; it never fakes one. */
  instanceUrl?: string | null;
  salesforceAccountId?: string;
  segment?: string;
  currentRiskRating?: Text;
  profile?: Text;
  hq?: Text;
  employees?: number;
  customerSince?: string;
  fye?: string;
  asOf?: string;
}

/**
 * The deal-context flag set. The conditionality engine evaluates the manifest's
 * `renderWhen` predicates against exactly these, so a flag is not decoration:
 * it decides whether a module renders at all.
 *
 * FALSE MEANS "NOT EVIDENCED IN THE BUNDLE", and a module switched off by a
 * false flag is SUPPRESSED, not a gap (references/conditionality.md). The two
 * are told apart in `renderPlanFor()`, and the room must keep telling them
 * apart: a suppressed module has nothing to complete.
 */
export interface MemoFlags {
  has_new_money?: boolean;
  has_revolver?: boolean;
  has_revolver_increase?: boolean;
  has_guarantor?: boolean;
  guarantor_types?: string[];
  has_financial_covenants?: boolean;
  collateral_types?: string[];
  has_real_estate?: boolean;
  has_deposits?: boolean;
  has_retained_earnings_adj?: boolean;
  is_syndicated?: boolean;
  is_peg?: boolean;
  is_lft?: boolean;
  is_public?: boolean;
  exposure_total?: number;
  sbe_threshold_breached?: boolean;
  [flag: string]: boolean | string | string[] | number | undefined;
}

export interface MemoCreditAction {
  productPackageName: Text;
  /** Manifest `creditEvents` id: existing_material, new_relationship, annual_review, … */
  creditEvent: string;
  /** "core" or "enhanced". Enhanced switches on the global-exposure / SBE components. */
  tier: string;
  description?: string;
  packageId?: string;
  flags: MemoFlags;
}

/** One side of a facility: what it is today, or what this action would make it. */
export interface MemoFacilitySide {
  commitment: Figure | null;
  outstanding: Figure | null;
  maturity: string | null;
}

export interface MemoLoan {
  id: string;
  /** `LLC_BI__Loan__c` id. Null suppresses the record deep-link rather than faking one. */
  ncinoId: string | null;
  name: string;
  purpose: Text;
  riskRating: Text;
  isNewMoney: boolean;
  isIncrease: boolean;
  isRenewal?: boolean;
  existing: MemoFacilitySide;
  proposed: MemoFacilitySide;
  type?: string;
  productType?: string;
  rateIndex?: Text;
  rateSpread?: number;
  allInRate?: number;
  amortization?: Text;
  collateral?: Text;
  lienPosition?: Text;
}

export interface MemoExposureSummary {
  existing: { commitment: Figure | null; outstanding: Figure | null };
  proposed: { commitment: Figure | null; outstanding: Figure | null };
  changeInExposure: { commitment: Figure | null; outstanding?: Figure | null; note: string };
}

/** Rendered as a plain table, so every field lands verbatim — marker included. */
export interface MemoCreditApprovalSummary {
  hrbDesignation: Text;
  hvcreApplicable: boolean;
  ureExceptions: Figure;
  pastDueFinancialStatements: Text;
  csgFeedbackComplete: boolean;
  csgFlags: boolean;
}

export interface MemoCollateralRecord {
  loan?: string;
  description?: Text;
  value?: number | null;
  /** Advance-rate-style percentage. Undefined renders "—"; it is never guessed from the pledge. */
  coveragePct?: number | null;
  lienPosition?: Text;
}

export interface MemoGuarantor {
  type: string;
  name: string;
  guarantyType?: Text;
}

/** Label-keyed period series: { FY2023: 56266000, FY2024: … }. */
export type MemoSeries = Record<string, number | null>;

/**
 * The label-keyed spread the renderer's period axis is built from. Adapted from
 * Boom's UUID-keyed `spread.file` exactly as assemble-memo.mjs adapts it, so the
 * memo's periods and the Financials tab's periods are the same periods.
 */
export interface MemoSpread {
  periods: string[];
  incomeStatement: Record<string, MemoSeries>;
  balanceSheet: Record<string, MemoSeries>;
  cashFlow: Record<string, MemoSeries>;
}

/** The headline KPI source. Boom's own ratios, so the memo and the widgets agree. */
export interface MemoRatios {
  revenue?: number | null;
  revenueYoYPct?: number | null;
  ebitda?: number | null;
  ebitdaMarginPct?: number | null;
  grossMarginPct?: number | null;
  totalLeverage?: number | null;
  totalDebt?: number | null;
  interestCoverage?: number | null;
  asOf?: string | null;
}

/** Analyst prose, keyed as the renderer's `narr(key)` calls read it. */
export type MemoNarratives = Record<string, string>;

export interface MemoAttestationEntry {
  status: "ai-drafted" | "approved" | "edited" | "flagged" | string;
  approvedBy?: string;
  approvedRole?: string;
  approvedDate?: string;
  editNote?: string;
}

/** Per-module sign-off, keyed by manifest module id. Replayed on every re-render. */
export type MemoAttestation = Record<string, MemoAttestationEntry>;

export interface MemoCanon {
  borrower: MemoBorrower;
  creditAction: MemoCreditAction;
  loans: MemoLoan[];
  exposureSummary: MemoExposureSummary;
  creditApprovalSummary: MemoCreditApprovalSummary;
  spread: MemoSpread;
  ratios?: MemoRatios;
  collateral?: MemoCollateralRecord[];
  guarantor?: MemoGuarantor | null;
  narratives?: MemoNarratives;
  riskMitigants?: Array<{ risk: string; mitigant: string; residual?: string }>;
  riskRatingFactors?: Array<{ factor: string; grade: string }>;
  supportingDocuments?: Array<{ name: string; status?: string }>;
  attestation?: MemoAttestation;
}

/* -----------------------------------------------------------------------------
   boom / afs / ic / peers — the other four dossier inputs
   ----------------------------------------------------------------------------- */

/**
 * The Boom payload the renderer's `li(statementType, accountCode)` reads.
 * `periodValues` are keyed by the FY LABEL here, not by Boom's period UUIDs:
 * the adaptation happens on the way in, once, so the renderer never sees a UUID.
 */
export interface MemoBoom {
  files: Record<
    string,
    {
      _source?: string;
      financialStatements: Array<{
        statementType: string;
        endDate?: string;
        periods: string[];
        lineItems: Array<{
          accountCode: string;
          name: string;
          hierarchy: string;
          periodValues: MemoSeries;
        }>;
      }>;
    }
  >;
}

/** Servicing. Absent `revolverUsage` simply drops the usage block; it invents nothing. */
export interface MemoAfs {
  _source?: string;
  revolverUsage?: {
    facility?: string;
    commitment?: number;
    months: string[];
    fundedBalance: number[];
    utilizationPct: number[];
    high?: number;
    low?: number;
    average?: number;
    highPct?: number;
    lowPct?: number;
    averagePct?: number;
    daysAtZero?: number;
    consecutiveDaysAtZero?: number;
  };
  paymentHistory?: {
    buckets?: { current?: boolean; d30_60?: number; d60_90?: number; d90_plus?: number };
    events?: unknown[];
  };
  balanceTrend?: unknown;
}

export interface MemoCovenantCompliance {
  name: string;
  type?: string;
  unit?: string;
  operator?: string;
  trigger?: number;
  frequency?: string;
  quarters?: string[];
  actuals?: Array<number | null>;
  perPeriod?: Array<{ value: number | null; flag: string; arrow: string }>;
  currentFlag?: string;
  actual?: number | null;
}

/** Ratings, covenant actuals, ratios and sensitivity. A stub until AFS lands, and the
 *  renderer's provenance chips say "stub" on every section it feeds. */
export interface MemoIc {
  _source?: string;
  ratios?: Array<{ period: string; totalLeverage?: number | null; [k: string]: unknown }>;
  riskRatingTrend?: { events: Array<{ period: string; rating: string; band?: string; pdPct?: number; proposed?: boolean }> };
  covenantCompliance?: MemoCovenantCompliance[];
  sensitivity?: {
    scenarios: Array<{
      name: string;
      dsc?: number;
      leverage?: number;
      revenueDelta?: number;
      gmDeltaBps?: number;
      covenantBreaches?: string[];
    }>;
  };
}

export interface MemoPeers {
  _source?: string;
  peers?: {
    naics?: string;
    revenueBand?: string;
    set?: Array<{ name: string; ticker?: string; revenueLTM?: number; ebitdaMarginPct?: number; leverage?: number; dsc?: number }>;
    medians?: Record<string, number>;
  };
  industryOutlook?: {
    naics?: string;
    outlook?: string;
    marketSize?: string;
    cagrPct?: number;
    cyclicality?: string;
    drivers?: string[];
  };
}

/* -----------------------------------------------------------------------------
   the dossier, and what comes back
   ----------------------------------------------------------------------------- */

export interface MemoDossier {
  canon: MemoCanon;
  boom: MemoBoom;
  afs: MemoAfs;
  ic: MemoIc;
  peers: MemoPeers;
  /** Flip a flag to prove the conditionality engine. Not a production path. */
  flagOverrides?: Partial<MemoFlags>;
  attestation?: MemoAttestation;
  /** Per-chart view choice, e.g. `{ spreading: "margin" }`. */
  chartVariants?: Record<string, string>;
}

/** One module in the resolved render plan. */
export interface MemoPlanModule {
  id: string;
  name: string;
  order: number;
  ncinoSection?: string;
  components?: Array<{ id: string; name?: string }>;
}

export interface MemoRenderResult {
  html: string;
  plan: MemoPlanModule[];
  /** Module ids, and `module/component` ids, the flags switched off. */
  suppressed: string[];
  flags: MemoFlags;
  /** The seven nCino cm_* rich-text buckets, RTE-safe. */
  rteSections: Record<string, string>;
}

/* -----------------------------------------------------------------------------
   the cockpit's own inputs
   ----------------------------------------------------------------------------- */

/**
 * ONE EXECUTED PLAN STEP, read back from the org.
 *
 * This is the "handover of the exact changes" the room is built on: what was
 * done to the relationship, per facility, with the org record id that proves it.
 * Phase B fills these from `cm_Plan_JSON__c` / `cm_Tracker_JSON__c` on the
 * executed staging rows; Phase A takes them as an input and asks nothing about
 * where they came from.
 *
 * `before` and `after` carry whatever the plan held — commitment, maturity, rate,
 * a covenant threshold. A key absent from `before` was not part of the change,
 * which is not the same as a key whose value is null. `before` ABSENT ENTIRELY
 * means the step created the record: that is how a new facility is recognised.
 */
export interface MemoChangeFields {
  commitment?: number | null;
  outstanding?: number | null;
  maturity?: string | null;
  /** Anything else the plan step held — a rate, a covenant threshold, a fee. */
  [field: string]: unknown;
}

export interface MemoChange {
  id: string;
  label: string;
  /** What was changed: the facility, covenant or package the step acted on. */
  target: { kind: string; id?: string; name?: string };
  before?: MemoChangeFields;
  after?: MemoChangeFields;
  /** The re-query that proved it landed. */
  verification?: string;
  /** The org id of the record the step created or updated. */
  orgId?: string;
}
