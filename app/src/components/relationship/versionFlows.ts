import type { Covenant, Facility } from "../../data/contract";
import { fmtCovThreshold, fmtCovVal } from "../../data/finance";
import { fmtMoney } from "../../data/format";
import { classifyCovenant } from "../../domain/covenantStatus";
import { stageRationale } from "../../actions/registry";
import { amendablePackage, type PackageEntry } from "../../book/packages";
import { collateralAssets, shortAssetTitle, type CollateralAsset } from "../../domain/collateralAssets";
import { clipTitle } from "../workroom/elicit";
import type { StagePayloads } from "../../channel/writeTools";
import type { IconKind } from "../workroom/TypeIcon";
import {
  INTAKE_OPERATORS,
  OPERATOR_WORD,
  bookCovenantTypes,
  collateralChips,
  collateralTypeNames,
  covenantTypeNames,
  dateChips,
  fmtThreshold,
  frequencyChips,
  inferOperator,
  readDate,
  resolveCollateralType,
  resolveCovenantType,
  DIRECTION_IS_A_PROPOSAL,
  OTHER_DATE,
  UNKNOWN_COLLATERAL_TYPE,
  UNKNOWN_COVENANT_TYPE,
  type IntakeOperator,
} from "./intakeFlows";
import { answered, num, text, type Answers, type RelStep, type StepOption } from "./relStep";
import type { PayloadResult, RelContext } from "./reviewFlows";

/* =============================================================================
   SHAPING THE VERSION IN PLACE: A COVENANT ONTO IT, COLLATERAL PLEDGED TO IT.

   THE GAP THIS CLOSES (founder, 2026-09-13): "a modification we created a day
   ago: add a covenant or collateral". 0.9.17 made the in-flight version a
   first-class STATE and locked every route that would fork a second one. It
   opened no route that changes anything INSIDE it, so a banker standing in
   their own unbooked version could read it and nothing else.

   WHAT THESE TWO ROUTES ARE, EXACTLY. `amend_version` carrying ONE arm. The
   frozen tool contract (knowledge/SPEC-0.9.23-TOOL-CONTRACT.md) reuses the
   modification's own authoring arms verbatim, landing on the version's OWN
   loans instead of on a clone, with no credit action behind them. So a covenant
   add here is `covenantAddsJson`, an attach is `covenantAttachesJson`, a pledge
   is `pledgeAddsJson`, and every JSON shape below is read off
   `StageLoanModification.cls`'s own invocable descriptions rather than composed
   here.

   WHAT THEY ARE NOT, AND EVERY PLAN CARD SAYS SO. No new version is forked, no
   credit action is taken, no figure on the booked package moves, and nothing is
   deleted. Those four are the facts a banker has to hear before the plan lands,
   because all four are things the neighbouring routes DO do.

   THE CATALOGS ARE THE INTAKE'S. A covenant type and a collateral type are the
   org's own records whichever room files them, so `intakeFlows.ts` owns the
   readers, the chip builders and the operator vocabulary, and this module
   imports them. A second covenant-type resolver beside that one is how the two
   rooms come to file different records under one name.
   ============================================================================= */

/* ---------------------------------------------------------- what is amendable */

/** Every package on the relationship that can be shaped in place. One list, one
 *  judgement, and it is `amendablePackage`'s. It is the same gate `StageAmendVersion`
 *  re-reads on the org at stage time and again at execute. */
export function amendablePackages(ctx: RelContext): PackageEntry[] {
  return ctx.packages.filter(amendablePackage);
}

/** The package this route is standing in, where it is one the room may shape.
 *  Null on a booked package, on a version the org has taken, and on nothing. */
export function amendTarget(ctx: RelContext): PackageEntry | null {
  const entry = ctx.packages.find((p) => p.id === ctx.productPackageId);
  return entry && amendablePackage(entry) ? entry : null;
}

/** THE ROUTE HAS NOTHING TO RUN AGAINST, said before it asks anything. The
 *  refusal names the gap AND the way on, because a refusal without a door is
 *  the dead end rule 4 forbids. */
export const NOTHING_AMENDABLE =
  "This relationship carries no version to shape: every package on it is booked, or its version is already at Approval / Loan Committee and no longer the banker's. " +
  "A change to a booked package is a modification, which forks a version in Facility Actions; a version in approval goes back a stage in Salesforce first.";

/** The version's own facilities, which are the only legal targets. */
export function versionMembers(ctx: RelContext): Facility[] {
  return (amendTarget(ctx)?.members ?? []).filter((f) => !!f.loanId);
}

/** The name a version facility reads under on a chip. */
function memberLabel(f: Facility): string {
  return (f.name ?? "").trim() || f.loanId || "facility";
}

/** One chip per version loan: the org's own name, its stage and its commitment.
 *  `blocked` names the members this particular pick may not land on. */
function memberChips(ctx: RelContext, blocked: Map<string, string> = new Map()): StepOption[] {
  return versionMembers(ctx).map((f) => {
    const reason = blocked.get(f.loanId!);
    return {
      label: memberLabel(f),
      value: f.loanId!,
      detail: [f.stage, typeof f.committed === "number" ? `${fmtMoney(f.committed)} committed` : null]
        .filter(Boolean)
        .join(" · "),
      disabled: Boolean(reason),
      reason,
    };
  });
}

/** The one member, where the version holds exactly one. A choice of one is not
 *  a choice, so the room binds it and names it in the plan rather than asking. */
function soleMember(ctx: RelContext): string | null {
  const members = versionMembers(ctx);
  return members.length === 1 ? members[0].loanId! : null;
}

/* ============================================================ THE COVENANT

   ADD, OR ATTACH THE ONE THE BORROWER ALREADY HOLDS. The two are different
   writes and the difference matters: `covenantAddsJson` resolves a TYPE and
   always inserts a fresh `LLC_BI__Covenant2__c`, while `covenantAttachesJson`
   writes the junction alone, so the threshold, the frequency and the schedule
   stay exactly as the borrower holds them. Authoring a second covenant of a
   type the relationship already carries is a real thing a bank does (a stepped
   threshold, a different basis), so the room ASKS rather than refusing either
   way.                                                                       */

/** How many org names go on the glass at once. The org holds 71 covenant types
 *  and a chip set of 71 is a list, not a question. The intake's own cap. */
const CHIP_CAP = 10;

/** The covenants the relationship already holds that the org gave an id. Only
 *  those are attachable: the arm is anchored on `covenantId`. */
export function attachableCovenants(ctx: RelContext): Covenant[] {
  return (ctx.bundle?.covenants?.covenants ?? []).filter((c) => !!c.covenantId);
}

/**
 * WHERE A COVENANT ON FILE STANDS, in the room's own glyphs.
 *
 * `1.38x vs >= 1.25x`, built through `fmtCovVal` and `fmtCovThreshold`, which are the
 * same two formatters `relBook.railFor` builds the greeting's rail with, so a
 * covenant reads identically on the attach chip and on every other surface in
 * this room. It is NOT imported from `relBook`: that module imports
 * `reviewFlows`, which imports this one, and a value cycle through three files
 * is a load order nobody can reason about.
 */
export function covenantRail(c: Covenant): string | null {
  if (typeof c.actualValue !== "number" || typeof c.thresholdValue !== "number") return null;
  return `${fmtCovVal(c.actualValue, c.covenantType)} vs ${fmtCovThreshold(c.covenantType, c.actualValue, c.thresholdValue)}`;
}

/** How one reads on an attach chip: where it stands, the org's own verdict on
 *  it, and the schedule it runs on. */
export function covenantChipDetail(c: Covenant): string {
  return [covenantRail(c), classifyCovenant(c).label, c.frequency].filter(Boolean).join(" · ");
}

/** The org's own type names, what this relationship already tests leading. */
function typeChips(ctx: RelContext): StepOption[] {
  const names = covenantTypeNames(ctx);
  const held = bookCovenantTypes(ctx);
  const heldSet = new Set(held.map((t) => t.toLowerCase()));
  const ordered = [
    ...held.filter((t) => names.some((n) => n.toLowerCase() === t.toLowerCase())),
    ...names.filter((n) => !heldSet.has(n.toLowerCase())),
  ];
  return ordered.slice(0, CHIP_CAP).map((n) => ({
    label: n,
    value: n,
    detail: heldSet.has(n.toLowerCase()) ? "already tested on this relationship" : undefined,
  }));
}

/** The chip a banker takes to author a fresh covenant beside the one on file. */
export const AUTHOR_A_NEW_ONE = "__author_new__";

export interface VersionCovenantDraft {
  /** The org's own type name, resolved. Null until it is. */
  typeName: string | null;
  /** The covenant being ATTACHED, where the banker took one off the book. */
  attach: Covenant | null;
  operator: IntakeOperator | null;
  threshold: number | null;
  frequency: string | null;
  effectiveDate: string | null;
  /** The version facility this lands on. */
  targetLoanId: string | null;
}

export function versionCovenantDraft(ctx: RelContext, a: Answers): VersionCovenantDraft {
  const names = covenantTypeNames(ctx);
  const said = text(a.vcPick) ?? text(a.vcType);
  const typeName = said ? resolveCovenantType(said, names) : null;

  const picked = text(a.vcAttach);
  const attachId = picked && picked !== AUTHOR_A_NEW_ONE ? picked : null;
  const attach = attachId ? (attachableCovenants(ctx).find((c) => c.covenantId === attachId) ?? null) : null;

  const dated = text(a.vcEffective);
  return {
    typeName,
    attach,
    operator: (text(a.vcOperator) as IntakeOperator | null) ?? (typeName ? inferOperator(typeName) : null),
    threshold: num(a.vcThreshold),
    frequency: text(a.vcFrequency),
    effectiveDate:
      readDate(text(a.vcEffectiveOther) ?? "") ?? (dated && dated !== OTHER_DATE ? readDate(dated) : null),
    targetLoanId: text(a.vcTarget) ?? soleMember(ctx),
  };
}

function versionCovenantStep(ctx: RelContext, a: Answers): RelStep | null {
  const names = covenantTypeNames(ctx);
  const draft = versionCovenantDraft(ctx, a);
  const target = amendTarget(ctx);

  if (!answered(a, "vcType")) {
    const chips = typeChips(ctx);
    const more = names.length - chips.length;
    return {
      key: "vcType",
      /* THE QUESTION LEADS WITH WHERE THE WRITE LANDS (rule 2). The banker is
         about to file a covenant onto a package nobody has booked, and which
         package that is decides everything downstream. */
      ask: `Which test is this covenant, on ${target?.name ?? "this version"}?`,
      kind: "text",
      options: chips.length ? chips : undefined,
      placeholder: chips.length
        ? more > 0
          ? `Pick one, or name any of the org's ${names.length} covenant types.`
          : "Pick one, or name the test."
        : "Name the test, exactly as the org holds it.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Covenant_Type__c" },
    };
  }

  /* A NAME THE ORG DOES NOT HOLD IS REFUSED BY NAME, and the question is asked
     again with the org's own names. The tool matches the type exactly, so a
     near miss here is a refusal the banker reads instead of an answer they can
     give. Asked ONCE: a chips step refuses anything but its own values, so a
     second unresolved answer can only come from the step counter's probe walk,
     and returning null there is what makes that walk terminate. */
  if (!draft.typeName) {
    if (answered(a, "vcPick")) return null;
    return {
      key: "vcPick",
      ask: UNKNOWN_COVENANT_TYPE(text(a.vcType) ?? ""),
      kind: "chips",
      options: typeChips(ctx),
      placeholder: "Pick the org's own name for it.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Covenant_Type__c" },
    };
  }

  /* THE RELATIONSHIP ALREADY HOLDS THIS TEST, so the room offers the junction
     before it offers a duplicate. Attaching writes NO covenant field: the
     threshold, the direction and the schedule stay exactly as the borrower
     holds them, which is the whole reason the two arms are separate. */
  const held = attachableCovenants(ctx).filter(
    (c) => (c.covenantType ?? "").trim().toLowerCase() === draft.typeName!.toLowerCase(),
  );
  if (held.length && !answered(a, "vcAttach")) {
    return {
      key: "vcAttach",
      ask: `This relationship already carries ${held.length === 1 ? `a ${draft.typeName} covenant` : `${held.length} ${draft.typeName} covenants`}. Attach ${held.length === 1 ? "it" : "one"} to the version, or author a new one?`,
      kind: "chips",
      options: [
        ...held.map((c) => ({
          label: `Attach the ${covenantLabelOf(c)} on file`,
          value: c.covenantId!,
          detail: covenantChipDetail(c) || "the covenant the borrower already holds",
        })),
        {
          label: "Author a new one",
          value: AUTHOR_A_NEW_ONE,
          detail: "A second covenant of this type, with its own threshold and its own schedule.",
        },
      ],
      placeholder: "Attach the one on file, or author a new one.",
      target: { object: "LLC_BI__Loan_Covenant__c", field: "LLC_BI__Covenant__c" },
    };
  }

  /* AN ATTACH IS DONE ASKING. Nothing below is on the junction's wire, and a
     question whose answer cannot be filed is a question that should not be put. */
  if (!draft.attach) {
    /* THE DIRECTION THE BANK'S OWN FAMILY RUNS IN, offered as a PROPOSAL and
       never taken silently (doctrine C). Where the family settles nothing the
       question stands on its own and the room says it will not guess, which is
       the same sentence the intake asks it with. */
    if (!answered(a, "vcOperator")) {
      const inferred = inferOperator(draft.typeName);
      return {
        key: "vcOperator",
        ask: inferred
          ? `Which way does the ${draft.typeName} test run? On the bank's own families that runs as a "${OPERATOR_WORD[inferred]}" test. ${DIRECTION_IS_A_PROPOSAL}`
          : `Which way does the ${draft.typeName} test run? The bank's families do not settle the direction on this one, so I will not guess it.`,
        kind: "chips",
        options: INTAKE_OPERATORS.map((op) => ({
          label: `${OPERATOR_WORD[op]} (${op})`,
          value: op,
          detail: inferred === op ? "the direction the bank's own family runs" : undefined,
        })),
        placeholder: "Pick the direction.",
        target: { object: "LLC_BI__Covenant2__c", field: "Acnpex_Operator__c" },
      };
    }
    if (draft.threshold === null && !answered(a, "vcThreshold")) {
      return {
        key: "vcThreshold",
        ask: draft.operator
          ? `And the figure the ${draft.typeName} test ${OPERATOR_WORD[draft.operator]}?`
          : `And the figure the ${draft.typeName} test is measured against?`,
        kind: "number",
        placeholder: "The threshold, from the approved credit agreement.",
        target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Financial_Indicator_Value__c" },
      };
    }
    if (!draft.frequency && !answered(a, "vcFrequency")) {
      return {
        key: "vcFrequency",
        ask: "How often is it tested?",
        kind: "chips",
        options: frequencyChips(ctx),
        placeholder: "The schedule the agreement sets.",
        target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Frequency__c" },
      };
    }
    /* THE DATE IS ASKED TWICE AT MOST: once with the offers, once on its own
       where neither fitted and what was written was not a date. Past that the
       draft is simply not complete and the payload refuses it by name. */
    if (!draft.effectiveDate && !answered(a, "vcEffectiveOther")) {
      if (!answered(a, "vcEffective")) {
        return {
          key: "vcEffective",
          ask: `From what date does the ${draft.typeName} test run? ${EFFECTIVE_DATE_ON_A_VERSION}`,
          kind: "text",
          options: dateChips(ctx),
          placeholder: "Pick one, or give me the date as YYYY-MM-DD.",
          target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Effective_Date__c" },
        };
      }
      return {
        key: "vcEffectiveOther",
        ask: "What date does it run from?",
        kind: "date",
        placeholder: "YYYY-MM-DD.",
        target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Effective_Date__c" },
      };
    }
  }

  /* AND WHICH FACILITY ON THE VERSION IT TESTS. Asked only where the version
     holds more than one: a choice of one is not a choice, and the plan names
     the member either way. */
  if (!draft.targetLoanId && !answered(a, "vcTarget")) {
    return {
      key: "vcTarget",
      ask: "Which facility on the version does it test?",
      kind: "chips",
      options: memberChips(ctx),
      placeholder: "Pick the facility.",
      target: { object: "LLC_BI__Loan_Covenant__c", field: "LLC_BI__Loan__c" },
    };
  }
  return null;
}

/** The effective date is the schedule's anchor and it is never updated after. */
export const EFFECTIVE_DATE_ON_A_VERSION =
  "The effective date is set once at creation and never updated: it is what the whole compliance schedule is counted from.";

function covenantLabelOf(c: Covenant): string {
  return (c.covenantType ?? "").trim() || "covenant";
}

/* ============================================================ THE PLEDGE

   AN ASSET THE BORROWER ALREADY OWNS, OR ONE FILED WITH THE PLEDGE. The org's
   own rule decides which questions follow: an existing asset resolves the type's
   own advance rate and needs neither, a new one is REQUIRED to state an advance
   rate and the org's `Advance_Rate_Override` rule then demands a reason beside
   it.                                                                        */

/** The chip a banker takes to file the asset with the pledge. */
export const A_NEW_ASSET = "__new_asset__";

/** The org refuses a description past the field's own length rather than
 *  truncating it, so the room refuses it first, with the length. */
export const DESCRIPTION_CAP = 255;
export const DESCRIPTION_TOO_LONG = (n: number): string =>
  `That description is ${n} characters and LLC_BI__Description__c on this org holds ${DESCRIPTION_CAP}. The tool refuses a longer one rather than truncating it, so give me a shorter one.`;

export const VALUE_MUST_BE_POSITIVE =
  "A collateral value cannot be zero or negative. The org refuses it on the insert, and an asset worth nothing is not an asset the bank records.";

export const ADVANCE_RATE_BOUNDS =
  "An advance rate is a percentage from 0 to 100. It rides LLC_BI__Advance_Rate_Override__c, because the plain advance rate on the pledge is a formula.";

export interface VersionPledgeDraft {
  /** The asset the borrower already owns, where the banker took one. */
  asset: CollateralAsset | null;
  /** The type of the asset being filed with the pledge. Null on an existing. */
  collateralType: string | null;
  description: string | null;
  value: number | null;
  advanceRate: number | null;
  advanceRateReason: string | null;
  /** The amount this facility's pledge claims. Null means the tool's own
   *  default, which is the asset's lendable value. */
  amountPledged: number | null;
  authoriseOverPledge: boolean;
  targetLoanId: string | null;
  /** The lendable value this pledge resolves to, where the room can derive it:
   *  the asset's value at the rate the pledge will use. Null where it cannot. */
  lendable: number | null;
}

/** Every asset the borrower owns, as the collateral pane reads them. */
export function ownedAssets(ctx: RelContext): CollateralAsset[] {
  return collateralAssets(ctx.bundle).filter((asset) => !!asset.collateralId);
}

function assetChipLabel(asset: CollateralAsset): string {
  return clipTitle(shortAssetTitle(asset.collateralType, asset.description), 60);
}

export function versionPledgeDraft(ctx: RelContext, a: Answers): VersionPledgeDraft {
  const source = text(a.vpSource);
  const assetId = source && source !== A_NEW_ASSET ? source : null;
  const asset = assetId ? (ownedAssets(ctx).find((x) => x.collateralId === assetId) ?? null) : null;

  const names = collateralTypeNames(ctx);
  const said = text(a.vpPick) ?? text(a.vpType);
  const collateralType = asset ? null : said ? resolveCollateralType(said, names) : null;

  const advanceRate = num(a.vpAdvanceRate);
  const value = asset ? asset.value : num(a.vpValue);
  /* THE LENDABLE VALUE THIS PLEDGE RESOLVES TO, derived the way the org derives
     it: the asset's value at the rate the pledge will use, which is the
     override where one is stated and the asset's own rate otherwise. Null where
     the room holds neither, and a null lendable proposes nothing. */
  const rate = advanceRate ?? asset?.advanceRate ?? null;
  const lendable =
    advanceRate === null && asset?.lendableValue != null
      ? asset.lendableValue
      : value !== null && rate !== null
        ? round2((value * rate) / 100)
        : null;

  return {
    asset,
    collateralType,
    description: asset ? (asset.description ?? asset.collateralName ?? null) : text(a.vpDescription),
    value,
    advanceRate,
    advanceRateReason: text(a.vpAdvanceReason),
    amountPledged: num(a.vpAmount),
    authoriseOverPledge: text(a.vpAuthorise) === "authorise",
    targetLoanId: text(a.vpTarget) ?? soleMember(ctx),
    lendable,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function versionPledgeStep(ctx: RelContext, a: Answers): RelStep | null {
  const draft = versionPledgeDraft(ctx, a);
  const target = amendTarget(ctx);
  const owned = ownedAssets(ctx);

  /* THE FIRST QUESTION IS A CHOICE, AND ONLY WHERE THERE IS ONE. A borrower the
     read carries no asset for has nothing to choose between, so the room goes
     straight to filing one rather than asking "which asset" over a list of one
     chip and then asking for its type underneath the answer. */
  if (owned.length && !answered(a, "vpSource")) {
    return {
      key: "vpSource",
      ask: `Which asset are we pledging to ${target?.name ?? "this version"}?`,
      kind: "chips",
      options: [
        ...owned.map((asset) => ({
          label: assetChipLabel(asset),
          value: asset.collateralId!,
          /* THE LENDABLE VALUE IS THE CREDIT FIGURE and it leads, because that
             is what the pledge will default to. The asset's own value is beside
             it, and where it already secures something the room says so rather
             than letting the org refuse a duplicate pledge later. */
          detail: [
            asset.lendableValue !== null ? `${fmtMoney(asset.lendableValue)} lendable` : null,
            asset.value !== null ? `${fmtMoney(asset.value)} value` : null,
            asset.pledges.length
              ? `already pledged to ${asset.pledges.length} ${asset.pledges.length === 1 ? "facility" : "facilities"}`
              : "unpledged",
          ]
            .filter(Boolean)
            .join(" · "),
          synonyms: [asset.collateralName, asset.collateralType].filter((x): x is string => Boolean(x && x.trim())),
        })),
        { label: "File a new asset", value: A_NEW_ASSET, detail: "The asset, the borrower's ownership of it, and the pledge." },
      ],
      placeholder: "Pick the asset, or file a new one.",
      target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Collateral__c" },
    };
  }

  /* THE NEW-ASSET CHAIN. Type, description, value, and the advance rate the org
     REQUIRES on a create. Nothing here runs on an existing asset: its type, its
     description and its value are the org's already. */
  if (!draft.asset) {
    const names = collateralTypeNames(ctx);
    if (!answered(a, "vpType") && !draft.collateralType) {
      return {
        key: "vpType",
        ask: owned.length
          ? "What kind of asset is it?"
          : `The read carries no asset this borrower owns, so this pledge files one. What kind of asset is it?`,
        kind: "text",
        options: collateralChips(ctx),
        placeholder: names.length ? "Pick a family, or name the type." : "Name the collateral type as the org holds it.",
        target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Collateral_Type__c" },
      };
    }
    if (!draft.collateralType) {
      if (answered(a, "vpPick")) return null;
      return {
        key: "vpPick",
        ask: UNKNOWN_COLLATERAL_TYPE(text(a.vpType) ?? ""),
        kind: "chips",
        options: names.slice(0, CHIP_CAP).map((n) => ({ label: n, value: n })),
        placeholder: "Pick the org's own name for it.",
        target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Collateral_Type__c" },
      };
    }
    if (!draft.description && !answered(a, "vpDescription")) {
      return {
        key: "vpDescription",
        ask: "How is the asset described? This is what everyone downstream reads it under.",
        kind: "text",
        placeholder: `The asset, in the bank's own words. At most ${DESCRIPTION_CAP} characters.`,
        target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Description__c" },
      };
    }
    if (draft.value === null && !answered(a, "vpValue")) {
      return {
        key: "vpValue",
        ask: `What is ${draft.description ?? "the asset"} worth?`,
        kind: "number",
        bounds: { min: 0.01, max: Number.MAX_SAFE_INTEGER, whole: false, refusal: VALUE_MUST_BE_POSITIVE },
        placeholder: "The value, in dollars.",
        target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Value__c" },
      };
    }
    /* THE ADVANCE RATE IS REQUIRED ON A CREATE, and the org's own rule is why:
       the plain advance rate on a pledge is a FORMULA, so a stated rate rides
       `LLC_BI__Advance_Rate_Override__c`, and an override makes the org's
       `Advance_Rate_Override` rule demand a reason beside it. */
    if (draft.advanceRate === null && !answered(a, "vpAdvanceRate")) {
      return {
        key: "vpAdvanceRate",
        ask: `What advance rate does the bank lend against ${draft.description ?? "it"} at? ${ADVANCE_RATE_BOUNDS}`,
        kind: "number",
        bounds: { min: 0, max: 100, whole: false, refusal: ADVANCE_RATE_BOUNDS },
        placeholder: "The rate, as a percentage.",
        target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Advance_Rate_Override__c" },
      };
    }
    if (!answered(a, "vpAdvanceReason")) {
      return {
        key: "vpAdvanceReason",
        ask: "The org requires a reason with any advance-rate override. State it, or skip it and the tool files a provenance line saying where the figure came from.",
        kind: "text",
        optional: true,
        placeholder: "The reason for the rate, or skip it.",
        target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Advance_Rate_Reason__c" },
      };
    }
  }

  /* THE FACILITY'S SHARE. The lendable value leads and is OFFERED, which is the
     tool's own default and the figure the room can derive; the banker still
     answers. Left unstated the tool uses the lendable value itself. */
  if (draft.amountPledged === null && !answered(a, "vpAmount")) {
    const lendable = draft.lendable;
    return {
      key: "vpAmount",
      ask: lendable !== null
        ? `How much of ${draft.description ?? "the asset"} does this facility claim? ${fmtMoney(lendable)} is its lendable value at the rate this pledge resolves to, which is what the tool files where nothing is stated.`
        : `How much of ${draft.description ?? "the asset"} does this facility claim? The read carries no advance rate for it, so the room derives no lendable value and proposes nothing.`,
      kind: "number",
      optional: true,
      options:
        lendable !== null
          ? [{ label: fmtMoney(lendable), value: String(lendable), detail: "the lendable value, which is the tool's own default", onFile: true }]
          : undefined,
      placeholder: lendable !== null ? `The figure, or skip it and ${fmtMoney(lendable)} is used.` : "The figure, in dollars, or skip it.",
      target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Amount_Pledged__c" },
    };
  }

  /* OVER THE LENDABLE VALUE IS THE ORG'S OWN REFUSAL, and it has exactly one
     way through: `LLC_BI__Authorize__c`. The room asks for it out loud, because
     the flag records the banker authorising the over-pledge on the row rather
     than the tool setting it silently. */
  if (
    draft.amountPledged !== null &&
    draft.lendable !== null &&
    draft.amountPledged > draft.lendable &&
    !answered(a, "vpAuthorise")
  ) {
    return {
      key: "vpAuthorise",
      ask: `${fmtMoney(draft.amountPledged)} is more than the ${fmtMoney(draft.lendable)} this asset is lendable for. The org's Pledge_More_Than_Lendable_Value rule refuses that row unless the Authorize Pledge Amount checkbox is set. Authorise it?`,
      kind: "chips",
      options: [
        { label: "Authorise the over-pledge", value: "authorise", detail: "The checkbox is set on the row and the plan says in words that you authorised it." },
        { label: `Take the ${fmtMoney(draft.lendable)} lendable value`, value: "lendable", detail: "The pledge files at the lendable value and nothing is authorised." },
      ],
      placeholder: "Authorise it, or take the lendable value.",
      target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Authorize__c" },
    };
  }

  if (!draft.targetLoanId && !answered(a, "vpTarget")) {
    /* A SECOND PLEDGE OF ONE ASSET TO ONE FACILITY IS REFUSED BY THE ORG, so
       the member it already secures is shown and disabled with that reason
       rather than offered and refused at the confirm gate. */
    const blocked = new Map<string, string>();
    for (const p of draft.asset?.pledges ?? []) {
      if (p.loanId) blocked.set(p.loanId, "This asset is already pledged to that facility, and the org refuses a duplicate pledge.");
    }
    return {
      key: "vpTarget",
      ask: "Which facility on the version does it secure?",
      kind: "chips",
      options: memberChips(ctx, blocked),
      placeholder: "Pick the facility.",
      target: { object: "LLC_BI__Loan_Collateral2__c", field: "LLC_BI__Loan__c" },
    };
  }
  return null;
}

/* ------------------------------------------------------------ the machine */

/** The next question either version route asks, or null when it has everything
 *  its arm demands. Null is the readiness test and it is the only one. */
export function versionStep(route: "versionCovenant" | "versionPledge", ctx: RelContext, a: Answers): RelStep | null {
  return route === "versionCovenant" ? versionCovenantStep(ctx, a) : versionPledgeStep(ctx, a);
}

/* ============================================================ THE PAYLOAD

   ONE ARM PER ROUTE, and every JSON shape below is the one
   `StageLoanModification.cls` declares on its own invocable variable. Nothing
   is composed here that the modification's wire does not already carry, which
   is the whole reason `amend_version` reuses those arms verbatim.            */

export interface VersionCovenantAddWire {
  typeName: string;
  threshold: number;
  operator: string;
  frequency: string;
  effectiveDate: string;
  targetLoanId: string;
}

export interface VersionCovenantAttachWire {
  covenantId: string;
  targetLoanId: string;
}

export interface VersionPledgeWire {
  collateralId?: string;
  newCollateral?: { description: string; collateralType: string; value: number };
  advanceRate?: number;
  advanceRateReason?: string;
  amountPledged?: number;
  authoriseOverPledge?: boolean;
  targetLoanId: string;
}

const NOT_COMPLETE = (what: string): string =>
  `Nothing on this ${what} is complete enough to file. It travels only with everything the org needs on it, and a half-answered one is never staged under a default.`;

const NO_VERSION_ANCHOR =
  "This route lands on an unbooked version and none is anchored, so there is nothing to stage against.";

export function buildVersionPayload(
  route: "versionCovenant" | "versionPledge",
  ctx: RelContext,
  a: Answers,
  idempotencyKey: string,
): PayloadResult {
  const entry = amendTarget(ctx);
  if (!entry) return { ok: false, blocked: NO_VERSION_ANCHOR };
  const members = new Set(versionMembers(ctx).map((f) => f.loanId));

  const rationale = stageRationale({
    actionId: "amend-version",
    accountName: ctx.accountName,
    typed: versionRationale(route, ctx, a),
  });

  if (route === "versionCovenant") {
    const d = versionCovenantDraft(ctx, a);
    if (!d.targetLoanId || !members.has(d.targetLoanId)) return { ok: false, blocked: TARGET_OFF_THE_VERSION };
    if (d.attach?.covenantId) {
      const attaches: VersionCovenantAttachWire[] = [{ covenantId: d.attach.covenantId, targetLoanId: d.targetLoanId }];
      return {
        ok: true,
        payload: {
          idempotencyKey,
          rationale,
          versionPackageId: entry.id,
          covenantAttachesJson: JSON.stringify(attaches),
        } satisfies StagePayloads["amend-version"],
      };
    }
    if (!d.typeName || !d.operator || d.threshold === null || !d.frequency || !d.effectiveDate) {
      return { ok: false, blocked: NOT_COMPLETE("covenant") };
    }
    const adds: VersionCovenantAddWire[] = [
      {
        typeName: d.typeName,
        threshold: d.threshold,
        operator: d.operator,
        frequency: d.frequency,
        effectiveDate: d.effectiveDate,
        targetLoanId: d.targetLoanId,
      },
    ];
    return {
      ok: true,
      payload: {
        idempotencyKey,
        rationale,
        versionPackageId: entry.id,
        covenantAddsJson: JSON.stringify(adds),
      } satisfies StagePayloads["amend-version"],
    };
  }

  const d = versionPledgeDraft(ctx, a);
  if (!d.targetLoanId || !members.has(d.targetLoanId)) return { ok: false, blocked: TARGET_OFF_THE_VERSION };
  const row: VersionPledgeWire = { targetLoanId: d.targetLoanId };
  if (d.asset?.collateralId) {
    row.collateralId = d.asset.collateralId;
  } else {
    if (!d.collateralType || !d.description || d.value === null) return { ok: false, blocked: NOT_COMPLETE("pledge") };
    if (d.value <= 0) return { ok: false, blocked: VALUE_MUST_BE_POSITIVE };
    if (d.description.length > DESCRIPTION_CAP) return { ok: false, blocked: DESCRIPTION_TOO_LONG(d.description.length) };
    /* EXACTLY ONE OF `collateralId` AND `newCollateral`, and the org enforces
       the difference: an existing asset must be proven owned through
       `LLC_BI__Account_Collateral__c`, a new one authors that junction itself. */
    row.newCollateral = { description: d.description, collateralType: d.collateralType, value: d.value };
    if (d.advanceRate === null) return { ok: false, blocked: NOT_COMPLETE("pledge") };
  }
  if (d.advanceRate !== null) {
    row.advanceRate = d.advanceRate;
    if (d.advanceRateReason) row.advanceRateReason = d.advanceRateReason;
  }
  /* THE AMOUNT TRAVELS ONLY WHERE THE BANKER STATED ONE. An absent key is the
     tool's own default of the lendable value; sending the derived figure would
     claim the room computed what the org computes. */
  if (d.amountPledged !== null) {
    row.amountPledged = d.amountPledged;
    /* AND THE FLAG ONLY WHERE IT DOES WORK. Sent on a pledge within the
       lendable value the org ignores it, so sending it there would put a
       checkbox on the wire for a decision nobody had to make. */
    if (d.lendable !== null && d.amountPledged > d.lendable) {
      if (!d.authoriseOverPledge) return { ok: false, blocked: OVER_PLEDGE_NOT_AUTHORISED(d.amountPledged, d.lendable) };
      row.authoriseOverPledge = true;
    }
  }
  return {
    ok: true,
    payload: {
      idempotencyKey,
      rationale,
      versionPackageId: entry.id,
      pledgeAddsJson: JSON.stringify([row]),
    } satisfies StagePayloads["amend-version"],
  };
}

/** The target is not a member of the version, which the org refuses by name. */
export const TARGET_OFF_THE_VERSION =
  "This plan names a facility that is not a member of the version it would land on. Every target on an amendment is a member of the version's own package, and the org refuses anything else.";

export const OVER_PLEDGE_NOT_AUTHORISED = (amount: number, lendable: number): string =>
  `A pledge of ${fmtMoney(amount)} is more than the ${fmtMoney(lendable)} this asset is lendable for, and nobody has authorised the over-pledge. The org's own rule refuses the row without it.`;

/** The audit rationale, in the banker's own register. It is what the trail row
 *  will read under, so it names the write, the member and the version. */
function versionRationale(route: "versionCovenant" | "versionPledge", ctx: RelContext, a: Answers): string {
  const entry = amendTarget(ctx);
  const where = `${entry?.name ?? "the version in flight"} on ${ctx.accountName}`;
  if (route === "versionCovenant") {
    const d = versionCovenantDraft(ctx, a);
    const member = memberNameOf(ctx, d.targetLoanId);
    if (d.attach) {
      return `Attaching the ${covenantLabelOf(d.attach)} covenant the borrower already holds to ${member} on ${where}, from the approved credit terms.`;
    }
    const test = d.operator && d.threshold !== null ? `${d.operator} ${fmtThreshold(d.threshold)}` : "the agreed terms";
    return `Authoring a ${d.typeName ?? "covenant"} covenant at ${test} on ${member} on ${where}, from the approved credit terms.`;
  }
  const d = versionPledgeDraft(ctx, a);
  const member = memberNameOf(ctx, d.targetLoanId);
  const what = d.asset ? `the ${d.description ?? "asset"} the borrower already owns` : `a new ${d.collateralType ?? "collateral"} asset`;
  return `Pledging ${what} to ${member} on ${where}, from the approved credit terms.`;
}

function memberNameOf(ctx: RelContext, loanId: string | null): string {
  const f = versionMembers(ctx).find((m) => m.loanId === loanId);
  return f ? memberLabel(f) : "the version facility";
}

/* ============================================================ THE NARRATIVE

   EVERY PLAN CARD EXPLAINS AND CONNECTS (0.9.23 brief, golden rule 3). Three
   things, in this order and always all three:

     WHAT IT CHANGES   the write, the version member it lands on, the version.
     WHAT IT DOES NOT  no new version, no credit action, nothing on the booked
                       package, nothing deleted. All four are things the
                       neighbouring routes DO do, which is why all four are said.
     WHAT FOLLOWS      the effect the ROOM can derive from the read it is
                       holding: coverage after the pledge, out of the bundle's
                       own collateral pool; the covenant's re-test, where a ratio
                       for it exists on file. Derived and SAID to be derived;
                       never a figure claimed back from the org.              */

/** The second sentence, and it is the same on both routes because the four
 *  facts are the same four. */
export const AMEND_DOES_NOT =
  "It forks no new version, it takes no credit action, it moves no figure on the booked package behind this one, and it deletes nothing.";

export function versionPlanNarrative(
  route: "versionCovenant" | "versionPledge",
  ctx: RelContext,
  a: Answers,
): string {
  const entry = amendTarget(ctx);
  const version = entry?.name ?? "the version in flight";
  if (route === "versionCovenant") {
    const d = versionCovenantDraft(ctx, a);
    const member = memberNameOf(ctx, d.targetLoanId);
    const what = d.attach
      ? `This attaches the ${covenantLabelOf(d.attach)} covenant the borrower already holds to ${member} on ${version}, and writes no covenant field: the threshold, the direction and the schedule stay exactly as the borrower holds them.`
      : `This authors a ${d.typeName ?? "covenant"} covenant${
          d.operator && d.threshold !== null ? ` at ${d.operator} ${fmtThreshold(d.threshold)}` : ""
        }${d.frequency ? `, tested ${d.frequency.toLowerCase()}` : ""}${
          d.effectiveDate ? `, running from ${d.effectiveDate}` : ""
        }, and attaches it to ${member} on ${version}.`;
    return [what, AMEND_DOES_NOT, covenantRetest(ctx, d)].filter(Boolean).join(" ");
  }
  const d = versionPledgeDraft(ctx, a);
  const member = memberNameOf(ctx, d.targetLoanId);
  const amount = d.amountPledged ?? d.lendable;
  const what = d.asset
    ? `This pledges the ${d.description ?? "asset"} the borrower already owns to ${member} on ${version}${
        amount !== null ? `, at ${fmtMoney(amount)}` : ""
      }. The asset itself and the borrower's ownership of it are untouched.`
    : `This files a ${d.collateralType ?? "collateral"} asset${d.description ? ` described as ${d.description}` : ""}${
        d.value !== null ? ` at ${fmtMoney(d.value)}` : ""
      }, the borrower's ownership of it, and a pledge of it to ${member} on ${version}${
        amount !== null ? ` at ${fmtMoney(amount)}` : ""
      }.`;
  return [what, AMEND_DOES_NOT, coverageAfter(ctx, d)].filter(Boolean).join(" ");
}

/**
 * THE COVENANT'S RE-TEST, WHERE THE RATIO EXISTS ON FILE.
 *
 * A covenant is a test, and a banker filing one wants to know whether the
 * borrower passes it today. The room can answer that ONLY where the read
 * carries an actual for the same quantity: the covenant being attached carries
 * its own, and a covenant being authored is measured against the relationship's
 * own test of that type where one exists. Everywhere else there is no sentence,
 * because a pass or a fail invented from nothing is the worst thing this room
 * could say.
 */
function covenantRetest(ctx: RelContext, d: VersionCovenantDraft): string | null {
  if (d.attach) {
    const rail = covenantRail(d.attach);
    if (!rail) return null;
    /* THE ORG'S OWN VERDICT, through the shared classifier, never a second
       opinion computed here. The junction carries the covenant onto the version
       exactly as the borrower holds it, so where it stands today is where the
       version facility inherits it. */
    const verdict = classifyCovenant(d.attach);
    return `On the figures on file it reads ${rail}, and Salesforce classifies it as ${verdict.label}, so that is the test the version facility inherits.`;
  }
  if (!d.typeName || !d.operator || d.threshold === null) return null;
  const held = (ctx.bundle?.covenants?.covenants ?? []).find(
    (c) => (c.covenantType ?? "").trim().toLowerCase() === d.typeName!.toLowerCase() && typeof c.actualValue === "number",
  );
  if (!held || typeof held.actualValue !== "number") return null;
  return `The relationship's own ${covenantLabelOf(held)} reads ${fmtThreshold(held.actualValue)} on the book, so against ${d.operator} ${fmtThreshold(d.threshold)} this test would ${
    passes(held.actualValue, d.operator, d.threshold) ? "be met" : "fail"
  } on today's figure. That is this room's arithmetic over the read, not a test the org has run.`;
}

function passes(actual: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case ">=":
      return actual >= threshold;
    case ">":
      return actual > threshold;
    case "<=":
      return actual <= threshold;
    case "<":
      return actual < threshold;
    default:
      return actual === threshold;
  }
}

/**
 * COVERAGE AFTER THE PLEDGE, out of the bundle's own collateral pool.
 *
 * The relationship pool is `totalUniqueCollateralLendableValue` over
 * `uniqueCollateralCount` distinct assets, which is the org's own figure and
 * already counts every asset the borrower owns and has pledged. So:
 *
 *   AN EXISTING ASSET MOVES NOTHING AT RELATIONSHIP LEVEL. It is already in the
 *   pool, and pledging it to a second facility is cross-collateral: what moves
 *   is the version facility's own coverage, not the relationship's. Saying
 *   otherwise would promise a credit improvement the bank does not get.
 *
 *   A NEW ASSET ADDS ITS LENDABLE VALUE, and the room states the pool after and
 *   the ratio against the outstanding the read carries.
 */
function coverageAfter(ctx: RelContext, d: VersionPledgeDraft): string | null {
  const ex = ctx.bundle?.exposure;
  const pool = typeof ex?.totalUniqueCollateralLendableValue === "number" ? ex.totalUniqueCollateralLendableValue : null;
  const count = typeof ex?.uniqueCollateralCount === "number" ? ex.uniqueCollateralCount : null;
  if (d.asset) {
    if (pool === null) return null;
    return `That asset is already in the relationship's collateral pool of ${fmtMoney(pool)}${
      count !== null ? ` over ${count} distinct assets` : ""
    }, so the relationship's coverage does not move: this is cross-collateral, and what it lifts is the version facility's own coverage.`;
  }
  if (pool === null || d.lendable === null) return null;
  const after = pool + d.lendable;
  const outstanding = typeof ex?.totalOutstanding === "number" ? ex.totalOutstanding : null;
  const ratio = outstanding && outstanding > 0 ? after / outstanding : null;
  return `The relationship's collateral pool reads ${fmtMoney(pool)}${
    count !== null ? ` over ${count} distinct assets` : ""
  } today; this asset adds ${fmtMoney(d.lendable)} lendable at the rate you stated, taking it to ${fmtMoney(after)}${
    ratio !== null ? `, which is ${ratio.toFixed(2)}x the ${fmtMoney(outstanding!)} outstanding` : ""
  }. That is this room's arithmetic over the read; the org strikes its own figure once the pledge is filed.`;
}

/* ============================================================= THE READ-BACK

   ONE ROW PER THING FILED, built from the same draft the payload is built from.
   A lane listing nine answers behind one pledge is a transcript; the banker is
   filing a pledge, so the lane reads as a pledge.                            */

export interface VersionRow {
  key: string;
  icon: IconKind;
  label: string;
  value: string;
}

export function versionRows(route: "versionCovenant" | "versionPledge", ctx: RelContext, a: Answers): VersionRow[] {
  const rows: VersionRow[] = [];
  const entry = amendTarget(ctx);
  if (entry) rows.push({ key: "version", icon: "package", label: "Version", value: entry.name });
  if (route === "versionCovenant") {
    const d = versionCovenantDraft(ctx, a);
    if (d.attach) {
      rows.push({ key: "covenant", icon: "covenant", label: covenantLabelOf(d.attach), value: `attached, ${covenantChipDetail(d.attach) || "as the borrower holds it"}` });
    } else if (d.typeName) {
      rows.push({
        key: "covenant",
        icon: "covenant",
        label: d.typeName,
        value:
          [
            d.operator && d.threshold !== null ? `${d.operator} ${fmtThreshold(d.threshold)}` : "terms outstanding",
            d.frequency?.toLowerCase(),
            d.effectiveDate ? `from ${d.effectiveDate}` : null,
          ]
            .filter(Boolean)
            .join(", ") || "terms outstanding",
      });
    }
    if (d.targetLoanId) rows.push({ key: "target", icon: "package", label: "Tests", value: memberNameOf(ctx, d.targetLoanId) });
    return rows;
  }
  const d = versionPledgeDraft(ctx, a);
  if (d.description || d.collateralType) {
    rows.push({
      key: "asset",
      icon: "collateral",
      label: d.description || d.collateralType || "asset",
      value:
        [
          d.asset ? "owned on the book" : d.collateralType,
          d.value !== null ? fmtMoney(d.value) : null,
          d.advanceRate !== null ? `${d.advanceRate}% advance rate` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "asset",
    });
  }
  const amount = d.amountPledged ?? d.lendable;
  if (amount !== null) {
    rows.push({
      key: "pledge",
      icon: "commit",
      label: "Pledged",
      value: `${fmtMoney(amount)}${d.authoriseOverPledge ? ", over-pledge authorised" : ""}`,
    });
  }
  if (d.targetLoanId) rows.push({ key: "target", icon: "package", label: "Secures", value: memberNameOf(ctx, d.targetLoanId) });
  return rows;
}

/** The trail rows, built from the ORG'S OWN account of what it created. A row
 *  the org did not name reads as filed and unverified, which is what a failed
 *  verification read-back actually is. */
export function versionDossierRows(
  route: "versionCovenant" | "versionPledge",
  ctx: RelContext,
  a: Answers,
  items: Array<{ recordName?: string | null; recordId?: string | null }> | undefined,
): VersionRow[] {
  const rows = versionRows(route, ctx, a).filter((r) => r.key !== "version");
  return rows.map((row, i) => {
    const item = items?.[i];
    const named = [(item?.recordName ?? "").trim(), (item?.recordId ?? "").trim()].filter(Boolean).join(" · ");
    return { ...row, value: named || row.value };
  });
}
