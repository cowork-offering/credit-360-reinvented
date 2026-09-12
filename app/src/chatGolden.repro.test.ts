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
import { buildEnvelope, toReadCardModel } from "./components/workroom/brainRoute";
import type { PackageMember } from "./workroom/types";
import { FACILITY_HANDOFF } from "./components/relationship/relRoute";
import { CREATE_GAPS, nextStep, relContextFor } from "./components/relationship/reviewFlows";
import { REL_ROUTE_WORDS } from "./components/relationship/relBrain";
import { SKIPPED } from "./components/relationship/relStep";
import { NO_COMPLIANCE_ROW } from "./components/relationship/relBook";
import { NO_PACKAGE_REFUSAL, whyChecked, whyRefused } from "./workroom/explain";
import { DESK_RULES, deskContext, deskThread } from "./channel/deskAsk";
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

/** THE WHOLE FACILITY ENVELOPE, as the room hands it over on this relationship:
 *  the deepest book, every member of the anchored package, a staged entry and a
 *  live exchange. This is what is measured against the cap. */
const hartwellEnvelope = () => {
  const b = bundle();
  const members: PackageMember[] = (b.exposure?.facilities ?? [])
    .filter((f) => f.productPackageId === PACKAGE)
    .map((f) => ({
      id: f.loanId!,
      key: f.productType ?? "Facility",
      short: f.productType ?? "Facility",
      tag: f.stage ?? "",
      product: f.productType ?? "",
      amount: `$${((f.committed ?? 0) / 1_000_000).toFixed(1)}M`,
      detail: f.name ?? "",
    }));
  return buildEnvelope({
    line: "what is this covenant doing",
    mode: "modify",
    accountName: b.snapshot!.name!,
    packageName: "Hartwell Industrial C&I Credit Package",
    productPackageId: PACKAGE,
    members,
    eligible: () => true,
    focused: members[0],
    entries: [],
    reads: { bundle: b, accountName: b.snapshot!.name!, productPackageId: PACKAGE, generatedAt: "2026-09-03T08:00:00.000Z" },
    thread: [
      { who: "banker", text: "what is this covenant doing" },
      { who: "agent", text: "Debt Service Coverage of Borrower tests 1.38x against a 1.25x floor, next measured Sep 30, 2026." },
    ],
  });
};

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

  it("FIXED: the STRUCTURE travels, on top of the deal's own involvement rows", () => {
    // `buildReadBlocks` read `graph.legalEntities` and never `graph.connections`,
    // so a party reached the desk only where the org wrote it an INVOLVEMENT on a
    // loan: a role on a facility, with no structural relationship attached. That
    // block is unchanged and still says who is on the DEAL...
    const rows = readsFor().involvements!;
    expect(rows.find((r) => r.name === "Hartwell Logistics LLC")).toMatchObject({
      role: "Related Entity",
      scope: "Construction",
    });
    expect(rows.find((r) => r.name === "Hartwell Industrial Holdings LLC")!.role).toBe("Guarantor");
    // ...and `group` now says who the borrower IS, downstream, in the org's own
    // roles and with the ownership the involvement block suppresses.
    const group = readsFor().group!;
    expect(group).toEqual([
      { name: "Hartwell Industrial Holdings LLC", relation: "parent", role: undefined, ownership: "100%", grade: "4" },
      { name: "Hartwell Logistics LLC", relation: "affiliate", role: "Affiliated Company", ownership: undefined, grade: undefined },
      { name: "James Hartwell", relation: "owner", role: undefined, ownership: "60%", grade: undefined },
      { name: "Elena Hartwell", relation: "owner", role: "Co-Owner", ownership: "40%", grade: undefined },
    ]);
    const text = readsText();
    expect(text).toMatch(/affiliate/i);
    expect(text).toMatch(/\bparent\b/i);
    // What is STILL not carried is refused by name now, which is the other half
    // of the contract: an absent block must never be reported as an empty fact.
    const notCarried = readsFor().notCarried.join(" ");
    expect(notCarried).toMatch(/cross-default/i);
    expect(notCarried).toMatch(/OWN exposure and facilities/);
    // The household and cross-collateral remain outside this cockpit's reads.
    expect(text).not.toMatch(/household/i);
  });

  it("the guarantors travel with their own grade, and their own book is refused by name", () => {
    const guarantors = readsFor().involvements!.filter((i) => /guarantor/i.test(i.role));
    expect(guarantors.map((g) => g.name)).toContain("Hartwell Industrial Holdings LLC");
    // The org's own read carries a grade on that guarantor, and it now travels
    // on the group row rather than being dropped.
    const signals = bundle().signals?.guarantorSignals ?? [];
    expect(signals.some((s) => s.guarantorName === "Hartwell Industrial Holdings LLC" && s.highestRiskGrade === "4")).toBe(
      true,
    );
    expect(readsFor().group!.find((g) => g.name === "Hartwell Industrial Holdings LLC")!.grade).toBe("4");
    // Their own EXPOSURE is still nowhere, because no read on this cockpit opens
    // another relationship's book. Said by name instead of reported as silence.
    for (const g of guarantors) expect(JSON.stringify(g)).not.toMatch(/exposure|committed|outstanding/i);
    expect(readsFor().notCarried.join(" ")).toMatch(/a guarantor's, parent's or affiliate's OWN exposure/);
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
      scope: "on this package",
    });
  });

  it("the ladder routes a downstream question to the connected party's book; the version chain needs no call-out", () => {
    /* CHANGED 2026-09-12 (rule 1 completion). This was the repro of a defect:
       the rung-3 coverage mirrored the two exposed read doors and nothing else,
       so no downstream question could reach a call-out. Now:
       - a party's OWN book routes to `connectedPartyBook` (ladder.ts), bounded
         to the anchored graph;
       - the version in flight travels IN the envelope (`reads.inFlight`), so
         that line is answered from context and correctly needs no tool;
       - cross-default links are still carried by no read and are refused by
         name in `notCarried` — an honest gap, not a routing miss. */
    expect(toolsCovering("what is Hartwell Industrial Holdings' own exposure")).toContain("connectedPartyBook");
    expect(toolsCovering("what does the affiliate carry")).toContain("connectedPartyBook");
    expect(toolsCovering("is there a modification version in flight on this package")).toEqual([]);
    expect(toolsCovering("which facilities cross-default off this one")).toEqual([]);
  });

  /* THE BUDGET, MEASURED RATHER THAN ASSUMED. The additions above were costed
     against the deepest relationship in the book: 6,119 bytes of read blocks
     and a 7,436-byte facility envelope before, 6,738 and 8,055 after, against
     the 10,000-byte cap. Roughly 1.9 KB of headroom is left for the rest. */
  it("the envelope carries the additions and still fits inside its own cap", () => {
    expect(ENVELOPE_CAP_BYTES).toBe(10_000);
    expect(readsText().length).toBeLessThan(7_000);
    const envelope = hartwellEnvelope();
    expect(JSON.stringify(envelope).length).toBeLessThan(ENVELOPE_CAP_BYTES);
    // Nothing was given up to get there: a capped envelope names what it dropped.
    expect(envelope.omitted).toBeUndefined();
    expect(envelope.reads?.group?.length).toBe(4);
  });

  it("the envelope carries the obligor group: parent, affiliates, owners, with their own grade where the read holds one", () => {
    const group = readsFor().group!;
    expect(group.map((g) => `${g.relation}:${g.name}`)).toEqual([
      "parent:Hartwell Industrial Holdings LLC",
      "affiliate:Hartwell Logistics LLC",
      "owner:James Hartwell",
      "owner:Elena Hartwell",
    ]);
    expect(group.find((g) => g.relation === "parent")).toMatchObject({ ownership: "100%", grade: "4" });
    expect(group.filter((g) => g.relation === "owner").map((g) => g.ownership)).toEqual(["60%", "40%"]);
  });

  it("the envelope names the downstream relationship in notCarried wherever the cockpit cannot carry it", () => {
    const said = readsFor().notCarried.join(" ");
    // The two honest refusals: another party's own book, and the links between
    // facilities that no read on this cockpit carries.
    expect(said).toMatch(/a guarantor's, parent's or affiliate's OWN exposure and facilities/);
    expect(said).toMatch(/cross-default links between these facilities/);
    expect(said).toMatch(/any facility elsewhere that depends on one of them/);
    // And where the read stages no graph at all, the group itself is refused by
    // name rather than being silently absent.
    const b = bundle();
    const noGraph = buildReadBlocks({
      bundle: { ...b, graph: { legalEntities: b.graph?.legalEntities } },
      accountName: b.snapshot!.name!,
      productPackageId: PACKAGE,
    })!;
    expect(noGraph.group).toBeUndefined();
    expect(noGraph.notCarried.join(" ")).toMatch(/the obligor group - parent, affiliates, subsidiaries and owners/);
  });

  it("the envelope carries the in-flight package version the room is already locked by (book/packages.ts computes it)", () => {
    // Hartwell's own live fork, at the cockpit's contract: two Booked members on
    // the source package, the same two copied onto an unbooked version.
    const SOURCE = "a5Fbb000000J6BNEA0";
    const VERSION = "a5Fbb000000JFzREAW";
    const member = (over: Record<string, unknown>) => ({ status: "Open", productPackageId: SOURCE, stage: "Booked", ...over });
    const forked = {
      snapshot: { accountId: HARTWELL, name: "Hartwell Precision Manufacturing LLC" },
      exposure: {
        facilities: [
          member({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 }),
          member({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000 }),
          member({ loanId: "a4Zbb000002KFD3EAO", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, productPackageId: VERSION, stage: "Qualification" }),
          member({ loanId: "a4Zbb000002KFD4EAO", name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000, productPackageId: VERSION, stage: "Qualification" }),
        ],
      },
    } as unknown as ReturnType<typeof bundle>;
    const locked = buildReadBlocks({ bundle: forked, accountName: "Hartwell", productPackageId: SOURCE })!;
    // WHY the room refuses, in the words the picker uses, rather than a blind no.
    expect(locked.inFlight).toMatchObject({ hasInFlightModification: true, versionId: VERSION });
    expect(locked.inFlight!.reason).toContain("a version of this package is unbooked with the org");
    const inside = buildReadBlocks({ bundle: forked, accountName: "Hartwell", productPackageId: VERSION })!;
    expect(inside.inFlight).toMatchObject({ version: true, editable: true });
  });

  it.todo("the envelope carries the plan's own pro-forma package total, so 'what does this do to exposure' is read and not derived");
  it.todo("the envelope carries the relationship's own flags (deriveReasonsForBundle), so 'why is this flagged' is answered in the glass's words");

  it("every new read block is added to ENVELOPE_BLOCK_DROP_ORDER, so nothing is dropped silently", () => {
    expect([...ENVELOPE_BLOCK_DROP_ORDER]).toEqual([
      "pricing",
      "collateral",
      "involvements",
      "group",
      "inFlight",
      "covenants",
      "exposure",
    ]);
    // Every block the builder can emit is in that list, or the cap could never
    // give it up and it would be the one thing that breaks the budget.
    const emitted = Object.keys(readsFor()).filter((k) => k !== "notCarried");
    for (const key of emitted) expect(ENVELOPE_BLOCK_DROP_ORDER).toContain(key);
  });
});

/* ============================ RULE 1, SECOND SURFACE — the cockpit chat

   The cockpit chat does not travel a BrainEnvelope at all. It composes its own
   prose context in `channel/deskAsk.ts` and sends rules + context + ONE
   question (deskAsk.ts:118). The two surfaces are not two views of one book;
   they are two different, differently incomplete books.                      */

describe("rule 1: the cockpit chat carries a different, thinner book", () => {
  const deskText = () => deskContext(bundle(), bundle().snapshot!.name!);

  /* FIXED (finding B3). `deskContext` read `actualValue` and never
     `thresholdValue`, so the surface a founder demo opens on stated a figure
     with nothing to measure it against and "what is this covenant doing" was
     unanswerable on it. */
  it("the cockpit chat carries the covenant thresholds, so it can say what a covenant is doing", () => {
    const text = deskText();
    // What it measures, what it is measured against, and where it stands: the
    // operator and the unit are the org's own, through the same formatter the
    // workroom envelope and the covenant card use.
    expect(text).toContain("Debt Service Coverage of Borrower, Pending, tests ≥ 1.25×, last 1.38×, Quarterly, next test Sep 30, 2026.");
    expect(text).toContain("Maximum Debt to Worth");
    expect(text).toContain("tests ≤ 3.00×");
    // The three surfaces write one test one way.
    expect(readsFor().covenants!.find((c) => c.name === "Debt Service Coverage of Borrower")!.threshold).toBe("≥ 1.25×");
    // A test the org carries no threshold for says so rather than reading as a
    // covenant with nothing to clear.
    expect(text).toContain("no threshold carried on this read");
  });

  it("REPRO: no collateral figures, no parties, no coverage and no honesty list travel", () => {
    const text = deskText();
    // "Collateral valuation recorded" rides in as an ACTIVITY TITLE; not one
    // collateral figure does.
    expect(text).not.toMatch(/pledge|lendable|advance rate|first mortgage|blanket lien/i);
    expect(text).not.toMatch(/guarantor|guaranty|borrower type|\bowner\b/i);
    expect(text).not.toMatch(/coverage ratio|collateral coverage|shortfall/i);
    expect(text).not.toContain("1.09");
    // Still no standing `notCarried` list naming the collateral, the parties
    // and the coverage. What HAS gone is the silent stop at 7,000 characters:
    // a context that is cut now names the parts of the book that did not
    // travel (`deskAsk.test.ts`, "the context names what it had to cut"), and
    // Hartwell, the deepest book, does not reach the cut at all.
    expect(text).not.toMatch(/not carried|does not carry/i);
    expect(text.length).toBeLessThan(7_000);
  });

  /* FIXED. Both surfaces still total a different book, which is correct: the
     desk answers about the relationship and the room works one package. What
     changed is that each says which, in the same breath as the figure. */
  it("the two surfaces still total different books, and each states its scope", () => {
    // The desk sums every ACTIVE facility on the relationship, across both
    // packages, and says so with the figure.
    expect(deskText()).toContain("Facilities across the relationship, every package included: $57M committed");
    // The workroom envelope sums the facilities of the ANCHORED package.
    expect(readsFor().exposure).toMatchObject({ committed: "$49M", facilities: 7, scope: "on this package" });
    // And the model composing the chat answer is told the scope it is holding.
    expect(DESK_RULES).toMatch(/Every total in this context is the WHOLE RELATIONSHIP/);
    expect(DESK_RULES).toMatch(/a workroom quotes the anchored package/);
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

  /* FIXED, 2026-09-12 (finding I8). `askDesk` took one question and no thread,
     so every follow-up was answered as if it were the first. The CONTEXT is
     still the book and nothing else, which is the contract; the conversation
     now travels beside it, through the rooms' own `threadDigest`. */
  it("the book is the book, and the conversation travels beside it", () => {
    // The context itself is still purely the relationship: it is what figures
    // are read from, and a conversation inside it would be a second source.
    expect(deskText()).not.toMatch(/earlier|previously|you said|conversation so far/i);
    // The thread is its own block, oldest first, and it says what rule 5 asks.
    const said = deskThread([
      { who: "banker", text: "what is the exposure" },
      { who: "agent", text: "$57M committed across the relationship." },
    ]);
    expect(said).toMatch(/The conversation so far, oldest first/);
    expect(said).toMatch(/never answer the same input twice/);
    expect(said).toContain("Banker: what is the exposure");
  });

  /* FIXED, 2026-09-12 (finding B5). The room was locked by a version the chat
     knew nothing about. Proved on Hartwell's own fork in
     `channel/deskAsk.test.ts`; pinned here as the fact, not the prose. */
  it("the cockpit chat carries the version chain that locks a room", () => {
    const forked = {
      snapshot: { accountId: HARTWELL, name: "Hartwell Precision Manufacturing LLC" },
      exposure: {
        facilities: [
          { loanId: "a4Zbb000002ICnyEAG", status: "Open", stage: "Booked", productPackageId: "a5Fbb000000J6BNEA0", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 },
          { loanId: "a4Zbb000002ICnxEAG", status: "Open", stage: "Booked", productPackageId: "a5Fbb000000J6BNEA0", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000 },
          { loanId: "a4Zbb000002KFD3EAO", status: "Open", stage: "Qualification", productPackageId: "a5Fbb000000JFzREAW", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000 },
          { loanId: "a4Zbb000002KFD4EAO", status: "Open", stage: "Qualification", productPackageId: "a5Fbb000000JFzREAW", name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000 },
        ],
      },
    } as unknown as ReturnType<typeof bundle>;
    const said = deskContext(forked, "Hartwell Precision Manufacturing LLC");
    expect(said).toContain("Modification in Progress");
    expect(said).toContain("a version of it is unbooked with the org");
    expect(said).toContain("IS the unbooked modification version of another package");
  });

  it.todo("the cockpit chat and the workrooms compose their context through ONE builder over the same bundle");
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

  /* FIXED, 2026-09-12 (audit finding 2). This was the REPRO for "the valuation
     asks for the figure cold, one turn after printing it". The ask is now built
     from the same `BookAsset` the chooser chip was, and the figure on file is
     OFFERED rather than written. Kept live as the regression cover. */
  it("the valuation figure step leads with the value on file and offers it as a chip", () => {
    const { ctx, ids } = pickedAssets();
    const picker = nextStep("valuation", ctx, {})!;
    // The chip the banker just read carries the asset's value and its lendable
    // figure (reviewFlows.ts:702-709).
    const chip = picker.options!.find((o) => o.value === ids[0])!;
    expect(chip.detail).toMatch(/\$/);

    const ask = nextStep("valuation", ctx, { records: ids })!;
    expect(ask.key).toBe(`recordValues.${ids[0]}`);
    // And the ask that follows carries that same figure, and the way to take it.
    expect(ask.ask).toMatch(/carries \$/);
    expect(ask.ask).toContain("File that figure, or give me the new one.");
    expect(ask.options!.length).toBe(1);
    expect(Number(ask.options![0].value)).toBeGreaterThan(0);
    // It is still the banker's answer: the proposal is an option, never a default.
    expect(ask.optional).toBeUndefined();
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

  /* FIXED, 2026-09-12 (audit finding 1). `recordValues` gated on
     `typeof values[id] === "number"` while the probe writes the SKIPPED
     sentinel, so the walk never cleared the first asset and burned its whole
     64-step guard there: "Step 2 of 65" on a seven-step review. The step now
     reads `answered(values, id)`, the way `covenantStep` already read its own
     observed figure. */
  it("the valuation's step counter walks the review it is going to ask", () => {
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
    // The walk settles, and every question on it is asked once.
    expect(keys.length).toBeLessThan(64);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(`recordValues.${ids[0]}`);
    expect(keys).toContain("valuationDate");
    expect(keys[keys.length - 1]).toBe("description");
  });

  /* FIXED, 2026-09-12. Four blank boxes in a row became four questions that say
     what the read does and does not carry: the scored factor leads with the
     closest figure the book holds, NAMED as the covenant's own and offered
     rather than written, and the first unscored factor carries
     SCORED_VS_STORED so the banker knows the next three are stored and not
     weighed. No read on this cockpit carries these four as rating inputs, so
     nothing is defaulted. */
  it("the rating route says what the read carries on each of its four figures", () => {
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
    // The scored factor leads with the covenant that measures the same thing,
    // named as the covenant's figure and offered as the one option.
    expect(asks[0].ask).toContain("The closest figure the read carries is the Debt Service Coverage of Borrower test at");
    expect(asks[0].options).toHaveLength(1);
    // The first UNSCORED factor is where the template's own limit is stated.
    expect(asks[1].ask).toContain("This org's rating template scores cash-flow coverage and nothing else");
    // And the three the read carries nothing for say so, with no figure invented.
    for (const a of asks.slice(1)) {
      expect(a.options).toBeUndefined();
      expect(a.ask).toContain("No read on this cockpit carries it");
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

  /* FIXED, 2026-09-12. The handoff counted five reviews after the intake made
     six, and the count and the room now agree. */
  it("the handoff counts the reviews this room actually takes", () => {
    expect(FACILITY_HANDOFF).toContain("This room takes the six reviews.");
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

  it("the room's deterministic sentences obey the same no-em-dash rule the doctrine imposes on the model", () => {
    // The explanation layer, the advisories and the create parser wrote them
    // freely while `narrate.ts` stripped them out of every model reply.
    expect(whyChecked({ lendable: 12_000_000, covers: true })).not.toContain("—");
    expect(whyChecked({ lendable: 12_000_000, covers: true })).toContain("The pledged pool does not grow with the commitment.");
    for (const id of ["covenant.complianceStatus", "collateral.valuation", "loan.stage"]) {
      expect(whyRefused(id)).not.toContain("—");
    }
    expect(NO_PACKAGE_REFUSAL).not.toContain("—");
    expect(NO_PACKAGE_REFUSAL).toContain("until the deal is on a package. Open the relationship");
  });

  it("REPRO: the golden rule bans exclamation points and emoji, and the doctrine names neither", () => {
    expect(always).not.toMatch(/exclamation/i);
    expect(always).not.toMatch(/emoji/i);
  });

  it.todo("the doctrine carries the golden rule's voice line in full: no marketing, no exclamation points, no emoji");
});
