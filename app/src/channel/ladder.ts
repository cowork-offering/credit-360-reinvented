/* =============================================================================
   THE LATENCY LADDER — which rung answers this line, decided before the model
   is ever reached.

   THE FOUNDER'S CONSTRAINT GOVERNS THE WHOLE DESIGN: "the brain should know
   when to make a call-out and when to leverage what is on store, otherwise the
   latency is horrendous."

   | rung | what answers                       | cost                    |
   |------|------------------------------------|-------------------------|
   | 0    | the deterministic parser           | instant, no model       |
   | 1    | the bundle already in the room     | instant, no model       |
   | 2    | the model over the envelope only   | one round, 1-2s quick   |
   | 3    | the model plus a page function     | several rounds, 30-90s  |

   Rungs 0 and 1 are the parser and the local reads. They are UNTOUCHED and they
   still answer the large majority of lines. This module decides only between 2
   and 3, and between quick and default inside 2.

   RUNG 3 IS RARE BY CONSTRUCTION. It is reached only when the line asks for
   something CURRENT, or names something the envelope's own `notCarried` list
   says no read on this cockpit holds — AND an exposed tool actually covers it.
   A 30 to 90 second round trip that ends in "no tool carries that" is the worst
   of both: the wait AND the refusal. That refusal belongs at rung 2, instantly.
   ============================================================================= */

import type { BrainEnvelope } from "./brainLane";
import type { CallTier } from "./sampleMetrics";

export type Rung = 2 | 3;

export interface RungChoice {
  rung: Rung;
  tier: CallTier;
  /** Why this rung, in one phrase. It is what the over-call reading is judged
   *  against and what a debug panel prints beside the timing. */
  why: string;
}

/* --------------------------------------------------------------- the words */

/**
 * THE LINE ASKS FOR SOMETHING CURRENT.
 *
 * "The snapshot already IS Salesforce" (spec, the honest boundary): the
 * envelope's reads were built from a Customer 360 read moments ago, so almost
 * every org fact is loaded at rung 2 for free. A live re-check earns its 30 to
 * 90 seconds only for the DELTA between the snapshot and now.
 */
const CURRENT =
  /\b(current(?:ly)?|latest|newest|newer|most recent|recent(?:ly)?|today|right now|as of (?:today|now)|up ?to ?date|since (?:then|this morning|the snapshot)|live|just (?:booked|added|posted|filed|drawn)|re-?check|refresh|check (?:the )?(?:org|salesforce)|any change)\b/i;

/**
 * THE LINE ASKS FOR A JUDGMENT.
 *
 * A judgment is what earns the default tier: the model has to reason over the
 * whole book rather than resolve a phrasing. A fuzzy instruction does not, and
 * paying five to sixty seconds to restate one would be the founder's exact
 * complaint about latency, in the other direction.
 */
const JUDGMENT =
  /\b(why|which|should|would you|compare|comparison|versus|vs\.?|risk|risky|cushion|headroom|tightest|loosest|least|most|worst|best|closest|prefer|recommend|advice|advis\w+|implicat\w+|impact|consequence|exposed|exposure to|rationale|explain|reason|what happens|makes? sense|instead|trade-?off|too tight|too loose)\b/i;

/**
 * WHAT THE EXPOSED TOOLS ACTUALLY COVER.
 *
 * This mirrors channel/brainTools.ts and nothing else. A term the book does not
 * carry AND no tool can fetch is a refusal, not a call-out: the doctrine's
 * "missing data is an answer" rule, applied to the latency ladder.
 */
export const RUNG3_COVERAGE: Array<{ tool: string; match: RegExp }> = [
  {
    tool: "currentBoomRatios",
    match: /\b(ratios?|dscr|fccr|leverage|coverage|ebitda|debt service|fixed charge|current ratio|quick ratio|boom)\b/i,
  },
  {
    tool: "liveInvolvements",
    match:
      /\b(guarantors?|guarantee\w*|guaranty|borrowers?|co-?borrowers?|involvements?|parties|party|obligors?|related entit\w+|who is on|who guarantees)\b/i,
  },
  {
    // THE CONNECTED PARTY'S OWN BOOK (golden rule 1, downstream). "What is the
    // guarantor's own exposure" carries no CURRENT word, so without this entry
    // the line never reached rung 3 and the tool was never offered for the one
    // question it exists to answer. The subject words name the party or the
    // book; the tool itself is still bounded to the anchored graph.
    tool: "connectedPartyBook",
    match: /\b(affiliates?|parent|holding|subsidiar\w*|obligor group|counterpart(?:y|ies)|own (?:book|exposure|covenants?|facilities))\b/i,
  },
];

/** The tools whose subject this line touches. Empty means no call-out could
 *  answer it, whatever the line asked for. */
export function toolsCovering(line: string): string[] {
  return RUNG3_COVERAGE.filter((c) => c.match.test(line)).map((c) => c.tool);
}

/** TRUE where the envelope itself says no read on this cockpit carries what the
 *  line is asking about. `notCarried` is written by the room, in the room's own
 *  words, so a term of two characters or fewer is ignored as noise. */
function envelopeCannotAnswer(line: string, envelope: BrainEnvelope): string | null {
  const lower = line.toLowerCase();
  const named = [...(envelope.reads?.notCarried ?? []), ...(envelope.omitted ?? [])];
  for (const term of named) {
    const word = term.trim().toLowerCase();
    if (word.length > 2 && lower.includes(word)) return term;
  }
  return null;
}

/**
 * THE RUNG THIS LINE TAKES.
 *
 * Order matters and it is the order of cost. A line that asks for something
 * current is checked first, because that is the only thing worth 30 to 90
 * seconds; then whether the book admits it cannot answer; then whether the
 * question needs judgment; and everything else is a quick restatement.
 */
export function rungFor(envelope: BrainEnvelope): RungChoice {
  const line = envelope.line ?? "";
  const covered = toolsCovering(line);

  if (CURRENT.test(line)) {
    return covered.length
      ? { rung: 3, tier: "default", why: `asks for something current, covered by ${covered.join(" and ")}` }
      : { rung: 2, tier: "default", why: "asks for something current, but no exposed tool covers it" };
  }

  const gap = envelopeCannotAnswer(line, envelope);
  if (gap) {
    return covered.length
      ? { rung: 3, tier: "default", why: `the book does not carry ${gap}, covered by ${covered.join(" and ")}` }
      : { rung: 2, tier: "default", why: `the book does not carry ${gap}, and no exposed tool covers it` };
  }

  if (JUDGMENT.test(line)) return { rung: 2, tier: "default", why: "a judgment over the book" };

  return { rung: 2, tier: "quick", why: "resolve the phrasing against the book" };
}
