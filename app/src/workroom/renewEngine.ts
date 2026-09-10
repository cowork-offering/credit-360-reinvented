import { newRequestId } from "../channel/adapter";
import { mcpAvailable } from "../channel/mcp";
import {
  executionHeldReason,
  stageAction,
  type StagePayloads,
  type ToolOutcome,
} from "../channel/writeTools";
import { assertNoRecordIds, type PlanStep, type StagedOutput } from "../actions/stagedPlan";
import { packageRecords } from "../actions/schemas";
import { validatePlan } from "../actions/transitionAllowlist";
import { bookedFacilities, facilityProduct, facilityStagesStaged, shortFacilityLabel } from "../data/facilityStage";
import { fmtDate, fmtMoney } from "../data/format";
import { isActiveFacility, MATURITY_NEAR_WINDOW_DAYS } from "../data/worklist";
import type { BorrowerBundle, C360Data, Covenant, Facility } from "../data/contract";
import {
  holdComposed,
  recallComposed,
  releaseComposed,
  type PackageChoice,
  type WorkroomBrief,
  type WorkroomEngine,
  type WorkroomSuggestion,
} from "./engine";
import { catalogField, chainFor, type CatalogField } from "./fieldCatalog";
import { gatewayRestate, type Restate } from "./gatewayRestate";
import { WorkroomRefusalError } from "./modifyEngine";
import { vocabularyFor } from "./modes";
import {
  membersNamedIn,
  parseAnswer,
  parseModify,
  readDate,
  type Amendment,
  type Awaiting,
  type ParseContext,
  type ParsedValue,
} from "./parseModify";
import { greetingFor } from "./viewer";
import type { SourceChip, WhyRow } from "./scripts";
import type {
  HaveRow,
  IntentResult,
  PackageMember,
  StagedWorkroomPlan,
  WorkroomAcknowledgement,
  WorkroomApproval,
  WorkroomChallenge,
  WorkroomContext,
  WorkroomDelta,
  WorkroomExecution,
} from "./types";

/* =============================================================================
   THE RENEWAL ENGINE.

   A renewal is not a smaller modification. It is MATURITY-DRIVEN and it is
   PACKAGE-FIRST (founder correction, 2026-08-30): nCino package methodology
   never versions a loan alone. The credit action mints the next VERSION of the
   whole package — every booked, open member is cloned onto it with its record
   graph (covenant junctions, pledges, borrowing structure; the engine copies no
   junction rows itself, so the carry is composed and proven by count), the
   renewed member's clone takes the new maturity, the rest carry unchanged, and
   anything not booked/open is NAMED as staying behind on the current version.
   The new maturity is the thing that makes it a renewal at all. The deployed
   tool says the same in its own words: `newMaturityDate` is `required=true` on
   `StageRenewal.Request` AND re-checked in Apex ("newMaturityDate is required.
   A renewal is maturity-driven."), and the only other change it carries is a
   repricing.

   SO THIS ROOM STAGES AND HANDS OFF. It does not execute, and the reason is not
   a policy of ours: `WRITE_TOOLS.renewal.execute` is NULL because no
   `execute_renewal` was ever built, and the org's own staged plan comes back
   with `executionHeld: true` and Loan_Validation_06 as the reason — Booked is
   unreachable through the API with no permission bypass, and reaching it needs
   nCino's Submit for Approval with real approvers.

   That makes the final beat the honest one: the governed plan is staged, the
   token is minted and NOT redeemed, and the room says out loud that booking
   runs through nCino. There is no execute call anywhere in this file. Faking
   one — or calling `executeAction("renewal", …)` to collect the refusal and
   render it as a filing — would be the single worst thing this room could do.

   Wire shape observed 2026-08-25 on the live org and archived in
   `knowledge/sf-build-v2/wp2/observed-envelopes-facilityIds.json`
   (`package_anchored_renewal`). The plan grew the package-versioning steps
   (roll_package / verify_package / carry_junctions) on 2026-08-30, mirroring
   StageLoanModification; the envelope keys this file reads are unchanged.
   ============================================================================= */

const RATIONALE_PREFIX = "Renewal Workroom";

/** The two request keys `stage_renewal` accepts as changes. Everything else a
 *  banker can say about a renewal is staged for the record and handed off. */
const RENEW_WIRE: Record<string, "newMaturityDate" | "requestedRate"> = {
  "loan.maturityDate": "newMaturityDate",
  "loan.interestRate": "requestedRate",
};

const MATURITY_FIELD = catalogField("loan.maturityDate")!;

/** Why the two everyone reaches for next are not on this wire. Named per field,
 *  because "no tool" is not the same sentence for an amount as for a covenant. */
const RENEW_GAP: Record<string, string> = {
  "loan.amount":
    "stage_renewal carries exactly two changes: the new maturity date and a repricing. Resizing a facility is a modification, not a renewal, and no tool resizes one here.",
  "loan.termMonths":
    "stage_renewal takes the new maturity DATE, not a term in months. Say the date and it files; the term is derived from it by the org.",
};

const MM = (n: number) => n / 1_000_000;

function pct(part: number | undefined, whole: number | undefined): number | null {
  if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** Whole days from `from` to `to`, or null where either is not a date. */
function daysBetween(from: string | undefined, to: string | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(from.slice(0, 10));
  const b = Date.parse(to.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function packageMembers(bundle: BorrowerBundle | null, packageId: string | null): Facility[] {
  const all = (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  if (!packageId) return all;
  const on = all.filter((f) => f.productPackageId === packageId);
  return on.length ? on : all;
}

/** Every package on the relationship, with whether a credit action can run in
 *  it at all. Same rule as a modification: a renewal needs a booked member. */
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
          ? `All members are at ${stages.join(", ")}, and a renewal only runs against a booked one.`
          : "No member of this package carries a stage in this read, so a booked one cannot be confirmed.",
    };
  });
}

function packageCovenantRows(bundle: BorrowerBundle | null, members: Facility[]): Covenant[] {
  const covenants = bundle?.covenants?.covenants ?? [];
  const loanIds = new Set(members.map((f) => f.loanId).filter(Boolean));
  return covenants.filter((c) => {
    const attached = c.attachedLoans;
    if (!attached || !attached.length) return true;
    return attached.some((a) => a.loanId && loanIds.has(a.loanId));
  });
}

function memberTag(f: Facility, staged: boolean): { tag: string; proposed: boolean } {
  if (!staged) return { tag: "Stage not staged", proposed: true };
  const stage = (f.stage ?? "").trim();
  if (!stage) return { tag: "Stage not staged", proposed: true };
  return { tag: stage, proposed: stage.toLowerCase() !== "booked" };
}

function toPackageMember(f: Facility, relationship: string, staged: boolean): PackageMember {
  const { tag, proposed } = memberTag(f, staged);
  const drawn = pct(f.outstanding, f.committed);
  // THE MATURITY LEADS THE DETAIL LINE, because in this room it is the fact the
  // banker is choosing on. Everywhere else it is the fourth thing on the chip.
  const detail = [
    f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : "no maturity staged",
    typeof f.outstanding === "number" ? `${fmtMoney(f.outstanding)} outstanding` : null,
    typeof f.interestRate === "number" ? `${f.interestRate}%` : null,
    f.riskGrade ? `grade ${f.riskGrade}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = facilityProduct(f, relationship);
  return {
    id: f.loanId ?? label,
    key: label,
    short: label,
    tag,
    product: facilityProduct(f, relationship),
    amount: typeof f.committed === "number" ? `$${MM(f.committed).toFixed(1)}MM` : "—",
    detail,
    utilisation: drawn ?? undefined,
    available: typeof f.available === "number" ? `${fmtMoney(f.available)} available` : undefined,
    proposed,
  };
}

/* --------------------------------------------------------------- the deltas */

const GROUP_KIND: Record<string, string> = {
  "loan-terms": "Renewal term",
  "loan-other": "Renewal term",
  package: "Package change",
  covenant: "Covenant",
  collateral: "Security",
  party: "Borrowing structure",
  pricing: "Pricing",
  fee: "Fee",
  exception: "Policy exception",
};

const OP_KIND: Record<string, string> = { add: "Add", remove: "Remove", change: "" };

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
    default:
      return value.text;
  }
}

/** What the member reads TODAY for this field. The chip's "before", and the
 *  basis a drift recompute checks before anything is staged against it. */
function currentValue(field: CatalogField, facility: Facility | null): string {
  if (!facility) return "not set";
  switch (field.id) {
    case "loan.maturityDate":
      return facility.maturityDate ? fmtDate(facility.maturityDate) : "not staged";
    case "loan.interestRate":
      return typeof facility.interestRate === "number" ? `${facility.interestRate}%` : "not staged";
    case "loan.amount":
      return typeof facility.committed === "number" ? fmtMoney(facility.committed) : "not staged";
    default:
      return "today's value is not staged in this read";
  }
}

/** The term fields a banker moves to a value, so can hold at the current one. */
const SCALAR_TERM_TYPES = new Set(["currency", "percent", "months", "date"]);

/** The chips under a renewal term question: a one-click "Keep <current>" first
 *  (it rides the keep-current parser, same as a typed "hold"), then any org
 *  picklist values, capped. Mirrors the modify engine so a renewal reads the
 *  same as a modification. */
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

export function createRenewEngine(args: {
  context: WorkroomContext;
  data: C360Data;
  bundle: BorrowerBundle | null;
  deps?: RenewEngineDeps;
}): WorkroomEngine {
  const { context, data, bundle } = args;
  const deps = { ...defaultDeps, ...args.deps };
  const vocabulary = vocabularyFor(context);
  const relationship = (bundle?.snapshot?.name ?? context.accountName ?? "").trim();
  /** The cockpit's own clock. Never `new Date()`: the artifact is a snapshot. */
  const asOf = data.meta?.generatedAt;

  /* ONE SESSION IS ONE PACKAGE. A renewal's credit action is anchored on one
     product package, and a plan that blurred two is a plan no single approval
     could honestly cover. */
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

  /* ----------------------------------------------------- the maturity window

     THE STORY THIS ROOM OPENS ON. A renewal is chosen off a maturity, so the
     members are ordered by it and the ones inside the cockpit's own near-window
     lead. The window is `MATURITY_NEAR_WINDOW_DAYS`, the same figure the
     worklist raises a maturity reason on, so the room and the worklist can never
     disagree about what "coming up" means.                                    */

  const byMaturity = booked.filter((f) => f.maturityDate).sort((a, b) => (a.maturityDate! < b.maturityDate! ? -1 : 1));
  const maturing = byMaturity.filter((f) => {
    const days = daysBetween(asOf, f.maturityDate);
    return days !== null && days <= MATURITY_NEAR_WINDOW_DAYS;
  });
  const maturingCommitted = maturing.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
  /** The one the room leads with, and the default a line that names none gets. */
  const lead = maturing[0] ?? byMaturity[0] ?? booked[0] ?? null;

  function memberName(f: Facility): string {
    const product = facilityProduct(f, relationship);
    const twins = members.filter((m) => facilityProduct(m, relationship) === product).length > 1;
    return twins && typeof f.committed === "number" ? `${product} (${fmtMoney(f.committed)})` : product;
  }

  let focus: Facility | null = null;
  const parseContext = (): ParseContext => ({ facilities: members, booked, relationship, entities, focus });

  const suggestions = buildSuggestions();
  let suggestionIndex = 0;
  let asked = false;
  let staged: StagedWorkroomPlan | null = null;
  let stagedDeltas: WorkroomDelta[] = [];
  /** What this package was left composing when the room last closed. Read
   *  once, at construction: the room asks for it and starts on it. */
  const held = recallComposed(context.mode, context.productPackageId);
  /** Carried across a close with the manifest, so reopening and approving
   *  files ONE action, replayed, rather than a second one beside the first. */
  let idempotencyKey: string | null = held.idempotencyKey;
  const spent = new Set<string>();
  let deltaSeq = 0;
  let awaiting: Awaiting | null = null;

  /* ------------------------------------------------------------- the deltas */

  function toDelta(a: Amendment, seq: number): WorkroomDelta {
    const { field, facility, value, op } = a;
    const target = facility
      ? memberName(facility)
      : field.category === "party"
        ? (a.party ?? "the borrowing structure")
        : "the product package";

    const wireKey = RENEW_WIRE[field.id];
    const fileable = Boolean(wireKey) && op === "change" && facility?.loanId !== undefined && value !== null;
    const wire =
      fileable && value
        ? (() => {
            const raw = wireKey === "newMaturityDate" ? (value.kind === "date" ? value.iso : null) : value.kind === "percent" ? value.rate : null;
            return raw === null ? undefined : { key: wireKey!, value: raw, facilityId: facility!.loanId! };
          })()
        : undefined;

    // AGAINST THE ROLL-OVER BASELINE. The clone carries the parent's whole
    // record graph, so an ADD starts from "not on the facility today" and a
    // REMOVE ends there; only a change has two values to show.
    const after = op === "remove" ? "off the renewal" : valueLabel(value);
    const before =
      op === "add"
        ? "not on the facility today"
        : field.category === "party" || field.category === "fee" || field.type === "record"
          ? "rolls forward from the parent"
          : currentValue(field, facility);

    const gap = RENEW_GAP[field.id] ?? field.gap ?? "No tool files this on a renewal today.";

    return {
      id: `${field.id}:${facility?.loanId ?? a.party ?? "package"}:${seq}`,
      group: field.group,
      op,
      kind: [OP_KIND[op], GROUP_KIND[field.category] ?? "Change"].filter(Boolean).join(" "),
      kindTone: op === "remove" ? "refusal" : wire ? undefined : "refusal",
      badge: wire ? `${field.label} → ${after}` : `${OP_KIND[op] || "Change"} ${field.label.toLowerCase()} · handed off`,
      title: field.label,
      target,
      before,
      after,
      member: facility?.loanId,
      map: [
        ["Object", field.object],
        ["Field", field.apiName ?? "not established on this org — a live describe supplies it"],
        [
          "Written as",
          wire
            ? `${field.apiName} on the renewal clone, on the next package version. The booked parent and the current package are untouched, and nothing is written until nCino books the clone.`
            : "Nothing. No tool files this on a renewal; it travels as a handoff on the staged plan.",
        ],
      ],
      fields: field.apiName ? [`${field.object}.${field.apiName}`] : [field.object],
      caveat: wire ? undefined : gap,
      filed: {
        recordId: wire ? "the org's own staging row" : "not filed",
        verification: wire
          ? "Staged on the renewal plan and persisted by the org"
          : "Handed off — nothing was written",
      },
      fileable: Boolean(wire),
      wire,
      basis: wire && facility?.loanId ? { facilityId: facility.loanId, fieldId: field.id, before } : undefined,
      handoff: wire ? undefined : { reason: gap, closes: field.closes },
      chainLinks: op === "add" ? chainFor(field) : undefined,
    };
  }

  /* ------------------------------------------------------------ suggestions */

  function buildSuggestions(): WorkroomSuggestion[] {
    if (unanchored || !lead) return [];
    const out: WorkroomSuggestion[] = [];
    const identity = shortFacilityLabel(lead, relationship);
    const product = facilityProduct(lead, relationship);

    /* THE PILL NAMES THE MEMBER AND ITS MATURITY, and no target date: the room
       will not invent the date a renewal runs to. The label states what the
       member reads today, the parse asks what it should become, and the
       banker's answer is the date. */
    out.push({
      label: lead.maturityDate ? `Renew the ${product} · matures ${fmtDate(lead.maturityDate)}` : `Renew the ${product}`,
      say: `renew the ${identity}`,
    });
    out.push({ label: `Reprice the ${product}`, say: `change the interest rate on the ${identity}` });

    // The thinnest covenant on the package. It rolls forward on the clone, so
    // resetting it is a real move — and one this room manifests and hands off.
    const thin = covenants
      .filter((c) => typeof c.thresholdValue === "number" && typeof c.actualValue === "number")
      .sort((a, b) => Math.abs((a.actualValue ?? 0) - (a.thresholdValue ?? 0)) - Math.abs((b.actualValue ?? 0) - (b.thresholdValue ?? 0)))[0];
    if (thin?.covenantType) {
      const line = `Reset the ${thin.covenantType.toLowerCase()} test on the renewal`;
      out.push({ label: line, say: `change the ${thin.covenantType.toLowerCase()} covenant on the ${identity}` });
    }
    return out;
  }

  /* ------------------------------------------------------------------ brief */

  function rollOverRows(): HaveRow[] {
    if (!lead) return [];
    const name = shortFacilityLabel(lead, relationship) || "the facility";
    const junctions = lead.loanCovenants ?? [];
    const pledges = lead.collateral ?? [];
    const parties = entities.filter((e) => !e.loanId || e.loanId === lead.loanId);

    const rows: HaveRow[] = [
      {
        label: `What ${name} rolls forward`,
        value: [
          `${junctions.length} covenant ${junctions.length === 1 ? "junction" : "junctions"}`,
          `${pledges.length} ${pledges.length === 1 ? "pledge" : "pledges"}`,
          `${parties.length} involvement ${parties.length === 1 ? "row" : "rows"}`,
        ].join(" · "),
        detail:
          "A renewal versions the WHOLE package: every booked member is cloned onto the next package version and each clone carries this graph with it — nCino's engine copies no junction rows itself, so the carry is composed and proven by count. Everything here is KEPT unless the staged terms say otherwise, which is what makes a renewal a roll-over rather than a rebuild.",
      },
    ];
    if (junctions.length) {
      rows.push({
        label: "Covenants that roll forward",
        value: junctions.map((j) => j.covenantType ?? j.name ?? "covenant").join(", "),
        detail:
          "nCino clones the junction, not the covenant, and its own guidance says a business process must decide what happens to each one. This room stages that decision and hands it off.",
      });
    }
    if (pledges.length) {
      rows.push({
        label: "Security that rolls forward",
        value: pledges
          .map((c) => `${c.collateralName ?? c.collateralType ?? "collateral"}${typeof c.amountPledged === "number" ? ` ${fmtMoney(c.amountPledged)}` : ""}`)
          .join(", "),
        detail: pledges
          .map((c) =>
            [c.collateralName, typeof c.advanceRate === "number" ? `${c.advanceRate}% advance` : null, c.lienPosition ? `${c.lienPosition} lien` : null, c.pledgedStatus]
              .filter(Boolean)
              .join(" · "),
          )
          .join("; "),
      });
    }
    if (parties.length) {
      rows.push({
        label: "Who rolls forward onto the clone",
        value: parties.map((e) => `${e.accountName ?? "entity"} (${e.borrowerType ?? "role unstated"})`).join(", "),
        detail:
          "The borrowing structure comes with the clone, re-anchored on the new package version. Changing it on a renewal is a handoff: no tool writes an involvement row here.",
      });
    }
    rows.push({
      label: "Known renewal side effects",
      value: "A new Opportunity, and the renewal number",
      detail:
        "The org's own staged plan says both: a renewal auto-creates an Opportunity and is effectively irreversible once run, and LLC_BI__Renewal_Number__c must be set or the clone is named _Rnull and breaks core sync. Neither is this room's to suppress.",
    });
    return rows;
  }

  function haveRows(): HaveRow[] {
    const rows: HaveRow[] = [];

    // MATURITIES LEAD. In this room they are the reason there is a room.
    if (byMaturity.length) {
      rows.push({
        label: "Maturities",
        value: maturing.length
          ? `${maturing.length} of ${booked.length} booked ${maturing.length === 1 ? "member matures" : "members mature"} within ${MATURITY_NEAR_WINDOW_DAYS} days · ${fmtMoney(maturingCommitted)}`
          : `Next ${fmtDate(byMaturity[0].maturityDate)}`,
        detail: byMaturity
          .slice(0, 5)
          .map((f) => {
            const days = daysBetween(asOf, f.maturityDate);
            return `${shortFacilityLabel(f, relationship)} ${fmtDate(f.maturityDate)}${days !== null ? ` (${days} days)` : ""}`;
          })
          .join("; "),
      });
    }

    rows.push({
      label: "Package position",
      value: `${members.length} ${members.length === 1 ? "member" : "members"} · ${fmtMoney(committed)} committed`,
      detail: [
        bundle?.snapshot?.packageStage ? `Stage ${bundle.snapshot.packageStage}` : null,
        bundle?.snapshot?.primaryRiskRating ? `risk rating ${bundle.snapshot.primaryRiskRating}` : null,
        `${booked.length} of ${members.length} booked, which is what a renewal requires`,
        stagesStaged ? null : "Facility stages are not staged in this read, so booked cannot be confirmed on every member",
      ]
        .filter(Boolean)
        .join(" · "),
    });

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
        detail: `Across ${bundle?.exposure?.uniqueCollateralCount ?? "an unstated number of"} distinct collateral records. It rolls onto the clone with the pledges.`,
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

  function sources(): SourceChip[] {
    const have = haveRows();
    const pick = (label: string) => have.filter((r) => r.label === label);
    const out: SourceChip[] = [];
    if (pick("Maturities").length) out.push({ id: "maturities", label: "Maturities", kicker: "What matures next", icon: "calendar", have: pick("Maturities") });
    out.push({ id: "package", label: "Package", kicker: "What the package holds today", icon: "package", have: pick("Package position") });
    if (pick("Covenants").length) out.push({ id: "covenants", label: "Covenants", kicker: "What rolls forward", icon: "covenants", have: pick("Covenants") });
    if (pick("Collateral pool").length) out.push({ id: "collateral", label: "Collateral", kicker: "The collateral pool", icon: "collateral", have: pick("Collateral pool") });
    if (pick("Borrowing structure").length) out.push({ id: "entities", label: "Entities", kicker: "Who is on the deal", icon: "account", have: pick("Borrowing structure") });
    return out;
  }

  function why(): WhyRow[] {
    const rows: WhyRow[] = [
      {
        label: "The package",
        detail: `${members.length} ${members.length === 1 ? "member" : "members"}, ${fmtMoney(committed)} committed, ${booked.length} booked. A renewal runs against a booked facility; anything else the org refuses outright.`,
      },
      {
        label: "How the package versions",
        detail:
          "nCino package methodology: a renewal never versions a loan alone. The credit action mints the next version of the whole package — every booked, open member rolls onto it with its junction graph, and anything else is named as staying behind on the current version. The staged plan computes and names that roll.",
      },
    ];
    if (byMaturity.length) {
      const days = daysBetween(asOf, byMaturity[0].maturityDate);
      rows.push({
        label: "Why now",
        detail: `The nearest maturity is ${fmtDate(byMaturity[0].maturityDate)}${days !== null ? `, ${days} days out` : ""}. A renewal is maturity-driven: the tool refuses a plan that does not carry a new maturity date.`,
      });
    }
    rows.push({
      label: "What this room can file",
      detail:
        "Two changes travel on stage_renewal: the new maturity date and a repricing. Everything else — the amount, the covenants, the security, the structure — rolls forward on the clone and is staged into the plan as a handoff with its reason.",
    });
    rows.push({
      label: "What happens at the end",
      detail:
        "The plan is staged and persisted, and the token is minted and not redeemed. There is no execute_renewal: booking the clone is nCino's own Submit for Approval run with real approvers (Loan_Validation_06), and this room hands into it rather than around it.",
    });
    return rows;
  }

  /**
   * THE ONE SENTENCE, AT PACKAGE ALTITUDE (law 1) AND ON THE MATURITY.
   *
   * The founder's reading of this room: the package total is what counts, the
   * members are where the money sits, and it rolls up. In a renewal the fact
   * that decides is how much of that total is coming due, so that is the figure
   * the opening states — once, in the one place the strip cannot show it.
   */
  function position(): string {
    if (unanchored) {
      return `${choices.length} packages on this relationship. Pick the one to renew in: a renewal is anchored on one package, and one package is one plan under one submission.`;
    }
    if (!booked.length) {
      return `This package holds ${members.length} ${members.length === 1 ? "member" : "members"} and none of them is booked, so there is nothing here a renewal can run against.`;
    }
    if (maturing.length && lead?.maturityDate) {
      return `${fmtMoney(maturingCommitted)} matures within ${MATURITY_NEAR_WINDOW_DAYS} days — the ${facilityProduct(lead, relationship)} first, on ${fmtDate(lead.maturityDate)}. A renewal versions the whole package: every booked member rolls forward with its covenants, security and structure. Pick it and name the new maturity.`;
    }
    if (lead?.maturityDate) {
      return `Nothing matures inside ${MATURITY_NEAR_WINDOW_DAYS} days. The nearest is the ${facilityProduct(lead, relationship)} on ${fmtDate(lead.maturityDate)}, and renewing it early is a legitimate move: it rolls the whole package forward onto the next version.`;
    }
    return `${booked.length} of ${members.length} members are booked and none of them stages a maturity date in this read. A renewal is maturity-driven, so name the member and the date it should run to.`;
  }

  function brief(): WorkroomBrief {
    const compliant = covenants.filter((c) => (c.latestComplianceStatus ?? c.covenantStatus ?? "").toLowerCase() === "compliant").length;
    return {
      greeting: greetingFor(data.meta?.user, context.approver),
      packageChoices: unanchored ? choices : [],
      packageChoiceRequired: unanchored,
      packageName: context.packageName,
      baselineCommittedMM: MM(committed),
      baselineMembers: members.length,
      showsMembers: members.length > 0,
      covenantFigure: covenants.length ? `${compliant}/${covenants.length}` : "—",
      loadSteps: ["Reading the package", "Maturities and terms", "What rolls forward", "Ready"],
      // THE PIN IS THE MATURITY, or nothing. It is the one figure the strip
      // above cannot show and the one this room is chosen on.
      askPin: lead?.maturityDate ? `Matures ${fmtDate(lead.maturityDate)}` : "",
      position: position(),
      sources: sources(),
      why: why(),
      whyCaveat:
        "Recommendation only. Nothing is written at all: the plan is staged, the token is held, and booking runs through nCino's own approval process. The agent recommends, the banker decides.",
      composeTarget: Math.max(1, suggestions.length),
      members: members.map((f) => toPackageMember(f, relationship, stagesStaged)),
      have: haveRows(),
    };
  }

  /* ------------------------------------------------------------ parseIntent */

  const RENEW_VERB = /\b(renew|renewal|renewing|roll\s*over|rollover|roll\s+forward|extend\s+the\s+facility)\b/i;

  function withCurrent(question: string, at?: Awaiting): string {
    if (!at?.facility) return question;
    const today = currentValue(at.field, at.facility);
    return today.startsWith("not ") || today.includes("not staged") ? question : `${question} Today it reads ${today}.`;
  }

  /** The question a renewal always ends up asking, with today's date beside it.
   *  `newMaturityDate` is `required=true` on the invocable AND re-checked in
   *  Apex, so this is the org's rule quoted, not a house style. */
  function askMaturity(facility: Facility): IntentResult {
    focus = facility;
    awaiting = { field: MATURITY_FIELD, facility };
    asked = true;
    const held = [
      typeof facility.committed === "number" ? `${fmtMoney(facility.committed)} committed` : null,
      typeof facility.interestRate === "number" ? `${facility.interestRate}%` : null,
      facility.maturityDate ? `matures ${fmtDate(facility.maturityDate)}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return {
      kind: "unparsed",
      reply: `${facilityProduct(facility, relationship)}${held ? `: ${held}` : ""}. What maturity does the renewal run to? A renewal is maturity-driven and the tool refuses a plan without the date.`,
    };
  }

  function notBooked(facility: Facility): IntentResult {
    focus = null;
    asked = false;
    const stage = (facility.stage ?? "").trim();
    return {
      kind: "unparsed",
      reply: `${facilityProduct(facility, relationship)} is ${stage ? `at ${stage}` : "carrying no stage in this read"}, and a renewal only runs against a booked facility. There is nothing on it I can renew here.`,
    };
  }

  function toResult(outcome: ReturnType<typeof parseModify>, seq: number): IntentResult | null {
    if (outcome.kind === "clarify")
      return {
        kind: "unparsed",
        reply: withCurrent(outcome.question, outcome.awaiting),
        options: clarifyChips(outcome.awaiting, outcome.options),
      };
    if (outcome.kind === "none") return null;
    // KEEP CURRENT — the banker held the term the renewal was waiting on. Say
    // the current figure back and stop asking; nothing stages, and the caller
    // clears `awaiting` because this is not a clarify.
    if (outcome.kind === "hold") {
      const cur = currentValue(outcome.field, outcome.facility);
      const at = cur.startsWith("not ") || cur.includes("not staged") ? "unchanged" : `at ${cur}`;
      return { kind: "unparsed", reply: `Holding ${outcome.field.label.toLowerCase()} ${at}. Nothing changes on it.` };
    }

    const deltas = outcome.amendments.map((a, i) => toDelta(a, seq + i));
    const fileable = deltas.filter((d) => d.fileable).length;
    const handed = deltas.length - fileable;
    const targets = [...new Set(deltas.map((d) => d.target))];
    const reply = [
      targets.length > 1 ? `That names a product this package carries ${targets.length} of, so it lands on all of them: ${targets.join(", ")}.` : null,
      fileable ? `${fileable} of these ${deltas.length === 1 ? "goes" : "go"} on the renewal plan.` : null,
      handed
        ? `${handed} ${handed === 1 ? "is" : "are"} staged for the record and handed off: no tool files ${handed === 1 ? "it" : "them"} on a renewal, and I will not pretend otherwise.`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    return { kind: "deltas", reply: reply || "Here is what that becomes.", deltas };
  }

  function settle(result: IntentResult): IntentResult {
    asked = result.kind === "unparsed";
    if (!asked) {
      deltaSeq += 8;
      suggestionIndex = Math.min(suggestionIndex + 1, suggestions.length);
    }
    return result;
  }

  async function parseIntent(text: string): Promise<IntentResult> {
    if (unanchored) {
      asked = true;
      return {
        kind: "unparsed",
        reply: `This relationship carries ${choices.length} packages and a renewal is anchored on one of them. Pick the package above and I will work inside it.`,
      };
    }

    // AN ANSWER TO THE LAST QUESTION comes first: "15 March 2029" is a complete
    // reply to "what maturity does the renewal run to", and reading it as a new
    // instruction would lose both the field and the member.
    if (awaiting) {
      const answered = parseAnswer(awaiting, text, parseContext());
      if (answered) {
        const result = toResult(answered, deltaSeq);
        if (result) {
          awaiting = answered.kind === "clarify" ? (answered.awaiting ?? awaiting) : null;
          return settle(result);
        }
      }
    }

    /* THE RENEWAL VERB, which the amendment catalog does not carry and should
       not: "renew the line" names no field. It names a MOVE, and the move's
       one required fact is the new maturity. So the verb selects the member and
       the room asks the question the tool would otherwise refuse over. */
    if (RENEW_VERB.test(text)) {
      const named = membersNamedIn(text, parseContext());
      const target = named[0] ?? focus ?? (named.length ? null : maturing.length === 1 ? maturing[0] : null);
      if (!target) {
        asked = true;
        const list = (maturing.length ? maturing : byMaturity).slice(0, 4).map((f) => `${facilityProduct(f, relationship)} (${fmtDate(f.maturityDate)})`);
        return {
          kind: "unparsed",
          reply: list.length
            ? `Which one? ${list.join(", ")}. Name it and I will take the new maturity next.`
            : "Which member should the renewal run against? Name one of the members above.",
        };
      }
      if (!booked.some((b) => b.loanId === target.loanId)) return settle(notBooked(target));

      // A DATE IN THE SAME BREATH is the whole instruction: "renew the line to
      // 15 March 2029" needs no second turn.
      const date = readDate(text.toLowerCase());
      if (date?.iso) {
        focus = target;
        awaiting = null;
        const result = toResult(
          { kind: "amendments", amendments: [{ field: MATURITY_FIELD, facility: target, value: { kind: "date", iso: date.iso, text: date.text }, matched: date.text, op: "change" }] },
          deltaSeq,
        );
        if (result) return settle(result);
      }
      if (date?.dayMissing) {
        focus = target;
        awaiting = { field: MATURITY_FIELD, facility: target };
        asked = true;
        return {
          kind: "unparsed",
          reply: `"${date.text}" names a month, and a maturity is a day. Give me the date and I will stage the renewal on it.`,
        };
      }
      return settle(askMaturity(target));
    }

    const parsed = parseModify(text, parseContext());
    awaiting = parsed.kind === "clarify" ? (parsed.awaiting ?? null) : null;
    const direct = toResult(parsed, deltaSeq);
    if (direct) return settle(direct);

    if (deps.restate && deps.available()) {
      const words = [...new Set(members.map((f) => facilityProduct(f, relationship)))].concat("renew", "maturity date", "interest rate", "covenant", "pledge", "guarantor");
      const restated = await deps.restate(text, words);
      if (restated) {
        const second = toResult(parseModify(restated, parseContext()), deltaSeq);
        if (second) return settle(second);
      }
    }

    const named = membersNamedIn(text, parseContext());
    const scope = "The new maturity and a repricing file on the renewal; everything else rolls forward on the clone and I stage it as a handoff with the reason.";
    asked = true;
    return {
      kind: "unparsed",
      reply: named.length
        ? `I read the ${named.map(memberName).join(" and the ")}, but not what should change on the renewal. ${scope}`
        : `I could not map that onto this package: it names no member I hold and no term I file. Name one of the members above and the maturity it renews to. ${scope}`,
    };
  }

  /* --------------------------------------------------------- picking a member */

  function pick(memberId: string): IntentResult | null {
    const facility = members.find((f) => (f.loanId ?? "") === memberId) ?? null;
    if (!facility) return null;
    if (!booked.some((b) => b.loanId === facility.loanId)) return notBooked(facility);
    return askMaturity(facility);
  }

  /* ------------------------------------------------- the confirm's answer */

  /** WHAT A LANDED TERM DID TO THE PACKAGE. A renewal does not move the
   *  committed total, so the package figure this room closes on is its
   *  MATURITY: the earliest date any member of it now runs to. */
  function packageMaturity(staged: WorkroomDelta[]): string {
    const today = byMaturity[0]?.maturityDate;
    if (!today) return `The package holds at ${fmtMoney(committed)} committed.`;
    const renewed = new Map<string, string>();
    for (const d of staged) {
      if (d.wire?.key === "newMaturityDate" && typeof d.wire.value === "string") renewed.set(d.wire.facilityId, d.wire.value);
    }
    if (!renewed.size) return `The package's next maturity holds at ${fmtDate(today)}.`;
    const after = byMaturity
      .map((f) => renewed.get(f.loanId ?? "") ?? f.maturityDate!)
      .sort()[0];
    return after === today
      ? `The package's next maturity holds at ${fmtDate(today)}.`
      : `That moves the package's next maturity from ${fmtDate(today)} to ${fmtDate(after)}.`;
  }

  /**
   * THE CHECKS A RENEWAL TRIPS, on the org's own figures and named as this
   * cockpit's arithmetic. Two, and each fires only on the term that causes it:
   * a new maturity moves the package's maturity wall, and a repricing moves the
   * annual interest on a commitment the org already staged.
   */
  function renewalCheck(delta: WorkroomDelta, staged: WorkroomDelta[]): WorkroomChallenge | undefined {
    if (delta.wire?.key === "newMaturityDate" && typeof delta.wire.value === "string") {
      const facility = members.find((f) => f.loanId === delta.wire!.facilityId);
      const from = facility?.maturityDate;
      const to = delta.wire.value;
      const extended = daysBetween(from, to);
      if (extended === null) return undefined;
      const renewed = new Set(staged.filter((d) => d.wire?.key === "newMaturityDate").map((d) => d.wire!.facilityId));
      const stillNear = byMaturity.filter((f) => {
        if (renewed.has(f.loanId ?? "")) return false;
        const days = daysBetween(asOf, f.maturityDate);
        return days !== null && days <= MATURITY_NEAR_WINDOW_DAYS;
      });
      return {
        id: `maturity:${delta.wire.facilityId}:${to}`,
        verdict: extended > 0 ? "Maturity extends" : "Maturity pulls in",
        tone: extended > 0 ? "ok" : "warn",
        kicker: "Derived here from the org's maturity dates",
        line: `${delta.target} runs to ${fmtDate(to)}, ${Math.abs(extended)} days ${extended > 0 ? "later" : "earlier"} than today's ${fmtDate(from)}. ${
          stillNear.length
            ? `${stillNear.length} other ${stillNear.length === 1 ? "member is" : "members are"} still inside ${MATURITY_NEAR_WINDOW_DAYS} days.`
            : `Nothing else on the package is inside ${MATURITY_NEAR_WINDOW_DAYS} days after this.`
        }`,
        rows: [
          ["Matures today", fmtDate(from)],
          ["Renews to", fmtDate(to), "key"],
          ["Days moved", `${extended > 0 ? "+" : ""}${extended}`, "sum"],
          ["Others still maturing near", String(stillNear.length)],
        ],
        say: "This is the cockpit's own arithmetic over the maturity dates the org staged. It is not a covenant test and it is not the org's own concentration view.",
      };
    }

    if (delta.wire?.key === "requestedRate" && typeof delta.wire.value === "number") {
      const facility = members.find((f) => f.loanId === delta.wire!.facilityId);
      const was = facility?.interestRate;
      const amount = facility?.committed;
      if (typeof was !== "number" || typeof amount !== "number") return undefined;
      const move = delta.wire.value - was;
      const annual = (move / 100) * amount;
      return {
        id: `reprice:${delta.wire.facilityId}:${delta.wire.value}`,
        verdict: move >= 0 ? "Repriced up" : "Repriced down",
        tone: move >= 0 ? "ok" : "warn",
        kicker: "Derived here from the org's committed figure",
        line: `${delta.target} moves from ${was}% to ${delta.wire.value}%. On the ${fmtMoney(amount)} committed that is ${fmtMoney(Math.abs(annual))} a year ${move >= 0 ? "more" : "less"}, fully drawn.`,
        rows: [
          ["Rate today", `${was}%`],
          ["Renews at", `${delta.wire.value}%`, "key"],
          ["Committed", fmtMoney(amount)],
          ["Annual interest, fully drawn", `${move >= 0 ? "+" : "−"}${fmtMoney(Math.abs(annual))}`, "sum"],
        ],
        say: "Simple interest on the committed figure, computed here. The org's own pricing streams are not in this read, so this is an indication of size and not a pricing model.",
      };
    }

    return undefined;
  }

  function acknowledge(delta: WorkroomDelta, staged: WorkroomDelta[]): WorkroomAcknowledgement {
    const landed = delta.fileable
      ? `${delta.title} on ${delta.target}: ${delta.before} → ${delta.after}, staged on the renewal.`
      : `${delta.title} on ${delta.target} is on the plan for the record. ${delta.handoff?.reason ?? "No tool files it on a renewal."}`;
    return { reply: `${landed} ${packageMaturity(staged)} ${vocabulary.nextMove}`, challenge: renewalCheck(delta, staged) };
  }

  /* -------------------------------------------------------------- stagePlan */

  /** The handoffs, appended before the org's own held-execution step: "this
   *  needs the clone and has no tool" belongs there in the reading. */
  function withHandoffs(plan: StagedOutput, handed: WorkroomDelta[]): StagedOutput {
    if (!handed.length) return plan;
    const steps: PlanStep[] = [];
    handed.forEach((d, i) => {
      steps.push({
        id: `handoff_${i}`,
        type: "handoff",
        label: `HANDOFF: ${d.title} on ${d.target} — ${d.handoff?.reason ?? "no tool files this on a renewal"}`,
      });
      (d.chainLinks ?? []).forEach((link, j) => {
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
        `${handed.length} staged ${handed.length === 1 ? "entry is" : "entries are"} handed off rather than staged onto the clone: no deployed tool carries ${handed.length === 1 ? "it" : "them"} on a renewal. The submitted summary names each one and why.`,
      ],
    };
  }

  /** ONE scalar per wire key, applied to every selected facility — the tool's
   *  own semantic. Two members renewing to different dates is not one plan. */
  function wirePayload(fileable: WorkroomDelta[], rationale: string): StagePayloads["renewal"] {
    const byKey = new Map<string, Set<number | string>>();
    for (const d of fileable) {
      if (!d.wire) continue;
      const set = byKey.get(d.wire.key) ?? new Set<number | string>();
      set.add(d.wire.value);
      byKey.set(d.wire.key, set);
    }
    for (const [key, values] of byKey) {
      if (values.size > 1) {
        throw new WorkroomRefusalError(
          `${key} travels as ONE value applied to every facility in the plan, and this renewal asks for ${values.size} different ones. Remove all but one and stage the rest as a second renewal.`,
        );
      }
    }
    const maturity = [...(byKey.get("newMaturityDate") ?? [])][0];
    if (typeof maturity !== "string") {
      throw new WorkroomRefusalError(
        "A renewal is maturity-driven: stage_renewal refuses a plan that carries no new maturity date, and it says so in those words. Name the date this renewal runs to and I will stage it.",
      );
    }
    return {
      idempotencyKey: idempotencyKey!,
      rationale,
      facilityIds: [...new Set(fileable.map((d) => d.wire!.facilityId))],
      productPackageId: context.productPackageId,
      newMaturityDate: maturity,
      requestedRate: ([...(byKey.get("requestedRate") ?? [])][0] as number | undefined) ?? null,
    };
  }

  async function stagePlan(deltas: WorkroomDelta[]): Promise<StagedWorkroomPlan> {
    if (!deps.available()) {
      throw new WorkroomRefusalError(
        "This view has no connector, so there is no org to stage against. Nothing here is simulated: the plan is the org's or there is no plan.",
      );
    }
    if (!context.productPackageId) {
      throw new WorkroomRefusalError(
        "A renewal is anchored on the product package — the tool declares productPackageId required — and this relationship stages none. There is nothing to renew.",
      );
    }

    const fileable = deltas.filter((d) => d.fileable && d.wire);
    const handed = deltas.filter((d) => !d.fileable);
    if (!fileable.length) {
      throw new WorkroomRefusalError(
        handed.length
          ? `Nothing in this plan reaches the renewal. All ${handed.length} ${handed.length === 1 ? "entry rolls" : "entries roll"} forward on the clone with no tool to change ${handed.length === 1 ? "it" : "them"}, and a renewal with no new maturity is not a renewal. Name the maturity date and I will stage it.`
          : "Nothing is staged, so there is no plan to build.",
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
    staged = { plan, planHash: plan.planHash, stagingId: plan.stagingId, decisionToken: plan.decisionToken ?? null };
    stagedDeltas = deltas;
    return staged;
  }

  /* ----------------------------------------------------------- the handoff */

  /** The ConfirmGate recompute, on the figures THIS plan was composed against. */
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
      const now = currentValue({ id: d.basis.fieldId } as CatalogField, facility);
      if (now !== d.basis.before) moved.push(`${d.title} on ${d.target} was ${d.basis.before}, and now reads ${now}.`);
    }
    return moved;
  }

  /**
   * THE FINAL BEAT, AND IT FILES NOTHING.
   *
   * It is called `execute` because that is the seam's name, and every check the
   * modification runs before a write runs here too — the allowlist mirror, the
   * record-id fence, the drift recompute, one use of one token. What does NOT
   * happen is the write, and that is the design: there is no `execute_renewal`
   * to call. The plan is staged with the org, the token stays unredeemed, and
   * the room hands into nCino's Submit for Approval in the org's own words.
   */
  /* NO TERMINAL-STATE GUARD HERE, AND THERE IS NOTHING TO GUARD. The other two
     engines refuse to build a filed list from a run the ORG reported failed;
     this one never calls an execute at all, because there is no
     `execute_renewal` on the org. Its `filed` rows name the staging record the
     stage call already returned and claim no write, so there is no org answer to
     be wrong about. */
  async function execute(approval: WorkroomApproval): Promise<WorkroomExecution> {
    if (!staged) throw new WorkroomRefusalError("Nothing has been staged, so there is no plan to submit.");
    if (approval.planHash !== staged.planHash || approval.stagingId !== staged.stagingId) {
      throw new WorkroomRefusalError("The plan changed after you confirmed it, so the confirmation no longer applies.");
    }
    if (spent.has(approval.decisionToken)) throw new WorkroomRefusalError("This confirmation has already been used.");

    const violations = validatePlan(staged.plan.steps);
    if (violations.length) {
      throw new WorkroomRefusalError(`This plan cannot be submitted: ${violations.map((v) => `step ${v.stepId}: ${v.reason}`).join("; ")}.`);
    }
    const leaks = assertNoRecordIds(staged.plan);
    if (leaks.length) throw new WorkroomRefusalError(`This plan cannot be submitted: ${leaks.join("; ")}.`);

    const moved = drift();
    if (moved.length) {
      throw new WorkroomRefusalError(
        `The figures moved under this plan, so it cannot be submitted as it stands. ${moved.join(" ")} Remove the affected entries and say them again; I will restage on what the org reads now.`,
      );
    }
    spent.add(approval.decisionToken);

    const fileableDeltas = stagedDeltas.filter((d) => d.fileable && d.wire);
    const filed = fileableDeltas.map((d) => ({
      deltaId: d.id,
      // THE ORG'S OWN STAGING ROW, which is the record that exists. No clone id
      // is claimed: no clone was created and none will be until nCino books it.
      recordId: staged!.stagingId,
      verification: "Staged on the renewal plan and persisted by the org. Nothing is written on the facility until nCino books the clone.",
    }));
    const handoffs = stagedDeltas
      .filter((d) => !d.fileable)
      .map((d) => ({ deltaId: d.id, title: `${d.title} · ${d.target}`, reason: d.handoff?.reason ?? "No tool files this on a renewal.", closes: d.handoff?.closes }));

    // The ORG's reason when it gives one, else the renewal's own. LV06 and a
    // client-side hold are different facts and must not borrow each other's words.
    const heldReason = staged.plan.heldReason ?? executionHeldReason("renewal") ?? "";

    return {
      filed,
      tokenNote: `Token minted for ${approval.approverUserId} and NOT redeemed · single use · ${filed.length} ${
        filed.length === 1 ? "term is" : "terms are"
      } on the staged plan, and no record was written`,
      handoff: `${heldReason} The renewal is staged; booking runs through nCino's Submit for Approval, driven by a human with real approvers. This room hands into that process and never around it.`,
      handoffs,
      reply: {
        subject: `${context.packageName}: renewal staged`,
        lede: staged.plan.summary,
        body: [
          packageMaturity(stagedDeltas),
          `${filed.length} ${filed.length === 1 ? "term is" : "terms are"} on the staged renewal of ${context.packageName}. Nothing has been written.`,
          ...fileableDeltas.map((d) => `- ${d.title} on ${d.target}: ${d.before} → ${d.after}`),
          handoffs.length
            ? `\n${handoffs.length} ${handoffs.length === 1 ? "item was" : "items were"} recorded on the renewal but not staged onto the clone, because no tool carries ${handoffs.length === 1 ? "it" : "them"}:\n` +
              handoffs.map((h) => `- ${h.title}: ${h.reason}`).join("\n")
            : "",
          `\n${heldReason}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    };
  }

  return {
    mode: "renew",
    scripted: false,
    brief,
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

/* ---------------------------------------------------------------- the deps */

export interface RenewEngineDeps {
  stage?: (payload: StagePayloads["renewal"]) => Promise<ToolOutcome<StagedOutput>>;
  /** Restates a line in the room's vocabulary. Never authors a delta. */
  restate?: Restate;
  available?: () => boolean;
  newKey?: () => string;
  /* NO `execute`. There is no `execute_renewal` on the org, and a dep for one
     would be a seam for a call that must never be made. */
}

const defaultDeps: Required<Omit<RenewEngineDeps, "restate">> & Pick<RenewEngineDeps, "restate"> = {
  stage: (payload) => stageAction("renewal", payload),
  available: mcpAvailable,
  newKey: newRequestId,
  restate: gatewayRestate,
};
