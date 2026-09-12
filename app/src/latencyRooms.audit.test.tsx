// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom, neutralAsk } from "./components/workroom/Workroom";
import {
  bindFacilityRoute,
  closeFacilityRoom,
  openFacilityRoom,
  useFacilityRoom,
} from "./components/workroom/roomSession";
import { RelationshipRoom, neutralRelAsk, type RelRouter } from "./components/relationship/RelationshipRoom";
import { closeRelationshipRoom } from "./components/relationship/relSession";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import { clearComposed, createScriptedEngine } from "./workroom/engine";
import { doorFor } from "./workroom/modes";
import { AppProvider, useApp } from "./state/appState";
import { KpiBand } from "./components/KpiBand";
import { MAIL_GATE_MS } from "./components/workroom/clientMail";
import type { WorkroomContext, WorkroomMode } from "./workroom/types";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { StagedOutput } from "./actions/stagedPlan";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";

/* =============================================================================
   THE ROOMS' OWN LATENCY, PINNED.

   Founder, 2026-09-12: "i would love it to be 110% zero latency and smooth
   transitions etc in all workrooms and chats." The measured audit behind these
   numbers (L1, against the released 0.9.18 bundle at a 500 ms relay):

     satellite click -> room root painted        15 to 97 ms
     satellite click -> COMPOSER ENABLED         1,544 to 1,568 ms (facility)
                                                 1,539 to 1,599 ms (relationship)
     "Renew" chip    -> composer enabled AGAIN   1,516 to 1,568 ms
     "Modify" chip   -> composer enabled again   60 ms

   Nothing was being read in that window. The room's own mailbox read resolves
   in ~508 ms, in parallel, and the six detail reads landed on the account open.
   A fixed 1,500 ms timer with no work behind it is not a ritual, it is a wait.

   WHAT THESE HOLD:

     THE FLOOR      the lookup is still SEEN to happen: 400 ms minimum, so a
                    room whose gate was open on the first tick still shimmers.
     THE REAL WAIT  past the floor the shimmer tracks the mail gate the greeting
                    is already blocked on, to the millisecond.
     THE CEILING    a mailbox that never answers cannot hold the composer past
                    the old 1,500 ms beat.
     ONCE           binding a route rebuilds the room on the new engine, and the
                    rebuilt room does not charge the banker for the ritual twice.
     THE FLOOR      the composed beat is a floor on an ANSWER, so a deterministic
     THAT FOLLOWS   parse that took 2 ms gets one paced beat, not 460 ms; the
     THE LANE       full floor is kept for a desk round trip, which is what it
                    was written for.
     WHICH SILENCE  the thinking mark says whether the desk is still reading or
                    has started writing.

   Motion is OFF in jsdom (no matchMedia), which is the reduced-motion path and
   lands the whole ritual in one commit. Every block here stubs matchMedia to
   prove the animated one, because that is the path a banker is on.
   ============================================================================= */

const hoisted = vi.hoisted(() => ({
  /** Is there a connector? Off means `useClientMail` opens its gate on the
   *  first tick, which is the no-connector case and the common one in a test. */
  mcpOn: false,
  /** The mailbox read, held open so a test can decide when the gate resolves. */
  mailbox: null as Promise<{ hits: unknown[] }> | null,
  /** The live open, held open so the test can prove the band navigated BEFORE
   *  the aggregate settled. */
  onOpen: null as (() => void) | null,
  settleOpen: null as ((ok: boolean) => void) | null,
}));

vi.mock("./channel/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./channel/mcp")>()),
  mcpAvailable: () => hoisted.mcpOn,
}));

vi.mock("./book/dynamicBook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./book/dynamicBook")>()),
  openAccountLive: (args: { onOpen?: () => void }) =>
    new Promise<boolean>((resolve) => {
      hoisted.onOpen = () => args.onOpen?.();
      hoisted.settleOpen = resolve;
    }),
  announce: () => {},
}));

vi.mock("./channel/cockpitTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./channel/cockpitTools")>()),
  searchMailbox: () => hoisted.mailbox ?? Promise.resolve({ hits: [] }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  act(() => closeFacilityRoom());
  act(() => closeRelationshipRoom());
  container?.remove();
  root = null;
  container = null;
  document.body.className = "";
  clearComposed();
  hoisted.mcpOn = false;
  hoisted.mailbox = null;
});

/* ---------------------------------------------------------------- harness */

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

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** A mailbox read the test resolves by hand. */
function heldMailbox() {
  let open!: () => void;
  hoisted.mcpOn = true;
  hoisted.mailbox = new Promise((resolve) => {
    open = () => resolve({ hits: [] });
  });
  return async () => {
    open();
    await settle();
  };
}

const ACCOUNT = "001bb00001DLtRMAA1";
const ACCOUNT_NAME = "Hartwell Precision Manufacturing LLC";
const PACKAGE = "a5Fbb000000IHFJEA4";

function contextFor(mode: WorkroomMode = "modify"): WorkroomContext {
  return {
    mode,
    door: doorFor(mode, PACKAGE),
    accountId: ACCOUNT,
    accountName: ACCOUNT_NAME,
    productPackageId: PACKAGE,
    packageName: "Hartwell Industrial C&I Credit Package",
    approver: "fabian.goetzens@accenture.com.bankinggpt",
  };
}

/** The one thing every measurement below reads: is the room taking an
 *  instruction yet? Same input the banker types into. */
const composer = () => document.querySelector<HTMLInputElement>(".wk-composer .wk-txt");
/** React tracks the input's value on the node, so a bare assignment is
 *  swallowed as a no-op change. The native setter is what a real keystroke
 *  moves. */
const nativeValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
const type = async (text: string) => {
  const input = composer()!;
  await act(async () => {
    nativeValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const asleep = () => composer()?.disabled ?? true;
const mark = () => document.querySelector<HTMLElement>(".wk-compose");

function openRoom(args?: {
  brain?: (envelope: BrainEnvelope, opts?: { onFirstToken?: () => void }) => Promise<BrainReply>;
  /** Null is a BOUND room: the route question is answered, so a typed line goes
   *  to the lanes rather than to the binder. */
  bound?: boolean;
}) {
  const context = contextFor();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createScriptedEngine(context)}
        router={{ question: args?.bound ? null : neutralAsk(), say: null, onBind: () => {}, onRestart: () => {} }}
        brain={args?.brain}
        onClose={() => {}}
      />,
    );
  });
}

/* ================================================== A1, the facility room */

describe("A1 - the lookup shimmers for as long as the room is actually waiting", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  it("holds the floor: a gate open at 120 ms still enables the composer at 400 ms", async () => {
    const openGate = heldMailbox();
    openRoom();
    expect(asleep()).toBe(true);

    advance(120);
    await openGate();
    // THE RITUAL IS STILL A RITUAL. The room does not snap awake the instant
    // the mailbox answers; the lookup is seen to happen.
    expect(asleep()).toBe(true);

    advance(279);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
  });

  it("tracks the real wait: a gate that resolves at 900 ms lands at 900 ms", async () => {
    const openGate = heldMailbox();
    openRoom();

    // Past the floor, and still reading: the shimmer is honest here.
    advance(400);
    expect(asleep()).toBe(true);
    advance(499);
    expect(asleep()).toBe(true);

    advance(1);
    await openGate();
    expect(asleep()).toBe(false);
  });

  it("cannot be held past the mail gate's own cap by a mailbox that never answers", () => {
    heldMailbox(); // never opened
    openRoom();

    /* THE GATE HAS A CEILING OF ITS OWN. `useClientMail` opens on
       MAIL_GATE_MS (1,200) whatever the read does, so the room lands there
       rather than on the lookup's 1,500 ms backstop: the shimmer tracks the
       wait, and the wait is over at 1,200. The backstop is proved on the
       relationship room below, where the gate is a prop and can genuinely
       never resolve. */
    advance(MAIL_GATE_MS - 1);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
    expect(MAIL_GATE_MS).toBeLessThan(1500);
  });

  it("with no connector the gate is open on the first tick, so the room lands on the floor", () => {
    openRoom();
    advance(399);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
  });
});

describe("A1 - the relationship room, same clock", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  const rerenderRel = (mailGate: boolean) =>
    act(() => {
      root!.render(relElement(mailGate));
    });

  function relElement(mailGate: boolean) {
    const router: RelRouter = {
      question: neutralRelAsk(),
      say: null,
      neutral: () => neutralRelAsk(),
      onBind: () => {},
      onRestart: () => {},
    };
    return (
      <RelationshipRoom ctx={relCtx()} route={null} router={router} deps={REL_DEPS} mailGate={mailGate} onClose={() => {}} />
    );
  }

  function openRel(mailGate: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(relElement(mailGate));
    });
  }

  it("holds the floor: a gate open at 120 ms still enables the composer at 400 ms", () => {
    openRel(false);
    advance(120);
    rerenderRel(true);
    expect(asleep()).toBe(true);
    advance(279);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
  });

  it("tracks the real wait: a gate that resolves at 900 ms lands at 900 ms", () => {
    openRel(false);
    advance(899);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(true);
    rerenderRel(true);
    expect(asleep()).toBe(false);
  });

  it("keeps the 1,500 ms ceiling", () => {
    openRel(false);
    advance(1499);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
  });
});

/* ============================== A2, the second shimmer on renew / new facility */

/** The host's own shape: the room is KEYED on the mode, so binding a route
 *  remounts it. That remount is load-bearing (one session is one engine is one
 *  plan) and nothing here removes it. */
function BoundRoom() {
  const session = useFacilityRoom();
  const mode = (session?.route ?? "modify") as WorkroomMode;
  const context = useMemo(() => contextFor(mode), [mode]);
  const engine = useMemo(() => createScriptedEngine(context), [context]);
  if (!session) return null;
  return (
    <Workroom
      key={`${context.mode}-${context.door}-${context.accountId}-${context.productPackageId}`}
      context={context}
      engine={engine}
      router={{
        question: session.bound ? null : neutralAsk(),
        say: session.say,
        onBind: (route) => bindFacilityRoute(route),
        onRestart: () => {},
      }}
      onClose={() => {}}
    />
  );
}

describe("A2 - binding a route does not charge the banker for the ritual twice", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  const openBound = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => openFacilityRoom({ accountId: ACCOUNT, accountName: ACCOUNT_NAME, opening: null, productPackageId: PACKAGE }));
    act(() => {
      root!.render(<BoundRoom />);
    });
  };

  it("enables the composer within a frame of binding 'renew' after the provisional 'modify'", () => {
    openBound();
    advance(400);
    expect(asleep()).toBe(false);

    // The gesture the founder's drive measured at 1,516 to 1,568 ms.
    act(() => bindFacilityRoute("renew"));
    // The room DID remount - a new engine, a new key - and it is awake on the
    // same tick. No timer is advanced between these two lines.
    expect(asleep()).toBe(false);
    advance(100);
    expect(asleep()).toBe(false);
  });

  it("still shimmers for a room the banker opened fresh on the same relationship", () => {
    openBound();
    advance(400);
    act(() => bindFacilityRoute("renew"));
    expect(asleep()).toBe(false);

    // A CLOSE ENDS THE SESSION, and the ritual is per session.
    act(() => closeFacilityRoom());
    act(() => openFacilityRoom({ accountId: ACCOUNT, accountName: ACCOUNT_NAME, opening: null, productPackageId: PACKAGE }));
    expect(asleep()).toBe(true);
    advance(399);
    expect(asleep()).toBe(true);
    advance(1);
    expect(asleep()).toBe(false);
  });
});

/* ======================================================= B3, the compose floor */

describe("B3 - the composed beat follows the lane that answered", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  const send = async (text: string) => {
    await type(text);
    const input = composer()!;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
  };

  it("lands a deterministic answer on one paced beat, not on the full floor", async () => {
    openRoom({ bound: true });
    advance(400);
    await send("raise the revolver to 15 million");
    expect(mark()).toBeTruthy();

    advance(149);
    await settle();
    expect(mark()).toBeTruthy();
    advance(1);
    await settle();
    expect(mark()).toBeNull();
  });

  it("keeps the full floor where the desk was asked", async () => {
    const desk = async (): Promise<BrainReply> => ({ type: "clarify", text: "Which facility?", options: [] });
    openRoom({ brain: desk, bound: true });
    advance(400);
    // Off the storyline rails, so the parse is unusable and the desk answers.
    await send("what does the group look like these days");
    expect(mark()).toBeTruthy();

    advance(459);
    await settle();
    expect(mark()).toBeTruthy();
    advance(1);
    await settle();
    expect(mark()).toBeNull();
  });
});

/* ================================================= B2, the first-token mark */

describe("B2 - the mark says which half of the silence this is", () => {
  beforeEach(() => {
    motionOn();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    motionOff();
  });

  it("moves from reading to writing when the session door reports its first token", async () => {
    let fire: (() => void) | null = null;
    const desk = (_envelope: BrainEnvelope, opts?: { onFirstToken?: () => void }): Promise<BrainReply> =>
      new Promise((resolve) => {
        fire = () => {
          opts?.onFirstToken?.();
          resolve({ type: "clarify", text: "Which facility?", options: [] });
        };
      });

    openRoom({ brain: desk, bound: true });
    advance(400);
    await type("what does the group look like these days");
    await act(async () => {
      composer()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(mark()!.getAttribute("data-desk")).toBe("reading");
    expect(mark()!.textContent).toContain("Composing");

    await act(async () => {
      fire!();
      await Promise.resolve();
    });
    expect(mark()!.getAttribute("data-desk")).toBe("writing");
    expect(mark()!.textContent).toContain("Writing");
  });
});

/* ------------------------------------------------- the relationship fixture */

function relCtx(): RelContext {
  const bundle = {
    snapshot: {
      accountId: ACCOUNT,
      name: ACCOUNT_NAME,
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
    borrowers: { [ACCOUNT]: bundle },
  } as unknown as C360Data;
  return relContextFor({ data, bundle, accountId: ACCOUNT, accountName: ACCOUNT_NAME });
}

const REL_DEPS: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: {} as StagedOutput }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: {} as ExecuteResult }) as ToolOutcome<ExecuteResult>,
};

/* ============================================== A3, the KPI band's navigation */

/** A relationship ON THE QUEUE with no baked bundle, which is the only row that
 *  takes the live-open path. */
function bandData(): C360Data {
  return {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: {
      accounts: [
        {
          accountId: "001LIVE0000000001",
          name: "Brightwater Foods Holdings",
          industry: "Food Manufacturing",
          naicsCode: "3119",
          tce: 12_000_000,
          outstanding: 8_000_000,
        },
      ],
      signals: { covenantsDueSoon: [], maturitiesSoon: [], breachedCount: 0 },
    },
    borrowers: {},
    worklist: { accountIds: ["001LIVE0000000001"], reasons: { "001LIVE0000000001": ["COVENANT_DUE"] } },
  } as unknown as C360Data;
}

/** The view, watched. `OPEN_ACCOUNT` is what the band dispatches, and this is
 *  the only honest way to see it land from outside the provider. */
const opens: string[] = [];
function ViewProbe() {
  const { state } = useApp();
  useEffect(() => {
    if (state.view !== "account" || !state.accountId) return;
    if (opens[opens.length - 1] === state.accountId) return;
    opens.push(state.accountId);
  }, [state.view, state.accountId]);
  return null;
}

describe("A3 - the KPI band switches the view the moment the relationship is navigable", () => {
  afterEach(() => {
    opens.length = 0;
  });

  it("dispatches OPEN_ACCOUNT on onOpen, not on the aggregate's resolve", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <AppProvider data={bandData()}>
          <KpiBand />
          <ViewProbe />
        </AppProvider>,
      );
    });

    const cell = [...document.querySelectorAll('[role="button"]')].find((b) => /Needs action/.test(b.textContent ?? ""));
    expect(cell).toBeTruthy();
    act(() => cell!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    // The connector arrives before the gesture: the popover is already painted,
    // and `openFromSheet` reads the capability at click time.
    hoisted.mcpOn = true;
    const cta = [...document.querySelectorAll("button")].find((b) => /^Start /.test(b.textContent ?? ""));
    expect(cta).toBeTruthy();
    await act(async () => {
      cta!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    // The relationship is registered and navigable; the aggregate has NOT
    // resolved, because the relationship graph is still in flight.
    expect(opens).toHaveLength(0);
    await act(async () => {
      hoisted.onOpen!();
      await Promise.resolve();
    });
    // The band navigated on that, which is the whole of this fix. Before it,
    // this dispatch sat in `.then()` and cost the banker the graph's wave.
    expect(opens).toEqual(["001LIVE0000000001"]);
    await act(async () => {
      hoisted.settleOpen!(true);
      await Promise.resolve();
    });
    // And the resolve does not navigate a second time.
    expect(opens).toEqual(["001LIVE0000000001"]);
  });
});
