import { describe, expect, it } from "vitest";
import type { Facility, LegalEntity } from "../data/contract";
import { catalogField } from "./fieldCatalog";
import { parseAnswer, parseModify, type ParseContext } from "./parseModify";

/* =============================================================================
   THE DETERMINISTIC PARSE, AND ITS REFUSALS.

   The interesting cases here are the ones where a parser is tempted to invent:
   a bare number, a spread, a month with no day. Each has to come back as a
   question, because a chip the banker did not mean is worse than one that never
   arrived — and every one of those chips is a figure that would reach the org.
   ============================================================================= */

/* THE REAL HARTWELL PACKAGE, read live from bankinggpt 2026-08-27
   (a5Fbb000000IHFJEA4, seven members). The org calls the $15MM member a
   "Line of Credit"; the word "revolver" appears nowhere in the data, which is
   exactly why the parser carries the vocabulary and the data does not. */

const line15: Facility = {
  loanId: "a4Zbb0000027MaYEAU",
  name: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
  productType: "Line of Credit",
  productPackageId: "a5Fbb000000IHFJEA4",
  stage: "Booked",
  status: "Active",
  committed: 15_000_000,
  outstanding: 9_200_000,
  interestRate: 7.6,
  maturityDate: "2027-03-15",
  // The two Hartwell assets this member secures, described the way the read
  // carries them. They share a word on purpose: a pledge resolves on the org's
  // own record, so a phrase fitting both has to be a question.
  collateral: [
    { loanId: "a4Zbb0000027MaYEAU", collateralId: "a35bb0000013xz3AAA", collateralName: "COL-000762", collateralDescription: "Duluth warehouse" },
    { loanId: "a4Zbb0000027MaYEAU", collateralId: "a35bb0000013y0fAAA", collateralName: "COL-000763", collateralDescription: "Duluth machine shop" },
  ],
};

const line25: Facility = {
  loanId: "a4Zbb0000027MttEAE",
  name: "Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00",
  productType: "Line of Credit",
  productPackageId: "a5Fbb000000IHFJEA4",
  stage: "Booked",
  status: "Active",
  committed: 2_500_000,
  // Priced, like every booked member of this package: a rate move that names
  // the product has two real rates to land on, not one.
  interestRate: 6.83,
  maturityDate: "2026-06-30",
};

const equipment: Facility = {
  loanId: "a4Zbb0000027MnREAU",
  name: "Hartwell Precision Manufacturing LLC - Equipment - $8,000,000.00",
  productType: "Equipment",
  productPackageId: "a5Fbb000000IHFJEA4",
  stage: "Booked",
  status: "Active",
  committed: 8_000_000,
  maturityDate: "2028-01-31",
};

/** The showcase member. Proposal stage: never a modification target. */
const proposal: Facility = {
  loanId: "a4Zbb000002CECXEA4",
  name: "Hartwell Precision Manufacturing LLC - Equipment - $3,000,000.00",
  productType: "Equipment",
  productPackageId: "a5Fbb000000IHFJEA4",
  stage: "Proposal",
  status: "Active",
  committed: 3_000_000,
};

const entities: LegalEntity[] = [
  { accountName: "Hartwell Industrial Holdings LLC", borrowerType: "Guarantor" },
  { accountName: "Elena Hartwell", borrowerType: "Limited Guarantor" },
];

const ctx: ParseContext = {
  facilities: [line15, line25, equipment, proposal],
  booked: [line15, line25, equipment],
  relationship: "Hartwell Precision Manufacturing LLC",
  entities,
};

/** One facility on the package: the member never has to be named. */
const single: ParseContext = { ...ctx, facilities: [line15], booked: [line15] };

describe("the deterministic parse", () => {
  it("reads a commitment increase onto the member it names", () => {
    const out = parseModify("increase the line of credit - $15,000,000.00 to $20,000,000", ctx);
    expect(out.kind).toBe("amendments");
    if (out.kind !== "amendments") return;
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0].field.id).toBe("loan.amount");
    expect(out.amendments[0].facility?.loanId).toBe(line15.loanId);
    expect(out.amendments[0].value).toEqual({ kind: "currency", amount: 20_000_000, text: "$20,000,000" });
  });

  it("takes the figure after the LAST 'to', so 'from 15 to 20 million' is twenty", () => {
    const out = parseModify("take the revolver from $15,000,000 to 20 million", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].value).toMatchObject({ kind: "currency", amount: 20_000_000 });
  });

  it("REFUSES a bare number rather than reading it as millions", () => {
    const out = parseModify("increase the commitment to 20", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/in full/i);
  });

  it("REFUSES a spread, because the field the tool writes is an absolute rate", () => {
    const out = parseModify("move the rate to SOFR+300", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/absolute rate/i);
  });

  it("reads basis points as a percentage", () => {
    const out = parseModify("price the revolver at 810 bps", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].value).toMatchObject({ kind: "percent", rate: 8.1 });
  });

  it("REFUSES a month with no day, because a maturity is a day", () => {
    const out = parseModify("push the maturity to March 2028", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/names a month/i);
  });

  it("reads a written date in either order", () => {
    for (const line of ["move the maturity to 2028-03-15", "move the maturity to 15 March 2028", "move the maturity to March 15, 2028"]) {
      const out = parseModify(line, single);
      if (out.kind !== "amendments") throw new Error(`${line}: ${out.kind}`);
      expect(out.amendments[0].value).toMatchObject({ kind: "date", iso: "2028-03-15" });
    }
  });

  it("DERIVES an extension from the member's own maturity, and refuses when there is none", () => {
    const out = parseModify("extend the maturity by 18 months", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    // 2027-03-15 + 18 months.
    expect(out.amendments[0].value).toMatchObject({ kind: "date", iso: "2028-09-15" });

    const blind = parseModify("extend the maturity by 18 months", {
      ...single,
      facilities: [{ ...line15, maturityDate: undefined }],
      booked: [{ ...line15, maturityDate: undefined }],
    });
    expect(blind.kind).toBe("clarify");
  });

  it("reads a term in years as months", () => {
    const out = parseModify("give the revolver a 5 year term", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].value).toMatchObject({ kind: "months", months: 60 });
  });

  it("ASKS WHICH MEMBER when the package has several and the line names none", () => {
    const out = parseModify("increase the commitment to $20,000,000", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/which member/i);
  });

  it("spreads a product word across every BOOKED member of that product", () => {
    const out = parseModify("take the equipment facilities to $9,000,000", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    // Two Equipment members are booked; the Proposal one is not swept up.
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0].facility?.loanId).toBe(equipment.loanId);
  });

  it("maps the banker's word onto the ORG's product, and asks when two share it", () => {
    // The org calls it a Line of Credit; the banker says revolver, and this
    // package has two of them.
    const out = parseModify("increase the revolver to $20,000,000", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/Line of Credit - \$15,000,000\.00/);
    expect(out.question).toMatch(/Line of Credit - \$2,500,000\.00/);
  });

  it("NEVER targets a member that is not booked, and says why", () => {
    const out = parseModify("increase the equipment - $3,000,000.00 to $4,000,000", ctx);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/at Proposal/);
    expect(out.question).toMatch(/only runs against a booked facility/);
  });

  it("reads a mapped covenant with a threshold as a FILEABLE covenant value", () => {
    const out = parseModify("add a leverage covenant max 3.5x", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const a = out.amendments[0];
    expect(a.field.id).toBe("covenant.add");
    expect(a.value?.kind).toBe("covenant");
    if (a.value?.kind !== "covenant") return;
    expect(a.value.typeName).toBe("Leverage");
    expect(a.value.threshold).toBe(3.5);
    expect(a.value.operator).toBe("<=");
  });

  it("asks for the threshold when a mapped covenant arrives without one", () => {
    const out = parseModify("add a leverage covenant", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/threshold/i);
    expect(out.question).toMatch(/Leverage/);
  });

  it("reads an out-of-scope amendment as an amendment, not as a failure", () => {
    const out = parseModify("add a collateral insurance covenant", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].field.id).toBe("covenant.add");
    expect(out.amendments[0].field.wireKey).toBeUndefined();
  });

  it("reads a picklist as the ORG's own value, not as the banker's word for it", () => {
    const out = parseModify("change the payment schedule to monthly", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const schedule = out.amendments.find((a) => a.field.id === "loan.paymentSchedule")!;
    expect(schedule.field.dynamicField).toBe("LLC_BI__Payment_Schedule__c");
    // The banker said "monthly" in lower case; what travels is the value the org
    // holds, because the org validates against its own active values.
    expect(schedule.value).toEqual({ kind: "text", text: "Monthly" });
  });

  it("REFUSES a picklist value this org does not hold, and names every one it does", () => {
    const out = parseModify("change the payment schedule to fortnightly", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/The org offers/);
    expect(out.question).toMatch(/Bi-Monthly/);
    // Never the banker's word back as though it were legal.
    expect(out.question).not.toMatch(/fortnightly/i);
  });

  it("resolves a party already on the deal, and keeps an unknown name verbatim", () => {
    const known = parseModify("remove Elena Hartwell from the guaranty", single);
    if (known.kind !== "amendments") throw new Error(known.kind);
    expect(known.amendments.some((a) => a.party === "Elena Hartwell")).toBe(true);

    const fresh = parseModify("add Hartwell Logistics LLC as a guarantor", single);
    if (fresh.kind !== "amendments") throw new Error(fresh.kind);
    expect(fresh.amendments.some((a) => a.party === "Hartwell Logistics LLC")).toBe(true);
  });

  it("ASKS WHO when a party amendment names a role and nobody", () => {
    const out = parseModify("add a guarantor", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/which entity/i);
  });

  it("reads a fee ask (founder directive), and never as a commitment", () => {
    const out = parseModify("add a $50,000 arrangement fee", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].field.category).toBe("fee");
  });

  it("resolves a percentage fee into the org's own fee type, with no amount beside it", () => {
    const out = parseModify("add a 1% origination fee", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const value = out.amendments[0].value;
    if (value?.kind !== "fee") throw new Error(String(value?.kind));
    expect(value.feeType).toBe("Loan Origination");
    expect(value.calculationType).toBe("Percentage");
    expect(value.percentage).toBe(1);
    // The org's FeeTrigger derives the money; a figure here would contradict it.
    expect(value.amount).toBeUndefined();
    expect(value.recordType).toBe("Fees");
  });

  it("resolves a flat fee into an amount, and reads basis points as a percentage", () => {
    const flat = parseModify("add a $5,000 attorney fee", single);
    if (flat.kind !== "amendments") throw new Error(flat.kind);
    const flatValue = flat.amendments[0].value;
    if (flatValue?.kind !== "fee") throw new Error(String(flatValue?.kind));
    expect(flatValue).toMatchObject({ feeType: "Attorney", calculationType: "Flat Amount", amount: 5000 });

    const bps = parseModify("add a 25bps unused fee", single);
    if (bps.kind !== "amendments") throw new Error(bps.kind);
    const bpsValue = bps.amendments[0].value;
    if (bpsValue?.kind !== "fee") throw new Error(String(bpsValue?.kind));
    // No commitment or unused value exists on this org's fee picklist.
    expect(bpsValue).toMatchObject({ feeType: "Other", calculationType: "Percentage", percentage: 0.25 });
  });

  it("classes a third-party pass-through as a COST rather than fee income", () => {
    const out = parseModify("add a $12,500 appraisal fee", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const value = out.amendments[0].value;
    if (value?.kind !== "fee") throw new Error(String(value?.kind));
    expect(value).toMatchObject({ feeType: "Appraisal", recordType: "Costs" });
  });

  it("asks for the fee's KIND, and completes on the kind alone", () => {
    const asked = parseModify("add a 1% fee", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/what kind of fee/i);
    expect(asked.options).toContain("Origination fee");
    expect(asked.awaiting?.fee?.percentage).toBe(1);

    const answered = parseAnswer(asked.awaiting!, "origination fee", single);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].value).toMatchObject({ feeType: "Loan Origination", percentage: 1 });
  });

  it("asks HOW MUCH a fee is, and will not read a percentage and an amount as one fee", () => {
    const asked = parseModify("add an origination fee", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/how much is the origination fee/i);
    expect(asked.awaiting?.fee?.typeName).toBe("Loan Origination");

    const both = parseModify("add a 1% origination fee of $150,000", single);
    if (both.kind !== "clarify") throw new Error(both.kind);
    expect(both.question).toMatch(/1% or \$150,000\.00/);
    // Neither reading survives: keeping one would answer the question asked.
    expect(both.awaiting?.fee?.percentage).toBeUndefined();
    expect(both.awaiting?.fee?.amount).toBeUndefined();
  });

  /* ------------------------------------------------------------- the pledge */

  it("resolves an EXISTING asset off the deal's own pledges, and sends the org's record", () => {
    const out = parseModify("pledge the Duluth warehouse to the equipment", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].field.category).toBe("collateral");
    expect(out.amendments[0].facility?.loanId).toBe(equipment.loanId);
    const value = out.amendments[0].value;
    if (value?.kind !== "pledge") throw new Error(String(value?.kind));
    // The ID, never the name: the org resolves nothing on the banker's spelling.
    expect(value.collateralId).toBe("a35bb0000013xz3AAA");
    expect(value.create).toBeUndefined();
    expect(value.noun).toBe("Duluth warehouse");
  });

  it("asks WHICH ASSET when the words fit two of the deal's own, and never picks one", () => {
    const out = parseModify("pledge the Duluth asset to the equipment", ctx);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/2 assets that could be it/);
    expect(out.options).toEqual(["Duluth warehouse", "Duluth machine shop"]);

    const answered = parseAnswer(out.awaiting!, "Duluth machine shop", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].value).toMatchObject({ collateralId: "a35bb0000013y0fAAA" });
  });

  it("names the deal's own assets when it cannot find the one the line meant", () => {
    const out = parseModify("pledge the Mazak tooling to the line of credit - $15,000,000.00", single);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toContain("Duluth warehouse");
    expect(out.options).toContain("A new asset");
  });

  it("creates then pledges a NEW asset, asking for the kind, the value and the rate in turn", () => {
    // The founder's own line. Nothing in it says "pledge", which is why the
    // catalog carries "as collateral" as a verb of its own.
    const asked = parseModify("add a new $2M piece of equipment as collateral on the LoC", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    // The kind and the value are already read; only the rate is missing.
    expect(asked.question).toMatch(/advance rate/i);
    expect(asked.awaiting?.pledge).toMatchObject({ isNew: true, assetType: "Equipment", value: 2_000_000 });

    const done = parseAnswer(asked.awaiting!, "80%", single);
    if (done?.kind !== "amendments") throw new Error(String(done?.kind));
    const value = done.amendments[0].value;
    if (value?.kind !== "pledge") throw new Error(String(value?.kind));
    expect(value.collateralId).toBeUndefined();
    expect(value.create).toEqual({
      description: "New piece of equipment",
      collateralType: "Equipment",
      value: 2_000_000,
      advanceRate: 80,
    });
  });

  it("asks the KIND of a new asset before anything else, and holds that it is new", () => {
    const asked = parseModify("add a new asset as collateral on the line of credit - $15,000,000.00", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/what kind of asset/i);
    expect(asked.options).toContain("Equipment");

    // "Equipment" must NOT go back through the existing-asset resolver: `isNew`
    // survives the answer, which is the whole reason it is held.
    const worth = parseAnswer(asked.awaiting!, "Equipment", single);
    if (worth?.kind !== "clarify") throw new Error(String(worth?.kind));
    expect(worth.question).toMatch(/what is it worth/i);
    expect(worth.awaiting?.pledge).toMatchObject({ isNew: true, assetType: "Equipment" });

    const rate = parseAnswer(worth.awaiting!, "$2,000,000", single);
    if (rate?.kind !== "clarify") throw new Error(String(rate?.kind));
    expect(rate.question).toMatch(/advance rate/i);
    expect(rate.awaiting?.pledge?.value).toBe(2_000_000);
  });

  it("will not read the pledge's DESTINATION as the kind of asset", () => {
    // "to the equipment loan" is where the pledge lands, not what it is made of.
    const out = parseModify("pledge the Duluth warehouse to the equipment", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const value = out.amendments[0].value;
    if (value?.kind !== "pledge") throw new Error(String(value?.kind));
    expect(value.create).toBeUndefined();
  });

  /* --------------------------------------------------- the policy exception */

  it("reads the founder's own line into ONE exception: what, the decision, the mitigant", () => {
    const out = parseModify(
      "log a policy exception: advance rate above guideline on the equipment, mitigated by the personal guaranty",
      ctx,
    );
    if (out.kind !== "amendments") throw new Error(out.kind);
    // ONE ask, not three. "advance rate" is what is out of policy and "mitigated"
    // is this exception's own status; reading either as a second amendment would
    // stage two chips for one sentence.
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0].field.id).toBe("exception.record");
    expect(out.amendments[0].facility?.loanId).toBe(equipment.loanId);
    const value = out.amendments[0].value;
    if (value?.kind !== "policyException") throw new Error(String(value?.kind));
    expect(value.title).toBe("Advance rate above guideline");
    expect(value.status).toBe("Mitigated");
    expect(value.reasons).toEqual(["the personal guaranty"]);
    expect(value.severity).toBeUndefined();
  });

  it("keeps what the banker said BEFORE the exception verb as its own amendment", () => {
    const out = parseModify(
      "take the commitment to $20,000,000 and log a policy exception for the advance rate above guideline, unmitigated",
      single,
    );
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments.map((a) => a.field.id)).toEqual(["loan.amount", "exception.record"]);
    expect(out.amendments[0].value).toMatchObject({ kind: "currency", amount: 20_000_000 });
    expect(out.amendments[1].value).toMatchObject({ title: "Advance rate above guideline", status: "Unmitigated" });
  });

  it("asks for the DECISION rather than taking the org's Unmitigated default", () => {
    const asked = parseModify("log a policy exception: hold limit exceeded on the line of credit - $15,000,000.00", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/waived, mitigated, or standing unmitigated/i);
    expect(asked.options).toEqual(["Waived", "Mitigated", "Unmitigated"]);
    expect(asked.awaiting?.exception).toMatchObject({ title: "Hold limit exceeded" });

    const done = parseAnswer(asked.awaiting!, "Waived", ctx);
    if (done?.kind !== "amendments") throw new Error(String(done?.kind));
    expect(done.amendments[0].value).toMatchObject({ title: "Hold limit exceeded", status: "Waived", reasons: [] });
  });

  it("asks what mitigates it, then takes a BARE line as the mitigant and keeps the title", () => {
    const asked = parseModify("log a policy exception: leverage through the ceiling, mitigated", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/what mitigates it/i);
    expect(asked.awaiting?.exception).toMatchObject({ title: "Leverage through the ceiling", status: "Mitigated" });

    // "Mitigated" typed into the status question must never become the NAME of
    // the exception, and a bare line here is the mitigant rather than a new ask.
    const done = parseAnswer(asked.awaiting!, "sponsor support letter; unlimited personal guaranty", single);
    if (done?.kind !== "amendments") throw new Error(String(done?.kind));
    const value = done.amendments[0].value;
    if (value?.kind !== "policyException") throw new Error(String(value?.kind));
    expect(value.title).toBe("Leverage through the ceiling");
    expect(value.reasons).toEqual(["sponsor support letter", "unlimited personal guaranty"]);
  });

  it("REFUSES a mitigant longer than the org's field rather than truncating it", () => {
    const long = "x".repeat(101);
    const out = parseModify(`log a policy exception: advance rate above guideline, mitigated by ${long}`, single);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/101 characters and a mitigation reason holds 100/);
    // The over-long reason is dropped rather than held, so the next answer is
    // read as the replacement it is.
    expect(out.awaiting?.exception?.reasons).toEqual([]);
  });

  it("will not compose an exception that is both unmitigated and mitigated", () => {
    const out = parseModify(
      "log a policy exception: advance rate above guideline, unmitigated, though mitigating factors exist: the personal guaranty",
      single,
    );
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/cannot be both unmitigated and mitigated/i);
    // BOTH readings are dropped: keeping the mitigants would send an answer of
    // "Unmitigated" straight back into the same question.
    expect(out.awaiting?.exception).toMatchObject({ title: "Advance rate above guideline", status: undefined, reasons: [] });

    const done = parseAnswer(out.awaiting!, "Unmitigated", single);
    if (done?.kind !== "amendments") throw new Error(String(done?.kind));
    expect(done.amendments[0].value).toMatchObject({ status: "Unmitigated", reasons: [] });
  });

  it("REFUSES a fourth mitigant, because the org holds three", () => {
    const out = parseModify(
      "log a policy exception: advance rate above guideline, mitigated by one; two; three; four",
      single,
    );
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/holds 3 mitigation reasons on an exception and this line carries 4/);
  });

  it("asks for a NAME rather than filing a record the org would name after its own Id", () => {
    const asked = parseModify("log a policy exception on the line of credit - $15,000,000.00", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(asked.question).toMatch(/what should the exception be called/i);

    const done = parseAnswer(asked.awaiting!, "Advance rate above guideline, unmitigated", ctx);
    if (done?.kind !== "amendments") throw new Error(String(done?.kind));
    expect(done.amendments[0].value).toMatchObject({ title: "Advance rate above guideline", status: "Unmitigated" });
  });

  it("carries a severity only where the banker LABELLED one, and never a numeric grade", () => {
    const out = parseModify(
      "log a policy exception: advance rate above guideline, major severity, unmitigated",
      single,
    );
    if (out.kind !== "amendments") throw new Error(out.kind);
    const value = out.amendments[0].value;
    if (value?.kind !== "policyException") throw new Error(String(value?.kind));
    expect(value.severity).toBe("Major");
    // The severity phrase is a field of its own and never part of the name.
    expect(value.title).toBe("Advance rate above guideline");
    expect(Object.keys(value)).not.toContain("severityValue");

    // The same word in prose is NOT a grading: "a major exception" grades nothing.
    const prose = parseModify("log a policy exception: major customer concentration, unmitigated", single);
    if (prose.kind !== "amendments") throw new Error(prose.kind);
    expect(prose.amendments[0].value).toMatchObject({ severity: undefined, title: "Major customer concentration" });
  });

  it("says nothing rather than guessing at a line with no amendment in it", () => {
    expect(parseModify("what is the weather in Kokomo", single).kind).toBe("none");
    expect(parseModify("", single).kind).toBe("none");
  });

  it("says there is nothing to modify when no member is booked", () => {
    const out = parseModify("increase the commitment to $20,000,000", { ...ctx, booked: [] });
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/booked/i);
  });
});

/* =============================================================================
   THE BORROWING STRUCTURE, IN THE ORDER BANKERS SAY IT.

   "remove the guarantor James Hartwell" puts the ROLE between the verb and the
   name, and the name is somebody the read does not carry — which is the whole
   point of a removal the room has to stage. Everything here is a name that is
   NOT in `entities`, so what is exercised is the reader and not the lookup.
   ============================================================================= */

describe("a party the deal does not already carry", () => {
  const NAMED = [
    "remove the guarantor James Hartwell",
    "remove the guarantor James Hartwell from the line of credit",
    // The role AFTER the name — the phrasing that already worked, kept honest.
    "remove James Hartwell as guarantor",
    "remove the limited guarantor James Hartwell",
    "add the co-borrower James Hartwell",
  ];

  it.each(NAMED)("reads the entity out of %j", (line) => {
    const out = parseModify(line, single);
    if (out.kind !== "amendments") throw new Error(`${line}: ${out.kind}`);
    expect(out.amendments[0].party).toBe("James Hartwell");
  });

  it("never lets the MEMBER clause become part of the name", () => {
    // The org capitalises its own product names, so a capture left to run would
    // file an entity called "James Hartwell From The Line Of Credit".
    const out = parseModify("remove the guarantor James Hartwell from the Line of Credit - $15,000,000.00", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].party).toBe("James Hartwell");
    expect(out.amendments[0].facility?.loanId).toBe(line15.loanId);
  });

  it("still reads a first word that only LOOKS like a role", () => {
    // Capitalised, so it is a name: the role words are the ones a banker writes
    // in lower case.
    const out = parseModify("add Borrower Holdings LLC as a guarantor", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].party).toBe("Borrower Holdings LLC");
  });

  it("ANSWERS the room's own question with the name alone", () => {
    const asked = parseModify("remove the guarantor", single);
    expect(asked.kind).toBe("clarify");
    if (asked.kind !== "clarify") return;
    expect(asked.question).toMatch(/which entity/i);
    // The op, the role and the member were all read off the asking line.
    expect(asked.awaiting?.party).toMatchObject({ op: "remove", role: "Guarantor" });
    expect(asked.awaiting?.facility?.loanId).toBe(line15.loanId);

    const answered = parseAnswer(asked.awaiting!, "James Hartwell", single);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments).toHaveLength(1);
    expect(answered.amendments[0]).toMatchObject({
      party: "James Hartwell",
      role: "Guarantor",
      op: "remove",
    });
    expect(answered.amendments[0].facility?.loanId).toBe(line15.loanId);
  });

  it("spells an answered name the way the DEAL spells it", () => {
    const asked = parseModify("remove the limited guarantor", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const answered = parseAnswer(asked.awaiting!, "elena hartwell", single);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    // The org has to find the row by name, so the deal's own spelling travels.
    expect(answered.amendments[0].party).toBe("Elena Hartwell");
  });

  it("lets the ANSWER state a role and an ownership the question did not carry", () => {
    const asked = parseModify("bring in an entity on the line of credit - $15,000,000.00", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const answered = parseAnswer(asked.awaiting!, "Hartwell Logistics LLC as a co-borrower at 40% ownership", single);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0]).toMatchObject({
      party: "Hartwell Logistics LLC",
      role: "Co-Borrower",
      ownership: 40,
      op: "add",
    });
  });

  it("refuses an answer that belongs to a different question", () => {
    const asked = parseModify("remove the guarantor", single);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    expect(parseAnswer(asked.awaiting!, "the line of credit", single)).toBeNull();
  });
});

describe("a length whose own label states the unit", () => {
  it("reads a bare figure as MONTHS rather than asking which unit", () => {
    // The org labels the field "Amortized Term (Months)". A banker who quotes
    // that label and says 240 has already said the unit.
    const out = parseModify("set the Amortized Term (Months) to 240", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    // ONE amendment: "months" inside the org's own label is part of the field
    // name, not a second field for the parse to find.
    expect(out.amendments).toHaveLength(1);
    expect(out.amendments[0].field.id).toBe("loan.amortisedTerm");
    expect(out.amendments[0].value).toMatchObject({ kind: "months", months: 240 });
  });

  it("still asks when the figure is loose in the sentence", () => {
    const out = parseModify("shorten the amortisation", single);
    expect(out.kind).toBe("clarify");
    if (out.kind !== "clarify") return;
    expect(out.question).toMatch(/months or years/i);
  });
});

/* =============================================================================
   ONE REFERENCE, TWO MEMBERS (D1, orchestrator drive 2026-09-13).

   "Increase the line of credit by 20M USD" on Hartwell's package staged TWO
   amount cards, $15M to $35M and $2.50M to $22.50M, each with its own Confirm,
   and the drive confirmed both. A product word spreading across every member
   carrying it is right for "the equipment facilities", where the banker
   counted. It is wrong for a singular, definite reference: "the line of credit"
   on a package with two of them names NEITHER, and staging both is a change set
   nobody asked for on a member nobody named.
   ============================================================================= */

describe("a singular reference that fits two members", () => {
  it("ASKS which one, and names each of them on a chip", () => {
    const out = parseModify("Increase the line of credit by 20M USD", ctx);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/Line of Credit - \$15,000,000\.00/);
    expect(out.question).toMatch(/Line of Credit - \$2,500,000\.00/);
    // One chip per member, by product and what it commits today.
    expect(out.options).toEqual(["Line of Credit $15M", "Line of Credit $2.50M"]);
    // AN AMOUNT MOVE NEVER RIDES BOTH. Twenty million on each is two different
    // credit actions, so there is no honest "Both" to offer.
    expect(out.options).not.toContain("Both");
    // And the line itself is held, so the answer is a member and nothing else.
    expect(out.awaiting?.member?.said).toBe("Increase the line of credit by 20M USD");
    expect(out.awaiting?.member?.choices.map((f) => f.loanId)).toEqual([line15.loanId, line25.loanId]);
  });

  it("stages the ask on the member the answer names, off the held line", () => {
    const asked = parseModify("Increase the line of credit by 20M USD", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const answered = parseAnswer(asked.awaiting!, "Line of Credit $15M", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments).toHaveLength(1);
    expect(answered.amendments[0].facility?.loanId).toBe(line15.loanId);
    // A move, computed off the figure on file: $15M + $20M.
    expect(answered.amendments[0].value).toMatchObject({ kind: "currency", amount: 35_000_000 });
  });

  it("reads the member out of a figure the banker wrote instead of the chip", () => {
    const asked = parseModify("Increase the line of credit by 20M USD", ctx);
    if (asked.kind !== "clarify") throw new Error(asked.kind);
    const answered = parseAnswer(asked.awaiting!, "the $2.5M one", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].facility?.loanId).toBe(line25.loanId);
  });

  it("keeps a PLURAL reference a selection, because the banker counted", () => {
    const out = parseModify("take the lines of credit to $20,000,000", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments.map((a) => a.facility?.loanId)).toEqual([line15.loanId, line25.loanId]);
  });

  it("offers Both where the ask could honestly ride both members", () => {
    const out = parseModify("add a leverage covenant max 3.5x on the line of credit", ctx);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.options).toEqual(["Line of Credit $15M", "Line of Credit $2.50M", "Both"]);
    const answered = parseAnswer(out.awaiting!, "Both", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments.map((a) => a.facility?.loanId)).toEqual([line15.loanId, line25.loanId]);
  });

  it("asks nothing where a figure in the line names one of them", () => {
    // "the 2.5M line of credit" is not ambiguous. The narrowing itself is the
    // qualifier filter's, in components/workroom/dispatch.ts, which says which
    // member it read; the parser's job here is only not to ask.
    const out = parseModify("take the 2.5M line of credit to 4M", ctx);
    expect(out.kind).toBe("amendments");
  });

  it("puts the SAME chips under the question when the line names no member", () => {
    const out = parseModify("increase the commitment to $20,000,000", ctx);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.question).toMatch(/which member/i);
    expect(out.options).toEqual(["Line of Credit $15M", "Line of Credit $2.50M", "Equipment $8M"]);
    expect(out.awaiting?.member?.choices).toHaveLength(3);
  });
});

/* =============================================================================
   A BPS MOVE IS A RATE MOVE (D2, orchestrator drive 2026-09-13).

   "add 50bps on the line of credit" staged nothing at all: "bps" sits inside
   "50bps", so the catalog's word-bounded synonyms never see it, and the room
   fell through to a question about a term. Nothing on a facility but the price
   is quoted in basis points.
   ============================================================================= */

describe("a move quoted in basis points", () => {
  it("reads an ADD as a move UP off the rate on file", () => {
    const out = parseModify("add 50bps on the line of credit", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].field.id).toBe("loan.interestRate");
    expect(out.amendments[0].facility?.loanId).toBe(line15.loanId);
    expect(out.amendments[0].value).toMatchObject({ kind: "percent", rate: 8.1 });
  });

  it("reads TAKE OFF as a move DOWN, on the member the figure names", () => {
    const out = parseModify("take 25 bps off the $15M line", ctx);
    if (out.kind !== "amendments") throw new Error(out.kind);
    const on15 = out.amendments.find((a) => a.facility?.loanId === line15.loanId);
    expect(on15?.field.id).toBe("loan.interestRate");
    expect(on15?.value).toMatchObject({ kind: "percent", rate: 7.35 });
  });

  it("reads the direction off the verb where the field is named too", () => {
    const out = parseModify("lower the rate by 50bps", single);
    if (out.kind !== "amendments") throw new Error(out.kind);
    expect(out.amendments[0].value).toMatchObject({ kind: "percent", rate: 7.1 });
  });

  it("REFUSES a signed figure with both readings rather than picking one", () => {
    const out = parseModify("add -50bps on the line of credit", single);
    if (out.kind !== "clarify") throw new Error(out.kind);
    // 7.6% less half a point, and $15,000,000 less half a per cent.
    expect(out.question).toContain("the rate down 0.5 points, to 7.1%");
    expect(out.question).toContain("the commitment cut 0.5%, to $14,925,000.00");
    expect(out.options).toEqual(["Lower the rate to 7.1%", "Reduce the commitment to $14,925,000.00"]);
  });

  it("asks which line before it prices anything, where the reference fits two", () => {
    const out = parseModify("add 50bps on the line of credit", ctx);
    if (out.kind !== "clarify") throw new Error(out.kind);
    expect(out.options).toEqual(["Line of Credit $15M", "Line of Credit $2.50M"]);
    const answered = parseAnswer(out.awaiting!, "Line of Credit $15M", ctx);
    if (answered?.kind !== "amendments") throw new Error(String(answered?.kind));
    expect(answered.amendments[0].value).toMatchObject({ kind: "percent", rate: 8.1 });
  });

  it("leaves a bare percentage alone where the line states no move", () => {
    // "810 bps" beside a member is a price; "5%" with no verb is a fact about
    // the deal, and the room does not stage facts.
    expect(parseModify("5% on the line of credit", single).kind).toBe("none");
  });
});

/* =============================================================================
   AN ANSWER OUT OF ORDER IS STILL AN ANSWER (D3, orchestrator drive 2026-09-13).

   With the term question open, "7.25%", "asdf", "-5%", "actually 8%" and "no
   change" each got the identical sentence back. A rate typed into a term
   question is the banker answering the next field early; re-asking the term
   over it loses the figure they just gave.
   ============================================================================= */

describe("a figure that belongs to another field, typed into an open question", () => {
  const onTerm = { field: catalogField("loan.termMonths")!, facility: line15 };

  it("stages the RATE on the member in focus", () => {
    const out = parseAnswer(onTerm, "7.25%", single);
    if (out?.kind !== "amendments") throw new Error(String(out?.kind));
    expect(out.amendments[0].field.id).toBe("loan.interestRate");
    expect(out.amendments[0].facility?.loanId).toBe(line15.loanId);
    expect(out.amendments[0].value).toMatchObject({ kind: "percent", rate: 7.25 });
  });

  it("supersedes it on a correction", () => {
    const out = parseAnswer(onTerm, "actually 8%", single);
    if (out?.kind !== "amendments") throw new Error(String(out?.kind));
    expect(out.amendments[0].value).toMatchObject({ kind: "percent", rate: 8 });
  });

  it("REFUSES a signed figure with both readings and the figure each lands on", () => {
    const out = parseAnswer(onTerm, "-5%", single);
    if (out?.kind !== "clarify") throw new Error(String(out?.kind));
    // 7.6% less five points, and $15,000,000 less five per cent.
    expect(out.question).toContain("the rate down 5 points, to 2.6%");
    expect(out.question).toContain("the commitment cut 5%, to $14,250,000.00");
    expect(out.options).toEqual(["Lower the rate to 2.6%", "Reduce the commitment to $14,250,000.00"]);
  });

  it("still reads the open field's OWN answer first", () => {
    const out = parseAnswer(onTerm, "240 months", single);
    if (out?.kind !== "amendments") throw new Error(String(out?.kind));
    expect(out.amendments[0].field.id).toBe("loan.termMonths");
    expect(out.amendments[0].value).toMatchObject({ kind: "months", months: 240 });
  });

  it("still takes a keep-current word as the answer it is", () => {
    for (const said of ["keep it", "keep as booked", "no change", "leave it", "hold"]) {
      const out = parseAnswer(onTerm, said, single);
      if (out?.kind !== "hold") throw new Error(`${said}: ${String(out?.kind)}`);
      expect(out.field.id).toBe("loan.termMonths");
      expect(out.facility?.loanId).toBe(line15.loanId);
    }
  });

  it("asks again, naming what it heard, where the line is neither", () => {
    const out = parseAnswer(onTerm, "asdf", single);
    if (out?.kind !== "clarify") throw new Error(String(out?.kind));
    expect(out.question).toMatch(/months or years/i);
  });
});
