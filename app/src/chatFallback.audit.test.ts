// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOT_CONNECTED_CLARIFY, UNREADABLE_CLARIFY, askBrain, type BrainEnvelope } from "./channel/brainLane";
import { ALWAYS_BLOCK_IDS, DOCTRINE_BLOCKS } from "./channel/doctrine";
import {
  DESK_PORTFOLIO_RULES,
  DESK_RULES,
  DESK_TIMEOUT_MS,
  askDesk,
  askDeskPortfolio,
  deskAvailable,
  deskContext,
  deskTimeoutAnswer,
} from "./channel/deskAsk";
import { DECLINE_NOTICE, acquireSample, resetSessionDoor, type SampleOptions } from "./channel/sampleDoor";
import { createChannel } from "./channel/adapter";
import { mcpAvailable } from "./channel/mcp";
import type { ActionHistoryRow, BorrowerBundle, C360Data } from "./data/contract";
import { deriveQueue } from "./data/queue";
import { DeadlineExpired } from "./components/workroom/deadline";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE FALLBACK AUDIT (founder, 2026-09-12: "run again some agents over the chat
   behaviours, patterns etc to avoid any fallbacks").

   EVERY PATH WHERE A SURFACE GIVES UP is driven here with a real door: the
   session door present, the session door absent, a door that never answers, a
   door that throws, and no door at all. What is asserted is what the BANKER is
   left holding.

   The file follows this repo's own convention (chatGolden.repro.test.ts): a
   REPRO states today's behaviour as a true assertion, so it goes green now and
   turns red the moment the gap is closed. Where a repro has been closed in this
   pass the assertion is FLIPPED in place and dated, never deleted.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const bundle = () => data.borrowers![HARTWELL] as BorrowerBundle;
const NAME = "Hartwell Precision Manufacturing LLC";

type SampleStub = ((input: string, options?: SampleOptions) => Promise<unknown>) & {
  json?: (input: string, options?: SampleOptions) => Promise<unknown>;
};

/** Put a session door in this view, exactly as the runtime contract shapes it. */
async function openDesk(sample: SampleStub): Promise<void> {
  (window as unknown as { claude?: unknown }).claude = {
    use: async (name: string) => (name === "sample" ? sample : null),
  };
  await acquireSample(50);
}

const answers = (text: string): SampleStub =>
  Object.assign(async () => ({ text, truncated: false, modelTierApplied: "quick" as const }), {
    json: async () => ({ text }),
  });

const never = (): SampleStub => Object.assign(() => new Promise<never>(() => {}), { json: () => new Promise<never>(() => {}) });

const throws = (code: string): SampleStub =>
  Object.assign(() => Promise.reject({ code, message: `stub ${code}` }), {
    json: () => Promise.reject({ code, message: `stub ${code}` }),
  });

beforeEach(() => {
  resetSessionDoor();
});

afterEach(() => {
  delete (window as unknown as { claude?: unknown }).claude;
});

/* ========================================================= FINDING A1

   THE COMPOSER IS GATED ON THE CONNECTOR, NOT ON THE DESK.

   `ChatPanel` computes `available = live || channel.available()`. Neither of
   those two doors is the one the cockpit chat actually answers through: the
   desk runs on the viewer's own session Claude and needs no connector at all.
   So a view carrying a working session door and no IDB Gateway renders the
   composer disabled and tells the banker to re-open the cockpit through the
   agent, while the door that would have answered sits open beside it.        */

describe("A1: the chat's own gate must count the door it answers through", () => {
  it("the session door is open while both doors the panel gates on are shut", async () => {
    await openDesk(answers("ready"));
    expect(deskAvailable()).toBe(true);
    // The two the panel actually reads.
    expect(mcpAvailable()).toBe(false);
    expect(createChannel().available()).toBe(false);
  });

  it("FIXED 2026-09-12 (founder: avoid any fallbacks): the gate counts the desk", async () => {
    const { chatReachable } = await import("./components/ChatPanel");
    await openDesk(answers("ready"));
    expect(chatReachable(createChannel())).toBe(true);
  });

  it("stays shut where no door of the three is open", async () => {
    const { chatReachable } = await import("./components/ChatPanel");
    expect(deskAvailable()).toBe(false);
    expect(chatReachable(createChannel())).toBe(false);
  });
});

/* ========================================================= FINDING A2

   THE DESK'S ASK HAD NO DEADLINE.

   Every other lane is bounded (BRAIN_TIMEOUT_MS, BRAIN_TIMEOUT_DEFAULT_MS,
   BRAIN_TIMEOUT_TOOLS_MS, RESTATE_TIMEOUT_MS). `askDesk` passed the caller's
   signal through and started no clock of its own, and `ChatPanel` passed no
   signal, so a session that never answered left "Composing..." on the glass
   with no bound and nothing for the banker to do.                            */

describe("A2: the wait on the cockpit chat is bounded, and the room says so", () => {
  const ask = (deadlineMs?: number) =>
    askDesk({ bundle: bundle(), accountName: NAME, question: "What is the exposure?", deadlineMs });

  it("FIXED 2026-09-12: a door that never answers resolves inside the deadline", async () => {
    await openDesk(never());
    const settled = await Promise.race([
      ask(40).then((t) => t),
      new Promise<string>((r) => setTimeout(() => r("STILL WAITING"), 400)),
    ]);
    expect(settled).not.toBe("STILL WAITING");
  });

  it("names the wait it spent and hands the banker a move", async () => {
    await openDesk(never());
    const said = await ask(40);
    expect(said).toMatch(/has not come back/i);
    expect(said).toMatch(/ask again/i);
    // It never claims an answer it does not have.
    expect(said).not.toMatch(/committed|covenant|facility/i);
  });

  it("a door that refuses still throws, so the caller's next rung gets its turn", async () => {
    await openDesk(throws("not_granted"));
    await expect(ask(500)).rejects.toMatchObject({ code: "not_granted" });
  });

  it("a door that answers in time is untouched by the clock", async () => {
    await openDesk(answers("Committed is $57.0M across nine facilities."));
    expect(await ask(500)).toContain("$57.0M");
  });
});

/* ========================================================= FINDING A3

   A DOOR FAILURE WAS REPORTED AS AN UNREADABLE ANSWER.

   `doorFor` fell through to the gateway completion door even where no connector
   exists in the view. The call rejected, `askBrain` swallowed it, and the
   banker read "I could not read that answer. Try asking directly" over a reply
   that was never made. It is untrue, and "try asking directly" points straight
   back at the path that just failed, which is the loop rule 5 forbids.       */

describe("A3: a door that did not answer is not a reply that could not be read", () => {
  const envelope = (): BrainEnvelope => ({
    v: 2,
    line: "what is the coverage on the line of credit",
    room: "facility",
    relationship: NAME,
    route: "modify",
    packageName: "Hartwell Core",
    productPackageId: "a5Fbb000000IHFJEA4",
    selectedFacility: null,
    facilities: [],
    staged: [],
    grounding: "plugin-skill:workroom-brain",
  });

  it("FIXED 2026-09-12: the session refusing with no connector beneath it says the desk did not answer", async () => {
    await openDesk(throws("upstream_error"));
    const reply = await askBrain(envelope());
    expect(reply.type).toBe("clarify");
    expect(reply).not.toEqual(UNREADABLE_CLARIFY);
    expect(reply.type === "clarify" && reply.text).toMatch(/did not answer/i);
    expect(reply.type === "clarify" && reply.text).toMatch(/say the change you want/i);
  });

  it("a reply that really was malformed still degrades as unreadable", async () => {
    const reply = await askBrain(envelope(), { send: async () => "I think you should raise it." });
    expect(reply).toEqual(UNREADABLE_CLARIFY);
  });
});

/* ========================================================= FINDING A4

   THE NOT-CONNECTED CLARIFY ENDED ON "ONCE A CONNECTOR IS ADDED".

   Pinned as an open REPRO in chatGolden.repro.test.ts (rule 4). It states a
   condition and a future capability and leaves the banker, who is standing in
   the room now, with nothing to do and an instruction only an administrator
   could act on.                                                              */

describe("A4: the not-connected degrade names what the banker can still do here", () => {
  it("FIXED 2026-09-12: it names the move the room can still make", () => {
    expect(NOT_CONNECTED_CLARIFY.text).toMatch(/say the change you want/i);
    expect(NOT_CONNECTED_CLARIFY.text).not.toMatch(/connector/i);
  });

  it("no degrade on this lane sends the banker to configure infrastructure", () => {
    for (const said of [NOT_CONNECTED_CLARIFY.text, UNREADABLE_CLARIFY.text]) {
      expect(said).not.toMatch(/gateway|connector|settings|reconnect|install/i);
    }
  });
});

/* ========================================================= FINDING A5

   THE COCKPIT CHAT CARRIED NO DOCTRINE AT ALL.

   The two rooms travel with the sliced pack. The desk travelled with four
   sentences about scope and prose: no guidance rule, no recommendation rule, no
   next step, no voice rule. It is the surface a founder demo opens on and it
   was the only conversational surface with nothing holding it to the golden
   rule.                                                                      */

describe("A5: the desk's standing rules carry the golden rule", () => {
  it("FIXED 2026-09-12: the figure leads, and the options come with it (rule 2)", () => {
    expect(DESK_RULES).toMatch(/lead with the current figure on file/i);
    expect(DESK_RULES).toMatch(/the real options/i);
  });

  it("FIXED 2026-09-12: recommendation rule C travels verbatim (founder, 2026-09-12)", async () => {
    const { RECOMMEND_ONLY_WHEN_GROUNDED } = await import("./channel/doctrine");
    expect(DESK_RULES).toContain(RECOMMEND_ONLY_WHEN_GROUNDED);
  });

  it("FIXED 2026-09-12: every answer ends on the next step (rule 4)", () => {
    expect(DESK_RULES).toMatch(/next step/i);
    expect(DESK_RULES).toMatch(/never leave the banker with nothing to do/i);
  });

  it("FIXED 2026-09-12: the voice rule is the pack's own, word for word (rule 7)", async () => {
    const { VOICE } = await import("./channel/doctrine");
    expect(DESK_RULES).toContain(VOICE);
    expect(VOICE).toMatch(/no exclamation points/i);
    expect(VOICE).toMatch(/no emoji/i);
  });

  it("a refusal still names the move that would get the figure (rule 4)", () => {
    expect(DESK_RULES).toMatch(/name the one move that would get it/i);
  });
});

/* ========================================================= FINDING A6

   THE DOCTRINE CONTRADICTED ITSELF ABOUT THE SPREAD.

   HARD_RULES told the model this org stores "a rate and, on floating
   facilities, a spread" and to "state the rate or the spread as stored". The
   pricing block carries a RATE ONLY, `pricing` conventions say the opposite,
   and the one honesty list refuses the spread by name. A model told a figure is
   stored will ask the banker for it or quote it, which is rule 1's "never ask
   for something the book already holds" in reverse.                          */

describe("A6: the doctrine and the book agree on what pricing this org stores", () => {
  const always = () =>
    DOCTRINE_BLOCKS.filter((b) => ALWAYS_BLOCK_IDS.includes(b.id))
      .flatMap((b) => b.lines)
      .join("\n");

  it("FIXED 2026-09-12: the always-on rules never promise a stored spread", () => {
    expect(always()).not.toMatch(/on floating facilities, a spread/i);
    expect(always()).not.toMatch(/State the rate or the spread as stored/i);
  });

  it("FIXED 2026-09-12: they say what the read actually carries, and refuse the rest by name", () => {
    expect(always()).toMatch(/stores a RATE/);
    expect(always()).toMatch(/no read on this cockpit carries a spread/i);
  });

  it("the one honesty list says the same thing on every surface", () => {
    const said = deskContext(bundle(), NAME);
    expect(said).toMatch(/the spread, which no read on this cockpit carries/);
    expect(said).toMatch(/the rate index name/);
  });
});

/* ========================================================= FINDING A9

   THE COCKPIT CHAT COULD NEVER CARRY THE ACTIONS ALREADY FILED.

   `deskContext` named "the actions already filed" in its own cut notice and
   built its facts with no `history`, so `historyBlock` returned undefined on
   every call and the block was structurally unreachable. The cockpit holds the
   trail in `state.actionHistory`, and the rooms travel with it.              */

describe("A9: the trail this cockpit filed reaches the desk (rule 1)", () => {
  const trail = [
    { actionId: "loan-modification", summary: "Raised the Line of Credit to $30,000,000", status: "Filed" },
    { actionId: "covenant-review", summary: "Closed the Q2 covenant test period", status: "Filed" },
  ] as unknown as ActionHistoryRow[];

  it("FIXED 2026-09-12: the filed rows travel where the caller holds them", () => {
    const said = deskContext(bundle(), NAME, { history: trail });
    expect(said).toContain("Filed: Raised the Line of Credit to $30,000,000");
    expect(said).toContain("Filed: Closed the Q2 covenant test period");
  });

  it("says nothing at all where the caller holds no trail, rather than an empty fact", () => {
    expect(deskContext(bundle(), NAME)).not.toMatch(/^Filed:/m);
  });
});

/* ========================================================= FINDING A10 / A11 / A12

   THE CHAT'S OWN COPY.

   Three banker-facing strings gave up without a next step, and one of them
   handed the banker the connector layer's own fix copy, which names the IDB
   Gateway and claude.ai connector settings. The founder's rule is that a
   degrade names what could not be done and the next real option, and that no
   path says "gateway" to a banker.                                           */

describe("A10-A12: the chat's degrades name a next step and never the plumbing", () => {
  it("FIXED 2026-09-12: every banker-facing chat string is sober and carries a move", async () => {
    const chat = await import("./components/ChatPanel");
    for (const said of [
      chat.CHAT_ASK_FAILED,
      chat.CHAT_EMPTY_ANSWER,
      chat.CHAT_OFF_BODY,
      // ADDED 2026-09-13 with the never-silent lane: a declined door and a door
      // that timed the call out are two more sentences a banker reads, and they
      // are held to the same rule as the three that were already here.
      chat.CHAT_DESK_OFF,
      deskTimeoutAnswer(75),
    ]) {
      expect(said).not.toMatch(/gateway|connector|claude\.ai|settings|gpt|copilot/i);
      expect(said).not.toMatch(/[—–!]/);
      expect(said).toMatch(/ask again|room|tabs/i);
    }
  });

  it("FIXED 2026-09-12: the off state says what still works rather than how to wire it up", async () => {
    const { CHAT_OFF_BODY } = await import("./components/ChatPanel");
    expect(CHAT_OFF_BODY).toMatch(/already read/i);
    expect(CHAT_OFF_BODY).not.toMatch(/open the cockpit through the agent/i);
  });
});

/* ========================================================= FINDING A13

   THE LANDING HAD NO LANE AT ALL.

   The desk was tried only where `account?.accountId` AND a resolved bundle were
   both in hand, so a question typed on the worklist view fell past the desk,
   past a connector that is not in every view, and into the legacy prompt
   bridge, which throws where nothing is wired. The banker asked the first
   surface the cockpit opens on and got a note with no answer in it.          */

describe("A13: the book lane is bounded and refuses exactly like the relationship lane", () => {
  const state = () => ({ data, queue: deriveQueue(data, false) });
  const ask = (deadlineMs?: number) =>
    askDeskPortfolio({ state: state(), question: "who needs attention today?", deadlineMs });

  it("FIXED 2026-09-13: the book travels with the ask, under the book's own rules", async () => {
    const seen: string[] = [];
    await openDesk(
      Object.assign(async (input: string) => {
        seen.push(input);
        return { text: "Start with Brightwater.", truncated: false, modelTierApplied: "quick" as const };
      }, {}),
    );
    await ask(500);
    expect(seen[0].startsWith(DESK_PORTFOLIO_RULES)).toBe(true);
    expect(seen[0]).toContain("The book on this page is 5 relationships");
    expect(seen[0]).toContain("Brightwater Foods Group");
  });

  it("a door that never answers resolves inside the deadline, with the wait named", async () => {
    await openDesk(never());
    const said = await ask(40);
    expect(said).toMatch(/has not come back/i);
    expect(said).toMatch(/ask again/i);
  });

  it("a door that refuses still throws, carrying the code the panel branches on", async () => {
    await openDesk(throws("not_granted"));
    await expect(ask(500)).rejects.toMatchObject({ code: "not_granted", permanent: true });
  });
});

/* ========================================================= FINDING A14

   EVERY SessionFailure ON THE DESK LANE WAS SWALLOWED.

   `catch {}`, with a comment saying the gateway path would answer, on a view
   that frequently has no gateway path. `takeDeclineNotice()` had no caller
   anywhere in the app, so a door the viewer had DECLINED was indistinguishable
   from a door that was merely slow: both left "Composing..." and then nothing.
   The three kinds of failure are three different next moves, so they are three
   different sentences.                                                       */

describe("A14: a desk failure is never swallowed, and the three kinds read differently", () => {
  it("FIXED 2026-09-13: timeout, refusal and breakage each have their own sentence", async () => {
    const { CHAT_ASK_FAILED, CHAT_DESK_OFF, deskFailureSentence } = await import("./components/ChatPanel");
    const seconds = Math.round(DESK_TIMEOUT_MS / 1000);

    expect(deskFailureSentence({ code: "timeout" })).toBe(deskTimeoutAnswer(seconds));
    // The rooms' own typed clock, which reaches this lane through a caller's
    // signal rather than through the platform.
    expect(deskFailureSentence(new DeadlineExpired("the desk", 75_000, "narrate"))).toBe(deskTimeoutAnswer(seconds));
    // A declined door never says "ask again": that would loop on a decision the
    // banker has already made, which is what rule 5 forbids.
    expect(deskFailureSentence({ code: "not_granted", permanent: true })).toBe(CHAT_DESK_OFF);
    expect(CHAT_DESK_OFF).not.toMatch(/ask again/i);
    expect(deskFailureSentence({ code: "upstream_error" })).toBe(CHAT_ASK_FAILED);
    // A door that throws a shape nobody recognised is still a bubble.
    expect(deskFailureSentence(new Error("no shape at all"))).toBe(CHAT_ASK_FAILED);
  });

  it("the decline notice is the door's own sentence, said once per view", async () => {
    const { takeDeclineNotice } = await import("./channel/sampleDoor");
    await openDesk(throws("not_granted"));
    await expect(askDesk({ bundle: bundle(), accountName: NAME, question: "hi", deadlineMs: 500 })).rejects.toBeTruthy();
    expect(takeDeclineNotice()).toBe(DECLINE_NOTICE);
    expect(takeDeclineNotice()).toBeNull();
  });
});

/* ========================================================= LOOPS AND DOUBLES

   Rule 5, on the two mechanisms that have produced one in this panel before:
   the retry re-posting the banker's own bubble, and the agent's written-back
   copy of a question rendering beside the local one.                         */

describe("rule 5: one input, one bubble, one answer", () => {
  it("drops the agent's echo of a question the banker already watched arrive", async () => {
    const { mergeMessages } = await import("./components/ChatPanel");
    const ts = new Date().toISOString();
    const merged = mergeMessages(
      [{ id: "agent-copy", role: "user", text: "What is the exposure?", ts }],
      [{ id: "local", role: "user", text: "What is the exposure?", ts }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("local");
  });

  it("keeps both where the banker genuinely asked the same thing twice", async () => {
    const { mergeMessages } = await import("./components/ChatPanel");
    const ts = new Date().toISOString();
    const merged = mergeMessages(
      [],
      [
        { id: "a", role: "user", text: "What is the exposure?", ts },
        { id: "b", role: "user", text: "What is the exposure?", ts },
      ],
    );
    expect(merged).toHaveLength(2);
  });
});
