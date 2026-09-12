// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiMessage, C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import { CHAT_ASK_FAILED, ChatPanelBody, mergeMessages } from "./components/ChatPanel";
import { __skipBootForTests } from "./channel/useLivePortfolio";
import sample from "../../artifact/sample-data.json";

__skipBootForTests();

/* =============================================================================
   THE COCKPIT CHAT, HELD TO GOLDEN RULE 5 (finding I8).

   "It never replies twice to one input." The panel did, twice over: the merge
   deduped on id alone, so a locally rendered exchange and the agent's own
   written-back copy of it BOTH rendered; and "Ask again" re-posted the question
   as a second banker bubble, so a retry read as a second ask.

   Both are proved here on the mounted panel, not on the prose.
   ============================================================================= */

const hooks = vi.hoisted(() => ({
  desk: [] as Array<{ question: string; thread?: ReadonlyArray<{ who: string; text: string }> }>,
  deskAnswer: { ok: true },
  copilot: [] as string[],
}));

vi.mock("./channel/deskAsk", async (orig) => ({
  ...((await orig()) as object),
  deskAvailable: () => true,
  askDesk: async (args: { question: string; thread?: ReadonlyArray<{ who: string; text: string }> }) => {
    hooks.desk.push({ question: args.question, thread: args.thread });
    if (!hooks.deskAnswer.ok) throw new Error("the door refused");
    return `The relationship carries $18M committed. (${hooks.desk.length})`;
  },
}));

vi.mock("./channel/cockpitTools", async (orig) => ({
  ...((await orig()) as object),
  askCopilot: async (args: { question: string }) => {
    hooks.copilot.push(args.question);
    throw { code: "tool_error", message: "no", retryable: true, fix: "The desk refused that read.", retract: false };
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date().toISOString();
const QUESTION = "what is the exposure";

const base = sample as unknown as C360Data;
const ACCOUNT = base.portfolio.accounts[0].accountId;

/** The book, plus the agent's OWN written-back copy of one exchange. This is
 *  what the panel merges the session's local messages against. */
const dataWithServerCopy = (): C360Data =>
  ({
    ...base,
    aiPanel: {
      threads: [
        {
          id: "t1",
          messages: [
            { id: "server-q", role: "user", text: QUESTION, ts: NOW },
            { id: "server-a", role: "agent", text: "The relationship carries $18M committed. (1)", ts: NOW },
          ],
        },
      ],
    },
  }) as unknown as C360Data;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const { dispatch } = useApp();
  useEffect(() => {
    dispatch({ type: "OPEN_ACCOUNT", accountId: ACCOUNT });
    dispatch({ type: "SET_PANEL", panel: "chat" });
  }, [dispatch]);
  return <ChatPanelBody />;
}

async function mount(data: C360Data) {
  // A connected view, so the composer renders at all. The desk door is mocked
  // above; this is only the panel's own availability gate.
  (window as unknown as { claude?: unknown }).claude = { mcp: { callTool: async () => ({}) } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppProvider data={data}>
        <Harness />
      </AppProvider>,
    );
  });
}

/** Put the question in the composer and send it, exactly as the banker does. */
async function ask(text: string) {
  const field = container!.querySelector("textarea")!;
  // The element's OWN realm: the jsdom window the panel is mounted in is not
  // necessarily the one this module closed over.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const bubbles = () => [...container!.querySelectorAll(".chatbub")].map((n) => n.textContent ?? "");

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  hooks.desk.length = 0;
  hooks.copilot.length = 0;
  hooks.deskAnswer.ok = true;
  delete (window as unknown as { claude?: unknown }).claude;
});

describe("mergeMessages: one exchange, one bubble", () => {
  const msg = (over: Partial<AiMessage>): AiMessage => ({ id: "x", role: "user", text: QUESTION, ts: NOW, ...over });

  it("keeps the LOCAL copy and drops the agent's written-back one", () => {
    const out = mergeMessages([msg({ id: "server-q" })], [msg({ id: "local-q" })]);
    expect(out.map((m) => m.id)).toEqual(["local-q"]);
  });

  it("matches on the exchange, never on the id, because the ids never agreed", () => {
    const out = mergeMessages(
      [msg({ id: "server-q" }), msg({ id: "server-a", role: "agent", text: "It carries $18M." })],
      [msg({ id: "local-q" }), msg({ id: "local-a", role: "agent", text: "It carries $18M." })],
    );
    expect(out.map((m) => m.id)).toEqual(["local-q", "local-a"]);
  });

  it("leaves a genuine repeat alone: the match is only ever made across the two sources", () => {
    const out = mergeMessages([], [msg({ id: "a" }), msg({ id: "b" })]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("leaves two different questions alone, and an old server copy alone", () => {
    const old = msg({ id: "server-old", ts: new Date(Date.parse(NOW) - 3_600_000).toISOString() });
    expect(mergeMessages([old], [msg({ id: "local-q" })]).map((m) => m.id)).toEqual(["server-old", "local-q"]);
    expect(mergeMessages([msg({ id: "s", text: "and the covenants" })], [msg({ id: "l" })]).map((m) => m.id)).toEqual([
      "s",
      "l",
    ]);
  });
});

describe("the panel answers once (golden rule 5)", () => {
  it("renders ONE bubble for an exchange the agent also wrote back", async () => {
    await mount(dataWithServerCopy());
    // The written-back exchange is already on the glass.
    expect(bubbles().filter((t) => t === QUESTION).length).toBe(1);

    await ask(QUESTION);

    // One question, one answer. Not two of either, which is what the id-only
    // merge produced.
    expect(bubbles().filter((t) => t === QUESTION).length).toBe(1);
    expect(bubbles().filter((t) => t.includes("$18M committed")).length).toBe(1);
    expect(hooks.desk.length).toBe(1);
  });

  it("hands the desk the conversation so far, without the question it is asking", async () => {
    await mount(dataWithServerCopy());
    await ask("and the covenants");
    expect(hooks.desk[0].question).toBe("and the covenants");
    expect(hooks.desk[0].thread).toEqual([
      { who: "banker", text: QUESTION },
      { who: "agent", text: "The relationship carries $18M committed. (1)" },
    ]);
  });
});

describe("Ask again repeats the ask, never the banker", () => {
  it("asks a second time and leaves one banker bubble", async () => {
    // The desk door refuses, so the ask falls through to the copilot path,
    // which is the one that raises the error note the retry sits in.
    hooks.deskAnswer.ok = false;
    await mount(base);
    await ask(QUESTION);

    /* CHANGED 2026-09-12 (founder, the fallback audit). The note used to print
       `McpFailure.fix`, which names the IDB Gateway and claude.ai connector
       settings: plumbing, addressed to an administrator, handed to a banker
       with no next step in it. The chat now says its own sentence; the
       connector diagnosis stays on HealthLine. */
    expect(container!.textContent).toContain(CHAT_ASK_FAILED);
    expect(container!.textContent).not.toMatch(/gateway|connector|claude\.ai/i);
    expect(bubbles().filter((t) => t === QUESTION).length).toBe(1);
    expect(hooks.copilot.length).toBe(1);

    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Ask again")!;
    await act(async () => {
      retry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The ask went again; the banker's own bubble did not.
    expect(hooks.copilot.length).toBe(2);
    expect(bubbles().filter((t) => t === QUESTION).length).toBe(1);

    // And the retried question is not sent twice over: it is the ask, so it is
    // trimmed off the tail of the thread rather than travelling as both.
    expect(hooks.desk.length).toBe(2);
    expect(hooks.desk[1].question).toBe(QUESTION);
    expect(hooks.desk[1].thread?.some((t) => t.who === "banker" && t.text === QUESTION)).toBe(false);
  });
});
