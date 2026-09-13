// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelationshipRoom, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { BorrowerBundle, C360Data, Facility } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, StagePayloads, ToolOutcome, WriteActionId } from "./channel/writeTools";

/* =============================================================================
   SHAPING THE VERSION FROM THE RELATIONSHIP ROOM (0.9.23).

   THE FOUNDER'S ASK, 2026-09-13: "a modification we created a day ago: add a
   covenant or collateral". 0.9.17 made the in-flight version a first-class
   STATE and locked every route that would fork a second one; it opened no route
   that changes anything INSIDE it, so a banker standing in their own unbooked
   version could read it and nothing else.

   THE BOOK BELOW IS THE SHAPE THAT MAKES ONE. A booked package of two
   facilities, and a second package holding a member-for-member copy of them at
   Qualification with the money on the end of one clone's name rewritten, which
   is what nCino's own filing does. `packageRoster` reads that as a fork, and
   `amendablePackage` reads the fork as the banker's until it climbs to
   Approval / Loan Committee.

   EVERY ASSERTION BELOW IS EITHER THE PAYLOAD THE ORG WOULD RECEIVE, the row a
   picker draws, or a sentence the plan card says. The payload assertions parse
   the JSON arms back out, because the arms travel as JSON STRINGS on this wire
   and a shape asserted as a string is a shape nobody can read.
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

const ACCOUNT = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";
const PURCHASE_CLONE = "a4Zbb000002KFD4EAO";
const EQUIPMENT_CLONE = "a4Zbb000002KFD3EAO";

const loan = (over: Partial<Facility>): Facility => ({
  status: "Open",
  productPackageId: SOURCE,
  stage: "Booked",
  ...over,
});

const BOOKED: Facility[] = [
  loan({
    loanId: "a4Zbb000002ICnxEAG",
    name: "Hartwell - Purchase - $6,500,000.00",
    committed: 6_500_000,
    outstanding: 6_340_000,
    collateral: [
      {
        loanId: "a4Zbb000002ICnxEAG",
        collateralId: "a35A",
        collateralName: "COL-000762",
        collateralDescription: "Kokomo plant, 1400 Industrial Parkway",
        collateralType: "Real Estate-Industrial",
        collateralValue: 9_000_000,
        advanceRate: 70,
        currentLendableValue: 6_300_000,
      },
    ],
  }),
  loan({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, outstanding: 1_330_000 }),
];

const versionMembers = (stage = "Qualification"): Facility[] => [
  loan({
    loanId: PURCHASE_CLONE,
    name: "Hartwell - Purchase - $12,000,000.00",
    committed: 12_000_000,
    outstanding: 0,
    productPackageId: VERSION,
    stage,
  }),
  loan({
    loanId: EQUIPMENT_CLONE,
    name: "Hartwell - Equipment - $1,500,000.00",
    committed: 1_500_000,
    outstanding: 0,
    productPackageId: VERSION,
    stage,
  }),
];

function bundleOf(stage = "Qualification"): BorrowerBundle {
  const facilities = [...BOOKED, ...versionMembers(stage)];
  return {
    snapshot: { accountId: ACCOUNT, name: "Hartwell Precision Manufacturing LLC", productPackageId: SOURCE },
    exposure: {
      totalCommitted: facilities.reduce((s, f) => s + (f.committed ?? 0), 0),
      totalOutstanding: facilities.reduce((s, f) => s + (f.outstanding ?? 0), 0),
      totalUniqueCollateralLendableValue: 6_300_000,
      uniqueCollateralCount: 1,
      facilities,
    },
    covenants: {
      covenants: [
        {
          covenantId: "a2XA",
          covenantType: "Debt Service Coverage of Borrower",
          thresholdValue: 1.25,
          actualValue: 1.38,
          frequency: "Quarterly",
          covenantStatus: "Active",
          lastEvaluationStatus: "Compliant",
        },
      ],
    },
    requests: [],
  } as unknown as BorrowerBundle;
}

function ctxFor(bundle: BorrowerBundle, productPackageId: string | null) {
  const data = {
    meta: { generatedAt: "2026-09-13", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { [ACCOUNT]: bundle },
  } as unknown as C360Data;
  return relContextFor({
    data,
    bundle,
    accountId: ACCOUNT,
    accountName: "Hartwell Precision Manufacturing LLC",
    catalog: null,
    productPackageId,
  });
}

const PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files the record on the version.",
  steps: [],
  warnings: [],
  suggestions: [],
};
const RESULT: ExecuteResult = {
  stagingId: "a8abb00001KtalSAAR",
  terminalState: "success",
  outcome: "Created and verified.",
  recordName: "COV-0099",
  steps: [],
};

type Staged = { actionId: WriteActionId; payload: StagePayloads[keyof StagePayloads] };

function depsWith(staged: Staged[]): RelFlowDeps {
  return {
    available: () => true,
    newKey: () => "key-1",
    stage: async (actionId, payload) => {
      staged.push({ actionId, payload });
      return { ok: true, result: PLAN } as ToolOutcome<StagedOutput>;
    },
    execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
  };
}

const ROUTER: RelRouter = {
  question: null,
  say: null,
  preselectCovenantId: null,
  neutral: () => ({ line: "", chips: [] }),
  onBind: () => {},
  onRestart: () => {},
};

/** The room, with the package anchor the banker's own pick moves, which is
 *  what `RelationshipRoomHost` does through the session. */
function Harness({ route, bundle, deps }: { route: RelRoute; bundle: BorrowerBundle; deps: RelFlowDeps }) {
  const [anchor, setAnchor] = useState<string | null>(null);
  return (
    <RelationshipRoom
      ctx={ctxFor(bundle, anchor)}
      route={route}
      router={ROUTER}
      deps={deps}
      onAnchorPackage={setAnchor}
      onClose={() => {}}
    />
  );
}

function open(route: RelRoute, bundle: BorrowerBundle = bundleOf(), deps: RelFlowDeps = depsWith([])): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness route={route} bundle={bundle} deps={deps} />);
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
  if (!b) throw new Error(`no chip matching ${re}; saw ${[...document.body.querySelectorAll("button.wk-opt")].map((x) => x.textContent).join(" | ")}`);
  act(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** The package rows the ask draws, with what each one says and whether it can
 *  be taken at all. */
const packageRows = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>(".wk-pkgask button.wk-pkg")].map((b) => ({
    id: b.dataset.pkg,
    line: (b.querySelector("span > span")?.textContent ?? "").trim(),
    blocked: b.disabled,
  }));

function pickPackage(id: string) {
  const b = document.body.querySelector<HTMLButtonElement>(`.wk-pkgask button[data-pkg="${id}"]`);
  if (!b) throw new Error(`no package row ${id}`);
  act(() => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** Every agent bubble the room has spoken, sentence only. */
const said = () =>
  [...document.body.querySelectorAll(".wk-msg[data-who='Agent'] .wk-bub")].map((n) => {
    const copy = n.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".wk-opts, .rl-kicker").forEach((x) => x.remove());
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });

const lastAsk = () => said().at(-1) ?? "";

/** Put the staged plan up, which is the one gesture that reaches the tool. */
async function stagePlan(room: HTMLElement) {
  const go = [...room.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    /review .*(plan|file)|review & file/i.test(b.textContent ?? ""),
  );
  if (!go) throw new Error(`no review chip; saw ${[...room.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  await act(async () => {
    go.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

const armOf = (staged: Staged[], key: string): unknown[] => {
  const payload = staged[0].payload as Record<string, string | undefined>;
  return JSON.parse(payload[key] ?? "[]");
};

/* =============================================================================
   1. THE PICKER
   ============================================================================= */

describe("the relationship room's package ask, on a version route", () => {
  it("offers the editable version and blocks the booked package it forked", async () => {
    open("versionCovenant");
    await settle();
    const rows = packageRows();
    const version = rows.find((r) => r.id === VERSION)!;
    const booked = rows.find((r) => r.id === SOURCE)!;
    expect(version.blocked).toBe(false);
    expect(version.line).toContain("editable until approval");
    expect(booked.blocked).toBe(true);
    // A change to a booked package is a modification, and it forks a version
    // rather than shaping one. The row says which door that is.
    expect(booked.line).toContain("Open Modify and the plan versions it");
  });

  it("asks which VERSION this lands on, not which package the review runs in", async () => {
    open("versionPledge");
    await settle();
    expect(document.body.querySelector(".wk-pkgask-h")?.textContent).toBe("Which version does this land on?");
  });

  /* RESTATED 0.9.24 (backlog row 49, founder 2026-09-13). This case used to
     assert that a REVIEW standing on an unanchored book still put the package
     ask up and still blocked the unbooked version in it. A review asks for no
     package at all now: the covenant review and the collateral valuation are
     anchored on the account and list everything the relationship carries, with
     the packages shown on each row. So what is pinned here is the absence of
     the question, and the version route beside it is untouched. */
  it("asks a review NO package, on the same book the version route asks about", async () => {
    const loose = bundleOf();
    const bundle = { ...loose, snapshot: { ...loose.snapshot, productPackageId: undefined } } as BorrowerBundle;
    open("valuation", bundle);
    await settle();
    expect(document.body.querySelector(".wk-pkgask")).toBeNull();
    // And the header names the relationship rather than a package the room
    // never asked for.
    expect(document.body.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe("account");
  });

  it("still blocks the unbooked version on the AMENDMENT, exactly as it did", async () => {
    const loose = bundleOf();
    const bundle = { ...loose, snapshot: { ...loose.snapshot, productPackageId: undefined } } as BorrowerBundle;
    open("versionPledge", bundle);
    await settle();
    const rows = packageRows();
    expect(rows.find((r) => r.id === VERSION)!.blocked).toBe(false);
    expect(rows.find((r) => r.id === SOURCE)!.blocked).toBe(true);
  });

  it("refuses the route outright once the org has taken the version to approval", async () => {
    open("versionCovenant", bundleOf("Approval / Loan Committee"));
    await settle();
    // No ask at all: there is nothing on this relationship left to shape, and
    // the refusal names both the gap and the way on.
    expect(document.body.querySelector(".wk-pkgask")).toBeNull();
    const spoke = said().join(" ");
    expect(spoke).toContain("This relationship carries no version to shape");
    expect(spoke).toContain("goes back a stage in Salesforce first");
  });
});

/* =============================================================================
   2. ADD A COVENANT ON THE VERSION
   ============================================================================= */

describe("adding a covenant to the version", () => {
  /** Every step of the author path, in the order the room asks them. */
  async function authorACovenant(room: HTMLElement) {
    pickPackage(VERSION);
    await settle();
    chip(/^Minimum Liquidity/);
    await settle();
    chip(/must be at least/);
    await settle();
    await type(room, "2,500,000");
    chip(/^Quarterly/);
    await settle();
    chip(/1st of next month/);
    await settle();
    chip(/Purchase/);
    await settle();
  }

  it("asks the type, the direction, the threshold, the schedule, the date and the member", async () => {
    const room = open("versionCovenant");
    await settle();
    pickPackage(VERSION);
    await settle();
    expect(lastAsk()).toMatch(/Which test is this covenant, on .+\?/);
    chip(/^Minimum Liquidity/);
    await settle();
    // The direction is a PROPOSAL off the bank's own families, never taken.
    expect(lastAsk()).toContain('runs as a "must be at least" test');
    expect(lastAsk()).toContain("The approved credit agreement is the authority");
    chip(/must be at least/);
    await settle();
    expect(lastAsk()).toBe("And the figure the Minimum Liquidity test must be at least?");
    await type(room, "2,500,000");
    expect(lastAsk()).toBe("How often is it tested?");
    chip(/^Quarterly/);
    await settle();
    expect(lastAsk()).toContain("From what date does the Minimum Liquidity test run?");
    expect(lastAsk()).toContain("never updated");
    chip(/1st of next month/);
    await settle();
    expect(lastAsk()).toBe("Which facility on the version does it test?");
  });

  it("stages amend-version with ONE covenant add, aimed at the version's own loan", async () => {
    const staged: Staged[] = [];
    const room = open("versionCovenant", bundleOf(), depsWith(staged));
    await settle();
    await authorACovenant(room);
    await stagePlan(room);

    expect(staged).toHaveLength(1);
    expect(staged[0].actionId).toBe("amend-version");
    const payload = staged[0].payload as StagePayloads["amend-version"];
    expect(payload.versionPackageId).toBe(VERSION);
    expect(payload.idempotencyKey).toBe("key-1");
    expect(payload.rationale).toContain("Minimum Liquidity");
    // The ARMS are JSON strings on this wire, exactly as they are on the
    // modification's. Only the one arm travels.
    expect(payload.covenantAttachesJson).toBeUndefined();
    expect(payload.pledgeAddsJson).toBeUndefined();
    expect(armOf(staged, "covenantAddsJson")).toEqual([
      {
        typeName: "Minimum Liquidity",
        threshold: 2_500_000,
        operator: ">=",
        frequency: "Quarterly",
        effectiveDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        targetLoanId: PURCHASE_CLONE,
      },
    ]);
  });

  it("offers the covenant the borrower already holds, by name, instead of a duplicate", async () => {
    const staged: Staged[] = [];
    const room = open("versionCovenant", bundleOf(), depsWith(staged));
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/Debt Service Coverage of Borrower/);
    await settle();
    expect(lastAsk()).toContain("This relationship already carries a Debt Service Coverage of Borrower covenant");
    expect(lastAsk()).toContain("Attach it to the version, or author a new one?");
    chip(/Attach the Debt Service Coverage of Borrower on file/);
    await settle();

    // AN ATTACH IS DONE ASKING. Nothing below the junction is on its wire, so
    // the room goes straight to the member and files no covenant field.
    expect(lastAsk()).toBe("Which facility on the version does it test?");
    chip(/Equipment/);
    await settle();
    await stagePlan(room);

    const payload = staged[0].payload as StagePayloads["amend-version"];
    expect(payload.covenantAddsJson).toBeUndefined();
    expect(armOf(staged, "covenantAttachesJson")).toEqual([
      { covenantId: "a2XA", targetLoanId: EQUIPMENT_CLONE },
    ]);
  });

  it("explains what it changes, what it does not, and how the test reads today", async () => {
    const room = open("versionCovenant");
    await settle();
    await authorACovenant(room);
    const ready = said().at(-1)!;
    // WHAT IT CHANGES, on which member of which version.
    expect(ready).toContain("This authors a Minimum Liquidity covenant at >= $2.50M");
    expect(ready).toContain("Hartwell - Purchase - $12,000,000.00");
    // WHAT IT DOES NOT.
    expect(ready).toContain(
      "It forks no new version, it takes no credit action, it moves no figure on the booked package behind this one, and it deletes nothing.",
    );
    // AND THE NEXT STEP.
    expect(ready).toContain("Review the plan below, then file it.");
  });

  it("re-tests an attached covenant against the figures on file", async () => {
    open("versionCovenant");
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/Debt Service Coverage of Borrower/);
    await settle();
    chip(/Attach the Debt Service Coverage of Borrower on file/);
    await settle();
    chip(/Equipment/);
    await settle();
    const ready = said().at(-1)!;
    expect(ready).toContain("writes no covenant field");
    expect(ready).toContain("1.38\u00d7 vs \u2265 1.25\u00d7");
    expect(ready).toContain("Salesforce classifies it as");
  });
});

/* =============================================================================
   3. PLEDGE COLLATERAL ON THE VERSION
   ============================================================================= */

describe("pledging collateral to the version", () => {
  it("offers the asset the borrower already owns, by description and lendable value", async () => {
    open("versionPledge");
    await settle();
    pickPackage(VERSION);
    await settle();
    expect(lastAsk()).toMatch(/Which asset are we pledging to .+\?/);
    const chips = [...document.body.querySelectorAll("button.wk-opt")].map((x) => x.textContent ?? "");
    const asset = chips.find((c) => /Kokomo plant/.test(c))!;
    expect(asset).toContain("$6.30M lendable");
    expect(asset).toContain("$9M value");
    expect(chips.some((c) => /File a new asset/.test(c))).toBe(true);
  });

  it("stages ONE pledge of an existing asset, defaulting to its lendable value", async () => {
    const staged: Staged[] = [];
    const room = open("versionPledge", bundleOf(), depsWith(staged));
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/Kokomo plant/);
    await settle();
    // The lendable value leads and is OFFERED. It is the tool's own default.
    expect(lastAsk()).toContain("$6.30M is its lendable value");
    chip(/^\$6\.30M/);
    await settle();
    chip(/Equipment/);
    await settle();
    await stagePlan(room);

    const payload = staged[0].payload as StagePayloads["amend-version"];
    expect(payload.versionPackageId).toBe(VERSION);
    expect(payload.covenantAddsJson).toBeUndefined();
    expect(armOf(staged, "pledgeAddsJson")).toEqual([
      { collateralId: "a35A", amountPledged: 6_300_000, targetLoanId: EQUIPMENT_CLONE },
    ]);
  });

  it("authors a new asset with its advance rate, and the reason the org demands beside it", async () => {
    const staged: Staged[] = [];
    const room = open("versionPledge", bundleOf(), depsWith(staged));
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/File a new asset/);
    await settle();
    chip(/^Equipment/);
    await settle();
    await type(room, "Two Haas VF-4SS machining centres");
    expect(lastAsk()).toBe("What is Two Haas VF-4SS machining centres worth?");
    await type(room, "800000");
    expect(lastAsk()).toContain("What advance rate does the bank lend against");
    expect(lastAsk()).toContain("the plain advance rate on the pledge is a formula");
    await type(room, "50");
    expect(lastAsk()).toContain("The org requires a reason with any advance-rate override");
    await type(room, "Bank policy rate for used machine tools.");
    // The lendable value the room derives is the value at the rate just stated.
    expect(lastAsk()).toContain("$400K is its lendable value");
    chip(/^\$400K/);
    await settle();
    chip(/Purchase/);
    await settle();
    await stagePlan(room);

    expect(armOf(staged, "pledgeAddsJson")).toEqual([
      {
        newCollateral: { description: "Two Haas VF-4SS machining centres", collateralType: "Equipment", value: 800_000 },
        advanceRate: 50,
        advanceRateReason: "Bank policy rate for used machine tools.",
        amountPledged: 400_000,
        targetLoanId: PURCHASE_CLONE,
      },
    ]);
  });

  it("takes an over-pledge only with the authorise flag the org's own rule demands", async () => {
    const staged: Staged[] = [];
    const room = open("versionPledge", bundleOf(), depsWith(staged));
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/Kokomo plant/);
    await settle();
    await type(room, "7,000,000");
    expect(lastAsk()).toContain("$7M is more than the $6.30M this asset is lendable for");
    expect(lastAsk()).toContain("Pledge_More_Than_Lendable_Value");
    chip(/Authorise the over-pledge/);
    await settle();
    chip(/Purchase/);
    await settle();
    await stagePlan(room);

    expect(armOf(staged, "pledgeAddsJson")).toEqual([
      { collateralId: "a35A", amountPledged: 7_000_000, authoriseOverPledge: true, targetLoanId: PURCHASE_CLONE },
    ]);
  });

  it("says what the pledge does to coverage, and what it does not do at all", async () => {
    open("versionPledge");
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/Kokomo plant/);
    await settle();
    chip(/^\$6\.30M/);
    await settle();
    chip(/Equipment/);
    await settle();
    const ready = said().at(-1)!;
    expect(ready).toContain("This pledges the Kokomo plant");
    expect(ready).toContain("Hartwell - Equipment - $1,500,000.00");
    expect(ready).toContain(
      "It forks no new version, it takes no credit action, it moves no figure on the booked package behind this one, and it deletes nothing.",
    );
    /* AN ASSET ALREADY IN THE POOL MOVES NOTHING AT RELATIONSHIP LEVEL, and
       saying otherwise would promise a credit improvement the bank does not
       get. What it lifts is the version facility's own coverage. */
    expect(ready).toContain("already in the relationship's collateral pool of $6.30M");
    expect(ready).toContain("this is cross-collateral");
  });

  it("derives the pool after a NEW asset, and says the arithmetic is the room's", async () => {
    const room = open("versionPledge");
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/File a new asset/);
    await settle();
    chip(/^Equipment/);
    await settle();
    await type(room, "Forklift fleet");
    await type(room, "800000");
    await type(room, "50");
    await type(room, "Bank policy rate.");
    chip(/^\$400K/);
    await settle();
    chip(/Purchase/);
    await settle();
    const ready = said().at(-1)!;
    expect(ready).toContain("adds $400K lendable at the rate you stated, taking it to $6.70M");
    expect(ready).toContain("That is this room's arithmetic over the read");
  });
});

/* =============================================================================
   4. THE TOOL IS REACHED ONCE, AND ONLY THROUGH THE CONFIRM PATH
   ============================================================================= */

describe("the confirm path is the review's own", () => {
  it("stages nothing until the banker puts the plan up", async () => {
    const staged: Staged[] = [];
    const room = open("versionCovenant", bundleOf(), depsWith(staged));
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/^Minimum Liquidity/);
    await settle();
    chip(/must be at least/);
    await settle();
    await type(room, "2,500,000");
    chip(/^Quarterly/);
    await settle();
    chip(/1st of next month/);
    await settle();
    chip(/Purchase/);
    await settle();
    // Every question answered, and the org has not been called.
    expect(staged).toHaveLength(0);
    await stagePlan(room);
    expect(staged).toHaveLength(1);
  });

  it("names the reason from the org's own refusal, verbatim", async () => {
    const staged: Staged[] = [];
    const deps: RelFlowDeps = {
      ...depsWith(staged),
      stage: async () => ({
        ok: false,
        error: {
          code: "VERSION_NOT_EDITABLE",
          message:
            "The version a5Fbb000000JFzREAW has a member at Approval / Loan Committee, so it is no longer editable.",
        },
      }) as ToolOutcome<StagedOutput>,
    };
    const room = open("versionCovenant", bundleOf(), deps);
    await settle();
    pickPackage(VERSION);
    await settle();
    chip(/^Minimum Liquidity/);
    await settle();
    chip(/must be at least/);
    await settle();
    await type(room, "2,500,000");
    chip(/^Quarterly/);
    await settle();
    chip(/1st of next month/);
    await settle();
    chip(/Purchase/);
    await settle();
    await stagePlan(room);
    expect(said().join(" ")).toContain(
      "The version a5Fbb000000JFzREAW has a member at Approval / Loan Committee, so it is no longer editable.",
    );
  });
});
