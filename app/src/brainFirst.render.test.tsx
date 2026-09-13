// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk, type WorkroomRouter } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import type { C360Data } from "./data/contract";
import type { WorkroomMode } from "./workroom/types";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE LANE INVERSION, IN THE FACILITY ROOM.

   brainLane.render.test.tsx holds the CONTRACT: the three shapes, the restate,
   the degrade. What is held here is the DISPATCH the 2026-09-01 drive demanded:
   which lane a line takes, and why.

     reads          -> local, always, and BEFORE the route gate (F1);
     provably clean -> the parser, straight through, instant card;
     everything else-> the desk, with the parse held behind it as the degrade;
     no bridge      -> exactly the room that shipped, with nothing waiting.

   Plus the two safety layers that land regardless of the lane: the dollar
   qualifier (F4, struck twice) and the magnitude bound (F5, $900M on a $46MM
   package with no objection of any kind).
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  clearComposed();
});

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";

interface Opened {
  room: HTMLElement;
  bound: Array<{ route: WorkroomMode; say?: string }>;
}

/** The room on the real baked read, with a brain and a router of the test's own. */
function open(args: { brain?: (e: BrainEnvelope) => Promise<BrainReply>; routeOpen?: boolean } = {}): Opened {
  const bundle = data.borrowers![accountId];
  const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
  const bound: Opened["bound"] = [];
  const router: WorkroomRouter | undefined = args.routeOpen
    ? {
        question: neutralAsk(),
        say: null,
        onBind: (route, opts) => bound.push({ route, say: opts?.say }),
        onRestart: (route, say) => bound.push({ route, say }),
      }
    : undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data, bundle })}
        router={router}
        reads={{ bundle, accountName: bundle.snapshot!.name!, productPackageId: context.productPackageId }}
        brain={args.brain}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound };
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function typeInto(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => room.querySelector(".wk-send")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
  await settle();
  await settle();
}

const reply = (r: BrainReply) => vi.fn(async (_envelope: BrainEnvelope) => r);

const CLARIFY: BrainReply = { type: "clarify", text: "Which of the two lines of credit do you mean?" };

/* ------------------------------------------------------------ reads, local */

describe("a read is answered from the package, and it is answered first", () => {
  it("does not trouble the desk for a topic the bundle carries", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "which borrowers have we already in the package?");

    expect(brain).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".wk-read")).toHaveLength(1);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("answers a read WHILE THE ROUTE QUESTION IS OPEN, and binds nothing (F1)", async () => {
    const brain = reply(CLARIFY);
    const { room, bound } = open({ brain, routeOpen: true });
    await settle();
    await typeInto(room, "what covenants are against this Product Package");

    // The route gate used to swallow this and answer with the three-way.
    expect(document.querySelectorAll(".wk-read")).toHaveLength(1);
    expect(bound).toHaveLength(0);
    expect(brain).not.toHaveBeenCalled();
    expect(room.textContent).not.toMatch(/Pick one above/);
  });

  it("takes a topic the bundle CANNOT answer to the desk instead", async () => {
    // No read tool puts fee rows on the bundle, so this is exactly the case the
    // second lane exists for.
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "what fees are on the line of credit");

    expect(brain).toHaveBeenCalledTimes(1);
    expect(room.querySelectorAll(".wk-read")).toHaveLength(0);
  });
});

/* --------------------------------------------------------- the fast path */

describe("a provably clean parse keeps its instant card", () => {
  it("never reaches the desk for a proven single-clause phrasing", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "take the 15M line of credit to $19M");

    expect(brain).not.toHaveBeenCalled();
    expect(room.querySelector(".wk-chip")).toBeTruthy();
  });

  it("takes a MULTI-CLAUSE line to the desk, staging nothing of its own (F6)", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "take the Line of Credit to $19M and give the Equipment a 240 month term");

    expect(brain).toHaveBeenCalledTimes(1);
    // The parser's own reading was HELD, not drawn: the desk answered instead.
    expect(room.textContent).toMatch(/Which of the two lines of credit/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("takes a line the parser could not read to the desk (P5)", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "bump the big revolver by five million");

    expect(brain).toHaveBeenCalledTimes(1);
    expect(room.textContent).toMatch(/Which of the two lines of credit/);
  });
});

/* ------------------------------------------------- the qualifier filter (F4) */

describe("a dollar qualifier is read, on either lane", () => {
  const LINE = "take the 2.5M line of credit to 4M";

  /* REVERSED ON EVIDENCE (2026-09-01 evening drive). This test used to assert
     that a qualified line went to the desk. Driven for real, that made the
     connected room WORSE than the disconnected one: with no channel the filter
     staged the single correct chip instantly, and with a channel the identical
     line waited on a round trip it did not need. The filter narrows only on an
     exact one-member reading, so the resolved line now takes the fast lane on
     BOTH lanes, and the two tests below are deliberately the same assertions. */
  it("stages the resolved member itself, without asking the desk (P6)", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, LINE);

    expect(brain).not.toHaveBeenCalled();
    expect(room.textContent).toMatch(/Read that as the \$2\.50M/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(1);
    expect(room.textContent).not.toMatch(/\$15\.0M to \$4\.0M|\$15M to \$4M/);
  });

  it("drops the sibling, out loud, where there is no desk to ask", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, LINE);

    // The room says which member it read, and puts up ONE chip rather than two.
    expect(room.textContent).toMatch(/Read that as the \$2\.50M/);
    expect(room.textContent).toMatch(/left alone/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(1);
    expect(room.textContent).not.toMatch(/\$15\.0M to \$4\.0M|\$15M to \$4M/);
  });
});

/* -------------------------------------------------- the magnitude bound (F5) */

describe("a commitment out of the relationship's range is challenged, not blocked", () => {
  it("stages the 900M probe AND says what it is (P7)", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "take the Construction to $900M");

    // STAGED: the advisory is advice, never a gate.
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
    expect([...room.querySelectorAll("button")].map((b) => b.textContent)).toContain("Confirm");
    // AND CHALLENGED, in banker language, against the relationship's own total.
    expect(room.textContent).toMatch(/times the .* this whole relationship has committed today/);
  });

  it("says nothing about a figure inside the range", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "take the Construction to $19M");

    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
    expect(room.textContent).not.toMatch(/this whole relationship has committed today/);
  });
});

/* ------------------------------------------------------------- the degrade */

describe("a bad round trip never leaves the room worse than the fast lane", () => {
  it("falls back to the parser's own reply and chips", async () => {
    const { askBrain } = await import("./channel/brainLane");
    const { room } = open({ brain: (e) => askBrain(e, { send: async () => "I think you should raise it." }) });
    await settle();
    // Multi-clause, so it routes to the desk; the desk answers with prose.
    await typeInto(room, "take the 15M line of credit to $19M and give the Equipment a 240 month term");

    // The degrade sentence is NOT what the banker gets: the parse is.
    expect(room.textContent).not.toMatch(/I could not read that answer/);
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
  });

  it("says the lane failed where there was no parse to fall back on", async () => {
    const { askBrain } = await import("./channel/brainLane");
    const { room } = open({ brain: (e) => askBrain(e, { send: async () => "prose" }) });
    await settle();
    await typeInto(room, "what fees are on the line of credit");

    expect(room.textContent).toMatch(/I could not read that answer/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ the envelope */

describe("the envelope carries what the room read, and the conversation", () => {
  it("ships the read blocks, the thread digest and what the route cannot file", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "which borrowers have we already in the package?");
    await typeInto(room, "what fees are on the line of credit");

    const envelope = brain.mock.calls[0][0] as BrainEnvelope;
    expect(envelope.v).toBe(2);
    expect(envelope.room).toBe("facility");
    // THE BLIND ENVELOPE IS CLOSED (F2).
    expect(envelope.reads?.covenants?.length).toBeGreaterThan(0);
    expect(envelope.reads?.involvements?.length).toBeGreaterThan(0);
    expect(envelope.reads?.exposure?.committed).toMatch(/^\$/);
    expect(envelope.reads?.notCarried.join(" ")).toMatch(/index name/);
    // The conversation so far, so the desk holds context across turns.
    expect(envelope.thread?.some((t) => t.who === "banker" && /which borrowers/.test(t.text))).toBe(true);
    expect(envelope.fileable?.files.length).toBeGreaterThan(0);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });
});

/* --------------------------------------------------- the route, from intent */

describe("the desk may resolve the route, and never binds one itself", () => {
  it("binds the route a reply names, through the room's own router", async () => {
    const brain = reply({ ...CLARIFY, route: "renew" });
    const { room, bound } = open({ brain, routeOpen: true });
    await settle();
    await typeInto(room, "the revolver comes up for its annual roll next month");

    expect(bound).toEqual([{ route: "renew", say: "the revolver comes up for its annual roll next month" }]);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("leaves the question standing where the reply names no route", async () => {
    const brain = reply(CLARIFY);
    const { room, bound } = open({ brain, routeOpen: true });
    await settle();
    await typeInto(room, "not sure what we are doing with this one yet");

    expect(bound).toHaveLength(0);
    expect(room.textContent).toMatch(/Which of the two lines of credit/);
  });

  it("ignores a route word the room does not know", async () => {
    const brain = reply({ ...CLARIFY, route: "restructure" });
    const { room, bound } = open({ brain, routeOpen: true });
    await settle();
    await typeInto(room, "the client called about their plans for next quarter");

    expect(bound).toHaveLength(0);
    expect(room.textContent).toMatch(/Which of the two lines of credit/);
  });
});

/* ---------------------------------------------------- channel-none parity */

describe("with no bridge the room is exactly the room that shipped", () => {
  it("parses every line it used to parse, waits on nothing and says nothing new", async () => {
    const { room } = open();
    await settle();

    // A multi-clause line still goes to the parser: there is no second lane to
    // hold it for, and holding it would be a room that got WORSE when a
    // connector was absent.
    await typeInto(room, "take the 15M line of credit to $19M and give the Equipment a 240 month term");
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
    expect(room.textContent).not.toMatch(/desk|has not come back|could not read that answer/i);
    // The composer is live: nothing waited on a bridge that was never there.
    expect(room.querySelector<HTMLInputElement>(".wk-txt")!.disabled).toBe(false);
  });

  it("answers a question it cannot read with what it CAN do", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "what is the relationship manager's phone number");

    expect(room.textContent).toMatch(/What I can do is change this package/);
    expect(room.textContent).toMatch(/not connected to the bank's systems/);
  });
});
