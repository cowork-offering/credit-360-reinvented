import { describe, expect, it } from "vitest";
import live from "../../artifact/live-data.json";
import type { C360Data, Facility, LegalEntity } from "./data/contract";
import { bookedFacilities } from "./data/facilityStage";
import { readRole, readTopic } from "./components/workroom/ask";
import { buildReadCard } from "./components/workroom/readCard";
import { parseAnswer, parseModify, partyNamed, type ParseContext } from "./workroom/parseModify";

/* =============================================================================
   PARTIES AND COLLATERAL IN THE FACILITY ROOM (founder, 0.9.22 preview;
   IMPROVEMENTS row 44, reproduced on the built bundle).

   Five lines about Hartwell's Non-Real-Estate package, and only the last of
   them worked:

     "show me all my collaterals"        -> "I could not match that ..."
     "who are the guarantors on this
      package"                           -> the desk, over a book that holds it
     "remove Elena from this loan"       -> nothing matched at all
     "remove Elena Hartwell from this
      loan"                              -> read EVERY facility on the package
     "remove Elena Hartwell as guarantor
      from the 15M line of credit"       -> staged, correctly

   Everything here runs on the REAL book (`artifact/live-data.json`, borrower
   001bb00001I7FPNAA3): Elena Hartwell is Limited Guarantor on the $15M Line of
   Credit and the $12M Construction, James Hartwell guarantees eight loans,
   Hartwell Industrial Holdings LLC seven, and Hartwell Logistics LLC is a
   Related Entity on the Construction.
   ============================================================================= */

const data = live as unknown as C360Data;
const ACCOUNT = "001bb00001I7FPNAA3";
/** The Non-Real-Estate package, which is the one the founder was standing on. */
const PACKAGE = "a5Fbb000000IHFJEA4";
const LINE15 = "a4Zbb0000027MaYEAU";
const CONSTRUCTION = "a4Zbb0000027Mp3EAE";
const EQUIPMENT8 = "a4Zbb0000027MnREAU";

const bundle = data.borrowers![ACCOUNT];
const relationship = bundle.snapshot!.name!;
const members = (bundle.exposure?.facilities ?? []).filter((f: Facility) => f.productPackageId === PACKAGE);
const booked = bookedFacilities(bundle).filter((f) => members.some((m) => m.loanId === f.loanId));
const entities = (bundle.graph?.legalEntities ?? []).filter(
  (e: LegalEntity) => !e.packageId || e.packageId === PACKAGE,
);
const ctx: ParseContext = { facilities: members, booked, relationship, entities };
const reads = { bundle, accountName: relationship, productPackageId: PACKAGE };

const card = (line: string, loanIds?: string[]) => {
  const topic = readTopic(line);
  if (!topic) return null;
  return buildReadCard(topic, reads, { role: readRole(line) ?? undefined, loanIds });
};

/* ------------------------------------------------------------ 1. collateral */

describe("a read that says collateral, however the banker spells it", () => {
  const SAID = [
    "show me all my collaterals",
    "show my full collaterals",
    "show me the collateral",
    "what collateral do we hold",
    "list the pledges",
    "what secures this",
    "what are the assets on this package",
    "show me the security",
  ];

  it.each(SAID)("reads %j as the collateral card", (line) => {
    expect(readTopic(line)).toBe("collateral");
    expect(card(line)?.topic).toBe("collateral");
  });

  it("answers the founder's own line from the package, not with a refusal", () => {
    const built = card("show me all my collaterals");
    expect(built?.lede).toContain("8 pledges are recorded against this package");
    // Every facility on the package that carries a pledge is a group of its own.
    expect(built?.groups.map((g) => g.heading)).toContain("Line of Credit");
    expect(built?.groups.flatMap((g) => g.rows).length).toBe(8);
  });

  it("narrows to one facility where the question names one", () => {
    const built = card("show me the pledges on this loan", [LINE15]);
    expect(built?.lede).toContain("recorded against the Line of Credit ($15M)");
    expect(built?.groups.flatMap((g) => g.rows).length).toBe(2);
  });

  it("still answers the package where the named facility carries no pledge", () => {
    const built = card("show me the pledges on this loan", ["a4Zbb000000NOTHING"]);
    expect(built?.lede).toContain("against this package");
  });
});

/* ------------------------------------------------------------- 2. structure */

describe("a read about who is on the deal", () => {
  const SAID = [
    "who are the guarantors on this package",
    "which entities are on the $15M line of credit",
    "who guarantees the construction loan",
    "what is the borrowing structure",
    "list the parties on this package",
    "which borrowers are on this package",
    "who is on this deal",
    "any guaranties?",
    "who are the co-borrowers",
  ];

  it.each(SAID)("reads %j as the structure card", (line) => {
    expect(readTopic(line)).toBe("structure");
  });

  it("answers the guarantor question from the book, with the role the org wrote", () => {
    const built = card("who are the guarantors on this package");
    expect(built?.topic).toBe("structure");
    expect(built?.lede).toContain("3 guarantors are on this package");
    const rows = built!.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => `${r.label} · ${r.value}`)).toEqual(
      expect.arrayContaining([
        "Hartwell Industrial Holdings LLC · Guarantor",
        "James Hartwell · Guarantor",
        "Elena Hartwell · Limited Guarantor",
      ]),
    );
  });

  it("narrows to the facility the question names, with every role on it", () => {
    const built = card("which entities are on the $15M line of credit", [LINE15]);
    expect(built?.lede).toContain("the Line of Credit ($15M)");
    const rows = built!.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => `${r.label} · ${r.value}`).sort()).toEqual([
      "Elena Hartwell · Limited Guarantor",
      "Hartwell Industrial Holdings LLC · Guarantor",
      "Hartwell Precision Manufacturing LLC · Borrower",
      "James Hartwell · Guarantor",
    ]);
  });

  it("answers from the relationship where no involvement row names a member of this package", () => {
    // A room standing IN a version: the facilities are clones with ids of their
    // own, so every involvement row names a loan the package does not hold.
    const clone = {
      ...bundle,
      exposure: {
        ...bundle.exposure!,
        facilities: members.map((f) => ({ ...f, loanId: `${f.loanId}CLONE`, productPackageId: "a5Fbb0000009TESTV1" })),
      },
    };
    const built = buildReadCard("structure", {
      bundle: clone,
      accountName: relationship,
      productPackageId: "a5Fbb0000009TESTV1",
    });
    expect(built).not.toBeNull();
    expect(built!.lede).toContain("on this relationship");
    expect(built!.groups[0].heading).toBe("On this relationship's facilities");
  });
});

/* ------------------------------------------------- 3. the party, named short */

describe("a party named the way a banker names one", () => {
  it("resolves a first name to the one entity it fits", () => {
    expect(partyNamed("remove Elena from this loan", ctx)).toEqual({ kind: "one", name: "Elena Hartwell" });
    expect(partyNamed("add James as guarantor on the 15M line", ctx)).toEqual({ kind: "one", name: "James Hartwell" });
  });

  it("resolves a company's own word, and never a word it merely shares", () => {
    expect(partyNamed("remove Logistics from the construction loan", ctx)).toEqual({
      kind: "one",
      name: "Hartwell Logistics LLC",
    });
    // "Precision" is the borrower's word too, and this is a name the deal does
    // not carry: an add of a new guarantor must keep the banker's own spelling.
    expect(partyNamed("add Vertex Precision LLC as a guarantor", ctx)).toEqual({
      kind: "none",
      said: "Vertex Precision LLC",
    });
  });

  it("asks which where the word fits more than one", () => {
    const out = partyNamed("remove Hartwell from this loan", ctx);
    expect(out.kind).toBe("many");
    if (out.kind !== "many") return;
    expect(out.names).toEqual([
      "Elena Hartwell",
      "Hartwell Industrial Holdings LLC",
      "Hartwell Logistics LLC",
      "Hartwell Precision Manufacturing LLC",
      "James Hartwell",
    ]);
  });

  it("stages the removal off a first name alone, once the loan is settled", () => {
    const asked = parseModify("remove Elena from this loan", ctx);
    expect(asked.kind).toBe("clarify");
    if (asked.kind !== "clarify") return;
    expect(asked.question).toContain("Elena Hartwell is on 2 of these facilities");
    expect(asked.options).toEqual(["Line of Credit $15M", "Construction $12M"]);

    const answered = parseAnswer(asked.awaiting!, "Line of Credit $15M", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0]).toMatchObject({ party: "Elena Hartwell", op: "remove" });
    expect(answered.amendments[0].facility?.loanId).toBe(LINE15);
  });

  it("asks by name, with chips, where the word fits two parties", () => {
    const out = parseModify("remove Hartwell from this loan", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toContain("5 parties on this package answer to that");
    expect(out.options).toContain("Elena Hartwell");
    // And the name answered to it resolves the rest of the line.
    const answered = parseAnswer(out.awaiting!, "Elena Hartwell", ctx);
    if (answered?.kind !== "clarify") throw new Error(String(answered?.kind));
    expect(answered.options).toEqual(["Line of Credit $15M", "Construction $12M"]);
  });

  it("says who IS on the package where a shorthand fits nobody", () => {
    const out = parseModify("remove Sandra from this loan", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toContain("I could not match Sandra to a party on this package's borrowing structure");
    expect(out.question).toContain("Elena Hartwell as Limited Guarantor");
    expect(out.options).toContain("James Hartwell");
  });
});

/* ------------------------------------------------- 4. which loan she is on */

describe("a removal with no member in focus", () => {
  it("asks which of the loans the party is actually on, one chip each", () => {
    const out = parseModify("remove Elena Hartwell from this loan", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    // Never the whole package: she is on two of its seven facilities.
    expect(out.question).toBe(
      "Elena Hartwell is on 2 of these facilities: the Line of Credit $15M as Limited Guarantor and the Construction $12M as Limited Guarantor. Which one should come off?",
    );
    expect(out.options).toEqual(["Line of Credit $15M", "Construction $12M"]);
    expect(out.awaiting?.member?.choices.map((f) => f.loanId)).toEqual([LINE15, CONSTRUCTION]);
  });

  it("stages it outright where the party is on exactly one of them", () => {
    const out = parseModify("remove Logistics from this loan", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0]).toMatchObject({ party: "Hartwell Logistics LLC", op: "remove" });
    expect(out.amendments[0].facility?.loanId).toBe(CONSTRUCTION);
  });

  /* THE DRIVE'S OWN TURN 6 (workroom-e2e founderParties, 0.9.23): the banker
     restates the instruction with the full name rather than picking, and the
     room used to answer with the identical sentence. */
  it("narrows the ask rather than repeating it when the line is said again", () => {
    const asked = parseModify("remove Elena from this loan", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const again = parseAnswer(asked.awaiting!, "remove Elena Hartwell from this loan", ctx);
    if (again?.kind !== "clarify") throw new Error(String(again?.kind));
    expect(again.question).not.toBe(asked.question);
    expect(again.question).toContain("the facility is still what is open");
    expect(again.options).toEqual(["Line of Credit $15M", "Construction $12M"]);
    // And the narrowed ask is still answerable by a chip.
    const answered = parseAnswer(again.awaiting!, "Line of Credit $15M", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].facility?.loanId).toBe(LINE15);
  });

  it("re-reads the line against the loan the banker picks", () => {
    const asked = parseModify("remove Elena Hartwell from this loan", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const answered = parseAnswer(asked.awaiting!, "Construction $12M", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].facility?.loanId).toBe(CONSTRUCTION);
    expect(answered.amendments[0]).toMatchObject({ party: "Elena Hartwell", op: "remove" });
  });
});

/* ----------------------------------------- 5. the line that always worked */

describe("a removal that names the role and the member", () => {
  it("still stages on the member the line names, and on that one alone", () => {
    const out = parseModify("remove Elena Hartwell as guarantor from the 15M line of credit", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0]).toMatchObject({ party: "Elena Hartwell", op: "remove" });
    expect(out.amendments[0].facility?.loanId).toBe(LINE15);
  });

  it("refuses by name where the party is not on the facility the line names", () => {
    const out = parseModify("remove Elena Hartwell from the 8M equipment", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toContain("Elena Hartwell is not on the Equipment $8M today");
    expect(out.question).toContain("the Line of Credit $15M as Limited Guarantor");
    expect(out.options).toEqual(["Line of Credit $15M", "Construction $12M"]);
    expect(EQUIPMENT8).toBe("a4Zbb0000027MnREAU");
  });

  it("takes an add on a first name, on the facility the figure names", () => {
    const out = parseModify("add James as guarantor on the 15M line", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0]).toMatchObject({ party: "James Hartwell", role: "Guarantor", op: "add" });
    expect(out.amendments[0].facility?.loanId).toBe(LINE15);
  });
});
