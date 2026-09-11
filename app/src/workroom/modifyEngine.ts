import { newRequestId } from "../channel/adapter";
import { mcpAvailable, SERVERS, TOOLS, callTool, unwrapLlm } from "../channel/mcp";
import { sampleAvailable, askSession } from "../channel/sampleDoor";
import {
  executeAction,
  executionFailed,
  failureReason,
  resolveApproverUserId,
  stageAction,
  type ExecuteResult,
  type StagePayloads,
  type ToolOutcome,
} from "../channel/writeTools";
import { assertNoRecordIds, type PlanStep, type StagedOutput } from "../actions/stagedPlan";
import { packageRecords } from "../actions/schemas";
import { validatePlan } from "../actions/transitionAllowlist";
import { bookedFacilities, facilityProduct, facilityStagesStaged, shortFacilityLabel } from "../data/facilityStage";
import { fmtDate, fmtMoney } from "../data/format";
import { isActiveFacility } from "../data/worklist";
import type { BorrowerBundle, C360Data, Covenant, Facility } from "../data/contract";
import {
  holdComposed,
  readableError,
  recallComposed,
  releaseComposed,
  type PackageChoice,
  type WorkroomBrief,
  type WorkroomEngine,
  type WorkroomSuggestion,
} from "./engine";
import { runAdvisories } from "./advisory";
import {
  NO_CONNECTOR_REFUSAL,
  NO_PACKAGE_REFUSAL,
  nothingFilesRefusal,
  whyAsked,
  whyChecked,
  whyHandoff,
  whyProposed,
  whyRefused,
} from "./explain";
import { catalogSummary, chainFor, isFileable, FILING_FIELDS, type CatalogField, type WireKey } from "./fieldCatalog";
import { vocabularyFor } from "./modes";
import { deriveNextMove } from "./nextMove";
import {
  membersNamedIn,
  parseAnswer,
  parseModify,
  type Amendment,
  type AmendmentOp,
  type Awaiting,
  type ParseContext,
  type ParsedValue,
} from "./parseModify";
import { greetingFor } from "./viewer";
import type { SourceChip, WhyRow } from "./scripts";
import type {
  FiledEntry,
  HaveRow,
  IntentResult,
  PackageMember,
  StagedWorkroomPlan,
  WorkroomAcknowledgement,
  WorkroomAdvisory,
  WorkroomApproval,
  WorkroomChallenge,
  WorkroomContext,
  WorkroomDelta,
  WorkroomExecution,
  WorkroomRefusal,
} from "./types";

/* =============================================================================
   THE REAL MODIFY ENGINE.

   Same five calls as the shell engine, and not one of them is a storyline:

     brief       — the cockpit's own read of THIS package: members, covenants,
                   collateral, signals, the client's ask. No fixture.
     suggest     — moves derived from that read, spent as they are taken.
     parseIntent — the deterministic parser over the indexed field catalog. The
                   gateway LLM may RESTATE a line into the catalog's vocabulary;
                   it never authors a delta, and its restatement goes back
                   through the same parser before anything can become a chip.
     stagePlan   — ORDERED (W1). Step 1 is the credit-action clone through the
                   existing stage_loan_modification wrapper; the org's own steps
                   carry the order; amendments no tool can file are appended as
                   handoff steps and are EXCLUDED from the wire payload.
     execute     — the existing execute wrapper, behind the ConfirmGate checks:
                   allowlist, no-record-ids, org hold, and a drift recompute
                   against the figures each entry was composed on. Verified by
                   the tool's own re-query, or it does not come back.

   WHAT IT WILL NOT DO. Nine of W1's sixteen scope items have no tool at all
   (`knowledge/sf-build-v2/wiring-gap-analysis.md`). They are parsed, named,
   manifested and HANDED OFF — never filed, never faked, and never silently
   dropped. The plan counts what files; the filed scene says what did not.
   ============================================================================= */

/**
 * Raised where the room cannot honestly proceed. The shell renders the message
 * into the conversation and leaves the approval where it was.
 *
 * EXCEPT WHERE THE PLAN HAD ALREADY LEFT. `dispatched` is true when the execute
 * call reached the org before the refusal was raised — an org-side error, or a
 * transport failure on the way back. The token may be spent and the write may
 * have landed, so the approval must NOT be offered again: a live run had the
 * org succeed after 43 seconds while the room re-armed a button whose retry
 * would have bounced on the burnt single-use token. Every refusal raised BEFORE
 * the call leaves — drift, a missing approver id, a held plan — is safe to
 * retry and carries the flag false.
 */
export class WorkroomRefusalError extends Error {
  constructor(
    message: string,
    readonly dispatched = false,
  ) {
    super(message);
  }
}

const RATIONALE_PREFIX = "Modification Workroom";

/** How long the gateway assist may hold the conversation open. Past this the
 *  deterministic miss is the answer, because a room with nothing on screen is
 *  worse than a room that says it could not read the line. */
const RESTATE_TIMEOUT_MS = 12_000;

/* ------------------------------------------------------------------ figures */

const MM = (n: number) => n / 1_000_000;

function pct(part: number | undefined, whole: number | undefined): number | null {
  if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** Members of THIS package, in the read's own order. */
function packageMembers(bundle: BorrowerBundle | null, packageId: string | null): Facility[] {
  const all = (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  if (!packageId) return all;
  const on = all.filter((f) => f.productPackageId === packageId);
  // A read that does not carry package ids on its facilities is not a read of
  // an empty package: it is a read that cannot place them, and the room shows
  // what it has rather than an empty strip.
  return on.length ? on : all;
}

/**
 * EVERY PACKAGE ON THE RELATIONSHIP, with what it holds and whether it can be
 * worked on at all. Eligibility is the same rule the org enforces — a credit
 * action runs against a booked, open member — so a package whose members are all
 * still in review is offered hollow with its own stages as the reason rather
 * than silently omitted.
 */
function packageChoices(bundle: BorrowerBundle | null): PackageChoice[] {
  const facilities = (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  const booked = new Set(bookedFacilities(bundle).map((f) => f.loanId));
  return packageRecords(bundle).map((pkg) => {
    const on = facilities.filter((f) => f.productPackageId === pkg.id);
    const committed = on.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
    const canCarry = on.filter((f) => booked.has(f.loanId));
    const stages = [...new Set(on.map((f) => (f.stage ?? "").trim()).filter(Boolean))];
    return {
      id: pkg.id,
      label: pkg.label,
      figure: `${fmtMoney(committed)} committed · ${on.length} ${on.length === 1 ? "member" : "members"}`,
      eligible: canCarry.length > 0,
      reason: canCarry.length
        ? undefined
        : stages.length
          ? `All members are at ${stages.join(", ")}, and a credit action only runs against a booked one.`
          : "No member of this package carries a stage in this read, so a booked one cannot be confirmed.",
    };
  });
}

function packageCovenantRows(bundle: BorrowerBundle | null, members: Facility[]): Covenant[] {
  const covenants = bundle?.covenants?.covenants ?? [];
  const loanIds = new Set(members.map((f) => f.loanId).filter(Boolean));
  return covenants.filter((c) => {
    const attached = c.attachedLoans;
    // Absent or empty attachment is relationship level, which the package reads.
    if (!attached || !attached.length) return true;
    return attached.some((a) => a.loanId && loanIds.has(a.loanId));
  });
}

/** The org's own stage, turned into the strip's Booked / Proposal tag — and only
 *  where every member carries one. Where stages are not staged the room says
 *  "stage not staged" rather than calling an unknown member Booked (W4). */
function memberTag(f: Facility, staged: boolean): { tag: string; proposed: boolean } {
  if (!staged) return { tag: "Stage not staged", proposed: true };
  const stage = (f.stage ?? "").trim();
  if (!stage) return { tag: "Stage not staged", proposed: true };
  return { tag: stage, proposed: stage.toLowerCase() !== "booked" };
}

function toPackageMember(f: Facility, relationship: string, staged: boolean): PackageMember {
  const { tag, proposed } = memberTag(f, staged);
  const drawn = pct(f.outstanding, f.committed);
  const detail = [
    typeof f.outstanding === "number" ? `${fmtMoney(f.outstanding)} outstanding` : null,
    typeof f.interestRate === "number" ? `${f.interestRate}%` : null,
    f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : null,
    f.riskGrade ? `grade ${f.riskGrade}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // THE CHIP SAYS THE PRODUCT, and the amount beside it tells two of the same
  // product apart. nCino names a loan "<Borrower> - <Product> - <$Amount>", so
  // the full short label would print the figure twice and spend six of law 3's
  // sixty words per member. The whole name is on the member card in the peek.
  const label = facilityProduct(f, relationship);
  return {
    // The org's own loan id. Two members can share a product word, so a click
    // and a React key resolve on this and never on the label beside it.
    id: f.loanId ?? label,
    key: label,
    short: label,
    tag,
    product: facilityProduct(f, relationship),
    amount: typeof f.committed === "number" ? `$${MM(f.committed).toFixed(1)}MM` : "—",
    detail: detail || "No terms staged on this member",
    utilisation: drawn ?? undefined,
    available: typeof f.available === "number" ? `${fmtMoney(f.available)} available` : undefined,
    proposed,
  };
}

/* --------------------------------------------------------------- the deltas */

const GROUP_KIND: Record<string, string> = {
  "loan-terms": "Term change",
  "loan-other": "Term change",
  package: "Package change",
  covenant: "Covenant",
  collateral: "Security",
  party: "Borrowing structure",
  pricing: "Pricing",
  fee: "Fee",
  exception: "Policy exception",
};

/** The word the chip leads with. A REMOVAL says so first, because it is the one
 *  entry in a change set that takes something away. */
const OP_KIND: Record<string, string> = { add: "Add", remove: "Remove", change: "" };

/**
 * THE CHIP'S TITLE FOLLOWS THE OP, NOT THE CATALOG ENTRY.
 *
 * "remove James Hartwell as guarantor" matches the ADD entry — "as guarantor"
 * is one of its synonyms — and the verb makes it a removal. Printing that
 * entry's label gave a chip that read "Add a legal entity" directly above "off
 * the modification", which is the one misread in a change set that matters: a
 * banker must never sign a removal believing it was an addition.
 */
function deltaTitle(field: CatalogField, op: AmendmentOp): string {
  return op === "remove" ? field.label.replace(/^Add\b/, "Remove") : field.label;
}

function valueLabel(value: ParsedValue | null): string {
  if (!value) return "as described";
  switch (value.kind) {
    case "currency":
      return fmtMoney(value.amount);
    case "percent":
      return `${value.rate}%`;
    case "months":
      return `${value.months} months`;
    case "date":
      return fmtDate(value.iso);
    case "covenant":
    case "fee":
    case "pledge":
    case "policyException":
      return value.text;
    default:
      return value.text;
  }
}

/** What the member reads at TODAY for this field, from the live bundle. This is
 *  both the chip's "before" and the basis a drift recompute checks. */
function currentValue(field: CatalogField, facility: Facility | null): string {
  if (!facility) return "not set";
  switch (field.id) {
    case "loan.amount":
      return typeof facility.committed === "number" ? fmtMoney(facility.committed) : "not staged";
    case "loan.interestRate":
      return typeof facility.interestRate === "number" ? `${facility.interestRate}%` : "not staged";
    case "loan.maturityDate":
      return facility.maturityDate ? fmtDate(facility.maturityDate) : "not staged";
    case "loan.termMonths":
      return typeof facility.termMonths === "number" ? `${facility.termMonths} months` : "not staged in this read";
    default:
      return "today's value is not staged in this read";
  }
}

/** The term fields a banker moves to a value, and so can hold at the current
 *  one. Party / fee / pledge / exception / picklist answers are not a "keep":
 *  they add or name a thing, so a keep chip there would be nonsense. */
const SCALAR_TERM_TYPES = new Set(["currency", "percent", "months", "date"]);

/**
 * THE CHIPS UNDER A TERM QUESTION (guidance). A one-click "Keep <current>"
 * first, so the banker can leave a field alone without knowing the word for it;
 * its say rides the same keep-current parser a typed "hold" does. Then the org's
 * own picklist values, capped so a long list is not a wall of buttons.
 */
function clarifyChips(
  awaiting: Awaiting | undefined,
  options: string[] | undefined,
): Array<{ label: string; say: string }> | undefined {
  const chips: Array<{ label: string; say: string }> = [];
  if (awaiting && SCALAR_TERM_TYPES.has(awaiting.field.type)) {
    const cur = currentValue(awaiting.field, awaiting.facility);
    const known = !cur.startsWith("not ") && !cur.includes("not staged");
    chips.push({ label: known ? `Keep ${cur}` : "Keep as booked", say: "keep it" });
  }
  for (const v of (options ?? []).slice(0, 10)) chips.push({ label: v, say: v });
  return chips.length ? chips : undefined;
}

const WIRE_VALUE: Record<WireKey, (v: ParsedValue) => number | string | null> = {
  requestedAmount: (v) => (v.kind === "currency" ? v.amount : null),
  requestedRate: (v) => (v.kind === "percent" ? v.rate : null),
  requestedTermMonths: (v) => (v.kind === "months" ? v.months : null),
  requestedMaturityDate: (v) => (v.kind === "date" ? v.iso : null),
};

/** What a parsed value becomes on the FIELD WIRE. The org coerces by field type
 *  against its own describe, so what travels is the figure the banker said and
 *  never a formatted string. A covenant is a record rather than a field, and has
 *  its own wire. */
function fieldWireValue(v: ParsedValue): string | number | null {
  switch (v.kind) {
    case "currency":
      return v.amount;
    case "percent":
      return v.rate;
    case "months":
      return v.months;
    case "date":
      return v.iso;
    case "text":
      return v.text;
    default:
      return null;
  }
}

function toDelta(a: Amendment, seq: number, name: (f: Facility) => string): WorkroomDelta {
  const { field, facility, value, op } = a;
  // A FEE, AN ASSET AND AN EXCEPTION NAME THEMSELVES. The catalog entries are
  // called "Facility fee", "Collateral pledge" and "Policy exception", which are
  // the categories rather than the things: a chip reading "Policy exception →
  // mitigated by the personal guaranty" says the category and buries WHAT IS OUT
  // OF POLICY, which is the whole point of the record. The banker's own words
  // are the better title, and the category is already on the badge.
  const title =
    op === "add" && (value?.kind === "fee" || value?.kind === "pledge")
      ? value.noun
      : op === "add" && value?.kind === "policyException"
        ? value.title
        : deltaTitle(field, op);
  // The handoff badge leads with the op, so a title that already carries the
  // word must not say it twice ("Remove remove a legal entity").
  const noun = title.replace(/^(?:Add|Remove)\s+/, "");
  // THE TARGET IS A DISPLAY NAME, and it has to be, because the org names a loan
  // `<Borrower> - <Product> - <$Amount>`: using it here printed the member's
  // CURRENT commitment on the chip directly above "$15M → $20M", which is a live
  // figure sitting where a delta belongs. Nothing that resolves a record reads
  // this — the wire carries `facility.loanId`.
  const target = facility
    ? name(facility)
    : field.category === "party"
      ? (a.party ?? "the borrowing structure")
      : "the product package";
  // AGAINST THE ROLL-OVER BASELINE. The clone carries the parent's whole record
  // graph, so an ADD starts from "not on the facility" and a REMOVE ends there;
  // only a change has two values to show.
  const after = op === "remove" ? "off the modification" : valueLabel(value);
  const before =
    op === "add"
      ? "not on the facility today"
      : field.category === "party" || field.category === "fee" || field.type === "record"
        ? "carried over from the parent"
        : currentValue(field, facility);

  const fileable = isFileable(field) && facility?.loanId !== undefined && value !== null;
  const wire =
    fileable && field.wireKey && value
      ? (() => {
          const v = WIRE_VALUE[field.wireKey!](value);
          return v === null ? undefined : { key: field.wireKey!, value: v, facilityId: facility!.loanId! };
        })()
      : undefined;
  // A net-new covenant files as a structured record: the resolved catalog type,
  // the threshold and the operator, targeted at THIS member — the org attaches
  // it to the member's CLONE on the new package version.
  const covenantWire =
    fileable && field.recordWire === "covenantAdd" && value?.kind === "covenant"
      ? {
          typeName: value.typeName,
          threshold: value.threshold,
          operator: value.operator,
          frequency: "Quarterly",
          facilityId: facility!.loanId!,
        }
      : undefined;
  // A borrowing-structure change files when the line named the member (the org
  // anchors every involvement row on one loan) and, for an add, the role. A
  // remove needs no role: the org resolves the exact row at stage time and
  // refuses ambiguity.
  const involvementWire =
    field.recordWire === "involvementChange" && facility?.loanId !== undefined && a.party &&
    (op === "remove" || a.role)
      ? {
          op: op === "remove" ? ("remove" as const) : ("add" as const),
          role: a.role,
          accountName: a.party,
          ownership: a.ownership,
          facilityId: facility.loanId,
        }
      : undefined;
  // A NET-NEW FEE files as a structured record on the member's CLONE. The org's
  // fee-type picklist is residential, so `feeType` is always a value the org
  // holds and `description` is where the banker's own words go — `Name` on a fee
  // is an autonumber and cannot carry them. A percentage fee sends NO amount:
  // the org's FeeTrigger derives it from the clone's commitment.
  const feeWire =
    field.recordWire === "feeAdd" && op === "add" && facility?.loanId !== undefined && value?.kind === "fee"
      ? {
          feeType: value.feeType,
          description: value.description,
          calculationType: value.calculationType,
          percentage: value.percentage,
          amount: value.amount,
          recordType: value.recordType,
          facilityId: facility.loanId,
        }
      : undefined;
  // A COLLATERAL PLEDGE files as a structured record on the member's CLONE, in
  // one of its two shapes. An EXISTING asset travels as the org's own collateral
  // id — resolved off the deal's own pledges, never as a name the org would have
  // to guess at. A NET-NEW one travels as its shape and the arm authors the
  // whole chain: `LLC_BI__Collateral__c` has no account lookup, so the borrower
  // link is the `LLC_BI__Account_Collateral__c` junction, and only then the
  // pledge. `advanceRate` is the OVERRIDE on the pledge; the plain advance rate
  // is a formula the org resolves from the override, the auto-applied value and
  // the collateral type's default, in that order.
  const pledgeWire =
    field.recordWire === "pledgeAdd" && op === "add" && facility?.loanId !== undefined && value?.kind === "pledge"
      ? {
          collateralId: value.collateralId,
          newCollateral: value.create
            ? { description: value.create.description, collateralType: value.create.collateralType, value: value.create.value }
            : undefined,
          advanceRate: value.create?.advanceRate,
          facilityId: facility.loanId,
        }
      : undefined;
  // A POLICY EXCEPTION files as a structured record on the member's CLONE and
  // anchored on the borrower — the two anchors together are what make it visible
  // both on the facility and at relationship level, which is where a credit
  // officer looks for the bank's exceptions. The title, the status and the
  // mitigants ride ONE entry because they are one record.
  const policyExceptionWire =
    field.recordWire === "policyExceptionAdd" && op === "add" && facility?.loanId !== undefined &&
    value?.kind === "policyException"
      ? {
          title: value.title,
          status: value.status,
          reasons: value.reasons,
          severity: value.severity,
          facilityId: facility.loanId,
        }
      : undefined;
  // A CURATED LOAN FIELD files through fieldChangesJson: the room sends the API
  // name and the typed value, and the ORG resolves the name against its own live
  // describe at stage time — updateable, non-formula, off the deny-list — then
  // coerces by type and refuses an illegal picklist value with the legal list.
  // The name travels because the describe checks it, not because this file is
  // sure of it.
  const fieldWire =
    fileable && field.dynamicField && value
      ? (() => {
          const v = fieldWireValue(value);
          return v === null
            ? undefined
            : {
                field: field.dynamicField!,
                label: field.label,
                value: v,
                display: valueLabel(value),
                facilityId: facility!.loanId!,
              };
        })()
      : undefined;

  const committedDeltaMM =
    wire?.key === "requestedAmount" && typeof facility?.committed === "number" && typeof wire.value === "number"
      ? MM(wire.value - facility.committed)
      : undefined;

  /** Whether ANY wave carries this entry to the org. Read as a single fact here
   *  because every wave added since has had to be threaded through the same
   *  eight places, and one of them being missed is a chip that reads as filed
   *  and travels as a handoff. */
  const files = Boolean(
    wire || covenantWire || involvementWire || fieldWire || feeWire || pledgeWire || policyExceptionWire,
  );

  /* WHAT THE ORG ACTUALLY RECORDS, in its own words. One branch per wave, in
     the order the waves shipped, and the fall-through is the honest "nothing".
     A chain of nested ternaries got this to six deep and unreadable, which is
     the state a seventh wave must not add to: the one thing this line has to be
     is checkable against what the arm really writes. */
  const writtenAs = (): string => {
    if (wire) return `${field.apiName} on the modification clone. The booked facility is untouched.`;
    if (fieldWire) {
      return `${fieldWire.field} on the modification clone, resolved against the org's live describe. The booked facility is untouched.`;
    }
    if (covenantWire) {
      return "LLC_BI__Covenant2__c created Pending/Active on the borrower, LLC_BI__Loan_Covenant__c junction attached to the CLONE on the new package version. No compliance row is minted and no approval starts.";
    }
    if (involvementWire) {
      return involvementWire.op === "add"
        ? "LLC_BI__Legal_Entities__c authored on the CLONE with the new package anchor, under the guard's five-role birth state."
        : "A CARRY EXCLUSION: the named row never travels to the new version. The booked facility keeps it; nothing is deleted anywhere.";
    }
    if (feeWire) {
      return feeWire.calculationType === "Percentage"
        ? `LLC_BI__Fee__c created on the CLONE as a Percentage fee: ${feeWire.percentage}% against LLC_BI__Amount__c. The org's own FeeTrigger computes the basis and the money from the clone's commitment; this room sets no figure.`
        : "LLC_BI__Fee__c created on the CLONE as a Flat Amount fee. The label rides LLC_BI__Fee_Type_Description__c, because Name on a fee is an autonumber.";
    }
    if (pledgeWire) {
      return pledgeWire.newCollateral
        ? `LLC_BI__Collateral__c created, LLC_BI__Account_Collateral__c recording the borrower's ownership (the asset has no account lookup of its own), then LLC_BI__Loan_Collateral2__c pledging it to the CLONE at ${pledgeWire.advanceRate}% as an override with its reason. The booked facility keeps exactly the security it has today.`
        : "LLC_BI__Loan_Collateral2__c pledging the borrower's existing asset to the CLONE, beside the pledges the carry replicates. The booked facility keeps exactly the security it has today.";
    }
    if (policyExceptionWire) {
      // THE EGRESS BELONGS ON THE CHIP. Every committed write to this object
      // fires the org's own PolicyExceptionCDC trigger, which POSTs the whole
      // serialised record to an AWS endpoint. It is not an approval and not an
      // email, but it is the borrower's data leaving the org, and a banker
      // confirming this chip is the person entitled to know.
      return (
        `LLC_BI__Policy_Exception__c created against the CLONE (LLC_BI__Loan__c) and the borrower (LLC_BI__Relationship__c), ` +
        `LLC_BI__Type__c "Policy" like every row this org holds, LLC_BI__Status__c ${policyExceptionWire.status}` +
        (policyExceptionWire.reasons.length
          ? `, ${policyExceptionWire.reasons.length} mitigant${policyExceptionWire.reasons.length === 1 ? "" : "s"} on LLC_BI__Mitigation_Reason_1..3__c`
          : "") +
        ". The booked facility carries no exception of its own. Note: a committed write here fires the org's PolicyExceptionCDC trigger, which POSTs the record to the bank's EventBridge endpoint."
      );
    }
    return "Nothing. No tool files this today; it travels as a handoff on the filed summary.";
  };

  /** How the write is proved, per wave. Same shape and same reason as above. */
  const verification = (): string => {
    if (wire || fieldWire) return "Re-queried on the clone after the write";
    if (covenantWire) return "Covenant and junction re-queried on the clone after creation";
    if (feeWire) return "Fee re-queried on the clone after creation, with the figure the org computed";
    if (pledgeWire) return "Pledge re-queried on the clone after creation, with the lendable value the org derived";
    if (policyExceptionWire) {
      return "Exception re-queried on the clone after creation, with the name, status and mitigants the org holds";
    }
    if (involvementWire) {
      return involvementWire.op === "add"
        ? "Involvement re-queried on the clone after creation"
        : "Proven by absence on the clone and presence on the parent";
    }
    return "Handed off — nothing was written";
  };

  return {
    id: `${field.id}:${facility?.loanId ?? a.party ?? "package"}:${seq}`,
    group: field.group,
    op,
    kind: [OP_KIND[op], GROUP_KIND[field.category] ?? "Change"].filter(Boolean).join(" "),
    // A removal is the destructive one, and it carries the refusal tone whether
    // or not a tool files it: the banker must never mistake it for an addition.
    kindTone: op === "remove" ? "refusal" : files ? undefined : "refusal",
    badge: files ? `${title} → ${after}` : `${OP_KIND[op] || "Change"} ${noun.toLowerCase()} · handed off`,
    title,
    target,
    before,
    after,
    member: facility?.loanId,
    committedDeltaMM,
    map: [
      ["Object", field.object],
      ["Field", field.apiName ?? "not established on this org — a live describe supplies it"],
      ["Written as", writtenAs()],
    ],
    fields: field.apiName ? [`${field.object}.${field.apiName}`] : [field.object],
    caveat: files ? undefined : field.gap,
    filed: {
      recordId:
        wire || covenantWire || fieldWire || feeWire || pledgeWire || policyExceptionWire ||
        involvementWire?.op === "add"
          ? "assigned by the org on execution"
          : involvementWire
            ? "a carry exclusion writes nothing"
            : "not filed",
      verification: verification(),
    },
    fileable: files,
    wire,
    covenantWire,
    involvementWire,
    fieldWire,
    feeWire,
    pledgeWire,
    policyExceptionWire,
    // Only a FILEABLE entry carries a basis: drift is the check that a figure
    // reaching the org has not moved, and a handoff sends no figure.
    basis: wire && facility?.loanId ? { facilityId: facility.loanId, fieldId: field.id, before } : undefined,
    handoff: files ? undefined : { reason: field.gap ?? "No tool files this today.", closes: field.closes },
    // The chain a create must carry. Held on the delta so the plan cannot be
    // composed without it: a create with no junctions never becomes steps.
    chainLinks: op === "add" ? chainFor(field) : undefined,
  };
}

/** Whether ANY wave carries this delta to the org. ONE definition, because the
 *  list of waves is now seven long and it was written out at three call sites:
 *  a wave missed at one of them is a chip that reads as filed and travels as a
 *  handoff, which is the exact failure `files` above exists to prevent. */
function carriesWire(d: WorkroomDelta): boolean {
  return Boolean(
    d.wire || d.covenantWire || d.involvementWire || d.fieldWire || d.feeWire || d.pledgeWire || d.policyExceptionWire,
  );
}

/** The member a fileable delta lands on. Every wire anchors on exactly one, and
 *  which wire carries it is the delta's own business rather than the caller's. */
function wireTarget(d: WorkroomDelta): string | undefined {
  return (
    d.wire?.facilityId ??
    d.covenantWire?.facilityId ??
    d.involvementWire?.facilityId ??
    d.fieldWire?.facilityId ??
    d.feeWire?.facilityId ??
    d.pledgeWire?.facilityId ??
    d.policyExceptionWire?.facilityId
  );
}

/* ------------------------------------------------------------- the refusals */

/** Asks that are real, understood, and NOT this room's to file — each with the
 *  org's own reason. A refusal is an answer; a fabricated chip is not. */
function refusalFor(field: CatalogField): WorkroomRefusal | null {
  const title =
    field.id === "covenant.complianceStatus" || field.id === "collateral.valuation"
      ? `${field.label} is its own credit action`
      : field.id === "loan.stage" || field.id === "package.stage"
        ? "Booking is nCino's own approval run"
        : null;
  if (!title) return null;
  const why = whyRefused(field.id);
  return {
    id: field.id,
    target: field.label,
    title,
    reason: field.gap ?? "",
    why,
    // The banker's reading first, then the org's own account of its constraint.
    detail: [why, field.gap, field.closes].filter(Boolean).join(" "),
  };
}

/* ---------------------------------------------------------------- the engine */

export interface ModifyEngineDeps {
  stage?: (payload: StagePayloads["loan-modification"]) => Promise<ToolOutcome<StagedOutput>>;
  execute?: (payload: {
    idempotencyKey: string;
    stagingId: string;
    planHash: string;
    decisionToken: string;
    approverUserId: string;
  }) => Promise<ToolOutcome<ExecuteResult>>;
  /** Restates a line in the catalog's vocabulary. Never authors a delta. */
  restate?: (line: string, vocabulary: string[]) => Promise<string | null>;
  available?: () => boolean;
  newKey?: () => string;
  /** Today, as an ISO date. The advisory rule about maturities compares against
   *  it, and a rule whose answer depends on the machine's clock is a rule that
   *  cannot be tested. */
  today?: () => string;
}

const defaultDeps: Required<Omit<ModifyEngineDeps, "restate">> & Pick<ModifyEngineDeps, "restate"> = {
  stage: (payload) => stageAction("loan-modification", payload),
  execute: (payload) => executeAction("loan-modification", payload),
  available: mcpAvailable,
  newKey: newRequestId,
  today: () => new Date().toISOString().slice(0, 10),
  restate: async (line, vocabulary) => {
    // ONE call, lean payload, and the answer is a SENTENCE rather than a
    // structure: the artifact-to-connector bridge burns on machine-shaped
    // payloads (structured tripped at ask 2, prose lasted 15), and a
    // restatement goes back through the deterministic parser anyway.
    const prompt =
      "Rewrite this banker instruction using only these amendment words, keeping every number, name and date exactly as written. " +
      "Reply with the rewritten instruction and nothing else. If it is not an amendment to a loan or a package, reply NONE.\n" +
      `Words: ${vocabulary.join(", ")}\nInstruction: ${line}`;
    const clean = (t: string): string | null => (!t || /^none$/i.test(t) ? null : t);
    // THE SESSION DOOR FIRST (the recorded decision, channel/sampleDoor.ts): the
    // banker's own Claude, fast and needing NO connector. Where it is in the view
    // and answers, the gateway beneath it is never reached — which is why the
    // assist is quick and why a phrasing the deterministic parser missed no
    // longer raises an IDB Gateway consent prompt mid-modification.
    if (sampleAvailable()) {
      try {
        const text = await Promise.race([
          askSession(prompt, { tier: "quick" }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the session did not answer in time")), RESTATE_TIMEOUT_MS)),
        ]);
        return clean(text.trim());
      } catch {
        // Absence, never an error on the glass: take the next rung down.
      }
    }
    try {
      // A GATEWAY THAT NEVER ANSWERS IS SILENCE, and silence is the one thing
      // this room may not do. The deterministic parse has already missed, so
      // this call is the assist and not the answer: it gets a bounded slice of
      // the banker's attention and then the honest miss is returned. Without
      // the bound a read retry can hold the conversation open indefinitely with
      // nothing on screen, which is a wired-only failure the headless run cannot
      // reach and the live one did.
      const res = await Promise.race([
        callTool(SERVERS.gateway, TOOLS.llm, { prompt }, { read: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the gateway did not answer in time")), RESTATE_TIMEOUT_MS)),
      ]);
      return clean(unwrapLlm(res.payload).text.trim());
    } catch {
      // A gateway that is down is not a parse failure the banker should read as
      // one: the deterministic path already answered, and this was the assist.
      return null;
    }
  },
};

export function createModifyEngine(args: {
  context: WorkroomContext;
  data: C360Data;
  bundle: BorrowerBundle | null;
  deps?: ModifyEngineDeps;
}): WorkroomEngine {
  const { context, data, bundle } = args;
  const deps = { ...defaultDeps, ...args.deps };
  const vocabulary = vocabularyFor(context);

  const relationship = (bundle?.snapshot?.name ?? context.accountName ?? "").trim();

  /* ------------------------------------------------------ the anchor

     ONE SESSION IS ONE PACKAGE (founder, 2026-08-27). The credit action anchors
     on one product package and that anchor is the governance boundary, so a
     relationship carrying more than one CHOOSES instead of defaulting to
     whichever the read listed first. Until it is chosen the room holds: no
     members, no suggestion, no plan — a blurred strip would be the first step
     toward a manifest no single approval could honestly cover.               */

  const choices = packageChoices(bundle);
  const unanchored = !context.productPackageId && choices.length > 1;

  const members = unanchored ? [] : packageMembers(bundle, context.productPackageId);
  const stagesStaged = facilityStagesStaged(bundle);
  const booked = bookedFacilities(bundle).filter((f) => members.some((m) => m.loanId === f.loanId));
  const covenants = packageCovenantRows(bundle, members);
  const entities = (bundle?.graph?.legalEntities ?? []).filter(
    (e) => !context.productPackageId || !e.packageId || e.packageId === context.productPackageId,
  );
  const committed = members.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
  // The SAME population `committed` sums — every member, not just the booked
  // ones — so the utilization tier of `deriveNextMove` divides two figures
  // that were always meant to be read together.
  const outstanding = members.reduce((sum, f) => sum + (typeof f.outstanding === "number" ? f.outstanding : 0), 0);
  const request = (bundle?.requests ?? [])[0];

  /**
   * THE MEMBER, NAMED FOR A SENTENCE.
   *
   * The org's loan name carries that member's current commitment inside it, so
   * putting it in prose or on a chip prints a live figure everywhere the member
   * is mentioned — including directly beside the delta that is about to move it.
   * The PRODUCT is the name. The amount comes back only where the package holds
   * two of the same product and the figure is the thing that tells them apart.
   */
  function memberName(f: Facility): string {
    const product = facilityProduct(f, relationship);
    const twins = members.filter((m) => facilityProduct(m, relationship) === product).length > 1;
    return twins && typeof f.committed === "number" ? `${product} (${fmtMoney(f.committed)})` : product;
  }

  /** The member the banker picked off the strip. A default for a line that names
   *  none; never an override for one that does. */
  let focus: Facility | null = null;
  /**
   * WHO THE PARSE ALREADY KNOWS ABOUT.
   *
   * `entities` above is the org's OWN involvement set — `graph.legalEntities` is
   * the read of LLC_BI__Legal_Entities__c — so it carries every guarantor,
   * co-borrower and related entity on the package, not just the borrower.
   * Verified against the live read and the sample bundle: both return the
   * guarantor rows. So the name lookup in `readParty` is already as wide as the
   * data goes, and a name it misses is a name the ORG does not hold.
   *
   * `graph.connections` — the household around the deal — deliberately does NOT
   * join it. Those counterparties are related to the relationship and NOT on the
   * package, and `entities` is what the advisories read to decide whether a party
   * is already involved. Widening it there would make every add of a subsidiary
   * report itself as a duplicate involvement. An unknown name needs no lookup
   * anyway: adding somebody who is not on the deal yet is exactly the ask, and
   * the parse keeps their name verbatim.
   */
  const parseContext = (): ParseContext => ({ facilities: members, booked, relationship, entities, focus });

  const suggestions = buildSuggestions();
  let suggestionIndex = 0;
  /** TRUE while the room is waiting on an answer to its own question. Offering an
   *  unrelated next move under a pending question is what made the pill jump to
   *  a covenant while the room was asking for a commitment figure. */
  let asked = false;
  let staged: StagedWorkroomPlan | null = null;
  let stagedDeltas: WorkroomDelta[] = [];
  /** What this package was left composing when the room last closed. Read once,
   *  at construction: the room asks for it and starts on it. */
  const held = recallComposed(context.mode, context.productPackageId);
  /** The stage key, reused by the execute pair — that pairing is what the proven
   *  round trip used, and what makes a replay idempotent rather than a double.
   *  It survives a close with the manifest, so reopening and approving files ONE
   *  credit action, replayed, rather than a second one beside the first. */
  let idempotencyKey: string | null = held.idempotencyKey;
  const spent = new Set<string>();

  /* ------------------------------------------------------------ suggestions */

  function askFacility(): Facility | null {
    const name = request?.ask?.facilityName?.toLowerCase();
    if (name) {
      const hit = members.find((f) => (f.name ?? "").toLowerCase().includes(name));
      if (hit) return hit;
    }
    const from = request?.ask?.from;
    if (typeof from === "number") {
      const matches = members.filter((f) => f.committed === from);
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  function buildSuggestions(): WorkroomSuggestion[] {
    // NOTHING TO SUGGEST UNTIL THE ROOM IS ANCHORED. A move offered across two
    // packages is a move that cannot be staged.
    if (unanchored) return [];
    const out: WorkroomSuggestion[] = [];
    const target = askFacility() ?? booked[0] ?? null;

    /* A CURRENT FIGURE MUST NEVER SIT WHERE A DELTA BELONGS (founder, live UAT).
       nCino's loan name carries the member's COMMITTED amount, so a pill built
       on the full label read "Increase the Line of Credit - $15,000,000.00" —
       which parses in a banker's head as "increase BY fifteen million", and made
       the room's next question ("what should it become?") look like it was
       asking twice for a number it had already offered. So the pill names the
       PRODUCT, states the current figure as context where there is no target,
       and prints a figure in the delta position only when that figure is a real
       target the client actually asked for. */
    if (target) {
      // The SAY is scoped on the member's full org name, which is the only
      // string that resolves one member out of six. The LABEL never carries it.
      const identity = shortFacilityLabel(target, relationship);
      const product = facilityProduct(target, relationship);
      out.push(
        request?.ask?.to
          ? // The client's own number. This one IS a delta, so it reads as one.
            { label: `Take the ${product} to ${fmtMoney(request.ask.to)}`, say: `increase the ${identity} to ${request.ask.to}` }
          : // NO ASK, NO FIGURE. The room will not invent a target commitment to
            // make a pill clickable: the label states what the member reads
            // today, the parse asks what it should become, and the banker's
            // answer is the number.
            {
              label: `${product}${typeof target.committed === "number" ? ` · ${fmtMoney(target.committed)} committed` : ""}`,
              say: `change the commitment on the ${identity}`,
            },
      );
    }

    // 2. THE THINNEST COVENANT, where one is staged. It composes as a covenant
    //    amendment, which this room manifests and hands off honestly.
    const thin = covenants
      .filter((c) => typeof c.thresholdValue === "number" && typeof c.actualValue === "number")
      .sort((a, b) => Math.abs((a.actualValue ?? 0) - (a.thresholdValue ?? 0)) - Math.abs((b.actualValue ?? 0) - (b.thresholdValue ?? 0)))[0];
    if (thin?.covenantType) {
      const line = `Add a covenant on the ${thin.covenantType.toLowerCase()} test`;
      out.push({ label: line, say: line });
    }

    // 3. THE BORROWING STRUCTURE, FROM THE HOUSEHOLD FIRST (founder directive
    //    2026-08-27). W1 asks for add/remove of legal entities, and the entity
    //    a banker means is almost always one already around the relationship —
    //    a related company in the ownership graph, or a guarantor on another
    //    member. An unrelated entity is the explicit alternative, not the
    //    default, so the room offers the household and says the other door is
    //    open rather than asking an open question.
    const related = household().find((h) => !h.onDeal);
    const guarantor = entities.find((e) => (e.borrowerType ?? "").toLowerCase().includes("guarantor"));
    const name = related?.name ?? guarantor?.accountName;
    if (name) {
      const line = `Add ${name} as a guarantor`;
      out.push({ label: line, say: line });
    }

    return out;
  }

  /* ------------------------------------------------------------------ brief */

  function haveRows(): HaveRow[] {
    const rows: HaveRow[] = [
      {
        label: "Package position",
        value: `${members.length} ${members.length === 1 ? "member" : "members"} · ${fmtMoney(committed)} committed`,
        detail: [
          bundle?.snapshot?.packageStage ? `Stage ${bundle.snapshot.packageStage}` : null,
          bundle?.snapshot?.primaryRiskRating ? `risk rating ${bundle.snapshot.primaryRiskRating}` : null,
          `${booked.length} of ${members.length} booked, which is what a credit action requires`,
          stagesStaged ? null : "Facility stages are not staged in this read, so booked cannot be confirmed on every member",
        ]
          .filter(Boolean)
          .join(" · "),
      },
    ];

    if (covenants.length) {
      const compliant = covenants.filter((c) => (c.latestComplianceStatus ?? c.covenantStatus ?? "").toLowerCase() === "compliant");
      rows.push({
        label: "Covenants",
        value: `${covenants.length} on the package · ${compliant.length} compliant`,
        detail:
          covenants
            .slice(0, 4)
            .map((c) => `${c.covenantType ?? "covenant"} ${c.actualValue ?? "?"} against ${c.thresholdValue ?? "?"}`)
            .join("; ") || "No thresholds staged",
      });
    }

    const lendable = bundle?.exposure?.totalUniqueCollateralLendableValue;
    if (typeof lendable === "number") {
      rows.push({
        label: "Collateral pool",
        value: `${fmtMoney(lendable)} lendable`,
        detail: `Across ${bundle?.exposure?.uniqueCollateralCount ?? "an unstated number of"} distinct collateral records. Coverage is the org's own computation over the distinct pool, never a sum of facility shares.`,
      });
    }

    const maturing = members.filter((f) => f.maturityDate).sort((a, b) => (a.maturityDate! < b.maturityDate! ? -1 : 1));
    if (maturing.length) {
      rows.push({
        label: "Maturities",
        value: `Next ${fmtDate(maturing[0].maturityDate)}`,
        detail: maturing
          .slice(0, 4)
          .map((f) => `${shortFacilityLabel(f, relationship)} ${fmtDate(f.maturityDate)}`)
          .join("; "),
      });
    }

    if (entities.length) {
      const roles = entities.reduce<Record<string, number>>((acc, e) => {
        const role = e.borrowerType ?? "Unstated role";
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
      }, {});
      rows.push({
        label: "Borrowing structure",
        value: `${entities.length} involvement ${entities.length === 1 ? "row" : "rows"}`,
        detail: Object.entries(roles)
          .map(([role, n]) => `${role} ×${n}`)
          .join("; "),
      });
    }

    rows.push(...rollOverRows());
    return rows;
  }

  /* ------------------------------------------------------- roll-over baseline

     A modification does not start from nothing, and it never versions a loan
     alone. nCino package methodology: the credit action rolls the WHOLE package
     into a new version — every Booked/Open member is cloned, the touched one
     takes the changes, the rest carry unchanged, and each clone's record graph
     (covenant junctions, collateral pledges, borrowing structure) is carried by
     the same governed run. Every amendment is a delta against that, so the room
     has to show it, and it has to be honest about the halves it cannot read.  */

  function rollOverRows(): HaveRow[] {
    const target = askFacility() ?? booked[0] ?? null;
    if (!target) return [];
    const name = shortFacilityLabel(target, relationship) || "the facility";
    const junctions = target.loanCovenants ?? [];
    const pledges = target.collateral ?? [];
    const parties = entities.filter((e) => !e.loanId || e.loanId === target.loanId);
    const stayBehind = members.filter((m) => !booked.some((b) => b.loanId === m.loanId));

    const rows: HaveRow[] = [
      {
        label: "How the package versions",
        value:
          `${booked.length} ${booked.length === 1 ? "member rolls" : "members roll"} into the new package` +
          (stayBehind.length
            ? ` · ${stayBehind.length} ${stayBehind.length === 1 ? "stays" : "stay"} on the current version`
            : ""),
        detail:
          "nCino package methodology: a modification versions the whole package, never a loan alone. Every Booked/Open member is cloned onto the new version with its junction graph; only the selected member takes the requested changes. " +
          (stayBehind.length
            ? `${stayBehind.map((m) => shortFacilityLabel(m, relationship) || m.loanId).join(", ")} is not Booked/Open and stays behind, named rather than silently skipped.`
            : "Every member of this package is eligible to roll."),
      },
      {
        label: `What ${name} carries onto its clone`,
        value: [
          `${junctions.length} covenant ${junctions.length === 1 ? "junction" : "junctions"}`,
          `${pledges.length} ${pledges.length === 1 ? "pledge" : "pledges"}`,
          `${parties.length} involvement ${parties.length === 1 ? "row" : "rows"}`,
        ].join(" · "),
        detail:
          "The version roll clones the facility and the same governed run carries this graph onto the clone, verified by count. Everything here is KEPT unless the manifest says otherwise, which is why a removal is a change like any other and reads as one.",
      },
    ];

    if (junctions.length) {
      rows.push({
        label: "Covenants on the facility",
        value: junctions.map((j) => j.covenantType ?? j.name ?? "covenant").join(", "),
        detail: "Loan-level junctions. The carry replicates the junction, not the covenant, and nCino's own guidance says a business process must decide what happens to each one.",
      });
    }
    if (pledges.length) {
      rows.push({
        label: "Pledged to the facility",
        value: pledges
          .map((c) => `${c.collateralName ?? c.collateralType ?? "collateral"}${typeof c.amountPledged === "number" ? ` ${fmtMoney(c.amountPledged)}` : ""}`)
          .join(", "),
        detail: pledges
          .map((c) =>
            [
              c.collateralName,
              typeof c.advanceRate === "number" ? `${c.advanceRate}% advance` : null,
              c.lienPosition ? `${c.lienPosition} lien` : null,
              c.pledgedStatus,
            ]
              .filter(Boolean)
              .join(" · "),
          )
          .join("; "),
      });
    }
    if (parties.length) {
      rows.push({
        label: "Who is on the facility",
        value: parties.map((e) => `${e.accountName ?? "entity"} (${e.borrowerType ?? "role unstated"})`).join(", "),
        detail:
          "The borrowing structure rolls onto the clone. Adding or removing an entity is a change against THIS list, and the household below is where a new one usually comes from.",
      });
    }

    // THE TWO HALVES NO READ COVERS. Saying "0 fees" would be a claim the
    // cockpit cannot make: the six detail reads fetch neither fees nor pricing
    // streams, so the room says it cannot see them rather than that they are
    // not there.
    rows.push({
      label: "Not in this read",
      value: "Fees and pricing streams",
      detail:
        "The cockpit's six detail reads carry no fee rows and no pricing streams, so what the clone would carry on those two is not shown here. The org's own credit action carries both onto the new version and counts them back; a fee this room ADDS is named on its own manifest entry.",
    });

    return rows;
  }

  /** THE HOUSEHOLD. Who is already around this relationship — the entities on
   *  the deal and the ownership graph behind it — because a borrower a banker
   *  adds is almost always one of them. */
  function household(): Array<{ name: string; role: string; onDeal: boolean }> {
    const onDeal = new Map<string, string>();
    for (const e of entities) {
      const name = (e.accountName ?? "").trim();
      if (name) onDeal.set(name, e.borrowerType ?? "on the deal");
    }
    const out = [...onDeal].map(([name, role]) => ({ name, role, onDeal: true }));
    for (const c of bundle?.graph?.connections ?? []) {
      const name = (c.counterpartyName ?? "").trim();
      if (!name || onDeal.has(name)) continue;
      out.push({
        name,
        role: [c.role, typeof c.ownershipPercent === "number" ? `${c.ownershipPercent}%` : null].filter(Boolean).join(" · ") || "related",
        onDeal: false,
      });
    }
    return out;
  }

  function sources(): SourceChip[] {
    const have = haveRows();
    const pick = (label: string) => have.filter((r) => r.label === label);
    const out: SourceChip[] = [
      { id: "package", label: "Package", kicker: "What the package holds today", icon: "package", have: pick("Package position") },
    ];
    if (pick("Covenants").length) out.push({ id: "covenants", label: "Covenants", kicker: "Covenants on this package", icon: "covenants", have: pick("Covenants") });
    if (pick("Collateral pool").length) out.push({ id: "collateral", label: "Collateral", kicker: "The collateral pool", icon: "collateral", have: pick("Collateral pool") });
    if (pick("Maturities").length) out.push({ id: "maturities", label: "Maturities", kicker: "What matures next", icon: "calendar", have: pick("Maturities") });
    if (pick("Borrowing structure").length) out.push({ id: "entities", label: "Entities", kicker: "Who is on the deal", icon: "account", have: pick("Borrowing structure") });
    if (request) {
      out.push({
        id: "email",
        label: "Client request",
        kicker: `Received ${fmtDate(request.receivedAt) || "recently"}`,
        icon: "email",
        have: [
          {
            label: request.channel ? `Client request · ${request.channel}` : "Client request",
            value: request.ask?.to ? `${fmtMoney(request.ask.from)} → ${fmtMoney(request.ask.to)}` : (request.status ?? "open"),
            detail: request.summary ?? "No summary staged on the request.",
          },
        ],
      });
    }
    return out;
  }

  function why(): WhyRow[] {
    const rows: WhyRow[] = [
      {
        label: "The package",
        detail: `${members.length} ${members.length === 1 ? "member" : "members"}, ${fmtMoney(committed)} committed, ${booked.length} booked. A modification runs against a booked facility; anything else the org refuses outright.`,
      },
    ];
    const drawn = bundle?.exposure?.totalOutstanding;
    if (typeof drawn === "number") {
      rows.push({
        label: "Drawn",
        detail: `${fmtMoney(drawn)} outstanding across the relationship${pct(drawn, committed) !== null ? `, ${pct(drawn, committed)}% of the committed total` : ""}.`,
      });
    }
    if (typeof bundle?.exposure?.coverageRatio === "number") {
      rows.push({
        label: "Collateral coverage",
        detail: `${bundle.exposure.coverageRatio.toFixed(2)}x, computed by the org over the distinct collateral pool. The cockpit never re-derives it from the facility rows.`,
      });
    }
    const summary = catalogSummary();
    rows.push({
      label: "What this room can file",
      detail: `${FILING_FIELDS.length} of ${summary.total} indexed amendments file through stage_loan_modification — the four terms, the field wave, net-new covenants on the borrower, borrowing-structure changes, net-new fees, collateral pledges and policy exceptions, all landing on the clone — and the live-describe index proposes the loan's remaining writable fields on demand. What no wave carries is staged into the manifest and handed off with the reason.`,
    });
    return rows;
  }

  /**
   * THE ONE SENTENCE, AT PACKAGE ALTITUDE (law 1, applied to the conversation).
   *
   * The founder's reading of this room: the product package total is what
   * counts, the members are where the money sits, and it rolls up. So the
   * opening sentence leads on how much of the PACKAGE is open to work and the
   * members are the mechanism, not the story. The shell prefixes the greeting;
   * everything here is the fact.
   *
   * It is also budgeted. Law 3 gives the whole opening view sixty words and the
   * strip above already prints the committed total once, so this says it in the
   * one place it changes the reading — how much of that total a credit action
   * can actually reach — and nowhere else.
   *
   * PROACTIVE, where the deal itself has something to lead on. A maturity
   * inside the coming quarter, a covenant test due soon, or the package drawn
   * hard against its commitment (`deriveNextMove`, ./nextMove.ts) outranks the
   * inventory sentence below — a banker opening this room wants the next move,
   * not a headcount. An inbound client ask still outranks the derived move: a
   * human is already waiting on that answer, which is the one thing this room
   * already treats as more urgent than a signal it noticed on its own. Where
   * neither applies, the room falls back to the inventory sentence exactly as
   * it always has.
   */
  function position(): string {
    if (unanchored) {
      return `${choices.length} packages on this relationship. Pick the one to work in: a modification is anchored on one package, and one package is one plan under one approval.`;
    }
    const target = askFacility() ?? booked[0] ?? members[0] ?? null;
    // NOTHING BOOKED IS THE HEADLINE when it is true: a client ask the room
    // cannot act on is the second fact, not the first.
    if (!booked.length) {
      return `This package holds ${members.length} ${members.length === 1 ? "member" : "members"} and none of them is booked, so there is nothing here a credit action can modify.`;
    }
    if (request?.ask?.to && target) {
      // THE CLIENT'S ASK, CLOSED AT PACKAGE ALTITUDE: what it does to the total
      // is the fact the strip cannot show, and it is the fact that decides.
      const after = typeof target.committed === "number" ? committed - target.committed + request.ask.to : null;
      return `The client has asked to take the ${facilityProduct(target, relationship)} to ${fmtMoney(request.ask.to)}${
        after !== null ? `, which moves the package to ${fmtMoney(after)}` : ""
      }.`;
    }
    const move = deriveNextMove(
      { facilities: booked, covenants, committed, outstanding, relationship },
      data.meta?.generatedAt ?? "",
    );
    if (move) return move.line;
    if (booked.length === members.length) {
      return members.length === 1
        ? `The one member is booked, so the whole ${fmtMoney(committed)} is open. Pick it.`
        : `All ${members.length} members are booked: the whole ${fmtMoney(committed)} is open. Pick one.`;
    }
    const reachable = booked.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
    return `${fmtMoney(reachable)} of ${fmtMoney(committed)} is open: ${booked.length} of ${members.length} members are booked. Pick one.`;
  }

  function brief(): WorkroomBrief {
    const compliant = covenants.filter(
      (c) => (c.latestComplianceStatus ?? c.covenantStatus ?? "").toLowerCase() === "compliant",
    ).length;
    return {
      // The assembler's own session user first, then whoever the room was
      // opened on. No third candidate: the relationship's name is the BORROWER,
      // and greeting the banker by their client's name is worse than not
      // greeting them at all.
      greeting: greetingFor(data.meta?.user, context.approver),
      packageChoices: unanchored ? choices : [],
      // A modification cannot be composed until one package is chosen: the credit
      // action IS anchored on one, and that anchor is the governance boundary.
      packageChoiceRequired: unanchored,
      packageName: context.packageName,
      baselineCommittedMM: MM(committed),
      baselineMembers: members.length,
      showsMembers: members.length > 0,
      covenantFigure: covenants.length ? `${compliant}/${covenants.length}` : "—",
      loadSteps: ["Reading the package", "Facilities and collateral", "Covenants and structure", "Ready"],
      // THE PIN IS THE ASK, or nothing. With no client request it used to
      // repeat the committed figure the strip is already showing two inches
      // above it — a third printing of one number, and three of law 3's sixty
      // words spent saying nothing new.
      askPin: request?.ask?.to !== undefined ? `${fmtMoney(request.ask.from)} → ${fmtMoney(request.ask.to)}` : "",
      position: position(),
      sources: sources(),
      why: why(),
      whyCaveat:
        "Recommendation only. Nothing is written until the single approval, and the approval redeems one use of one token. The agent recommends, the banker decides.",
      composeTarget: Math.max(1, suggestions.length),
      members: members.map((f) => toPackageMember(f, relationship, stagesStaged)),
      have: haveRows(),
    };
  }

  /* -------------------------------------------------- association awareness

     FOUNDER LAW 1 (2026-08-27): before a create is proposed, look at what is
     already associated with the facility. A covenant of the same kind already
     attached is not a second covenant by default — it is a choice between
     amending the one that is there and deliberately adding another. Duplicate
     prevention is a VALIDATION here and in stagePlan, never a UI nicety.      */

  function associated(field: CatalogField, facility: Facility | null): string[] {
    switch (field.associationScope) {
      case "loan-covenants":
        return (facility?.loanCovenants ?? []).map((j) => j.covenantType ?? j.name ?? "").filter(Boolean);
      case "pledges":
        // The DESCRIPTION first, because it is what a banker says: the amend-or-
        // add question compares the line against these, and matching only on the
        // autonumber would let "pledge the Duluth warehouse" through silently on
        // a facility that already carries it.
        return (facility?.collateral ?? [])
          .map((c) => c.collateralDescription ?? c.collateralName ?? c.collateralType ?? "")
          .filter(Boolean);
      case "parties":
        return entities
          .filter((e) => !e.loanId || !facility?.loanId || e.loanId === facility.loanId)
          .map((e) => e.accountName ?? "")
          .filter(Boolean);
      case "fees":
        // No read tool carries fee rows onto the bundle, so the room cannot
        // name what a facility already charges. Returning nothing here means
        // "not read", not "not there" — which is why the amend-or-add question
        // never fires on a fee and the org's own duplicate warning is the one
        // the banker sees.
        return [];
      default:
        return [];
    }
  }

  /** Words that make a second one deliberate rather than accidental. */
  const DELIBERATE_SECOND = /\b(second|another|additional|extra|as well|too|on top)\b/;

  /**
   * THE AMEND-OR-ADD QUESTION.
   *
   * It fires only when the banker's own line NAMES something already carried
   * onto the clone — matched on the association's significant words, so "the
   * fixed charge test" finds "Fixed Charge Coverage". A create that names
   * something new is not a duplicate and is not questioned; a create that names
   * what is already there is a choice the banker has to make, and making it
   * silently either way is the failure this prevents.
   */
  function duplicateQuestion(a: Amendment, said: string): string | null {
    if (a.op !== "add" || !a.field.associationScope) return null;
    // PARTIES ARE THE ADVISORY'S (Tier-1 rule 6). Blocking a party add on a name
    // already involved prevented no duplicate — an involvement row is a handoff
    // on this org, so nothing was ever going to be written twice — while costing
    // the banker the record of the ask. The rule says the role they already hold
    // and offers the role change, and the banker proceeds either way.
    if (a.field.associationScope === "parties") return null;
    const lower = said.toLowerCase();
    if (DELIBERATE_SECOND.test(lower)) return null;

    const hit = associated(a.field, a.facility).find((existing) => {
      const name = existing.toLowerCase();
      if (name && lower.includes(name)) return true;
      const words = name.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      return words.length > 1 && words.filter((w) => lower.includes(w)).length >= 2;
    });
    if (!hit) return null;

    return `${hit} is already on ${
      a.facility ? shortFacilityLabel(a.facility, relationship) : "this deal"
    }, and a modification carries it onto the clone. Change it, or say "add a second" and I will stage a new one beside it.`;
  }

  /* ------------------------------------------------------------ parseIntent */

  /**
   * THE QUESTION, WITH TODAY'S FIGURE BESIDE IT.
   *
   * "What should commitment amount become?" on its own reads as a second ask for
   * a number the room appeared to have already offered — which is exactly how it
   * read in the live UAT, because the pill it followed carried the member's
   * current commitment in its name. Stating the current value as CONTEXT, in the
   * question rather than in the pill, is where that figure belongs: it is what
   * the field reads today, not what it is being moved to.
   *
   * The parser cannot do this itself. It resolves fields, not the bundle.
   */
  function withCurrent(question: string, awaiting?: Awaiting): string {
    if (!awaiting) return question;
    const today = awaiting.facility ? currentValue(awaiting.field, awaiting.facility) : "";
    const reads = today && !today.startsWith("not ") && !today.includes("not staged") ? ` Today it reads ${today}.` : "";
    // AND WHY THE ROOM IS ASKING. A question with today's figure beside it says
    // what the field holds; it does not say what the answer is FOR, and a banker
    // who cannot see that is being walked through a form rather than talked to.
    const why = whyAsked(awaiting.field, { committed, lendable: bundle?.exposure?.totalUniqueCollateralLendableValue });
    return `${question}${reads}${why ? ` ${why}` : ""}`;
  }

  function toResult(outcome: ReturnType<typeof parseModify>, seq: number, said: string): IntentResult | null {
    if (outcome.kind === "clarify") {
      return {
        kind: "unparsed",
        reply: withCurrent(outcome.question, outcome.awaiting),
        // GUIDANCE: the way out comes first. Every term question offers a
        // one-click "Keep <current>" that holds the field where it is, so
        // keep-current is a chip and not only a typed word — and the banker
        // never has to know the word to leave a field alone. The chip's say
        // rides the same keep-current parser a typed "hold" does. Then the
        // org's own picklist values, capped so a long list is not a wall of
        // forty buttons.
        options: clarifyChips(outcome.awaiting, outcome.options),
      };
    }
    if (outcome.kind === "none") return null;

    // KEEP CURRENT. The banker held the field the room was waiting on; the room
    // says the current figure back, stages nothing, and stops asking. Clearing
    // `awaiting` is the caller's job (an outcome that is not a clarify does it).
    if (outcome.kind === "hold") {
      const cur = currentValue(outcome.field, outcome.facility);
      const at = cur.startsWith("not ") || cur.includes("not staged") ? "unchanged" : `at ${cur}`;
      return { kind: "unparsed", reply: `Holding ${outcome.field.label.toLowerCase()} ${at}. Nothing changes on it.` };
    }

    // A refusal beats a chip: an ask that belongs to another credit action is
    // answered with the reason rather than staged into this plan. And a refusal
    // that only says no is a dead end, so the WHY and the route out travel with
    // it into the conversation.
    for (const a of outcome.amendments) {
      const refusal = refusalFor(a.field);
      if (refusal) {
        return {
          kind: "refusal",
          reply: `That one is not mine to file. ${refusal.title}. ${refusal.why ?? ""}`.trim(),
          refusal,
        };
      }
    }

    // ASSOCIATION-AWARE FIRST. A create that names something already carried
    // onto the clone is a question, not a chip.
    for (const a of outcome.amendments) {
      const question = duplicateQuestion(a, said);
      if (question) return { kind: "unparsed", reply: question };
    }

    const deltas = outcome.amendments.map((a, i) => toDelta(a, seq + i, memberName));
    const fileable = deltas.filter((d) => d.fileable).length;
    const firstHandoff = deltas.find((d) => !d.fileable);
    const handed = deltas.length - fileable;
    // A PRODUCT WORD IS A SELECTION, and a selection the banker did not count is
    // a change set they did not mean to sign. "The line of credit" on a deal with
    // two of them legitimately lands on both, so the reply SAYS both rather than
    // reporting a count and leaving the spread to be discovered in the rail.
    const targets = [...new Set(deltas.map((d) => d.target))];
    const reply = [
      targets.length > 1 ? `That names a product this package carries ${targets.length} of, so it lands on all of them: ${targets.join(", ")}.` : null,
      fileable ? `${fileable} of these ${deltas.length === 1 ? "goes" : "go"} on the clone.` : null,
      // WHAT CONFIRMING WILL ACTUALLY DO, once, in the beat where the decision
      // is being asked for. A banker who has not seen this room has no way to
      // know the booked facility is untouched, and that is the fact that makes
      // the Confirm safe to press.
      whyProposed(deltas) || null,
      handed ? `${handed} ${handed === 1 ? "is" : "are"} recorded rather than filed.` : null,
      // ONE reason, for the first of them. A line that produces two handoffs
      // almost always produces two of a kind, and every entry gets its own
      // reason again when it is confirmed. Two here would be the lecture.
      firstHandoff ? whyHandoff(firstHandoff) : null,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      kind: "deltas",
      reply: reply || "Here is what that becomes.",
      deltas,
      // THE SENSE-CHECKS, BEFORE ANYTHING IS STAGED. They inform and suggest;
      // the chips above arrive open either way, because the org's guards do the
      // blocking and this room does not.
      advisories: advise(outcome.amendments, deltas, said),
    };
  }

  /** The Tier-1 rules, run over what the parse just produced. Everything they
   *  read is the room's own state — the members, the covenants, the involvement
   *  rows, the org's pool and its own ratio. */
  function advise(amendments: Amendment[], deltas: WorkroomDelta[], said: string): WorkroomAdvisory[] {
    return runAdvisories({
      proposals: amendments.map((amendment, i) => ({ amendment, delta: deltas[i] })),
      said,
      covenants,
      entities,
      committed,
      lendable: bundle?.exposure?.totalUniqueCollateralLendableValue,
      orgCoverageRatio: bundle?.exposure?.coverageRatio ?? undefined,
      clientAskTo: request?.ask?.to,
      today: deps.today(),
      memberName,
      identity: (f) => shortFacilityLabel(f, relationship),
    });
  }

  let deltaSeq = 0;
  /** The question the room last asked, so the next line can answer it. */
  let awaiting: Awaiting | null = null;

  /**
   * WHAT THE ANSWER DID TO THE ROOM'S OWN STATE.
   *
   * A QUESTION spends nothing: the room is still on the same move, so the
   * suggestion it was going to offer is still the right one and is simply held
   * back until the question is answered. Advancing the pill on a question is
   * what put "add a covenant on the accounts receivable test" under "what should
   * the commitment become" — two unrelated moves offered at once, with the
   * scene-bar Continue wired to the wrong one.
   */
  function settle(result: IntentResult): IntentResult {
    asked = result.kind === "unparsed";
    if (!asked) {
      deltaSeq += 8;
      suggestionIndex = Math.min(suggestionIndex + 1, suggestions.length);
    }
    return result;
  }

  async function parseIntent(text: string): Promise<IntentResult> {
    // NOT UNTIL THE ROOM IS ANCHORED. An amendment across two packages is one no
    // single credit action can carry, so it is refused before it is parsed
    // rather than staged into a plan that could never file.
    if (unanchored) {
      asked = true;
      return {
        kind: "unparsed",
        reply: `This relationship carries ${choices.length} packages and a modification is anchored on one of them. Pick the package above and I will work inside it.`,
      };
    }

    // AN ANSWER TO THE LAST QUESTION comes first: "$20,000,000" is a complete
    // reply to "what should the commitment become", and reading it as a new
    // instruction would lose both the field and the member.
    if (awaiting) {
      const answered = parseAnswer(awaiting, text, parseContext());
      if (answered) {
        const result = toResult(answered, deltaSeq, text);
        if (result) {
          awaiting = answered.kind === "clarify" ? (answered.awaiting ?? awaiting) : null;
          return settle(result);
        }
      }
    }

    const parsed = parseModify(text, parseContext());
    awaiting = parsed.kind === "clarify" ? (parsed.awaiting ?? null) : null;
    const direct = toResult(parsed, deltaSeq, text);
    if (direct) return settle(direct);

    // THE ASSIST, and its whole job is vocabulary. It restates the line in the
    // catalog's words and the deterministic parser reads THAT; nothing the
    // gateway says becomes a chip without passing the same validation.
    if (deps.restate && deps.available()) {
      const words = [...new Set(brief().members.map((m) => m.short))].concat(
        "commitment",
        "interest rate",
        "maturity date",
        "term",
        "covenant",
        "pledge",
        "guarantor",
        "fee",
      );
      const restated = await deps.restate(text, words);
      if (restated) {
        const second = toResult(parseModify(restated, parseContext()), deltaSeq, restated);
        if (second) return settle(second);
      }
    }

    // A REFUSAL NAMES WHAT IT COULD NOT MAP. Reaching here means the catalog
    // matched no field and no amount could be inferred, so the only half that
    // can have landed is the member — and saying which one landed is the
    // difference between a refusal the banker can answer and a dead end.
    const named = membersNamedIn(text, parseContext());
    const scope =
      "Commitment, rate, maturity, term, covenants, entities, fees, collateral and policy exceptions all file on the clone; pricing I stage and hand off with the reason.";
    asked = true;
    return {
      kind: "unparsed",
      reply: named.length
        ? `I read the ${named.map(memberName).join(" and the ")}, but not what should change on ${named.length === 1 ? "it" : "them"}. ${scope}`
        : `I could not map that onto this package: it names no member I hold and no field I file. Name one of the members above and what should change on it. ${scope}`,
    };
  }

  /* ----------------------------------------------------- picking a member

     The package strip is the room's list of what is eligible, so it has to be
     the room's way IN. A chip that only opens a read-only card is a list of
     things the banker can look at; a chip that starts the conversation on that
     member is a list of things they can work on, which is what the strip is
     actually showing.                                                        */

  function pick(memberId: string): IntentResult | null {
    const facility = members.find((f) => (f.loanId ?? "") === memberId) ?? null;
    if (!facility) return null;
    const label = facilityProduct(facility, relationship) || memberId;

    if (!booked.some((b) => b.loanId === facility.loanId)) {
      // NOT ELIGIBLE IS AN ANSWER, and the org's own stage is the reason. The
      // strip draws this member hollow; clicking it says why in words.
      focus = null;
      asked = false;
      const stage = (facility.stage ?? "").trim();
      return {
        kind: "unparsed",
        reply: `${label} is ${stage ? `at ${stage}` : "carrying no stage in this read"}, and a credit action only runs against a booked facility. There is nothing on it I can modify here.`,
      };
    }

    focus = facility;
    awaiting = null;
    asked = true;
    const held = [
      typeof facility.committed === "number" ? `${fmtMoney(facility.committed)} committed` : null,
      typeof facility.outstanding === "number" ? `${fmtMoney(facility.outstanding)} drawn` : null,
      facility.maturityDate ? `matures ${fmtDate(facility.maturityDate)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      kind: "unparsed",
      reply: `${label}${held ? `: ${held}` : ""}. What should change on it? Commitment, rate, maturity, term, covenants, entities, fees, collateral and policy exceptions all file on the clone; pricing I stage and hand off with the reason.`,
    };
  }

  /* ------------------------------------------------- the confirm's answer */

  /**
   * THE CHECK AN INCREASE TRIPS, on the org's own collateral figures.
   *
   * It does NOT re-derive the org's coverage ratio. That ratio is the org's
   * computation over the DISTINCT pool against what is drawn, and a commitment
   * change moves neither — `why()` already promises the cockpit never re-derives
   * it. What a commitment change moves is the FULLY DRAWN position, so that is
   * the figure the check states, named as this cockpit's arithmetic and printed
   * beside the org's own ratio so the two can never be read as the same number.
   *
   * It runs over the WHOLE manifest, so a second increase re-states the check on
   * the combined figure rather than on its own delta.
   */
  function coverageCheck(delta: WorkroomDelta, staged: WorkroomDelta[]): WorkroomChallenge | undefined {
    if (!delta.committedDeltaMM || delta.committedDeltaMM <= 0) return undefined;
    const lendable = bundle?.exposure?.totalUniqueCollateralLendableValue;
    if (typeof lendable !== "number" || lendable <= 0 || committed <= 0) return undefined;

    const addedMM = staged.reduce((sum, d) => sum + (d.committedDeltaMM ?? 0), 0);
    const after = committed + addedMM * 1_000_000;
    if (after <= 0) return undefined;
    const was = lendable / committed;
    const now = lendable / after;
    const drawn = bundle?.exposure?.totalOutstanding;
    const orgRatio = bundle?.exposure?.coverageRatio;

    return {
      id: `coverage:${after}`,
      verdict: now >= 1 ? "Coverage holds" : "Coverage thins",
      tone: now >= 1 ? "ok" : "warn",
      kicker: "Derived here from the org's collateral pool",
      line: `Committed goes to ${fmtMoney(after)} against ${fmtMoney(lendable)} of lendable collateral. Fully drawn, the pool covers ${now.toFixed(2)}x of the commitment, from ${was.toFixed(2)}x.`,
      // WHY THIS CHECK, ON THIS PACKAGE. The ratio on its own is a number the
      // banker has to take on trust; the gap between a fixed pool and a moving
      // commitment is the reason it moved at all.
      why: whyChecked({ lendable, covers: now >= 1 }),
      rows: [
        ["Lendable collateral, distinct pool", fmtMoney(lendable)],
        ["Committed today", fmtMoney(committed)],
        ["Committed with this manifest", fmtMoney(after), "key"],
        ["Coverage if fully drawn", `${was.toFixed(2)}x → ${now.toFixed(2)}x`, "sum"],
      ],
      say:
        typeof orgRatio === "number" && typeof drawn === "number"
          ? `The org's own coverage is ${orgRatio.toFixed(2)}x, computed over the distinct pool against the ${fmtMoney(drawn)} drawn today, and a commitment change does not move it. The figure above is this cockpit's arithmetic on the fully drawn position and is not the org's ratio.`
          : "The figure above is this cockpit's arithmetic over the org's lendable pool on a fully drawn position. It is not the org's own coverage ratio.",
    };
  }

  /**
   * WHAT A LANDED CHIP DID TO THE PACKAGE.
   *
   * Founder verbatim: the package amount is what counts, the loans are where the
   * money is, and it rolls up. An acknowledgement that only names the member
   * reports a row moving in a rail — which is why the loop read as dead even
   * when something had genuinely happened. Every confirm therefore closes on the
   * package figure, moved or held.
   */
  function packageMove(staged: WorkroomDelta[]): string {
    const addedMM = staged.reduce((sum, d) => sum + (d.committedDeltaMM ?? 0), 0);
    return addedMM
      ? `That takes the package from ${fmtMoney(committed)} to ${fmtMoney(committed + addedMM * 1_000_000)}.`
      : `The package total holds at ${fmtMoney(committed)}.`;
  }

  function acknowledge(delta: WorkroomDelta, staged: WorkroomDelta[]): WorkroomAcknowledgement {
    // A HANDOFF ANSWERS IN CREDIT LANGUAGE. The org's own sentence — the guard,
    // the object, the allowlist — is kept verbatim on the chip's map and on the
    // filed handoff list, where a banker went looking for it. In the flow it is
    // the reason a credit officer would give.
    const landed = delta.fileable
      ? `${delta.title} on ${delta.target}: ${delta.before} → ${delta.after}, staged on the clone.`
      : `${delta.title} on ${delta.target} is on the manifest for the record. ${whyHandoff(delta)}`;
    return {
      reply: `${landed} ${packageMove(staged)} ${vocabulary.nextMove}`,
      challenge: coverageCheck(delta, staged),
    };
  }

  /* -------------------------------------------------------------- stagePlan */

  /** The ordered plan (W1). The org's own steps carry the order — credit action,
   *  verify the clone, apply the changes — and the handoffs are appended before
   *  the booking handoff, which is where "this needs the clone and has no tool"
   *  belongs in the reading. */
  function withHandoffs(plan: StagedOutput, handed: WorkroomDelta[]): StagedOutput {
    if (!handed.length) return plan;
    // CONNECTED CREATION, NEVER ORPHANS (founder law 2). A create is not one
    // step: it is the record AND the junction chain that ties it to the deal,
    // in order, each link verified before the next runs. The plan shows that
    // chain even where no tool runs it, because a banker signing a change set
    // is owed what filing it would actually take — and because a chain written
    // here is a chain the Apex extension has to implement.
    const steps: PlanStep[] = [];
    handed.forEach((d, i) => {
      const chain = d.chainLinks ?? [];
      steps.push({
        id: `handoff_${i}`,
        type: "handoff",
        // No record id in a label: a plan that carries one reads as a plan that
        // already wrote (A33.5.3), and the fence checks every string.
        label: `HANDOFF: ${d.title} on ${d.target} — ${d.handoff?.reason ?? "no tool files this today"}`,
      });
      chain.forEach((link, j) => {
        steps.push({
          id: `handoff_${i}_chain_${j}`,
          type: "handoff",
          label: `${j + 1}. ${link.label} (${link.object} via ${link.via})${link.note ? ` — ${link.note}` : ""}`,
        });
      });
    });
    const at = plan.steps.findIndex((s) => s.id === "held_execution");
    const merged = at === -1 ? [...plan.steps, ...steps] : [...plan.steps.slice(0, at), ...steps, ...plan.steps.slice(at)];
    return {
      ...plan,
      steps: merged,
      warnings: [
        ...plan.warnings,
        `${handed.length} staged ${handed.length === 1 ? "entry is" : "entries are"} handed off rather than filed: no deployed tool writes ${handed.length === 1 ? "it" : "them"}. The filed summary names each one and why.`,
      ],
    };
  }

  /** ONE SCALAR, TWO CHANNELS (2026-08-31).
   *
   *  A change on a loan is not always an increase or a decrease of the same
   *  thing on every member (founder, 2026-08-31). The four scalars used to
   *  travel ONCE for the whole plan and land on every selected clone, so a
   *  legitimate mixed manifest — commitment on the line of credit, amortisation
   *  on the equipment loan — could not be filed at all: this morning's guard
   *  refused it rather than let the amount leak onto the second clone.
   *
   *  They now travel PER TARGET. Every scalar delta already carries the member
   *  it was staged on, so a multi-member plan sends `scalarChangesJson` —
   *  one entry per (scalar, member) — and each clone takes only its own
   *  changes. Two DIFFERENT amounts on two members is therefore a legal plan.
   *  Two different amounts on ONE member is not, and never can be: that is the
   *  ambiguity the refusal below still exists for.
   *
   *  Where broadcasting says exactly what the banker meant — one member, or one
   *  figure every selected member asked for — the flat request keys still carry
   *  the plan. The org accepts both shapes and refuses a request carrying them
   *  at once, and staying on the flat keys where they are unambiguous is what
   *  keeps this client safe against a connector still running the older
   *  contract. */
  function wirePayload(fileable: WorkroomDelta[], rationale: string): StagePayloads["loan-modification"] {
    /** One entry per (scalar, member), in the order the banker staged them. */
    const scalars: Array<{ key: WireKey; value: number | string; targetLoanId: string }> = [];
    const valueAt = new Map<string, number | string>();
    /** The members that actually staged each scalar, which is NOT the same set as
     *  the members the plan selects. */
    const scalarOn = new Map<WireKey, Set<string>>();
    const nameOf = (id: string) => fileable.find((d) => wireTarget(d) === id)?.target ?? id;
    for (const d of fileable) {
      if (!d.wire) continue; // a covenant delta carries covenantWire instead
      // The delta carries the key as a plain string so `types.ts` stays free of
      // the catalog; this is the one place it is read back as the wire key.
      const key = d.wire.key as WireKey;
      const at = `${key} ${d.wire.facilityId}`;
      const held = valueAt.get(at);
      if (held !== undefined) {
        // WITHIN ONE MEMBER a scalar still travels once. Two figures for the
        // same field on the same clone is not a plan the org could file either
        // way round, so it is refused here rather than resolved by arrival order.
        if (held !== d.wire.value) {
          throw new WorkroomRefusalError(
            `${key} travels as ONE value per facility, and this manifest asks for two on ${nameOf(d.wire.facilityId)}: ` +
              `${held} and ${d.wire.value}. Take one of them off; a second figure for the same field on the same facility is a ` +
              `later modification, not this one.`,
          );
        }
        continue;
      }
      valueAt.set(at, d.wire.value);
      scalars.push({ key, value: d.wire.value, targetLoanId: d.wire.facilityId });
      const on = scalarOn.get(key) ?? new Set<string>();
      on.add(d.wire.facilityId);
      scalarOn.set(key, on);
    }

    // Every fileable delta anchors the selection: a covenant's target member
    // must be among the selected facilities or the org refuses the add.
    const facilityIds = [...new Set(fileable.map(wireTarget).filter((x): x is string => Boolean(x)))];

    /* WHICH CHANNEL. The flat keys BROADCAST: the org applies each one to every
       selected clone. That says exactly what the banker meant on TWO conditions
       together — every selected member staged the scalar, and they all staged
       the SAME figure. A one-member plan is the common case; "push the maturity
       on both facilities to the same date" is the other, and keeping it on the
       flat keys keeps a connector still running the pre-per-target contract
       working through the rollout.
       Fail either condition and broadcasting is a lie: a member that never
       asked for the change would take it, or one of two figures would win by
       arrival order. Then the scalars ride targeted. */
    const spreadOf = (on: Set<string>) => facilityIds.filter((id) => !on.has(id));
    const figures = (key: WireKey) => new Set(scalars.filter((s) => s.key === key).map((s) => s.value));
    const perTarget = [...scalarOn].some(([key, on]) => spreadOf(on).length > 0 || figures(key).size > 1);

    /* THE SCALAR LEAK (P0, closed by the per-target channel above).

       `facilityIds` is the union of EVERY delta's target — a covenant on one
       member, a curated field on another — while a FLAT scalar travels once and
       the org applies it to every clone in that selection. So a plan staging
       "$15M → $20M" on the Line of Credit beside a field change on the $8MM
       Equipment loan silently took the Equipment clone to $20M as well.

       This guard is now a BACKSTOP: it asserts the routing above actually held,
       and by construction a plan that reaches the flat channel has nothing to
       spread onto. It stays because that is an INVARIANT rather than a fact —
       narrow the routing, bypass it, or hand this a selection assembled
       elsewhere, and the room refuses instead of filing the wrong figure on
       someone else's clone. */
    if (!perTarget) {
      for (const [key, on] of scalarOn) {
        const spread = spreadOf(on);
        if (!spread.length) continue;
        const plural = spread.length > 1;
        throw new WorkroomRefusalError(
          `${key} travels as ONE value applied to every facility in the plan. It is staged on ${[...on].map(nameOf).join(" and ")}, ` +
            `and this manifest also selects ${spread.map(nameOf).join(" and ")}, so filing it as it stands would set the same ${key} on ` +
            `${plural ? "those members" : "that member"} too. Stage the ${key} change as its own modification, or take the other ` +
            `${plural ? "members'" : "member's"} changes off this one.`,
        );
      }
    }

    const covenantAdds = fileable
      .filter((d) => d.covenantWire)
      .map((d) => ({
        typeName: d.covenantWire!.typeName,
        threshold: d.covenantWire!.threshold,
        operator: d.covenantWire!.operator,
        frequency: d.covenantWire!.frequency,
        targetLoanId: d.covenantWire!.facilityId,
      }));
    const involvementChanges = fileable
      .filter((d) => d.involvementWire)
      .map((d) => ({
        op: d.involvementWire!.op,
        role: d.involvementWire!.role,
        accountName: d.involvementWire!.accountName,
        ownership: d.involvementWire!.ownership,
        targetLoanId: d.involvementWire!.facilityId,
      }));
    // ONE ENTRY PER FIELD PER MEMBER. A field change has always carried its own
    // target, which is the shape the scalars have now adopted.
    const fieldChanges = fileable
      .filter((d) => d.fieldWire)
      .map((d) => ({
        field: d.fieldWire!.field,
        value: d.fieldWire!.value,
        targetLoanId: d.fieldWire!.facilityId,
      }));
    // A FEE IS PER TARGET LIKE EVERY RECORD WAVE, and a percentage fee sends no
    // amount at all: the key is omitted rather than nulled, because the org
    // refuses an amount on a percentage fee and a null would still be an answer
    // to a question this room has no business answering.
    const feeAdds = fileable
      .filter((d) => d.feeWire)
      .map((d) => ({
        feeType: d.feeWire!.feeType,
        description: d.feeWire!.description,
        calculationType: d.feeWire!.calculationType,
        ...(d.feeWire!.percentage !== undefined ? { percentage: d.feeWire!.percentage } : {}),
        ...(d.feeWire!.amount !== undefined ? { amount: d.feeWire!.amount } : {}),
        recordType: d.feeWire!.recordType,
        targetLoanId: d.feeWire!.facilityId,
      }));
    // A PLEDGE IS PER TARGET TOO, and it carries exactly one of its two shapes:
    // `collateralId` for an asset the borrower already owns, `newCollateral` for
    // one the arm has to author first. Neither key is nulled when it does not
    // apply — the org reads the presence of one as the choice between the two
    // verbs, and a null there would be a third answer nobody meant.
    const pledgeAdds = fileable
      .filter((d) => d.pledgeWire)
      .map((d) => ({
        ...(d.pledgeWire!.collateralId ? { collateralId: d.pledgeWire!.collateralId } : {}),
        ...(d.pledgeWire!.newCollateral ? { newCollateral: d.pledgeWire!.newCollateral } : {}),
        ...(d.pledgeWire!.advanceRate !== undefined ? { advanceRate: d.pledgeWire!.advanceRate } : {}),
        targetLoanId: d.pledgeWire!.facilityId,
      }));
    // A POLICY EXCEPTION IS PER TARGET TOO. The mitigants travel as a LIST and
    // the org lays them onto its three fields: three reasons is an org storage
    // fact, not a shape the banker should have to know, and a list is also what
    // lets the tool refuse a fourth by name instead of dropping it.
    const policyExceptionAdds = fileable
      .filter((d) => d.policyExceptionWire)
      .map((d) => ({
        title: d.policyExceptionWire!.title,
        status: d.policyExceptionWire!.status,
        ...(d.policyExceptionWire!.reasons.length ? { mitigationReasons: d.policyExceptionWire!.reasons } : {}),
        ...(d.policyExceptionWire!.severity ? { severity: d.policyExceptionWire!.severity } : {}),
        targetLoanId: d.policyExceptionWire!.facilityId,
      }));
    // The flat keys carry a value only on the channel that owns them; on the
    // per-target channel they stay null, which is what the org requires to read
    // `scalarChangesJson` at all.
    const one = (key: WireKey) => (perTarget ? undefined : scalars.find((s) => s.key === key)?.value);
    return {
      idempotencyKey: idempotencyKey!,
      rationale,
      facilityIds,
      productPackageId: context.productPackageId,
      requestedAmount: (one("requestedAmount") as number | undefined) ?? null,
      requestedMaturityDate: (one("requestedMaturityDate") as string | undefined) ?? null,
      requestedTermMonths: (one("requestedTermMonths") as number | undefined) ?? null,
      requestedRate: (one("requestedRate") as number | undefined) ?? null,
      // The key exists on the wire ONLY when covenants ride: a null field would
      // still put the word on every scalar-only payload.
      ...(perTarget ? { scalarChangesJson: JSON.stringify(scalars) } : {}),
      ...(covenantAdds.length ? { covenantAddsJson: JSON.stringify(covenantAdds) } : {}),
      ...(involvementChanges.length ? { involvementChangesJson: JSON.stringify(involvementChanges) } : {}),
      ...(fieldChanges.length ? { fieldChangesJson: JSON.stringify(fieldChanges) } : {}),
      ...(feeAdds.length ? { feeAddsJson: JSON.stringify(feeAdds) } : {}),
      ...(pledgeAdds.length ? { pledgeAddsJson: JSON.stringify(pledgeAdds) } : {}),
      ...(policyExceptionAdds.length ? { policyExceptionAddsJson: JSON.stringify(policyExceptionAdds) } : {}),
    };
  }

  async function stagePlan(deltas: WorkroomDelta[]): Promise<StagedWorkroomPlan> {
    // EVERY WALL EXPLAINS ITSELF. The refusal stands — a plan is the org's or
    // there is no plan — and it says what went wrong in the banker's terms with
    // one thing they can do about it.
    if (!deps.available()) throw new WorkroomRefusalError(NO_CONNECTOR_REFUSAL);
    if (!context.productPackageId) throw new WorkroomRefusalError(NO_PACKAGE_REFUSAL);

    const fileable = deltas.filter((d) => d.fileable && carriesWire(d));
    const handed = deltas.filter((d) => !d.fileable);
    if (!fileable.length) {
      throw new WorkroomRefusalError(
        handed.length ? nothingFilesRefusal(handed.length) : "Nothing is staged, so there is no plan to build.",
      );
    }

    idempotencyKey = idempotencyKey ?? deps.newKey();
    const rationale = `${RATIONALE_PREFIX}: ${fileable.map((d) => `${d.title} to ${d.after} on ${d.target}`).join("; ")}.`;
    const outcome = await deps.stage(wirePayload(fileable, rationale));
    if (!outcome.ok) {
      // The org's own words. A refusal here is a precondition the banker can act
      // on, and paraphrasing it has already cost one live session.
      idempotencyKey = null;
      throw new WorkroomRefusalError(outcome.error.message);
    }

    const plan = withHandoffs(outcome.result, handed);
    staged = {
      plan,
      planHash: plan.planHash,
      stagingId: plan.stagingId,
      decisionToken: plan.decisionToken ?? null,
    };
    stagedDeltas = deltas;
    return staged;
  }

  /* ---------------------------------------------------------------- execute */

  /** The ConfirmGate recompute, on the figures THIS manifest was composed
   *  against. A plan never executes against numbers the banker did not see. */
  function drift(): string[] {
    const current = packageMembers(bundle, context.productPackageId);
    const moved: string[] = [];
    for (const d of stagedDeltas) {
      if (!d.basis) continue;
      const facility = current.find((f) => f.loanId === d.basis!.facilityId);
      if (!facility) {
        moved.push(`${d.target} is no longer staged on this package.`);
        continue;
      }
      const field = { id: d.basis.fieldId } as CatalogField;
      const now = currentValue(field, facility);
      if (now !== d.basis.before) moved.push(`${d.title} on ${d.target} was ${d.basis.before}, and now reads ${now}.`);
    }
    return moved;
  }

  async function execute(approval: WorkroomApproval): Promise<WorkroomExecution> {
    if (!staged) throw new WorkroomRefusalError("Nothing has been staged, so there is no plan to execute.");
    if (approval.planHash !== staged.planHash || approval.stagingId !== staged.stagingId) {
      throw new WorkroomRefusalError("The plan changed after you confirmed it, so the confirmation no longer applies.");
    }
    if (spent.has(approval.decisionToken)) throw new WorkroomRefusalError("This confirmation has already been used.");

    const violations = validatePlan(staged.plan.steps);
    if (violations.length) {
      throw new WorkroomRefusalError(
        `This plan cannot be confirmed: ${violations.map((v) => `step ${v.stepId}: ${v.reason}`).join("; ")}.`,
      );
    }
    const leaks = assertNoRecordIds(staged.plan);
    if (leaks.length) throw new WorkroomRefusalError(`This plan cannot be confirmed: ${leaks.join("; ")}.`);
    if (staged.plan.executionHeld) {
      throw new WorkroomRefusalError(staged.plan.heldReason ?? "The org holds execution of this plan.");
    }

    const moved = drift();
    if (moved.length) {
      throw new WorkroomRefusalError(
        `The figures moved under this manifest, so it cannot be filed as it stands. ${moved.join(" ")} Remove the affected entries and say them again; I will restage on what the org reads now.`,
      );
    }

    // The org checks this against the RUNNING IDENTITY before it redeems the
    // token, and a display name fails that check with nothing written. The room
    // resolves the id itself rather than trusting the name it renders.
    const approverUserId = resolveApproverUserId(data.meta);
    if (!approverUserId) {
      throw new WorkroomRefusalError(
        "This view has no Salesforce user id for the signed-in identity, and the org will not file a record without one.",
      );
    }
    const token = staged.decisionToken;
    if (!token) {
      throw new WorkroomRefusalError("This plan carries no confirmation token from the staging call, so it cannot be executed.");
    }

    // FROM HERE THE PLAN IS THE ORG'S. Everything below is raised `dispatched`:
    // the call left the room, so neither a domain error nor a lost answer is
    // evidence that nothing was written.
    let outcome: ToolOutcome<ExecuteResult>;
    try {
      outcome = await deps.execute({
        idempotencyKey: idempotencyKey ?? staged.stagingId,
        stagingId: staged.stagingId,
        planHash: staged.planHash,
        decisionToken: token,
        approverUserId,
      });
    } catch (e) {
      // The transport rejects with a plain failure OBJECT, not an Error. Read it
      // as a sentence or the room says "[object Object]" and calls it an answer.
      throw new WorkroomRefusalError(readableError(e), true);
    }
    if (!outcome.ok) throw new WorkroomRefusalError(outcome.error.message, true);
    spent.add(approval.decisionToken);

    const result = outcome.result;
    const perFacility = new Map((result.facilities ?? []).map((f) => [f.facilityId, f]));
    const verified = (result.steps ?? []).filter((s) => s.state === "verified").length;

    /* A FILED LIST IS THE ORG'S ANSWER, NEVER THE ROOM'S OWN MANIFEST.
       This used to build every row from `stagedDeltas`, the entries the room
       SENT, so a run the org reported failed came back carrying record ids and
       verification sentences for writes that never happened, and the room's two
       guards at the seam (a non-empty list, a record id on it) were both
       satisfied by rows nobody wrote. An empty list is the honest answer, and
       the room's unreadable-execution path takes it from there. */
    const failed = executionFailed(result);

    const filed: FiledEntry[] = failed
      ? []
      : stagedDeltas
          .filter((d) => d.fileable && carriesWire(d))
          .map((d) => {
            const row = perFacility.get(wireTarget(d)!);
            const cloneId = row?.cloneLoanId ?? result.cloneLoanId;
            return {
              deltaId: d.id,
              // REAL ids, from the org's own response. A missing clone id is a
              // verification that did not confirm, and it says so.
              recordId: cloneId ?? "the org did not name the clone",
              verification:
                [row?.appliedChanges, row?.verification, row?.junctionName ? `Chain row ${row.junctionName}` : null]
                  .filter(Boolean)
                  .join(" ") || result.outcome,
            };
          });

    const handoffs = stagedDeltas
      .filter((d) => !d.fileable)
      .map((d) => ({
        deltaId: d.id,
        title: `${d.title} · ${d.target}`,
        reason: d.handoff?.reason ?? "No tool files this today.",
        closes: d.handoff?.closes,
      }));

    return {
      filed,
      terminalState: result.terminalState,
      // The version the credit action rolled the package into, where the org
      // named one. The sheet's "version <v>" clause and the dossier's link both
      // read it from here rather than from a local widening.
      outputPackageId: result.outputPackageId ?? null,
      tokenNote: `Token redeemed by ${approval.approverUserId} · single use · ${verified} of ${result.steps?.length ?? 0} plan steps verified by the tool's own re-query${result.replayed ? " · replayed, nothing was written twice" : ""}`,
      // The org's sentence about what booking requires, verbatim. It is the
      // org's account of its own process, not ours to paraphrase. A failed run
      // has no booking to describe, so its own reason travels in that slot.
      handoff: failed ? failureReason(result) : result.bookingHandoff,
      handoffs,
      reply: {
        subject: `${context.packageName}: modification staged`,
        lede: result.outcome,
        body: [
          // THE CLOSE IS AT PACKAGE ALTITUDE, like the open. What the banker
          // signed is a movement of the package total; the member rows below are
          // how it got there.
          packageMove(stagedDeltas),
          `${filed.length} ${filed.length === 1 ? "change" : "changes"} filed against the modification of ${context.packageName}.`,
          ...filed.map((f) => `- ${stagedDeltas.find((d) => d.id === f.deltaId)?.title}: ${f.verification}`),
          handoffs.length
            ? `\n${handoffs.length} ${handoffs.length === 1 ? "item was" : "items were"} recorded on the modification but not filed, because no tool writes ${handoffs.length === 1 ? "it" : "them"} today:\n` +
              handoffs.map((h) => `- ${h.title}: ${h.reason}`).join("\n")
            : "",
          result.bookingHandoff ? `\n${result.bookingHandoff}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    };
  }

  return {
    mode: "modify",
    scripted: false,
    brief,
    // A PENDING QUESTION SUPPRESSES THE NEXT MOVE. Offering an unrelated
    // suggestion under an open question puts two moves on the table at once and
    // wires the scene bar to the wrong one.
    suggest: () => (asked ? null : (suggestions[suggestionIndex] ?? null)),
    pick,
    parseIntent,
    acknowledge,
    stagePlan,
    execute,
    resume: () => held.entries,
    hold: (entries) => holdComposed(context.mode, context.productPackageId, { entries, idempotencyKey }),
    release: () => releaseComposed(context.mode, context.productPackageId),
  };
}
