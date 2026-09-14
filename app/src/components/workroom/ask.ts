import type { WorkroomDelta } from "../../workroom/types";

/* =============================================================================
   WHAT KIND OF THING THE BANKER JUST SAID.

   THE GUARD RUNS BEFORE THE PARSER, AND IT IS NOT A PARSER (founder, live run
   2026-09-01). Two transcripts made the case:

     "which borrowers have we already in the package?"
        -> the parser's refusal boilerplate, over a bundle holding all 21
           involvements. A question the room could answer, refused.

     "what covenants are against this Product Package"
        -> matched field="Product", value="Package" on the Line of Credit and
           STAGED A TERM CHANGE. Confidently wrong, which is worse.

   So: a question never becomes a delta. It is answered from the read the room
   already holds, or it is answered honestly with what the room can do. That is
   the whole of this module — it recognises SHAPES, it resolves no records and
   it stages nothing. The engines under `app/src/workroom/` are untouched by it.

   THE HUMAN GATE HELD THROUGH BOTH TRANSCRIPTS: nothing could be written
   without Confirm. What failed was the intelligence, and these are the two
   deterministic guards that stand in front of it until the agent layer lands.
   ============================================================================= */

/* ------------------------------------------------------------ question shape */

/** The words that open a question. `can` is in the founder's own list. */
const INTERROGATIVE_OPENERS =
  /^(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|have|has|had|any|anything)\b/i;

/** The same words, wherever they sit, for the value bounds below. A staged
 *  VALUE containing "what" is a sentence someone sliced, not a value. */
const INTERROGATIVE_ANYWHERE =
  /\b(what|which|who|whom|whose|when|where|why|how|do i|do we|does|did|can i|can we|should|would)\b/i;

/**
 * IS THIS A QUESTION.
 *
 * A leading interrogative, or a question mark anywhere. Deliberately blunt:
 * the cost of treating an instruction as a question is one clarifying
 * exchange, and the cost of treating a question as an instruction is a staged
 * delta nobody asked for.
 *
 * KNOWN CONSEQUENCE, accepted on the founder's own wording: "can you increase
 * the Line of Credit to $20M" opens on `can` and is therefore answered rather
 * than staged. The banker's own phrasing without the courtesy ("increase the
 * Line of Credit to $20M") stages exactly as it always has.
 */
export function isQuestion(text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  return line.includes("?") || INTERROGATIVE_OPENERS.test(line);
}

/* -------------------------------------------------------------- read intents */

export type ReadTopic = "structure" | "covenants" | "collateral" | "fees" | "facilities";

/** The openers that make a line a READ rather than an instruction. Without one
 *  of these "add a covenant to the revolver" would be read as a request to LIST
 *  the covenants, which is the mirror image of the bug this module exists for. */
const READ_OPENER =
  /\b(which|who|whose|what|list|show|tell me|do we|do i|have we|have i|are there|is there|how many|what's|whats)\b/i;

/** One topic per line, tested in the order a collision should resolve. A line
 *  naming two topics is answered on the first one named here rather than on
 *  whichever regex happened to run first. */
const TOPICS: Array<[ReadTopic, RegExp]> = [
  /* THE VERB IS A STRUCTURE WORD TOO. "who guarantees the construction loan"
     carried no noun from this list, matched "loan" and came back as the
     FACILITIES card: a question about the borrowing structure answered with a
     list of commitments. `doctrine.ts` and `ladder.ts` have classified the same
     sentence on `guarantee\w*|guaranty` all along; this row was the one that
     did not. */
  ["structure", /\b(borrowers?|guarantors?|guarantee\w*|guarant(?:y|ies)|entit(?:y|ies)|involvements?|parties|obligors?|co-?borrowers?|structure|who is on|who's on)\b/i],
  ["covenants", /\b(covenants?|tests?|financial covenants?)\b/i],
  /* THE PLURAL IS HOW THE FOUNDER ASKS (0.9.22 preview, IMPROVEMENTS row 44).
     "show me all my collaterals" and "show my full collaterals" both fell out of
     this row on the singular `\bcollateral\b`, went past the question guard as
     an instruction, and came back as "I could not match that to anything on this
     package" over a package carrying eight pledges. The noun a banker reaches
     for is not always the one the org's field is named after: collateral is also
     said as security, as what is pledged, as the assets, and as what SECURES the
     facility, and every one of those is the same card. */
  ["collateral", /\b(collaterals?|securit(?:y|ies)|secure[sd]?|pledges?|pledged|assets?|liens?)\b/i],
  ["fees", /\b(fees?)\b/i],
  ["facilities", /\b(facilit(?:y|ies)|members?|loans?|lines?\s+of\s+credit)\b/i],
];

/* ------------------------------------------------------- the shortest reads

   "ANY GUARANTORS?" WENT TO THE DESK (E7, founder drive 2026-09-01). It carries
   no opener from the list above, so `readTopic` returned null, the question
   guard sent it over the bridge, and a blind desk answered with a card holding
   the heading "Guarantors" and no rows under it — while the room was holding
   the involvements the whole time.

   A BARE TOPIC IS A READ. "any guarantors?", "guarantors?", "covenants?" are
   how a banker asks at a screen, and each of them is a question this room can
   answer from the bundle. The rule stays narrow so an instruction can never
   fall into it: no verb the room stages on, a handful of words, and either an
   "any" in front or a question mark behind. */

/** Anything that makes the line an instruction rather than a question. */
const ACTS = /\b(add|adds|remove|removes|drop|drops|pledge|pledges|change|changes|set|sets|move|moves|increase|decrease|reduce|raise|lower|extend|take|make|put|file|stage|log|waive|release|renew|reprice)\b/i;

/** Past this it is a sentence, not a bare topic. */
const BARE_WORD_CAP = 4;

function bareTopic(line: string): boolean {
  const words = line.replace(/[?.!]+$/, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > BARE_WORD_CAP) return false;
  if (ACTS.test(line)) return false;
  return line.trim().endsWith("?") || /^any\b/i.test(line.trim());
}

/**
 * THE TOPIC A READ QUESTION IS ABOUT, or null.
 *
 * Null is not a failure and it is not an apology: it means this line is not one
 * of the reads the room can answer deterministically, and the caller then falls
 * through to `isQuestion` (an honest account of what the room CAN do) or to the
 * parser (an instruction).
 */
export function readTopic(text: string): ReadTopic | null {
  const line = text.trim();
  if (!line) return null;
  if (!READ_OPENER.test(line) && !bareTopic(line)) return null;
  for (const [topic, re] of TOPICS) if (re.test(line)) return topic;
  return null;
}

/* ============================ A QUESTION IS NOT A READ REPEAT (founder's Blue
   Ridge run, 2026-09-14, defect e).

   "do we need to add a new covenant?" was answered with the covenant card the
   room had just printed, and, because it was the same card, with "that is the
   same read as a moment ago" above it. The banker did not ask to SEE the
   covenants. They asked whether the package needs another one, which is a
   judgement: it is answered from the relationship and the doctrine, the way the
   cockpit chat answers one, or it is answered with what this room can actually
   do about it. Either way it is not a card.

   THE SHAPE IS NARROW ON PURPOSE. A modal over a person and an ACTION VERB, or
   an explicit ask for a view. "do we have any guarantors?" carries no action
   verb and stays the read it has always been. */

/** A question about whether to DO something, rather than about what is on file. */
const JUDGEMENT =
  /\b(?:do|does|did|should|shall|would|could|can|must)\s+(?:we|i|you)\s+(?:really\s+|also\s+|still\s+|now\s+)?(?:need\s+to\s+|want\s+to\s+|have\s+to\s+|ought\s+to\s+)?(?:add|put|set|change|move|increase|decrease|reduce|raise|lower|extend|shorten|take|remove|drop|file|stage|write|create|waive|pledge|price|reprice|renew)\b|\bany\s+(?:need|reason|point)\s+to\b|\bwhat\s+do\s+you\s+(?:think|recommend|suggest|advise)\b|\bdo\s+you\s+(?:recommend|suggest|advise)\b|\bis\s+it\s+worth\b/i;

/** What this room can do about each topic, said in the banker's own vocabulary.
 *  It is the answer where no desk is reachable, and the degrade where one is. */
const JUDGEMENT_ROUTES: Record<ReadTopic, string> = {
  covenants:
    "Adding a covenant on this version is in scope here, and the covenant review is the credit action that assesses one. I will not call it for you off the read alone.",
  collateral:
    "Pledging an asset on this version is in scope here, and the collateral valuation is the credit action that values one. I will not call it for you off the read alone.",
  structure:
    "Putting a party on this version, or taking one off it, is in scope here. Whether the credit needs it is the committee's call and not one I will make off the read alone.",
  fees: "Adding a fee on this version is in scope here. No read on this cockpit carries the fees already on the deal, so I cannot tell you what it already charges.",
  facilities:
    "Changing a commitment, a rate, a maturity or a term on one of the facilities above is in scope here. I will not call whether it is needed off the read alone.",
};

/**
 * THE JUDGEMENT THIS LINE ASKS FOR, and what the room can do about it, or null.
 *
 * Null is the common case and it is not a failure: the line is a read, an
 * instruction, or a question of some other shape, and every lane the room
 * already has takes it exactly as it always did.
 */
export function judgementAsk(text: string): { topic: ReadTopic; routes: string } | null {
  const line = text.trim();
  if (!line || !JUDGEMENT.test(line)) return null;
  for (const [topic, re] of TOPICS) if (re.test(line)) return { topic, routes: JUDGEMENT_ROUTES[topic] };
  return null;
}

/** The GUARANTOR words, which name a role rather than a topic. */
const GUARANTOR_ASK = /\bguarantor|guarant(?:y|ies|ees?)\b/i;

/**
 * WHAT THE QUESTION NARROWS THE STRUCTURE CARD TO, or null for the whole of it.
 *
 * "Any guarantors?" is a question about a ROLE, and a card that answers it with
 * the borrowers as well has not answered it. Both `Guarantor` and `Limited
 * Guarantor` are guarantors: a limited guaranty is a guaranty with a cap on it,
 * and leaving Elena Hartwell out of an answer about guarantors because her row
 * says "Limited" would be the cockpit inventing a distinction the credit file
 * does not make.
 */
export function readRole(text: string): "guarantor" | null {
  return GUARANTOR_ASK.test(text) ? "guarantor" : null;
}

/* --------------------------------------------------------------- value bounds

   THE FIELD WAVE TOOK EVERYTHING AFTER THE LABEL (founder repro 11b). The
   longer covenant question staged field="Product" with a value of the entire
   fifteen-word tail of the sentence, question mark included. The wave has no
   shape validation of its own, so the room refuses to SHOW a delta whose value
   is not a value — the same judgement a banker makes reading the chip, applied
   before the chip is drawn.

   Scoped to the FIELD WAVE alone (`fieldWire`). A commitment, a rate and a
   maturity are parsed into typed values by their own waves and carry their own
   validation; second-guessing those here would be a rule written twice.       */

/** Past this a "value" is prose. Five words is a generous picklist label. */
const VALUE_WORD_CAP = 5;

/** A line that ASSIGNS. Two colocated nouns are not an instruction, however
 *  confidently a label matched inside them. */
const ASSIGNMENT = /\b(set|sets|change|changes|changed|make|makes|made|move|moves|update|updates|switch|switches|to)\b/i;

/**
 * Why this staged value must not be offered, or null when it is sound.
 *
 * The sentence comes back rather than a boolean because the room says it out
 * loud: a delta the room silently dropped would be the same silence the founder
 * hit from the other direction.
 */
export function unsoundFieldChange(line: string, delta: WorkroomDelta): string | null {
  if (!delta.fieldWire) return null;
  const value = String(delta.fieldWire.display ?? delta.after ?? "").trim();
  if (!value) return "the line did not carry a new value for it";
  if (value.includes("?")) return "what it read as the new value is a question, not a value";
  if (INTERROGATIVE_ANYWHERE.test(value)) return "what it read as the new value is part of a question, not a value";
  if (value.split(/\s+/).length > VALUE_WORD_CAP) return "what it read as the new value is a sentence, not a value";
  if (!ASSIGNMENT.test(line)) return "the line names the field but never says what to change it to";
  return null;
}

/* ------------------------------------------------------------- banker copy

   THE ROOM TALKS LIKE A BANKER (founder, 2026-09-01). The engines compose
   their sentences in the vocabulary of their own machinery — what they "hold",
   what they "file", what "rides the plan" — which is precise for whoever wrote
   the wave and unreadable for whoever is being asked to approve a credit
   action. This rewrites those phrases on the way to the glass and nothing else.

   IT IS A PRESENTATION FILTER AND IT STAYS ONE. Every engine string is
   unchanged (`app/src/workroom/` is untouched), the engine tests still assert
   the engine's own words, and a phrase not in this table is rendered verbatim.
   The moment a phrase reaches the banker in the engine's own good words, its
   row here can go.                                                          */

const PHRASES: Array<[RegExp, string]> = [
  [/\bit names no member I hold and no term I file\b/gi, "it names no facility on this package and no term I can change"],
  [/\bit names no member I hold and no field I file\b/gi, "it names no facility on this package and no field I can change"],
  [/\bno member I hold\b/gi, "no facility on this package"],
  [/\bI could not map that onto this package\b/gi, "I could not match that to anything on this package"],
  [/\brides the plan as a handoff\b/gi, "goes onto the plan for you to carry out"],
  [/\brides the plan\b/gi, "goes onto the plan"],
  [/\brecorded rather than filed\b/gi, "recorded for the file rather than written to the org"],
  [/\btoday's value is not staged in this read\b/gi, "this read does not carry today's value"],
  [/\bnot staged in this read\b/gi, "not carried in this read"],
  [/\bnot staged in this view\b/gi, "not carried in this view"],
];

/**
 * NO EM DASH REACHES THE GLASS (founder's house rule, and the drive found one).
 *
 * The split-offer sentence came back reading "The line names two changes—one I
 * can file, one I cannot". It is not a string in this codebase: the desk wrote
 * it, which is exactly why the rule belongs on the presentation filter every
 * agent sentence already passes through rather than on a string somewhere. An
 * engine sentence and a desk sentence are held to the same rule here.
 *
 * A dash BETWEEN WORDS becomes a comma, because that is what it was standing in
 * for; one with a space either side becomes a full stop and a capital where the
 * clause after it can carry one, and a comma where it cannot. A lone "—" is the
 * cockpit's placeholder for a figure a read does not carry, and it is left
 * exactly as it is: it is a value, not prose.
 */
function noEmDash(text: string): string {
  return text
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/(\w)[—–](\w)/g, "$1, $2")
    .replace(/\s+[—–](\w)/g, ", $1")
    .replace(/(\w)[—–]\s+/g, "$1, ");
}

/** The same sentence, in the words a credit officer uses. */
export function bankerly(text: string): string {
  let out = text;
  for (const [re, to] of PHRASES) out = out.replace(re, to);
  return noEmDash(out);
}

/* ------------------------------------------------------- the honest fallback */

/**
 * WHAT THE ROOM CAN DO, said plainly.
 *
 * The answer to a question the room cannot read from the package. It names the
 * work in credit language with a worked example, because "I could not parse
 * that" tells a banker nothing about what would have worked.
 */
export function whatICanDo(relationship: string): string {
  return (
    `I cannot answer that one from what I hold on ${relationship}. ` +
    "What I can do is change this package: a commitment, a rate, a maturity or a term on one of the facilities above, " +
    "a covenant, a fee, collateral or who is on the deal. " +
    'Say it the way you would write it, for example "take the Line of Credit to $19M" or "move the Seasonal maturity to 2027-06-30", ' +
    "and I will put it up as a change for you to confirm."
  );
}
