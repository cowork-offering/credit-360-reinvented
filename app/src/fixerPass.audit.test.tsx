// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { RelationshipRoom, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { addEntry, supersededBy } from "./workroom/manifest";
import { whyAsked } from "./workroom/explain";
import { catalogField } from "./workroom/fieldCatalog";
import { readNewFacility } from "./components/workroom/newFacilityArm";
import { UNREADABLE_CLARIFY, unreadableClarify } from "./channel/brainLane";
import { REACHES_THE_ORG } from "./components/workroom/Words";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import type { BorrowerBundle, C360Data, Facility } from "./data/contract";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";
import type { StagedOutput } from "./actions/stagedPlan";
import type { WorkroomContext, WorkroomDelta } from "./workroom/types";

/* =============================================================================
   THE FIXER PASS, PINNED (F1, 2026-09-12).

   The two audit agents (A1 on the cockpit chat, A2 on the workrooms) left eight
   items they could not close. Every case below was driven against the real
   engines, the real arms and the real rooms, reproduced the break FIRST, and is
   kept here so it cannot come back.

   The authority for the pinned decision that changed — a correction supersedes
   rather than stacks — is the founder's stress script
   (`knowledge/IMPROVEMENTS-AND-BUGS.md`, and `knowledge/MODIFICATION-TEST-SCRIPT.md`
   row 3.k: "set 7%, then 'actually 8%' — 🚩 keeps the first or stacks both").
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

const PACKAGE_ID = "a5Fbb000000IHFJEA4";
const LINE_ID = "a4Zbb0000027MaYEAU";
const EQUIPMENT_ID = "a4Zbb0000027MnREAU";

const line: Facility = {
  loanId: LINE_ID,
  name: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
  productType: "Line of Credit",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 15_000_000,
  outstanding: 9_200_000,
  available: 5_800_000,
  interestRate: 7.6,
  maturityDate: "2027-03-15",
  termMonths: 60,
  amortizedTermMonths: 240,
  firstPaymentDate: "2026-10-01",
};

const equipment: Facility = {
  loanId: EQUIPMENT_ID,
  name: "Hartwell Precision Manufacturing LLC - Equipment - $8,000,000.00",
  productType: "Equipment",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 8_000_000,
  outstanding: 5_900_000,
  interestRate: 6.4,
  maturityDate: "2029-06-30",
};

function bundleWith(over: Partial<BorrowerBundle> = {}): BorrowerBundle {
  return {
    snapshot: {
      accountId: "001bb00001I7FPNAA3",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE_ID,
      packageStage: "Complete",
      primaryRiskRating: "4",
    },
    exposure: {
      totalCommitted: 23_000_000,
      totalOutstanding: 15_100_000,
      totalUniqueCollateralLendableValue: 34_600_000,
      uniqueCollateralCount: 5,
      coverageRatio: 1.13,
      facilities: [line, equipment],
    },
    covenants: { covenants: [] },
    graph: { legalEntities: [], connections: [] },
    ...over,
  } as unknown as BorrowerBundle;
}

const data = {
  meta: {
    anchorAccountId: "001bb00001I7FPNAA3",
    generatedAt: "2026-08-27T08:00:00Z",
    user: "Fabian Goetzens",
    userId: "005bb00000ftouDAAQ",
  },
} as unknown as C360Data;

const modifyContext: WorkroomContext = {
  mode: "modify",
  door: "package",
  accountId: "001bb00001I7FPNAA3",
  accountName: "Hartwell Precision Manufacturing LLC",
  productPackageId: PACKAGE_ID,
  packageName: "Hartwell Precision Manufacturing LLC credit package",
  approver: "Fabian Goetzens",
};

type Said = { kind: string; reply: string; options?: Array<{ label: string; say: string }>; deltas?: WorkroomDelta[] };

function engineOn(bundle: BorrowerBundle = bundleWith(), stage = vi.fn().mockResolvedValue({ ok: true, result: {} })) {
  clearComposed();
  const deps = { available: () => true, newKey: () => "fixer-key", restate: undefined, stage, today: () => "2026-09-12" };
  return { engine: createModifyEngine({ context: modifyContext, data, bundle, deps }), stage };
}

const say = async (engine: { parseIntent: (t: string, c: WorkroomContext) => Promise<unknown> }, text: string): Promise<Said> =>
  (await engine.parseIntent(text, modifyContext)) as Said;

/* ===================================================== OPEN-1: the correction */

describe("OPEN-1 — a corrected figure supersedes the one it corrects", () => {
  /** Two rates on ONE line of credit, staged the way the room stages them: one
   *  engine, two sentences, two deltas with their own ids. */
  async function twoRates() {
    const { engine } = engineOn();
    await say(engine, "change the rate on the line of credit - $15,000,000.00");
    const first = (await say(engine, "7%")).deltas![0];
    const second = (await say(engine, "change the rate on the line of credit - $15,000,000.00 to 8%")).deltas![0];
    expect(first.id).not.toBe(second.id);
    return { first, second, engine };
  }

  it("holds ONE entry for one field on one facility, at the latest figure", async () => {
    const { first, second } = await twoRates();
    const rail = [first, second].reduce<WorkroomDelta[]>((r, d) => addEntry(r, d), []);
    expect(rail).toHaveLength(1);
    expect(rail[0].after).toBe("8%");
    expect(rail[0].wire).toMatchObject({ key: "requestedRate", value: 8, facilityId: LINE_ID });
  });

  it("names the entry it replaces, so the room can say which figure went", async () => {
    const { first, second, engine } = await twoRates();
    expect(supersededBy([first], second)?.after).toBe("7%");
    // THE SAME FIELD ON ANOTHER MEMBER IS NOT A CORRECTION: it still stacks.
    const other = (await say(engine, "change the rate on the equipment - $8,000,000.00 to 6%")).deltas![0];
    expect(supersededBy([first], other)).toBeNull();
    expect(addEntry(addEntry([], first), other)).toHaveLength(2);
  });

  it("keeps the replacement where the first one stood, so the rail does not reshuffle", async () => {
    const { engine } = engineOn();
    await say(engine, "change the rate on the line of credit - $15,000,000.00");
    const rate7 = (await say(engine, "7%")).deltas![0];
    const amount = (await say(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")).deltas![0];
    const rate8 = (await say(engine, "change the rate on the line of credit - $15,000,000.00 to 8%")).deltas![0];
    const rail = [rate7, amount, rate8].reduce<WorkroomDelta[]>((r, d) => addEntry(r, d), []);
    expect(rail.map((e) => e.after)).toEqual(["8%", "$20M"]);
  });

  it("sends the LATEST figure only, and stages a plan that used to be refused (A9)", async () => {
    const { engine, stage } = engineOn();
    await say(engine, "change the rate on the line of credit - $15,000,000.00");
    const rate7 = (await say(engine, "7%")).deltas![0];
    const rate8 = (await say(engine, "change the rate on the line of credit - $15,000,000.00 to 8%")).deltas![0];
    const rail = [rate7, rate8].reduce<WorkroomDelta[]>((r, d) => addEntry(r, d), []);
    await engine.stagePlan(rail, modifyContext);
    const payload = stage.mock.calls[0][0];
    expect(payload.requestedRate).toBe(8);
    expect(JSON.stringify(payload)).not.toContain("\"requestedRate\":7");
  });
});

/* ------------------------------------------- and the room says so on the glass */

function openRoom(bundle: BorrowerBundle = bundleWith(), brain?: (e: BrainEnvelope) => Promise<BrainReply>) {
  clearComposed();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={modifyContext}
        engine={createModifyEngine({ context: modifyContext, data, bundle })}
        reads={{ bundle, accountName: modifyContext.accountName, productPackageId: PACKAGE_ID }}
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

const buttons = () => [...document.body.querySelectorAll("button")];
const clickEl = (el: Element | undefined) => act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

async function confirmTheChip() {
  clickEl(buttons().find((b) => b.textContent === "Confirm"));
  await settle();
  await settle();
  await settle();
}

describe("OPEN-1 — the room says which figure the correction replaced", () => {
  it("lands one entry and names the earlier rate", async () => {
    const room = openRoom();
    await settle();
    await typeInto(room, "change the rate on the line of credit - $15,000,000.00 to 7%");
    await confirmTheChip();
    await typeInto(room, "change the rate on the line of credit - $15,000,000.00 to 8%");
    await confirmTheChip();

    expect(room.querySelectorAll(".wk-ent")).toHaveLength(1);
    expect(room.textContent).toContain("That replaces the earlier 7%.");
  });
});

/* ================================================ OPEN-2: the typed answer */

describe("OPEN-2 — a typed answer reaches the facility being composed", () => {
  const armCtx = (composing: string | undefined, line_: string, requested?: number) => ({
    line: line_,
    mode: "modify" as const,
    members: [],
    staged: 0,
    generatedAt: "2026-09-12T08:00:00Z",
    composing,
    requestedCommitment: requested,
  });

  const DRAFT = "add a new equipment loan";

  it("takes the commitment in each of the three shapes a banker types it", () => {
    for (const answer of ["$3MM", "3 million", "the commitment is $3MM"]) {
      const read = readNewFacility(armCtx(DRAFT, answer));
      expect(read, answer).not.toBeNull();
      expect(read!.kind, answer).toBe("ask");
      // The amount landed: the composition has moved on to the TERM question.
      expect(read!.kind === "ask" && read!.text, answer).toContain("$3MM equipment run for");
    }
  });

  it("never loses the draft: the product and the purpose survive the amount answer", () => {
    const draft = "add a new heloc loan for working capital";
    const read = readNewFacility(armCtx(draft, "$3MM"));
    expect(read?.kind).toBe("ask");
    const next = read!.kind === "ask" ? read!.draft : "";
    expect(next).toContain("heloc");
    expect(next).toContain("working capital");
    expect(next).toContain("$3MM");
    // And the question it asks next is the one that follows the amount.
    expect(read!.kind === "ask" && read!.text).toContain("$3MM heloc run for");
  });

  it("carries every typed answer forward, to the card", () => {
    let draft = DRAFT;
    /* EACH OF THESE IS TYPED, NOT CLICKED. "working capital" and "1 November
       2026" read onto nothing bare, so the arm folds them the way the ask's own
       chips phrase them; the commitment and the term read bare. */
    for (const answer of ["$3MM", "60 months", "working capital", "240 months", "1 November 2026"]) {
      const read = readNewFacility(armCtx(draft, answer));
      expect(read, answer).not.toBeNull();
      if (read!.kind !== "ask") break;
      draft = read!.draft;
    }
    expect(draft).toContain("$3MM");
    expect(draft).toContain("60 months");
    const card = readNewFacility(armCtx(draft, "1 November 2026"));
    expect(card!.kind).toBe("card");
    expect(card!.kind === "card" && card!.spec).toMatchObject({
      product: "Equipment",
      amount: 3_000_000,
      termMonths: 60,
      amortizedTermMonths: 240,
      firstPaymentDate: "2026-11-01",
    });
  });

  it("does not claim a line that answers nothing on the composition", () => {
    expect(readNewFacility(armCtx(DRAFT, "what is the coverage on the line of credit"))).toBeNull();
    expect(readNewFacility(armCtx(undefined, "$3MM"))).toBeNull();
  });

  it("offers the client's own ask at the amount question, and invents nothing without one", () => {
    const grounded = readNewFacility(armCtx(undefined, DRAFT, 3_000_000));
    expect(grounded!.kind === "ask" && grounded!.options).toEqual([
      { label: "The client asked for $3MM", say: "add a new equipment loan $3MM" },
    ]);
    const bare = readNewFacility(armCtx(undefined, DRAFT));
    expect(bare!.kind === "ask" && bare!.options).toBeUndefined();
  });
});

/* =============================================== OPEN-3: the two pricing asks */

describe("OPEN-3 — the term and first-payment asks lead with the current figure", () => {
  const field = (id: string) => catalogField(id)!;

  it("states the amortisation the book carries, and says so plainly where it carries none", () => {
    const on = whyAsked(field("loan.amortisedTerm"), { committed: 23_000_000, amortisedTermMonths: 240 });
    expect(on).toContain("240 months");
    const off = whyAsked(field("loan.amortisedTerm"), { committed: 23_000_000 });
    expect(off).toContain("the org holds none on this facility");
    expect(off).not.toMatch(/\d/);
  });

  it("states the first payment date the book carries, and invents none where it does not", () => {
    const on = whyAsked(field("loan.firstPaymentDate"), { committed: 23_000_000, firstPaymentDate: "2026-10-01" });
    expect(on).toContain("Oct 1, 2026");
    const off = whyAsked(field("loan.firstPaymentDate"), { committed: 23_000_000, firstPaymentDate: null });
    expect(off).toContain("the org holds none on this facility");
    expect(off).not.toMatch(/\d/);
  });

  it("gives each of the six filing terms its own reason, one sentence long", () => {
    const ctx = { committed: 23_000_000, amortisedTermMonths: 240, firstPaymentDate: "2026-10-01" };
    const ids = [
      "loan.amount",
      "loan.maturityDate",
      "loan.interestRate",
      "loan.termMonths",
      "loan.amortisedTerm",
      "loan.firstPaymentDate",
    ];
    const reasons = ids.map((id) => whyAsked(field(id), ctx));
    expect(new Set(reasons).size).toBe(6);
    for (const why of reasons) {
      expect(why.length).toBeGreaterThan(0);
      expect(why.split(/[.!?] /).length).toBeLessThanOrEqual(1);
      expect(why).not.toMatch(/LLC_BI__|junction|invocable/i);
    }
  });

  it("leads the ask with today's figure and offers the same keep-chip every term field gets", async () => {
    const { engine } = engineOn();
    const asked = await say(engine, "change the amortisation term on the line of credit - $15,000,000.00");
    expect(asked.reply).toContain("Today it reads 240 months.");
    expect(asked.reply).toContain("this facility runs on 240 months today");
    expect(asked.options?.[0]).toEqual({ label: "Keep 240 months", say: "keep it" });

    const payment = await say(engineOn().engine, "change the first payment date on the line of credit - $15,000,000.00");
    expect(payment.reply).toContain("Today it reads Oct 1, 2026.");
    expect(payment.options?.[0]).toEqual({ label: "Keep Oct 1, 2026", say: "keep it" });
  });

  it("says the org holds it blank rather than a figure, where the read carries none", async () => {
    const blind = bundleWith({
      exposure: {
        ...(bundleWith().exposure as object),
        facilities: [{ ...line, amortizedTermMonths: null, firstPaymentDate: null }, equipment],
      },
    } as Partial<BorrowerBundle>);
    const { engine } = engineOn(blind);
    const asked = await say(engine, "change the amortisation term on the line of credit - $15,000,000.00");
    expect(asked.reply).not.toContain("Today it reads");
    expect(asked.reply).toContain("the org holds none on this facility");
    expect(asked.options?.[0]).toEqual({ label: "Keep as booked", say: "keep it" });
  });
});

/* ============================================= OPEN-4: the desk in the rel room */

function relCtx(): RelContext {
  const bundle = {
    snapshot: {
      accountId: "001X",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE_ID,
      primaryRiskRating: "4",
    },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [{ loanId: "0Cb1", status: "Active", productPackageId: PACKAGE_ID, committed: 10_000_000, collateral: [] }],
    },
    covenants: {
      covenants: [
        {
          covenantId: "cov1",
          covenantType: "Debt Service Coverage",
          nextEvaluationDate: "2026-09-06",
          frequency: "Quarterly",
          actualValue: 1.08,
          thresholdValue: 1.25,
          lastEvaluationStatus: "Exception",
          latestComplianceId: "a3X1",
          latestComplianceStatus: "Pending",
        },
      ],
    },
  } as unknown as BorrowerBundle;
  return relContextFor({
    data: {
      meta: { generatedAt: "2026-09-12", userId: "005bb000001AAAAAAA" },
      portfolio: { accounts: [] },
      borrower: bundle,
      borrowers: { "001X": bundle },
    } as unknown as C360Data,
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
const relDeps: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: {} as ExecuteResult }) as ToolOutcome<ExecuteResult>,
};

function openRelRoom(brain?: (e: BrainEnvelope) => Promise<BrainReply>) {
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
    root!.render(
      <RelationshipRoom ctx={relCtx()} route="covenant" router={router} brain={brain} deps={relDeps} onClose={() => {}} />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

async function typeRel(room: HTMLElement, text: string) {
  const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  await settle();
  await settle();
}

/** Every agent bubble the room has spoken, sentence only. */
const said = () =>
  [...document.body.querySelectorAll(".wk-msg[data-who='Agent'] .wk-bub")].map((n) => {
    const copy = n.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".wk-opts, .rl-kicker").forEach((x) => x.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });

const chipEl = (re: RegExp) => [...document.body.querySelectorAll("button.wk-opt")].find((x) => re.test(x.textContent ?? ""));

describe("OPEN-4 — the desk's answers land in the room the banker is standing in", () => {
  const CLARIFY: BrainReply = { type: "clarify", text: "Which of the two tests do you mean?" };
  const COVENANT_PROPOSAL: BrainReply = {
    type: "delta-proposal",
    action: "loan-modification",
    rationale: "The Debt Service Coverage test is measured at 1.08x against a 1.25x threshold.",
    changes: {},
  } as unknown as BrainReply;

  async function intoTheReview(brain: (e: BrainEnvelope) => Promise<BrainReply>) {
    const room = openRelRoom(brain);
    await settle();
    clickEl(chipEl(/Debt Service Coverage/));
    await settle();
    return room;
  }

  it("restates the live question under a clarify, so the review has somewhere to go", async () => {
    const room = await intoTheReview(async () => CLARIFY);
    await typeRel(room, "is that the one the committee flagged?");
    expect(said()).toContain("Which of the two tests do you mean?");
    // The last thing on the glass is the room's own live question.
    expect(said().at(-1)).toContain("How does the Debt Service Coverage test assess?");
  });

  it("answers a covenant proposal with the covenant, not with the facility handoff", async () => {
    const room = await intoTheReview(async () => COVENANT_PROPOSAL);
    await typeRel(room, "the committee felt 1.08x understates the seasonal swing");
    expect(said().join(" ")).not.toContain("That is facility work.");
    expect(said().join(" ")).toContain("measured at 1.08x against a 1.25x threshold");
    expect(said().at(-1)).toContain("How does the Debt Service Coverage test assess?");
  });

  it("still hands facility work next door when the line actually asked for it", async () => {
    const desk = vi.fn(async () => COVENANT_PROPOSAL);
    const room = await intoTheReview(desk);
    await typeRel(room, "pledge the receivables to the new facility");
    expect(said().join(" ")).toContain("That is facility work.");
    /* AND THE ROOM SAYS IT WITHOUT ASKING THE DESK. The room's own test runs on
       the typed line first, which is why gating the desk's answer on the SAME
       test can only ever narrow what the handoff is said over. */
    expect(desk).not.toHaveBeenCalled();
  });
});

/* ================================================= A14: the rung-3 wait notice */

describe("A14 — a call that reaches the org says so beside the thinking mark", () => {
  function heldBrain() {
    let release: ((r: BrainReply) => void) | null = null;
    const brain = () =>
      new Promise<BrainReply>((resolve) => {
        release = resolve;
      });
    return { brain, let: () => release?.({ type: "clarify", text: "Done." }) };
  }

  it("names the two-minute wait in the relationship room, and only on a rung-3 line", async () => {
    const held = heldBrain();
    const room = openRelRoom(held.brain);
    await settle();
    clickEl(chipEl(/Debt Service Coverage/));
    await settle();

    await typeRel(room, "how is the current EBITDA trending?");
    const mark = room.querySelector(".wk-compose");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toContain(REACHES_THE_ORG);
    act(() => held.let());
    await settle();
    await settle();
    expect(room.querySelector(".wk-compose")).toBeNull();

    const quick = heldBrain();
    act(() => root?.unmount());
    container?.remove();
    const second = openRelRoom(quick.brain);
    await settle();
    clickEl(chipEl(/Debt Service Coverage/));
    await settle();
    await typeRel(second, "what did the committee settle on?");
    expect(second.querySelector(".wk-compose")!.textContent).not.toContain(REACHES_THE_ORG);
    act(() => quick.let());
    await settle();
  });

  it("names it in the facility room too", async () => {
    const held = heldBrain();
    const room = openRoom(bundleWith(), held.brain);
    await settle();
    const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "how is the current EBITDA trending?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => room.querySelector(".wk-send")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    expect(room.querySelector(".wk-compose")!.textContent).toContain(REACHES_THE_ORG);
    act(() => held.let());
    await settle();
    await settle();
  });
});

/* ========================================== A15: connector copy off the banker */

describe("A15 — a failed read says what the surface is showing, not how to wire a connector", () => {
  const OPERATOR_WORDS = /gateway|connectors|claude\.ai/i;
  const band = readFileText("src/components/KpiBand.tsx");
  const actions = readFileText("src/components/ActionsPanel.tsx");

  it("renders neither the connector instruction nor the words it is written in", () => {
    // The operator sentence reaches these two files only through
    // `McpFailure.fix`, so not reading it is what keeps the words off the glass.
    expect(band).not.toContain("live.failure.fix");
    expect(actions).not.toContain("failure.failure.fix");
    for (const rendered of [rendersOf(band), rendersOf(actions)]) {
      expect(rendered).not.toMatch(OPERATOR_WORDS);
    }
  });

  it("says what the tiles and the rows are standing on instead", () => {
    expect(band).toContain("This tile shows the last good read.");
    expect(actions).toContain("These actions stage from the last good read.");
  });

  it("leaves the connector's own fix copy written where it was, and the operator surface standing", () => {
    // `fixCopy` is NOT edited by this pass: it is the right sentence for
    // whoever wired the connector, and the chat panel still composes from it.
    expect(readFileText("src/channel/mcp.ts")).toContain("claude.ai Settings");
    // And the operator's surface still names the connectors and their grants.
    expect(readFileText("src/components/HealthLine.tsx")).toContain("Connectors");
  });
});

/* ============================================ VOCABULARY: the room's own words */

describe("the unreadable degrade speaks the asking room's vocabulary", () => {
  it("keeps the facility room's move, which is what A1 pinned", () => {
    expect(unreadableClarify("facility")).toEqual(UNREADABLE_CLARIFY);
    expect(UNREADABLE_CLARIFY.text).toMatch(/say the change you want/i);
  });

  it("does not offer the relationship room a change it cannot put up", () => {
    const rel = unreadableClarify("relationship");
    expect(rel.degraded).toBe(true);
    expect(rel.text).not.toMatch(/put it up|the change you want/i);
    expect(rel.text).toMatch(/review/i);
    expect(rel.text).not.toMatch(/gateway|connector|settings|reconnect|install/i);
  });
});

/* --------------------------------------------------------------------------- */

function readFileText(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

/** Everything a module actually PUTS ON THE GLASS: its string literals and its
 *  JSX, with the comments taken out. A comment that quotes the sentence being
 *  removed is documentation, not copy. */
function rendersOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
