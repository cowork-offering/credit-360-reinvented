import { describe, expect, it } from "vitest";
import { buildReadCard, planReadCard, readGap, type ReadSource } from "./readCard";
import type { BorrowerBundle, C360Data } from "../../data/contract";
import live from "../../../../artifact/live-data.json";
import sample from "../../../../artifact/sample-data.json";

/* =============================================================================
   THE READ CARDS, OVER EVERY STAGED RELATIONSHIP.

   Founder rule (2026-07-27): a surface that renders correctly for one
   relationship and wrongly for another is a failed round item. A read card is
   built from whatever the bundle holds, so it is proved against every borrower
   in every staged file rather than against Hartwell's six facilities.

   THE INVARIANT UNDER ALL OF IT: a card either has rows or it does not exist.
   An empty card is the frame of an answer with no answer in it, and `readGap`
   is what the room says instead.
   ============================================================================= */

const FILES: Array<[string, C360Data]> = [
  ["live-data.json", live as unknown as C360Data],
  ["sample-data.json", sample as unknown as C360Data],
];

const everyBorrower: Array<[string, string, BorrowerBundle]> = FILES.flatMap(([file, data]) =>
  Object.entries(data.borrowers ?? {}).map(
    ([id, b]) => [file, (b as BorrowerBundle).snapshot?.name ?? id, b as BorrowerBundle] as [string, string, BorrowerBundle],
  ),
);

const srcFor = (bundle: BorrowerBundle, name: string): ReadSource => ({
  bundle,
  accountName: name,
  productPackageId: null,
});

describe("a read card is never an empty frame", () => {
  it("has borrowers to check", () => {
    expect(everyBorrower.length).toBeGreaterThanOrEqual(5);
  });

  for (const [file, name, bundle] of everyBorrower) {
    for (const topic of ["structure", "covenants", "collateral", "facilities", "fees"] as const) {
      it(`${name} (${file}) · ${topic}: rows or nothing, never a frame`, () => {
        const card = buildReadCard(topic, srcFor(bundle, name));
        if (!card) {
          // The honest alternative has to say something, and it has to say it
          // in words a banker reads rather than in an empty card.
          expect(readGap(topic, name).length).toBeGreaterThan(20);
          return;
        }
        expect(card.groups.length).toBeGreaterThan(0);
        for (const g of card.groups) expect(g.rows.length).toBeGreaterThan(0);
        expect(card.lede.length).toBeGreaterThan(0);
        expect(card.followUp.length).toBeGreaterThan(0);
        // House style, everywhere in UI copy.
        expect(card.lede).not.toContain("—");
        expect(card.followUp).not.toContain("—");
      });
    }
  }
});

describe("the borrowers card the founder asked for", () => {
  const data = live as unknown as C360Data;
  const accountId = "001bb00001I7FPNAA3";
  const bundle = data.borrowers![accountId];
  const name = bundle.snapshot!.name!;

  it("answers from the involvements the bundle was already holding", () => {
    const card = buildReadCard("structure", srcFor(bundle, name))!;
    expect(card).toBeTruthy();
    const rows = card.groups.flatMap((g) => g.rows);
    expect(rows.length).toBeGreaterThan(0);
    // ROLE-GROUPED PER FACILITY: the heading names the facility, the row names
    // the party and the role it holds ON THAT FACILITY. A flat list of names
    // loses exactly the fact the question was asking about.
    for (const row of rows) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.value.length).toBeGreaterThan(0);
    }
    expect(card.followUp).toMatch(/which facility/i);
  });

  it("answers the covenants question with thresholds and the org's own verdicts", () => {
    const card = buildReadCard("covenants", srcFor(bundle, name))!;
    expect(card).toBeTruthy();
    const rows = card.groups.flatMap((g) => g.rows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.detail).toMatch(/threshold/);
      // The verdict is the org's own, read through the same classifier the
      // covenants tab renders - never a word this card made up.
      expect(row.value.length).toBeGreaterThan(0);
      expect(row.icon).toBe("covenant");
    }
    expect(card.followUp).toMatch(/threshold/i);
  });

  it("groups an account-level covenant apart from the ones attached to a facility", () => {
    const card = buildReadCard("covenants", srcFor(bundle, name))!;
    // An empty `attachedLoans` is a FACT (account level); absent is a read that
    // does not carry the field. Both land in the relationship-wide group rather
    // than being silently hung off a facility.
    const headings = card.groups.map((g) => g.heading);
    expect(headings).toContain("Across the relationship");
  });

  it("scopes to the package the room is anchored on", () => {
    const wide = buildReadCard("facilities", srcFor(bundle, name))!;
    const anchored = buildReadCard("facilities", {
      bundle,
      accountName: name,
      productPackageId: "no-such-package",
    });
    expect(wide.groups.flatMap((g) => g.rows).length).toBeGreaterThan(0);
    // Nothing belongs to a package that does not exist, so there is no card.
    expect(anchored).toBeNull();
  });
});

describe("fees are a gap in the read, and the room says so", () => {
  const data = live as unknown as C360Data;
  const bundle = data.borrowers!["001bb00001I7FPNAA3"];

  it("never lists fees, because no read tool carries them", () => {
    // "No fees" would be a claim nothing on this cockpit supports. The room
    // refuses to make it and offers the half of the answer it can honour.
    expect(buildReadCard("fees", srcFor(bundle, "Hartwell"))).toBeNull();
    const gap = readGap("fees", "Hartwell");
    expect(gap).toMatch(/cannot list them/i);
    expect(gap).toMatch(/percentage of the commitment|flat amount/i);
  });
});

/* =============================================================================
   THE STRUCTURE CARD, NARROWED BY THE QUESTION (E7, drive 2026-09-01; the
   22-row book, 2026-09-02).

   "Any guarantors?" is a question about a ROLE, and a card that answers it with
   the borrowers as well has not answered it. Both `Guarantor` and `Limited
   Guarantor` are guarantors: a limited guaranty is a guaranty with a cap on it.

   AND THE ORG STORES ONE ROW PER LOAN. The refreshed read carries 22 rows for 5
   parties: listed raw, the card said the same guarantor six times. One row per
   party per role, carrying the facilities behind it, is the same fact said
   once. The question narrows the FACILITIES too: "who guarantees the
   construction loan" is a question about one loan.
   ============================================================================= */

const HARTWELL = (live as unknown as C360Data).borrowers!["001bb00001I7FPNAA3"] as BorrowerBundle;

/** The loans the pinned read carries, by the product word a banker would say. */
const LOC_15M = "a4Zbb0000027MaYEAU";
const CONSTRUCTION = "a4Zbb0000027Mp3EAE";

/**
 * A BORROWER-ONLY BOOK, which the real read no longer is.
 *
 * The pinned book carried six identical Borrower rows and nothing else when the
 * "no guaranty rows" branch was written; it now carries 14 guaranty rows across
 * three guarantors. The branch is still the right behaviour and still needs
 * proving, so it is proved against a book shaped the way that one was.
 */
const borrowersOnly: BorrowerBundle = {
  ...HARTWELL,
  graph: {
    ...HARTWELL.graph,
    legalEntities: (HARTWELL.graph?.legalEntities ?? []).filter((e) => (e.borrowerType ?? "") === "Borrower"),
  },
};

describe("a question about guarantors is answered with the guarantors", () => {
  const src = (bundle: BorrowerBundle): ReadSource => ({
    bundle,
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: null,
  });

  it("keeps the limited guarantor in the answer, on the loan the question named", () => {
    // The $15M line carries two unlimited guarantors and one limited one. Each
    // of them is ONE row: the org writes the guaranty once per loan and the
    // question is about one loan.
    const card = buildReadCard("structure", src(HARTWELL), { role: "guarantor", loanIds: [LOC_15M] })!;
    const rows = card.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.label)).toEqual(["Hartwell Industrial Holdings LLC", "James Hartwell", "Elena Hartwell"]);
    expect(rows.map((r) => r.value)).toEqual(["Guarantor", "Guarantor", "Limited Guarantor"]);
    // The heading names the loan, and the lede counts guarantors rather than
    // the org's rows: "14 guaranty rows" is a sentence about storage.
    expect(card.groups.map((g) => g.heading)).toEqual(["Line of Credit ($15M)"]);
    expect(card.lede).toContain("3 guarantors are on the Line of Credit ($15M) today");
    expect(card.lede).toContain("Limited guarantors are guarantors");
  });

  it("answers a guarantor question about another loan with that loan's parties", () => {
    // Elena is a limited guarantor on the Construction loan and the $15M line
    // and on nothing else, so the two loans give two different answers.
    const construction = buildReadCard("structure", src(HARTWELL), { role: "guarantor", loanIds: [CONSTRUCTION] })!;
    expect(construction.groups.flatMap((g) => g.rows).map((r) => r.label)).toEqual([
      "Hartwell Industrial Holdings LLC",
      "James Hartwell",
      "Elena Hartwell",
    ]);
    const equipment = buildReadCard("structure", src(HARTWELL), { role: "guarantor", loanIds: ["a4Zbb0000027MnREAU"] })!;
    expect(equipment.groups.flatMap((g) => g.rows).map((r) => r.label)).toEqual([
      "Hartwell Industrial Holdings LLC",
      "James Hartwell",
    ]);
  });

  it("answers an unqualified guarantor question once per guarantor, with the facility count", () => {
    const card = buildReadCard("structure", src(HARTWELL), { role: "guarantor" })!;
    const rows = card.groups.flatMap((g) => g.rows);
    // 14 guaranty ROWS in the org, three guarantors on the credit.
    expect(rows.map((r) => r.label)).toEqual([
      "Hartwell Industrial Holdings LLC",
      "James Hartwell",
      "Elena Hartwell",
    ]);
    expect(rows[0].detail).toContain("on 6 facilities");
    expect(rows[2].detail).toContain("on 2 facilities");
    expect(card.lede).toContain("3 guarantors are on this package today");
    expect(card.lede).not.toContain("14");
  });

  /* D1, the three-book drive matrix (2026-09-13). "each once" is a promise about
     a LIST, and a list of one has nothing to promise: on Kingsley, whose credit
     carries a single personal guaranty, the card read "1 guarantor is on this
     package today, each once with the role the org wrote". The claim the
     sentence exists for is the ROLE, and that half is said either way. */
  it("drops 'each once' where there is only one of them to count", () => {
    const oneGuarantor: BorrowerBundle = {
      ...HARTWELL,
      graph: {
        ...HARTWELL.graph,
        legalEntities: (HARTWELL.graph?.legalEntities ?? []).filter((e) => e.accountName === "Elena Hartwell"),
      },
    };
    const card = buildReadCard("structure", src(oneGuarantor), { role: "guarantor" })!;
    expect(card.lede).toContain("1 guarantor is on");
    expect(card.lede).not.toContain("each once");
    expect(card.lede).toContain("with the role the org wrote");

    const parties = buildReadCard("structure", src(oneGuarantor))!;
    expect(parties.lede).toContain("1 party is on");
    expect(parties.lede).not.toContain("each once");
    expect(parties.lede).toContain("with the role it holds");
  });

  it("keeps 'each once' where the card really is deduplicating rows", () => {
    const card = buildReadCard("structure", src(HARTWELL), { role: "guarantor" })!;
    expect(card.lede).toContain("3 guarantors are on this package today, each once with the role the org wrote");
    expect(buildReadCard("structure", src(HARTWELL))!.lede).toContain("today, each once, with the role it holds");
  });

  it("says so, and shows the whole structure, where the read carries no guaranty row", () => {
    // A book of BORROWER rows only. An empty card under a "Guarantors" heading
    // is the frame of an answer with no answer in it; this names the gap and
    // shows what the read does carry.
    const card = buildReadCard("structure", src(borrowersOnly), { role: "guarantor" })!;
    expect(card.lede).toContain("no guaranty rows");
    expect(card.groups.flatMap((g) => g.rows).length).toBeGreaterThan(0);
  });

  it("answers an unqualified structure question with every party, once each", () => {
    const card = buildReadCard("structure", src(HARTWELL))!;
    const rows = card.groups.flatMap((g) => g.rows);
    const names = (HARTWELL.graph?.legalEntities ?? []).map((e) => e.accountName);
    // 22 org rows, 5 parties, 5 lines.
    expect(new Set(names).size).toBe(5);
    expect(rows.map((r) => r.label)).toEqual([...new Set(names)]);
    expect(rows.map((r) => r.value)).toEqual(["Borrower", "Guarantor", "Guarantor", "Limited Guarantor", "Related Entity"]);
    expect(card.lede).toContain("5 parties are on this package today");
  });

  it("carries the facility count across the whole relationship, unscoped", () => {
    // Hartwell's org grew a second package (2026-09-03): the borrower's graph
    // rows now span nine loans across both, and with no package anchored the
    // card stands on the whole relationship, not on "the" package.
    const card = buildReadCard("structure", src(HARTWELL))!;
    const borrower = card.groups.flatMap((g) => g.rows).find((r) => r.value === "Borrower")!;
    expect(new Set((HARTWELL.graph?.legalEntities ?? []).filter((e) => e.borrowerType === "Borrower").map((e) => e.loanId)).size).toBe(9);
    expect(borrower.detail).toContain("on 9 facilities");
  });

  it("carries the facility count and drops a loan the package does not hold (single-package fixture)", () => {
    // The graph-vs-exposure split this test proves no longer shows on live
    // Hartwell: with two packages its exposure read now carries all nine
    // facilities, proposal included, so nothing is dropped any more. Proved
    // instead on a synthetic single-package slice of the same bundle: the six
    // ORIGINALLY-booked C&I facilities in exposure, with the graph's Borrower
    // rows still carrying the seventh, Proposal-stage loan the package holds
    // but exposure does not book.
    const CNI_PACKAGE = "a5Fbb000000IHFJEA4";
    const cniLoanIds = new Set(
      (HARTWELL.exposure?.facilities ?? []).filter((f) => f.productPackageId === CNI_PACKAGE).map((f) => f.loanId),
    );
    expect(cniLoanIds.size).toBe(7); // six booked + the Proposal-stage equipment loan
    const singlePackage: BorrowerBundle = {
      ...HARTWELL,
      exposure: {
        ...HARTWELL.exposure,
        facilities: (HARTWELL.exposure?.facilities ?? []).filter(
          (f) => f.productPackageId === CNI_PACKAGE && f.stage !== "Proposal",
        ),
      },
      graph: {
        ...HARTWELL.graph,
        legalEntities: (HARTWELL.graph?.legalEntities ?? []).filter(
          (e) => e.borrowerType !== "Borrower" || cniLoanIds.has(e.loanId ?? undefined),
        ),
      },
    };
    const card = buildReadCard("structure", src(singlePackage))!;
    const borrower = card.groups.flatMap((g) => g.rows).find((r) => r.value === "Borrower")!;
    // The graph read carries the borrower on SEVEN loans; the exposure read
    // carries six facilities. The card stands on the package it is scoped to.
    expect(new Set((singlePackage.graph?.legalEntities ?? []).filter((e) => e.borrowerType === "Borrower").map((e) => e.loanId)).size).toBe(7);
    expect(borrower.detail).toContain("on 6 facilities");
  });
});

/* ================== "WHAT IS ON THE PLAN" IS ROWS, NOT A PARAGRAPH

   Founder drive 2026-09-02: the deterministic read-back printed fifteen entries
   as one semicolon-separated blob, and the model's remark under it then did the
   structuring the deterministic layer should have done.                       */

describe("the plan reads back as rows, grouped by facility", () => {
  const PLAN = [
    { title: "Commitment", target: "$15.0MM Line of Credit", before: "$15.0M", after: "$20.0M", group: "terms", member: "a1" },
    { title: "Leverage above policy", target: "$15.0MM Line of Credit", before: "not on the facility today", after: "logged as mitigated", group: "structure", member: "a1" },
    { title: "Kokomo plant expansion", target: "Construction", before: "not on the facility today", after: "created and pledged, $6,500,000.00 at 75% advance", group: "security", member: "a2" },
  ];

  it("puts one row under each facility, in landing order, and keeps the count line", () => {
    const card = planReadCard(PLAN, "The manifest holds 3 changes.", "What next?");
    expect(card.lede).toBe("The manifest holds 3 changes.");
    expect(card.groups.map((g) => g.heading)).toEqual(["$15.0MM Line of Credit", "Construction"]);
    expect(card.groups[0].rows.map((r) => r.label)).toEqual(["Commitment", "Leverage above policy"]);
    expect(card.groups[1].rows.map((r) => r.label)).toEqual(["Kokomo plant expansion"]);
  });

  it("carries the move in the entry's own words, before to after", () => {
    const card = planReadCard(PLAN, "The manifest holds 3 changes.", "What next?");
    expect(card.groups[0].rows[0].detail).toBe("$15.0M → $20.0M");
    expect(card.groups[1].rows[0].detail).toBe(
      "not on the facility today → created and pledged, $6,500,000.00 at 75% advance",
    );
  });

  it("never runs the entries together into one line", () => {
    const card = planReadCard(PLAN, "The manifest holds 3 changes.", "What next?");
    const rows = card.groups.flatMap((g) => g.rows);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.label).not.toContain(";");
  });

  it("groups an entry that hangs off no facility under the relationship", () => {
    const card = planReadCard(
      [{ title: "A thing", target: "", before: "a", after: "b", group: "covenants" }],
      "The manifest holds 1 change.",
      "What next?",
    );
    expect(card.groups[0].heading).toBe("Across the relationship");
  });
});
