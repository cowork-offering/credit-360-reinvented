// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelationshipRoom, neutralRelAsk, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelFlowDeps } from "./components/relationship/reviewFlows";
import { executedActivityEntry } from "./actions/executedActivity";
import type { RelRoute } from "./components/relationship/relRoute";
import type { StagedOutput } from "./actions/stagedPlan";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { ExecuteResult, ToolOutcome, WriteActionId } from "./channel/writeTools";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE TWO REVIEWS, ON HARTWELL'S REAL BOOK (0.9.24, backlog row 49).

   Founder, 2026-09-13: "covenants and collaterals should be driven from the
   relationship perspective. A package is an association the row shows, which PPs
   and facilities it is tied to, never a filter or a narrowing control. The
   facility workroom stays package-driven; that is good as it is."

   So what is proved here is the ROOM on the book the artifact actually ships:
   two product packages and no snapshot anchor, six covenants across both, seven
   distinct pledged assets. No package question, no package chip, the header on
   the relationship, every row carrying what it is tied to, and the trail
   sentence naming the account and the reach.

   THE PAYLOAD IS READ OFF THE WIRE THE ROOM SENDS, through the injected deps:
   nothing here reaches a connector and nothing here asserts a string the room
   did not actually put on the glass.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const NAME = "Hartwell Precision Manufacturing LLC";
const LINE_OF_CREDIT = "a4Zbb0000027MaYEAU";
const AR_COVENANT = "a3Bbb000000S0bNEAS";
const NON_RE_PACKAGE = "a5Fbb000000IHFJEA4";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
});

/** The org's own reading of what the plan touches, as the room holds it.
 *
 *  The 0.9.24 contract sends this as a JSON STRING and `toStagedCovenant`
 *  parses it; the deps below stand in for the wire AFTER that mapper, so this
 *  is the parsed shape. The string itself is proved end to end through
 *  `stageAction` in components/relationship/relAssociations.test.ts. */
const ASSOCIATIONS = [
  {
    loanId: LINE_OF_CREDIT,
    loanName: `${NAME} - Line of Credit - $15,000,000.00`,
    productPackageId: NON_RE_PACKAGE,
    packageName: `${NAME} credit package · Non-Real Estate and Real Estate`,
  },
];

const PLAN = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Assesses one covenant on the relationship.",
  steps: [],
  warnings: [],
  suggestions: [],
  accountId: HARTWELL,
  covenants: [
    {
      covenantId: AR_COVENANT,
      covenantName: "COV-000652",
      covenantType: "Accounts Receivable",
      state: "planned",
      associations: ASSOCIATIONS,
    },
  ],
} as unknown as StagedOutput;

const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "The assessment was written and verified.",
  recordName: "COMP-0489",
  steps: [],
};

interface Opened {
  room: HTMLElement;
  staged: Array<{ actionId: WriteActionId; payload: Record<string, unknown> }>;
  filed: Array<{ actionId: WriteActionId; result: ExecuteResult; packages?: string[] }>;
}

function open(route: RelRoute, plan: StagedOutput = PLAN): Opened {
  const staged: Opened["staged"] = [];
  const filed: Opened["filed"] = [];
  const deps: RelFlowDeps = {
    available: () => true,
    newKey: () => "key-1",
    stage: async (actionId, payload) => {
      staged.push({ actionId, payload: payload as unknown as Record<string, unknown> });
      return { ok: true, result: plan } as ToolOutcome<StagedOutput>;
    },
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
        route={route}
        router={router}
        deps={deps}
        onFiled={(f) => filed.push(f)}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, staged, filed };
}

const buttons = () => [...document.body.querySelectorAll("button")];
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

/** The option rows of the live step, label and detail together. */
const optionRows = () =>
  [...document.body.querySelectorAll(".wk-step:not(.wk-gone) .wk-opts button")].map((b) =>
    (b.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

/* ------------------------------------------------------------ no package ask */

describe("the two reviews ask no package", () => {
  for (const route of ["covenant", "valuation"] as const) {
    it(`opens the ${route} route on the relationship with no package question`, async () => {
      const { room } = open(route);
      await settle();
      expect(room.querySelector(".wk-pkgask")).toBeNull();
      expect(room.textContent).not.toContain("Which package does this review run in?");
      // AND NO PACKAGE CHIP. The header names the relationship the review runs
      // on, and it is a statement: there is nothing here to switch, because
      // nothing is being narrowed.
      const line = room.querySelector<HTMLElement>(".wk-pkgline")!;
      expect(line.dataset.pkgline).toBe("account");
      expect(line.tagName).toBe("SPAN");
      expect(line.textContent).toContain(NAME);
    });
  }

  it("asks the first question straight away rather than gating it", async () => {
    const { room } = open("covenant");
    await settle();
    expect(room.textContent).toContain("Which covenants are we assessing?");
  });
});

/* ------------------------------------------------ every row, with its ties */

describe("every row shows what it is tied to", () => {
  it("lists all six covenants on the relationship, each with its facilities and packages", async () => {
    open("covenant");
    await settle();
    const rows = optionRows();
    expect(rows).toHaveLength(6);
    // The four with a loan junction name the facility and the package it sits in.
    expect(rows.find((r) => r.startsWith("Accounts Receivable"))).toContain(
      "Line of Credit $15M; Non-RE/RE package",
    );
    expect(rows.find((r) => r.startsWith("Term Covenants"))).toContain("Construction $12M; Non-RE/RE package");
    // The one that hangs off the SECOND package names that one instead.
    expect(rows.find((r) => r.startsWith("Debt Service Coverage of Borrower"))).toContain(
      "Purchase $6.50M; RE/Non-RE package",
    );
    // And the two that hang off no facility say so, rather than going silent.
    expect(rows.filter((r) => /Relationship level, on no facility/.test(r))).toHaveLength(2);
  });

  it("lists every asset the borrower owns, each with its pledges", async () => {
    open("valuation");
    await settle();
    const rows = optionRows();
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row).toMatch(/package|Relationship level|pledged to no active facility/);
    expect(rows.some((r) => /Line of Credit \$15M/.test(r))).toBe(true);
    expect(rows.some((r) => /RE\/Non-RE package/.test(r))).toBe(true);
  });
});

/* ------------------------------------------------------- the wire and the card */

describe("the plan the room stages", () => {
  async function driveOneCovenant() {
    const opened = open("covenant");
    await settle();
    click(byText(/^Accounts Receivable/));
    await settle();
    click(byText(/^Compliant$/));
    await settle();
    // The observed figure and the narrative are both optional.
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    return opened;
  }

  it("sends the account and never a package", async () => {
    const { room, staged } = await driveOneCovenant();
    click(room.querySelector(".wk-propose")!);
    await settle();
    expect(staged).toHaveLength(1);
    expect(staged[0].actionId).toBe("covenant-review");
    expect(staged[0].payload.accountId).toBe(HARTWELL);
    expect(staged[0].payload).not.toHaveProperty("productPackageId");
  });

  it("reads the org's own associations back onto the card", async () => {
    const { room } = await driveOneCovenant();
    click(room.querySelector(".wk-propose")!);
    await settle();
    const touches = room.querySelector('[data-assoc="plan"]')!;
    expect(touches.textContent).toContain("What this touches");
    expect(touches.textContent).toContain("COV-000652");
    expect(touches.textContent).toContain("Line of Credit $15M; Non-RE/RE package");
  });

  it("says nothing about associations where the org sent none", async () => {
    // Absent is "the org did not say", never "tied to nothing", so the block
    // is not rendered rather than rendered empty.
    const bare = { ...PLAN, covenants: [{ covenantId: AR_COVENANT, covenantName: "COV-000652", state: "planned" }] } as StagedOutput;
    const opened = open("covenant", bare);
    await settle();
    click(byText(/^Accounts Receivable/));
    await settle();
    click(byText(/^Compliant$/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(byText(/Not assessed/));
    await settle();
    click(opened.room.querySelector(".wk-propose")!);
    await settle();
    expect(opened.room.querySelector('[data-assoc="plan"]')).toBeNull();
  });

  it("hands the trail the packages it touched, and the trail names the relationship", async () => {
    const { room, filed } = await driveOneCovenant();
    click(room.querySelector(".wk-propose")!);
    await settle();
    click(byText(/File the assessments/));
    await settle();
    expect(filed).toHaveLength(1);
    expect(filed[0].packages).toEqual(["Non-RE/RE"]);
    const entry = executedActivityEntry({
      actionId: filed[0].actionId,
      outcome: filed[0].result,
      target: NAME,
      packages: filed[0].packages,
      now: () => new Date("2026-09-13T10:00:00Z"),
    })!;
    expect(entry.title).toBe(`Covenant review on ${NAME}, on the Non-RE/RE package`);
  });
});
