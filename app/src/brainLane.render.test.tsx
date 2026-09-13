// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE SECOND LANE, IN THE ROOM.

   The fast lane is proved in workroom.render.test.tsx and none of it moves
   here. What these hold is the lane beside it: that a question reaches the
   desk, that the three contract shapes arrive as things this room already
   knows how to draw, that a delta-proposal re-enters the deterministic parser
   rather than going anywhere near a tool, and — the one that matters most —
   that NOTHING a malformed reply can say renders as broken UI.

   THE BRAIN IS A FUNCTION HERE. The room takes a `brain` prop and asks nothing
   about the other end of it, which is exactly why the round trip can be held to
   its contract without a live bridge (see brainLane.test.ts for the transport).
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

/** The room, standing on the real baked read, with a brain of the test's own. */
function openWithBrain(brain?: (e: BrainEnvelope) => Promise<BrainReply>) {
  const bundle = data.borrowers![accountId];
  const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data, bundle })}
        reads={{ bundle, accountName: bundle.snapshot!.name!, productPackageId: context.productPackageId }}
        brain={brain}
        onClose={() => {}}
      />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
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
}

const reply = (r: BrainReply) => vi.fn(async (_envelope: BrainEnvelope) => r);

/** The founder's first failure, answered the way the pack answers it: grouped
 *  by role, with the SCOPE on every row. */
const STRUCTURE: BrainReply = {
  type: "read-card",
  topic: "involvements",
  title: "Borrowing structure on the Hartwell package",
  rows: [
    { icon: "borrower", label: "Hartwell Precision Manufacturing LLC", value: "Borrower", sub: "all 6 facilities . 100%" },
    { icon: "guarantor", label: "Hartwell Industrial Holdings LLC", value: "Guarantor", sub: "all 6 . unlimited . EPC" },
    { icon: "warn", label: "Elena Hartwell", value: "Limited Guarantor", sub: "HW1001 capped $5.0MM" },
  ],
  followUp: "Who should be added, and on which facility?",
};

describe("a question the room cannot answer goes to the desk", () => {
  it("hands over the banker's line verbatim, with the package it is standing on", async () => {
    const brain = reply(STRUCTURE);
    const room = openWithBrain(brain);
    await settle();
    await typeInto(room, "what is the relationship manager's phone number");

    expect(brain).toHaveBeenCalledTimes(1);
    const envelope = brain.mock.calls[0][0] as BrainEnvelope;
    expect(envelope.line).toBe("what is the relationship manager's phone number");
    expect(envelope.route).toBe("modify");
    expect(envelope.relationship).toMatch(/Hartwell/);
    expect(envelope.facilities.length).toBeGreaterThan(0);
    expect(envelope.grounding).toBe("plugin-skill:workroom-brain");
    // The honest fallback is gone in this state: there IS somewhere to take it.
    expect(room.textContent).not.toMatch(/What I can do is change this package/);
  });

  it("renders a read-card through the room's own card, not a second one", async () => {
    const room = openWithBrain(reply(STRUCTURE));
    await settle();
    await typeInto(room, "who else could we bring onto this deal");

    const cards = [...document.querySelectorAll<HTMLElement>(".wk-read")];
    expect(cards).toHaveLength(1);
    const card = cards[cards.length - 1];
    // The pack's own topic slug reaches the DOM.
    expect(card.dataset.topic).toBe("involvements");
    expect(card.querySelectorAll(".wk-read-r")).toHaveLength(3);
    // Type icons, the same component every other row in this room uses.
    expect(card.querySelectorAll(".tico").length).toBe(3);
    // Status in the ink, from the pack's own warn glyph. Never a pill.
    expect(card.querySelectorAll(".wk-read-r.wk-warn")).toHaveLength(1);
    expect(card.querySelector(".wk-read-next")!.textContent).toMatch(/on which facility/i);
    // AN ANSWER IS NOT A GATE: nothing is staged and nothing is waiting.
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });

  it("renders a clarify as an agent bubble, with its closed answer set as chips", async () => {
    const room = openWithBrain(
      reply({
        type: "clarify",
        text: "Which line do you mean? The relationship carries two.",
        options: [
          { label: "Revolving line, $15.0MM", say: "the revolving line of credit" },
          { label: "Seasonal line, $2.5MM", say: "the seasonal line of credit" },
        ],
      }),
    );
    await settle();
    await typeInto(room, "how much headroom is on the line");

    expect(room.textContent).toMatch(/Which line do you mean\?/);
    const chips = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")];
    expect(chips.map((c) => c.textContent)).toEqual(["Revolving line, $15.0MM", "Seasonal line, $2.5MM"]);
    expect(room.querySelectorAll(".wk-read")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });
});

describe("a delta-proposal re-enters the deterministic parser", () => {
  it("restates one change as a sentence and stages it through the fast lane", async () => {
    const room = openWithBrain(
      reply({
        type: "delta-proposal",
        action: "loan-modification",
        rationale: "The client asked for seasonal working capital ahead of the Q4 build.",
        changes: {
          scalarChangesJson: [{ key: "requestedAmount", value: 20000000, targetLoanId: "a4Zbb0000027MaYEAU" }],
        },
      }),
    );
    await settle();
    await typeInto(room, "what would it take to get them to twenty million");

    // The room says WHAT IT READ before it puts anything up. A chip that
    // appeared with no account of where it came from would be the brain acting
    // rather than proposing.
    expect(room.textContent).toMatch(/Reading that as: take the/);
    expect(room.textContent).toMatch(/seasonal working capital/);
    // And the chip is the parser's, with the same Confirm the banker always had.
    const chip = room.querySelector<HTMLElement>(".wk-chip");
    expect(chip).toBeTruthy();
    expect([...room.querySelectorAll("button")].map((b) => b.textContent)).toContain("Confirm");
    // NOTHING IS STAGED YET. The ceremony is untouched: the manifest is empty
    // until the banker confirms, and no plan and no token exist before that.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });

  it("offers several changes one at a time, as sentences the banker could have typed", async () => {
    const room = openWithBrain(
      reply({
        type: "delta-proposal",
        action: "loan-modification",
        rationale: "Both members move under one plan.",
        facilityIds: ["a4Zbb0000027MaYEAU", "a4Zbb0000027MnREAU"],
        changes: {
          scalarChangesJson: [
            { key: "requestedAmount", value: 20000000, targetLoanId: "a4Zbb0000027MaYEAU" },
            { key: "requestedTermMonths", value: 240, targetLoanId: "a4Zbb0000027MnREAU" },
          ],
        },
      }),
    );
    await settle();
    await typeInto(room, "what would the whole restructure look like");

    expect(room.textContent).toMatch(/That is 2 changes\. One at a time\./);
    const chips = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")];
    expect(chips.length).toBe(2);
    // Nothing was staged by the proposal itself.
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });

  it("says so rather than staging a proposal it has no sentence for", async () => {
    const room = openWithBrain(
      reply({
        type: "delta-proposal",
        action: "loan-modification",
        rationale: "The Duluth asset is already owned and can be pledged.",
        changes: { pledgeAddsJson: [{ collateralId: "a35bb0000013xz3AAA", amountPledged: 2000000 }] },
      }),
    );
    await settle();
    await typeInto(room, "could that asset carry more");

    expect(room.textContent).toMatch(/I could not put that up as a change from here/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });
});

describe("nothing a malformed reply can say reaches the glass", () => {
  it("draws no card, no chip and no delta when the desk answers with prose", async () => {
    // `askBrain` degrades before the room ever sees it; the room is handed the
    // neutral clarify. This holds the WHOLE path, not just the validator.
    const { askBrain } = await import("./channel/brainLane");
    const room = openWithBrain((e) => askBrain(e, { send: async () => "I think you should raise it to $20M." }));
    await settle();
    await typeInto(room, "what do you make of the request");

    expect(room.textContent).toMatch(/I could not read that answer/);
    expect(room.querySelectorAll(".wk-read")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
    // No empty card frame, no orphan heading, no undefined in the thread.
    expect(room.textContent).not.toMatch(/undefined|\[object Object\]|NaN/);
  });

  it("names the delay rather than leaving the banker on a spinner", async () => {
    const { askBrain } = await import("./channel/brainLane");
    const room = openWithBrain((e) => askBrain(e, { send: () => new Promise<string>(() => {}), timeoutMs: 5 }));
    await settle();
    await typeInto(room, "what is the exposure across the group");
    await settle();

    expect(room.textContent).toMatch(/has not come back within 0 seconds|has not come back/);
    // The composer is live again: the pulse does not outlive the round trip.
    expect(room.querySelector<HTMLInputElement>(".wk-txt")!.disabled).toBe(false);
    expect(room.querySelectorAll(".wk-compose")).toHaveLength(0);
  });
});

describe("no session, no brain lane", () => {
  it("keeps the merged fast lane and answers the rest honestly, without hanging", async () => {
    const room = openWithBrain(undefined);
    await settle();

    // The deterministic read the tweaks pass shipped is untouched.
    await typeInto(room, "which borrowers have we already in the package?");
    expect(document.querySelectorAll(".wk-read").length).toBe(1);

    // And a question it cannot read says what it CAN do, plus the honest reason
    // it cannot take the question any further.
    await typeInto(room, "what is the relationship manager's phone number");
    expect(room.textContent).toMatch(/What I can do is change this package/);
    expect(room.textContent).toMatch(/not connected to the bank's systems/);
    expect(room.querySelectorAll(".wk-compose")).toHaveLength(0);
  });
});

describe("the polite command still stages, and the question still asks", () => {
  it("stages a courtesy-prefixed imperative on the FAST lane, never over the bridge", async () => {
    const brain = reply(STRUCTURE);
    const room = openWithBrain(brain);
    await settle();
    await typeInto(room, "can you increase the 15M line of credit to $19M?");

    // The desk was never troubled: this was always an instruction.
    expect(brain).not.toHaveBeenCalled();
    expect(room.querySelectorAll(".wk-read")).toHaveLength(0);
    expect(room.textContent).toMatch(/Line of Credit/);
    expect(room.querySelector(".wk-chip")).toBeTruthy();
  });

  /* THE READ IS LOCAL NOW (brain-first inversion, 2026-09-01). This assertion
     used to be "goes to the desk"; the drive proved that order wrong three
     times over, with the brain reporting "data not carried" on covenants the
     bundle was holding. A topic the room can answer is answered from the room,
     and the desk is kept for what the bundle cannot carry. */
  it("answers a courtesy-prefixed READ from the bundle, without troubling the desk", async () => {
    const brain = reply(STRUCTURE);
    const room = openWithBrain(brain);
    await settle();
    await typeInto(room, "can you tell me what covenants are against this Product Package");

    expect(brain).not.toHaveBeenCalled();
    const card = document.querySelector<HTMLElement>(".wk-read");
    expect(card?.dataset.topic).toBe("covenants");
    // The founder's second failure, in its courtesy form: still not a delta.
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    expect(room.textContent).not.toMatch(/Term change/);
  });
});
