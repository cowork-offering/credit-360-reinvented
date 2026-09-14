// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk, type RouterQuestion } from "./components/workroom/Workroom";
import { TIER_EXIT_MS, TIER_STAGGER_MS } from "./components/workroom/entryChoreography";
import { clearComposed, createScriptedEngine } from "./workroom/engine";
import { doorFor } from "./workroom/modes";
import type { WorkroomContext, WorkroomMode } from "./workroom/types";
import {
  RelationshipRoom,
  neutralRelAsk,
  type RelRouter,
  type RelRouterQuestion,
} from "./components/relationship/RelationshipRoom";
import { closeRelationshipRoom } from "./components/relationship/relSession";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";

/* =============================================================================
   THE ENTRY CHOREOGRAPHY.

   Founder, 2026-09-01: entering an action dumped the routing question, the
   package header and the whole facility list in one frame. The room now earns
   its tiers - question, then the identity the action runs against, then the
   thing being decided on - and each arrival retires the tier above it.

   WHAT THESE HOLD, and they are the reason the choreography is not just CSS:

     SEQUENCE      nothing below the question is on the stage while the question
                   stands, and the two tiers under it land in order.
     FADED IS NOT  a tier that left the stage is still MOUNTED and carries
     GONE          data-tier-state="faded". Content that was never earned has no
                   node at all. An absence contract that could not tell those
                   apart would read a retired tier as a deleted one.
     SUMMONABLE    one quiet control brings every faded tier back.
     REDUCED       an instant swap. No leaving beat, nothing animating.
     THE CALM      a read question answered BEFORE the route is picked renders
     STAGE         its card without summoning a single tier.
     ROUTE LOCK    a staged manifest keeps its room, and the choreography never
                   re-hides what is staged.
     BOTH ROOMS    one grammar, the same attributes, the same summon.

   Motion is OFF in jsdom (no matchMedia), which is the reduced-motion path. The
   sequencing blocks stub matchMedia to prove the animated one.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  act(() => closeRelationshipRoom());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  clearComposed();
});

/* ---------------------------------------------------------------- harness */

/** Motion ON: jsdom has no matchMedia, so `prefersReducedMotion` reads true
 *  there and every existing test sees the instant path. The sequence only
 *  exists when motion is on, so it has to be stubbed to be proved. */
function motionOn() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
function motionOff() {
  delete (window as unknown as Record<string, unknown>).matchMedia;
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Past the package lookup and both tier beats, with room to spare. */
const LOOKUP_AND_MORE = 1700;

function contextFor(mode: WorkroomMode = "modify"): WorkroomContext {
  const packageId = "a5Fbb000000IHFJEA4";
  return {
    mode,
    door: doorFor(mode, packageId),
    accountId: "001bb00001DLtRMAA1",
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: packageId,
    packageName: "Hartwell Industrial C&I Credit Package",
    approver: "fabian.goetzens@accenture.com.bankinggpt",
  };
}

function openRoom(question: RouterQuestion | null) {
  const bound: WorkroomMode[] = [];
  const context = contextFor();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createScriptedEngine(context)}
        router={{
          question,
          say: null,
          onBind: (route) => bound.push(route),
          onRestart: () => {},
        }}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound };
}

const tier = (room: HTMLElement, name: string) => room.querySelector<HTMLElement>(`[data-tier="${name}"]`);
const tierState = (room: HTMLElement, name: string) => tier(room, name)?.getAttribute("data-tier-state") ?? null;
const buttons = () => [...document.body.querySelectorAll("button")];
const click = (el: Element | undefined | null) =>
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
/* THE ROUTE IS A DOOR ON THE ENTRY SHEET (0.9.25, founder design-intent gate
   2026-09-14), and the sheet IS the question tier: same `data-tier="question"`
   slot, same arrival, same leaving. The choreography below is untouched; what
   moved is the node the route is taken on. */
const chip = (room: HTMLElement, label: string) =>
  [...room.querySelectorAll<HTMLButtonElement>(".wk-entry-door")].find(
    (d) => d.querySelector(".wk-entry-dl")?.textContent === label,
  );
const summon = (room: HTMLElement) => room.querySelector<HTMLButtonElement>('[data-summon="tiers"]');
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/* ============================================ the facility room, in sequence */

describe("the entry choreography - the tiers arrive one at a time", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  it("opens on the question ALONE: nothing under it is on the stage, or in the document", () => {
    const { room } = openRoom(neutralAsk());
    advance(LOOKUP_AND_MORE);

    expect(tierState(room, "question")).toBe("on");
    // NOT faded, NOT hidden - genuinely not there. The package and the
    // facilities have not been earned, so there is nothing to summon.
    expect(tier(room, "identity")).toBeNull();
    expect(tier(room, "detail")).toBeNull();
    expect(room.querySelector(".wk-pkgs")).toBeNull();
    expect(room.querySelector(".wk-mchips")).toBeNull();
    // And the question is readable, which is the whole point of the calm stage.
    // RESTATED 2026-09-14: the doors ask it, so what is read is the doors.
    expect([...room.querySelectorAll(".wk-entry-door .wk-entry-dl")].map((n) => n.textContent)).toEqual([
      "Modify",
      "Renew",
      "New facility",
    ]);
  });

  it("blends the package identity in when the route is picked, and the question leaves", () => {
    const { room, bound } = openRoom(neutralAsk());
    advance(LOOKUP_AND_MORE);
    click(chip(room, "Modify"));
    expect(bound).toEqual(["modify"]);

    expect(tierState(room, "identity")).toBe("on");
    expect(room.querySelector(".wk-pkgs")).toBeTruthy();
    // The tier above shimmers out rather than cutting. It is still laid out
    // while it does, which is what "no hard cuts" means in the DOM.
    expect(tierState(room, "question")).toBe("leaving");
    expect(tier(room, "question")!.className).toContain("wk-tier-out");
    // The facilities are the NEXT beat, not this one.
    expect(tier(room, "detail")).toBeNull();
  });

  it("blends the facilities in a beat later, and the identity leaves in its turn", () => {
    const { room } = openRoom(neutralAsk());
    advance(LOOKUP_AND_MORE);
    click(chip(room, "Modify"));
    // The exit completes before the next tier lands: the question is off stage,
    // the identity is still on it, and the facilities are still on their beat.
    advance(TIER_EXIT_MS + 20);
    expect(tierState(room, "question")).toBe("faded");
    expect(tierState(room, "identity")).toBe("on");
    expect(tier(room, "detail")).toBeNull();

    advance(TIER_STAGGER_MS - TIER_EXIT_MS);
    expect(tierState(room, "detail")).toBe("on");
    expect(room.querySelector(".wk-mchips")).toBeTruthy();
    expect(tierState(room, "identity")).toBe("leaving");
    advance(TIER_EXIT_MS + 20);
    expect(tierState(room, "identity")).toBe("faded");
    // The tier the banker is deciding on is the only one on the stage.
    expect(tierState(room, "detail")).toBe("on");
  });

  it("staggers the facilities rather than dropping them as a block", () => {
    const { room } = openRoom(null);
    // Two beats, two flushes: the facilities' own timer is only scheduled once
    // React has processed the lookup landing.
    advance(LOOKUP_AND_MORE);
    advance(TIER_STAGGER_MS);
    const delays = [...room.querySelectorAll<HTMLElement>(".wk-mchip")].map((b) => b.style.animationDelay);
    expect(delays.length).toBeGreaterThan(1);
    expect(delays[0]).toBe("0ms");
    expect(delays[1]).toBe("45ms");
    // Capped, so a long package never feels sluggish.
    expect(delays.every((d) => Number.parseInt(d, 10) <= 320)).toBe(true);
  });

  it("runs the same sequence on a room opened with the route already bound", () => {
    // The cmdk row and the deep link both open bound. There is no question to
    // answer, but the grammar is the same one: the opening bubble is still the
    // tier above the package, and it still leaves when the package arrives.
    const { room } = openRoom(null);
    advance(LOOKUP_AND_MORE);
    expect(tierState(room, "identity")).toBe("on");
    expect(tierState(room, "question")).not.toBe("on");
    advance(TIER_STAGGER_MS + TIER_EXIT_MS + 20);
    expect(tierState(room, "detail")).toBe("on");
    expect(tierState(room, "identity")).toBe("faded");
  });
});

/* ================================================= faded out, never deleted */

describe("the entry choreography - a faded tier is summonable, not gone", () => {
  it("keeps every retired tier in the document, hidden from the reading order", () => {
    const { room } = openRoom(null);
    // Reduced motion: the swap is instant, so both upper tiers are already off.
    expect(tierState(room, "question")).toBe("faded");
    expect(tierState(room, "identity")).toBe("faded");
    expect(tierState(room, "detail")).toBe("on");

    for (const name of ["question", "identity"]) {
      const node = tier(room, name)!;
      expect(document.body.contains(node)).toBe(true);
      expect(node.getAttribute("aria-hidden")).toBe("true");
      expect(node.className).toContain("wk-tier-gone");
    }
    // The package card and the greeting are STILL THERE, which is the whole
    // difference between this and an unmount.
    expect(room.querySelector(".wk-pkgs")).toBeTruthy();
    expect(room.querySelector(".wk-headline")).toBeTruthy();
  });

  it("offers one quiet summon, and it brings them all back", () => {
    const { room } = openRoom(null);
    const control = summon(room)!;
    expect(control).toBeTruthy();
    expect(control.textContent).toBe("↑ show what the room read (2)");
    expect(control.getAttribute("aria-expanded")).toBe("false");

    click(control);
    for (const name of ["question", "identity"]) {
      const node = tier(room, name)!;
      expect(node.getAttribute("data-tier-state")).toBe("summoned");
      expect(node.hasAttribute("aria-hidden")).toBe(false);
      expect(node.className).not.toContain("wk-tier-gone");
    }
    expect(summon(room)!.textContent).toBe("↓ hide what the room read");
    expect(summon(room)!.getAttribute("aria-expanded")).toBe("true");

    // And it puts them back, because a summon that could not be taken back
    // would just be the dump again with an extra click in front of it.
    click(summon(room));
    expect(tierState(room, "identity")).toBe("faded");
  });

  it("offers no summon while the stage is still calm", () => {
    // Nothing has left, so there is nothing to bring back. A control that would
    // reveal an empty set has no business on the glass.
    const { room } = openRoom(neutralAsk());
    expect(summon(room)).toBeNull();
  });
});

/* ================================================== the reduced-motion path */

describe("the entry choreography - reduced motion is an instant swap", () => {
  it("never renders a leaving state, and never animates a tier out", () => {
    // jsdom has no matchMedia, so this is the reduced path by construction.
    const { room } = openRoom(neutralAsk());
    click(chip(room, "Modify"));
    for (const name of ["question", "identity", "detail"]) {
      expect(tierState(room, name)).not.toBe("leaving");
      expect(tier(room, name)?.className ?? "").not.toContain("wk-tier-out");
    }
    // Everything landed on the same tick: no beat was waited on.
    expect(tierState(room, "detail")).toBe("on");
    expect(room.querySelector(".wk-mchips")).toBeTruthy();
  });

  it("still earns the tiers in order: the question alone until it is answered", () => {
    const { room } = openRoom(neutralAsk());
    expect(tier(room, "identity")).toBeNull();
    expect(tier(room, "detail")).toBeNull();
    click(chip(room, "Modify"));
    expect(tier(room, "identity")).toBeTruthy();
    expect(tier(room, "detail")).toBeTruthy();
  });
});

/* ================================================= the read on a calm stage */

describe("the entry choreography - a read answers on the question-only stage", () => {
  it("renders the card without summoning a single tier", async () => {
    const { room, bound } = openRoom(neutralAsk());
    const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "which borrowers are on this package");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    // A read binds no engine (F1) and it earns no tier: the package card and
    // the facilities are still unwritten.
    expect(bound).toEqual([]);
    expect(tier(room, "identity")).toBeNull();
    expect(tier(room, "detail")).toBeNull();
    expect(summon(room)).toBeNull();
    // The question is still standing, still on the stage, still answerable.
    expect(tierState(room, "question")).toBe("on");
    // RESTATED 2026-09-14: the sheet asks the question, so the doors are what
    // the banker reads while the tier is on the stage.
    expect(room.querySelector(".wk-entry-door[data-door='modify']")).toBeTruthy();
  });
});

/* ======================================================= the route lock */

describe("the entry choreography - a staged manifest keeps its room", () => {
  it("never re-hides staged content behind a tier", async () => {
    const { room } = openRoom(null);
    click(buttons().find((b) => /liquidity covenant/.test(b.textContent ?? "")));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    const rail = room.querySelectorAll(".wk-col-r .wk-ent");
    expect(rail.length).toBeGreaterThan(0);
    // The lane is not a tier and never leaves the stage on a tier's account.
    for (const entry of rail) expect(entry.closest("[data-tier]")).toBeNull();
    expect(room.querySelector(".wk-col-r")).toBeTruthy();
  });

  it("goes straight past the question when a manifest survived the last close", async () => {
    // The room binds its own route on resume (rule 4), so the choreography must
    // read that as an answered question and move to the tiers below it rather
    // than parking the banker on a decision that was already made.
    const first = openRoom(null);
    click(buttons().find((b) => /liquidity covenant/.test(b.textContent ?? "")));
    await settle();
    for (const b of buttons().filter((x) => x.textContent === "Confirm")) {
      click(b);
      await settle();
    }
    expect(first.room.querySelectorAll(".wk-col-r .wk-ent").length).toBeGreaterThan(0);
    act(() => root?.unmount());
    container?.remove();

    const { room, bound } = openRoom(neutralAsk());
    expect(bound).toEqual(["modify"]);
    expect(room.textContent).toContain("Picking up where you left off");
    expect(tierState(room, "detail")).toBe("on");
    expect(tierState(room, "question")).toBe("faded");
    expect(room.querySelectorAll(".wk-col-r .wk-ent").length).toBeGreaterThan(0);
  });
});

/* ============================================= the relationship room, same */

const PACKAGE = "a5Fbb000000IHFJEA4";

function relCtx(): RelContext {
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
      facilities: [{ loanId: "0Cb1", status: "Active", productPackageId: PACKAGE, committed: 10_000_000 }],
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
  const data = {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({ data, bundle, accountId: "001X", accountName: "Hartwell Precision Manufacturing LLC" });
}

const REL_DEPS: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: {} as StagedOutput }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: {} as ExecuteResult }) as ToolOutcome<ExecuteResult>,
};

function openRel(args: { route?: RelRoute | null; question?: RelRouterQuestion | null }) {
  const bound: RelRoute[] = [];
  const router: RelRouter = {
    question: args.question ?? null,
    say: null,
    neutral: () => neutralRelAsk(),
    onBind: (route) => bound.push(route),
    onRestart: () => {},
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={relCtx()}
        route={args.route ?? null}
        router={router}
        deps={REL_DEPS}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound };
}

describe("the entry choreography - the relationship room speaks the same grammar", () => {
  it("opens on the question ALONE, with the scope and the first step unearned", () => {
    const { room } = openRel({ question: neutralRelAsk() });
    expect(tierState(room, "question")).toBe("on");
    expect(tier(room, "identity")).toBeNull();
    expect(tier(room, "detail")).toBeNull();
    expect(room.querySelector(".rl-brief")).toBeNull();
    expect(summon(room)).toBeNull();
  });

  it("earns the scope, then the first question, retiring each tier above", () => {
    const { room } = openRel({ route: "annual" });
    expect(room.querySelector(".rl-brief")).toBeTruthy();
    expect(tierState(room, "identity")).toBe("faded");
    expect(tierState(room, "question")).toBe("faded");
    expect(tierState(room, "detail")).toBe("on");
  });

  it("keeps the retired tiers mounted and summonable, with the same words", () => {
    const { room } = openRel({ route: "annual" });
    const control = summon(room)!;
    expect(control.textContent).toBe("↑ show what the room read (2)");
    expect(room.querySelector(".rl-brief")).toBeTruthy();
    expect(tier(room, "identity")!.getAttribute("aria-hidden")).toBe("true");

    click(control);
    expect(tierState(room, "identity")).toBe("summoned");
    expect(tierState(room, "question")).toBe("summoned");
    expect(tier(room, "identity")!.hasAttribute("aria-hidden")).toBe(false);
  });

  it("holds the scope on the stage for a beat before the first question takes it", () => {
    motionOn();
    vi.useFakeTimers();
    try {
      const { room } = openRel({ route: "annual" });
      advance(LOOKUP_AND_MORE);
      expect(tierState(room, "identity")).toBe("on");
      expect(tier(room, "detail")).toBeNull();
      advance(TIER_STAGGER_MS + TIER_EXIT_MS + 20);
      expect(tierState(room, "detail")).toBe("on");
      expect(tierState(room, "identity")).toBe("faded");
    } finally {
      vi.useRealTimers();
      motionOff();
    }
  });

  it("answers a read on the calm stage without earning a tier", async () => {
    const { room, bound } = openRel({ question: neutralRelAsk() });
    const input = room.querySelector<HTMLInputElement>(".wk-txt")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "which covenants are on this relationship");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    expect(bound).toEqual([]);
    expect(tier(room, "identity")).toBeNull();
    expect(tier(room, "detail")).toBeNull();
    expect(tierState(room, "question")).toBe("on");
  });
});
