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

  /* THE INVERSE, AND THEN THE GROWTH. The sheet is in flow at its own size the
     instant this runs, so the transform that puts it over the card is the only
     thing between the reader and a jump. It is computed before paint (layout
     effect) and handed to an animation with a clock of its own. */
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

    /* THE GROWTH IS AN ANIMATION, NOT A PAIR OF STYLE WRITES.

       The textbook FLIP sets the from-state, forces a reflow and sets the
       to-state, and a CSS transition picks the difference up. It does transition
       - but its clock starts at the browser's next style recalculation, and this
       runs inside React's commit with the drain's own animations still to come.
       Measured on the strip harness: the sheet held the card's box for 340ms and
       then covered 90% of the distance in one frame, which is a jump wearing a
       transition's clothes.

       `Element.animate` has a clock of its own. It starts on the next frame
       whatever the main thread is doing, it interpolates on that clock rather
       than on repaints, and it ends by resolving a promise rather than by a
       timer somebody has to keep in step with the stylesheet. The keyframes are
       transform and opacity only, exactly as before.

       THE EASING IS THE ROOM'S OWN, READ OFF THE ROOM. `--ease-settle` is the
       rooms' settle curve and it is defined once, in tokens.css; taking its
       literal from the element keeps this from becoming a second place that
       claims to know what the room's easing is. */
    const settle = getComputedStyle(el).getPropertyValue("--ease-settle").trim() || "cubic-bezier(0.19, 1, 0.3, 1)";
    const growth = el.animate(
      [
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`, opacity: 0 },
        /* THE SHEET IS WHOLE BEFORE IT HAS FINISHED ARRIVING. The card is fading
           underneath it on its own 300ms, so the two overlap rather than trading
           places, and there is never a frame with nothing card-shaped on it. */
        { opacity: 1, offset: 0.55 },
        { transform: "none", opacity: 1 },
      ],
      { duration: MORPH_MS, easing: settle, fill: "both" },
    );

    const land = () => {
      growth.cancel();
      const done = sheet.current;
      if (done) {
        done.style.transformOrigin = "";
      }
      setPhase("sheet");
    };
    /* WHICHEVER COMES FIRST, AND ONE OF THEM ALWAYS DOES. A promise that never
       resolves - a cancelled animation, a backgrounded tab - must not leave the
       room mid-growth, and a timer that fires early must not cut the travel off,
       so the ceiling sits a beat past the animation's own length. */
    growth.finished.then(land).catch(() => {});
    later(land, MORPH_MS + 120);
  }, [phase, later]);

  const cardRef = useCallback((el: HTMLElement | null) => {
    card.current = el;
  }, []);
  const sheetRef = useCallback((el: HTMLElement | null) => {
    sheet.current = el;
  }, []);

  return { phase, cardRef, sheetRef, arm };
}
