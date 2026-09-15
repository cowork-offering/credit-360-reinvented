import { askSession, sampleAvailable } from "../channel/sampleDoor";

/* =============================================================================
   THE VOCABULARY ASSIST.

   Its whole job is WORDS. It restates a banker's line using the room's own
   vocabulary and the deterministic parser reads THAT; nothing the assist says
   becomes a chip without passing the same validation a typed line passes. So a
   wrong restatement is a wrong sentence, never a wrong write.

   BOUNDED, because an assist that never answers is silence and silence is the
   one thing the room may not do. The deterministic parse has already missed by
   the time this runs, so this call gets a slice of the banker's attention and
   then the honest miss is the answer.

   SESSION DOOR ONLY (2026-09-15). IDB Gateway retired; the restate assist is
   session-door only. It used to fall to a gateway completion beneath the
   session door, which meant a phrasing the parser missed could raise a
   connector consent prompt mid-modification. There is no rung below now: no
   door, no restatement, and the room gives its honest miss.
   ============================================================================= */

/** How long the assist may hold the conversation open. */
export const RESTATE_TIMEOUT_MS = 12_000;

export type Restate = (line: string, vocabulary: string[]) => Promise<string | null>;

/**
 * Restate `line` in `vocabulary`. Null means "no help": either the door said
 * the line is not one of ours, or it did not answer in time, or it is not in
 * this view at all. All three are the same fact to the caller, which is that
 * the deterministic miss stands.
 */
export const restateAssist: Restate = async (line, vocabulary) => {
  if (!sampleAvailable()) return null;
  const prompt =
    "Rewrite this banker instruction using only these words, keeping every number, name and date exactly as written. " +
    "Reply with the rewritten instruction and nothing else. If it is not an instruction about a loan or a credit package, reply NONE.\n" +
    `Words: ${vocabulary.join(", ")}\nInstruction: ${line}`;
  try {
    const text = await Promise.race([
      askSession(prompt, { tier: "quick" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the session did not answer in time")), RESTATE_TIMEOUT_MS)),
    ]);
    const trimmed = text.trim();
    return !trimmed || /^none$/i.test(trimmed) ? null : trimmed;
  } catch {
    // Absence, never an error on the glass: the deterministic path already
    // answered, and this was the assist.
    return null;
  }
};
