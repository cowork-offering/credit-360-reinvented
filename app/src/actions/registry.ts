/* =============================================================================
   ACTION REGISTRY (SPEC §12 A27.2) — the single source of truth for every
   client action the cockpit offers.

   THREE RULES, all load-bearing:

   1. Availability predicates read ONLY C360_DATA. No clock, no network, no
      guessing. If the staged data cannot support an action, it is not
      available — full stop.

   2. Unavailable actions stay VISIBLE and DISABLED with a concrete reason
      (A27.3, the Salesforce lifecycle rule). We never hide an action (the banker
      loses the map of what exists) and never enable one the data can't support
      (the banker gets a dead end). The `reason` is shown verbatim in the UI, so
      it must read like a banker wrote it: "No booked loans on this
      relationship", not "predicate failed".

   3. `apexAction` is a DECLARED, UNUSED SEAM. v2 will route these through
      Salesforce/Salesforce Apex invocables on the MCP server as GATED WRITES
      (stage -> human approve -> commit). Nothing here writes today: every
      action routes through the channel adapter as a well-formed agent prompt.
      Do not wire apexAction without the approval gate.
   ============================================================================= */

import { bookedFacilityAvailability } from "../data/facilityStage";
import type { BorrowerBundle, C360Data, Id } from "../data/contract";
import { isActiveFacility } from "../data/worklist";
import { DISCARD_LABEL, DISCARD_LINE } from "./discardVersion";
import { discardAvailability } from "./discardTarget";
import { packageRoster } from "../book/packages";

export type ActionCategory = "Analyze" | "Originate" | "Service" | "Risk";

export const CATEGORY_ORDER: ActionCategory[] = ["Analyze", "Originate", "Service", "Risk"];

export interface Availability {
  available: boolean;
  /** Banker-readable explanation, shown verbatim when disabled. */
  reason?: string;
}

export interface ClientAction {
  id: string;
  label: string;
  category: ActionCategory;
  /** 1-2 sentences of banker language, shown in the actions panel. */
  description: string;
  icon: ActionIcon;
  availability: (data: C360Data, accountId: Id | null) => Availability;
  /** `{account}` and `{accountId}` are substituted by renderPrompt(). */
  promptTemplate: string;
  /** PLANNED SEAM — v2 gated write via an Apex invocable. Unused in v1. */
  apexAction?: { tool: string; params: Record<string, string> };
  /** A33.1.2 — declared for SHIPPING actions only. An action with no schema
   *  does not open the Action Panel and stays analysis-only. The schema itself
   *  is built per-context in actions/schemas.ts; this flag is the registry's
   *  single source of truth for "does this action have a panel". */
  hasPanel?: true;
}

export type ActionIcon =
  | "spread"
  | "memo"
  | "modify"
  | "renew"
  | "covenant"
  | "collateral"
  | "review"
  | "rating"
  | "facility"
  | "person"
  | "service"
  /* The arc's fourth satellite and the two org records it branches to. No
     registry ACTION wears these — they are doors to a record rather than
     writes — but the icon language is one union, so they live here (rule 35). */
  | "cloud"
  | "building"
  | "package";

/* ----------------------------------------------------------------- helpers */

const NO_ACCOUNT = "Open a relationship to run this action.";
const NOT_STAGED = "Account not staged in this view";

export function resolveBundle(data: C360Data, accountId: Id | null): BorrowerBundle | null {
  if (!accountId) return null;
  const staged = (data.borrowers ?? {})[accountId];
  if (staged) return staged;
  return data.borrower?.snapshot?.accountId === accountId ? data.borrower : null;
}

function activeFacilities(bundle: BorrowerBundle | null) {
  return (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
}

/** Staging gate shared by EVERY action (C1).
 *
 *  An account that sits in portfolio.accounts but has no bundle in `borrowers`
 *  is NOT actionable: we would be firing a prompt about a relationship whose
 *  data this artifact never staged. "Always available" means "no DATA
 *  precondition beyond staging" — never "no staging".
 *
 *  Book/home context (accountId === null) disables every action uniformly with
 *  NO_ACCOUNT. That is the deliberate choice over enabling a couple of actions
 *  book-wide: the panel is account-scoped, its rows read as "act on THIS
 *  relationship", and a row that silently changes meaning with context is worse
 *  than one that tells you to open a relationship first. */
function withBundle(
  data: C360Data,
  accountId: Id | null,
  check: (bundle: BorrowerBundle) => Availability,
): Availability {
  if (!accountId) return { available: false, reason: NO_ACCOUNT };
  const bundle = resolveBundle(data, accountId);
  if (!bundle) return { available: false, reason: NOT_STAGED };
  return check(bundle);
}

/** No data precondition beyond being staged (C1). */
const STAGED_ONLY = { available: true } as const;

/** Boom block carries REAL content, not just an empty container (C2). */
function hasBoomContent(bundle: BorrowerBundle): boolean {
  const boom = bundle.boom;
  if (!boom) return false;
  const ratios = boom.ratios;
  const hasRatio =
    !!ratios &&
    !Array.isArray(ratios) &&
    Object.values(ratios).some((v) => typeof v === "number" && Number.isFinite(v));
  const spread = boom.spread;
  const hasSpread =
    !!spread && ((spread.periods?.length ?? 0) > 0 || (spread.lineItems?.length ?? 0) > 0);
  return hasRatio || hasSpread;
}

const NO_BOOKED_LOANS = "No booked loans on this relationship";

/** "Active package" = at least one booked facility (A27.3). */
function requireActivePackage(bundle: BorrowerBundle): Availability {
  return activeFacilities(bundle).length > 0
    ? { available: true }
    : { available: false, reason: NO_BOOKED_LOANS };
}

/* ------------------------------------------------------------------ actions */

export const ACTIONS: ClientAction[] = [
  {
    id: "generate-spreading",
    label: "Generate Spreading",
    category: "Analyze",
    description:
      "Pull the spread financials into a normalised model. Shows revenue, EBITDA, leverage and coverage period over period.",
    icon: "spread",
    promptTemplate: "Pull up the Boom spreads for {account} ({accountId}).",
    availability: (data, accountId) =>
      withBundle(data, accountId, (b) =>
        hasBoomContent(b)
          ? { available: true }
          : { available: false, reason: "No spread financials on file for this borrower" },
      ),
  },
  {
    id: "draft-credit-memo",
    label: "Draft Credit Memo",
    category: "Originate",
    description:
      "Draft the credit memo from the current package, spreads and covenant position. Produces a reviewable narrative, not a decision.",
    icon: "memo",
    promptTemplate: "Draft the credit memo for {account} ({accountId}).",
    availability: (data, accountId) => withBundle(data, accountId, requireActivePackage),
    apexAction: { tool: "ncino_draft_credit_memo", params: { accountId: "{accountId}" } },
  },
  {
    id: "loan-modification",
    label: "Loan Modification",
    category: "Service",
    description:
      "Open a modification against a booked facility: rate, amortisation, covenant or maturity changes. Routes to credit for approval.",
    icon: "modify",
    promptTemplate:
      "Start a loan modification for {account} ({accountId}): summarise the booked facilities and the modification options.",
    // nCino accepts a credit action only against a BOOKED facility, so the
    // action is withheld where none exists and the real reason is shown (A27.3).
    availability: (data, accountId) => withBundle(data, accountId, (b) => bookedFacilityAvailability(b, "modifications")),
    apexAction: { tool: "ncino_create_modification", params: { accountId: "{accountId}" } },
     hasPanel: true,
  },
  {
    id: "renewal",
    label: "Renewal",
    category: "Service",
    description:
      "Start the renewal workflow for a maturing facility, carrying forward terms and the current risk position.",
    icon: "renew",
    promptTemplate:
      "Begin the renewal workflow for {account} ({accountId}): start with the facility closest to maturity.",
    availability: (data, accountId) => withBundle(data, accountId, (b) => bookedFacilityAvailability(b, "renewals")),
    apexAction: { tool: "ncino_create_renewal", params: { accountId: "{accountId}" } },
     hasPanel: true,
  },
  {
    id: "covenant-review",
    label: "Covenant Review",
    category: "Risk",
    description:
      "Review every active covenant: cushion, next test date, and any divergence between the Salesforce evaluation and the spread.",
    icon: "covenant",
    promptTemplate:
      "Run a covenant review for {account} ({accountId}): cushions, next test dates, and any divergence from the spread.",
    availability: (data, accountId) =>
      withBundle(data, accountId, (b) =>
        (b.covenants?.covenants?.length ?? 0) > 0
          ? { available: true }
          : { available: false, reason: "No covenants recorded for this relationship" },
      ),
     hasPanel: true,
  },
  {
    id: "collateral-valuation",
    label: "Collateral Valuation",
    category: "Risk",
    description:
      "Re-value pledged collateral and recompute advance rates, lendable value and facility coverage.",
    icon: "collateral",
    promptTemplate: "Re-value the pledged collateral for {account} ({accountId}) and recompute coverage.",
    availability: (data, accountId) =>
      withBundle(data, accountId, (b) =>
        // Only ACTIVE facilities count — collateral released with a paid-off
        // facility is not re-valuable exposure (C3).
        activeFacilities(b).some((f) => (f.collateral?.length ?? 0) > 0)
          ? { available: true }
          : { available: false, reason: "No collateral pledged against these facilities" },
      ),
    hasPanel: true,
  },
  {
    id: "annual-review",
    label: "Annual Review",
    category: "Risk",
    description:
      "Run the periodic credit review: exposure, performance, covenant compliance and confirmation of the risk grade.",
    icon: "review",
    promptTemplate: "Run the annual credit review for {account} ({accountId}).",
    availability: (data, accountId) => withBundle(data, accountId, requireActivePackage),
    apexAction: { tool: "ncino_start_annual_review", params: { accountId: "{accountId}" } },
    hasPanel: true,
  },
  {
    id: "risk-rating-review",
    label: "Risk Rating Review",
    category: "Risk",
    description:
      "Re-assess the borrower's risk grade against current financials and behaviour, and document the rationale.",
    icon: "rating",
    promptTemplate:
      "Review the risk rating for {account} ({accountId}) against current financials and document the rationale.",
    availability: (data, accountId) =>
      withBundle(data, accountId, (b) =>
        b.snapshot?.primaryRiskRating != null
          ? { available: true }
          : { available: false, reason: "No risk rating on file for this borrower" },
      ),
    apexAction: { tool: "ncino_update_risk_rating", params: { accountId: "{accountId}" } },
     hasPanel: true,
  },
  {
    id: "new-facility-request",
    label: "New Facility Request",
    category: "Originate",
    description:
      "Structure a new facility for this borrower: amount, purpose, tenor, pricing and collateral.",
    icon: "facility",
    promptTemplate: "Structure a new facility request for {account} ({accountId}).",
    availability: (data, accountId) => withBundle(data, accountId, () => STAGED_ONLY),
    apexAction: { tool: "ncino_create_loan", params: { accountId: "{accountId}" } },
     hasPanel: true,
  },
  /* THE UNDO (0.9.23, SPEC-0.9.23-VERSION-LIFECYCLE 2b.1). Every other row here
     makes something; this one takes a version back off the org. It is a SERVICE
     row because that is where the modification it undoes already lives, and it
     is offered only where the roster has found an unbooked version the banker
     may still shape: never on a booked package, never on a version the org has
     taken to approval. `discardAvailability` is the one gate, shared with the
     trail's own door, so the two surfaces cannot disagree about whether a
     discard is on the table. The panel is relationship-scoped and anchors no
     package, which is the third entry in `discardTarget`. */
  {
    id: "discard-version",
    label: DISCARD_LABEL,
    category: "Service",
    description: DISCARD_LINE,
    icon: "package",
    promptTemplate:
      "Discard the unbooked modification version on {account} ({accountId}) and leave the booked package as it is.",
    availability: (data, accountId) =>
      withBundle(data, accountId, (b) => discardAvailability(packageRoster(b), null)),
    hasPanel: true,
  },
  {
    id: "create-service-request",
    label: "Create Service Request",
    category: "Service",
    description:
      "Log a servicing request against the relationship: statements, payoff quotes, document requests or account changes.",
    icon: "service",
    promptTemplate: "Create a service request for {account} ({accountId}).",
    availability: (data, accountId) => withBundle(data, accountId, () => STAGED_ONLY),
    apexAction: { tool: "ncino_create_service_request", params: { accountId: "{accountId}" } },
    hasPanel: true,
  },
];

export const ACTIONS_BY_ID: Record<string, ClientAction> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a]),
);

/** Substitute the account placeholders. The rendered string is what goes to the
 *  agent verbatim — keep it a complete, unambiguous instruction. */
export function renderPrompt(action: ClientAction, accountName: string, accountId: string): string {
  return action.promptTemplate.replaceAll("{account}", accountName).replaceAll("{accountId}", accountId);
}


/**
 * The audit rationale that goes on every staged plan.
 *
 * The Apex Request declares `rationale` required, and an undefined one is
 * simply dropped by JSON, so there is always a sentence: what the figures said
 * when they said something, what the banker wrote when they wrote something,
 * and otherwise a deterministic statement of who asked for what.
 */
export function stageRationale(input: {
  actionId: string;
  accountName: string;
  accepted?: string;
  typed?: string;
}): string {
  const parts = [input.typed?.trim(), input.accepted?.trim()].filter(Boolean);
  if (parts.length) return parts.join(" ");
  const label = ACTIONS_BY_ID[input.actionId]?.label.toLowerCase() ?? input.actionId;
  return `Banker-initiated ${label} for ${input.accountName} via the cockpit.`;
}
