// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearComposed } from "./engine";
import { addressManifest } from "./manifest";
import { createModifyEngine, WorkroomRefusalError, type ModifyEngineDeps } from "./modifyEngine";
import { assertNoRecordIds } from "../actions/stagedPlan";
import { validatePlan } from "../actions/transitionAllowlist";
import type { BorrowerBundle, C360Data, Facility } from "../data/contract";
import type { WorkroomContext, WorkroomDelta } from "./types";

/* =============================================================================
   THE REAL ENGINE, ON A MOCKED CHANNEL.

   What is proved here is the wiring, not a storyline:

     - the ORDERED composer (W1): step 1 is the credit-action clone and the
       mutations that follow land on it, in the org's own order;
     - the FIELD CATALOG mapping: a sentence becomes the request key the tool
       actually accepts, and LLC_BI__InterestRate__c is the field it names;
     - the HONEST HANDOFF: an amendment no tool files is staged, excluded from
       the payload, and reported as not filed;
     - the GOVERNANCE the ConfirmGate carries: allowlist, no record ids in a
       staged plan, a drift recompute, the org's approver id, one use of one
       token.

   The channel is mocked exactly as `writeTools.test.ts` mocks it — the tool
   wrappers are the real ones, and what is faked is the connector.
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
  // The composed manifest is held in MODULE scope so a close does not lose it,
  // which means it outlives a test the way it outlives a room.
  clearComposed();
});

/* ------------------------------------------------------------------ fixture */

/* THE REAL HARTWELL PACKAGE, read live from bankinggpt on 2026-08-27: seven
   members, the $15.0MM Line of Credit booked and open, the $3.0MM Equipment
   showcase member at Proposal. The org calls it a "Line of Credit"; the word
   "revolver" appears nowhere in the data, which is why the parser carries the
   vocabulary and these fixtures do not. */

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
  maturityDate: "2027-03-15",
  // The roll-over baseline the clone would carry, as the org holds it.
  loanCovenants: [{ id: "a4Vbb000000pNIjEAM", name: "COV-0107", covenantType: "Accounts Receivable", covenantId: "a3Bbb000000S0bNEAS" }],
  collateral: [
    // The DESCRIPTIONS matter to the pledge wave: a banker names an asset the way
    // the read describes it, never by its autonumber, and both of these share a
    // word on purpose so an ambiguous line has something real to be ambiguous
    // between.
    { loanId: LINE_ID, collateralId: "a35bb0000013xz3AAA", collateralName: "COL-000762", collateralDescription: "Duluth warehouse", amountPledged: 8_000_000, advanceRate: 80, lienPosition: "1st", pledgedStatus: "Inactive" },
    { loanId: LINE_ID, collateralId: "a35bb0000013y0fAAA", collateralName: "COL-000763", collateralDescription: "Duluth machine shop", amountPledged: 4_000_000, advanceRate: 50, lienPosition: "1st", pledgedStatus: "Inactive" },
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
};

/** The showcase member. Proposal stage: never a modification target. */
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
    snapshot: {
      accountId: "001bb00001I7FPNAA3",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE_ID,
      packageStage: "Complete",
      primaryRiskRating: "4",
    },
    exposure: {
      totalCommitted: 46_000_000,
      totalOutstanding: 31_030_000,
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
      // The four involvement rows the org holds on the Line of Credit.
      legalEntities: [
        { accountName: "Hartwell Precision Manufacturing LLC", borrowerType: "Borrower", loanId: LINE_ID, packageId: PACKAGE_ID },
        { accountName: "Hartwell Industrial Holdings LLC", borrowerType: "Guarantor", loanId: LINE_ID, packageId: PACKAGE_ID },
        { accountName: "James Hartwell", borrowerType: "Guarantor", loanId: LINE_ID, packageId: PACKAGE_ID },
        { accountName: "Elena Hartwell", borrowerType: "Limited Guarantor", loanId: LINE_ID, packageId: PACKAGE_ID },
      ],
      // The household around the deal: related, and NOT on it yet.
      connections: [{ counterpartyName: "Hartwell Logistics LLC", role: "Subsidiary", ownershipPercent: 100, isActive: true }],
    },
    requests: [
      {
        id: "req-1",
        channel: "email",
        receivedAt: "2026-08-27T08:02:00Z",
        summary: "Increase the operating line to fund the Kokomo tooling ramp.",
        ask: { type: "facility_increase", from: 15_000_000, to: 20_000_000, facilityName: "Line of Credit" },
      },
    ],
  };
}

const data = { meta: { anchorAccountId: "001bb00001DLtRMAA1", generatedAt: "2026-08-27T08:00:00Z", user: "Fabian Goetzens", userId: "005bb00000ftouDAAQ" } } as unknown as C360Data;

const context: WorkroomContext = {
  mode: "modify",
  door: "package",
  accountId: "001bb00001DLtRMAA1",
  accountName: "Hartwell Precision Manufacturing LLC",
  productPackageId: PACKAGE_ID,
  packageName: "Hartwell Precision Manufacturing LLC credit package",
  approver: "Fabian Goetzens",
};

/* THE OBSERVED ENVELOPES, trimmed to what the wrappers read. Every key below
   appears verbatim in `knowledge/sf-build-v2/wp2/observed-envelopes-execute-loan-modification.json`. */

const STAGE_RESULT = {
  stagingId: "a8abb00001N6Z0XAAV",
  planHash: "962ba9589fe41637d48392575f63dd2cfb25245fe7f54e615de38de67847ed8c",
  decisionToken: "8fc5099ec8f0a9fa83dc7c6c39c4ed7f76e07d6b8494e7f0bf0d6bd29285ee86",
  replayed: false,
  accountId: "001bb00001DLtRMAA1",
  productPackageId: PACKAGE_ID,
  summary: "Plans a modification on the package.",
  warnings: ["Execution is available."],
  executionHeld: false,
  facilityCount: 1,
  facilities: [{ facilityId: LINE_ID, facilityName: line.name, creditActionStepId: "credit_action_0", verifyStepId: "verify_clone_0", applyStepId: "apply_changes_0", covenantCarryoverCount: 0 }],
  steps: [
    { id: "credit_action_0", type: "write", label: "Invoke the modification credit action on the package", objectName: "LLC_BI__Loan__c", fields: ["clone created by nCino"], state: "pending" },
    { id: "verify_clone_0", type: "verification", label: "Re-query for the new facility and its junction row", objectName: "LLC_BI__LoanRenewal__c", fields: ["LLC_BI__ParentLoanId__c"], state: "pending" },
    { id: "apply_changes_0", type: "write", label: "Apply the requested changes to the new facility", objectName: "LLC_BI__Loan__c", fields: ["LLC_BI__Amount__c", "LLC_BI__Maturity_Date__c", "LLC_BI__InterestRate__c", "LLC_BI__Term_Months__c"], state: "pending" },
    { id: "observe_side_effects", type: "observed_side_effect", label: "Stage-driven email alerts", state: "pending" },
    { id: "held_execution", type: "handoff", label: "HANDOFF: booking the modification is nCino's own approval run", state: "pending" },
  ],
};

const EXECUTE_RESULT = {
  terminalState: "success",
  stagingId: STAGE_RESULT.stagingId,
  replayed: false,
  recordName: "Hartwell - Revolving line of credit - $20,000,000",
  outcome: "Modification created at stage Qualification. The parent was not touched.",
  facilityCount: 1,
  facilities: [
    {
      facilityId: LINE_ID,
      facilityName: line.name,
      cloneLoanId: "a4Zbb000002Br6HEAS",
      cloneName: "Hartwell - Revolving line of credit - $20,000,000",
      cloneStage: "Qualification",
      junctionId: "a4Obb000000FXGcEAO",
      junctionName: "RL-00000198",
      revisionNumber: 1,
      parentUnchanged: true,
      appliedChanges: "Amount reads back at 20000000.00.",
      verification: "the clone reads back with Is_Modification true; chain row RL-00000198 records revision 1.",
    },
  ],
  cloneLoanId: "a4Zbb000002Br6HEAS",
  /* THE VERSION THE CREDIT ACTION ROLLED THE PACKAGE INTO. Observed live
     2026-09-03 12:15:22 on the run recorded in `settleExecution.ts`; the sheet's
     "version <v>" clause and the dossier's deep link both read it. */
  outputPackageId: "a5Fbb000000J61hEAC",
  bookingHandoff: "Booking it requires nCino's Submit for Approval with real approvers. Nothing here has been approved.",
  steps: STAGE_RESULT.steps.map((s) => ({ ...s, state: "verified" })),
};

/** A deps set whose stage/execute are the observed envelopes, and whose LLM
 *  assist is off unless a test turns it on. */
function deps(over: Partial<ModifyEngineDeps> = {}): ModifyEngineDeps {
  return {
    stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT }),
    execute: vi.fn().mockResolvedValue({ ok: true, result: EXECUTE_RESULT }),
    available: () => true,
    newKey: () => "wr-test-key",
    restate: undefined,
    ...over,
  };
}

function engineOn(over: Partial<ModifyEngineDeps> = {}, bundle: BorrowerBundle | null = bundleWith()) {
  const d = deps(over);
  return { engine: createModifyEngine({ context, data, bundle, deps: d }), deps: d };
}

async function confirm(engine: ReturnType<typeof createModifyEngine>, line: string): Promise<WorkroomDelta[]> {
  const result = await engine.parseIntent(line, context);
  if (result.kind !== "deltas") throw new Error(`${line} → ${result.kind}: ${result.reply}`);
  return result.deltas;
}

/* --------------------------------------------------------------------------- */

describe("the modify engine reads the real package", () => {
  it("resolves the strip, the members and the covenants from the bundle, and is not scripted", () => {
    const { engine } = engineOn();
    expect(engine.scripted).toBe(false);
    const brief = engine.brief(context);
    expect(brief.baselineMembers).toBe(3);
    expect(brief.baselineCommittedMM).toBe(26);
    expect(brief.covenantFigure).toBe("2/2");
    expect(brief.loadSteps.at(-1)).toBe("Ready");
    // The chip says the PRODUCT; the amount beside it tells two lines apart.
    expect(brief.members.map((m) => m.short)).toContain("Line of Credit");
    expect(brief.members.find((m) => m.short === "Line of Credit")!.amount).toBe("$15.0MM");
  });

  it("marks a member that is NOT booked as pending work (W4)", () => {
    const brief = engineOn().engine.brief(context);
    const booked = brief.members.find((m) => m.key === "Line of Credit")!;
    const staged = brief.members.find((m) => m.amount === "$3.0MM")!;
    expect(booked.proposed).toBe(false);
    expect(booked.tag).toBe("Booked");
    expect(staged.proposed).toBe(true);
    expect(staged.tag).toBe("Proposal");
  });

  it("says stage-not-staged rather than calling an unknown member booked", () => {
    const blind = bundleWith([{ ...line, stage: undefined }, equipment]);
    const brief = createModifyEngine({ context, data, bundle: blind, deps: deps() }).brief(context);
    expect(brief.members.every((m) => m.proposed)).toBe(true);
    expect(brief.members[0].tag).toBe("Stage not staged");
  });

  it("answers its own question, so a bare figure completes the instruction", async () => {
    const { engine } = engineOn();
    // No figure in the line: the room asks rather than inventing one.
    const asked = await engine.parseIntent("increase the line of credit - $15,000,000.00", context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/what should commitment amount become/i);

    // And the answer alone is a complete instruction.
    const answered = await engine.parseIntent("$20,000,000", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].wire).toEqual({ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID });
  });

  it("takes 'hold' as keep-current instead of re-asking the same question forever", async () => {
    const { engine } = engineOn();
    const asked = await engine.parseIntent("change the rate on the Line of Credit", context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/what rate should it move to/i);

    // "hold" holds the field at its current figure and does NOT re-emit the
    // question. This was the loop: an unrecognised answer re-asked itself.
    const held = await engine.parseIntent("hold", context);
    expect(held.kind).toBe("unparsed");
    if (held.kind !== "unparsed") return;
    expect(held.reply).toMatch(/holding/i);
    expect(held.reply).toContain("7.6%");
    expect(held.reply).not.toMatch(/what rate should it move to/i);

    // AND THE QUESTION IS GONE. A bare "8%" would stage a rate ONLY if the room
    // were still waiting on the rate; with the field held, it is just a number
    // attached to no field, so it never becomes a rate delta.
    const after = await engine.parseIntent("8%", context);
    expect(after.kind).not.toBe("deltas");
  });

  it("does not read 'keep it at 7%' as hold — the figure is the answer", async () => {
    const { engine } = engineOn();
    await engine.parseIntent("change the rate on the Line of Credit", context);
    const answered = await engine.parseIntent("keep it at 7%", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].wire).toEqual({ key: "requestedRate", value: 7, facilityId: LINE_ID });
  });

  it("will not invent a target figure when no client ask exists", () => {
    const noAsk = bundleWith();
    delete noAsk.requests;
    const engine = createModifyEngine({ context, data, bundle: noAsk, deps: deps() });
    const pill = engine.suggest()!;
    // A CURRENT FIGURE NEVER SITS WHERE A DELTA BELONGS. The org names a loan
    // "<Borrower> - <Product> - <$Amount>", so a pill built on that name read
    // "Increase the Line of Credit - $15,000,000.00" — which a banker parses as
    // "increase BY fifteen million", and which then made the room's own
    // question look like a second ask for a number it had already offered.
    expect(pill.label).toBe("Line of Credit · $15M committed");
    expect(pill.label).not.toMatch(/increase/i);
    // The instruction behind it still names the member precisely enough to
    // resolve one of six, and asks rather than inventing a target.
    expect(pill.say).toBe("change the commitment on the Line of Credit - $15,000,000.00");
  });

  it("asks for the target once, with today's figure as context rather than as the ask", async () => {
    const noAsk = bundleWith();
    delete noAsk.requests;
    const engine = createModifyEngine({ context, data, bundle: noAsk, deps: deps() });
    const asked = await engine.parseIntent(engine.suggest()!.say, context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/what should commitment amount become/i);
    expect(asked.reply).toContain("Today it reads $15M");
    // AND THE PILL HOLDS while the question is open. Offering an unrelated next
    // move under a pending question puts two moves on the table at once.
    expect(engine.suggest()).toBeNull();
  });

  it("leads on the client's own ask where the read carries one, and closes it at package altitude", () => {
    const { engine } = engineOn();
    const brief = engine.brief(context);
    expect(brief.askPin).toContain("$20M");
    // The pill carries the CLIENT's number, which is a real target and so reads
    // as one. The member is named by product, never by the name that prints its
    // current commitment.
    expect(engine.suggest()!.label).toBe("Take the Line of Credit to $20M");
    // Founder law: the loans are where the money is, the package is what counts,
    // and it rolls up. So the one sentence closes on the package total.
    expect(brief.position).toContain("moves the package to $31M");
  });

  it("states plainly when nothing on the package is booked", () => {
    const none = bundleWith([{ ...line, stage: "Proposal" }]);
    const brief = createModifyEngine({ context, data, bundle: none, deps: deps() }).brief(context);
    expect(brief.position).toMatch(/none of them is booked/i);
  });
});

/* =============================================================================
   WAVE 2 — THE OPENER LEADS ON THE DEAL'S NEXT MOVE.

   `nextMove.ts` carries its own exhaustive date-math coverage in isolation
   (nextMove.test.ts): edge days, ties, missing fields, priority order. What is
   proved HERE is the WIRING — that `position()` reaches for it, in the right
   place relative to the two things that already outrank it (an unanchored
   room, a client's own ask), and falls back to the original inventory
   sentence exactly as before where no move applies. `data.meta.generatedAt`
   is "2026-08-27T08:00:00Z" throughout, from the module fixture above.
   ============================================================================= */
describe("the opener leads on the deal's next move (wave 2)", () => {
  it("leads on a facility maturing within the coming quarter, with no client ask staged", () => {
    const soon = bundleWith([{ ...line, maturityDate: "2026-09-10" }, equipment, proposal]);
    delete soon.requests;
    const brief = createModifyEngine({ context, data, bundle: soon, deps: deps() }).brief(context);
    expect(brief.position).toBe("The $15M Line of Credit matures in 14 days. Start the renewal?");
  });

  it("leads on a covenant test due soon when nothing is maturing inside the quarter", () => {
    const due = bundleWith();
    delete due.requests;
    due.covenants!.covenants![0] = { ...due.covenants!.covenants![0], nextEvaluationDate: "2026-09-06" };
    const brief = createModifyEngine({ context, data, bundle: due, deps: deps() }).brief(context);
    expect(brief.position).toBe("The Fixed Charge Coverage covenant is due in 10 days. Start the review?");
  });

  it("leads on utilization when the package is drawn hard and neither of the first two tiers applies", () => {
    const drawn = bundleWith([
      { ...line, outstanding: 14_500_000 },
      { ...equipment, outstanding: 7_800_000 },
      proposal,
    ]);
    delete drawn.requests;
    const brief = createModifyEngine({ context, data, bundle: drawn, deps: deps() }).brief(context);
    expect(brief.position).toBe("The package is drawn to 86% of commitment. Worth a headroom conversation?");
  });

  it("still leads on the client's own ask even where a facility also matures within the quarter", () => {
    // request?.ask?.to already outranks the fallback inventory sentence
    // (proven above); this proves it outranks the DERIVED move too — a human
    // waiting on an answer beats a signal the room noticed on its own.
    const both = bundleWith([{ ...line, maturityDate: "2026-09-10" }, equipment, proposal]);
    const brief = createModifyEngine({ context, data, bundle: both, deps: deps() }).brief(context);
    expect(brief.position).toContain("The client has asked to take the Line of Credit to $20M");
    expect(brief.position).not.toContain("Start the renewal");
  });

  it("falls back to the original inventory sentence where no move applies at all", () => {
    const quiet = bundleWith();
    delete quiet.requests;
    const brief = createModifyEngine({ context, data, bundle: quiet, deps: deps() }).brief(context);
    // Neither facility matures soon (2027-03-15, and Equipment carries no
    // maturityDate), neither covenant has a nextEvaluationDate, and utilization
    // sits at 15.1/26 ≈ 58% — nothing in any tier, so this is the room's
    // ORIGINAL sentence, unchanged by wave 2.
    expect(brief.position).toBe("$23M of $26M is open: 2 of 3 members are booked. Pick one.");
  });
});

describe("parseIntent maps a sentence onto the catalog", () => {
  it("turns a commitment increase into a fileable delta on the named member", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    expect(delta.fileable).toBe(true);
    expect(delta.wire).toEqual({ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID });
    expect(delta.before).toBe("$15M");
    expect(delta.after).toBe("$20M");
    expect(delta.fields).toEqual(["LLC_BI__Loan__c.LLC_BI__Amount__c"]);
  });

  it("NEVER prints a member's current figure beside the delta that moves it", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    // The chip renders `target` directly above `before → after`. Carrying the
    // org's loan name there put "$15,000,000.00" one line above "$15M → $20M" —
    // the same figure twice, in two different roles, one of them wrong.
    expect(delta.target).toBe("Line of Credit");
    expect(delta.target).not.toMatch(/\$/);
    expect(`${delta.before} → ${delta.after}`).toBe("$15M → $20M");
  });

  it("tells two members of the same product apart by the figure that separates them", async () => {
    // Two lines of credit: the product alone names neither, so the commitment
    // comes back — as an identifier this time, which is what it actually is.
    const second: Facility = { ...line, loanId: "a4Zbb0000027SECOND", name: "Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00", committed: 2_500_000 };
    const engine = createModifyEngine({ context, data, bundle: bundleWith([line, equipment, second]), deps: deps() });
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    expect(delta.target).toBe("Line of Credit ($15M)");
  });

  it("names LLC_BI__InterestRate__c for a rate change, and never the field that does not exist", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "move the rate on the line of credit - $15,000,000.00 to 8.1%");
    expect(delta.wire).toEqual({ key: "requestedRate", value: 8.1, facilityId: LINE_ID });
    expect(delta.fields).toEqual(["LLC_BI__Loan__c.LLC_BI__InterestRate__c"]);
    expect(delta.fields.join()).not.toContain("LLC_BI__Interest_Rate__c");
  });

  it("offers the org's legal values as CLICKABLE options when a picklist value is wrong", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("change the payment schedule to fortnightly on the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toContain("The org offers");
    // The chips ARE the org's list, and each one, clicked, is a complete answer
    // to the open question through the same parser a typed value rides.
    expect(result.options?.map((o) => o.label)).toContain("Monthly");
    expect(result.options?.map((o) => o.say)).toContain("Quarterly");

    const answered = await engine.parseIntent("Monthly", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].fieldWire).toMatchObject({ field: "LLC_BI__Payment_Schedule__c", value: "Monthly" });
  });

  it("stages a mapped, thresholded covenant as FILEABLE, targeted at the member's clone", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add a leverage covenant max 3.5x to the line of credit - $15,000,000.00");
    expect(delta.fileable).toBe(true);
    expect(delta.wire).toBeUndefined();
    expect(delta.covenantWire).toMatchObject({ typeName: "Leverage", threshold: 3.5, operator: "<=", facilityId: LINE_ID });
    expect(delta.handoff).toBeUndefined();
    expect(delta.filed.recordId).toBe("assigned by the org on execution");
  });

  it("sends the covenant add on the wire as covenantAddsJson, anchored on its member", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a leverage covenant max 3.5x to the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.facilityIds).toEqual([LINE_ID]);
    const adds = JSON.parse(payload.covenantAddsJson);
    expect(adds).toEqual([
      { typeName: "Leverage", threshold: 3.5, operator: "<=", frequency: "Quarterly", targetLoanId: LINE_ID },
    ]);
  });

  it("stages an out-of-scope amendment as NOT fileable, with the reason on it", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00");
    expect(delta.fileable).toBe(false);
    expect(delta.wire).toBeUndefined();
    expect(delta.handoff?.reason).toMatch(/cannot settle against the org catalog/);
    expect(delta.handoff?.closes).toBeTruthy();
    expect(delta.filed.recordId).toBe("not filed");
  });

  it("stages a PERCENTAGE fee as fileable, and sets no amount the org will compute itself", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add a 1% origination fee to the line of credit - $15,000,000.00");
    expect(delta.fileable).toBe(true);
    expect(delta.feeWire).toMatchObject({
      feeType: "Loan Origination",
      calculationType: "Percentage",
      percentage: 1,
      recordType: "Fees",
      facilityId: LINE_ID,
    });
    // THE ORG COMPUTES THE MONEY on a percentage fee, so the room sends none.
    expect(delta.feeWire!.amount).toBeUndefined();
    expect(delta.feeWire!.description).toBe("Origination fee - 1.00% of the committed amount");
    // The chip names the fee, not the catalog's category word for it.
    expect(delta.title).toBe("Origination fee");
    expect(delta.badge).toBe("Origination fee → 1.00% of the committed amount");
    expect(delta.target).toBe("Line of Credit");
    expect(delta.handoff).toBeUndefined();
    expect(delta.filed.recordId).toBe("assigned by the org on execution");
  });

  it("stages a FLAT fee with its amount, on the member the line named", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add a $5,000 attorney fee to the equipment - $8,000,000.00");
    expect(delta.fileable).toBe(true);
    expect(delta.feeWire).toMatchObject({
      feeType: "Attorney",
      calculationType: "Flat Amount",
      amount: 5000,
      facilityId: EQUIPMENT_ID,
    });
    expect(delta.feeWire!.percentage).toBeUndefined();
  });

  it("maps a C&I fee the org's residential picklist cannot express onto Other, with the banker's words", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add a 25bps unused commitment fee to the line of credit - $15,000,000.00");
    expect(delta.feeWire).toMatchObject({ feeType: "Other", calculationType: "Percentage", percentage: 0.25 });
    // The autonumber Name cannot carry the banker's phrase, so the description does.
    expect(delta.feeWire!.description).toContain("Unused commitment fee");
  });

  it("asks WHICH KIND when the line says fee and nothing else, then completes on the answer alone", async () => {
    const { engine } = engineOn();
    const asked = await engine.parseIntent("add a 1% fee to the line of credit - $15,000,000.00", context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/what kind of fee/i);
    expect(asked.options?.map((o) => o.label)).toContain("Origination fee");

    // The answer is the missing half; the figure and the member were settled.
    const answered = await engine.parseIntent("origination fee", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].feeWire).toMatchObject({
      feeType: "Loan Origination",
      calculationType: "Percentage",
      percentage: 1,
      facilityId: LINE_ID,
    });
  });

  it("asks HOW MUCH when the kind is settled and the figure is not", async () => {
    const { engine } = engineOn();
    const asked = await engine.parseIntent("add an origination fee to the line of credit - $15,000,000.00", context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/how much is the origination fee/i);

    const answered = await engine.parseIntent("0.75%", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    expect(answered.deltas[0].feeWire).toMatchObject({ feeType: "Loan Origination", percentage: 0.75 });
  });

  it("sends the fee add on the wire as feeAddsJson, beside a scalar on the same member", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a 1% origination fee to the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.facilityIds).toEqual([LINE_ID]);
    expect(JSON.parse(payload.feeAddsJson)).toEqual([
      {
        feeType: "Loan Origination",
        description: "Origination fee - 1.00% of the committed amount",
        calculationType: "Percentage",
        percentage: 1,
        recordType: "Fees",
        targetLoanId: LINE_ID,
      },
    ]);
  });

  it("aims a fee at its OWN member in a mixed plan, exactly as the scalars do", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a $5,000 attorney fee to the equipment - $8,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The fee's member joins the selection, so the scalar must ride targeted:
    // broadcasting the amount would take the equipment clone to $20MM too.
    expect(payload.requestedAmount).toBeNull();
    expect(JSON.parse(payload.scalarChangesJson)).toEqual([
      { key: "requestedAmount", value: 20_000_000, targetLoanId: LINE_ID },
    ]);
    const fees = JSON.parse(payload.feeAddsJson);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ calculationType: "Flat Amount", amount: 5000, targetLoanId: EQUIPMENT_ID });
    expect(fees[0].percentage).toBeUndefined();
  });

  it("pledges an EXISTING asset onto the clone, aimed at the member the line named", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "pledge the Duluth warehouse to the equipment - $8,000,000.00");
    expect(delta.fileable).toBe(true);
    expect(delta.pledgeWire).toMatchObject({ collateralId: "a35bb0000013xz3AAA", facilityId: EQUIPMENT_ID });
    expect(delta.pledgeWire!.newCollateral).toBeUndefined();
    // The chip names the ASSET, not the catalog's category word for it.
    expect(delta.title).toBe("Duluth warehouse");
    expect(delta.badge).toBe("Duluth warehouse → pledged on the modification");
    expect(delta.target).toBe("Equipment ($8M)");
    expect(delta.handoff).toBeUndefined();
    expect(delta.map.find(([k]) => k === "Written as")![1]).toContain("LLC_BI__Loan_Collateral2__c");
  });

  it("asks amend-or-add when the asset is already pledged to the member the line names", async () => {
    const { engine } = engineOn();
    // COL-000762 secures the Line of Credit today, and a modification carries it
    // onto the clone: pledging it again there is a duplicate, not a second lien.
    const result = await engine.parseIntent("pledge the Duluth warehouse to the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toMatch(/Duluth warehouse is already on/);

    const second = await engine.parseIntent("pledge the Duluth warehouse to the line of credit - $15,000,000.00 as well", context);
    expect(second.kind).toBe("deltas");
  });

  it("creates then pledges a NET-NEW asset, and sends the whole chain on one wire entry", async () => {
    const { engine, deps: d } = engineOn();
    const asked = await engine.parseIntent(
      "add a new $2M piece of equipment as collateral on the equipment - $8,000,000.00",
      context,
    );
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    expect(asked.reply).toMatch(/advance rate/i);

    const answered = await engine.parseIntent("80%", context);
    expect(answered.kind).toBe("deltas");
    if (answered.kind !== "deltas") return;
    const delta = answered.deltas[0];
    expect(delta.fileable).toBe(true);
    expect(delta.pledgeWire).toMatchObject({
      newCollateral: { description: "New piece of equipment", collateralType: "Equipment", value: 2_000_000 },
      advanceRate: 80,
      facilityId: EQUIPMENT_ID,
    });
    expect(delta.pledgeWire!.collateralId).toBeUndefined();
    // The banker is told the chain, in the order the arm writes it.
    const written = delta.map.find(([k]) => k === "Written as")![1];
    expect(written).toContain("LLC_BI__Collateral__c");
    expect(written).toContain("LLC_BI__Account_Collateral__c");

    await engine.stagePlan(answered.deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.parse(payload.pledgeAddsJson)).toEqual([
      {
        newCollateral: { description: "New piece of equipment", collateralType: "Equipment", value: 2_000_000 },
        advanceRate: 80,
        targetLoanId: EQUIPMENT_ID,
      },
    ]);
  });

  it("sends a pledge on the wire as pledgeAddsJson, per target like every record wave", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "pledge the Duluth machine shop to the equipment - $8,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The pledge's member joins the selection, so the scalar rides targeted.
    expect(payload.requestedAmount).toBeNull();
    expect(JSON.parse(payload.pledgeAddsJson)).toEqual([
      { collateralId: "a35bb0000013y0fAAA", targetLoanId: EQUIPMENT_ID },
    ]);
  });

  it("logs a policy exception on the clone, and the chip is named after what is out of policy", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(
      engine,
      "log a policy exception: advance rate above guideline on the equipment - $8,000,000.00, mitigated by the personal guaranty",
    );
    expect(delta.fileable).toBe(true);
    expect(delta.policyExceptionWire).toEqual({
      title: "Advance rate above guideline",
      status: "Mitigated",
      reasons: ["the personal guaranty"],
      severity: undefined,
      facilityId: EQUIPMENT_ID,
    });
    // The chip names the exception, not the catalog's category word for it.
    expect(delta.title).toBe("Advance rate above guideline");
    expect(delta.badge).toBe("Advance rate above guideline → mitigated by the personal guaranty");
    expect(delta.target).toBe("Equipment ($8M)");
    expect(delta.handoff).toBeUndefined();
    const written = delta.map.find(([k]) => k === "Written as")![1];
    expect(written).toContain("LLC_BI__Policy_Exception__c");
    expect(written).toContain("LLC_BI__Relationship__c");
    // THE EGRESS REACHES THE BANKER. A committed write here POSTs the record to
    // the bank's own AWS endpoint, and the person confirming is entitled to know.
    expect(written).toContain("PolicyExceptionCDC");
  });

  it("sends the exception on the wire as policyExceptionAddsJson, per target like every record wave", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(
        engine,
        "log a policy exception: advance rate above guideline on the equipment - $8,000,000.00, mitigated by the personal guaranty",
      )),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The exception's member joins the selection, so the scalar rides targeted:
    // broadcasting the amount would take the equipment clone to $20MM too.
    expect(payload.requestedAmount).toBeNull();
    expect(JSON.parse(payload.policyExceptionAddsJson)).toEqual([
      {
        title: "Advance rate above guideline",
        status: "Mitigated",
        mitigationReasons: ["the personal guaranty"],
        targetLoanId: EQUIPMENT_ID,
      },
    ]);
  });

  it("omits the mitigation key entirely on an exception that has none", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await confirm(
      engine,
      "log a policy exception: hold limit exceeded on the line of credit - $15,000,000.00, unmitigated",
    );
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const [entry] = JSON.parse(payload.policyExceptionAddsJson);
    // An absent key is "nobody said"; a null one would be an answer.
    expect(entry).toEqual({ title: "Hold limit exceeded", status: "Unmitigated", targetLoanId: LINE_ID });
  });

  it("walks the exception clarify chain from the room, question by question", async () => {
    const { engine } = engineOn();
    const named = await engine.parseIntent(
      "log a policy exception on the equipment - $8,000,000.00",
      context,
    );
    expect(named.kind).toBe("unparsed");
    if (named.kind !== "unparsed") return;
    expect(named.reply).toMatch(/what should the exception be called/i);

    const status = await engine.parseIntent("advance rate above guideline", context);
    expect(status.kind).toBe("unparsed");
    if (status.kind !== "unparsed") return;
    expect(status.options?.map((o) => o.label)).toEqual(["Waived", "Mitigated", "Unmitigated"]);

    const mitigant = await engine.parseIntent("Mitigated", context);
    expect(mitigant.kind).toBe("unparsed");
    if (mitigant.kind !== "unparsed") return;
    expect(mitigant.reply).toMatch(/what mitigates it/i);

    const done = await engine.parseIntent("the personal guaranty from James Hartwell", context);
    expect(done.kind).toBe("deltas");
    if (done.kind !== "deltas") return;
    expect(done.deltas[0].policyExceptionWire).toMatchObject({
      title: "Advance rate above guideline",
      status: "Mitigated",
      reasons: ["the personal guaranty from James Hartwell"],
      facilityId: EQUIPMENT_ID,
    });
  });

  it("stages a structure change WITHOUT a member as a handoff, and WITH one as a filing delta (W1)", async () => {
    const { engine } = engineOn();
    // No member named: the org anchors every involvement row on one loan, so
    // this cannot file — it travels as an honest handoff.
    const [add] = await confirm(engine, "add Hartwell Logistics LLC as a guarantor");
    expect(add.fileable).toBe(false);
    expect(add.target).toBe("Hartwell Logistics LLC");
    expect(add.handoff?.reason).toMatch(/names the MEMBER/);

    const [remove] = await confirm(engine, "remove the guarantor Elena Hartwell");
    expect(remove.fileable).toBe(false);
    expect(remove.handoff?.reason).toMatch(/names the member/);

    // Member named: the add authors the row on the CLONE, the remove is a
    // CARRY EXCLUSION resolved by the org at stage time.
    const [filedAdd] = await confirm(engine, "add Hartwell Logistics LLC as a limited guarantor on the line of credit - $15,000,000.00");
    expect(filedAdd.fileable).toBe(true);
    expect(filedAdd.involvementWire).toMatchObject({ op: "add", role: "Limited Guarantor", accountName: "Hartwell Logistics LLC", facilityId: LINE_ID });

    const [filedRemove] = await confirm(engine, "remove the guarantor Elena Hartwell from the line of credit - $15,000,000.00");
    expect(filedRemove.fileable).toBe(true);
    expect(filedRemove.involvementWire).toMatchObject({ op: "remove", accountName: "Elena Hartwell", facilityId: LINE_ID });
    expect(filedRemove.filed.recordId).toBe("a carry exclusion writes nothing");
  });

  it("NEVER titles a removal as an addition, whichever catalog entry the line matched", async () => {
    const { engine } = engineOn();
    // "as guarantor" is a synonym of the ADD entry and the verb is a REMOVE, so
    // the chip used to read "Add a legal entity" directly above "off the
    // modification" — the one misread in a change set that actually matters.
    const [delta] = await confirm(engine, "remove James Hartwell as guarantor from the line of credit - $15,000,000.00");
    expect(delta.op).toBe("remove");
    expect(delta.title).toBe("Remove a legal entity");
    expect(delta.badge).toBe("Remove a legal entity → off the modification");
    expect(delta.involvementWire).toMatchObject({ op: "remove", accountName: "James Hartwell", facilityId: LINE_ID });
  });

  it("carries the op, the role and the member across its OWN question", async () => {
    const { engine } = engineOn();
    // The room asks who; the banker answers with the name and nothing else, and
    // the amendment completes from what the asking line already settled.
    const asked = await engine.parseIntent("remove the guarantor from the line of credit - $15,000,000.00", context);
    expect(asked.kind).toBe("unparsed");
    expect(asked.reply).toMatch(/which entity/i);

    const answered = await engine.parseIntent("James Hartwell", context);
    if (answered.kind !== "deltas") throw new Error(`${answered.kind}: ${answered.reply}`);
    expect(answered.deltas).toHaveLength(1);
    expect(answered.deltas[0].title).toBe("Remove a legal entity");
    expect(answered.deltas[0].involvementWire).toMatchObject({
      op: "remove",
      role: "Guarantor",
      accountName: "James Hartwell",
      facilityId: LINE_ID,
    });
  });

  it("reads a bare figure against a label that states its own unit", async () => {
    const { engine } = engineOn();
    // The org labels the field "Amortized Term (Months)". Quoting that label and
    // saying 240 has already said the unit, so the room does not ask which.
    const deltas = await confirm(engine, "set the Amortized Term (Months) on the line of credit - $15,000,000.00 to 240");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].fieldWire).toMatchObject({ field: "LLC_BI__Amortized_Term_Months__c", value: 240, facilityId: LINE_ID });
  });

  it("sends structure changes on the wire as involvementChangesJson", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "add Hartwell Logistics LLC as a limited guarantor on the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const changes = JSON.parse(payload.involvementChangesJson);
    expect(changes).toEqual([
      { op: "add", role: "Limited Guarantor", accountName: "Hartwell Logistics LLC", ownership: undefined, targetLoanId: LINE_ID },
    ]);
    expect(payload.facilityIds).toEqual([LINE_ID]);
  });

  it("stages a curated loan field as FILEABLE, carrying the org's own picklist value", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "change the payment schedule to monthly on the line of credit - $15,000,000.00");
    expect(delta.fileable).toBe(true);
    // It rides fieldChangesJson, not one of the four request keys.
    expect(delta.wire).toBeUndefined();
    expect(delta.fieldWire).toMatchObject({ field: "LLC_BI__Payment_Schedule__c", value: "Monthly", facilityId: LINE_ID });
    expect(delta.handoff).toBeUndefined();
    expect(delta.filed.recordId).toBe("assigned by the org on execution");
    // The chip says who settles the field name, because it is not this client.
    expect(delta.map.find(([label]) => label === "Written as")![1]).toMatch(/resolved against the org's live describe/);
  });

  it("files an amortisation as months, and never on the term the tool already carries", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "amortize the line of credit - $15,000,000.00 over 20 years");
    // LLC_BI__Term_Months__c is the facility's own term and rides
    // requestedTermMonths; the amortisation is the schedule the payment is
    // struck on. Two fields, and a plan that confused them would move the wrong
    // one silently.
    expect(delta.wire).toBeUndefined();
    expect(delta.fieldWire).toMatchObject({ field: "LLC_BI__Amortized_Term_Months__c", value: 240, facilityId: LINE_ID });
  });

  it("sends curated fields as fieldChangesJson, and leaves the key off a scalar-only plan", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "change the payment schedule to monthly on the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.parse(payload.fieldChangesJson)).toEqual([
      { field: "LLC_BI__Payment_Schedule__c", value: "Monthly", targetLoanId: LINE_ID },
    ]);
    // The scalar still rides its own request key, and both anchor one member.
    expect(payload.requestedAmount).toBe(20_000_000);
    expect(payload.facilityIds).toEqual([LINE_ID]);

    // THE KEY EXISTS ONLY WHEN FIELDS RIDE. A null would put the word on every
    // scalar-only payload and offer the org an empty change set to read.
    const scalar = engineOn();
    const only = await confirm(scalar.engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    await scalar.engine.stagePlan(only, context);
    const plain = (scalar.deps.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect("fieldChangesJson" in plain).toBe(false);
  });

  it("REFUSES an ask that belongs to another credit action rather than staging it", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("waive the covenant on the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("refusal");
    if (result.kind !== "refusal") return;
    expect(result.refusal.reason).toMatch(/founder-gated/);
  });

  it("does not parse a line it cannot read, and says what it can take", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("what is the weather in Kokomo", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toMatch(/could not map that onto this package/i);
    expect(result.reply).toMatch(
      /commitment, rate, maturity, term, covenants, entities, fees, collateral and policy exceptions all file on the clone/i,
    );
  });

  it("names the half of the line it DID read, so the refusal can be answered", async () => {
    const { engine } = engineOn();
    // A member the room holds, and nothing it can do to it. "I could not read an
    // amendment in that" is true and useless; naming what landed is the
    // difference between a question and a dead end.
    const result = await engine.parseIntent("have a look at the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    // Named by PRODUCT. The org's loan name prints that member's current
    // commitment inside it, and a live figure has no business appearing every
    // time the member is mentioned.
    expect(result.reply).toContain("I read the Line of Credit, but not what should change on it");
    expect(result.reply).not.toContain("$15,000,000.00");
  });

  it("lets the gateway RESTATE a line, and validates the restatement itself", async () => {
    const restate = vi.fn().mockResolvedValue("increase the line of credit - $15,000,000.00 to $20,000,000");
    const { engine } = engineOn({ restate });
    const result = await engine.parseIntent("give them another five on the operating line", context);
    expect(restate).toHaveBeenCalledOnce();
    expect(result.kind).toBe("deltas");
    if (result.kind !== "deltas") return;
    // The delta came out of the deterministic parser, not out of the model.
    expect(result.deltas[0].wire).toEqual({ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID });
  });

  it("does not take a restatement the parser cannot read either", async () => {
    const restate = vi.fn().mockResolvedValue("do something clever");
    const { engine } = engineOn({ restate });
    expect((await engine.parseIntent("hmm", context)).kind).toBe("unparsed");
  });
});

/* =============================================================================
   THE CONFIRM'S ANSWER.

   Founder verbatim, live UAT 2026-08-27: "the overall PP Amount is what
   counts... the loans in there is where obviously the money is and that rolls up
   to the PP". An acknowledgement that names only the member reports a row moving
   in a rail, which is why the loop read as dead even when something had happened.
   Every confirm closes on the package figure.
   ============================================================================= */

describe("acknowledge tells the banker what the confirm did to the PACKAGE", () => {
  it("restates a member change as its package consequence", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const { reply } = engine.acknowledge(delta, [delta]);
    expect(reply).toContain("$15M → $20M");
    // 26.0 committed today, +5.0 on the line.
    expect(reply).toContain("That takes the package from $26M to $31M.");
    expect(reply).toContain("Anything else on this facility, or shall I stage it?");
    // The member is named by PRODUCT. `delta.target` is the org's loan name and
    // prints that member's current commitment inside it, which is the reading
    // that made a pill say "Increase the Line of Credit - $15,000,000.00".
    expect(reply).toContain("Commitment amount on Line of Credit:");
  });

  it("says the package HELD where an entry moves no money", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add Hartwell Logistics LLC as a guarantor");
    const { reply } = engine.acknowledge(delta, [delta]);
    expect(reply).toContain("The package total holds at $26M.");
    expect(reply).toContain("on the manifest for the record");
  });

  it("adds up the whole manifest rather than the last entry", async () => {
    const { engine } = engineOn();
    const [first] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const [second] = await confirm(engine, "take the equipment - $8,000,000.00 to $10,000,000");
    const { reply } = engine.acknowledge(second, [first, second]);
    expect(reply).toContain("from $26M to $33M");
  });
});

describe("the check a confirm trips, on the org's own collateral", () => {
  it("fires on an increase and states the fully drawn position", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const { challenge } = engine.acknowledge(delta, [delta]);
    expect(challenge).toBeTruthy();
    // $34.6MM lendable against $31MM committed still covers it.
    expect(challenge!.verdict).toBe("Coverage holds");
    expect(challenge!.tone).toBe("ok");
    expect(challenge!.line).toContain("$34.60M of lendable collateral");
    expect(challenge!.line).toContain("1.12x");
  });

  it("warns when the pool no longer covers the commitment", async () => {
    const thin = bundleWith();
    thin.exposure!.totalUniqueCollateralLendableValue = 20_000_000;
    const engine = createModifyEngine({ context, data, bundle: thin, deps: deps() });
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const { challenge } = engine.acknowledge(delta, [delta]);
    expect(challenge!.verdict).toBe("Coverage thins");
    expect(challenge!.tone).toBe("warn");
  });

  it("NEVER re-derives the org's own coverage ratio, and says which is which", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const { challenge } = engine.acknowledge(delta, [delta]);
    // The org computes 1.13x over the distinct pool against what is DRAWN. A
    // commitment change does not move that, so the check reports it verbatim and
    // labels its own arithmetic as its own.
    expect(challenge!.say).toContain("1.13x");
    expect(challenge!.say).toContain("$31.03M drawn");
    expect(challenge!.say).toMatch(/is not the org's ratio/);
    expect(challenge!.kicker).toBe("Derived here from the org's collateral pool");
  });

  it("does not re-trip on an entry that moves no commitment", async () => {
    const { engine } = engineOn();
    const [money] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const [rate] = await confirm(engine, "move the rate on the line of credit - $15,000,000.00 to 8.1%");
    expect(engine.acknowledge(rate, [money, rate]).challenge).toBeUndefined();
  });

  it("stays quiet where the read carries no collateral pool to check against", async () => {
    const blind = bundleWith();
    delete blind.exposure!.totalUniqueCollateralLendableValue;
    const engine = createModifyEngine({ context, data, bundle: blind, deps: deps() });
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const ack = engine.acknowledge(delta, [delta]);
    expect(ack.challenge).toBeUndefined();
    // Quiet about the CHECK is not quiet about the confirm.
    expect(ack.reply).toContain("takes the package");
  });
});

describe("picking a member off the package strip", () => {
  it("opens the ask-what-changes beat and remembers the member", async () => {
    const { engine } = engineOn();
    const picked = engine.pick(LINE_ID)!;
    expect(picked.kind).toBe("unparsed");
    if (picked.kind !== "unparsed") return;
    expect(picked.reply).toContain("$15M committed");
    expect(picked.reply).toMatch(/what should change on it/i);

    // AND THE NEXT LINE DOES NOT HAVE TO NAME IT AGAIN. Without the focus this
    // package of three answers "which member?" about the member just clicked.
    const result = await engine.parseIntent("take it to $20,000,000", context);
    expect(result.kind).toBe("deltas");
    if (result.kind !== "deltas") return;
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0].wire).toEqual({ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID });
  });

  it("a named member still beats the one that was picked", async () => {
    const { engine } = engineOn();
    engine.pick(LINE_ID);
    const result = await engine.parseIntent("take the equipment - $8,000,000.00 to $10,000,000", context);
    expect(result.kind).toBe("deltas");
    if (result.kind !== "deltas") return;
    expect(result.deltas[0].wire!.facilityId).toBe(EQUIPMENT_ID);
  });

  it("says WHY a member that is not booked cannot be worked on", () => {
    const { engine } = engineOn();
    const picked = engine.pick(PROPOSAL_ID)!;
    expect(picked.kind).toBe("unparsed");
    if (picked.kind !== "unparsed") return;
    expect(picked.reply).toContain("at Proposal");
    expect(picked.reply).toMatch(/only runs against a booked facility/);
  });

  it("holds the suggestion back while its own question is open", () => {
    const { engine } = engineOn();
    expect(engine.suggest()).toBeTruthy();
    engine.pick(LINE_ID);
    expect(engine.suggest()).toBeNull();
  });

  it("hands the member back to the shell where it holds no such member", () => {
    expect(engineOn().engine.pick("a4Zbb00000NOTMINE")).toBeNull();
  });
});

/* =============================================================================
   ONE SESSION IS ONE PACKAGE IS ONE PLAN IS ONE APPROVAL.

   The credit action anchors on ONE product package and that anchor is the
   governance boundary, so a relationship carrying several chooses rather than
   defaulting to whichever the read listed first. The baked Hartwell relationship
   holds one package, so the multi-package branch is constructed here.
   ============================================================================= */

describe("a relationship carrying more than one package", () => {
  const SECOND_ID = "a5Fbb000000SECOND";
  const other: Facility = {
    loanId: "a4Zbb0000027OTHER",
    name: "Hartwell Precision Manufacturing LLC - Term - $9,000,000.00",
    productType: "Term",
    productPackageId: SECOND_ID,
    stage: "Booked",
    status: "Active",
    committed: 9_000_000,
  };
  const inReview: Facility = { ...other, loanId: "a4Zbb0000027REVIEW", stage: "Final Review" };

  const twoPackages = (second: Facility) => {
    const b = bundleWith([line, equipment, proposal, second]);
    b.snapshot!.productPackageId = PACKAGE_ID;
    return b;
  };
  /** Relationship altitude: no package named, so the room must ask. */
  const loose = { ...context, productPackageId: null, packageName: "Hartwell Precision Manufacturing LLC · 2 packages" };

  it("offers every package with its own total, and does not pick one", () => {
    const engine = createModifyEngine({ context: loose, data, bundle: twoPackages(other), deps: deps() });
    const brief = engine.brief(loose);
    expect(brief.packageChoices).toHaveLength(2);
    expect(brief.packageChoices.every((c) => c.eligible)).toBe(true);
    expect(brief.packageChoices.map((c) => c.figure)).toEqual(["$26M committed · 3 members", "$9M committed · 1 member"]);
    // The strip holds NOTHING until one is chosen: members drawn across two
    // packages would be the first step toward a manifest no single approval
    // could honestly cover.
    expect(brief.showsMembers).toBe(false);
    expect(brief.members).toHaveLength(0);
    expect(brief.position).toMatch(/one package is one plan under one approval/);
  });

  it("draws a package with nothing booked as ineligible, with the org's reason", () => {
    const engine = createModifyEngine({ context: loose, data, bundle: twoPackages(inReview), deps: deps() });
    const second = engine.brief(loose).packageChoices.find((c) => c.id === SECOND_ID)!;
    expect(second.eligible).toBe(false);
    expect(second.reason).toContain("Final Review");
  });

  it("refuses to compose anything until one is anchored", async () => {
    const engine = createModifyEngine({ context: loose, data, bundle: twoPackages(other), deps: deps() });
    expect(engine.suggest()).toBeNull();
    const result = await engine.parseIntent("increase the line of credit - $15,000,000.00 to $20,000,000", loose);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toMatch(/anchored on one of them/i);
  });

  it("works normally once the banker has anchored it", () => {
    const anchored = { ...loose, productPackageId: PACKAGE_ID };
    const brief = createModifyEngine({ context: anchored, data, bundle: twoPackages(other), deps: deps() }).brief(anchored);
    expect(brief.packageChoices).toHaveLength(0);
    expect(brief.baselineMembers).toBe(3);
  });

  it("NEVER shows a selection beat on a relationship with one package", () => {
    expect(engineOn().engine.brief(context).packageChoices).toHaveLength(0);
  });
});

describe("stagePlan composes the ORDERED plan (W1)", () => {
  it("sends ONLY the fileable changes, on the tool's own request keys", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);

    expect(d.stage).toHaveBeenCalledOnce();
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({
      idempotencyKey: "wr-test-key",
      productPackageId: PACKAGE_ID,
      facilityIds: [LINE_ID],
      requestedAmount: 20_000_000,
      requestedMaturityDate: null,
      requestedRate: null,
      requestedTermMonths: null,
    });
    // The covenant never reaches the wire. There is no key it could travel on.
    expect(JSON.stringify(payload)).not.toMatch(/covenant/i);
    expect(payload.rationale).toContain("Commitment amount");
  });

  it("keeps the org's order: clone, verify, apply, then everything with no tool, then booking", async () => {
    const { engine } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00")),
    ];
    const staged = await engine.stagePlan(deltas, context);
    expect(staged.plan.steps.map((s) => s.id)).toEqual([
      "credit_action_0",
      "verify_clone_0",
      "apply_changes_0",
      "observe_side_effects",
      // CONNECTED CREATION: the covenant is not one step. It is the record and
      // the junction that ties it to the clone, in order.
      "handoff_0",
      "handoff_0_chain_0",
      "handoff_0_chain_1",
      "held_execution",
    ]);
    // Step 1 IS the clone, and the mutation lands after the clone is verified.
    expect(staged.plan.steps[0].type).toBe("write");
    expect(staged.plan.steps[1].type).toBe("verification");
    expect(staged.plan.steps.find((s) => s.id === "handoff_0")!.type).toBe("handoff");
    // The chain names the covenant record AND its loan attachment, in that order.
    expect(staged.plan.steps.find((s) => s.id === "handoff_0_chain_0")!.label).toContain("LLC_BI__Covenant2__c");
    expect(staged.plan.steps.find((s) => s.id === "handoff_0_chain_1")!.label).toContain("LLC_BI__Loan_Covenant__c");
  });

  it("refuses to pledge an asset the deal does not carry, and names the ones it does", async () => {
    const { engine } = engineOn();
    // A pledge sends the ORG'S OWN collateral record, so an asset this read
    // never carried has no id to send and the room asks rather than inventing
    // one. (Before 2026-08-31 this line handed off with its three-link chain;
    // the chain-on-a-handoff assertion now lives on the covenant test above,
    // which is still a handoff when its type is off the org's catalog.)
    const result = await engine.parseIntent("pledge the Mazak tooling to the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toContain("Duluth warehouse");
    expect(result.reply).toContain("Duluth machine shop");
    expect(result.reply).toMatch(/NEW asset/);
  });

  it("asks amend-or-add when a create names something already on the facility", async () => {
    const { engine } = engineOn();
    // The Line of Credit already carries an Accounts Receivable covenant.
    const result = await engine.parseIntent("add an accounts receivable covenant to the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("unparsed");
    if (result.kind !== "unparsed") return;
    expect(result.reply).toMatch(/already on/);
    expect(result.reply).toMatch(/add a second/);

    // Said deliberately, it stages.
    const second = await engine.parseIntent("add a second accounts receivable covenant to the line of credit - $15,000,000.00", context);
    expect(second.kind).toBe("deltas");
  });

  it("hands back the ORG's plan hash, staging id and token, untranslated", async () => {
    const { engine } = engineOn();
    const staged = await engine.stagePlan(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000"), context);
    expect(staged.stagingId).toBe(STAGE_RESULT.stagingId);
    expect(staged.planHash).toBe(STAGE_RESULT.planHash);
    expect(staged.decisionToken).toBe(STAGE_RESULT.decisionToken);
  });

  it("stages a plan that passes the allowlist and carries no record id", async () => {
    const { engine } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00")),
    ];
    const staged = await engine.stagePlan(deltas, context);
    expect(validatePlan(staged.plan.steps)).toEqual([]);
    expect(assertNoRecordIds(staged.plan)).toEqual([]);
  });

  it("warns, before the gesture, that part of the manifest is handed off", async () => {
    const { engine } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00")),
    ];
    const staged = await engine.stagePlan(deltas, context);
    expect(staged.plan.warnings.some((wn) => /handed off rather than filed/.test(wn))).toBe(true);
  });

  it("REFUSES a manifest that files nothing rather than staging an empty change", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(WorkroomRefusalError);
    expect(d.stage).not.toHaveBeenCalled();
  });

  /* THE FOUR SCALARS, PER TARGET (2026-08-31). Founder: "there is the
     possibility that there is a change on a loan which does not have an
     increase or decrease". A scalar used to travel once for the WHOLE selection
     and land on every clone, so a legitimate mixed plan was refused outright by
     this morning's leak guard. Each scalar now names the member it lands on. */

  it("stages two different amounts on two members, each targeted at its own clone", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "take the equipment - $8,000,000.00 to $9,000,000")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.parse(payload.scalarChangesJson)).toEqual([
      { key: "requestedAmount", value: 20_000_000, targetLoanId: LINE_ID },
      { key: "requestedAmount", value: 9_000_000, targetLoanId: EQUIPMENT_ID },
    ]);
    // The flat keys stay null: the org reads the targeted channel only when they
    // are empty, and a figure in both places is a clone with two answers.
    expect(payload.requestedAmount).toBeNull();
  });

  it("REFUSES two different amounts on ONE member, which no channel can carry", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $22,000,000")),
    ];
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(WorkroomRefusalError);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/ONE value per facility/);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/Line of Credit/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("files the mixed plan the guard used to refuse: amount on the LoC, a field on the equipment", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "amortize the equipment - $8,000,000.00 over 20 years")),
    ];
    const staged = await engine.stagePlan(deltas, context);
    expect(staged.planHash).toBe(STAGE_RESULT.planHash);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.facilityIds).toEqual([LINE_ID, EQUIPMENT_ID]);
    // The amount names the line of credit ALONE. That is the whole fix: the
    // equipment clone keeps its $8M and takes only the amortisation.
    expect(JSON.parse(payload.scalarChangesJson)).toEqual([
      { key: "requestedAmount", value: 20_000_000, targetLoanId: LINE_ID },
    ]);
    expect(payload.requestedAmount).toBeNull();
    expect(JSON.parse(payload.fieldChangesJson)).toEqual([
      { field: "LLC_BI__Amortized_Term_Months__c", value: 240, targetLoanId: EQUIPMENT_ID },
    ]);
  });

  it("keeps the BROADCAST channel for a scalar every selected member staged", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "push the maturity on the line of credit - $15,000,000.00 to 2028-06-30")),
      ...(await confirm(engine, "push the maturity on the equipment - $8,000,000.00 to 2028-06-30")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The selection is not wider than the scalar's own targets, so the flat key
    // says exactly what is meant and the deployed contract carries the plan.
    expect(payload.facilityIds).toEqual([LINE_ID, EQUIPMENT_ID]);
    expect(payload.requestedMaturityDate).toBe("2028-06-30");
    expect("scalarChangesJson" in payload).toBe(false);
  });

  /* THE LEAK, AS AN INVARIANT. The membership guard survives in wirePayload as
     the backstop on the broadcast channel, and by construction a plan routed
     there has nothing to spread onto — so the guard cannot fire from this
     client. What is worth pinning is the property it exists for, over every
     mix the room can actually build: a scalar NEVER reaches a member that did
     not stage it, whichever channel carries the plan. */

  it("never lets a scalar reach a member that did not stage it, on either channel", async () => {
    const mixes = [
      ["increase the line of credit - $15,000,000.00 to $20,000,000", "amortize the equipment - $8,000,000.00 over 20 years"],
      ["increase the line of credit - $15,000,000.00 to $20,000,000", "take the equipment - $8,000,000.00 to $9,000,000"],
      ["push the maturity on the line of credit - $15,000,000.00 to 2028-06-30", "push the maturity on the equipment - $8,000,000.00 to 2028-06-30"],
      ["increase the line of credit - $15,000,000.00 to $20,000,000", "change the payment schedule to monthly on the line of credit - $15,000,000.00"],
    ];
    for (const lines of mixes) {
      const { engine, deps: d } = engineOn();
      const deltas: Awaited<ReturnType<typeof confirm>> = [];
      for (const line of lines) deltas.push(...(await confirm(engine, line)));
      await engine.stagePlan(deltas, context);
      const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Who staged what, read off the deltas rather than off the payload.
      const stagedOn = new Map<string, Set<string>>();
      for (const dl of deltas) {
        if (!dl.wire) continue;
        const on = stagedOn.get(dl.wire.key) ?? new Set<string>();
        on.add(dl.wire.facilityId);
        stagedOn.set(dl.wire.key, on);
      }
      // Where the scalars ride targeted, every entry names a member that staged
      // it. Where they broadcast, every selected member staged every scalar.
      const targeted: Array<{ key: string; targetLoanId: string }> = payload.scalarChangesJson
        ? JSON.parse(payload.scalarChangesJson)
        : [];
      for (const entry of targeted) expect([...stagedOn.get(entry.key)!]).toContain(entry.targetLoanId);
      if (!payload.scalarChangesJson) {
        for (const on of stagedOn.values()) expect(payload.facilityIds.filter((id: string) => !on.has(id))).toEqual([]);
      }
    }
  });

  it("stages an amount beside a field change on the SAME member, which is one plan", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "take the equipment - $8,000,000.00 to $10,000,000")),
      ...(await confirm(engine, "change the payment schedule to monthly on the equipment - $8,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload.facilityIds).toEqual([EQUIPMENT_ID]);
    expect(payload.requestedAmount).toBe(10_000_000);
    expect(JSON.parse(payload.fieldChangesJson)).toEqual([
      { field: "LLC_BI__Payment_Schedule__c", value: "Monthly", targetLoanId: EQUIPMENT_ID },
    ]);
  });

  it("stages record and field changes across two members, because none of them is a scalar", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = [
      ...(await confirm(engine, "add a leverage covenant max 3.5x to the equipment - $8,000,000.00")),
      ...(await confirm(engine, "add Hartwell Logistics LLC as a limited guarantor on the line of credit - $15,000,000.00")),
      ...(await confirm(engine, "change the payment schedule to monthly on the line of credit - $15,000,000.00")),
    ];
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // Each of these carries its own target, so a two-member selection is a
    // normal plan and not the leak the guard above exists to catch.
    expect(payload.facilityIds).toEqual([EQUIPMENT_ID, LINE_ID]);
    expect(payload.requestedAmount).toBeNull();
    expect(payload.requestedRate).toBeNull();
    expect(payload.requestedMaturityDate).toBeNull();
    expect(payload.requestedTermMonths).toBeNull();
    expect(JSON.parse(payload.covenantAddsJson)[0].targetLoanId).toBe(EQUIPMENT_ID);
    expect(JSON.parse(payload.involvementChangesJson)[0].targetLoanId).toBe(LINE_ID);
    expect(JSON.parse(payload.fieldChangesJson)[0].targetLoanId).toBe(LINE_ID);
  });

  it("carries the org's own refusal message rather than a paraphrase", async () => {
    const { engine } = engineOn({
      stage: vi.fn().mockResolvedValue({ ok: false, error: { code: "VALIDATION_FAILED", message: "The request contains invalid facilities" } }),
    });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow("The request contains invalid facilities");
  });

  it("refuses to stage with no connector, rather than simulating a plan", async () => {
    const { engine } = engineOn({ available: () => false });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    // The refusal STANDS — a plan is the org's or there is no plan — and it now
    // says so in the banker's own terms rather than reporting a missing part.
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/not connected to the bank's systems/);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/nothing here is ever simulated/);
  });
});

describe("execute redeems the token and reports what the org read back", () => {
  async function stageOne(over: Partial<ModifyEngineDeps> = {}) {
    const { engine, deps: d } = engineOn(over);
    const deltas = [
      ...(await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000")),
      ...(await confirm(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00")),
    ];
    const staged = await engine.stagePlan(deltas, context);
    return { engine, deps: d, staged, approval: { stagingId: staged.stagingId, planHash: staged.planHash, decisionToken: staged.decisionToken!, approverUserId: context.approver } };
  }

  it("sends the SALESFORCE USER ID, never the display name", async () => {
    const { engine, deps: d, approval } = await stageOne();
    await engine.execute(approval);
    expect((d.execute as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      approverUserId: "005bb00000ftouDAAQ",
      stagingId: STAGE_RESULT.stagingId,
      planHash: STAGE_RESULT.planHash,
      decisionToken: STAGE_RESULT.decisionToken,
      idempotencyKey: "wr-test-key",
    });
  });

  it("refuses to file when the view has no Salesforce user id", async () => {
    const nameOnly = { meta: { user: "Fabian Goetzens" } } as unknown as C360Data;
    const d = deps();
    const engine = createModifyEngine({ context, data: nameOnly, bundle: bundleWith(), deps: d });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const staged = await engine.stagePlan(deltas, context);
    await expect(
      engine.execute({ stagingId: staged.stagingId, planHash: staged.planHash, decisionToken: staged.decisionToken!, approverUserId: "Fabian Goetzens" }),
    ).rejects.toThrow(/no Salesforce user id/);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("reports the REAL clone id and junction the org named", async () => {
    const { engine, approval } = await stageOne();
    const result = await engine.execute(approval);
    expect(result.filed).toHaveLength(1);
    expect(result.filed[0].recordId).toBe("a4Zbb000002Br6HEAS");
    expect(result.filed[0].verification).toContain("RL-00000198");
    expect(result.filed[0].verification).toContain("Amount reads back at 20000000.00.");
  });

  it("renders the org's booking sentence verbatim and lists what was NOT filed", async () => {
    const { engine, approval } = await stageOne();
    const result = await engine.execute(approval);
    expect(result.handoff).toBe(EXECUTE_RESULT.bookingHandoff);
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs![0].title).toMatch(/New covenant/);
    expect(result.reply!.body).toMatch(/not filed, because no tool writes/);
  });

  /* ============================ THE FAILED-EXECUTE SEAM (2026-09-06)

     `writeTools` normalises a malformed execute's `terminalState` to "failed"
     and always has. What lost that fact was THIS leg: `filed` was built from the
     MANIFEST the room sent, record ids included, so a run the org reported as
     failed came back looking exactly like a filing and the two guards the room
     can apply at the seam - a non-empty list, a record id on it - were both
     satisfied by rows nobody wrote. The room's afterglow then lit on a write
     that never happened. (chaos.mjs `garbage-on-execute`, red until now.) */
  it("carries the org's terminalState and the version it produced", async () => {
    const { engine, approval } = await stageOne();
    const result = await engine.execute(approval);
    expect(result.terminalState).toBe("success");
    expect(result.outputPackageId).toBe(EXECUTE_RESULT.outputPackageId);
  });

  it("REFUSES to build a filed list from a run the org reported failed", async () => {
    const { engine, approval } = await stageOne({
      execute: vi.fn().mockResolvedValue({
        ok: true,
        result: { ...EXECUTE_RESULT, terminalState: "failed", outcome: "The credit action could not be created.", facilities: undefined, cloneLoanId: undefined },
      }),
    });
    const result = await engine.execute(approval);
    // EMPTY, and the reason travels. The room reads an empty list as a result it
    // cannot stand a filing on, and says so instead of drawing a dossier.
    expect(result.filed).toEqual([]);
    expect(result.terminalState).toBe("failed");
    expect(result.handoff).toBe("The credit action could not be created.");
  });

  it("says so even when the org names no reason, rather than inventing one", async () => {
    const { engine, approval } = await stageOne({
      execute: vi.fn().mockResolvedValue({ ok: true, result: { ...EXECUTE_RESULT, terminalState: "failed", outcome: "" } }),
    });
    const result = await engine.execute(approval);
    expect(result.filed).toEqual([]);
    expect(result.handoff).toContain("gave no reason with it");
  });

  it("burns the token, and refuses a confirmation that belongs to another plan", async () => {
    const { engine, approval } = await stageOne();
    await engine.execute(approval);
    await expect(engine.execute(approval)).rejects.toThrow(/already been used/);
    await expect(engine.execute({ ...approval, planHash: "changed" })).rejects.toThrow(/no longer applies/);
  });

  it("REFUSES when the figure the entry was composed on has moved (drift)", async () => {
    const d = deps();
    const bundle = bundleWith();
    const engine = createModifyEngine({ context, data, bundle, deps: d });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const staged = await engine.stagePlan(deltas, context);
    // The read moves under the manifest between staging and the gesture.
    bundle.exposure!.facilities![0] = { ...line, committed: 16_000_000 };
    await expect(
      engine.execute({ stagingId: staged.stagingId, planHash: staged.planHash, decisionToken: staged.decisionToken!, approverUserId: context.approver }),
    ).rejects.toThrow(/figures moved/);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("stops on an org hold rather than sending a plan the org will not run", async () => {
    const { engine, approval } = await stageOne({
      stage: vi.fn().mockResolvedValue({ ok: true, result: { ...STAGE_RESULT, executionHeld: true, heldReason: "LV06 holds this." } }),
    });
    await expect(engine.execute(approval)).rejects.toThrow("LV06 holds this.");
  });

  it("says a replay was a replay rather than claiming a second write", async () => {
    const { engine, approval } = await stageOne({
      execute: vi.fn().mockResolvedValue({ ok: true, result: { ...EXECUTE_RESULT, replayed: true, facilities: undefined } }),
    });
    const result = await engine.execute(approval);
    expect(result.tokenNote).toMatch(/replayed, nothing was written twice/);
    // The clone is still named, because a replay names what already exists.
    expect(result.filed[0].recordId).toBe("a4Zbb000002Br6HEAS");
  });
});

/* =============================================================================
   THE EXPLANATION LAYER, IN THE FLOW.

   Founder verdict 2026-08-29: the room "feels almost more like guided template
   still, no explanation" — "it can explain also concise in the flow what and why
   it is needed."

   The copy itself is proved in `explain.test.ts`. What is proved HERE is that
   every beat of a real conversation carries it, composed against the figures
   this package actually reads: the ask, the proposal, the check, the handoff and
   the refusal. A beat that goes quiet is the failure.
   ============================================================================= */

describe("every beat says WHY, on this package's own figures", () => {
  it("asks for a figure AND says what the figure decides", async () => {
    const noAsk = bundleWith();
    delete noAsk.requests;
    const engine = createModifyEngine({ context, data, bundle: noAsk, deps: deps() });
    const asked = await engine.parseIntent(engine.suggest()!.say, context);
    expect(asked.kind).toBe("unparsed");
    if (asked.kind !== "unparsed") return;
    // Today's figure, then what the answer is FOR — the package total and the
    // pool it is covered by, both read off this bundle.
    expect(asked.reply).toContain("Today it reads $15M");
    expect(asked.reply).toContain("the $26M package total");
    expect(asked.reply).toContain("$34.60M pledged pool");
  });

  it("says what confirming DOES before the banker confirms it", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("increase the line of credit - $15,000,000.00 to $20,000,000", context);
    expect(result.kind).toBe("deltas");
    if (result.kind !== "deltas") return;
    expect(result.reply).toContain("clone of Line of Credit");
    expect(result.reply).toContain("booked facilities and the current package stay exactly as they are");
  });

  it("explains a handoff in credit language, never in the org's own schema", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("add a collateral insurance covenant for the equipment - $8,000,000.00", context);
    expect(result.kind).toBe("deltas");
    if (result.kind !== "deltas") return;
    expect(result.reply).toContain("2 connected writes");
    expect(result.reply).toContain("nothing is silently dropped");
    // The org's own sentence is still carried, verbatim — on the entry, where a
    // banker who wants it goes looking. It is not the answer in the room.
    expect(result.reply).not.toMatch(/LLC_BI__|allowlist|C360WriteGuard/);
    // The truthful mechanism since the covenant arm shipped: an unmapped type is
    // a catalog-resolution gap, not a guard refusal — and the entry still names it.
    expect(result.deltas[0].handoff?.reason).toMatch(/org catalog/);
  });

  it("carries the same reading into the confirm's answer", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "add Hartwell Logistics LLC as a guarantor");
    const { reply } = engine.acknowledge(delta, [delta]);
    expect(reply).toContain("on the manifest for the record");
    expect(reply).toContain("names the member and the role");
    expect(reply).not.toMatch(/LLC_BI__|allowlist/);
  });

  it("says why the coverage check moved the way it did", async () => {
    const { engine } = engineOn();
    const [delta] = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const { challenge } = engine.acknowledge(delta, [delta]);
    expect(challenge!.why).toContain("does not grow with the commitment");
    expect(challenge!.why).toContain("$34.60M");
  });

  it("refuses with the reason AND the way through it", async () => {
    const { engine } = engineOn();
    const result = await engine.parseIntent("waive the covenant on the line of credit - $15,000,000.00", context);
    expect(result.kind).toBe("refusal");
    if (result.kind !== "refusal") return;
    expect(result.reply).toContain("cannot be pulled back");
    expect(result.reply).toContain("Open the covenant review");
    // The org's own account is still the quote on the chip, unparaphrased.
    expect(result.refusal.reason).toMatch(/founder-gated/);
    expect(result.refusal.why).toBe(
      "Filing a compliance status makes the bank send its own approval notice to a named person, and that cannot be pulled back — so it is taken deliberately rather than as a side effect of a term change. Open the covenant review on this package and file it there.",
    );
  });

  it("explains a disconnected view rather than reporting a fault", async () => {
    const { engine } = engineOn({ available: () => false });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/not connected to the bank's systems/);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/accept the connection prompt/);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/Sync control/);
  });

  it("explains a manifest that files nothing, with both ways out", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "add a collateral insurance covenant for the equipment - $8,000,000.00");
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/Add a commitment, rate, maturity or term change/);
    await expect(engine.stagePlan(deltas, context)).rejects.toThrow(/person who can action it/);
  });
});

/* =============================================================================
   TIER-1 ADVISORIES.

   Deterministic sense-checks that speak up BEFORE staging, off the figures the
   engine already holds. They NEVER block — the chips still arrive open and the
   org's guards still do the blocking — so every rule below is proved twice: on
   the read that trips it, and on the read that must leave it silent.
   ============================================================================= */

async function propose(engine: ReturnType<typeof createModifyEngine>, said: string) {
  const result = await engine.parseIntent(said, context);
  if (result.kind !== "deltas") throw new Error(`${said} → ${result.kind}: ${result.reply}`);
  return result;
}

const ruleIds = (result: { advisories?: Array<{ rule: string }> }) => (result.advisories ?? []).map((a) => a.rule);

describe("advisory 1 — a limit under what is already drawn", () => {
  it("speaks up, and offers the client's own ask as the figure that works", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "take the line of credit - $15,000,000.00 to $8,000,000");
    const advice = result.advisories!.find((a) => a.rule === "commitment-below-outstanding")!;
    expect(advice.line).toBe(
      "$9.20M is already drawn on the Line of Credit, so a limit of $8M does not work as stated. The balance comes down first, or the figure is not the one you meant.",
    );
    expect(advice.resolution!.label).toBe("Make it $20M, the client's own ask");
    // AND IT DOES NOT BLOCK. The chip the banker asked for is still on the table.
    expect(result.deltas[0].wire).toEqual({ key: "requestedAmount", value: 8_000_000, facilityId: LINE_ID });
  });

  it("says nothing when the limit clears the balance", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "take the line of credit - $15,000,000.00 to $20,000,000");
    expect(ruleIds(result)).not.toContain("commitment-below-outstanding");
  });

  it("offers no figure it cannot stand behind where the read stages no client ask", async () => {
    const noAsk = bundleWith();
    delete noAsk.requests;
    const engine = createModifyEngine({ context, data, bundle: noAsk, deps: deps() });
    const result = await propose(engine, "take the line of credit - $15,000,000.00 to $8,000,000");
    const advice = result.advisories!.find((a) => a.rule === "commitment-below-outstanding")!;
    expect(advice.resolution).toBeUndefined();
  });
});

describe("advisory 2 — something of this kind is already on the facility", () => {
  it("names what the clone already carries, and offers the amend", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "add a collateral insurance covenant for the line of credit - $15,000,000.00");
    const advice = result.advisories!.find((a) => a.rule === "amend-or-add")!;
    expect(advice.line).toContain("already carries 1 covenant — Accounts Receivable");
    expect(advice.line).toContain("stages a new one beside it");
    expect(advice.resolution!.label).toBe("Change the Accounts Receivable test instead");
  });

  it("says nothing on a member that carries none", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "add a collateral insurance covenant for the equipment - $8,000,000.00");
    expect(ruleIds(result)).not.toContain("amend-or-add");
  });
});

describe("advisory 3 — a maturity that cannot stand", () => {
  const AUG29 = () => "2026-08-29";

  it("catches a date behind today", async () => {
    const { engine } = engineOn({ today: AUG29 });
    const result = await propose(engine, "push the maturity on the line of credit - $15,000,000.00 to 2020-01-15");
    const advice = result.advisories!.find((a) => a.rule === "maturity-out-of-order")!;
    expect(advice.line).toContain("Jan 15, 2020 is behind today");
    expect(advice.line).toContain("would file already matured");
  });

  it("catches a maturity that lands before a test the facility still owes", async () => {
    const owing = bundleWith();
    // The junction the Line of Credit carries, given the due date the org holds.
    owing.covenants!.covenants!.push({
      covenantId: "a3Bbb000000S0bNEAS",
      covenantType: "Accounts Receivable",
      nextEvaluationDate: "2027-09-30",
    });
    const engine = createModifyEngine({ context, data, bundle: owing, deps: { ...deps(), today: AUG29 } });
    const result = await propose(engine, "push the maturity on the line of credit - $15,000,000.00 to 2027-06-30");
    const advice = result.advisories!.find((a) => a.rule === "maturity-out-of-order")!;
    expect(advice.line).toContain("Accounts Receivable test");
    expect(advice.line).toContain("mature owing a test nobody can take");
    expect(advice.resolution!.say).toContain("to 2027-09-30");
  });

  it("says nothing about a maturity ahead of today with no test behind it", async () => {
    const { engine } = engineOn({ today: AUG29 });
    const result = await propose(engine, "push the maturity on the line of credit - $15,000,000.00 to 2029-03-15");
    expect(ruleIds(result)).not.toContain("maturity-out-of-order");
  });
});

describe("advisory 4 — a covenant threshold that would never bind", () => {
  it("measures the proposed level against the actual the read carries", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "set the fixed charge coverage threshold on the line of credit - $15,000,000.00 to 1.00");
    const advice = result.advisories!.find((a) => a.rule === "covenant-never-binds")!;
    expect(advice.line).toBe(
      "Fixed Charge Coverage reads 1.22 today against a 1.15 floor. At 1 it only bites once the ratio falls 18%, so on the numbers this read carries it would not bind at all.",
    );
  });

  it("says nothing when the threshold is being TIGHTENED", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "set the fixed charge coverage threshold on the line of credit - $15,000,000.00 to 1.30");
    expect(ruleIds(result)).not.toContain("covenant-never-binds");
  });

  it("says nothing where the line names no covenant it could be about", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "set the threshold on the line of credit - $15,000,000.00 to 1.00");
    expect(ruleIds(result)).not.toContain("covenant-never-binds");
  });
});

describe("advisory 5 — a release that takes the cover under the org's own ratio", () => {
  it("names the pledge, the pool and both ratios, and says which is the org's", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "release the pledge COL-000762 on the line of credit - $15,000,000.00");
    const advice = result.advisories!.find((a) => a.rule === "release-thins-cover")!;
    expect(advice.line).toBe(
      "Releasing COL-000762 takes $8M out of the $34.60M pledged pool, leaving 1.02x against the $26M committed — under the 1.13x the org reads on this relationship today.",
    );
  });

  it("says nothing about a release the pool absorbs", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "release the pledge COL-000763 on the line of credit - $15,000,000.00");
    expect(ruleIds(result)).not.toContain("release-thins-cover");
  });

  it("says nothing where the read carries no collateral pool to reason over", async () => {
    const blind = bundleWith();
    delete blind.exposure!.totalUniqueCollateralLendableValue;
    const engine = createModifyEngine({ context, data, bundle: blind, deps: deps() });
    const result = await propose(engine, "release the pledge COL-000762 on the line of credit - $15,000,000.00");
    expect(ruleIds(result)).not.toContain("release-thins-cover");
  });
});

describe("advisory 6 — an entity already involved on the package", () => {
  it("offers the role change where the line asks for a role they do not hold", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "add Elena Hartwell as a guarantor");
    const advice = result.advisories!.find((a) => a.rule === "entity-already-involved")!;
    expect(advice.line).toContain("Elena Hartwell is already a limited guarantor on this package");
    expect(advice.resolution!.label).toBe("Change the role to guarantor instead");
    expect(advice.resolution!.say).toBe("change the role of Elena Hartwell to guarantor");
  });

  it("says a duplicate is a duplicate where the role is the one they already hold", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "add James Hartwell as a guarantor");
    const advice = result.advisories!.find((a) => a.rule === "entity-already-involved")!;
    expect(advice.line).toContain("stages a second involvement for the same name");
    expect(advice.resolution).toBeUndefined();
  });

  it("says nothing about an entity that is genuinely new to the deal", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "add Hartwell Logistics LLC as a guarantor");
    expect(ruleIds(result)).not.toContain("entity-already-involved");
  });
});

describe("what an advisory is NOT", () => {
  it("never removes the change it warns about, so the banker can still proceed", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "take the line of credit - $15,000,000.00 to $8,000,000");
    expect(result.advisories!.length).toBeGreaterThan(0);
    expect(result.deltas).toHaveLength(1);
    const staged = await engine.stagePlan(result.deltas, context);
    // The org staged it. The advisory informed; it did not gate.
    expect(staged.planHash).toBe(STAGE_RESULT.planHash);
  });

  it("every resolution is a line the banker could have typed, and the parser reads it back", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "take the line of credit - $15,000,000.00 to $8,000,000");
    const say = result.advisories!.find((a) => a.rule === "commitment-below-outstanding")!.resolution!.say;
    const taken = await engine.parseIntent(say, context);
    expect(taken.kind).toBe("deltas");
    if (taken.kind !== "deltas") return;
    expect(taken.deltas[0].wire).toEqual({ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID });
  });

  it("stays silent on a clean change, rather than finding something to say", async () => {
    const { engine } = engineOn();
    const result = await propose(engine, "move the rate on the line of credit - $15,000,000.00 to 8.1%");
    expect(result.advisories ?? []).toHaveLength(0);
  });
});

/* =============================================================================
   THE SAY PATH'S TWO SEAMS, PROVED AGAINST THE REAL ENGINE.

   Both are defects found in a live click-through of the room, and both live
   between the shell and the engine rather than inside either.
   ============================================================================= */

describe("the manifest addresser does not eat a structure removal", () => {
  /** The line off the live run. The room answered "Nothing is staged yet, so
   *  there is nothing to take out" and the parser never saw it. */
  const RELEASE = "remove the guarantor Hartwell Industrial Holdings LLC from the line of credit - $15,000,000.00";

  it("lets the line through to the parser, which files it as a carry exclusion", async () => {
    const { engine } = engineOn();

    // The shell runs every line past the rail before the parser sees it. An
    // empty rail must not claim it...
    expect(addressManifest(RELEASE, [])).toBeNull();

    // ...and neither must a rail holding a change on the very same member. The
    // facility is what the line SCOPES to, not what it names.
    const [rate] = await confirm(engine, "move the rate on the line of credit - $15,000,000.00 to 8.1%");
    expect(addressManifest(RELEASE, [rate])).toBeNull();

    const [release] = await confirm(engine, RELEASE);
    expect(release.fileable).toBe(true);
    expect(release.involvementWire).toMatchObject({
      op: "remove",
      accountName: "Hartwell Industrial Holdings LLC",
      facilityId: LINE_ID,
    });
    expect(release.filed.recordId).toBe("a carry exclusion writes nothing");
  });
});

describe("the composed manifest survives the room closing", () => {
  it("restores it on the next engine for the same package, and starts another clean", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    // The shell hands the rail back on every landing, which is what a close then
    // has nothing to lose.
    engine.hold(deltas);

    const reopened = createModifyEngine({ context, data, bundle: bundleWith(), deps: deps() });
    expect(reopened.resume().map((d) => d.id)).toEqual(deltas.map((d) => d.id));

    // ONE SESSION IS ONE PACKAGE. A manifest composed against one package may
    // never reappear under another: that anchor is the governance boundary.
    const elsewhere = { ...context, productPackageId: "a5Fbb000000IHXXEA4" };
    expect(createModifyEngine({ context: elsewhere, data, bundle: bundleWith(), deps: deps() }).resume()).toEqual([]);
  });

  it("carries the idempotency key with it, so a reopened approval is a REPLAY", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    await engine.stagePlan(deltas, context);
    engine.hold(deltas);

    const { engine: reopened, deps: d } = engineOn({ newKey: () => "a-second-key" });
    await reopened.stagePlan(reopened.resume(), context);
    expect((d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0].idempotencyKey).toBe("wr-test-key");
  });

  it("lets go once the plan has filed, because there is nothing left to pick up", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    engine.hold(deltas);
    const staged = await engine.stagePlan(deltas, context);
    await engine.execute({
      stagingId: staged.stagingId,
      planHash: staged.planHash,
      decisionToken: staged.decisionToken!,
      approverUserId: "Fabian Goetzens",
    });
    engine.release();
    expect(createModifyEngine({ context, data, bundle: bundleWith(), deps: deps() }).resume()).toEqual([]);
  });
});

describe("a failed execute never re-arms the approval blindly", () => {
  it("reads a transport failure OBJECT as a sentence, and marks the plan dispatched", async () => {
    const { engine } = engineOn({
      // The transport rejects with a plain failure object, not an Error. This is
      // the shape that put "[object Object]" in the thread as the room's whole
      // answer to a 43-second execute.
      execute: vi.fn().mockRejectedValue({ code: "upstream_error", server: "customer360" }),
    });
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const staged = await engine.stagePlan(deltas, context);
    await expect(
      engine.execute({
        stagingId: staged.stagingId,
        planHash: staged.planHash,
        decisionToken: staged.decisionToken!,
        approverUserId: "Fabian Goetzens",
      }),
    ).rejects.toMatchObject({ dispatched: true });

    const thrown = await engine
      .execute({
        stagingId: staged.stagingId,
        planHash: staged.planHash,
        decisionToken: staged.decisionToken!,
        approverUserId: "Fabian Goetzens",
      })
      .catch((e: unknown) => e);
    expect((thrown as Error).message).not.toContain("[object Object]");
    expect((thrown as Error).message).toContain("upstream_error");
  });

  it("leaves a refusal raised BEFORE the call safe to retry", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "increase the line of credit - $15,000,000.00 to $20,000,000");
    const staged = await engine.stagePlan(deltas, context);
    // The org's approver check runs in the room, before anything leaves it.
    const thrown = await engine
      .execute({ stagingId: staged.stagingId, planHash: "a different plan", decisionToken: "x", approverUserId: "x" })
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(WorkroomRefusalError);
    expect((thrown as WorkroomRefusalError).dispatched).toBe(false);
  });
});
