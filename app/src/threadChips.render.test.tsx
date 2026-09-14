// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { RelationshipRoom, neutralRelAsk, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelFlowDeps } from "./components/relationship/reviewFlows";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import type { StagedOutput } from "./actions/stagedPlan";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE CHIPS GO WITH THE TURN (founder, 2026-09-14, backlog row 54).

   "i dont want all the chips for any action rather the show earlier which shows
   the history but not the full history of those chips of the actions in the
   chat".

   0.9.22 condensed an answered turn to one settled line, and the chips stayed:
   they hang off the bubble that asked, and nothing ever took them off it. So the
   term question the banker settled four turns ago still offered "240 months",
   "300 months", "Another figure" and "Leave pricing for later", and opening the
   earlier steps brought every chip row in the session back at once.

   WHAT IS ASSERTED IS THE GLASS. A spent turn carries no `.wk-opt` and does
   carry its recap line; the live turn carries its chips exactly as it always
   did; and the way back into the history is still there, now showing the history
   rather than replaying the offers.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const NAME = "Hartwell Precision Manufacturing LLC";
const NON_RE_PACKAGE = "a5Fbb000000IHFJEA4";
/** The artifact's own instant, so every month the room offers is deterministic. */
const GENERATED_AT = "2026-07-25T21:04:49Z";

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

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const click = async (el: Element | undefined) => {
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  for (let i = 0; i < 8; i += 1) await settle();
};

/** Every option chip on the glass, wherever it stands. */
const chips = (room: HTMLElement) =>
  [...room.querySelectorAll(".wk-opt")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());

/** The step the banker is in: the one the room has not collapsed behind it. */
const liveStep = (room: HTMLElement) =>
  [...room.querySelectorAll<HTMLElement>(".wk-step")].filter((s) => !s.classList.contains("wk-gone")).at(-1)!;

/* -------------------------------------------------------- the facility room */

function openFacility(): HTMLElement {
  const bundle = data.borrowers![HARTWELL];
  const context = workroomContextFor({
    mode: "modify",
    data,
    bundle,
    accountId: HARTWELL,
    accountName: bundle.snapshot!.name!,
    productPackageId: NON_RE_PACKAGE,
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

/** The founder's own four moves: raise the line, answer the term, answer the
 *  first payment date, hold the rate. */
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

describe("the facility room keeps the live chips and drops the spent ones", () => {
  it("takes the answered question's chips off the glass and leaves its recap", async () => {
    const room = openFacility();
    await settle();
    await theTranscript(room);

    // THE TERM WAS ANSWERED, SO ITS OFFERS ARE GONE. Not one of the four the
    // room put up when it asked is still pressable anywhere in the thread.
    const said = chips(room);
    for (const spent of ["240 months", "300 months", "Another figure", "Leave pricing for later"]) {
      expect(said).not.toContain(spent);
    }
    // AND THE TURN IS STILL THERE, as the line a banker would say back.
    const recaps = [...room.querySelectorAll("[data-recap]")].map((n) => (n.textContent ?? "").trim());
    expect(recaps.some((line) => line.includes("Amortisation term") && line.includes("240 months"))).toBe(true);

    // NO CHIP OUTSIDE THE LIVE STEP. Whatever is still offered belongs to the
    // turn the banker is in.
    const live = liveStep(room);
    for (const chip of room.querySelectorAll(".wk-opt")) expect(live.contains(chip)).toBe(true);
    // And no recapped turn is hiding a chip under its line.
    for (const line of room.querySelectorAll("[data-recap-line]")) {
      expect(line.querySelector(".wk-opt")).toBeNull();
    }
  });

  it("shows the history on earlier steps without replaying their chips", async () => {
    const room = openFacility();
    await settle();
    await theTranscript(room);

    const earlier = [...document.body.querySelectorAll<HTMLButtonElement>(".wk-hist")].at(-1);
    expect(earlier).toBeTruthy();
    const before = chips(room).length;
    await click(earlier);

    // THE CONTROL IS STILL THE WAY BACK, and what it opens is the history: every
    // earlier step is on the glass with what was said in it.
    expect(room.querySelectorAll(".wk-step.wk-gone")).toHaveLength(0);
    expect(room.textContent).toContain("What is the amortisation term");
    // It brings back no chip that was not already on the glass.
    expect(chips(room).length).toBe(before);
    expect(chips(room)).not.toContain("240 months");
  });
});

/* ---------------------------------------------------- the relationship room */

const PLAN = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Assesses one covenant on the relationship.",
  steps: [],
  warnings: [],
  suggestions: [],
  accountId: HARTWELL,
  covenants: [],
} as unknown as StagedOutput;

const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "The assessment was written and verified.",
  recordName: "COMP-0489",
  steps: [],
};

function openCovenantReview(): HTMLElement {
  const deps: RelFlowDeps = {
    available: () => true,
    newKey: () => "key-1",
    stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
    execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
  };
  const router: RelRouter = {
    question: null,
    say: null,
    neutral: () => neutralRelAsk(),
    onBind: () => {},
    onRestart: () => {},
  };
  const bundle = data.borrowers![HARTWELL] as BorrowerBundle;
  const ctx = relContextFor({ data, bundle, accountId: HARTWELL, accountName: NAME });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={ctx}
        route="covenant"
        router={router}
        deps={deps}
        onFiled={() => {}}
        onClose={() => {}}
      />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

describe("the relationship room keeps the live chips and drops the spent ones", () => {
  it("leaves the answered step a recap line and no option rows", async () => {
    const room = openCovenantReview();
    await settle();

    // The first question, answered: one covenant off the relationship's own six.
    const first = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) =>
      (b.textContent ?? "").startsWith("Accounts Receivable"),
    );
    expect(first).toBeTruthy();
    await click(first);
    const next = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].at(0);
    if (next) await click(next);

    // NOTHING THE ROOM ALREADY HAS AN ANSWER FOR IS STILL OFFERED.
    for (const chip of room.querySelectorAll(".wk-opt")) {
      expect(liveStep(room).contains(chip)).toBe(true);
    }
    for (const line of room.querySelectorAll("[data-recap-line]")) {
      expect(line.querySelector(".wk-opt")).toBeNull();
    }
    // And the answered turn still says what was chosen.
    expect(room.querySelectorAll("[data-recap]").length).toBeGreaterThan(0);
  });

  it("shows the history on earlier steps without replaying their chips", async () => {
    const room = openCovenantReview();
    await settle();
    // Two steps answered, so there is a step behind the live one to open.
    for (let step = 0; step < 2; step += 1) {
      const chip = [...room.querySelectorAll<HTMLButtonElement>(".wk-opt")].find((b) => !b.disabled);
      if (chip) await click(chip);
    }
    const earlier = [...document.body.querySelectorAll<HTMLButtonElement>(".wk-hist")].at(-1);
    expect(earlier).toBeTruthy();
    const before = chips(room).length;
    await click(earlier);

    expect(room.querySelectorAll(".wk-step.wk-gone")).toHaveLength(0);
    expect(chips(room).length).toBe(before);
  });
});
