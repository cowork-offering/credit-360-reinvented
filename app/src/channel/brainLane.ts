import { buildBrainTools } from "./brainTools";
import { budgetPrompt } from "./doctrine";
import { rungFor, type RungChoice } from "./ladder";
import { CONTEXT_DROP_ORDER } from "./relationshipContext";
import { askSessionJson, sampleAvailable } from "./sampleDoor";

/* =============================================================================
   THE BRAIN LANE — the room's second lane, over the artifact<->session bridge.

   TWO LANES, ONE COMPOSER. The deterministic parser is the FAST LANE and it is
   untouched: a line it confidently claims stages exactly as it did before this
   module existed. What routes here is what the fast lane cannot claim — every
   question the guard catches, and every line the parser hands back unparsed.

   THE TRANSPORT IS THE SESSION DOOR (channel/sampleDoor.ts), and as of
   2026-09-15 it is the only one: the viewer's own Claude, which carries a REPLY
   back. The legacy `window.sendPrompt` arm in channel/adapter.ts is
   fire-and-forget by construction: it hands a prompt over and resolves, and
   nothing ever comes back to parse. A lane built on it could only ever hang or
   lie, so this module treats "no session door" as NO BRAIN LANE and says so
   (see `brainReachable`). That is the channel-none doctrine applied to the
   second lane.

   THE FENCE HOLDS. Nothing here writes, stages, mints a token or reaches an
   `execute_*` tool. A delta-proposal that validates is RESTATED as the sentence
   a banker could have typed and goes back through `engine.parseIntent` — the
   same path a typed line takes, the same org-side re-validation, the same plan,
   confirm and token ceremony. The brain proposes; the spine writes.

   A REPLY THAT FAILS VALIDATION IS NOT RENDERED. It degrades to a neutral
   clarify. Broken UI from a malformed model reply is the one failure this
   module exists to make impossible.
   ============================================================================= */

/* ------------------------------------------------------------ the envelope */

/** One member of the package, named tersely enough for a proposal to target it. */
export interface BrainFacility {
  loanId: string;
  label: string;
  /** The commitment as the room prints it. Pre-formatted; never re-derived. */
  commitment: string;
}

/* ------------------------------------------------------------ read blocks

   THE ENVELOPE WAS BLIND (F2, proven three times in the 2026-09-01 drive: the
   covenant read, the rate read and the guarantors read all came back "data not
   carried" over a bundle that held every one of them). What the room has ALREADY
   READ now travels with the line, pre-formatted exactly as the room prints it,
   so an answer is grounded in the same figures the glass shows.

   EVERY BLOCK IS READ, NEVER DERIVED. `notCarried` is the other half and it is
   load-bearing: a block that is absent because no read on this cockpit carries
   it must be refusable BY NAME, and an absent block must never be reported as
   an empty fact.                                                            */

export interface BrainReadBlocks {
  /**
   * WHAT EACH FACILITY IS, not just what it is called.
   *
   * The envelope carried a label and a commitment per member and nothing else,
   * so "what does this facility do" could not be answered with its maturity,
   * its drawn balance, its stage or its own coverage. Four figures the cockpit
   * chat was printing off the same read the whole time. One builder now prints
   * them once (`channel/relationshipContext.ts`) and both surfaces name the
   * facility the same way, so this block joins to `covenants[].scope`,
   * `collateral[].scope` and `pricing[].facility` by name.
   */
  facilities?: Array<{
    name: string;
    commitment?: string;
    drawn?: string;
    available?: string;
    rate?: string;
    maturity?: string;
    /** The org's own stage word. Absent where the read stages none. */
    stage?: string;
    /** The ORG'S per-facility coverage ratio, never one derived here. */
    coverage?: string;
  }>;
  covenants?: Array<{
    name: string;
    threshold: string;
    measured?: string;
    lastEvaluated?: string;
    nextTest?: string;
    /** How often the org tests it, in the org's own word. */
    frequency?: string;
    status: string;
    /** The verdict's own loudness, so a line item can take the room's colour
     *  without re-deriving a verdict from a label string. */
    severity?: "breach" | "watch" | "clear" | "neutral";
    /** The facility it is attached to, or "across the relationship". */
    scope: string;
  }>;
  /** ONE ROW PER PARTY PER ROLE, never one per org row. The org writes the
   *  involvement once per loan, and a desk sent 22 rows for 5 parties answers a
   *  guarantor question with a count of rows. */
  involvements?: Array<{
    name: string;
    role: string;
    /** Only where the org's OWN word says so. Absent is not "corporate". */
    kind?: "corporate" | "person";
    /** The facilities this party holds this role on, by name, or "across the
     *  relationship" where the org hung the row off no loan. */
    scope: string;
    /** How many facilities `scope` names. Absent where it names none. */
    facilities?: number;
    detail?: string;
  }>;
  collateral?: Array<{
    asset: string;
    type?: string;
    advanceRate?: string;
    pledged?: string;
    lendable?: string;
    scope: string;
    /** THE ASSET'S VALUATION CLOCK, so a desk answering off this envelope can
     *  say when a figure was struck and when it is due again rather than
     *  reading a pledge amount back with no date on it. One line, built by
     *  `data/collateralValuation.ts`, and absent on no asset: it says "No
     *  valuation on file" where the read stages none. */
    valuation?: string;
  }>;
  /**
   * THE OBLIGOR GROUP, DOWNSTREAM OF THE BORROWER IN VIEW.
   *
   * `involvements` is who is on the DEAL; this is who the borrower IS connected
   * to — the parent that owns it, the affiliates beside it, the principals who
   * own it and by how much. The read carries both and only the first travelled,
   * so a parent reached the desk as a guarantor and two owners lost their 60/40
   * altogether. Rule 1 names the obligor group explicitly.
   */
  group?: Array<{
    name: string;
    /** THE ORG'S OWN ACCOUNT ID for this counterparty, where the graph carries
     *  one. `connectedPartyBook` is addressed by id, and a model holding only
     *  the name can only ever ask for it the one way that is ambiguous. */
    counterpartyId?: string;
    /** Normalised from the org's own role word, never guessed from a name. */
    relation: "parent" | "subsidiary" | "affiliate" | "owner" | "guarantor";
    /** The org's own word where it says more than the relation does
     *  ("Co-Owner", "Affiliated Company"). Absent where it says the same. */
    role?: string;
    /** Total ownership as the org carries it, direct or indirect. */
    ownership?: string;
    /** The counterparty's OWN highest risk grade, where the structural signals
     *  carry one. Never their exposure: no read on this cockpit carries it, and
     *  `notCarried` says so by name. */
    grade?: string;
  }>;
  /**
   * THE VERSION CHAIN, as `book/packages.ts` already computes it for the glass.
   *
   * nCino files a modification as a new package VERSION whose members start
   * unbooked, and the room refuses a second fork off a package that has one in
   * flight. That refusal reached the banker with the chat knowing nothing about
   * it, so "why can't I modify this" was answered blind. Absent where the
   * roster names no version on either side of this package.
   */
  inFlight?: {
    /** This package IS the unbooked version. */
    version?: true;
    /** A version forked from this package is unbooked with the org. */
    hasInFlightModification?: true;
    /** The version's own package id, where the roster links one. */
    versionId?: string;
    /** Still the banker's to shape, or already at Approval / Loan Committee. */
    editable?: boolean;
    /** The roster's own one-line account of it. */
    reason?: string;
  };
  /** The package's own totals. `scope` says WHICH book they are over, because
   *  the cockpit chat totals the whole relationship and these two figures
   *  differ on any relationship carrying more than one package. */
  exposure?: { committed: string; drawn: string; available?: string; facilities: number; scope: string };
  /** Pricing AS STORED. Rate only: this org stores no index name (see the
   *  prompt's prohibition) and no read on this cockpit carries a spread. */
  pricing?: Array<{ facility: string; rate: string }>;
  /** THE LAST FEW ACTIONS THIS COCKPIT FILED on this relationship. The host has
   *  passed the trail to the builder since the envelope shipped and the builder
   *  discarded it, so "what did we do last time" was answered by a model that
   *  had never been shown the answer. */
  history?: Array<{ what: string; action?: string; status?: string }>;
  /** What NO read on this cockpit carries, named so an answer refuses by name
   *  rather than reporting silence as a fact. */
  notCarried: string[];
}

/* -------------------------------------------------------- the client's mail

   THE MAIL IS NOT A READ BLOCK, AND THAT IS THE POINT. `reads` means "what this
   room has read from the BOOK". A mailbox is not the book: it is what the
   client SAID, and what a client says is a REQUEST, never a fact about the
   deal. Keeping it a sibling is what lets the doctrine say "never a source for
   a figure" without contradicting "speak from CONTEXT.reads".

   ONE MESSAGE, BOUNDED. Sender, date, subject and a clipped gist of the body,
   plus a COUNT of whatever else matched. Roughly 500 bytes against a 10 KB cap.
   No thread, no attachment, no second message: `notCarried` says so by name
   whenever this block is present.                                            */

export interface BrainMail {
  /** As the mailbox names the sender, VERBATIM. Absent is absent: a person is
   *  never inferred from a company name, a guarantor list or an address. */
  from?: string;
  /** `fmtDate` output, only where the date parsed. */
  received?: string;
  subject?: string;
  /** The body preview, clipped. ONE message only. */
  gist?: string;
  /** Other matched messages. A COUNT, never their text. */
  more?: number;
  /** The message is NEWER than the book this room is standing on, so the read
   *  predates it and nothing here reflects it. */
  arrivedAfterBook?: true;
  /** ONLY from a swept ClientRequest.ask, and labelled as the CLIENT'S figure.
   *  It is what they asked for, never what the book says. */
  asked?: { from?: string; to: string; facility?: string };
  /** The route the message points at, read by the room's own `readRouteIntent`
   *  over subject and gist. Absent where the message names no credit action. */
  route?: "modify" | "renew" | "create";
  /** Where it came from: a sweep already on the bundle, a live read, or an
   *  INTENT carried in from a conversation that happened somewhere else. The
   *  third is not a mailbox read and never claims to be one; it travels in this
   *  block because it is the same fact — what someone said — arriving by a
   *  different door. */
  source: "swept" | "mailbox" | "intent";
}

/** One exchange of the conversation so far. The banker's words are verbatim;
 *  the room's are summarised, because a room quoting itself at length crowds
 *  out the reads the answer actually needs. */
export interface BrainTurn {
  who: "banker" | "agent";
  text: string;
}

/** WHAT THIS ROUTE CAN AND CANNOT FILE. The relationship room refuses creates
 *  by name (CREATE_GAPS, OVERRIDE_NOT_FILEABLE) and the brain must refuse the
 *  same way rather than inventing a capability the org does not deploy. */
export interface BrainFileable {
  files: string[];
  cannot: Array<{ what: string; why: string }>;
}

/**
 * WHAT THE ROOM HANDS THE BRAIN.
 *
 * It carries the banker's line verbatim, where the room is standing, what it is
 * standing on, what it has already READ, the conversation so far, and a digest
 * of what is staged. It does NOT carry the grounding pack: that ships as the
 * plugin skill the session loads, and `grounding` names it so a session without
 * it says so rather than answering ungrounded.
 *
 * IT IS CAPPED. `capEnvelope` holds the serialised form under
 * {@link ENVELOPE_CAP_BYTES} and names in `omitted` whatever it had to drop, so
 * a trimmed envelope can never be read as an empty one.
 */
export interface BrainEnvelope {
  /** Protocol version. A session skill may refuse a shape it does not know.
   *  v2 added the read blocks, the thread digest and the fileable map. */
  v: 2;
  /** The banker's line, verbatim. Never rewritten, never summarised. */
  line: string;
  /** Which room is asking. The two rooms have different route vocabularies and
   *  different filing surfaces, and an answer must not confuse them. */
  room: "facility" | "relationship";
  relationship: string;
  /** The bound route, in the asking room's own vocabulary. "unbound" while the
   *  room is still asking which route this is. */
  route: string;
  /** TRUE while the route question is still open. A reply may then NAME the
   *  route (see `route` on the three shapes); binding still happens through the
   *  room's own router, and an ambiguous intent still asks. */
  routeOpen?: boolean;
  /** The legal route words, when the route question is open. */
  routeOptions?: string[];
  packageName: string;
  productPackageId: string | null;
  /** The facility the conversation is standing on, where one is selected. */
  selectedFacility: BrainFacility | null;
  /** The members a credit action can run against, so a proposal can name one. */
  facilities: BrainFacility[];
  /** The staged plan, digested. Titles, targets and the proposed reading only. */
  staged: Array<{ title: string; target: string; after: string }>;
  /** What the room has already read. Absent where it stands on no read. */
  reads?: BrainReadBlocks;
  /** THE CLIENT'S OWN MESSAGE, where this room found one. Top level, never
   *  inside `reads`: it is a request, not a read. */
  mail?: BrainMail;
  /**
   * ENTITIES THE READ BLOCKS DO NOT CARRY, for the line-item rail.
   *
   * `resolveEntities` resolves a row's rail out of the staged plan, the
   * covenants, the facilities, the involvements and the collateral. The
   * RELATIONSHIP room's greeting talks about two things none of those tables
   * holds: the risk grade on file and the reviews already filed. This is the
   * LAST rank of that lookup, so it can only fill a name nothing else claimed.
   *
   * The facility room never sets it and its behaviour is therefore unchanged by
   * construction, which is what the narrate suite pins.
   */
  entities?: Array<{ name: string; value: string; tone?: "warn" | "bad" }>;
  /** The conversation so far, oldest first. This is what makes it chat. */
  thread?: BrainTurn[];
  fileable?: BrainFileable;
  /** Blocks dropped to hold the envelope under its cap. Named, never silent. */
  omitted?: string[];
  /** WHERE THE GROUNDING IS. The pack is not inlined; the skill carries it. */
  grounding: "plugin-skill:workroom-brain";
}

/* ------------------------------------------------------------------- the cap

   A PROMPT IS NOT A DATABASE. The read blocks are bounded by the package, but a
   long conversation is not, so the envelope is trimmed to a budget before it
   travels. THREAD HISTORY GOES FIRST: an answer without the last six exchanges
   is a worse conversation, and an answer without the covenant thresholds is a
   wrong one.                                                                 */

/** The serialised budget. Comfortably inside the completion door's headroom and
 *  well clear of the grounding pack the skill loads beside it. */
export const ENVELOPE_CAP_BYTES = 10_000;

/** Read blocks in the order they are given up.
 *
 *  THE ORDER IS NOT THIS FILE'S ANY MORE (2026-09-12, backlog item 9). It is
 *  {@link CONTEXT_DROP_ORDER}, shared with the cockpit chat, so the block the
 *  envelope surrenders first is the block the chat's own cut reaches first and
 *  the two surfaces cannot disagree about what matters least. */
export const ENVELOPE_BLOCK_DROP_ORDER = CONTEXT_DROP_ORDER;

const sizeOf = (envelope: BrainEnvelope): number => JSON.stringify(envelope).length;

/**
 * THE ENVELOPE, TRIMMED TO ITS BUDGET, SAYING WHAT IT DROPPED.
 *
 * Thread turns go oldest-first, then whole read blocks in
 * {@link ENVELOPE_BLOCK_DROP_ORDER}. `omitted` names everything given up so a
 * reply can say "that is not in front of me" rather than "there is none", and
 * it is measured as it grows: a cap that ignored its own honesty field would
 * come back over budget by exactly the width of that field.
 *
 * THE BANKER'S LINE IS NEVER TRIMMED. Where the line alone is bigger than the
 * budget, the envelope travels over it with every block named as omitted: a
 * question cut in half is worse than a prompt that is long.
 */
export function capEnvelope(envelope: BrainEnvelope, cap: number = ENVELOPE_CAP_BYTES): BrainEnvelope {
  if (sizeOf(envelope) <= cap) return envelope;
  const out: BrainEnvelope = { ...envelope };
  const omit = (what: string) => {
    out.omitted = [...(out.omitted ?? []), what];
  };

  if (out.thread?.length) {
    const thread = [...out.thread];
    const before = thread.length;
    while (thread.length && sizeOf({ ...out, thread, omitted: [...(out.omitted ?? []), "earlier conversation"] }) > cap) {
      thread.shift();
    }
    out.thread = thread.length ? thread : undefined;
    if (thread.length !== before) omit("earlier conversation");
  }

  if (sizeOf(out) > cap && out.reads) {
    const reads: BrainReadBlocks = { ...out.reads };
    out.reads = reads;
    for (const block of ENVELOPE_BLOCK_DROP_ORDER) {
      if (sizeOf(out) <= cap) break;
      if (reads[block] === undefined) continue;
      delete reads[block];
      omit(block);
    }
  }

  /* THE MAIL IS SURRENDERED LAST, and it is named when it is. It is not in
     ENVELOPE_BLOCK_DROP_ORDER because that list is indexed as `reads[block]`
     and the mail is not a read block. This step should never fire; it exists so
     the mail can be given up rather than being the one thing that cannot. */
  if (sizeOf(out) > cap && out.mail) {
    delete out.mail;
    omit("mail");
  }
  return out;
}

/* --------------------------------------------------------- the three shapes */

/**
 * THE ROUTE A REPLY NAMES, where the room is still asking which route this is.
 *
 * It is the asking room's OWN vocabulary (`routeOptions` on the envelope), and
 * the ROOM decides whether the word is legal: a route the room does not know is
 * ignored and the question stands. Binding always runs through the room's own
 * router, so a named route can do nothing a chip could not.
 */
interface Routed {
  route?: string;
}

/** (a) An answer, rendered by the room's own read-card components. */
export interface BrainReadCard extends Routed {
  type: "read-card";
  /** The card style slug: involvements, covenants, collateral, fees, exposure,
   *  pricing, exceptions, history, decisions. Free text; the room maps it. */
  topic: string;
  /** One line, banker language, no question mark. */
  title: string;
  rows: Array<{ icon: string; label: string; value: string; sub?: string }>;
  /** ONE question, only where the read leads somewhere. Never two. */
  followUp?: string;
}

/** One entry of a change list. `targetLoanId` may be omitted where exactly one
 *  facility is selected; the room resolves it against the selection. */
interface Targeted {
  targetLoanId?: string;
}

export interface BrainScalarChange extends Targeted {
  key: "requestedAmount" | "requestedMaturityDate" | "requestedRate" | "requestedTermMonths";
  value: number | string;
}
export interface BrainCovenantAdd extends Targeted {
  typeName: string;
  threshold: number;
  operator: "<" | "<=" | "=" | ">=" | ">";
  frequency?: string;
  effectiveDate?: string;
}
export interface BrainInvolvementChange extends Targeted {
  op: "add" | "remove";
  role?: string;
  accountId?: string;
  accountName?: string;
  ownership?: number;
}
export interface BrainFieldChange extends Targeted {
  field: string;
  value: string | number | boolean;
}
export interface BrainFeeAdd extends Targeted {
  feeType: string;
  description?: string;
  calculationType: "Percentage" | "Flat Amount";
  percentage?: number;
  amount?: number;
  basisSource?: string;
  recordType?: string;
  paidBy?: string;
}
export interface BrainPledgeAdd extends Targeted {
  collateralId?: string;
  newCollateral?: { description: string; collateralType: string; value: number };
  advanceRate?: number;
  advanceRateReason?: string;
  amountPledged?: number;
  lienPosition?: string;
}
export interface BrainPolicyExceptionAdd extends Targeted {
  title: string;
  status: "Waived" | "Mitigated" | "Unmitigated";
  mitigationReasons?: string[];
  severity?: string;
  severityValue?: number;
  code?: string;
  type?: string;
}

/** The seven wire keys of `stage_loan_modification`, as the pack declares them. */
export interface BrainChanges {
  scalarChangesJson?: BrainScalarChange[];
  covenantAddsJson?: BrainCovenantAdd[];
  involvementChangesJson?: BrainInvolvementChange[];
  fieldChangesJson?: BrainFieldChange[];
  feeAddsJson?: BrainFeeAdd[];
  pledgeAddsJson?: BrainPledgeAdd[];
  policyExceptionAddsJson?: BrainPolicyExceptionAdd[];
}

/** (b) A proposed change. It never reaches a tool from here: it is restated as
 *  a sentence and re-enters the deterministic parser. */
export interface BrainDeltaProposal extends Routed {
  type: "delta-proposal";
  action: "loan-modification";
  /** REQUIRED by the tool, and by us: it is the credit reason on the ledger. */
  rationale: string;
  facilityIds?: string[];
  loanId?: string;
  changes: BrainChanges;
}

/** (c) An honest question, when intent is genuinely ambiguous. */
export interface BrainClarify extends Routed {
  type: "clarify";
  text: string;
  /** Present only where the legal answer set is closed and short. `say` is the
   *  sentence the chip types back, so a chip can do nothing the banker could
   *  not have typed. */
  options?: Array<{ label: string; say: string }>;
  /**
   * THIS CLARIFY IS A DEGRADE, not an answer.
   *
   * Set by this module and NEVER by a model reply (the validator strips it).
   * It is what lets the room fall back to today's parser reply instead of
   * showing a lane failure where the fast lane had a real answer to give.
   */
  degraded?: true;
}

/** TRUE where a reply is this module's own degrade rather than a desk answer. */
export function isDegrade(reply: BrainReply): boolean {
  return reply.type === "clarify" && reply.degraded === true;
}

export type BrainReply = BrainReadCard | BrainDeltaProposal | BrainClarify;

/* ----------------------------------------------------------- the validator */

/** Why a reply was not accepted. Rendered nowhere: it is for the console and
 *  for the tests. The banker gets the neutral clarify. */
export type BrainRejection =
  | "empty"
  | "not-json"
  | "not-an-object"
  | "unknown-type"
  | "bad-read-card"
  | "bad-delta"
  | "bad-clarify";

export type BrainParse = { ok: true; reply: BrainReply } | { ok: false; why: BrainRejection };

/** THE NEUTRAL DEGRADE. One sentence, no blame, and a route out that the fast
 *  lane can actually take. Every validation failure resolves to this. */
export const UNREADABLE_CLARIFY: BrainClarify = {
  type: "clarify",
  text: "I could not read that answer. Try asking directly, or say the change you want and I will put it up.",
  degraded: true,
};

/**
 * THE SAME DEGRADE, IN THE ASKING ROOM'S OWN VOCABULARY (fixer pass,
 * 2026-09-12).
 *
 * "Say the change you want and I will put it up" is the FACILITY room's move:
 * it stages a change on a package. The relationship room reviews and files —
 * it has no package to put a change up on — so that route out sent a banker
 * standing in a covenant review to a move this room cannot make, which is the
 * dead end golden rule 4 forbids. The move it CAN make is the review it is
 * already standing in, so that is what its degrade names.
 */
export function unreadableClarify(room: BrainEnvelope["room"]): BrainClarify {
  if (room !== "relationship") return UNREADABLE_CLARIFY;
  return {
    type: "clarify",
    text: "I could not read that answer. Ask it a different way, or answer the question on the table and I will carry it into the review.",
    degraded: true,
  };
}

/** The clarify a round trip that never came back resolves to. It names the
 *  delay rather than pretending the question was answered. */
export function timeoutClarify(seconds: number): BrainClarify {
  return {
    type: "clarify",
    text: `The desk has not come back within ${seconds} seconds, so I am not going to leave you waiting on it. Ask again, or say the change you want and I will put it up.`,
    degraded: true,
  };
}

/**
 * The clarify a room with no door answers a routed line with. Honest, and it
 * never hangs: there was nothing to wait for.
 *
 * REWRITTEN 2026-09-12 (founder, the fallback audit; golden rule 4). It used to
 * end on "I can still change this package once a connector is added": a future
 * capability, conditional on an act only an administrator can perform, offered
 * to a banker standing in the room now. The deterministic parser is untouched
 * by any of this, so the room CAN still stage a change the banker types. That
 * is the move, and it is the one this sentence names.
 */
export const NOT_CONNECTED_CLARIFY: BrainClarify = {
  type: "clarify",
  text: "I cannot take that question to the desk from this view. Say the change you want in plain words and I will put it up, and the figures on the cards here are the ones already read from the bank.",
  degraded: true,
};

/**
 * THE DOOR DID NOT ANSWER, WHICH IS NOT A REPLY THAT COULD NOT BE READ.
 *
 * Every transport failure used to resolve to {@link UNREADABLE_CLARIFY}, which
 * told the banker a reply was malformed when no reply was ever made, and then
 * sent them back down the path that had just failed ("try asking directly").
 * Untrue, and a loop by rule 5. This names the state and offers the lane that
 * is still working (founder 2026-09-12, the fallback audit).
 */
export const NO_ANSWER_CLARIFY: BrainClarify = {
  type: "clarify",
  text: "The desk did not answer that one. Ask again, or say the change you want and I will put it up from the book already on this page.",
  degraded: true,
};

const isRow = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const SCALAR_KEYS = new Set(["requestedAmount", "requestedMaturityDate", "requestedRate", "requestedTermMonths"]);
const OPERATORS = new Set(["<", "<=", "=", ">=", ">"]);
const EXCEPTION_STATUS = new Set(["Waived", "Mitigated", "Unmitigated"]);
const CHANGE_KEYS = [
  "scalarChangesJson",
  "covenantAddsJson",
  "involvementChangesJson",
  "fieldChangesJson",
  "feeAddsJson",
  "pledgeAddsJson",
  "policyExceptionAddsJson",
] as const;

/** Every entry of a change list must be an object, or the list is not one. */
function rows(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.every(isRow) ? (v as Record<string, unknown>[]) : null;
}

/** ONE entry of one change list, validated against its own required fields.
 *  An entry that fails takes its whole list with it: a half-read change list
 *  would stage some of what the brain proposed and silently drop the rest. */
function validEntry(key: (typeof CHANGE_KEYS)[number], e: Record<string, unknown>): boolean {
  if (e.targetLoanId !== undefined && !str(e.targetLoanId)) return false;
  switch (key) {
    case "scalarChangesJson":
      return str(e.key) && SCALAR_KEYS.has(e.key as string) && (num(e.value) || str(e.value));
    case "covenantAddsJson":
      return str(e.typeName) && num(e.threshold) && str(e.operator) && OPERATORS.has(e.operator as string);
    case "involvementChangesJson":
      return (e.op === "add" || e.op === "remove") && (str(e.accountName) || str(e.accountId));
    case "fieldChangesJson":
      return str(e.field) && (num(e.value) || str(e.value) || typeof e.value === "boolean");
    case "feeAddsJson":
      if (!str(e.feeType)) return false;
      if (e.calculationType === "Percentage") return num(e.percentage) && e.amount === undefined;
      if (e.calculationType === "Flat Amount") return num(e.amount) && e.percentage === undefined;
      return false;
    case "pledgeAddsJson": {
      const existing = str(e.collateralId);
      const fresh = isRow(e.newCollateral) && str(e.newCollateral.description) && str(e.newCollateral.collateralType);
      // EXACTLY ONE of the two shapes. Both, or neither, is not a pledge.
      return existing !== fresh;
    }
    case "policyExceptionAddsJson":
      return str(e.title) && str(e.status) && EXCEPTION_STATUS.has(e.status as string);
  }
}

/** A named route is a STRING or it is not there. Whether the word is a legal
 *  route is the ROOM's judgement, not the validator's: the two rooms have
 *  different vocabularies and neither one is knowable from here. */
const validRoute = (o: Record<string, unknown>): boolean => o.route === undefined || str(o.route);

function validDelta(o: Record<string, unknown>): boolean {
  if (o.action !== "loan-modification") return false;
  if (!validRoute(o)) return false;
  if (!str(o.rationale)) return false;
  // ONE SHAPE OR THE OTHER, never both: the tool refuses a request carrying
  // the package-anchored list and the single-facility back-compat field.
  if (o.facilityIds !== undefined && o.loanId !== undefined) return false;
  if (o.facilityIds !== undefined && !(Array.isArray(o.facilityIds) && o.facilityIds.length > 0 && o.facilityIds.every(str)))
    return false;
  if (o.loanId !== undefined && !str(o.loanId)) return false;
  if (!isRow(o.changes)) return false;

  let carried = 0;
  for (const key of CHANGE_KEYS) {
    const raw = (o.changes as Record<string, unknown>)[key];
    if (raw === undefined) continue;
    const list = rows(raw);
    if (!list || !list.every((e) => validEntry(key, e))) return false;
    carried += list.length;
  }
  // A proposal with no change is refused by the tool, so it is refused here.
  return carried > 0;
}

function validReadCard(o: Record<string, unknown>): boolean {
  if (!str(o.topic) || !str(o.title) || !validRoute(o)) return false;
  const list = rows(o.rows);
  if (!list) return false;
  if (o.followUp !== undefined && !str(o.followUp)) return false;
  return list.every((r) => str(r.icon) && str(r.label) && str(r.value) && (r.sub === undefined || str(r.sub)));
}

function validClarify(o: Record<string, unknown>): boolean {
  if (!str(o.text) || !validRoute(o)) return false;
  // `degraded` is THIS MODULE'S word for its own fallback. A reply that claims
  // it would make the room replay the parser over a real desk answer, so it is
  // stripped rather than trusted.
  delete o.degraded;
  if (o.options === undefined) return true;
  const list = rows(o.options);
  return !!list && list.every((c) => str(c.label) && str(c.say));
}

/**
 * THE HARD VALIDATOR.
 *
 * A model reply is untrusted text. It is accepted only when it is exactly one
 * of the three shapes AND every required field of that shape is present and of
 * the right type. Anything else is rejected with a reason, and the caller
 * degrades to {@link UNREADABLE_CLARIFY}.
 *
 * The raw string may carry a fenced code block, a leading sentence or a
 * trailing one: models do that, and refusing on it would fail a reply that is
 * otherwise perfectly in contract. The FIRST balanced top-level object is
 * taken. Nothing else is tolerated.
 */
export function parseBrainReply(raw: string): BrainParse {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, why: "empty" };

  const json = extractObject(text);
  if (json === null) return { ok: false, why: "not-json" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, why: "not-json" };
  }
  if (!isRow(parsed)) return { ok: false, why: "not-an-object" };

  switch (parsed.type) {
    case "read-card":
      return validReadCard(parsed) ? { ok: true, reply: parsed as unknown as BrainReadCard } : { ok: false, why: "bad-read-card" };
    case "delta-proposal":
      return validDelta(parsed) ? { ok: true, reply: parsed as unknown as BrainDeltaProposal } : { ok: false, why: "bad-delta" };
    case "clarify":
      return validClarify(parsed) ? { ok: true, reply: parsed as unknown as BrainClarify } : { ok: false, why: "bad-clarify" };
    default:
      return { ok: false, why: "unknown-type" };
  }
}

/** The first balanced `{...}` at top level, string-aware so a brace inside a
 *  quoted value cannot close the object early. Null where there is none. */
function extractObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/* ------------------------------------------------------------- the restate

   A VALIDATED PROPOSAL BECOMES A SENTENCE, and the sentence goes back through
   the deterministic parser. That is the whole of how the brain reaches the
   staging path: it can do nothing a banker could not have typed, the org
   re-validates at stage time exactly as it always did, and the plan hash, the
   single-use token and the one human approval are untouched.

   Every phrasing below is one the parser's own suite already asserts
   (app/src/workroom/parseModify.test.ts). A shape with no proven phrasing is
   NOT invented one: `restateProposal` drops it and the caller says so.        */

/** The member label a `targetLoanId` names, for the parser to resolve on. */
export type FacilityNamer = (loanId: string | undefined) => string | null;

const money = (v: number | string): string =>
  typeof v === "number" ? `$${Math.round(v).toLocaleString("en-US")}` : String(v);

/** " on the Line of Credit", or nothing where no member is named. */
const on = (name: string | null) => (name ? ` on the ${name}` : "");

function scalarLine(c: BrainScalarChange, name: string | null): string | null {
  const target = name ?? "facility";
  switch (c.key) {
    case "requestedAmount":
      return `take the ${target} to ${money(c.value)}`;
    case "requestedMaturityDate":
      return str(c.value) ? `move the ${target} maturity to ${c.value}` : null;
    case "requestedRate":
      return `move the ${target} rate to ${typeof c.value === "number" ? `${c.value}%` : c.value}`;
    case "requestedTermMonths":
      return num(c.value) ? `give the ${target} a ${c.value} month term` : null;
  }
}

/**
 * THE PROPOSAL, SAID.
 *
 * One sentence per change, in landing order, each with the label the banker
 * reads on the chip. `dropped` counts what carried no proven phrasing, so the
 * room can say what it did not offer rather than swallowing it.
 */
export function restateProposal(
  proposal: BrainDeltaProposal,
  nameFor: FacilityNamer,
): { lines: Array<{ say: string; label: string }>; dropped: number } {
  const lines: Array<{ say: string; label: string }> = [];
  let dropped = 0;
  // A single-facility proposal names its member once; every entry inherits it.
  const fallbackId = proposal.loanId ?? (proposal.facilityIds?.length === 1 ? proposal.facilityIds[0] : undefined);
  const push = (say: string | null, label: string) => (say ? lines.push({ say, label }) : dropped++);
  const named = (e: Targeted) => nameFor(e.targetLoanId ?? fallbackId);

  for (const c of proposal.changes.scalarChangesJson ?? []) {
    const line = scalarLine(c, named(c));
    push(line, line ?? c.key);
  }
  for (const c of proposal.changes.covenantAddsJson ?? []) {
    push(
      `add a ${c.typeName} covenant ${c.operator} ${c.threshold}${on(named(c))}`,
      `Add ${c.typeName} ${c.operator} ${c.threshold}`,
    );
  }
  for (const c of proposal.changes.involvementChangesJson ?? []) {
    const who = c.accountName;
    if (!who) {
      // An id with no name is a record the banker cannot read on a chip, and
      // the parser resolves parties by NAME. Dropped rather than guessed at.
      dropped++;
      continue;
    }
    push(
      c.op === "add"
        ? `add ${who} as a ${c.role ?? "guarantor"}${on(named(c))}`
        : `remove ${who} from the ${named(c) ?? "package"}`,
      c.op === "add" ? `Add ${who}` : `Remove ${who}`,
    );
  }
  for (const c of proposal.changes.fieldChangesJson ?? []) {
    push(`set ${c.field} to ${c.value}${on(named(c))}`, `Set ${c.field} to ${c.value}`);
  }
  for (const c of proposal.changes.feeAddsJson ?? []) {
    push(
      c.calculationType === "Percentage"
        ? `add a ${c.percentage}% ${c.feeType} fee${on(named(c))}`
        : `add a ${money(c.amount ?? 0)} ${c.feeType} fee${on(named(c))}`,
      `Add ${c.feeType} fee`,
    );
  }
  for (const c of proposal.changes.pledgeAddsJson ?? []) {
    const name = named(c);
    push(
      c.newCollateral
        ? `add a new ${money(c.newCollateral.value)} ${c.newCollateral.collateralType} as collateral${on(name)}`
        : // An existing asset is pledged by the id the read gave us; the parser
          // resolves the deal's own assets by description, so an id with no
          // description carries no proven phrasing.
          null,
      c.newCollateral ? `Pledge ${c.newCollateral.description}` : "Pledge",
    );
  }
  for (const c of proposal.changes.policyExceptionAddsJson ?? []) {
    push(
      `log a policy exception: ${c.title}, ${c.status.toLowerCase()}${on(named(c))}`,
      `Log exception: ${c.title}`,
    );
  }
  return { lines, dropped };
}

/* --------------------------------------------------------------- the wire */

/** How long the room waits on a rung-2 quick call. A restatement that takes
 *  longer than this has stopped being a restatement. */
export const BRAIN_TIMEOUT_MS = 25_000;

/** Rung 2 on the default tier: the contract says 5 to 60 seconds to first text,
 *  up to two minutes on a long structured prompt. */
export const BRAIN_TIMEOUT_DEFAULT_MS = 90_000;

/** Rung 3: several rounds back to back, commonly 30 to 90 seconds and legally
 *  longer. A timeout tighter than the platform's own would cut off an answer
 *  the banker was told to expect. */
export const BRAIN_TIMEOUT_TOOLS_MS = 150_000;

/** The wait this rung is allowed. One place, so no caller has to remember it. */
export function timeoutFor(choice: RungChoice): number {
  if (choice.rung === 3) return BRAIN_TIMEOUT_TOOLS_MS;
  return choice.tier === "quick" ? BRAIN_TIMEOUT_MS : BRAIN_TIMEOUT_DEFAULT_MS;
}

/**
 * IS THERE A BRAIN LANE AT ALL.
 *
 * ONE DOOR (2026-09-15). The SESSION door (`window.claude.use("sample")`) is
 * the one the recorded decision names: the viewer's own Claude, their identity,
 * their connectors, zero infrastructure. The gateway completion beneath it is
 * retired, so this counts the door `doorFor` actually tries and the two can no
 * longer disagree.
 *
 * WITHOUT IT the room keeps the fast lane and the existing loud notice, and a
 * routed line gets {@link NOT_CONNECTED_CLARIFY} rather than a hang.
 */
export function brainReachable(): boolean {
  return sampleAvailable();
}

/* ------------------------------------------------------- the doctrine, inline

   THE PACK NEVER ARRIVES, SO THE DOCTRINE TRAVELS IN THE PROMPT.

   The envelope has always declared `grounding: "plugin-skill:workroom-brain"`
   and the preamble has always said "obey it". No channel loads it, and the
   SESSION door cannot: `sample` has no page-controlled system prompt and does
   not auto-load the plugin skill either. So the instruction pointed at a
   document neither responder could read, and P3 of the 2026-09-01 drive
   degraded for exactly that reason.

   WHAT TRAVELS IS THE SLICE, NOT THE PACK, and the slicing now lives in
   channel/doctrine.ts: named, budgeted blocks, four of which travel on every
   line and the rest selected by the surface the line is about. The marker in
   the envelope stays, because a session that HAS loaded the pack should still
   be told the pack is the authority; the prompt simply no longer depends on it.

   THE BUDGET IS THE WHOLE PROMPT. `budgetPrompt` gives up thread history first,
   doctrine second, and never the read blocks.                                */

/** The composer's own preamble, in bytes, so the budget is the whole prompt
 *  rather than two halves that each fit and together do not. */
const PREAMBLE_BYTES = 1_400;

/**
 * THE PROMPT THE ENVELOPE TRAVELS IN.
 *
 * Both doors take a string, so the envelope is serialised into one. The
 * preamble states the GROUNDING FACTS contract (what CONTEXT carries and how to
 * refuse what it does not), then the doctrine slices this line needs, then the
 * envelope itself.
 */
export function composeBrainPrompt(envelope: BrainEnvelope): string {
  const budgeted = budgetPrompt({ envelope, mode: "reply", overhead: PREAMBLE_BYTES });
  return [
    "You are the credit brain of a relationship workroom, answering one banker line.",
    "The workroom-brain pack (WORKROOM-BRAIN.md) is the authority. The slices you need are below.",
    "",
    /* ------------------------------------------- THE GROUNDING FACTS CONTRACT
       The envelope is no longer blind, so an answer that ignores it is now a
       worse failure than one that refuses. */
    "GROUNDING FACTS. CONTEXT.reads carries what this room has already read:",
    "the facilities with their maturities, stages and coverage, covenants, involvements, the obligor group,",
    "the package's version chain, collateral, exposure, pricing and the actions already filed,",
    "formatted as the glass prints them.",
    "Answer READS from those blocks and state the figures as they stand there.",
    "CONTEXT.reads.notCarried names what no read on this cockpit holds, and CONTEXT.omitted names",
    "what was dropped to fit. Refuse those BY NAME. An absent block is never an empty fact.",
    "",
    "CONTEXT.thread is the conversation so far, oldest first. Read it: this is one conversation.",
    "CONTEXT.fileable names what this route can and cannot file. Refuse what it cannot, by name,",
    "rather than proposing a change no deployed tool accepts.",
    'If CONTEXT.routeOpen is true you may add "route" to your reply, naming ONE of CONTEXT.routeOptions,',
    "where the line makes the intent plain. Where it does not, clarify and let the banker pick.",
    "",
    ...budgeted.doctrine.lines,
    "",
    "CONTEXT:",
    JSON.stringify(budgeted.envelope),
  ].join("\n");
}

export interface BrainAskDeps {
  /** The door, overridden. Injected so the suite never touches a global. */
  send?: (prompt: string, signal?: AbortSignal) => Promise<string>;
  /** The clock the timeout runs on. Injected for the same reason. */
  timeoutMs?: number;
  /**
   * WHAT THE RUNG-3 TOOLS BIND TO. Absent means no tools are offered at all, so
   * a room that does not know which relationship it is standing in can never
   * hand the model a door to somebody else's book.
   */
  anchor?: { accountId: string | null; company: string | null };
  /** The rung, overridden. The router decides it from the envelope otherwise. */
  rung?: RungChoice;
  /**
   * THE MODEL STARTED WRITING (B2, founder latency brief 2026-09-12).
   *
   * Forwarded to the session door and fired at most once, on the first token.
   * The reply itself is JSON and must never be rendered from a partial, so this
   * carries no text: it is the one honest beat a room can put between "reading"
   * and "writing" in a silence that runs to 150 seconds at rung 3.
   */
  onFirstToken?: () => void;
}

/**
 * THE SESSION DOOR, AND NOTHING BENEATH IT (2026-09-15).
 *
 * IDB Gateway retired; the rooms ask the banker's own Claude or they say they
 * could not. `sample` was always the recorded decision and the correct door,
 * and the gateway completion under it was the rung kept while the latency gate
 * was unproven. Every way the door can fail, a null capability, a declined
 * consent, a rate limit, a refusal, a transport fault, now means one thing:
 * say so and let the caller degrade. The banker is never shown which door
 * answered, and the caller turns a failure into a clarify the room can draw.
 *
 * TOOLS RIDE ONLY AT RUNG 3, and only where the room named an anchor. That is
 * the whole of what keeps a 30 to 90 second round trip rare.
 */
function doorFor(envelope: BrainEnvelope, deps: BrainAskDeps, choice: RungChoice) {
  return async (prompt: string, signal?: AbortSignal): Promise<string> => {
    if (!sampleAvailable()) throw new Error("no door answered");
    return askSessionJson(prompt, {
      kind: "reply",
      tier: choice.tier,
      rung: choice.rung,
      signal,
      onFirstToken: deps.onFirstToken,
      tools:
        choice.rung === 3 && deps.anchor
          ? buildBrainTools({ anchor: deps.anchor, reads: envelope.reads })
          : undefined,
    });
  };
}

/**
 * ASK THE BRAIN, AND COME BACK WITH SOMETHING RENDERABLE.
 *
 * This never rejects and never resolves to a shape the room cannot draw. Every
 * failure — no door, a timeout, a transport error, a malformed reply — comes
 * back as a clarify the room renders as an agent bubble.
 */
/** What a door that threw resolves to, distinct from any text it could return. */
const SILENT = Symbol("no-door-answered");

export async function askBrain(envelope: BrainEnvelope, deps: BrainAskDeps = {}): Promise<BrainReply> {
  const choice = deps.rung ?? rungFor(envelope);
  const send = deps.send ?? doorFor(envelope, deps, choice);
  const timeoutMs = deps.timeoutMs ?? timeoutFor(choice);
  if (!deps.send && !brainReachable()) return NOT_CONNECTED_CLARIFY;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    // THE BUDGET IS ENFORCED AT THE WIRE, not at the caller: every room that
    // builds an envelope gets the same cap without having to remember it.
    const prompt = composeBrainPrompt(capEnvelope(envelope));
    /* THE TWO FAILURES ARE TOLD APART. A door that threw produced NO reply, and
       calling that unreadable is a false statement about the desk (founder
       2026-09-12). The sentinel is a symbol so a model can never emit it. */
    const raced = await Promise.race([send(prompt, controller.signal).catch(() => SILENT), timeout]);
    if (raced === "timeout") {
      controller.abort();
      return timeoutClarify(Math.round(timeoutMs / 1000));
    }
    if (raced === SILENT) return NO_ANSWER_CLARIFY;
    // AND THE DEGRADE SPEAKS THE ASKING ROOM'S VOCABULARY (see below).
    if (typeof raced !== "string") return unreadableClarify(envelope.room);
    const parsed = parseBrainReply(raced);
    return parsed.ok ? parsed.reply : unreadableClarify(envelope.room);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
