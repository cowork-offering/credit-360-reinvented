import { assetValuation, valuationLine, valuationsOf } from "../../data/collateralValuation";
import type { ActionHistoryRow, BorrowerBundle, Covenant, Facility } from "../../data/contract";
import { facilityProduct, shortFacilityName } from "../../data/facilityStage";
import { fmtDate, fmtMoney, fmtPct } from "../../data/format";
import { aggregateInvolvements, involvementRole, isGuarantyRole, type AggregatedInvolvement } from "../../data/graphAggregate";
import { isActiveFacility } from "../../data/worklist";
import { classifyCovenant } from "../../domain/covenantStatus";
import { shortAssetTitle } from "../../domain/collateralAssets";
import type { IconKind } from "./TypeIcon";
import { iconForProduct } from "./TypeIcon";
import type { ReadTopic } from "./ask";

/* =============================================================================
   THE READ CARD — A QUESTION ANSWERED FROM THE PACKAGE.

   "which borrowers have we already in the package?" is a question the bundle
   answers completely: the room was holding all 21 involvements while the parser
   was refusing the sentence. This turns what the room already read into the
   room's own card language — grouped rows, type icons, one figure per row —
   and ends on the follow-up that flows into the op the banker is heading for.

   EVERY ROW IS READ, NEVER DERIVED INTO A NEW FACT. The covenants card states
   the org's own threshold, the org's own measured value and the org's own
   verdict (`classifyCovenant`, the same one the covenants tab renders). The
   structure card states the involvements as the graph read carries them. Where
   a read carries nothing, the card says so in words rather than showing an
   empty frame — the channel-none doctrine, applied to a question.

   IT ANSWERS; IT DOES NOT ACT. Nothing here stages, resolves a record id or
   composes a payload. The follow-up is a SENTENCE: the banker's own next line
   goes through the same parser every other line does.
   ============================================================================= */

export interface ReadRow {
  icon: IconKind;
  label: string;
  /** The figure, right-aligned. Empty where the row has none. */
  value: string;
  detail?: string;
  /** Status lives in the INK (rule: status as typography, never pill soup). */
  tone?: "warn" | "bad";
}

export interface ReadGroup {
  heading: string;
  rows: ReadRow[];
}

export interface ReadCardModel {
  /** The card style slug. A locally built card carries a {@link ReadTopic}; a
   *  card the BRAIN answered with carries the pack's own topic vocabulary
   *  (`involvements`, `exposure`, `decisions`, …). It reaches the DOM as
   *  `data-topic` and keys nothing, so the wider type costs nothing and lets
   *  both lanes render through the same component instead of forking it. */
  topic: string;
  /** The agent's own sentence above the card. */
  lede: string;
  groups: ReadGroup[];
  /** The guided next move, in credit language. Always a question the EXISTING
   *  ops can take an answer to. */
  followUp: string;
}

/** What the QUESTION narrowed the card to, where it narrowed it to anything. */
export interface ReadOptions {
  role?: "guarantor";
  /**
   * The facilities the question named, resolved by the caller against the same
   * members the parser resolves on. Empty or absent asks about the package.
   *
   * "who guarantees the construction loan" is a question about ONE loan, and a
   * card that answers it with every guarantor on the package has answered a
   * different question.
   */
  loanIds?: string[];
  /**
   * THE ROOM'S OWN NEXT MOVE, where the room asking has one.
   *
   * Every card below ends on the FACILITY room's work: "I can also add one to a
   * facility", "What should be pledged, and to which facility?". Offered to a
   * banker three questions into a covenant review, that is a door this room
   * refuses to open and a dead end in the golden rule's terms. A caller that
   * knows what it is standing on hands its own line in; the facility room passes
   * nothing and the cards read as they always have.
   */
  followUp?: string;
}

export interface ReadSource {
  bundle: BorrowerBundle | null;
  accountName: string;
  /** The package the room is anchored on. Null narrows nothing. */
  productPackageId: string | null;
  /** `meta.generatedAt` — the artifact's own snapshot instant, and the ONLY
   *  clock any derivation in the room layer is allowed to read. Absent where
   *  the caller has no data behind it, and every time-based tier then yields
   *  nothing rather than reaching `Date.now()`. */
  generatedAt?: string;
  /** THE DURABLE ACTION TRAIL for this relationship, where the host holds one.
   *  Read for exactly one thing (rule 2): a filed loan-modification row names
   *  the SOURCE package in `productPackageId` and a loan of the version it
   *  created in `resultRecordId`, which is what links an unbooked version back
   *  to the package it forked from. Absent leaves the version named and the
   *  source unlocked, never the other way round. */
  history?: readonly ActionHistoryRow[];
}

/* ------------------------------------------------------------------ helpers */

/** The facilities this room is standing on: active, and scoped to the package
 *  the room is anchored on where it is anchored on one. The SAME scoping the
 *  room's own strip uses, so the card and the strip can never disagree about
 *  which facilities are in the conversation. */
function scoped(src: ReadSource): Facility[] {
  return (src.bundle?.exposure?.facilities ?? [])
    .filter(isActiveFacility)
    .filter((f) => !src.productPackageId || f.productPackageId === src.productPackageId);
}

const nameOf = (f: Facility, relationship: string) => facilityProduct(f, relationship) || "Facility";
const iconOf = (f: Facility, relationship: string) => iconForProduct(nameOf(f, relationship));

/** "$15.0M committed", or nothing where the read carries no figure. */
const money = (n: number | null | undefined) => (typeof n === "number" ? fmtMoney(n) : "");

/* ---------------------------------------------------------------- structure */

/**
 * THE FACILITY, NAMED SO A BANKER CAN TELL TWO OF THEM APART.
 *
 * `facilityProduct` gives the product word, and this package carries two Lines
 * of Credit and two Equipment loans. Where the product repeats, the commitment
 * comes with it, which is the same disambiguation the room's own member labels
 * make.
 */
function labelFor(f: Facility, among: Facility[], relationship: string): string {
  const product = nameOf(f, relationship);
  const twins = among.filter((m) => nameOf(m, relationship) === product).length > 1;
  return twins && typeof f.committed === "number" ? `${product} (${fmtMoney(f.committed)})` : product;
}

/**
 * THE ORG STORES ONE INVOLVEMENT ROW PER LOAN, AND THE CARD IS NOT A DUMP OF IT.
 *
 * The 2026-09-02 read of Hartwell carries 22 rows for 5 parties. Listed raw,
 * the card said "Hartwell Industrial Holdings LLC, Guarantor" six times and the
 * envelope beside it said "14 guaranty rows", which is a sentence about the
 * org's storage shape rather than about the credit. One row per party per role,
 * carrying the facilities behind it, is the same fact said once.
 */
function structureCard(src: ReadSource, opts: ReadOptions = {}): ReadCardModel | null {
  const entities = src.bundle?.graph?.legalEntities ?? [];
  if (!entities.length) return null;

  const packageFacilities = scoped(src);
  /* THE QUESTION NARROWS THE FACILITIES. A loan the question named that is not
     on this package narrows nothing: the package is what the room stands on. */
  const named = new Set((opts.loanIds ?? []).filter(Boolean));
  const onlyOn = packageFacilities.filter((f) => f.loanId && named.has(f.loanId));
  const label = (f: Facility) => labelFor(f, packageFacilities, src.accountName);

  /** The involvement rows sitting on a set of facilities, plus the rows the org
   *  hung off the relationship rather than off a loan. */
  const on = (facilities: Facility[]) => {
    const byLoan = new Map(facilities.map((f) => [f.loanId ?? "", f]));
    return { byLoan, rows: entities.filter((e) => !e.loanId || byLoan.has(e.loanId)) };
  };

  /* THE NARROWING NEVER EMPTIES THE CARD. A facility the question named that
     carries no involvement row of its own would otherwise answer "who is on
     this" with nothing at all, which is a dead end rather than an answer; the
     card falls back to the package and its lede says which it is. */
  const wide = on(packageFacilities);
  const narrow = onlyOn.length ? on(onlyOn) : null;
  const scope = narrow && narrow.rows.length ? narrow : wide;
  /** The one loan the question named, where it named exactly one of ours AND
   *  that loan is what the rows below are about. */
  const only = scope === narrow && onlyOn.length === 1 && packageFacilities.length > 1 ? onlyOn[0] : null;
  const byLoan = scope.byLoan;
  /* AND THE ROWS MAY NAME NO LOAN THIS PACKAGE HOLDS. The org anchors an
     involvement row on a loan, so a room standing on a package whose members
     are not the loans the graph read names (an in-flight version, whose
     facilities are clones with ids of their own) matched nothing at all and
     answered "who is on this" with the desk. The rows are still this
     relationship's, so they are shown and the heading says where they sit
     rather than claiming the package. */
  const offPackage = scope.rows.length === 0 && entities.length > 0;
  const all = offPackage ? entities : scope.rows;

  /* THE QUESTION NARROWS THE CARD (E7). A question about guarantors is answered
     with the guarantors; where the read carries none, the card says so with the
     whole structure under it rather than rendering a heading over no rows. */
  const asked = opts.role === "guarantor" ? all.filter(isGuarantyRole) : all;
  const narrowed = opts.role === "guarantor" && asked.length > 0;
  const rows = aggregateInvolvements(narrowed ? asked : all);

  const where = only ? `the ${label(only)}` : offPackage ? "this relationship" : "this package";

  const row = (e: AggregatedInvolvement): ReadRow => {
    const loans = e.loanIds
      .map((id) => byLoan.get(id))
      .filter((f): f is Facility => Boolean(f))
      .map(label);
    return {
      icon: "package",
      label: e.accountName ?? "Unnamed party",
      // The role the org wrote, on the row, because a card that groups by scope
      // has to say what each party IS or it has not answered the question.
      value: involvementRole(e),
      detail:
        [
          e.guarantyAmountType || null,
          loans.length === 1 ? `on the ${loans[0]}` : loans.length > 1 ? `on ${loans.length} facilities` : null,
          typeof e.ownershipPercent === "number" && !e.guarantyAmountType ? `${fmtPct(e.ownershipPercent)} ownership` : null,
          typeof e.contingentAmount === "number" ? `${fmtMoney(e.contingentAmount)} contingent` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    };
  };

  /* GROUPED BY SCOPE, NOT BY FACILITY. Grouping by facility was what forced one
     line per facility per party; the row now carries its own facilities, so the
     only split left is the one the org itself makes between a row hung off a
     loan and a row hung off the relationship. */
  const groups: ReadGroup[] = [];
  const onFacilities = rows.filter((e) => e.loanIds.length).map(row);
  if (onFacilities.length) {
    groups.push({
      heading: offPackage ? "On this relationship's facilities" : only ? label(only) : "On this package",
      rows: onFacilities,
    });
  }
  const relationshipWide = rows.filter((e) => !e.loanIds.length).map(row);
  if (relationshipWide.length) groups.push({ heading: "Across the relationship", rows: relationshipWide });
  if (!groups.length) return null;

  // The lede counts PARTIES, not rows: a party holding two roles is two rows
  // and one name, and "6 guarantors" over four people is the multiplicity bug
  // moved into a number.
  const total = new Set(groups.flatMap((g) => g.rows).map((r) => r.label)).size;
  /* "EACH ONCE" IS A PROMISE ABOUT A LIST, and a list of one has nothing to
     promise (D1, the three-book matrix, 2026-09-13). It is there because the org
     stores one involvement row per loan and the card deduplicates them, which is
     worth saying over three guarantors and reads as filler over one: Kingsley's
     card said "1 guarantor is on this package today, each once with the role the
     org wrote". The claim the sentence exists for is the ROLE, and that half is
     said either way. */
  const once = total === 1 ? "" : ", each once";
  const onceNoComma = total === 1 ? "" : " each once";
  return {
    topic: "structure",
    lede: narrowed
      ? `${total} ${total === 1 ? "guarantor is" : "guarantors are"} on ${where} today,${onceNoComma} with the role the org wrote. Limited guarantors are guarantors: the cap is on the amount, not on the obligation.`
      : opts.role === "guarantor"
        ? `This read carries no guaranty rows on ${where}. What it does carry is ${total} ${total === 1 ? "party" : "parties"}, with the role each holds.`
        : `${total} ${total === 1 ? "party is" : "parties are"} on ${where} today${once}, with the role it holds and the facilities behind it.`,
    groups,
    followUp: "Who should be added or taken off, and on which facility?",
  };
}

/* ---------------------------------------------------------------- covenants */

function covenantRow(c: Covenant): ReadRow {
  const verdict = classifyCovenant(c);
  const type = (c.covenantType ?? "").trim() || "Covenant";
  const threshold = typeof c.thresholdValue === "number" ? `${c.thresholdValue}` : "not carried";
  const actual = typeof c.actualValue === "number" ? `, measured ${c.actualValue}` : "";
  const next = c.nextEvaluationDate ? `next test ${fmtDate(c.nextEvaluationDate)}` : "no next test carried";
  return {
    icon: "covenant",
    label: type,
    value: `${verdict.label}`,
    detail: `threshold ${threshold}${actual} · ${next}${c.frequency ? ` · ${c.frequency}` : ""}`,
    tone: verdict.severity === "breach" ? "bad" : verdict.severity === "watch" ? "warn" : undefined,
  };
}

function covenantsCard(src: ReadSource): ReadCardModel | null {
  const covenants = src.bundle?.covenants?.covenants ?? [];
  if (!covenants.length) return null;
  const facilities = scoped(src);
  const loanIds = new Set(facilities.map((f) => f.loanId).filter(Boolean));

  const groups: ReadGroup[] = [];
  let counted = 0;
  for (const f of facilities) {
    // The junction is the authority on what a covenant is attached to. An
    // ABSENT `attachedLoans` is a read that does not carry the field, which is
    // not the same fact as an empty one and must not be grouped as either.
    const rows = covenants
      .filter((c) => (c.attachedLoans ?? []).some((a) => a.loanId && a.loanId === f.loanId))
      .map(covenantRow);
    if (rows.length) {
      counted += rows.length;
      groups.push({ heading: nameOf(f, src.accountName), rows });
    }
  }
  const accountLevel = covenants
    .filter((c) => {
      const attached = c.attachedLoans;
      if (!attached) return true;
      if (!attached.length) return true;
      return !attached.some((a) => a.loanId && loanIds.has(a.loanId));
    })
    .map(covenantRow);
  if (accountLevel.length) {
    counted += accountLevel.length;
    groups.push({ heading: "Across the relationship", rows: accountLevel });
  }
  if (!groups.length) return null;

  return {
    topic: "covenants",
    lede: `${counted} ${counted === 1 ? "covenant test runs" : "covenant tests run"} against this package, with the org's own thresholds and last verdicts.`,
    groups,
    followUp: "Which test should change, and to what threshold? I can also add one to a facility.",
  };
}

/* --------------------------------------------------------------- collateral */

function collateralCard(src: ReadSource, opts: ReadOptions = {}): ReadCardModel | null {
  const packageFacilities = scoped(src);
  /* THE QUESTION NARROWS THE FACILITIES, exactly as it does on the structure
     card: "show me the pledges on this loan" while the banker is standing on
     one member is a question about that member. A named loan carrying no pledge
     of its own falls back to the package rather than answering with nothing,
     and the lede says which of the two it did. */
  const named = new Set((opts.loanIds ?? []).filter(Boolean));
  const onlyOn = packageFacilities.filter((f) => f.loanId && named.has(f.loanId) && (f.collateral ?? []).length > 0);
  const facilities = onlyOn.length ? onlyOn : packageFacilities;
  const only = onlyOn.length === 1 && packageFacilities.length > 1 ? onlyOn[0] : null;
  const valuations = valuationsOf(src.bundle);
  const groups: ReadGroup[] = [];
  let counted = 0;
  for (const f of facilities) {
    const rows: ReadRow[] = (f.collateral ?? []).map((c) => ({
      icon: "collateral",
      // THE SHORT TITLE, never the full legal description (founder finding,
      // 2026-09-03): the org's own type and a compact descriptor, the same
      // shortener the pledge lane and the collateral pane read an asset's
      // name through.
      label: shortAssetTitle(c.collateralType, c.collateralDescription, c.collateralName ?? c.collateralType ?? "Collateral"),
      value: money(c.amountPledged),
      detail: [
        c.collateralType,
        typeof c.advanceRate === "number" ? `${c.advanceRate}% advance` : null,
        c.lienPosition ? `lien ${c.lienPosition}` : null,
        c.pledgedStatus,
        /* WHEN IT WAS LAST VALUED AND WHEN IT IS DUE AGAIN. A pledge figure
           with no clock beside it reads the same whether the number was struck
           last month or two years ago, and those are a different credit. */
        valuationLine(c, valuations),
      ]
        .filter(Boolean)
        .join(" · "),
      /* THE QUIET TONE, NOT THE LOUD ONE. A revaluation past its date is a
         housekeeping fact on a performing asset, not a bad debt: status lives
         in the ink and the ink here is a warning, never an alarm. */
      tone: assetValuation(c, valuations).overdue ? "warn" : undefined,
    }));
    if (rows.length) {
      counted += rows.length;
      groups.push({ heading: nameOf(f, src.accountName), rows });
    }
  }
  if (!groups.length) return null;
  return {
    topic: "collateral",
    lede: only
      ? `${counted} ${counted === 1 ? "pledge is" : "pledges are"} recorded against the ${labelFor(only, packageFacilities, src.accountName)}, at the share it holds.`
      : `${counted} ${counted === 1 ? "pledge is" : "pledges are"} recorded against this package, by facility, at the share each facility holds.`,
    groups,
    followUp: "What should be pledged, and to which facility?",
  };
}

/* -------------------------------------------------------------- facilities */

function facilitiesCard(src: ReadSource): ReadCardModel | null {
  const facilities = scoped(src);
  if (!facilities.length) return null;
  const row = (f: Facility): ReadRow => ({
    icon: iconOf(f, src.accountName),
    label: shortFacilityName(f.name, src.accountName) || nameOf(f, src.accountName),
    value: money(f.committed),
    detail: [
      typeof f.outstanding === "number" ? `${fmtMoney(f.outstanding)} drawn` : null,
      typeof f.interestRate === "number" ? `${f.interestRate}%` : null,
      f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : null,
      f.riskGrade ? `grade ${f.riskGrade}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  });
  const booked = facilities.filter((f) => (f.stage ?? "").trim().toLowerCase() === "booked");
  const rest = facilities.filter((f) => !booked.includes(f));
  const groups: ReadGroup[] = [];
  if (booked.length) groups.push({ heading: "Booked, and open to a credit action", rows: booked.map(row) });
  if (rest.length) groups.push({ heading: "Not booked, so not modifiable here", rows: rest.map(row) });
  return {
    topic: "facilities",
    lede: `This package holds ${facilities.length} ${facilities.length === 1 ? "facility" : "facilities"}.`,
    groups,
    followUp: "Which one should change, and what on it?",
  };
}

/** The honest sentence for a topic the room cannot read, keyed by topic. Used
 *  where the builder returns null: the room says WHY, never nothing. */
export function readGap(topic: ReadTopic, relationship: string, where?: string | null): string {
  /* AND IT NAMES WHAT IT LOOKED AT. A question about one facility answered with
     "these facilities" tells the banker nothing about whether the room read the
     one they asked about; the caller passes the member where the question named
     one, and the sentence is otherwise exactly what it always was. */
  const on = where ? `the ${where}` : "these facilities";
  switch (topic) {
    case "fees":
      return (
        `No read on this cockpit carries the fees already on ${on}, so I cannot list them. ` +
        "I can still add one: say the fee kind and either a percentage of the commitment or a flat amount."
      );
    case "structure":
      return `The relationship read for ${relationship} carries no parties on ${on}, so there is nothing for me to list. I can still put someone on the deal: name them, the role, and the facility.`;
    case "covenants":
      return `No covenant tests reach this view for ${relationship}${where ? ` on ${on}` : ""}. I can add one: name the test, the facility and the threshold.`;
    case "collateral":
      return `No collateral pledges reach this view for ${relationship}${where ? ` on ${on}` : ""}. I can pledge something: name the asset and the facility.`;
    default:
      return `No facilities reach this view for ${relationship}, so there is nothing here a credit action can change.`;
  }
}

/**
 * THE CARD FOR A TOPIC, or null when the read carries nothing to show.
 *
 * Null is answered by `readGap` rather than by an empty card. Both are honest;
 * only one of them is useful.
 */
export function buildReadCard(topic: ReadTopic, src: ReadSource, opts: ReadOptions = {}): ReadCardModel | null {
  const card = cardFor(topic, src, opts);
  // THE CALLER'S OWN NEXT MOVE WINS. See `ReadOptions.followUp`.
  return card && opts.followUp ? { ...card, followUp: opts.followUp } : card;
}

function cardFor(topic: ReadTopic, src: ReadSource, opts: ReadOptions): ReadCardModel | null {
  switch (topic) {
    case "structure":
      return structureCard(src, opts);
    case "covenants":
      return covenantsCard(src);
    case "collateral":
      return collateralCard(src, opts);
    case "facilities":
      return facilitiesCard(src);
    /* NO READ TOOL CARRIES FEE ROWS onto the bundle, so the room cannot say
       what a facility already charges. That is a gap in the READ, not an empty
       package, and listing "no fees" would be a claim nothing supports. The
       gap sentence below is the honest half of the answer. */
    case "fees":
      return null;
  }
}

/* ============================== THE PLAN, READ BACK AS ROWS (2026-09-02)

   FOUNDER DRIVE: "what is on the plan" printed fifteen entries as one
   semicolon-separated paragraph. The model's remark under it then re-structured
   the same fifteen BY FACILITY, which is the shape the answer wanted and is not
   a shape a deterministic read-back should be leaving to a model.

   SO THE DETERMINISTIC READ-BACK USES THE ROOM'S OWN CARD. One row per entry,
   grouped by the facility the entry sits on, in the order the entries landed.
   The COUNT LINE stays exactly where it was, as the card's lede: it is the
   figure the rail itself shows and the two must agree.

   IT RENDERS; IT DERIVES NOTHING. Every string on the card is already on the
   entry, so a row and the manifest rail beside it cannot disagree.           */

/** The glyph for a manifest group. The rail's own vocabulary, not a new one. */
const PLAN_ICON: Record<string, IconKind> = {
  structure: "package",
  terms: "commit",
  covenants: "covenant",
  security: "collateral",
};

/** The facility an entry sits on, as the banker reads it on the rail. An entry
 *  that hangs off no member is grouped under the relationship. */
const PLAN_SCOPE = "Across the relationship";

export function planReadCard(
  entries: Array<{ title: string; target: string; before: string; after: string; group: string; member?: string }>,
  countLine: string,
  followUp: string,
): ReadCardModel {
  const order: string[] = [];
  const byFacility = new Map<string, ReadRow[]>();
  for (const e of entries) {
    const heading = e.target?.trim() || PLAN_SCOPE;
    if (!byFacility.has(heading)) {
      byFacility.set(heading, []);
      order.push(heading);
    }
    byFacility.get(heading)!.push({
      icon: PLAN_ICON[e.group] ?? "package",
      label: e.title,
      // THE MOVE, IN THE ENTRY'S OWN WORDS. Never recomposed and never derived.
      value: "",
      detail: `${e.before} \u2192 ${e.after}`,
    });
  }
  /* THE COMMITMENT IS READ FIRST (founder, 2026-09-03). A plan read-back is how
     a banker checks that the change they came in for is still on it, and the
     amount is that change on almost every modification. It was arriving in
     staging order, so on a facility with four pricing rows it could be fourth.
     Only the AMOUNT is promoted, and only inside its own facility: the rest of
     the group keeps the order the banker built it in. */
  const amountFirst = (rows: ReadRow[]): ReadRow[] => {
    const at = rows.findIndex((r) => COMMITMENT_ROW.test(r.label));
    if (at <= 0) return rows;
    return [rows[at], ...rows.slice(0, at), ...rows.slice(at + 1)];
  };
  return {
    topic: "plan",
    lede: countLine,
    groups: order.map((heading) => ({ heading, rows: amountFirst(byFacility.get(heading)!) })),
    followUp,
  };
}

/** The entry title the engines give a commitment move. Matched on the words
 *  rather than on a wire key, because the read-back is built from titles. */
const COMMITMENT_ROW = /\bcommitment\b/i;
