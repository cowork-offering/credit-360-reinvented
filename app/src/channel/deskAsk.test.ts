import { describe, expect, it, vi } from "vitest";
import {
  DESK_ANSWER_WORDS,
  DESK_THREAD_TURNS,
  deskAnswer,
  deskContext,
  deskThread,
} from "./deskAsk";
import type { BorrowerBundle, C360Data } from "../data/contract";
import live from "../../../artifact/live-data.json";

/* =============================================================================
   THE COCKPIT CHAT'S OWN BOOK (golden rule 1 and 5, findings B5 and I8).

   The desk is the surface a founder demo opens on and it was the thinner of the
   two books: it knew nothing of the version chain that locks a room, it carried
   no conversation, and it cut its own context mid-sentence with nothing to say
   it had. Everything here is measured against the baked book, never asserted
   from the prose.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const bundle = () => data.borrowers![HARTWELL];

/** Hartwell's own live fork, at the cockpit's contract: the second package's
 *  two Booked members, and the same two copied onto an unbooked version. This
 *  is the fixture `chatGolden.repro.test.ts` proves the WORKROOM envelope on;
 *  the desk now has to answer off the same facts. */
const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";
const member = (over: Record<string, unknown>) => ({ status: "Open", productPackageId: SOURCE, stage: "Booked", ...over });
const forked = () =>
  ({
    snapshot: { accountId: HARTWELL, name: "Hartwell Precision Manufacturing LLC", primaryRiskRating: "4" },
    exposure: {
      facilities: [
        member({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 }),
        member({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000 }),
        member({
          loanId: "a4Zbb000002KFD3EAO",
          name: "Hartwell - Equipment - $1,500,000.00",
          committed: 1_500_000,
          productPackageId: VERSION,
          stage: "Qualification",
        }),
        member({
          loanId: "a4Zbb000002KFD4EAO",
          name: "Hartwell - Purchase - $12,000,000.00",
          committed: 12_000_000,
          productPackageId: VERSION,
          stage: "Qualification",
        }),
      ],
    },
  }) as unknown as BorrowerBundle;

describe("the version chain reaches the cockpit chat (finding B5)", () => {
  const text = () => deskContext(forked(), "Hartwell Precision Manufacturing LLC");

  it("says WHY the source package is locked, in the words the picker uses", () => {
    const said = text();
    expect(said).toContain("Modification in Progress");
    expect(said).toContain("a version of it is unbooked with the org");
    expect(said).toContain(VERSION);
    expect(said).toMatch(/a second modification or renewal on that package is refused/);
    // The instruction the golden rule's rule 1 is about: say it, do not refuse
    // blind on a fact the chat was never given.
    expect(said).toMatch(/That is WHY the room is locked; say it rather than refusing blind/);
  });

  it("says what the version itself is, and that it is still the banker's", () => {
    const said = text();
    expect(said).toContain("IS the unbooked modification version of another package");
    expect(said).toContain("still editable until it reaches approval");
    expect(said).toMatch(/carries no booked facility/);
  });

  it("reads a version the org has taken as no longer editable", () => {
    const taken = forked();
    for (const f of taken.exposure!.facilities!) {
      if (f.productPackageId === VERSION) f.stage = "Approval / Loan Committee";
    }
    const said = deskContext(taken, "Hartwell");
    expect(said).toContain("at Approval / Loan Committee and no longer editable");
    expect(said).not.toContain("still editable until it reaches approval");
  });

  it("says nothing at all where no version is in flight, rather than an empty fact", () => {
    // The baked Hartwell: two packages, no fork.
    const said = deskContext(bundle(), bundle().snapshot!.name!);
    expect(said).not.toMatch(/Modification in Progress|unbooked modification version/);
  });
});

describe("the context names what it had to cut (finding I8)", () => {
  /** A book far past the 7,000-character budget: the cut has to bite. */
  const wide = () => {
    const b = bundle();
    const facilities = Array.from({ length: 200 }, (_, i) => ({
      loanId: `L${i}`,
      status: "Open",
      stage: "Booked",
      productType: "Non-Real Estate",
      committed: 1_000_000 + i,
      outstanding: 500_000,
      interestRate: 6.5,
      maturityDate: "2027-03-15",
    }));
    return { ...b, exposure: { ...b.exposure, facilities } } as unknown as BorrowerBundle;
  };

  it("cuts at a whole line and names the parts of the book that did not travel", () => {
    const said = deskContext(wide(), "Hartwell Precision Manufacturing LLC");
    expect(said).toContain("This context was cut to fit, so it does not carry");
    // What was dropped, by the part of the book it came from, so the model can
    // refuse it by name instead of reading silence as a fact.
    expect(said).toMatch(/the covenants and their thresholds/);
    expect(said).toMatch(/Say that it is not in front of you rather than reading what is here as the whole book/);
    // And it still ends on a whole sentence, never mid-figure.
    expect(said.trim().endsWith(".")).toBe(true);
  });

  it("says nothing about a cut on a book that fits", () => {
    const said = deskContext(bundle(), bundle().snapshot!.name!);
    expect(said).not.toMatch(/cut to fit/);
    expect(said.length).toBeLessThan(7_000);
  });
});

describe("the desk carries its own conversation (golden rule 5)", () => {
  const turns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ who: (i % 2 ? "agent" : "banker") as "banker" | "agent", text: `line ${i}` }));

  it("carries the last N exchanges, oldest first, and nothing older", () => {
    const said = deskThread(turns(10));
    expect(said).toMatch(/The conversation so far, oldest first/);
    const kept = said.split("\n").filter((l) => /^(Banker|You): /.test(l));
    expect(kept.length).toBe(DESK_THREAD_TURNS);
    expect(kept[0]).toBe("Banker: line 4");
    expect(kept[kept.length - 1]).toBe("You: line 9");
    expect(said).not.toContain("line 3");
  });

  it("tells the model it is ONE conversation, which is what rule 5 turns on", () => {
    expect(deskThread(turns(2))).toMatch(/never re-ask what has been answered, and never answer the same input twice/);
  });

  it("is nothing at all before anything has been said", () => {
    expect(deskThread([])).toBe("");
    expect(deskThread(undefined)).toBe("");
  });

  it("gives up the oldest turns rather than crowding out the book", () => {
    const fat = Array.from({ length: 6 }, (_, i) => ({ who: "banker" as const, text: `${i} ${"x".repeat(900)}` }));
    const said = deskThread(fat);
    const kept = said.split("\n").filter((l) => /^Banker: /.test(l));
    expect(kept.length).toBeLessThan(6);
    // The LAST turn always survives: it is the one the banker just said.
    expect(kept[kept.length - 1]).toContain("5 ");
  });
});

describe("the desk answer is one bubble, guarded like a room's", () => {
  it("strips the markdown the panel used to render as punctuation", () => {
    const said = deskAnswer("## The position\n\n- **Line of Credit**: $15M committed\n- Equipment: $8M\n\n`code`");
    expect(said).not.toMatch(/[#*`]/);
    expect(said).toContain("Line of Credit");
    expect(said).toContain("$15M committed");
  });

  it("holds the answer to its word budget, cutting at whole sentences", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about the relationship.`).join(" ");
    const said = deskAnswer(long);
    expect(said.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(DESK_ANSWER_WORDS);
    // Whole sentences only: nothing is ever cut mid-clause.
    expect(said.trim().endsWith(".")).toBe(true);
  });

  it("falls back to the raw text rather than to silence where the guard empties it", () => {
    expect(deskAnswer("```\nfenced only\n```")).toBe("```\nfenced only\n```");
    expect(deskAnswer("")).toBe("");
  });
});

describe("askDesk sends the rules, the book, the conversation and the question", () => {
  it("composes the prompt in that order and guards what comes back", async () => {
    vi.resetModules();
    const seen: string[] = [];
    vi.doMock("./sampleDoor", () => ({
      sampleAvailable: () => true,
      askSession: async (prompt: string) => {
        seen.push(prompt);
        return "## Heading\n\nThe relationship carries $57M committed across nine facilities.";
      },
    }));
    const { askDesk, DESK_RULES } = await import("./deskAsk");
    const answer = await askDesk({
      data,
      bundle: bundle(),
      accountName: bundle().snapshot!.name!,
      question: "and the other one?",
      thread: [
        { who: "banker", text: "what is the exposure" },
        { who: "agent", text: "$57M committed across the relationship." },
      ],
    });
    const prompt = seen[0];
    expect(prompt.indexOf(DESK_RULES)).toBe(0);
    expect(prompt).toContain("\n\nContext:\n");
    expect(prompt).toContain("The conversation so far, oldest first");
    expect(prompt).toContain("Banker: what is the exposure");
    expect(prompt).toContain("You: $57M committed across the relationship.");
    expect(prompt.trimEnd().endsWith("Question: and the other one?")).toBe(true);
    // The door's own text, through the rooms' guard: one bubble, and the
    // heading gone rather than rendered as punctuation.
    expect(answer).toBe("The relationship carries $57M committed across nine facilities.");
    vi.doUnmock("./sampleDoor");
    vi.resetModules();
  });
});
