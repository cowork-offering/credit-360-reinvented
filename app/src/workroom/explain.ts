import { fmtDate, fmtMoney } from "../data/format";
import type { CatalogField } from "./fieldCatalog";
import type { WorkroomDelta } from "./types";

/* =============================================================================
   THE EXPLANATION LAYER.

   Founder verdict, 2026-08-29: the room "feels almost more like guided template
   still, no explanation" — "it can explain also concise in the flow what and why
   it is needed."

   So every beat carries ONE sentence of WHY, in the agent's own voice, in the
   language a credit officer already speaks. Five beats, and no sixth:

     asked      — why the room needs the figure it is asking for;
     proposed   — what confirming will actually DO to the deal;
     checked    — why this check matters on THIS package, not in general;
     handed off — why an entry is recorded rather than filed;
     refused    — why the answer is no, and what would work instead.

   THREE RULES THIS FILE IS HELD TO.

   1. IT NEVER LECTURES. One sentence. The room is talking to a banker who knows
      what a covenant is; the thing they cannot know is what THIS room does with
      it, and that is the only thing said.

   2. IT DERIVES FROM STATE. Every figure in every sentence comes in as an
      argument — the package total, the pool, the chain the catalog carries, the
      member's own name. A sentence that would read identically on any deal is
      filler, and filler is what the founder called a guided template.

   3. IT SPEAKS CREDIT, NOT SCHEMA. No object names, no "junction", no
      "invocable", no tool names. The org's own words are kept verbatim where a
      banker asked for them — on the chip's map, in the manifest peek, on the
      filed handoff list — and never in the conversation.

   LAW 3 IS UNTOUCHED. Nothing here reaches `brief()`: the opening view keeps its
   sixty words, and the explanations live in the beats that follow it.
   ============================================================================= */

/* ------------------------------------------------------ 0. what it takes

   THE ANSWER A QUESTION TAKES, in the banker's own words. It is used by the
   honest re-ask (A2 audit, 2026-09-12): a repeat that says "I heard \"asdf\",
   and I cannot read it as a rate" has narrowed the question, and one that says
   the question again word for word has not. It names the SHAPE and never a
   figure, so it can never read as the room proposing an answer.              */

/** What this field's question will accept, named. */
export function answerShape(field: CatalogField): string {
  switch (field.id) {
    case "loan.interestRate":
      return "a rate";
    case "loan.amount":
      return "an amount";
    case "loan.maturityDate":
      return "a date";
    case "covenant.add":
      return "a covenant and the level it is tested at";
    case "fee.row":
      return "a fee";
    case "collateral.pledge":
      return "an asset to pledge";
    case "exception.record":
      return "a policy exception";
    default:
      break;
  }
  switch (field.type) {
    case "currency":
      return "an amount";
    case "percent":
      return "a percentage";
    case "months":
      return "a length in months or years";
    case "date":
      return "a date";
    case "number":
      return "a figure";
    case "picklist":
      return "one of the values above";
    default:
      return `an answer to ${field.label.toLowerCase()}`;
  }
}

/* -------------------------------------------------------------- 1. asked */

/** What the room is standing on when it asks for a figure. Everything here is
 *  read off the live bundle by the caller; nothing is assumed. */
export interface AskContext {
  /** The package's committed total today. */
  committed: number;
  /** The org's distinct lendable collateral pool, where the read carries one. */
  lendable?: number;
  /** THE TWO PRICING FIELDS, AS THE BOOK HOLDS THEM ON THIS FACILITY (golden
   *  rule 2: every ask leads with the current figure). Undefined or null is the
   *  org holding the field BLANK, which this room says out loud rather than
   *  filling: a first payment date nobody set is not a first payment date. */
  amortisedTermMonths?: number | null;
  /** ISO, exactly as the read carries it. Formatted here, never re-derived. */
  firstPaymentDate?: string | null;
}

/**
 * WHY THE ROOM NEEDS THIS FIGURE.
 *
 * The four terms the credit action carries get the reason they actually carry —
 * the commitment is the one every other number on the package derives from, so
 * it says so with the package total in it.
 *
 * EVERYTHING ELSE GETS SILENCE, deliberately. A reason keyed on a category
 * rather than on the field would answer "which entity?" with a sentence about
 * guarantee limits the moment the parser asked a different question, and a
 * confidently wrong explanation is worse than none. Where a handoff field is
 * asked about, the why arrives at the proposal beat instead.
 */
export function whyAsked(field: CatalogField, ctx: AskContext): string {
  switch (field.id) {
    case "loan.amount":
      return ctx.lendable !== undefined
        ? `The target drives everything downstream: the ${fmtMoney(ctx.committed)} package total, and the cover the ${fmtMoney(ctx.lendable)} pledged pool gives against it.`
        : `The target drives everything downstream: the ${fmtMoney(ctx.committed)} package total, the coverage check and the plan itself.`;
    case "loan.maturityDate":
      return "The maturity is what the modification is dated to, and it sets when this facility next comes back round.";
    case "loan.interestRate":
      return "The rate is the price the modification carries; the booked facility keeps the one it has until the bank's own approval books the change.";
    case "loan.termMonths":
      return "The term is what the amortisation and the payment schedule are built off, so nothing can be composed until it is settled.";
    /* THE OTHER TWO OF THE FOUR SALESFORCE PRICES ON (fixer pass, 2026-09-12).
       The rate, the amount and the maturity each led with what the book holds
       and these two asked blankly, which is the one thing golden rule 2 does not
       allow. Each states the current figure where the book carries one and says
       the org holds it blank where it does not; neither invents a length or a
       date, because a facility nobody can price is the defect, not the cure. */
    case "loan.amortisedTerm":
      return typeof ctx.amortisedTermMonths === "number"
        ? `The amortisation is what the payment stream is struck on, and this facility runs on ${ctx.amortisedTermMonths} months today.`
        : "The amortisation is what the payment stream is struck on, and the org holds none on this facility, so nothing prices until it is set.";
    case "loan.firstPaymentDate":
      return ctx.firstPaymentDate
        ? `The first payment date starts the schedule the rate is struck against, and this facility reads ${fmtDate(ctx.firstPaymentDate)} today.`
        : "The first payment date starts the schedule the rate is struck against, and the org holds none on this facility, so nothing prices until it is set.";
    default:
      return "";
  }
}

/* ----------------------------------------------------------- 2. proposed */

/** WHAT CONFIRMING WILL ACTUALLY DO. The founder's own reading of a
 *  modification (corrected 2026-08-30 to nCino package methodology): the credit
 *  action versions the WHOLE package — every eligible member rolls into a new
 *  package with its junction graph, the named member's clone carries the new
 *  terms, and nothing that exists today is touched until the bank's own
 *  approval books the new version. A banker who has never seen this room has
 *  no way to know that, and it is the single fact that makes a confirm safe. */
export function whyProposed(deltas: WorkroomDelta[]): string {
  const fileable = deltas.filter((d) => d.fileable !== false);
  if (!fileable.length) return "";
  const targets = [...new Set(fileable.map((d) => d.target))];
  const named = targets.length > 2 ? `${targets.length} members` : targets.join(" and ");
  return `Confirming stages the next VERSION of the package: every eligible member rolls into it with its covenants, collateral and borrowers, and the clone of ${named} carries the new terms. The booked facilities and the current package stay exactly as they are until the bank's own approval books the new version.`;
}

/* ------------------------------------------------------------ 3. checked */

/** Why the coverage check matters HERE. The pledged pool is a fixed figure the
 *  org already computed; the commitment is what the banker is moving. That gap
 *  IS the check, and stating it is what turns a ratio into a reason. */
export function whyChecked(args: { lendable: number; covers: boolean }): string {
  const held = `The pledged pool does not grow with the commitment. It holds at ${fmtMoney(args.lendable)}`;
  return args.covers
    ? `${held}, so every dollar added thins the cover behind it, and at this level it still clears the whole commitment.`
    : `${held}, so every dollar added thins the cover behind it, and at this level it no longer clears the whole commitment.`;
}

/* --------------------------------------------------------- 4. handed off */

/**
 * WHY AN ENTRY IS RECORDED RATHER THAN FILED.
 *
 * The gap table (`knowledge/sf-build-v2/wiring-gap-analysis.md`) says this in
 * the org's own words, and those words are kept verbatim where a banker asks
 * for them. What they are not is an answer in a conversation: "LLC_BI__Covenant2__c
 * is not on C360WriteGuard's allowlist" is the sentence the founder read as too
 * technical. So the conversation gets the credit reading of the same fact, and
 * the chain length is the honest measure of how much a create would take.
 */
export function whyHandoff(delta: WorkroomDelta): string {
  const links = delta.chainLinks?.length ?? 0;
  const steps = links > 1 ? ` in ${links} connected writes` : "";
  switch (handoffKind(delta)) {
    case "covenant-add":
      return `Creating a covenant means writing it and attaching it to the modification${steps}. A mapped type with a stated threshold files directly; this one the room could not settle against the org's own catalog, so it rides the plan as a handoff and nothing is silently dropped.`;
    case "covenant-remove":
      return "Taking a covenant off the facility means deleting the attachment outright, which nothing in this room may do, so it rides the plan as a handoff, with the reason.";
    case "covenant-change":
      return "The test itself lives on the covenant rather than on the facility, and no deployed write reaches it, so it rides the plan as a handoff and nothing is silently dropped.";
    case "collateral-add":
      return `Pledging security files on the modification${steps}. An asset the borrower already owns goes straight onto the clone, and a net-new one is created, has its ownership recorded and is then pledged. This one the room could not resolve to a single asset, or could not settle its kind, value and advance rate, so it rides the plan as a handoff rather than a pledge aimed at a record nobody picked.`;
    case "collateral-remove":
      return "Releasing a pledge is a change on the pledge itself, and no deployed write reaches it yet, so it rides the plan as a handoff, with the reason.";
    case "party-add":
      return "Putting an entity on the modification files when the line names the member and the role; this one did not, so it rides the plan as a handoff and leaves with you rather than being dropped.";
    case "party-remove":
      return "Taking an entity off files as a CARRY EXCLUSION when the line names the member: the booked facility keeps its row, the clone starts without it. This line did not name one, so it rides the plan as a handoff.";
    case "fee":
      return "A whole fee files on the modification: the kind, and either a percentage of the commitment or a flat amount. This one the room could not settle into that shape, so it rides the plan as a handoff rather than a figure that would look filed.";
    case "pricing":
      return "Pricing is neither read nor written here, so the room can name the change but not show today's value, so it rides the plan as a handoff and nothing is silently dropped.";
    case "exception":
      return "Logging an exception files on the modification: what is out of policy, what the bank decided about it, and what stands behind that decision. This one the room could not settle into that shape, so it rides the plan as a handoff rather than as a record named after its own Id.";
    default:
      return "The credit action carries four terms (commitment, rate, maturity and term), and this is not one of them, so it rides the plan as a handoff with the field named.";
  }
}

type HandoffKind =
  | "covenant-add"
  | "covenant-remove"
  | "covenant-change"
  | "collateral-add"
  | "collateral-remove"
  | "party-add"
  | "party-remove"
  | "fee"
  | "pricing"
  | "exception"
  | "term";

/** The delta's own group and operation decide the reading. `group` is the
 *  manifest heading the entry files under, which is the closest thing the delta
 *  carries to the catalog's category without reaching back into it. */
function handoffKind(delta: WorkroomDelta): HandoffKind {
  const remove = delta.op === "remove";
  const add = delta.op === "add";
  // AN EXCEPTION FILES UNDER THE COVENANT HEADING, and the group switch below
  // therefore read every one of them as a covenant — which left the exception
  // reading unreachable and a handed-off exception explained as a covenant. The
  // kind badge carries the category the group cannot.
  if (delta.kind.toLowerCase().includes("policy exception")) return "exception";
  switch (delta.group) {
    case "covenants":
      return remove ? "covenant-remove" : add ? "covenant-add" : "covenant-change";
    case "security":
      return remove ? "collateral-remove" : "collateral-add";
    case "structure":
      return remove ? "party-remove" : "party-add";
    default:
      break;
  }
  const title = delta.title.toLowerCase();
  if (title.includes("fee")) return "fee";
  if (title.includes("pricing") || title.includes("spread") || title.includes("index")) return "pricing";
  if (title.includes("exception")) return "exception";
  return "term";
}

/* ------------------------------------------------------------ 5. refused */

/** WHY THE ANSWER IS NO, AND WHAT WOULD WORK. A refusal with no route out is a
 *  dead end; the second half is the part that makes it an answer. Keyed on the
 *  catalog id, because that is what the refusal was raised on. */
export function whyRefused(fieldId: string): string {
  switch (fieldId) {
    case "covenant.complianceStatus":
      return "Filing a compliance status makes the bank send its own approval notice to a named person, and that cannot be pulled back, so it is taken deliberately rather than as a side effect of a term change. Open the covenant review on this package and file it there.";
    case "collateral.valuation":
      return "A valuation is a fact about the asset rather than a term on the facility, so it is filed against the collateral itself and not against a modification. Open the collateral valuation and it goes through there.";
    case "loan.stage":
    case "package.stage":
      return "Booking runs through the bank's own approval with real approvers, and nothing here may move a facility there by hand. Stage the change, approve it, and submit it for approval where the bank expects it.";
    default:
      return "";
  }
}

/* ------------------------------------------------------ the room's walls */

/**
 * NO CONNECTOR (the refusal that explains itself).
 *
 * The refusal itself is right and stays: a plan is the org's or there is no
 * plan. What it did not do was tell a banker what had gone wrong in their own
 * terms, or what to do about it — so it read as a fault rather than as a
 * disconnected view. One reason, one recovery step, one way to confirm it.
 */
export const NO_CONNECTOR_REFUSAL =
  "This view is not connected to the bank's systems, so there is no package to stage against and nothing here is ever simulated. " +
  "Reload the page and accept the connection prompt; the Sync control on the relationship confirms it once it is through.";

/** No package to anchor on. Same shape: the reason, then the way forward. */
export const NO_PACKAGE_REFUSAL =
  "A modification is anchored on one product package, and this relationship stages none. " +
  "There is nothing here to modify until the deal is on a package. Open the relationship and check what the package read carries.";

/** A manifest where nothing files. The reason is the gap table; the way forward
 *  is either a term the credit action carries, or the handoff list itself. */
export function nothingFilesRefusal(handedOff: number): string {
  const plural = handedOff === 1 ? "entry needs" : "entries need";
  return (
    `Nothing in this manifest files. All ${handedOff} ${plural} a write that is not deployed here, and a plan with no change is a plan that does nothing. ` +
    "Add a commitment, rate, maturity or term change so the credit action has something to carry, or take the handoff list to the person who can action it."
  );
}
