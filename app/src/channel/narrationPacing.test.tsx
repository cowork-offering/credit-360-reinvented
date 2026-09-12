// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, memo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useNarration } from "./Narration";
import type { BrainEnvelope } from "./brainLane";
import { acquireSample, resetSessionDoor } from "./sampleDoor";
import type { NarrateSubject } from "./narrate";
import { unitsOf } from "./streamPacer";

/* =============================================================================
   THE HOST COMMITS ON A NEW WORD, NOT ON A FRAME (D2/F1).

   FOUNDER, 2026-09-12, the latency brief: "110% zero latency and smooth
   transitions etc in all workrooms and chats."

   The pacer runs on the frame clock and releases 26 words a second against a
   60fps loop, so on a 51-word remark roughly four emits in nine carry the same
   prefix as the frame before them. Every one of those used to be a `setViews`
   returning a FRESH object, so the view handed down to the room was a new
   object on every frame and React could never bail out of reconciling the
   subtree under it - the room is the largest component in the build.

   WHAT IS COUNTED HERE IS THE COMMIT THE ROOM SEES: how many times the view
   object a consumer is handed actually changes. That is what the bail-out
   protects, and the number is one per word released plus the opening and the
   closing commit, against one per FRAME before it.

   THE PACER ITSELF IS NOT TOUCHED. `streamPacer.test.ts` reads the emit made on
   the very first frame and that emit is still made; what changed is only what
   the host does with one that says nothing new.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 51 words in three sentences, no figure and no entity name, so every guard
 *  passes it through whole and the prose the pacer releases is exactly this. */
const VOCAB = ["the", "relationship", "reads", "clean", "across", "every", "facility", "and", "covenant", "held"];
const WORDS = Array.from({ length: 51 }, (_, i) => VOCAB[i % VOCAB.length]);
const REMARK = [WORDS.slice(0, 17).join(" "), WORDS.slice(17, 34).join(" "), WORDS.slice(34, 51).join(" ")].join(". ") + ".";

const envelope: BrainEnvelope = {
  v: 2,
  line: "",
  room: "facility",
  relationship: "Hartwell Precision Manufacturing LLC",
  route: "modify",
  packageName: "Hartwell Industrial C&I Credit Package",
  productPackageId: "a5Fbb000000IHFJEA4",
  selectedFacility: null,
  facilities: [],
  staged: [],
  reads: { covenants: [], notCarried: [] },
  grounding: "plugin-skill:workroom-brain",
};

const subject: NarrateSubject = { act: "greeting", sentence: "" };

/* THE FRAME CLOCK, DRIVEN BY HAND. `startPacer` reads `window.requestAnimationFrame`
   and `performance.now` when the host injects neither, so those two are the
   whole seam and nothing inside `Narration` has to be opened for the test. */
let clock = 0;
let pending: Array<(t: number) => void> = [];
let realRaf: typeof window.requestAnimationFrame;
let realCancel: typeof window.cancelAnimationFrame;
let realNow: () => number;

function frame(ms = 16): void {
  clock += ms;
  const due = pending;
  pending = [];
  act(() => {
    for (const cb of due) cb(clock);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetSessionDoor();
  clock = 0;
  pending = [];
  realRaf = window.requestAnimationFrame;
  realCancel = window.cancelAnimationFrame;
  realNow = performance.now.bind(performance);
  window.requestAnimationFrame = ((cb: (t: number) => void) => {
    pending.push(cb);
    return pending.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  performance.now = () => clock;
  // Motion ON: jsdom has no matchMedia, which the motion guard reads as reduced
  // motion, and reduced motion has no pacer at all.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCancel;
  performance.now = realNow;
  delete (window as unknown as Record<string, unknown>).matchMedia;
  delete (window as unknown as { claude?: unknown }).claude;
});

/** The session door at the runtime's own shape. The remark lands whole, which
 *  is the case that actually happens: the guards run on the finished text. */
function installSession(): void {
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) =>
      name === "sample"
        ? async () => ({ text: REMARK, truncated: false, modelTierApplied: "quick" })
        : null,
  };
}

describe("the narration host bails out of an emit that says nothing new", () => {
  it("commits once per word released, not once per frame", async () => {
    installSession();
    await acquireSample(50);

    const commits = { n: 0 };
    let api: ReturnType<typeof useNarration> | null = null;

    /* THE CONSUMER, memoised on the view exactly as the room's own subtree is
       reconciled on it. A no-op emit that returns `prev` leaves this untouched;
       a fresh object on every frame renders it on every frame. */
    const Sink = memo(function Sink({ view }: { view: unknown }) {
      commits.n += 1;
      return <i>{String((view as { reveal?: number } | undefined)?.reveal ?? "")}</i>;
    });

    function Probe() {
      const seen = useRef(0);
      seen.current += 1;
      api = useNarration({ enabled: true, envelopeFor: () => envelope, prime: async () => REMARK });
      return <Sink view={api.viewFor("greet")} />;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<Probe />);
    });

    await act(async () => {
      api!.open("greet", subject);
    });
    // The door resolves and the guarded text is handed to the pacer.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const before = commits.n;
    // 1,500ms of frames is the whole 51-word drain at the pacer's base rate,
    // and then some: the loop stops on its own when the remark has landed.
    let frames = 0;
    // 1,500ms of frames is the whole 51-word drain at the pacer's base rate,
    // and then some: the loop stops on its own when the remark has landed.
    for (let i = 0; i < 140 && pending.length; i++) {
      frame(16);
      frames += 1;
    }

    const words = unitsOf(REMARK).length;
    expect(words).toBe(51);
    const paced = commits.n - before;
    // The pacer ran for far more frames than it released words, which is the
    // condition the bail-out exists for.
    expect(frames).toBeGreaterThan(words + 20);
    // One commit per word released, plus the opening and closing ones. Before
    // the bail-out this was one per frame, about 90.
    expect(paced).toBeGreaterThan(0);
    expect(paced).toBeLessThanOrEqual(words + 4);
    // And the remark did fully land.
    expect(api!.viewFor("greet")?.reveal).toBe(words);
    expect(api!.viewFor("greet")?.streaming).toBe(false);
  });
});
