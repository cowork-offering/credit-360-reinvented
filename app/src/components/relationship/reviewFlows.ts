import type { SettleDeps } from "../workroom/settleExecution";
import type { ActionHistoryRow, BorrowerBundle, C360Data, Collateral, Covenant } from "../../data/contract";
import { fmtMoney } from "../../data/format";
import { isActiveFacility } from "../../data/worklist";
import { packageRoster, type PackageAsk, type PackageEntry } from "../../book/packages";
import { classifyCovenant } from "../../domain/covenantStatus";
import { ACTIONS_BY_ID, stageRationale } from "../../actions/registry";
import { COVENANT_ASSESSMENT_STATUSES, observedOptions } from "../../actions/observedPicklists";
import { assertNoRecordIds, type StagedOutput } from "../../actions/stagedPlan";
import { validatePlan } from "../../actions/transitionAllowlist";
import { newRequestId } from "../../channel/adapter";
import { mcpAvailable } from "../../channel/mcp";
import type { OrgCatalog } from "../../channel/catalog";
import {
  executeAction,
  parseLegalValues,
  resolveApproverUserId,
  stageAction,
  toolErrorCopy,
  type ExecutePayload,
  type ExecuteResult,
  type StagePayloads,
  type ToolError,
  type ToolOutcome,
  type WriteActionId,
} from "../../channel/writeTools";
import type { IconKind } from "../workroom/TypeIcon";
import { fieldExamBodyOption } from "./fieldExam";
import { NO_COMPLIANCE_ROW, relBookFor, type BookCovenant } from "./relBook";
import {
  answered,
  asOptions,
  num,
  perRecord,
  pickedList,
  text,
  type Answers,
  type RelStep,
} from "./relStep";
import {
  buildIntakePayload,
  intakeConfirmSentence,
  intakeDossierRows,
  intakeStep,
} from "./intakeFlows";
import { REL_ROUTE_WORD, isVersionRoute, type RelRoute } from "./relRoute";
import {
  NOTHING_AMENDABLE,
  amendTarget,
  amendablePackages,
  buildVersionPayload,
  versionDossierRows,
  versionPlanNarrative,
  versionStep,
} from "./versionFlows";

/* =============================================================================
   THE FIVE REVIEWS — ONE STEP MACHINE OVER THE FLOWS THAT ALREADY EXIST.

   THE ROOM RE-CLOTHES, IT DOES NOT REINVENT. Every route below drives the SAME
   `stage_*` / `execute_*` pair the Action Panel drives today, with the SAME
   payload shape, read from `channel/writeTools.ts` and from the panel's own
   `stagePayload()`. Not one wire key is composed here that the panel does not
   already send. The ActionPanel machinery is untouched and still ships.

   WHAT IS NEW is the CHOREOGRAPHY: instead of a form the banker fills, the room
   asks one question at a time, in a professional register, with the org's own
   legal values as chips, and stages only when the flow has everything its tool
   demands.

   A STEP MACHINE, NOT A STEP LIST. Three of the five routes are conditional —
   a covenant assessed Exception has to say whether it was breached or overdue,
   a valuation needs one figure per asset the banker chose — so the next
   question is DERIVED from what has been answered rather than walked down a
   fixed array. `nextStep` returning null is the whole readiness test, and it is
   the same test in the room and in its tests.

   CREATION SEMANTICS (founder, 2026-08-31). Relationship-level creates belong
   here: a covenant authored standalone on the Account, a collateral asset the
   borrower owns plus its ownership junction, unpledged. NEITHER IS BACKED BY A
   DEPLOYED TOOL TODAY, and this module says so by name rather than composing a
   payload the org has never accepted. See `CREATE_GAPS` at the foot of the
   file: the room takes the banker all the way to the proposal and then states
   the org-side gap, because an unbacked write invented at the client is exactly
   the failure this campaign has already paid for twice.
   ============================================================================= */

/* ------------------------------------------------------------- the context */

export interface RelContext {
  accountId: string;
  accountName: string;
  bundle: BorrowerBundle | null;
  /** The relationship's product package. Both bulk tools are anchored on it and
   *  refuse a batch without one. */
  productPackageId: string | null;
  /** EVERY package the relationship stages. Where it stages more than one and
   *  none is chosen, a package-anchored review ASKS which rather than refusing:
   *  "the read stages none" is false for a relationship that stages three, and
   *  the banker has an answer the room never asked for. */
  packages: PackageEntry[];
  /** `meta.generatedAt` — the artifact's own clock. Never `new Date()`. */
  asOf: string | null;
  /** The Salesforce user id `execute_*` will accept, or null. */
  approver: string | null;
  /**
   * THE ORG'S OWN CHIP SETS, where the view has read them.
   *
   * Only the INTAKE route uses it, and only for the two lookup catalogs it
   * files a NAME against: the covenant types and the collateral types. The five
   * reviews are unchanged and still stand on the observed describes, because a
   * review picks from a list the tool validates rather than naming a record.
   *
   * NULL IS A STATE. No connector, or a tool the client's schema cache has not
   * caught up with, leaves the intake chips empty and the banker naming the type
   * themselves, which is the channel-none doctrine applied to a catalog.
   */
  catalog?: OrgCatalog | null;
  /** The durable action trail the host handed the room, for the briefing and the roster. */
  history?: readonly ActionHistoryRow[];
}

export function relContextFor(args: {
  data: C360Data;
  bundle: BorrowerBundle | null;
  accountId: string;
  accountName: string;
  catalog?: OrgCatalog | null;
  /** The package the banker chose, where the relationship stages several. */
  productPackageId?: string | null;
  /** The durable action trail, for the in-flight version reading (rule 2). */
  history?: readonly ActionHistoryRow[];
}): RelContext {
  /* THE BANKER'S OWN CHOICE FIRST, then the snapshot's anchor exactly as before.
     The snapshot-only read is NOT widened here: `DeepLink.tsx:95`,
     `ActionPanel.tsx:697` and `schemas.ts:448` carry the same split and it is
     one ticket, not four half-fixes (package-anchor addendum, section 8). What
     this adds is the case that split cannot express: several packages, where
     the room now ASKS instead of refusing. */
  const packages = packageRoster(args.bundle, args.history);
  const chosen = args.productPackageId && packages.some((p) => p.id === args.productPackageId)
    ? args.productPackageId
    : null;
  return {
    accountId: args.accountId,
    accountName: args.accountName,
    bundle: args.bundle,
    packages,
    history: args.history,
    productPackageId: chosen ?? args.bundle?.snapshot?.productPackageId ?? null,
    asOf: args.data.meta?.generatedAt ?? null,
    approver: resolveApproverUserId(args.data.meta),
    catalog: args.catalog ?? null,
  };
}

/* --------------------------------------------------------------- the steps

   THE STEP PRIMITIVES NOW LIVE IN `relStep.ts` and are re-exported here
   unchanged. The INTAKE route describes its questions in the same grammar and
   reads the same answer map, and it cannot import this module back without a
   cycle. Every name below is the one this file has exported since the room
   shipped, so no caller anywhere changes.                                   */

export type { StepKind, StepOption, RelStep, Answers } from "./relStep";
export { SKIPPED } from "./relStep";

/* -------------------------------------------------------------- the briefs */

export interface RelFlowSpec {
  route: RelRoute;
  actionId: WriteActionId;
  /** The room's own word for the route, in the slim bar. */
  word: string;
  icon: IconKind;
  /** THE STRUCTURED BRIEF. What the review covers, then what it produces. Two
   *  sentences, read before the first question, because a governance ritual
   *  states its scope before it asks anything. */
  covers: string;
  produces: string;
  /** The object the plan writes, in banker language. */
  writeObjectLabel: string;
  /** The ink button's word once the plan is staged. */
  approveLabel: string;
  /** The past-tense word the room uses once it has filed. */
  filedWord: string;
  /** The status line rotation under the execute mark. */
  loadSteps: string[];
  /**
   * THE TOOL KEY THE CLIENT FENCE IS ARMED WITH, where the route has one.
   *
   * `TOOL_OBJECT_FENCE` narrows a tool to fewer objects than the plain
   * allowlist permits, and it can only ever subtract. A route that declares no
   * key is validated exactly as it always was, which is why every review flow
   * leaves this undefined: they write objects only they write, so the object
   * table alone already fences them.
   */
  toolId?: string;
}

export const REL_FLOWS: Record<RelRoute, RelFlowSpec> = {
  annual: {
    route: "annual",
    actionId: "annual-review",
    word: "Annual Review",
    icon: "package",
    covers:
      "The annual review covers the whole relationship: exposure, performance against the package, covenant compliance and the standing risk grade.",
    produces:
      "It files a credit review record at In Progress carrying the narratives, then hands control to the bank's own Submit for Approval process. The review's own decision picklists are on no tool wire and stay for Salesforce, and the rating on file is untouched by this: changing it is the risk-rating review.",
    writeObjectLabel: "credit review",
    approveLabel: "File the review",
    filedWord: "Filed",
    loadSteps: ["Composing the review", "Filing the credit review", "Verifying the record"],
  },
  covenant: {
    route: "covenant",
    actionId: "covenant-review",
    word: "Covenant Review",
    icon: "covenant",
    covers:
      "The covenant review covers every test on this relationship: each covenant's latest compliance row, its schedule, whether it is measurable this period, and the facilities and packages it is tied to.",
    produces:
      "It writes one assessment per covenant onto its compliance row. Only a row sitting at Pending advances the covenant schedule.",
    writeObjectLabel: "covenant assessment",
    approveLabel: "File the assessments",
    filedWord: "Filed",
    loadSteps: ["Assessing the covenants", "Writing the compliance rows", "Re-querying the schedule"],
  },
  valuation: {
    route: "valuation",
    actionId: "collateral-valuation",
    word: "Collateral Valuation",
    icon: "collateral",
    covers:
      "The valuation covers every asset this borrower owns: the basis the figure is struck on, where the number came from, and the facilities and packages each asset is pledged to.",
    produces:
      "It files one valuation record per asset. Whether the value rolls up onto the collateral record is Salesforce's own automation and is reported, never claimed.",
    writeObjectLabel: "collateral valuation",
    approveLabel: "File the valuation",
    filedWord: "Filed",
    loadSteps: ["Composing the valuation", "Filing the valuation", "Re-querying the collateral"],
  },
  rating: {
    route: "rating",
    actionId: "risk-rating-review",
    word: "Risk-Rating Review",
    icon: "commit",
    covers:
      "The risk-rating review covers the four factors the grade is built from: cash-flow coverage, revenue growth, management experience and credit score.",
    produces:
      "It files a risk-rating review at In Review carrying the factor actuals, the proposed grade and any override with its written reason. The FINAL grade is Salesforce's own formula over what is filed, Approved and Declined belong to the org's decisioning path, and the facility-level rating stays in the facility room.",
    writeObjectLabel: "risk-rating review",
    approveLabel: "File the rating review",
    filedWord: "Filed",
    loadSteps: ["Scoring the factors", "Filing the rating review", "Verifying the record"],
  },
  /**
   * THE SIXTH, AND THE ONLY ONE THAT AUTHORS.
   *
   * The five above act on records the org already holds. This one puts a
   * covenant or an asset ONTO the relationship, which is the pair of creates
   * `CREATE_GAPS` has named as unfileable since the room shipped. What closes
   * them is the org side: `stage_relationship_intake` authors an
   * `LLC_BI__Covenant2__c` with an `LLC_BI__Account_Covenant__c` junction and no
   * loan junction, and an `LLC_BI__Collateral__c` with its
   * `LLC_BI__Account_Collateral__c` ownership junction and NO pledge.
   */
  intake: {
    route: "intake",
    actionId: "relationship-intake",
    // THE ONE ROUTE WHOSE IDENTITY IS WHAT IT MUST NOT TOUCH. The loan junction
    // and the pledge are both legitimate creates on the object table, because
    // the modification arm authors them, so the object fence alone would let an
    // intake plan reach a facility and say nothing. This mirrors the Apex fence.
    toolId: "relationship-intake",
    word: "Relationship Intake",
    icon: "package",
    covers:
      "The intake covers what goes onto the relationship itself: a covenant the approved credit agreement struck, or an asset the borrower owns that no facility is secured by yet.",
    produces:
      "It authors the records and their account junctions and nothing else. A covenant lands on the borrower with no loan junction, so it is a relationship-level test; an asset lands with its ownership junction and no pledge and no lien, so nothing about coverage moves. The compliance schedule, the advance rate and the lendable value are the org's own arithmetic and are never asked for or claimed.",
    writeObjectLabel: "relationship record",
    approveLabel: "File them",
    filedWord: "Filed",
    loadSteps: ["Composing the intake", "Writing the records", "Verifying the junctions"],
  },
  service: {
    route: "service",
    actionId: "create-service-request",
    word: "Service Request",
    icon: "maturity",
    covers:
      "The service request covers a servicing ask on this relationship: statements, payoff quotes, document requests or account changes.",
    produces:
      "It creates the request at status New, with what the client asked for on the subject and the request in full in the body. The type and the origin are read off this org's own picklists by the tool and are not the room's to set; if the org does not offer the honest pair the case still files and the plan says which pair it used. Nobody is assigned, no turnaround is promised, the tool performs no status transitions and it never closes a case.",
    writeObjectLabel: "service request",
    approveLabel: "Log the request",
    filedWord: "Logged",
    loadSteps: ["Composing the request", "Creating the request", "Verifying the record"],
  },
  /* --------------------------------------------------- SHAPING THE VERSION

     THE SEVENTH AND EIGHTH, AND NEITHER IS A REVIEW. Both write through
     `amend_version`, which is the modification's own authoring arms landing on
     the version's OWN loans with no credit action behind them. What makes them
     this room's rather than the facility room's is what they act on: an
     UNBOOKED package, which holds no booked facility for a credit action to run
     against, which is exactly why the facility room refuses it by name.       */
  versionCovenant: {
    route: "versionCovenant",
    actionId: "amend-version",
    word: "Covenant on the Version",
    icon: "covenant",
    covers:
      "This covers the version in flight: the unbooked package a modification forked, and the facilities on it. It puts one covenant onto one of them.",
    produces:
      "It authors the covenant on the borrower and attaches it to the version facility you name, or attaches one the borrower already holds and writes no covenant field at all. It forks no second version, it takes no credit action and it moves nothing on the booked package behind this one. The compliance schedule is the org's own arithmetic and is never asked for or claimed.",
    writeObjectLabel: "covenant on the version",
    approveLabel: "File it on the version",
    filedWord: "Filed",
    loadSteps: ["Composing the amendment", "Writing the covenant", "Verifying the junction"],
  },
  versionPledge: {
    route: "versionPledge",
    actionId: "amend-version",
    word: "Pledge on the Version",
    icon: "collateral",
    covers:
      "This covers the security behind the version in flight: what the borrower owns, what it is lendable for, and which facility on the unbooked package it secures.",
    produces:
      "It files the pledge onto the version facility you name, and where the asset is new it files the asset and the borrower's ownership of it first. It forks no second version, it takes no credit action and it moves nothing on the booked package behind this one. The advance rate, the lendable value and the coverage roll-up are the org's own arithmetic; what the room states about coverage is derived from the read and says so.",
    writeObjectLabel: "collateral pledge on the version",
    approveLabel: "File the pledge",
    filedWord: "Filed",
    loadSteps: ["Composing the amendment", "Writing the pledge", "Verifying the coverage"],
  },
};

/* ------------------------------------------------------- what the read holds */

/** The covenants this package carries, with the org's own verdict on each.
 *  Only covenants the org gave an id are offerable: the bulk tool is anchored
 *  on `covenantId` and a covenant without one cannot be assessed. */
export function reviewableCovenants(ctx: RelContext): Covenant[] {
  return (ctx.bundle?.covenants?.covenants ?? []).filter((c) => !!c.covenantId);
}

/** The collateral pledged against the ACTIVE facilities, deduplicated by
 *  collateral id. A cross-pledged asset appears on two facilities and is ONE
 *  asset: offering it twice would invite the duplicate the tool refuses. */
export function valuableCollateral(ctx: RelContext): Collateral[] {
  const out = new Map<string, Collateral>();
  for (const f of (ctx.bundle?.exposure?.facilities ?? []).filter(isActiveFacility)) {
    for (const c of f.collateral ?? []) {
      if (c.collateralId && !out.has(c.collateralId)) out.set(c.collateralId, c);
    }
  }
  return [...out.values()];
}

/** The name a collateral row reads under. The friendly description leads where
 *  the org staged one; the autonumber is the fallback, never a guess. */
export function collateralLabel(c: Collateral): string {
  return c.collateralDescription?.trim() || c.collateralName?.trim() || c.collateralId || "collateral";
}

/** The name a covenant reads under. */
export function covenantLabel(c: Covenant): string {
  return (c.covenantType ?? "").trim() || "covenant";
}

/** The batch cap `stage_collateral_valuation` enforces (WS0.5, 2026-08-22). */
export const VALUATION_BATCH_CAP = 20;

/* --------------------------------------------------------- the step machine */

const REVIEW_TYPE = observedOptions("LLC_BI__Review__c", "LLC_BI__Review_Type__c");
const VALUATION_BASIS = observedOptions("LLC_BI__Collateral_Valuation__c", "LLC_BI__Type__c");
const VALUATION_SOURCE = observedOptions("LLC_BI__Collateral_Valuation__c", "LLC_BI__Source__c");
const EXCEPTION_REASON = observedOptions("LLC_BI__Covenant_Compliance2__c", "LLC_BI__Reason_for_Exception__c");

/**
 * THE NEXT QUESTION, or null when the flow has everything its tool demands.
 *
 * Null is the readiness test. It is deliberately the ONLY readiness test: a
 * second "is this complete" predicate beside it is how the room and the payload
 * builder drift apart, and the drift shows up as a refusal the banker has to
 * read.
 */
export function nextStep(route: RelRoute, ctx: RelContext, a: Answers): RelStep | null {
  /* A BLOCKED ROUTE ASKS NOTHING, AND IT IS ONE TEST RATHER THAN TWO.
     The covenant route's own honesty gate was inside `covenantStep`, so the
     valuation route rendered NO_PACKAGE_ANCHOR under its brief and then asked
     "which collateral are we valuing?" underneath it: the room refusing and
     interrogating in the same breath. Caught by the headless drive on
     2026-09-02, line 5. `relRouteBlock` is the one judgement now, and the room
     and the machine cannot disagree about it. */
  if (relRouteBlock(route, ctx)) return null;
  switch (route) {
    case "annual":
      return annualStep(ctx, a);
    case "covenant":
      return covenantStep(ctx, a);
    case "valuation":
      return valuationStep(ctx, a);
    case "rating":
      return ratingStep(ctx, a);
    case "service":
      return serviceStep(ctx, a);
    case "intake":
      return intakeStep(ctx, a);
    case "versionCovenant":
    case "versionPledge":
      return versionStep(route, ctx, a);
  }
}

/**
 * THE FURTHER SECTIONS OF A REAL ANNUAL REVIEW.
 *
 * Six narrative wires were declared on `StageAnnualReview.Request` and HARD
 * NULLED in `buildStagePayload`, so a review this room filed carried a position
 * and a recommendation and nothing else. A real annual review carries the
 * collateral position, the guarantors, the rating affirmation and the financial
 * read.
 *
 * OFFERED AS A CHIP SET, NOT AS SIX SEQUENTIAL QUESTIONS. The addendum's target
 * is two or three questions, never eight: the banker picks the sections that
 * matter on this relationship, and each pick opens ONE text step. Default is
 * none, so a review that only needs a position and a recommendation still takes
 * exactly the three questions it takes today.
 */
const ANNUAL_SECTIONS: Array<{ value: string; label: string; ask: string; field: string }> = [
  {
    value: "strengths",
    label: "Strengths",
    ask: "The strengths this review rests on.",
    field: "cm_Strengths_Narrative__c",
  },
  {
    value: "weaknesses",
    label: "Weaknesses",
    ask: "And the weaknesses it has to name.",
    field: "cm_Weakness_Narrative__c",
  },
  {
    value: "collateral",
    label: "Collateral analysis",
    ask: "The collateral position, with the dates behind the values.",
    field: "cm_Collateral_Analysis_Narrative__c",
  },
  {
    value: "guarantors",
    label: "Guarantors",
    ask: "The guarantors and what their support is worth.",
    field: "cm_Guarantor_Narrative__c",
  },
  {
    value: "rating",
    label: "Rating comments",
    ask: "The rating affirmation, in prose.",
    field: "cm_Risk_Rating_Comments__c",
  },
  {
    value: "financial",
    label: "Financial analysis",
    ask: "The financial read: the direction, not the level.",
    field: "cm_Financial_Analyst_Narrative__c",
  },
];

/** The section answer keys, so the payload reads them without a second table. */
export const ANNUAL_SECTION_FIELDS: Record<string, string> = Object.fromEntries(
  ANNUAL_SECTIONS.map((s) => [s.value, s.field]),
);

function annualStep(ctx: RelContext, a: Answers): RelStep | null {
  if (!answered(a, "reviewType")) {
    return {
      key: "reviewType",
      ask: "Which review is this?",
      kind: "chips",
      options: asOptions(REVIEW_TYPE?.values),
      placeholder: "Name the review type, or pick one above.",
      target: { object: "LLC_BI__Review__c", field: "LLC_BI__Review_Type__c" },
    };
  }
  if (!answered(a, "relationshipSummary")) {
    return {
      key: "relationshipSummary",
      ask: "State the relationship position for the record. One or two sentences.",
      kind: "text",
      optional: true,
      placeholder: "The position, in your own words.",
      /* THE FIELD NAMED HERE USED TO BE `LLC_BI__Relationship_Summary__c`,
         WHICH DOES NOT EXIST IN THIS ORG. The payload has always sent the
         correct `cm_` name; the peek on the founder's screen was wrong. */
      target: { object: "LLC_BI__Review__c", field: "cm_Relationship_Summary__c" },
    };
  }
  if (!answered(a, "recommendation")) {
    return {
      key: "recommendation",
      ask: "And the recommendation this review carries.",
      kind: "text",
      optional: true,
      placeholder: "The recommendation.",
      /* Was `LLC_BI__Recommendation__c`, which does not exist here either. */
      target: { object: "LLC_BI__Review__c", field: "cm_Recommendation_Narrative__c" },
    };
  }
  if (!answered(a, "sections")) {
    return {
      key: "sections",
      ask: "Anything else for the file?",
      kind: "multi",
      optional: true,
      options: ANNUAL_SECTIONS.map((sec) => ({
        label: sec.label,
        value: sec.value,
        detail: `Writes ${sec.field}.`,
      })),
      placeholder: "Pick the sections this review needs, or none.",
    };
  }
  const picked = pickedList(a, "sections");
  const written = perRecord(a, "sectionNarratives");
  for (const value of picked) {
    if (answered(written, value)) continue;
    const sec = ANNUAL_SECTIONS.find((x) => x.value === value);
    if (!sec) continue;
    return {
      key: `sectionNarratives.${value}`,
      ask: sec.ask,
      kind: "text",
      optional: true,
      placeholder: `${sec.label}, in your own words.`,
      target: { object: "LLC_BI__Review__c", field: sec.field },
    };
  }
  void ctx;
  return null;
}

/**
 * THE GROUNDED RECOMMENDATION, AND THE ONLY ONE (doctrine C, founder
 * 2026-09-12: "the middle path").
 *
 * Rule 2 says the room recommends one option. The room's own governance rule
 * says a record must not be filed under a default nobody chose. Doctrine C
 * reconciles them: the room recommends ONLY where the recommendation is already
 * grounded — a figure on file, or a band this codebase actually states — and it
 * says which of the two it is standing on. It never invents a number.
 *
 * This is the ON-FILE half, and it is said ONLY on a step that is holding a real
 * figure from the read: the covenant's observed value and the collateral's value
 * on the book. It is a sentence, never a pre-filled answer — the chip beside it
 * is what the banker takes, and both asks still offer the alternative in the
 * same breath.
 *
 * WHERE NOTHING IS GROUNDED THERE IS NO SENTENCE. The rating factors, the grade,
 * the override and the renewal maturity all lead with the figure on file and
 * stop there: this org states no band for a grade and no standard tenor for a
 * product, so a preference there would be invented. `reviewFlows.test.ts` and
 * `renewEngine.test.ts` assert that absence rather than trusting it.
 */
export const ON_FILE_RECOMMENDATION = "That is the figure on file, so it is the one I would file.";

function covenantStep(ctx: RelContext, a: Answers): RelStep | null {
  const covenants = reviewableCovenants(ctx);
  /* THE BOOK SPEAKS BEFORE THE ROOM ASKS, and `nextStep` has already asked
     `relRouteBlock` whether this route can run at all. A second copy of that
     judgement here is how the two come to disagree. */
  const book = relBookFor(ctx);
  const byId = new Map(book.covenants.map((c) => [c.covenantId, c]));
  if (!answered(a, "covenants")) {
    return {
      key: "covenants",
      ask: "Which covenants are we assessing?",
      kind: "multi",
      options: covenants.map((c) => {
        const held = byId.get(c.covenantId!);
        const verdict = classifyCovenant(c);
        return {
          label: covenantLabel(c),
          value: c.covenantId!,
          /* WHAT THIS COVENANT IS TIED TO IS ON THE ROW (0.9.24, backlog row
             49). The review lists EVERY covenant on the relationship, so the
             facilities and packages behind each one are how a banker places it;
             the line is a statement and never narrows the list it sits in. */
          detail: [
            verdict.label,
            held?.rail,
            c.latestComplianceStatus ? `row at ${c.latestComplianceStatus}` : null,
            held?.associationLine,
          ]
            .filter(Boolean)
            .join(" · "),
          disabled: held ? !held.assessable : false,
          reason: held?.reason ?? undefined,
        };
      }),
      placeholder: "Name the covenants, or pick them above.",
    };
  }
  const picked = pickedList(a, "covenants");
  const statuses = perRecord(a, "covenantStatuses");
  for (const id of picked) {
    if (typeof statuses[id] === "string") continue;
    const cov = covenants.find((c) => c.covenantId === id);
    /* THE TEST LEADS WITH WHERE IT STANDS (A2 audit, 2026-09-12). On the
       governance path the room is opened ON a covenant, so "How does the Debt
       Service Coverage test assess?" was the FIRST thing the banker read, with
       the rail the room was already holding two questions away. Rule 2: every
       question leads with the current figure. The rail is the read's own
       actual against its own threshold; nothing is proposed with it, because
       how a breach is assessed is a credit judgement and no band grounds it. */
    const rail = byId.get(id)?.rail;
    const standing = rail ? `The ${covenantLabel(cov ?? {})} reads ${rail}. ` : "";
    return {
      key: `covenantStatuses.${id}`,
      ask: `${standing}How does the ${covenantLabel(cov ?? {})} test assess?`,
      kind: "chips",
      options: asOptions(COVENANT_ASSESSMENT_STATUSES),
      placeholder: "Compliant, Waived or Exception.",
      target: { object: "LLC_BI__Covenant_Compliance2__c", field: "LLC_BI__Status__c" },
    };
  }
  const observed = perRecord(a, "covenantObservedValues");
  for (const id of picked) {
    if (answered(observed, id)) continue;
    const cov = covenants.find((c) => c.covenantId === id);
    const held = byId.get(id);
    /* THE ROOM PROPOSES THE FIGURE AND ASKS FOR CONFIRMATION. It already holds
       the actual the read carries; asking cold for a number it is looking at is
       the "step by step, not intuitive" the founder named. The banker still
       owns the answer: the proposal is an OPTION, never a default. */
    const proposed = typeof cov?.actualValue === "number" ? String(cov.actualValue) : null;
    return {
      key: `covenantObservedValues.${id}`,
      ask: proposed
        ? `The read carries ${held?.rail ?? proposed} on the ${covenantLabel(cov ?? {})}. ${ON_FILE_RECOMMENDATION} File that figure, or give me the certificate's own.`
        : `What figure was tested on the ${covenantLabel(cov ?? {})}?`,
      kind: "number",
      optional: true,
      options: proposed ? [{ label: proposed, value: proposed, detail: "the figure on the read", onFile: true }] : undefined,
      placeholder: "The tested figure, or skip it.",
      /* THE TOOL WRITES `LLC_BI__Historic_Financial_Indicator__c`. This peek
         used to name `LLC_BI__Observed_Value__c`, which the tool does not
         write, so the founder was reading a wrong field name on the glass. */
      target: { object: "LLC_BI__Covenant_Compliance2__c", field: "LLC_BI__Historic_Financial_Indicator__c" },
    };
  }
  const reasons = perRecord(a, "covenantReasons");
  for (const id of picked) {
    if (statuses[id] !== "Exception" || typeof reasons[id] === "string") continue;
    const cov = covenants.find((c) => c.covenantId === id);
    return {
      key: `covenantReasons.${id}`,
      ask: `Is the ${covenantLabel(cov ?? {})} exception a failed test or an undelivered document?`,
      kind: "chips",
      options: asOptions(EXCEPTION_REASON?.values),
      placeholder: "Breached or Overdue.",
      target: { object: "LLC_BI__Covenant_Compliance2__c", field: "LLC_BI__Reason_for_Exception__c" },
    };
  }
  /* THE OPT-IN, OFFERED ONLY WHERE A CHOSEN ROW IS NOT PENDING.
     `allowNonPending` has been on the tool since WS0.5 and the room has never
     offered it, so such a row could only ever be REFUSED. A write onto it is
     stored and the covenant schedule does NOT advance, which is a governance
     fact the banker has to opt into out loud rather than discover afterwards. */
  const nonPending = picked.map((id) => byId.get(id)).filter((c): c is BookCovenant => Boolean(c?.needsNonPendingOptIn));
  if (nonPending.length && !answered(a, "allowNonPending")) {
    const at = [...new Set(nonPending.map((c) => c.complianceStatus ?? "not Pending"))].join(" and ");
    return {
      key: "allowNonPending",
      ask: `${nonPending.length === 1 ? `The ${nonPending[0].name} row sits` : `${nonPending.length} of these rows sit`} at ${at}, not Pending. Record the assessment anyway?`,
      kind: "chips",
      options: [
        { label: "Record it", value: "yes", detail: "The assessment is stored and the schedule does not advance." },
        { label: "Leave those out", value: "no", detail: "Only rows at Pending are assessed." },
      ],
      placeholder: "Record it, or leave those out.",
    };
  }
  if (!answered(a, "assessmentNarrative")) {
    return {
      key: "assessmentNarrative",
      ask: "State the basis for these assessments.",
      kind: "text",
      optional: true,
      placeholder: "The basis, for the record.",
      /* THE TOOL WRITES `Agentic_AI_Response__c`, not `LLC_BI__Narrative__c`.
         Same correction as the observed figure above: the wire was always
         right and the "what this writes" peek was always wrong. */
      target: { object: "LLC_BI__Covenant_Compliance2__c", field: "Agentic_AI_Response__c" },
    };
  }
  return null;
}

/**
 * THE ROUTE CANNOT RUN, AND THE ROOM SAYS SO BEFORE IT ASKS ANYTHING.
 *
 * Non-null where the review's own preconditions fail on the read this room is
 * holding, so the refusal comes FIRST rather than after six questions and a
 * tool call. This is the single worst moment the addendum names: Hartwell
 * carries no compliance rows, so the covenant route asked which covenants, then
 * a verdict each, then a figure each, then a narrative, and only then let the
 * org refuse all six.
 *
 * IT IS NOT THE SAME TEST AS `buildStagePayload`. That one guards the WIRE and
 * still runs; this one guards the CONVERSATION.
 */
/**
 * WHAT THE ROOM CANNOT SEE, SAID OUT LOUD BEFORE THE ROUTE RUNS.
 *
 * `stage_annual_review` CREATES. There is no deployed path that edits a review
 * already on file, so filing from here files a SECOND record, not an edit. The
 * addendum wants the room to name the review already open before it asks
 * anything; no read on this cockpit carries `LLC_BI__Review__c`, so what the
 * room can honestly say is that it cannot see one. Those are different facts
 * and a banker acts differently on each.
 */
export const ANNUAL_CREATES_A_SECOND =
  "This tool creates a review; there is no deployed path that edits one already on file, and no read here carries the reviews this relationship already holds. So if a review is already open, filing from here files a second one. Say so and I will hold.";

/** The review's own decision picklists, on no tool wire. Stated, never guessed. */
export const DECISIONS_NOT_ON_THE_WIRE =
  "The review's own decision fields are not on this tool: the current and recommended relationship ratings, whether a grade change is requested, whether the covenants were tested and passed, a new policy exception, sending it to credit committee, and the next review type and date. I write the affirmation in the rating comments in prose, and those picklists stay for Salesforce.";

/** Filed is not approved, and the two fields that would say so are fenced. */
export const COMPLETE_IS_NOT_OURS =
  "The review is filed at In Progress, not approved. cm_Review_Stage__c and cm_Approved_Date__c are fenced from this cockpit, and submitting it for approval runs through the bank's own process.";

/**
 * DOES THIS ROUTE RUN AGAINST ONE PRODUCT PACKAGE?
 *
 * NOT ANY MORE, FOR THE TWO REVIEWS (0.9.24, backlog row 49; founder
 * 2026-09-13: "covenants and collaterals should be driven from the relationship
 * perspective"). nCino holds covenants on the Account with loan junctions and
 * collateral on the Account with pledges across packages, so the covenant review
 * and the collateral valuation are relationship work like the annual review, the
 * risk-rating review and the service request: they ask no package, they list
 * EVERY covenant and every owned asset on the relationship, and each row SHOWS
 * the facilities and packages it is tied to. An association is a fact on the
 * row, never a filter.
 *
 * The two VERSION routes are the only ones left that ask, and they are not
 * reviews: an amendment lands ON a package version, which is the one thing the
 * banker has to choose before anything is written.
 */
export function relRouteNeedsPackage(route: RelRoute): boolean {
  return isVersionRoute(route);
}

/**
 * WHAT A PICK ON THIS ROUTE WOULD START, so `packagePick` can decide the row.
 *
 * ONE FUNCTION STILL DECIDES ALL THREE PICKERS (0.9.17's rule, unchanged). What
 * 0.9.23 adds is the fourth ASK KIND: a version route is standing in front of a
 * package it means to SHAPE, and `"review"` blocks every unbooked package by
 * construction, which is right for a review and wrong for an amendment.
 */
export function relPackageAsk(route: RelRoute | null): PackageAsk {
  return isVersionRoute(route ?? "annual") ? "amend" : "review";
}

/**
 * The route is anchored on a package and the banker has not chosen which.
 *
 * FALSE FOR EVERY REVIEW AS OF 0.9.24. The covenant review and the collateral
 * valuation were the only two that asked, and they no longer do: the account is
 * the anchor, the room lists everything on the relationship, and the packages
 * are shown on the rows. The question that used to stand between the brief and
 * the first step is gone, not deferred.
 *
 * A VERSION ROUTE ASKS WHEREVER THE ANCHOR IS NOT ONE IT MAY SHAPE, which is the
 * common case rather than the exception: `relContextFor` falls back to the
 * SNAPSHOT's own anchor, and that is the booked package, the one thing an
 * amendment is never allowed to land on. Asking is what puts the version in
 * front of the banker; binding the snapshot's anchor silently would point the
 * route at the package it exists to leave alone.
 */
export function relPackagePending(route: RelRoute | null, ctx: RelContext): boolean {
  if (!route || !relRouteNeedsPackage(route)) return false;
  return !amendTarget(ctx) && amendablePackages(ctx).length > 0;
}

export function relRouteBlock(route: RelRoute, ctx: RelContext): string | null {
  /* SEVERAL PACKAGES IS A QUESTION, NOT A REFUSAL. `NO_PACKAGE_ANCHOR` says the
     read stages none, which is true for a relationship with no package and
     false for one staging three. The room asks instead; see `relPackagePending`. */
  if (relPackagePending(route, ctx)) return null;
  if (route === "covenant") {
    /* NO PACKAGE PRECONDITION (0.9.24). The review is anchored on the account,
       so a relationship staging two packages, three, or none at all reaches the
       same first question; what used to be a refusal here was the room asking
       for an anchor the tool no longer wants. */
    const book = relBookFor(ctx);
    if (book.noComplianceRows) return NO_COMPLIANCE_ROW(book.covenants.length);
    /* AND A QUESTION WITH NO LEGAL ANSWER IS A SEALED ROOM (A2 audit,
       2026-09-12). "Which covenants are we assessing?" is a chooser, and an
       empty chooser cannot be answered, cannot be skipped and cannot be left:
       the room asked a question nothing could satisfy and kept asking it. The
       route is refused up front instead, in words that say what is missing. */
    if (!reviewableCovenants(ctx).length) return NOTHING_TO_ASSESS;
    return null;
  }
  if (route === "valuation") {
    if (!valuableCollateral(ctx).length) return NOTHING_TO_VALUE;
    return null;
  }
  /* AND A VERSION ROUTE WITH NO VERSION TO SHAPE IS REFUSED BEFORE IT ASKS.
     `relPackagePending` has already returned above where there IS one and the
     banker has not picked it, so reaching here means the relationship carries
     nothing amendable at all, or the banker is standing on a package that is
     not it. Both are the same fact to a banker and one sentence answers both. */
  if (isVersionRoute(route)) {
    return amendTarget(ctx) ? null : NOTHING_AMENDABLE;
  }
  return null;
}

function valuationStep(ctx: RelContext, a: Answers): RelStep | null {
  const assets = valuableCollateral(ctx);
  if (!answered(a, "records")) {
    const held = new Map(relBookFor(ctx).assets.map((x) => [x.collateralId, x]));
    return {
      key: "records",
      ask: "Which collateral are we valuing?",
      kind: "multi",
      options: assets.map((c) => {
        const book = held.get(c.collateralId!);
        /* THE LENDABLE VALUE ON THE OPTION IS THE PLEDGE FIGURE, which is the
           credit figure. The asset's own formula ignores the pledge override:
           on Hartwell inventory the asset reads $6.4MM at the 80 percent type
           rate and the pledge reads $4.0MM at the 50 percent policy rate.
           Printing the asset figure would print a number the bank does not
           lend against.

           THE VALUATION CLOCK IS THE OPENING READ OF THIS ROUTE. The banker
           picking assets to revalue is choosing on staleness, so when each was
           last valued, on what basis, and when it falls due next is on the
           option itself rather than a question later. `book.valuation` says
           "No valuation on file" where the read stages none. */
        return {
          label: collateralLabel(c),
          value: c.collateralId!,
          /* THE ORG'S OWN NAMES FOR THE ASSET ARE ANSWERS TOO. The option's
             VALUE is a Salesforce record id and its LABEL is the long
             description, so COL-000762 - the autonumber printed on the
             collateral pane and in nCino - used to be met with the identical
             re-ask. The bank's own vocabulary for a row is not a miss. */
          synonyms: [c.collateralName, c.collateralType].filter((x): x is string => Boolean(x && x.trim())),
          detail: [
            c.collateralType,
            typeof c.collateralValue === "number" ? fmtMoney(c.collateralValue) : null,
            book?.lendable ? `${book.lendable} lendable` : null,
            book?.advanceRateSource,
            book?.valuation,
            /* AND ITS PLEDGES (0.9.24). The valuation lists every asset the
               borrower owns, so which facilities and packages each one secures
               is the fact that places it. Shown, never a filter. */
            book?.associationLine,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }),
      placeholder: "Name the assets, or pick them above.",
    };
  }
  const picked = pickedList(a, "records");
  const values = perRecord(a, "recordValues");
  const held = new Map(relBookFor(ctx).assets.map((x) => [x.collateralId, x]));
  for (const id of picked) {
    /* ANSWERED, NOT "A NUMBER". `covenantStep` already reads its observed
       figure this way, and the two must agree: the step counter walks this
       machine writing the SKIPPED sentinel, so a predicate that only accepts a
       number never clears this step and the counter burned its whole guard.
       "Step 2 of 65" on a seven-step ritual came from exactly this line. */
    if (answered(values, id)) continue;
    const asset = assets.find((c) => c.collateralId === id);
    const label = collateralLabel(asset ?? {});
    const book = held.get(id);
    /* THE FIGURE ON FILE LEADS, AND ITS DATE WITH IT. The chooser chip the
       banker just took already printed both; asking "what value are we filing"
       cold underneath it is the blank form the golden rule refuses. The on-file
       figure is OFFERED as an option, exactly as the covenant observed figure
       is, and it is never written on the banker's behalf. */
    const onFile = book?.value ?? null;
    const raw = typeof asset?.collateralValue === "number" ? String(asset.collateralValue) : null;
    const standing = onFile
      ? `${label} carries ${onFile} on the book${
          book?.lastValued ? `, last valued ${book.lastValued}` : ", with no valuation on file"
        }${book?.lendable ? `, ${book.lendable} lendable` : ""}.`
      : null;
    return {
      key: `recordValues.${id}`,
      /* AND WHERE THE BOOK CARRIES NOTHING IT SAYS SO (A2 audit, 2026-09-12).
         "What value are we filing for Receivables?" reads as a form the room
         could have filled; "the book carries no value for it" is the fact that
         makes the question necessary. No figure is proposed here, because none
         is grounded. */
      ask: standing
        ? `${standing} ${ON_FILE_RECOMMENDATION} File that figure, or give me the new one.`
        : `The book carries no value for ${label}. What value are we filing for it?`,
      kind: "number",
      options: onFile && raw ? [{ label: onFile, value: raw, detail: "the figure on the book", onFile: true }] : undefined,
      placeholder: onFile ? `The figure, in dollars, or take the ${onFile} on file.` : "The figure, in dollars.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Value__c" },
    };
  }
  if (!answered(a, "valuationDate")) {
    /* THE DATE ON FILE LEADS, LIKE THE FIGURE ABOVE IT (A2 audit, 2026-09-12).
       The room holds every picked asset's last valuation date and asked for a
       date cold underneath them, which is the blank form rule 2 refuses. The
       dates on file are stated; NO recommendation travels with them, because
       the date a new valuation is struck on is the exercise's own and the date
       on file is by definition the one being replaced. */
    const onFile = [...new Set(picked.map((id) => held.get(id)?.lastValued).filter((d): d is string => Boolean(d)))];
    const standing = onFile.length
      ? `The ${onFile.length === 1 ? "valuation on file was" : "valuations on file were"} struck ${onFile.join(", ")}. `
      : "";
    return {
      key: "valuationDate",
      ask: `${standing}As of what date was this one struck?`,
      kind: "date",
      placeholder: "YYYY-MM-DD.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Valuation_Date__c" },
    };
  }
  if (!answered(a, "type")) {
    return {
      key: "type",
      ask: "On what basis was it struck?",
      kind: "chips",
      options: asOptions(VALUATION_BASIS?.values),
      placeholder: "The valuation basis.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Type__c" },
    };
  }
  if (!answered(a, "source")) {
    return {
      key: "source",
      ask: "And where did the figure come from?",
      kind: "chips",
      options: asOptions(VALUATION_SOURCE?.values),
      /* THE ORG'S LIST CARRIES NEITHER A BROKER OPINION OF VALUE NOR A FIELD
         EXAM, and a banker who says either should be told which of the org's
         own values covers it rather than watching the room pick one silently. */
      placeholder: "The source of the number. No BOV and no Field Exam on this org's list.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Source__c" },
    };
  }
  /* TWO INPUTS THE TOOL HAS ALWAYS TAKEN AND THE ROOM HARDCODED.
     `primary: false` and `description: null` were written into every payload,
     so a banker filing the valuation that supersedes the one on file could not
     say so, and the appraiser who struck the figure went unrecorded. */
  if (!answered(a, "primary")) {
    return {
      key: "primary",
      ask: "Does this become the primary valuation on the asset?",
      kind: "chips",
      options: [
        { label: "Yes", value: "yes", detail: "It supersedes the valuation on file as the primary." },
        { label: "No", value: "no", detail: "It joins the ladder and the primary does not move." },
      ],
      placeholder: "Yes or no.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Primary__c" },
    };
  }
  if (!answered(a, "description")) {
    return {
      key: "description",
      ask: "Name the appraiser or the exam, for the record.",
      kind: "text",
      optional: true,
      placeholder: "Who struck the figure, or skip it.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Valuation_Description__c" },
    };
  }
  return null;
}

/**
 * The four factors, in the order the org's own request class carries them.
 *
 * THE WRITE OBJECT IS `LLC_BI__Annual_Review__c`. There is no
 * `LLC_BI__Risk_Rating_Review__c` in this org — the label and the API name do
 * not agree, and the panel schema records the same mismatch. The room names the
 * object the plan actually writes.
 */
/** `from` is the TEST on the book that measures the same thing. No read on this
 *  cockpit carries these four as rating inputs; where the relationship runs a
 *  covenant over the same quantity, the room shows that figure and names it as
 *  the covenant's rather than asking cold beside it. Nothing is derived and
 *  nothing is defaulted: the figure is offered and the banker answers. */
const RATING_FACTORS: Array<{ key: string; label: string; ask: string; field: string; from?: RegExp }> = [
  {
    key: "cashFlowCoverage",
    label: "cash-flow coverage",
    ask: "What is cash-flow coverage on this borrower?",
    field: "cashFlowCoverageActual",
    from: /\b(coverage|debt\s*service|dscr|fixed\s*charge)\b/i,
  },
  { key: "revenueGrowth", label: "revenue growth", ask: "And revenue growth?", field: "revenueGrowthActual", from: /\brevenue\b/i },
  { key: "managementExperience", label: "management experience", ask: "Management experience, in years?", field: "managementExperienceActual" },
  { key: "creditScore", label: "credit score", ask: "And the credit score?", field: "creditScoreActual" },
];

/** THE ONE FACTOR THIS ORG'S TEMPLATE ACTUALLY SCORES. The other three are
 *  stored as inputs and never weighed, and the tool cannot choose the template,
 *  so the room says which is which rather than implying a model. */
const SCORED_FACTOR = "cashFlowCoverage";

/** WHERE THE BANKER LEARNS THAT THREE OF THE FOUR ARE STORED AND NOT WEIGHED:
 *  the first question that asks for one of them. Said over the scored factor it
 *  would tell them nothing about the three still coming. */
const FIRST_STORED_FACTOR = RATING_FACTORS.find((f) => f.key !== SCORED_FACTOR)!.key;

const RATING_OBJECT = "LLC_BI__Annual_Review__c";

function ratingStep(ctx: RelContext, a: Answers): RelStep | null {
  const covenants = reviewableCovenants(ctx);
  const rails = new Map(relBookFor(ctx).covenants.map((c) => [c.covenantId, c.rail]));
  for (const factor of RATING_FACTORS) {
    if (answered(a, factor.key)) continue;
    const held = factor.from
      ? covenants.find((c) => typeof c.actualValue === "number" && factor.from!.test(covenantLabel(c)))
      : undefined;
    const rail = held ? (rails.get(held.covenantId as string) ?? String(held.actualValue)) : null;
    const note = factor.key === FIRST_STORED_FACTOR ? ` ${SCORED_VS_STORED}` : "";
    return {
      key: factor.key,
      /* THE READ'S CLOSEST FIGURE LEADS, NAMED FOR WHAT IT IS. It is the
         covenant's figure and the sentence says so, so nobody reads it as the
         rating input already on file. Where the read carries nothing at all the
         question says that too, rather than standing there as a blank box. */
      ask: held
        ? `${factor.ask} The closest figure the read carries is the ${covenantLabel(held)} test at ${rail}.${note}`
        : `${factor.ask} No read on this cockpit carries it, so the figure is yours or the question is skipped.${note}`,
      kind: "number",
      optional: true,
      options: held
        ? [
            {
              label: String(held.actualValue),
              value: String(held.actualValue),
              detail: `the ${covenantLabel(held)} test's own figure`,
            },
          ]
        : undefined,
      placeholder: "The figure, or skip it.",
      target: { object: RATING_OBJECT, field: factor.field },
    };
  }
  /* THE PROPOSED GRADE IS STATED AND OWNED, not taken silently. It used to be
     read off `snapshot.computedRiskRating` inside `buildStagePayload` and never
     shown, so the banker filed a grade nobody had put in front of them. The
     read's own figure is offered as a chip; the proposal is theirs. */
  if (!answered(a, "computedRiskGradeValue")) {
    const computed = Number(ctx.bundle?.snapshot?.computedRiskRating);
    const proposed = Number.isFinite(computed) ? String(computed) : null;
    const onFile = ctx.bundle?.snapshot?.primaryRiskRating;
    return {
      key: "computedRiskGradeValue",
      ask: onFile
        ? `The grade on file is ${onFile}, on the relationship. What grade does this analysis support, on the rating review's own scale?`
        : "What grade does this analysis support, on the rating review's own scale?",
      kind: "number",
      optional: true,
      options: proposed ? [{ label: proposed, value: proposed, detail: "the grade the read computes" }] : undefined,
      placeholder: `A grade from ${RISK_GRADE_SCALE.min} to ${RISK_GRADE_SCALE.max}, or skip it.`,
      bounds: GRADE_BOUNDS,
      target: { object: RATING_OBJECT, field: "LLC_BI__Computed_Risk_Grade_Value__c" },
    };
  }
  /* THE OVERRIDE IS ON THE WIRE and the room used to refuse it by name.
     `StageRiskRatingReview.Request.overriddenRiskGradeValue` is deployed and
     `StageExecuteRiskRatingReviewTest.overrideWithACommentIsAccepted` covers
     it. What IS refused is an override with no written reason, which is the
     org's own Mandatory_comment rule and has no bypass. */
  if (!answered(a, "overriddenRiskGradeValue")) {
    return {
      key: "overriddenRiskGradeValue",
      ask: "Are you overriding the computed grade? Give me the grade you are filing instead, or skip it.",
      kind: "number",
      optional: true,
      placeholder: `The overriding grade, ${RISK_GRADE_SCALE.min} to ${RISK_GRADE_SCALE.max}, or skip it.`,
      bounds: GRADE_BOUNDS,
      target: { object: RATING_OBJECT, field: "LLC_BI__Overridden_Risk_Grade_Value__c" },
    };
  }
  if (!answered(a, "overrideComment")) {
    const overriding = hasOverride(a);
    return {
      key: "overrideComment",
      /* AN OVERRIDE ABOVE ZERO MAKES THE COMMENT MANDATORY. The room says so
         and stops it being optional, rather than letting the org refuse. */
      ask: overriding
        ? "An override needs a written reason. That is the org's own rule and it has no bypass."
        : "State the rationale for the record.",
      kind: "text",
      optional: !overriding,
      placeholder: overriding ? "The reason for the override." : "The rationale.",
      target: { object: RATING_OBJECT, field: "LLC_BI__Comments__c" },
    };
  }
  return null;
}

/** TRUE where the answers carry an override above zero. The org's own trigger
 *  for the Mandatory_comment rule, read the same way in the step and the wire. */
function hasOverride(a: Answers): boolean {
  const v = num(a.overriddenRiskGradeValue);
  return v !== null && v > 0;
}

/**
 * THE OVERRIDE NEEDS A WRITTEN REASON, and that is the only thing refused.
 *
 * This constant REPLACES `OVERRIDE_NOT_FILEABLE`, which told the banker the
 * override could not be filed because its wire name had never been observed.
 * That was false against the source in this repo:
 * `StageRiskRatingReview.Request.overriddenRiskGradeValue` is deployed, carries
 * its own description, and `StageExecuteRiskRatingReviewTest`
 * .overrideWithACommentIsAccepted covers it. The room was refusing a capability
 * the tool already takes.
 *
 * What is real is the org's `Mandatory_comment` rule: any override above zero
 * requires `LLC_BI__Comments__c`, and it has no bypass. The room validates it
 * before the org has to.
 */
export const OVERRIDE_NEEDS_A_REASON =
  "An override above zero needs a written reason. That is the org's own rule and it has no bypass. Give me the reason and I will file both.";

/**
 * THE RATING REVIEW'S OWN SCALE, and the ONLY place the room holds it.
 *
 * `StageRiskRatingReview.cls` states it in its header ("the review scale here is
 * 1 to 12") and on `computedRiskGradeValue`'s own describe ("The model output,
 * on the 1 to 12 review scale"). It does NOT enforce it: the class validates
 * `accountId`, `rationale` and the Mandatory_comment rule, and nothing else, so
 * a 47, a 99 or a 0 travelled the wire and filed. The doctrine block calls this
 * surface "unbounded" and that stays true of the ORG. It is not true of the
 * room.
 *
 * The bound is written here and not read from doctrine deliberately: the
 * doctrine block is prose the model reasons over, not a validator, and a
 * refusal that depends on a sentence being selected is not a refusal.
 */
export const RISK_GRADE_SCALE = { min: 1, max: 12 } as const;

/**
 * THE GRADE IS OFF THE SCALE, refused by name with the scale stated.
 *
 * Zero is refused with the rest and for its own reason: on the override wire it
 * is the org's own "no override" sentinel (`Mandatory_comment` fires above
 * zero), so filing a zero would look like an override that needed no comment
 * and read like a grade at the same time. The question is optional; skipping it
 * is how a banker says nothing.
 */
export const GRADE_OFF_THE_SCALE =
  `The rating review's own scale is ${RISK_GRADE_SCALE.min} to ${RISK_GRADE_SCALE.max}, in whole numbers, and I will not file a grade off it. Zero is not a grade on this scale either: skip the question instead. Give me a number from ${RISK_GRADE_SCALE.min} to ${RISK_GRADE_SCALE.max}.`;

const GRADE_BOUNDS = {
  min: RISK_GRADE_SCALE.min,
  max: RISK_GRADE_SCALE.max,
  whole: true,
  refusal: GRADE_OFF_THE_SCALE,
} as const;

/** TRUE where a figure sits inside a step's declared scale. */
export function onScale(n: number, b: NonNullable<RelStep["bounds"]>): boolean {
  return Number.isFinite(n) && (!b.whole || Number.isInteger(n)) && n >= b.min && n <= b.max;
}

/** TRUE where a figure is a grade this org's review scale can hold. */
export function onRiskGradeScale(n: number | null): boolean {
  return n !== null && onScale(n, GRADE_BOUNDS);
}

/**
 * SPECIAL MENTION IS NOT A GRADE IN THIS ORG.
 *
 * The interagency categories are the regulatory classification and this org's
 * rating scale is numeric. Writing "Substandard" into a numeric grade field is
 * not a thing the org can hold, and reading a number out of the word would be
 * inventing the bank's own mapping.
 */
export const NOT_A_CLASSIFICATION =
  "Special Mention, Substandard, Doubtful and Loss are the regulatory categories and this org's scale is numeric. I file the grade; the classification is assigned elsewhere and I will not write one into it.";

/**
 * FOUR GRADE SURFACES ARE LIVE HERE AND THEY DO NOT AGREE.
 *
 * THE RANGES OF THE OTHER THREE ARE NOT INLINED HERE. They live in the
 * `risk-rating` doctrine block, which is where every other bank figure the
 * model reasons over lives; a component that restates a scale is a second place
 * for it to drift. This room's own surface IS inlined, in
 * `RISK_GRADE_SCALE` above, because the room ENFORCES that one and a bound
 * cannot be enforced from prose.
 */
export const NAME_THE_SURFACE =
  "Four grade surfaces are live here and they do not agree: the facility's, the package's, the review's and this rating review's own. The number I am filing is on the rating review's own scale.";

/** The org put this rating on a template that scores ONE factor. */
export const SCORED_VS_STORED =
  "This org's rating template scores cash-flow coverage and nothing else. The credit score, the management experience and the revenue growth are recorded as inputs and not weighed, and the tool cannot choose the template.";

/** The dual-rating fields exist, are empty on every record, and are on no wire. */
export const DUAL_RATING_NOT_CARRIED =
  "The probability of default and loss given default fields exist on this object and are empty on every record here, and none is on this tool's wire. I read them; I never claim them.";

/** "override the grade to 6", "downgrade it to 7 manually". */
const OVERRIDE_ASK = /\b(override|overrid\w*)\b/i;

/** The interagency categories, which this org's numeric scale does not hold. */
const CLASSIFICATION_ASK = /\b(special\s+mention|substandard|doubtful|criticised|criticized|classif\w+)\b/i;

/** TRUE where the banker asked to override the computed grade. */
export function asksForOverride(text: string, route: RelRoute): boolean {
  return route === "rating" && OVERRIDE_ASK.test(text.trim());
}

/** TRUE where the banker named a REGULATORY CLASSIFICATION rather than a grade. */
export function asksForClassification(text: string, route: RelRoute): boolean {
  return route === "rating" && CLASSIFICATION_ASK.test(text.trim());
}

/**
 * THE SERVICE REQUEST, WITH ITS SUBJECT AND ITS BODY THE RIGHT WAY ROUND.
 *
 * THREE DEFECTS LIVED ON FOUR LINES OF THIS FUNCTION, all of them against the
 * deployed `StageServiceRequest.cls` in this repo.
 *
 * 1. THE SUBJECT AND THE BODY WERE INVERTED. The Apex is explicit:
 *    `requestType` is "Banker-language description of what the client asked
 *    for. Becomes the case subject" and maps `'Subject' => req.requestType`;
 *    `summary` is "The request in full, as the servicing team needs to read it"
 *    and maps `'Description' => describeWithSource(req)`. Both are
 *    required=true. The room asked "What kind of request is this?" for
 *    `requestType`, so a CATEGORY landed on the subject line, and "State the
 *    subject" for `summary`, so THE SUBJECT LANDED IN THE DESCRIPTION BODY.
 *
 * 2. `origin` IS NOT A WIRE. The class declares no origin invocable variable at
 *    all. It resolves `Case.Type` and `Case.Origin` itself through
 *    `C360Picklist.preferredOrFallback` and reports `degradedTypeMode`. The
 *    banker answered "How did it reach us?" and the answer was dropped on the
 *    floor. The step and the payload key are gone.
 *
 * 3. `Case.Type` AND `Case.Origin` CHIPS WOULD REPEAT DEFECT 2. The catalog now
 *    carries both, and the wire-arms follow-up says to pass them into this
 *    room. DO NOT. Neither is on the wire, so a chip set from them is a
 *    question that cannot be filed. They are named in `produces` as facts the
 *    ORG sets, and never offered as chips. The catalog reaches this room for
 *    covenantType and collateralType only.
 */
function serviceStep(ctx: RelContext, a: Answers): RelStep | null {
  if (!answered(a, "requestType")) {
    /* THE CLIENT'S OWN WORDS LEAD, where the read staged an inbound request.
       Offered as a chip, never written silently: a subject the banker did not
       choose is a case nobody can defend at audit. */
    const inbound = (ctx.bundle?.requests ?? [])[0]?.summary?.trim();
    return {
      key: "requestType",
      ask: "What did the client ask for? One line, as it should read on the case.",
      kind: "text",
      options: inbound
        ? [{ label: inbound.slice(0, 120), value: inbound.slice(0, 120), detail: "from the client's request" }]
        : undefined,
      placeholder: "The ask, in one line.",
      // THIS LINE IS THE CASE SUBJECT. A subject nobody can action is a case
      // nobody can defend at audit, so the room challenges it once.
      substantive: true,
      target: { object: "Case", field: "Subject" },
    };
  }
  if (!answered(a, "summary")) {
    return {
      key: "summary",
      ask: "And the request in full, as the servicing team needs to read it.",
      kind: "text",
      /* A FIELD EXAM ASK GETS ITS BODY OFFERED, never written for it. Read off
         the SUBJECT the banker has already answered, so it appears whether the
         route was bound from the field exam offer or typed straight in. */
      options: fieldExamBodyOption(a.requestType),
      placeholder: "The request, in full.",
      // AND THIS ONE IS THE CASE BODY, which the servicing team works from.
      substantive: true,
      target: { object: "Case", field: "Description" },
    };
  }
  if (!answered(a, "detail")) {
    /* THE DETAIL RIDES `rationale`, AND THE PEEK NOW SAYS SO.
       `buildStagePayload` folds `a.detail` into `typed`, which becomes the
       plan's `rationale`; it puts no `detail` on the wire and it never has.
       The step nonetheless claimed {Case, Description}, which `summary` already
       owns and actually writes, so the founder was reading a peek that named a
       field this answer does not reach. A step with no target claims nothing:
       the ask itself says where the words go. */
    return {
      key: "detail",
      ask: "Anything further for the audit record? It rides the plan's rationale, not the case body.",
      kind: "text",
      optional: true,
      placeholder: "Further detail, or skip it.",
    };
  }
  return null;
}

/* ------------------------------------------------------------ the payloads */

export type PayloadResult =
  | { ok: true; payload: StagePayloads[keyof StagePayloads] }
  | { ok: false; blocked: string };

/**
 * BUILD THE TOOL PAYLOAD from what the banker answered.
 *
 * Every key below is copied from `ActionPanel.stagePayload()`, which is itself
 * copied from a request body the org actually accepted. Nothing is composed
 * here that the panel does not already send, and a flow that cannot satisfy its
 * tool's hard requirements returns a BLOCKED SENTENCE rather than a payload the
 * org would refuse.
 */
export function buildStagePayload(route: RelRoute, ctx: RelContext, a: Answers, idempotencyKey: string): PayloadResult {
  const spec = REL_FLOWS[route];
  const typed = [
    text(a.relationshipSummary),
    text(a.recommendation),
    text(a.assessmentNarrative),
    text(a.overrideComment),
    text(a.detail),
  ]
    .filter((x): x is string => !!x)
    .join(" ");
  const rationale = stageRationale({ actionId: spec.actionId, accountName: ctx.accountName, typed });

  /* THE INTAKE IS ANCHORED ON THE RELATIONSHIP, NOT ON THE PACKAGE, so it is
     read before the package-anchored routes and composes its own wire. The
     rationale is composed inside the intake module, over the notes the banker
     wrote on the drafts, because those are per covenant rather than one
     narrative for the whole exercise. */
  if (route === "intake") return buildIntakePayload(ctx, a, idempotencyKey);

  /* AND THE TWO VERSION ROUTES COMPOSE THEIR OWN WIRE TOO. `amend_version` is
     anchored on `versionPackageId` and carries no `accountId` and no
     `productPackageId`, so nothing in the shared composition above applies to
     it; the rationale is composed inside the module, over what the banker
     actually chose, because the registry carries no card for the action. */
  if (route === "versionCovenant" || route === "versionPledge") {
    return buildVersionPayload(route, ctx, a, idempotencyKey);
  }

  if (route === "annual") {
    const written = perRecord(a, "sectionNarratives");
    /* A SECTION TRAVELS ONLY WHERE IT WAS PICKED AND ANSWERED. A section the
       banker never chose is null, and one they chose and skipped is null too:
       the wire carries what was written and nothing about the choosing. */
    const section = (value: string): string | null =>
      pickedList(a, "sections").includes(value) ? text(written[value]) : null;
    return {
      ok: true,
      payload: {
        idempotencyKey,
        accountId: ctx.accountId,
        rationale,
        reviewType: text(a.reviewType),
        productPackageId: ctx.productPackageId,
        narrative: null,
        relationshipSummary: text(a.relationshipSummary),
        strengthsNarrative: section("strengths"),
        weaknessNarrative: section("weaknesses"),
        recommendationNarrative: text(a.recommendation),
        collateralAnalysisNarrative: section("collateral"),
        financialAnalystNarrative: section("financial"),
        guarantorNarrative: section("guarantors"),
        riskRatingComments: section("rating"),
      },
    };
  }

  if (route === "covenant") {
    const picked = [...new Set(pickedList(a, "covenants"))];
    const statuses = perRecord(a, "covenantStatuses");
    const reasons = perRecord(a, "covenantReasons");
    const observed = perRecord(a, "covenantObservedValues");
    // ALL OR NOTHING on the verdict, exactly as the panel does it. A covenant
    // the banker selected but never answered is not filed under a default.
    const assessments = picked
      .filter((covenantId) => typeof statuses[covenantId] === "string" && statuses[covenantId] !== "")
      .map((covenantId) => ({
        covenantId,
        status: statuses[covenantId] as string,
        // A NUMBER on this wire: the invocable declares Decimal.
        observedValue: num(observed[covenantId]),
        reasonForException: typeof reasons[covenantId] === "string" ? (reasons[covenantId] as string) : null,
        narrative: text(a.assessmentNarrative),
        comments: null,
      }));
    if (!assessments.length || assessments.length !== picked.length) {
      return { ok: false, blocked: "Every covenant on the list needs a verdict before the plan can be staged." };
    }
    /* THE ACCOUNT IS THE ANCHOR AND NO PACKAGE TRAVELS (0.9.24, backlog row
       49). `productPackageId` is still on the type because the Client Actions
       panel sends one and the deployed org still accepts a package-only call;
       this room never does, because it never asked. */
    const payload: StagePayloads["covenant-review"] = {
      idempotencyKey,
      rationale,
      accountId: ctx.accountId,
      assessments,
      covenantIds: picked,
    };
    // ONLY WHERE THE BANKER SAID YES OUT LOUD. An absent key is the tool's own
    // default of false; sending `false` would claim the question was asked.
    if (a.allowNonPending === "yes") payload.allowNonPending = true;
    return { ok: true, payload };
  }

  if (route === "valuation") {
    const picked = [...new Set(pickedList(a, "records"))];
    const valuationDate = text(a.valuationDate);
    if (!picked.length || !valuationDate) {
      return { ok: false, blocked: "The valuation needs at least one asset and the date it was struck on." };
    }
    if (picked.length > VALUATION_BATCH_CAP) {
      return { ok: false, blocked: `The tool caps a valuation batch at ${VALUATION_BATCH_CAP} assets.` };
    }
    const values = perRecord(a, "recordValues");
    // The basis, the origin, the date and the notes describe the EXERCISE and
    // apply to every item in it. Only the figure is per collateral record.
    const shared = {
      valuationDate,
      type: text(a.type),
      source: text(a.source),
      description: text(a.description),
      primary: a.primary === "yes",
    };
    // THE ACCOUNT IS THE ANCHOR HERE TOO, for the same reason: an asset is
    // owned by the borrower and pledged across packages, never by one package.
    return {
      ok: true,
      payload: {
        idempotencyKey,
        rationale,
        accountId: ctx.accountId,
        items: picked.map((collateralId) => ({ collateralId, value: num(values[collateralId]), ...shared })),
      },
    };
  }

  if (route === "rating") {
    // THE GRADE THE BANKER OWNS, falling back to the read's own computed figure
    // only where they skipped the question rather than answered it.
    const fromRead = Number(ctx.bundle?.snapshot?.computedRiskRating);
    const answeredGrade = num(a.computedRiskGradeValue);
    const overridden = num(a.overriddenRiskGradeValue);
    const comments = text(a.overrideComment);
    /* THE ORG'S OWN RULE, CHECKED BEFORE THE ORG HAS TO. `Mandatory_comment`
       fires on any override above zero and has no bypass, so a plan that would
       certainly be refused is blocked here with the reason in words. */
    if (overridden !== null && overridden > 0 && !comments) {
      return { ok: false, blocked: OVERRIDE_NEEDS_A_REASON };
    }
    /* AND NEITHER GRADE MAY LEAVE THE SCALE. The step refuses it first, so this
       is the second gate rather than the only one: an answer can also arrive
       from a chip, from the read's own computed figure, or from a restored
       session, and none of those goes through the composer. The org enforces
       nothing here, so if this passes a 47 the org files a 47. */
    for (const grade of [answeredGrade, overridden]) {
      if (grade !== null && !onRiskGradeScale(grade)) return { ok: false, blocked: GRADE_OFF_THE_SCALE };
    }
    const fallback = Number.isFinite(fromRead) && onRiskGradeScale(fromRead) ? fromRead : null;
    return {
      ok: true,
      payload: {
        idempotencyKey,
        accountId: ctx.accountId,
        rationale,
        computedRiskGradeValue: answeredGrade ?? fallback,
        overriddenRiskGradeValue: overridden,
        cashFlowCoverageActual: num(a.cashFlowCoverage),
        revenueGrowthActual: num(a.revenueGrowth),
        managementExperienceActual: num(a.managementExperience),
        creditScoreActual: num(a.creditScore),
        comments,
        /* NO loanId. It is the only facility-LGD hook on any of the five wires,
           and a facility rating is the facility room's subject: this route's
           whole frame is the borrower. Left off deliberately, and `produces`
           says so. */
      },
    };
  }

  const req = (ctx.bundle?.requests ?? [])[0];
  return {
    ok: true,
    payload: {
      idempotencyKey,
      accountId: ctx.accountId,
      rationale,
      // requestType BECOMES THE SUBJECT and summary BECOMES THE DESCRIPTION.
      // The Apex says so in its own field descriptions; the room used to send
      // these two the other way round.
      requestType: text(a.requestType),
      summary: text(a.summary),
      // NO `origin`. StageServiceRequest declares no such invocable variable:
      // it reads Case.Type and Case.Origin off this org's own picklists.
      referenceKind: req?.reference?.kind ?? null,
      referenceId: req?.reference?.id ?? null,
      referenceWebLink: req?.reference?.webLink ?? null,
    },
  };
}

/**
 * THE LINE THE ROOM SAYS THE MOMENT THE LAST QUESTION IS ANSWERED.
 *
 * Four of the six routes have nothing to add to it: the plan the org stages is
 * about to say what it will write, in the org's own summary, and a second
 * sentence from the room ahead of it would be the room speaking for the tool.
 * The INTAKE is the exception, because what it does NOT do is the fact a banker
 * has to hear before the plan lands: an asset filed here secures nothing.
 */
export function relReadyLine(route: RelRoute, ctx: RelContext, answers: Answers): string {
  const base = `That is everything the ${REL_ROUTE_WORD[route]} needs. Review the plan below, then file it.`;
  if (route === "intake") return `${intakeConfirmSentence(ctx, answers)} ${base}`;
  /* AND THE VERSION ROUTES ARE THE OTHER EXCEPTION, for the same reason: what
     an amendment does NOT do is the fact a banker has to hear before the plan
     lands, and so is the effect the room can derive from the read it holds. */
  if (route === "versionCovenant" || route === "versionPledge") {
    return `${versionPlanNarrative(route, ctx, answers)} ${base}`;
  }
  return base;
}

/* `NO_PACKAGE_ANCHOR` IS GONE (0.9.24). It said "this review is anchored on the
   product package and the read stages none for this relationship", which is no
   longer true of either review and was never true of a relationship staging
   two. The account is the anchor; there is nothing left to refuse. */

/* WHAT THE ROUTE WOULD HAVE HAD NOTHING TO ASK ABOUT. Both name the gap and
   both name the way on, because a refusal without a door is the dead end rule 4
   forbids (A2 audit, 2026-09-12). */
const NOTHING_TO_ASSESS =
  "This package carries no covenant this room can assess: a covenant is assessable here only where Salesforce holds a compliance row against it. " +
  "I can put a new covenant onto the relationship, or run the annual review.";
const NOTHING_TO_VALUE =
  "This relationship pledges no collateral on its active facilities, so there is nothing here to value. " +
  "I can put a new asset onto the relationship, or run the annual review.";

/* ------------------------------------------------------------- the driver */

export interface RelFlowDeps {
  stage: (actionId: WriteActionId, payload: StagePayloads[keyof StagePayloads]) => Promise<ToolOutcome<StagedOutput>>;
  execute: (actionId: WriteActionId, payload: ExecutePayload) => Promise<ToolOutcome<ExecuteResult>>;
  /** Is there a connector at all. The channel-none doctrine turns on this. */
  available: () => boolean;
  newKey: () => string;
  /** How the room waits on the org after a dispatched call lost its answer.
   *  Injected so a test does not spend ninety real seconds; live by default. */
  settle?: SettleDeps;
}

export const defaultRelDeps: RelFlowDeps = {
  stage: (actionId, payload) => stageAction(actionId, payload as never),
  execute: (actionId, payload) => executeAction(actionId, payload),
  available: mcpAvailable,
  newKey: newRequestId,
};

/** THE ROOM REACHED NO ORG. The one failure that earns a surface of its own:
 *  a banker who cannot tell "not connected" from "something went wrong" will
 *  retry a room that can never answer. No plan, nothing simulated, no token. */
export const NO_CONNECTOR =
  "This view is not connected to the bank's systems, so there is no plan to stage and nothing here is ever simulated. Open the cockpit with the Customer 360 connector enabled and the review will run against the org.";

export class RelFlowError extends Error {
  /** True once the call has REACHED the org: the token may be spent and the
   *  write may have landed, so the approval must not be offered again. */
  readonly dispatched: boolean;
  readonly code: string;
  /** The org's own legal value list, where the refusal carried one. */
  readonly legalValues?: string[];

  constructor(message: string, opts?: { dispatched?: boolean; code?: string; legalValues?: string[] }) {
    super(message);
    this.name = "RelFlowError";
    this.dispatched = opts?.dispatched === true;
    this.code = opts?.code ?? "RELATIONSHIP_FLOW";
    this.legalValues = opts?.legalValues;
  }
}

function fromToolError(e: ToolError, dispatched: boolean): RelFlowError {
  return new RelFlowError(toolErrorCopy(e), { dispatched, code: e.code, legalValues: legalValuesFrom(e) });
}

/** The org's own legal list, lifted out of a refusal so the room can re-offer
 *  it as chips instead of leaving the banker to guess again. */
export function legalValuesFrom(e: ToolError): string[] | undefined {
  return e.legalValues ?? parseLegalValues(e.message);
}

export interface StagedRelPlan {
  plan: StagedOutput;
  stagingId: string;
  planHash: string;
  decisionToken: string | null;
}

/**
 * STAGE THE PLAN. Zero DML by contract, which is the only reason the flow card
 * can show the org's REAL decision token rather than a decoration shaped like
 * one.
 */
export async function stageRelPlan(
  route: RelRoute,
  ctx: RelContext,
  answers: Answers,
  idempotencyKey: string,
  deps: RelFlowDeps = defaultRelDeps,
): Promise<StagedRelPlan> {
  if (!deps.available()) throw new RelFlowError(NO_CONNECTOR, { code: "server_not_connected" });
  const built = buildStagePayload(route, ctx, answers, idempotencyKey);
  if (!built.ok) throw new RelFlowError(built.blocked, { code: "INCOMPLETE" });
  const out = await deps.stage(REL_FLOWS[route].actionId, built.payload);
  if (!out.ok) throw fromToolError(out.error, false);
  const plan = out.result;

  /* THE SAME TWO CHECKS THE CONFIRM GATE RUNS, and for the same reason. A plan
     that would write outside the transition allowlist, or that carries a record
     id the staging call could not have created, is not a plan a banker should
     be offered a token for. Both refuse BEFORE the gesture exists rather than
     after it is made. */
  const violations = validatePlan(plan.steps, REL_FLOWS[route].toolId);
  if (violations.length) {
    throw new RelFlowError(
      `The staged plan would write outside what this cockpit permits: ${violations.map((v) => v.reason).join("; ")}.`,
      { code: "ALLOWLIST" },
    );
  }
  const leaks = assertNoRecordIds(plan);
  if (leaks.length) {
    throw new RelFlowError(
      `The staged plan carries a record id, so something may already have been written: ${leaks.join("; ")}.`,
      { code: "ID_LEAK" },
    );
  }

  if (plan.executionHeld) {
    // THE ORG IS THE AUTHORITY ON HOLDING. A staged plan that says it may not
    // execute is staged, read and reported; the room does not arm the gesture.
    return { plan, stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: null };
  }
  return { plan, stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken ?? null };
}

/** REDEEM THE TOKEN. One gesture, one write, and the org's own account of it. */
export async function executeRelPlan(
  route: RelRoute,
  approval: ExecutePayload,
  deps: RelFlowDeps = defaultRelDeps,
): Promise<ExecuteResult> {
  const out = await deps.execute(REL_FLOWS[route].actionId, approval);
  // ONCE THE CALL IS AWAY THE WRITE MAY HAVE LANDED. A domain refusal after
  // dispatch is stamped so the room stops offering the approval rather than
  // arming a retry on a burnt single-use token.
  if (!out.ok) throw fromToolError(out.error, true);
  return out.result;
}

/* -------------------------------------------------------------- the dossier */

export interface DossierRow {
  icon: IconKind;
  label: string;
  value: string;
}

/**
 * THE RESULT DOSSIER, built from the REAL result. Every row is something the
 * org reported; nothing is composed from what the room hoped would happen.
 *
 * `recordName === null` is EVIDENCE OF A FAILED VERIFICATION READ-BACK, not a
 * missing nicety (Apex builder, 2026-07-26), so it renders as the filed-
 * unverified state it is rather than behind a generic label.
 */
export function dossierRowsFor(route: RelRoute, ctx: RelContext, answers: Answers, result: ExecuteResult): DossierRow[] {
  const rows: DossierRow[] = [];
  const named = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : "filed, unverified");

  if (route === "covenant") {
    const covenants = reviewableCovenants(ctx);
    const statuses = perRecord(answers, "covenantStatuses");
    for (const id of pickedList(answers, "covenants")) {
      const cov = covenants.find((c) => c.covenantId === id);
      rows.push({ icon: "covenant", label: covenantLabel(cov ?? {}), value: String(statuses[id] ?? "assessed") });
    }
    if (result.approvalChainStarted === true) {
      rows.push({ icon: "package", label: "approval chain", value: "started" });
    }
    return rows;
  }

  if (route === "valuation") {
    const assets = valuableCollateral(ctx);
    const values = perRecord(answers, "recordValues");
    for (const id of pickedList(answers, "records")) {
      const asset = assets.find((c) => c.collateralId === id);
      const v = num(values[id]);
      rows.push({ icon: "collateral", label: collateralLabel(asset ?? {}), value: v === null ? "filed" : fmtMoney(v) });
    }
    rows.push({
      icon: "commit",
      label: "collateral value",
      value: result.collateralValueMoved === true ? "rolled up" : "unchanged",
    });
    return rows;
  }

  if (route === "versionCovenant" || route === "versionPledge") {
    return versionDossierRows(route, ctx, answers, result.items);
  }

  if (route === "intake") {
    /* THE ORG'S OWN IDS, ONE PER RECORD. `items[]` is the same wire key both
       bulk tools already answer under, and a row the org did not name reads as
       filed and unverified, which is what a failed read-back actually is. */
    return intakeDossierRows(ctx, answers, result.items);
  }

  if (route === "annual") {
    rows.push({ icon: "package", label: "credit review", value: named(result.recordName) });
    if (result.status) rows.push({ icon: "maturity", label: "status", value: result.status });
    return rows;
  }

  if (route === "rating") {
    rows.push({ icon: "commit", label: "risk-rating review", value: named(result.recordName) });
    const overridden = num(answers.overriddenRiskGradeValue);
    const proposed = num(answers.computedRiskGradeValue);
    if (proposed !== null) rows.push({ icon: "commit", label: "proposed grade", value: String(proposed) });
    if (overridden !== null) rows.push({ icon: "commit", label: "override", value: String(overridden) });
    for (const factor of RATING_FACTORS) {
      const v = num(answers[factor.key]);
      if (v === null) continue;
      /* WHICH FIGURE THE ORG ACTUALLY WEIGHS. This org put the rating on a
         template that scores cash-flow coverage and nothing else; the other
         three are stored as inputs. A dossier listing four factors with no
         distinction implies a model that does not exist here. */
      const label = factor.key === SCORED_FACTOR ? `${factor.label}, scored` : `${factor.label}, recorded`;
      rows.push({ icon: "pricing", label, value: String(v) });
    }
    return rows;
  }

  rows.push({ icon: "maturity", label: "service request", value: named(result.recordName) });
  if (result.status) rows.push({ icon: "package", label: "status", value: result.status });
  return rows;
}

/** The card's last line: the ORG'S OWN account of what it verified, where the
 *  result carries one. Never a slogan the room made up about a write it cannot
 *  see. */
export function dossierFooter(result: ExecuteResult): string {
  if (result.outcome?.trim()) return result.outcome.trim();
  return `Terminal state ${result.terminalState}.`;
}

/** What the filing did NOT do, in the org's own sentence where it has one. */
export function dossierHandoff(route: RelRoute, result: ExecuteResult): string | undefined {
  if (result.bookingHandoff?.trim()) return result.bookingHandoff.trim();
  if (route === "annual") {
    return "The review is filed, not approved. Submitting it for approval runs through the bank's own process.";
  }
  if (route === "valuation" && result.collateralValueMoved === false) {
    return "The valuation is filed and the collateral value did not move. The roll-up is bound to Salesforce's own Add Valuation button, so no coverage improvement is claimed.";
  }
  return undefined;
}

/* ------------------------------------------------------- the creation gaps

   RELATIONSHIP-LEVEL CREATES LIVE HERE (founder, 2026-08-31) — and neither of
   the two is backed by a deployed tool today. The room takes the banker to the
   proposal and then states the gap, by name, rather than composing a payload
   the org has never accepted.

   THE EVIDENCE, read from `channel/writeTools.ts`:

   COVENANT. `stage_covenant_review` accepts `productPackageId`, `covenantIds`,
   `allowNonPending` and `assessments[]`, where every assessment is anchored on
   an EXISTING `covenantId`. There is no create key of any kind. Covenant
   creation exists in exactly one place in the deployed surface —
   `stage_loan_modification`'s `covenantAddsJson` — and every covenant it
   authors is attached to the CLONE of a targeted facility on a new package
   version. That is facility-context creation by construction, so it cannot
   author a standalone Account covenant even by borrowing the shape.

   COLLATERAL. `stage_collateral_valuation` accepts `items[].collateralId` —
   assets that already exist. The create chain (asset, then the
   `LLC_BI__Account_Collateral__c` ownership junction, then the pledge) exists
   only in `stage_loan_modification`'s `pledgeAddsJson.newCollateral`, and it
   always ends in a pledge onto a facility clone. There is no path to an owned,
   UNPLEDGED asset.

   WHAT WOULD CLOSE EACH ONE is named below and reported upward, never
   improvised at the client. */
export interface CreateGap {
  /** What the banker asked for, in their words. */
  what: string;
  /** The one-line refusal the room says out loud. */
  line: string;
  /** The org-side change that would back it. Reported, never attempted. */
  orgGap: string;
}

export const CREATE_GAPS: Record<"covenant" | "collateral", CreateGap> = {
  covenant: {
    what: "a covenant authored standalone on the relationship",
    line: "The room can compose the covenant, and it cannot file it. No deployed tool authors a standalone covenant on the Account: the covenant review only assesses covenants that already exist.",
    orgGap:
      "stage_covenant_review accepts no create input. Closing this needs an account-anchored covenant create on the org side: either a covenantAdds input on stage_covenant_review that authors LLC_BI__Covenant2__c against LLC_BI__Relationship__c with no loan junction, or a stage_covenant tool of its own.",
  },
  collateral: {
    what: "a collateral asset the borrower owns, unpledged",
    line: "The room can compose the asset and its ownership, and it cannot file them. No deployed tool authors an owned but unpledged collateral record: the only create path in the org ends in a pledge onto a facility.",
    orgGap:
      "stage_collateral_valuation takes existing collateralIds only, and the newCollateral chain inside stage_loan_modification always terminates in a pledge. Closing this needs a create that stops after LLC_BI__Collateral__c plus the LLC_BI__Account_Collateral__c ownership junction, with no LLC_BI__Loan_Collateral2__c row.",
  },
};

/** Words that ask this room to CREATE the thing rather than review it. Narrow
 *  on purpose: "add a covenant" and "new collateral" are creates; "assess the
 *  covenant" and "value the collateral" are the routes themselves. */
const CREATE_COVENANT = /\b(add|create|author|new|set\s+up|put)\b[^.]{0,40}\bcovenant\b|\bcovenant\b[^.]{0,20}\b(create|add)\b/i;
const CREATE_COLLATERAL = /\b(add|create|author|new|register|record)\b[^.]{0,40}\b(collateral|asset|security)\b/i;

/** Which create the banker asked for, or null. */
export function readCreateAsk(text: string, route: RelRoute): keyof typeof CREATE_GAPS | null {
  const line = text.trim();
  if (!line) return null;
  if (route === "covenant" && CREATE_COVENANT.test(line)) return "covenant";
  if (route === "valuation" && CREATE_COLLATERAL.test(line)) return "collateral";
  return null;
}

/* -------------------------------------------------------------- availability

   THE REGISTRY IS THE MAP OF WHAT EXISTS. A route the staged data cannot
   support keeps its chip and says the registry's own reason verbatim, exactly
   as the Client Actions panel does (A27.3): hiding it would take the map away
   from the banker. */
export function routeAvailability(route: RelRoute, data: C360Data, accountId: string | null) {
  const action = ACTIONS_BY_ID[REL_FLOWS[route].actionId];
  /* THE INTAKE CARRIES NO CLIENT ACTIONS CARD, and that is deliberate rather
     than an omission. The registry is the map of what the ANALYSIS panel offers,
     and every card on it is a tile the founder's own panel renders; the intake
     is a room route whose write arm is not deployed yet, so putting a tile on
     that panel would advertise a door the org has not opened. Its availability
     is the relationship itself, which is all an account-anchored create needs.

     THE CHIP IS NEVER HIDDEN EITHER WAY (A27.3). What the registry decides is
     whether a route's chip is offered as live or shown disabled with a reason. */
  if (!action) return { available: Boolean(accountId) };
  return action.availability(data, accountId);
}
