import { describe, expect, it } from "vitest";
import {
  NOT_CONNECTED_CLARIFY,
  UNREADABLE_CLARIFY,
  timeoutClarify,
  ENVELOPE_CAP_BYTES,
  ENVELOPE_BLOCK_DROP_ORDER,
} from "./channel/brainLane";
import { ALWAYS_BLOCK_IDS, DOCTRINE_BLOCKS, composeDoctrine } from "./channel/doctrine";
import { toolsCovering } from "./channel/ladder";
import { buildReadBlocks } from "./components/workroom/readBlocks";
import { toReadCardModel } from "./components/workroom/brainRoute";
import { FACILITY_HANDOFF } from "./components/relationship/relRoute";
import { CREATE_GAPS, nextStep, relContextFor } from "./components/relationship/reviewFlows";
import { REL_ROUTE_WORDS } from "./components/relationship/relBrain";
import { SKIPPED } from "./components/relationship/relStep";
import { NO_COMPLIANCE_ROW } from "./components/relationship/relBook";
import { whyChecked } from "./workroom/explain";
import { deskContext } from "./channel/deskAsk";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   THE CHAT GOLDEN RULE — REPRODUCTIONS, NOT FIXES.

   knowledge/CHAT-GOLDEN-RULE.md is the founder's standard for every
   conversational surface. This file REPRODUCES where the layer stands short of
   it. Nothing here changes production behaviour and nothing here is a fix.

   TWO KINDS OF TEST, deliberately:

     PASSING    the gap, demonstrated. The book holds a fact, the envelope drops
                it, and `notCarried` does not name it either — so the assertion
                that the gap EXISTS is a true statement about today's tree and
                goes green. When the gap is closed these are the tests that turn
                red, which is exactly the signal wanted: the proposal landed.

     it.todo    the behaviour the golden rule asks for, named and unimplemented.
                A todo is a commitment in the suite rather than a line in a
                document nobody re-reads.

   Every finding here is written up, ranked and costed in
   knowledge/CHAT-TUNING-PROPOSAL.md. Findings before fixes.
   ============================================================================= */

const data = live as unknown as C360Data;
/** Hartwell: the deepest book in the artifact. Two packages, seven active
 *  facilities, six covenants, five parties, a parent, an affiliate and two
 *  natural-person owners. If rule 1 holds anywhere, it holds here. */
const HARTWELL = "001bb00001I7FPNAA3";
const PACKAGE = "a5Fbb000000IHFJEA4";

const bundle = () => data.borrowers![HARTWELL];

const readsFor = () => {
  const b = bundle();
  return buildReadBlocks({
    bundle: b,
    accountName: b.snapshot!.name!,
    productPackageId: PACKAGE,
    generatedAt: "2026-09-03T08:00:00.000Z",
  })!;
};

/** Everything the envelope's read blocks say, as one searchable string. A fact
 *  the desk can reach is a fact somewhere in here. */
const readsText = () => JSON.stringify(readsFor());

/* ========================================================== RULE 1 — the book

   "It knows the FULL input of the relationship ... and including the DOWNSTREAM
   relationships of the one in view."                                          */

describe("rule 1: the book holds the obligor group and the envelope drops it", () => {
  it("the bundle carries the downstream relationship graph", () => {
    // The read this cockpit already took. Parent, affiliate and two owners, on
    // the relationship in view.
    const roles = (bundle().graph?.connections ?? []).map((c) => c.role);
    expect(roles).toContain("Parent");
    expect(roles).toContain("Affiliated Company");
    expect(roles).toContain("Owner");
    const named = (bundle().graph?.connections ?? []).map((c) => c.counterpartyName);
    expect(named).toContain("Hartwell Industrial Holdings LLC");
    expect(named).toContain("Hartwell Logistics LLC");
  });

  it("REPRO: the STRUCTURE never travels, and it is not refused by name either", () => {
    const text = readsText();
    // `buildReadBlocks` reads `graph.legalEntities` and never `graph.connections`
    // (readBlocks.ts:120). So a party reaches the desk only where the org wrote
    // it an INVOLVEMENT on a loan, and it arrives as a role on a facility with
    // no structural relationship attached to it at all.
    const rows = readsFor().involvements!;
    // The affiliate is here, and reads as a role on one facility, not as an
    // affiliate of the borrower.
    expect(rows.find((r) => r.name === "Hartwell Logistics LLC")).toMatchObject({
      role: "Related Entity",
      scope: "Construction",
    });
    // The parent is here, and reads as a guarantor. Nothing says it owns 100%.
    expect(rows.find((r) => r.name === "Hartwell Industrial Holdings LLC")!.role).toBe("Guarantor");
    // The two natural-person owners are here, and their ownership is dropped:
    // `detail` prefers the guaranty type and suppresses the percentage
    // (readBlocks.ts:136-139).
    expect(rows.find((r) => r.name === "James Hartwell")!.detail).toBe("Unlimited guaranty");
    expect(
      bundle().graph!.connections!.find((c) => c.counterpartyName === "James Hartwell" && c.role === "Owner")!
        .totalOwnershipPercent,
    ).toBe(60);
    // And no structural word travels at all.
    expect(text).not.toMatch(/affiliate\b/i);
    expect(text).not.toMatch(/\bparent\b/i);
    expect(text).not.toMatch(/subsidiar/i);
    expect(text).not.toMatch(/cross-?default/i);
    expect(text).not.toMatch(/cross-?collateral/i);
    expect(text).not.toMatch(/household/i);
    // AND NOT REFUSED BY NAME EITHER, which is the sharper half. `notCarried`
    // exists so an absent block is refusable rather than reported as silence;
    // the obligor group is absent from both sides of that contract.
    const notCarried = readsFor().notCarried.join(" ");
    expect(notCarried).not.toMatch(/affiliate|parent|subsidiar|obligor|household|cross-?default/i);
  });

  it("REPRO: the guarantors travel with no exposure and no grade of their own", () => {
    const guarantors = readsFor().involvements!.filter((i) => /guarantor/i.test(i.role));
    expect(guarantors.map((g) => g.name)).toContain("Hartwell Industrial Holdings LLC");
    // The org's own read carries a grade on that guarantor.
    const signals = bundle().signals?.guarantorSignals ?? [];
    expect(signals.some((s) => s.guarantorName === "Hartwell Industrial Holdings LLC" && s.highestRiskGrade === "4")).toBe(
      true,
    );
    // The envelope carries neither the grade nor any exposure figure for them.
    for (const g of guarantors) {
      expect(JSON.stringify(g)).not.toMatch(/grade|exposure|committed|outstanding/i);
    }
  });

  it("REPRO: nCino's own obligor exposure is on the snapshot and not on the envelope", () => {
    // The two figures nCino distinguishes, both staged by the read.
    expect(bundle().snapshot!.totalBorrowerExposure).toBe(54_000_000);
    expect(bundle().snapshot!.totalObligorExposure).toBe(38_700_000);
    // The envelope's exposure block is a sum over the package's own facilities.
    // It is not wrong; it is simply not the obligor figure, and the obligor
    // figure is nowhere.
    expect(readsText()).not.toMatch(/obligor/i);
  });

  it("REPRO: the action history reaches the envelope builder and is discarded", () => {
    const b = bundle();
    // The trail the room already holds (WorkroomHost.tsx:151 passes it as
    // `ReadSource.history`; RelationshipRoom.tsx:3137 does the same).
    const withHistory = buildReadBlocks({
      bundle: b,
      accountName: b.snapshot!.name!,
      productPackageId: PACKAGE,
      generatedAt: "2026-09-03T08:00:00.000Z",
      history: [
        {
          stagingId: "a8abb00001NL3jsAAD",
          actionId: "loan-modification",
          status: "Completed",
          summary: "The risk rating was reviewed and held at grade 4.",
          productPackageId: PACKAGE,
        },
      ],
    })!;
    // Byte for byte the same blocks: `buildReadBlocks` never reads `history`.
    expect(JSON.stringify(withHistory)).toBe(readsText());
    expect(withHistory.notCarried.join(" ")).not.toMatch(/history|prior action|what was filed/i);
  });

  it("REPRO: a facility travels as a label and a commitment, with no maturity, stage or drawn figure", () => {
    const facility = (bundle().exposure?.facilities ?? []).find((f) => f.loanId === "a4Zbb0000027MaYEAU")!;
    // What the read holds about it.
    expect(facility.maturityDate).toBe("2027-03-15");
    expect(facility.stage).toBe("Booked");
    expect(facility.outstanding).toBe(9_200_000);
    expect(facility.coverageRatio).toBe(1.3);
    // What travels: the package-level sums, and nothing per facility beyond the
    // covenant/collateral/pricing scopes. "What does this facility do" cannot be
    // answered with its maturity, its drawn balance or its own coverage.
    const text = readsText();
    expect(text).not.toContain("2027-03-15");
    expect(text).not.toMatch(/"stage"/);
    expect(readsFor().exposure).toEqual({
      committed: "$49M",
      drawn: "$31.03M",
      available: "$17.97M",
      facilities: 7,
    });
  });

  it("REPRO: the ladder can route no line to a tool about an affiliate, a parent or a version in flight", () => {
    // The rung-3 coverage mirrors the two exposed read doors and nothing else,
    // so a downstream question cannot reach a call-out either.
    expect(toolsCovering("what is Hartwell Industrial Holdings' own exposure")).toEqual([]);
    expect(toolsCovering("is there a modification version in flight on this package")).toEqual([]);
    expect(toolsCovering("what does the affiliate carry")).toEqual([]);
    expect(toolsCovering("which facilities cross-default off this one")).toEqual([]);
  });

  it("the envelope has room for what is missing: it fits well inside its own cap", () => {
    // 6,119 bytes of read blocks on the deepest relationship in the book,
    // against a 10,000 byte cap. The rule-1 additions have to be budgeted, not
    // invented room for.
    expect(readsText().length).toBeLessThan(6_500);
    expect(ENVELOPE_CAP_BYTES).toBe(10_000);
  });

  it.todo("the envelope carries the obligor group: parent, affiliates, owners, with their own grade where the read holds one");
  it.todo("the envelope names the downstream relationship in notCarried wherever the cockpit cannot carry it");
  it.todo("the envelope carries the in-flight package version the room is already locked by (book/packages.ts computes it)");
  it.todo("the envelope carries the plan's own pro-forma package total, so 'what does this do to exposure' is read and not derived");
  it.todo("the envelope carries the relationship's own flags (deriveReasonsForBundle), so 'why is this flagged' is answered in the glass's words");
  it.todo("every new read block is added to ENVELOPE_BLOCK_DROP_ORDER, so nothing is dropped silently");

  it("REPRO: the drop order knows only the five blocks that exist today", () => {
    expect([...ENVELOPE_BLOCK_DROP_ORDER]).toEqual(["pricing", "collateral", "involvements", "covenants", "exposure"]);
  });
});

/* ============================ RULE 1, SECOND SURFACE — the cockpit chat

   The cockpit chat does not travel a BrainEnvelope at all. It composes its own
   prose context in `channel/deskAsk.ts` and sends rules + context + ONE
   question (deskAsk.ts:118). The two surfaces are not two views of one book;
   they are two different, differently incomplete books.                      */

describe("rule 1: the cockpit chat carries a different, thinner book", () => {
  const deskText = () => deskContext(bundle(), bundle().snapshot!.name!);

  it("REPRO: it states a covenant's current value and never its threshold", () => {
    const text = deskText();
    // The test value travels.
    expect(text).toContain("Debt Service Coverage of Borrower");
    expect(text).toContain("last 1.38");
    // The threshold does not. `deskContext` reads `actualValue` and never
    // `thresholdValue` (deskAsk.ts:72-82), so "what is this covenant doing" is
    // unanswerable on this surface: a figure with nothing to measure it against.
    expect(text).not.toContain("1.25");
    expect(text).not.toMatch(/threshold/i);
    // Where the workroom envelope carries both.
    expect(readsFor().covenants!.find((c) => c.name === "Debt Service Coverage of Borrower")!.threshold).toBe("≥ 1.25×");
  });

  it("REPRO: no collateral figures, no parties, no coverage and no honesty list travel", () => {
    const text = deskText();
    // "Collateral valuation recorded" rides in as an ACTIVITY TITLE; not one
    // collateral figure does.
    expect(text).not.toMatch(/pledge|lendable|advance rate|first mortgage|blanket lien/i);
    expect(text).not.toMatch(/guarantor|guaranty|borrower type|\bowner\b/i);
    expect(text).not.toMatch(/coverage ratio|collateral coverage|shortfall/i);
    expect(text).not.toContain("1.09");
    // No `notCarried`: the context simply stops at 7,000 characters
    // (deskAsk.ts:101), so a truncated book and a book with nothing in it read
    // the same to the model.
    expect(text).not.toMatch(/not carried|does not carry/i);
  });

  it("REPRO: the two surfaces report DIFFERENT committed totals for one relationship", () => {
    // The desk sums every ACTIVE facility on the relationship, across both
    // packages (deskAsk.ts:63-67).
    expect(deskText()).toContain("$57M committed");
    // The workroom envelope sums the facilities of the ANCHORED package
    // (readBlocks.ts:48-52, 168-179).
    expect(readsFor().exposure!.committed).toBe("$49M");
    // Both are honest about their own scope and neither says which scope it is.
    // A banker who asks the chat and then opens the room reads two figures.
  });

  it("REPRO: the desk carries per-facility figures the workroom envelope drops, and the other way round", () => {
    const text = deskText();
    // The desk holds the maturity, the drawn balance and the stage per facility.
    expect(text).toContain("matures Mar 15, 2027");
    expect(text).toContain("drawn");
    // The workroom envelope holds none of those, and holds thresholds,
    // collateral and parties the desk does not. Neither surface is the book.
    expect(readsText()).not.toContain("Mar 15, 2027");
  });

  it("REPRO: the cockpit chat is stateless: no conversation travels with the question", () => {
    // `askDesk` takes one `question` and no thread (deskAsk.ts:110-120), and
    // `ChatPanel.send` passes none (ChatPanel.tsx:259-264). The envelope's own
    // `thread` field exists precisely because "this is one conversation".
    const prompt = `${deskText()}`;
    expect(prompt).not.toMatch(/earlier|previously|you said|conversation so far/i);
  });

  it.todo("the cockpit chat and the workrooms compose their context through ONE builder over the same bundle");
  it.todo("the cockpit chat carries the covenant thresholds, so it can say what a covenant is doing");
  it.todo("the cockpit chat carries the last turns of its own conversation");
  it.todo("the cockpit chat names what it does not carry, rather than truncating silently at 7,000 characters");
});

/* ================================================= RULE 2 — guide and advise

   "Every question it asks leads with the current figure, offers the real
   options, and recommends one."                                              */

describe("rule 2: nothing in the doctrine holds an ask to figure, options and a recommendation", () => {
  const always = DOCTRINE_BLOCKS.filter((b) => ALWAYS_BLOCK_IDS.includes(b.id))
    .flatMap((b) => b.lines)
    .join("\n");

  it("REPRO: the shape rules govern what a clarify may ask about, never how it is put", () => {
    // The one rule that exists is about the WIRE, not about the banker.
    expect(always).toContain("A CLARIFY MAY ONLY ASK FOR A FIELD THE WIRE ACTUALLY CARRIES.");
    // No standing instruction to lead with the figure on file.
    expect(always).not.toMatch(/lead with the (current )?figure/i);
    expect(always).not.toMatch(/state the current figure/i);
    // No standing instruction to recommend one of the options offered.
    expect(always).not.toMatch(/recommend one/i);
  });

  it("REPRO: a clarify is valid with no options at all", async () => {
    const { parseBrainReply } = await import("./channel/brainLane");
    const bare = parseBrainReply('{"type":"clarify","text":"Which facility should this land on?"}');
    expect(bare.ok).toBe(true);
    // A blank form passes the validator. The founder's rule is that it should
    // not have been composed, and nothing in the layer says so.
  });

  it.todo("the doctrine requires every ask to carry the figure on file, the real options, and one recommendation");
});

/* ================================================ RULE 3 — explain on demand

   "'What is this covenant doing?' -> what it measures, the current value
   against its threshold, why it matters, what a breach would trigger."       */

describe("rule 3: the reply contract has no shape for an explanation", () => {
  it("REPRO: a read-card carries one line of prose and a table of label/value rows", async () => {
    const { parseBrainReply } = await import("./channel/brainLane");
    const parsed = parseBrainReply(
      JSON.stringify({
        type: "read-card",
        topic: "covenants",
        title: "Debt Service Coverage of Borrower tests 1.38x against a 1.25x floor",
        rows: [{ icon: "covenant", label: "Measured", value: "1.38x" }],
        followUp: "Do you want the cushion on the rest of the package?",
        // What an explanation needs and the shape has no room for.
        note: "It measures cash available to service debt. A breach would...",
      }),
    );
    expect(parsed.ok).toBe(true);
    // The extra prose survives the validator but reaches no renderer: the card
    // model is topic, lede, groups and followUp, and `ReadCard` draws those four.
    const model = toReadCardModel(parsed.ok ? (parsed.reply as never) : (null as never));
    expect(Object.keys(model).sort()).toEqual(["followUp", "groups", "lede", "topic"]);
  });

  it("the four covenant facts an explanation needs ARE on the envelope", () => {
    const dsc = readsFor().covenants!.find((c) => c.name === "Debt Service Coverage of Borrower")!;
    expect(dsc.threshold).toBe("≥ 1.25×");
    expect(dsc.measured).toBe("1.38×");
    expect(dsc.frequency).toBe("Quarterly");
    expect(dsc.nextTest).toBe("Sep 30, 2026");
    // So the gap is not the data. It is that nothing tells the model what an
    // explanation is, and the card has nowhere to put one.
  });

  it("REPRO: 'what a breach would trigger' has no doctrine in the facility room", () => {
    // The downgrade triggers live in `risk-rating`, which is gated to the
    // relationship room, so a facility-room covenant question carries none.
    const facility = composeDoctrine("what happens if this covenant is breached", { room: "facility" });
    expect(facility.included).not.toContain("risk-rating");
    const relationship = composeDoctrine("what happens if this covenant is breached", { room: "relationship" });
    expect(relationship.included).not.toContain("risk-rating");
    // It takes a rating word to reach it at all.
    expect(composeDoctrine("should we downgrade", { room: "relationship" }).included).toContain("risk-rating");
  });

  it.todo("a covenant explanation states what it measures, the current value against its threshold, why it matters and what a breach triggers");
  it.todo("a facility explanation states what it is for, its commitment, its drawn balance, its maturity and what secures it");
});

/* ============ RULES 2, 5 AND 6 — the relationship room's six review flows */

describe("rules 2, 5 and 6: the relationship room's steps", () => {
  const relCtx = () =>
    relContextFor({
      data,
      bundle: bundle(),
      accountId: HARTWELL,
      accountName: bundle().snapshot!.name!,
      productPackageId: PACKAGE,
    });

  /** The valuation route, answered as far as the asset picker. */
  const pickedAssets = () => {
    const ctx = relCtx();
    const picker = nextStep("valuation", ctx, {})!;
    expect(picker.key).toBe("records");
    return { ctx, ids: picker.options!.slice(0, 2).map((o) => o.value) };
  };

  it("REPRO (rule 2): the valuation asks for the figure cold, one turn after printing it", () => {
    const { ctx, ids } = pickedAssets();
    const picker = nextStep("valuation", ctx, {})!;
    // The chip the banker just read carries the asset's value and its lendable
    // figure (reviewFlows.ts:702-709).
    const chip = picker.options!.find((o) => o.value === ids[0])!;
    expect(chip.detail).toMatch(/\$/);

    const ask = nextStep("valuation", ctx, { records: ids })!;
    expect(ask.key).toBe(`recordValues.${ids[0]}`);
    // And the ask that follows carries no figure, no option and no escape.
    expect(ask.ask).toMatch(/^What value are we filing for /);
    expect(ask.options).toBeUndefined();
    expect(ask.optional).toBeUndefined();
    expect(ask.placeholder).toBe("The figure, in dollars.");
  });

  it("REPRO (rule 5): 'keep the figure on file' is not an answer to a number step", () => {
    const { ctx, ids } = pickedAssets();
    const ask = nextStep("valuation", ctx, { records: ids })!;
    // `stepAccepts` (RelationshipRoom.tsx:2567-2578) reads a number step as
    // `Number.isFinite(Number(line.replace(/[$,\s]/g, "")))`. Every phrasing the
    // golden rule calls an answer fails it, and the only accepted no-change
    // tokens are "Not assessed" and "skip" (RelationshipRoom.tsx:1090).
    const accepts = (line: string) => Number.isFinite(Number(line.replace(/[$,\s]/g, "")));
    for (const said of ["keep", "hold", "keep the figure on file", "no change", "leave it as it stands", "unchanged"]) {
      expect(accepts(said), said).toBe(false);
    }
    // And this step is not optional, so "Not assessed" is refused too
    // (RelationshipRoom.tsx:1091-1095) and the room re-asks.
    expect(ask.optional).toBeUndefined();
  });

  it("REPRO (rule 6): the valuation's own step counter runs away on the figure step", () => {
    // `plannedStepCount` (RelationshipRoom.tsx:449-462) walks the machine on a
    // copy, writing the SKIPPED sentinel into each step it passes. SKIPPED is a
    // STRING (relStep.ts:56); `recordValues` gates on
    // `typeof values[id] === "number"` (reviewFlows.ts:718). So the walk never
    // gets past the first asset and spends its whole 64-step guard there.
    const { ctx, ids } = pickedAssets();
    const probe: Record<string, unknown> = { records: ids };
    const keys: string[] = [];
    for (let guard = 0; guard < 64; guard++) {
      const step = nextStep("valuation", ctx, probe)!;
      if (!step) break;
      keys.push(step.key);
      // `assign`, in the same shape the room uses for a dotted per-record key.
      const dot = step.key.indexOf(".");
      if (dot === -1) probe[step.key] = step.kind === "multi" ? [] : SKIPPED;
      else {
        const head = step.key.slice(0, dot);
        const tail = step.key.slice(dot + 1);
        const map = (probe[head] as Record<string, unknown>) ?? {};
        map[tail] = SKIPPED;
        probe[head] = map;
      }
    }
    // Every one of the 64 probe steps is the SAME question.
    expect(keys).toHaveLength(64);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe(`recordValues.${ids[0]}`);
    // Which is what the kicker counts against: "Step 1 of 66" on a seven-step
    // review (RelationshipRoom.tsx:920).
  });

  it("REPRO (rule 6): the rating route asks four blank figures in a row", () => {
    const ctx = relCtx();
    const answers: Record<string, unknown> = {};
    const asks: Array<{ key: string; ask: string; options?: unknown }> = [];
    for (let i = 0; i < 4; i++) {
      const step = nextStep("rating", ctx, answers)!;
      asks.push({ key: step.key, ask: step.ask, options: step.options });
      answers[step.key] = SKIPPED;
    }
    expect(asks.map((a) => a.key)).toEqual([
      "cashFlowCoverage",
      "revenueGrowth",
      "managementExperience",
      "creditScore",
    ]);
    // Four turns, no figure on file quoted on any of them, no options on any.
    for (const a of asks) {
      expect(a.options).toBeUndefined();
      expect(a.ask).not.toMatch(/\d/);
    }
  });

  it("REPRO (rule 4): the covenant route block names no other review to run", () => {
    // Where Salesforce holds no open test period, the whole route is refused
    // before its first question, as one bare agent line with no options
    // (RelationshipRoom.tsx:893-895).
    const said = NO_COMPLIANCE_ROW(6);
    expect(said).toContain("there is nothing for a covenant review to close");
    // It offers to read the tests out, with nothing to click, and it names none
    // of the five reviews that COULD run on this relationship instead.
    expect(said).toContain("I can read them out");
    expect(said).not.toMatch(/annual|valuation|rating|service|intake|Facility Actions/i);
  });

  it("REPRO (rule 6): the covenant picker commits the banker to up to three turns per covenant", () => {
    const ctx = relCtx();
    const picker = nextStep("covenant", ctx, {})!;
    expect(picker.key).toBe("covenants");
    expect(picker.kind).toBe("multi");
    expect(picker.ask).toBe("Which covenants are we assessing?");
    const all = picker.options!.map((o) => o.value);
    expect(all.length).toBe(6);
    // Picking every covenant is one chip gesture. What follows is a status ask
    // per covenant, then a figure ask per covenant, then a reason ask on each
    // one marked Exception. Nothing on the picker says so.
    const after = nextStep("covenant", ctx, { covenants: all })!;
    expect(after.key).toBe(`covenantStatuses.${all[0]}`);
    expect(picker.ask).not.toMatch(/each|per covenant|question/i);
    // And the picker itself carries no escape: it is not optional, so there is
    // no "assess none of them" answer.
    expect(picker.optional).toBeUndefined();
  });

  it("REPRO (rule 4): the create gaps refuse the two things the intake route now files", () => {
    // The refusal.
    expect(CREATE_GAPS.covenant.line).toContain("No deployed tool authors a standalone covenant on the Account");
    expect(CREATE_GAPS.collateral.line).toContain("No deployed tool authors an owned but unpledged collateral record");
    // And the route that does exactly that, one screen back.
    const intake = nextStep("intake", relCtx(), {})!;
    expect(intake.ask).toBe("Are we putting a covenant on this relationship, or an asset?");
    // Neither refusal names it.
    expect(CREATE_GAPS.covenant.line).not.toMatch(/intake|Add a covenant or an asset/i);
    expect(CREATE_GAPS.collateral.line).not.toMatch(/intake|Add a covenant or an asset/i);
  });

  it("REPRO (rule 7, factual): the handoff says five reviews and the room takes six", () => {
    expect(FACILITY_HANDOFF).toContain("This room takes the five reviews.");
    expect(REL_ROUTE_WORDS.size).toBe(6);
  });

  it.todo("every non-optional step reads a keep / hold / no-change answer as an answer");
  it.todo("the valuation figure step leads with the value on file and offers it as a chip, as the covenant figure step does");
  it.todo("plannedStepCount cannot be spun by a predicate that refuses the SKIPPED sentinel");
  it.todo("the four rating figures are asked as one grouped confirmation against the figures on file");
  it.todo("a route block names the reviews that CAN run on this relationship");
  it.todo("the create gaps point at the intake route that files exactly those two things");
});

/* ============================================== RULE 4 — the hand to the end */

describe("rule 4: a degrade must still name the next step", () => {
  it("the timeout and the unreadable reply both hand the banker a move", () => {
    expect(timeoutClarify(90).text).toMatch(/ask again, or say the change you want/i);
    expect(UNREADABLE_CLARIFY.text).toMatch(/try asking directly, or say the change you want/i);
  });

  it("REPRO: the not-connected clarify ends without one", () => {
    // It states a condition and a future capability. There is nothing here the
    // banker can do next, in a room they are standing in now.
    expect(NOT_CONNECTED_CLARIFY.text).toBe(
      "This view is not connected to the bank's systems, so I cannot take that question to the desk. I can still change this package once a connector is added.",
    );
    expect(NOT_CONNECTED_CLARIFY.text).not.toMatch(/ask again|try|reload|open|pick|say the/i);
    expect(NOT_CONNECTED_CLARIFY.options).toBeUndefined();
  });

  it("REPRO: the relationship room's fallback next step offers the one thing the room refuses", () => {
    const model = toReadCardModel({
      type: "read-card",
      topic: "covenants",
      title: "Six covenants on this relationship",
      rows: [{ icon: "covenant", label: "Debt Service Coverage of Borrower", value: "1.38×" }],
    });
    // `toReadCardModel` is shared by BOTH rooms (Workroom.tsx:2652 and
    // RelationshipRoom.tsx:1362), and its fallback is the facility room's line.
    expect(model.followUp).toBe("What should change on this package?");
    // Which is precisely what the relationship room hands off.
    expect(FACILITY_HANDOFF).toContain("That is facility work.");
  });

  it.todo("the relationship room's fallback next step names one of its six reviews, never a package change");
  it.todo("the not-connected clarify names what the banker can still do in this view");
});

/* ============================================================ RULE 7 — voice */

describe("rule 7: the voice rule binds the model and not the room", () => {
  const always = DOCTRINE_BLOCKS.filter((b) => ALWAYS_BLOCK_IDS.includes(b.id))
    .flatMap((b) => b.lines)
    .join("\n");

  it("the doctrine bans the em dash", () => {
    expect(always).toContain("No em dashes.");
  });

  it("REPRO: the room's own deterministic explanation uses them", () => {
    const said = whyChecked({ lendable: 12_000_000, covers: true });
    expect(said).toContain("—");
  });

  it("REPRO: the golden rule bans exclamation points and emoji, and the doctrine names neither", () => {
    expect(always).not.toMatch(/exclamation/i);
    expect(always).not.toMatch(/emoji/i);
  });

  it.todo("the doctrine carries the golden rule's voice line in full: no marketing, no exclamation points, no emoji");
  it.todo("the room's deterministic sentences obey the same no-em-dash rule the doctrine imposes on the model");
});
