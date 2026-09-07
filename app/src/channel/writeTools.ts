/* =============================================================================
   LIVE WRITE TOOLS (WP5) — stage_* / execute_* on the Customer 360 server.

   Transport is the SAME positional invocable envelope as the read tools, so
   `unwrapInvocableOne` does the outer unwrap. The typed result lives INSIDE
   `outputValues`, discriminated by `ok` (A33.5.1):

     transport failure -> isSuccess:false / errors  (handled by unwrapInvocable)
     domain failure    -> isSuccess:true, outputValues.ok === false
     success           -> outputValues.ok === true, outputValues.result

   A domain failure is a SUCCESSFUL INVOCATION carrying ok:false. Keeping the
   two layers separate is what makes them independently testable, so this module
   never collapses one into the other.

   Shapes read from the deployed Apex Stage and Execute classes (their Request
   and Result inner classes), never guessed.
   ============================================================================= */

import { callTool, SERVERS, TOOLS, unwrapInvocableOne, type McpFailure } from "./mcp";
import type { PlanStep, StagedCovenant, StagedFacility, StagedItem, StagedOutput, StepType } from "../actions/stagedPlan";

/** The deployed write actions, and the tools each one runs on. */
export const WRITE_TOOLS = {
  "collateral-valuation": { stage: "stage_collateral_valuation", execute: "execute_collateral_valuation", heldReason: null },
  "create-service-request": { stage: "stage_service_request", execute: "execute_service_request", heldReason: null },
  "annual-review": { stage: "stage_annual_review", execute: "execute_annual_review", heldReason: null },
  "new-facility-request": { stage: "stage_new_facility", execute: "execute_new_facility", heldReason: null },
  "risk-rating-review": { stage: "stage_risk_rating_review", execute: "execute_risk_rating_review", heldReason: null },
  // UNHELD 2026-08-22 (WS0.5 item 1). `execute_loan_modification` is deployed
  // and was exercised live over the REST Actions API on throwaway data, so the
  // client no longer carries a hold of its own. What the org still enforces is
  // the BOOKING handoff: executing produces a clone facility at Qualification,
  // and moving that clone past approval is nCino's own Submit for Approval run
  // (Loan_Validation_06). That fact reaches the banker through the plan's
  // `warnings[]` and the `held_execution` handoff step, not through a gate.
  //
  // The ORG remains the authority on holding: a staged plan carrying
  // `executionHeld: true` still blocks the gesture in the confirm gate.
  "loan-modification": {
    stage: "stage_loan_modification",
    execute: "execute_loan_modification",
    heldReason: null,
  },
  // UNHELD 2026-08-22 (WS0.5 items 2+3). The founder gate stood on one fact:
  // `execute_covenant_review` had never been run live. It has now, twice, on
  // throwaway data, and both arms are archived verbatim
  // (`observed-envelopes-covenant-bulk.json`: a Pending row moved to Compliant,
  // an In Progress row moved to Exception under `allowNonPending`, plus the
  // replay). The reason the gate named no longer exists, so the gate does not
  // either.
  //
  // What still holds the gesture is the ORG: a staged plan carrying
  // `executionHeld: true` blocks the confirm gate whatever this map says, and
  // the plan refuses a non-Pending row PER COVENANT unless the banker opts in.
  "covenant-review": {
    stage: "stage_covenant_review",
    execute: "execute_covenant_review",
    heldReason: null,
  },
  /* RELATIONSHIP INTAKE (2026-09-03). The only write arm that AUTHORS on the
     relationship rather than acting on what the org already holds: a covenant
     with an account junction and no loan junction, and a collateral asset with
     its ownership junction and no pledge.

     THE PAIR IS BUILT TO THE FROZEN CONTRACT and is not deployed as this ships,
     which is exactly the state `new-facility-request` and the rest of wave 2
     were built in. Nothing here is held: the ORG remains the authority, so a
     staged plan carrying `executionHeld: true` blocks the gesture whatever this
     map says, and a tool the connector does not yet publish fails as the
     unavailable tool it is rather than as a room that pretended. */
  "relationship-intake": {
    stage: "stage_relationship_intake",
    execute: "execute_relationship_intake",
    heldReason: null,
  },
  // EXECUTE HELD. `execute` is null, not a name we hope exists: the tool was
  // never built for renewal.
  renewal: {
    stage: "stage_renewal",
    execute: null,
    heldReason:
      "Staging works; execution awaits an approved facility path: Salesforce requires facilities to be Booked via its own Submit for Approval before a credit action can run (org rule LV06). The staged plan is preserved.",
  },
} as const;

/** Actions whose plan can be STAGED but not executed from here. */
export function isExecutionHeld(actionId: string): boolean {
  return isWriteAction(actionId) && WRITE_TOOLS[actionId].execute === null;
}

/** Why this action cannot be executed from here, in the words that fit ITS
 *  reason. LV06 and a founder gate are different facts and read differently. */
export function executionHeldReason(actionId: string): string | null {
  return isWriteAction(actionId) ? (WRITE_TOOLS[actionId].heldReason ?? null) : null;
}

/** The banker-facing explanation of the held state. One sentence of cause, one
 *  of consequence, and the reassurance that the work is not lost. */
export const EXECUTION_HELD_COPY =
  "Staging works; execution awaits an approved facility path: Salesforce requires facilities to be Booked via its own Submit for Approval before a credit action can run (org rule LV06). The staged plan is preserved.";

export type WriteActionId = keyof typeof WRITE_TOOLS;

export function isWriteAction(actionId: string): actionId is WriteActionId {
  return actionId in WRITE_TOOLS;
}

/** A33.5.1 domain error. Distinct from McpFailure, which is transport. */
export interface ToolError {
  code: string;
  message: string;
  orgError?: string;
  resumable?: boolean;
  idempotencyKey?: string;
  /** Parsed from the message when the tool rejects an illegal picklist value. */
  legalValues?: string[];
}

export type ToolOutcome<T> = { ok: true; result: T } | { ok: false; error: ToolError };

/**
 * One record's own outcome inside a batch. A failure on one is reported against
 * THAT record and does not discard the others.
 *
 * BOTH bulk tools return this under the same wire key, `items`, and each fills
 * the half that belongs to it (observed 2026-07-27 and 2026-08-22). The keys are
 * kept in one interface rather than two because the wire keeps them in one
 * array; which half is populated is read from what is present, never assumed.
 */
export interface ExecutedItem {
  /** Both: null means the read-back did not confirm the name — filed,
   *  unverified. Same semantic as the single-record case, per item. */
  recordName?: string | null;
  /**
   * THE ORG'S OWN ID FOR THIS RECORD, where the tool reports one per item.
   *
   * The two bulk tools that shipped before the intake name their records
   * through fields of their own (`valuationId`, `covenantComplianceId`), which
   * is why there was no generic key. The intake authors on two objects in one
   * plan and reports the id it created against each entry, so the trail can
   * name what was created rather than only how many.
   */
  recordId?: string;
  anchorName?: string | null;
  /** The org's own sentence for this item. */
  outcome?: string;

  /* -- collateral valuation ------------------------------------------------ */
  collateralId?: string;
  collateralName?: string;
  valuationId?: string;
  /** Probe 6 settled this negative: a filed valuation does not move the
   *  collateral value. Each item reports its own answer and none may claim a
   *  coverage improvement. */
  collateralValueMoved?: boolean;

  /* -- covenant review ----------------------------------------------------- */
  covenantId?: string;
  /** The compliance row the assessment landed on. */
  covenantComplianceId?: string;
  /** False when the plan carried this covenant but the write did not happen. */
  written?: boolean;
  /** The status the row now reads at, and the one it moved FROM. Both are the
   *  org's read-back, which is why the pair is reported rather than the target
   *  status the banker chose. */
  status?: string;
  sourceStatus?: string;
  /* Whether nCino minted the successor row is NOT carried per item: the org
     states it in this item's own `outcome` sentence, which is rendered
     verbatim, and the batch-level `approvalChainStarted` carries the same
     measurement in a form the tracker can render as a fact. */
}

/**
 * One facility's own outcome inside a package-anchored credit action.
 *
 * OBSERVED 2026-08-22 on `execute_loan_modification`
 * (`knowledge/sf-build-v2/wp2/observed-envelopes-execute-loan-modification.json`).
 * Every key below appeared on the wire; nothing here is inferred. The org
 * reports the clone it created, the chain row that records the revision, and
 * its own sentence for what it read back — the parent is named too, because
 * "the parent was not touched" is the fact a banker checks first.
 *
 * The whole array is NULL on a replay. That is not an empty batch: it means the
 * org is not re-asserting per-facility detail for a call that wrote nothing.
 */
export interface ExecutedFacility {
  /** The PARENT facility the modification was raised against. */
  facilityId: string;
  facilityName?: string;
  /** The facility nCino cloned. Named by the org after the changes landed. */
  cloneLoanId?: string;
  cloneName?: string;
  cloneStage?: string;
  cloneLookupKey?: string;
  /** The `LLC_BI__LoanRenewal__c` chain row tying clone to parent. */
  junctionId?: string;
  junctionName?: string;
  revisionNumber?: number;
  /** The org's re-read of the parent. A modification must not move it. */
  parentUnchanged?: boolean;
  /** The org's own sentence about what the apply step read back. */
  appliedChanges?: string;
  verification?: string;
  outcome?: string;
}

export interface ExecuteStepResult {
  id: string;
  type: string;
  label: string;
  state: string;
  detail?: string;
}

export interface ExecuteResult {
  stagingId: string;
  terminalState: string;
  steps: ExecuteStepResult[];
  outcome: string;
  replayed?: boolean;
  /** Collateral valuation only: states plainly when the value did not move. */
  collateralValueMoved?: boolean;
  valuationId?: string;
  caseId?: string;
  reviewId?: string;
  /**
   * The created record's NAME, read back from the org after the write.
   *
   * CRITICAL SEMANTIC (Apex builder, 2026-07-26): this is null EXACTLY when the
   * verification read-back failed — the `filed_unverified` case. A null here is
   * therefore evidence of a verification failure, not a missing nicety, and it
   * must never be papered over with a generic label. Doing so would hide a real
   * failure behind copy that reads like success.
   */
  recordName?: string | null;
  /** The thing the record was filed against, named by the org. */
  anchorName?: string | null;
  riskRatingReviewId?: string;
  loanId?: string;
  /** Bulk valuation and bulk covenant review: one result per record. */
  items?: ExecutedItem[];
  /**
   * COVENANT REVIEW, and it is MEASURED. Moving a compliance row into a
   * complete status can make nCino create the NEXT compliance row, and that
   * create is what fires `acnpex_covenantApprovalProcess` at a named human. The
   * executor re-queries after the write and reports what it saw.
   *
   * TRI-STATE. `null` on a replay: that run observed nothing, and whether a
   * chain started is the first run's answer rather than this one's.
   */
  approvalChainStarted?: boolean | null;
  /** Loan modification: one result per facility in the credit action. Absent on
   *  a replay, where the org returns null rather than restating the detail. */
  facilities?: ExecutedFacility[];
  facilityCount?: number;
  /** The clone the modification created. Present on the first run AND on the
   *  replay, which is how a replay still names what already exists. */
  cloneLoanId?: string;
  /** The org's sentence about what booking the clone requires. Rendered
   *  verbatim: it is the org's account of the nCino run, not ours. */
  bookingHandoff?: string;
  /** The package the credit action ran on. For a modification it is the SOURCE
   *  package: no new package is minted. */
  outputPackageId?: string;
  /** The package the facility was filed on. Created by the plan when the
   *  relationship had none; observed as `productPackageId`, not `packageId`. */
  productPackageId?: string;
  /** TRI-STATE. `true` on the invocation that created it, `null` on the resume
   *  (the org is not re-asserting it), absent when no package was involved.
   *  Coercing null to false would make a created package vanish on Continue. */
  packageCreated?: boolean | null;
  /** The borrowing-structure row: the relationship added as Borrower. */
  involvementId?: string;
  /** The record's status as the org holds it, e.g. "In Review". Observed. */
  status?: string;
  /**
   * TWO-PHASE EXECUTE (new facility).
   *
   * The in-transaction wait was architecturally impossible: the Loan Detail is
   * created by an AFTER-COMMIT flow, so no synchronous poll can ever see it,
   * and the busy-spin hit the Apex CPU ceiling before its own timeout could
   * fire (PROBE-LEDGER wave 4, `execute_new_facility` OBSERVED_FAILED).
   *
   * So execution is two invocations. The first returns `partial` with the loan
   * written and `wait_loan_detail` waiting; the banker's Continue gesture makes
   * the second, which re-queries once and either finishes or reports still
   * waiting. STILL WAITING IS NEVER A FAILURE: nothing has gone wrong, the org
   * simply has not finished yet.
   */
  resumable?: boolean;
  /** The org's own sentence about what a Continue would do. Rendered
   *  verbatim: it is the tool's explanation, not ours to paraphrase. */
  resumeDescriptor?: string;
  /** The facility's stage as the org holds it right now. */
  stage?: string;
  loanDetailId?: string;
  executionHeld?: boolean;
  heldReason?: string;
}

/**
 * DID THE ORG REPORT THIS RUN AS FAILED?
 *
 * `terminalState` is the Apex executor's own word for how the run ended, and
 * the normaliser above defaults it to "failed" when a payload carries none, a
 * malformed answer is not a filing. Reading it is the ONLY way an engine can
 * tell a failed execute from a successful one, because everything else on the
 * result (the record ids, the step list) is absent in exactly the same way on
 * both a failure and an answer the transport mangled.
 *
 * `partial` is NOT a failure and must never read as one: the two-invocation new
 * facility comes back partial by design, with the facility written.
 */
export function executionFailed(result: { terminalState?: string | null }): boolean {
  return (result.terminalState ?? "").trim().toLowerCase() === "failed";
}

/** The org's own account of a failed run, for the room to say verbatim. Never
 *  invented: where the tool said nothing, this says that it said nothing. */
export function failureReason(result: { outcome?: string | null }): string {
  return (result.outcome ?? "").trim() || "The org reported the run as failed and gave no reason with it.";
}

/* ------------------------------------------------------------- unwrapping */

const STEP_TYPES: StepType[] = ["write", "verification", "wait", "handoff", "observed_side_effect"];

function toStepType(v: unknown): StepType {
  return STEP_TYPES.includes(v as StepType) ? (v as StepType) : "observed_side_effect";
}

/** Map a wire step onto our PlanStep. Defensive: the wire may omit optionals. */
function toPlanStep(raw: Record<string, unknown>): PlanStep {
  return {
    id: String(raw.id ?? ""),
    type: toStepType(raw.type),
    label: String(raw.label ?? ""),
    objectName: typeof raw.objectName === "string" ? raw.objectName : undefined,
    fields: Array.isArray(raw.fields) ? raw.fields.map(String) : undefined,
    automationWoken: Array.isArray(raw.automationWoken) ? raw.automationWoken.map(String) : undefined,
    verification: typeof raw.verification === "string" ? raw.verification : undefined,
    state: typeof raw.state === "string" ? raw.state : undefined,
    detail: typeof raw.detail === "string" ? raw.detail : undefined,
    waitBudgetMs: typeof raw.waitBudgetMs === "number" ? raw.waitBudgetMs : undefined,
  };
}

/** One facility inside a package-anchored plan. A row without a facilityId
 *  cannot be reported against anything, so it is dropped rather than rendered
 *  as an anonymous facility the banker cannot place. */
function toStagedFacility(raw: Record<string, unknown>): StagedFacility {
  return {
    facilityId: String(raw.facilityId ?? ""),
    facilityName: typeof raw.facilityName === "string" ? raw.facilityName : undefined,
    creditActionStepId: typeof raw.creditActionStepId === "string" ? raw.creditActionStepId : undefined,
    verifyStepId: typeof raw.verifyStepId === "string" ? raw.verifyStepId : undefined,
    applyStepId: typeof raw.applyStepId === "string" ? raw.applyStepId : undefined,
    covenantCarryoverCount:
      typeof raw.covenantCarryoverCount === "number" ? raw.covenantCarryoverCount : undefined,
  };
}

/** One EXECUTED facility. Same doctrine as the staged row: a result without a
 *  parent facilityId cannot be reported against anything and is dropped rather
 *  than rendered as a clone the banker cannot place. */
function toExecutedFacility(raw: Record<string, unknown>): ExecutedFacility {
  return {
    facilityId: String(raw.facilityId ?? ""),
    facilityName: str(raw.facilityName),
    cloneLoanId: str(raw.cloneLoanId),
    cloneName: str(raw.cloneName),
    cloneStage: str(raw.cloneStage),
    cloneLookupKey: str(raw.cloneLookupKey),
    junctionId: str(raw.junctionId),
    junctionName: str(raw.junctionName),
    revisionNumber: typeof raw.revisionNumber === "number" ? raw.revisionNumber : undefined,
    parentUnchanged: typeof raw.parentUnchanged === "boolean" ? raw.parentUnchanged : undefined,
    appliedChanges: str(raw.appliedChanges),
    verification: str(raw.verification),
    outcome: str(raw.outcome),
  };
}

/** One EXECUTED item of a bulk batch. Each tool fills its own half; a key the
 *  wire did not send stays absent rather than being coerced to a default that
 *  would read as an answer. */
function toExecutedItem(raw: Record<string, unknown>): ExecutedItem {
  return {
    recordName: typeof raw.recordName === "string" ? raw.recordName : null,
    recordId: str(raw.recordId),
    anchorName: typeof raw.anchorName === "string" ? raw.anchorName : null,
    outcome: str(raw.outcome),
    collateralId: str(raw.collateralId),
    collateralName: str(raw.collateralName),
    valuationId: str(raw.valuationId),
    collateralValueMoved: typeof raw.collateralValueMoved === "boolean" ? raw.collateralValueMoved : undefined,
    covenantId: str(raw.covenantId),
    covenantComplianceId: str(raw.covenantComplianceId),
    written: typeof raw.written === "boolean" ? raw.written : undefined,
    status: str(raw.status),
    sourceStatus: str(raw.sourceStatus),
  };
}

/** One covenant of a package-scoped review plan. A row without a covenantId
 *  cannot be reported against anything, so the caller drops it rather than
 *  rendering an anonymous covenant the banker cannot place. */
function toStagedCovenant(raw: Record<string, unknown>): StagedCovenant {
  return {
    covenantId: String(raw.covenantId ?? ""),
    covenantName: str(raw.covenantName),
    covenantType: str(raw.covenantType),
    attachment: str(raw.attachment),
    covenantComplianceId: str(raw.covenantComplianceId),
    currentComplianceStatus: str(raw.currentComplianceStatus),
    assessedStatus: str(raw.assessedStatus),
    state: str(raw.state),
    reason: typeof raw.reason === "string" ? raw.reason : null,
    generatesNextRow: typeof raw.generatesNextRow === "boolean" ? raw.generatesNextRow : undefined,
    writeStepId: str(raw.writeStepId),
    statusStepId: str(raw.statusStepId),
    verifyStepId: str(raw.verifyStepId),
    generationStepId: str(raw.generationStepId),
  };
}

/** One planned item, defensively: a row without a collateralId cannot be
 *  reported against anything and is dropped rather than rendered anonymous. */
function toStagedItem(raw: Record<string, unknown>): StagedItem {
  return {
    collateralId: String(raw.collateralId ?? ""),
    collateralName: typeof raw.collateralName === "string" ? raw.collateralName : undefined,
    value: typeof raw.value === "number" ? raw.value : null,
    writeStepId: typeof raw.writeStepId === "string" ? raw.writeStepId : undefined,
    verifyStepId: typeof raw.verifyStepId === "string" ? raw.verifyStepId : undefined,
    rollupStepId: typeof raw.rollupStepId === "string" ? raw.rollupStepId : undefined,
  };
}

/** `provenanceJson` arrives as a STRING. Parse defensively: a malformed blob
 *  must not take down a staging call that is otherwise fine. */
export function parseProvenance(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Pull the legal picklist set out of a VALIDATION_FAILED message. The tool
 *  lists them; we surface exactly what it returned and never invent the rest. */
export function parseLegalValues(message: string): string[] | undefined {
  // The COLON is required: the message often says "is not a legal value on this
  // org" earlier in the sentence, and matching that prose instead of the list
  // silently mangles the first value.
  const m = message.match(/(?:legal values?(?:\s+are)?|one of)\s*:\s*(.+)$/i);
  if (!m) return undefined;
  const values = m[1]
    .replace(/\.$/, "")
    .split(/\s*(?:,|;|\bor\b)\s*/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
  return values.length ? values : undefined;
}

function toToolError(raw: Record<string, unknown>): ToolError {
  const message = String(raw.message ?? "The tool reported a failure.");
  return {
    code: String(raw.code ?? "UNKNOWN"),
    message,
    orgError: typeof raw.orgError === "string" ? raw.orgError : undefined,
    resumable: raw.resumable === true,
    idempotencyKey: typeof raw.idempotencyKey === "string" ? raw.idempotencyKey : undefined,
    legalValues: parseLegalValues(message),
  };
}

/** Unwrap the positional envelope, then branch on outputValues.ok (A33.5.6). */
function unwrapToolOutcome<T>(payload: unknown, map: (r: Record<string, unknown>) => T): ToolOutcome<T> {
  const slot = unwrapInvocableOne<Record<string, unknown>>(payload);
  if (!slot.ok) {
    // Transport-level: isSuccess:false or non-null errors on the element.
    return { ok: false, error: { code: "TRANSPORT", message: slot.error } };
  }
  const out = slot.data;
  if (out?.ok === true && out.result && typeof out.result === "object") {
    return { ok: true, result: map(out.result as Record<string, unknown>) };
  }
  if (out?.error && typeof out.error === "object") {
    return { ok: false, error: toToolError(out.error as Record<string, unknown>) };
  }
  return { ok: false, error: { code: "UNEXPECTED", message: "The tool returned neither a result nor an error." } };
}

/* ------------------------------------------------------------------ stage */

export interface StagePayloads {
  /**
   * ITEMS[] ONLY, observed 2026-07-27. Mixing flat fields with `items[]` is
   * REFUSED by the tool, and so is a duplicate `collateralId` within a batch.
   * One item is a batch of one: there is no separate single-item shape.
   *
   * HARDENED 2026-08-22 (WS0.5 item 3), observed on the wire in
   * `observed-envelopes-valuation-hardened.json`:
   *   - `productPackageId` is REQUIRED. It is the deal anchor, and every
   *     collateral must be pledged to a loan of that package or owned by the
   *     package's borrower. A batch without it is refused outright.
   *   - `valuationDate` is REQUIRED PER ITEM and is not defaulted server-side:
   *     nCino orders valuations by it, and defaulting it to today would make
   *     two valuations of one asset on one date the normal case.
   *   - the batch is capped at 20 items.
   */
  "collateral-valuation": {
    idempotencyKey: string;
    rationale?: string;
    productPackageId: string;
    items: Array<{
      collateralId: string;
      value?: number | null;
      /** REQUIRED. Typed non-optional so an omission is a compile error here
       *  rather than a refusal the banker has to read. */
      valuationDate: string;
      /** LLC_BI__Type__c — the valuation BASIS (Net Orderly Liquidation Value,
       *  Fair Market Value, …). NOT where the number came from. */
      type?: string | null;
      /** LLC_BI__Source__c — the ORIGIN of the number (Appraisal, Receivables
       *  Aging, Inventory Report). NOT the basis it was struck on. */
      source?: string | null;
      description?: string | null;
      primary?: boolean;
    }>;
  };
  /**
   * THE DEPLOYED SHAPE, RE-READ AGAINST THE APEX (2026-09-02).
   *
   * `requestType` becomes `Subject` and `summary` becomes `Description`. The
   * class says so in its own field descriptions ("Banker-language description
   * of what the client asked for. Becomes the case subject" and "The request in
   * full, as the servicing team needs to read it"), and BOTH are required=true.
   * The relationship room used to ask for them the other way round, so a
   * CATEGORY landed on the subject line and the subject landed in the body.
   *
   * `origin` IS NOT AN INVOCABLE VARIABLE. `StageServiceRequest.cls` declares
   * none: it resolves `Case.Type` and `Case.Origin` itself through
   * `C360Picklist.preferredOrFallback` and reports `degradedTypeMode` where the
   * org offered neither preferred value. The key is KEPT on this type because
   * the Client Actions panel still sends it from its own schema control, and
   * removing it would change that panel's request body on the eve of a demo.
   * The relationship room does not send it and does not ask for it: a question
   * whose answer is dropped on the floor is worse than no question.
   */
  "create-service-request": {
    idempotencyKey: string;
    accountId: string;
    rationale?: string;
    /** Banker-language description of what the client asked for. -> `Subject`. */
    requestType?: string | null;
    /** NOT A WIRE ON THE APEX. See the note above. The room sends none. */
    origin?: string | null;
    /** The request in full, as the servicing team reads it. -> `Description`. */
    summary?: string | null;
    referenceKind?: string | null;
    referenceId?: string | null;
    referenceWebLink?: string | null;
  };
  "annual-review": {
    idempotencyKey: string;
    accountId: string;
    rationale?: string;
    reviewType?: string | null;
    productPackageId?: string | null;
    narrative?: string | null;
    relationshipSummary?: string | null;
    strengthsNarrative?: string | null;
    weaknessNarrative?: string | null;
    recommendationNarrative?: string | null;
    collateralAnalysisNarrative?: string | null;
    financialAnalystNarrative?: string | null;
    guarantorNarrative?: string | null;
    riskRatingComments?: string | null;
  };

  /* ---- WAVE 2 -------------------------------------------------------------
     OBSERVED 2026-07-26 (/tmp/wave2-envelopes.json). Every field below is
     copied verbatim from a request body the org actually accepted. Two notes:

     - `new-facility-request` carries NO accountId: it is anchored on the
       product package, which is what the org hangs a facility off.
     - the risk rating factor scores are four NAMED fields, not a map. */

  "new-facility-request": {
    idempotencyKey: string;
    rationale?: string;
    /**
     * EXACTLY ONE ANCHOR (both variants observed). A relationship WITH a package
     * sends `productPackageId` and no `accountId`; one WITHOUT sends `accountId`
     * and no `productPackageId`, and the returned plan opens with a
     * `create_package` step the way nCino's own wizard does.
     */
    productPackageId?: string;
    accountId?: string;
    /** `LLC_BI__Product__c`. Collected because the org files a blank one as
     *  `Construction` and then names the loan from it. */
    product?: string | null;
    amount?: number | null;
    termMonths?: number | null;
    /** `LLC_BI__Primary_Loan_Purpose__c` on the async-created Loan Detail. */
    primaryLoanPurpose?: string | null;
  };
  "risk-rating-review": {
    idempotencyKey: string;
    rationale?: string;
    accountId: string;
    computedRiskGradeValue?: number | null;
    cashFlowCoverageActual?: number | null;
    revenueGrowthActual?: number | null;
    managementExperienceActual?: number | null;
    creditScoreActual?: number | null;
    comments?: string | null;
    /**
     * THE OVERRIDE IS ON THE WIRE, and this comment used to say it was not.
     *
     * `StageRiskRatingReview.Request.overriddenRiskGradeValue` is DEPLOYED, it
     * carries its own description ("Any value above zero triggers the
     * Mandatory_comment rule") and `StageExecuteRiskRatingReviewTest`
     * .overrideWithACommentIsAccepted covers it. It maps to
     * `LLC_BI__Overridden_Risk_Grade_Value__c`.
     *
     * ANY VALUE ABOVE ZERO MAKES `comments` MANDATORY. That is the org's own
     * rule and it has no bypass, so the room validates it before the org has
     * to. `comments` is the field the rule tests, NOT
     * `LLC_BI__Override_Comment__c`.
     */
    overriddenRiskGradeValue?: number | null;
  };
  /**
   * PACKAGE-SCOPED BULK, rebuilt 2026-08-22 (WS0.5 item 2). Observed on the wire
   * in `observed-envelopes-covenant-bulk.json`.
   *
   * THE OLD SHAPE IS GONE, not deprecated: `accountId` + `covenantComplianceId`
   * + `result` anchored on a compliance ROW and named no covenant, so it could
   * not carry the parent-covenant reads (Active, Frequency Template, Effective
   * Date) that make the approval-trap warning and the Pending precondition
   * possible. Those superseded fields carried `required=true` on the invocable,
   * so sending them now makes the new shape unreachable on the wire.
   *
   * The anchor is the PRODUCT PACKAGE and the unit of action is still the
   * covenant: one plan, one hash, one token, N assessments.
   */
  "covenant-review": {
    idempotencyKey: string;
    rationale?: string;
    productPackageId: string;
    /** Optional member selection. Omitted, the whole package is surveyed. */
    covenantIds?: string[];
    /** Explicit opt-in to writing onto a compliance row that is not Pending.
     *  Such a write is stored and the covenant schedule does NOT advance. */
    allowNonPending?: boolean;
    assessments: Array<{
      covenantId: string;
      /** Compliant, Waived or Exception. nCino's three complete statuses. */
      status: string;
      /** Observed as a NUMBER on this wire (the invocable declares Decimal). */
      observedValue?: number | null;
      /** Breached or Overdue. THE field that separates a failed test from an
       *  undelivered document; the tool defaults it to Breached on Exception. */
      reasonForException?: string | null;
      narrative?: string | null;
      comments?: string | null;
    }>;
  };
  "loan-modification": FacilityAnchor & {
    idempotencyKey: string;
    rationale?: string;
    productPackageId?: string | null;
    /* THE FOUR SCALARS TRAVEL TWO WAYS (2026-08-31).

       Flat, below: ONE value applied to EVERY selected facility. That is the
       shape the tool shipped with, and it is still what a single-facility plan
       sends. Per target, in `scalarChangesJson`: one value aimed at one clone,
       which is what a mixed plan needs. The org REFUSES both channels in one
       request, because a clone would then have two figures and no rule to pick
       between them. */
    requestedAmount?: number | null;
    /** OBSERVED on StageLoanModification.Request as a Date, and applied by the
     *  plan's `apply_changes_*` step to `LLC_BI__Maturity_Date__c` on each
     *  clone. One of the four the tool's at-least-one-change rule counts. */
    requestedMaturityDate?: string | null;
    requestedTermMonths?: number | null;
    requestedRate?: number | null;
    /** PER-TARGET SCALARS (2026-08-31), JSON-encoded:
     *  [{key (one of the four request keys), value, targetLoanId}]. Each lands
     *  on the CLONE of the named facility ALONE, so a plan can take the line of
     *  credit to a new commitment while the equipment loan takes a different
     *  change entirely — the case the flat fields above cannot express, because
     *  they broadcast.
     *
     *  Mutually exclusive with those flat fields. Keys are validated against
     *  exactly the four names and targets against the selected facilities; an
     *  unknown one is refused with the legal list rather than dropped. */
    scalarChangesJson?: string | null;
    /** NET-NEW COVENANTS (2026-08-30). A JSON-encoded list the org resolves
     *  against its own covenant-type catalog at stage time:
     *  [{typeName, threshold, operator (< <= = >= >), frequency?, targetLoanId?}].
     *  Each is created Pending/Active on the borrower and attached to the CLONE
     *  of the targeted facility on the new package version. Counts toward the
     *  tool's at-least-one-change rule. */
    covenantAddsJson?: string | null;
    /** BORROWING-STRUCTURE amendments (2026-08-30), JSON-encoded:
     *  [{op (add|remove), role?, accountId? or accountName, ownership?, targetLoanId?}].
     *  Adds are authored on the CLONE with the new package anchor; removes are
     *  CARRY EXCLUSIONS — the parent keeps its row, nothing is deleted. */
    involvementChangesJson?: string | null;
    /** CURATED LOAN FIELDS (2026-08-31), JSON-encoded:
     *  [{field (API name or exact label), value, targetLoanId}]. Each is applied
     *  to the modification CLONE.
     *
     *  THE ORG RESOLVES THE NAME, not this client: the server reads its own live
     *  describe and takes the field only if it is updateable, non-formula and off
     *  the deny-list (the four scalars, which ride their own request keys; stage
     *  and status; the anchoring lookups; the versioning flags). It coerces the
     *  value by field type and validates a picklist against the org's ACTIVE
     *  values, refusing with the legal list rather than writing a near-miss.
     *  That is what makes a name here safe in a way the Interest_Rate lesson
     *  was not. Counts toward the tool's at-least-one-change rule. */
    fieldChangesJson?: string | null;
    /** NET-NEW FEES (2026-08-31), JSON-encoded:
     *  [{feeType, description, calculationType (Percentage|Flat Amount),
     *    percentage?, amount?, recordType?, targetLoanId?}]. Each is authored on
     *  the CLONE of the targeted facility, never on the booked parent.
     *
     *  THE ORG VALIDATES THE SHAPE, and its fee model is unusual enough that it
     *  has to: `feeType` is checked against the live LLC_BI__Fee_Type__c
     *  picklist (a residential/TRID set — a C&I fee files as "Other" with the
     *  banker's words in `description`, because `Name` on a fee is an
     *  autonumber); a Percentage fee must carry `percentage` and NO `amount`,
     *  since the org's own FeeTrigger derives the money from the clone's
     *  commitment; a Flat Amount fee must carry `amount` and no percentage.
     *  `RecordTypeId` is never sent — no Fee record type is assigned to the
     *  integration user's profile — so `recordType` is the independent picklist
     *  LLC_BI__Record_Type__c (Fees / Costs / Adjustments).
     *  Counts toward the tool's at-least-one-change rule. */
    feeAddsJson?: string | null;
    /** COLLATERAL PLEDGES (2026-08-31), JSON-encoded:
     *  [{collateralId?, newCollateral?: {description, collateralType, value},
     *    advanceRate?, amountPledged?, lienPosition?, advanceRateReason?,
     *    targetLoanId?}]. Each pledge lands on the CLONE of the targeted
     *  facility, beside the pledges the carry replicates from its parent.
     *
     *  EXACTLY ONE of `collateralId` and `newCollateral` per entry, and the org
     *  enforces the difference. `collateralId` must be a collateral THE BORROWER
     *  OWNS — proven through `LLC_BI__Account_Collateral__c`, which is the only
     *  link the object has to an account (`LLC_BI__Collateral__c` carries no
     *  account lookup at all) — and must not already be pledged to that
     *  facility. `newCollateral` authors the chain: the asset, then the
     *  ownership junction, then the pledge. `collateralType` is resolved against
     *  the org's live `LLC_BI__Collateral_Type__c` catalog and a refusal carries
     *  the candidates; a type whose own advance rate is null is refused before
     *  the org's `Advance_Rate_should_not_be_null` rule fires on the insert.
     *  `advanceRate` is REQUIRED on a create and rides
     *  `LLC_BI__Advance_Rate_Override__c` (the plain advance rate is a formula),
     *  which makes the org's `Advance_Rate_Override` rule demand a reason —
     *  supply `advanceRateReason` or the tool composes a provenance one.
     *  Counts toward the tool's at-least-one-change rule. */
    pledgeAddsJson?: string | null;
    /** POLICY EXCEPTIONS (2026-08-31), JSON-encoded:
     *  [{title, status (Waived|Mitigated|Unmitigated), mitigationReasons?,
     *    severity?, severityValue?, code?, targetLoanId?}]. Each is authored on
     *  the CLONE of the targeted facility (`LLC_BI__Loan__c`) and anchored on the
     *  borrower (`LLC_BI__Relationship__c`), born `LLC_BI__Type__c` = "Policy"
     *  like every row this org holds.
     *
     *  `title` is REQUIRED and rides `Name`, which is plain text rather than an
     *  autonumber: the org's trigger stack backfills an omitted one with the
     *  record's own 15-character Id, so an unnamed exception is a row nobody can
     *  find. `status` is validated against the live picklist — the org DEFAULTS a
     *  new row to Unmitigated, which reads as a decision rather than as an absent
     *  value, so the tool demands the status rather than accepting that default.
     *  `mitigationReasons` is a list laid onto the three
     *  `LLC_BI__Mitigation_Reason_N__c` fields, at most three and at most 100
     *  characters each; a longer one is refused with its length rather than
     *  truncated, and Mitigated with none is refused outright.
     *
     *  ⚠ EGRESS. This object carries the org-local `PolicyExceptionCDC` trigger,
     *  which enqueues an EventBridge callout POSTing the serialised records to an
     *  AWS endpoint on EVERY committed DML. No approval process targets the
     *  object and no email fires (recon Task 3d), but the borrower's data leaves
     *  the org. The whole plan's exceptions are inserted in ONE DML for exactly
     *  that reason. Counts toward the tool's at-least-one-change rule. */
    policyExceptionAddsJson?: string | null;
    /** COVENANT CARRY EXCLUSIONS (2026-09-02), JSON-encoded:
     *  [{covenantId? or junctionId?, targetLoanId?}]. EXACTLY ONE identifier per
     *  entry; `targetLoanId` may be omitted when the plan selects exactly one
     *  facility. At most ten.
     *
     *  NOTHING IS DELETED. A modification clones the parent and the carry
     *  replicates its junctions; an exclusion makes that carry write FEWER rows,
     *  so the booked facility keeps its own `LLC_BI__Loan_Covenant__c` and the
     *  clone simply starts without one. The org resolves the exact junction at
     *  STAGE time against the target parent, so the banker confirms a named
     *  covenant rather than a description, and refuses by name where the
     *  facility does not carry that covenant at all. */
    covenantExclusionsJson?: string | null;
    /** PLEDGE CARRY EXCLUSIONS (2026-09-02), JSON-encoded:
     *  [{pledgeId? or collateralId?, targetLoanId?}]. Same one-identifier rule,
     *  same optional target, same cap of ten.
     *
     *  The pledge object is `LLC_BI__Loan_Collateral2__c`. The ASSET and its
     *  `LLC_BI__Account_Collateral__c` ownership junction are RELATIONSHIP
     *  records and are never touched: what fails to travel onto the new version
     *  is the per-facility pledge alone. */
    pledgeExclusionsJson?: string | null;
    /** ASSOCIATING AN EXISTING COVENANT (2026-09-02), JSON-encoded:
     *  [{covenantId, targetLoanId?}]. `covenantId` is REQUIRED and is an
     *  `LLC_BI__Covenant2__c` id exactly as the covenants read returns it.
     *
     *  A JUNCTION-ONLY CREATE. `covenantAddsJson` resolves a covenant TYPE and
     *  always inserts a fresh covenant, which is why this is its own arm: the
     *  junction lands on the CLONE for the covenant the borrower already holds,
     *  no covenant is inserted and no covenant field is written, so the
     *  threshold, the frequency and the schedule stay exactly as the borrower
     *  holds them. The org refuses a duplicate junction and a covenant
     *  belonging to another relationship, each by name. */
    covenantAttachesJson?: string | null;
    /** NET-NEW FACILITIES ON THE NEW VERSION (founder, 2026-09-03), JSON-encoded:
     *  [{label?, product, amount, termMonths, purpose, amortizedTermMonths?,
     *  firstPaymentDate?}]. `product` is an org-exact Commercial Loan record-type
     *  value; the org would STORE anything else and render it wrong, so the tool
     *  refuses it by name against the catalog it holds.
     *
     *  A modification versions the whole PACKAGE, so the new version is where
     *  new money belongs: the facility is filed on it beside the clones, at
     *  Qualification with the borrower on its own borrowing structure, carrying
     *  no chain row and no modification flag because it is a new loan rather
     *  than a version of one. Every other arm of the same request may target it
     *  by its LABEL ("new:1") in place of `targetLoanId`, because the id does not
     *  exist until execution.
     *
     *  The PURPOSE lands on the Loan Detail, which nCino creates in its own
     *  transaction after the filing; the org writes it where that record is
     *  already there and reports a handoff where it is not. */
    newFacilitiesJson?: string | null;
  };
  /**
   * RELATIONSHIP INTAKE, built to the frozen contract (2026-09-03).
   *
   * ANCHORED ON THE ACCOUNT and on nothing else. There is no `productPackageId`
   * on this wire and that is the point: a relationship-level covenant belongs to
   * the borrower rather than to a package version, and an owned asset is the
   * borrower's whether the package exists or not. Both are the reason the two
   * `CREATE_GAPS` existed at all.
   *
   * THE TWO LISTS TRAVEL AS JSON STRINGS, exactly as `covenantAddsJson` and
   * `pledgeAddsJson` do on the modification wire, because the invocable declares
   * them as strings. Either may be omitted; a request carrying neither has
   * nothing to file and the tool refuses it.
   *
   *   covenantsJson   [{covenantTypeName, operator, threshold, frequency,
   *                     effectiveDate, nextEvaluationDate?, notes?}], max 10.
   *                   `covenantTypeName` is matched against the org's own
   *                   LLC_BI__Covenant_Type__c names, so a near miss is refused
   *                   by index rather than filed as something else. `operator`
   *                   is one of < <= = >= > and rides `Acnpex_Operator__c`,
   *                   mapped onto `Financial_Indicator_Operator__c`.
   *   collateralJson  [{collateralType, description, value, valuationBasis?,
   *                     valuationSource?, valuationDate?, address?,
   *                     ownerAccountId?}], max 10. `ownerAccountId` defaults to
   *                   `accountId`; the ownership junction is the only link
   *                   collateral has to an account.
   */
  "relationship-intake": {
    idempotencyKey: string;
    accountId: string;
    rationale?: string;
    covenantsJson?: string | null;
    collateralJson?: string | null;
  };
  renewal: FacilityAnchor & {
    idempotencyKey: string;
    rationale?: string;
    productPackageId?: string | null;
    newMaturityDate?: string | null;
    requestedRate?: number | null;
  };
}

/**
 * How a credit action names the facilities it covers — XOR, observed live
 * 2026-07-27 against the Hartwell package.
 *
 * `facilityIds` is the package-anchored shape: ONE plan, ONE planHash, ONE
 * decision token, N per-facility step triples. The flat `loanId` is the
 * back-compat shape and is byte-identical to what shipped before it.
 *
 * MIXING THE TWO IS REFUSED BY THE TOOL, and so is an empty list, a duplicate
 * id, and a facility from another package. The union below makes sending both
 * a compile error rather than a runtime refusal a banker has to read.
 */
export type FacilityAnchor =
  | { loanId: string; facilityIds?: never }
  | { facilityIds: string[]; loanId?: never };

/** What `complete_new_facility_detail` reports about one net-new facility. */
export interface NewFacilityDetail {
  label: string;
  loanId: string | null;
  recordName: string | null;
  loanDetailId: string | null;
  purpose: string | null;
  /** written, already_set, pending_detail or not_found. */
  state: string;
  verification: string | null;
}

export interface NewFacilityDetailResult {
  facilities: NewFacilityDetail[];
  writtenCount: number;
  pendingCount: number;
  /** True while a Loan Detail has not appeared yet. Calling again finishes it. */
  resumable: boolean;
  outcome: string;
}

/**
 * THE SECOND HOP FOR A NET-NEW FACILITY'S PURPOSE (2026-09-03).
 *
 * `LLC_BI__Primary_Loan_Purpose__c` lives on `LLC_BI__Loan_Detail__c`, which
 * nCino creates from an AFTER-COMMIT flow of its own. Nothing inside the
 * transaction that files the facility can see it, so execute reports the purpose
 * as pending and this finishes it.
 *
 * IT IS ITS OWN HOP ON PURPOSE. The 2026-08-31 governor fix exists to keep
 * writes out of the engine leg; bolting a third write pass onto either leg would
 * put the same transaction back under the pressure that fix removed.
 *
 * IT IS SAFE TO CALL AND SAFE TO REPEAT: the org writes nothing when the purpose
 * already reads back correct, nothing when the child has not appeared, and
 * nothing at all when the plan carried no net-new facility.
 */
export async function completeNewFacilityDetail(
  stagingId: string,
  approverUserId: string,
): Promise<ToolOutcome<NewFacilityDetailResult>> {
  const res = await callTool(
    SERVERS.customer360,
    TOOLS.completeNewFacilityDetail,
    { inputs: [{ stagingId, approverUserId }] },
    // A write is never cached and never auto-retried: the tool is idempotent by
    // construction, and a retry decision is the room's rather than the transport's.
    { cache: false, read: false },
  );
  return unwrapToolOutcome<NewFacilityDetailResult>(res.payload, (r) => ({
    facilities: Array.isArray(r.facilities)
      ? (r.facilities as Array<Record<string, unknown>>).map((f) => ({
          label: String(f.label ?? ""),
          loanId: f.loanId ? String(f.loanId) : null,
          recordName: f.recordName ? String(f.recordName) : null,
          loanDetailId: f.loanDetailId ? String(f.loanDetailId) : null,
          purpose: f.purpose ? String(f.purpose) : null,
          state: String(f.state ?? "not_found"),
          verification: f.verification ? String(f.verification) : null,
        }))
      : [],
    writtenCount: Number(r.writtenCount ?? 0),
    pendingCount: Number(r.pendingCount ?? 0),
    resumable: r.resumable === true,
    outcome: String(r.outcome ?? ""),
  }));
}

/** Call `stage_*`. USER GESTURE ONLY — never on mount, never polled. */
export async function stageAction<K extends WriteActionId>(
  actionId: K,
  payload: StagePayloads[K],
): Promise<ToolOutcome<StagedOutput>> {
  const res = await callTool(
    SERVERS.customer360,
    WRITE_TOOLS[actionId].stage,
    { inputs: [payload] },
    // A stage call computes and plans; it writes nothing, but it is not a read
    // either. No caching, no retry: `read` stays false so a stamped-retryable
    // failure is never auto-repeated.
    { cache: false },
  );
  return unwrapToolOutcome<StagedOutput>(res.payload, (r) => ({
    /* `planId` IS THE SAME THING UNDER THE INTAKE CONTRACT'S OWN NAME. Every
       tool deployed before it answers under `stagingId` and reaches this
       fallback never; the intake pair names the staging row `planId`, and a
       client that read an empty string there would offer a token bound to
       nothing. */
    stagingId: String(r.stagingId ?? r.planId ?? ""),
    planHash: String(r.planHash ?? ""),
    decisionToken: typeof r.decisionToken === "string" ? r.decisionToken : null,
    replayed: r.replayed === true,
    accountId: typeof r.accountId === "string" ? r.accountId : undefined,
    productPackageId: typeof r.productPackageId === "string" ? r.productPackageId : undefined,
    summary: String(r.summary ?? ""),
    steps: Array.isArray(r.steps) ? r.steps.map((s) => toPlanStep(s as Record<string, unknown>)) : [],
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
    suggestions: [],
    provenanceJson: typeof r.provenanceJson === "string" ? r.provenanceJson : undefined,
    executionHeld: r.executionHeld === true,
    heldReason: typeof r.heldReason === "string" ? r.heldReason : undefined,
    items: Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>).map(toStagedItem) : undefined,
    itemCount: typeof r.itemCount === "number" ? r.itemCount : undefined,
    facilities: Array.isArray(r.facilities)
      ? (r.facilities as Array<Record<string, unknown>>).map(toStagedFacility).filter((f) => f.facilityId !== "")
      : undefined,
    facilityCount: typeof r.facilityCount === "number" ? r.facilityCount : undefined,
    covenants: Array.isArray(r.covenants)
      ? (r.covenants as Array<Record<string, unknown>>).map(toStagedCovenant).filter((c) => c.covenantId !== "")
      : undefined,
    assessedCount: typeof r.assessedCount === "number" ? r.assessedCount : undefined,
    refusedCount: typeof r.refusedCount === "number" ? r.refusedCount : undefined,
    refusals: Array.isArray(r.refusals)
      ? (r.refusals as Array<Record<string, unknown>>)
          .map((x) => ({
            index: typeof x.index === "number" ? x.index : -1,
            reason: String(x.reason ?? ""),
          }))
          .filter((x) => x.reason !== "")
      : undefined,
    scopeCount: typeof r.scopeCount === "number" ? r.scopeCount : undefined,
    createsPackage: r.createsPackage === true,
    plannedPackageName: typeof r.plannedPackageName === "string" ? r.plannedPackageName : undefined,
    covenantCarryoverCount: typeof r.covenantCarryoverCount === "number" ? r.covenantCarryoverCount : undefined,
    provenance: parseProvenance(r.provenanceJson),
  }));
}

/* ---------------------------------------------------------------- execute */

/** Identical across all three tools (read from the Execute*.cls Request classes). */
export interface ExecutePayload {
  idempotencyKey: string;
  stagingId: string;
  planHash: string;
  decisionToken: string;
  approverUserId: string;
}

/**
 * The Salesforce user id the execute tools will accept as `approverUserId`.
 *
 * LIVE DEFECT, 2026-07-26. The panel was sending `meta.user`, which is the
 * DISPLAY NAME ("Fabian Goetzens"). The Apex checks, in order: staging row →
 * planHash → `approverUserId` equals the running identity → token hash. The
 * name failed the third check, so every attempt died BEFORE token redemption
 * and the staging rows all sat at Staged with cm_Token_Consumed_At__c null.
 *
 * So this refuses anything that is not shaped like a user id. Fail closed: it
 * is better to say the id is not staged than to send a value the org will
 * refuse and report as a generic tool failure.
 */
const SF_USER_ID = /^005[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

export function resolveApproverUserId(meta: { user?: string; userId?: string } | undefined): string | null {
  // `userId` is the field the assembler stages for this. `user` is checked only
  // because an assembler that stages the id there is still correct; a name
  // there is not, and falls through to null.
  for (const candidate of [meta?.userId, meta?.user]) {
    if (typeof candidate === "string" && SF_USER_ID.test(candidate.trim())) return candidate.trim();
  }
  return null;
}

/**
 * RESUME CONTRACT (observed 2026-07-26).
 *
 * `decisionToken` is declared `required=true` on the invocable variable, and
 * the Actions API enforces that at the PLATFORM boundary: a null or omitted
 * token on invocation 2 is rejected before Apex runs, with
 * `REQUIRED_FIELD_MISSING`. The Apex resume path never reads it (it dispatches
 * on staging status), so the token is single-use SEMANTICALLY — invocation 1
 * consumes it and stamps `cm_Token_Consumed_At` exactly once — while the wire
 * still requires its PRESENCE on the resume as a transport formality.
 *
 * So the caller resends the original stage token. That is the natural caller
 * behaviour and the one the verified envelope captured.
 */
/** Call `execute_*`. USER GESTURE ONLY, and only behind a confirmed plan. */
export async function executeAction(
  actionId: WriteActionId,
  payload: ExecutePayload,
): Promise<ToolOutcome<ExecuteResult>> {
  const tool = WRITE_TOOLS[actionId].execute;
  // Defence in depth: the gate disables the gesture, and the call is refused
  // anyway rather than sending a tool name that does not exist.
  if (!tool) {
    return {
      ok: false,
      error: { code: "EXECUTION_HELD", message: executionHeldReason(actionId) ?? EXECUTION_HELD_COPY, resumable: false },
    };
  }
  const res = await callTool(
    SERVERS.customer360,
    tool,
    { inputs: [payload] },
    // A write is never cached and never auto-retried: an ambiguous transport
    // outcome is not proof the tool did not run.
    { cache: false, read: false },
  );
  return unwrapToolOutcome<ExecuteResult>(res.payload, (r) => ({
    stagingId: String(r.stagingId ?? ""),
    terminalState: String(r.terminalState ?? "failed"),
    outcome: String(r.outcome ?? ""),
    replayed: r.replayed === true,
    collateralValueMoved: typeof r.collateralValueMoved === "boolean" ? r.collateralValueMoved : undefined,
    valuationId: typeof r.valuationId === "string" ? r.valuationId : undefined,
    caseId: typeof r.caseId === "string" ? r.caseId : undefined,
    reviewId: typeof r.reviewId === "string" ? r.reviewId : undefined,
    riskRatingReviewId: typeof r.riskRatingReviewId === "string" ? r.riskRatingReviewId : undefined,
    items: Array.isArray(r.items)
      ? (r.items as Array<Record<string, unknown>>).map(toExecutedItem)
      : undefined,
    approvalChainStarted:
      typeof r.approvalChainStarted === "boolean" ? r.approvalChainStarted : r.approvalChainStarted === null ? null : undefined,
    facilities: Array.isArray(r.facilities)
      ? (r.facilities as Array<Record<string, unknown>>).map(toExecutedFacility).filter((f) => f.facilityId !== "")
      : undefined,
    facilityCount: typeof r.facilityCount === "number" ? r.facilityCount : undefined,
    cloneLoanId: str(r.cloneLoanId),
    bookingHandoff: str(r.bookingHandoff),
    outputPackageId: typeof r.outputPackageId === "string" ? r.outputPackageId : undefined,
    productPackageId: typeof r.productPackageId === "string" ? r.productPackageId : undefined,
    packageCreated: typeof r.packageCreated === "boolean" ? r.packageCreated : r.packageCreated === null ? null : undefined,
    involvementId: typeof r.involvementId === "string" ? r.involvementId : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    loanId: typeof r.loanId === "string" ? r.loanId : undefined,
    resumable: r.resumable === true,
    resumeDescriptor: typeof r.resumeDescriptor === "string" ? r.resumeDescriptor : undefined,
    stage: typeof r.stage === "string" ? r.stage : undefined,
    loanDetailId: typeof r.loanDetailId === "string" ? r.loanDetailId : undefined,
    executionHeld: r.executionHeld === true,
    heldReason: typeof r.heldReason === "string" ? r.heldReason : undefined,
    // `recordName` is canonical; the per-action aliases carry the SAME fact for
    // tools that predate it. All absent means the read-back did not confirm a
    // name, which is a state the UI must show rather than fill in.
    recordName: str(r.recordName) ?? str(r.caseNumber) ?? str(r.reviewName) ?? null,
    anchorName: str(r.anchorName) ?? null,
    steps: Array.isArray(r.steps)
      ? r.steps.map((s) => {
          const raw = s as Record<string, unknown>;
          return {
            id: String(raw.id ?? ""),
            type: String(raw.type ?? ""),
            label: String(raw.label ?? ""),
            state: String(raw.state ?? "pending"),
            detail: typeof raw.detail === "string" ? raw.detail : undefined,
          };
        })
      : [],
  }));
}

/** A non-empty string, or undefined. Blank is not a name. */
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Banker-readable copy for a domain failure, keeping the org's own words. */
export function toolErrorCopy(e: ToolError): string {
  if (e.code === "TRANSPORT") return e.message;
  return e.message;
}

export type { McpFailure };
