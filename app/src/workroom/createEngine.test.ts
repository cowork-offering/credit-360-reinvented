// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createCreateEngine, type CreateEngineDeps } from "./createEngine";
import { WorkroomRefusalError } from "./modifyEngine";
import { assertNoRecordIds } from "../actions/stagedPlan";
import { validatePlan } from "../actions/transitionAllowlist";
import type { BorrowerBundle, C360Data, Facility } from "../data/contract";
import type { WorkroomContext, WorkroomDelta } from "./types";

/* =============================================================================
   THE CREATION ENGINE, ON A MOCKED CHANNEL.

   What is proved here:

     - TWO DOORS, ONE ANCHOR. The package door sends `productPackageId` and no
       account; the account door sends `accountId` and no package, and the plan
       it gets back opens with `create_package`. Sending both is refused by the
       tool, and the payload type makes it a compile error here.
     - THE THREE THE TOOL REFUSES WITHOUT. Product, amount and purpose are
       collected one question at a time, and a plan missing one is refused HERE,
       in the tool's own words, rather than spending a round trip to be told.
     - THE TWO-INVOCATION RESUME. Invocation 1 comes back `partial` with the
       Loan Detail waiting; invocation 2 carries the SAME stagingId, planHash,
       idempotency key and token and finishes the tree. A resume that is still
       waiting is not a failure and does not read as one.
     - THE ALLOWLIST MIRROR. The org's own plan writes four objects, and every
       one of them has to be on the client-side fence or a real creation would
       be refused at the confirm gate.

   Envelopes: `observed-envelopes-relationship-actions.json`, live 2026-08-24.
   ============================================================================= */

const PACKAGE_ID = "a5Fbb000000IokjEAC";
const ACCOUNT_ID = "001bb00001KfNPkAAN";
const LINE_ID = "a4Zbb0000027MaYEAU";

const line: Facility = {
  loanId: LINE_ID,
  name: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
  productType: "Line of Credit",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 15_000_000,
  outstanding: 9_200_000,
  interestRate: 7.6,
  maturityDate: "2027-03-15",
};

const equipment: Facility = {
  loanId: "a4Zbb0000027MnREAU",
  name: "Hartwell Precision Manufacturing LLC - Equipment - $8,000,000.00",
  productType: "Equipment",
  productPackageId: PACKAGE_ID,
  stage: "Booked",
  status: "Active",
  committed: 8_000_000,
};

function bundleWith(facilities: Facility[] = [line, equipment]): BorrowerBundle {
  return {
    snapshot: { accountId: ACCOUNT_ID, name: "Hartwell Precision Manufacturing LLC", productPackageId: PACKAGE_ID, packageStage: "Complete" },
    exposure: {
      totalCommitted: 23_000_000,
      totalOutstanding: 15_100_000,
      totalUniqueCollateralLendableValue: 34_600_000,
      uniqueCollateralCount: 5,
      coverageRatio: 1.13,
      facilities,
    },
    graph: {
      legalEntities: [{ accountName: "Hartwell Precision Manufacturing LLC", borrowerType: "Borrower", loanId: LINE_ID, packageId: PACKAGE_ID }],
      connections: [{ counterpartyName: "Hartwell Logistics LLC", role: "Subsidiary", ownershipPercent: 100, isActive: true }],
    },
  };
}

/** THE ACCOUNT DOOR. No package anywhere in the read: not a failure, a fact. */
function bundleWithNoPackage(): BorrowerBundle {
  return {
    snapshot: { accountId: ACCOUNT_ID, name: "Hartwell Precision Manufacturing LLC" },
    exposure: { totalCommitted: 0, totalOutstanding: 0, facilities: [] },
    graph: { legalEntities: [], connections: [{ counterpartyName: "Hartwell Logistics LLC", role: "Subsidiary", ownershipPercent: 100, isActive: true }] },
  };
}

const data = {
  meta: { anchorAccountId: ACCOUNT_ID, generatedAt: "2026-08-27T08:00:00Z", user: "Fabian Goetzens", userId: "005bb00000ftouDAAQ" },
} as unknown as C360Data;

const packageDoor: WorkroomContext = {
  mode: "create",
  door: "package",
  accountId: ACCOUNT_ID,
  accountName: "Hartwell Precision Manufacturing LLC",
  productPackageId: PACKAGE_ID,
  packageName: "Hartwell Precision Manufacturing LLC credit package",
  approver: "Fabian Goetzens",
};

const accountDoor: WorkroomContext = { ...packageDoor, door: "account", productPackageId: null, packageName: "Hartwell Precision Manufacturing LLC · no package yet" };

/* THE OBSERVED STAGE ENVELOPE. Every step, object and field below appears
   verbatim in `observed-envelopes-relationship-actions.json`. */
const STAGE_RESULT = {
  stagingId: "a8abb00001NL3OpAAL",
  planHash: "6cb7d24fedba3c4ea2cfcdf3d8af92f579c333ac06cd2be9ed8ecab62bb32611",
  decisionToken: "8e50dfc454d0b465d290d8b8d7cac1aaf355caca91f4150ef6a54adcefccacd8",
  replayed: false,
  accountId: ACCOUNT_ID,
  productPackageId: PACKAGE_ID,
  createsPackage: false,
  summary: "Creates one facility at stage Qualification, status Open. The org names the record and assigns the loan officer.",
  warnings: [
    "The org rewrites the facility name as \"Account - Product - Amount\". The name you see after creation is the org's, not one this panel chose.",
    "A borrower row is added to the facility's borrowing structure as part of this action.",
  ],
  executionHeld: false,
  steps: [
    {
      id: "write_loan",
      type: "write",
      label: "Create the facility at Qualification on Hartwell Precision Manufacturing LLC - PP",
      objectName: "LLC_BI__Loan__c",
      fields: ["LLC_BI__Account__c", "LLC_BI__Product_Package__c", "LLC_BI__Stage__c", "LLC_BI__Status__c", "LLC_BI__isRenewal__c", "LLC_BI__Is_Modification__c", "LLC_BI__Product__c", "LLC_BI__Amount__c"],
      state: "pending",
    },
    {
      id: "write_involvement",
      type: "write",
      label: "Add the borrower to the facility's borrowing structure",
      objectName: "LLC_BI__Legal_Entities__c",
      fields: ["LLC_BI__Account__c", "LLC_BI__Loan__c", "LLC_BI__Product_Package__c", "LLC_BI__Borrower_Type__c", "LLC_BI__Ownership__c"],
      state: "pending",
    },
    { id: "verify_loan", type: "verification", label: "Read back the facility and report the name the org assigned", objectName: "LLC_BI__Loan__c", fields: ["Name", "LLC_BI__Stage__c", "LLC_BI__Product__c"], state: "pending" },
    { id: "wait_loan_detail", type: "wait", label: "nCino creates the Loan Detail, then this action continues", objectName: "LLC_BI__Loan_Detail__c", fields: [], state: "pending", waitBudgetMs: 30000 },
    { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose on the Loan Detail", objectName: "LLC_BI__Loan_Detail__c", fields: ["LLC_BI__Primary_Loan_Purpose__c"], state: "pending" },
    { id: "hop_to_proposal", type: "write", label: "Move the facility from Qualification to Proposal", objectName: "LLC_BI__Loan__c", fields: ["LLC_BI__Stage__c"], state: "pending" },
    { id: "verify_hop", type: "verification", label: "Confirm the facility now reads Proposal", objectName: "LLC_BI__Loan__c", fields: ["LLC_BI__Stage__c"], state: "pending" },
    { id: "observe_loan_officer", type: "observed_side_effect", label: "The org assigns the loan officer", state: "pending" },
  ],
};

/** The account door's plan: one extra step at the top, and nothing else moves. */
const STAGE_RESULT_CREATES_PACKAGE = {
  ...STAGE_RESULT,
  createsPackage: true,
  plannedPackageName: "Hartwell Precision Manufacturing LLC - 8/27/2026 - PP",
  productPackageId: undefined,
  steps: [
    { id: "create_package", type: "write", label: "Create the credit package Hartwell Precision Manufacturing LLC - 8/27/2026 - PP", objectName: "LLC_BI__Product_Package__c", fields: ["Name", "LLC_BI__Account__c"], state: "pending" },
    ...STAGE_RESULT.steps,
  ],
};

const EXECUTE_PARTIAL = {
  stagingId: STAGE_RESULT.stagingId,
  terminalState: "partial",
  resumable: true,
  replayed: false,
  recordName: "Hartwell Precision Manufacturing LLC - Equipment - $5,000,000.00",
  productPackageId: PACKAGE_ID,
  packageCreated: false,
  loanId: "a4Zbb000002CE2rEAG",
  involvementId: "a4Lbb000000OsIbEAK",
  stage: "Qualification",
  resumeDescriptor:
    "Continue this action to verify the Loan Detail and complete the move to Proposal. No new confirmation is needed: the same plan is still running.",
  outcome: "Facility filed at Qualification. The org creates the Loan Detail moments after filing, in its own transaction.",
  steps: [
    { id: "write_loan", type: "write", label: "Create the facility", state: "verified", detail: "Facility a4Zbb000002CE2rEAG created at Qualification." },
    { id: "write_involvement", type: "write", label: "Add the borrower", state: "verified", detail: "Borrower added to the borrowing structure at 100.00 percent ownership." },
    { id: "verify_loan", type: "verification", label: "Read back the facility", state: "verified", detail: "The org named this facility Hartwell Precision Manufacturing LLC - Equipment - $5,000,000.00 and set product Equipment." },
    { id: "wait_loan_detail", type: "wait", label: "nCino creates the Loan Detail", state: "waiting", detail: "It cannot be seen from here." },
    { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose", state: "pending" },
    { id: "hop_to_proposal", type: "write", label: "Move to Proposal", state: "pending" },
  ],
};

const EXECUTE_SUCCESS = {
  ...EXECUTE_PARTIAL,
  terminalState: "success",
  resumable: false,
  resumeDescriptor: undefined,
  packageCreated: null,
  stage: "Proposal",
  loanDetailId: "a4Wbb000001KLkTEAW",
  outcome: "Facility filed and moved to Proposal.",
  steps: [
    ...EXECUTE_PARTIAL.steps.slice(0, 3),
    { id: "wait_loan_detail", type: "wait", label: "nCino creates the Loan Detail", state: "verified", detail: "nCino created Loan Detail a4Wbb000001KLkTEAW." },
    { id: "write_loan_purpose", type: "write", label: "Set the primary loan purpose", state: "verified", detail: "Primary loan purpose set to equipment." },
    { id: "hop_to_proposal", type: "write", label: "Move to Proposal", state: "verified", detail: "Stage moved from Qualification to Proposal." },
  ],
};

function deps(over: Partial<CreateEngineDeps> = {}): CreateEngineDeps {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, result: EXECUTE_PARTIAL })
    .mockResolvedValueOnce({ ok: true, result: EXECUTE_SUCCESS });
  return {
    stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT }),
    execute,
    settle: vi.fn().mockResolvedValue(undefined),
    available: () => true,
    newKey: () => "wr-create-key",
    restate: undefined,
    ...over,
  };
}

function engineOn(over: Partial<CreateEngineDeps> = {}, context = packageDoor, bundle: BorrowerBundle | null = bundleWith()) {
  const d = deps(over);
  return { engine: createCreateEngine({ context, data, bundle, deps: d }), deps: d, context };
}

async function confirm(engine: ReturnType<typeof createCreateEngine>, line: string, context = packageDoor): Promise<WorkroomDelta[]> {
  const result = await engine.parseIntent(line, context);
  if (result.kind !== "deltas") throw new Error(`${line} → ${result.kind}: ${result.reply}`);
  return result.deltas;
}

/** The whole storyline: compose, confirm, stage, file — including the resume. */
async function filed(over: Partial<CreateEngineDeps> = {}, context = packageDoor, bundle: BorrowerBundle | null = bundleWith()) {
  const { engine, deps: d } = engineOn(over, context, bundle);
  const composed = await confirm(engine, "add a $5MM equipment facility over 60 months for equipment", context);
  engine.acknowledge(composed[0], composed);
  const plan = await engine.stagePlan(composed, context);
  const execution = await engine.execute({
    stagingId: plan.stagingId,
    planHash: plan.planHash,
    decisionToken: plan.decisionToken!,
    approverUserId: "Fabian Goetzens",
  });
  return { engine, deps: d, composed, plan, execution };
}

/* --------------------------------------------------------------------------- */

describe("a new facility creates a new package, and the room stands there", () => {
  it("opens the package door only where the banker joined one, on that package's own total", () => {
    const { engine } = engineOn();
    expect(engine.scripted).toBe(false);
    expect(engine.mode).toBe("create");
    const brief = engine.brief(packageDoor);
    expect(brief.position).toContain("2 members and $23M committed");
    expect(brief.position).toContain("taking this facility instead of a new package");
    expect(brief.showsMembers).toBe(true);
    expect(brief.position.split(/\s+/).length).toBeLessThan(60);
  });

  it("opens the account door on EVERY relationship, and states the default first", () => {
    /* THE RULE (founder, 2026-09-06). The account door used to mean "there is no
       package here"; it now means "a new facility creates a new package", which
       is true of a relationship with two packages exactly as it is of one with
       none. */
    const { engine } = engineOn({}, accountDoor, bundleWithNoPackage());
    const brief = engine.brief(accountDoor);
    expect(brief.position).toContain("This plan creates a new credit package.");
    expect(brief.showsMembers).toBe(false);
    expect(brief.baselineMembers).toBe(0);
    expect(brief.have[0].value).toBe("New package");
    // Nothing on this relationship, so nothing to offer and nothing to ask.
    expect(brief.packageChoices).toEqual([]);
    expect(brief.packageChoiceRequired).toBe(false);
  });

  it("still creates a new package where the relationship already carries booked ones", () => {
    const ctx = { ...packageDoor, door: "account" as const, productPackageId: null, packageName: "New package" };
    const { engine } = engineOn({}, ctx, bundleWith());
    const brief = engine.brief(ctx);
    expect(brief.position).toContain("This plan creates a new credit package.");
    // Both of Hartwell's packages are booked, so there is no exception to offer
    // and the room says why rather than going quiet about it.
    expect(brief.packageChoices).toEqual([]);
    expect(brief.have[0].detail).toContain("None of them is still before approval");
    expect(brief.baselineMembers).toBe(0);
  });

  it("names what the org names, so the room never claims it chose the facility's name", () => {
    const rows = engineOn().engine.brief(packageDoor).have;
    const org = rows.find((r) => r.label === "What the org names, not us")!;
    expect(org.detail).toContain("REBUILDS the name as Account - Product - Amount");
    expect(org.detail).toContain("assigns the officer");
  });

  it("says the tool files one borrowing-structure row and it is the borrower's", () => {
    const rows = engineOn().engine.brief(packageDoor).have;
    expect(rows.find((r) => r.label === "Borrowing structure")!.detail).toContain("100 percent ownership");
  });

  it("does NOT hold where the relationship carries several: it composes on a new one", async () => {
    /* THE BEAT THIS REPLACES. Two packages used to stop the room dead until one
       was picked. A new facility creates a new package, so there is nothing to
       pick before composing and the room takes the instruction straight away. */
    const two = bundleWith([line, { ...equipment, productPackageId: "a5Fbb000000OTHERAA" }]);
    const ctx = { ...packageDoor, door: "account" as const, productPackageId: null, packageName: "New package" };
    const engine = createCreateEngine({ context: ctx, data, bundle: two, deps: deps() });
    expect(engine.brief(ctx).packageChoiceRequired).toBe(false);
    const out = await engine.parseIntent("add an equipment facility", ctx);
    expect(out.kind).toBe("deltas");
  });

  it("offers an unapproved package as the one exception, after stating the default", async () => {
    /* THE EXCEPTION (founder, 2026-09-06): "you can add to product packages
       which are NOT approved (i.e. loans in pre-approval stages), of course not
       to the booked packages." */
    const open = bundleWith([{ ...equipment, stage: "Proposal" }]);
    open.snapshot = { ...open.snapshot, packageStage: "In Review" };
    const ctx = { ...packageDoor, door: "account" as const, productPackageId: null, packageName: "New package" };
    const engine = createCreateEngine({ context: ctx, data, bundle: open, deps: deps() });
    const brief = engine.brief(ctx);
    expect(brief.position).toContain("This plan creates a new credit package.");
    expect(brief.position).toContain("is still in In Review and can take the facility instead: say so, or carry on.");
    // The default leads the offer and is the one marked; the existing package is
    // on the table and is NEVER pre-selected.
    expect(brief.packageChoices.map((c) => c.label)).toEqual(["New package", "Hartwell Precision Manufacturing LLC credit package"]);
    expect(brief.packageChoices[0].selected).toBe(true);
    expect(brief.packageChoices[1].selected).toBe(false);
    expect(brief.packageChoices[1].figure).toContain("Still in In Review");
    expect(brief.packageChoiceRequired).toBe(false);
  });

  it("never offers a package that is booked, complete or past approval", () => {
    const ctx = { ...packageDoor, door: "account" as const, productPackageId: null, packageName: "New package" };
    // Stage before approval, but a booked member: the bank has money out on it.
    const booked = bundleWith([{ ...equipment, stage: "Booked" }]);
    booked.snapshot = { ...booked.snapshot, packageStage: "In Review" };
    expect(createCreateEngine({ context: ctx, data, bundle: booked, deps: deps() }).brief(ctx).packageChoices).toEqual([]);
    // Nothing booked, but the package's own stage is past approval.
    const late = bundleWith([{ ...equipment, stage: "Proposal" }]);
    late.snapshot = { ...late.snapshot, packageStage: "Complete" };
    expect(createCreateEngine({ context: ctx, data, bundle: late, deps: deps() }).brief(ctx).packageChoices).toEqual([]);
  });
});

describe("the room collects the three the tool refuses without", () => {
  it("takes product, amount and term from one sentence and asks for the purpose", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("add a $5MM equipment facility over 60 months", packageDoor);
    expect(out.kind).toBe("deltas");
    if (out.kind !== "deltas") return;
    expect(out.deltas.map((d) => d.title)).toEqual(["Product", "Amount", "Term (months)"]);
    expect(out.reply).toContain("What is the primary loan purpose?");
    // One question at a time, and a pending question suppresses the next pill.
    expect(engine.suggest()).toBeNull();
  });

  it("maps the wire keys the tool actually accepts", async () => {
    const deltas = await confirm(engineOn().engine, "add a $5MM equipment facility over 60 months");
    expect(deltas.map((d) => d.wire)).toEqual([
      { key: "product", value: "Equipment", facilityId: PACKAGE_ID },
      { key: "amount", value: 5_000_000, facilityId: PACKAGE_ID },
      { key: "termMonths", value: 60, facilityId: PACKAGE_ID },
    ]);
  });

  it("has no before, because there is no record until the plan runs", async () => {
    const deltas = await confirm(engineOn().engine, "add a $5MM equipment facility");
    expect(deltas.every((d) => d.before === "not on the deal — this plan creates it")).toBe(true);
    expect(deltas.find((d) => d.title === "Product")!.newMember).toBe(true);
    expect(deltas.find((d) => d.title === "Amount")!.committedDeltaMM).toBe(5);
  });

  it("names the facility as soon as it knows what it is, and files the purpose as a purpose", async () => {
    const { engine } = engineOn();
    const first = await confirm(engine, "add a $5MM equipment facility");
    // Before the product lands there is only "the new facility".
    expect(first.every((d) => d.target === "the new facility")).toBe(true);
    engine.acknowledge(first[0], first);
    const [purpose] = await confirm(engine, "the purpose is equipment");
    expect(purpose.target).toBe("the new Equipment facility");
    // The purpose is not a term: it lands on the Loan Detail, on the resume.
    expect(purpose.kind).toBe("Loan purpose");
    expect(first.find((d) => d.title === "Product")!.kind).toBe("New facility");
  });

  it("carries the chain a creation actually takes, so it cannot be staged as an orphan", async () => {
    const deltas = await confirm(engineOn().engine, "add a $5MM equipment facility");
    const chain = deltas.find((d) => d.title === "Product")!.chainLinks!;
    expect(chain.map((c) => c.object)).toEqual(["LLC_BI__Loan__c", "LLC_BI__Legal_Entities__c", "LLC_BI__Loan_Detail__c"]);
    expect(chain[2].note).toContain("two invocations");
  });

  it("answers its own question, so a one-word reply completes the composition", async () => {
    const { engine } = engineOn();
    const first = await engine.parseIntent("add a facility", packageDoor);
    expect(first.kind).toBe("unparsed");
    expect(first.reply).toContain("Which product?");

    const product = await engine.parseIntent("Equipment", packageDoor);
    expect(product.kind).toBe("deltas");
    if (product.kind !== "deltas") return;
    expect(product.reply).toContain("What amount?");
    // A one-word ANSWER still leaves a question open, so the pill stays down.
    expect(engine.suggest()).toBeNull();
  });

  it("puts the org's own validation caveat on the purpose, and never guesses the list", async () => {
    const deltas = await confirm(engineOn().engine, "an equipment facility for the tooling ramp");
    const purpose = deltas.find((d) => d.title === "Primary loan purpose")!;
    expect(purpose.caveat).toContain("names the legal values, verbatim");
    expect(purpose.map.find(([k]) => k === "Written as")![1]).toContain("second invocation, never the first");
  });

  it("stages a second entity as a handoff, because the tool files one row and it is the borrower's", async () => {
    const [delta] = await confirm(engineOn().engine, "add Hartwell Logistics LLC as a guarantor");
    expect(delta.fileable).toBe(false);
    expect(delta.handoff!.reason).toContain("exactly one borrowing-structure row");
    expect(delta.chainLinks![0].note).toContain("formulas derived from Borrower_Type");
  });

  it("answers a pick on the strip without pretending it can create what is already there", () => {
    const { engine } = engineOn();
    const out = engine.pick(LINE_ID)!;
    expect(out.reply).toContain("already on the package");
    expect(out.reply).toContain("adds a new facility beside it");
    expect(out.reply).toContain("Which product?");
  });

  it("closes the loop on a confirm, at package altitude, and asks the next thing", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "add a $5MM equipment facility");
    const amount = deltas.find((d) => d.title === "Amount")!;
    const { reply, challenge } = engine.acknowledge(amount, deltas);
    expect(reply).toContain("That takes the package from $23M to $28M.");
    expect(reply).toContain("What is the primary loan purpose?");
    // A new facility enlarges the commitment and brings no security with it,
    // which is the fact the check states whichever way the ratio lands.
    expect(challenge!.verdict).toBe("Coverage holds");
    expect(challenge!.line).toContain("pledges nothing of its own");
    expect(challenge!.rows).toContainEqual(["Committed with this facility", "$28M", "key"]);
    expect(challenge!.say).toContain("its own credit action");
  });

  it("offers the next move only once nothing is outstanding", async () => {
    const { engine } = engineOn();
    const deltas = await confirm(engine, "add a $5MM equipment facility for equipment");
    const { reply } = engine.acknowledge(deltas[0], deltas);
    expect(reply).toContain("Anything else in this package, or shall I file it?");
    expect(engine.suggest()).not.toBeNull();
  });
});

/* The product ask is now clickable everywhere it appears, not just on the pure
   clarify path. `optionsFor` reads the catalog directly (CREATE_PRODUCTS.map),
   so asserting against a literal here would drift if the catalog ever does;
   the tests below check shape and the label/say pairing instead. */
describe("the product catalog rides the reply, not just the clarify path", () => {
  it("keeps the product chips on a reply that also lands delta chips", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("a new 2 million facility for working capital", packageDoor);
    expect(out.kind).toBe("deltas");
    if (out.kind !== "deltas") return;
    // The sentence gave an amount and a purpose; product is still open, so the
    // reply both lands chips AND keeps asking — and now offers the catalog.
    expect(out.deltas.map((d) => d.title)).toEqual(["Amount", "Primary loan purpose"]);
    expect(out.reply).toContain("Which product?");
    expect(out.options?.map((o) => o.label)).toEqual(["Construction", "Deposit", "Equipment", "HELOC", "Line of Credit", "Purchase"]);
    expect(out.options?.every((o) => o.say === o.label)).toBe(true);
  });

  it("still offers the catalog on the pure clarify path (regression)", async () => {
    const { engine } = engineOn();
    const out = await engine.parseIntent("add a new facility", packageDoor);
    expect(out.kind).toBe("unparsed");
    if (out.kind !== "unparsed") return;
    expect(out.reply).toContain("Which product?");
    expect(out.options?.map((o) => o.label)).toContain("Line of Credit");
  });

  it("completes product selection when the tapped chip's own value is said back", async () => {
    const { engine } = engineOn();
    const first = await engine.parseIntent("a new 2 million facility for working capital", packageDoor);
    expect(first.kind).toBe("deltas");
    if (first.kind !== "deltas") return;
    const tapped = first.options!.find((o) => o.say === "Line of Credit")!;

    // A tap SAYS the value: it goes back through the same parser as a typed
    // answer, resolving the field the reply was still waiting on.
    const second = await engine.parseIntent(tapped.say, packageDoor);
    expect(second.kind).toBe("deltas");
    if (second.kind !== "deltas") return;
    expect(second.deltas.map((d) => d.title)).toEqual(["Product"]);
    expect(second.deltas[0].after).toBe("Line of Credit");
    // Amount and purpose were never confirmed onto the manifest in this flow,
    // so the room now asks for one of those next rather than reading as done.
    expect(second.reply).toContain("What amount?");
  });

  it("keeps offering the catalog on the confirm's own follow-up ask, once product is what is left", async () => {
    const { engine } = engineOn();
    const first = await engine.parseIntent("a new 2 million facility for working capital", packageDoor);
    expect(first.kind).toBe("deltas");
    if (first.kind !== "deltas") return;

    // Confirm the amount and purpose one at a time, exactly as the chip UI
    // does — each confirm adds one delta to the manifest and asks what is
    // still missing, which by the second confirm is only the product.
    let manifest: WorkroomDelta[] = [];
    let last: ReturnType<typeof engine.acknowledge> | null = null;
    for (const delta of first.deltas) {
      manifest = [...manifest, delta];
      last = engine.acknowledge(delta, manifest);
    }
    expect(last!.reply).toContain("Which product?");
    expect(last!.options?.map((o) => o.label)).toEqual(["Construction", "Deposit", "Equipment", "HELOC", "Line of Credit", "Purchase"]);

    // Saying the tapped chip's value now closes the composition outright: the
    // manifest already carries amount and purpose, so product is the last one.
    const tapped = last!.options!.find((o) => o.say === "Line of Credit")!;
    const third = await engine.parseIntent(tapped.say, packageDoor);
    expect(third.kind).toBe("deltas");
    if (third.kind !== "deltas") return;
    expect(third.reply).toContain("everything the tool requires");
  });
});

describe("staging refuses here what the org would refuse there", () => {
  it("sends the package anchor and no account on the package door", async () => {
    const { deps: d } = await filed();
    expect(vi.mocked(d.stage!).mock.calls[0][0]).toEqual({
      idempotencyKey: "wr-create-key",
      rationale: expect.stringContaining("New Facility Workroom"),
      productPackageId: PACKAGE_ID,
      product: "Equipment",
      amount: 5_000_000,
      termMonths: 60,
      primaryLoanPurpose: "equipment",
    });
    expect(vi.mocked(d.stage!).mock.calls[0][0]).not.toHaveProperty("accountId");
  });

  it("sends the account anchor and no package on the account door", async () => {
    const { deps: d } = await filed({ stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT_CREATES_PACKAGE }) }, accountDoor, bundleWithNoPackage());
    const payload = vi.mocked(d.stage!).mock.calls[0][0];
    expect(payload).toHaveProperty("accountId", ACCOUNT_ID);
    expect(payload).not.toHaveProperty("productPackageId");
  });

  it("refuses a plan with no product, in the tool's own words", async () => {
    const { engine, deps: d } = engineOn();
    const amount = await confirm(engine, "$5,000,000");
    await expect(engine.stagePlan(amount, packageDoor)).rejects.toThrow(WorkroomRefusalError);
    await expect(engine.stagePlan(amount, packageDoor)).rejects.toThrow(/product is required/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("refuses a plan with no purpose, naming what it gates", async () => {
    const { engine, deps: d } = engineOn();
    const composed = await confirm(engine, "add a $5MM equipment facility");
    await expect(engine.stagePlan(composed, packageDoor)).rejects.toThrow(/primaryLoanPurpose is required/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("refuses two different amounts, because one facility has one", async () => {
    const { engine } = engineOn();
    const first = await confirm(engine, "add a $5MM equipment facility for equipment");
    const second = await confirm(engine, "make it $6MM");
    await expect(engine.stagePlan([...first, ...second], packageDoor)).rejects.toThrow(/2 different values for amount/);
  });

  it("refuses to stage without a connector, and simulates nothing", async () => {
    const { engine, deps: d } = engineOn({ available: () => false });
    const composed = await confirm(engine, "add a $5MM equipment facility for equipment");
    await expect(engine.stagePlan(composed, packageDoor)).rejects.toThrow(/no connector/);
    expect(d.stage).not.toHaveBeenCalled();
  });

  it("hands the org's own refusal back verbatim", async () => {
    const { engine } = engineOn({
      stage: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "VALIDATION_FAILED", message: "product 'Term' is not offered by the Commercial Loan record type. Available: Construction, Deposit, Equipment, HELOC, Line of Credit, Purchase." },
      }),
    });
    const composed = await confirm(engine, "add a $5MM equipment facility for equipment");
    await expect(engine.stagePlan(composed, packageDoor)).rejects.toThrow(/not offered by the Commercial Loan record type/);
  });

  it("passes the allowlist mirror on the org's own plan, both doors", async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The observed plan writes four
    // objects — Loan, Legal_Entities, Loan_Detail and, on the account door,
    // Product_Package — and three of them had no policy on the client-side
    // fence, so every real creation would have been refused at the gate.
    const pkg = await filed();
    expect(validatePlan(pkg.plan.plan.steps)).toEqual([]);
    expect(assertNoRecordIds(pkg.plan.plan)).toEqual([]);

    const acct = await filed({ stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT_CREATES_PACKAGE }) }, accountDoor, bundleWithNoPackage());
    expect(validatePlan(acct.plan.plan.steps)).toEqual([]);
    expect(assertNoRecordIds(acct.plan.plan)).toEqual([]);
  });

  it("appends the handoffs and warns about them", async () => {
    const { engine } = engineOn();
    const composed = await confirm(engine, "add a $5MM equipment facility for equipment");
    const party = await confirm(engine, "add Hartwell Logistics LLC as a guarantor");
    const { plan } = await engine.stagePlan([...composed, ...party], packageDoor);
    expect(plan.steps.some((s) => s.id === "handoff_0")).toBe(true);
    expect(plan.warnings.at(-1)).toContain("handed off rather than filed");
  });
});

describe("execution is two invocations, and the second is not a retry", () => {
  it("resumes with the same ids and the token resent, and finishes the tree", async () => {
    const { deps: d } = await filed();
    expect(d.execute).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(d.execute!).mock.calls.map((c) => c[0]);
    expect(second).toEqual(first);
    expect(second).toEqual({
      idempotencyKey: "wr-create-key",
      stagingId: STAGE_RESULT.stagingId,
      planHash: STAGE_RESULT.planHash,
      // The Apex resume path never reads it, but the platform refuses a null:
      // `decisionToken` is required=true on the invocable variable.
      decisionToken: STAGE_RESULT.decisionToken,
      approverUserId: "005bb00000ftouDAAQ",
    });
    expect(d.settle).toHaveBeenCalledTimes(1);
  });

  it("reports the org's REAL ids: the facility, and the Loan Detail for the purpose", async () => {
    const { execution, composed } = await filed();
    const byTitle = new Map(execution.filed.map((f) => [composed.find((d) => d.id === f.deltaId)!.title, f]));
    expect(byTitle.get("Product")!.recordId).toBe("a4Zbb000002CE2rEAG");
    expect(byTitle.get("Primary loan purpose")!.recordId).toBe("a4Wbb000001KLkTEAW");
    expect(byTitle.get("Primary loan purpose")!.verification).toBe("Primary loan purpose set to equipment.");
  });

  it("names the package, the borrower row and the stage the org left it at", async () => {
    const { execution } = await filed();
    expect(execution.reply!.body).toContain("The org named it Hartwell Precision Manufacturing LLC - Equipment - $5,000,000.00.");
    expect(execution.reply!.body).toContain("Borrower added to the borrowing structure (a4Lbb000000OsIbEAK)");
    expect(execution.reply!.body).toContain("The facility reads at Proposal");
    expect(execution.reply!.body).toContain("Nothing is approved");
    expect(execution.tokenNote).toContain("Token redeemed by Fabian Goetzens");
    expect(execution.handoff).toBeUndefined();
  });

  it("reports a package the account door created", async () => {
    const created = { ...EXECUTE_SUCCESS, packageCreated: true, productPackageId: "a5Fbb000000NEWPKGAA" };
    const { execution } = await filed(
      {
        stage: vi.fn().mockResolvedValue({ ok: true, result: STAGE_RESULT_CREATES_PACKAGE }),
        execute: vi.fn().mockResolvedValueOnce({ ok: true, result: { ...EXECUTE_PARTIAL, packageCreated: true, productPackageId: "a5Fbb000000NEWPKGAA" } }).mockResolvedValueOnce({ ok: true, result: created }),
      },
      accountDoor,
      bundleWithNoPackage(),
    );
    expect(execution.reply!.body).toContain("Package a5Fbb000000NEWPKGAA created");
    expect(execution.reply!.body).toContain("That opens the new package at $5M.");
    // AND THE ROOM CARRIES IT OUT. The sheet's version clause, the dossier's
    // deep link and the memo's anchor all read this one field, so a created
    // package that reached only the reply body would still be a lost fact.
    expect(execution.outputPackageId).toBe("a5Fbb000000NEWPKGAA");
  });

  /* ============================ THE FAILED-EXECUTE SEAM (2026-09-06)

     Same defect as `modifyEngine`: `filed` was built from the MANIFEST the room
     sent rather than from what the org answered, so a run the org reported as
     failed reached the room carrying record ids for writes that never happened.
     (chaos.mjs `garbage-on-execute`, red until now.) */
  it("carries the org's terminalState and the package the filing landed on", async () => {
    const { execution } = await filed();
    expect(execution.terminalState).toBe("success");
    expect(execution.outputPackageId).toBe(PACKAGE_ID);
  });

  it("REFUSES to build a filed list from a run the org reported failed", async () => {
    const { execution } = await filed({
      execute: vi.fn().mockResolvedValue({
        ok: true,
        result: { ...EXECUTE_SUCCESS, terminalState: "failed", outcome: "The facility could not be created.", loanId: undefined },
      }),
    });
    expect(execution.filed).toEqual([]);
    expect(execution.terminalState).toBe("failed");
    expect(execution.handoff).toBe("The facility could not be created.");
  });

  it("says so even when the org names no reason, rather than inventing one", async () => {
    const { execution } = await filed({
      execute: vi.fn().mockResolvedValue({ ok: true, result: { ...EXECUTE_SUCCESS, terminalState: "failed", outcome: "" } }),
    });
    expect(execution.filed).toEqual([]);
    expect(execution.handoff).toContain("gave no reason with it");
  });

  it("reads a still-waiting resume as waiting, never as a failure", async () => {
    const { execution } = await filed({
      execute: vi.fn().mockResolvedValue({ ok: true, result: EXECUTE_PARTIAL }),
    });
    expect(execution.handoff).toBe(EXECUTE_PARTIAL.resumeDescriptor);
    expect(execution.handoff).not.toMatch(/fail|error/i);
    // The facility is filed either way, and the purpose says where it landed.
    expect(execution.filed.find((f) => f.recordId === "a4Zbb000002CE2rEAG")).toBeTruthy();
    expect(execution.filed.some((f) => f.recordId === "the org has not created the Loan Detail yet")).toBe(true);
  });

  it("keeps the filing when the resume itself fails, and says what did not finish", async () => {
    const { execution } = await filed({
      execute: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, result: EXECUTE_PARTIAL })
        .mockResolvedValueOnce({ ok: false, error: { code: "PRECONDITION", message: "The staging row is no longer resumable." } }),
    });
    // A FAILED RESUME IS NOT A FAILED CREATE: the facility exists by then.
    expect(execution.handoff).toContain("The facility is filed.");
    expect(execution.handoff).toContain("The staging row is no longer resumable.");
    expect(execution.filed.find((f) => f.recordId === "a4Zbb000002CE2rEAG")).toBeTruthy();
  });

  it("does not resume at all when the first invocation already finished", async () => {
    const { deps: d } = await filed({ execute: vi.fn().mockResolvedValue({ ok: true, result: EXECUTE_SUCCESS }) });
    expect(d.execute).toHaveBeenCalledTimes(1);
    expect(d.settle).not.toHaveBeenCalled();
  });

  it("refuses a used confirmation and one that no longer matches the plan", async () => {
    const { engine, plan } = await filed();
    const approval = { stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" };
    await expect(engine.execute(approval)).rejects.toThrow(/already been used/);
    await expect(engine.execute({ ...approval, planHash: "moved", decisionToken: "other" })).rejects.toThrow(/no longer applies/);
  });

  it("refuses to file without a Salesforce user id for the signed-in identity", async () => {
    const nameOnly = { meta: { generatedAt: "2026-08-27T08:00:00Z", user: "Fabian Goetzens" } } as unknown as C360Data;
    const d = deps();
    const engine = createCreateEngine({ context: packageDoor, data: nameOnly, bundle: bundleWith(), deps: d });
    const composed = await confirm(engine, "add a $5MM equipment facility for equipment");
    const plan = await engine.stagePlan(composed, packageDoor);
    await expect(
      engine.execute({ stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" }),
    ).rejects.toThrow(/no Salesforce user id/);
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("refuses to file a plan the org itself holds", async () => {
    const { engine } = engineOn({
      stage: vi.fn().mockResolvedValue({ ok: true, result: { ...STAGE_RESULT, executionHeld: true, heldReason: "The org holds this one." } }),
    });
    const composed = await confirm(engine, "add a $5MM equipment facility for equipment");
    const plan = await engine.stagePlan(composed, packageDoor);
    await expect(
      engine.execute({ stagingId: plan.stagingId, planHash: plan.planHash, decisionToken: plan.decisionToken!, approverUserId: "Fabian Goetzens" }),
    ).rejects.toThrow("The org holds this one.");
  });
});

describe("the suggestion grammar offers only what the read supplies", () => {
  it("offers another of what the package already carries, and says so", () => {
    const pill = engineOn().engine.suggest()!;
    expect(["Add another Line of Credit", "Add another Equipment"]).toContain(pill.label);
    expect(pill.say).toMatch(/^add a .* facility$/);
  });

  it("offers the client's own product and figure where a request carries them", () => {
    const withAsk = bundleWith();
    withAsk.requests = [
      {
        id: "req-1",
        channel: "email",
        receivedAt: "2026-08-27T08:02:00Z",
        summary: "They want an equipment line for the Kokomo tooling ramp.",
        ask: { type: "new_facility", to: 5_000_000, facilityName: "Equipment" },
      },
    ];
    const engine = createCreateEngine({ context: packageDoor, data, bundle: withAsk, deps: deps() });
    expect(engine.suggest()!.label).toBe("Add the Equipment the client asked for");
    expect(engine.brief(packageDoor).askPin).toBe("Client asks $5M");
  });

  it("offers nothing to invent when the read supplies nothing", () => {
    const engine = createCreateEngine({ context: accountDoor, data, bundle: bundleWithNoPackage(), deps: deps() });
    // No package, no members, no request: the only honest first move is the
    // room's own question, which the position already asks.
    expect(engine.suggest()!.label).toBe("Add Hartwell Logistics LLC as a guarantor");
  });
});
