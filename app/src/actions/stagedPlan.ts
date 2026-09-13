/* =============================================================================
   STAGED OUTPUT (A33.5.3) — the plan, and only the plan.

   `stage_*` performs ZERO domain-object DML. Ever. It validates, computes and
   returns an immutable execution plan (a plan hash plus steps[]) together with a
   staging record and a ledger entry. Every org write happens behind the
   token-gated execute step.

   Two consequences this file depends on:
     1. The tracker genuinely PREVIEWS — the plan the banker reads at the confirm
        gate is the plan that later executes, because nothing has executed yet.
     2. NO staged output contains a record id, because stage_* created none.
        `assertNoRecordIds` enforces that on anything we accept.
   ============================================================================= */

import type { Suggestion } from "./suggestionEngine";

export type StepType = "write" | "verification" | "wait" | "handoff" | "observed_side_effect";

export interface PlanStep {
  id: string;
  type: StepType;
  label: string;
  /** Wire name is `objectName` (WP2 observed 2026-07-26), not `object`. */
  objectName?: string;
  /** The wire carries FIELD NAMES only, not values: the resolved values live in
   *  the plan hash, server-side. Client-side value checks therefore apply only
   *  to locally-built plans. */
  fields?: string[];
  /** Server-supplied step state; the tracker seeds from this. */
  state?: string;
  detail?: string;
  /** Automation this write is expected to wake. Surfaced before confirming. */
  automationWoken?: string[];
  /** The query that proves the write landed (verification steps). */
  verification?: string;
  /** Bounded hold for asynchronous org automation (wait steps). */
  waitBudgetMs?: number;
  pollIntervalMs?: number;
  /** Step ids that must be verified before this one may run. */
  dependsOn?: string[];
  /** Conditions the executor has satisfied, for conditional transitions. */
  satisfiedConditions?: string[];
  transition?: { field: string; from: string; to: string };
}

/**
 * One row of a plan's `items[]`, and the slot now carries two kinds of row.
 *
 * A BULK VALUATION names collateral: `collateralId` plus the step ids that will
 * report on it, so a failure on one item is reported against ITS collateral.
 *
 * A DISCARD names the INVENTORY (0.9.23, SPEC-0.9.23-TOOL-CONTRACT pair 2):
 * object, id, name and the reason the row goes, discovered by query on the org
 * from the version package id. It carries no `collateralId`, which is why that
 * field is optional here; the renderer tells the two shapes apart by `object`.
 * Nothing derives an inventory locally, so a row without `object` is simply not
 * an inventory row.
 */
export interface StagedItem {
  collateralId?: string;
  collateralName?: string;
  value?: number | null;
  writeStepId?: string;
  verifyStepId?: string;
  rollupStepId?: string;
  /** Discard inventory: the org object this row belongs to, API name. */
  object?: string;
  /** The record's own id, as the org resolved it. */
  id?: string;
  /** The record's name, in the org's words. */
  name?: string;
  /** Why this row goes, in the org's words. Rendered verbatim. */
  reason?: string;
}

/** One facility inside a package-anchored credit action, with the step ids that
 *  will report on it. Observed on stage_loan_modification / stage_renewal
 *  2026-07-27: N facilities, one plan, one hash, one token. A failure on one is
 *  reported against THAT facility and does not silently discard the others. */
export interface StagedFacility {
  facilityId: string;
  facilityName?: string;
  creditActionStepId?: string;
  verifyStepId?: string;
  applyStepId?: string;
  /** Loan-level covenant junctions that would clone onto THIS facility. */
  covenantCarryoverCount?: number;
}

/**
 * One covenant of the package inside a staged covenant review, planned or
 * refused, with the step ids that will report on it.
 *
 * OBSERVED 2026-08-22 on `stage_covenant_review`. Every covenant the package
 * aggregates and the plan touched appears here — a refusal is REPORTED with its
 * own reason rather than dropped, so a banker who assessed six covenants and
 * gets four written learns which two did not and why.
 */
export interface StagedCovenant {
  covenantId: string;
  covenantName?: string;
  covenantType?: string;
  /** loan, relationship, or both. An empty loan junction is the fact that the
   *  covenant is relationship-level, not a gap. */
  attachment?: string;
  /** The compliance row a review would act on. */
  covenantComplianceId?: string;
  /** The row status BEFORE this plan runs. Only Pending advances the schedule. */
  currentComplianceStatus?: string;
  /** The status this plan would write, or absent when surveyed only. */
  assessedStatus?: string;
  /** `planned`, `not_assessed`, or one of the `not_assessable_*` refusals. */
  state?: string;
  /** Why this covenant is not being written, when it is not — and, under
   *  `allowNonPending`, why it IS being written and what will not happen. The
   *  org's own sentence, rendered verbatim. */
  reason?: string | null;
  /** True when the covenant is Active with a Frequency Template and an
   *  Effective Date: the configuration nCino uses to mint the next compliance
   *  record on a complete status, which is what raises a covenant approval. */
  generatesNextRow?: boolean;
  writeStepId?: string;
  statusStepId?: string;
  verifyStepId?: string;
  generationStepId?: string;
}

export interface StagedOutput {
  stagingId: string;
  /** Minted server-side and bound to stagingId + planHash + user. Null on an
   *  idempotent replay, because the caller already holds it. */
  decisionToken?: string | null;
  /** True when this idempotency key had already staged. Nothing was re-planned. */
  replayed?: boolean;
  /** True when a replay re-issued the confirmation token on the same staging
   *  row (the earlier token, never received, is void). */
  tokenRotated?: boolean;
  accountId?: string;
  productPackageId?: string;
  /** Per-field provenance map, delivered as a JSON STRING on the wire. */
  provenanceJson?: string;
  /** OBSERVED on stage_loan_modification / stage_renewal. The ORG's own word
   *  for whether this plan can be executed, and its reason verbatim. The client
   *  has a tool map that says the same thing; when both speak, the org wins. */
  executionHeld?: boolean;
  heldReason?: string;
  /** A33.2.4(c) — loan-level covenants that would carry to the clone. */
  covenantCarryoverCount?: number;
  /** New facility: whether the plan creates the package first, and the name it
   *  will carry. The org's own naming convention, computed server-side. */
  createsPackage?: boolean;
  plannedPackageName?: string;
  /** Bulk valuation: what the plan will file, per collateral record. */
  items?: StagedItem[];
  itemCount?: number;
  /** Package-anchored credit action: what the plan covers, per facility. */
  facilities?: StagedFacility[];
  facilityCount?: number;
  /** Package-scoped covenant review: every covenant in scope, planned or
   *  refused, each carrying its own state and reason. */
  covenants?: StagedCovenant[];
  /** Covenants this plan will write. */
  assessedCount?: number;
  /** Covenants carrying an assessment that cannot be written, one reason each. */
  refusedCount?: number;
  /**
   * WHAT THE PLAN WOULD NOT TAKE, BY INDEX, in the org's own words.
   *
   * The bulk covenant review reports its refusals per covenant id, because a
   * covenant already exists and has one. A CREATE has no id yet, so the intake
   * pair reports its refusals against the position in the list the caller sent:
   * "the third covenant names a type this org does not hold". The room renders
   * them beside the plan's own warnings, verbatim.
   */
  refusals?: Array<{ index: number; reason: string }>;
  /** Covenants the package aggregates, before any member selection. */
  scopeCount?: number;
  /** Hash over the ordered steps plus resolved field values. Immutable.
   *  `execute_*` refuses a mismatch. */
  planHash: string;
  /** What will be written, in banker language. Drives the confirm gate copy. */
  summary: string;
  steps: PlanStep[];
  /** Side effects the banker must see BEFORE confirming. */
  warnings: string[];
  /** The Suggestion records that fed the plan, so the gate can recompute. */
  suggestions: Suggestion[];
  /** Per-field prefill provenance plus any NarrativeAttribution. */
  provenance?: Record<string, unknown>;
}

/* A33.5.3 — a staged plan must not prove that something was already written.
 *
 * SCOPE, learned the hard way (live 2026-07-26): a blanket "no id-shaped string
 * anywhere" check contradicts the spec it enforces. `accountId`,
 * `productPackageId` and `stagingId` are part of A33.5.3's own common output,
 * and A26 provenance citations ARE record ids by design. Flagging those blocked
 * every legitimate live plan.
 *
 * The real fence is narrower and sharper: an id belonging to a WRITE TARGET
 * object has no business in a staged plan, because stage_* created nothing. So:
 *
 *   1. Write-target prefixes are refused ANYWHERE, whitelist included. Finding a
 *      valuation, Case or Review id in a plan means a record exists.
 *   2. Everything else is refused only OUTSIDE the known id carriers, which
 *      catches a stray resultRecordId or outcome reference.
 */

/** Key-prefix to object, for the three objects these tools actually write. */
export const WRITE_TARGET_ID_PREFIXES: Record<string, string> = {
  a34: "collateral valuation",
  "500": "service request",
  a5n: "credit review",
};

/** Fields that legitimately carry an org record id (A33.5.3 common output).
 *
 *  `facilityId` belongs here for the same reason `productPackageId` does: a
 *  package-anchored plan names the BOOKED facilities it would act on, and those
 *  loans existed long before this plan was staged. Finding one proves nothing
 *  was written — it is the plan saying what it is aimed at. */
const ID_CARRYING_KEYS = new Set([
  "accountId",
  "productPackageId",
  "stagingId",
  "decisionToken",
  "facilityId",
  // Same reason as `facilityId`, for the two BULK plans. A valuation batch
  // names the collateral it is aimed at and a covenant review names the
  // covenants and the compliance rows it would update; all three existed long
  // before the plan was staged. Finding one proves nothing was written.
  "collateralId",
  "covenantId",
  "covenantComplianceId",
]);

const RECORD_ID = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/** True for a provenance citation path: A26 says the citation IS the record id. */
function isProvenanceCitation(path: string): boolean {
  return /^provenance\b/.test(path) && /\bcitation$/.test(path);
}

/** A transition's `from` and `to` are PICKLIST VALUES, never record ids. Some
 *  org picklists are long enough to trip the id shape on their own —
 *  `CustomerEngagement` is eighteen characters — and flagging one as evidence
 *  that a record already exists is simply wrong. */
function isTransitionState(path: string): boolean {
  return /\.transition\.(?:from|to)$/.test(path);
}

/**
 * A DISCARD INVENTORY ROW'S OWN ID (0.9.23).
 *
 * `items[n].id` on a discard plan is a record the org found by query and would
 * DELETE. Every one of them existed long before this plan was staged, so
 * finding one proves the opposite of what the fence looks for: it is the plan
 * naming what it is aimed at, exactly as `facilityId` is on a credit action.
 *
 * PATH-SHAPED, NOT KEY-SHAPED. `id` is too generic a key to allowlist globally;
 * a stray `id` anywhere else in a plan must still be flagged.
 */
function isInventoryId(path: string): boolean {
  return /^items\[\d+\]\.id$/.test(path);
}

export function assertNoRecordIds(plan: StagedOutput): string[] {
  const violations: string[] = [];

  const walk = (value: unknown, path: string, key: string) => {
    if (typeof value === "string") {
      if (!RECORD_ID.test(value)) return;

      // 1. A write-target id is a hard block wherever it appears.
      const target = WRITE_TARGET_ID_PREFIXES[value.slice(0, 3)];
      if (target) {
        violations.push(
          `${path} looks like an org record id (${value}), and it belongs to the ${target} this plan would create, so something was already written`,
        );
        return;
      }

      // 2. Otherwise only flag ids outside the known carriers.
      if (ID_CARRYING_KEYS.has(key) || isProvenanceCitation(path) || isTransitionState(path) || isInventoryId(path)) return;
      violations.push(`${path} looks like an org record id (${value})`);
      return;
    }
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`, key));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, k);
    }
  };

  walk(plan, "", "");
  return violations;
}

/* =============================================================================
   NOT-LIVE SIMULATION ADAPTER

   ⚠️  TESTS AND LOCAL PREVIEW ONLY. THIS NEVER RUNS IN A SHIPPED ARTIFACT.  ⚠️

   WP2 is building the real `stage_*` Apex concurrently against A33.5. Until
   those tools exist, the tracker has nothing to consume, so this adapter
   produces plans of the SPEC-CORRECT SHAPE for tests and preview.

   The fail-closed discipline is unchanged and enforced by `isSimulationAllowed`:
   when the artifact runs for real, panel-backed actions stay ANALYSIS-ONLY
   exactly as today. No fabricated plan is ever presented to a banker as if a
   real staging call had happened, and no simulated plan can reach a confirm
   gesture in a shipped bundle.
   ============================================================================= */

/** The one gate. Simulation is permitted ONLY under the dev server or a test
 *  runner (vitest sets DEV) — never in a built artifact.
 *
 *  This reads `import.meta.env.DEV` and NOTHING else, deliberately. Vite
 *  replaces it with the literal `false` in a production build, which lets
 *  Rollup prove the simulation branch dead and strip it — so the adapter's
 *  strings never even reach the shipped bundle, rather than shipping as
 *  unreachable code. A compound condition would defeat that analysis. */
export function isSimulationAllowed(): boolean {
  return import.meta.env.DEV;
}

export const SIMULATION_BANNER =
  "Simulated plan. No staging tool has run and nothing will be written. For preview only.";

function hashPlan(steps: PlanStep[]): string {
  // Deterministic, order-sensitive, and dependent on resolved field values, so
  // any edit to the plan changes the hash exactly as the real tool's does.
  const material = JSON.stringify(steps.map((s) => [s.id, s.type, s.objectName ?? "", s.fields ?? [], s.transition ?? null]));
  let h = 0;
  for (let i = 0; i < material.length; i++) {
    h = (Math.imul(31, h) + material.charCodeAt(i)) | 0;
  }
  return `sim-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Build a spec-shaped plan for one action. Returns null when simulation is not
 *  allowed, so a caller cannot accidentally ship one. */
export function simulateStagedOutput(args: {
  actionId: string;
  accountName: string;
  suggestions: Suggestion[];
}): StagedOutput | null {
  // Statically eliminable guard — see isSimulationAllowed(). Everything below
  // this line is stripped from a production build.
  if (!import.meta.env.DEV) return null;

  const { actionId, accountName, suggestions } = args;
  const steps: PlanStep[] = [];
  let summary = "";
  const warnings: string[] = [];

  if (actionId === "collateral-valuation") {
    summary = `Files a new collateral valuation for ${accountName} against the pledged collateral.`;
    steps.push(
      {
        id: "s1",
        type: "write",
        label: "Create the collateral valuation",
        objectName: "LLC_BI__Collateral_Valuation__c",
        fields: ["LLC_BI__Active__c", "LLC_BI__Primary__c"],
        automationWoken: ["CollateralValuationTrigger, before insert"],
      },
      {
        id: "s2",
        type: "verification",
        label: "Re-query the collateral record to see whether the value rolled up",
        verification: "SELECT LLC_BI__Lendable_Value__c FROM LLC_BI__Collateral__c",
        dependsOn: ["s1"],
      },
    );
    warnings.push(
      "The roll-up onto the collateral record is bound to Salesforce's Add Valuation button and may not fire here. If it does not, the terminal state reads valuation filed, collateral value unchanged, and no coverage improvement is claimed.",
    );
  } else if (actionId === "create-service-request") {
    summary = `Logs a service request against ${accountName} at status New.`;
    steps.push({
      id: "s1",
      type: "write",
      label: "Create the service request",
      objectName: "Case",
      fields: ["Status"],
      automationWoken: ["FinServ.CaseTrigger", "slackv2.caseTrigger"],
    });
    steps.push({
      id: "s2",
      type: "observed_side_effect",
      label: "The Slack trigger may post to a channel on insert",
      dependsOn: ["s1"],
    });
    warnings.push(
      "Creating the case may post to Slack. No probe has watched for that, so it is surfaced rather than claimed either way.",
    );
  } else if (actionId === "annual-review") {
    summary = `Stages an annual credit review for ${accountName} at In Progress with the drafted narratives.`;
    steps.push(
      {
        id: "s1",
        type: "write",
        label: "Create the credit review",
        objectName: "LLC_BI__Review__c",
        fields: ["LLC_BI__Status__c"],
        automationWoken: ["Review After Save assigns the record type and the loan officer"],
      },
      {
        id: "s2",
        type: "verification",
        label: "Re-query the review to confirm it exists and carries the narratives",
        verification: "SELECT Id, LLC_BI__Status__c FROM LLC_BI__Review__c",
        dependsOn: ["s1"],
      },
      {
        id: "s3",
        type: "handoff",
        label: "Control passes to the bank's own Submit for Approval process",
        dependsOn: ["s2"],
      },
    );
    warnings.push(
      "Entities added to the borrowing structure after the review is created get no snapshot row and become invisible to it.",
    );
  } else {
    return null;
  }

  return {
    stagingId: `sim-staging-${actionId}`,
    planHash: hashPlan(steps),
    summary,
    steps,
    warnings,
    suggestions,
  };
}
