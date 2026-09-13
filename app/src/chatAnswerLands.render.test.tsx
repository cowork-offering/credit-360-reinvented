// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { CHAT_EMPTY_ANSWER, ChatPanelBody } from "./components/ChatPanel";
import { __skipBootForTests } from "./channel/useLivePortfolio";
import sample from "../../artifact/sample-data.json";

__skipBootForTests();

/* =============================================================================
   THE CHAT COMES BACK WITH THE ANSWER (founder bug bug-1789294443785).

   "the chat is also not coming back with an answer."

   The desk was never the suspect: every exit in `askDesk` hands text back, the
   75 second deadline included. The answer was lost in the last thirty lines of
   the panel. `ChatWords` paints EMPTY on the commit that mounts it and fills in
   from `requestAnimationFrame`, and the same batch drops "Composing...", so a
   view whose frames are throttled (hidden tab, backgrounded artifact, a banker
   who looked away during a 75 second wait) shows a blank bubble with nothing
   beside it and no way to tell that an answer ever came.

   THESE TESTS RUN WITH MOTION ON, which is the production path and the one the
   suite never took: jsdom has no `matchMedia`, the motion guard reads that as
   reduced motion, and reduced motion lands the answer whole. Frames are
   hand-driven, so "the frames never came" is a state a test can hold.
   ============================================================================= */

const hooks = vi.hoisted(() => ({
  /** How long the fake desk takes, and what it answers with. */
  desk: { delayMs: 0, text: "The relationship carries $18M committed against $42.37M of lendable collateral." },
  asked: [] as string[],
}));

vi.mock("./channel/deskAsk", async (orig) => ({
  ...((await orig()) as object),
  deskAvailable: () => true,
  askDesk: async (args: { question: string }) => {
    hooks.asked.push(args.question);
    if (hooks.desk.delayMs > 0) await new Promise((r) => setTimeout(r, hooks.desk.delayMs));
    return hooks.desk.text;
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = sample as unknown as C360Data;
const ACCOUNT = base.portfolio.accounts[0].accountId;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/* ------------------------------------------------------ the frame clock, ours */

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

/** Frames until the pacer has nothing left to release, or the budget is out.
 *  The budget is the pacer's own worst case with room to spare, never a wait. */
function framesUntil(done: () => boolean, budget = 400): void {
  for (let i = 0; i < budget && !done(); i += 1) frame();
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
  hooks.asked.length = 0;
  hooks.desk.delayMs = 0;
  hooks.desk.text = "The relationship carries $18M committed against $42.37M of lendable collateral.";
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

async function mount() {
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
}

async function ask(text: string) {
  const field = container!.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** Real time, for the door's own latency. The frame clock above is fake; the
 *  desk's delay is not, because that is the shape of the bug. */
const waited = async (ms: number) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

/** What the banker reads in the agent's bubble, right now. */
const answer = () => {
  const rows = [...container!.querySelectorAll(".chatrow.agent .chatbub")];
  return (rows[rows.length - 1]?.textContent ?? "").trim();
};
const full = () => hooks.desk.text;

describe("the desk's answer reaches the glass", () => {
  it("lands whole when the desk answers after 300ms and the frames run", async () => {
    await mount();
    hooks.desk.delayMs = 300;
    await ask("what is the exposure");
    expect(hooks.asked).toHaveLength(1);
    await waited(360);

    framesUntil(() => answer() === full());
    expect(answer()).toBe(full());
  });

  it("lands whole when the desk answers instantly, before the pacer mounts", async () => {
    await mount();
    hooks.desk.delayMs = 0;
    await ask("what is the exposure");

    framesUntil(() => answer() === full());
    expect(answer()).toBe(full());
  });

  it("lands whole when the door is slow (2s) and the panel has been waiting", async () => {
    await mount();
    hooks.desk.delayMs = 2000;
    await ask("what is the exposure");
    // Still composing, two seconds in, with the door open.
    expect(container!.querySelector(".chatthink")).toBeTruthy();
    await waited(2100);

    framesUntil(() => answer() === full());
    expect(answer()).toBe(full());
    // And nothing is still claiming to be composing.
    expect(container!.querySelector(".chatthink")).toBeFalsy();
  });

  it("lands whole even if no frame ever arrives (the throttled view)", async () => {
    await mount();
    await ask("what is the exposure");
    // NOT ONE FRAME. This is a hidden or backgrounded view, which is what a 75
    // second desk wait invites. Before the net, the bubble stayed empty here for
    // the rest of the session.
    expect(pending.length).toBeGreaterThan(0);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1400));
    });
    expect(answer()).toBe(full());
  });

  it("says something when the desk answers with nothing at all", async () => {
    await mount();
    hooks.desk.text = "";
    await ask("what is the exposure");

    framesUntil(() => answer() === CHAT_EMPTY_ANSWER);
    expect(answer()).toBe(CHAT_EMPTY_ANSWER);
  });
});
