// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { ChatPanelBody } from "./components/ChatPanel";
import { __skipBootForTests } from "./channel/useLivePortfolio";
import sample from "../../artifact/sample-data.json";

__skipBootForTests();

/* =============================================================================
   THE CHAT SPEAKS IN THE ROOMS' REGISTER (D1).

   FOUNDER, 2026-09-12, the latency brief: "110% zero latency and smooth
   transitions etc in all workrooms and chats."

   THE DEFECT. The answer's words were revealed by a fixed CSS stagger,
   `animationDelay: n * 60ms`, with no catch-up and no cap. That is 16.7 words a
   second: 2.3 times slower than the rooms' 38, and below the pacer's own
   resting floor of 26. Because it was linear it scaled without limit, so the
   longest legal desk answer — DESK_ANSWER_WORDS, 140 — finished arriving 8.4
   SECONDS after it had landed, and the banker read the chat as the slow surface
   in the cockpit.

   WHAT IS PINNED. The same 140 words now drain in about three seconds on the
   rooms' own pacer, and they drain PROGRESSIVELY: the count of words on the
   glass climbs frame by frame rather than being 140 from the first paint with
   the CSS hiding most of them. Both halves matter. The old build would pass a
   textContent assertion at t=0, because every word was already in the DOM.

   THE CLOCK IS DRIVEN BY HAND. `startPacer` reads `window.requestAnimationFrame`
   and `performance.now` where the host injects neither, so those two are the
   whole seam and the number below is deterministic rather than wall-clock.
   ============================================================================= */

/** 140 words: what `deskAnswer` clips the longest legal answer to. */
const VOCAB = ["the", "relationship", "carries", "eighteen", "million", "committed", "across", "four", "facilities", "today"];
const ANSWER = Array.from({ length: 140 }, (_, i) => VOCAB[i % VOCAB.length]).join(" ");

vi.mock("./channel/deskAsk", async (orig) => ({
  ...((await orig()) as object),
  deskAvailable: () => true,
  askDesk: async () => ANSWER,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = sample as unknown as C360Data;
const ACCOUNT = base.portfolio.accounts[0].accountId;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

let clock = 0;
let pending: Array<(t: number) => void> = [];
let realRaf: typeof window.requestAnimationFrame;
let realCancel: typeof window.cancelAnimationFrame;
let realNow: () => number;

/** One 60fps frame, with every callback the page had queued for it. */
function frame(): void {
  clock += 16;
  const due = pending;
  pending = [];
  act(() => {
    for (const cb of due) cb(clock);
  });
}

beforeEach(() => {
  clock = 0;
  pending = [];
  realRaf = window.requestAnimationFrame;
  realCancel = window.cancelAnimationFrame;
  realNow = performance.now.bind(performance);
  window.requestAnimationFrame = ((cb: (t: number) => void) => pending.push(cb)) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  performance.now = () => clock;
  // MOTION ON. jsdom has no matchMedia, which the motion guard reads as reduced
  // motion, and reduced motion lands the answer whole by the pacer's contract.
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

function Harness() {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ type: "OPEN_ACCOUNT", accountId: ACCOUNT });
    dispatch({ type: "SET_PANEL", panel: "chat" });
  }, [dispatch]);
  return <ChatPanelBody />;
}

/** Words of the answer actually on the glass, which is what a banker can read. */
const said = () => container!.querySelectorAll(".chatw").length;

describe("the chat reveals at the rooms' rate, not at 60ms a word", () => {
  it("finishes a 140-word answer in about three seconds, and climbs to it", async () => {
    (window as unknown as { claude?: unknown }).claude = { mcp: { callTool: async () => ({}) } };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <AppProvider data={base}>
          <Harness />
        </AppProvider>,
      );
    });

    const field = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    await act(async () => {
      setter.call(field, "what is the exposure");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const started = clock;
    // NOT ALL OF IT FROM THE FIRST PAINT. The CSS-stagger build put all 140
    // spans in the DOM immediately and hid them, so this line is the one that
    // separates a real pace from an animation over a finished paragraph.
    expect(said()).toBeLessThan(140);

    let finishedAt: number | null = null;
    let atOneSecond: number | null = null;
    for (let i = 0; i < 400 && finishedAt === null; i++) {
      frame();
      if (atOneSecond === null && clock - started >= 1000) atOneSecond = said();
      if (said() >= 140) finishedAt = clock - started;
    }

    expect(finishedAt).not.toBeNull();
    // ~3.05s on the pacer's own schedule. The old fixed stagger took 8,400ms.
    expect(finishedAt!).toBeGreaterThan(2_000);
    expect(finishedAt!).toBeLessThan(4_000);
    // And it is genuinely progressive: a second in, most of it is still coming.
    expect(atOneSecond!).toBeGreaterThan(20);
    expect(atOneSecond!).toBeLessThan(140);
    // The answer is byte-identical when it lands: the pacer's last emit is the
    // door's own text.
    expect(container!.querySelector(".chatrow.agent .chatbub")!.textContent).toBe(ANSWER);
  });
});
