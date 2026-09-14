import { describe, expect, it } from "vitest";
import {
  advance,
  amendedPlanLine,
  amendmentOf,
  associateGap,
  awarenessFor,
  buildBook,
  CATALOG_TESTS,
  changedLine,
  compose,
  createSubject,
  handoffEntry,
  mirrorChips,
  namedTest,
  nextAsk,
  noVersionRefusal,
  openCreate,
  planAmendmentFor,
  readAssetType,
  readInto,
  readScope,
  restateEntry,
  routeGap,
  rolesOnFacility,
  facilitiesFor,
  samePartyName,
  settleFromBook,
  thresholdText,
  verify,
  INVOLVEMENT_ROLES,
  type Draft,
  type ElicitContext,
  type ElicitMember,
} from "./elicit";
import { createModifyEngine } from "../../workroom/modifyEngine";
import { workroomContextFor } from "../../workroom/openWorkroom";
import type { BorrowerBundle, C360Data } from "../../data/contract";
import type { WorkroomDelta } from "../../workroom/types";
import type { OrgCatalog } from "../../channel/catalog";
import live from "../../../../artifact/live-data.json";

/* =============================================================================
   THE CREATE GRAMMAR, IN ISOLATION.

   The room's own behaviour is proved in createGrammar.render.test.tsx. What is
   proved HERE is the machine: what a scope word resolves to, what the book
   answers, what a proposal is grounded in, what a composed sentence says, and
   what verification refuses.

   THE COMPOSED SENTENCES ARE DRIVEN THROUGH THE REAL ENGINE. A composition that
   only passes against a stub is a composition nobody has proved: the whole
   point of composing rather than wiring is that the deterministic parser reads
   it, so the parser reads it here too.
   ============================================================================= */

const data = live as unknown as C360Data;
const accountId = "001bb00001I7FPNAA3";
const bundle = data.borrowers![accountId] as BorrowerBundle;

const LOC15 = "a4Zbb0000027MaYEAU";
const CONSTRUCTION = "a4Zbb0000027Mp3EAE";
const EQ8 = "a4Zbb0000027MnREAU";
const PURCHASE = "a4Zbb0000027MqfEAE";
const EQ35 = "a4Zbb0000027MsHEAU";
const LOC25 = "a4Zbb0000027MttEAE";

const MEMBERS: ElicitMember[] = [
  { id: LOC15, key: "Line of Credit", label: "$15.0MM Line of Credit", orgName: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00", shortName: "Line of Credit - $15,000,000.00", committed: 15_000_000 },
  { id: CONSTRUCTION, key: "Construction", label: "Construction", orgName: "Hartwell Precision Manufacturing LLC - Construction - $12,000,000.00", shortName: "Construction - $12,000,000.00", committed: 12_000_000 },
  { id: EQ8, key: "Equipment", label: "$8.0MM Equipment", orgName: "Hartwell Precision Manufacturing LLC - Equipment - $8,000,000.00", shortName: "Equipment - $8,000,000.00", committed: 8_000_000 },
  { id: PURCHASE, key: "Purchase", label: "Purchase", orgName: "Hartwell Precision Manufacturing LLC - Purchase - $5,000,000.00", shortName: "Purchase - $5,000,000.00", committed: 5_000_000 },
  { id: EQ35, key: "Equipment", label: "$3.5MM Equipment", orgName: "Hartwell Precision Manufacturing LLC - Equipment - $3,500,000.00", shortName: "Equipment - $3,500,000.00", committed: 3_500_000 },
  { id: LOC25, key: "Line of Credit", label: "$2.5MM Line of Credit", orgName: "Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00", shortName: "Line of Credit - $2,500,000.00", committed: 2_500_000 },
];

const book = buildBook(bundle, MEMBERS.map((m) => m.id));

function ctxWith(over: Partial<ElicitContext> = {}): ElicitContext {
  return {
    members: MEMBERS,
    focused: null,
    book,
    plan: [],
    relationship: "Hartwell Precision Manufacturing LLC",
    ...over,
  };
}

/** The real deterministic parser, on the real read. Every composed sentence in
 *  this file goes through it. */
function realEngine() {
  const context = workroomContextFor({ mode: "modify", data, bundle, accountId, accountName: bundle.snapshot!.name!, productPackageId: "a5Fbb000000IHFJEA4" });
  return { engine: createModifyEngine({ context, data, bundle }), context };
}

/* ------------------------------------------------------------------ the book */

describe("the book is read off the bundle the room already holds", () => {
  it("carries the relationship's own covenants with their schedules", () => {
    const dsc = book.covenants.find((c) => c.type === "Debt Service Coverage of Borrower")!;
    expect(dsc.threshold).toBe(1.25);
    expect(dsc.frequency).toBe("Quarterly");
    // The org grew a second package (2026-09-03) and attached COV-000646 to the
    // new CRE loan, so this is no longer an empty attachedLoans list read as
    // the covenant hanging off the relationship: it hangs off a loan now, one
    // outside this room's C&I scope, which is why accountLevel reads false.
    expect(dsc.accountLevel).toBe(false);
  });

  it("carries the assets the deal pledges, deduped, with the facilities they reach", () => {
    const ar = book.assets.find((a) => a.name === "COL-000762" || /accounts receivable/i.test(a.label))!;
    expect(ar.loanIds).toContain(LOC15);
    expect(ar.loanIds).toContain(LOC25);
    expect(ar.lien).toBe("1st");
  });

  it("is empty with no bundle, and nothing downstream breaks on that", () => {
    const none = buildBook(null, [LOC15]);
    expect(none.covenants).toHaveLength(0);
    expect(none.assets).toHaveLength(0);
    expect(mirrorChips(none)).toHaveLength(0);
  });

  it("never prints a unit the org does not store", () => {
    // The org keeps every threshold on one numeric field with no unit beside
    // it, so a book-derived figure prints bare.
    expect(thresholdText(80)).toBe("80");
    expect(thresholdText(5_000_000)).toBe("5,000,000");
    // The banker's own words are a different matter.
    expect(thresholdText(1.25, "ratio")).toBe("1.25x");
    expect(thresholdText(5_000_000, "money")).toBe("$5,000,000");
  });
});

/* ----------------------------------------------------------------- the scope */

describe("a scope word fans out or it asks, and it is never narrowed in silence", () => {
  it("resolves an unambiguous all-word over a generic noun", () => {
    const read = readScope("all 6 facilities", MEMBERS);
    expect(read.word).toBe(true);
    expect(read.ambiguous).toBe(false);
    expect(read.ids).toHaveLength(6);
  });

  it("asks about \"all of the loans\" on a package that also carries lines", () => {
    // The founder's own line. "Loans" may mean all six or may mean the four
    // that are not lines, and the room does not pick.
    const read = readScope("add another covenant to all of the loans", MEMBERS);
    expect(read.word).toBe(true);
    expect(read.ambiguous).toBe(true);
    expect(read.ids).toHaveLength(0);
  });

  it("resolves a product group when the line counts it", () => {
    const read = readScope("both lines of credit", MEMBERS);
    expect(read.ids.sort()).toEqual([LOC15, LOC25].sort());
  });

  it("asks when a bare product word names more than one facility", () => {
    const read = readScope("on the line of credit", MEMBERS);
    expect(read.word).toBe(true);
    expect(read.ambiguous).toBe(true);
    expect(read.ids).toHaveLength(0);
  });

  it("resolves a dollar qualifier to exactly one facility", () => {
    const read = readScope("on the 15M line of credit", MEMBERS);
    expect(read.ids).toEqual([LOC15]);
    expect(read.said).toContain("$15.0MM Line of Credit");
  });

  it("asks when a stated count disagrees with the package", () => {
    const read = readScope("all four facilities", MEMBERS);
    expect(read.ambiguous).toBe(true);
    expect(read.ids).toHaveLength(0);
  });

  it("reads no scope word out of a line that carries none", () => {
    expect(readScope("tested quarterly", MEMBERS)).toMatchObject({ word: false, ids: [] });
  });

  /* D2. The focused member answers "which one?" ONLY for a line that asked
     nothing else. A line carrying a scope word never lands on it in silence. */
  it("D2: a scope word is never narrowed to the focused member", () => {
    const ctx = ctxWith({ focused: MEMBERS[0] });
    const draft = openCreate("add another covenant to all of the loans", ctx)!;
    expect(draft.scopeWord).toBe(true);
    expect(draft.scope).toHaveLength(0);
    const step = advance(draft, ctx);
    expect(step.ask?.slot).toBe("scope");
  });

  it("uses the focused member only where the line named no scope at all", () => {
    const ctx = ctxWith({ focused: MEMBERS[1] });
    const draft = openCreate("add a minimum liquidity covenant of $5,000,000", ctx)!;
    expect(draft.scopeWord).toBe(false);
    expect(draft.scope).toEqual([CONSTRUCTION]);
  });
});

/* ------------------------------------------------------------ what is asked */

describe("the room asks for what the human owns, and never for what the org computes", () => {
  it("opens the founder's line on the scope, then on the test", async () => {
    const ctx = ctxWith();
    const opened = openCreate("add another covenant to all of the loans", ctx)!;
    expect(advance(opened, ctx).ask?.slot).toBe("scope");

    const scoped = readInto(opened, "all 6 facilities", ctx);
    const next = advance(scoped, ctx);
    expect(next.ask?.slot).toBe("test");
    // OFFER BEFORE ASKING. The proposals are what this relationship already
    // tests, and the room says it will not set a threshold itself.
    expect(next.ask!.text).toContain("Debt Service Coverage of Borrower quarterly");
    expect(next.ask!.text).toContain("I will not set a threshold myself");
  });

  it("asks which test when the catalog carries the family twice", () => {
    const ctx = ctxWith();
    const draft = openCreate("add a DSCR covenant of 1.25x on the 15M line of credit", ctx)!;
    const step = advance(draft, ctx);
    expect(step.ask?.slot).toBe("test");
    expect(step.ask!.options.map((o) => o.label)).toEqual([
      "Debt Service Coverage of Borrower",
      "Debt Service Coverage with and without Distributions",
    ]);
  });

  it("never sets a threshold itself, and quotes the band as a band", () => {
    const ctx = ctxWith();
    const draft = readInto(openCreate("add a covenant to the Purchase", ctx)!, "a Maximum Debt to Worth covenant", ctx);
    const step = advance(draft, ctx);
    expect(step.ask?.slot).toBe("threshold");
    expect(step.ask!.text).toContain("threshold IS the covenant");
    expect(step.ask!.text).toContain("approved credit agreement");
  });

  it("takes the frequency from the book rather than asking a question it can answer", () => {
    const ctx = ctxWith();
    const draft = readInto(
      openCreate("add a covenant to the Purchase", ctx)!,
      "a Maximum Debt to Worth covenant of 3x",
      ctx,
    );
    const settled = settleFromBook(draft, ctx);
    expect(settled.slots.frequency).toBe("Quarterly");
    expect(settled.slots.frequencyFrom).toBe("book");
    expect(advance(draft, ctx).ask).toBeNull();
  });

  it("never asks for the advance rate or the lendable value on a pledge", () => {
    const ctx = ctxWith();
    let draft = openCreate("pledge the accounts receivable to the Purchase", ctx)!;
    const asks: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const step = advance(draft, ctx);
      if (!step.ask) break;
      asks.push(step.ask.slot);
      draft = { ...step.draft, slots: { ...step.draft.slots, lien: "1st" } };
    }
    expect(asks).not.toContain("advanceRate");
    for (const ask of asks) expect(ask).not.toMatch(/lendable/i);
    expect(compose(draft, ctx).lede).toContain("no advance rate for you to set here");
  });

  it("P3: asks a net-new asset for the rate the credit terms carry, and never refuses it", () => {
    const ctx = ctxWith();
    const draft = openCreate("pledge a new forklift fleet worth $2,000,000 to the Purchase", ctx)!;
    expect(draft.slots.isNew).toBe(true);
    expect(draft.slots.assetValue).toBe(2_000_000);
    expect(draft.slots.assetDescription).toBe("Forklift fleet");

    const ask = advance(draft, ctx).ask!;
    expect(ask.slot).toBe("advanceRate");
    expect(ask.text).toContain("The credit terms carry an advance rate for this asset: which?");
    expect(ask.text).toContain("approved credit terms are the authority");
    // The bank's own guideline, as a band, offered as chips.
    expect(ask.options.map((o) => o.label)).toEqual(["80 percent"]);
    expect(ask.options[0].say).toBe("at a 80% advance rate");
    // And never the pointless fallback.
    expect(ask.text).not.toContain("already carries");
    expect(ask.text).not.toMatch(/will not set/i);
  });
});

/* -------------------------------------------------------------- the awareness */

describe("the room reads the book and the plan before it proposes anything", () => {
  const complete = (over: Partial<Draft["slots"]> = {}, scope = [PURCHASE]): Draft => ({
    surface: "covenant",
    slots: { test: "Debt Service Coverage of Borrower", threshold: 1.25, unit: "ratio", frequency: "Quarterly", ...over },
    scope,
    scopeWord: true,
    unused: null,
  });

  /* ------------------------------------------------- P1, the three states

     THE DEDUPE IS PER LOAN JUNCTION. A covenant with an Account_Covenant
     association and no Loan_Covenant junction is NOT associated to the loan,
     whatever the package VIEW shows, so "it already reaches every facility,
     nothing needs putting up twice" was a false refusal. Three states, three
     different answers. */

  it("STATE 1: the same test on THIS loan is the duplicate, and is named as one", () => {
    // Accounts Receivable carries a loan junction to the $15M line on this book.
    const aware = awarenessFor(complete({ test: "Accounts Receivable", threshold: 80 }, [LOC15]), ctxWith());
    expect(aware.onTheBook).toContain("is already on $15.0MM Line of Credit");
    expect(aware.fresh).toHaveLength(0);
    expect(aware.options.map((o) => o.label)).toEqual(["Put a second one on the facility", "A different test"]);
    // The duplicate's own close. Nothing here needs putting up twice.
    expect(aware.close).toBeNull();
  });

  it("STATE 2: on the book but not on THIS loan is not a duplicate, and offers the three", () => {
    // The founder's own line: DSC of Borrower runs at the relationship level and
    // carries no loan junction at all, so it is not on the equipment loan.
    const aware = awarenessFor(complete({}, [EQ8]), ctxWith());
    expect(aware.onTheBook).toContain("NOT associated to $8.0MM Equipment");
    expect(aware.onTheBook).toContain("at the relationship level, with no loan junction on it at all");
    expect(aware.onTheBook).toContain("reaches a facility through its loan junction");
    // And never the old claim.
    expect(aware.onTheBook).not.toContain("already reaches every facility");
    expect(aware.options.map((o) => o.label)).toEqual([
      "Create a new one on this facility",
      "Associate the existing Debt Service Coverage of Borrower to this facility",
      "A different test",
    ]);
    // NOT a duplicate, so it must not be told it is one.
    expect(aware.close).toBe("Say which and I will put it up.");
  });

  it("STATE 3: a test the book does not carry stages, with nothing said", () => {
    const aware = awarenessFor(complete({ test: "Minimum Liquidity", threshold: 5_000_000, unit: "money" }, [EQ8]), ctxWith());
    // Minimum Liquidity carries no junction to the equipment loan either, so it
    // is state 2 as well - the honest third state needs a book with nothing on
    // it at all for this test.
    const bare = awarenessFor(complete({ test: "Minimum Liquidity" }, [EQ8]), ctxWith({ book: { ...book, covenants: [] } }));
    expect(bare.onTheBook).toBeNull();
    expect(bare.fresh).toEqual([EQ8]);
    expect(bare.options).toHaveLength(0);
    expect(aware.onTheBook).toContain("NOT associated to");
  });

  it("stages the second when the banker asks for one anyway", () => {
    const aware = awarenessFor(complete({ test: "Accounts Receivable", second: true }, [LOC15]), ctxWith());
    expect(aware.onTheBook).toBeNull();
    expect(aware.fresh).toEqual([LOC15]);
  });

  it("takes the associate chip, settles the record's own terms, and stages it as a handoff", () => {
    const ctx = ctxWith();
    const draft = complete({}, [EQ8]);
    const took = readInto(draft, "associate the existing Debt Service Coverage of Borrower covenant to this facility", ctx);
    expect(took.slots.associate).toBe(true);
    // The org's own record id, off the book. Never invented.
    expect(took.slots.existingCovenantId).toBe("a3Bbb000000S0UvEAK");
    expect(took.slots.threshold).toBe(1.25);
    expect(took.slots.frequency).toBe("Quarterly");

    // It is no longer blocked: an associate is a create on the junction.
    const aware = awarenessFor(took, ctx);
    expect(aware.fresh).toEqual([EQ8]);

    // ON A MODIFICATION IT FILES. `covenantAttachesJson` deployed on 2026-09-02,
    // so there is no gap left to state and the room stages a real card instead
    // (see orgArms.test.ts). On the other two routes the handoff stands, and it
    // names the route that does carry the arm rather than an arm being built.
    expect(associateGap(took, "modify")).toBeNull();
    const gap = associateGap(took, "renew")!;
    expect(gap).toContain("junction create for an existing record");
    expect(gap).toContain("rides the modification alone");
    expect(gap).toContain("Run it as a modification");
    expect(gap).not.toContain("being built");
    // AND THE JOIN IS A SENTENCE END, not a colon with a capital after it. The
    // route's own line opens a sentence wherever it is used, so a colon in
    // front of it read as "rides the modification alone: The renewal files".
    expect(gap).toContain("rides the modification alone. The renewal files");
    expect(gap).not.toContain("alone: The");
    expect(associateGap(draft, "renew")).toBeNull();

    const entry = handoffEntry(took, ctx, EQ8, gap, 0);
    expect(entry.fileable).toBe(false);
    expect(entry.after).toContain("Debt Service Coverage of Borrower");
    // The card does not call an association a new covenant, and the object it
    // names is the junction rather than the covenant.
    expect(entry.kind).toBe("Associate a covenant");
    expect(entry.title).toBe("Associate a covenant");
    expect(entry.before).toBe("on the book, with no junction to this facility");
    expect(entry.fields).toEqual(["LLC_BI__Loan_Covenant__c"]);

    // And the sentence over it says the record is not touched.
    expect(compose(took, ctx).lede).toContain("The covenant record is not touched");
    expect(compose(took, ctx).lede).not.toContain("set once when it is created");
  });

  it("never asks an associate for a threshold it is not setting", () => {
    const ctx = ctxWith();
    const took = readInto(
      { surface: "covenant", slots: { test: "Term Covenants", associate: true }, scope: [EQ8], scopeWord: true, unused: null },
      "the existing one",
      ctx,
    );
    // Term Covenants carries no threshold on this book at all.
    expect(took.slots.existingCovenantId).toBe("a3Bbb000000S0czEAC");
    expect(took.slots.threshold).toBeUndefined();
    expect(advance(took, ctx).ask).toBeNull();
  });

  it("names a pledge the deal already carries, and offers the second", () => {
    const ar = book.assets.find((a) => /accounts receivable/i.test(a.label))!;
    const draft: Draft = {
      surface: "collateral",
      slots: { assetId: ar.id, assetName: ar.name ?? undefined, lien: "1st" },
      scope: [LOC15, PURCHASE],
      scopeWord: true,
      unused: null,
    };
    const aware = awarenessFor(draft, ctxWith());
    expect(aware.onTheBook).toContain("already pledged to $15.0MM Line of Credit");
    // The facility it is NOT on survives. Awareness removes a question, never a
    // change the banker asked for.
    expect(aware.fresh).toEqual([PURCHASE]);
    expect(aware.options.map((o) => o.label)).toContain("Add a second");
  });

  it("never proposes what this session already put on the plan", () => {
    const ctx = ctxWith({
      plan: [
        {
          deltaId: "d1",
          surface: "covenant",
          memberId: PURCHASE,
          title: "New covenant",
          target: "Purchase",
          slots: { test: "Maximum Debt to Worth" },
          open: true,
        },
      ],
    });
    const aware = awarenessFor(complete({ test: "Maximum Debt to Worth" }), ctx);
    expect(aware.onThePlan).toContain("already on this plan");
    expect(aware.fresh).toHaveLength(0);
  });
});

/* --------------------------------------------------- composing and verifying */

describe("the composed sentence goes through the real parser, and is verified", () => {
  const covenant = (test: string, threshold: number, unit: "ratio" | "money", scope: string[]): Draft => ({
    surface: "covenant",
    slots: { test, threshold, unit, frequency: "Quarterly", second: true },
    scope,
    scopeWord: true,
    unused: null,
  });

  it("names the facility by the org's own loan name, so nothing fans out", async () => {
    const ctx = ctxWith();
    const draft = covenant("Debt Service Coverage of Borrower", 1.25, "ratio", [LOC15]);
    const { lines } = compose(draft, ctx);
    expect(lines[0].say).toBe(
      "on the Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00 add a debt service coverage of borrower covenant of 1.25x",
    );
    const { engine, context } = realEngine();
    const result = await engine.parseIntent(lines[0].say, context);
    expect(result.kind).toBe("deltas");
    const verdict = verify(draft, LOC15, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(true);
    // One facility, not both lines of credit.
    expect(result.kind === "deltas" && result.deltas).toHaveLength(1);
  });

  it("puts the facility first so the facility's own size cannot become the threshold", async () => {
    const ctx = ctxWith();
    const draft = covenant("Minimum Liquidity", 5_000_000, "money", [LOC15]);
    const { lines } = compose(draft, ctx);
    const { engine, context } = realEngine();
    const result = await engine.parseIntent(lines[0].say, context);
    const wire = result.kind === "deltas" ? result.deltas.find((d) => d.covenantWire)?.covenantWire : undefined;
    expect(wire?.threshold).toBe(5_000_000);
    expect(verify(draft, LOC15, result.kind === "deltas" ? result.deltas : []).ok).toBe(true);
  });

  it("D1: refuses a test the bank's catalog does not settle rather than staging the leftover words", async () => {
    const ctx = ctxWith();
    const draft = covenant("Accounts Receivable", 80, "ratio", [PURCHASE]);
    const { lines } = compose(draft, ctx);
    const { engine, context } = realEngine();
    const result = await engine.parseIntent(lines[0].say, context);
    // The parser DOES come back with a delta. It is a hollow one: no wire, and
    // the leftover words as its value. This is exactly the chip the founder
    // saw, and verification is what stops it reaching the glass.
    expect(result.kind).toBe("deltas");
    const verdict = verify(draft, PURCHASE, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.why).toContain("catalog did not settle");
  });

  it("D1: refuses a test the catalog resolved to a DIFFERENT test", async () => {
    const ctx = ctxWith();
    const draft = covenant("Debt Service Coverage with and without Distributions", 1.15, "ratio", [PURCHASE]);
    const { lines } = compose(draft, ctx);
    const { engine, context } = realEngine();
    const result = await engine.parseIntent(lines[0].say, context);
    const verdict = verify(draft, PURCHASE, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.why).toContain("Debt Service Coverage of Borrower");
  });

  it("composes a pledge on the org's own collateral record, and verifies the asset", async () => {
    const ctx = ctxWith();
    const ar = book.assets.find((a) => /accounts receivable/i.test(a.label))!;
    const draft: Draft = {
      surface: "collateral",
      slots: { assetId: ar.id, assetName: ar.name ?? undefined, lien: "1st" },
      scope: [PURCHASE],
      scopeWord: true,
      unused: null,
    };
    const { lines, gaps } = compose(draft, ctx);
    const { engine, context } = realEngine();
    const result = await engine.parseIntent(lines[0].say, context);
    const verdict = verify(draft, PURCHASE, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(true);
    expect(verdict.ok === true && verdict.delta.pledgeWire?.collateralId).toBe(ar.id);
    // THE LIEN POSITION IS THE BANK'S DECISION AND NO WIRE CARRIES IT, so it is
    // named rather than dropped.
    expect(gaps.join(" ")).toContain("lien position");
  });

  it("names a covenant schedule the modification cannot file", () => {
    const ctx = ctxWith();
    const draft = covenant("Minimum Liquidity", 5_000_000, "money", [PURCHASE]);
    const monthly: Draft = { ...draft, slots: { ...draft.slots, frequency: "Monthly" } };
    expect(compose(monthly, ctx).gaps.join(" ")).toContain("monthly");
    expect(compose(draft, ctx).gaps).toHaveLength(0);
  });

  /* THE HINT IS CHECKED AGAINST THE REAL PARSER. A mirror chip that leads to a
     refusal is a wasted gesture at a booth, so every one the room offers is
     driven through the engine here. If the catalog map inside the fence moves,
     this test fails rather than the demo. */
  it("every mirror it offers resolves against the bank's catalog", async () => {
    const ctx = ctxWith();
    const { engine, context } = realEngine();
    for (const mirror of mirrorChips(book)) {
      const draft = readInto(
        { surface: "covenant", slots: { second: true }, scope: [PURCHASE], scopeWord: true, unused: null },
        mirror.say,
        ctx,
      );
      // "with and without Distributions" is the one the catalog collapses onto
      // another test. It is still offered, because refusing to offer it would
      // hide a test the relationship genuinely runs, and verification names the
      // collision precisely when it happens.
      if (draft.slots.test === "Debt Service Coverage with and without Distributions") continue;
      const { lines } = compose(draft, ctx);
      const result = await engine.parseIntent(lines[0].say, context);
      const verdict = verify(draft, PURCHASE, result.kind === "deltas" ? result.deltas : []);
      expect(verdict.ok, `${mirror.label} did not resolve`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------- the amendment */

describe("a correction lands on the open create rather than beside it", () => {
  const open = (): Draft => ({
    surface: "covenant",
    slots: { test: "Debt Service Coverage of Borrower", threshold: 1.25, unit: "ratio", frequency: "Quarterly" },
    scope: [LOC15],
    scopeWord: true,
    unused: null,
  });

  it("reads \"actually make it 1.30x\" as the same decision, corrected", () => {
    const amend = amendmentOf("actually make it 1.30x", open(), ctxWith())!;
    expect(amend.draft.slots.threshold).toBe(1.3);
    expect(changedLine(amend.changed)).toBe("Updated on the card: the threshold is now 1.3x.");
  });

  it("reads a bare schedule as a correction", () => {
    const amend = amendmentOf("no, quarterly", { ...open(), slots: { ...open().slots, frequency: "Monthly" } }, ctxWith())!;
    expect(amend.draft.slots.frequency).toBe("Quarterly");
    expect(amend.changed.join(" ")).toContain("tested quarterly");
  });

  it("reads \"on the construction loan instead\" as a change of scope", () => {
    const amend = amendmentOf("on the construction loan instead", open(), ctxWith())!;
    expect(amend.draft.scope).toEqual([CONSTRUCTION]);
    expect(amend.changed.join(" ")).toContain("Construction");
  });

  it("is not a correction when nothing actually changed", () => {
    expect(amendmentOf("actually make it 1.25x", open(), ctxWith())).toBeNull();
  });

  it("is not a correction when the line is a new instruction", () => {
    expect(amendmentOf("take the line of credit to $20,000,000", open(), ctxWith())).toBeNull();
  });
});

/* ------------------------------------------------------------ what it ignores */

describe("what the create grammar deliberately does not claim", () => {
  it("does not open on a removal, a waiver or a question", () => {
    const ctx = ctxWith();
    expect(openCreate("waive the covenant on the Purchase", ctx)).toBeNull();
    expect(openCreate("drop the liquidity covenant", ctx)).toBeNull();
    expect(openCreate("what covenants are on this package", ctx)).toBeNull();
  });

  it("does not open on a commitment change", () => {
    expect(openCreate("take the 2.5M line of credit to $4,000,000", ctxWith())).toBeNull();
  });

  it("says nothing in banker copy with an em dash in it", () => {
    const ctx = ctxWith();
    const draft = openCreate("add another covenant to all of the loans", ctx)!;
    const step = advance(draft, ctx);
    const copy = [step.ask!.text, ...step.ask!.options.map((o) => `${o.label} ${o.say}`)].join(" ");
    expect(copy).not.toMatch(/—/);
  });
});

/* ------------------------------------------------------------- the catalog */

describe("the org's own covenant catalog, mirrored and proved against the engine", () => {
  /* THE MIRROR IS ONLY HONEST WHILE IT MATCHES. Every name the room offers is
     driven through the real deterministic parser here, so a change behind the
     fence breaks this test rather than a demo. */
  it("every catalog name the room offers is one the bank's own parser settles on", async () => {
    const { engine, context } = realEngine();
    for (const name of CATALOG_TESTS) {
      const draft: Draft = {
        surface: "covenant",
        slots: { test: name, threshold: 2, frequency: "Quarterly" },
        scope: [PURCHASE],
        scopeWord: true,
        unused: null,
      };
      const [line] = compose(draft, ctxWith()).lines;
      const result = await engine.parseIntent(line.say, context);
      expect(result.kind).toBe("deltas");
      const verdict = verify(draft, PURCHASE, result.kind === "deltas" ? result.deltas : []);
      expect(verdict.ok, `${name} did not survive the parser`).toBe(true);
    }
  });

  it("F-CG1a: a complete in-catalog line the book does not carry is complete, not a question", () => {
    const ctx = ctxWith();
    const draft = openCreate("add a leverage covenant of 3.5x tested quarterly on the purchase facility", ctx)!;
    expect(draft.slots.test).toBe("Leverage");
    expect(draft.slots.threshold).toBe(3.5);
    expect(draft.slots.frequency).toBe("Quarterly");
    expect(draft.scope).toEqual([PURCHASE]);
    expect(advance(draft, ctx).ask).toBeNull();
  });

  it("F-CG1b: names a test the catalog does not carry rather than asking again", () => {
    const ctx = ctxWith({ focused: MEMBERS[3] });
    const draft = openCreate("add an interest coverage covenant of 3.0x tested quarterly on this facility", ctx)!;
    expect(draft.notInCatalog).toBe("interest coverage");
    expect(draft.slots.test).toBeUndefined();
    // WHAT HE TYPED IS STILL HELD.
    expect(draft.slots.threshold).toBe(3);
    expect(draft.slots.frequency).toBe("Quarterly");

    const ask = advance(draft, ctx).ask!;
    expect(ask.text).toContain("does not carry an interest coverage test");
    expect(ask.text).toContain("I am holding 3x and the quarterly schedule");
    expect(ask.options.map((o) => o.label)).toEqual(expect.arrayContaining(CATALOG_TESTS));
    // GROUNDED IN THE BOOK FIRST: what the relationship already runs leads.
    expect(book.covenants.some((c) => c.type === ask.options[0].label)).toBe(true);
  });

  it("keeps the typed threshold and schedule when the banker names a catalog test", () => {
    const ctx = ctxWith({ focused: MEMBERS[3] });
    const draft = openCreate("add an interest coverage covenant of 3.0x tested quarterly on this facility", ctx)!;
    const after = readInto(draft, "a Minimum Current Ratio covenant", ctx);
    expect(after.slots.test).toBe("Minimum Current Ratio");
    expect(after.notInCatalog).toBeUndefined();
    expect(after.slots.threshold).toBe(3);
    expect(after.slots.frequency).toBe("Quarterly");
    expect(advance(after, ctx).ask).toBeNull();
  });

  it("still asks which test when the family names two, rather than reaching for the catalog", () => {
    const ctx = ctxWith();
    const draft = openCreate("add a DSCR covenant of 1.25x tested quarterly on the 15M line of credit", ctx)!;
    expect(draft.slots.test).toBeUndefined();
    expect(draft.notInCatalog).toBeUndefined();
    expect(draft.ambiguousTests).toEqual([
      "Debt Service Coverage of Borrower",
      "Debt Service Coverage with and without Distributions",
    ]);
  });

  it("does not read leverage and debt to worth as the same test", () => {
    const ctx = ctxWith();
    expect(openCreate("add a leverage covenant of 3.5x on the purchase facility", ctx)!.slots.test).toBe("Leverage");
    expect(openCreate("add a debt to worth covenant of 3x on the purchase facility", ctx)!.slots.test).toBe(
      "Maximum Debt to Worth",
    );
  });

  it("reads what the banker called the test, and nothing where he named none", () => {
    expect(namedTest("add an interest coverage covenant of 3.0x tested quarterly")).toBe("interest coverage");
    expect(namedTest("put a fixed charge coverage test on the equipment loan")).toBe("fixed charge coverage");
    // No test named at all. The grounded ask is the right answer to these.
    expect(namedTest("add another covenant to all of the loans")).toBeNull();
    expect(namedTest("add a covenant on this facility")).toBeNull();
    expect(namedTest("add a second covenant")).toBeNull();
  });
});

/* -------------------------------------------------------- the plan, amended */

describe("a line touching a staged entry amends it rather than doubling it", () => {
  const staged = (over: Partial<Draft["slots"]> = {}) => ({
    deltaId: "covenant.add:purchase:1",
    surface: "covenant" as const,
    memberId: PURCHASE,
    title: "New covenant",
    target: "Purchase",
    slots: { test: "Leverage", threshold: 3.5, unit: "ratio" as const, frequency: "Quarterly", ...over },
    open: false,
  });

  it("names the staged entry and what moved on it", () => {
    const ctx = ctxWith({ plan: [staged()] });
    const draft = openCreate("add a leverage covenant of 2.75x tested quarterly on the purchase facility", ctx)!;
    const found = planAmendmentFor(draft, ctx)!;
    expect(found.entry.deltaId).toBe("covenant.add:purchase:1");
    expect(found.changed).toEqual(["the threshold is now 2.75x"]);
    expect(amendedPlanLine(found.changed)).toContain("rather than putting a second one beside it");
  });

  it("is not an amendment when the line says exactly what is already staged", () => {
    const ctx = ctxWith({ plan: [staged()] });
    const draft = openCreate("add a leverage covenant of 3.5x tested quarterly on the purchase facility", ctx)!;
    expect(planAmendmentFor(draft, ctx)).toBeNull();
  });

  it("is not an amendment when the banker asked for a second one", () => {
    const ctx = ctxWith({ plan: [staged()] });
    const draft = readInto(
      openCreate("add a leverage covenant of 2.75x on the purchase facility", ctx)!,
      "add a second leverage covenant",
      ctx,
    );
    expect(planAmendmentFor(draft, ctx)).toBeNull();
  });

  it("leaves a chip that is still open to the card's own amendment", () => {
    const ctx = ctxWith({ plan: [{ ...staged(), open: true }] });
    const draft = openCreate("add a leverage covenant of 2.75x tested quarterly on the purchase facility", ctx)!;
    expect(planAmendmentFor(draft, ctx)).toBeNull();
  });
});

/* ------------------------------------------- the routes that cannot file it */

describe("a route whose own tool cannot file the create records it instead", () => {
  it("says nothing about the modification, which files both surfaces", () => {
    expect(routeGap("covenant", "modify")).toBeNull();
    expect(routeGap("collateral", "modify")).toBeNull();
  });

  it("names what the renewal and the new facility do file", () => {
    expect(routeGap("covenant", "renew")).toContain("a new maturity and a repricing");
    expect(routeGap("collateral", "create")).toContain("the product, the amount, the term and the purpose");
    expect(routeGap("collateral", "renew")).toContain("A pledge is not one of them");
  });

  it("records the whole create on the plan, with no wire on it", () => {
    const ctx = ctxWith();
    const draft = openCreate("add a leverage covenant of 3.5x tested quarterly on the purchase facility", ctx)!;
    const entry = handoffEntry(draft, ctx, PURCHASE, routeGap("covenant", "renew")!, 0);
    expect(entry.fileable).toBe(false);
    expect(entry.wire).toBeUndefined();
    expect(entry.covenantWire).toBeUndefined();
    expect(entry.handoff!.reason).toContain("a new maturity and a repricing");
    expect(entry.after).toBe("Leverage at 3.5x, tested quarterly");
    expect(entry.target).toBe("Purchase");
    expect(`${entry.after} ${entry.caveat} ${entry.badge}`).not.toMatch(/—/);
  });
});

/* ------------------------------------------------ the founder's own words */

describe("the founder's own correction, without a unit on it", () => {
  const open = (): Draft => ({
    surface: "covenant",
    slots: { test: "Leverage", threshold: 3.5, unit: "ratio", frequency: "Quarterly" },
    scope: [PURCHASE],
    scopeWord: true,
    unused: null,
  });

  it("reads \"actually make it 1.30\" as the threshold, keeping the unit the card holds", () => {
    const amend = amendmentOf("actually make it 1.30", open(), ctxWith())!;
    expect(amend.draft.slots.threshold).toBe(1.3);
    expect(amend.draft.slots.unit).toBe("ratio");
    expect(changedLine(amend.changed)).toBe("Updated on the card: the threshold is now 1.3x.");
  });

  it("still refuses a bare figure that no word anchors as a threshold", () => {
    // "3.5" sitting loose beside a facility is a figure about the deal, not an
    // instruction, and the room asks for the threshold rather than taking it.
    const ctx = ctxWith();
    const draft = openCreate("add a leverage covenant 3.5 on the purchase facility", ctx)!;
    expect(draft.slots.test).toBe("Leverage");
    expect(draft.slots.threshold).toBeUndefined();
    expect(advance(draft, ctx).ask?.slot).toBe("threshold");
  });
});

/* =============================================================================
   THE INVOLVEMENT SURFACE (phase 2, closing E4a and E4b from the everything-plan
   drive).

   THE BOOK IT IS HELD AGAINST is the org's own pre-flight: Hartwell Industrial
   Holdings is Guarantor on all six eligible loans, and Elena Hartwell is
   Limited Guarantor on Construction and on the $15M line only.
   ============================================================================= */

const HOLDINGS = "Hartwell Industrial Holdings LLC";
const ELENA = "Elena Hartwell";

/** The bundle's own read, with the borrowing structure the org actually holds
 *  folded in. `buildBook` reads it exactly as it reads the live one. */
const structured = buildBook(
  {
    ...bundle,
    graph: {
      ...bundle.graph,
      legalEntities: [
        ...[LOC15, EQ8, CONSTRUCTION, PURCHASE, EQ35, LOC25].map((loanId) => ({
          accountName: "Hartwell Precision Manufacturing LLC",
          borrowerType: "Borrower",
          loanId,
        })),
        ...[LOC15, EQ8, CONSTRUCTION, PURCHASE, EQ35, LOC25].map((loanId) => ({
          accountName: HOLDINGS,
          borrowerType: "Guarantor",
          loanId,
        })),
        { accountName: ELENA, borrowerType: "Limited Guarantor", loanId: LOC15 },
        { accountName: ELENA, borrowerType: "Limited Guarantor", loanId: CONSTRUCTION },
      ],
    },
  } as BorrowerBundle,
  MEMBERS.map((m) => m.id),
);

const structuredCtx = (over: Partial<ElicitContext> = {}): ElicitContext => ctxWith({ book: structured, ...over });

describe("the book carries who is on the deal, per facility", () => {
  it("reads the role PER FACILITY, because that is how the org holds it", () => {
    expect(rolesOnFacility(structured, ELENA, LOC15)).toEqual(["Limited Guarantor"]);
    expect(rolesOnFacility(structured, ELENA, EQ8)).toEqual([]);
    expect(rolesOnFacility(structured, HOLDINGS, CONSTRUCTION)).toEqual(["Guarantor"]);
  });

  it("matches a name across the legal suffix a banker drops in speech", () => {
    expect(rolesOnFacility(structured, "Hartwell Industrial Holdings", CONSTRUCTION)).toEqual(["Guarantor"]);
    expect(samePartyName("Hartwell Industrial Holdings", HOLDINGS)).toBe(true);
    expect(samePartyName(ELENA, HOLDINGS)).toBe(false);
  });

  it("names every facility a party is on, with the role each row carries", () => {
    expect(facilitiesFor(structured, ELENA).map((f) => f.loanId).sort()).toEqual([LOC15, CONSTRUCTION].sort());
  });
});

describe("a complete borrowing-structure line stages directly (E4b)", () => {
  it("reads the party, the role and the facility off one sentence", () => {
    const draft = openCreate("add Elena Hartwell as limited guarantor on the 8M equipment loan", structuredCtx())!;
    expect(draft.surface).toBe("involvement");
    expect(draft.slots.party).toBe(ELENA);
    expect(draft.slots.role).toBe("Limited Guarantor");
    expect(draft.scope).toEqual([EQ8]);
    expect(advance(draft, structuredCtx()).ask).toBeNull();
  });

  it("composes a sentence the real parser stages, with the ROLE as the value and never a fragment", async () => {
    const { engine, context } = realEngine();
    const draft = openCreate("add Elena Hartwell as limited guarantor on the 8M equipment loan", structuredCtx())!;
    const composed = compose(draft, structuredCtx());
    const result = await engine.parseIntent(composed.lines[0].say, context);
    const verdict = verify(draft, EQ8, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.delta.involvementWire).toMatchObject({ op: "add", role: "Limited Guarantor", accountName: ELENA, facilityId: EQ8 });
    // THE CHIP SAYS THE ROLE, not the tail of the sentence (E4b: the value was
    // "on the construction loan").
    const chip = restateEntry(draft, structuredCtx(), verdict.delta);
    expect(chip.title).toBe(ELENA);
    expect(chip.after).toBe("Limited Guarantor");
    expect(chip.after).not.toMatch(/on the/);
    expect(chip.before).toBe("not on the facility today");
  });

  it("claims nothing about a facility whose structure this read does not carry", () => {
    // "not on the facility today" is an assertion about the bank's record, and
    // the drive caught the room making it about a party that WAS on it. With a
    // read carrying no structure at all the room says what it actually knows.
    const blind = ctxWith({ book: buildBook(null, MEMBERS.map((m) => m.id)) });
    const draft = openCreate("add Elena Hartwell as limited guarantor on the 8M equipment loan", blind)!;
    const chip = restateEntry(draft, blind, {
      ...handoffEntry(draft, blind, EQ8, "reason", 0),
      involvementWire: { op: "add", role: "Limited Guarantor", accountName: ELENA, facilityId: EQ8 },
    });
    expect(chip.before).toBe("not carried on this read");
  });

  it("elicits rather than staging when the line names nobody", () => {
    const draft = openCreate("add a guarantor", structuredCtx())!;
    expect(draft.slots.party).toBeUndefined();
    const step = advance(draft, structuredCtx());
    expect(step.ask?.slot).toBe("party");
    expect(step.ask?.text).toContain("An involvement row names one account");
    expect(step.ask?.options.map((o) => o.label)).toContain(HOLDINGS);
  });

  /* ================== A NAME THE BANKER TYPED IS NEVER DROPPED (founder's Blue
     Ridge run, 2026-09-14, defect b). "Add Piedmont Precision as Guarantor" ,
     an ordinary sentence opening on a capital, matched no verb at all, because
     the name pattern carried no case for its own verb, so the party slot stayed
     empty and the room asked "Who goes on the deal?" over a name it had just
     been given, offering only the relationship's own parties. */
  it("takes a capitalised verb and keeps the name the banker typed", () => {
    const draft = openCreate("Add Piedmont Precision as Guarantor", structuredCtx())!;
    expect(draft.surface).toBe("involvement");
    expect(draft.slots.party).toBe("Piedmont Precision");
    expect(draft.slots.partyOnBook).toBe(false);
    expect(draft.slots.role).toBe("Guarantor");
    // AND THE NAME QUESTION IS BEHIND IT: what is left is where it lands.
    const step = advance(draft, structuredCtx());
    expect(step.ask?.slot).not.toBe("party");
  });

  it("still refuses to read an article or a bare role as a name", () => {
    for (const line of ["Add a guarantor", "Add the limited guarantor"]) {
      const draft = openCreate(line, structuredCtx())!;
      expect(draft.slots.party).toBeUndefined();
    }
  });

  it("takes the chip that files the typed name as a new party", () => {
    const draft = openCreate("Add Piedmont Precision as Guarantor", structuredCtx())!;
    const next = readInto(draft, "add the new party Piedmont Precision", structuredCtx());
    expect(next.slots.partyNew).toBe(true);
    expect(next.slots.party).toBe("Piedmont Precision");
  });

  it("asks for the role, book first, when the line names only a party", () => {
    const draft = openCreate("add Elena Hartwell to the 8M equipment loan", structuredCtx())!;
    const step = advance(draft, structuredCtx());
    expect(step.ask?.slot).toBe("role");
    expect(step.ask?.options.map((o) => o.label)[0]).toBe("Limited Guarantor");
    expect(step.ask?.text).toContain("already carries Elena Hartwell as Limited Guarantor");
  });

  it("refuses Grantor and Contractor by name and offers the five that are legal", () => {
    const draft = openCreate("add Hartwell Logistics LLC as grantor on the construction loan", structuredCtx())!;
    const step = advance(draft, structuredCtx());
    expect(step.ask?.slot).toBe("role");
    expect(step.ask?.text).toContain("Grantor is on the object");
    expect(step.ask?.text).toContain("collateral semantics");
    expect(step.ask?.options.map((o) => o.label)).toEqual(INVOLVEMENT_ROLES);
  });

  it("keeps a name the book does not carry, because that is what an add is", () => {
    const draft = openCreate("add Hartwell Logistics LLC as a guarantor on the construction loan", structuredCtx())!;
    expect(draft.slots.party).toBe("Hartwell Logistics LLC");
    expect(draft.slots.partyOnBook).toBe(false);
  });
});

describe("a party already on the facility is named, never staged twice (E4a)", () => {
  it("names the duplicate and offers a way through it", () => {
    // The founder's own trap line. Holdings IS already Guarantor on
    // Construction, and the room staged a second row saying "not on the
    // facility today".
    const draft = openCreate("add Hartwell Industrial Holdings as guarantor on the construction loan", structuredCtx())!;
    expect(draft.scope).toEqual([CONSTRUCTION]);
    const aware = awarenessFor(draft, structuredCtx());
    expect(aware.fresh).toEqual([]);
    expect(aware.onTheBook).toContain("already Guarantor on Construction");
    expect(aware.onTheBook).toContain("stages a SECOND row");
    expect(aware.options.map((o) => o.label)).toContain("Take Hartwell Industrial Holdings LLC off that facility");
    expect(aware.options.map((o) => o.label)).toContain("A different facility");
  });

  it("calls a different role on that facility a role change, not an addition", () => {
    const draft = openCreate("add Elena Hartwell as a guarantor on the 15M line of credit", structuredCtx())!;
    expect(draft.scope).toEqual([LOC15]);
    const aware = awarenessFor(draft, structuredCtx());
    expect(aware.fresh).toEqual([]);
    expect(aware.onTheBook).toContain("already Limited Guarantor");
    expect(aware.onTheBook).toContain("ROLE CHANGE rather than an addition");
    expect(aware.onTheBook).toContain("carry exclusion");
  });

  it("lets a clean facility through untouched", () => {
    const draft = openCreate("add Elena Hartwell as limited guarantor on the 8M equipment loan", structuredCtx())!;
    const aware = awarenessFor(draft, structuredCtx());
    expect(aware.fresh).toEqual([EQ8]);
    expect(aware.onTheBook).toBeNull();
    expect(aware.options).toEqual([]);
  });

  it("does not propose the same involvement twice in one session", () => {
    const draft = openCreate("add Elena Hartwell as limited guarantor on the 8M equipment loan", structuredCtx())!;
    const plan = [
      { deltaId: "d", surface: "involvement" as const, memberId: EQ8, title: ELENA, target: "$8.0MM Equipment", slots: { party: ELENA, role: "Limited Guarantor" }, open: false },
    ];
    const aware = awarenessFor(draft, structuredCtx({ plan }));
    expect(aware.fresh).toEqual([]);
    expect(aware.onThePlan).toContain("already on this plan");
  });
});

describe("create then pledge, end to end (P3)", () => {
  const FOUNDER = "pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000";

  it("reads the asset, the family, the figure and the facility off the founder's own line", () => {
    const draft = openCreate(FOUNDER, ctxWith())!;
    expect(draft.slots.isNew).toBe(true);
    /* E6: "real estate" is a WORD and this org holds eleven NAMES under it, so
       the kind is a question rather than a settled slot. The org's own refusal
       is what says so: `"Real Estate" matches 12 collateral types on this org`. */
    expect(draft.slots.assetKind).toBeUndefined();
    expect(draft.typeFamily?.word).toBe("Real Estate");
    expect(draft.typeFamily?.values).toContain("Real Estate-Construction");
    expect(draft.slots.assetValue).toBe(6_500_000);
    // HIS WORDS. What the org files as the collateral description.
    expect(draft.slots.assetDescription).toBe("Kokomo plant expansion");
    expect(draft.scope).toEqual([CONSTRUCTION]);
  });

  it("asks only for the rate and the lien, and never refuses the create", () => {
    const ctx = ctxWith();
    let draft = openCreate(FOUNDER, ctx)!;
    const asks: string[] = [];
    const answers: Record<string, string> = {
      assetKind: "Real Estate-Construction",
      advanceRate: "at a 75% advance rate",
      lien: "1st lien position",
    };
    for (let i = 0; i < 6; i += 1) {
      const step = advance(draft, ctx);
      if (!step.ask) break;
      asks.push(step.ask.slot);
      draft = readInto(step.draft, answers[step.ask.slot] ?? "1st lien position", ctx);
    }
    expect(asks).toEqual(["assetKind", "advanceRate", "lien"]);
    expect(draft.slots.assetKind).toBe("Real Estate-Construction");
    expect(draft.slots.advanceRate).toBe(75);
    // And the description survived the answers that came after it.
    expect(draft.slots.assetDescription).toBe("Kokomo plant expansion");
  });

  it("the rate ask offers the bank's own guideline band for the kind", () => {
    const ctx = ctxWith();
    const draft = readInto(openCreate(FOUNDER, ctx)!, "Real Estate-Construction", ctx);
    const ask = advance(draft, ctx).ask!;
    expect(ask.slot).toBe("advanceRate");
    expect(ask.options.map((o) => o.label)).toEqual(["75 percent", "80 percent"]);
    expect(ask.text).toContain("75 to 80 percent of appraised value");
    expect(ask.text).toContain("70 percent of cost on construction");
  });

  it("composes a sentence the real engine stages, and files the banker's own description", async () => {
    const ctx = ctxWith();
    const settled: Draft = {
      ...openCreate(FOUNDER, ctx)!,
      slots: {
        ...openCreate(FOUNDER, ctx)!.slots,
        assetKind: "Real Estate-Construction",
        advanceRate: 75,
        lien: "1st",
      },
    };
    const composition = compose(settled, ctx);
    expect(composition.lines).toHaveLength(1);
    expect(composition.lede).toContain("Kokomo plant expansion, real estate-construction at $6,500,000");
    expect(composition.lede).toContain("75 percent advance rate");
    // The lien still rides the plan: no deployed write carries one.
    expect(composition.gaps.join(" ")).toContain("lien position");

    const { engine, context } = realEngine();
    const result = await engine.parseIntent(composition.lines[0].say, context);
    expect(result.kind).toBe("deltas");
    const verdict = verify(settled, CONSTRUCTION, result.kind === "deltas" ? result.deltas : []);
    expect(verdict.ok).toBe(true);

    const entry = restateEntry(settled, ctx, (verdict as { ok: true; delta: WorkroomDelta }).delta);
    expect(entry.fileable).toBe(true);
    expect(entry.title).toBe("Kokomo plant expansion");
    /* E6: the fenced parser maps every real-estate word onto the single word
       "Real Estate", which is not one of this org's types and which the org
       refuses at staging with its own list. `restateEntry` puts the name the
       banker settled on onto the wire. */
    expect(entry.pledgeWire!.newCollateral).toEqual({
      description: "Kokomo plant expansion",
      collateralType: "Real Estate-Construction",
      value: 6_500_000,
    });
    expect(entry.pledgeWire!.advanceRate).toBe(75);
    expect(entry.after).toContain("created and pledged");
  });

  it("asks for the description where the line carried none, rather than composing one", () => {
    const ctx = ctxWith();
    const draft = readInto(
      { surface: "collateral", slots: { isNew: true, assetKind: "Equipment" }, scope: [PURCHASE], scopeWord: true, unused: null },
      "a new asset",
      ctx,
    );
    const ask = advance(draft, ctx).ask!;
    expect(ask.slot).toBe("assetDescription");
    expect(ask.text).toContain("only readable identity");
  });

  it("keeps pledge-existing as its own action and never as the fallback to a create", () => {
    const ctx = ctxWith();
    // The asset question, on a line that named no asset at all. The deal's own
    // assets are offered here, which is where that choice belongs.
    const ask = advance(openCreate("pledge something to the Purchase", ctx)!, ctx).ask!;
    expect(ask.slot).toBe("asset");
    expect(ask.options.map((o) => o.label)).toContain("None of these, a new asset");
    // And a create is never answered with "pledge something the deal already
    // carries", which was the pointless fallback (P3).
    let draft = openCreate("pledge a new forklift fleet worth $2,000,000 to the Purchase", ctx)!;
    for (let i = 0; i < 6; i += 1) {
      const step = advance(draft, ctx);
      if (!step.ask) break;
      expect(step.ask.text).not.toContain("already carries");
      expect(step.ask.options.map((o) => o.label)).not.toContain("Pledge something the deal already carries");
      draft = readInto(step.draft, step.ask.slot === "advanceRate" ? "at an 80% advance rate" : "1st lien position", ctx);
    }
    expect(compose(draft, ctx).lines).toHaveLength(1);
  });
});

describe("a typed collateral type wins over the question (E3)", () => {
  it("takes \"real estate\" off the founder's own line and asks WHICH of the org's own names", () => {
    const line = "pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000";
    const draft = openCreate(line, ctxWith())!;
    expect(draft.surface).toBe("collateral");
    expect(draft.slots.isNew).toBe(true);
    expect(draft.slots.assetValue).toBe(6_500_000);
    /* E6, and it SUPERSEDES the E3 reading below it. The typed word is still
       honoured: it is what picks the family. What it is not is a collateral
       TYPE, because this org holds eleven of them under those two words. */
    const step = advance(draft, ctxWith());
    expect(step.ask?.slot).toBe("assetKind");
    expect(step.ask!.text).toContain("11 collateral types on this org");
    expect(step.ask!.options.map((o) => o.label)).toContain("Real Estate-Construction");
    // And the chip is the org's own name, typed straight back.
    const answered = readInto(step.draft, "Real Estate-Construction", ctxWith());
    expect(answered.slots.assetKind).toBe("Real Estate-Construction");
    expect(answered.typeFamily).toBeUndefined();
    expect(advance(answered, ctxWith()).ask?.slot).not.toBe("assetKind");
  });

  it("names the catalog it resolves a word against when it does have to ask", () => {
    const draft = readInto({ surface: "collateral", slots: { isNew: true, assetValue: 1_000_000 }, scope: [LOC15], scopeWord: true, unused: null }, "a new asset", ctxWith());
    const ask = advance(draft, ctxWith()).ask!;
    expect(ask.slot).toBe("assetKind");
    expect(ask.text).toContain("collateral-type catalog");
    // ONE CHIP PER FAMILY. The name is the family's own second question.
    expect(ask.options.map((o) => o.label)).toContain("Equipment");
    expect(ask.options.map((o) => o.label)).toContain("Real Estate");
    expect(ask.options.map((o) => o.label)).not.toContain("Real Estate-Warehouse");
  });
});

describe("an operator in front of a figure is the threshold", () => {
  it("reads \">= 1.30\" and leaves the facility's own figure to the scope", () => {
    // The founder's own line 5. With no operator in the anchor list the reader
    // fell through to the single money token, filed $8,000,000 as the threshold
    // and left the scope unresolved, so a fully-specified line was asked about.
    const line = "add a Debt Service Coverage of Borrower covenant >= 1.30 on the 8M equipment loan";
    const draft = openCreate(line, ctxWith())!;
    expect(draft.slots.test).toBe("Debt Service Coverage of Borrower");
    expect(draft.slots.threshold).toBe(1.3);
    expect(draft.slots.unit).toBeUndefined();
    expect(draft.scope).toEqual([EQ8]);
    expect(advance(draft, ctxWith()).ask).toBeNull();
  });

  it("still reads a money threshold as money", () => {
    const draft = openCreate("add a Minimum Liquidity covenant >= $5,000,000 on the construction loan", ctxWith())!;
    expect(draft.slots.threshold).toBe(5_000_000);
    expect(draft.slots.unit).toBe("money");
    expect(draft.scope).toEqual([CONSTRUCTION]);
  });

  it("still reads a ratio written with an x", () => {
    const draft = openCreate("add a Maximum Debt to Worth covenant of 3.5x on the construction loan", ctxWith())!;
    expect(draft.slots.threshold).toBe(3.5);
    expect(draft.slots.unit).toBe("ratio");
  });
});

/* ============================ THE COLLATERAL TYPE IS THE ORG'S NAME (E6)

   Founder drive, 2026-09-02: "pledge new collateral on the construction loan:
   Kokomo plant expansion, real estate, valued at 6,500,000" staged the type
   "Real Estate" and the org refused it at staging with the eleven names it
   actually holds. The word is a FAMILY here, and a family is a question.      */

const ORG_COLLATERAL_CATALOG: OrgCatalog = {
  fields: [
    {
      objectName: "LLC_BI__Collateral__c",
      fieldName: "LLC_BI__Collateral_Type__c",
      source: "catalog",
      values: [
        "Equipment",
        "Real Estate-Construction",
        "Real Estate-Office",
        "Real Estate-Warehouse",
        "Inventory",
      ].map((label, i) => ({ label, value: `a3Kbb000000${i}AAA` })),
      acceptedValues: [],
    },
  ],
};

describe("the collateral type resolves to the org's own name (E6)", () => {
  const catalogCtx = () => ctxWith({ catalog: ORG_COLLATERAL_CATALOG });

  it("asks WHICH name where the banker's word is a family the org holds several of", () => {
    const read = readAssetType("Kokomo plant expansion, real estate, valued at 6,500,000", catalogCtx());
    expect(read).toEqual({
      kind: "family",
      word: "Real Estate",
      values: ["Real Estate-Construction", "Real Estate-Office", "Real Estate-Warehouse"],
    });
  });

  it("takes an exact org name the banker typed over the word in front of it", () => {
    expect(readAssetType("Real Estate-Construction", catalogCtx())).toEqual({
      kind: "exact",
      value: "Real Estate-Construction",
    });
  });

  it("settles a word the org holds exactly one name under, and asks nothing", () => {
    expect(readAssetType("a new equipment asset", catalogCtx())).toEqual({ kind: "exact", value: "Equipment" });
  });

  it("says nothing about a line that named no kind at all", () => {
    expect(readAssetType("at a 75% advance rate", catalogCtx())).toBeNull();
  });

  it("carries the choice into the composed sentence and onto the wire", () => {
    const ctx = catalogCtx();
    let draft = openCreate(
      "pledge new collateral on the construction loan: Kokomo plant expansion, real estate, valued at 6,500,000",
      ctx,
    )!;
    expect(draft.slots.assetKind).toBeUndefined();
    const ask = advance(draft, ctx).ask!;
    expect(ask.slot).toBe("assetKind");
    expect(ask.text).toContain("3 collateral types on this org");
    // The chip types the org's own name straight back.
    draft = readInto(draft, ask.options[0].say, ctx);
    expect(draft.slots.assetKind).toBe("Real Estate-Construction");
    expect(draft.typeFamily).toBeUndefined();
  });

  it("stands on the mirror with the org's own family names where there is no catalog", () => {
    const read = readAssetType("a new real estate asset", ctxWith());
    expect(read?.kind).toBe("family");
    expect(read && read.kind === "family" ? read.values : []).toContain("Real Estate-Construction");
    expect(read && read.kind === "family" ? read.values : []).toHaveLength(11);
  });
});

/* ========= THE SAME CREATE TWICE AMENDS THE ENTRY, IT DOES NOT DOUBLE IT

   Founder drive 2026-09-02: the Kokomo create was staged twice and the manifest
   ended with it twice. The plan-awareness rule keys on `assetId`, which a
   net-new asset does not have yet, so it fell straight through.               */

describe("a net-new pledge already on the plan (2026-09-02)", () => {
  const KOKOMO: Draft = {
    surface: "collateral",
    slots: {
      isNew: true,
      assetKind: "Real Estate-Construction",
      assetDescription: "Kokomo plant expansion",
      assetValue: 6_500_000,
      advanceRate: 75,
    },
    scope: [CONSTRUCTION],
    scopeWord: true,
    unused: null,
  };

  const staged = (over: Partial<Draft["slots"]> = {}) =>
    ctxWith({
      plan: [
        {
          deltaId: "collateral.pledge:construction:0",
          surface: "collateral",
          memberId: CONSTRUCTION,
          title: "Kokomo plant expansion",
          target: "Construction",
          slots: { ...KOKOMO.slots, ...over },
          open: false,
        },
      ],
    });

  it("names it as already on the plan rather than staging a second one", () => {
    const aware = awarenessFor(KOKOMO, staged());
    expect(aware.onThePlan).toContain("Kokomo plant expansion is already on this plan for Construction");
    expect(aware.fresh).toEqual([]);
  });

  it("amends the entry where the banker said it again with a different figure", () => {
    const amendment = planAmendmentFor({ ...KOKOMO, slots: { ...KOKOMO.slots, assetValue: 7_000_000 } }, staged())!;
    expect(amendment).not.toBeNull();
    expect(amendment.entry.deltaId).toBe("collateral.pledge:construction:0");
    expect(amendment.changed).toEqual(["it is worth $7,000,000"]);
  });

  it("amends the entry where the collateral type moved", () => {
    const amendment = planAmendmentFor(
      { ...KOKOMO, slots: { ...KOKOMO.slots, assetKind: "Real Estate-Office" } },
      staged(),
    )!;
    expect(amendment.changed).toEqual(["the collateral type is now Real Estate-Office"]);
  });

  it("is not an amendment where nothing the banker owns has moved", () => {
    expect(planAmendmentFor(KOKOMO, staged())).toBeNull();
  });

  it("takes a DIFFERENT asset on the same facility as a create of its own", () => {
    const other: Draft = { ...KOKOMO, slots: { ...KOKOMO.slots, assetDescription: "Muncie tooling line" } };
    expect(planAmendmentFor(other, staged())).toBeNull();
    expect(awarenessFor(other, staged()).fresh).toEqual([CONSTRUCTION]);
  });

  it("leaves an entry staged on another facility alone", () => {
    const elsewhere = ctxWith({
      plan: [
        {
          deltaId: "collateral.pledge:loc:0",
          surface: "collateral",
          memberId: LOC15,
          title: "Kokomo plant expansion",
          target: "$15.0MM Line of Credit",
          slots: KOKOMO.slots,
          open: false,
        },
      ],
    });
    expect(planAmendmentFor(KOKOMO, elsewhere)).toBeNull();
    expect(awarenessFor(KOKOMO, elsewhere).fresh).toEqual([CONSTRUCTION]);
  });
});

/* =============================================================================
   A PARTY'S OWN NAME IS NOT A FACILITY SCOPE.

   D1, the three-book drive matrix (2026-09-13, backlog row 51). `productWords`
   indexes each member by its key AND by the key's first word, which is what
   lets "equipment" name the equipment loans. On a book whose loans are not
   named `<Borrower> - <Product> - <$Amount>` the key keeps the borrower's name
   on the front, so that first word is the BORROWER'S: on Kingsley, "kingsley"
   names all three facilities at once.

   "add Kingsley Family Trust as guarantor on the 8M Kingsley Working Capital
   Revolver" therefore came back asking which of the three it should land on,
   over a line that had already named one: by the time the scope is read the
   facility phrase has been scrubbed out of the text, and the guarantor's own
   name was the only thing left carrying the word.
   ============================================================================= */

describe("a guarantor whose name carries the borrower's", () => {
  const kgsl: ElicitMember[] = [
    { id: "a1XSAMPLEKGSL001", key: "Kingsley Equipment Term Loan A", label: "Kingsley Equipment Term Loan A", orgName: "Kingsley Equipment Term Loan A", shortName: "Kingsley Equipment Term Loan A", committed: 10_000_000 },
    { id: "a1XSAMPLEKGSL002", key: "Kingsley Working Capital Revolver", label: "Kingsley Working Capital Revolver", orgName: "Kingsley Working Capital Revolver", shortName: "Kingsley Working Capital Revolver", committed: 8_000_000 },
    { id: "a1XSAMPLEKGSL003", key: "Kingsley CapEx Facility II", label: "Kingsley CapEx Facility II", orgName: "Kingsley CapEx Facility II", shortName: "Kingsley CapEx Facility II", committed: 4_000_000 },
  ];
  const kctx = ctxWith({ members: kgsl, relationship: "Kingsley Precision Works" });

  it("reads the borrower's name inside a member key as a scope, which is what the scrub is for", () => {
    /* The behaviour the fix works around, asserted so a change to `productWords`
       shows up here rather than as a mystery in the drive. */
    const raw = readScope("add Kingsley Family Trust as guarantor", kgsl);
    expect(raw.word).toBe(true);
    expect(raw.ids).toEqual([]);
  });

  it("does not read the party's own name as the facility once the surface has settled it", () => {
    const draft = openCreate("add Kingsley Family Trust as guarantor", kctx)!;
    expect(draft.surface).toBe("involvement");
    expect(draft.slots.party).toBe("Kingsley Family Trust");
    /* The line named no facility, so the room asks the plain scope question
       rather than the "more than one reading of that" one, which is about a word
       the banker actually wrote. */
    expect(draft.scopeWord).toBe(false);
    expect(nextAsk(draft, kctx)?.text).not.toMatch(/more than one reading of that/);
  });

  it("still reads a facility the line DOES name", () => {
    const draft = openCreate("add Kingsley Family Trust as guarantor on the 8M Kingsley Working Capital Revolver", kctx)!;
    expect(draft.scope).toEqual(["a1XSAMPLEKGSL002"]);
  });

  it("leaves a book whose loans follow the naming convention exactly as it was", () => {
    const draft = openCreate("add James Hartwell as guarantor on the 15M line of credit", ctxWith())!;
    expect(draft.scope).toEqual([LOC15]);
  });
});

/* =============================================================================
   A PACKAGE WITH NOTHING BOOKED TAKES NO CREATE EITHER (B5, row 57).

   Piedmont's three facilities are all at Final Review, so no credit action can
   run and the eligible set the room hands the grammar is EMPTY. The grammar
   still opened the create and asked "no facilities on this package. Which of
   them should this land on?" with the chip "All 0".
   ============================================================================= */

describe("nothing to version, so nothing to add", () => {
  const empty = ctxWith({ members: [] });

  it("names the party the banker typed and both ways forward, in one sentence", () => {
    const draft = openCreate("Add Brightwater Foods Group as Guarantor", empty)!;
    const said = noVersionRefusal(createSubject(draft));
    expect(said).toContain("Brightwater Foods Group as Guarantor");
    expect(said).toContain("nothing on this package is booked for me to version");
    expect(said).toContain("New facility on a new package");
    // One sentence, and no em dash in it.
    expect(said.match(/\./g)).toHaveLength(1);
    expect(said).not.toMatch(/—/);
  });

  it("says the covenant and the pledge back in their own words too", () => {
    const covenant = openCreate("add a minimum current ratio covenant of 2x tested quarterly", empty)!;
    expect(createSubject(covenant)).toBe("A Minimum Current Ratio covenant");
    const pledge = openCreate("pledge the accounts receivable", empty)!;
    expect(createSubject(pledge)).toBe("A pledge");
  });

  it("never offers an All chip over an empty set", () => {
    // The party create is the one that reaches the scope question with
    // everything else settled, which is exactly how "All 0" rendered.
    const draft = openCreate("Add Brightwater Foods Group as Guarantor", empty)!;
    const ask = nextAsk(draft, empty)!;
    expect(ask.text).toContain("Which of them should this land on?");
    expect(ask.options).toHaveLength(0);
  });

  it("still counts the All chip where there is something to count", () => {
    const draft = openCreate("add another covenant to all of the loans", ctxWith())!;
    expect(nextAsk(draft, ctxWith())!.options.map((o) => o.label)).toContain("All 6");
  });
});
