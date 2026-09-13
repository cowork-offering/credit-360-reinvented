// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { C360Data } from "./data/contract";
import { AppProvider, useApp } from "./state/appState";
import {
  CHAT_ASK_FAILED,
  CHAT_DESK_OFF,
  CHAT_OFF_BODY,
  ChatPanelBody,
  chatLane,
  chatReachable,
} from "./components/ChatPanel";
import { DESK_PORTFOLIO_RULES, DESK_RULES, DESK_TIMEOUT_MS, deskTimeoutAnswer } from "./channel/deskAsk";
import { DECLINE_NOTICE, acquireSample, resetSessionDoor } from "./channel/sampleDoor";
import type { AgentChannel } from "./channel/adapter";
import { __skipBootForTests } from "./channel/useLivePortfolio";
import live from "../../artifact/live-data.json";

__skipBootForTests();

/* =============================================================================
   THE LANDING TAKES A QUESTION, AND NOTHING IS EVER SWALLOWED.

   FOUNDER, 2026-09-13: the cockpit chat sat on "Composing..." for over three
   minutes in the real host. W1 closed the pacer; these are the two holes it
   left, driven on the mounted panel with a REAL session door.

   (a) THE WORKLIST VIEW ASKED NOBODY. The desk lane required an open account
       AND a resolved bundle, so a question typed on the landing fell past the
       desk, past a connector that is not in every view, and into the legacy
       prompt bridge, which throws where nothing is wired.

   (b) EVERY FAILURE WAS SWALLOWED. `catch {}` on the desk lane, and
       `takeDeclineNotice` had no caller anywhere in the app, so a door that
       REFUSED and a door that was merely slow left the banker the same nothing.

   The door here is the runtime's own shape (`window.claude.use("sample")`), not
   a mocked `askDesk`: a decline has to reach `sampleDoor`'s own state for the
   notice to exist at all, which is exactly what a mocked module hides.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const book = live as unknown as C360Data;
const ACCOUNT = "001bb00001I7FPNAA3";
const ANSWER = "Two relationships are overdue on a covenant test. Start with Brightwater Foods Group.";

/** Every prompt the door was handed, in order. */
const prompts: string[] = [];

type DoorResult = { text: string; truncated: boolean; modelTierApplied: "quick" };
type Door = (input: string) => Promise<DoorResult>;

const answers = (text: string): Door => async (input) => {
  prompts.push(input);
  return { text, truncated: false, modelTierApplied: "quick" };
};

const refuses = (failure: unknown): Door => async (input) => {
  prompts.push(input);
  throw failure;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let info: ReturnType<typeof vi.spyOn>;

function Harness({ accountId }: { accountId?: string }) {
  const { dispatch } = useApp();
  useEffect(() => {
    if (accountId) dispatch({ type: "OPEN_ACCOUNT", accountId });
    dispatch({ type: "SET_PANEL", panel: "chat" });
  }, [dispatch, accountId]);
  return <ChatPanelBody />;
}

/** Put a session door in this view and mount the panel on it. `accountId`
 *  absent is the LANDING: the worklist, with no relationship open. */
async function mount(door?: Door, accountId?: string) {
  if (door) {
    (window as unknown as { claude?: unknown }).claude = {
      use: async (name: string) => (name === "sample" ? door : null),
    };
    await acquireSample(50);
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppProvider data={book}>
        <Harness accountId={accountId} />
      </AppProvider>,
    );
  });
}

async function ask(text: string) {
  const field = container!.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** What the banker reads in the last agent bubble. */
const answer = () => {
  const rows = [...container!.querySelectorAll(".chatrow.agent .chatbub")];
  return (rows[rows.length - 1]?.textContent ?? "").trim();
};
const agentBubbles = () => [...container!.querySelectorAll(".chatrow.agent .chatbub")].map((n) => n.textContent ?? "");
const composing = () => container!.querySelector(".chatthink") !== null;

beforeEach(() => {
  resetSessionDoor();
  prompts.length = 0;
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  info.mockRestore();
  delete (window as unknown as { claude?: unknown }).claude;
});

describe("the worklist view asks the desk too (hole a)", () => {
  it("takes the question with no account open, and answers it in a bubble", async () => {
    await mount(answers(ANSWER));
    expect(container!.querySelector("textarea")).toBeTruthy();

    await ask("who needs attention today?");

    expect(prompts).toHaveLength(1);
    expect(answer()).toBe(ANSWER);
    expect(composing()).toBe(false);
  });

  it("travels with the BOOK's rules and the book's own context, not a relationship's", async () => {
    await mount(answers(ANSWER));
    await ask("who needs attention today?");

    const prompt = prompts[0];
    expect(prompt.startsWith(DESK_PORTFOLIO_RULES)).toBe(true);
    expect(prompt).not.toContain(DESK_RULES);
    expect(prompt).toContain("\n\nContext:\n");
    expect(prompt.trimEnd().endsWith("Question: who needs attention today?")).toBe(true);
  });

  it("carries every queue row, the totals and the coverage the three questions need", async () => {
    await mount(answers(ANSWER));
    await ask("which relationship has the thinnest coverage?");
    const prompt = prompts[0];

    // WHO NEEDS ATTENTION: every row by name, with the reason it is on the queue.
    for (const name of [
      "Hartwell Precision Manufacturing LLC",
      "Piedmont Precision Components, Inc.",
      "Brightwater Foods Group",
      "Sterling Fabrication Co.",
      "Kingsley Precision Works",
    ]) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain("COVENANT_BREACH (covenant breach)");
    expect(prompt).toContain("CLIENT_REQUEST (client request waiting)");

    // THE THINNEST COVERAGE: the org's own ratio on every staged relationship,
    // so the comparison is read rather than worked out.
    expect(prompt).toContain("collateral coverage 0.96×");
    expect(prompt).toContain("collateral coverage 1.65×");

    // HOW MUCH IS COMMITTED: the book totals, summed the way the band sums them.
    expect(prompt).toContain("$135M committed");
    expect(prompt).toContain("5 relationships");
  });

  it("still sends the RELATIONSHIP context once an account is open", async () => {
    await mount(answers(ANSWER), ACCOUNT);
    await ask("what is the exposure");

    expect(prompts).toHaveLength(1);
    expect(prompts[0].startsWith(DESK_RULES)).toBe(true);
    expect(prompts[0]).toContain("Facilities across the relationship, every package included");
  });
});

describe("never silent: every desk failure reaches the glass (hole b)", () => {
  it("a declined door says the notice ONCE and then what still answers", async () => {
    await mount(refuses({ code: "not_granted", message: "the viewer declined" }));
    await ask("who needs attention today?");

    expect(answer()).toContain(DECLINE_NOTICE);
    expect(answer()).toContain(CHAT_DESK_OFF);
    // The mark is gone the moment the failure lands.
    expect(composing()).toBe(false);
    // And the code is in the console, so the next real-host report is diagnosable.
    expect(info.mock.calls.flat().join(" ")).toContain("not_granted");

    // The door is off for this view now, so the composer is too: it must not
    // take a question it cannot send.
    expect(container!.querySelector("textarea")).toBeNull();
    expect(container!.textContent).toContain(CHAT_OFF_BODY);
    // ONE bubble carries it, and there cannot be a second: the door is out of
    // the lane order for the rest of this view, so it is never asked again.
    expect(agentBubbles().filter((t) => t.includes(DECLINE_NOTICE))).toHaveLength(1);
    expect(chatLane({ kind: () => "none", available: () => false, request: async () => {} })).toBe("none");
  });

  it("a door that times the call out says the wait it spent", async () => {
    await mount(refuses({ code: "timeout", message: "the platform gave up" }));
    await ask("who needs attention today?");

    expect(answer()).toBe(deskTimeoutAnswer(Math.round(DESK_TIMEOUT_MS / 1000)));
    expect(answer()).toMatch(/ask again/i);
    expect(composing()).toBe(false);
    expect(info.mock.calls.flat().join(" ")).toContain("timeout");
  });

  it("any other failure says the ask did not reach the desk", async () => {
    await mount(refuses({ code: "upstream_error", message: "the door broke" }));
    await ask("who needs attention today?");

    expect(answer()).toBe(CHAT_ASK_FAILED);
    expect(composing()).toBe(false);
    // Transient, so the composer stays: asking again is a real move here.
    expect(container!.querySelector("textarea")).toBeTruthy();
  });

  it("a failure with no code at all still lands a bubble rather than silence", async () => {
    await mount(refuses(new Error("no shape at all")));
    await ask("who needs attention today?");

    expect(answer()).toBe(CHAT_ASK_FAILED);
    expect(composing()).toBe(false);
  });
});

describe("the gate and the lanes agree (hole a, the other half)", () => {
  const stub = (over: Partial<AgentChannel>): AgentChannel => ({
    kind: () => "none",
    available: () => false,
    request: async () => {},
    ...over,
  });

  it("the desk is the lane wherever the door is open, account or no account", async () => {
    await mount(answers(ANSWER));
    expect(chatLane(stub({}))).toBe("desk");
    expect(chatReachable(stub({}))).toBe(true);
  });

  it("a channel that only reports the connector namespace is NOT a bridge", () => {
    // `channel.request` throws on this kind by construction rather than
    // sending, and no connector is in the view, so there is nothing to take a
    // question. The composer must say so instead of accepting one.
    expect(chatLane(stub({ kind: () => "mcp", available: () => true }))).toBe("none");
    expect(chatReachable(stub({ kind: () => "mcp", available: () => true }))).toBe(false);
  });

  it("a real prompt bridge IS a lane", () => {
    expect(chatLane(stub({ kind: () => "sendPrompt", available: () => true }))).toBe("bridge");
  });

  it("with no door at all the panel shows the off body and no composer", async () => {
    await mount();
    expect(container!.querySelector("textarea")).toBeNull();
    expect(container!.textContent).toContain(CHAT_OFF_BODY);
  });
});
