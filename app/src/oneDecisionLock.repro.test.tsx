// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE ROOM THAT REFUSED EVERYTHING (founder bug bug-1789294443785, 2026-09-13).

   Hartwell, Modification, cockpit 0.9.20. The banker moved the $15M line up by
   $20M, answered the amortisation term and the first payment date, held the
   rate at 6.58%, and from that line on the room answered EVERY input with

     "One decision at a time. The open card above, or the review chip under it,
      carries the next move."

   with no open card anywhere on the glass. Three lines died there, two of them
   questions the room was holding the answer to and one of them a change of mind
   about the rate it had just been told to hold.

   FOUR RULES ARE TESTED HERE, all of them the golden rule's:

     1. a gate the banker cannot SEE is not a gate. `openGates` counted every
        live item in the thread, and a settled exchange stays mounted; anything
        an exchange settle walked over kept the room shut for good.
     2. a QUESTION is never blocked. It is answered from the book while the
        decision stays open, and the decision is restated under the answer.
     3. a change of mind after a hold RE-OPENS the rate. A correction
        supersedes; it is not a second decision.
     4. where the refusal legitimately fires it NAMES the card the banker is
        looking at.

   Nothing here is wired to a desk: the transcript, the questions and the
   refusals are all the room's own, deterministic.
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
/** The artifact's own instant. Every month the room offers is computed from it. */
const GENERATED_AT = "2026-07-25T21:04:49Z";

function open(): HTMLElement {
  const bundle = data.borrowers![accountId];
  const context = workroomContextFor({
    mode: "modify",
    data,
    bundle,
    accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: "a5Fbb000000IHFJEA4",
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data, bundle })}
        reads={{
          bundle,
          accountName: bundle.snapshot!.name!,
          productPackageId: context.productPackageId,
          generatedAt: GENERATED_AT,
        }}
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
  for (let i = 0; i < 8; i += 1) await settle();
}

const lastByText = (re: RegExp) =>
  [...document.body.querySelectorAll("button")].reverse().find((b) => re.test((b.textContent ?? "").trim()));
const click = async (el: Element | undefined) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 8; i += 1) await settle();
};
const said = (room: HTMLElement) => [...room.querySelectorAll(".wk-msg")].map((m) => m.textContent ?? "").join(" · ");
const REFUSAL = /One decision at a time/;

/** Whatever the room is asking for, on the glass: a card, a check or a question
 *  with chips under it, in an exchange that has not settled away. */
function onGlass(): Element[] {
  return [...document.body.querySelectorAll("button")].filter((b) => {
    if (!/^(Confirm|Acknowledge|Hold |Keep the rate|New all-in rate|Index \+ spread|\d+ months|Another|Leave pricing)/.test((b.textContent ?? "").trim())) {
      return false;
    }
    return !b.closest('[data-settle-state="settled"]') && !b.closest('[data-settle-state="leaving"]');
  });
}

/* -------------------------------------------------- the founder's own drive */

/** Increase by $20M, answer the term, answer the date, hold the rate. The exact
 *  four moves of the transcript, on the facility the transcript names. */
async function theTranscript(room: HTMLElement) {
  await typeInto(room, "Increase the 15M line of credit by 20M USD");
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^Acknowledge$/));
  await click(lastByText(/^240 months$/));
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^1 September 2026$/));
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^Hold 6\.58%$/));
}

describe("the transcript that locked the room (bug-1789294443785)", () => {
  it("takes the hold and says what the facility keeps", async () => {
    const room = open();
    await settle();
    await theTranscript(room);

    expect(said(room)).toContain("The $15.0MM Line of Credit keeps 6.58%");
    expect(said(room)).toContain("Nothing is staged for the rate and the new version carries it forward");
  });

  it("answers 'what borrowers are on this loan already ?' instead of refusing it", async () => {
    const room = open();
    await settle();
    await theTranscript(room);
    await typeInto(room, "what borrowers are on this loan already ?");

    expect(said(room)).not.toMatch(REFUSAL);
    expect(room.querySelector('.wk-read[data-topic="structure"]')).toBeTruthy();
  });

  it("answers 'show me the pledges on this loan' too", async () => {
    const room = open();
    await settle();
    await theTranscript(room);
    await typeInto(room, "show me the pledges on this loan");

    expect(said(room)).not.toMatch(REFUSAL);
    expect(room.querySelector('.wk-read[data-topic="collateral"]')).toBeTruthy();
  });

  it("re-opens the rate on 'yes increase to 7.25%' and stages the figure", async () => {
    const room = open();
    await settle();
    await theTranscript(room);
    await typeInto(room, "yes increase to 7.25%");

    expect(said(room)).not.toMatch(REFUSAL);
    // The room does not ask which of six members this lands on: it is the
    // facility whose rate it was told to hold, one line ago.
    expect(said(room)).not.toContain("Which member should this land on?");
    expect(said(room)).toContain("The $15.0MM Line of Credit moves to 7.25%");
    await click(lastByText(/^Confirm$/));
    // And it is on the manifest, on that facility, like any other entry.
    const entries = [...room.querySelectorAll(".wk-ent")].map((e) => e.textContent ?? "");
    expect(entries.join(" | ")).toContain("7.25%");
  });

  it("takes the whole transcript end to end and ends on the approval door", async () => {
    const room = open();
    await settle();
    await theTranscript(room);
    await typeInto(room, "what borrowers are on this loan already ?");
    await typeInto(room, "show me the pledges on this loan");

    // Four pricing facts are set (amount, term, amortised term, first payment
    // date) and the rate is answered, so the next move is the bank's own
    // approval and the room says so.
    expect(said(room)).not.toMatch(REFUSAL);
    expect(lastByText(/Review & execute/)).toBeTruthy();
  });
});

/* ------------------------------------- the doctrine, where it still applies */

describe("one decision at a time still holds for a card the banker can see", () => {
  /** Move the line, leave the coverage check unacknowledged. The check is a
   *  real open gate and it is on the glass. */
  async function withTheCheckOpen(room: HTMLElement) {
    await typeInto(room, "Increase the 15M line of credit by 20M USD");
    await click(lastByText(/^Confirm$/));
  }

  it("refuses a new instruction and NAMES the card it is waiting on", async () => {
    const room = open();
    await settle();
    await withTheCheckOpen(room);
    await typeInto(room, "extend the maturity on the 8M equipment loan to 2027-06-30");

    expect(said(room)).toMatch(REFUSAL);
    // The generic sentence named nothing. This one names the check.
    expect(said(room)).toContain("check above is still open: acknowledge it and I will carry on");
    expect(said(room)).not.toContain("The open card above, or the review chip under it");
  });

  it("answers a question while that card stays open, then restates the decision", async () => {
    const room = open();
    await settle();
    await withTheCheckOpen(room);
    await typeInto(room, "what borrowers are on this loan already ?");

    expect(room.querySelector('.wk-read[data-topic="structure"]')).toBeTruthy();
    expect(said(room)).not.toMatch(REFUSAL);
    // Back to the flow: the open decision is restated under the answer.
    expect(said(room)).toContain("check above is still open: acknowledge it and I will carry on");
    // And the check really is still waiting.
    expect(lastByText(/^Acknowledge$/)).toBeTruthy();
  });

  it("never refuses over a card that is not on the glass", async () => {
    const room = open();
    await settle();
    // Four cards in one block. Confirming one settles the exchange the block
    // sits in, which takes the other three off the glass with it: they were
    // counted as open gates for the rest of the session, and nothing the banker
    // could do would close them.
    await typeInto(room, "increase the 15M line of credit to 35M and the 8M equipment loan to 10M");
    await click(lastByText(/^Confirm$/));
    await typeInto(room, "what borrowers are on this loan already ?");

    expect(said(room)).not.toMatch(REFUSAL);
  });

  it("holds the invariant: a refusal only ever fires with something on the glass", async () => {
    const room = open();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 35M and the 8M equipment loan to 10M");
    await click(lastByText(/^Confirm$/));
    await typeInto(room, "extend the maturity on the 8M equipment loan to 2027-06-30");

    if (REFUSAL.test(said(room))) expect(onGlass().length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------- the chip, typed back */

describe("the rate chip's own label, typed", () => {
  async function toRateAsk(room: HTMLElement) {
    await typeInto(room, "Increase the 15M line of credit by 20M USD");
    await click(lastByText(/^Confirm$/));
    await click(lastByText(/^Acknowledge$/));
    await click(lastByText(/^240 months$/));
    await click(lastByText(/^Confirm$/));
    await click(lastByText(/^1 September 2026$/));
    await click(lastByText(/^Confirm$/));
  }

  it("reads 'Hold 6.58%' as the hold it is the label of", async () => {
    const room = open();
    await settle();
    await toRateAsk(room);
    expect(said(room)).toContain("What rate should the $15.0MM Line of Credit carry?");
    await typeInto(room, "Hold 6.58%");

    expect(said(room)).toContain("The $15.0MM Line of Credit keeps 6.58%");
    expect(said(room)).not.toContain("I could not match that to anything on this package");
    expect(said(room)).not.toMatch(REFUSAL);
  });

  it("does not read a DIFFERENT figure behind 'hold' as a hold", async () => {
    const room = open();
    await settle();
    await toRateAsk(room);
    await typeInto(room, "hold 7.25%");

    // Not the rate on file, so it is not the hold chip: it is a new rate.
    expect(said(room)).not.toContain("keeps 6.58%");
  });
});

/* =============================================================================
   THE STRESS SCRIPT, ON THE GLASS (orchestrator drive, 2026-09-13).

   Four defects the browser drive found against Hartwell's real book, each one a
   golden-rule breach rather than a crash:

     D1  "the line of credit" staged BOTH lines, each with its own Confirm;
     D2  "add 50bps" staged no rate at all;
     D3  every unreadable answer came back as the previous reply, word for word,
         and a rate typed into the term question was thrown away;
     D4  "keep it" and "no change" typed did not land as the keep chip.
   ============================================================================= */

/** Up to the amortisation question, on the member the line names. */
async function toTheTermQuestion(room: HTMLElement) {
  await typeInto(room, "Increase the 15M line of credit by 20M USD");
  await click(lastByText(/^Confirm$/));
  await click(lastByText(/^Acknowledge$/));
}

const optionChips = () => [...document.body.querySelectorAll(".wk-opt")].map((b) => (b.textContent ?? "").trim());

describe("one reference, two lines of credit (D1)", () => {
  it("asks which one, with a chip per member, and stages only the one picked", async () => {
    const room = open();
    await settle();
    await typeInto(room, "Increase the line of credit by 20M USD");

    expect(said(room)).toContain("Which one?");
    expect(optionChips()).toEqual(["Line of Credit $15M", "Line of Credit $2.50M"]);
    // NOT staged: a question stages nothing, so there is no Confirm to press.
    expect(lastByText(/^Confirm$/)).toBeUndefined();

    await click(lastByText(/^Line of Credit \$15M$/));
    expect(room.textContent).toMatch(/\$15M\s*→\s*\$35M/);
    expect(room.textContent).not.toMatch(/\$2\.50M\s*→\s*\$22\.50M/);
  });

  it("puts the same chips under the member question when the line names none", async () => {
    const room = open();
    await settle();
    await typeInto(room, "increase the commitment to $20,000,000");

    expect(said(room)).toContain("Which member should this land on?");
    expect(optionChips()).toEqual([
      "Line of Credit $15M",
      "Construction $12M",
      "Equipment $8M",
      "Purchase $5M",
      "Equipment $3.50M",
      "Line of Credit $2.50M",
    ]);
  });
});

describe("a basis-point move is a rate move (D2)", () => {
  it("stages the rate off the figure on file once the member is settled", async () => {
    const room = open();
    await settle();
    await typeInto(room, "add 50bps on the line of credit");
    await click(lastByText(/^Line of Credit \$15M$/));

    // 6.58% on the book, plus fifty basis points.
    expect(room.textContent).toMatch(/6\.58%\s*→\s*7\.08%/);
  });
});

describe("an answer out of order, and an answer it cannot read (D3)", () => {
  it("takes a rate typed into the term question and puts the term question back", async () => {
    const room = open();
    await settle();
    await toTheTermQuestion(room);
    expect(said(room)).toContain("What is the amortisation term");

    await typeInto(room, "7.25%");
    expect(said(room)).toContain("moves to 7.25%");
    // The question it jumped is still the one the room needs.
    expect(said(room).lastIndexOf("What is the amortisation term")).toBeGreaterThan(
      said(room).indexOf("moves to 7.25%"),
    );
  });

  it("says what it could not read, and asks again, instead of repeating itself", async () => {
    const room = open();
    await settle();
    await toTheTermQuestion(room);
    /* WHAT IS NEW, COUNTED RATHER THAN MEASURED (backlog row 54). Slicing by the
       length of the earlier text assumed the earlier text never changes, and a
       spent turn now gives up its chips, so the prefix shrinks under the slice. */
    const before = room.querySelectorAll(".wk-msg").length;
    await typeInto(room, "asdf");

    const now = [...room.querySelectorAll(".wk-msg")]
      .slice(before)
      .map((m) => m.textContent ?? "")
      .join(" · ");
    expect(now).toContain('I heard "asdf", and I cannot read it as a length in months or years.');
    expect(now).toContain("What is the amortisation term");
  });
});

describe("a keep word, typed (D4)", () => {
  for (const word of ["keep it", "no change", "leave it", "hold"]) {
    it(`reads "${word}" as the keep chip rather than as a line it cannot read`, async () => {
      const room = open();
      await settle();
      await toTheTermQuestion(room);
      await typeInto(room, word);

      expect(said(room)).toContain("left for later");
      expect(said(room)).not.toContain("I could not match that to anything on this package");
    });
  }
});
