import { afterEach, describe, expect, it, vi } from "vitest";

/* =============================================================================
   QUICK FIRST, ESCALATE ONCE (0.9.36).

   A plain instruction stays on the quick tier. An answer the quick tier gives
   back that the room cannot read is asked once more on the default tier before
   the banker sees anything; a readable answer, a real clarifying question and a
   silent door are never re-asked.
   ============================================================================= */

const calls: Array<{ tier: string }> = [];
let answers: string[] = [];

vi.mock("./sampleDoor", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sampleDoor")>();
  return {
    ...real,
    sampleAvailable: () => true,
    askSessionJson: vi.fn(async (_prompt: string, opts: { tier: string }) => {
      calls.push({ tier: opts.tier });
      const next = answers.shift();
      if (next === undefined) throw new Error("no door answered");
      return next;
    }),
  };
});

const { askBrain, isUnreadable } = await import("./brainLane");

const envelope = { room: "facility", line: "bump the big revolver by five million" } as unknown as Parameters<typeof askBrain>[0];
const CLARIFY = JSON.stringify({ type: "clarify", text: "Which of the two lines of credit do you mean?" });

afterEach(() => {
  calls.length = 0;
  answers = [];
});

describe("the quick tier, and the one escalation", () => {
  it("asks a plain instruction once, on the quick tier, when the answer reads", async () => {
    answers = [CLARIFY];
    const reply = await askBrain(envelope);
    expect(calls.map((c) => c.tier)).toEqual(["quick"]);
    expect(reply.type).toBe("clarify");
    expect(isUnreadable(reply)).toBe(false);
  });

  it("asks again on the default tier when the quick answer cannot be read, and shows the second answer", async () => {
    answers = ["this is not json at all", CLARIFY];
    const reply = await askBrain(envelope);
    expect(calls.map((c) => c.tier)).toEqual(["quick", "default"]);
    expect(isUnreadable(reply)).toBe(false);
    expect(reply.type === "clarify" && reply.text).toContain("Which of the two lines");
  });

  it("escalates once and no more: two unreadable answers end on the neutral degrade", async () => {
    answers = ["garbage", "more garbage"];
    const reply = await askBrain(envelope);
    expect(calls.map((c) => c.tier)).toEqual(["quick", "default"]);
    expect(isUnreadable(reply)).toBe(true);
  });

  it("never re-asks a door that did not answer at all", async () => {
    answers = [];
    const reply = await askBrain(envelope);
    expect(calls.map((c) => c.tier)).toEqual(["quick"]);
    expect(isUnreadable(reply)).toBe(false);
  });

  it("leaves a caller that pins its own rung alone", async () => {
    answers = ["garbage"];
    await askBrain(envelope, { rung: { rung: 2, tier: "quick", why: "pinned" } });
    expect(calls.map((c) => c.tier)).toEqual(["quick"]);
  });
});
