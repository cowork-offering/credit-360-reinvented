/* =============================================================================
   PANEL SCHEMAS for the three SHIPPING actions (A33.4.5 / A33.4.6 / A33.4.8).

   Only these three have a schema. The other seven registry actions have no
   `panelSchema` yet and stay analysis-only — an action without a schema simply
   does not open the panel.

   Every field below traces to a contract table. Notably NOT rendered as inputs:
     - `LLC_BI__Collateral__c.LLC_BI__Lendable_Value__c` (formula on the parent)
     - `LLC_BI__Review__c.RecordTypeId` (the after-save flow assigns it)
     - `cm_Review_Stage__c` (local ladder: read and labelled, never written)
   Picklist option SETS are deliberately absent: A33.1.6 requires them to be read
   from the org. Each picklist declares `optionsFrom` and the renderer disables it
   until the org supplies values.
   ============================================================================= */

import type { BorrowerBundle, Covenant, Facility } from "../data/contract";
import { fmtCovVal } from "../data/finance";
import { isActiveFacility } from "../data/worklist";
import { collateralDetail, collateralRecords } from "../data/collateralRecords";
import { fmtDate, fmtMoney } from "../data/format";
import {
  bookedFacilities,
  bookedFacilityGap,
  facilityLabel,
  shortFacilityLabel,
  unbookedFacilities,
} from "../data/facilityStage";
import type { PanelField, PanelSchema } from "./panelSchema";
import { PREFILL_PROVENANCE, unansweredItems } from "./panelSchema";
import { COVENANT_ASSESSMENT_STATUSES } from "./observedPicklists";
import { DISCARD_LINE, NO_VERSION_REASON, whatStays } from "./discardVersion";
import type { DiscardTarget } from "./discardTarget";

export interface SchemaContext {
  bundle: BorrowerBundle | null;
  accountId: string;
  accountName: string;
  /** Picklist values loaded from the org, keyed "Object.Field". Absent = not loaded. */
  orgPicklists?: Record<string, string[]>;
  /**
   * `meta.generatedAt`, the deterministic clock every date derivation in this
   * cockpit reads (A10). A date default computed from `new Date()` would move
   * under the schema on every render and would disagree with everything else on
   * the screen. Absent leaves a date field empty rather than guessing.
   */
  asOf?: string;
  /**
   * The DEAL the banker picked, when they picked one.
   *
   * The two package-scoped bulk tickets list the members of ONE package, so the
   * chooser has to be able to change what the lists hold. Absent means "use the
   * relationship's own package", which is the default and the usual case.
   */
  packageId?: string;
  /**
   * THE VERSION THE DISCARD DOOR IS AIMED AT, resolved by the caller.
   *
   * It is handed in rather than derived here for the reason `discardTarget.ts`
   * explains: this module is what `book/packages.ts` reads `packageRecords` out
   * of, so reaching back for the roster from inside a schema builder would
   * close a module cycle. Absent on every other action, and absent means the
   * discard panel renders its blocking gap, which is the same answer.
   */
  discard?: DiscardTarget | null;
}

/** The ISO date the panel should treat as today, or null when the read stages
 *  no clock. Never `new Date()`: the artifact is a snapshot with its own. */
function today(ctx: SchemaContext): string | null {
  const d = ctx.asOf ? new Date(ctx.asOf) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

const provenanceOf = (source: PanelField["prefill"]["source"]) => PREFILL_PROVENANCE[source] ?? undefined;

/** Small helper so every field declaration stays readable and consistent. */
function field(f: Omit<PanelField, "prefill"> & { prefill: PanelField["prefill"] }): PanelField {
  return { ...f, prefill: { ...f.prefill, provenance: f.prefill.provenance ?? provenanceOf(f.prefill.source) } };
}

const picklist = (ctx: SchemaContext, object: string, fieldName: string): string[] | undefined =>
  ctx.orgPicklists?.[`${object}.${fieldName}`];

/* -------------------------------------------------- collateral-valuation */

/** The pledge carrying the largest lendable value on an ACTIVE facility — the
 *  natural anchor for a revaluation. */
function primaryPledge(
  bundle: BorrowerBundle | null,
): { facility: Facility; type?: string; value?: number; collateralId?: string } | null {
  let best: { facility: Facility; type?: string; value?: number; collateralId?: string } | null = null;
  for (const f of bundle?.exposure?.facilities ?? []) {
    for (const c of f.collateral ?? []) {
      const v = c.currentLendableValue ?? c.collateralValue;
      // Deterministic largest-pledge selection. We deliberately do NOT prefer a
      // pledge that happens to carry an id: that would hide a staging gap
      // behind a different, arbitrary record.
      if (best === null || (v ?? 0) > (best.value ?? 0)) {
        best = { facility: f, type: c.collateralType, value: v, collateralId: c.collateralId };
      }
    }
  }
  return best;
}

function collateralValuationSchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "LLC_BI__Collateral_Valuation__c";
  const pledge = primaryPledge(ctx.bundle);
  const asOf = today(ctx);
  // ANCHORED ON THE DEAL, like the covenants. A pledge the read PROVES hangs
  // off another package's facility is refused by the tool by name, so it is
  // listed with that reason rather than offered and then rejected.
  const packageId = activePackageId(ctx);
  const records = collateralRecords(onPackage(ctx.bundle, packageId));
  const offPackage = collateralRecords(offPackageOnly(ctx.bundle, packageId)).filter(
    (r) => !records.some((x) => x.collateralId && x.collateralId === r.collateralId),
  );

  return {
    writeObject: OBJ,
    writeObjectLabel: "collateral valuation",
    intro:
      "Records a new valuation against the pledged collateral. Every collateral in the batch must belong to the named deal. The lendable value on the collateral record is a formula and is not written here.",
    fields: [
      packageField(
        ctx,
        "Every collateral valued must be pledged to a loan of this package, or owned by the package's borrower.",
      ),
      field({
        key: "records",
        label: "Collateral to revalue",
        type: "multiselect",
        // Chosen from the relationship's collateral RECORDS, deduped from the
        // per-facility pledges: a banker revalues a piece of security once, not
        // once per loan it happens to secure.
        value: records.length === 1 && records[0].collateralId ? [records[0].collateralId] : [],
        prefill: { source: "NCINO_RECORD", citation: "Customer360Exposure — pledged collateral records" },
        editable: true,
        required: true,
        optionsAreRecords: true,
        options: records.filter((r) => r.collateralId).map((r) => r.collateralId!),
        optionLabels: records.filter((r) => r.collateralId).map((r) => r.displayName),
        optionDetails: records.filter((r) => r.collateralId).map(collateralDetail),
        disabledOptions: [
          ...records
            .filter((r) => !r.collateralId)
            .map((r) => ({ value: r.collateralType ?? "Collateral", reason: "no collateral record id staged" })),
          ...offPackage.map((r) => ({ value: r.displayName, reason: "pledged to another package's facilities" })),
        ],
        perItemInputs: [
          {
            valueKey: "recordValues",
            label: "New value",
            type: "currency",
            placeholder: "enter the new valuation",
          },
        ],
        target: { object: OBJ, field: "LLC_BI__Collateral__c" },
        gap: records.some((r) => r.collateralId)
          ? undefined
          : {
              reason: pledge
                ? "The collateral record id is not staged in this view, so there is nothing to write the valuation against."
                : "No collateral is pledged against the active facilities on this relationship.",
              blocksStaging: true,
            },
      }),
      field({
        key: "source",
        label: "Where the number came from",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        optionsFrom: { object: OBJ, field: "LLC_BI__Source__c" },
        options: picklist(ctx, OBJ, "LLC_BI__Source__c"),
        target: { object: OBJ, field: "LLC_BI__Source__c" },
        help: "The ORIGIN of the figure: an appraisal, a receivables aging, an inventory report.",
      }),
      field({
        key: "type",
        label: "Valuation basis",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        optionsFrom: { object: OBJ, field: "LLC_BI__Type__c" },
        options: picklist(ctx, OBJ, "LLC_BI__Type__c"),
        target: { object: OBJ, field: "LLC_BI__Type__c" },
        help: "The BASIS the figure was struck on: net orderly liquidation, fair market value, and so on.",
      }),
      field({
        key: "valuationDate",
        label: "Valuation date",
        type: "date",
        // Defaulted CLIENT-side from the view's clock, never server-side: a
        // banker correcting an offered date is a choice, an Apex default is the
        // org inventing one, and the org refuses a null rather than filling it.
        value: asOf,
        prefill: asOf
          ? { source: "COMPUTED", citation: "meta.generatedAt — the view's own clock" }
          : { source: "BANKER" },
        editable: true,
        required: true,
        target: { object: OBJ, field: "LLC_BI__Valuation_Date__c" },
        help: "The org refuses a second valuation of the same collateral on a date it already carries.",
      }),
      field({
        key: "value",
        label: "Valuation amount",
        type: "currency",
        value: pledge?.value ?? null,
        prefill: {
          source: "NCINO_RECORD",
          citation: pledge ? "current lendable value on the pledge" : undefined,
        },
        editable: true,
        required: true,
        target: { object: OBJ, field: "LLC_BI__Value__c" },
        help: "Prefilled from the current pledge value. Replace with the new valuation.",
      }),
      field({
        key: "primary",
        label: "Primary valuation",
        type: "boolean",
        // The three booleans default to false in the org, so a revaluation sets
        // Active and Primary explicitly (A33.4.5(a)).
        value: true,
        prefill: { source: "COMPUTED", citation: "revaluation sets Active and Primary explicitly" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Primary__c" },
      }),
      field({
        key: "description",
        label: "Valuation notes",
        type: "longtext",
        value: null,
        prefill: { source: "AGENT_NARRATIVE" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Valuation_Description__c" },
      }),
    ],
  };
}

/* ------------------------------------------------- create-service-request */

function serviceRequestSchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "Case";
  const req = (ctx.bundle?.requests ?? [])[0];

  return {
    writeObject: OBJ,
    writeObjectLabel: "service request",
    intro: "Logs a service request against the relationship. Created at status New; the tool performs no status transitions and never closes a case.",
    fields: [
      field({
        key: "account",
        label: "Relationship",
        type: "readonly",
        value: ctx.accountName,
        prefill: { source: "NCINO_RECORD", citation: ctx.accountId },
        editable: false,
        editableReason: "the action is anchored on this relationship",
        required: true,
        target: { object: OBJ, field: "AccountId" },
      }),
      field({
        key: "type",
        label: "Request type",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        optionsFrom: { object: OBJ, field: "Type" },
        options: picklist(ctx, OBJ, "Type"),
        target: { object: OBJ, field: "Type" },
      }),
      field({
        key: "origin",
        label: "Origin",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        optionsFrom: { object: OBJ, field: "Origin" },
        options: picklist(ctx, OBJ, "Origin"),
        target: { object: OBJ, field: "Origin" },
      }),
      field({
        key: "status",
        label: "Status",
        type: "readonly",
        value: "New",
        prefill: { source: "COMPUTED", citation: "created at New; no transitions in this tool" },
        editable: false,
        editableReason: "the tool creates at New only",
        required: true,
        target: { object: OBJ, field: "Status" },
      }),
      field({
        key: "subject",
        label: "Subject",
        type: "text",
        value: req?.summary ? req.summary.slice(0, 120) : null,
        prefill: req?.summary
          ? { source: "CLIENT_REQUEST", citation: req.reference?.id }
          : { source: "BANKER" },
        editable: true,
        required: true,
        target: { object: OBJ, field: "Subject" },
      }),
      field({
        key: "description",
        label: "Description",
        type: "longtext",
        value: req?.summary ?? null,
        prefill: req?.summary
          ? { source: "CLIENT_REQUEST", citation: req.reference?.id }
          : { source: "AGENT_NARRATIVE" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "Description" },
      }),
    ],
  };
}

/* -------------------------------------------------------- annual-review */

/** The nine narrative fields the execute step writes (A33.4.6(a)). */
const REVIEW_NARRATIVES: Array<[string, string, string]> = [
  ["narrative", "Review narrative", "LLC_BI__Narrative__c"],
  ["relationshipSummary", "Relationship summary", "cm_Relationship_Summary__c"],
  ["strengths", "Strengths", "cm_Strengths_Narrative__c"],
  ["weaknesses", "Weaknesses", "cm_Weakness_Narrative__c"],
  ["recommendation", "Recommendation", "cm_Recommendation_Narrative__c"],
  ["collateralAnalysis", "Collateral analysis", "cm_Collateral_Analysis_Narrative__c"],
  ["financialAnalysis", "Financial analysis", "cm_Financial_Analyst_Narrative__c"],
  ["guarantor", "Guarantor analysis", "cm_Guarantor_Narrative__c"],
  ["riskRatingComments", "Risk rating comments", "cm_Risk_Rating_Comments__c"],
];

function annualReviewSchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "LLC_BI__Review__c";

  const head: PanelField[] = [
    field({
      key: "account",
      label: "Relationship",
      type: "readonly",
      value: ctx.accountName,
      prefill: { source: "NCINO_RECORD", citation: ctx.accountId },
      editable: false,
      editableReason: "the action is anchored on this relationship",
      required: true,
      target: { object: OBJ, field: "LLC_BI__Account__c" },
    }),
    field({
      key: "status",
      label: "Status",
      type: "readonly",
      // Probe-confirmed: nothing defaults this, so the execute step sets it
      // explicitly rather than letting it land NULL (A33.4.6(a)).
      value: "In Progress",
      prefill: { source: "COMPUTED", citation: "set explicitly; the org defaults nothing" },
      editable: false,
      editableReason: "the tool creates at In Progress and stops",
      required: true,
      target: { object: OBJ, field: "LLC_BI__Status__c" },
    }),
    field({
      key: "reviewType",
      label: "Review type",
      type: "picklist",
      value: null,
      prefill: { source: "BANKER" },
      editable: true,
      required: true,
      optionsFrom: { object: OBJ, field: "LLC_BI__Review_Type__c" },
      options: picklist(ctx, OBJ, "LLC_BI__Review_Type__c"),
      target: { object: OBJ, field: "LLC_BI__Review_Type__c" },
    }),
    field({
      key: "isAgentic",
      label: "Agent-authored review",
      type: "readonly",
      value: true,
      prefill: { source: "COMPUTED", citation: "the org is pre-wired for agent-authored reviews" },
      editable: false,
      editableReason: "set by the tool",
      required: false,
      target: { object: OBJ, field: "LLC_BI__Is_Agentic_Review__c" },
    }),
    field({
      key: "reviewStage",
      label: "Review stage (Salesforce)",
      type: "readonly",
      value: null,
      prefill: { source: "NCINO_RECORD" },
      editable: false,
      editableReason: "read and labelled, never written by this tool",
      required: false,
      target: { object: OBJ, field: "cm_Review_Stage__c" },
      help: "The bank's own process moves this ladder. The tool creates the review and stops.",
    }),
  ];

  const narratives = REVIEW_NARRATIVES.map(([key, label, apiField]) =>
    field({
      key,
      label,
      type: "longtext",
      value: null,
      prefill: { source: "AGENT_NARRATIVE" },
      editable: true,
      required: false,
      target: { object: OBJ, field: apiField },
    }),
  );

  return {
    writeObject: OBJ,
    writeObjectLabel: "annual credit review",
    intro:
      "CREDIT REVIEW. " +
      REVIEW_FORK["annual-review"].explains +
      " Distinct from a Risk Rating Review, which refreshes the relationship's grade instead.",
    fields: [...head, ...narratives],
  };
}

/* =============================================================================
   WAVE 2 (A33.5.7 frozen contracts)

   Built against the CONTRACT while the Apex lane deploys, on the same seam
   discipline as WP5: field names and option sets are declared here once, so the
   swap when observed envelopes land is a single edit per action.

   Two of the five stage but cannot execute (LV06). That is a property of the
   tool map, not of these schemas: the ticket is complete and the plan is real,
   and the confirm gate is where the held state is explained.
   ============================================================================= */

/** The commitment the client actually asked for, when one is staged. */
function requestedCommitment(bundle: BorrowerBundle | null): number | null {
  const ask = (bundle?.requests ?? [])[0]?.ask;
  return typeof ask?.to === "number" ? ask.to : null;
}

function newFacilitySchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "LLC_BI__Loan__c";
  const pkg = ctx.bundle?.snapshot?.productPackageId;

  return {
    writeObject: OBJ,
    writeObjectLabel: "facility request",
    // The borrowing-structure claim is made ONLY for the package-first variant,
    // which is the one whose observed plan carries `write_involvement`. The
    // existing-package plan has never been observed with that step, and the
    // confirm gate renders whatever the org actually returns either way.
    intro: pkg
      ? "Requests a new facility on this relationship's package. Salesforce names the loan itself on creation and fills in the application method; the Loan Detail record follows about four seconds later."
      : "Requests a new facility for this relationship. No credit package exists yet, so one is created first and the facility filed under it, with the borrower added to its borrowing structure at 100 percent. Salesforce names the loan itself on creation and fills in the application method; the Loan Detail record follows about four seconds later.",
    fields: [
      field({
        key: "account",
        label: "Relationship",
        type: "readonly",
        value: ctx.accountName,
        prefill: { source: "NCINO_RECORD", citation: ctx.accountId },
        editable: false,
        editableReason: "the action is anchored on this relationship",
        required: true,
        target: { object: OBJ, field: "LLC_BI__Account__c" },
      }),
      field({
        key: "package",
        label: "Package",
        type: "readonly",
        // A relationship with no package is not a dead end: the org's own wizard
        // creates one first, and so does the plan. No blocking gap.
        value: pkg ? "This relationship's deal package" : "A new package will be created first",
        prefill: pkg
          ? { source: "NCINO_RECORD", citation: pkg }
          : { source: "COMPUTED", citation: "created by the plan, named the way Salesforce's wizard names it" },
        editable: false,
        editableReason: pkg ? "the facility hangs off the existing package" : "the plan creates it before the facility",
        required: false,
        target: { object: OBJ, field: "LLC_BI__Product_Package__c" },
      }),
      field({
        key: "amount",
        label: "Amount",
        type: "currency",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        target: { object: OBJ, field: "LLC_BI__Amount__c" },
      }),
      field({
        key: "productType",
        label: "Product",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        // PROBE 5, finding 2: the org self-populates this to `Construction`
        // when it is left blank, and then builds the loan's Name from it. A
        // tool that does not collect Product ships loans mislabelled.
        required: true,
        optionsFrom: { object: OBJ, field: "LLC_BI__Product__c" },
        options: picklist(ctx, OBJ, "LLC_BI__Product__c"),
        target: { object: OBJ, field: "LLC_BI__Product__c" },
        help: "Left blank, the org files this as Construction and names the loan accordingly.",
      }),
      field({
        key: "termMonths",
        label: "Term (months)",
        type: "text",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Term__c" },
      }),
      field({
        key: "purpose",
        label: "Primary loan purpose",
        type: "picklist",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        // PROBE 5, finding 4: of the two fields LV12/LV13 gate, the org
        // pre-fills Application Method and leaves this one null. It is the one
        // thing the banker actually has to supply, and it lives on the Loan
        // DETAIL, which the org creates asynchronously.
        required: true,
        optionsFrom: { object: "LLC_BI__Loan_Detail__c", field: "LLC_BI__Primary_Loan_Purpose__c" },
        options: picklist(ctx, "LLC_BI__Loan_Detail__c", "LLC_BI__Primary_Loan_Purpose__c"),
        target: { object: "LLC_BI__Loan_Detail__c", field: "LLC_BI__Primary_Loan_Purpose__c" },
        help: "Written to the Loan Detail once the org has created it.",
      }),
      field({
        key: "applicationMethod",
        label: "Application method",
        type: "readonly",
        value: "Online",
        prefill: { source: "COMPUTED", citation: "org-defaulted on the Loan Detail; nothing is sent for it" },
        editable: false,
        editableReason: "the org fills this in",
        required: false,
        target: { object: "LLC_BI__Loan_Detail__c", field: "LLC_BI__Application_Method__c" },
      }),
      field({
        key: "loanOfficer",
        label: "Loan officer",
        type: "readonly",
        value: "Assigned by the org",
        prefill: { source: "COMPUTED", citation: "org-assigned; ACNPEX_AccountOwnerAsLoanOfficer overwrites anything set here" },
        editable: false,
        editableReason: "the org assigns this and overwrites what we send",
        required: false,
        target: { object: OBJ, field: "LLC_BI__Loan_Officer__c" },
        help: "Set by Salesforce's own assignment routine, so the cockpit does not propose one.",
      }),
    ],
  };
}

function riskRatingSchema(ctx: SchemaContext): PanelSchema {
  // PROBE 4 (ledger wave 3): the object is LLC_BI__Annual_Review__c. There is
  // no LLC_BI__Risk_Rating_Review__c in this org; the label/API mismatch is
  // A33.4.7. It has no RecordTypeId and no OwnerId, and it is a cascade-delete
  // child of Account. Every field below was read back by the insert probe.
  const OBJ = "LLC_BI__Annual_Review__c";
  const grade = ctx.bundle?.snapshot?.primaryRiskRating;
  const computed = ctx.bundle?.snapshot?.computedRiskRating;

  return {
    writeObject: OBJ,
    writeObjectLabel: "risk rating review",
    intro:
      "RISK RATING REVIEW. " +
      REVIEW_FORK["risk-rating-review"].explains +
      " Distinct from a Credit Review, which is the periodic review of the deal itself. Created In Review; the org's own decision path owns Approved and Declined, and an override needs a stated reason.",
    fields: [
      field({
        key: "account",
        label: "Relationship",
        type: "readonly",
        value: ctx.accountName,
        prefill: { source: "NCINO_RECORD", citation: ctx.accountId },
        editable: false,
        editableReason: "the action is anchored on this relationship",
        required: true,
        target: { object: OBJ, field: "LLC_BI__Account__c" },
      }),
      field({
        key: "status",
        label: "Status",
        type: "readonly",
        // PROBE 4: an omitted status lands in `Not Approved`, which reads as a
        // DECISION rather than an absent value. The tool sets In Review
        // explicitly for exactly that reason.
        value: "In Review",
        prefill: { source: "COMPUTED", citation: "set explicitly; the org would otherwise default this to Not Approved" },
        editable: false,
        editableReason: "the tool creates at In Review and stops",
        required: true,
        target: { object: OBJ, field: "LLC_BI__Status__c" },
        help: "Left unset, the org files this as Not Approved, which reads as a decision nobody made.",
      }),
      field({
        key: "computedGrade",
        label: "Computed grade",
        type: "readonly",
        value: computed != null ? `Grade ${computed}` : null,
        prefill: { source: "NCINO_RECORD", citation: "Customer360Snapshot — the org's computed grade" },
        editable: false,
        editableReason: "the org computes this",
        required: false,
        target: { staging: true },
      }),
      field({
        key: "finalGrade",
        label: "Final grade",
        type: "readonly",
        value: grade != null ? `Grade ${grade}` : null,
        prefill: { source: "NCINO_RECORD", citation: "Customer360Snapshot — Salesforce risk grade" },
        editable: false,
        editableReason: "the org's decision path sets the final grade",
        required: false,
        // Displayed, never targeted: A33.1.6 bans this field as a write target
        // and the decision path owns it.
        target: { staging: true },
      }),
      // OBSERVED: the stage tool takes four NAMED factor actuals. They are the
      // inputs the org computes the grade from, so the ticket collects them.
      ...([
        ["cashFlowCoverage", "Cash flow coverage"],
        ["revenueGrowth", "Revenue growth"],
        ["managementExperience", "Management experience"],
        ["creditScore", "Credit score"],
      ] as Array<[string, string]>).map(([key, label]) =>
        field({
          key,
          label,
          type: "currency",
          value: null,
          prefill: { source: "BANKER" },
          editable: true,
          required: false,
          target: { object: OBJ, field: `LLC_BI__${label.replace(/ /g, "_")}_actual__c` },
        }),
      ),
      field({
        key: "overrideValue",
        label: "Override grade",
        type: "currency",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Overridden_Risk_Grade_Value__c" },
        help: "Leave empty to accept the computed grade.",
      }),
      field({
        key: "overrideComment",
        label: "Reason for the override",
        type: "longtext",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        // Conditionally required: see `overrideNeedsComment` below. The schema
        // cannot express "required when another field is set", so the rule is a
        // function the panel and the tests share rather than a duplicated
        // condition in each.
        required: false,
        target: { object: OBJ, field: "LLC_BI__Comments__c" },
      }),
    ],
  };
}

/**
 * The org's validation rule, stated once: an override without a reason is
 * refused. Enforced in the panel so the banker learns it here rather than from
 * a rejected write.
 */
export function overrideNeedsComment(values: Record<string, unknown>): boolean {
  const comment = typeof values.overrideComment === "string" ? values.overrideComment.trim() : "";
  return overrideIsSet(values) && comment === "";
}

export const OVERRIDE_COMMENT_REQUIRED = "An override requires a stated reason.";

/** A credit action is staged against the facilities the banker NAMES. An empty
 *  selection is not "all of them" and it is not a plan, so the ticket asks
 *  before anything reaches the wire. */
export const NO_FACILITY_SELECTED =
  "Choose at least one facility. A credit action is staged against the facilities you name, and an empty selection is not a plan.";

/** ONE credit action runs on ONE package. Facilities drawn from two packages
 *  are two deals, and filing them as one plan would aim a write at the wrong
 *  one — the same fail-closed rule the single-facility path already applies. */
export const FACILITIES_SPAN_PACKAGES =
  "These facilities belong to different product packages. A credit action runs on one package, so stage each package's facilities separately.";

/**
 * The org's own refusal when a modification asks for nothing, VERBATIM.
 *
 * `StageLoanModification.build` throws it before it reads a single facility:
 * "At least one requested change is required: amount, maturity date, rate or
 * term." A plan that changes nothing would clone every selected facility and
 * apply an empty diff, so the ticket states the rule where the banker is
 * standing rather than letting a round trip refuse the whole batch.
 */
export const MODIFICATION_NEEDS_A_CHANGE =
  "At least one requested change is required: amount, maturity date, rate or term.";

/** The wire semantic of every requested change, said where the banker enters
 *  one. `requestedAmount`, `requestedMaturityDate`, `requestedRate` and
 *  `requestedTermMonths` are single scalars applied to EVERY facility in
 *  `facilityIds` — the org's own warning on an N>1 plan says the same thing. */
export const EACH_SELECTED = "Applies to EACH selected facility. Stage them separately if they need different terms.";

/** Whether the ticket carries a change the tool would accept. Mirrors the Apex
 *  null-check exactly: any ONE of the four is enough, and a zero amount is
 *  refused separately by the tool's own `requestedAmount > 0` rule. */
function hasRequestedChange(values: Record<string, unknown>): boolean {
  return [values.newCommitment, values.requestedMaturityDate, values.requestedRate, values.requestedTermMonths].some(isSet);
}

const isSet = (v: unknown) => v !== null && v !== undefined && v !== "";

/**
 * The consequence of prefilling the amount from what the facility carries
 * today (founder, 2026-08-25).
 *
 * The org's at-least-one-change rule counts a PRESENT amount, not a DIFFERENT
 * one, so a ticket left on its prefill would stage a plan that clones every
 * selected facility and applies a diff of nothing. The ticket refuses that
 * where it can prove it: only when the amount is the sole change asked for, and
 * only when every selected member's current commitment is known and equal to
 * it. An unknown commitment is silence, never an assumption of movement.
 */
export const MODIFICATION_NO_MOVEMENT =
  "The amount is what every selected facility already carries, so this plan would ask for no change. Enter a different amount, or a new maturity, rate or term.";

/** Same rule again, for the valuation batch. */
export const NO_COLLATERAL_SELECTED =
  "Choose at least one collateral to revalue. An empty selection is not the whole package, and it is not a plan.";

/** Same rule as the facility selection, for the covenant batch: an empty
 *  selection is not "every covenant of the package" and it is not a plan. */
export const NO_COVENANT_SELECTED =
  "Choose at least one covenant. A review with no verdict on any covenant would stage a plan that writes nothing.";

/** A covenant the banker selected but never answered. Filing it under a default
 *  would record an assessment nobody made. */
export const COVENANT_WITHOUT_ASSESSMENT =
  "Every covenant you selected needs an assessment before this can be staged. An assessment is a verdict, and it is never defaulted.";

/** `valuationDate` is refused by the tool rather than defaulted, and the panel
 *  says why rather than filling a blank in silently. */
const VALUATION_DATE_REQUIRED =
  "A valuation needs a date. Salesforce uses it to decide which valuation record is the latest, so a null-dated row cannot be ordered against the ones already on file.";

/**
 * What is wrong with a PACKAGE-SCOPED BULK batch, before any payload is built.
 *
 * Every sentence returned here is one the tool would send back anyway. It is
 * checked client-side so a banker learns the rule from the ticket they are
 * filling in rather than from a round trip that refused the whole batch, and
 * so nothing knowingly wrong leaves the page.
 *
 * Returns null when the batch is fine, or when the action is not a batch.
 */
export function batchStagingGap(
  actionId: string,
  values: Record<string, unknown>,
  schema: PanelSchema | null,
): string | null {
  const picked = (key: string) => [...new Set(Array.isArray(values[key]) ? (values[key] as string[]) : [])];
  const fieldFor = (key: string) => schema?.fields.find((f) => f.key === key);

  if (actionId === "covenant-review") {
    const covenants = picked("covenants");
    if (!covenants.length) return NO_COVENANT_SELECTED;
    if (covenants.length > COVENANT_BATCH_CAP) return COVENANT_CAP_REASON;
    const field = fieldFor("covenants");
    if (field && unansweredItems(field, values).length) return COVENANT_WITHOUT_ASSESSMENT;
    return null;
  }

  // The EMPTY selection and the two-package selection are checked by the panel's
  // own facility gate, which runs first and owns those two sentences. What is
  // left is the rule the org states and this ticket never used to: a plan has
  // to ask for something.
  if (actionId === "loan-modification") {
    if (!hasRequestedChange(values)) return MODIFICATION_NEEDS_A_CHANGE;
    return noMovementGap(values, fieldFor("facility"), picked("facility"));
  }

  if (actionId === "collateral-valuation") {
    const records = picked("records");
    // A relationship with no valuable collateral is a GAP, already named on the
    // field itself. Deselecting everything is a different thing and says so.
    if (!records.length) return (fieldFor("records")?.options?.length ?? 0) > 0 ? NO_COLLATERAL_SELECTED : null;
    if (records.length > VALUATION_BATCH_CAP) return VALUATION_CAP_REASON;
    const date = values.valuationDate;
    if (typeof date !== "string" || !date.trim()) return VALUATION_DATE_REQUIRED;
    return null;
  }

  return null;
}

/** The amount every selected member carries today, when the schema staged it
 *  for all of them. Null the moment one is unknown: a partial answer here would
 *  decide whether a plan may be staged. */
function currentCommitments(field: PanelField | undefined, picked: string[]): number[] | null {
  if (!field || !picked.length) return null;
  const out: number[] = [];
  for (const id of picked) {
    const i = (field.options ?? []).indexOf(id);
    const amount = i >= 0 ? field.optionAmounts?.[i] : undefined;
    if (typeof amount !== "number") return null;
    out.push(amount);
  }
  return out;
}

function noMovementGap(values: Record<string, unknown>, field: PanelField | undefined, picked: string[]): string | null {
  const amount = typeof values.newCommitment === "number" ? values.newCommitment : Number(values.newCommitment);
  if (!Number.isFinite(amount)) return null;
  // Any OTHER requested change makes the plan a change whatever the amount does.
  if ([values.requestedMaturityDate, values.requestedRate, values.requestedTermMonths].some(isSet)) return null;
  const current = currentCommitments(field, picked);
  if (!current) return null;
  return current.every((c) => c === amount) ? MODIFICATION_NO_MOVEMENT : null;
}

/** Credit Review and Risk Rating Review are DIFFERENT INSTRUMENTS on different
 *  objects. The banker must know which one they are raising. */
export const REVIEW_FORK = {
  "annual-review": {
    instrument: "Credit Review",
    explains:
      "The periodic credit review on the deal: Annual, AdHoc or Problem Loan. Staged at In Progress with the drafted narratives; the bank's own Submit for Approval process mints Complete, and this tool never does.",
  },
  "risk-rating-review": {
    instrument: "Risk Rating Review",
    explains:
      "The account-level rating refresh. It records the scoring inputs and the org computes the grade. It carries no facility scope: the rating is the relationship's, not a loan's.",
  },
} as const;

export const OVERRIDE_NOT_YET_FILEABLE =
  "Filing an override needs one live-probe confirmation of the org's field name, coming in the next wave. Clear the override to stage this review, or keep it and wait.";

export function overrideIsSet(values: Record<string, unknown>): boolean {
  const v = values.overrideValue;
  return typeof v === "number" ? v > 0 : typeof v === "string" && v.trim() !== "" && Number(v) > 0;
}

/* --------------------------------------------------------- covenant review */

/** The org's own sentence when the anchor is missing. Rendered rather than
 *  paraphrased: it explains WHY the package is the anchor, which is the part a
 *  banker needs. */
export const PACKAGE_ANCHOR_REQUIRED =
  "This relationship stages no credit package, so there is no deal for this action to run on. Neither the relationship record nor any of its active facilities names one.";

/** The same fact for whoever has to fix it, behind the ticket's info toggle.
 *  A banker cannot act on a wire field name; an engineer cannot act without it. */
export const PACKAGE_ANCHOR_TECHNICAL =
  "productPackageId is required on the staging tool and resolves from neither borrower.snapshot.productPackageId nor borrower.exposure.facilities[].productPackageId.";

/** The tool's cap, and its reason, in the tool's own words. */
const COVENANT_BATCH_CAP = 20;
export const COVENANT_CAP_REASON =
  `A covenant review carries at most ${COVENANT_BATCH_CAP} covenants per plan. Each status write enqueues a change-data queueable, and a complete status may make Salesforce insert the next compliance row, which enqueues a second one, against a platform ceiling of 50 queued jobs per transaction. Stage the rest as a second plan.`;

const VALUATION_BATCH_CAP = 20;
export const VALUATION_CAP_REASON =
  `A valuation batch carries at most ${VALUATION_BATCH_CAP} collaterals per plan. Every valuation insert wakes a change-data trigger that enqueues one queueable per record, against a platform ceiling of 50 queued jobs per synchronous transaction, and exceeding it rolls the whole insert back rather than filing what it could. Stage the rest as a second plan.`;

/** The org's own account of what `allowNonPending` does, and does not do. */
export const ALLOW_NON_PENDING_WARNING =
  "An assessment recorded on a row that is not Pending is stored, and the covenant schedule does NOT advance: Salesforce pushes the next evaluation date only on a Pending to complete transition.";

export interface PackageRecord {
  id: string;
  /** The HEADLINE. What the banker reads at the top of the ticket. */
  label: string;
  /** The one compact metadata line under it: members, committed, drawn. */
  detail: string;
}

/**
 * The PRODUCT PACKAGES this relationship stages, primary first.
 *
 * The relationship's own package (the snapshot's) leads, because that is the
 * default a banker means by "this deal". The rest come off the active
 * facilities.
 *
 * NAMING. No package NAME is staged anywhere in the read. The previous
 * derivation named the deal by concatenating its members, which on Hartwell's
 * six-facility package produced a headline three loan names long, each of them
 * beginning with the borrower's own name — the density the founder read as
 * "dense and weird" on 2026-08-25. A package IS the relationship's credit
 * container, so it is named as one, and the raw record id moves off the visible
 * line and behind the ticket's info toggle. Where the relationship stages more
 * than one, the products on each package distinguish them; that too is derived
 * from staged rows, never invented.
 */
export function packageRecords(bundle: BorrowerBundle | null): PackageRecord[] {
  const facilities = (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  const ids: string[] = [];
  const primary = bundle?.snapshot?.productPackageId;
  if (primary) ids.push(primary);
  for (const f of facilities) {
    if (f.productPackageId && !ids.includes(f.productPackageId)) ids.push(f.productPackageId);
  }
  const relationship = (bundle?.snapshot?.name ?? "").trim();
  const several = ids.length > 1;

  return ids.map((id) => {
    const on = facilities.filter((f) => f.productPackageId === id);
    const committed = on.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
    // DRAWN is summed only when EVERY member stages it. A partial sum presented
    // beside a complete committed figure would read as a utilisation nobody can
    // reproduce, so the line is dropped instead.
    const drawn = on.every((f) => typeof f.outstanding === "number")
      ? on.reduce((sum, f) => sum + (f.outstanding as number), 0)
      : null;
    return {
      id,
      label: packageLabel(relationship, on, several),
      detail: [
        on.length ? `${on.length} ${on.length === 1 ? "facility" : "facilities"}` : "no facility names it",
        committed > 0 ? `${fmtMoney(committed)} committed` : null,
        drawn !== null && on.length ? `${fmtMoney(drawn)} drawn` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

/** One deal's headline. See `packageRecords` for why it is derived at all. */
function packageLabel(relationship: string, on: Facility[], several: boolean): string {
  const base = relationship ? `${relationship} credit package` : "Credit package";
  if (!several) return base;

  // Two packages on one relationship need telling apart, and the products
  // booked on each is the fact that does it. Failing that, the member names,
  // capped: a six-member package rendered as six names is the list again.
  const products = [...new Set(on.map((f) => (f.productType ?? "").trim()).filter(Boolean))];
  if (products.length) {
    const shown = products.slice(0, 2).join(" and ");
    return `${base} · ${shown}${products.length > 2 ? ` and ${products.length - 2} more` : ""}`;
  }
  const names = on.map((f) => shortFacilityLabel(f, relationship));
  if (!names.length) return base;
  return `${base} · ${names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
}

/** The deal anchor, shared by both package-scoped bulk actions. */
/** The bundle as it looks from ONE deal: the facilities of that package, and
 *  nothing else. A relationship whose facilities name no package at all is
 *  returned untouched, because filtering on a field the read does not carry
 *  would empty the list on a data gap. */
function onPackage(bundle: BorrowerBundle | null, packageId: string | null): BorrowerBundle | null {
  const facilities = bundle?.exposure?.facilities ?? [];
  if (!bundle || !packageId || !facilities.some((f) => f.productPackageId)) return bundle;
  return { ...bundle, exposure: { ...bundle.exposure, facilities: facilities.filter((f) => f.productPackageId === packageId) } };
}

/** The mirror image: everything the read places on a DIFFERENT package. */
function offPackageOnly(bundle: BorrowerBundle | null, packageId: string | null): BorrowerBundle | null {
  const facilities = bundle?.exposure?.facilities ?? [];
  if (!bundle || !packageId || !facilities.some((f) => f.productPackageId)) return null;
  return {
    ...bundle,
    exposure: { ...bundle.exposure, facilities: facilities.filter((f) => f.productPackageId && f.productPackageId !== packageId) },
  };
}

/** The deal in play: the banker's pick when it is one of the relationship's,
 *  else the relationship's own package. Never a package this read does not
 *  stage — an id the exposure cannot place is not a deal the ticket can list. */
function activePackageId(ctx: SchemaContext): string | null {
  const packages = packageRecords(ctx.bundle);
  const picked = packages.find((p) => p.id === ctx.packageId);
  return picked?.id ?? packages[0]?.id ?? null;
}

function packageField(ctx: SchemaContext, help: string): PanelField {
  const packages = packageRecords(ctx.bundle);
  const active = activePackageId(ctx);
  return field({
    key: "package",
    label: "Deal",
    // A record chooser, always, even with one option: the value IS the id the
    // wire carries, so the payload never has to reconstruct it from a label.
    type: "picklist",
    value: active,
    prefill: active ? { source: "NCINO_RECORD", citation: active } : { source: "BANKER" },
    editable: packages.length > 1,
    editableReason: packages.length > 1 ? undefined : "the relationship stages one product package",
    required: true,
    optionsAreRecords: true,
    options: packages.map((p) => p.id),
    optionLabels: packages.map((p) => p.label),
    optionDetails: packages.map((p) => p.detail),
    target: { staging: true },
    help,
    gap: packages.length
      ? undefined
      : { reason: PACKAGE_ANCHOR_REQUIRED, blocksStaging: true, technical: PACKAGE_ANCHOR_TECHNICAL },
  });
}

/**
 * The covenants of the chosen package, and the ones that are not.
 *
 * The org resolves the real scope as the UNION of the package's loan-level and
 * relationship-level junctions. The cockpit can only approximate that from
 * `attachedLoans`, so it is deliberately GENEROUS: a covenant is offered unless
 * the read PROVES it hangs off facilities of another package. Anything the
 * cockpit gets wrong, the tool refuses by name with its own sentence, which is
 * a better answer than a covenant silently missing from the list.
 */
function packageCovenants(
  bundle: BorrowerBundle | null,
  packageId: string | null,
): { offered: Covenant[]; blocked: Array<{ value: string; reason: string }> } {
  const covenants = bundle?.covenants?.covenants ?? [];
  const facilities = bundle?.exposure?.facilities ?? [];
  const inPackage = new Set(facilities.filter((f) => f.productPackageId === packageId).map((f) => f.loanId));
  const known = new Set(facilities.map((f) => f.loanId));

  const offered: Covenant[] = [];
  const blocked: Array<{ value: string; reason: string }> = [];

  for (const c of covenants) {
    const label = covenantLabel(c);
    if (!c.covenantId) {
      blocked.push({ value: label, reason: "no covenant record id staged" });
      continue;
    }
    const attached = Array.isArray(c.attachedLoans) ? c.attachedLoans : null;
    // ABSENT is not EMPTY. An absent list means the read cannot say how this
    // covenant is scoped, so it is offered and the tool decides.
    if (attached === null || attached.length === 0) {
      offered.push(c);
      continue;
    }
    const reaches = attached.some((a) => !a.loanId || !known.has(a.loanId) || inPackage.has(a.loanId));
    if (reaches) offered.push(c);
    else blocked.push({ value: label, reason: "attached to facilities on another package" });
  }

  return { offered, blocked };
}

/** What the banker reads for a covenant. The read stages no covenant NAME, so
 *  the type is the name, with its threshold where there is one. */
function covenantLabel(c: Covenant): string {
  const type = c.covenantType ?? "Covenant";
  return c.thresholdValue != null ? `${type} against ${fmtCovVal(c.thresholdValue, c.covenantType)}` : type;
}

/** The context line under a covenant: where nCino has it standing right now. */
function covenantDetail(c: Covenant): string {
  const parts: string[] = [];
  // The COMPLIANCE ROW's status, which is what decides whether an assessment
  // advances the schedule. Distinct from the covenant-level status.
  if (c.latestComplianceStatus) {
    parts.push(
      c.latestComplianceStatus === "Pending"
        ? "compliance row Pending"
        : `compliance row ${c.latestComplianceStatus}, not Pending`,
    );
  }
  if (c.reasonForException) parts.push(`reason ${c.reasonForException}`);
  if (c.actualValue != null) parts.push(`last reported ${fmtCovVal(c.actualValue, c.covenantType)}`);
  const attached = Array.isArray(c.attachedLoans) ? c.attachedLoans : null;
  if (attached !== null) {
    parts.push(attached.length === 0 ? "relationship-level" : `on ${attached.map((a) => a.loanName ?? a.loanId ?? "a facility").join(", ")}`);
  }
  if (c.nextEvaluationDate) parts.push(`next test ${c.nextEvaluationDate}`);
  return parts.join(" · ");
}

/**
 * COVENANT REVIEW — package-anchored bulk (WS0.5, 2026-08-22).
 *
 * AGGREGATION FIRST. The thing under review is the covenant package of a
 * product package; a single covenant is a member selection inside it, not a
 * separate action. nCino says the same: "the product package shows an
 * aggregated list of the covenants included in the loans within the package.
 * The user still needs to manage the covenants at the individual loan or
 * Relationship level" (kb:kAHHu000000XZTaOAO). So this is one plan, one hash,
 * one token, and N assessments — never a package-level verdict.
 *
 * The assessment itself is PER COVENANT, which is why the verdict, the figure,
 * the reason and the note are per-item entries rather than shared fields. Only
 * the narrative is shared: it describes the review exercise, not one covenant.
 */
function covenantReviewSchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "LLC_BI__Covenant_Compliance2__c";
  const packageId = activePackageId(ctx);
  const { offered, blocked } = packageCovenants(ctx.bundle, packageId);
  const anyNonPending = offered.some((c) => c.latestComplianceStatus && c.latestComplianceStatus !== "Pending");

  return {
    writeObject: OBJ,
    writeObjectLabel: "covenant assessment",
    intro:
      "Reviews the covenants this deal aggregates. Each assessment updates one existing compliance record with the status, the observed value and the notes. No compliance record is created here, and no credit decision is made or implied.",
    fields: [
      packageField(
        ctx,
        "Covenants are resolved as the union of this package's loan-level and relationship-level junctions.",
      ),
      field({
        key: "covenants",
        label: "Covenants to assess",
        type: "multiselect",
        // Nothing is preselected, not even a single covenant: an assessment is
        // a verdict, and a verdict must be chosen rather than defaulted into.
        value: [],
        prefill: { source: "NCINO_RECORD", citation: "Customer360Covenants — the covenants this package aggregates" },
        editable: true,
        required: true,
        optionsAreRecords: true,
        options: offered.map((c) => c.covenantId!),
        optionLabels: offered.map(covenantLabel),
        optionDetails: offered.map(covenantDetail),
        disabledOptions: blocked,
        perItemInputs: [
          {
            valueKey: "covenantStatuses",
            label: "Assessment",
            type: "picklist",
            // The TOOL's complete-status set, not the org's picklist: see
            // COVENANT_ASSESSMENT_STATUSES.
            options: COVENANT_ASSESSMENT_STATUSES,
            required: true,
          },
          {
            valueKey: "covenantObservedValues",
            label: "Observed value",
            type: "currency",
            placeholder: "the tested figure",
          },
          {
            valueKey: "covenantReasons",
            label: "Reason",
            type: "picklist",
            optionsFrom: { object: OBJ, field: "LLC_BI__Reason_for_Exception__c" },
            options: picklist(ctx, OBJ, "LLC_BI__Reason_for_Exception__c"),
            placeholder: "Breached or Overdue",
          },
          {
            valueKey: "covenantComments",
            label: "Note",
            type: "text",
            placeholder: "what was tested",
          },
        ],
        target: { object: OBJ, field: "LLC_BI__Status__c" },
        // The MISSING-PACKAGE case is not restated here: the package field
        // carries that blocking gap already, and the footer joins every
        // blocker's reason, so a banker would read one fact twice.
        gap: offered.length
          ? undefined
          : {
              reason: "No covenant of this deal carries a record id in this view, so there is nothing to assess.",
              blocksStaging: true,
            },
      }),
      field({
        key: "allowNonPending",
        label: "Record on rows that are not Pending",
        type: "boolean",
        // OFF unless the banker turns it on. The default refusal is the org's,
        // and it exists to stop a write that succeeds and changes nothing.
        value: false,
        prefill: { source: "BANKER" },
        editable: true,
        required: false,
        target: { staging: true },
        help: anyNonPending
          ? `A covenant in this package sits on a row that is not Pending. ${ALLOW_NON_PENDING_WARNING} Leave this off and such a covenant is refused by name, with its reason.`
          : `${ALLOW_NON_PENDING_WARNING} Leave this off and a non-Pending row is refused by name, with its reason.`,
      }),
      field({
        key: "assessmentNarrative",
        label: "Assessment notes",
        type: "longtext",
        value: null,
        prefill: { source: "AGENT_NARRATIVE" },
        editable: true,
        required: false,
        // The review exercise's narrative, carried onto every assessment in the
        // batch. Per-covenant colour goes in the per-item note.
        target: { object: OBJ, field: "Agentic_AI_Response__c" },
        help: "Carried onto every assessment in this batch. What is specific to one covenant belongs in its own note.",
      }),
    ],
  };
}

/**
 * The BOOKED members of one deal, and everything that is not one, with reasons.
 *
 * Same generosity rule as `onPackage`: a read where NO facility carries a
 * product package cannot be filtered by one, so every booked facility is
 * offered and the tool decides. Where the read DOES place facilities on
 * packages, a booked facility of another deal is listed with that reason rather
 * than hidden — a banker hunting for a facility learns where it actually sits.
 */
function packageFacilities(
  bundle: BorrowerBundle | null,
  packageId: string | null,
): { offered: Facility[]; blocked: Array<{ value: string; reason: string }> } {
  const booked = bookedFacilities(bundle);
  const scoped = packageId !== null && (bundle?.exposure?.facilities ?? []).some((f) => f.productPackageId);
  const offered = scoped ? booked.filter((f) => f.productPackageId === packageId) : booked;
  const relationship = bundle?.snapshot?.name ?? null;

  const blocked: Array<{ value: string; reason: string }> = [];
  for (const b of unbookedFacilities(bundle)) {
    // Off-package AND unbooked: the deal is the sharper fact, and it is the one
    // that decides whether this ticket could ever carry it.
    blocked.push({
      value: shortFacilityLabel(b.facility, relationship),
      reason: scoped && b.facility.productPackageId && b.facility.productPackageId !== packageId ? "on another deal" : b.reason,
    });
  }
  for (const f of booked) {
    if (!offered.includes(f)) blocked.push({ value: shortFacilityLabel(f, relationship), reason: "booked on another deal" });
  }
  return { offered, blocked };
}

/**
 * The facility the ENTRY POINT implied, out of the ones this deal offers.
 *
 * A ticket opened from a client request about the revolver should open with the
 * revolver ticked. Three derivations, all from staged rows and in this order:
 * the ask's own facility name, the ask's CURRENT commitment matched against a
 * member's committed figure, and failing both the largest commitment in the
 * deal. Never a lock: the banker can untick it and tick three others.
 */
export function impliedFacility(bundle: BorrowerBundle | null, offered: Facility[]): Facility | null {
  if (!offered.length) return null;
  const ask = (bundle?.requests ?? [])[0]?.ask;

  const wanted = typeof ask?.facilityName === "string" ? ask.facilityName.trim().toLowerCase() : "";
  if (wanted) {
    const named = offered.filter((f) => {
      const name = (f.name ?? "").trim().toLowerCase();
      return name !== "" && (name === wanted || name.includes(wanted) || wanted.includes(name));
    });
    if (named.length === 1) return named[0];
  }

  // The ask's "from" figure IS a member's commitment when the client wrote
  // about one facility. Only ever used when exactly one member carries it:
  // two facilities at the same commitment is not an implication.
  if (typeof ask?.from === "number") {
    const matched = offered.filter((f) => f.committed === ask.from);
    if (matched.length === 1) return matched[0];
  }

  let best = offered[0];
  for (const f of offered) if ((f.committed ?? 0) > (best.committed ?? 0)) best = f;
  return best;
}

/** Modification and renewal share their anchor: both act on an existing booked
 *  facility of one deal, both are staged and neither books anything.
 *
 *  EVERY CONTROL BELOW MAPS ONE-FOR-ONE TO AN OBSERVED WIRE FIELD, with one
 *  deliberate exception: the reason. It has no wire field of its own and folds
 *  into `rationale`, so it targets staging rather than claiming an org field. A
 *  control the wire cannot carry is a promise the panel cannot keep. */
function facilityChangeSchema(ctx: SchemaContext, kind: "modification" | "renewal"): PanelSchema {
  const OBJ = "LLC_BI__Loan__c";
  const asked = requestedCommitment(ctx.bundle);

  // PACKAGE FIRST. The deal is the driver's seat and the facilities are member
  // selections inside it, which is both nCino's framing and the wire's:
  // `productPackageId` is required on every call and `facilityIds` names the
  // members. Only BOOKED members can carry a credit action; the rest are listed
  // with their reason rather than hidden.
  const packageId = activePackageId(ctx);
  const { offered, blocked } = packageFacilities(ctx.bundle, packageId);
  const chosen = impliedFacility(ctx.bundle, offered);
  const anyBooked = bookedFacilities(ctx.bundle).length > 0;

  const anchor = field({
    key: "facility",
    label: "Facilities in this credit action",
    type: "multiselect",
    // The entry point's own implication, ticked and never locked.
    value: chosen?.loanId ? [chosen.loanId] : [],
    prefill: chosen ? { source: "NCINO_RECORD", citation: chosen.loanId } : { source: "BANKER" },
    editable: true,
    required: true,
    optionsAreRecords: true,
    // The VALUE is the record id; the label is what the banker reads. Shortened
    // against the relationship name, because every nCino loan name repeats it
    // and a member list is read by what differs between its rows.
    options: offered.map((f) => f.loanId ?? ""),
    optionLabels: offered.map((f) => shortFacilityLabel(f, ctx.bundle?.snapshot?.name)),
    // The stage moves to its own chip: it is a status, not another clause in a
    // sentence of figures.
    optionChips: offered.map((f) => (f.stage ?? "").trim() || "Booked"),
    optionAmounts: offered.map((f) => (typeof f.committed === "number" ? f.committed : null)),
    optionDetails: offered.map((f) =>
      [
        f.committed != null ? `${fmtMoney(f.committed)} committed` : null,
        f.outstanding != null ? `${fmtMoney(f.outstanding)} drawn` : null,
        f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    disabledOptions: blocked,
    target: { object: OBJ, field: "Id" },
    gap: chosen
      ? undefined
      : {
          // Three different facts, three different sentences. "Cannot tell" and
          // "none are booked" come from the availability rule; "none on THIS
          // deal" is the package-first case and is neither of them.
          reason: anyBooked
            ? `No facility of this deal is booked, so this deal has nothing a ${kind} can run against. Facilities booked on another deal are listed below with that reason.`
            : (bookedFacilityGap(ctx.bundle, kind === "renewal" ? "renewals" : "modifications") ?? ""),
          blocksStaging: true,
        },
  });

  /** The facility a "currently…" line can honestly describe: the one the ticket
   *  opened on. With several selected the current figures differ per member, so
   *  the help says what the change DOES instead of what one facility carries. */
  const one = offered.length === 1 ? offered[0] : chosen;

  /** `requestedRate` on both observed envelopes. */
  const rate = field({
    key: "requestedRate",
    label: "Rate",
    type: "currency",
    value: null,
    prefill: { source: "BANKER" },
    editable: true,
    required: false,
    target: { staging: true },
    help:
      kind === "modification"
        ? `${EACH_SELECTED}${one?.interestRate != null ? ` ${facilityLabel(one)} carries ${one.interestRate} percent today.` : ""}`
        : one?.interestRate != null
          ? `Currently ${one.interestRate} percent.`
          : undefined,
  });

  const reason = field({
    key: kind === "renewal" ? "renewalReason" : "modificationReason",
    label: "Reason",
    type: "longtext",
    value: null,
    prefill: { source: "AGENT_NARRATIVE" },
    editable: true,
    required: false,
    // No wire field of its own: this text becomes the plan's rationale, which
    // the org does record.
    target: { staging: true },
    help: "Carried on the plan as the stated reason for this change.",
  });

  if (kind === "renewal") {
    return {
      writeObject: OBJ,
      writeObjectLabel: "renewal",
      intro: "Builds the renewal plan for this facility. The plan is staged and preserved; filing it awaits the org's own approval path.",
      fields: [
        anchor,
        field({
          key: "newMaturityDate",
          label: "New maturity",
          type: "date",
          value: null,
          prefill: { source: "BANKER" },
          editable: true,
          required: true,
          target: { object: OBJ, field: "LLC_BI__Maturity_Date__c" },
          help: one?.maturityDate ? `Currently matures ${one.maturityDate}.` : undefined,
        }),
        rate,
        reason,
      ],
    };
  }

  return {
    writeObject: OBJ,
    writeObjectLabel: "modification",
    intro:
      "Builds one modification plan on this deal, covering the facilities you select within it. Every requested change below applies to each selected facility, and the whole batch travels under a single confirmation and a single decision token. The plan is staged and preserved; booking the clones it creates is Salesforce's own approval path.",
    fields: [
      packageField(
        ctx,
        "The deal anchor. Every facility this modification covers must be a booked member of it, and the org refuses a member of any other package by name.",
      ),
      anchor,
      // NONE of the four is required on its own. The org's rule is that at least
      // ONE of them is present, which is a rule about the ticket rather than
      // about any one field — `batchStagingGap` states it in the org's words.
      field({
        key: "newCommitment",
        label: "New commitment",
        type: "currency",
        // PREFILLED FROM WHAT IS ON THE TABLE (founder, 2026-08-25): the
        // client's own ask when one is staged, otherwise the CURRENT commitment
        // of the member the ticket opened on, so the field opens as a from -> to
        // reading rather than as a blank the banker has to look up.
        //
        // The hazard the previous wave guarded against is real and is handled
        // rather than avoided: a prefill equal to the current figure satisfies
        // the org's at-least-one-change rule while asking for nothing. That is
        // now caught by name — MODIFICATION_NO_MOVEMENT — instead of by leaving
        // the field empty.
        value: asked ?? (typeof chosen?.committed === "number" ? chosen.committed : null),
        prefill: asked
          ? { source: "CLIENT_REQUEST", citation: (ctx.bundle?.requests ?? [])[0]?.reference?.id }
          : typeof chosen?.committed === "number"
            ? { source: "NCINO_RECORD", citation: chosen.loanId }
            : { source: "BANKER" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Amount__c" },
        help: EACH_SELECTED,
      }),
      // OBSERVED as `requestedMaturityDate` on StageLoanModification.Request and
      // applied by the plan's `apply_changes_*` step. The ticket carried no
      // control for it, so a banker could not ask for the one change a
      // modification most often is.
      field({
        key: "requestedMaturityDate",
        label: "New maturity",
        type: "date",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: false,
        target: { object: OBJ, field: "LLC_BI__Maturity_Date__c" },
        help: EACH_SELECTED,
      }),
      field({
        key: "requestedTermMonths",
        label: "Term (months)",
        type: "text",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: false,
        target: { staging: true },
        help: EACH_SELECTED,
      }),
      rate,
      reason,
    ],
  };
}


/* ------------------------------------------------- discard-version (0.9.23)

   THE BRIEFING FOR AN UNDO. Nothing here is a value the banker supplies except
   the reason: the version is resolved from the roster, the booked package comes
   with it, and what would actually be deleted is DISCOVERED BY THE ORG at stage
   time. So the panel states the two records in play, says what stays, and gets
   out of the way; the inventory belongs on the confirm gate, where it can be
   the org's own list rather than ours.                                       */

function discardVersionSchema(ctx: SchemaContext): PanelSchema {
  const OBJ = "LLC_BI__Product_Package__c";
  const target = ctx.discard ?? null;
  const version = target?.version ?? null;
  const source = target?.source ?? null;

  return {
    writeObject: OBJ,
    writeObjectLabel: "version package",
    intro: `${DISCARD_LINE} ${whatStays(source?.name ?? null)}`,
    fields: [
      field({
        key: "version",
        label: "The version being discarded",
        type: "readonly",
        // The ROSTER'S OWN LINE for a version ("Modification in flight ·
        // editable until approval · ..."), which is the line every package
        // picker in this cockpit already shows for it.
        value: version ? `${version.name} · ${version.reason ?? version.line}` : null,
        prefill: { source: "NCINO_RECORD", citation: version?.id },
        editable: false,
        editableReason: "resolved from the relationship's package roster",
        required: true,
        target: { object: OBJ, field: "Id" },
        /* A PANEL OPENED WITH NO VERSION IS A BLOCKED PANEL, not an empty form.
           The registry's availability has already refused the row; this is the
           same rule where a stale entry point got past it. */
        gap: version
          ? undefined
          : {
              reason: NO_VERSION_REASON,
              blocksStaging: true,
              technical: "book/packages.ts packageRoster() found no in-flight version on this bundle",
            },
      }),
      field({
        key: "source",
        label: "The booked package that stays",
        type: "readonly",
        value: source ? `${source.name} · ${source.line}` : null,
        prefill: { source: "NCINO_RECORD", citation: source?.id },
        editable: false,
        editableReason: "the discard never touches it",
        required: false,
        target: { object: OBJ, field: "Id" },
        help: source
          ? undefined
          : "The read does not link this version to a booked package, so the trail will land on the version's own relationship.",
      }),
      field({
        key: "discardReason",
        label: "Why this version is being discarded",
        type: "longtext",
        value: null,
        prefill: { source: "BANKER" },
        editable: true,
        required: true,
        target: { staging: true },
        help: "Goes on the staging row the org keeps and marks Withdrawn. It is the audit of why the version went.",
      }),
    ],
  };
}

/* ------------------------------------------------------------- registry */

export type SchemaBuilder = (ctx: SchemaContext) => PanelSchema;

/** Only the three shipping actions. An action absent here has no panel. */
export const PANEL_SCHEMAS: Record<string, SchemaBuilder> = {
  "collateral-valuation": collateralValuationSchema,
  "create-service-request": serviceRequestSchema,
  "annual-review": annualReviewSchema,
  "new-facility-request": newFacilitySchema,
  "risk-rating-review": riskRatingSchema,
  "covenant-review": covenantReviewSchema,
  "loan-modification": (ctx) => facilityChangeSchema(ctx, "modification"),
  renewal: (ctx) => facilityChangeSchema(ctx, "renewal"),
  "discard-version": discardVersionSchema,
};

export function buildPanelSchema(actionId: string, ctx: SchemaContext): PanelSchema | null {
  const builder = PANEL_SCHEMAS[actionId];
  return builder ? builder(ctx) : null;
}
