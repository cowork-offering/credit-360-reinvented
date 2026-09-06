import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* =============================================================================
   THE CARD GROWS INTO THE SHEET. ONE MOTION, TWO ELEMENTS.

   FOUNDER, 2026-09-06: "I liked the rainbow card morphing into this but I need a
   clean room at the end when it's done with a clean Summary screen. But all
   super super gentle, no hangers, I hate when it gets stuck."

   A SHARED-ELEMENT MORPH, WHICH IS A FLIP AND NOTHING CLEVERER. The card's box
   is measured before the sheet exists; the sheet is then mounted at its own
   size, given the transform that puts it exactly over the card, and released to
   the identity transform over {@link MORPH_MS}. The card is lifted out of flow
   at its measured box and fades under the sheet while it grows.

   TRANSFORM AND OPACITY, AND NOTHING ELSE. No width, no height, no filter, no
   box-shadow: those are the four properties that turn a morph into a per-frame
   relayout and a rasterisation of a blurred rim, which is the exact shape of
   "it gets stuck". The scale is UNIFORM, so nothing on the sheet is stretched;
   what the reader sees is a card enlarging into a page, which is what it is.

   THE MEASUREMENT IS TAKEN ONCE AND NEVER AGAIN. A morph that re-measured
   mid-flight would be reading boxes it is itself transforming.

   REDUCED MOTION SKIPS THE WHOLE THING: the sheet simply is, in one commit, and
   nothing is ever measured. That is also what jsdom sees, where
   `getBoundingClientRect` returns zeros and a FLIP would be arithmetic over
   nothing.

   NOT EVEN A CROSS-FADE, and that is the app's own rule rather than this file's
   preference: `electric-glass.css` kills every animation and every transition
   under that media query, with `!important`, on purpose. A dissolve here would
   have to fight the accessibility switch to exist, so the honest reading of "no
   motion" is that the sheet is simply the room from the first commit - which is
   exactly what the finale itself does with its own drain.
   ============================================================================= */

/** How long the card takes to become the sheet. Founder's own number. */
export const MORPH_MS = 600;

/** The card's ascent, from `finale.ts`'s own keyframe. Held here so the room can
 *  say "when the card has landed" without reading the stylesheet. */
export const CARD_ASCEND_MS = 500;

/** The beat the card is held whole before it grows. Long enough to be a card and
 *  not a flash; short enough that the sheet is readable inside a second and a
 *  half of the org answering. */
export const CARD_HELD_MS = 240;

/**
 * `off`    no filing, or the finale has not landed.
 * `card`   the card is on the glass, alone, waiting out its own beat.
 * `morph`  the sheet is mounted and travelling from the card's box to its own.
 * `sheet`  the sheet is the room. The card is off stage and stays mounted.
 */
export type MorphPhase = "off" | "card" | "morph" | "sheet";

export interface Morph {
  phase: MorphPhase;
  /** The card, so its box can be read before the sheet exists. */
  cardRef: (el: HTMLElement | null) => void;
  /** The sheet, so its own box can be read once it does. */
  sheetRef: (el: HTMLElement | null) => void;
  /**
   * The filing landed: start the beat.
   *
   * `at` is measured from THIS call and is the room's own arithmetic over the
   * finale's drain, so the morph begins exactly when the card has finished
   * ascending and held. Runs once per room; a second call is ignored, because
   * re-arming would replay a growth over a sheet that is already the room.
   */
  arm: (at: number) => void;
}

/** Where the card was, in the page's own coordinates. */
interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const boxOf = (el: HTMLElement): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

export function useCardMorph(reduced: boolean): Morph {
  const [phase, setPhase] = useState<MorphPhase>("off");
  const card = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLElement | null>(null);
  const from = useRef<Box | null>(null);
  const armed = useRef(false);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
      timers.current = [];
    },
    [],
  );

  const arm = useCallback(
    (at: number) => {
      if (armed.current) return;
      armed.current = true;
      if (reduced) {
        setPhase("sheet");
        return;
      }
      setPhase("card");
      later(() => {
        /* THE CARD'S BOX, TAKEN BEFORE THE SHEET EXISTS. This is the only read of
           it there will ever be: the layout effect below works from this number
           and from the sheet's own first box, and nothing is measured after the
           transform starts. */
        from.current = card.current ? boxOf(card.current) : null;
        setPhase("morph");
      }, Math.max(0, at));
    },
    [later, reduced],
  );

  /* THE INVERSE, THEN THE RELEASE. The sheet is in flow at its own size the
     instant this runs, so the transform that puts it over the card is the only
     thing between the reader and a jump. It is applied before paint (layout
     effect), and released on the next frame. */
  useLayoutEffect(() => {
    if (phase !== "morph") return;
    const el = sheet.current;
    const start = from.current;
    if (!el || !start || start.width <= 0) {
      setPhase("sheet");
      return;
    }
    const to = boxOf(el);
    if (to.width <= 0) {
      setPhase("sheet");
      return;
    }
    const scale = start.width / to.width;
    const dx = start.left + start.width / 2 - (to.left + to.width / 2);
    const dy = start.top + start.height / 2 - (to.top + to.height / 2);

    const ghost = card.current;
    if (ghost) {
      /* THE CARD LEAVES THE FLOW WHERE IT STOOD. Its own offset parent is the
         thread, so the box it is pinned at is the box it was already occupying
         and nothing on the glass moves at the moment it is lifted. */
      const parent = ghost.offsetParent as HTMLElement | null;
      const base = parent ? boxOf(parent) : { top: 0, left: 0, width: 0, height: 0 };
      ghost.style.setProperty("--wk-ghost-top", `${start.top - base.top + (parent?.scrollTop ?? 0)}px`);
      ghost.style.setProperty("--wk-ghost-left", `${start.left - base.left}px`);
      ghost.style.setProperty("--wk-ghost-w", `${start.width}px`);
    }

    el.style.transition = "none";
    el.style.transformOrigin = "center center";
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
    el.style.opacity = "0";
    // One forced read, so the browser cannot batch the start state away.
    void el.offsetWidth;
    el.style.transition = `transform ${MORPH_MS}ms var(--ease-settle), opacity ${Math.round(MORPH_MS * 0.6)}ms var(--ease-settle)`;
    el.style.transform = "none";
    el.style.opacity = "1";

    later(() => {
      const done = sheet.current;
      if (done) {
        done.style.transition = "";
        done.style.transform = "";
        done.style.opacity = "";
        done.style.transformOrigin = "";
      }
      setPhase("sheet");
    }, MORPH_MS + 40);
  }, [phase, later]);

  const cardRef = useCallback((el: HTMLElement | null) => {
    card.current = el;
  }, []);
  const sheetRef = useCallback((el: HTMLElement | null) => {
    sheet.current = el;
  }, []);

  return { phase, cardRef, sheetRef, arm };
}
