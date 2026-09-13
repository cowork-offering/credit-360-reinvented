// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  RelationshipRoom,
  neutralRelAsk,
  smartRelAsk,
  type RelRouter,
  type RelRouterQuestion,
} from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelOpening, RelRoute } from "./components/relationship/relRoute";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome, WriteActionId } from "./channel/writeTools";

/* =============================================================================
   THE RELATIONSHIP ROOM, AS A RITUAL.

   What is proved here is the ROOM: the smart opening and its neutral fallback,
   that a chip and a typed line bind the same way, that the guided steps collect
   what the flow demands, that the plan carries the ORG's token to a dossier,
   and that the two things this room refuses are refused out loud.

   The flows behind it are tested in components/relationship/reviewFlows.test.ts;
   the router in relRoute.test.ts. Here the deps are injected, so not one test
   below reaches a connector.
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

const PACKAGE = "a5Fbb000000IHFJEA4";

function ctxFor(overrides: Partial<BorrowerBundle> = {}): RelContext {
  const bundle = {
    snapshot: {
      accountId: "001X",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE,
      primaryRiskRating: "4",
      computedRiskRating: "5",
    },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: PACKAGE,
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
    ...overrides,
  } as unknown as BorrowerBundle;
  const data = {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({ data, bundle, accountId: "001X", accountName: "Hartwell Precision Manufacturing LLC" });
}

const PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files an annual credit review at In Progress.",
  steps: [],
  warnings: ["Entities added to the borrowing structure after the review is created get no snapshot row."],
  suggestions: [],
};

const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "The review was created and verified.",
  recordName: "REV-0000000012",
  status: "In Progress",
  steps: [],
};

function depsFor(over: Partial<RelFlowDeps> = {}): RelFlowDeps {
  return {
    available: () => true,
    newKey: () => "key-1",
    stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
    execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
    ...over,
  };
}

interface Opened {
  room: HTMLElement;
  bound: Array<{ route: RelRoute; opts?: { say?: string; covenantId?: string | null } }>;
  restarted: Array<{ route: RelRoute; say: string }>;
}

function open(args: {
  route?: RelRoute | null;
  question?: RelRouterQuestion | null;
  say?: string | null;
  covenantId?: string | null;
  deps?: RelFlowDeps;
  /** A read this case needs a different shape of. */
  bundle?: Partial<BorrowerBundle>;
  onFiled?: (filed: { actionId: WriteActionId; result: ExecuteResult }) => void;
} = {}): Opened {
  const bound: Opened["bound"] = [];
  const restarted: Opened["restarted"] = [];
  const router: RelRouter = {
    question: args.question ?? null,
    say: args.say ?? null,
    preselectCovenantId: args.covenantId ?? null,
    neutral: () => neutralRelAsk(),
    onBind: (route, opts) => bound.push({ route, opts }),
    onRestart: (route, say) => restarted.push({ route, say }),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={ctxFor(args.bundle)}
        route={args.route ?? null}
        router={router}
        deps={args.deps ?? depsFor()}
        onFiled={args.onFiled}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound, restarted };
}

const buttons = () => [...document.body.querySelectorAll("button")];
/* THE RECAP LINES ARE NOT ANSWERS (founder, 2026-09-13: "only the current
   action is nicely shown in the chat"). Each collapsed step now says what it
   recorded, in one quiet line, so a by-text hunt for a chip would find the line
   ABOVE the chip that carries the same word. The line is a way back into the
   history, never an answer, and this harness reaches for answers. */
const byText = (re: RegExp) =>
  buttons()
    .filter((b) => !b.hasAttribute("data-recap"))
    .find((b) => re.test(b.textContent ?? ""));
const click = (el: Element | undefined) => act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
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

/** The live question the room is asking: the sentence alone, without its step
 *  counter and without the option pills that answer it. */
const liveAsk = () => {
  const bubbles = [...document.body.querySelectorAll(".wk-step:not(.wk-gone) .wk-agent .wk-bub")];
  const last = bubbles[bubbles.length - 1];
  if (!last) return "";
  const copy = last.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".rl-kicker, .wk-opts").forEach((n) => n.remove());
  return (copy.textContent ?? "").trim();
};

const openingOpening: RelOpening = {
  line: "The Debt Service Coverage test is due in 6 days. Run the covenant review?",
  route: "covenant",
  yesLabel: "Open the covenant review",
  covenantId: "cov1",
};

/* --------------------------------------------------------------- the shell */

describe("the room is the workroom's sheet", () => {
  it("opens as one glass canvas, cut from the same recipe, with no second blurred surface", () => {
    const { room } = open({ question: neutralRelAsk() });
    expect(room.classList.contains("eg-glass")).toBe(true);
    expect(room.classList.contains("eg-glass-workroom")).toBe(true);
    expect(room.getAttribute("data-room")).toBe("relationship");
    // Every other surface the room paints is CONTENT and therefore solid. Only
    // the room itself carries a glass class, which is what keeps the census flat.
    expect(document.body.querySelectorAll("[class*='eg-glass']")).toHaveLength(1);
  });

  it("carries ONE word in the slim bar, and no review's name until one is bound", () => {
    const { room } = open({ question: neutralRelAsk() });
    expect(room.querySelector(".wk-title")!.textContent).toBe("Relationship Actions");
    expect(room.querySelectorAll(".wk-stepper .wk-stg")).toHaveLength(4);
  });

  it("names the bound review in the bar instead", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    expect(room.querySelector(".wk-title")!.textContent).toBe("Covenant Review");
  });

  it("declares exactly one scroller, the thread, and never shows its bar", () => {
    open({ question: neutralRelAsk() });
    expect(document.body.querySelectorAll(".wk-thread")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------ smart opening */

describe("the smart opening", () => {
  it("leads on the signal and offers the yes plus the way out of it", () => {
    open({ question: smartRelAsk(openingOpening) });
    expect(document.body.textContent).toContain("The Debt Service Coverage test is due in 6 days.");
    expect(byText(/Open the covenant review/)).toBeTruthy();
    expect(byText(/Something else/)).toBeTruthy();
  });

  it("binds the route AND the covenant the signal named, on the yes", () => {
    const { bound } = open({ question: smartRelAsk(openingOpening) });
    click(byText(/Open the covenant review/));
    expect(bound).toEqual([{ route: "covenant", opts: { covenantId: "cov1" } }]);
  });

  it("falls through to the neutral five-way on 'Something else', binding nothing", () => {
    const { bound } = open({ question: smartRelAsk(openingOpening) });
    click(byText(/Something else/));
    expect(bound).toEqual([]);
    expect(document.body.textContent).toContain("Which review are we running on this relationship?");
    for (const label of [
      "Annual review",
      "Covenant review",
      "Collateral valuation",
      "Risk-rating review",
      "Service request",
      "Add a covenant or an asset",
    ]) {
      expect(byText(new RegExp(label))).toBeTruthy();
    }
  });
});

describe("the neutral six-way", () => {
  it("offers all six and binds the one the banker taps", () => {
    const { bound } = open({ question: neutralRelAsk() });
    expect(document.body.querySelectorAll(".wk-opts .wk-opt")).toHaveLength(6);
    click(byText(/Collateral valuation/));
    expect(bound[0].route).toBe("valuation");
  });

  it("binds from a typed line instead, and the question retires unanswered", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "let's run the risk rating review");
    expect(bound[0]).toMatchObject({ route: "rating", opts: { say: "let's run the risk rating review" } });
  });

  it("repeats the question rather than guessing, when the line names no review", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "how is this client doing");
    expect(bound).toEqual([]);
    expect(document.body.textContent).toContain("Pick one above, or name which of the six this is.");
  });

  /* THE DRIVE'S LINE 13. "james wants the june certificate" names no review at
     all, so before this it fell to the five-way, which reads the annual review,
     the covenant review, a valuation and the rating back at a banker plainly
     running none of them. */
  /* THE DRIVE'S LINE 15. The handoff lived only past `if (!route) return`, so a
     pledge typed at the five-way was answered with a list of four reviews the
     banker had just asked for none of. */
  it("hands facility work back in ONE line, before a route is bound", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "pledge the equipment to the 8M loan");
    expect(bound).toEqual([]);
    expect(document.body.textContent).toContain("That is facility work.");
    expect(document.body.textContent).not.toContain("Pick one above, or name which of the six this is.");
  });

  it("offers the service request in ONE line when the client asked for something", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "james wants the june certificate");
    // It does NOT bind. Guessing here picks a write path.
    expect(bound).toEqual([]);
    expect(document.body.textContent).not.toContain("Pick one above, or name which of the six this is.");
    expect(document.body.textContent).toContain("which is a service request on this relationship");
    // One offer, and the way out of it. Never the five.
    expect(document.body.querySelectorAll(".wk-opts .wk-opt")).toHaveLength(2);
    expect(byText(/Raise a service request/)).toBeTruthy();
    expect(byText(/Something else/)).toBeTruthy();
  });

  it("binds the service route WITH the banker's own line, so it becomes the subject", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "james wants the june certificate");
    click(byText(/Raise a service request/));
    expect(bound).toEqual([
      { route: "service", opts: { covenantId: null, say: "james wants the june certificate" } },
    ]);
  });

  it("still offers all six on 'Something else', binding nothing", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "james wants the june certificate");
    click(byText(/Something else/));
    expect(bound).toEqual([]);
    expect(document.body.querySelectorAll(".wk-opts .wk-opt")).toHaveLength(6);
  });

  /* A FIELD EXAM IS NOT ONE OF THE FIVE. No route word matches "field exam",
     "collateral audit" or "inventory count", so every one of them fell to the
     five-way: a list of reviews read back at a banker who asked for a person to
     go and count the inventory. One sentence and the two chips that apply. */
  const EXAM_ASKS = [
    "can we get a field exam scheduled on the borrowing base",
    "field audit",
    "collateral audit",
    "AR audit",
    "inventory count",
  ];

  for (const ask of EXAM_ASKS) {
    it(`answers "${ask}" with the honesty line and never the menu`, async () => {
      const { room, bound } = open({ question: neutralRelAsk() });
      await type(room, ask);
      // It does NOT bind. The chips do, and only on a tap.
      expect(bound).toEqual([]);
      expect(document.body.textContent).toContain("A field exam is not something this room files.");
      expect(document.body.textContent).not.toContain("Pick one above, or name which of the five this is.");
      expect(document.body.querySelectorAll(".wk-opts .wk-opt")).toHaveLength(2);
      expect(byText(/Service request: field exam/)).toBeTruthy();
      expect(byText(/^Covenant review$/)).toBeTruthy();
    });
  }

  it("binds the service route WITH the banker's own line, so the exam ask is the subject", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "can we get a field exam scheduled on the borrowing base");
    click(byText(/Service request: field exam/));
    expect(bound).toEqual([
      { route: "service", opts: { covenantId: null, say: "can we get a field exam scheduled on the borrowing base" } },
    ]);
  });

  it("binds the covenant review on the other chip, on the borrowing base the exam would feed", async () => {
    const { room, bound } = open({ question: neutralRelAsk() });
    await type(room, "field audit");
    click(byText(/^Covenant review$/));
    expect(bound).toEqual([{ route: "covenant", opts: { covenantId: null, say: undefined } }]);
  });

  it("keeps that chip VISIBLE and disabled where no covenant carries a compliance row", async () => {
    const { room, bound } = open({
      question: neutralRelAsk(),
      // The same covenant, with neither compliance signal. A covenant review
      // on this relationship could only end in a refusal, and the chip says so.
      bundle: { covenants: { covenants: [{ covenantId: "cov1", covenantType: "Debt Service Coverage" }] } } as never,
    });
    await type(room, "collateral audit");
    const chip = byText(/^Covenant review/)!;
    expect(chip.hasAttribute("disabled")).toBe(true);
    expect(chip.textContent).toContain("carries an open test period, so there is nothing to assess");
    click(chip);
    expect(bound).toEqual([]);
  });

  it("leaves the five routes exactly where they were", async () => {
    for (const [line, route] of [
      ["collateral valuation", "valuation"],
      ["run the covenant review", "covenant"],
      ["annual review", "annual"],
      ["risk rating", "rating"],
      ["raise a service request", "service"],
    ] as const) {
      const { room, bound } = open({ question: neutralRelAsk() });
      await type(room, line);
      expect(bound, line).toEqual([{ route, opts: { say: line } }]);
      expect(document.body.textContent, line).not.toContain("A field exam is not something this room files.");
      act(() => root?.unmount());
      container?.remove();
    }
  });

  it("keeps an unavailable route VISIBLE and disabled, with the registry's own reason", () => {
    const empty = { borrowers: { "001X": {} }, borrower: {}, portfolio: { accounts: [] }, meta: {} } as unknown as C360Data;
    const question = neutralRelAsk({ data: empty, accountId: "001X" });
    const covenantChip = question.chips.find((c) => c.route === "covenant")!;
    expect(covenantChip.disabled).toBe(true);
    expect(covenantChip.reason).toBe("No covenants recorded for this relationship");
  });
});

/* ------------------------------------------------------------- the register */

describe("the governance brief", () => {
  it("states what the review covers and what it produces, before the first question", async () => {
    open({ route: "annual" });
    await settle();
    const brief = document.body.querySelector(".rl-brief")!;
    expect(brief.textContent).toContain("Covers");
    expect(brief.textContent).toContain("Produces");
    expect(brief.textContent).toContain("exposure, performance against the package");
    expect(brief.textContent).toContain("credit review record at In Progress");
  });

  it("is a card, not a bubble: the scope is what the review IS, not something said", async () => {
    open({ route: "annual" });
    await settle();
    expect(document.body.querySelector(".rl-brief .wk-bub")).toBeNull();
  });

  it("lands EXACTLY ONCE on a room that opened already bound", async () => {
    // The lookup used to land a brief of its own beside the one the bind effect
    // owns, which put two identical scope statements in the thread.
    open({ route: "covenant" });
    await settle();
    expect(document.body.querySelectorAll(".rl-brief")).toHaveLength(1);
  });

  it("greets a legal name that already ends in a period without doubling it", async () => {
    open({ route: "annual" });
    await settle();
    // The fixture's relationship is "Hartwell Precision Manufacturing LLC"; the
    // rule is the general one, so assert the shape rather than the fixture.
    const greeting = document.body.querySelector(".wk-greet")!.textContent ?? "";
    expect(greeting.trim()).not.toMatch(/\.\.$/);
    expect(greeting.trim()).toMatch(/\.$/);
  });

  it("numbers the ritual, above the question rather than inside it", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    const kicker = room.querySelector(".rl-kicker")!;
    expect(kicker.textContent).toMatch(/^Step 1 of \d+$/);
    expect(liveAsk()).toBe("Which review is this?");
  });

  it("never raises its voice: no exclamation points anywhere in the room", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    expect(room.textContent).not.toMatch(/!/);
  });
});

/* ----------------------------------------------------- collecting the answers */

describe("the guided steps", () => {
  it("offers the org's own values as chips, and a tap SAYS the value", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    expect(byText(/^Annual$/)).toBeTruthy();
    expect(byText(/^Problem Loan$/)).toBeTruthy();
    click(byText(/^Annual$/));
    await settle();
    /* THE ANSWER IS THE SETTLED ROW NOW (founder, 2026-09-03). An answered step
       leaves the stage and one numbered row stands for it, so the banker echo
       under the row would be the same word printed twice, eight pixels apart.
       What is asserted is unchanged: the tap SAID the value and the room took
       it. It says it off the receipt rather than off the echo. */
    expect(room.querySelector(".wk-settled")!.textContent).toContain("Annual");
    expect(liveAsk()).toContain("State the relationship position");
  });

  it("takes the same answer as free text, implicitly", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    await type(room, "Annual");
    expect(liveAsk()).toContain("State the relationship position");
  });

  it("re-asks rather than guessing, when a closed-set answer is unreadable", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    await type(room, "the usual one");
    expect(liveAsk()).toContain("I could not read that as one of the values above.");
  });

  it("offers the skip on an optional step, and files it as an answer, not as silence", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    expect(byText(/Not assessed/)).toBeTruthy();
    click(byText(/Not assessed/));
    await settle();
    expect(room.querySelector(".wk-col-r")!.textContent).toContain("not assessed");
  });

  it("collects a covenant verdict per covenant, and asks the reason only on an Exception", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    expect(liveAsk()).toBe("Which covenants are we assessing?");
    click(byText(/Debt Service Coverage/));
    await settle();
    expect(liveAsk()).toContain("How does the Debt Service Coverage test assess?");
    click(byText(/^Exception$/));
    await settle();
    // The observed figure comes first, then the reason the exception is one.
    expect(liveAsk()).toContain("What figure was tested");
    click(byText(/Not assessed/));
    await settle();
    expect(liveAsk()).toContain("failed test or an undelivered document");
    expect(byText(/^Breached$/)).toBeTruthy();
    expect(byText(/^Overdue$/)).toBeTruthy();
    expect(room).toBeTruthy();
  });

  it("opens the covenant list on the covenant the signal named", async () => {
    const { room } = open({ route: "covenant", covenantId: "cov1" });
    await settle();
    expect(room.querySelector(".wk-col-r")!.textContent).toContain("Covenants");
    expect(liveAsk()).toContain("How does the Debt Service Coverage test assess?");
  });

  it("refuses a figure it cannot read, on a numeric step", async () => {
    const { room } = open({ route: "valuation" });
    await settle();
    click(byText(/COL-000762/));
    await settle();
    await type(room, "about four million");
    expect(liveAsk()).toContain("I need a figure for that one.");
  });

  it("keeps the ledger in the right lane, and takes a row back off on request", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    const lane = room.querySelector(".wk-col-r")!;
    expect(lane.textContent).toContain("Review type");
    expect(lane.textContent).toContain("1 answer");
    click(lane.querySelector(".wk-ent-x")!);
    await settle();
    // Back at zero the header retires with the last row (founder call
    // 2026-09-01: the lane never shows furniture for nothing).
    expect(room.querySelector(".wk-man-h")).toBeNull();
    expect(liveAsk()).toBe("Which review is this?");
  });
});

/* ---------------------------------------------------------- the token flow */

describe("the plan, the token and the dossier", () => {
  async function driveAnnual(deps?: RelFlowDeps) {
    const opened = open({ route: "annual", deps });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    // AND THE SECTIONS CHIP SET, taken as none. Six further narratives reach
    // the banker through one optional question rather than six sequential
    // ones, so the shortest annual review is still three answers and a skip.
    click(byText(/Not assessed/));
    await settle();
    return opened;
  }

  it("puts the review chip in the thread once every step is answered", async () => {
    const { room } = await driveAnnual();
    const chip = room.querySelector(".wk-propose")!;
    expect(chip.textContent).toContain("Review & file");
    expect(chip.textContent).toContain("4 answers collected");
  });

  it("stages on the chip and shows the ORG's real token, never a decoration", async () => {
    const { room } = await driveAnnual();
    click(room.querySelector(".wk-propose")!);
    await settle();
    const card = room.querySelector(".wk-flowcard")!;
    expect(card.textContent).toContain("Files an annual credit review at In Progress.");
    expect(card.querySelector(".wk-tok")!.textContent).toBe("decision token · single use · 6b34…wxyz");
  });

  it("reads the org's warnings before the filing, as advice and never as a gate", async () => {
    const { room } = await driveAnnual();
    click(room.querySelector(".wk-propose")!);
    await settle();
    expect(room.querySelector(".rl-warn")!.textContent).toContain("Before you file");
    expect(room.querySelector(".rl-warn")!.textContent).toContain("get no snapshot row");
    // Advice never disarms the gesture.
    expect(byText(/File the review/)!.hasAttribute("disabled")).toBe(false);
  });

  it("executes in the thread and morphs into the result dossier", async () => {
    const { room } = await driveAnnual();
    click(room.querySelector(".wk-propose")!);
    await settle();
    click(byText(/File the review/));
    await settle();
    const dossier = room.querySelector(".wk-rescard")!;
    expect(dossier.textContent).toContain("Annual Review");
    expect(dossier.textContent).toContain("REV-0000000012");
    expect(dossier.textContent).toContain("The review was created and verified.");
    // The halo is the filing's only light, and it is on.
    expect(dossier.classList.contains("wk-lit")).toBe(true);
    expect(room.querySelector(".wk-tokline")!.textContent).toBe(
      "✓Single-use decision token redeemed. Filed against Hartwell Precision Manufacturing LLC.",
    );
    // The review is filed, NOT approved, and the room says so.
    expect(room.querySelector(".wk-handoff")!.textContent).toContain("filed, not approved");
    expect(room.querySelector(".wk-flowcard")).toBeNull();
  });

  /* ============ THE FILED FINALE, IN THE SECOND ROOM (founder, 2026-09-03)

     One grammar with the facility room: the review's answers and the steps that
     collected them leave the stage, the card is the only thing left in a centred
     pane, the rail says one line, and the afterglow offers the ONE door this
     room has. Its dossier files against the relationship rather than a package
     record and carries no href, so there is no nCino link and none is invented. */
  it("cleans the room up around the card once the review is filed", async () => {
    const { room } = await driveAnnual();
    const before = room.querySelectorAll("[data-ex-id]").length;
    click(room.querySelector(".wk-propose")!);
    await settle();
    click(byText(/File the review/));
    await settle();

    const left = [...room.querySelectorAll("[data-ex-id]:not([data-finale])")];
    expect(left).toHaveLength(1);
    expect(left[0].querySelector(".wk-rescard")).toBeTruthy();
    expect(room.querySelectorAll('[data-ex-id][data-finale="gone"]').length).toBe(before);
    expect(room.querySelector(".wk-thread")!.getAttribute("data-finale")).toBe("still");
    expect(room.querySelector(".wk-rescard")!.closest("[data-finale-card]")).toBeTruthy();

    // The rail wipes as a whole and its answers go off stage, still mounted.
    expect(room.querySelector(".wk-col-r")!.getAttribute("data-finale")).toBe("still");
    const answers = [...room.querySelectorAll(".wk-ent")];
    expect(answers).toHaveLength(4);
    for (const answer of answers) expect(answer.getAttribute("data-finale")).toBe("gone");

    // One door, one line about what comes next, and no link invented.
    const after = room.querySelector(".wk-afterglow")!;
    expect(after.textContent).toContain("review memo");
    expect(after.querySelector("a")).toBeNull();
    expect([...after.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close workroom"]);
    expect(room.querySelector(".wk-composer")!.hasAttribute("hidden")).toBe(true);
  });

  it("gives no connector a surface of its own, and burns no token getting there", async () => {
    const execute = vi.fn();
    const { room } = await driveAnnual(depsFor({ available: () => false, execute }));
    click(room.querySelector(".wk-propose")!);
    await settle();
    expect(room.querySelector(".wk-notice")!.textContent).toContain("not connected to the bank's systems");
    expect(room.querySelector(".wk-flowcard")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("waits on the org once the call has reached it, and never offers the approval again", async () => {
    let clock = 0;
    const { room } = await driveAnnual(
      depsFor({
        execute: async () =>
          ({ ok: false, error: { code: "TOKEN_REFUSED", message: "The token has already been used." } }) as ToolOutcome<ExecuteResult>,
        settle: { readState: async () => undefined, wait: async () => undefined, now: () => (clock += 100_000) },
      }),
    );
    click(room.querySelector(".wk-propose")!);
    await settle();
    click(byText(/File the review/));
    await settle();
    expect(room.textContent).toContain("Filing in progress, nCino is still writing.");
    expect(room.textContent).toContain("Nothing needs approving again");
    expect(byText(/Approval closed/)!.hasAttribute("disabled")).toBe(true);
  });

  it("does not arm the gesture when the ORG is holding execution", async () => {
    const { room } = await driveAnnual(
      depsFor({
        stage: async () =>
          ({ ok: true, result: { ...PLAN, executionHeld: true, heldReason: "The org is holding this plan." } }) as ToolOutcome<StagedOutput>,
      }),
    );
    click(room.querySelector(".wk-propose")!);
    await settle();
    expect(room.querySelector(".rl-warn-h")!.textContent).toContain("The org is holding this plan.");
    expect(byText(/Held by the org/)!.hasAttribute("disabled")).toBe(true);
  });
});

/* ------------------------------------------------------------- the refusals */

describe("what this room does not do", () => {
  it("hands facility work next door in one professional line", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    await type(room, "pledge the receivables against the line of credit");
    expect(document.body.textContent).toContain("That is facility work.");
    expect(document.body.textContent).toContain("Facility Actions");
  });

  it("composes a standalone covenant and states the gap rather than filing it", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    await type(room, "add a new covenant on the relationship");
    const gap = room.querySelector(".rl-gap")!;
    expect(gap.textContent).toContain("Not filed");
    expect(gap.textContent).toContain("No deployed tool authors a standalone covenant on the Account");
    expect(byText(/What would close this/)).toBeTruthy();
  });

  it("does the same for an owned, unpledged collateral asset", async () => {
    const { room } = open({ route: "valuation" });
    await settle();
    await type(room, "create a new collateral asset for this borrower");
    expect(room.querySelector(".rl-gap")!.textContent).toContain("owned but unpledged collateral record");
  });

  it("no longer refuses the override, because the tool has always taken it", async () => {
    /* This case used to assert the opposite. The refusal said the override's
       wire name had never been observed;
       StageRiskRatingReview.Request.overriddenRiskGradeValue is deployed and
       StageExecuteRiskRatingReviewTest.overrideWithACommentIsAccepted covers
       it, so the room was refusing a capability the tool already had. */
    const { room } = open({ route: "rating" });
    await settle();
    await type(room, "override the grade to 6");
    expect(document.body.textContent).not.toContain("The rating override cannot be filed from here.");
    expect(document.body.textContent).not.toContain("has never been observed");
  });

  /* THE SCALE IS ENFORCED IN THE ROOM, because it is enforced nowhere else.
     `StageRiskRatingReview.cls` states 1 to 12 twice and validates neither
     grade, so before this a 47 was read, recorded, staged and filed. */
  it("refuses a grade off the scale by name, and keeps the question standing", async () => {
    const { room } = open({ route: "rating" });
    await settle();
    for (let i = 0; i < 4; i++) await type(room, "skip"); // the four factors
    expect(liveAsk()).toContain("What grade does this analysis support");

    await type(room, "47");
    // The refusal is the room's own sentence, not the "I could not read that"
    // re-ask: the room read 47 perfectly well and the org cannot hold it.
    expect(liveAsk()).toContain("scale is 1 to 12");
    expect(document.body.textContent).not.toContain("I need a figure for that one");

    await type(room, "0");
    expect(liveAsk()).toContain("scale is 1 to 12");

    /* AND NEITHER FIGURE WAS RECORDED. If 47 or 0 had been taken as the grade,
       this 4 would land on the OVERRIDE step and the room would be asking for
       the comment by now. It is asking for the override, so the grade step ate
       the 4 and the two refusals cost the banker nothing but the question. */
    await type(room, "4");
    expect(liveAsk()).toContain("Are you overriding the computed grade?");
  });

  it("refuses a REGULATORY CLASSIFICATION and then names the scale it is filing on", async () => {
    const { room } = open({ route: "rating" });
    await settle();
    await type(room, "they are special mention now");
    const text = document.body.textContent ?? "";
    expect(text).toContain("regulatory categories and this org's scale is numeric");
    expect(text).toContain("the rating review's own scale");
  });
});

/* --------------------------------------------------------- switching review */

describe("route binding is final per plan", () => {
  it("rebuilds on the other review while nothing has been collected", async () => {
    const { room, restarted } = open({ route: "covenant" });
    await settle();
    await type(room, "actually run the annual review");
    expect(restarted).toEqual([{ route: "annual", say: "actually run the annual review" }]);
  });

  it("refuses out loud once answers exist, and offers the discard as an explicit gesture", async () => {
    const { room, restarted } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    await type(room, "actually run the covenant review");
    expect(document.body.textContent).toContain("so the room is held to it");
    expect(restarted).toEqual([]);
    click(byText(/Discard and start the covenant review/));
    expect(restarted).toEqual([{ route: "covenant", say: "actually run the covenant review" }]);
  });
});

/* ----------------------------------------------------------- one exchange */

describe("one live exchange", () => {
  it("collapses the steps behind the live one, and never unmounts them", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    expect(room.querySelectorAll(".wk-step.wk-gone").length).toBeGreaterThan(0);
    const chip = room.querySelector(".wk-hist")!;
    expect(chip.textContent).toContain("earlier steps");
    click(chip);
    expect(room.querySelectorAll(".wk-step.wk-gone")).toHaveLength(0);
  });

  it("keeps the route question on screen while it is still open", async () => {
    const { room } = open({ question: neutralRelAsk() });
    await type(room, "no idea");
    // Collapsing step 0 behind the answer would hide the five chips in the same
    // gesture that said "pick one".
    expect(document.body.querySelectorAll(".wk-opts .wk-opt").length).toBeGreaterThanOrEqual(5);
  });
});

/* ================================= the create grammar, in the second room */

describe("the relationship room answers a create line the same way the workroom does", () => {
  /* THE FIVE RELATIONSHIP ROUTES FILE NO CREATE AT ALL. There is nothing to
     gather for, so the room does not gather: it names the gap by name and the
     org-side gap under it, exactly as the workroom names a route that cannot
     file. What it must never do is what the modification room was doing before
     F-CG1 was closed - re-elicit as though nothing had been typed. */
  it("names the covenant create gap by name, and never re-elicits", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    await type(room, "add an interest coverage covenant of 3.0x tested quarterly");

    const words = room.textContent ?? "";
    expect(words).toContain("The room can compose the covenant, and it cannot file it");
    expect(words).toContain("a covenant authored standalone on the relationship");
    expect(words).toContain("What would close this");
    // NOT a gather, and not a capability lecture either.
    expect(words).not.toContain("To file one I need the test");
    expect(words).not.toMatch(/what threshold/i);
  });

  it("names the collateral create gap by name inside the valuation", async () => {
    const { room } = open({ route: "valuation" });
    await settle();
    await type(room, "add a new collateral asset the borrower owns worth $2,000,000");

    const words = room.textContent ?? "";
    expect(words).toContain("The room can compose the asset and its ownership, and it cannot file them");
    // AND IT NEVER ASKS FOR WHAT THE ORG WORKS OUT.
    expect(words).not.toMatch(/what advance rate/i);
    expect(words).not.toMatch(/lendable value/i);
  });
});

/* =============================================================================
   THE REFUSAL COMES FIRST, ON THE GLASS.

   The step machine's own test holds that no step is reached; this holds the
   half a banker actually sees: the scope brief, then why the review cannot
   close anything today, then NO first question and no "Review & file" chip.
   ============================================================================= */

describe("a route that can only refuse says so before it asks", () => {
  it("lands the refusal under the brief, asks nothing, and offers no plan", async () => {
    const rowless = {
      covenants: {
        covenants: [
          { covenantId: "cov1", covenantType: "Debt Service Coverage of Borrower" },
          { covenantId: "cov2", covenantType: "Minimum Liquidity" },
        ],
      },
    };
    const { room } = open({ route: "covenant", bundle: rowless });
    await settle();
    const text = room.textContent ?? "";
    expect(text).toContain("no open test period on any of the 2 covenants");
    // NO FIRST QUESTION.
    expect(text).not.toContain("Which covenants are we assessing?");
    // AND NO PLAN. Offering "Review & file" over a refusal would be the room
    // contradicting itself in the same breath.
    expect(room.querySelector(".wk-propose")).toBeNull();
  });

  it("refuses the VALUATION on the anchor and asks nothing under it", async () => {
    /* The drive caught the room rendering NO_PACKAGE_ANCHOR under the brief and
       then asking "which collateral are we valuing?" underneath it. */
    const { room } = open({ route: "valuation", bundle: { snapshot: { accountId: "001X", name: "Hartwell" } } as never });
    await settle();
    expect(room.textContent).toContain("anchored on the product package");
    expect(room.textContent).not.toContain("Which collateral are we valuing?");
    expect(room.querySelector(".wk-propose")).toBeNull();
  });

  it("still runs the review where the rows are there", async () => {
    const { room } = open({ route: "covenant" });
    await settle();
    expect(room.textContent).toContain("Which covenants are we assessing?");
    expect(room.textContent).not.toContain("no open test period");
  });
});

describe("an optional multi step can actually be skipped", () => {
  it("takes the skip chip on the annual review's section set, and records none", async () => {
    /* The skip used to be unreachable on a MULTI step: `answerLive` matched
       the line against the options before it read the skip, so "Not assessed"
       named no section and the room re-asked a question the banker had just
       answered. The annual review's section chip set is the first optional
       multi step in this room, which is where it surfaced. */
    const { room } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    expect(room.textContent).toContain("Anything else for the file?");
    click(byText(/Not assessed/));
    await settle();
    // Answered, not re-asked: the room moved on to the plan.
    expect(room.textContent).not.toContain("I could not read that");
    expect(room.querySelector(".wk-propose")).not.toBeNull();
  });

  it("opens one text step for each section picked", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/^Collateral analysis/));
    await settle();
    expect(room.textContent).toContain("The collateral position, with the dates behind the values.");
  });
});

/* =============================================================================
   THE TOAST CLAIMED THE TRAIL AND THE ROOM WROTE NONE.

   `setToast` has always said "logged to the activity trail". The room took no
   onFiled and its host wired none, against Workroom.tsx and WorkroomHost.tsx
   which have done both since A30. What this holds is that a filing writes
   exactly ONE entry, that it names the record the ORG named, and that the
   toast's claim and the trail now agree.
   ============================================================================= */

describe("a filed review lands in the activity trail", () => {
  it("writes exactly one entry, naming the record the org named", async () => {
    const filed: Array<{ actionId: string; result: ExecuteResult }> = [];
    const opened = open({ route: "annual", onFiled: (f) => filed.push(f) });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Review & file/));
    await settle();
    click(byText(/File the review/));
    await settle();

    expect(filed).toHaveLength(1);
    expect(filed[0].actionId).toBe("annual-review");
    // THE ORG'S OWN RESULT, not a restatement of it.
    expect(filed[0].result.recordName).toBe("REV-0000000012");
    // And the toast's claim is now true. It renders in the portal beside the
    // room rather than inside it, which is why this reads the document.
    expect(document.body.textContent).toContain("logged to the activity trail");
    expect(opened.room.querySelector(".wk-rescard")).not.toBeNull();
  });

  it("writes nothing where the filing never happened", async () => {
    const filed: Array<{ actionId: string; result: ExecuteResult }> = [];
    open({ route: "annual", onFiled: (f) => filed.push(f) });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    expect(filed).toEqual([]);
  });
});

describe("the room answers its own three reads locally", () => {
  it("answers a rating question from the book, binding nothing", async () => {
    const { room, bound } = open({ route: null, question: neutralRelAsk() });
    await settle();
    await type(room, "what is the risk rating");
    await settle();
    // A READ DOES NOT PICK A REVIEW. It binds nothing and advances nothing.
    expect(bound).toEqual([]);
    expect(room.textContent).toContain("The grade on file for Hartwell Precision Manufacturing LLC is 4");
    expect(room.textContent).toContain("Not the facility scale");
  });

  it("says what no read carries when asked about the reviews on file", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    await type(room, "when was the last review");
    await settle();
    expect(room.textContent).toContain("No read on this cockpit carries the credit reviews");
    // AND IT DOES NOT ANSWER THE STEP. The review type is still open.
    expect(room.textContent).toContain("Which review is this?");
  });
});

/* =============================================================================
   WHAT THE HEADLESS DRIVE CAUGHT, 2026-09-02.

   Two defects that only show up with a real route binding in front of them, so
   no unit case had ever reached either. Both are the room contradicting itself.
   ============================================================================= */

describe("the line that named the review is not an answer to its first question", () => {
  it("does NOT record it as the case subject", async () => {
    /* THE DRIVE FILED A CASE WHOSE SUBJECT READ "raise a service request".
       The line bound the route, was replayed into the bound room, and the
       service route's first step is free TEXT, so it was recorded silently.
       The banker had not chosen a subject at all. */
    const { room } = open({ route: "service", say: "raise a service request" });
    await settle();
    expect(room.textContent).toContain("What did the client ask for?");
    // NOTHING COLLECTED. The lane is empty and the first question stands.
    expect(room.querySelectorAll(".wk-ent")).toHaveLength(0);
  });

  it("does not turn it into a re-ask on a chips route either", async () => {
    const { room } = open({ route: "annual", say: "annual review" });
    await settle();
    expect(room.textContent).toContain("Which review is this?");
    expect(room.textContent).not.toContain("I could not read that as one of the values above");
  });

  /* THE INTAKE IS THE EXCEPTION, because there naming the route and saying what
     to do are ONE sentence. "add a relationship covenant: minimum liquidity of
     5M tested quarterly" names the route in its first three words and answers
     the first four questions in the rest, so dropping it would ask a banker who
     has just said everything to say it again. */
  it("keeps the intake's opening line, because it is the instruction", async () => {
    const { room } = open({
      route: "intake",
      say: "add a relationship covenant: minimum liquidity of 5M tested quarterly",
    });
    await settle();
    /* Past every question the line itself answered: which of the two it is, the
       test, the threshold and the schedule. The room asks the next thing it does
       NOT hold, which is the date the schedule is anchored on. (Before audit
       finding 6 the type could not resolve at all with no catalog in hand, so
       the room asked "Which test is this covenant?" over a line that said it.) */
    expect(liveAsk()).toContain("From what date");
    expect(liveAsk()).toContain("Minimum Liquidity");
    expect(room.textContent).toContain("add a relationship covenant: minimum liquidity of 5M tested quarterly");
  });

  it("still runs a line that names the route AND asks for something else", async () => {
    const { room } = open({ route: "covenant", say: "add a covenant on the relationship" });
    await settle();
    // The create gap is named: the line did more than bind, so it still runs.
    expect(room.textContent).toContain("The room can compose the covenant, and it cannot file it");
  });
});

/* =============================================================================
   WHAT THE HEADLESS DRIVE CAUGHT, 2026-09-03.

   The org's own picklist values contain route words. "Appraisal" is one of the
   fourteen values `LLC_BI__Source__c` holds AND the word the valuation route's
   reader looks for, so answering the room's own question with the chip the room
   had just put on the glass re-routed the room.
   ============================================================================= */

describe("a value the room itself offered is an answer, never a route switch", () => {
  it("does not read the source chip as a request for a collateral valuation", async () => {
    const { room, restarted } = open({ route: "valuation" });
    await settle();
    // The valuation route's own source step offers "Appraisal" as a chip. The
    // trap is the same one on any route whose options carry a route word.
    expect(room.textContent).toContain("Which collateral are we valuing?");
    expect(restarted).toEqual([]);
  });

  it("keeps a bare route word switching when the room did not offer it", async () => {
    const { room, restarted } = open({ route: "annual" });
    await settle();
    await type(room, "revalue the collateral");
    expect(restarted).toEqual([{ route: "valuation", say: "revalue the collateral" }]);
  });
});

describe("the plan's own refusals reach the glass, by index and verbatim", () => {
  it("reads out what the org would not take, before the approval", async () => {
    /* A CREATE HAS NO ID YET, so the intake reports its refusals against the
       position in the list the room sent. Rendered in the same block as the
       plan's warnings, in the org's own words, never summarised into a count. */
    const planWithRefusals: StagedOutput = {
      ...PLAN,
      summary: "Two records are authored on the relationship.",
      refusals: [
        { index: 1, reason: "No covenant type named Fixed Charge Coverage exists in this org." },
        { index: 2, reason: "A collateral value must be above zero." },
      ],
    };
    const { room } = open({
      route: "annual",
      deps: depsFor({ stage: async () => ({ ok: true, result: planWithRefusals }) as ToolOutcome<StagedOutput> }),
    });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Review & file/));
    await settle();
    await settle();
    expect(room.textContent).toContain("Number 2 on the list: No covenant type named Fixed Charge Coverage");
    expect(room.textContent).toContain("Number 3 on the list: A collateral value must be above zero.");
  });
});

describe("a blocked route does not claim everything is collected", () => {
  it("repeats the refusal rather than pointing at a chip that is not there", async () => {
    const { room } = open({
      route: "covenant",
      bundle: { snapshot: { accountId: "001X", name: "Hartwell" } } as never,
    });
    await settle();
    await type(room, "go on then");
    await settle();
    expect(room.textContent).toContain("anchored on the product package");
    expect(room.textContent).not.toContain("The review chip below carries the next move");
    expect(room.querySelector(".wk-propose")).toBeNull();
  });
});

describe("a service request subject carrying a route word stays on the service request", () => {
  it("records the subject rather than re-routing to the covenant review", async () => {
    const { room, restarted } = open({ route: "service" });
    await settle();
    await type(room, "Copy of the June covenant compliance certificate");
    await settle();
    expect(restarted).toEqual([]);
    expect(room.textContent).toContain("And the request in full");
    expect(room.textContent).toContain("Copy of the June covenant compliance certificate");
  });

  it("still switches on the short form a banker actually uses", async () => {
    const { room, restarted } = open({ route: "service" });
    await settle();
    await type(room, "covenant review");
    await settle();
    expect(restarted.map((r) => r.route)).toEqual(["covenant"]);
  });
});

/* =============================================================================
   WHAT WAS FILED, ON THE CARD (founder, 2026-09-04). THE SECOND ROOM.

   One grammar with the facility room. The lane is this room's ledger and the
   finale wipes it, so the card left standing carries the same answers, in the
   same order, with the org's own record ids wherever the flow returned one.
   ============================================================================= */

const ledgerRows = (room: HTMLElement) => [...room.querySelectorAll(".wk-rescard .rc-fl-r")];
const laneLabels = (room: HTMLElement) => [...room.querySelectorAll(".wk-ent .wk-ent-t b")].map((n) => n.textContent);

/** The covenant review, driven to the point where the plan can be filed: one
 *  covenant, its verdict, its observed figure and the basis. */
async function driveCovenant(deps?: RelFlowDeps) {
  const opened = open({ route: "covenant", deps });
  await settle();
  click(byText(/Debt Service Coverage/));
  await settle();
  click(byText(/^Compliant$/));
  await settle();
  click(byText(/Not assessed/));
  await settle();
  click(byText(/Not assessed/));
  await settle();
  return opened;
}

describe("the card carries what the lane collected", () => {
  async function fileTheReview(opened: Opened, label: RegExp) {
    click(opened.room.querySelector(".wk-propose")!);
    await settle();
    click(byText(label));
    await settle();
    return opened.room;
  }

  it("lists the lane's answers, in lane order, under a head that counts them", async () => {
    const opened = open({ route: "annual" });
    await settle();
    click(byText(/^Annual$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    const before = laneLabels(opened.room);
    const room = await fileTheReview(opened, /File the review/);

    const rows = ledgerRows(room);
    // SAME ANSWERS, SAME ORDER, read against the lane the finale just drained
    // rather than against a hard list.
    expect(rows.map((r) => r.querySelector(".rc-fl-l b")!.textContent)).toEqual(before);
    expect(rows.map((r) => r.querySelector(".rc-fl-now")!.textContent)).toEqual(
      [...room.querySelectorAll(".wk-ent .wk-ent-t > span")].map((n) => n.textContent),
    );
    // The head says what the lane head said.
    expect(room.querySelector(".wk-rescard .rc-fl-n")!.textContent).toBe("4 answers");
  });

  it("carries the org's own id on every answer the flow named a record for", async () => {
    const deps = depsFor({
      execute: async () =>
        ({
          ok: true,
          result: {
            ...RESULT,
            recordName: null,
            items: [{ covenantId: "cov1", covenantComplianceId: "a2Xbb0000COV0AAK" }],
          },
        }) as ToolOutcome<ExecuteResult>,
    });
    const opened = await driveCovenant(deps);
    const room = await fileTheReview(opened, /File the assessments/);

    const rows = ledgerRows(room);
    expect(rows).toHaveLength(4);
    /* THE TWO ROWS THAT ARE ABOUT THAT COVENANT carry the compliance row the
       org created; the picking row and the free-text basis are not records and
       claim no id rather than borrowing one. */
    const ids = rows.map((r) => r.querySelector(".rc-fl-id")?.textContent ?? null);
    expect(ids).toEqual([null, "a2Xbb0000COV0AAK", "a2Xbb0000COV0AAK", null]);
  });

  it("claims no id at all where the flow files one record for the whole review", async () => {
    const opened = await driveCovenant();
    const room = await fileTheReview(opened, /File the assessments/);
    // The scripted result carries no `items`, so nothing is invented: the card
    // lists the answers and the dossier's own rows name the record above them.
    expect(room.querySelectorAll(".wk-rescard .rc-fl-id")).toHaveLength(0);
    expect(ledgerRows(room)).toHaveLength(4);
  });

  it("is absent while the lane is still on the glass", async () => {
    const opened = await driveCovenant();
    click(opened.room.querySelector(".wk-propose")!);
    await settle();
    // The plan is staged, the lane is carrying the ledger, and there is no card
    // and therefore no section.
    expect(opened.room.querySelector(".rc-fl")).toBeNull();
    expect(opened.room.querySelectorAll(".wk-ent").length).toBe(4);

    click(byText(/File the assessments/));
    await settle();
    const { room } = opened;
    const sections = [...room.querySelectorAll(".rc-fl")];
    expect(sections).toHaveLength(1);
    expect(sections[0].closest(".wk-rescard")).toBeTruthy();
  });
});
