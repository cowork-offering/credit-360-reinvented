import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/* =============================================================================
   THE FILED FINALE - what the room does once the dossier has landed.

   FOUNDER, 2026-09-03: "when the modification is done, can we gently and
   elegantly clean up the room, a cinematic kind of creation success with that
   card. Right now the room stays like nothing happened. But elegant."

   IT DID STAY. The executed card was APPENDED to the thread and everything else
   held its place: the settled rows, the greeting remnants, the staged cards in
   the manifest rail, an open composer. The filing is the end of the change set
   and the room read like the middle of one.

   THREE BEATS, IN ORDER, AND THE ORDER IS THE WHOLE POINT:

     exhale   everything that is not the card fades and slides DOWN, top to
              bottom, {@link FINALE_STAGGER_MS} apart, over {@link FINALE_EXHALE_MS}.
              Down, not up: the room is sinking away from the card rather than
              being pushed off by it, and the settle choreography's own exit
              rises, so a shared direction would read as one more settle.
     still    the drain is over. Everything it covered is off stage (mounted,
              display:none, aria-hidden - the settle machinery's contract, not a
              new one) and the CARD ascends into the space, alone.
     off      no filing has happened. Nothing here applies.

   WHAT THIS DOES NOT TOUCH. The execute path, the dossier's content, its links,
   its handoffs, the trail write, the purpose hop. The finale is a presentation
   over the `filed` phase and it is driven off that phase alone, which is why
   {@link Finale.begin} is called from an effect and never from execute.

   A LINE THAT ARRIVES AFTER THE FINALE IS NOT PART OF IT. The purpose footnote
   is a runtime hop that finishes AFTER the card has landed; the exit set is
   fixed at the instant the finale begins, so a late line slots under the card
   with its own ordinary arrival and nothing re-runs.

   REDUCED MOTION SKIPS THE MIDDLE BEAT. `begin` lands straight on `still`: the
   room is clear and the card is there, in one commit, with no sweep and no
   stagger. That is also what every jsdom test sees, because jsdom has no
   matchMedia and `prefersReducedMotion` is true there.
   ============================================================================= */

/** How long one item takes to fade and sink. The founder's own range is 8 to
 *  12px over ~600ms; the distance lives in the stylesheet, the clock here. */
export const FINALE_EXHALE_MS = 600;

/** The beat between one item starting its exit and the next. Founder's range is
 *  30 to 50ms; this is the middle of it. */
export const FINALE_STAGGER_MS = 40;

/**
 * HOW MANY ITEMS MAY CARRY A STAGGER.
 *
 * A long conversation is thirty items and thirty staggers would be a 1.2s wave
 * before the card is allowed to arrive - the finale performing the history
 * rather than clearing it. Past this the exits share the last beat, so the
 * drain is always over inside a second whatever the room is holding.
 */
export const FINALE_STAGGER_CAP = 8;

/** One slow pass of the rainbow behind the card, then still. Never a loop. */
export const FINALE_SWEEP_MS = 2600;

/** Where an item's exit starts, by its place in the thread. */
export function finaleHoldMs(index: number): number {
  return Math.min(Math.max(index, 0), FINALE_STAGGER_CAP) * FINALE_STAGGER_MS;
}

/** How long the whole drain takes for a room holding `count` items. */
export function finaleDrainMs(count: number): number {
  return FINALE_EXHALE_MS + finaleHoldMs(count - 1);
}

/**
 * WHEN THE CARD STARTS ARRIVING: THE END OF THE DRAIN, NEVER BEFORE IT.
 *
 * FOUNDER, 2026-09-14 (backlog row 53): "when i click on approve and execute at
 * the end, the rainbow card is like its pulling down from itself and moves back
 * up."
 *
 * IT WAS, AND THE HANDOVER IS WHY. The card is the last thing in the thread, so
 * while the room is draining its box is still being decided by everything above
 * it: measured on the drive, the card faded in at the bottom edge of the pane,
 * crept up as the wave closed, and then moved 443px in one frame when the drain
 * ended and the pane centred what was left. An overlap that starts the ascent
 * before the room is still is an ascent into a box that is still moving.
 *
 * SO THE CARD TAKES ITS RESTING BOX AND THEN ARRIVES IN IT. The wait is now the
 * whole drain, which is the same instant the room goes `still`, so the ascent
 * runs against a pane that holds nothing else and the card never travels.
 */
export function finaleCardHoldMs(count: number): number {
  return finaleDrainMs(count);
}

/**
 * WHERE THE FINALE STANDS.
 *
 * `off`     nothing has filed.
 * `exhale`  the room is draining. The card is held back.
 * `still`   the room is clear and the card is the only thing on the stage.
 */
export type FinaleState = "off" | "exhale" | "still";

export interface Finale {
  state: FinaleState;
  /**
   * HOW LONG THE CARD WAITS BEFORE IT ASCENDS.
   *
   * The whole drain, and zero where there is no drain. The card is MOUNTED
   * throughout - it is the filing's own output and a test must be able to read
   * it whatever the clock is doing - so the wait is a delay on its entrance and
   * on every paced row inside it, never a mount gate. The room exhales first and
   * the card arrives into the space that made room for it, into the box it will
   * keep rather than into one the drain is still moving (backlog row 53).
   */
  hold: number;
  /**
   * The room filed: these items leave, in this order.
   *
   * IT RUNS ONCE PER ROOM. A second call - a re-render, a late effect, a
   * restored session - is ignored, because re-arming the drain would re-play an
   * exit over items that are already off the stage.
   */
  begin: (itemIds: readonly string[]) => void;
  /** Where this item is in the drain, or null if the finale does not cover it. */
  exitOf: (itemId: string) => number | null;
  reset: () => void;
}

export function useFinale(reduced: boolean): Finale {
  const [state, setState] = useState<FinaleState>("off");
  const [hold, setHold] = useState(0);
  const order = useRef<Record<string, number>>({});
  const armed = useRef(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const begin = useCallback(
    (itemIds: readonly string[]) => {
      if (armed.current) return;
      armed.current = true;
      const at: Record<string, number> = {};
      itemIds.forEach((id, i) => {
        at[id] = i;
      });
      order.current = at;
      if (reduced || !itemIds.length) {
        setState("still");
        return;
      }
      const drain = finaleDrainMs(itemIds.length);
      setHold(finaleCardHoldMs(itemIds.length));
      setState("exhale");
      timer.current = window.setTimeout(() => setState("still"), drain);
    },
    [reduced],
  );

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    armed.current = false;
    order.current = {};
    setHold(0);
    setState("off");
  }, []);

  const exitOf = useCallback((itemId: string) => order.current[itemId] ?? null, []);

  return { state, hold, begin, exitOf, reset };
}

/**
 * HOW AN ITEM THE FINALE COVERS RENDERS.
 *
 * `data-finale` is the contract a test reads, and it is the same two words the
 * settle choreography uses for the same two states: mid-exit, then off stage.
 * The attributes MERGE onto whatever wrapper the item already had - a settled
 * exchange's or a tier's - so no node is remounted to leave the stage.
 */
export interface FinaleAttrs {
  className: string;
  style?: CSSProperties;
  "data-finale": "exhale" | "gone";
  "aria-hidden": "true";
}

export function finaleAttrs(index: number, state: FinaleState): FinaleAttrs | null {
  if (state === "off") return null;
  /* OFF STAGE IS `display: none` AND NOT A COLLAPSED TRACK. A settled exchange
     keeps a zero-height box and its 32px step gap with it, which is the right
     answer while the conversation continues and the wrong one here: the card
     has to be ALONE in the pane, and eight invisible gaps above it are not
     alone. Mounted, hidden, aria-hidden - the same contract, taken further. */
  if (state === "still") return { className: "wk-fin-gone", "data-finale": "gone", "aria-hidden": "true" };
  return {
    className: "wk-fin-out",
    /* THE EXIT'S TWO NUMBERS, ridden down to the stylesheet rather than written
       there as well: the item's own place in the wave, and how long its sink
       takes. Both live here, so the beat and the sheet cannot drift apart. */
    style: {
      "--wk-fin-at": `${finaleHoldMs(index)}ms`,
      "--wk-fin-ms": `${FINALE_EXHALE_MS}ms`,
    } as CSSProperties,
    "data-finale": "exhale",
    "aria-hidden": "true",
  };
}

/** The wrapper shape both rooms' thread items and tiers already have. */
interface Wrapper {
  className: string;
  style?: CSSProperties;
  "aria-hidden"?: "true";
}

/**
 * The item's own wrapper, with the finale's exit folded into it.
 *
 * Merged rather than nested: a second wrapper around a bubble would remount it
 * and restart its word speech, and the finale is the one moment in the room
 * where nothing should move except what it is moving. `extra` is the star's own
 * clocks, which ride the same wrapper for the same reason.
 */
export function withFinale<T extends Wrapper>(attrs: T, exit: FinaleAttrs | null, extra: CSSProperties | null = null): T {
  if (!exit) return extra ? { ...attrs, style: { ...attrs.style, ...extra } } : attrs;
  return {
    ...attrs,
    ...exit,
    className: `${attrs.className} ${exit.className}`,
    style: { ...attrs.style, ...exit.style, ...extra },
  };
}

/**
 * WHAT THE RAIL SAYS ONCE ITS CARDS HAVE DRAINED.
 *
 * The staged cards are the ledger of what is ABOUT to be written, and after the
 * filing there is nothing about to be written. One line in the room's own
 * vocabulary takes their place; the detail is on the card and in nCino, which is
 * where a filed change belongs.
 *
 * `split` carries the same requested/derived count the rail head shows while
 * the plan is still open (`derivedDelta.ts`'s `countSplit`), so the one line
 * that survives the drain does not go back to saying a bare number the moment
 * the pricing gate's own cards are the reason it is not two. Absent where
 * nothing on the filed set was derived, which reads exactly as it always has.
 */
export function railFiledLine(
  count: number,
  filedWord: string,
  changeWord: readonly [string, string],
  split?: { requested: number; derived: number },
): string {
  const base = `${filedWord} · ${count} ${count === 1 ? changeWord[0] : changeWord[1]}`;
  return split && split.derived > 0 ? `${base} · ${split.requested} requested · ${split.derived} derived` : base;
}
