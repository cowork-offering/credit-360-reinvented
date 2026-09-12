// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRenewEngine, type RenewEngineDeps } from "./renewEngine";
import { WorkroomRefusalError } from "./modifyEngine";
import { assertNoRecordIds } from "../actions/stagedPlan";
import { validatePlan } from "../actions/transitionAllowlist";
import type { BorrowerBundle, C360Data, Facility } from "../data/contract";
import type { WorkroomContext, WorkroomDelta } from "./types";

/* =============================================================================
   THE RENEWAL ENGINE, ON A MOCKED CHANNEL.

   What is proved here is the wiring and the honesty, not a storyline:

     - MATURITY LEADS. The room opens on what is coming due, because that is
       what a renewal is chosen on.
     - `newMaturityDate` IS THE WIRE'S OWN PRECONDITION. The deployed
       `StageRenewal` declares it required=true AND re-checks it in Apex, and
       this room refuses a plan without it in the tool's own words rather than
       spending a round trip to be told.
     - ROLL-OVER SEMANTICS. Everything not staged comes with the clone, and the
       two changes that travel are the maturity and a repricing. An amount is a
       modification, not a renewal, and it is handed off saying so.
     - NOTHING IS EXECUTED. There is no `execute_renewal`, so the final beat
       stages the governed plan, leaves the token unredeemed and hands into
       nCino's Submit for Approval. The test that matters most in this file is
       the one asserting no execute call is made at all.

   The stage envelope is the one observed live against the Hartwell package and
   archived in `knowledge/sf-build-v2/wp2/observed-envelopes-facilityIds.json`
   under `package_anchored_renewal`.
   ============================================================================= */

const PACKAGE_ID = "a5Fbb000000IHFJEA4";
const LINE_ID = "a4Zbb0000027MaYEAU";
const EQUIPMENT_ID = "a4Zbb0000027MnREAU";
const PROPOSAL_ID = "a4Zbb000002CECXEA4";

const line: Facility = {
  loanId: LINE_ID,
  name: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
  productType: "Line of Credit",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 15_000_000,
  outstanding: 9_200_000,
  available: 5_800_000,
  interestRate: 7.6,
  // 200 days after the read's own clock: inside the near window.
  maturityDate: "2027-03-15",
  loanCovenants: [{ id: "a4Vbb000000pNIjEAM", name: "COV-0107", covenantType: "Accounts Receivable", covenantId: "a3Bbb000000S0bNEAS" }],
  collateral: [
    { loanId: LINE_ID, collateralId: "a35bb0000013xz3AAA", collateralName: "COL-000762", amountPledged: 8_000_000, advanceRate: 80, lienPosition: "1st", pledgedStatus: "Inactive" },
  ],
};

const equipment: Facility = {
  loanId: EQUIPMENT_ID,
  name: "Hartwell Precision Manufacturing LLC - Equipment - $8,000,000.00",
  productType: "Equipment",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 8_000_000,
  outstanding: 5_900_000,
  interestRate: 6.4,
  maturityDate: "2029-06-30",
};

/** The showcase member. Proposal stage: never a renewal target. */
const proposal: Facility = {
  loanId: PROPOSAL_ID,
  name: "Hartwell Precision Manufacturing LLC - Equipment - $3,000,000.00",
  productType: "Equipment",
  productPackageId: PACKAGE_ID,
  stage: "Proposal",
  status: "Active",
  committed: 3_000_000,
};

function bundleWith(facilities: Facility[] = [line, equipment, proposal]): BorrowerBundle {
  return {
    snapshot: { accountId: "001bb00001I7FPNAA3", name: "Hartwell Precision Manufacturing LLC", productPackageId: PACKAGE_ID, packageStage: "Complete", primaryRiskRating: "4" },
    exposure: {
      totalCommitted: 26_000_000,
      totalOutstanding: 15_100_000,
      totalUniqueCollateralLendableValue: 34_600_000,
      uniqueCollateralCount: 5,
      coverageRatio: 1.13,
      facilities,
    },
    covenants: {
      covenants: [
        { covenantId: "a3Bbb000000S0ZlEAK", covenantType: "Fixed Charge Coverage", thresholdValue: 1.15, actualValue: 1.22, latestComplianceStatus: "Compliant" },
        { covenantId: "a3Bbb000000S0UvEAK", covenantType: "Debt Service Coverage", thresholdValue: 1.25, actualValue: 1.38, latestComplianceStatus: "Compliant" },
      ],
    },
    graph: {
      legalEntities: [
        { accountName: "Hartwell Precision Manufacturing LLC", borrowerType: "Borrower", loanId: LINE_ID, packageId: PACKAGE_ID },
        { accountName: "James Hartwell", borrowerType: "Guarantor", loanId: LINE_ID, packageId: PACKAGE_ID },
      ],
      connections: [{ counterpartyName: "Hartwell Logistics LLC", role: "Subsidiary", ownershipPercent: 100, isActive: true }],
    },
  };
}

const data = {
  meta: { anchorAccountId: "001bb00001I7FPNAA3", generatedAt: "2026-08-27T08:00:00Z", user: "Fabian Goetzens", userId: "005bb00000ftouDAAQ" },
} as unknown as C360Data;

const context: WorkroomContext = {
  mode: "renew",
  door: "package",
  accountId: "001bb00001I7FPNAA3",
  accountName: "Hartwell Precision Manufacturing LLC",
  productPackageId: PACKAGE_ID,
  packageName: "Hartwell Precision Manufacturing LLC credit package",
  approver: "Fabian Goetzens",
};

/* THE OBSERVED ENVELOPE, trimmed to what the wrapper reads. Every key below
   appears verbatim in `observed-envelopes-facilityIds.json`. */
const STAGE_RESULT = {
  stagingId: "a8abb00001KxMvaAAF",
  planHash: "2e741b2b042f2939853b6e91c819a0e44d87b7d962d8e609bc4efc2d26d4fd65",
  decisionToken: "9cf61a0bd3d967a692b4790e0a253ed0559bfcc97c4edd2859d59270bf36597f",
  replayed: false,
  accountId: "001bb00001I7FPNAA3",
  productPackageId: PACKAGE_ID,
  summary:
    "Plans the next VERSION of the package, nCino package methodology: one credit action rolls all 2 eligible members into a new package with their junction graphs. Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00 is the member being renewed; the rest carry unchanged. NOTHING IS WRITTEN AND NOTHING WILL BE: execution is held.",
  warnings: [
    "EXECUTION IS HELD. This facility is booked and open, which is what a credit action requires, but no execute tool ships in this wave.",
    "nCino package methodology: a renewal versions the whole package, never a loan alone. Executing this plan would create a NEW package version holding clones of all 2 eligible members; the current package and every original loan stay exactly as they are.",
    "nCino's engine copies NO junction rows in this org (verified live 2026-08-30). Whatever executes this plan must therefore carry each member's covenant junctions, collateral pledges and borrowing involvements onto its clone itself, and prove the counts by re-query.",
    "A renewal auto-creates a new Opportunity and is effectively irreversible once run.",
  ],
  executionHeld: true,
  heldReason:
    "A credit action requires a Booked, core-keyed facility, and Loan_Validation_06 makes Booked unreachable through the API with no bypass. Reaching it needs nCino's Submit for Approval with real approvers. This plan is staged and persisted so it can be executed once that path exists.",
  covenantCarryoverCount: 1,
  facilityCount: 1,
  facilities: [
    { facilityId: LINE_ID, facilityName: line.name, creditActionStepId: "credit_action_0", verifyStepId: "verify_clone_0", applyStepId: "apply_changes_0", covenantCarryoverCount: 1 },
  ],
  // The package-versioning shape (2026-08-30): the roll opens the plan, the
  // package is verified, and the junction carry is a counted promise — the same
  // steps StageLoanModification stages, in the renewal's held wave.
  steps: [
    { id: "roll_package", type: "write", label: "Create the next package version: one credit action rolls all 2 eligible members into a new package", objectName: "LLC_BI__Product_Package__c", fields: ["new package version created by nCino"], state: "pending" },
    { id: "credit_action_0", type: "write", label: "Roll the Line of Credit into the new package version (its clone is the one this plan renews)", objectName: "LLC_BI__Loan__c", fields: ["clone created by nCino on the new package version"], state: "pending" },
    { id: "verify_clone_0", type: "verification", label: "Re-query for the new facility and its junction row", objectName: "LLC_BI__LoanRenewal__c", fields: ["LLC_BI__ParentLoanId__c"], state: "pending" },
    { id: "apply_changes_0", type: "write", label: "Apply the requested changes to the new facility", objectName: "LLC_BI__Loan__c", fields: ["LLC_BI__Maturity_Date__c"], state: "pending" },
    { id: "verify_package", type: "verification", label: "Verify the new package version: it exists, it is not the current package, and every rolled member reads back as a clone on it", objectName: "LLC_BI__Product_Package__c", fields: ["Id", "Name"], state: "pending" },
    { id: "carry_junctions", type: "write", label: "Carry each rolled member's junction graph onto its clone: 1 covenant junction, 1 collateral pledge, 2 borrowing involvements", objectName: "LLC_BI__Loan_Covenant__c", fields: ["replicas retargeted at the clones, verified by count"], state: "pending" },
    { id: "observe_side_effects", type: "observed_side_effect", label: "A new Opportunity is auto-created on every renewal", state: "pending" },
    { id: "held_execution", type: "handoff", label: "HELD: execution needs an approved facility", state: "pending" },
  ],
};

function deps(over: Partial<RenewEngineDeps> = {}): RenewEngineDeps {
  return {
    stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT }),
    available: () => true,
    newKey: () => "wr-renew-key",
    restate: undefined,
    ...over,
  };
}

function engineOn(over: Partial<RenewEngineDeps> = {}, bundle: BorrowerBundle | null = bundleWith()) {
  const d = deps(over);
  return { engine: createRenewEngine({ context, data, bundle, deps: d }), deps: d };
}

async function confirm(engine: ReturnType<typeof createRenewEngine>, line: string): Promise<WorkroomDelta[]> {
  const result = await engine.parseIntent(line, context);
  if (result.kind !== "deltas") throw new Error(`${line} → ${result.kind}: ${result.reply}`);
  return result.deltas;
}

/** Compose, stage and submit in one go: the whole storyline, headlessly. */
async function submitted(over: Partial<RenewEngineDeps> = {}) {
  const { engine, deps: d } = engineOn(over);
  const deltas = await confirm(engine, "renew the Line of Credit to 15 March 2029");
  const plan = await engine.stagePlan(deltas, context);
  const execution = await engine.execute({
    stagingId: plan.stagingId,
    planHash: plan.planHash,
    decisionToken: plan.decisionToken!,
    approverUserId: "Fabian Goetzens",
  });
  return { engine, deps: d, deltas, plan, execution };
}

/* --------------------------------------------------------------------------- */

describe("the renewal room opens on what is coming due", () => {
  it("leads the position with the maturing money, not with the committed total", () => {
    const { engine } = engineOn();
    expect(engine.scripted).toBe(false);
    expect(engine.mode).toBe("renew");
    const brief = engine.brief(context);
    expect(brief.position).toContain("$15M matures within 270 days");
    expect(brief.position).toContain("Line of Credit");
    expect(brief.position).toContain("Mar 15, 2027");
    // Law 3: the opening view is budgeted, and this is the sentence in it.
    expect(brief.position.split(/\s+/).length).toBeLessThan(60);
  });

  it("pins the maturity rather than reprinting a figure the strip already shows", () => {
    const brief = engineOn().engine.brief(context);
    expect(brief.askPin).toBe("Matures Mar 15, 2027");
    expect(brief.baselineCommittedMM).toBe(26);
    expect(brief.baselineMembers).toBe(3);
  });

  it("puts maturities first in what it read, with the days to each", () => {
    const brief = engineOn().engine.brief(context);
    expect(brief.have[0].label).toBe("Maturities");
    expect(brief.have[0].detail).toContain("(200 days)");
    expect(brief.sources[0].id).toBe("maturities");
  });

  it("says what rolls forward, because a renewal is a roll-over", () => {
    const rows = engineOn().engine.brief(context).have;
    const carry = rows.find((r) => r.label.startsWith("What "))!;
    expect(carry.value).toContain("1 covenant junction");
    expect(carry.value).toContain("1 pledge");
    expect(rows.some((r) => r.label === "Covenants that roll forward")).toBe(true);
    expect(rows.find((r) => r.label === "Known renewal side effects")!.detail).toContain("Opportunity");
  });

  it("puts the maturity on the member chip, because that is what this room chooses on", () => {
    const brief = engineOn().engine.brief(context);
    expect(brief.members.find((m) => m.id === LINE_ID)!.detail.startsWith("matures Mar 15, 2027")).toBe(true);
  });

  it("holds everything until a package is chosen, when the relationship carries several", async () => {
    const two = bundleWith([line, { ...equipment, productPackageId: "a5Fbb000000OTHERAA" }]);
    const engine = createRenewEngine({ context: { ...context, productPackageId: null }, data, bundle: two, deps: deps() });
    const brief = engine.brief({ ...context, productPackageId: null });
    expect(brief.packageChoices.length).toBe(2);
    expect(brief.members).toEqual([]);
    expect(engine.suggest()).toBeNull();
    const out = await engine.parseIntent("renew the line", { ...context, productPackageId: null });
    expect(out.reply).toContain("anchored on one of them");
  });

  it("says nothing is renewable when nothing is booked", () => {
    const none = bundleWith([{ ...line, stage: "Proposal" }]);
    const brief = createRenewEngine({ context, data, bundle: none, deps: deps() }).brief(context);
    expect(brief.position).toContain("none of them is booked");
  });
});

describe("the renewal verb asks the one question the tool refuses without", () => {
  it("names the member and asks for the maturity, with today's date beside it", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("renew the Line of Credit", context);
    expect(out.kind).toBe("unparsed");
    expect(out.reply).toContain("What maturity does the renewal run to?");
    expect(out.reply).toContain("matures Mar 15, 2027");
    expect(out.reply).toContain("maturity-driven");
    // A PENDING QUESTION SUPPRESSES THE NEXT MOVE: two moves on the table at
    // once is what wires the scene bar to the wrong one.
    expect(engine.suggest()).toBeNull();
  });

  /* DOCTRINE C, THE ABSENCE HALF (founder 2026-09-12). The room recommends only
     where a figure on file or a doctrine band grounds it. Neither grounds a
     RENEWAL TENOR here: the only tenor language in the codebase is one
     `credit-policy` doctrine line of CAPS keyed to product words this engine
     does not carry ("revolver", "machinery and equipment", "owner-occupied
     CRE"), and nothing maps nCino's own `productType` onto them. So the ask
     leads with the current figures, offers the three real extensions, and takes
     no view. This test exists to keep it that way. */
  it("offers the real options on the maturity and recommends none of them", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("renew the Line of Credit", context);
    if (out.kind !== "unparsed") throw new Error(`expected the maturity question, got ${out.kind}`);
    expect(out.options?.map((o) => o.label)).toEqual([
      "+12 months (Mar 15, 2028)",
      "+24 months (Mar 15, 2029)",
      "+36 months (Mar 15, 2030)",
      "Another date",
    ]);
    expect(out.reply).not.toMatch(/I would|recommend|suggest|standard tenor|typical|usually/i);
  });

  it("takes the answer alone as a complete instruction", async () => {
    const { engine } = engineOn();
    await engine.parseIntent("renew the Line of Credit", context);
    const answered = await engine.parseIntent("15 March 2029", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].wire).toEqual({ key: "newMaturityDate", value: "2029-03-15", facilityId: LINE_ID });
  });

  it("takes the verb and the date in one breath", async () => {
    const [delta] = await confirm(engineOn().engine, "renew the Line of Credit to 15 March 2029");
    expect(delta.wire).toEqual({ key: "newMaturityDate", value: "2029-03-15", facilityId: LINE_ID });
    expect(delta.before).toBe("Mar 15, 2027");
    expect(delta.after).toBe("Mar 15, 2029");
    expect(delta.kind).toBe("Renewal term");
  });

  it("refuses a month, because a maturity is a day", async () => {
    const out = await engineOn().engine.parseIntent("renew the Line of Credit to March 2029", context);
    expect(out.kind).toBe("unparsed");
    expect(out.reply).toContain("names a month, and a maturity is a day");
  });

  it("picks the one maturing member itself, and names the one it picked", async () => {
    // ONE member inside the window is not an ambiguity: choosing it and saying
    // so is a better answer than a list of one.
    const out = await engineOn().engine.parseIntent("let's do a renewal", context);
    expect(out.kind).toBe("unparsed");
    expect(out.reply).toContain("Line of Credit");
    expect(out.reply).toContain("What maturity does the renewal run to?");
  });

  it("asks which one, listing them with their dates, when two are maturing", async () => {
    const both = bundleWith([line, { ...equipment, maturityDate: "2027-05-01" }]);
    const engine = createRenewEngine({ context, data, bundle: both, deps: deps() });
    const out = await engine.parseIntent("let's do a renewal", context);
    expect(out.kind).toBe("unparsed");
    expect(out.reply).toContain("Line of Credit (Mar 15, 2027)");
    expect(out.reply).toContain("Equipment (May 1, 2027)");
  });

  /* THE MATURITY ASK CARRIES THE ANSWER SET (golden rule 2, finding B2). The one
     question this room exists to ask arrived with three figures and nothing to
     click, on a field whose whole point is that it must move. */
  it("offers the real options off the date on file, and recommends none of them", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("renew the Line of Credit", context);
    expect(out.kind).toBe("unparsed");
    if (out.kind !== "unparsed") return;
    // The current maturity is STATED, and the options are extensions off it.
    expect(out.reply).toContain("matures Mar 15, 2027");
    expect(out.options).toEqual([
      { label: "+12 months (Mar 15, 2028)", say: "extend by 12 months" },
      { label: "+24 months (Mar 15, 2029)", say: "extend by 24 months" },
      { label: "+36 months (Mar 15, 2030)", say: "extend by 36 months" },
      { label: "Another date", say: "another date" },
    ]);
    // NO RECOMMENDATION, and no chip that holds the maturity where it is.
    expect(out.reply).not.toMatch(/I would|recommend|suggest/i);
    expect(out.options!.some((o) => /keep|hold/i.test(o.label))).toBe(false);
  });

  it("derives the chip's own date through the parser, so the chip and a typed answer file the same thing", async () => {
    const { engine } = engineOn();
    await engine.parseIntent("renew the Line of Credit", context);
    const said = await engine.parseIntent("extend by 24 months", context);
    expect(said.kind).toBe("deltas");
    if (said.kind !== "deltas") return;
    expect(said.deltas[0].wire).toEqual({ key: "newMaturityDate", value: "2029-03-15", facilityId: LINE_ID });
  });

  /* A RENEWAL CANNOT HOLD ITS MATURITY (golden rule 2/4/5, finding B1). The chip
     used to be offered and the hold used to be accepted, which staged a plan
     `wirePayload` refuses at Confirm and left the room with no next move. */
  it("offers no keep chip on the maturity, and answers a typed hold with the options", async () => {
    const { engine } = engineOn();
    const ask = await engine.parseIntent("renew the Line of Credit", context);
    if (ask.kind !== "unparsed") throw new Error("expected the maturity ask");
    expect(JSON.stringify(ask.options)).not.toMatch(/keep/i);

    const held = await engine.parseIntent("keep it", context);
    expect(held.kind).toBe("unparsed");
    if (held.kind !== "unparsed") return;
    // NOT the hold sentence: it closed the question on a plan the tool refuses.
    expect(held.reply).not.toContain("Holding maturity");
    expect(held.reply).toContain("Mar 15, 2027");
    expect(held.reply).toMatch(/refuses a plan with no new maturity date/);
    expect(held.options?.map((o) => o.say)).toEqual([
      "extend by 12 months",
      "extend by 24 months",
      "extend by 36 months",
      "another date",
    ]);
    // And the question is still open, so the next line is read as its answer.
    const answered = await engine.parseIntent("15 March 2029", context);
    expect(answered.kind).toBe("deltas");
  });

  it("still takes a hold on a term a renewal CAN leave alone", async () => {
    const { engine } = engineOn();
    const ask = await engine.parseIntent("reprice the Line of Credit", context);
    expect(ask.kind).toBe("unparsed");
    if (ask.kind !== "unparsed") return;
    expect(ask.options?.[0]).toEqual({ label: "Keep 7.6%", say: "keep it" });
    const held = await engine.parseIntent("keep it", context);
    expect(held.reply).toBe("Holding interest rate at 7.6%. Nothing changes on it.");
  });

  it("answers a pick on the strip, and refuses one that is not booked", () => {
    const { engine } = engineOn();
    const booked = engine.pick(LINE_ID)!;
    expect(booked.reply).toContain("What maturity does the renewal run to?");

    const staged = engine.pick(PROPOSAL_ID)!;
    expect(staged.reply).toContain("is at Proposal");
    expect(staged.reply).toContain("only runs against a booked facility");
  });
});

describe("two changes travel and the rest rolls forward", () => {
  it("files a repricing on the renewal wire", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "reprice the Line of Credit to 8.1%");
    expect(delta.wire).toEqual({ key: "requestedRate", value: 8.1, facilityId: LINE_ID });
    expect(delta.map.find(([k]) => k === "Written as")![1]).toContain("renewal clone");
  });

  it("hands off an amount, saying that resizing is a modification and not a renewal", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "take the Line of Credit to $20,000,000");
    expect(delta.fileable).toBe(false);
    expect(delta.wire).toBeUndefined();
    expect(delta.handoff!.reason).toContain("Resizing a facility is a modification, not a renewal");
    expect(delta.badge).toContain("handed off");
  });

  it("tells the banker a term in months is not what this wire takes", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "give the Line of Credit a 36 month term");
    expect(delta.fileable).toBe(false);
    expect(delta.handoff!.reason).toContain("takes the new maturity DATE");
  });

  it("stages a covenant change for the record and says nothing files it", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "add a covenant on the fixed charge coverage test on the Line of Credit");
    expect(deltas.every((d) => d.fileable === false)).toBe(true);
    expect(deltas[0].chainLinks?.length).toBeGreaterThan(0);
  });

  it("reads a change against the roll-over baseline, never against nothing", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add James Hartwell as a guarantor");
    expect(delta.before).toBe("not on the facility today");
  });
});

describe("the confirm answers, and the checks come to the banker", () => {
  it("closes on the package's own maturity, not on the member's", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const { reply, challenge } = engine.acknowledge(delta, [delta]);
    expect(reply).toContain("That moves the package's next maturity from Mar 15, 2027 to Mar 15, 2029.");
    expect(challenge!.verdict).toBe("Maturity extends");
    expect(challenge!.rows).toContainEqual(["Renews to", "Mar 15, 2029", "key"]);
    expect(challenge!.say).toContain("not a covenant test");
  });

  it("prices a repricing in money the banker can weigh", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "reprice the Line of Credit to 8.6%");
    const { challenge } = engine.acknowledge(delta, [delta]);
    expect(challenge!.verdict).toBe("Repriced up");
    // One percentage point on $15M committed, stated as this cockpit's own
    // arithmetic and never as the org's pricing.
    expect(challenge!.line).toContain("$150K a year more");
    expect(challenge!.say).toContain("not a pricing model");
  });

  it("says what a handoff did, and never goes quiet on a confirm", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "take the Line of Credit to $20,000,000");
    const { reply, challenge } = engine.acknowledge(delta, [delta]);
    expect(reply).toContain("on the plan for the record");
    expect(reply).toContain("The package's next maturity holds at Mar 15, 2027.");
    expect(challenge).toBeUndefined();
  });
});

describe("staging is the governed move, and it refuses what the org would refuse", () => {
  it("sends the observed renewal payload: package anchor, facility list, the date", async () => {
    const { engine, deps: d } = engineOn();
    const maturity = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const rate = await confirm(engine, "reprice the Line of Credit to 8.1%");
    await engine.stagePlan([...maturity, ...rate], context);
    expect(d.stage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.stage!).mock.calls[0][0]).toEqual({
      idempotencyKey: "wr-renew-key",
      rationale: expect.stringContaining("Renewal Workroom"),
      facilityIds: [LINE_ID],
      productPackageId: PACKAGE_ID,
      newMaturityDate: "2029-03-15",
      requestedRate: 8.1,
    });
  });

  it("refuses a plan with no new maturity, in the tool's own words", async () => {
    const { engine, deps: d } = engineOn();
    const rate = await confirm(engine, "reprice the Line of Credit to 8.1%");
    await expect(engine.stagePlan(rate, context)).rejects.toThrow(WorkroomRefusalError);
    await expect(engine.stagePlan(rate, context)).rejects.toThrow(/maturity-driven/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("refuses a plan that only hands off", async () => {
    const { engine, deps: d } = engineOn();
    const handed = await confirm(engine, "take the Line of Credit to $20,000,000");
    await expect(engine.stagePlan(handed, context)).rejects.toThrow(/a renewal with no new maturity is not a renewal/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("refuses two different maturities in one plan, because the wire takes one", async () => {
    const { engine } = engineOn();
    const first = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const second = await confirm(engine, "renew the Equipment to 30 June 2030");
    await expect(engine.stagePlan([...first, ...second], context)).rejects.toThrow(/ONE value applied to every facility/);
  });

  it("refuses to stage at all without a connector, and simulates nothing", async () => {
    const { engine, deps: d } = engineOn({ available: () => false });
    const deltas = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/no connector/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("hands the org's own refusal back verbatim", async () => {
    const { engine } = engineOn({
      stage: vi.fn().mockResolvedValue({ ok: false, error: { code: "VALIDATION_FAILED", message: "newMaturityDate is required. A renewal is maturity-driven." } }),
    });
    const deltas = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow("newMaturityDate is required. A renewal is maturity-driven.");
  });

  it("appends the handoffs before the org's own held step, and warns about them", async () => {
    const { engine } = engineOn();
    const maturity = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const handed = await confirm(engine, "take the Line of Credit to $20,000,000");
    const { plan } = await engine.stagePlan([...maturity, ...handed], context);
    const ids = plan.steps.map((s) => s.id);
    expect(ids.indexOf("handoff_0")).toBeGreaterThan(ids.indexOf("apply_changes_0"));
    expect(ids.indexOf("handoff_0")).toBeLessThan(ids.indexOf("held_execution"));
    expect(plan.warnings.at(-1)).toContain("handed off rather than staged onto the clone");
  });

  it("passes the allowlist mirror and the record-id fence on the org's own plan", async () => {
    const { plan } = await submitted();
    expect(validatePlan(plan.plan.steps)).toEqual([]);
    expect(assertNoRecordIds(plan.plan)).toEqual([]);
  });
});

describe("the final beat stages and hands off, and files nothing", () => {
  it("makes NO execute call: there is no execute_renewal to make one to", async () => {
    // The whole design in one assertion. `RenewEngineDeps` has no `execute`
    // seam at all, so this proves the shape as much as the behaviour: the only
    // tool this room ever reaches is `stage_renewal`.
    const { deps: d, execution } = await submitted();
    expect(d.stage).toHaveBeenCalledTimes(1);
    expect(Object.keys(d)).not.toContain("execute");
    expect(execution.filed.length).toBe(1);
  });

  it("reports the staged plan against the org's own staging row, and claims no clone", async () => {
    const { execution } = await submitted();
    expect(execution.filed[0].recordId).toBe(STAGE_RESULT.stagingId);
    expect(execution.filed[0].verification).toContain("Nothing is written on the facility until nCino books the clone");
  });

  it("says the token was minted and not redeemed", async () => {
    const { execution } = await submitted();
    expect(execution.tokenNote).toContain("NOT redeemed");
    expect(execution.tokenNote).not.toMatch(/\bredeemed by\b/);
  });

  it("hands into nCino's Submit for Approval, with the org's own reason first", async () => {
    const { execution } = await submitted();
    expect(execution.handoff).toContain("Loan_Validation_06");
    expect(execution.handoff).toContain("Submit for Approval");
    expect(execution.handoff).toContain("hands into that process and never around it");
  });

  it("drafts a reply that says nothing was written", async () => {
    const { execution } = await submitted();
    expect(execution.reply!.subject).toContain("renewal staged");
    expect(execution.reply!.lede).toBe(STAGE_RESULT.summary);
    expect(execution.reply!.body).toContain("Nothing has been written.");
    expect(execution.reply!.body).toContain("maturity from Mar 15, 2027 to Mar 15, 2029");
  });

  it("carries the handoffs onto the submitted summary", async () => {
    const { engine } = engineOn();
    const maturity = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const handed = await confirm(engine, "take the Line of Credit to $20,000,000");
    const plan = await engine.stagePlan([...maturity, ...handed], context);
    const execution = await engine.execute({ stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" });
    expect(execution.filed.length).toBe(1);
    expect(execution.handoffs!.length).toBe(1);
    expect(execution.reply!.body).toContain("not staged onto the clone");
  });

  it("refuses a confirmation that no longer matches the plan, and one already used", async () => {
    const { engine, plan, execution } = await submitted();
    expect(execution.filed.length).toBe(1);
    const approval = { stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" };
    await expect(engine.execute(approval)).rejects.toThrow(/already been used/);
    await expect(engine.execute({ ...approval, planHash: "moved", decisionToken: "other" })).rejects.toThrow(/no longer applies/);
  });

  it("refuses to submit when the figures moved under the plan", async () => {
    const bundle = bundleWith();
    const d = deps();
    const engine = createRenewEngine({ context, data, bundle, deps: d });
    const deltas = await confirm(engine, "renew the Line of Credit to 15 March 2029");
    const plan = await engine.stagePlan(deltas, context);
    // The org's read moves underneath the composed manifest.
    bundle.exposure!.facilities![0] = { ...line, maturityDate: "2027-09-30" };
    await expect(
      engine.execute({ stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" }),
    ).rejects.toThrow(/figures moved under this plan/);
  });

  it("refuses to submit a plan it never staged", async () => {
    const { engine } = engineOn();
    await expect(engine.execute({ stagingId: "x", planHash: "y", decisionToken: "z", approverUserId: "Fabian Goetzens" })).rejects.toThrow(/no plan to submit/);
  });
});

describe("the suggestion grammar never puts a current figure where a target belongs", () => {
  it("offers the maturing member with its date as context, and no invented target", () => {
    const pill = engineOn().engine.suggest()!;
    expect(pill.label).toBe("Renew the Line of Credit · matures Mar 15, 2027");
    expect(pill.say).toBe("renew the Line of Credit - $15,000,000.00");
    expect(pill.label).not.toMatch(/2029/);
  });

  it("advances only when a move has landed", async () => {
    const { engine } = engineOn();
    await confirm(engine, "renew the Line of Credit to 15 March 2029");
    expect(engine.suggest()!.label).toBe("Reprice the Line of Credit");
  });
});
