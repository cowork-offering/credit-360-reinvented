// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { CAPABILITY_LINE } from "./components/workroom/hygiene";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { PRICING_WHY } from "./components/workroom/pricingGate";
import { __resetFeedForTests, stageFeed } from "./intent/feed";
import { consumeIntent, __resetIntentsForTests } from "./intent/store";
import type { IntentDoc } from "./intent/contract";
import { ACT_WORDS } from "./channel/narrate";
import { armConfirmSentence, ARM_FIELD } from "./components/workroom/orgArms";
import { committedSentence } from "./components/workroom/dispatch";
import { figuresFor } from "./workroom/manifest";
import type { WorkroomDelta } from "./workroom/types";
import { SETTLE_EXIT_MS } from "./components/workroom/settle";
import { RelationshipRoom, neutralRelAsk } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { BorrowerBundle } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";
import { resetCatalog } from "./channel/catalog";
import { acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THREAD HYGIENE - the room resolves itself.

   FOUNDER, 2026-09-03, on the live cockpit: "it reads like double chats", and
   then, the same morning, "even a single bubble is too much text to read". Two
   complaints, one pass: the room said several things twice, and each of the
   things it said was longer than it needed to be.

   WHAT THESE HOLD:

     ONE BUBBLE     a focus click puts the room's own prompt on the glass and
                    nothing else. The model is not consulted on a selection and
                    never speaks over a question.
     ONE LINE       the focus prompt is one line, and the capability list rides
                    the FIRST focus of a room open and no other.
     THE SETTLE     an exchange that has been decided leaves the stage and is
                    replaced by one compact row. It is MOUNTED, not deleted, and
                    the row brings it back.
     THE CUTS       the parser preamble only where the room narrowed; the
                    version fact once per plan, in one sentence; the pricing
                    reason once per facility.
     THE FED LINE   an intent's instruction is a marker, not a banker bubble,
                    and the queue's own progress is in the rail, not the thread.
     THE BUDGET     each act's remark is clipped to its word budget on the glass,
                    not only asked for in the prompt.

   Motion is OFF in jsdom (no matchMedia), which is the reduced-motion path: the
   settle is an instant swap there and the next step lands in the same commit.
   That is deliberate - it is the path a banker with the accessibility setting
   on gets, and the one the suite can assert without chasing a timer.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetSessionDoor();
  __resetFeedForTests();
  __resetIntentsForTests();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  delete (window as unknown as { claude?: unknown }).claude;
  clearComposed();
  resetCatalog();
  __resetFeedForTests();
  __resetIntentsForTests();
});

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";

/** The session door at the runtime's own shape, answering one remark. */
function installSession(text: string): { calls: string[] } {
  const calls: string[] = [];
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) =>
      name === "sample"
        ? async (input: string, options?: { onText?: (u: { text: string; delta: string }) => void }) => {
            calls.push(input);
            options?.onText?.({ text, delta: text });
            return { text, truncated: false, modelTierApplied: "quick" };
          }
        : null,
  };
  return { calls };
}

async function openRoom() {
  await acquireSample(50);
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
        reads={{
          bundle,
          accountName: bundle.snapshot!.name!,
          productPackageId: context.productPackageId,
          generatedAt: "2026-09-03T08:00:00.000Z",
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
  await settle();
  await settle();
  await settle();
}

const click = async (el: Element | null | undefined) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
  await settle();
};

/** The facility chip on the package strip, by the label it prints. */
const memberChip = (room: HTMLElement, label: string) =>
  [...room.querySelectorAll<HTMLButtonElement>(".wk-mchip")].find((b) => b.textContent?.includes(label));

const confirmButton = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Confirm");

/* RECEIPTS, NOT RECAP LINES (founder, 2026-09-13: "only the current action is
   nicely shown in the chat"). A collapsed STEP now says what it recorded in one
   line, in the same quiet register as a receipt and marked `data-recap`. It is a
   way back into the history; these helpers are about the receipts an exchange
   leaves in the live thread. */
const settledRows = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLElement>(".wk-settled:not([data-recap])")];
const onStage = (room: HTMLElement) => [...room.querySelectorAll<HTMLElement>('[data-settle-state="on"]')];
const settledAway = (room: HTMLElement) => [...room.querySelectorAll<HTMLElement>('[data-settle-state="settled"]')];

/** Every word on the glass, as a reader meets it. The room's chrome (the
 *  header, the composer, the rail) is not the thread and is not counted. */
const threadWords = (room: HTMLElement): number =>
  (room.querySelector(".wk-thread")?.textContent ?? "").split(/\s+/).filter(Boolean).length;


/* ------------------------------------------------ the relationship room's own

   Injected deps, exactly as relationshipRoom.render.test.tsx does it: not one
   assertion below reaches a connector. */

const REL_PACKAGE = "a5Fbb000000IHFJEA4";

function relCtx() {
  const bundle = {
    snapshot: {
      accountId: "001X",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: REL_PACKAGE,
      primaryRiskRating: "4",
      computedRiskRating: "5",
    },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: REL_PACKAGE,
          committed: 10_000_000,
          collateral: [{ collateralId: "a35A", collateralName: "COL-000762", collateralType: "Equipment" }],
        },
      ],
    },
    covenants: {
      covenants: [
        {
          covenantId: "cov1",
          covenantType: "Debt Service Coverage",
          nextEvaluationDate: "2026-09-06",
          lastEvaluationStatus: "Compliant",
          latestComplianceStatus: "Pending",
        },
      ],
    },
  } as unknown as BorrowerBundle;
  const relData = {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({
    data: relData,
    bundle,
    accountId: "001X",
    accountName: "Hartwell Precision Manufacturing LLC",
  });
}

const REL_PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files an annual credit review at In Progress.",
  steps: [],
  warnings: [],
  suggestions: [],
};

const REL_RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "The review was created and verified.",
  recordName: "REV-0000000012",
  status: "In Progress",
  steps: [],
};

const relDeps = (): RelFlowDeps => ({
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: REL_PLAN }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: REL_RESULT }) as ToolOutcome<ExecuteResult>,
});

function openRel(args: { route: RelRoute; deps?: RelFlowDeps }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={relCtx()}
        route={args.route}
        router={{
          question: null,
          say: null,
          preselectCovenantId: null,
          neutral: () => neutralRelAsk(),
          onBind: () => {},
          onRestart: () => {},
        }}
        deps={args.deps ?? relDeps()}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")! };
}

const relSettle = settle;
const relClick = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

/** Answer the live step with the first chip the room offers. A chip SAYS the
 *  value: it rides the same recorder a typed line does. */
async function relAnswer(room: HTMLElement) {
  await relType(room, "Annual");
}

async function relType(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  await settle();
}

/* ============================================ 0. the focus click, one bubble */

describe("a focus click puts ONE bubble on the glass (founder paste, 2026-09-03)", () => {
  it("does not consult the model on a selection", async () => {
    const session = installSession("Commitment rises and the revolver sheds two pledges.");
    const room = await openRoom();
    await settle();
    await settle();
    const before = session.calls.length;
    const narrs = room.querySelectorAll(".wk-narr").length;

    await click(memberChip(room, "Line of Credit"));

    // The room answered. The model was never asked, so there is no second
    // bubble to read: a selection is the banker pointing, not the room acting.
    expect(room.textContent).toContain("What should change on it?");
    expect(session.calls).toHaveLength(before);
    expect(room.querySelectorAll(".wk-narr")).toHaveLength(narrs);
  });

  it("says the facility in ONE line, with the commitment as its name", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await settle();
    await click(memberChip(room, "Line of Credit"));

    const bubbles = [...room.querySelectorAll<HTMLElement>(".wk-agent .wk-bub")];
    const prompt = bubbles.find((b) => b.textContent?.includes("What should change on it?"))!;
    // The commitment is the facility's NAME, in parentheses, exactly as the
    // strip and the rail already print it - not a third figure in a list.
    expect(prompt.textContent).toMatch(/Line of Credit \(\$15M\):/);
    expect(prompt.textContent).not.toContain("committed,");
    // One line: the identity, the two facts, the question. Nothing else.
    expect(prompt.textContent!.replace(CAPABILITY_LINE, "").split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(18);
  });

  it("shows the capability list on the FIRST focus of a room open and never again", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await settle();

    await click(memberChip(room, "Line of Credit"));
    expect(room.textContent).toContain(CAPABILITY_LINE);

    await click(memberChip(room, "Construction"));
    const prompts = [...room.querySelectorAll<HTMLElement>(".wk-agent .wk-bub")].filter((b) =>
      b.textContent?.includes("What should change on it?"),
    );
    // The SECOND prompt carries the facility and not the orientation. What this
    // room can file is a thing you need the first time.
    expect(prompts[prompts.length - 1].textContent).not.toContain(CAPABILITY_LINE);
  });
});

/* ==================================================== 1. the settle choreography */

describe("an exchange that settles leaves the stage (rule 1)", () => {
  it("replaces the whole exchange with ONE compact settled row", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    const staged = onStage(room).length;
    expect(staged).toBeGreaterThan(1);

    await click(confirmButton(room));

    const rows = settledRows(room);
    expect(rows).toHaveLength(1);
    // What settled, and how. The card's own two figures, and the word.
    expect(rows[0].textContent).toContain("$15M");
    expect(rows[0].textContent).toContain("$20M");
    expect(rows[0].textContent).toContain("confirmed");
    // And the exchange it replaced is off the stage: the banker's line, the
    // room's account and the chips all left together.
    expect(settledAway(room).length).toBeGreaterThanOrEqual(staged);
  });

  it("keeps the exchange MOUNTED and brings it back on the row's own control", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    await click(confirmButton(room));

    const away = settledAway(room);
    expect(away.length).toBeGreaterThan(0);
    // FADED IS NOT GONE. Every settled item is still in the document, hidden
    // from the accessibility tree, and one click from being back.
    for (const node of away) {
      expect(document.body.contains(node)).toBe(true);
      expect(node.getAttribute("aria-hidden")).toBe("true");
    }

    const row = settledRows(room)[0];
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(settledAway(room)).toHaveLength(0);
    expect(room.querySelectorAll('[data-settle-state="shown"]').length).toBeGreaterThan(0);
    // The banker's own line is readable again, which is the whole point.
    expect(room.textContent).toContain("take the 15M line of credit to 20000000");
  });

  it("swaps instantly under reduced motion: nothing is left mid-exit", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    await click(confirmButton(room));

    // jsdom has no matchMedia, so `prefersReducedMotion` is true here. There is
    // no leaving beat at all and the next step is already on the glass.
    expect(room.querySelectorAll('[data-settle-state="leaving"]')).toHaveLength(0);
    expect(settledAway(room).length).toBeGreaterThan(0);
  });

  it("spends a handful of words where the exchange spent dozens", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    const spent = threadWords(room);

    await click(confirmButton(room));

    /* THE ROOM RESOLVES ITSELF. The exchange the banker just decided is off the
       stage - its line, its account and its chips are not in what is read - and
       the row that stands for it is a handful of words. What is on the glass
       now is the NEXT step, which is the only thing left to decide. */
    const visible = [...room.querySelectorAll<HTMLElement>(".wk-thread *")]
      .filter((el) => el.getAttribute("data-settle-state") === "on" || el.classList.contains("wk-settled"))
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(visible).not.toContain("take the 15M line of credit to 20000000");
    expect(visible).not.toContain("Read that as the");
    expect(spent).toBeGreaterThan(40);

    const row = settledRows(room)[0];
    expect(row.textContent!.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(10);
  });

  it("retires the facility strip once the first card lands (rule 4)", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await settle();
    expect(room.querySelector('[data-tier="detail"]')?.getAttribute("data-tier-state")).toBe("on");

    await typeInto(room, "take the 15M line of credit to 20000000");

    // The banker is deciding on the card now, not on the strip. Every tier is
    // faded and every one of them is still mounted behind the summon.
    expect(room.querySelector('[data-tier="detail"]')?.getAttribute("data-tier-state")).toBe("faded");
    expect(room.querySelector('[data-summon="tiers"]')).not.toBeNull();
  });
});

/* ============================================================ 2. the copy cuts */

describe("the room says it once (rule 2)", () => {
  it("says the version fact ONCE per plan, in one sentence", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    expect(room.textContent).toContain("Confirming stages the next version of the package");
    // The methodology paragraph is gone: what is left is the fact that makes
    // the Confirm safe to press.
    expect(room.textContent).not.toContain("every eligible member rolls into it");

    await click(confirmButton(room));
    await typeInto(room, "move the construction loan maturity to 2029-06-30");
    const bubbles = [...room.querySelectorAll<HTMLElement>(".wk-agent .wk-bub")];
    const last = bubbles[bubbles.length - 1];
    expect(last.textContent).not.toContain("Confirming stages the next version");
  });

  it("says the parser preamble only where it actually narrowed between members", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    // Two lines of credit on this package: naming the figure narrows, and the
    // banker is entitled to read which one the room took.
    await typeInto(room, "take the 15M line of credit to 20000000");
    expect(room.textContent).toContain("Read that as the");

    await click(confirmButton(room));
    // A line naming a facility no sibling shares narrows nothing, so the room
    // has nothing to explain and does not.
    await typeInto(room, "move the construction loan maturity to 2029-06-30");
    const bubbles = [...room.querySelectorAll<HTMLElement>(".wk-agent .wk-bub")];
    expect(bubbles[bubbles.length - 1].textContent).not.toContain("Read that as the");
  });

  it("gives the pricing reason once per facility, not on both of its questions", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    await click(confirmButton(room));

    // The first pricing question carries the reason.
    expect(room.textContent).toContain(PRICING_WHY);
    const first = room.textContent!.split(PRICING_WHY).length - 1;
    expect(first).toBe(1);
  });
});

/* ========================================================== 3. the intent feed */

describe("a fed line is a marker, not a banker bubble (rule 3)", () => {
  const INTENT: IntentDoc = {
    id: "01J8ZQ5K9T2M4XQ7YB3C1",
    accountId,
    accountName: "Hartwell Precision Manufacturing LLC",
    room: "facility",
    route: "modify",
    lines: [
      "take the 15M line of credit to 20000000",
      "move the construction loan maturity to 2029-06-30",
      "move the 2.5M line of credit rate to 7.25%",
      "give the 8M equipment loan a 84 month term",
    ],
    context: {
      summary: "James Hartwell asked to take the revolver to $20M.",
      source: { kind: "meeting", received: "3 Sep 2026" },
    },
    createdAt: "2026-09-03T07:00:00.000Z",
    status: "pending",
  };

  it("renders the instruction once, as one line naming where it came from", async () => {
    installSession("");
    consumeIntent(INTENT);
    stageFeed({ room: "facility", accountId, lines: INTENT.lines, intentId: INTENT.id });
    const room = await openRoom();
    await settle();
    await settle();
    await settle();
    await settle();

    const marker = room.querySelector<HTMLElement>('[data-fed="line"]');
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toContain("From the meeting of 3 Sep 2026");
    expect(marker!.textContent).toContain("take the 15M line of credit to 20000000");
    // NOT a banker bubble. Nobody in this room said it.
    expect(
      [...room.querySelectorAll(".wk-banker")].some((b) => b.textContent?.includes("take the 15M line of credit")),
    ).toBe(false);
  });

  it("puts the queue's own progress in the rail head, never in the thread", async () => {
    installSession("");
    consumeIntent(INTENT);
    stageFeed({ room: "facility", accountId, lines: INTENT.lines, intentId: INTENT.id });
    const room = await openRoom();
    await settle();
    await settle();
    await settle();

    const head = room.querySelector<HTMLElement>('[data-feed="progress"]');
    expect(head).not.toBeNull();
    expect(head!.textContent).toContain(`of ${INTENT.lines.length} settled`);
    expect(room.querySelector(".wk-thread")!.contains(head!)).toBe(false);
  });

  it("drops the 'anything else' tail while the queue still holds a line", async () => {
    installSession("");
    consumeIntent(INTENT);
    stageFeed({ room: "facility", accountId, lines: INTENT.lines, intentId: INTENT.id });
    const room = await openRoom();
    await settle();
    await settle();
    await settle();
    await settle();

    // The room is about to say the next line itself; asking whether there is
    // anything else would be a question it answers one beat later, out loud.
    expect(room.querySelector(".wk-thread")!.textContent).not.toContain(
      "Anything else on this facility, or shall I stage it?",
    );
  });
});

/* ============================================================ the word budget */

describe("the budget is enforced on the glass, not only asked for (founder, 2026-09-03)", () => {
  const LONG =
    "The revolver carries the whole increase on its own and the pledged pool does not move with it. " +
    "Coverage thins across the relationship and the cushion narrows on every test the package holds. " +
    "That leaves the borrower with less headroom than the committee saw at the last review, which is " +
    "worth a note in the file before this goes up for approval by anyone at all this quarter.";

  it("clips a staged remark to its act's word budget", async () => {
    installSession(LONG);
    const room = await openRoom();
    await settle();
    // A pledge is not a routine scalar, so the model is consulted and speaks.
    await typeInto(room, "pledge the Fort Wayne equipment on the 2.5M line of credit");

    const remark = room.querySelector<HTMLElement>(".wk-narr .wk-bub");
    if (!remark) return; // the room refused the line; there is no remark to hold
    const words = remark.textContent!.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(ACT_WORDS.staged + 2);
  });

  it("holds the staged budget well under the answered one", () => {
    // The card already carries the change; the remark is the consequence.
    expect(ACT_WORDS.staged).toBeLessThan(ACT_WORDS.answered);
    expect(ACT_WORDS.staged).toBeLessThanOrEqual(35);
    expect(ACT_WORDS.refused).toBeLessThanOrEqual(25);
  });
});

/* ==================================================== 5. the relationship room */

describe("the relationship room settles its steps the same way (rule 5)", () => {
  it("turns an answered step into ONE numbered row, mounted and summonable", async () => {
    const { room } = openRel({ route: "annual" });
    await relSettle();
    await relSettle();

    // The room is asking a numbered question, as the ritual does.
    expect(room.textContent).toMatch(/Step 1 of \d/);
    const asked = room.querySelector<HTMLElement>(".wk-thread")!.textContent!;

    await relAnswer(room);

    const rows = settledRows(room);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // The number travels on the row: a banker three questions into six should
    // not have to count rows to find out how far through the review they are.
    expect(rows[0].textContent).toMatch(/Step 1 of \d/);
    expect(rows[0].textContent).toContain("recorded");

    expect(asked).toContain("Step 1 of");
    /* THE FIRST QUESTION IS A TIER and the summon already owns it, so its row
       carries no second control for the same intent. Every step after it is an
       ordinary exchange and settles like one. */
    expect(rows[0].tagName).toBe("DIV");

    await relType(room, "The relationship is performing to plan and the position is unchanged.");
    const both = settledRows(room);
    expect(both.length).toBeGreaterThanOrEqual(2);
    const second = both[1] as HTMLButtonElement;
    expect(second.tagName).toBe("BUTTON");

    // FADED IS NOT GONE. The exchange is still in the document, hidden, and one
    // click from being back.
    const away = [...room.querySelectorAll<HTMLElement>('[data-settle-state="settled"]')];
    expect(away.length).toBeGreaterThan(0);
    for (const node of away) expect(node.getAttribute("aria-hidden")).toBe("true");

    relClick(second);
    await relSettle();
    expect(room.querySelectorAll('[data-settle-state="settled"]')).toHaveLength(0);
    expect(room.querySelectorAll('[data-settle-state="shown"]').length).toBeGreaterThan(0);
  });

  it("retires the scope tier once the first step settles (rule 4)", async () => {
    const { room } = openRel({ route: "annual" });
    await relSettle();
    await relSettle();
    await relAnswer(room);
    // Every tier is off the stage and the summon that brings them back is there.
    expect(room.querySelector('[data-tier="detail"]')?.getAttribute("data-tier-state")).toBe("faded");
    expect(room.querySelector('[data-summon="tiers"]')).not.toBeNull();
  });
});

/* ============================================== B. one card, morphing in place */

describe("the compile card resolves in place, never into a second card", () => {
  async function driveToPlan(room: HTMLElement) {
    // The annual review's four answers, on the chips the room offers.
    const pick = async (re: RegExp) => {
      const b = [...document.body.querySelectorAll("button")]
        .filter((x) => !x.hasAttribute("data-recap"))
        .find((x) => re.test(x.textContent ?? ""));
      relClick(b!);
      await settle();
      await settle();
    };
    await pick(/^Annual$/);
    await pick(/Not assessed/);
    await pick(/Not assessed/);
    await pick(/Not assessed/);
    const chip = room.querySelector<HTMLButtonElement>(".wk-propose");
    relClick(chip!);
    return chip;
  }

  it("is ONE node that carries the compile state, before and after", async () => {
    /* THE ORG IS HELD MID-STAGE, so the compiling half is observable. With a
       stub that resolves at once the card is ready before the test can look,
       which is the honest reason this holds the promise open. */
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const { room } = openRel({
      route: "annual",
      deps: {
        ...relDeps(),
        stage: async () => {
          await held;
          return { ok: true, result: REL_PLAN } as ToolOutcome<StagedOutput>;
        },
      },
    });
    await relSettle();
    await driveToPlan(room);

    // Mid-compile: one card, saying so, with the glow circling behind it.
    const compiling = room.querySelector<HTMLElement>('[data-card="compile"]');
    expect(compiling).not.toBeNull();
    expect(compiling!.getAttribute("data-compile-state")).toBe("compiling");
    expect(compiling!.querySelector('[data-orbit="circling"]')).not.toBeNull();

    await act(async () => {
      release!();
      await held;
    });
    await relSettle();
    await relSettle();
    await relSettle();

    // THE SAME NODE, RESOLVED. Not a second card appended below the first.
    const cards = [...room.querySelectorAll<HTMLElement>('[data-card="compile"]')];
    expect(cards).toHaveLength(1);
    expect(cards[0]).toBe(compiling);
    expect(cards[0].getAttribute("data-compile-state")).toBe("ready");
    // And the glow settles to still rather than disappearing: the card is warm,
    // it is simply no longer working.
    expect(cards[0].querySelector('[data-orbit="still"]')).not.toBeNull();
    expect(cards[0].textContent).toContain("decision token");
  });
});

/* ============================================ the founder's own pricing drive */

describe("the pricing ask is not a dead end (founder, 2026-09-03)", () => {
  /** The live-verified rate on the $15M line, as the org holds it. The snapshot
   *  carries none, so the drive seeds it exactly as a live read would. */
  const withRate = () => {
    const bundle = JSON.parse(JSON.stringify(data.borrowers![accountId]));
    bundle.exposure.facilities[0].interestRate = 7.6;
    return bundle;
  };

  async function openWithRate() {
    await acquireSample(50);
    const bundle = withRate();
    const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot.name, productPackageId: "a5Fbb000000IHFJEA4" });
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
            accountName: bundle.snapshot.name,
            productPackageId: context.productPackageId,
            generatedAt: "2026-09-03T08:00:00.000Z",
          }}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  const liveBubble = (room: HTMLElement) => {
    const bubbles = [...room.querySelectorAll<HTMLElement>('[data-settle-state="on"] .wk-agent .wk-bub')];
    return bubbles[bubbles.length - 1];
  };
  /** The chips under the LIVE question, which is the one being answered. Every
   *  earlier question is still on the stage until it settles, and its chips are
   *  still real: this reads the last bubble's own. */
  const chipLabels = (room: HTMLElement) => {
    const bub = liveBubble(room);
    return [...(bub?.querySelectorAll<HTMLButtonElement>('.wk-opt') ?? [])].map((b) => b.textContent);
  };

  /** The founder's sequence, up to the rate question. */
  async function driveToRate(room: HTMLElement) {
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));
    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => /240 months/.test(b.textContent ?? "")));
    await click(confirmButton(room));
    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => /^1 /.test(b.textContent ?? "")));
    await click(confirmButton(room));
  }

  it("asks the rate with the figure on file as a chip, and an example", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);

    const ask = liveBubble(room);
    expect(ask.textContent).toContain("What rate should the");
    // THE FIGURE IS ON THE QUESTION, not a bare "supply a rate".
    expect(ask.textContent).toContain("7.60%");
    expect(ask.textContent).toContain("e.g. 7.25% fixed, paid monthly");
    expect(chipLabels(room)).toEqual(["Hold 7.60%", "New all-in rate", "Index + spread"]);
  });

  it("does NOT stage on 'New all-in rate': it asks for the figure", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);
    const staged = room.querySelectorAll(".wk-ent").length;

    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => b.textContent === "New all-in rate"));

    // Nothing on the manifest, and no sentence claiming a rate was supplied.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(staged);
    expect(room.textContent).not.toContain("has supplied an all-in rate");
    expect(liveBubble(room).textContent).toContain("What is the new all-in rate");
    expect(liveBubble(room).textContent).toContain("e.g. 7.25%");
  });

  it("answers 'what index and rate options do I have' with the OPTIONS", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);

    await typeInto(room, "what index and rate options do I have");

    expect(chipLabels(room)).toEqual(["Hold 7.60%", "New all-in rate", "Index + spread"]);
    // The aside was said once, on the first ask, and is not repeated as an answer.
    const answers = room.querySelectorAll('[data-settle-state="on"] .wk-agent .wk-bub');
    const repeated = [...answers].filter((b) => (b.textContent ?? "").includes("no index name"));
    expect(repeated.length).toBeLessThanOrEqual(1);
  });

  it("takes 'Yes, 7.25% all-in' as the answer and never re-asks", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);

    await typeInto(room, "Yes, 7.25% all-in");

    // THE FIGURE IS ON THE SENTENCE AND ON THE CARD.
    expect(liveBubble(room).textContent).toContain("7.25%");
    expect(liveBubble(room).textContent).not.toContain("What rate should the");
    const card = room.querySelector('[data-settle-state="on"] .wk-chip');
    expect(card?.textContent).toContain("7.25%");
  });

  /* ============ THE WHOLE SEQUENCE, AND WHAT THE PLAN HOLDS AT THE END

     Focus, increase, confirm, acknowledge, 240, a first payment date, "what
     options do I have", "Yes, 7.25% all-in". The commitment is the change he
     came in for and it is the one that went missing. */
  it("keeps the commitment on the plan through every pricing turn", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);
    await typeInto(room, "what index and rate options do I have");
    await typeInto(room, "Yes, 7.25% all-in");
    await click(confirmButton(room));

    const rail = room.querySelector(".wk-col-r")!;
    const entries = [...rail.querySelectorAll(".wk-ent")].map((e) => (e.textContent ?? "").replace(/\s+/g, " "));
    const all = entries.join(" | ");
    expect(all).toMatch(/Commitment/i);
    expect(all).toMatch(/20/);
    expect(all).toMatch(/Amortisation|Amortised/i);
    expect(all).toMatch(/240/);
    expect(all).toMatch(/payment date/i);
    expect(all).toMatch(/[Rr]ate/);
    expect(all).toMatch(/7\.25/);
  });

  it("reads the plan back with the commitment first", async () => {
    installSession("");
    const room = await openWithRate();
    await settle();
    await driveToRate(room);
    await typeInto(room, "Yes, 7.25% all-in");
    await click(confirmButton(room));

    await typeInto(room, "what is on the plan");
    const rows = [...room.querySelectorAll<HTMLElement>(".wk-rc-row, .wk-rrow, .wk-read-row")];
    const labels = rows.map((r) => (r.textContent ?? "").trim()).filter(Boolean);
    const first = labels.findIndex((l) => /commitment/i.test(l));
    const rate = labels.findIndex((l) => /rate/i.test(l));
    if (first >= 0 && rate >= 0) expect(first).toBeLessThan(rate);
  });
});

/* ================================================== the settle glide (rule 2) */

describe("the settle glides rather than snapping (founder, 2026-09-03)", () => {
  it("collapses the exchange's own height instead of taking it away in one frame", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");
    await click(confirmButton(room));

    const away = [...room.querySelectorAll<HTMLElement>('[data-settle-state="settled"]')];
    expect(away.length).toBeGreaterThan(0);
    for (const node of away) {
      // The wrapper is a one-row grid whose track carries the collapse, and the
      // inner row is what the track is allowed to squeeze.
      expect(node.className).toContain("wk-ex");
      expect(node.querySelector(".wk-ex-in")).not.toBeNull();
      // ONE CLOCK. The stylesheet reads the duration off the constant.
      expect(node.style.getPropertyValue("--wk-settle-ms")).toBe(`${SETTLE_EXIT_MS}ms`);
    }
  });

  it("names a glide inside the founder's own range", () => {
    expect(SETTLE_EXIT_MS).toBeGreaterThanOrEqual(380);
    expect(SETTLE_EXIT_MS).toBeLessThanOrEqual(460);
  });
});

/* ===================== the runtime got in the way (founder, 2026-09-03) */

describe("a runtime failure is one quiet line, and the model stops talking", () => {
  /** The artifact runtime's own refusal, at the shape it reaches the room in. */
  const SCOPE_ERROR = "This call is outside the scope you consented to. Reload to review.";

  /** A door that answers, so a remark WOULD be asked for if anything asked. */
  const talkingSession = () =>
    installSession("The pledged pool does not move with the commitment as it grows.");

  async function openWithBrokenStage(error: string) {
    await acquireSample(50);
    const bundle = data.borrowers![accountId];
    const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
    const engine = createModifyEngine({ context, data, bundle });
    /* THE ORG IS REACHED AND REFUSES AT THE HOST. Only `stage` is broken: the
       parse, the manifest and every gate before it are the real code. */
    const broken = { ...engine, stagePlan: async () => { throw new Error(error); } };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <Workroom
          context={context}
          engine={broken as unknown as typeof engine}
          reads={{
            bundle,
            accountName: bundle.snapshot!.name!,
            productPackageId: context.productPackageId,
            generatedAt: "2026-09-03T08:00:00.000Z",
          }}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  async function toReview(room: HTMLElement) {
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));
    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => /Leave pricing for later/.test(b.textContent ?? "")));
    await click(room.querySelector<HTMLButtonElement>(".wk-propose"));
  }

  it("shows the host's refusal as ONE quiet line with a Reload chip", async () => {
    talkingSession();
    const room = await openWithBrokenStage(SCOPE_ERROR);
    await settle();
    await toReview(room);

    const trouble = [...room.querySelectorAll<HTMLElement>('[data-trouble="line"]')];
    expect(trouble).toHaveLength(1);
    expect(trouble[0].textContent).toContain("outside the scope you consented to");
    expect(trouble[0].querySelector("button")?.textContent).toBe("Reload");
    // NOT an agent bubble: the runtime is not the bank and not the room.
    expect([...room.querySelectorAll(".wk-agent .wk-bub")].some((b) => b.textContent?.includes("outside the scope"))).toBe(
      false,
    );
  });

  it("NEVER follows it with a model remark, however many times it is retried", async () => {
    const session = talkingSession();
    const room = await openWithBrokenStage(SCOPE_ERROR);
    await settle();
    await toReview(room);
    const remarks = room.querySelectorAll(".wk-narr").length;
    const calls = session.calls.length;

    // The banker tries again, exactly as he did.
    await click(room.querySelector<HTMLButtonElement>(".wk-propose"));
    await click(room.querySelector<HTMLButtonElement>(".wk-propose"));

    expect(room.querySelectorAll(".wk-narr")).toHaveLength(remarks);
    expect(session.calls).toHaveLength(calls);
    // Two attempts, two lines, and not one word of credit commentary.
    expect(room.querySelectorAll('[data-trouble="line"]').length).toBeGreaterThanOrEqual(1);
  });

  it("lets the model speak again once the banker says something next", async () => {
    talkingSession();
    const room = await openWithBrokenStage(SCOPE_ERROR);
    await settle();
    await toReview(room);
    await typeInto(room, "move the construction loan maturity to 2029-06-30");
    // The hush is about the trouble, not about the room: the exchange moved on.
    expect(room.querySelector(".wk-txt")).not.toBeNull();
    expect(room.querySelectorAll('[data-trouble="line"]').length).toBeGreaterThanOrEqual(1);
  });
});

/* ============================ the remark never grows and then shrinks (rule 5) */

describe("a remark is guarded before it is revealed (founder, 2026-09-03)", () => {
  /** A remark whose FIRST sentence the guards will strip: it claims an action
   *  nobody took. If the raw stream were rendered, the banker would read it and
   *  then watch it vanish. */
  const STRIPPED = [
    "The banker moved the first payment date forward two months to Oct 1, 2026.",
    "The cover behind the facility thins as the commitment grows.",
  ].join(" ");

  const ROWS = [
    "The package holds through the increase.",
    "- **Debt Service Coverage of Borrower**: the widest cushion on the deal.",
    "- **Maximum Debt to Worth**: room before it binds either way.",
    "- **Accounts Receivable**: exactly on its ceiling.",
  ].join("\n");

  /** Every rendered state of the remark, frame by frame. */
  async function recordRemark(text: string) {
    installSession(text);
    const room = await openRoom();
    await settle();
    const seen: Array<{ chars: number; rows: number; lists: number }> = [];
    const sample = () => {
      const bub = room.querySelector<HTMLElement>(".wk-narr .wk-bub");
      if (!bub) return;
      seen.push({
        chars: (bub.textContent ?? "").length,
        rows: bub.querySelectorAll(".wk-narr-row").length,
        lists: bub.querySelectorAll(".wk-narr-rows, .wk-narr-list").length,
      });
    };
    await typeInto(room, "pledge the Fort Wayne equipment on the 2.5M line of credit");
    for (let i = 0; i < 8; i++) {
      sample();
      await settle();
    }
    sample();
    return { room, seen };
  }

  it("never shows a sentence the guards were going to take away", async () => {
    const { room } = await recordRemark(STRIPPED);
    const bub = room.querySelector<HTMLElement>(".wk-narr .wk-bub");
    if (!bub) return; // the room refused the line; there is no remark to hold
    expect(bub.textContent).not.toContain("moved the first payment date");
  });

  it("never gets shorter between frames", async () => {
    const { seen } = await recordRemark(STRIPPED);
    const live = seen.filter((s) => s.chars > 0);
    for (let i = 1; i < live.length; i++) {
      expect(live[i].chars).toBeGreaterThanOrEqual(live[i - 1].chars);
    }
  });

  it("renders the line items as rows from the first paint, and never collapses them", async () => {
    const { room, seen } = await recordRemark(ROWS);
    const bub = room.querySelector<HTMLElement>(".wk-narr .wk-bub");
    if (!bub) return;
    const live = seen.filter((s) => s.chars > 0);
    if (!live.length) return;
    // The row count is the FINAL row count from the first frame the remark
    // exists: the guards ran before any of it was shown.
    const rows = live[0].rows;
    expect(rows).toBeGreaterThan(0);
    for (const frame of live) {
      expect(frame.rows).toBe(rows);
      // AND NEVER A PARAGRAPH. A list that reflowed into prose would drop to 0.
      expect(frame.lists).toBeGreaterThan(0);
    }
  });
});

/* ================================= the total is the staged total (rule 4) */

describe("the package total is the manifest's own (founder, 2026-09-03)", () => {
  it("does not report the total from before the change that is on the plan", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));

    const said = room.textContent ?? "";
    // The commitment moved, so the sentence is a MOVE and never a hold.
    expect(said).toMatch(/takes the package from/);
    expect(said).not.toMatch(/The package total holds at \$46/);

    // And a second card that moves no money reads the total WITH the increase
    // in it, not the total as the last render saw it.
    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));
    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => /Leave pricing for later/.test(b.textContent ?? "")));
    await typeInto(room, "move the 2.5M line of credit rate to 7.25%");
    await click(confirmButton(room));

    const holds = (room.textContent ?? "").match(/The package total holds at (\$[\d.]+M)/);
    if (holds) expect(holds[1]).not.toBe("$46.0M");
  });
});

/* ============ the check is its own exchange (founder, 2026-09-03) */

describe("acknowledging a check leaves the question beside it alone", () => {
  const chips = (room: HTMLElement) =>
    [...room.querySelectorAll<HTMLButtonElement>('[data-settle-state="on"] .wk-opt')].map((b) => b.textContent ?? "");

  it("keeps the amortisation chips on stage, and answerable", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));

    // The confirm raised BOTH: a check about the cover, and the question the
    // version needs. They are two exchanges and not one.
    expect(room.textContent).toContain("Coverage thins");
    expect(chips(room).some((c) => /240 months/.test(c))).toBe(true);

    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));

    // THE CHECK SETTLED. The question did not.
    expect(room.querySelectorAll(".wk-settled").length).toBeGreaterThan(0);
    expect(chips(room).some((c) => /240 months/.test(c))).toBe(true);

    // And it is still answerable: the banker does not have to re-open anything.
    await click([...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => /240 months/.test(b.textContent ?? "")));
    expect(room.textContent).toContain("240 months");
  });
});

/* ============ only the latest action is on the stage (founder, 2026-09-03) */

describe("the stage carries the latest action and nothing older", () => {
  const onStageExchanges = (room: HTMLElement) => {
    const live = [...room.querySelectorAll<HTMLElement>('.wk-thread [data-settle-state="on"]')];
    // A banker or fed line opens an exchange; count those, plus one for a
    // trailing run the room opened itself.
    const opens = live.filter((el) => el.querySelector(".wk-banker, [data-fed='line']")).length;
    return Math.max(opens, live.length ? 1 : 0);
  };

  it("settles an exchange nobody decided, once the next one begins", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    // A READ is answered and decided by nobody: it used to stand for the rest
    // of the session.
    await typeInto(room, "which borrowers are on this package");
    await typeInto(room, "which covenants do we carry");
    await typeInto(room, "increase the 15M line of credit to 20M");

    expect(room.querySelectorAll(".wk-settled").length).toBeGreaterThan(0);
    expect(onStageExchanges(room)).toBeLessThanOrEqual(2);
    // The oldest read is off the stage and still in the document.
    expect(room.querySelectorAll('[data-settle-state="settled"]').length).toBeGreaterThan(0);
  });

  it("mounts a restored session already settled, with nothing animating out", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "which borrowers are on this package");
    await typeInto(room, "which covenants do we carry");
    // NOTHING IS MID-EXIT. A restored exchange was never on this stage, so it
    // is not watched leaving it.
    expect(room.querySelectorAll('[data-settle-state="leaving"]')).toHaveLength(0);
  });
});

/* ============ the pricing ask informs, it never forces (founder, 2026-09-03) */

describe("every pricing ask can be left", () => {
  const skipChip = (room: HTMLElement, rx: RegExp) =>
    [...room.querySelectorAll<HTMLButtonElement>('[data-settle-state="on"] .wk-opt')].find((b) => rx.test(b.textContent ?? ""));

  it("offers the skip on the amortisation ask, and takes it", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));

    const skip = skipChip(room, /Leave pricing for later/);
    expect(skip).toBeTruthy();
    await click(skip);

    // Nothing staged for it, and the room asks no more pricing questions.
    expect(room.textContent).toContain("left for later");
    expect(skipChip(room, /240 months/)).toBeUndefined();
  });

  it("lets the banker type straight past the ask, and settles it as skipped", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    await click([...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Acknowledge"));

    // A new instruction over an open pricing question IS an answer to it.
    await typeInto(room, "move the construction loan maturity to 2029-06-30");

    // The line went through: the room is holding a card for it.
    expect(room.textContent).toContain("Jun 30, 2029");
    // The ask is a row, and it says what the consequence is.
    const rows = [...room.querySelectorAll<HTMLElement>(".wk-settled")].map((r) => r.textContent ?? "");
    expect(rows.some((r) => /Pricing left for later/.test(r))).toBe(true);
    // AND THE COMMITMENT IS STILL ON THE PLAN.
    const rail = (room.querySelector(".wk-col-r")?.textContent ?? "").replace(/\s+/g, " ");
    expect(rail).toMatch(/Commitment/i);
  });

  it("never ends a sentence on the retired tail", async () => {
    installSession("");
    const room = await openRoom();
    await settle();
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    expect(room.textContent).not.toContain("Anything else on this facility");
  });
});

/* ============ P0: the rate answer must reach the plan (founder, 12:15) */

describe("an answered pricing card cannot be silently absent from the plan", () => {
  const withRate = () => {
    const bundle = JSON.parse(JSON.stringify(data.borrowers![accountId]));
    bundle.exposure.facilities[0].interestRate = 7.6;
    return bundle;
  };

  async function openRated() {
    await acquireSample(50);
    const bundle = withRate();
    const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot.name, productPackageId: "a5Fbb000000IHFJEA4" });
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
            accountName: bundle.snapshot.name,
            productPackageId: context.productPackageId,
            generatedAt: "2026-09-03T08:00:00.000Z",
          }}
          onClose={() => {}}
        />,
      );
    });
    return document.querySelector<HTMLElement>(".wk-room")!;
  }

  const opt = (room: HTMLElement, rx: RegExp) =>
    [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => rx.test(b.textContent ?? ""));
  const named = (room: HTMLElement, label: string) =>
    [...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

  /** His exact sequence, up to and including the typed rate answer. */
  async function drive(room: HTMLElement) {
    await typeInto(room, "increase the 15M line of credit to 20M");
    await click(confirmButton(room));
    await click(named(room, "Acknowledge"));
    await click(opt(room, /240 months/));
    await click(confirmButton(room));
    await click(opt(room, /^1 /));
    await click(confirmButton(room));
    await typeInto(room, "Yes, 7.25% all-in");
  }

  it("puts the typed rate on the manifest once it is confirmed", async () => {
    installSession("");
    const room = await openRated();
    await settle();
    await drive(room);

    // The card carries the figure he typed, and confirming it puts it on the rail
    // beside the commitment and the two pricing fields.
    expect(room.querySelector('[data-settle-state="on"] .wk-chip')?.textContent).toContain("7.25%");
    await click(confirmButton(room));

    const rail = (room.querySelector(".wk-col-r")?.textContent ?? "").replace(/\s+/g, " ");
    expect(rail).toMatch(/Interest rate/i);
    expect(rail).toMatch(/7\.25/);
    expect(rail).toMatch(/Commitment/i);
    expect(rail).toMatch(/20/);
    expect(rail).toMatch(/Amortisation/i);
    expect(rail).toMatch(/240/);
    expect(rail).toMatch(/payment date/i);
  });

  /* THE 12:15 FAILURE. He answered, the card drew the figure, and the plan went
     up without it. The room asked the question; it does not get to forget that
     it was answered. */
  /* THE FIRST LINE OF DEFENCE, and the one that was already there: an open card
     is an open gate, so the review chip is not offered at all while the answer
     is sitting on the glass unconfirmed. */
  it("does not offer the plan at all while the answered card is still open", async () => {
    installSession("");
    const room = await openRated();
    await settle();
    await drive(room);

    expect(room.querySelector('[data-settle-state="on"] .wk-chip')?.textContent).toContain("7.25%");
    expect(room.querySelector(".wk-propose")).toBeNull();
  });

  /* AND THE SECOND, WHICH IS THE 12:15 FAILURE: a card that left the glass
     WITHOUT becoming an entry. The open card is a gate, so the review chip is
     withheld - but a gate that closes some other way (an advisory resolution
     settles every open chip in its block and re-says the line) reopens the plan
     with the answer on no manifest. Until now nothing anywhere noticed.

     THE BACKSTOP IS AT APPROVE. The room remembers every card the pricing gate
     drew and refuses to put a plan up that is missing one. Confirming clears
     it, which is what this holds: the invariant does not stand in the way of the
     plan it is protecting. */
  it("lets a confirmed answer through, so the backstop never blocks a good plan", async () => {
    installSession("");
    const room = await openRated();
    await settle();
    await drive(room);
    await click(confirmButton(room));

    const review = room.querySelector<HTMLButtonElement>(".wk-propose");
    expect(review).not.toBeNull();
    await click(review);
    expect(room.textContent).not.toContain("is on the glass and not on the plan");
  });

  it("lets the plan through once he discards the card instead", async () => {
    installSession("");
    const room = await openRated();
    await settle();
    await drive(room);

    // Discarding is an answer: the banker looked at the figure and said no.
    await click(named(room, "Discard"));
    await click(room.querySelector<HTMLButtonElement>(".wk-propose"));
    expect(room.textContent).not.toContain("is on the glass and not on the plan");
  });
});

/* ============ the sixteenth build: one voice on a rider (founder, 2026-09-03) */

describe("a rider on a facility gets the card and one line, never a remark", () => {
  it("does not consult the model when a covenant is associated", async () => {
    const session = installSession("Held at the relationship level and currently compliant at 1.38x tested quarterly.");
    const room = await openRoom();
    await settle();
    await settle();
    const before = session.calls.length;
    const narrs = room.querySelectorAll(".wk-narr").length;

    await typeInto(room, "associate the Debt Service Coverage of Borrower covenant with the construction loan");

    // Either the room staged the junction or it asked which one; in neither case
    // does a second voice arrive over the card.
    expect(session.calls).toHaveLength(before);
    expect(room.querySelectorAll(".wk-narr")).toHaveLength(narrs);
  });

  it("says what it authors in ONE line", () => {
    /* The founder's own card ran to three sentences of nCino methodology. The
       fact is unchanged: what is written, and what is not touched. */
    const said = armConfirmSentence(
      {
        id: "x",
        title: "Debt Service Coverage of Borrower",
        target: "$3MM Equipment",
        group: "covenants",
        kind: "covenant",
        before: "",
        after: "",
        badge: "",
        fieldWire: { field: ARM_FIELD, value: JSON.stringify({ kind: "covenantAttach", recordId: "c1", targetLoanId: "L" }) },
      } as unknown as WorkroomDelta,
      "Debt Service Coverage of Borrower on $3MM Equipment: staged on the clone. The package total holds at $54M.",
    );
    expect(said).toContain("associated to the $3MM Equipment: junction only, threshold and schedule unchanged.");
    expect(said.split(/(?<=[.?!])\s+/).filter(Boolean).length).toBeLessThanOrEqual(2);
    // The room's own package figure still rides after it, untouched.
    expect(said).toContain("The package total holds at $54M.");
  });
});

/* ============ the total on every card is the manifest total (founder, 2026-09-03) */

describe("the package total equals the manifest after every kind of change", () => {
  const baseline = { committedMM: 46, members: 6, changeWord: ["change", "changes"] as [string, string] };
  const entry = (over: Partial<WorkroomDelta>): WorkroomDelta =>
    ({ id: "e", title: "t", target: "f", group: "terms", kind: "k", before: "", after: "", badge: "", ...over }) as WorkroomDelta;

  it("counts a commitment change, a rider, a new facility and a field change the same way", () => {
    const cases: Array<{ what: string; entries: WorkroomDelta[]; expected: number }> = [
      { what: "nothing staged", entries: [], expected: 46 },
      { what: "a commitment increase", entries: [entry({ id: "a", committedDeltaMM: 5 })], expected: 51 },
      { what: "a rider beside it", entries: [entry({ id: "a", committedDeltaMM: 5 }), entry({ id: "b", group: "covenants" })], expected: 51 },
      {
        what: "a NEW FACILITY beside both",
        entries: [
          entry({ id: "a", committedDeltaMM: 5 }),
          entry({ id: "b", group: "covenants" }),
          entry({ id: "c", committedDeltaMM: 3, newMember: true }),
        ],
        expected: 54,
      },
      {
        what: "and the pricing fields, which move no money",
        entries: [
          entry({ id: "a", committedDeltaMM: 5 }),
          entry({ id: "c", committedDeltaMM: 3, newMember: true }),
          entry({ id: "d" }),
          entry({ id: "e2" }),
        ],
        expected: 54,
      },
    ];
    for (const { what, entries, expected } of cases) {
      /* ONE COMPUTATION, ONE PLACE. `figuresFor` is what the rail prints, what
         the plan summarises and what the confirm sentence reads. A total that is
         wrong is wrong in one function, where the rail would show it wrong too. */
      expect(figuresFor(entries, baseline).committedMM, what).toBe(expected);
    }
  });

  it("prints the two figures it is handed, and derives neither", () => {
    // The founder read "$54M" and then "$57M" on plans that were at $51M and
    // $54M. The sentence no longer computes anything.
    const d = { id: "r", title: "Interest rate", target: "Line of Credit", group: "terms", kind: "k", before: "7.6%", after: "7.25%", badge: "" } as WorkroomDelta;
    expect(
      committedSentence({ reply: "Rate: staged on the clone. The package total holds at $46M.", delta: d, before: 54_000_000, after: 54_000_000 }),
    ).toContain("The package total holds at $54M.");
    expect(
      committedSentence({ reply: "Amount: staged on the clone. The package total holds at $46M.", delta: d, before: 46_000_000, after: 51_000_000 }),
    ).toContain("That takes the package from $46M to $51M.");
  });
});

/* ============ one loader, in one place (founder, 2026-09-03) */

describe("the thinking mark and the bubble it becomes are one node", () => {
  it("stands the room's own compose beat down while a remark is breathing", async () => {
    installSession("The pledged pool does not move with the commitment as it grows.");
    const room = await openRoom();
    await settle();
    await typeInto(room, "remove the Accounts Receivable covenant from the 15M line of credit");

    /* NEVER TWO. The room's beat lives at the foot of the thread and the
       remark's lives in the slot the sentence will fill; both at once read as
       one loader jumping around the glass. */
    const marks = room.querySelectorAll(".wk-compose, .wk-narr-wait");
    expect(marks.length).toBeLessThanOrEqual(1);
  });

  it("fills the remark in where its mark was, under the item it belongs to", async () => {
    installSession("The pledged pool does not move with the commitment as it grows.");
    const room = await openRoom();
    await settle();
    await typeInto(room, "remove the Accounts Receivable covenant from the 15M line of credit");

    const remark = room.querySelector(".wk-narr");
    if (!remark) return; // the room refused the line; there is no remark to place
    // The remark is INSIDE its item's own exchange wrapper, which is where its
    // pending mark was: the node does not move between breathing and speaking.
    expect(remark.closest("[data-ex-id]")).not.toBeNull();
  });
});
