import { useMemo } from "react";

/* =============================================================================
   THE AGENT SPEAKS, NEVER PASTES (rule 65).

   The facility room and the relationship room each grew their own copy of this
   twelve-line component. The memo room is the third room on the same glass and
   a third copy is how three rooms stop being one room, so the primitive lives
   here, beside the other things the rooms share (`finale.ts`, `settle.ts`,
   `TypeIcon.tsx`), and the memo room imports it rather than restating it.

   Each word condenses out of the glass 26ms after the one before it. Whitespace
   stays as plain text nodes, so `textContent` is byte-identical to the sentence
   the room handed over, which is what lets a render test read a thread as
   prose rather than as a bag of spans.
   ============================================================================= */

export const WORD_STAGGER_MS = 26;

/**
 * THE WAIT THE BANKER IS ACTUALLY IN (A14, 2026-09-12).
 *
 * A rung-3 line goes out to the org and the room allows it up to 150 seconds
 * (`timeoutFor`, channel/ladder.ts), while the glass showed the same breathing
 * mark a one-second restatement shows. Two minutes of that reads as a hang. One
 * clause beside the mark says which wait this is; nothing else about the wait
 * changes, and the timeout clarify still names the number afterwards.
 *
 * It lives here because BOTH rooms say it, and a second copy of a sentence is
 * how two rooms stop saying the same thing.
 */
export const REACHES_THE_ORG = "This one reaches the org and can take up to two minutes.";

export function Words({ text, offset = 0 }: { text: string; offset?: number }) {
  const parts = useMemo(() => text.split(/(\s+)/).filter((p) => p !== ""), [text]);
  let n = offset - 1;
  return (
    <>
      {parts.map((part, i) => {
        if (/^\s+$/.test(part)) return part;
        n += 1;
        return (
          <span className="wk-w" style={{ animationDelay: `${n * WORD_STAGGER_MS}ms` }} key={i}>
            {part}
          </span>
        );
      })}
    </>
  );
}
