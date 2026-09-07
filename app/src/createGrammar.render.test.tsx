// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, type WorkroomRouter } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { createRenewEngine } from "./workroom/renewEngine";
import { createCreateEngine } from "./workroom/createEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import type { C360Data } from "./data/contract";
import type { WorkroomMode } from "./workroom/types";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE CREATE GRAMMAR, IN THE ROOM.

   THE THREE DEFECTS, and then the grammar that makes them structurally
   impossible rather than caught:

     D1  a create whose value did not resolve reached a chip, reading
         `New covenant / not on the facility today / to all of the loans`;
     D2  a scope word landed silently on the focused member;
     D3  one chip was staged under a sentence saying it landed on all of them.

   AND THE TWO ASKS BEHIND THEM. An underspecified create is GATHERED FOR, one
   question at a time, grounded in what the relationship already carries; the
   open card is AMENDABLE in place; and a navigational line is answered with the
   choice rather than with a capability lecture.

   NOTHING HERE NEEDS A BRIDGE. The whole grammar is deterministic, so the last
   describe drives the same lines with a desk attached and proves the desk is
   never consulted and the answers do not move: channel-none parity is a
   contract, not a fallback.
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

function open(
  args: {
    brain?: (e: BrainEnvelope) => Promise<BrainReply>;
    router?: boolean;
    mode?: WorkroomMode;
    /** THE PACKAGE THE BANKER CHOSE TO FILE INTO. A create now anchors on the
     *  account unless one is named (founder, 2026-09-06), so a create test that
     *  is ABOUT an existing facility has to say which package it joined. */
    join?: string;
  } = {},
): Opened {
  const bundle = data.borrowers![accountId];
  const mode = args.mode ?? "modify";
  const context = workroomContextFor({
    mode,
    data,
    bundle,
    accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: "a5Fbb000000IHFJEA4",
    joinPackageId: args.join ?? null,
  });
  const bound: Opened["bound"] = [];
  const router: WorkroomRouter | undefined = args.router
    ? {
        question: null,
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
        engine={
          mode === "renew"
            ? createRenewEngine({ context, data, bundle })
            : mode === "create"
              ? createCreateEngine({ context, data, bundle })
              : createModifyEngine({ context, data, bundle })
        }
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
  for (let i = 0; i < 6; i += 1) await settle();
}

const buttons = () => [...document.body.querySelectorAll("button")];
const byText = (re: RegExp) => buttons().find((b) => re.test(b.textContent ?? ""));
const click = async (el: Element | undefined) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 6; i += 1) await settle();
};
const chips = (room: HTMLElement) => [...room.querySelectorAll(".wk-chip")];
/** The OPTION chips the agent offered, in order. Scoped to `.wk-opt` so the
 *  package member strip's own buttons are never mistaken for an answer. */
const opts = (room: HTMLElement) => [...room.querySelectorAll(".wk-opt")].map((b) => b.textContent ?? "");
const option = (room: HTMLElement, label: string) =>
  [...room.querySelectorAll(".wk-opt")].find((b) => (b.textContent ?? "") === label);
/** Everything the agent has said, in one string. */
const said = (room: HTMLElement) => [...room.querySelectorAll(".wk-msg")].map((m) => m.textContent ?? "").join(" ");
/** Every org constraint riding an entry, in one string. */
const caveats = (room: HTMLElement) => [...room.querySelectorAll(".wk-cav")].map((c) => c.textContent ?? "").join(" ");

const NEVER: BrainReply = { type: "clarify", text: "the desk should never have been asked this" };

/* ============================================================ D1 and the ask */

describe("a create whose value did not resolve never reaches a chip", () => {
  it("D1: the founder's own line gathers instead of staging the leftover words", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add another covenant to all of the loans");

    // NOT A CHIP. The defect staged `New covenant -> to all of the loans`.
    expect(chips(room)).toHaveLength(0);
    // THE SCOPE WORD IS ANSWERED FIRST, because it is the thing in doubt.
    expect(said(room)).toContain("Six facilities on this package");
    expect(byText(/^All 6$/)).toBeTruthy();
    expect(byText(/The 2 Line of Credit facilities/)).toBeTruthy();
  });

  it("offers what the relationship already tests, and says it will not set a threshold", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add another covenant to all of the loans");
    await click(byText(/^All 6$/));

    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("This relationship already runs Debt Service Coverage of Borrower quarterly");
    expect(said(room)).toContain("I will not set a threshold myself");
    // GROUNDED IN THE BOOK, not in a hardcoded list.
    expect(byText(/Debt Service Coverage of Borrower at 1\.25/)).toBeTruthy();
    expect(byText(/Minimum Liquidity at 5,000,000/)).toBeTruthy();
  });

  it("asks which test when the bank's catalog carries the family twice", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a DSCR covenant of 1.25x on the 15M line of credit");

    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("two tests in that family");
    expect(byText(/^Debt Service Coverage of Borrower$/)).toBeTruthy();
    expect(byText(/^Debt Service Coverage with and without Distributions$/)).toBeTruthy();
  });

  it("refuses by name when a gathered create does not resolve against the catalog", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a DSCR covenant of 1.25x on the 15M line of credit");
    await click(byText(/^Debt Service Coverage with and without Distributions$/));
    // It is on the book at the relationship level and carries no junction to
    // this line, so the room offers the three ways through (P1).
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));

    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("Debt Service Coverage of Borrower");
    expect(said(room)).toContain("I am not putting it up");
  });
});

/* ============================================ F-CG1: free text always wins */

describe("a banker who types the whole answer skips the questions", () => {
  it("F-CG1a: a complete, in-catalog, fresh line stages a card rather than re-asking", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");

    // STAGED, not gathered. The banker said the test, the threshold, the
    // schedule and the facility, and there was nothing left to ask him.
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Leverage <= 3.5x");
    const words = said(room);
    expect(words).toContain("Leverage of 3.5x, tested quarterly");
    // NOT the grounded ask. That is the defect this closes.
    expect(words).not.toContain("To file one I need the test");
    expect(words).not.toContain("This relationship already runs Debt Service Coverage of Borrower quarterly");
  });

  it("F-CG1b: names an out-of-catalog test rather than re-eliciting as if nothing was typed", async () => {
    const { room } = open();
    await settle();
    await click(byText(/^Purchase\$5\.0MM$/));
    await typeInto(room, "add an interest coverage covenant of 3.0x tested quarterly on this facility");

    expect(chips(room)).toHaveLength(0);
    const words = said(room);
    // THE GAP, BY NAME, in the banker's own words.
    expect(words).toContain("The bank's catalog does not carry an interest coverage test");
    // AND THE CATALOG, offered.
    expect(words).toContain("Minimum Liquidity");
    expect(words).toContain("Minimum Current Ratio");
    // AND WHAT HE TYPED, said back rather than thrown away.
    expect(words).toContain("I am holding 3x and the quarterly schedule");
    // NOT the generic gather.
    expect(words).not.toContain("To file one I need the test");
    expect(byText(/^Minimum Current Ratio$/)).toBeTruthy();
  });

  it("F-CG1b: naming a catalog test carries the typed threshold and schedule onto it", async () => {
    const { room } = open();
    await settle();
    await click(byText(/^Purchase\$5\.0MM$/));
    await typeInto(room, "add an interest coverage covenant of 3.0x tested quarterly on this facility");
    await click(byText(/^Minimum Current Ratio$/));

    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Minimum Current Ratio >= 3x");
    expect(said(room)).toContain("Minimum Current Ratio of 3x, tested quarterly");
  });

  it("keeps the two-variant disambiguation: an ambiguous family still asks", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a DSCR covenant of 1.25x tested quarterly on the 15M line of credit");

    // COMPLETE, and still a question, because the family names two tests and
    // filing one as the other is unrecoverable.
    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("two tests in that family");
    expect(said(room)).not.toContain("does not carry");
  });
});

/* ==================================================================== D2 */

describe("a scope word is honoured, and never narrowed to the focused member", () => {
  it("D2: asks about the scope even with a member on the table", async () => {
    const { room } = open();
    await settle();
    // Stand on a member first, the way a banker does.
    await click(byText(/Line of Credit\$15\.0MM/));
    await typeInto(room, "add another covenant to all of the loans");

    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("Six facilities on this package");
  });

  it("fans a settled scope word out to every member it named", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add another covenant to all of the loans");
    await click(byText(/The 2 Line of Credit facilities/));
    await click(byText(/Maximum Debt to Worth at 3/));
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));

    // Both lines of credit, and nothing else.
    expect(chips(room)).toHaveLength(2);
    expect(said(room)).toContain("$15.0MM Line of Credit and $2.5MM Line of Credit");
  });
});

/* ==================================================================== D3 */

describe("the sentence over the chips says what the chips say", () => {
  it("D3: a narrowed line never claims it landed on all of them", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "take the 2.5M line of credit to $4,000,000");

    expect(chips(room)).toHaveLength(1);
    const words = said(room);
    expect(words).toContain("Read that as the $2.50M Line of Credit");
    // The engine's own fan-out announcement is gone, and so is the member it no
    // longer reaches.
    expect(words).not.toContain("it lands on all of them");
    expect(words).not.toContain("Line of Credit ($15M)");
    /* THE CLONE COUNT IS THE CARD'S OWN (founder, 2026-09-03). The cards are on
       the glass, side by side, and the banker can count them; the sentence is
       kept only where nothing was drawn. What the room still OWES here is the
       reading, and that is what the line above holds. */
    expect(words).not.toContain("of these go on the clone");
  });
});

/* ================================================= covenant, end to end */

describe("a covenant is gathered, grounded, and put up", () => {
  it("reads the book for the schedule rather than asking a question it can answer", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");

    // The relationship runs this test quarterly everywhere it carries it, so
    // "how often" is not asked. It IS said, with where it came from.
    expect(said(room)).not.toContain("How often is the");
    // P1: the book carries the test at the relationship level with no loan
    // junction, so it is NOT on the Purchase and the room says exactly that.
    expect(said(room)).toContain("at the relationship level, with no loan junction on it at all");
    expect(said(room)).toContain("NOT associated to Purchase");
    expect(said(room)).not.toContain("already reaches every facility");
  });

  it("offers the three ways through a test the book carries elsewhere, and stages the one he picks", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    expect(chips(room)).toHaveLength(0);

    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Maximum Debt to Worth <= 3x");
    expect(said(room)).toContain("tested quarterly as this relationship already tests it");
    expect(said(room)).toContain("set once when it is created and never updated");
  });

  /* ------------------------------------------ P1, the founder's own line

     "add a DSC of Borrower covenant on the 8M equipment loan" was answered with
     "it already runs at the relationship level, so it already reaches every
     facility, nothing needs putting up twice". The covenant carries NO loan
     junction, so it is not associated to that loan at all. */

  it("P1: says the relationship-level test is NOT on the loan, and offers the three", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a debt service coverage of borrower covenant of 1.25x on the 8M equipment loan");

    expect(chips(room)).toHaveLength(0);
    const words = said(room);
    expect(words).toContain("NOT associated to $8.0MM Equipment");
    expect(words).toContain("reaches a facility through its loan junction");
    expect(words).not.toContain("already reaches every facility");
    expect(words).not.toContain("Nothing here needs putting up twice");
    expect(byText(/^Create a new one on this facility$/)).toBeTruthy();
    expect(byText(/^Associate the existing Debt Service Coverage of Borrower to this facility$/)).toBeTruthy();
    expect(byText(/^A different test$/)).toBeTruthy();
  });

  it("P1: creating a new one on the facility stages a covenant, as it always did", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a debt service coverage of borrower covenant of 1.25x on the 8M equipment loan");
    await click(byText(/^Create a new one on this facility$/));

    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Debt Service Coverage of Borrower >= 1.25x");
  });

  it("P1: associating the existing one stages a real card on the junction arm", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a debt service coverage of borrower covenant of 1.25x on the 8M equipment loan");
    await click(byText(/^Associate the existing Debt Service Coverage of Borrower to this facility$/));

    // It goes UP: an associate is a junction create, not a delete, and since
    // `covenantAttachesJson` deployed on 2026-09-02 it FILES rather than
    // riding the plan as a handoff.
    expect(chips(room)).toHaveLength(1);
    const chip = chips(room)[0].textContent ?? "";
    expect(chip).toContain("Associate a covenant");
    expect(chip).toContain("Debt Service Coverage of Borrower");
    expect(chip).toContain("on the book, with no junction to this facility");
    expect(chip).toContain("associated to this facility, at 1.25, tested quarterly");

    // And the sentence keeps the record untouched, which is the whole point.
    const words = said(room) + caveats(room) + (room.textContent ?? "");
    expect(words).toContain("The covenant record is not touched");
    expect(words).toContain("its threshold, its schedule and its effective date stay exactly as they are");
    expect(words).not.toContain("being built on the org side");
    expect(words).not.toContain("Nothing here needs putting up twice");
  });

  it("does not propose again what this session already put on the plan", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));
    await click(byText(/^Confirm$/));

    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    expect(said(room)).toContain("already on this plan");
  });
});

/* =============================================== collateral, end to end */

describe("a pledge is gathered without ever asking what the org works out", () => {
  it("pledges the deal's own asset, and never asks for an advance rate", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge the accounts receivable to the purchase facility");

    expect(chips(room)).toHaveLength(1);
    const words = said(room);
    expect(words).toContain("no advance rate for you to set here");
    expect(words).not.toMatch(/what advance rate/i);
    expect(words).not.toMatch(/lendable/i);
  });

  it("names the lien position as something no write carries, and puts it on the entry", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge the accounts receivable to the purchase facility");

    expect(said(room)).toContain("lien position");
    await click(byText(/^Confirm$/));
    // The gap travels with the entry, so it reaches the plan rather than
    // scrolling away with the sentence that announced it.
    expect(room.textContent).toContain("No deployed write carries a lien position");
  });

  it("names an asset the facility already carries rather than pledging it twice", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge the accounts receivable to the 15M line of credit");

    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("already pledged to $15.0MM Line of Credit");
    expect(byText(/^Add a second$/)).toBeTruthy();
  });

  it("gathers a pledge end to end: which asset, then the lien position, then the card", async () => {
    const { room } = open();
    await settle();
    // NOTHING NAMED. The room asks which asset, out of the deal's own pledges.
    await typeInto(room, "pledge some collateral to the construction loan");
    expect(chips(room)).toHaveLength(0);
    expect(said(room)).toContain("Which asset?");
    expect(byText(/All present and future accounts receivable/)).toBeTruthy();

    await click(byText(/All present and future accounts receivable/));
    // The asset the deal already carries answers the lien question with it, so
    // the room does not ask twice. The card goes up complete.
    expect(chips(room)).toHaveLength(1);
    const words = said(room);
    expect(words).toContain("at 1st position, as the deal already holds it");
    expect(words).toContain("Construction");
    // THE TWO THINGS THE ORG RESOLVES IN-TRANSACTION ARE NEVER ASKED FOR. The
    // room says so once, as the reason it is not asking.
    expect(words).toContain("no advance rate for you to set here");
    expect(words).not.toMatch(/what advance rate|advance rate\?/i);
    expect(words).not.toMatch(/lendable/i);
  });

  /* -------------------------------------------- P3, create then pledge

     "Pledge something the deal already carries" as the fallback to creating an
     asset makes no sense: the deal's collateral carries onto the clone by
     itself. Creating one must be possible, so the room asks for the rate the
     wire needs, with the bank's own guideline as the proposal, and never
     refuses. */

  it("P3: asks a net-new asset for the rate rather than refusing it", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge a new forklift fleet worth $2,000,000 to the purchase facility");

    expect(chips(room)).toHaveLength(0);
    const words = said(room);
    expect(words).toContain("The credit terms carry an advance rate for this asset: which?");
    expect(words).toContain("approved credit terms are the authority");
    // The refusal is gone, and so is the pointless fallback.
    expect(words).not.toContain("credit decision out of the approved credit terms");
    expect(byText(/Pledge something the deal already carries/)).toBeFalsy();
    // The bank's guideline for equipment, as a chip.
    expect(byText(/^80 percent$/)).toBeTruthy();
  });

  it("P3: drives the founder's own create-then-pledge line to a staged card", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000");

    /* E6 SUPERSEDES E3's "never asks the kind". The typed word is honoured and
       it is what picks the FAMILY; this org holds eleven names under it and
       refuses the bare words at staging, so the room asks WHICH with the org's
       own names as the chips. */
    expect(said(room)).not.toContain("What kind of asset is it?");
    expect(said(room)).toContain("11 collateral types on this org");
    await click(byText(/^Real Estate-Construction$/));
    await click(byText(/^75 percent$/));
    await click(byText(/^1st position$/));

    expect(chips(room)).toHaveLength(1);
    // The banker's own words, on the card and on the wire.
    expect(room.textContent).toContain("Kokomo plant expansion");
    expect(room.textContent).toContain("created and pledged, $6,500,000.00 at 75% advance");
    const words = said(room);
    expect(words).toContain("The asset is created, the borrower's ownership is recorded and only then is it pledged");
    expect(words).not.toContain("I will not set");
  });
});

/* ============================== C, the fee cascade (founder drive 2026-09-02) */

describe("a fee create stays in the fast lane", () => {
  /* HIS OWN LINE. It went to the brain, which asked which line (fair) and then
     invented five more rounds: the fee basis on the increase against the full
     commitment, the payment method, "financed from proceeds / paid outside
     closing / bank paid / waived", and a confirmation. Then the deterministic
     layer asked "Is the origination fee 1% or $20,000,000.00?" because the
     restated line had carried the commitment figure into it. Seven exchanges. */
  const HIS_LINE = "add a 1% origination fee to LOC";

  it("asks which line, in chips, and never reaches the desk", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, HIS_LINE);

    expect(brain).not.toHaveBeenCalled();
    expect(said(room)).toContain("Which facility does the origination fee go on?");
    // AND ONLY THE LINES OF CREDIT. "LOC" names that family and no other.
    expect(opts(room)).toEqual(["$15.0MM Line of Credit", "$2.5MM Line of Credit"]);
  });

  it("stages the card on the NEXT gesture, and asks nothing more", async () => {
    const { room } = open({ brain: vi.fn(async (_e: BrainEnvelope) => NEVER) });
    await settle();
    await typeInto(room, HIS_LINE);
    await click(option(room, "$15.0MM Line of Credit"));

    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("1.00% of the committed amount");
  });

  it("never asks for a dollar amount beside the percentage, or for a basis", async () => {
    const { room } = open({ brain: vi.fn(async (_e: BrainEnvelope) => NEVER) });
    await settle();
    await typeInto(room, HIS_LINE);
    await click(option(room, "$15.0MM Line of Credit"));

    const words = said(room);
    expect(words).not.toMatch(/1% or \$/);
    expect(words).not.toMatch(/paid outside closing|financed from proceeds|bank paid/i);
    expect(words).not.toMatch(/\bbasis\b/i);
    // It says WHY it is not asking, once. The same reason rides the ENTRY as a
    // caveat, so it survives the sentence stepping back to the address where a
    // remark lands under the card.
    expect(words).toContain("The org works the money out itself");
  });

  it("asks the kind where the line named none, and nothing else", async () => {
    const { room } = open({ brain: vi.fn(async (_e: BrainEnvelope) => NEVER) });
    await settle();
    await typeInto(room, "add a 1% fee to the 8M equipment loan");

    expect(said(room)).toContain("What kind of fee is that on the");
    expect(opts(room)).toContain("Origination fee");
    expect(opts(room)).toContain("Commitment fee");
  });

  it("leaves a question about the fees on file alone", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "what fees are on this package?");

    expect(said(room)).not.toContain("Which facility does the");
  });
});

/* ================================== N3, the dollar qualifier as a focus */

describe("a dollar qualifier names the facility on every line, not just a commitment", () => {
  it("N3: stages ONE fee on the $15M line and never asks 1% or $15,000,000", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a 1% origination fee on the 15M line of credit");

    const words = said(room);
    // THE DEFECT: the fenced engine read "15M" as the fee amount and asked.
    expect(words).not.toMatch(/1% or \$15,000,000/);
    expect(words).not.toMatch(/is the .*fee .*or /i);
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Line of Credit");
    expect(room.textContent).not.toContain("$15,000,000.00 fee");
    // The card names the facility, which is why the room says nothing extra.
    expect(room.textContent).toContain("Line of Credit ($15M)");
    expect(room.textContent).toContain("1.00% of the committed amount");
  });

  it("N3: stages the policy exception on the facility the figure named", async () => {
    const { room } = open();
    await settle();
    await typeInto(
      room,
      "log a policy exception on the 15M line of credit for leverage above policy approved by credit committee",
    );

    // The narrative survived the strip: the exception is about leverage.
    expect(said(room).toLowerCase()).toContain("leverage");
    expect(said(room)).not.toMatch(/1% or|\$15,000,000/);
    /* E7: the NAME is what is out of policy. "approved by credit committee"
       says who decided, which is a mitigant and never the record's name. */
    expect(said(room)).toContain('Is "Leverage above policy" waived, mitigated, or standing unmitigated');
    expect(said(room)).toContain('"approved by credit committee"');
    expect(said(room)).not.toContain("Leverage above policy approved by credit committee");

    await click(byText(/^Waived$/));
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Line of Credit ($15M)");
    expect(room.textContent).toContain("Leverage above policy");
    expect(room.textContent).not.toContain("Leverage above policy approved by credit committee");
  });
});

/* ================================================== the amendment in place */

describe("the open card is amended, never contradicted", () => {
  it("takes \"actually make it 1.30x\" onto the same card and says what changed", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));
    expect(chips(room)).toHaveLength(1);

    await typeInto(room, "actually make it 2.75x");

    // ONE card, still. Not a second, contradicting one.
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Maximum Debt to Worth <= 2.75x");
    expect(room.textContent).not.toContain("Maximum Debt to Worth <= 3x");
    expect(said(room)).toContain("Updated on the card: the threshold is now 2.75x");
    // And it is NOT answered with the one-decision refusal.
    expect(said(room)).not.toContain("One decision at a time");
  });

  it("moves the open card to another facility when the banker says so", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));

    await typeInto(room, "on the construction loan instead");

    expect(chips(room)).toHaveLength(1);
    expect(said(room)).toContain("Updated on the card: it lands on Construction");
  });

  it("F-CG2: stages a covenant to a card, then takes \"actually make it 1.30x\" onto that card", async () => {
    const { room } = open();
    await settle();
    // A COMPLETE LINE, STAGED. This is the path the drive could never reach,
    // because every grounded proposal it followed was a book duplicate.
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Leverage <= 3.5x");

    await typeInto(room, "actually make it 1.30x");

    expect(chips(room)).toHaveLength(1);
    expect(room.textContent).toContain("Leverage <= 1.3x");
    expect(room.textContent).not.toContain("Leverage <= 3.5x");
    expect(said(room)).toContain("Updated on the card: the threshold is now 1.3x");
    expect(said(room)).not.toContain("One decision at a time");
  });

  it("F-CG2: takes \"no, quarterly\" onto the card and drops the schedule gap with it", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested monthly on the purchase facility");
    expect(chips(room)).toHaveLength(1);
    // A MONTHLY TEST IS NAMED AS SOMETHING THE WIRE DOES NOT CARRY.
    expect(said(room)).toContain("monthly schedule");

    await typeInto(room, "no, quarterly");

    expect(chips(room)).toHaveLength(1);
    expect(said(room)).toContain("Updated on the card: it is tested quarterly");
    expect(said(room)).not.toContain("One decision at a time");
    // THE GAP WENT WITH THE SCHEDULE THAT CAUSED IT. The card the banker is
    // about to sign no longer carries a caveat about a monthly test.
    await click(byText(/^Confirm$/));
    expect(caveats(room)).not.toContain("monthly");
  });

  it("F-CG2: moves a freshly staged card onto another facility, still one card", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    await typeInto(room, "on the construction loan instead");

    expect(chips(room)).toHaveLength(1);
    expect(said(room)).toContain("Updated on the card: it lands on Construction");
    expect(said(room)).not.toContain("One decision at a time");
  });

  it("still refuses a genuinely new instruction over an open card", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    await click(byText(/Create a new one on th(is|ese) facilit(y|ies)/));

    await typeInto(room, "take the 2.5M line of credit to $4,000,000");
    expect(said(room)).toContain("One decision at a time");
    expect(chips(room)).toHaveLength(1);
  });
});

/* ============================================ the plan, acted on not doubled */

describe("a line touching something already staged amends that entry", () => {
  it("moves the staged covenant rather than putting a second one beside it", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    await click(byText(/^Confirm$/));
    expect(room.textContent).toContain("1 change on");

    await typeInto(room, "add a leverage covenant of 2.75x tested quarterly on the purchase facility");

    // ONE entry on the plan, moved. Not two entries contradicting each other.
    expect(room.textContent).toContain("1 change on");
    expect(said(room)).toContain("I have moved the entry rather than putting a second one beside it");
    expect(said(room)).toContain("the threshold is now 2.75x");
    expect(chips(room)).toHaveLength(1);
  });

  it("moves a staged pledge when the lien position changes", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "pledge the accounts receivable to the purchase facility");
    await click(byText(/^Confirm$/));

    await typeInto(room, "pledge the accounts receivable to the purchase facility at 2nd lien position");

    expect(room.textContent).toContain("1 change on");
    expect(said(room)).toContain("the lien position is now 2nd");
    // THE SETTLED CHIP MOVED WITH THE ENTRY. It is still in the manifest, and
    // it must not read as though the banker's own decision had been undone.
    expect(room.textContent).toContain("in the manifest");
    expect(room.textContent).not.toContain("say it again to restage");
  });

  it("still names an identical line as already there rather than moving anything", async () => {
    const { room } = open();
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    await click(byText(/^Confirm$/));

    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    expect(said(room)).toContain("already on this plan");
    expect(said(room)).not.toContain("I have moved the entry");
  });
});

/* ============================================ the routes that cannot file it */

describe("a route whose own tool cannot file the create says so by name", () => {
  it("gathers the same way on the renewal, then hands the covenant off on the plan", async () => {
    const { room } = open({ mode: "renew" });
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");

    expect(chips(room)).toHaveLength(1);
    const words = said(room);
    // GATHERED THE SAME WAY: the lede is the room's, not the route's.
    expect(words).toContain("Leverage of 3.5x, tested quarterly");
    // AND THE ROUTE'S LIMIT, BY NAME.
    expect(words).toMatch(/renewal files a new maturity and a repricing|no tool files/i);
    // RECORDED, not pretended: the entry says nothing was written.
    await click(byText(/^Confirm$/));
    expect(room.textContent).toContain("1 term on");
    expect(said(room)).toContain("on the plan for the record");
  });

  /* THE JOINED DOOR. Both of these are about a covenant or a pledge aimed at a
     facility that ALREADY EXISTS, so they open the create room on the package
     that holds it. A create on its default path opens a package of its own and
     has no existing facility to name (founder, 2026-09-06). */
  it("gathers the same way on the new facility, then hands the covenant off on the plan", async () => {
    const { room } = open({ mode: "create", join: "a5Fbb000000IHFJEA4" });
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");

    expect(chips(room)).toHaveLength(1);
    const words = said(room);
    expect(words).toContain("Leverage of 3.5x, tested quarterly");
    expect(words).toContain("The new facility files the product, the amount, the term and the purpose");
    expect(words).toContain("A covenant is not one of them");
    expect(words).not.toContain("did not settle");

    await click(byText(/^Confirm$/));
    expect(said(room)).toContain("on the plan for the record");
  });

  it("hands a pledge off on the new facility too, and names the pledge", async () => {
    const { room } = open({ mode: "create", join: "a5Fbb000000IHFJEA4" });
    await settle();
    await typeInto(room, "pledge the accounts receivable to the purchase facility");

    expect(chips(room)).toHaveLength(1);
    expect(said(room)).toContain("A pledge is not one of them");
    // AND IT NEVER ASKS FOR WHAT THE ORG WORKS OUT, on any route.
    expect(said(room)).not.toMatch(/what advance rate/i);
    expect(said(room)).not.toMatch(/lendable/i);
  });
});

/* ================================================= navigational steering */

describe("a navigational line is answered with the choice", () => {
  it("shows the facilities for \"let's modify a new loan\"", async () => {
    const { room, bound } = open({ router: true });
    await settle();
    await typeInto(room, "let's modify a new loan");

    expect(said(room)).toContain("6 facilities on this package. Which one?");
    expect(byText(/^\$8\.0MM Equipment$/)).toBeTruthy();
    // And it did NOT restart the room in the origination path.
    expect(bound).toHaveLength(0);
  });

  it("stands the room on the facility the banker picks", async () => {
    const { room } = open({ router: true });
    await settle();
    await typeInto(room, "let's modify a new loan");
    await click(byText(/^\$8\.0MM Equipment$/));

    expect(said(room)).toContain("Equipment");
    expect(said(room)).toContain("What should change on it?");
  });

  /* THE FOUNDER'S CORRECTION, 2026-09-03. "add a new loan" used to RESTART the
     room in the origination route, which threw away the manifest the banker had
     been building, and it was wrong about nCino as well: a modification versions
     the whole PACKAGE and a new loan belongs on the version being approved. The
     room now stays where it is and asks the first thing it does not know. */
  it("keeps \"add a new loan\" in the modification and asks for the product", async () => {
    const { room, bound } = open({ router: true });
    await settle();
    await typeInto(room, "add a new loan");
    expect(bound).toHaveLength(0);
    expect(said(room)).toContain("What product is the new facility?");
    expect(byText(/^Equipment$/)).toBeTruthy();
  });

  it("offers the route switch that already exists for \"renew instead\"", async () => {
    const { room, bound } = open({ router: true });
    await settle();
    await typeInto(room, "let's renew instead");
    expect(bound.map((b) => b.route)).toEqual(["renew"]);
  });
});

/* ==================================================== channel-none parity */

describe("channel-none parity: the grammar is the same room either way", () => {
  it("never troubles the desk for a create it can gather itself", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "add another covenant to all of the loans");
    await click(byText(/^All 6$/));
    expect(brain).not.toHaveBeenCalled();
    expect(said(room)).toContain("This relationship already runs");
  });

  it("never troubles the desk for a pledge, an amendment or a steer", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "pledge the accounts receivable to the purchase facility");
    await typeInto(room, "actually 2nd lien position");
    await typeInto(room, "a different facility");
    expect(brain).not.toHaveBeenCalled();
  });

  it("never troubles the desk for the catalog gap, the plan amendment or a route handoff", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain });
    await settle();
    await typeInto(room, "add an interest coverage covenant of 3.0x tested quarterly on the purchase facility");
    await click(byText(/^Minimum Current Ratio$/));
    await click(byText(/^Confirm$/));
    await typeInto(room, "add a minimum current ratio covenant of 2x tested quarterly on the purchase facility");
    expect(brain).not.toHaveBeenCalled();
    expect(said(room)).toContain("does not carry an interest coverage test");
    expect(said(room)).toContain("I have moved the entry");
  });

  it("hands a create off on the renewal route without a desk either", async () => {
    const brain = vi.fn(async (_e: BrainEnvelope) => NEVER);
    const { room } = open({ brain, mode: "renew" });
    await settle();
    await typeInto(room, "add a leverage covenant of 3.5x tested quarterly on the purchase facility");
    expect(brain).not.toHaveBeenCalled();
    expect(chips(room)).toHaveLength(1);
  });

  it("gathers exactly the same way with a desk attached as without one", async () => {
    const wired = open({ brain: vi.fn(async (_e: BrainEnvelope) => NEVER) });
    await settle();
    await typeInto(wired.room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    const withDesk = said(wired.room);

    act(() => root?.unmount());
    container?.remove();
    clearComposed();

    const dry = open();
    await settle();
    await typeInto(dry.room, "add a maximum debt to worth covenant of 3x on the purchase facility");
    expect(said(dry.room)).toBe(withDesk);
  });
});
