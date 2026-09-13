// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMEND_ACTION_ID,
  amendPlanTitle,
  canAmendHere,
  createAmendEngine,
  toAmendPayload,
  VERSION_AMEND_REFUSAL,
} from "./amendEngine";
import { clearComposed } from "./engine";
import { WorkroomRefusalError } from "./modifyEngine";
import { WRITE_TOOLS, type StagePayloads } from "../channel/writeTools";
import type { BorrowerBundle, C360Data, Facility } from "../data/contract";
import type { WorkroomContext, WorkroomDelta } from "./types";

/* =============================================================================
   SHAPING A VERSION IN PLACE (0.9.23, spec 2a.1 / tool contract pair 1).

   THE FIXTURE IS HARTWELL'S REAL FORK, at the cockpit's own contract and at the
   figures `book/packages.test.ts` reads off bankinggpt-at: the booked source
   package a5Fbb000000J6BNEA0 with two Booked loans, and the unbooked version
   a5Fbb000000JFzREAW holding the two Qualification copies, the Purchase facility
   renamed by the filing from $6,500,000.00 to $12,000,000.00. C3's stub lanes
   mirror this shape.

   WHAT IS PROVED HERE:
     - the GATE: who may be amended, and that it is `amendablePackage` and not a
       second rule that happens to agree with it today;
     - the MEMBERS: the strip, the resolution and the read figures are the
       VERSION's loans, never the booked parents;
     - the PLAN: which tool it stages on, that every figure names its loan, and
       that the two arms the amendment pair does not carry never reach the wire;
     - the WORDS: the plan card says what an amendment is, and the room never
       says "clone".
   ============================================================================= */

type W = { claude?: { mcp?: unknown } };
const w = window as unknown as W;

afterEach(() => {
  delete w.claude;
  vi.restoreAllMocks();
  clearComposed();
});

/* ------------------------------------------------------------------ fixture */

const ACCOUNT = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";
const V_EQUIPMENT = "a4Zbb000002KFD3EAO";
const V_PURCHASE = "a4Zbb000002KFD4EAO";
const RELATIONSHIP = "Hartwell Precision Manufacturing LLC";

const booked: Facility[] = [
  {
    loanId: "a4Zbb000002ICnyEAG",
    name: `${RELATIONSHIP} - Equipment - $1,500,000.00`,
    productPackageId: SOURCE,
    stage: "Booked",
    status: "Open",
    committed: 1_500_000,
    outstanding: 900_000,
    interestRate: 6.58,
  },
  {
    loanId: "a4Zbb000002ICnxEAG",
    name: `${RELATIONSHIP} - Purchase - $6,500,000.00`,
    productPackageId: SOURCE,
    stage: "Booked",
    status: "Open",
    committed: 6_500_000,
    outstanding: 4_000_000,
    interestRate: 7.1,
  },
];

/** The forked copy. Same names but for the facility the filing moved, and the
 *  figures the VERSION holds, which are not the parents'. */
function versionMembers(stage = "Qualification"): Facility[] {
  return [
    {
      loanId: V_EQUIPMENT,
      name: `${RELATIONSHIP} - Equipment - $1,500,000.00`,
      productPackageId: VERSION,
      stage,
      status: "Open",
      committed: 1_500_000,
      outstanding: 0,
      interestRate: 6.58,
      maturityDate: "2028-06-30",
      termMonths: 60,
    },
    {
      loanId: V_PURCHASE,
      name: `${RELATIONSHIP} - Purchase - $12,000,000.00`,
      productPackageId: VERSION,
      stage,
      status: "Open",
      committed: 12_000_000,
      outstanding: 0,
      interestRate: 7.1,
      maturityDate: "2029-01-31",
      termMonths: 84,
    },
  ];
}

function bundleWith(facilities: Facility[]): BorrowerBundle {
  const committed = facilities.reduce((s, f) => s + (f.committed ?? 0), 0);
  return {
    snapshot: { accountId: ACCOUNT, name: RELATIONSHIP, productPackageId: SOURCE, primaryRiskRating: "4", primaryStage: "Booked" },
    exposure: {
      totalCommitted: committed,
      totalOutstanding: facilities.reduce((s, f) => s + (f.outstanding ?? 0), 0),
      totalUniqueCollateralLendableValue: 18_000_000,
      uniqueCollateralCount: 3,
      coverageRatio: 1.4,
      facilities,
    },
    covenants: { covenants: [] },
    graph: {
      legalEntities: [{ accountName: RELATIONSHIP, borrowerType: "Borrower", loanId: V_PURCHASE, packageId: VERSION }],
      connections: [{ counterpartyName: "Hartwell Logistics LLC", role: "Subsidiary", ownershipPercent: 100, isActive: true }],
    },
  };
}

const inFlight = () => bundleWith([...booked, ...versionMembers()]);

const data = {
  meta: { anchorAccountId: ACCOUNT, generatedAt: "2026-09-13T08:00:00Z", user: "Fabian Goetzens", userId: "005bb00000ftouDAAQ" },
} as unknown as C360Data;

const context: WorkroomContext = {
  mode: "amend",
  door: "package",
  accountId: ACCOUNT,
  accountName: RELATIONSHIP,
  productPackageId: VERSION,
  originPackageId: VERSION,
  packageName: "Hartwell Precision Manufacturing LLC - 9/12/2026 - PP",
  approver: "Fabian Goetzens",
};

const STAGE_RESULT = {
  stagingId: "a8abb00001N6ZAMENDV",
  planHash: "4f0b0a1c2d3e4f50617283940a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
  decisionToken: "de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c0de1c",
  replayed: false,
  accountId: ACCOUNT,
  productPackageId: VERSION,
  summary: "Plans an amendment on the version.",
  warnings: [],
  executionHeld: false,
  facilityCount: 1,
  facilities: [{ facilityId: V_PURCHASE, facilityName: `${RELATIONSHIP} - Purchase - $12,000,000.00`, applyStepId: "apply_changes_0" }],
  steps: [
    { id: "apply_changes_0", type: "write", label: "Apply the requested changes to the version's own facility", objectName: "LLC_BI__Loan__c", fields: ["LLC_BI__Amount__c"], state: "pending" },
    { id: "verify_0", type: "verification", label: "Re-query the version's facility to prove the write landed", objectName: "LLC_BI__Loan__c", state: "pending" },
  ],
};

const EXECUTE_RESULT = {
  terminalState: "success",
  stagingId: STAGE_RESULT.stagingId,
  replayed: false,
  outcome: "The version was amended in place. No new version was created.",
  facilityCount: 1,
  facilities: [
    {
      facilityId: V_PURCHASE,
      facilityName: `${RELATIONSHIP} - Purchase - $12,000,000.00`,
      appliedChanges: "Amount reads back at 14000000.00.",
      verification: "the version's own loan reads back at the new figure.",
    },
  ],
  outputPackageId: VERSION,
  steps: STAGE_RESULT.steps.map((s) => ({ ...s, state: "verified" })),
};

function deps(over: Record<string, unknown> = {}) {
  return {
    stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT }),
    execute: vi.fn().mockResolvedValue({ ok: true, result: EXECUTE_RESULT }),
    available: () => true,
    newKey: () => "amend-test-key",
    restate: undefined,
    ...over,
  };
}

function engineOn(over: Record<string, unknown> = {}, bundle: BorrowerBundle | null = inFlight()) {
  const d = deps(over);
  return { engine: createAmendEngine({ context, data, bundle, deps: d as never }), deps: d };
}

/** Compose one line into confirmed manifest entries, the way the room does. */
async function compose(engine: ReturnType<typeof engineOn>["engine"], line: string): Promise<WorkroomDelta[]> {
  const out = await engine.parseIntent(line, context);
  if (out.kind !== "deltas") throw new Error(`expected deltas, got ${out.kind}: ${out.reply}`);
  return out.deltas;
}

/* ------------------------------------------------------------------ the gate */

describe("the gate: who may be shaped in place", () => {
  it("says yes to an editable in-flight version, and it is the roster's own judgement", () => {
    expect(canAmendHere(inFlight(), VERSION)).toBe(true);
  });

  it("says no to the booked source of that version", () => {
    expect(canAmendHere(inFlight(), SOURCE)).toBe(false);
  });

  it("says no once a member of the version reaches Approval / Loan Committee", () => {
    const taken = bundleWith([...booked, ...versionMembers("Approval / Loan Committee")]);
    expect(canAmendHere(taken, VERSION)).toBe(false);
  });

  it("says no where the room stands on no package at all", () => {
    expect(canAmendHere(inFlight(), null)).toBe(false);
  });

  it("names the version in the plan card, and says what an amendment is not", () => {
    const said = amendPlanTitle(context.packageName);
    expect(said).toContain(context.packageName);
    expect(said).toContain("no new version");
    expect(said).toContain("no credit action");
    expect(said).not.toMatch(/clone/i);
  });

  it("points a refused fork at this room instead of at Salesforce", () => {
    expect(VERSION_AMEND_REFUSAL).toContain("Change the figures in this version");
    expect(VERSION_AMEND_REFUSAL).not.toMatch(/book it in Salesforce/);
  });
});

/* -------------------------------------------------------------- the members */

describe("the members are the version's, never the booked parents", () => {
  it("strips and counts the version's own facilities", () => {
    const brief = engineOn().engine.brief(context);
    expect(brief.baselineMembers).toBe(2);
    // $1.5M + $12M on the version. The booked parents sum to $8.0M and are not
    // in this room at all.
    expect(brief.baselineCommittedMM).toBeCloseTo(13.5, 5);
    expect(brief.members.map((m) => m.id).sort()).toEqual([V_EQUIPMENT, V_PURCHASE].sort());
  });

  it("resolves a named member against the version and reads ITS figure", async () => {
    const { engine } = engineOn();
    const deltas = await compose(engine, "take the purchase to 14,000,000");
    expect(deltas).toHaveLength(1);
    // The version's Purchase reads $12M; the booked parent reads $6.50M.
    expect(deltas[0].before).toBe("$12M");
    expect(deltas[0].after).toBe("$14M");
    expect(deltas[0].wire).toEqual({ key: "requestedAmount", value: 14_000_000, facilityId: V_PURCHASE });
  });

  it("offers the version's own members when a line names none", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("increase the commitment", context);
    expect(out.kind).toBe("unparsed");
    expect(out.reply).toContain("Which member should this land on?");
    // Both version members are on the question, and neither parent is.
    expect(out.reply).toContain("Purchase - $12,000,000.00");
    expect(out.reply).not.toContain("$6,500,000.00");
  });

  it("picks a version member and never calls it unbookable", () => {
    const out = engineOn().engine.pick(V_EQUIPMENT);
    expect(out?.kind).toBe("unparsed");
    expect(out?.reply).not.toMatch(/booked facility/i);
    expect(out?.reply).toContain("$1.50M committed");
  });

  it("refuses a member the org has taken, by the rung and not by the word booked", () => {
    const mixed = [...versionMembers()];
    mixed[0] = { ...mixed[0], stage: "Doc Prep" };
    const { engine } = engineOn({}, bundleWith([...booked, ...mixed]));
    const out = engine.pick(V_EQUIPMENT);
    expect(out?.reply).toContain("Approval / Loan Committee");
    expect(out?.reply).not.toMatch(/credit action only runs against a booked facility/);
  });
});

/* ------------------------------------------------------------- the room's words */

describe("the room says what it is doing, and never says clone", () => {
  it("opens on the version rather than on a roll-over", () => {
    const brief = engineOn().engine.brief(context);
    expect(brief.position).toContain("this version");
    const rows = brief.have.map((r) => `${r.label} ${r.value} ${r.detail}`).join(" ");
    expect(rows).not.toMatch(/\bclone\b/i);
    expect(rows).toContain("This package IS the version");
  });

  it("tells the banker what confirming does, in the amendment's own terms", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("take the purchase to 14,000,000", context);
    expect(out.reply).toContain("changes the version the org already holds");
    expect(out.reply).not.toMatch(/\bclone\b/i);
  });

  it("acknowledges a landed chip on the version, not on a clone", async () => {
    const { engine } = engineOn();
    const deltas = await compose(engine, "take the purchase to 14,000,000");
    const said = engine.acknowledge(deltas[0], deltas);
    expect(said.reply).toContain("staged on this version");
    expect(said.reply).not.toMatch(/\bclone\b/i);
  });

  it("writes the field map against the version's own loan", async () => {
    const { engine } = engineOn();
    const deltas = await compose(engine, "take the purchase to 14,000,000");
    const written = deltas[0].map.find(([k]) => k === "Written as")![1];
    expect(written).toContain("on the version's own loan");
    expect(written).toContain("No clone is made and no credit action runs");
    expect(deltas[0].filed.verification).toContain("version loan");
  });
});

/* ------------------------------------------------------------------ the plan */

describe("the plan: one tool, and every figure names its loan", () => {
  it("is registered on the frozen pair and nowhere else", () => {
    expect(WRITE_TOOLS[AMEND_ACTION_ID]).toEqual({
      stage: "stage_amend_version",
      execute: "execute_amend_version",
      heldReason: null,
    });
  });

  it("stages scalars per target, never broadcast, even on a one-member plan", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await compose(engine, "take the purchase to 14,000,000");
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0] as StagePayloads["amend-version"];
    expect(payload.versionPackageId).toBe(VERSION);
    expect(payload.rationale).toContain("Amendment Workroom");
    expect(JSON.parse(payload.scalarChangesJson!)).toEqual([
      { key: "requestedAmount", value: 14_000_000, targetLoanId: V_PURCHASE },
    ]);
    // The flat keys do not exist on this wire at all.
    expect(payload).not.toHaveProperty("requestedAmount");
    expect(payload).not.toHaveProperty("facilityIds");
    expect(payload).not.toHaveProperty("productPackageId");
  });

  it("keeps two members' figures apart on one plan", async () => {
    const { engine, deps: d } = engineOn();
    const first = await compose(engine, "take the purchase to 14,000,000");
    const second = await compose(engine, "take the equipment rate to 6.25%");
    await engine.stagePlan([...first, ...second], context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0] as StagePayloads["amend-version"];
    expect(JSON.parse(payload.scalarChangesJson!)).toEqual([
      { key: "requestedAmount", value: 14_000_000, targetLoanId: V_PURCHASE },
      { key: "requestedRate", value: 6.25, targetLoanId: V_EQUIPMENT },
    ]);
  });

  it("carries a curated field change on the version's own loan", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await compose(engine, "set the first payment date on the purchase to 2027-02-01");
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0] as StagePayloads["amend-version"];
    expect(JSON.parse(payload.fieldChangesJson!)).toEqual([
      { field: "LLC_BI__First_Payment_Date__c", value: "2027-02-01", targetLoanId: V_PURCHASE },
    ]);
  });

  it("carries a net-new covenant on the version", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await compose(engine, "add a leverage covenant max 3.5x to the purchase - $12,000,000.00");
    await engine.stagePlan(deltas, context);
    const payload = (d.stage as ReturnType<typeof vi.fn>).mock.calls[0][0] as StagePayloads["amend-version"];
    const adds = JSON.parse(payload.covenantAddsJson!) as Array<Record<string, unknown>>;
    expect(adds).toHaveLength(1);
    expect(adds[0].targetLoanId).toBe(V_PURCHASE);
    expect(adds[0].threshold).toBe(3.5);
  });

  it("executes on the version's own loan and names it as the record written", async () => {
    const { engine, deps: d } = engineOn();
    const deltas = await compose(engine, "take the purchase to 14,000,000");
    const plan = await engine.stagePlan(deltas, context);
    const out = await engine.execute({
      planHash: plan.planHash,
      stagingId: plan.stagingId,
      decisionToken: plan.decisionToken!,
      approverUserId: "005bb00000ftouDAAQ",
    });
    expect((d.execute as ReturnType<typeof vi.fn>).mock.calls[0][0].stagingId).toBe(STAGE_RESULT.stagingId);
    expect(out.filed).toHaveLength(1);
    expect(out.filed[0].recordId).toBe(V_PURCHASE);
    expect(out.reply?.subject).toContain("amendment filed");
    expect(out.reply?.body).toContain("No new version was created and no credit action ran.");
  });
});

/* ----------------------------------------------------------------- the arms */

describe("the arms the amendment pair does not carry", () => {
  type ModPayload = StagePayloads["loan-modification"];
  const memberIds = new Set([V_EQUIPMENT, V_PURCHASE]);
  const convert = (over: Partial<Omit<ModPayload, "loanId" | "facilityIds">>) =>
    toAmendPayload(
      {
        idempotencyKey: "k",
        rationale: "Amendment Workroom: test.",
        facilityIds: [V_PURCHASE],
        productPackageId: VERSION,
        requestedAmount: null,
        requestedMaturityDate: null,
        requestedTermMonths: null,
        requestedRate: null,
        ...over,
      },
      { versionPackageId: VERSION, memberIds },
    );

  it("refuses a flat scalar, because on an amend every figure names its loan", () => {
    expect(() => convert({ requestedAmount: 14_000_000 })).toThrow(WorkroomRefusalError);
    expect(() => convert({ requestedAmount: 14_000_000 })).toThrow(/names the facility for every figure/);
  });

  it("refuses a policy exception with the contract's own reason", () => {
    expect(() => convert({ policyExceptionAddsJson: "[{}]" })).toThrow(/credit action against the clone it makes/);
  });

  it("refuses a carry exclusion, because an amendment rolls nothing", () => {
    expect(() => convert({ covenantExclusionsJson: "[{}]" })).toThrow(/rolls nothing/);
    expect(() => convert({ pledgeExclusionsJson: "[{}]" })).toThrow(/rolls nothing/);
  });

  it("refuses a borrowing-structure REMOVAL, because that is a real delete", () => {
    const json = JSON.stringify([{ op: "remove", accountName: "James Hartwell", targetLoanId: V_PURCHASE }]);
    expect(() => convert({ involvementChangesJson: json })).toThrow(/real delete/);
  });

  it("takes a borrowing-structure ADD", () => {
    const json = JSON.stringify([{ op: "add", role: "Guarantor", accountName: "Hartwell Logistics LLC", targetLoanId: V_PURCHASE }]);
    expect(convert({ involvementChangesJson: json }).involvementChangesJson).toBe(json);
  });

  it("refuses a net-new facility: that is the create room's filing", () => {
    expect(() => convert({ newFacilitiesJson: "[{}]" })).toThrow(/New facility/);
  });

  it("refuses a target that is not a facility on this version, by name", () => {
    const json = JSON.stringify([{ key: "requestedAmount", value: 1, targetLoanId: "a4Zbb000002ICnxEAG" }]);
    expect(() => convert({ scalarChangesJson: json })).toThrow(/is not a facility on this version/);
  });

  it("refuses a plan that carries no arm at all", () => {
    expect(() => convert({})).toThrow(/no amendment to stage/);
  });

  it("sends only the keys that carry something", () => {
    const json = JSON.stringify([{ key: "requestedRate", value: 6.25, targetLoanId: V_EQUIPMENT }]);
    const out = convert({ scalarChangesJson: json });
    expect(Object.keys(out).sort()).toEqual(["idempotencyKey", "rationale", "scalarChangesJson", "versionPackageId"]);
  });

  it("hands a policy exception off at the chip rather than letting it reach the wire", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent(
      "log a policy exception: advance rate above guideline on the purchase - $12,000,000.00, mitigated by the personal guaranty",
      context,
    );
    if (out.kind !== "deltas") throw new Error(`expected deltas, got ${out.kind}: ${out.reply}`);
    expect(out.deltas.every((d) => !d.fileable)).toBe(true);
    expect(out.deltas[0].handoff?.reason).toContain("an amendment makes none");
  });
});
