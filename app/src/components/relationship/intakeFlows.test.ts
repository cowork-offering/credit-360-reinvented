import { describe, expect, it, vi } from "vitest";
import type { BorrowerBundle, C360Data } from "../../data/contract";
import type { OrgCatalog } from "../../channel/catalog";
import type { StagedOutput } from "../../actions/stagedPlan";
import type { ExecuteResult, StagePayloads, ToolOutcome } from "../../channel/writeTools";
import {
  REL_FLOWS,
  nextStep,
  relContextFor,
  relReadyLine,
  stageRelPlan,
  type Answers,
  type RelContext,
  type RelFlowDeps,
} from "./reviewFlows";
import { readRelRouteIntent, readsAsIntake, REL_ROUTE_WORD } from "./relRoute";
import {
  EFFECTIVE_DATE_IS_FINAL,
  INTAKE_CAP,
  INTAKE_CAP_REFUSAL,
  NO_PLEDGE_NO_LIEN,
  VALUE_MUST_BE_POSITIVE,
  addressLine,
  buildIntakePayload,
  collateralDrafts,
  covenantDrafts,
  firstOfNextMonth,
  inferOperator,
  intakeConfirmSentence,
  intakeDossierRows,
  intakeKindOf,
  intakeRows,
  ownerOptions,
  readAddress,
  readAmount,
  readFrequency,
  readOperator,
  resolveCovenantType,
} from "./intakeFlows";

/* =============================================================================
   THE INTAKE ROUTE.

   The sixth route is the only one that AUTHORS, so what these prove is the pair
   of things that would be worst if they drifted: the machine asks for exactly
   what the human owns and nothing the org computes, and the wire it composes
   carries the frozen contract's own keys and no others.

   THE LOOPS ARE THE OTHER HALF. Three covenants and two assets in one plan is
   the shape the founder's drive walks, and a loop that does not terminate is a
   hung room rather than a wrong answer, so the walk is asserted rather than
   assumed.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const AS_OF = "2026-08-31T09:00:00Z";

/** The org's own names, in the shape `Customer360Catalog` returns them. */
const CATALOG: OrgCatalog = {
  fields: [
    {
      objectName: "LLC_BI__Covenant2__c",
      fieldName: "LLC_BI__Covenant_Type__c",
      source: "catalog",
      values: [
        { label: "Debt Service Coverage of Borrower", value: "a3A1" },
        { label: "Minimum Tangible Net Worth", value: "a3A2" },
        { label: "Maximum Debt to Worth", value: "a3A3" },
        { label: "Minimum Liquidity", value: "a3A4" },
      ],
      acceptedValues: [],
    },
    {
      objectName: "LLC_BI__Collateral__c",
      fieldName: "LLC_BI__Collateral_Type__c",
      source: "picklist",
      values: [
        { label: "Equipment", value: "Equipment" },
        { label: "Real Estate-Warehouse", value: "Real Estate-Warehouse" },
        { label: "Real Estate-Office", value: "Real Estate-Office" },
        { label: "Accounts Receivable", value: "Accounts Receivable" },
      ],
      acceptedValues: ["Equipment", "Real Estate-Warehouse", "Real Estate-Office", "Accounts Receivable"],
    },
  ],
};

function ctxFor(opts: { catalog?: OrgCatalog | null } = {}): RelContext {
  const bundle = {
    snapshot: { accountId: ACCOUNT, name: "Hartwell Precision Manufacturing LLC", productPackageId: "a5F1" },
    graph: {
      connections: [
        { counterpartyId: "001GUARANTOR001", counterpartyName: "Hartwell Holdings LLC", role: "Guarantor", isActive: true },
        { counterpartyName: "Kokomo Property Trust", role: "Related Entity", isActive: true },
      ],
      legalEntities: [{ accountName: "Hartwell Precision Manufacturing LLC" }],
    },
    covenants: {
      covenants: [
        { covenantId: "a2X1", covenantType: "Debt Service Coverage of Borrower", frequency: "Quarterly" },
        { covenantId: "a2X2", covenantType: "Maximum Debt to Worth", frequency: "Quarterly" },
      ],
    },
    exposure: {
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          collateral: [{ collateralId: "a341", collateralType: "Equipment", collateralDescription: "CNC line" }],
        },
      ],
    },
  } as unknown as BorrowerBundle;
  const data = { meta: { generatedAt: AS_OF } } as unknown as C360Data;
  return relContextFor({
    data,
    bundle,
    accountId: ACCOUNT,
    accountName: "Hartwell Precision Manufacturing LLC",
    catalog: opts.catalog === undefined ? CATALOG : opts.catalog,
  });
}

/** Walk the machine, answering each step with what the driver says, exactly as
 *  the room's own `record` writes an answer. */
function answer(a: Answers, key: string, value: unknown): void {
  const dot = key.indexOf(".");
  if (dot === -1) {
    a[key] = value;
    return;
  }
  const group = key.slice(0, dot);
  const id = key.slice(dot + 1);
  const held = a[group];
  const next = held && typeof held === "object" && !Array.isArray(held) ? { ...(held as Record<string, unknown>) } : {};
  next[id] = value;
  a[group] = next;
}

/** Run the machine to the end, taking each answer from `script` by step key. */
function drive(ctx: RelContext, script: Record<string, unknown>, cap = 80): { answers: Answers; asked: string[] } {
  const answers: Answers = {};
  const asked: string[] = [];
  for (let i = 0; i < cap; i++) {
    const step = nextStep("intake", ctx, answers);
    if (!step) return { answers, asked };
    asked.push(step.key);
    if (!(step.key in script)) throw new Error(`the machine asked ${step.key}, which the script does not answer`);
    answer(answers, step.key, script[step.key]);
  }
  throw new Error(`the machine did not settle in ${cap} questions: ${asked.join(", ")}`);
}

/* ------------------------------------------------------------- the reading */

describe("a line that puts something onto the relationship opens the intake", () => {
  it("takes a create, in either half", () => {
    expect(readRelRouteIntent("add a relationship covenant: minimum tangible net worth of 12M tested annually")).toBe("intake");
    expect(readRelRouteIntent("create covenants")).toBe("intake");
    expect(readRelRouteIntent("add collateral: forklift fleet, Equipment, valued at 250,000")).toBe("intake");
    expect(readRelRouteIntent("register a new asset the borrower owns")).toBe("intake");
  });

  it("leaves the five reviews exactly where they were", () => {
    expect(readRelRouteIntent("covenant review")).toBe("covenant");
    expect(readRelRouteIntent("run the annual review")).toBe("annual");
    expect(readRelRouteIntent("revalue the collateral")).toBe("valuation");
    expect(readRelRouteIntent("re-rate this borrower")).toBe("rating");
    expect(readRelRouteIntent("raise a ticket for a payoff quote")).toBe("service");
    expect(readRelRouteIntent("the client wants a covenant waiver")).toBe("covenant");
  });

  /* A CREATE THAT NAMES A FACILITY IS FACILITY WORK, and the handoff that has
     always answered it still does. The intake never takes a pledge. */
  it("refuses the facility's own creates, so the handoff still answers them", () => {
    expect(readsAsIntake("pledge the equipment to the 8M loan")).toBe(false);
    expect(readsAsIntake("add a covenant to the line of credit")).toBe(false);
    expect(readsAsIntake("create a new facility")).toBe(false);
    expect(readRelRouteIntent("pledge the equipment to the 8M loan")).toBeNull();
  });

  it("names the route in banker grammar", () => {
    expect(REL_ROUTE_WORD.intake).toBe("relationship intake");
  });
});

describe("the readers only claim what the line actually said", () => {
  it("reads a figure the way a banker writes one", () => {
    expect(readAmount("12M")).toBe(12_000_000);
    expect(readAmount("$12.5MM")).toBe(12_500_000);
    expect(readAmount("1.25x")).toBe(1.25);
    expect(readAmount("250,000")).toBe(250_000);
    expect(readAmount("no number here")).toBeNull();
  });

  it("reads an operator in symbols or in words, and nothing where there is none", () => {
    expect(readOperator(">= 1.25")).toBe(">=");
    expect(readOperator("at least 1.25x")).toBe(">=");
    expect(readOperator("no more than 3.00")).toBe("<=");
    expect(readOperator("strictly above 2")).toBe(">");
    expect(readOperator("1.25")).toBeNull();
  });

  it("reads the schedule the agreement sets", () => {
    expect(readFrequency("tested annually")).toBe("Annually");
    expect(readFrequency("every quarter")).toBe("Quarterly");
    expect(readFrequency("tested")).toBeNull();
  });

  /* THE DIRECTION IS A FAMILY CONVENTION AND NEVER A GUESS. Where the family
     does not settle it the room asks, which is the whole point of returning
     null rather than a default. */
  it("infers the direction only where the bank's families settle it", () => {
    expect(inferOperator("Minimum Tangible Net Worth")).toBe(">=");
    expect(inferOperator("Debt Service Coverage of Borrower")).toBe(">=");
    expect(inferOperator("Maximum Debt to Worth")).toBe("<=");
    expect(inferOperator("Leverage")).toBe("<=");
    expect(inferOperator("Term Covenants (Kokomo)")).toBeNull();
  });

  it("matches a covenant type only against the org's own names", () => {
    const names = ["Minimum Tangible Net Worth", "Net Worth"];
    expect(resolveCovenantType("minimum tangible net worth", names)).toBe("Minimum Tangible Net Worth");
    // Longest wins, so the qualifier is not thrown away.
    expect(resolveCovenantType("add a Minimum Tangible Net Worth covenant", names)).toBe("Minimum Tangible Net Worth");
    expect(resolveCovenantType("fixed charge coverage", names)).toBeNull();
  });

  it("reads an address as an address, and says what it read", () => {
    expect(readAddress("1400 Industrial Parkway, Fort Wayne, IN 46802")).toEqual({
      street: "1400 Industrial Parkway",
      city: "Fort Wayne",
      state: "IN",
      zip: "46802",
    });
    expect(addressLine(readAddress("1400 Industrial Parkway, Fort Wayne, IN 46802"))).toBe(
      "1400 Industrial Parkway, Fort Wayne, IN 46802",
    );
    expect(readAddress("")).toBeNull();
  });

  it("computes both date offers off the artifact's own clock", () => {
    expect(firstOfNextMonth("2026-08-31T09:00:00Z")).toBe("2026-09-01");
    expect(firstOfNextMonth("2026-12-04T09:00:00Z")).toBe("2027-01-01");
    expect(firstOfNextMonth(null)).toBeNull();
  });
});

/* ----------------------------------------------------------- the covenants */

describe("the covenant intake", () => {
  it("asks the test, the terms, the schedule and the date, and nothing the org computes", () => {
    const ctx = ctxFor();
    const { asked } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Minimum Tangible Net Worth",
      "covTerms.0": "12,000,000",
      "covFrequency.0": "Annually",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "done",
    });
    expect(asked).toEqual([
      "intakeKind",
      "covTest.0",
      "covTerms.0",
      "covFrequency.0",
      "covEffective.0",
      "covNotes.0",
      "covMore.0",
    ]);
    // Never the advance rate, never the lendable value, never the schedule.
    expect(asked.join(" ")).not.toMatch(/advance|lendable|schedule|compliance/i);
  });

  /* FREE TEXT ALWAYS WINS. The intent route hands this flow one sentence and it
     has to land: everything the sentence settled is not asked again. */
  it("takes the whole thing from the opening line, and asks only what is left", () => {
    const ctx = ctxFor();
    const { asked, answers } = drive(ctx, {
      intakeKind: "add a relationship covenant: minimum tangible net worth of 12M tested annually",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "done",
    });
    expect(asked).toEqual(["intakeKind", "covEffective.0", "covNotes.0", "covMore.0"]);
    const [draft] = covenantDrafts(ctx, answers);
    expect(draft).toMatchObject({
      typeName: "Minimum Tangible Net Worth",
      operator: ">=",
      threshold: 12_000_000,
      frequency: "Annually",
      effectiveDate: "2026-09-01",
    });
  });

  it("offers the org's own names as chips, what the relationship already tests first", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covTest.0");
    expect(step.options?.map((o) => o.label)).toEqual([
      "Debt Service Coverage of Borrower",
      "Maximum Debt to Worth",
      "Minimum Tangible Net Worth",
      "Minimum Liquidity",
    ]);
    expect(step.options?.[0].detail).toBe("already tested on this relationship");
  });

  /* A NAME THE ORG DOES NOT HOLD IS REFUSED BY NAME AND ASKED AGAIN, not filed
     as something adjacent and not carried to a refusal at the confirm gate. */
  it("refuses a type the org does not hold, and asks again with the org's names", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "fixed charge coverage");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covPick.0");
    expect(step.kind).toBe("chips");
    expect(step.ask).toContain("holds no covenant type called fixed charge coverage");
    expect(step.options?.length).toBe(4);
  });

  it("names a test the relationship already carries and asks before adding a second", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Maximum Debt to Worth");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covSecond.0");
    expect(step.ask).toContain("already carries a Maximum Debt to Worth covenant");
  });

  it("drops the entry the banker dropped, and still ends the loop", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Maximum Debt to Worth",
      "covSecond.0": "drop",
      "covMore.0": "done",
    });
    expect(intakeRows(ctx, answers)).toEqual([]);
    expect(buildIntakePayload(ctx, answers, "idem-1").ok).toBe(false);
  });

  it("proposes the direction as a proposal and takes the threshold in the same question", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covTerms.0");
    expect(step.ask).toContain("must be at least");
    expect(step.ask).toContain("unless you say otherwise");
    expect(step.options?.map((o) => o.value)).toEqual(["<", "<=", "=", ">=", ">"]);
    expect(step.target).toEqual({ object: "LLC_BI__Covenant2__c", field: "Acnpex_Operator__c" });
  });

  /* AN OPERATOR CHIP ANSWERS HALF THE QUESTION, so the figure is asked for on
     its own rather than the room filing a covenant with no threshold. */
  it("asks for the figure on its own where the answer carried only a direction", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    answer(a, "covTerms.0", ">=");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covThreshold.0");
    expect(step.kind).toBe("number");
    expect(step.target).toEqual({
      object: "LLC_BI__Covenant2__c",
      field: "LLC_BI__Financial_Indicator_Value__c",
    });
  });

  it("asks the direction where the bank's families do not settle it", () => {
    const ctx = ctxFor({ catalog: { fields: [
      {
        objectName: "LLC_BI__Covenant2__c",
        fieldName: "LLC_BI__Covenant_Type__c",
        source: "catalog",
        values: [{ label: "Term Covenants (Kokomo)", value: "a3A9" }],
        acceptedValues: [],
      },
    ] } });
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Term Covenants (Kokomo)");
    const terms = nextStep("intake", ctx, a)!;
    expect(terms.ask).toContain("I will not guess it");
    answer(a, "covTerms.0", "5");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covOperator.0");
  });

  it("offers today, the 1st of next month and another date, on the real clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T09:00:00Z"));
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    answer(a, "covTerms.0", ">= 5,000,000");
    answer(a, "covFrequency.0", "Quarterly");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covEffective.0");
    expect(step.options?.map((o) => o.value)).toEqual(["2026-08-31", "2026-09-01", "__other_date__"]);
    expect(step.ask).toContain(EFFECTIVE_DATE_IS_FINAL);
    vi.useRealTimers();
  });

  it("takes a date of the banker's own when neither offer fits", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    answer(a, "covTerms.0", ">= 5,000,000");
    answer(a, "covFrequency.0", "Quarterly");
    answer(a, "covEffective.0", "__other_date__");
    expect(nextStep("intake", ctx, a)!.key).toBe("covEffectiveOther.0");
  });

  it("puts the frequencies this relationship already runs at the front", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    answer(a, "covTerms.0", ">= 5,000,000");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("covFrequency.0");
    expect(step.options?.[0]).toMatchObject({ value: "Quarterly", detail: "already run on this relationship" });
    expect(step.options?.map((o) => o.value)).toContain("Annually");
  });

  it("loops on 'another one' and stops on 'that is all'", () => {
    const ctx = ctxFor();
    const { answers, asked } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Minimum Tangible Net Worth",
      "covTerms.0": ">= 12,000,000",
      "covFrequency.0": "Annually",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "more",
      "covTest.1": "Minimum Liquidity",
      "covTerms.1": ">= 5,000,000",
      "covFrequency.1": "Quarterly",
      "covEffective.1": "2026-09-01",
      "covNotes.1": "__skipped__",
      "covMore.1": "more",
      "covTest.2": "Debt Service Coverage of Borrower",
      "covSecond.2": "second",
      "covTerms.2": ">= 1.25",
      "covFrequency.2": "Quarterly",
      "covEffective.2": "2026-09-01",
      "covNotes.2": "the agreement resets it at closing",
      "covMore.2": "done",
    });
    expect(asked.filter((k) => k.startsWith("covTest"))).toHaveLength(3);
    expect(covenantDrafts(ctx, answers)).toHaveLength(3);
    expect(intakeRows(ctx, answers).map((r) => r.label)).toEqual([
      "Minimum Tangible Net Worth",
      "Minimum Liquidity",
      "Debt Service Coverage of Borrower",
    ]);
  });

  it("states the cap on the tenth rather than at the confirm gate", () => {
    expect(INTAKE_CAP).toBe(10);
    expect(INTAKE_CAP_REFUSAL).toContain("governor budget");
  });
});

/* ---------------------------------------------------------- the collateral */

describe("the collateral intake", () => {
  it("asks the type, the description, the value, the basis, the source, the date, the address and the owner", () => {
    const ctx = ctxFor();
    const { asked } = drive(ctx, {
      intakeKind: "collateral",
      "colType.0": "Equipment",
      "colDescription.0": "Two Haas VF-4SS machining centres",
      "colValue.0": 850_000,
      "colBasis.0": "Net Orderly Liquidation Value",
      "colSource.0": "Appraisal",
      "colValuationDate.0": "2026-08-31",
      "colAddress.0": "1400 Industrial Parkway, Fort Wayne, IN 46802",
      "colOwner.0": ACCOUNT,
      "colMore.0": "done",
    });
    expect(asked).toEqual([
      "intakeKind",
      "colType.0",
      "colDescription.0",
      "colValue.0",
      "colBasis.0",
      "colSource.0",
      "colValuationDate.0",
      "colAddress.0",
      "colOwner.0",
      "colMore.0",
    ]);
  });

  it("says on the first question that this pledges nothing and secures nothing", () => {
    const ctx = ctxFor();
    const step = nextStep("intake", ctx, { intakeKind: "collateral" })!;
    expect(step.key).toBe("colType.0");
    expect(step.ask).toContain(NO_PLEDGE_NO_LIEN);
  });

  it("offers families first, and the family this relationship already holds leads", () => {
    const ctx = ctxFor();
    const step = nextStep("intake", ctx, { intakeKind: "collateral" })!;
    expect(step.options?.map((o) => o.label)).toEqual(["Equipment", "Real Estate", "Accounts Receivable"]);
    // A family of one IS the exact name; a family of several is a second beat.
    expect(step.options?.[0].value).toBe("Equipment");
    expect(step.options?.[1].value).toBe("Real Estate");
  });

  it("asks which member when the banker names a family the org splits", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "collateral" };
    answer(a, "colType.0", "Real Estate");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("colPick.0");
    expect(step.options?.map((o) => o.value)).toEqual(["Real Estate-Warehouse", "Real Estate-Office"]);
  });

  it("refuses a value of zero or less by name, on the step", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "collateral" };
    answer(a, "colType.0", "Equipment");
    answer(a, "colDescription.0", "A forklift fleet");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("colValue.0");
    expect(step.bounds?.refusal).toBe(VALUE_MUST_BE_POSITIVE);
    expect(step.bounds?.min).toBeGreaterThan(0);
  });

  /* THE OWNERSHIP JUNCTION IS THE ONLY LINK COLLATERAL HAS TO AN ACCOUNT, so a
     party the read carries by NAME and no id is named and refused rather than
     hidden, and rather than anchored on a string. */
  it("offers the relationship and the parties with an id, and disables the ones without", () => {
    const ctx = ctxFor();
    const owners = ownerOptions(ctx);
    expect(owners[0].value).toBe(ACCOUNT);
    expect(owners[0].disabled).toBeUndefined();
    const guarantor = owners.find((o) => o.label === "Hartwell Holdings LLC")!;
    expect(guarantor.value).toBe("001GUARANTOR001");
    expect(guarantor.disabled).toBeUndefined();
    const noId = owners.find((o) => o.label === "Kokomo Property Trust")!;
    expect(noId.disabled).toBe(true);
    expect(noId.reason).toContain("no account id");
  });

  it("loops over two assets and reads them back as assets", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "collateral",
      "colType.0": "Equipment",
      "colDescription.0": "Two Haas VF-4SS machining centres",
      "colValue.0": 850_000,
      "colBasis.0": "Net Orderly Liquidation Value",
      "colSource.0": "Appraisal",
      "colValuationDate.0": "2026-08-31",
      "colAddress.0": "1400 Industrial Parkway, Fort Wayne, IN 46802",
      "colOwner.0": ACCOUNT,
      "colMore.0": "more",
      "colType.1": "Real Estate",
      "colPick.1": "Real Estate-Warehouse",
      "colDescription.1": "Kokomo distribution warehouse",
      "colValue.1": 4_200_000,
      "colBasis.1": "Fair Market Value - Real Estate",
      "colSource.1": "Real Estate Evaluation",
      "colValuationDate.1": "__skipped__",
      "colAddress.1": "900 Markland Avenue, Kokomo, IN 46901",
      "colOwner.1": "001GUARANTOR001",
      "colMore.1": "done",
    });
    const drafts = collateralDrafts(ctx, answers);
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({
      collateralType: "Real Estate-Warehouse",
      description: "Kokomo distribution warehouse",
      value: 4_200_000,
      ownerAccountId: "001GUARANTOR001",
      ownerName: "Hartwell Holdings LLC",
    });
    expect(intakeRows(ctx, answers).map((r) => r.label)).toEqual([
      "Two Haas VF-4SS machining centres",
      "Kokomo distribution warehouse",
    ]);
  });
});

/* =============================================================================
   THE FIRST STEP: FILE A NEW ASSET, OR IS THIS ONE THE BOOK ALREADY HOLDS?
   (founder, 2026-09-03, the same fix as the facility room's pledge lane:
   "is it not offering the collaterals from my account to pledge towards it?")
   ============================================================================= */

/** `ctxFor`'s own facility plus one whose only pledge reads Inactive, so the
 *  asset it names carries no ACTIVE pledge anywhere: "Unpledged" on the
 *  collateral pane, and the set this step offers. */
function ctxWithUnpledged(): RelContext {
  const bundle = {
    snapshot: { accountId: ACCOUNT, name: "Hartwell Precision Manufacturing LLC", productPackageId: "a5F1" },
    graph: { connections: [], legalEntities: [{ accountName: "Hartwell Precision Manufacturing LLC" }] },
    covenants: { covenants: [] },
    exposure: {
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          collateral: [{ collateralId: "a341", collateralType: "Equipment", collateralDescription: "CNC line" }],
        },
        {
          loanId: "0Cb2",
          status: "Active",
          collateral: [
            {
              collateralId: "a342",
              collateralType: "UCC-Accounts",
              collateralDescription: "All present and future accounts receivable. Excludes invoices over 90 days past due.",
              pledgedStatus: "Inactive",
            },
          ],
        },
      ],
    },
  } as unknown as BorrowerBundle;
  const data = { meta: { generatedAt: AS_OF } } as unknown as C360Data;
  return relContextFor({ data, bundle, accountId: ACCOUNT, accountName: "Hartwell Precision Manufacturing LLC", catalog: CATALOG });
}

describe("the collateral intake's first step: new asset, or one the book already holds", () => {
  it("is skipped where the account holds no unpledged asset (ctxFor's own facility is actively pledged)", () => {
    const ctx = ctxFor();
    const step = nextStep("intake", ctx, { intakeKind: "collateral" })!;
    expect(step.key).toBe("colType.0");
  });

  it("lists the unpledged asset by its short title, plus 'a new asset', before the type question", () => {
    const ctx = ctxWithUnpledged();
    const step = nextStep("intake", ctx, { intakeKind: "collateral" })!;
    expect(step.key).toBe("colExisting.0");
    expect(step.ask).toBe("File a new asset, or is this one the book already holds?");
    const labels = step.options?.map((o) => o.label) ?? [];
    expect(labels).toContain("A new asset");
    const existing = labels.find((l) => l !== "A new asset")!;
    expect(existing).toContain("UCC-Accounts");
    // THE SHORT TITLE, never the full legal description.
    expect(existing).not.toContain("Excludes invoices over 90 days past due");
    expect(existing.length).toBeLessThan(70);
  });

  it("picking the existing asset hands off without filing anything", () => {
    const ctx = ctxWithUnpledged();
    const a: Answers = { intakeKind: "collateral" };
    answer(a, "colExisting.0", "existing:a342");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("colExistingHandoff");
    expect(step.ask).toContain("already on the book");
    expect(step.ask).toContain("Facility Actions");
    // NOTHING IS FILED. The type question never ran, so the draft never
    // resolved a `collateralType` and the payload has nothing to send.
    expect(collateralDrafts(ctx, a)).toHaveLength(0);
    const payload = buildIntakePayload(ctx, a, "idem-1");
    expect(payload.ok).toBe(false);
  });

  it("picking 'a new asset' continues into the ordinary type question unchanged", () => {
    const ctx = ctxWithUnpledged();
    const a: Answers = { intakeKind: "collateral" };
    answer(a, "colExisting.0", "new");
    const step = nextStep("intake", ctx, a)!;
    expect(step.key).toBe("colType.0");
    expect(step.ask).toContain(NO_PLEDGE_NO_LIEN);
  });
});

/* ------------------------------------------------------------- the payload */

describe("the wire carries the frozen contract's keys and no others", () => {
  it("composes the covenant half as a JSON array on covenantsJson", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "add a relationship covenant: minimum tangible net worth of 12M tested annually",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "from the amended and restated agreement",
      "covMore.0": "done",
    });
    const built = buildIntakePayload(ctx, answers, "idem-cov");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const payload = built.payload as StagePayloads["relationship-intake"];
    expect(Object.keys(payload).sort()).toEqual(["accountId", "covenantsJson", "idempotencyKey", "rationale"]);
    expect(payload.accountId).toBe(ACCOUNT);
    expect(JSON.parse(payload.covenantsJson as string)).toEqual([
      {
        covenantTypeName: "Minimum Tangible Net Worth",
        operator: ">=",
        threshold: 12_000_000,
        frequency: "Annually",
        effectiveDate: "2026-09-01",
        notes: "from the amended and restated agreement",
      },
    ]);
    // The banker's own line is the audit rationale, not a composed label.
    expect(payload.rationale).toContain("minimum tangible net worth");
  });

  it("composes the collateral half as a JSON array on collateralJson", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "collateral",
      "colType.0": "Equipment",
      "colDescription.0": "Two Haas VF-4SS machining centres",
      "colValue.0": 850_000,
      "colBasis.0": "Net Orderly Liquidation Value",
      "colSource.0": "Appraisal",
      "colValuationDate.0": "2026-08-31",
      "colAddress.0": "1400 Industrial Parkway, Fort Wayne, IN 46802",
      "colOwner.0": ACCOUNT,
      "colMore.0": "done",
    });
    const built = buildIntakePayload(ctx, answers, "idem-col");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const payload = built.payload as StagePayloads["relationship-intake"];
    expect(Object.keys(payload).sort()).toEqual(["accountId", "collateralJson", "idempotencyKey", "rationale"]);
    expect(JSON.parse(payload.collateralJson as string)).toEqual([
      {
        collateralType: "Equipment",
        description: "Two Haas VF-4SS machining centres",
        value: 850_000,
        valuationBasis: "Net Orderly Liquidation Value",
        valuationSource: "Appraisal",
        valuationDate: "2026-08-31",
        ownerAccountId: ACCOUNT,
        address: { street: "1400 Industrial Parkway", city: "Fort Wayne", state: "IN", zip: "46802" },
      },
    ]);
  });

  /* NO PACKAGE ANCHOR ON THIS WIRE, and that is the difference the route exists
     for: a relationship-level covenant belongs to the borrower rather than to a
     package version. */
  it("carries no productPackageId, no facility and no pledge key", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "collateral",
      "colType.0": "Equipment",
      "colDescription.0": "A forklift fleet",
      "colValue.0": 250_000,
      "colBasis.0": "__skipped__",
      "colSource.0": "__skipped__",
      "colValuationDate.0": "__skipped__",
      "colAddress.0": "__skipped__",
      "colOwner.0": ACCOUNT,
      "colMore.0": "done",
    });
    const built = buildIntakePayload(ctx, answers, "idem-3");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const json = JSON.stringify(built.payload);
    for (const key of ["productPackageId", "loanId", "facilityIds", "pledge", "lienPosition", "advanceRate"]) {
      expect(json).not.toContain(key);
    }
  });

  it("stages nothing where nothing is complete", () => {
    const ctx = ctxFor();
    const built = buildIntakePayload(ctx, { intakeKind: "covenant" }, "idem-4");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.blocked).toContain("not staged under a default");
  });
});

/* ---------------------------------------------------------- the seed figure */

describe("a figure inside a model number is not the asset's value", () => {
  it("takes a seed figure only where the line states one as a figure", () => {
    // THE DRIVE CAUGHT THIS. "two Haas VF-4SS machining centres" carries a 4
    // inside a model number, and reading it as the value files a machining
    // centre worth four dollars.
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "add collateral: two Haas VF-4SS machining centres" };
    answer(a, "colType.0", "Equipment");
    const [draft] = collateralDrafts(ctx, a);
    expect(draft.description).toBe("two Haas VF-4SS machining centres");
    expect(draft.value).toBeNull();
  });

  it("still takes one the line states plainly", () => {
    const ctx = ctxFor();
    for (const line of [
      "add collateral: a forklift fleet, valued at 250000",
      "add collateral: a forklift fleet worth $250,000",
      "add collateral: a forklift fleet, 250K",
    ]) {
      const a: Answers = { intakeKind: line };
      answer(a, "colType.0", "Equipment");
      expect(collateralDrafts(ctx, a)[0].value, line).toBe(250_000);
    }
  });

  it("keeps reading a bare figure inside an ANSWER, where the question asked for one", () => {
    const ctx = ctxFor();
    const a: Answers = { intakeKind: "collateral" };
    answer(a, "colType.0", "Equipment");
    answer(a, "colDescription.0", "A forklift fleet");
    answer(a, "colValue.0", 4);
    expect(collateralDrafts(ctx, a)[0].value).toBe(4);
  });
});

/* ------------------------------------------------------------ the read-back */

describe("the room says what it files and what it does not", () => {
  it("names the junction the covenant carries and the one it does not", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Minimum Liquidity",
      "covTerms.0": ">= 5,000,000",
      "covFrequency.0": "Quarterly",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "done",
    });
    const said = intakeConfirmSentence(ctx, answers);
    expect(said).toContain("no loan junction");
    expect(said).toContain("No compliance row is minted");
    expect(relReadyLine("intake", ctx, answers)).toContain(said);
  });

  it("says the asset secures nothing, every time", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "collateral",
      "colType.0": "Equipment",
      "colDescription.0": "A forklift fleet",
      "colValue.0": 250_000,
      "colBasis.0": "__skipped__",
      "colSource.0": "__skipped__",
      "colValuationDate.0": "__skipped__",
      "colAddress.0": "__skipped__",
      "colOwner.0": ACCOUNT,
      "colMore.0": "done",
    });
    expect(intakeConfirmSentence(ctx, answers)).toContain(NO_PLEDGE_NO_LIEN);
  });

  it("names each record with the org's own name and the org's own id", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Minimum Liquidity",
      "covTerms.0": ">= 5,000,000",
      "covFrequency.0": "Quarterly",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "done",
    });
    expect(intakeDossierRows(ctx, answers, [{ recordName: "COV-000990", recordId: "a2Xbb0000COV0AAK" }])[0].value).toBe(
      "COV-000990 · a2Xbb0000COV0AAK",
    );
    // A read-back that failed says so rather than hiding behind a label.
    expect(intakeDossierRows(ctx, answers, [{ recordName: null }])[0].value).toBe("filed, unverified");
  });

  it("reads a covenant row back as the covenant it is", () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, {
      intakeKind: "covenant",
      "covTest.0": "Minimum Liquidity",
      "covTerms.0": ">= 5,000,000",
      "covFrequency.0": "Quarterly",
      "covEffective.0": "2026-09-01",
      "covNotes.0": "__skipped__",
      "covMore.0": "done",
    });
    expect(intakeRows(ctx, answers)[0]).toMatchObject({
      icon: "covenant",
      label: "Minimum Liquidity",
      value: ">= $5M, quarterly, from 2026-09-01",
    });
  });
});

/* ------------------------------------------------------- the empty catalog */

/* CHANGED 2026-09-12 (audit finding 6). Reading the type names off the live org
   ONLY left an empty catalog refusing every name the banker typed, with an empty
   chip set under the refusal and no way past it. The fallback is the SHELL'S OWN
   MIRROR, which `elicit.ts` has resolved a typed name against since the facility
   room shipped (`assetTypeUniverse`, `covenantTypeChips`), so it is the same
   list the rest of this client already stands on rather than a list made up
   here. A name neither the org nor the mirror carries is still refused. */
describe("with no catalog the room stands on the shell's own mirror", () => {
  it("offers the mirror's names rather than an empty chip set", () => {
    const ctx = ctxFor({ catalog: null });
    const step = nextStep("intake", ctx, { intakeKind: "covenant" })!;
    expect(step.options?.map((o) => o.value)).toContain("Minimum Liquidity");
    expect(step.placeholder).toContain("Pick one");
  });

  it("resolves a name the mirror carries, and refuses one it does not", () => {
    const ctx = ctxFor({ catalog: null });
    const a: Answers = { intakeKind: "covenant" };
    answer(a, "covTest.0", "Minimum Liquidity");
    expect(covenantDrafts(ctx, a)[0].typeName).toBe("Minimum Liquidity");

    const b: Answers = { intakeKind: "covenant" };
    answer(b, "covTest.0", "Interest Coverage");
    expect(covenantDrafts(ctx, b)[0].typeName).toBeNull();
    expect(nextStep("intake", ctx, b)!.key).toBe("covPick.0");
  });
});

/* ------------------------------------------------------------- the grammar */

describe("the copy is the room's own register", () => {
  it("carries no em dash and no exclamation point anywhere", () => {
    const ctx = ctxFor();
    const a: Answers = {};
    const said = [
      NO_PLEDGE_NO_LIEN,
      EFFECTIVE_DATE_IS_FINAL,
      INTAKE_CAP_REFUSAL,
      VALUE_MUST_BE_POSITIVE,
      nextStep("intake", ctx, a)!.ask,
      nextStep("intake", ctx, { intakeKind: "collateral" })!.ask,
      nextStep("intake", ctx, { intakeKind: "covenant" })!.ask,
    ].join(" ");
    expect(said).not.toMatch(/[—!]/);
  });

  it("reads which flow the banker is in, out of a chip or out of a sentence", () => {
    expect(intakeKindOf({ intakeKind: "covenant" })).toBe("covenant");
    expect(intakeKindOf({ intakeKind: "add collateral: a forklift fleet" })).toBe("collateral");
    expect(intakeKindOf({ intakeKind: "put something on the book" })).toBeNull();
    // The disambiguation chip wins over an opening line it could not read.
    expect(intakeKindOf({ intakeKind: "put something on the book", intakeKindPick: "collateral" })).toBe("collateral");
  });

  it("asks which of the two when the opening line named neither", () => {
    const ctx = ctxFor();
    const step = nextStep("intake", ctx, { intakeKind: "put something on the book" })!;
    expect(step.key).toBe("intakeKindPick");
    expect(step.kind).toBe("chips");
  });
});

/* ---------------------------------------------------------------- the fence */

/*  THE CLIENT FENCE, ARMED. The Apex guard refuses an intake write to the loan
    junction or the pledge by name; this is the mirror of that refusal, and it
    fires at the confirm gate before a banker is ever offered a token. It is a
    per-TOOL fence rather than a per-object one because both junctions are
    legitimate creates for the modification arm, so the object table alone would
    let an intake plan reach a facility and never say a word. */

const INTAKE_SCRIPT: Record<string, unknown> = {
  intakeKind: "add a relationship covenant: minimum tangible net worth of 12M tested annually",
  "covEffective.0": "2026-09-01",
  "covNotes.0": "from the amended and restated agreement",
  "covMore.0": "done",
};

function stagedPlanOf(steps: StagedOutput["steps"]): StagedOutput {
  return {
    stagingId: "a8a000",
    planHash: "hash-abcd",
    decisionToken: "6b3490fc91cf",
    summary: "Files the intake.",
    steps,
    warnings: [],
    suggestions: [],
  };
}

function depsReturning(plan: StagedOutput): RelFlowDeps {
  return {
    available: () => true,
    newKey: () => "idem-fence",
    stage: async () => ({ ok: true, result: plan }) as ToolOutcome<StagedOutput>,
    execute: async () =>
      ({
        ok: true,
        result: { stagingId: "a8a000", terminalState: "success", outcome: "Filed.", steps: [] },
      }) as ToolOutcome<ExecuteResult>,
  };
}

describe("the intake route arms the per-tool fence", () => {
  it("declares the tool key on the intake route and on no other", () => {
    expect(REL_FLOWS.intake.toolId).toBe("relationship-intake");
    for (const route of ["annual", "covenant", "valuation", "rating", "service"] as const) {
      expect(REL_FLOWS[route].toolId, route).toBeUndefined();
    }
  });

  it("refuses an intake plan that would pledge the asset to a facility", async () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, INTAKE_SCRIPT);
    const deps = depsReturning(
      stagedPlanOf([
        { id: "collateral_create_0", type: "write", label: "File the asset", objectName: "LLC_BI__Collateral__c" },
        { id: "pledge_0", type: "write", label: "Pledge it", objectName: "LLC_BI__Loan_Collateral2__c" },
      ]),
    );
    await expect(stageRelPlan("intake", ctx, answers, "idem-fence", deps)).rejects.toThrow(
      /relationship-intake may not write/,
    );
  });

  it("refuses an intake plan that would attach the covenant to a loan", async () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, INTAKE_SCRIPT);
    const deps = depsReturning(
      stagedPlanOf([
        { id: "covenant_create_0", type: "write", label: "File the covenant", objectName: "LLC_BI__Covenant2__c" },
        { id: "attach_0", type: "write", label: "Attach it", objectName: "LLC_BI__Loan_Covenant__c" },
      ]),
    );
    await expect(stageRelPlan("intake", ctx, answers, "idem-fence", deps)).rejects.toThrow(
      /relationship-intake may not write/,
    );
  });

  it("passes the five relationship objects the intake actually writes", async () => {
    const ctx = ctxFor();
    const { answers } = drive(ctx, INTAKE_SCRIPT);
    const deps = depsReturning(
      stagedPlanOf([
        { id: "covenant_create_0", type: "write", label: "File the covenant", objectName: "LLC_BI__Covenant2__c" },
        { id: "covenant_anchor_0", type: "write", label: "Anchor it", objectName: "LLC_BI__Account_Covenant__c" },
        { id: "collateral_create_0", type: "write", label: "File the asset", objectName: "LLC_BI__Collateral__c" },
        { id: "collateral_own_0", type: "write", label: "Own it", objectName: "LLC_BI__Account_Collateral__c" },
        { id: "collateral_value_0", type: "write", label: "Value it", objectName: "LLC_BI__Collateral_Valuation__c" },
      ]),
    );
    const staged = await stageRelPlan("intake", ctx, answers, "idem-fence", deps);
    expect(staged.decisionToken).toBe("6b3490fc91cf");
  });
});
