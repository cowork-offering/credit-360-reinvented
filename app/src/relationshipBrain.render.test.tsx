// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RelationshipRoom, neutralRelAsk, type RelRouter } from "./components/relationship/RelationshipRoom";
import { closeRelationshipRoom } from "./components/relationship/relSession";
import { relContextFor, type RelContext, type RelFlowDeps } from "./components/relationship/reviewFlows";
import type { RelRoute } from "./components/relationship/relRoute";
import type { BrainEnvelope, BrainMail, BrainReply } from "./channel/brainLane";
import { acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import { resetSampleMetrics, sampleTimings } from "./channel/sampleMetrics";
import type { BorrowerBundle, C360Data } from "./data/contract";
import type { ExecuteResult, ToolOutcome } from "./channel/writeTools";
import type { StagedOutput } from "./actions/stagedPlan";

/* =============================================================================
   THE LANE INVERSION, IN THE RELATIONSHIP ROOM.

   The founder's quick test said this room reads "equally mechanical", and it
   read that way for the same reason the facility room did: every line went to
   the step machine, so a question became an answer and a line the step could
   not read became a re-ask.

   THE SAME DISPATCH, in this room's vocabulary. Reads local and first, the step
   machine for a line it can genuinely read, the desk for everything else, and
   the re-ask as the degrade. THE REFUSALS ARE THE POINT HERE: this room's
   honesty is that it names what the org cannot file, and the envelope carries
   that map so an answer refuses the same things by name.

   THE ROOM IS CLOSED AFTER EVERY TEST. `relSession` is a module-global store
   and a room left open bleeds into every test after it.
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
  delete (window as unknown as { claude?: unknown }).claude;
  resetSessionDoor();
  resetSampleMetrics();
});

const PACKAGE = "a5Fbb000000IHFJEA4";

function ctxFor(): RelContext {
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
          productType: "Non-Real Estate",
          name: "Hartwell Precision Manufacturing LLC - Line of Credit - $10,000,000.00",
          committed: 10_000_000,
          outstanding: 6_000_000,
          collateral: [{ collateralId: "a35A", collateralName: "COL-000762", collateralType: "Equipment" }],
        },
      ],
    },
    graph: {
      legalEntities: [{ accountName: "Hartwell Industrial Holdings LLC", borrowerType: "Guarantor" }],
    },
    covenants: {
      covenants: [
        {
          covenantId: "cov1",
          covenantType: "Debt Service Coverage",
          thresholdValue: 1.25,
          actualValue: 1.38,
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

const PLAN: StagedOutput = {
  stagingId: "a8abb00001KtalSAAR",
  planHash: "hash-wxyz",
  decisionToken: "6b3490fc91cfc47256b488c8bd783add",
  summary: "Files an annual credit review at In Progress.",
  steps: [],
  warnings: [],
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

const deps: RelFlowDeps = {
  available: () => true,
  newKey: () => "key-1",
  stage: async () => ({ ok: true, result: PLAN }) as ToolOutcome<StagedOutput>,
  execute: async () => ({ ok: true, result: RESULT }) as ToolOutcome<ExecuteResult>,
};

interface Opened {
  room: HTMLElement;
  bound: Array<{ route: RelRoute; opts?: { say?: string; covenantId?: string | null } }>;
}

function open(args: {
  route?: RelRoute | null;
  routeOpen?: boolean;
  brain?: (e: BrainEnvelope) => Promise<BrainReply>;
  mail?: BrainMail | null;
  mailGate?: boolean;
}): Opened {
  const bound: Opened["bound"] = [];
  const router: RelRouter = {
    question: args.routeOpen ? neutralRelAsk() : null,
    say: null,
    preselectCovenantId: null,
    neutral: () => neutralRelAsk(),
    onBind: (route, opts) => bound.push({ route, opts }),
    onRestart: (route, say) => bound.push({ route, opts: { say } }),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={ctxFor()}
        route={args.route ?? null}
        router={router}
        brain={args.brain}
        deps={deps}
        mail={args.mail ?? null}
        mailGate={args.mailGate ?? true}
        onClose={() => {}}
      />,
    );
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound };
}

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
  await settle();
  await settle();
}

const reply = (r: BrainReply) => vi.fn(async (_envelope: BrainEnvelope) => r);
const CLARIFY: BrainReply = { type: "clarify", text: "Which facility is that question about?" };

/* ---------------------------------------------------------- reads, local */

describe("a read is answered from the book, in this room too", () => {
  it("answers WHILE THE REVIEW QUESTION IS OPEN, and binds nothing (F1)", async () => {
    const brain = reply(CLARIFY);
    const { room, bound } = open({ routeOpen: true, brain });
    await settle();
    await type(room, "which covenants are on this relationship?");

    expect(document.body.querySelectorAll(".wk-read")).toHaveLength(1);
    expect(bound).toHaveLength(0);
    expect(brain).not.toHaveBeenCalled();
    expect(room.textContent).not.toMatch(/Pick one above/);
  });

  it("answers mid-review without advancing the review", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ route: "annual", brain });
    await settle();
    await type(room, "which covenants are on this relationship?");

    expect(document.body.querySelectorAll(".wk-read")).toHaveLength(1);
    expect(brain).not.toHaveBeenCalled();
    // The step is still the live one: a read is not an answer to it.
    expect(room.textContent).toMatch(/Which review is this\?/);
  });
});

/* ---------------------------------------------------------- the fast lane */

describe("a line the live step can read is still the step's", () => {
  it("records the org's own value without troubling the desk", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ route: "annual", brain });
    await settle();
    await type(room, "Annual");

    expect(brain).not.toHaveBeenCalled();
    // The review moved on: the next question is asked.
    expect(room.textContent).toMatch(/State the relationship position/);
  });

  it("takes a line the step CANNOT read to the desk instead of re-asking", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ route: "annual", brain });
    await settle();
    await type(room, "whatever the credit committee decided last time");

    expect(brain).toHaveBeenCalledTimes(1);
    expect(room.textContent).toMatch(/Which facility is that question about\?/);
  });

  it("degrades to the room's own re-ask, exactly as it always did", async () => {
    const { askBrain } = await import("./channel/brainLane");
    const { room } = open({ route: "annual", brain: (e) => askBrain(e, { send: async () => "prose" }) });
    await settle();
    await type(room, "whatever the credit committee decided last time");

    expect(room.textContent).toMatch(/I could not read that as one of the values above/);
  });
});

/* ------------------------------------------------------------ the envelope */

describe("the envelope carries this room's refusals by name", () => {
  it("names what the route cannot file, so an answer cannot invent the capability", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ route: "rating", brain });
    await settle();
    await type(room, "whatever the credit committee decided last time");

    const envelope = brain.mock.calls[0][0] as BrainEnvelope;
    expect(envelope.v).toBe(2);
    expect(envelope.room).toBe("relationship");
    expect(envelope.route).toMatch(/risk-rating review/i);
    const cannot = (envelope.fileable?.cannot ?? []).map((c) => `${c.what} ${c.why}`).join(" ");
    expect(cannot).toMatch(/override/i);
    expect(cannot).toMatch(/facility/i);
    // And the read blocks travel here too: the room is not blind either.
    expect(envelope.reads?.covenants?.length).toBeGreaterThan(0);
    expect(envelope.reads?.notCarried.join(" ")).toMatch(/index name/);
    expect(room.querySelectorAll(".rl-gap")).toHaveLength(0);
  });

  it("names the create gaps while the review question is still open", async () => {
    const brain = reply(CLARIFY);
    const { room } = open({ routeOpen: true, brain });
    await settle();
    await type(room, "the client called about their plans for next quarter");

    const envelope = brain.mock.calls[0][0] as BrainEnvelope;
    expect(envelope.routeOpen).toBe(true);
    expect(envelope.routeOptions).toContain("valuation");
    const cannot = (envelope.fileable?.cannot ?? []).map((c) => c.what).join(" ");
    expect(cannot).toMatch(/covenant authored standalone/);
    expect(cannot).toMatch(/unpledged/);
  });
});

/* --------------------------------------------------- the route, from intent */

describe("the desk may resolve the review, and never binds one itself", () => {
  it("binds the review a reply names, through the room's own router", async () => {
    const brain = reply({ ...CLARIFY, route: "valuation" });
    const { room, bound } = open({ routeOpen: true, brain });
    await settle();
    await type(room, "the appraisal on the equipment came back this morning");

    expect(bound).toEqual([
      { route: "valuation", opts: { say: "the appraisal on the equipment came back this morning" } },
    ]);
  });

  it("leaves the five-way standing where the reply names no review", async () => {
    const brain = reply(CLARIFY);
    const { room, bound } = open({ routeOpen: true, brain });
    await settle();
    await type(room, "the client called about their plans for next quarter");

    expect(bound).toHaveLength(0);
    expect(room.textContent).toMatch(/Which facility is that question about\?/);
  });
});

/* ----------------------------------------------- facility work lives next door */

describe("a change to a facility is not this room's work, whoever proposed it", () => {
  /* WHAT CHANGED ON 2026-09-12 (founder's stress-test pass, fixer item OPEN-4).
     EVERY reply that was not a read-card or a clarify used to be answered with
     the facility handoff, whatever the banker had actually said — so a line
     about the credit committee, inside an annual review, was told that pledging
     security runs next door and the banker's line was thrown away. Golden rule
     4 and 5 both: the answer did not belong to the question, and the live step
     was left two bubbles up the thread.

     The handoff is now GATED on the room's own facility test, the same one the
     typed path takes, so the desk can do nothing a banker could not. What this
     case pins is unchanged and is the part that matters: a proposal NEVER
     becomes a chip in this room. */
  it("never composes a proposal here, and answers it in the room's own subject", async () => {
    const brain = reply({
      type: "delta-proposal",
      action: "loan-modification",
      rationale: "The line could carry another two million.",
      changes: { scalarChangesJson: [{ key: "requestedAmount", value: 12_000_000, targetLoanId: "0Cb1" }] },
    });
    const { room } = open({ route: "annual", brain });
    await settle();
    await type(room, "whatever the credit committee decided last time");

    expect(room.textContent).toMatch(/The line could carry another two million/);
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
    // Nothing was staged, and the review is standing on its own question again.
    expect(room.textContent).toMatch(/Which review is this\?/);
  });

  it("hands facility work next door, before the desk is even asked", async () => {
    const brain = reply({ type: "clarify", text: "?" });
    const { room } = open({ route: "annual", brain });
    await settle();
    await type(room, "pledge the receivables to the line of credit");

    expect(room.textContent).toMatch(/Facility Actions/);
    expect(brain).not.toHaveBeenCalled();
    expect(room.querySelectorAll(".wk-chip")).toHaveLength(0);
  });
});

/* ---------------------------------------------------- channel-none parity */

describe("with no bridge the room is exactly the room that shipped", () => {
  it("re-asks a line the step cannot read, and waits on nothing", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    await type(room, "whatever the credit committee decided last time");

    expect(room.textContent).toMatch(/I could not read that as one of the values above/);
    expect(room.querySelector<HTMLInputElement>(".wk-txt")!.disabled).toBe(false);
  });

  it("repeats the five-way rather than guessing, when the line names no review", async () => {
    const { room, bound } = open({ routeOpen: true });
    await settle();
    await type(room, "the client called about their plans for next quarter");

    expect(bound).toHaveLength(0);
    expect(room.textContent).toMatch(/Pick one above, or name which of the six this is/);
  });

  it("still answers a read from the book", async () => {
    const { room } = open({ route: "annual" });
    await settle();
    await type(room, "which covenants are on this relationship?");

    expect(document.body.querySelectorAll(".wk-read")).toHaveLength(1);
  });
});

/* =============================================================================
   CONSENT RIDES THE GREETING, IN THE SECOND ROOM TOO.

   The platform's consent dialog appears on the FIRST call a view makes, and the
   call waits while the viewer decides. This room never made that call from its
   greeting, so the dialog landed on whatever line happened to narrate first,
   MID-REVIEW, against the SAMPLE-CHANNEL spec's own rule. What these hold is
   that the greeting is the first call, that it is made ONCE, that it is made
   only after both gates, and that a room with no session door renders exactly
   what it rendered before any of this existed.
   ============================================================================= */

/**
 * THE SESSION DOOR at the runtime's own shape.
 *
 * `kind` is the DOOR's own book-keeping and never reaches the page function, so
 * the greeting is counted through `sampleTimings()` the way the sample gate
 * counts it, not through an option the runtime does not carry.
 */
async function installDoor(text: string): Promise<{ prompts: string[] }> {
  const prompts: string[] = [];
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) =>
      name === "sample"
        ? async (input: string, options?: { onText?: (u: { text: string; delta: string }) => void }) => {
            prompts.push(input);
            options?.onText?.({ text, delta: text });
            return { text, truncated: false, modelTierApplied: "quick" };
          }
        : null,
  };
  await act(async () => {
    await acquireSample(50);
  });
  return { prompts };
}

/** How many calls this view made of a given kind. */
const callsOfKind = (kind: string) => sampleTimings().filter((c) => c.kind === kind).length;

const REMARK = [
  "Hartwell's relationship runs six facilities and six covenants, nothing staged yet.",
  "- **Debt Service Coverage**: the tightest ratio on the deal.",
  "- **Risk grade**: on file, and the rating review has not moved it.",
  "Annual review, covenants, collateral, the rating, or a service request?",
].join("\n");

describe("the greeting is the one consent moment", () => {
  it("primes exactly once, and only after the lookup has landed", async () => {
    const door = await installDoor(REMARK);
    const { room } = open({ routeOpen: true, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    expect(callsOfKind("greeting")).toBe(1);
    // The greeting's own sentence framed it: the deterministic greeting plus
    // the question the room is actually asking.
    expect(door.prompts[0]).toContain("Relationship Actions on Hartwell Precision Manufacturing LLC.");
    expect(door.prompts[0]).toContain("Which review are we running on this relationship?");
    expect(room).toBeTruthy();
  });

  it("waits for the mail gate rather than greeting without the client's message", async () => {
    const door = await installDoor(REMARK);
    open({ routeOpen: true, mailGate: false, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    expect(door.prompts).toEqual([]);
    expect(callsOfKind("greeting")).toBe(0);
  });

  it("carries the client's message on the envelope the greeting is grounded in", async () => {
    const door = await installDoor(REMARK);
    const mail: BrainMail = {
      source: "mailbox",
      from: "James Hartwell",
      received: "28 Aug 2026",
      subject: "June covenant compliance certificate",
    };
    open({ routeOpen: true, mail, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    expect(door.prompts[0]).toContain("James Hartwell");
    expect(door.prompts[0]).toContain("June covenant compliance certificate");
    // The mail rides the envelope at TOP LEVEL, never inside `reads`.
    const context = JSON.parse(door.prompts[0].slice(door.prompts[0].lastIndexOf("CONTEXT:") + 8));
    expect(context.mail.from).toBe("James Hartwell");
    expect(context.reads?.mail).toBeUndefined();
    expect(context.reads.notCarried.join(" ")).toContain("thread");
  });

  it("gives the second room its own five-way arm and not the facility room's three", async () => {
    const door = await installDoor(REMARK);
    open({ routeOpen: true, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    expect(door.prompts[0]).toContain("THE ROUTE IS NOT BOUND, AND THIS IS THE RELATIONSHIP ROOM");
    expect(door.prompts[0]).not.toContain("a modification, a renewal or a new facility");
  });

  it("renders the room's own rails beside the model's rows, and none of its own figures", async () => {
    await installDoor(REMARK);
    const { room } = open({ routeOpen: true, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    const rows = [...room.querySelectorAll(".wk-narr-row")];
    expect(rows.length).toBeGreaterThan(0);
    const covenant = rows.find((r) => r.textContent?.includes("Debt Service Coverage"))!;
    // The ROOM wrote this figure, out of the read blocks. The model wrote none.
    expect(covenant.querySelector(".wk-narr-row-v")?.textContent).toBe("1.38× vs ≥ 1.25×");
    // A name the envelope cannot resolve renders as a plain row with no rail.
    const grade = rows.find((r) => r.textContent?.includes("Risk grade"))!;
    expect(grade.querySelector(".wk-narr-row-v")?.textContent).toBe("grade 4");
  });

  it("says nothing at all with no session door, exactly as it did before", async () => {
    const { room } = open({ routeOpen: true, brain: async () => ({ type: "clarify", text: "?" }) as BrainReply });
    await settle();
    expect(room.querySelector(".wk-narr")).toBeNull();
    expect(room.querySelector(".wk-headline")?.textContent).toContain(
      "Relationship Actions on Hartwell Precision Manufacturing LLC.",
    );
  });
});
