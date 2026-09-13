// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Workroom } from "./components/workroom/Workroom";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine } from "./workroom/modifyEngine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { NEUTRAL_QUESTION, ROUTE_CHIPS } from "./components/workroom/route";
import type { BrainEnvelope, BrainReply } from "./channel/brainLane";
import { READ_DOORS } from "./channel/brainTools";
import { resetCatalog } from "./channel/catalog";
import { acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE PARSER STAGES, THE MODEL SPEAKS — in the room.

   THE CARD IS THE FACT AND THE SENTENCE IS THE JUDGMENT. What these hold is
   that the remark lands UNDER the room's own components and never instead of
   them, that a remark failing leaves the deterministic sentence exactly where
   it was, that no markdown character reaches the glass, and that a room with no
   session door renders precisely what it rendered before any of this existed.

   THE FOUR CHANNELS, each still rendering through the room's own components:
   a read-card through the read card, a delta-proposal through the parser's own
   chips, a clarify as an agent bubble with option chips, and the remark as an
   agent bubble beside whichever of them just landed.
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

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";

/** The session door, stubbed at the runtime's own shape. `text` is what the
 *  model writes; a rejection is any of the ways the door can fail. */
function installSession(answer: () => Promise<string>): { calls: string[] } {
  const calls: string[] = [];
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) =>
      name === "sample"
        ? async (input: string, options?: { onText?: (u: { text: string; delta: string }) => void }) => {
            calls.push(input);
            const text = await answer();
            options?.onText?.({ text, delta: text });
            return { text, truncated: false, modelTierApplied: "quick" };
          }
        : null,
  };
  return { calls };
}

/** main.tsx acquires the door before first render; the suite does the same. */
async function openRoom(
  brain?: (e: BrainEnvelope) => Promise<BrainReply>,
  opts: { generatedAt?: string; unbound?: true } = {},
) {
  await acquireSample(50);
  const bundle = data.borrowers![accountId];
  const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
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
          generatedAt: opts.generatedAt,
        }}
        brain={brain}
        router={opts.unbound ? ROUTER : undefined}
        onClose={() => {}}
      />,
    );
  });
  return document.querySelector<HTMLElement>(".wk-room")!;
}

/** THE ROUTE QUESTION, as the unified entry hands it to the room. With it the
 *  room is UNBOUND and standing on a provisional engine; without it the caller
 *  already named a mode and the room is bound, which is every other test here. */
const ROUTER = {
  question: { line: NEUTRAL_QUESTION, chips: [...ROUTE_CHIPS] },
  say: null,
  onBind: () => {},
  onRestart: () => {},
};

/**
 * THE MAILBOX, AT THE SHAPE THE LIVE TOOL ACTUALLY ANSWERS IN: a BARE SINGLE
 * OBJECT, `sender` a plain address string, the body preview under `summary`.
 * That is the 2026-07-27 defect `unwrapMail` was hardened for, so the stub
 * answers it rather than the documented array.
 */
function installMailbox(message: Record<string, unknown> | null, delayMs = 0) {
  const claude = (window as unknown as { claude: { mcp?: unknown } }).claude;
  claude.mcp = {
    callTool: (_server: string, tool: string) =>
      new Promise((resolve) =>
        setTimeout(
          () => resolve({ payload: tool === "outlook_email_search" && message ? message : {} }),
          delayMs,
        ),
      ),
  };
}

const HARTWELL_MAIL = {
  uri: "m365://message/AAMk-1",
  id: "AAMk-1",
  subject: "Hartwell equipment loan",
  sender: "james@hartwellprecision.com",
  receivedDateTime: "2026-08-28T09:12:00Z",
  sentDateTime: "2026-08-28T09:12:00Z",
  summary: "Can we renew the equipment loan when it matures next spring?",
  webLink: "https://outlook.office.com/mail/AAMk-1",
  internetMessageId: "<AAMk-1@hartwell>",
};

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
  await settle();
}

const reply = (r: BrainReply) => vi.fn(async (_e: BrainEnvelope) => r);

const READ_CARD: BrainReply = {
  type: "read-card",
  topic: "involvements",
  title: "Borrowing structure on the Hartwell package",
  rows: [{ icon: "borrower", label: "Hartwell Precision Manufacturing LLC", value: "Borrower", sub: "all 6 facilities" }],
  followUp: "Who should be added, and on which facility?",
};

const CLARIFY: BrainReply = {
  type: "clarify",
  text: "Which line do you mean? The relationship carries two.",
  options: [
    { label: "Revolving line, $15.0MM", say: "the revolving line of credit" },
    { label: "Seasonal line, $2.5MM", say: "the seasonal line of credit" },
  ],
};

const DELTA: BrainReply = {
  type: "delta-proposal",
  action: "loan-modification",
  rationale: "Client requested a seasonal working capital increase ahead of Q4 build.",
  changes: { scalarChangesJson: [{ key: "requestedAmount", value: 20_000_000, targetLoanId: "a4Zbb0000027MaYEAU" }] },
};

describe("the remark lands under the card, in the room's own bubble", () => {
  it("streams a sentence under the block the room just staged", async () => {
    /* THE BOLD FIGURE IS ONE THE ENVELOPE CARRIES. A figure the room cannot
       point at is rendered plainly and marked, which is the guard below. */
    installSession(async () => "Coverage thins on the **$15.0M** line: the pledged pool does not grow with it.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    const remark = room.querySelector(".wk-narr");
    expect(remark).not.toBeNull();
    expect(remark!.textContent).toContain("Coverage thins on the");
    // Light structure, parsed into the room's OWN elements. Never a marker.
    expect(remark!.querySelector("b")?.textContent).toBe("$15.0M");
    expect(remark!.textContent).not.toMatch(/\*/);
    // It is an agent bubble, not a second panel: one voice, one typography.
    expect(remark!.classList.contains("wk-agent")).toBe(true);
    expect(remark!.querySelector(".wk-bub")).not.toBeNull();
  });

  it("renders a bullet list as list items, never as hyphens in a paragraph", async () => {
    /* THE BULLETS CARRY NO FIGURES (founder, 2026-09-03). A figure the room
       cannot ground now takes its bullet with it rather than being printed
       without emphasis, so a fixture that leaned on ungrounded numbers was
       testing the guard rather than the SHAPE. The shape is what this holds:
       a hyphen run renders as list items and never as hyphens in a paragraph. */
    installSession(async () => "Three tests move:\n- the coverage ratio\n- the liquidity floor");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    const list = room.querySelector(".wk-narr-list");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll("li")).toHaveLength(2);
    expect(list!.textContent).not.toMatch(/^-/);
  });

  it("NEVER stages anything, whatever the remark says", async () => {
    // A remark that reads like an instruction is still prose. The plan is what
    // the deterministic layer put on it and nothing else.
    installSession(async () => "I have raised the equipment loan to $9M and added a DSC covenant at 1.40x.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    const before = room.querySelectorAll(".wk-chip").length;
    await typeInto(room, "what covenants do we carry");
    expect(room.querySelectorAll(".wk-chip").length).toBe(before);
  });
});

describe("one voice per moment (founder drive, 2026-09-02)", () => {
  it("puts ONE prose block under a routine card, not two", async () => {
    const session = installSession(async () => "The pledged pool does not move with the commitment.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();
    const atGreeting = room.querySelectorAll(".wk-narr").length;
    const calls = session.calls.length;

    await typeInto(room, "take the 15M line of credit to 20000000");

    // The chip is there, the room's own sentence is under it, and the model was
    // never asked: a plain scalar change with no advisory says the whole of
    // itself on the chip.
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
    expect(room.querySelectorAll(".wk-narr")).toHaveLength(atGreeting);
    expect(session.calls).toHaveLength(calls);
    /* THE VERSION FACT, SHORTENED TO ONE SENTENCE AND SAID ONCE PER PLAN
       (founder, 2026-09-03). The methodology paragraph under every card was two
       sentences of nCino mechanics; what a banker needs before pressing Confirm
       is that nothing booked moves until the bank approves. */
    expect(room.textContent).toContain("Confirming stages the next version of the package");
    expect(room.textContent).not.toContain("every eligible member rolls into it");
  });

  it("steps its own paragraph back to the address where the model DOES speak", async () => {
    installSession(async () => "That figure is two orders out on this relationship.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();

    // A magnitude advisory rides this card, so it is not routine and the model
    // speaks. The room's own account of what a modification does steps back.
    await typeInto(room, "take the 15M line of credit to 900000000");

    const said = room.textContent ?? "";
    expect(said).toContain("That figure is two orders out on this relationship.");
    expect(said).not.toContain("Confirming stages the next VERSION of the package");
    expect(said).toContain("Commitment amount on Line of Credit ($15M): $15M → $900M.");
    // And the CHECK stays: it is not a comment, it is the thing a credit officer says.
    expect(said).toContain("Before you confirm");
  });

  it("leaves the paragraph exactly where it is when the remark never arrives", async () => {
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();
    await typeInto(room, "take the 15M line of credit to 900000000");

    // No session door at all: degrade parity, byte for byte.
    /* THE VERSION FACT, SHORTENED TO ONE SENTENCE AND SAID ONCE PER PLAN
       (founder, 2026-09-03). The methodology paragraph under every card was two
       sentences of nCino mechanics; what a banker needs before pressing Confirm
       is that nothing booked moves until the bank approves. */
    expect(room.textContent).toContain("Confirming stages the next version of the package");
    expect(room.textContent).not.toContain("every eligible member rolls into it");
  });
});

describe("the consent moment rides the greeting", () => {
  it("makes its FIRST session call at room open, before any line is typed", async () => {
    const session = installSession(async () => "One covenant tests inside 90 days.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();

    // The dialog the platform raises on this call is framed by the greeting the
    // banker just asked for by opening the room. Never mid-plan.
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]).toMatch(/The room has just OPENED on this relationship/);
    expect(room.querySelector(".wk-narr")?.textContent).toContain("One covenant tests inside 90 days.");
  });

  it("asks once: a typed line afterwards makes a SECOND call, never a second consent", async () => {
    const session = installSession(async () => "Coverage thins on the pledged pool.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();
    const atOpen = session.calls.length;
    /* A READ, NOT A ROUTINE CONFIRM. A plain scalar term change with no
       advisory earns no remark at all since the one-voice rule, so the line
       that proves there is no SECOND consent has to be one the model speaks
       on. A read is. */
    await typeInto(room, "what covenants do we carry");

    expect(atOpen).toBe(1);
    expect(session.calls.length).toBeGreaterThan(atOpen);
    // Every later call is an ordinary narration, never another opening.
    expect(session.calls.slice(1).every((c) => !/The room has just OPENED/.test(c))).toBe(true);
  });

  it("makes no call at all at open where there is no session door", async () => {
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();
    expect(room.querySelector(".wk-narr")).toBeNull();
  });
});

describe("a remark that fails leaves the room exactly as it was", () => {
  it("keeps the deterministic sentence when the door rejects", async () => {
    installSession(() => Promise.reject({ code: "upstream_error", message: "down" }));
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");

    expect(room.querySelector(".wk-narr")).toBeNull();
    // The card the parser staged is still there. Nothing is worse than today.
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
  });

  it("says the decline sentence once, in banker language, and never again", async () => {
    installSession(() => Promise.reject({ code: "not_granted", message: "declined" }));
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");
    await typeInto(room, "take the equipment loan to 9000000");

    const said = [...room.querySelectorAll(".wk-narr")].map((n) => n.textContent ?? "");
    const declines = said.filter((t) => t.includes("Working from the file only"));
    expect(declines).toHaveLength(1);
    expect(declines[0]).not.toMatch(/[—–]/);
  });

  it("renders nothing at all where the reply is blank", async () => {
    installSession(async () => "   ");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");
    expect(room.querySelector(".wk-narr")).toBeNull();
  });
});

describe("channel-none renders exactly today's sentences", () => {
  it("shows no remark and no pulse with no session door and no brain", async () => {
    const room = await openRoom(undefined);
    await settle();
    await typeInto(room, "take the 15M line of credit to 20000000");

    expect(room.querySelector(".wk-narr")).toBeNull();
    expect(room.querySelector(".wk-narr-wait")).toBeNull();
    // And the deterministic room is untouched: the card is on the plan.
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
  });

  it("shows no remark where a brain exists but the session door does not", async () => {
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");
    expect(room.querySelector(".wk-narr")).toBeNull();
  });
});

describe("the model's four channels each render through the room's own components", () => {
  it("a read-card reply renders as the room's read card, never as raw text", async () => {
    installSession(async () => "Four of the six sit at relationship level.");
    const room = await openRoom(reply(READ_CARD));
    await settle();
    await typeInto(room, "what is the relationship manager's phone number");

    const card = room.querySelector(".wk-readcard, [data-topic]");
    expect(card).not.toBeNull();
    expect(room.textContent).toContain("Hartwell Precision Manufacturing LLC");
    // The card's title is a heading in the card, not a JSON blob in a bubble.
    expect(room.textContent).not.toContain('"type":"read-card"');
  });

  it("a clarify reply renders as an agent bubble with option chips", async () => {
    installSession(async () => "Both are open; the seasonal line is the smaller of the two.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "bump the big revolver by five million");

    const opts = [...room.querySelectorAll(".wk-opt")].map((b) => b.textContent);
    expect(opts).toEqual(expect.arrayContaining(["Revolving line, $15.0MM", "Seasonal line, $2.5MM"]));
    expect(room.textContent).not.toContain('"type":"clarify"');
  });

  it("a delta-proposal renders as the parser's own chips, never as a tool call", async () => {
    installSession(async () => "That takes the line to $20.0MM.");
    const room = await openRoom(reply(DELTA));
    await settle();
    await typeInto(room, "the client wants a bit more room on the revolver");

    // It re-entered the deterministic parser: the chip is the parser's chip.
    expect(room.querySelectorAll(".wk-chip").length).toBeGreaterThan(0);
    expect(room.textContent).toContain("Reading that as");
    expect(room.textContent).not.toContain("delta-proposal");
  });

  it("the remark itself renders as prose in an agent bubble and nothing else", async () => {
    installSession(async () => "Coverage thins on the pledged pool.");
    const room = await openRoom(reply(READ_CARD));
    await settle();
    await typeInto(room, "what is the relationship manager's phone number");

    const remark = room.querySelector(".wk-narr");
    expect(remark).not.toBeNull();
    expect(remark!.querySelector(".wk-opt")).toBeNull();
    expect(remark!.querySelector("button")).toBeNull();
  });
});

/* =============================================================================
   THE LINE ITEM, ON THE GLASS (founder, 2026-09-02).

   The model writes the name and the clause. The ROOM writes the figure, out of
   the same envelope the model was handed. And it stays a remark: a row is a
   row, never a chip, never a button, never a second card.
   ============================================================================= */

describe("an entity reads as a line item with the book's figure beside it", () => {
  /** The LAST remark on the glass. The greeting answers with the same stub, so
   *  scoping to the newest bubble is what keeps this about one remark. */
  const lastRemark = (room: HTMLElement) => [...room.querySelectorAll<HTMLElement>(".wk-narr")].pop()!;
  const LINE_ITEMS = [
    "Two tests are worth a second look.",
    "- **Debt Service Coverage of Borrower**: the widest ratio cushion on the deal.",
    "- **Piedmont Precision Components**: not a party to this package at all.",
  ].join("\n");

  it("renders its own list, with the label bold and the room's figure in the rail", async () => {
    installSession(async () => LINE_ITEMS);
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    const remark = lastRemark(room);
    const rows = remark.querySelectorAll(".wk-narr-rows .wk-narr-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("b")?.textContent).toBe("Debt Service Coverage of Borrower");
    // THE FIGURE IS THE BOOK'S, not the model's: it never wrote one.
    expect(rows[0].querySelector(".wk-narr-row-v")?.textContent).toBe("1.38× vs ≥ 1.25×");
    expect(remark.querySelector(".wk-narr-rows")!.textContent).not.toMatch(/\*/);
  });

  it("gives an unresolved name no rail at all, and no placeholder", async () => {
    installSession(async () => LINE_ITEMS);
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    const rows = lastRemark(room).querySelectorAll(".wk-narr-rows .wk-narr-row");
    expect(rows[1].querySelector("b")?.textContent).toBe("Piedmont Precision Components");
    expect(rows[1].querySelector(".wk-narr-row-v")).toBeNull();
    expect(rows[1].textContent).toContain("not a party to this package");
  });

  it("is a row and never a control: no chip, no button, in the remark bubble", async () => {
    installSession(async () => LINE_ITEMS);
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    const remark = lastRemark(room);
    expect(remark.querySelector(".wk-narr-rows")).not.toBeNull();
    expect(remark.querySelector(".wk-opt")).toBeNull();
    expect(remark.querySelector("button")).toBeNull();
  });

  it("keeps a plain bullet run in the bullet list, never in the row list", async () => {
    /* THE BULLETS CARRY NO FIGURES (founder, 2026-09-03). A figure the room
       cannot ground now takes its bullet with it rather than being printed
       without emphasis, so a fixture that leaned on ungrounded numbers was
       testing the guard rather than the SHAPE. The shape is what this holds:
       a hyphen run renders as list items and never as hyphens in a paragraph. */
    installSession(async () => "Three tests move:\n- the coverage ratio\n- the liquidity floor");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    expect(lastRemark(room).querySelector(".wk-narr-list")!.querySelectorAll("li")).toHaveLength(2);
    expect(room.querySelector(".wk-narr-rows")).toBeNull();
  });
});

describe("the write fence, from the room's side", () => {
  it("offers the model no door that is not a read", () => {
    for (const door of READ_DOORS) {
      expect(door).not.toMatch(/^(stage|execute)_/);
    }
  });

  it("makes no connector call at all to narrate", async () => {
    const callTool = vi.fn(async (..._args: unknown[]) => ({ payload: {} }));
    installSession(async () => "Coverage thins on the pledged pool.");
    (window as unknown as { claude?: { use: unknown; mcp?: unknown } }).claude!.mcp = { callTool };
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await typeInto(room, "take the line of credit to 20000000");

    expect(room.querySelector(".wk-narr")).not.toBeNull();
    /* THE ROOM'S ONLY CONNECTOR CALLS AT MOUNT ARE ITS OWN READS: the mailbox
       once, for the greeting's mail block and the quiet tier together, and the
       chip catalog once (Customer360Catalog, no longer masked by a cached null
       since 2026-09-02). Narration itself opens no door at all: the narration
       door is rung 2 and carries no tools, which the READ_DOORS check above holds. */
    const doors = callTool.mock.calls.map((call) => call[1]);
    expect(doors.every((d) => d === "outlook_email_search" || d === "Customer360Catalog")).toBe(true);
    expect(doors.some((d) => /^(stage|execute)_/.test(String(d)))).toBe(false);
  });
});


/* =============================================================================
   THE CLIENT'S MAIL, BAKED INTO THE GREETING (founder, 2026-09-02).

   "when there is an email attached, it should be in that first response baked
   in."

   EVERY ASSERTION HERE IS ON THE PROMPT THE ROOM SENT, never on what a model
   wrote back. What the model does with the message is the model's; what the
   room hands it is the contract.
   ============================================================================= */

describe("the greeting carries the client's mail, or says nothing about a mailbox", () => {
  const greeting = (calls: string[]) => calls.find((c) => /The room has just OPENED/.test(c));
  const wait = async (ms: number) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  };

  it("says NOTHING about correspondence where there is no connector at all", async () => {
    const session = installSession(async () => "Six facilities, all compliant.");
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();

    expect(session.calls).toHaveLength(1);
    const prompt = greeting(session.calls)!;
    expect(prompt).not.toContain('"mail"');
    expect(prompt).not.toMatch(/THE CLIENT HAS WRITTEN/);
    // And no apology and no placeholder: a room that never looked at a mailbox
    // has nothing to say about one.
    expect(prompt).not.toMatch(/correspondence beyond the one message/);
    expect(room.querySelector(".wk-narr")).not.toBeNull();
  });

  it("says nothing where the connector is there and the mailbox is empty", async () => {
    const session = installSession(async () => "Six facilities, all compliant.");
    installMailbox(null);
    const room = await openRoom(reply(CLARIFY));
    await settle();
    await settle();
    await settle();

    expect(greeting(session.calls)).not.toContain('"mail"');
    expect(room.querySelector(".wk-narr")).not.toBeNull();
  });

  it("bakes the sender, the date, the subject and the gist into the FIRST call", async () => {
    const session = installSession(async () => "James has written about the equipment loan.");
    installMailbox(HARTWELL_MAIL);
    await openRoom(reply(CLARIFY), { generatedAt: "2026-07-25T21:04:49Z" });
    await settle();
    await settle();
    await settle();

    const prompt = greeting(session.calls)!;
    expect(prompt).toContain("james@hartwellprecision.com");
    expect(prompt).toContain("Aug 28, 2026");
    expect(prompt).toContain("Can we renew the equipment loan when it matures next spring?");
    expect(prompt).toMatch(/THE CLIENT HAS WRITTEN/);
    // The message is NEWER than the book, and the doctrine tells the model to
    // say so rather than reading the file as if it reflected the note.
    expect(prompt).toContain('"arrivedAfterBook":true');
    // The room read what it points at, and the model is left to decide.
    expect(prompt).toContain('"route":"renew"');
    // ONE consent call, whatever the mailbox did.
    expect(session.calls).toHaveLength(1);
    // And it can refuse the rest of the exchange by name.
    expect(prompt).toMatch(/correspondence beyond the one message/);
  });

  it("mail that misses the gate is a SECOND remark, never a rewritten greeting", async () => {
    const session = installSession(async () => "One more thing about the equipment loan.");
    // Later than MAIL_GATE_MS: the greeting has already gone out.
    installMailbox(HARTWELL_MAIL, 1600);
    const room = await openRoom(reply(CLARIFY), { generatedAt: "2026-07-25T21:04:49Z" });
    await settle();
    await wait(1400);

    const first = greeting(session.calls)!;
    expect(first).not.toContain("james@hartwellprecision.com");
    expect(session.calls).toHaveLength(1);

    await wait(600);
    await settle();
    // A SECOND call, and it is not another greeting: no second consent moment.
    expect(session.calls.length).toBe(2);
    expect(session.calls[1]).toMatch(/The client's message arrived AFTER the room greeted/);
    expect(session.calls[1]).toContain("james@hartwellprecision.com");
    // Two bubbles under the opening, not one rewritten one.
    expect(room.querySelectorAll(".wk-narr").length).toBe(2);
  });

  it("reads the mailbox ONCE for the greeting and the quiet tier together", async () => {
    installSession(async () => "Six facilities, all compliant.");
    const calls: string[] = [];
    (window as unknown as { claude: { mcp?: unknown } }).claude.mcp = {
      callTool: async (_server: string, tool: string) => {
        calls.push(tool);
        return { payload: HARTWELL_MAIL };
      },
    };
    await openRoom(reply(CLARIFY), { generatedAt: "2026-07-25T21:04:49Z" });
    await settle();
    await settle();
    await settle();

    expect(calls.filter((t) => t === "outlook_email_search")).toHaveLength(1);
  });
});


/* =============================================================================
   THE GREETING'S SHAPE: A LEAD, THE ITEMS, A CLOSE.

   The founder pasted his own greeting and called it good but long: eighty-eight
   prose words carrying two figures, ending on "which facility or facilities
   move and what changes follow" over a room that had not yet been told whether
   this was a modification at all.

   THE FIXTURES BELOW ARE THE ANSWER TO BOTH HALVES, and they are the copy
   variants the addendum publishes. The model is not guaranteed to write them:
   what is guaranteed is that when it does, the room renders them as a lead, up
   to three line items carrying THE BOOK'S figures, and one closing line, and
   that the words the route has not earned are absent.
   ============================================================================= */

/** (a) NO MAIL, ROUTE UNBOUND. Forty-eight prose words carrying six figures. */
const GREETING_UNBOUND = [
  "Hartwell's $49M package sits clean across seven facilities, nothing staged yet.",
  "- **Debt Service Coverage of Borrower**: the widest ratio cushion on the deal.",
  "- **Maximum Debt to Worth**: room before the covenant binds, either way.",
  "- **Accounts Receivable**: exactly on its ceiling, and tested monthly.",
  "Modify, renew, or structure something new?",
].join("\n");

/** (d) THE MAIL ASKS A RENEWAL. The close names THAT route, and only it. */
const GREETING_RENEWAL_MAIL = [
  "Hartwell's $49M package is clean across seven facilities, nothing staged yet.",
  "- **Equipment ($8.0MM)**: the facility the note names, and the one a renewal re-cuts.",
  "- **Debt Service Coverage of Borrower**: the test a renewal is priced against.",
  "James asked to renew the $8.0MM equipment loan; open the renewal?",
].join("\n");

/** (e) A PLAIN QUESTION. Nothing to offer beyond the three routes. */
const GREETING_PLAIN_QUESTION = [
  "Hartwell's $49M package is clean; the message on it asks nothing of the credit.",
  "- **Accounts Receivable**: tested monthly, and the one test with no room left.",
  "James asked on Aug 28 for a copy of the June covenant certificate. Modify, renew, or structure something new?",
].join("\n");

describe("the greeting reads as a lead, the items and a close", () => {
  const opening = (room: HTMLElement) => room.querySelector<HTMLElement>(".wk-narr")!;

  it("renders three parts: one lead line, the rows, and one closing line", async () => {
    installSession(async () => GREETING_UNBOUND);
    const room = await openRoom(reply(CLARIFY), { unbound: true });
    await settle();
    await settle();

    const bubble = opening(room).querySelector(".wk-bub")!;
    /* `wk-narr-block` is the paced-reveal marker (founder, 2026-09-03): a
       remark that landed whole still arrives a block at a time. The SHAPE is
       what this test is about, so it reads the first class of each part. */
    const parts = [...bubble.children].map((el) => el.className.split(" ")[0]);
    expect(parts).toEqual(["wk-narr-line", "wk-narr-rows", "wk-narr-line"]);

    const lead = bubble.querySelector(".wk-narr-line")!.textContent!;
    expect(lead.trim().split(/\s+/).length).toBeLessThanOrEqual(18);
    expect([...bubble.querySelectorAll(".wk-narr-row")]).toHaveLength(3);
  });

  it("puts the BOOK'S figures in the rail, on every row, unasked", async () => {
    installSession(async () => GREETING_UNBOUND);
    const room = await openRoom(reply(CLARIFY), { unbound: true });
    await settle();
    await settle();

    const rails = [...opening(room).querySelectorAll(".wk-narr-row-v")].map((v) => v.textContent);
    expect(rails).toEqual(["1.38× vs ≥ 1.25×", "2.42× vs ≤ 3.00×", "80% vs ≤ 80%"]);
    // Six figures, and the model wrote none of them.
    expect(GREETING_UNBOUND).not.toMatch(/1\.38|2\.42|80%/);
  });

  it("never says which facility moves while the route is still open", async () => {
    const session = installSession(async () => GREETING_UNBOUND);
    const room = await openRoom(reply(CLARIFY), { unbound: true });
    await settle();
    await settle();

    const said = opening(room).textContent ?? "";
    expect(said).not.toMatch(/which facility|facilities move|changes follow/i);
    // The room ASKED the neutral question, and the remark closes on the same
    // three routes rather than on a fourth of its own.
    expect(said).toMatch(/Modify, renew, or structure something new\?/);
    expect(session.calls[0]).toMatch(/THE ROUTE IS NOT BOUND YET/);
    expect(session.calls[0]).toContain('"route":"unbound"');
    expect(session.calls[0]).toContain('"routeOptions":["modify","renew","create"]');
    // The three chips are already on the glass; the remark adds no fourth.
    expect(opening(room).querySelector("button")).toBeNull();
  });

  it("tells a BOUND room it is bound, and drops the route-open prohibition", async () => {
    const session = installSession(async () => "The package is clean and nothing is staged.");
    await openRoom(reply(CLARIFY));
    await settle();
    await settle();

    expect(session.calls[0]).toMatch(/THE ROUTE IS BOUND: this is a modify/);
    expect(session.calls[0]).not.toMatch(/THE ROUTE IS NOT BOUND/);
    expect(session.calls[0]).not.toMatch(/never say what changes follow/);
    expect(session.calls[0]).toContain('"route":"modify"');
  });

  it("closes on the route the mail names, and names no other", async () => {
    installSession(async () => GREETING_RENEWAL_MAIL);
    installMailbox({
      ...HARTWELL_MAIL,
      subject: "Hartwell equipment loan renewal",
      summary: "Can we renew the $8M equipment loan when it matures?",
    });
    const room = await openRoom(reply(CLARIFY), { unbound: true, generatedAt: "2026-07-25T21:04:49Z" });
    await settle();
    await settle();
    await settle();

    const said = opening(room).textContent ?? "";
    expect(said).toMatch(/open the renewal\?/i);
    expect(said).not.toMatch(/which facility|facilities move|changes follow/i);
    // The facility the note names carries its own commitment, from the book.
    const rails = [...opening(room).querySelectorAll(".wk-narr-row-v")].map((v) => v.textContent);
    expect(rails).toEqual(["$8.0MM", "1.38× vs ≥ 1.25×"]);
  });

  it("mentions a message that asks nothing of the credit, and offers the three", async () => {
    const session = installSession(async () => GREETING_PLAIN_QUESTION);
    installMailbox({
      ...HARTWELL_MAIL,
      subject: "Hartwell covenant certificate",
      summary: "Could you send a copy of the June covenant certificate?",
    });
    const room = await openRoom(reply(CLARIFY), { unbound: true, generatedAt: "2026-07-25T21:04:49Z" });
    await settle();
    await settle();
    await settle();

    const said = opening(room).textContent ?? "";
    expect(said).toMatch(/Modify, renew, or structure something new\?/);
    expect(said).not.toMatch(/open the renewal|open the modification/i);
    expect([...opening(room).querySelectorAll(".wk-narr-row")]).toHaveLength(1);
    // A question is not a credit action, so the room read no route out of it.
    const prompt = session.calls.find((c) => /The room has just OPENED/.test(c))!;
    expect(prompt).not.toContain('"route":"renew"');
    expect(prompt).toMatch(/MENTION IT AND STOP/);
  });
});
