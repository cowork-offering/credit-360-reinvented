/* =============================================================================
   PER-OBJECT TRANSITION ALLOWLIST (A33.3.1 v3, binding)

   Each tool declares the exact object states it may create or transition.
   Anything not on this table is REFUSED BY THE TOOL, not merely absent from the
   UI. This file is the client-side mirror: the tracker validates every plan
   against it before the banker ever sees a confirm gesture, so a malformed plan
   is caught here rather than at the org boundary.

   Why an allowlist and not a permission: v1 generalised a Loan-specific fact
   into a whole-system claim. Withholding `LLC_BI__Exclude_Validation` fences
   Loan STAGE MOVEMENT and nothing else. It does nothing about Case creation,
   valuation insertion, risk-review write-back or covenant workflow. Those
   objects need their own fence, and this table IS that fence.
   ============================================================================= */

export interface ObjectPolicy {
  /** API name of the object. */
  object: string;
  /** Banker-facing name, so no UI ever renders the API name. */
  label: string;
  /** May the tool create this object at all? */
  mayCreate: boolean;
  /**
   * May the tool write onto a record that already exists?
   *
   * SEPARATE FROM `mayCreate`, and it has to be. Until WS0.5 every object this
   * mirror saw a write step on was creatable, so reading "write step" as
   * "create" cost nothing. The covenant review broke that: it is the first tool
   * that only ever UPDATES, and reading its writes as creates refused every
   * real plan at the confirm gate before a banker could confirm one.
   *
   * The mirror does NOT try to tell a create from an update. A wire step
   * declares its object and its field names and nothing else, and a heuristic
   * over those was tried and was wrong both ways. What the two flags say is
   * whether the tool touches this object AT ALL, in either mode; the one create
   * that must be caught on an update-only object — a compliance row — is caught
   * by `refusedFields`, because creating one means writing `LLC_BI__Covenant__c`.
   */
  mayUpdate: boolean;
  /** Field/value pairs a create is allowed to set as its state. */
  createStates: Array<{ field: string; value: string }>;
  /** Permitted state transitions. Empty means: none, ever. */
  transitions: Array<{ field: string; from: string[]; to: string[]; condition?: string }>;
  /** Fields this tool may never write, with the reason. */
  refusedFields: Array<{ field: string; reason: string }>;
  /** Prose refusals that are not field-shaped (deletes, sub-record creation). */
  refusedOperations: string[];
  /**
   * THE ONE DELETE A WRITE PLAN MAY CARRY: rows the plan's own transaction
   * minted and left unlinked, removed by the named steps and by nothing else.
   * nCino's managed triggers mint one collateral aggregate shell per pledge the
   * version creation copies onto a clone (proven on Hartwell, 2026-09-14: five
   * per version, lookupKey null, nothing pointing at them). The org's step
   * `sweep_aggregates` removes exactly those, in the same transaction, proven
   * by re-query; a shell a facility or a pledge points at stays. Any other step
   * on the object is still refused by the flags above.
   */
  removesOwnRows?: { steps: string[]; reason: string };
}

/** The A33.3.1 table, verbatim. Keys are the plan's `object` values. */
export const TRANSITION_ALLOWLIST: Record<string, ObjectPolicy> = {
  "LLC_BI__Loan__c": {
    object: "LLC_BI__Loan__c",
    label: "facility",
    mayCreate: true,
    // A modification writes the requested amount, term and rate onto the CLONE.
    mayUpdate: true,
    createStates: [
      { field: "LLC_BI__Stage__c", value: "Qualification" },
      { field: "LLC_BI__Status__c", value: "Open" },
    ],
    transitions: [
      {
        field: "LLC_BI__Stage__c",
        from: ["Qualification"],
        to: ["Proposal"],
        // Exactly one hop, in execute_new_facility phase 2, and only after the
        // Loan Detail verification step passes (founder decision 2026-07-26).
        condition: "loan-detail-verified",
      },
    ],
    refusedFields: [
      { field: "LLC_BI__hasRenewal__c", reason: "formula field" },
      { field: "LLC_BI__Number_Of_Renewals__c", reason: "formula field" },
    ],
    refusedOperations: [
      "every stage transition other than the single Qualification to Proposal hop, in either direction",
      "any write to a post-approval stage",
      "the Qualification to Proposal hop while Loan Detail is unverified",
      "setting both loan-type flags on a clone",
    ],
  },

  "LLC_BI__LoanRenewal__c": {
    object: "LLC_BI__LoanRenewal__c",
    label: "renewal junction",
    // nCino's invocable owns this junction (founder decision 2026-07-26).
    mayCreate: false,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [{ field: "LLC_BI__ParentLoanId__c", reason: "set once at creation" }],
    refusedOperations: [
      "creation by us: nCino's credit action owns the junction",
      "updates of any kind",
      "deletion: removing a chain row is permanent poison",
    ],
  },

  "LLC_BI__Covenant_Compliance2__c": {
    object: "LLC_BI__Covenant_Compliance2__c",
    label: "covenant compliance record",
    // Generation is managed automation; we never create these. UPDATING an
    // existing row is the entire covenant review.
    mayCreate: false,
    mayUpdate: true,
    createStates: [],
    transitions: [
      // WAIVED joined the pair in WS0.5, matching the org's own write guard
      // (C360WriteGuard UPDATE_TRANSITIONS = Compliant, Waived, Exception). A
      // waiver is a decision not to enforce and is its own outcome, never a
      // synonym for either of the other two.
      //
      // `In Progress` is a legitimate SOURCE only under the banker's explicit
      // allowNonPending opt-in; without it the org refuses that row per
      // covenant, and the plan never contains the step at all.
      { field: "LLC_BI__Status__c", from: ["Pending", "In Progress"], to: ["Compliant", "Waived", "Exception"] },
    ],
    refusedFields: [
      { field: "LLC_BI__Effective_Date__c", reason: "writing it corrupts the whole compliance schedule" },
      { field: "LLC_BI__Covenant__c", reason: "set once at creation" },
    ],
    refusedOperations: [
      "creation: generation is managed automation, and a create is what raises the bank's covenant approval",
      "any status transition outside the three complete statuses",
      "Reason for Exception outside Breached and Overdue, which the org fences too",
    ],
  },

  "LLC_BI__Collateral_Valuation__c": {
    object: "LLC_BI__Collateral_Valuation__c",
    label: "collateral valuation",
    mayCreate: true,
    mayUpdate: false,
    createStates: [
      { field: "LLC_BI__Active__c", value: "true" },
      { field: "LLC_BI__Primary__c", value: "true" },
    ],
    transitions: [],
    refusedFields: [
      { field: "LLC_BI__Lendable_Value__c", reason: "formula on the parent collateral record" },
    ],
    refusedOperations: ["updates", "deletes", "sub-collateral creation"],
  },

  "LLC_BI__Review__c": {
    object: "LLC_BI__Review__c",
    label: "credit review",
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "LLC_BI__Status__c", value: "In Progress" }],
    transitions: [],
    refusedFields: [
      { field: "cm_Review_Stage__c", reason: "the bank's own process owns this ladder" },
      { field: "RecordTypeId", reason: "the after-save flow assigns it" },
      { field: "cm_Approved_Date__c", reason: "belongs to the approval path, which is not ours" },
    ],
    refusedOperations: [
      "any status transition, including to Complete",
      "writing cm_Review_Stage__c to Approval or Complete",
    ],
  },

  "LLC_BI__Annual_Review__c": {
    object: "LLC_BI__Annual_Review__c",
    label: "risk rating review",
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "LLC_BI__Status__c", value: "In Review" }],
    transitions: [],
    refusedFields: [{ field: "LLC_BI__Final_Risk_Grade__c", reason: "formula field" }],
    refusedOperations: [
      "any decision transition: Approved and Declined belong to the org's own decisioning path",
    ],
  },

  Case: {
    object: "Case",
    label: "service request",
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "Status", value: "New" }],
    transitions: [],
    refusedFields: [],
    refusedOperations: ["any status transition", "case closure"],
  },

  /* ---- THE THREE `stage_new_facility` PLANS ON, and this mirror did not know
     about any of them. The Loan policy above covered `write_loan` and the one
     stage hop, and the other three write steps in the org's own observed plan
     — `create_package`, `write_involvement`, `write_loan_purpose` — landed on
     objects with no policy, which reads as "not on the transition allowlist".
     That is the wrong sentence twice over: it says the plan is malformed when
     the plan is the org's, and it would refuse every real creation at the
     confirm gate. Mirrored below from `C360WriteGuard`'s own CREATE_STATES,
     FORBIDDEN_FIELDS and CREATE_ONLY sets, which is the fence the deployed tool
     actually passes through.                                                  */

  "LLC_BI__Product_Package__c": {
    object: "LLC_BI__Product_Package__c",
    label: "credit package",
    // Two doors touch a package. Creation: the account door of a create plan
    // makes the package before the facility, exactly as nCino's own wizard
    // does. Versioning (2026-08-30): a modification rolls the whole package
    // into a NEW one via the credit action, and the execute tool then repairs
    // what the engine leaves broken on it (a blank-prefixed name, a null
    // account) — the one update the org-side gate permits.
    mayCreate: true,
    mayUpdate: true,
    createStates: [],
    transitions: [],
    refusedFields: [
      { field: "RecordTypeId", reason: "real packages in this org have none, and only Master is available to the running profile anyway" },
      { field: "LLC_BI__Stage__c", reason: "the package's own stage belongs to the org's package automation" },
      { field: "LLC_BI__Status__c", reason: "the package's own status belongs to the org's package automation" },
    ],
    refusedOperations: ["deletion", "any update beyond the versioning name and account repair"],
  },

  "LLC_BI__Covenant2__c": {
    object: "LLC_BI__Covenant2__c",
    label: "covenant",
    // The net-new covenant arm (2026-08-30). Born Pending and Active on the
    // borrower account, or not at all: any other birth status would be authored
    // compliance history. Probed safe live: creating one mints no compliance
    // row, starts no approval and sends no email.
    mayCreate: true,
    mayUpdate: false,
    createStates: [
      { field: "LLC_BI__Covenant_Status__c", value: "Pending" },
      { field: "LLC_BI__Active__c", value: "true" },
    ],
    transitions: [],
    refusedFields: [
      { field: "LLC_BI__Breached__c", reason: "evaluation outcome, owned by the org's review cycle" },
      { field: "LLC_BI__Overdue__c", reason: "evaluation outcome, owned by the org's review cycle" },
      { field: "LLC_BI__Is_Template__c", reason: "templates are configuration, not credit facts" },
    ],
    refusedOperations: ["updates of any kind", "deletion"],
  },

  "LLC_BI__Loan_Covenant__c": {
    object: "LLC_BI__Loan_Covenant__c",
    label: "covenant junction",
    // The versioning carry (2026-08-30). nCino's engine copies NO junction rows
    // in this org (verified live: every related-lists copy default on, engine
    // run, zero rows landed), so the execute tool replicates each rolled
    // member's junctions onto its clone and proves the counts by re-query. The
    // carry may only REPLICATE rows that exist on a version parent, so no
    // create state is fenced here.
    //
    // WIDENED 2026-09-02, mirroring C360WriteGuard's OP_CREATE doctrine (founder
    // P1): a junction may also be authored for a covenant the BORROWER already
    // holds, to associate a relationship-level covenant to the facility. Such a
    // covenant carries no loan junction, so it is not on the loan however it
    // reads at relationship level. It is a junction create and nothing else:
    // covenant AMEND and DETACH stay fenced, here and in the org.
    //
    // A CARRY EXCLUSION NEEDS NOTHING FROM THIS TABLE (founder P2). Removing a
    // covenant from the open loan on a modification is the new version not
    // carrying that junction. The parent keeps its row, the covenant record is
    // never written, and the carry simply writes fewer rows. There is no
    // "remove" entry here and there must never be: that would be a doorway to
    // the delete this fence exists to refuse.
    mayCreate: true,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [],
    refusedOperations: ["updates of any kind: every field on this junction is non-updateable in the org", "deletion"],
  },

  "LLC_BI__Account_Covenant__c": {
    object: "LLC_BI__Account_Covenant__c",
    label: "relationship covenant",
    // THE MIRROR WAS MISSING THIS ONE (found 2026-09-03 building relationship intake). The Apex
    // guard has carried it since 2026-08-31, when the founder corrected the modification arm to
    // mint the account association nCino's own UI mints beside every covenant. This mirror never
    // learned it, so the first plan whose steps named the object would have been refused at the
    // confirm gate by our own belt-and-braces - the same failure the wave-2 comment below
    // describes, one object later.
    //
    // It is the RELATIONSHIP junction, and it is the whole reason a covenant can exist without
    // touching a facility: the package view of covenants is the union of this junction and the
    // loan one, deduped by covenant id. Two required lookups, nothing else.
    mayCreate: true,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [],
    refusedOperations: ["updates of any kind", "deletion"],
  },

  "LLC_BI__Legal_Entities__c": {
    object: "LLC_BI__Legal_Entities__c",
    label: "borrowing structure row",
    // ONE row, and it is the borrower's at 100 percent ownership. A facility
    // insert creates none on its own, so without it the facility would have no
    // borrowing structure at all.
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "LLC_BI__Borrower_Type__c", value: "Borrower" }],
    transitions: [],
    refusedFields: [
      { field: "LLC_BI__Is_Borrower__c", reason: "formula derived from Borrower_Type" },
      { field: "LLC_BI__Is_Guarantor__c", reason: "formula derived from Borrower_Type" },
      { field: "LLC_BI__Is_CoBorrower__c", reason: "formula derived from Borrower_Type" },
      { field: "LLC_BI__Is_Grantor__c", reason: "formula derived from Borrower_Type" },
      { field: "LLC_BI__Is_Related_Entity__c", reason: "formula derived from Borrower_Type" },
      {
        field: "LLC_BI__Contingent_Amount__c",
        reason: "mutually exclusive with Ownership on one row, and the validation rule's only escape tests for a Household role this org does not have",
      },
    ],
    refusedOperations: ["updates of any kind", "a second involvement row: the tool files the borrower's and nothing else"],
  },

  "LLC_BI__Loan_Detail__c": {
    object: "LLC_BI__Loan_Detail__c",
    label: "loan detail",
    // NEVER CREATED BY US. nCino creates it in an after-commit flow of its own,
    // which is the whole reason execution is two invocations. The one field the
    // resume writes is the primary loan purpose.
    mayCreate: false,
    mayUpdate: true,
    createStates: [],
    transitions: [],
    /* THE FIELD FENCE, WIDENED TO MATCH THE APEX GUARD (2026-09-03). The Apex
       side learned this object the day `complete_new_facility_detail` shipped,
       and the two lists must say the same thing: one field is this package's and
       every other field on the row is nCino's. */
    refusedFields: [
      { field: "LLC_BI__Application_Method__c", reason: "the org defaults it on the record it creates" },
      { field: "LLC_BI__Loan__c", reason: "set once by nCino when it creates the row" },
      { field: "RecordTypeId", reason: "the org's own automation owns it" },
      { field: "OwnerId", reason: "the org's own automation owns it" },
      { field: "LLC_BI__Additional_Loan_Purposes__c", reason: "the primary purpose is the only one this tool writes" },
    ],
    refusedOperations: [
      "creation by us: the org's own after-commit flow owns it",
      "any write other than the primary loan purpose the resume and complete_new_facility_detail set",
    ],
  },

  /* WAVE-2 ARMS (2026-09-01): the Apex guard (C360WriteGuard) learned five
     objects the day the fee, collateral and policy-exception arms shipped;
     this mirror did not, so the first fee plan through the panel's confirm
     gate was refused by our own belt-and-braces - found live by the founder.
     These entries mirror the Apex guard's OP_CREATE semantics: all five are
     CREATE-ONLY on the clone/account, never updated, never transitioned. */

  "LLC_BI__Fee__c": {
    object: "LLC_BI__Fee__c",
    label: "fee",
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "LLC_BI__Status__c", value: "Active" }],
    transitions: [],
    refusedFields: [
      { field: "Name", reason: "autonumber, org-assigned" },
      { field: "RecordTypeId", reason: "no Fee record type is assigned to the integration user; LLC_BI__Record_Type__c is the picklist we set" },
      { field: "LLC_BI__Basis_Amount__c", reason: "the org's FeeTrigger derives it from the loan amount" },
    ],
    refusedOperations: ["updates of any kind", "deletes", "setting Amount on a percentage fee: the org computes it"],
  },

  "LLC_BI__Loan_Collateral2__c": {
    object: "LLC_BI__Loan_Collateral2__c",
    label: "collateral pledge",
    mayCreate: true,
    mayUpdate: false,
    createStates: [{ field: "LLC_BI__Active__c", value: "true" }],
    transitions: [],
    refusedFields: [
      { field: "LLC_BI__Advance_Rate__c", reason: "formula: override then auto-applied then type default; the banker's rate lands as the override" },
    ],
    // A PLEDGE CARRY EXCLUSION needs nothing from this table either (founder P2,
    // 2026-09-02): releasing collateral on a modification is the new version not
    // carrying that pledge. The booked facility keeps the pledge it holds today,
    // the asset and its ownership junction are relationship records and are
    // untouched, and nothing is deleted anywhere.
    refusedOperations: ["updates of any kind", "deletes", "aggregate shells: the carry mints one per clone, never one per pledge"],
  },

  "LLC_BI__Collateral__c": {
    object: "LLC_BI__Collateral__c",
    label: "collateral asset",
    mayCreate: true,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [{ field: "Name", reason: "autonumber COL-000n, org-assigned" }],
    refusedOperations: ["updates of any kind", "deletes"],
  },

  "LLC_BI__Account_Collateral__c": {
    object: "LLC_BI__Account_Collateral__c",
    label: "collateral ownership",
    mayCreate: true,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [],
    refusedOperations: ["updates of any kind", "deletes"],
  },

  "LLC_BI__Loan_Collateral_Aggregate__c": {
    object: "LLC_BI__Loan_Collateral_Aggregate__c",
    label: "collateral aggregate shell",
    // nCino owns this object: one rollup anchor per facility, minted and
    // maintained by its own triggers. This cockpit never creates or updates one.
    mayCreate: false,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [],
    refusedOperations: ["creates", "updates of any kind", "deleting a shell a facility or a pledge points at"],
    removesOwnRows: {
      steps: ["sweep_aggregates"],
      reason:
        "the version creation removes the shells its own transaction minted and left unlinked, and only those (0.9.25, backlog 46)",
    },
  },

  "LLC_BI__Policy_Exception__c": {
    object: "LLC_BI__Policy_Exception__c",
    label: "policy exception",
    mayCreate: true,
    mayUpdate: false,
    createStates: [],
    transitions: [],
    refusedFields: [
      { field: "LLC_BI__Automatically_Added__c", reason: "hand-authored exceptions are exactly not that" },
    ],
    refusedOperations: ["updates of any kind", "deletes", "omitting Name: the trigger backfills the record's own Id, unreadable in any UI"],
  },
};

/* -------------------------------------------------- per-tool object fences */

/**
 * Objects a NAMED tool may write, narrower than the table above (mirrors
 * `C360WriteGuard.TOOL_CREATE_OBJECTS`). Subtraction only: a tool key can take
 * objects away and can never add one, because a step still has to pass the
 * object policy afterwards.
 *
 * `relationship-intake` is the first entry and the reason the mechanism exists.
 * It files covenants and assets on the BORROWER: a covenant with its
 * relationship junction and no loan junction, an asset with its ownership
 * junction and no pledge. Both of those facility junctions are legitimate
 * creates on the object table because the modification arm authors them, so the
 * object fence alone would let intake reach a facility and say nothing.
 */
export const TOOL_OBJECT_FENCE: Record<string, string[]> = {
  "relationship-intake": [
    "LLC_BI__Covenant2__c",
    "LLC_BI__Account_Covenant__c",
    "LLC_BI__Collateral__c",
    "LLC_BI__Account_Collateral__c",
    "LLC_BI__Collateral_Valuation__c",
  ],
};

/* ------------------------------------------------------------- validation */

export interface AllowlistViolation {
  stepId: string;
  object: string;
  reason: string;
}

export interface StepFieldWrite {
  field: string;
  value?: unknown;
}

export interface ValidatableStep {
  id: string;
  type: string;
  /** Locally-built plans use `object`; the live wire uses `objectName`. */
  object?: string;
  objectName?: string;
  /** Locally-built plans carry values; the wire carries field NAMES only. */
  fields?: Array<StepFieldWrite | string>;
  /** Present when the step transitions rather than creates. */
  transition?: { field: string; from: string; to: string };
  /** Preconditions the executor has verified, for conditional transitions. */
  satisfiedConditions?: string[];
}

const asString = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * Validate one step against the allowlist. Returns every violation rather than
 * the first, so a malformed plan reports fully instead of one problem at a time.
 */
/** Normalise both shapes: locally-built `{field, value}` and the wire's bare name. */
function normalizeFields(fields: ValidatableStep["fields"]): StepFieldWrite[] {
  return (fields ?? []).map((f) => (typeof f === "string" ? { field: f } : f));
}

export function validateStep(step: ValidatableStep, toolId?: string): AllowlistViolation[] {
  const objectName = step.object ?? step.objectName;
  // Non-write steps touch nothing, so nothing to police.
  if (step.type !== "write" || !objectName) return [];

  const policy = TRANSITION_ALLOWLIST[objectName];
  if (!policy) {
    return [{ stepId: step.id, object: objectName, reason: `${objectName} is not on the transition allowlist` }];
  }

  // A tool that fences itself by name is held to that fence first. Omitting the
  // tool id leaves every existing caller on exactly the behaviour it had.
  if (toolId) {
    const fence = TOOL_OBJECT_FENCE[toolId];
    if (!fence) {
      return [{ stepId: step.id, object: objectName, reason: `no per-tool object fence is declared for ${toolId}` }];
    }
    if (!fence.includes(objectName)) {
      return [
        {
          stepId: step.id,
          object: objectName,
          reason: `${toolId} may not write ${policy.label}: it writes only [${fence.join(", ")}]`,
        },
      ];
    }
  }

  // The one delete a write plan may carry (see `removesOwnRows`): the org's own
  // sweep of rows this transaction minted, by the step the policy names.
  if (policy.removesOwnRows?.steps.includes(step.id)) return [];

  const out: AllowlistViolation[] = [];
  const fields = normalizeFields(step.fields);

  // Refused fields, whatever the operation.
  for (const f of fields) {
    const refused = policy.refusedFields.find((r) => r.field === f.field);
    if (refused) {
      out.push({ stepId: step.id, object: objectName, reason: `${f.field} may never be written: ${refused.reason}` });
    }
  }

  if (step.transition) {
    const t = policy.transitions.find(
      (x) => x.field === step.transition!.field && x.from.includes(step.transition!.from) && x.to.includes(step.transition!.to),
    );
    if (!t) {
      out.push({
        stepId: step.id,
        object: objectName,
        reason: `transition ${step.transition.field} ${step.transition.from} to ${step.transition.to} is not permitted on ${policy.label}`,
      });
    } else if (t.condition && !(step.satisfiedConditions ?? []).includes(t.condition)) {
      out.push({
        stepId: step.id,
        object: objectName,
        reason: `transition requires the ${t.condition} precondition, which is not satisfied`,
      });
    }
    return out;
  }

  // An ordinary field write. The mirror does not guess whether it is a create
  // or an update (see `mayUpdate`); it asks whether the tool may write this
  // object at all.
  if (!policy.mayCreate && !policy.mayUpdate) {
    out.push({ stepId: step.id, object: objectName, reason: `${policy.label} may never be written by this tool` });
    return out;
  }

  // Any state field the policy pins must carry the pinned value.
  // Value pinning only applies where values are present: the live wire carries
  // field NAMES, and the server enforces the values itself.
  for (const pinned of policy.createStates) {
    const written = fields.find((f) => f.field === pinned.field);
    if (written && written.value !== undefined && asString(written.value) !== pinned.value) {
      out.push({
        stepId: step.id,
        object: objectName,
        reason: `${pinned.field} may only be created as ${pinned.value}, got ${asString(written.value)}`,
      });
    }
  }

  return out;
}

/** Validate a whole plan. An empty array means every step is allowlisted. */
export function validatePlan(steps: ValidatableStep[], toolId?: string): AllowlistViolation[] {
  return steps.flatMap((step) => validateStep(step, toolId));
}

/* ------------------------------------------------- the one plan that deletes

   THE ALLOWLIST WAS WRITTEN FOR WRITES, and until 0.9.23 that was every plan
   this cockpit could stage. `LLC_BI__LoanRenewal__c` is refused outright here,
   with "deletion: removing a chain row is permanent poison" in its own refused
   list, and that judgement was right: an ad-hoc delete of a chain row leaves the
   booked parent reading `hasRenewal = true` for ever and every later roll is
   refused (proven on Hartwell, 2026-09-11).

   A DISCARD IS THE OPPOSITE OF AN AD-HOC DELETE. It removes the chain rows as
   part of a single ordered, verified transaction that also removes the clones
   and the version package, and the whole point of taking the chain rows is to
   flip the parents' formula BACK. So the discard plan is validated against its
   own fence: the objects the frozen contract names, and nothing else. A step
   naming any other object is a violation exactly as it always was.

   IT REPLACES THE WRITE POLICY RATHER THAN RELAXING IT. Nothing else may ever
   reach this function: the only caller branches on `discard-version`, the org
   discovers the delete set itself, and the banker confirms the org's own
   inventory rather than a list this page composed.                            */

/** Every object a version discard may remove, in the contract's own order. */
export const DISCARD_VERSION_OBJECTS: readonly string[] = [
  "LLC_BI__LoanRenewal__c",
  "LLC_BI__Loan_Collateral2__c",
  "LLC_BI__Loan_Covenant__c",
  "LLC_BI__Pricing_Rate_Component__c",
  "LLC_BI__Pricing_Payment_Component__c",
  "LLC_BI__Pricing_Stream__c",
  "LLC_BI__Fee__c",
  "LLC_BI__Legal_Entities__c",
  "LLC_BI__Loan_Detail__c",
  "LLC_BI__Loan__c",
  // The clones' own rollup anchors, frozen at stage time; nCino usually takes
  // them with the facility and the org reads that as already_gone (0.9.25).
  "LLC_BI__Loan_Collateral_Aggregate__c",
  "LLC_BI__Product_Package__c",
  // Kept and marked Withdrawn rather than deleted. It is on the fence because
  // the plan has a step for it; what that step does is the org's business.
  "cm_Action_Staging__c",
];

/** Validate a version discard's plan. Empty means every step is in the fence. */
export function validateDiscardPlan(steps: ValidatableStep[]): AllowlistViolation[] {
  return steps.flatMap((step) => {
    const objectName = step.objectName ?? step.object;
    // A verification, a wait or a handoff names no object and removes nothing.
    if (!objectName) return [];
    if (DISCARD_VERSION_OBJECTS.includes(objectName)) return [];
    return [
      {
        stepId: step.id,
        object: objectName,
        reason: `a version discard may not touch ${objectName}: it removes the version's own rows and nothing else`,
      },
    ];
  });
}
