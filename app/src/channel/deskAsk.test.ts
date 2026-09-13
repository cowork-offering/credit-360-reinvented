import { describe, expect, it, vi } from "vitest";
import {
  DESK_ANSWER_WORDS,
  DESK_PORTFOLIO_RULES,
  DESK_THREAD_CAP,
  DESK_THREAD_TURNS,
  PORTFOLIO_CONTEXT_CAP,
  deskAnswer,
  deskContext,
  deskPortfolioContext,
  deskThread,
} from "./deskAsk";
import { PROMPT_CAP_BYTES, RECOMMEND_ONLY_WHEN_GROUNDED, VOICE } from "./doctrine";
import type { AccountRow, BorrowerBundle, C360Data } from "../data/contract";
import { deriveQueue } from "../data/queue";
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

  /* WHAT IS LOST CHANGED 2026-09-12 (backlog item 9), and that is the point.
     The desk used to emit its facility list before its covenants, so a book of
     200 facilities cost the banker the thresholds. It now emits its parts in
     the reverse of `CONTEXT_DROP_ORDER`, the envelope's own order: the totals
     and the covenants survive, and the facility list is the first thing the cut
     reaches. One order, two surfaces. */
  it("cuts at a whole line and names the parts of the book that did not travel", () => {
    const said = deskContext(wide(), "Hartwell Precision Manufacturing LLC");
    expect(said).toContain("This context was cut to fit, so it does not carry");
    // What was dropped, by the part of the book it came from, so the model can
    // refuse it by name instead of reading silence as a fact.
    expect(said).toMatch(/the facility list/);
    expect(said).toMatch(/who is on the deal/);
    // And what survived it: the two blocks the shared order protects.
    expect(said).toMatch(/Facilities across the relationship, every package included/);
    expect(said).toMatch(/Debt Service Coverage of Borrower/);
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

/* =============================================================================
   THE BOOK CONTEXT, ON THE REAL BOOK (founder 2026-09-13, the "Composing"
   report; W1 finding (a)).

   The landing had no context of its own, so the desk could not be asked there
   at all. Everything below is measured against `artifact/live-data.json`, the
   book the cockpit actually opens on, and the three questions the founder
   named are each asserted by the facts their answer stands on.
   ============================================================================= */

describe("the landing's own book reaches the desk", () => {
  const state = () => ({ data, queue: deriveQueue(data, false) });
  const said = () => deskPortfolioContext(state());

  it("WHO NEEDS ATTENTION: every queue row, by name, with its reason code and the words the chip says", () => {
    const text = said();
    for (const name of [
      "Hartwell Precision Manufacturing LLC",
      "Piedmont Precision Components, Inc.",
      "Brightwater Foods Group",
      "Sterling Fabrication Co.",
      "Kingsley Precision Works",
    ]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("CLIENT_REQUEST (client request waiting)");
    expect(text).toContain("COVENANT_BREACH (covenant breach)");
    expect(text).toContain("MODIFICATION_CLUSTER (modification cluster)");
    // An overdue test is told apart from one merely due, which is the half-step
    // the queue itself ranks on.
    expect(text).toContain("the test is overdue");
  });

  it("severity is the ORDER, and the context says so rather than inventing a scale", () => {
    const text = said();
    expect(text).toMatch(/Position is the severity; there is no other scale/);
    // The client request outranks the breach, which outranks the overdue tests.
    const at = (name: string) => text.indexOf(name);
    expect(at("Sterling Fabrication Co.")).toBeLessThan(at("Brightwater Foods Group"));
    expect(at("Brightwater Foods Group")).toBeLessThan(at("Hartwell Precision Manufacturing LLC"));
    expect(text).toContain("1. Sterling Fabrication Co.");
  });

  it("HOW MUCH IS COMMITTED: the book totals, summed the way the KPI band sums them", () => {
    const text = said();
    // $135M is the sum of the five rows on the page. The org's own bookTotals
    // says $127M because it spans accounts this page does not show, and the
    // chat may not state a book the landing does not.
    expect(text).toContain("The book on this page is 5 relationships, $135M committed, $97.75M drawn");
    expect(text).toContain("summed over the rows on this page and over nothing else");
    expect(text).toContain("5 relationships need action");
  });

  it("THE THINNEST COVERAGE: the org's own ratio on every staged relationship", () => {
    const text = said();
    expect(text).toContain("collateral coverage 0.96×"); // Brightwater, the thinnest
    expect(text).toContain("collateral coverage 1.02×");
    expect(text).toContain("collateral coverage 1.09×");
    expect(text).toContain("collateral coverage 1.55×");
    expect(text).toContain("collateral coverage 1.65×");
    expect(text).toMatch(/as the org computes it across that relationship/);
  });

  it("says every total's scope, so the landing and a room never read as two books", () => {
    // Hartwell is $54.0M here (the portfolio read's rollup) and $57.0M in the
    // relationship room (its own active facilities). Both honest; the scope is
    // what stops them being two relationships.
    expect(said()).toContain("$54M total credit exposure as the portfolio read carries it");
    expect(deskContext(bundle(), "Hartwell Precision Manufacturing LLC")).toContain(
      "Facilities across the relationship, every package included",
    );
  });

  it("refuses what a book-level read cannot state, by name, and names the move", () => {
    const text = said();
    expect(text).toMatch(/This view does not carry the facilities on any one relationship/);
    expect(text).toMatch(/covenant values and the thresholds they test against/);
    expect(text).toMatch(/collateral, its valuations and what it secures/);
    expect(text).toMatch(/the obligor group, the guarantors and who is on each deal/);
    expect(text).toMatch(/open the relationship for those/);
  });

  it("carries the quiet rest as a count rather than a second queue", () => {
    // The live book is all queue, so the quiet line is absent rather than an
    // empty fact. An absent block is never a zero.
    expect(said()).not.toMatch(/carr(y|ies) no signal today/);

    const quiet = structuredClone(data);
    quiet.worklist = { accountIds: [quiet.portfolio.accounts[0].accountId], reasons: {} };
    quiet.borrowers = {};
    quiet.borrower = { snapshot: { accountId: "none" } } as unknown as C360Data["borrower"];
    const text = deskPortfolioContext({ data: quiet, queue: deriveQueue(quiet, true) });
    expect(text).toMatch(/relationships carry no signal today/);
    expect(text).toContain("Brightwater Foods Group");
    expect(text).toMatch(/Quiet is not clear/);
  });
});

describe("the book context is budgeted, and says when it was cut", () => {
  /** A book far past the portfolio budget: 60 relationships, all on the queue. */
  const wide = (): C360Data => {
    const accounts: AccountRow[] = Array.from({ length: 60 }, (_, i) => ({
      accountId: `001WIDE${String(i).padStart(10, "0")}`,
      name: `Wide Industrial Holdings ${i} Incorporated`,
      industry: "Manufacturing",
      riskRating: "5",
      tce: 10_000_000 + i,
      outstanding: 5_000_000 + i,
    }));
    return {
      ...data,
      portfolio: { ...data.portfolio, accounts },
      worklist: {
        accountIds: accounts.map((a) => a.accountId),
        reasons: Object.fromEntries(accounts.map((a) => [a.accountId, ["COVENANT_DUE"]])),
      },
      borrowers: {},
    } as unknown as C360Data;
  };

  it("cuts at a whole line, names the part of the book that did not travel, and keeps the loudest rows", () => {
    const text = deskPortfolioContext({ data: wide(), queue: deriveQueue(wide(), true) });
    expect(text.length).toBeLessThanOrEqual(PORTFOLIO_CONTEXT_CAP);
    expect(text).toContain("This context was cut to fit, so it does not carry");
    expect(text).toMatch(/the rest of the needs-action queue/);
    // The totals and the top of the queue survive the cut; the tail is what
    // goes. Rank one is the largest exposure, which is the queue's own
    // tie-break between rows carrying the same reason.
    expect(text).toContain("The book on this page is 60 relationships");
    expect(text).toContain("1. Wide Industrial Holdings 59 Incorporated");
    expect(text).not.toContain("Wide Industrial Holdings 0 Incorporated");
    expect(text).toMatch(/Say that it is not in front of you rather than reading what is here as the whole book/);
    expect(text.trim().endsWith(".")).toBe(true);
    // The honesty list is reserved out of the budget, so a cut never eats it.
    expect(text).toMatch(/open the relationship for those/);
  });

  it("says nothing about a cut on the book that fits", () => {
    expect(deskPortfolioContext({ data, queue: deriveQueue(data, false) })).not.toMatch(/cut to fit/);
  });

  it("the WIDEST book prompt sits well inside the prompt cap", () => {
    const context = deskPortfolioContext({ data: wide(), queue: deriveQueue(wide(), true) });
    const thread = deskThread(
      Array.from({ length: DESK_THREAD_TURNS }, (_, i) => ({ who: "banker" as const, text: "x".repeat(400) + i })),
    );
    const question = "x".repeat(500);
    const prompt = `${DESK_PORTFOLIO_RULES}\n\nContext:\n${context}${thread}\n\nQuestion: ${question}`;
    // MEASURED, NOT GUESSED (the doctrine file's own discipline).
    console.info(
      `[budget] portfolio prompt ${prompt.length} B = rules ${DESK_PORTFOLIO_RULES.length} + context ${context.length} (cap ${PORTFOLIO_CONTEXT_CAP}) + thread ${thread.length} (cap ${DESK_THREAD_CAP}) + question ${question.length}; cap ${PROMPT_CAP_BYTES}`,
    );
    expect(context.length).toBeLessThanOrEqual(PORTFOLIO_CONTEXT_CAP);
    expect(prompt.length).toBeLessThan(PROMPT_CAP_BYTES);
  });

  it("carries the one rule and the one voice the other two surfaces carry", () => {
    expect(DESK_PORTFOLIO_RULES).toContain(RECOMMEND_ONLY_WHEN_GROUNDED);
    expect(DESK_PORTFOLIO_RULES).toContain(VOICE);
    expect(DESK_PORTFOLIO_RULES).toMatch(/never leave the banker with nothing to do/i);
    expect(DESK_PORTFOLIO_RULES).toMatch(/name the relationship and the room/i);
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
