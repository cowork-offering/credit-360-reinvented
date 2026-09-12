import type { BrainEnvelope, BrainFacility, BrainFileable, BrainMail, BrainReadCard, BrainTurn } from "../../channel/brainLane";
import { capEnvelope } from "../../channel/brainLane";
import type { PackageMember, WorkroomDelta, WorkroomMode } from "../../workroom/types";
import { buildReadBlocks, threadDigest } from "./readBlocks";
import type { IconKind } from "./TypeIcon";
import type { ReadCardModel, ReadGroup, ReadRow, ReadSource } from "./readCard";

/* =============================================================================
   WHICH LANE A LINE TAKES, and what a brain answer looks like in this room.

   THE GUARD RECOGNISES SHAPES; IT STILL RESOLVES NOTHING. Everything here is
   the same kind of judgement `ask.ts` makes — is this a question, is this an
   instruction — extended with the one reading the founder called out after the
   live run: a courtesy prefix in front of an imperative is a COMMAND, not a
   question, and refusing to stage it was the guard being blunt in the wrong
   direction.

   THE ENGINES ARE UNTOUCHED. Nothing in this file parses a value, resolves a
   record or composes a payload. A polite command is STRIPPED and handed to the
   fast lane exactly as if the courtesy had never been typed.
   ============================================================================= */

/* --------------------------------------------------------- polite commands

   "can you increase the LoC to 20M" opens on `can`, so the question guard
   answered it instead of staging it. That was the KNOWN CONSEQUENCE recorded in
   ask.ts, and the founder's call is that it is the wrong one: a banker who
   writes "could you move the maturity to 2028-03-31" has asked for a change and
   is owed a chip, not a capability lecture.

   THE ASYMMETRY IS DELIBERATE AND NARROW. A courtesy prefix alone is not
   enough: the remainder must open on an ACTION VERB and carry something to act
   on. "can you tell me what covenants are on this" opens on `tell`, which is
   not an action verb, and stays a question. "can you show me the fees" stays a
   question. The cost of getting this wrong in the permissive direction is the
   founder's original bug, so the verb list is a list and never a pattern.      */

/** The courtesy, and nothing else. `you`/`we`/`I` because bankers write all
 *  three, and the optional `please` on either side of it. */
const COURTESY = /^\s*(?:please[,\s]+)?(?:can|could|would|will)\s+(?:you|we|i)\s+(?:please\s+)?/i;

/**
 * Verbs that CHANGE the package. Every one of them is a verb the deterministic
 * parser already stages on (app/src/workroom/parseModify.test.ts). Reading
 * verbs — tell, show, list, explain, confirm, check, find, remind — are
 * deliberately absent: those are questions with a courtesy in front.
 */
const ACTION_VERB =
  /^(increase|decrease|reduce|raise|lower|take|move|push|extend|shorten|change|switch|update|set|make|give|price|add|put|bring|remove|drop|delete|exclude|pledge|log|record|renew|amend|stretch)\b/i;

/**
 * THE LINE WITHOUT ITS COURTESY, or null where the line is not a polite
 * command.
 *
 * The trailing question mark goes with the prefix: "would you take the line to
 * $20M?" is one sentence wearing two costumes, and the mark left on the end
 * would be read as part of a value by the field wave (the founder's repro 11b,
 * from the other direction).
 */
export function politeCommand(text: string): string | null {
  const line = text.trim();
  if (!line) return null;
  const match = COURTESY.exec(line);
  if (!match) return null;
  const rest = line.slice(match[0].length).replace(/[?\s]+$/, "").trim();
  if (!rest || !ACTION_VERB.test(rest)) return null;
  return rest;
}

/* ------------------------------------------------------------- the envelope */

/**
 * The label a facility carries in the envelope. The member's own key, which is
 * what the parser resolves a member on.
 *
 * A SHARED KEY IS NAMED WITH ITS COMMITMENT (2026-09-01 evening drive). This
 * package carries two Lines of Credit and two Equipment facilities, so a bare
 * key names a PRODUCT and not a FACILITY: the desk resolved one of the two
 * correctly and the restated line still landed on both, staging a reduction on
 * the $15M line nobody asked for. The amount in front is the same qualifier the
 * banker writes, and `qualifierFilter` resolves it to exactly one member.
 */
export const facilityLabel = (m: PackageMember, all: PackageMember[]): string =>
  all.filter((x) => x.key === m.key).length > 1 ? `${m.amount} ${m.key}` : m.key;

const facilityOf = (m: PackageMember, all: PackageMember[]): BrainFacility => ({
  loanId: m.id,
  label: facilityLabel(m, all),
  commitment: m.amount,
});

/**
 * WHAT THE ROOM HANDS OVER. Compact, and derived entirely from what the room is
 * already holding: no read is issued to build it.
 *
 * The staged digest carries titles, targets and the proposed reading. It does
 * NOT carry the wire payload: a reply must not be able to restate a figure it
 * did not read, and the pack says figures come from the live read.
 */
export function buildEnvelope(args: {
  line: string;
  mode: WorkroomMode;
  accountName: string;
  packageName: string;
  productPackageId: string | null;
  members: PackageMember[];
  eligible: (m: PackageMember) => boolean;
  focused: PackageMember | null;
  entries: WorkroomDelta[];
  /**
   * WHAT THE ROOM HAS ALREADY READ (F2). The blind envelope is what made the
   * brain look stupid three times in the 2026-09-01 drive. Absent where the
   * room stands on no read, and the blocks are then simply not there.
   */
  reads?: ReadSource;
  /** The conversation so far, so the desk holds context across turns. */
  thread?: BrainTurn[];
  /** TRUE while the room is still asking which of the three routes this is. */
  routeOpen?: boolean;
  /**
   * THE CLIENT'S OWN MESSAGE, where this room found one (founder, 2026-09-02:
   * "when there is an email attached, it should be in that first response baked
   * in"). Absent is silent: no key, no apology, no "not connected" string.
   */
  mail?: BrainMail;
}): BrainEnvelope {
  const entries = args.entries;
  const fileable: BrainFileable = {
    files: ["a commitment, a rate, a maturity or a term on a booked facility", "a covenant, a fee, collateral or who is on the deal"],
    // WHAT THIS ROUTE CANNOT FILE, from the manifest's own honesty rather than
    // from a list written twice: an entry the engines marked un-fileable is
    // already carrying the reason it is handed off.
    cannot: entries
      .filter((e) => e.fileable === false)
      .map((e) => ({ what: e.title, why: e.handoff?.reason ?? e.caveat ?? "No deployed tool files this today." })),
  };
  return capEnvelope({
    v: 2,
    line: args.line,
    room: "facility",
    relationship: args.accountName,
    route: args.routeOpen ? "unbound" : args.mode,
    routeOpen: args.routeOpen || undefined,
    routeOptions: args.routeOpen ? ["modify", "renew", "create"] : undefined,
    packageName: args.packageName,
    productPackageId: args.productPackageId,
    selectedFacility: args.focused ? facilityOf(args.focused, args.members) : null,
    facilities: args.members.filter(args.eligible).map((m) => facilityOf(m, args.members)),
    staged: entries.map((e) => ({ title: e.title, target: e.target, after: e.after })),
    reads: buildReadBlocks(args.reads, Boolean(args.mail)),
    mail: args.mail,
    thread: args.thread ? threadDigest(args.thread) : undefined,
    fileable,
    grounding: "plugin-skill:workroom-brain",
  });
}

/* ================================= A CLARIFY IS HELD TO THE WIRE (C, the drive)

   "add a 1% origination fee to LOC" reached the desk, which asked which line
   (fair), and then asked four more questions of its own: the fee basis on the
   increase against the full commitment, the payment method, "financed from
   proceeds / paid outside closing / bank paid / waived", and a confirmation.
   Seven exchanges for a fee the parser reads in one.

   NONE OF THOSE IS A FIELD ON THE WIRE THIS ROOM FILES. `feeAddsJson` carries
   the fee type, the human label, and either a percentage or a flat amount,
   against ONE facility. A question about a field the tool does not take cannot
   change what gets staged; it can only cost the banker a round trip and end in
   a restated line that carried a commitment figure into the fee reader.

   THE DOCTRINE SAYS SO NOW, AND THE DOCTRINE IS A REQUEST. This is the check:
   a fee clarify whose options name NOTHING the wire carries is treated as a
   degrade, so the room falls back to its own parse, which is where the fast
   lane was going to answer this line anyway.

   AGGREGATE, NOT PER-OPTION. A single unrecognised option does not condemn a
   question; a question with nothing recognisable in it is not about the wire at
   all. Getting this wrong in the strict direction would silence a legitimate
   clarify, and a clarify the room drops is a question the banker never sees. */

/** A line that opens a fee create. The only wire this rule is written for. */
const FEE_CREATE = /\bfees?\b/i;
const FEE_CREATE_VERB = /\b(add|adds|charge|charged|apply|applies|put|include|attach|bill)\b/i;

/** The fee wire's own fields, as the words a clarify would use for them: the
 *  fee type, the figure, and the facility it is authored on. */
const FEE_WIRE_WORDS = [
  /\b(origination|arrangement|upfront|up[- ]front|front[- ]end|structuring|commitment fee|facility fee|amendment|attorney|legal|appraisal|agency|agent|waiver|survey|title|credit report|unused|other)\b/i,
  /\d+(?:\.\d+)?\s*(?:%|per\s?cent|percent|bps|basis points?)|\$\s*\d/i,
  /\b(facilit(?:y|ies)|loans?|lines?|revolvers?|equipment|construction|purchase)\b/i,
];

const onWire = (text: string): boolean => FEE_WIRE_WORDS.some((rx) => rx.test(text));

/**
 * TRUE where this clarify asks about nothing the target wire carries.
 *
 * Judged only for a fee create today, because that is the wire the drive proved
 * it on. A caller that gets `true` should fall back to its own parse rather
 * than render the question.
 */
export function clarifyOffWire(
  clarify: { text: string; options?: Array<{ label: string; say: string }> },
  line: string,
): boolean {
  if (!FEE_CREATE.test(line) || !FEE_CREATE_VERB.test(line)) return false;
  const options = clarify.options ?? [];
  if (options.length) return !options.some((o) => onWire(`${o.label} ${o.say}`));
  return !onWire(clarify.text);
}

/* ------------------------------------------------------- the answer, drawn

   READ-CARDS RENDER THROUGH THE ROOM'S OWN CARD, never through a second one.
   `buildReadCard` turns the bundle into a `ReadCardModel`; this turns a brain
   reply into the same model, so both arrive at the same component and the room
   has exactly one card language. Nothing is forked.                          */

/** The pack's row-glyph vocabulary, mapped onto the room's icon set. An icon we
 *  do not know is `package`, which is the room's own neutral row mark: a wrong
 *  glyph is a claim, an unrecognised one is not. */
const ICONS: Record<string, IconKind> = {
  borrower: "package",
  guarantor: "package",
  covenant: "covenant",
  collateral: "collateral",
  fee: "pricing",
  facility: "revolver",
  date: "maturity",
  money: "commit",
  warn: "covenant",
  ok: "covenant",
};

/** The group heading a topic slug reads as. The slug is the pack's own word;
 *  an unknown one is title-cased rather than dropped. */
function headingFor(topic: string): string {
  const known: Record<string, string> = {
    involvements: "Who is on the deal",
    covenants: "Covenant tests",
    collateral: "Security",
    fees: "Fees",
    exposure: "Exposure",
    pricing: "Pricing",
    exceptions: "Policy exceptions",
    history: "History",
    decisions: "Prior decisions",
  };
  if (known[topic]) return known[topic];
  const words = topic.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Read";
}

/** A brain read-card as the room's own card model. */
export function toReadCardModel(card: BrainReadCard, followUp?: string): ReadCardModel {
  const rows: ReadRow[] = card.rows.map((r) => ({
    icon: ICONS[r.icon] ?? "package",
    label: r.label,
    value: r.value,
    detail: r.sub,
    // STATUS LIVES IN THE INK. The pack has no tone field; `warn` is its own
    // word for a row that reads badly, so the glyph key carries the tone.
    tone: r.icon === "warn" ? "warn" : undefined,
  }));
  const groups: ReadGroup[] = [{ heading: headingFor(card.topic), rows }];
  return {
    topic: card.topic,
    lede: card.title,
    groups,
    // A card the brain ended without a follow-up still hands the conversation
    // back: an answer that stops dead is an answer the banker has to restart.
    /* AND THE ROOM SUPPLIES THAT HAND-BACK. "What should change on this
       package?" is the FACILITY room's work, and this function is shared: in
       the relationship room it offered the one thing that room answers with the
       facility handoff. A caller that knows what it is standing on passes its
       own next step; the facility room passes nothing and reads as it did. */
    followUp: card.followUp ?? followUp ?? "What should change on this package?",
  };
}
