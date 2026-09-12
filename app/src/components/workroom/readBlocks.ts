import type { BrainTurn } from "../../channel/brainLane";

/* =============================================================================
   THE READ, PACKED FOR THE DESK (F2).

   The brain answered "the data is not carried" three times in the 2026-09-01
   drive over a bundle that held every one of those facts. Nothing was wrong
   with the brain: the envelope carried a line, some labels and the staged plan,
   and nothing else. What the room has ALREADY READ travels with the line now.

   THE FACTS MOVED OUT (2026-09-12, backlog item 9). They were produced here,
   and the cockpit chat produced its own set from the same bundle and disagreed
   with them. Every surface now selects from `channel/relationshipContext.ts`:
   one production, one drop order, one `notCarried`. This file keeps the
   envelope's own name for that builder, and the conversation digest, which is
   the one thing the desk's prose and the envelope's JSON genuinely share.
   ============================================================================= */

/** WHAT THE ROOM HAS ALREADY READ, packed. Absent where it stands on no read. */
export { buildRelationshipFacts as buildReadBlocks } from "../../channel/relationshipContext";

/* ------------------------------------------------------------ the thread

   WHAT MAKES IT CHAT. A room that hands over one line at a time answers each
   line as if it were the first, which is exactly the "step by step, not
   intuitive" the founder named. The banker's own words travel VERBATIM; the
   room's are clipped, because a room quoting itself at length crowds out the
   reads the answer actually needs.                                          */

/** How many exchanges travel. Six is two or three full turns, which is as far
 *  back as a banker's "it" and "that one" ever reach. */
const THREAD_TURNS = 6;

/** The longest an agent line travels. A clipped line ends on a word. */
const AGENT_CLIP = 180;

function clip(text: string, cap: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= cap) return line;
  const cut = line.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > cap / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

/** The last few exchanges, oldest first. Empty where nothing has been said. */
export function threadDigest(turns: BrainTurn[], limit: number = THREAD_TURNS): BrainTurn[] | undefined {
  const kept = turns
    .filter((t) => t.text.trim().length > 0)
    .slice(-limit)
    .map((t) => ({ who: t.who, text: t.who === "banker" ? t.text.trim() : clip(t.text, AGENT_CLIP) }));
  return kept.length ? kept : undefined;
}
