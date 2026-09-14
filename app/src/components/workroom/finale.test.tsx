// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type CSSProperties } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FINALE_EXHALE_MS,
  FINALE_STAGGER_CAP,
  FINALE_STAGGER_MS,
  finaleAttrs,
  finaleCardHoldMs,
  finaleDrainMs,
  finaleHoldMs,
  railFiledLine,
  useFinale,
  withFinale,
  type Finale,
} from "./finale";

/* =============================================================================
   THE FINALE'S MACHINERY, off a browser and off a room.

   Two things are only provable here. The FULL MOTION PATH, because jsdom has no
   matchMedia and every render test in this app is therefore the reduced-motion
   one. And the LATE ARRIVAL: the purpose footnote is a runtime hop that finishes
   after the card has landed, and what has to be true is that the exit set was
   fixed before it existed - so it is never in the drain and nothing re-runs when
   it turns up.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The wrapper shape both rooms hand to {@link withFinale}. */
type Wrapper = { className: string; style?: CSSProperties; "aria-hidden"?: "true" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

/** The hook, on a real render, with the room's own reduced flag in hand. */
function mountFinale(reduced: boolean): () => Finale {
  let held: Finale | null = null;
  function Probe() {
    held = useFinale(reduced);
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Probe />));
  return () => held!;
}

describe("the drain's clocks", () => {
  it("staggers by the founder's beat and caps the wave", () => {
    expect(finaleHoldMs(0)).toBe(0);
    expect(finaleHoldMs(3)).toBe(3 * FINALE_STAGGER_MS);
    // A thirty-item conversation does not get a thirty-item wave.
    expect(finaleHoldMs(30)).toBe(FINALE_STAGGER_CAP * FINALE_STAGGER_MS);
    expect(finaleDrainMs(1)).toBe(FINALE_EXHALE_MS);
    expect(finaleDrainMs(50)).toBe(FINALE_EXHALE_MS + FINALE_STAGGER_CAP * FINALE_STAGGER_MS);
  });

  it("holds the card until the room is still, so it ascends into its resting box", () => {
    /* Backlog row 53, founder 2026-09-14: the card used to start arriving while
       the drain was still closing space above it, so it faded in at the bottom
       edge of the pane and then jumped when the room centred what was left. */
    expect(finaleCardHoldMs(16)).toBe(finaleDrainMs(16));
    expect(finaleCardHoldMs(1)).toBe(FINALE_EXHALE_MS);
    expect(finaleCardHoldMs(1)).toBeGreaterThanOrEqual(0);
  });
});

describe("the finale runs once, over a set fixed at the filing", () => {
  it("exhales, then settles still, and the card's wait is the drain", () => {
    vi.useFakeTimers();
    const finale = mountFinale(false);
    expect(finale().state).toBe("off");
    expect(finale().hold).toBe(0);

    act(() => finale().begin(["a", "b", "c"]));
    expect(finale().state).toBe("exhale");
    expect(finale().hold).toBe(finaleCardHoldMs(3));
    // Top to bottom, one beat apart.
    expect(finale().exitOf("a")).toBe(0);
    expect(finale().exitOf("c")).toBe(2);

    act(() => vi.advanceTimersByTime(finaleDrainMs(3) - 1));
    expect(finale().state).toBe("exhale");
    act(() => vi.advanceTimersByTime(1));
    expect(finale().state).toBe("still");
  });

  it("never puts a line that arrived after the filing into the drain", () => {
    vi.useFakeTimers();
    const finale = mountFinale(false);
    act(() => finale().begin(["greeting", "card-lede"]));
    act(() => vi.advanceTimersByTime(finaleDrainMs(2)));

    /* THE PURPOSE FOOTNOTE. It is not in the set, so it has no exit, so its
       wrapper is untouched and it renders with its own ordinary arrival - under
       the card, where a footnote belongs. */
    expect(finale().exitOf("purpose-footnote")).toBeNull();
    expect(withFinale({ className: "wk-ex" }, null)).toEqual({ className: "wk-ex" });

    /* AND IT DOES NOT RE-ARM THE FINALE. A second begin - a late effect, a
       re-render, a restored session - would replay an exit over items that are
       already off the stage and re-delay a card that has already ascended. */
    act(() => finale().begin(["purpose-footnote"]));
    expect(finale().state).toBe("still");
    expect(finale().exitOf("purpose-footnote")).toBeNull();
    expect(finale().exitOf("greeting")).toBe(0);
  });

  it("skips the middle beat entirely under reduced motion", () => {
    vi.useFakeTimers();
    const finale = mountFinale(true);
    act(() => finale().begin(["a", "b"]));
    // No drain, no wait: the room is clear and the card is there.
    expect(finale().state).toBe("still");
    expect(finale().hold).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("goes back to nothing on a reset, and can arm again", () => {
    vi.useFakeTimers();
    const finale = mountFinale(false);
    act(() => finale().begin(["a"]));
    act(() => finale().reset());
    expect(finale().state).toBe("off");
    expect(finale().exitOf("a")).toBeNull();
    act(() => finale().begin(["b"]));
    expect(finale().state).toBe("exhale");
  });
});

describe("what an item the finale covers renders as", () => {
  it("says nothing at all before a filing", () => {
    expect(finaleAttrs(0, "off")).toBeNull();
  });

  it("sinks with its own delay mid-drain, and goes off stage after it", () => {
    const out = finaleAttrs(2, "exhale")!;
    expect(out.className).toBe("wk-fin-out");
    expect(out["data-finale"]).toBe("exhale");
    expect(out["aria-hidden"]).toBe("true");
    expect(out.style).toEqual({
      "--wk-fin-at": `${2 * FINALE_STAGGER_MS}ms`,
      "--wk-fin-ms": `${FINALE_EXHALE_MS}ms`,
    });

    const gone = finaleAttrs(2, "still")!;
    expect(gone.className).toBe("wk-fin-gone");
    expect(gone["data-finale"]).toBe("gone");
    // No delay survives the drain: the item is not animating any more.
    expect(gone.style).toBeUndefined();
  });

  it("merges onto the wrapper the item already had, never a new one", () => {
    const settled: Wrapper = {
      className: "wk-ex wk-ex-gone",
      style: { "--wk-settle-ms": "420ms" } as CSSProperties,
    };
    const merged = withFinale(settled, finaleAttrs(1, "exhale"));
    expect(merged.className).toBe("wk-ex wk-ex-gone wk-fin-out");
    expect(merged.style).toEqual({
      "--wk-settle-ms": "420ms",
      "--wk-fin-at": `${FINALE_STAGGER_MS}ms`,
      "--wk-fin-ms": `${FINALE_EXHALE_MS}ms`,
    });
    expect(merged["aria-hidden"]).toBe("true");
  });

  it("carries the star's own clocks through with no exit of its own", () => {
    const bare: Wrapper = { className: "wk-ex" };
    const star = withFinale(bare, null, { "--wk-fin-hold": "680ms" } as CSSProperties);
    expect(star.className).toBe("wk-ex");
    expect(star.style).toEqual({ "--wk-fin-hold": "680ms" });
    expect(star["aria-hidden"]).toBeUndefined();
  });
});

describe("the line the rail says instead", () => {
  it("speaks the room's own vocabulary, and counts", () => {
    expect(railFiledLine(3, "Filed", ["change", "changes"])).toBe("Filed · 3 changes");
    expect(railFiledLine(1, "Filed", ["change", "changes"])).toBe("Filed · 1 change");
    expect(railFiledLine(4, "Submitted", ["term", "terms"])).toBe("Submitted · 4 terms");
  });

  it("carries the requested/derived split when the filed set has one", () => {
    expect(railFiledLine(4, "Filed", ["change", "changes"], { requested: 2, derived: 2 })).toBe(
      "Filed · 4 changes · 2 requested · 2 derived",
    );
  });

  it("stays plain when nothing filed was derived", () => {
    expect(railFiledLine(2, "Filed", ["change", "changes"], { requested: 2, derived: 0 })).toBe("Filed · 2 changes");
  });
});
