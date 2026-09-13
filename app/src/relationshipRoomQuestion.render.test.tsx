// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelationshipRoom, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";

/* =============================================================================
   THE RELATIONSHIP ROOM RECORDED A QUESTION AS AN ANSWER (founder, 2026-09-13).

   Inside a collateral valuation, "show me the pledges on this loan" came back as
   a settled row reading "show me the pledges on this loan, recorded". The read
   question had been taken as the position answer, and U1's recap line is what
   put it on the glass: a receipt a banker had to expand to read is one thing, a
   one-line recap of the review saying it back as a decision is another.

   THE CAUSE. The room's read lane was card-or-nothing. `readTopic` recognised
   the line as a collateral read; `buildReadCard` returned null because the
   pledges sit on facilities outside the package the room is anchored on, and a
   null card fell past every guard to the step machine, where an open text or
   date step records whatever it is handed.

   THE BOOK BELOW IS THAT SHAPE, and nothing else about it is unusual: one
   pledged asset, on an active facility, in a different product package from the
   one the relationship is anchored on. The valuation route reads the asset (it
   is relationship-wide); the collateral card does not (it is package-scoped).
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
});

const ANCHORED = "a5Fbb000000IHFJEA4";
const OTHER = "a5Fbb000000ZZZZEA4";

function hartwell(): BorrowerBundle {
  return {
    snapshot: {
      accountId: "001X",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: ANCHORED,
      primaryRiskRating: "4",
      computedRiskRating: "5",
    },
    exposure: {
      totalCommitted: 10_000_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: OTHER,
          committed: 10_000_000,
          collateral: [
            {
              collateralId: "a35A",
              collateralName: "COL-000762",
              collateralDescription: "CNC machining line, Kokomo plant",
              collateralType: "Equipment",
              collateralValue: 8_000_000,
              currentLendableValue: 4_000_000,
            },
          ],
        },
      ],
    },
    covenants: { covenants: [] },
    requests: [],
    collateralValuations: [
      { collateralId: "a35A", valuationDate: "2024-03-14", type: "Appraisal", source: "Third Party Appraisal", value: 8_000_000 },
    ],
  } as unknown as BorrowerBundle;
}

function ctxFor(): RelContext {
  const bundle = hartwell();
  const data = {
    meta: { generatedAt: "2026-09-13", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({
    data,
    bundle,
    accountId: "001X",
    accountName: "Hartwell Precision Manufacturing LLC",
    catalog: null,
  });
}

const PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files the record.",
  steps: [],
  warnings: [],
  suggestions: [],
};
const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "Created and verified.",
  recordName: "REC-1",
  status: "In Progress",
  steps: [],
};
const deps: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
};

function open(route: RelRoute): HTMLElement {
  const router: RelRouter = {
    question: null,
    say: null,
    preselectCovenantId: null,
    neutral: () => ({ line: "", chips: [] }),
    onBind: () => {},
    onRestart: () => {},
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<RelationshipRoom ctx={ctxFor()} route={route} router={router} deps={deps} onClose={() => {}} />);
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

async function type(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

function chip(re: RegExp) {
  const b = [...document.body.querySelectorAll("button.wk-opt")].find((x) => re.test(x.textContent ?? ""));
  if (!b) throw new Error(`no chip matching ${re}`);
  act(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** Every agent bubble the room has spoken, sentence only. */
const said = () =>
  [...document.body.querySelectorAll(".wk-msg[data-who='Agent'] .wk-bub")].map((n) => {
    const copy = n.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".wk-opts, .rl-kicker").forEach((x) => x.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });

/** Every settled row and every recap line, as the banker reads them back. */
const settled = () =>
  [...document.body.querySelectorAll(".wk-settled")].map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim());

const QUESTION = "show me the pledges on this loan";

/** THE STEP THE FOUNDER WAS STANDING ON: "Name the appraiser or the exam, for
 *  the record." It is the valuation's one OPEN step, and an open step records
 *  whatever it is handed, which is why the question landed on the wire there and
 *  nowhere earlier. Every step before it is answered exactly as the room asks. */
async function toTheOpenStep(room: HTMLElement) {
  for (const line of ["9500000", "2026-09-01", "Book Value", "Appraisal", "Yes"]) {
    await type(room, line);
    await settle();
  }
}

describe("a read question is never recorded as a step's answer", () => {
  it("answers the pledges question, and files nothing, mid-valuation", async () => {
    const room = open("valuation");
    await settle();
    chip(/CNC machining line/);
    await settle();
    await toTheOpenStep(room);
    await type(room, QUESTION);
    await settle();

    // THE DEFECT: a settled row reading "show me the pledges on this loan,
    // recorded", and U1's recap line saying it back as one of the review's
    // decisions.
    for (const row of settled()) expect(row.toLowerCase()).not.toContain(QUESTION);
    // ANSWERED, and answered honestly: the pledge sits outside the package this
    // room is anchored on, so there is no card and the room says what is missing
    // rather than inventing one.
    const spoke = said();
    expect(spoke.some((t) => /collateral pledges reach this view/i.test(t))).toBe(true);
    // AND THE STEP IS STILL LIVE, restated under the answer.
    expect(spoke.at(-1)).toContain("Name the appraiser or the exam");
  });

  it("holds for every read topic, not just the one that was reported", async () => {
    const room = open("valuation");
    await settle();
    chip(/CNC machining line/);
    await settle();
    await toTheOpenStep(room);
    await type(room, "what covenants are on this relationship");
    await settle();

    // This book carries no covenant, so there is no card here either. The room
    // says what is missing; it does not file the question as the appraiser.
    for (const row of settled()) expect(row.toLowerCase()).not.toContain("what covenants");
    expect(said().some((t) => /No covenant tests reach this view/i.test(t))).toBe(true);
    expect(said().at(-1)).toContain("Name the appraiser or the exam");
  });

  it("never lets a bare question become the step's value either", async () => {
    const room = open("valuation");
    await settle();
    chip(/CNC machining line/);
    await settle();
    await toTheOpenStep(room);
    await type(room, "why did the plant valuation drop?");
    await settle();

    for (const row of settled()) expect(row.toLowerCase()).not.toContain("why did the plant");
    // With no desk on this view the room says so, and restates the question.
    expect(said().some((t) => /cannot take that question to the desk/i.test(t))).toBe(true);
    expect(said().at(-1)).toContain("Name the appraiser or the exam");
  });
});
