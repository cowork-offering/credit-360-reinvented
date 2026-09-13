// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk, type WorkroomRouter } from "./components/workroom/Workroom";
import { clearComposed, type PackageChoice } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { smartOpeningFor } from "./components/workroom/route";
import { mustChoosePackage, packageRoster } from "./book/packages";
import { readIntentDoc } from "./intent/contract";
import { UNREADABLE_CLARIFY } from "./channel/brainLane";
import { acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import { resetCatalog } from "./channel/catalog";
import { RelationshipRoom, neutralRelAsk } from "./components/relationship/RelationshipRoom";
import { closeRelationshipRoom } from "./components/relationship/relSession";
import { relContextFor, relRouteNeedsPackage, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";
import { ACCOUNT_ID, FACILITY_TWO, PACKAGE_ONE, PACKAGE_TWO, withSecondPackage } from "../../scripts/two-package-fixture.mjs";

/* =============================================================================
   MORE THAN ONE PRODUCT PACKAGE.

   Fabian, 2026-09-02, opening Hartwell and reading "the room has opened on a
   $46MM package across six facilities": "by that time we have not even selected
   a Product Package, why does it know that we are talking about this package
   (there is only one but what happens on multiple ones)?"

   WHAT THESE HOLD:

     ONE BINDS      a relationship staging exactly one package is anchored on it
                    without asking, and the room SAYS so on its header line.
                    Proved on a single-package slice of Hartwell (see
                    `hartwellOnePackage` below): the org grew a second package
                    of its own on 2026-09-03, so the shipped book itself is no
                    longer byte-identical to this case.
     SEVERAL ASK    a relationship staging more than one asks FIRST. No route
                    chips, no package card, no facilities, no greeting remark,
                    and a composer that says what it is waiting for.
     THE PICK       binding a package is an anchor call, which re-keys the host
                    and rebuilds the engine on the chosen package.
     THE SCOPE      once anchored, the members, the composer's own menu and the
                    envelope the greeting travels on hold that package alone.
     THE SWITCH     the header line lists every package and switches between
                    them, and REFUSES while a plan is staged.
     THE INTENT     an intent that names a package binds it without asking.

   The fixture is `scripts/two-package-fixture.mjs`: Sterling Fabrication with a
   second package holding one facility still in credit approval. Hartwell's own
   org now carries a real two-package relationship as well (2026-09-03), so
   this branch is no longer purely a synthetic-fixture concern, though the
   Sterling fixture stays the SEVERAL ASK proof below.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetSessionDoor();
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
});

const shipped = live as unknown as C360Data;
const two = withSecondPackage(live) as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";

/** Hartwell's own org grew a second package (2026-09-03): the shipped book is
 *  no longer the "exactly one package" case this file's ONE BINDS tests were
 *  written to prove ("the room has opened on a $46MM package across six
 *  facilities", Fabian's own words above). Proved instead on a single-package
 *  slice of the same relationship: the six originally-booked C&I facilities,
 *  with the new Real Estate package and the Proposal-stage loan removed. */
const HARTWELL_CNI_PACKAGE = "a5Fbb000000IHFJEA4";
const hartwellOnePackage = JSON.parse(JSON.stringify(shipped)) as C360Data;
hartwellOnePackage.borrowers![HARTWELL].exposure!.facilities = (
  shipped.borrowers![HARTWELL].exposure?.facilities ?? []
).filter((f) => f.productPackageId === HARTWELL_CNI_PACKAGE && f.stage === "Booked");

/** The session door at the runtime's own shape, recording every prompt. */
function installSession(): { prompts: string[] } {
  const prompts: string[] = [];
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) =>
      name === "sample"
        ? async (input: string, options?: { onText?: (u: { text: string; delta: string }) => void }) => {
            prompts.push(input);
            const text = "The room read the package.";
            options?.onText?.({ text, delta: text });
            return { text, truncated: false, modelTierApplied: "quick" };
          }
        : null,
  };
  return { prompts };
}

/** The envelope a recorded prompt carried, as `narrate.ts` appends it. */
function envelopeIn(prompt: string): Record<string, unknown> | null {
  const at = prompt.lastIndexOf("\nCONTEXT:\n");
  if (at < 0) return null;
  try {
    return JSON.parse(prompt.slice(at + 10)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface Opened {
  room: HTMLElement;
  anchored: PackageChoice[];
  /** Every package id the memo door was opened on, in order. */
  memoed: Array<string | undefined>;
  /** Every route the banker bound, in order. */
  bound: string[];
}

/** The room, as `WorkroomHost` mounts it: the context resolved through
 *  `workroomContextFor`, so the auto-anchor under test is the shipping one. */
function open(
  args: { data: C360Data; accountId: string; productPackageId?: string; brain?: true; ask?: false; memo?: true } = {
    data: two,
    accountId: ACCOUNT_ID,
  },
): Opened {
  const bundle = args.data.borrowers![args.accountId];
  const accountName = bundle.snapshot!.name!;
  const context = workroomContextFor({
    mode: "modify",
    data: args.data,
    bundle,
    accountId: args.accountId,
    accountName,
    productPackageId: args.productPackageId ?? null,
  });
  const anchored: PackageChoice[] = [];
  const memoed: Array<string | undefined> = [];
  const bound: string[] = [];
  const router: WorkroomRouter = {
    question: args.ask === false ? null : neutralAsk(),
    say: null,
    onBind: (route) => bound.push(route),
    onRestart: () => {},
    onMemo: args.memo ? (productPackageId) => memoed.push(productPackageId) : undefined,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data: args.data, bundle })}
        router={router}
        reads={{ bundle, accountName, productPackageId: context.productPackageId, generatedAt: args.data.meta?.generatedAt }}
        brain={args.brain ? async () => UNREADABLE_CLARIFY : undefined}
        onAnchor={(choice) => anchored.push(choice)}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, anchored, memoed, bound };
}

/** Past the lookup beat. jsdom has no matchMedia, so the room takes the reduced
 *  path and the ritual has already landed; the timers are advanced anyway so the
 *  test does not depend on which path ran. */
const settle = async () => {
  await act(async () => {
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
  });
};

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const rows = (room: HTMLElement, sel: string) => [...room.querySelectorAll(sel)].map((el) => text(el));

describe("the roster", () => {
  it("derives every package on the relationship, with stage, members and commitment", () => {
    const roster = packageRoster(two.borrowers![ACCOUNT_ID]);
    expect(roster.map((p) => p.id)).toEqual([PACKAGE_ONE, PACKAGE_TWO]);

    const [one, second] = roster;
    expect(one.status).toBe("Booked");
    expect(one.booked).toBe(2);
    expect(one.inProgress).toBe(0);
    expect(one.members).toHaveLength(2);
    expect(one.committed).toBe(18_000_000);
    expect(one.line).toBe("Booked · 2 facilities · $18M committed");

    expect(second.status).toBe("In progress");
    expect(second.stage).toBe("Credit Approval");
    expect(second.booked).toBe(0);
    expect(second.inProgress).toBe(1);
    expect(second.members.map((f) => f.loanId)).toEqual([FACILITY_TWO]);
    expect(second.line).toBe("In progress · 1 facility · $6M committed");
  });

  it("is one derivation for both books: no package read exists, so it comes off the facilities", () => {
    // The BAKED bundle and a bundle assembled from the live reads are the same
    // shape (`book/aggregate.ts` builds exactly what `live-data.json` stores),
    // so the roster over an exposure slice alone is the whole derivation.
    const fromExposureOnly = packageRoster({ exposure: two.borrowers![ACCOUNT_ID].exposure } as never);
    expect(fromExposureOnly.map((p) => p.id)).toEqual([PACKAGE_ONE, PACKAGE_TWO]);
  });

  it("one package is not a choice, and none is not either", () => {
    expect(mustChoosePackage(hartwellOnePackage.borrowers![HARTWELL], null)).toBe(false);
    expect(mustChoosePackage(two.borrowers![ACCOUNT_ID], null)).toBe(true);
    // Anchored is answered, however many the relationship stages.
    expect(mustChoosePackage(two.borrowers![ACCOUNT_ID], PACKAGE_TWO)).toBe(false);
    expect(mustChoosePackage(null, null)).toBe(false);
  });

  /* ================== A CREATE IGNORES THE PACKAGE IT WAS OPENED IN

     FOUNDER, 2026-09-06: "a new package needs to be created for a new facility."
     So the room a banker gets from a package tile and the room they get from the
     relationship compose the SAME plan, and the only thing that pins a package
     on a create is the banker choosing one off the offer inside the room. */
  it("anchors a create on the ACCOUNT even where the caller was standing in a package", () => {
    const bundle = two.borrowers![ACCOUNT_ID];
    const args = { data: two, bundle, accountId: ACCOUNT_ID, accountName: "Sterling Fabrication Co." };
    const ambient = workroomContextFor({ ...args, mode: "create", productPackageId: PACKAGE_TWO });
    expect(ambient.productPackageId).toBeNull();
    expect(ambient.door).toBe("account");
    expect(ambient.packageName).toBe("New package");

    // AND A MODIFICATION DOES NOT: there is nothing to reshape without one.
    const modify = workroomContextFor({ ...args, mode: "modify", productPackageId: PACKAGE_TWO });
    expect(modify.productPackageId).toBe(PACKAGE_TWO);
    expect(modify.door).toBe("package");
  });

  it("anchors a create on a package the banker CHOSE, and only then", () => {
    const bundle = two.borrowers![ACCOUNT_ID];
    const joined = workroomContextFor({
      data: two,
      bundle,
      accountId: ACCOUNT_ID,
      accountName: "Sterling Fabrication Co.",
      mode: "create",
      productPackageId: null,
      joinPackageId: PACKAGE_TWO,
    });
    expect(joined.productPackageId).toBe(PACKAGE_TWO);
    expect(joined.door).toBe("package");
    expect(joined.packageName).not.toBe("New package");
  });

  it("does not bind a lone package on a create the way it does on a modification", () => {
    const bundle = hartwellOnePackage.borrowers![HARTWELL];
    const args = { data: hartwellOnePackage, bundle, accountId: HARTWELL, accountName: "Hartwell Precision Manufacturing LLC" };
    expect(workroomContextFor({ ...args, mode: "modify" }).productPackageId).not.toBeNull();
    expect(workroomContextFor({ ...args, mode: "create" }).productPackageId).toBeNull();
  });

  it("refuses to rank a deal signal across packages nobody chose", () => {
    const bundle = two.borrowers![ACCOUNT_ID];
    expect(
      smartOpeningFor({ data: two, bundle, accountName: "Sterling Fabrication Co.", productPackageId: null }),
    ).toBeNull();
    // Anchored, the same call is free to speak again.
    const anchored = smartOpeningFor({
      data: two,
      bundle,
      accountName: "Sterling Fabrication Co.",
      productPackageId: PACKAGE_ONE,
    });
    expect(anchored === null || typeof anchored.line === "string").toBe(true);
  });
});

describe("the room opens", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ONE package binds silently, and the header says why", async () => {
    const { room } = open({ data: hartwellOnePackage, accountId: HARTWELL });
    await settle();

    expect(room.querySelector(".wk-pkgask")).toBeNull();
    // The route question is on the glass, exactly as it is today.
    expect(room.querySelectorAll(".wk-routes .wk-opt").length).toBe(3);
    const line = room.querySelector<HTMLElement>(".wk-pkgline")!;
    expect(line.dataset.pkgline).toBe("a5Fbb000000IHFJEA4");
    expect(text(line)).toContain("Hartwell");
  });

  it("and its six facilities still land once the route is answered", async () => {
    const { room } = open({ data: hartwellOnePackage, accountId: HARTWELL, ask: false });
    await settle();
    expect(room.querySelectorAll(".wk-mchip").length).toBe(6);
  });

  /* RESTATED 0.9.23 (spec 2c.3, founder 2026-09-13). The contract moved, not the
     rule: the room still asks before anything binds and still holds back every
     package-altitude figure, but the ROUTE is the question it asks first,
     because it is the one that says what a package is being picked FOR. The
     package question follows it and is scoped by it, which is the half this
     test now walks. */
  it("MORE THAN ONE asks the ROUTE first, and the package question follows it", async () => {
    const { room } = open();
    await settle();

    // THE ROUTE LEADS, and nothing at package altitude is on the stage with it.
    expect(room.querySelector(".wk-pkgask")).toBeNull();
    expect(room.querySelectorAll(".wk-routes .wk-opt").length).toBe(3);
    expect(room.querySelector(".wk-mchip")).toBeNull();
    expect(room.querySelector(".wk-askpin")).toBeNull();
    expect(room.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe("pending");

    // THE PACKAGE QUESTION IS SECOND, as line items, scoped by the route taken.
    const modify = [...room.querySelectorAll<HTMLElement>(".wk-routes .wk-opt")].find((b) => text(b) === "Modify")!;
    act(() => modify.click());
    await settle();

    const ask = room.querySelector<HTMLElement>(".wk-pkgask")!;
    expect(ask).toBeTruthy();
    expect(ask.getAttribute("role")).toBe("radiogroup");
    const cards = [...ask.querySelectorAll<HTMLElement>(".wk-pkg")];
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.dataset.pkg)).toEqual([PACKAGE_ONE, PACKAGE_TWO]);
    expect(text(cards[0])).toContain("Booked · 2 facilities · $18M committed");
    expect(text(cards[1])).toContain("In progress · 1 facility · $6M committed");
    // Neither package carries a version in flight, so a modification may run
    // against either of them and neither row is closed.
    expect(cards.every((c) => !(c as HTMLButtonElement).disabled)).toBe(true);

    expect(room.querySelector(".wk-routes")).toBeNull();
    expect(room.querySelector(".wk-mchip")).toBeNull();
    expect(text(room.querySelector(".wk-headline"))).toContain("Which package does this run in?");

    // And the composer says which of the two it is waiting on.
    const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Pick the package this runs in.");
  });

  /* THE MEMO'S OWN PACKAGE (spec 2c.3). A memo is about one package version, so the door that
     used to wait behind the package question now carries it: it asks with the review picker and
     opens the memo on the package the banker names, without anchoring this room on it. */
  it("the memo door asks which package the memo is for, and opens it on that one", async () => {
    const { room, anchored, memoed } = open({ data: two, accountId: ACCOUNT_ID, memo: true });
    await settle();

    const door = room.querySelector<HTMLElement>('[data-door="memo"]')!;
    expect(door).toBeTruthy();
    act(() => door.click());
    await settle();

    const ask = room.querySelector<HTMLElement>(".wk-pkgask")!;
    expect(text(ask.querySelector(".wk-pkgask-h"))).toBe("The memo is written about one package. Nothing is staged.");
    const cards = [...ask.querySelectorAll<HTMLButtonElement>(".wk-pkg")];
    expect(cards.map((c) => c.dataset.pkg)).toEqual([PACKAGE_ONE, PACKAGE_TWO]);

    act(() => cards[1].click());
    expect(memoed).toEqual([PACKAGE_TWO]);
    // The memo is not a plan: picking its package never re-anchors this room.
    expect(anchored).toHaveLength(0);
  });

  /* AND A NEW FACILITY ASKS FOR NO PACKAGE AT ALL (spec 2c.3). Its homes are an in-flight version,
     a cockpit-created package still before approval, or a new package, and the create engine's own
     offer is where those are read. The route binds create, and a create room never reaches the
     booked-package question: the gate is the mode itself. */
  it("New facility binds the create route, which never reaches the booked-package question", async () => {
    const { room, bound } = open();
    await settle();

    act(() => [...room.querySelectorAll<HTMLElement>(".wk-routes .wk-opt")].find((b) => text(b) === "New facility")!.click());
    await settle();
    expect(bound).toEqual(["create"]);

    const bundle = two.borrowers![ACCOUNT_ID];
    expect(mustChoosePackage(bundle, null)).toBe(true);
    const created = workroomContextFor({
      mode: "create",
      data: two,
      bundle,
      accountId: ACCOUNT_ID,
      accountName: bundle.snapshot!.name!,
      productPackageId: null,
    });
    expect(created.mode).toBe("create");
    expect(created.productPackageId).toBeNull();
  });

  it("the pick anchors the room on that package and nothing else", async () => {
    const { room, anchored } = open();
    await settle();

    // The route first (spec 2c.3): the package question only exists under one.
    act(() => [...room.querySelectorAll<HTMLElement>(".wk-routes .wk-opt")].find((b) => text(b) === "Modify")!.click());
    await settle();
    act(() => room.querySelectorAll<HTMLElement>(".wk-pkgask .wk-pkg")[1].click());
    expect(anchored).toHaveLength(1);
    expect(anchored[0].id).toBe(PACKAGE_TWO);
    expect(anchored[0].label).toContain("Sterling");
  });
});

describe("once anchored", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the scope holds only that package's facilities", async () => {
    const { room } = open({ data: two, accountId: ACCOUNT_ID, productPackageId: PACKAGE_ONE, ask: false });
    await settle();

    expect(room.querySelector(".wk-pkgask")).toBeNull();
    const members = rows(room, ".wk-mchip");
    expect(members).toHaveLength(2);
    expect(members.join(" ")).not.toContain("Fort Mill");
    expect(room.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe(PACKAGE_ONE);
  });

  it("the composer's menu follows the bound package", async () => {
    const { room } = open({ data: two, accountId: ACCOUNT_ID, productPackageId: PACKAGE_ONE, ask: false });
    await settle();

    act(() => room.querySelector<HTMLElement>(".cp-plus")!.click());
    await settle();
    const level1 = rows(document.body, ".cp-panel .cp-row").join(" | ");
    expect(level1).toContain("Term Loan");
    expect(level1).toContain("Revolver");
    // The other package's facility is not on this room's menu.
    expect(level1).not.toContain("Fort Mill");
    expect(level1).not.toContain("6.0");
  });
});

describe("the greeting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not speak while the package question stands", async () => {
    const session = installSession();
    await act(async () => {
      await acquireSample(50);
    });
    open({ data: two, accountId: ACCOUNT_ID, brain: true });
    await settle();
    await settle();
    expect(session.prompts).toHaveLength(0);
  });

  it("names the package the banker chose, and quotes that package alone", async () => {
    const session = installSession();
    await act(async () => {
      await acquireSample(50);
    });
    open({ data: two, accountId: ACCOUNT_ID, productPackageId: PACKAGE_TWO, brain: true });
    await settle();
    await settle();

    expect(session.prompts.length).toBeGreaterThan(0);
    const envelope = envelopeIn(session.prompts[0])!;
    expect(envelope.productPackageId).toBe(PACKAGE_TWO);
    expect(String(envelope.packageName)).toContain("Sterling");
    // A count is not a name, and the old unanchored label was exactly that.
    expect(String(envelope.packageName)).not.toMatch(/\d+ packages/);
    expect((envelope.facilities as unknown[]).length).toBeLessThanOrEqual(1);
  });
});

describe("switching", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the header line lists every package and switches to the other one", async () => {
    const { room, anchored } = open({ data: two, accountId: ACCOUNT_ID, productPackageId: PACKAGE_ONE });
    await settle();

    act(() => room.querySelector<HTMLElement>(".wk-pkgline")!.click());
    const listed = [...document.querySelectorAll<HTMLElement>("[data-pkgrow]")];
    expect(listed.map((el) => el.dataset.pkgrow)).toEqual([PACKAGE_ONE, PACKAGE_TWO]);
    // The one the room is standing in is marked and not a target.
    expect((listed[0] as HTMLButtonElement).disabled).toBe(true);
    expect(text(listed[0])).toContain("you are here");

    act(() => listed[1].click());
    expect(anchored.map((c) => c.id)).toEqual([PACKAGE_TWO]);
  });

  it("REFUSES while a plan is staged: one package is one plan is one approval", async () => {
    const { room, anchored } = open({ data: two, accountId: ACCOUNT_ID, productPackageId: PACKAGE_ONE, ask: false });
    await settle();

    // Stage one change, and confirm it onto the manifest.
    const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "take the 10M revolver to 12000000");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => room.querySelector(".wk-send")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    await settle();
    const confirm = [...room.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Confirm");
    expect(confirm).toBeTruthy();
    act(() => confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();

    act(() => room.querySelector<HTMLElement>(".wk-pkgline")!.click());
    const other = [...document.querySelectorAll<HTMLElement>("[data-pkgrow]")].find(
      (el) => el.dataset.pkgrow === PACKAGE_TWO,
    )!;
    act(() => other.click());

    expect(anchored).toHaveLength(0);
    expect(text(document.querySelector(".wk-toast"))).toBe("Confirm or drop the staged plan before switching packages");
  });

  it("states the stance for a relationship that stages exactly one", async () => {
    const { room } = open({ data: hartwellOnePackage, accountId: HARTWELL });
    await settle();
    act(() => room.querySelector<HTMLElement>(".wk-pkgline")!.click());
    expect(text(document.querySelector(".wk-cav"))).toContain("the relationship's only package");
  });
});

describe("an intent that names a package", () => {
  it("carries the id when it is a record id, and drops anything else", () => {
    const base = {
      accountId: ACCOUNT_ID,
      accountName: "Sterling Fabrication Co.",
      room: "facility",
      route: "modify",
      lines: ["increase the revolver to 12M"],
    };
    expect(readIntentDoc("i1", { ...base, productPackageId: PACKAGE_TWO })!.productPackageId).toBe(PACKAGE_TWO);
    expect(readIntentDoc("i2", base)!.productPackageId).toBeUndefined();
    expect(readIntentDoc("i3", { ...base, productPackageId: "nope" })!.productPackageId).toBeUndefined();
  });
});

/* ============================================================ the second room

   THE RELATIONSHIP ROOM ASKS NO PACKAGE AT ALL (0.9.24, backlog row 49; founder
   2026-09-13: "covenants and collaterals should be driven from the relationship
   perspective ... never a filter or a narrowing control").

   RESTATED, NOT REMOVED. Until 0.9.23 the covenant review and the collateral
   valuation both carried `productPackageId` on their stage payloads and both
   refused without one, so this block asserted that a relationship staging two
   packages was ASKED which rather than refused. The tools are anchored on the
   account now: the room lists every covenant and every owned asset on the
   relationship and shows the packages on the rows, so the question that used to
   stand here is gone. What these cases pin is that it is gone, that no step is
   gated behind it, and that the header names the relationship instead. */

const REL_DEPS: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: {} as StagedOutput }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: {} as ExecuteResult }) as ToolOutcome<ExecuteResult>,
};

function openRel(args: { route: RelRoute | null; productPackageId?: string }) {
  const bundle = two.borrowers![ACCOUNT_ID];
  const ctx = relContextFor({
    data: two,
    bundle,
    accountId: ACCOUNT_ID,
    accountName: "Sterling Fabrication Co.",
    productPackageId: args.productPackageId ?? null,
  });
  const anchored: string[] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={ctx}
        route={args.route}
        router={{ question: null, say: null, neutral: () => neutralRelAsk(), onBind: () => {}, onRestart: () => {} }}
        deps={REL_DEPS}
        onAnchorPackage={(id) => anchored.push(id)}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, ctx, anchored };
}

describe("the relationship room", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    act(() => closeRelationshipRoom());
    vi.useRealTimers();
  });

  it("knows which routes run against a package, and no review does", () => {
    expect(relRouteNeedsPackage("covenant")).toBe(false);
    expect(relRouteNeedsPackage("valuation")).toBe(false);
    expect(relRouteNeedsPackage("annual")).toBe(false);
    expect(relRouteNeedsPackage("rating")).toBe(false);
    expect(relRouteNeedsPackage("service")).toBe(false);
    // The two version routes are the only ones left: an amendment LANDS ON a
    // package version, which is a choice, not a narrowing.
    expect(relRouteNeedsPackage("versionCovenant")).toBe(true);
    expect(relRouteNeedsPackage("versionPledge")).toBe(true);
  });

  it("asks the covenant review NO package, on a relationship staging two", async () => {
    const { room, ctx } = openRel({ route: "covenant" });
    await settle();

    expect(ctx.packages).toHaveLength(2);
    expect(ctx.productPackageId).toBeNull();
    expect(room.querySelector(".wk-pkgask")).toBeNull();
    expect(text(room)).not.toContain("Which package does this review run in?");
    expect(text(room)).not.toContain("the read stages none for this relationship");
    /* AND THE ROUTE REACHES ITS OWN JUDGEMENT UNDERNEATH, rather than stalling
       on a question the room no longer puts up. This book's covenants carry no
       compliance row, so what stands under the brief is the covenant route's own
       refusal, in its own words, about the whole relationship. */
    expect(text(room)).toContain("no open test period on any of the 3 covenants on this relationship");
  });

  it("asks the collateral valuation no package either", async () => {
    const { room } = openRel({ route: "valuation" });
    await settle();
    expect(room.querySelector(".wk-pkgask")).toBeNull();
  });

  it("a relationship-level review never asks", async () => {
    const { room } = openRel({ route: "annual" });
    await settle();
    expect(room.querySelector(".wk-pkgask")).toBeNull();
    expect(room.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe("none");
  });

  it("names the RELATIONSHIP in the header, never a package it never asked for", async () => {
    const { room } = openRel({ route: "covenant" });
    await settle();
    expect(room.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe("account");
    expect(text(room.querySelector(".wk-pkgline"))).toContain("Sterling Fabrication Co.");
    // A STATEMENT, NOT A CONTROL. There is nothing being narrowed, so there is
    // nothing here to switch.
    expect(room.querySelector(".wk-pkgline")!.tagName).toBe("SPAN");
  });

  it("keeps the package line a control on a route that really does run in one", async () => {
    const { room } = openRel({ route: "annual", productPackageId: PACKAGE_ONE });
    await settle();
    expect(room.querySelector<HTMLElement>(".wk-pkgline")!.dataset.pkgline).toBe(PACKAGE_ONE);
    expect(room.querySelector(".wk-pkgline")!.tagName).toBe("BUTTON");
    expect(text(room.querySelector(".wk-pkgline"))).toContain("Sterling");
  });
});
