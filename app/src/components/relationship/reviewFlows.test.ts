import { describe, expect, it, vi } from "vitest";
import type { BorrowerBundle, C360Data } from "../../data/contract";
import type { StagedOutput } from "../../actions/stagedPlan";
import type { ExecuteResult, StagePayloads, ToolOutcome } from "../../channel/writeTools";
import {
  CREATE_GAPS,
  NOT_A_CLASSIFICATION,
  NO_CONNECTOR,
  OVERRIDE_NEEDS_A_REASON,
  REL_FLOWS,
  RelFlowError,
  SCORED_VS_STORED,
  SKIPPED,
  VALUATION_BATCH_CAP,
  asksForClassification,
  asksForOverride,
  buildStagePayload,
  GRADE_OFF_THE_SCALE,
  onScale,
  RISK_GRADE_SCALE,
  dossierRowsFor,
  executeRelPlan,
  nextStep,
  readCreateAsk,
  relContextFor,
  relRouteBlock,
  routeAvailability,
  stageRelPlan,
  type Answers,
  type RelContext,
  type RelFlowDeps,
} from "./reviewFlows";
import type { RelRoute } from "./relRoute";

/* =============================================================================
   THE FIVE FLOWS.

   The room re-clothes flows that already exist, so these prove the two things
   that would break if it drifted: the STEP MACHINE asks exactly what each tool
   demands, and the PAYLOAD it composes carries only wire keys the org has
   already accepted. Plus the two creates the room cannot file, which are
   asserted as proposal-only by name.
   ============================================================================= */

const PACKAGE = "a5Fbb000000IHFJEA4";

function ctxFor(overrides: Partial<BorrowerBundle> = {}): RelContext {
  const bundle = {
    snapshot: {
      accountId: "001X",
      name: "Testco",
      productPackageId: PACKAGE,
      primaryRiskRating: "4",
      computedRiskRating: "5",
    },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: PACKAGE,
          committed: 10_000_000,
          collateral: [
            { collateralId: "a35A", collateralName: "COL-000762", collateralType: "Equipment", collateralValue: 4_000_000 },
            { collateralId: "a35B", collateralDescription: "Receivables", collateralType: "Accounts Receivable" },
          ],
        },
        // The SAME collateral pledged to a second facility. It is one asset and
        // must be offered once: a duplicate id inside a batch is refused.
        {
          loanId: "0Cb2",
          status: "Active",
          productPackageId: PACKAGE,
          collateral: [{ collateralId: "a35A", collateralName: "COL-000762" }],
        },
      ],
    },
    covenants: {
      covenants: [
        { covenantId: "cov1", covenantType: "Debt Service Coverage", latestComplianceStatus: "Pending" },
        { covenantId: "cov2", covenantType: "Leverage", latestComplianceStatus: "Pending" },
        // No id: the bulk tool is anchored on covenantId, so this one cannot be
        // assessed and must never be offered.
        { covenantType: "Fixed Charge Coverage" },
      ],
    },
    ...overrides,
  } as unknown as BorrowerBundle;
  const data = {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({ data, bundle, accountId: "001X", accountName: "Testco" });
}

/** Drive the machine to the end, answering each step with the value the test
 *  names for it. Returns everything collected, in order. */
function driveTo(route: RelRoute, ctx: RelContext, answersFor: Record<string, unknown>): Answers {
  const a: Answers = {};
  for (let guard = 0; guard < 64; guard++) {
    const step = nextStep(route, ctx, a);
    if (!step) return a;
    const value = Object.prototype.hasOwnProperty.call(answersFor, step.key)
      ? answersFor[step.key]
      : step.optional
        ? SKIPPED
        : undefined;
    if (value === undefined) throw new Error(`no answer supplied for required step ${step.key}`);
    const dot = step.key.indexOf(".");
    if (dot === -1) a[step.key] = value;
    else {
      const group = step.key.slice(0, dot);
      const held = (a[group] as Record<string, unknown>) ?? {};
      a[group] = { ...held, [step.key.slice(dot + 1)]: value };
    }
  }
  throw new Error("the step machine did not settle");
}

const PLAN: StagedOutput = {
  stagingId: "a8a000",
  planHash: "hash-abcd",
  decisionToken: "6b3490fc91cf",
  summary: "Files the review.",
  steps: [],
  warnings: [],
  suggestions: [],
};

function depsFor(over: Partial<RelFlowDeps> = {}): RelFlowDeps & {
  staged: Array<{ actionId: string; payload: Record<string, unknown> }>;
} {
  const staged: Array<{ actionId: string; payload: Record<string, unknown> }> = [];
  return {
    staged,
    available: () => true,
    newKey: () => "key-1",
    stage: async (actionId, payload) => {
      staged.push({ actionId, payload: payload as Record<string, unknown> });
      return { ok: true, result: PLAN } as ToolOutcome<StagedOutput>;
    },
    execute: async () =>
      ({
        ok: true,
        result: { stagingId: "a8a000", terminalState: "success", outcome: "Filed and verified.", steps: [] },
      }) as ToolOutcome<ExecuteResult>,
    ...over,
  };
}

/* ------------------------------------------------------------- the wiring */

describe("the five routes drive the flows that already exist", () => {
  it("maps each route onto the deployed action id, and invents none", () => {
    expect(REL_FLOWS.annual.actionId).toBe("annual-review");
    expect(REL_FLOWS.covenant.actionId).toBe("covenant-review");
    expect(REL_FLOWS.valuation.actionId).toBe("collateral-valuation");
    expect(REL_FLOWS.rating.actionId).toBe("risk-rating-review");
    expect(REL_FLOWS.service.actionId).toBe("create-service-request");
  });

  it("states what each review covers AND what it produces, before it asks anything", () => {
    for (const spec of Object.values(REL_FLOWS)) {
      expect(spec.covers.length).toBeGreaterThan(40);
      expect(spec.produces.length).toBeGreaterThan(40);
      // Banker-formal: no em dashes, no exclamation points.
      expect(`${spec.covers} ${spec.produces} ${spec.approveLabel}`).not.toMatch(/[—!]/);
    }
  });

  it("reads availability off the registry rather than a second table", () => {
    const ctx = ctxFor();
    const data = { borrowers: { "001X": {} }, borrower: {}, portfolio: { accounts: [] }, meta: {} } as unknown as C360Data;
    // A relationship with no covenants cannot support the covenant review, and
    // the registry's own sentence is what the room says.
    expect(routeAvailability("covenant", data, "001X").available).toBe(false);
    expect(routeAvailability("covenant", data, "001X").reason).toBe("No covenants recorded for this relationship");
    expect(ctx.productPackageId).toBe(PACKAGE);
  });
});

/* --------------------------------------------------------- the step machine */

describe("the annual review collects what stage_annual_review takes", () => {
  it("asks the review type first, with the org's own three values", () => {
    const step = nextStep("annual", ctxFor(), {})!;
    expect(step.key).toBe("reviewType");
    expect(step.options?.map((o) => o.value)).toEqual(["Annual", "AdHoc", "Problem Loan"]);
    expect(step.optional).toBeFalsy();
  });

  it("settles after the type, two optional narratives and the sections chip", () => {
    // THREE QUESTIONS PLUS ONE CHIP SET, never eight sequential narratives.
    // Skipping the sections leaves the route exactly as long as it always was.
    const answers = driveTo("annual", ctxFor(), { reviewType: "Annual" });
    expect(Object.keys(answers)).toEqual(["reviewType", "relationshipSummary", "recommendation", "sections"]);
  });

  it("composes the account-anchored payload the tool accepts", () => {
    const ctx = ctxFor();
    const answers = driveTo("annual", ctx, { reviewType: "Annual", recommendation: "Renew at current terms." });
    const built = buildStagePayload("annual", ctx, answers, "key-1");
    expect(built.ok).toBe(true);
    const p = (built as { payload: StagePayloads["annual-review"] }).payload;
    expect(p.accountId).toBe("001X");
    expect(p.reviewType).toBe("Annual");
    expect(p.productPackageId).toBe(PACKAGE);
    expect(p.recommendationNarrative).toBe("Renew at current terms.");
    // A SKIPPED optional is an ABSENT value on the wire, never the sentinel.
    expect(p.relationshipSummary).toBeNull();
    expect(JSON.stringify(p)).not.toContain(SKIPPED);
  });
});

describe("the covenant review is package-anchored bulk", () => {
  const ctx = ctxFor();

  it("offers only covenants the org gave an id", () => {
    const step = nextStep("covenant", ctx, {})!;
    expect(step.key).toBe("covenants");
    expect(step.kind).toBe("multi");
    expect(step.options?.map((o) => o.value)).toEqual(["cov1", "cov2"]);
  });

  it("asks a verdict for every covenant chosen, one at a time", () => {
    const a: Answers = { covenants: ["cov1", "cov2"] };
    expect(nextStep("covenant", ctx, a)!.key).toBe("covenantStatuses.cov1");
    a.covenantStatuses = { cov1: "Compliant" };
    expect(nextStep("covenant", ctx, a)!.key).toBe("covenantStatuses.cov2");
  });

  it("offers only the three statuses the tool will write", () => {
    const step = nextStep("covenant", ctx, { covenants: ["cov1"] })!;
    expect(step.options?.map((o) => o.value)).toEqual(["Compliant", "Waived", "Exception"]);
  });

  it("asks the exception reason ONLY where the verdict was Exception", () => {
    const a: Answers = {
      covenants: ["cov1", "cov2"],
      covenantStatuses: { cov1: "Compliant", cov2: "Exception" },
      covenantObservedValues: { cov1: SKIPPED, cov2: SKIPPED },
    };
    const step = nextStep("covenant", ctx, a)!;
    expect(step.key).toBe("covenantReasons.cov2");
    expect(step.options?.map((o) => o.value)).toEqual(["Breached", "Overdue"]);
  });

  it("composes assessments with the org's own keys, and the member selection stated", () => {
    const answers = driveTo("covenant", ctx, {
      covenants: ["cov1", "cov2"],
      "covenantStatuses.cov1": "Compliant",
      "covenantStatuses.cov2": "Exception",
      "covenantObservedValues.cov1": 1.42,
      "covenantReasons.cov2": "Breached",
      assessmentNarrative: "Q2 statements tested.",
    });
    const built = buildStagePayload("covenant", ctx, answers, "key-1");
    const p = (built as { payload: StagePayloads["covenant-review"] }).payload;
    /* THE ACCOUNT IS THE ANCHOR (0.9.24, backlog row 49). Restated, not
       weakened: this line read `productPackageId` until the founder moved the
       contract on 2026-09-13. The room never asks which package, so it never
       sends one, and the tool anchors on the relationship. */
    expect(p.accountId).toBe("001X");
    expect(p).not.toHaveProperty("productPackageId");
    expect(p.covenantIds).toEqual(["cov1", "cov2"]);
    expect(p.assessments).toEqual([
      { covenantId: "cov1", status: "Compliant", observedValue: 1.42, reasonForException: null, narrative: "Q2 statements tested.", comments: null },
      { covenantId: "cov2", status: "Exception", observedValue: null, reasonForException: "Breached", narrative: "Q2 statements tested.", comments: null },
    ]);
    // The superseded single shape is GONE from the org. `covenantComplianceId`
    // anchored on a compliance ROW and named no covenant; sending it makes the
    // new shape unreachable on the wire.
    expect(p).not.toHaveProperty("covenantComplianceId");
    // allowNonPending is sent only when the banker turns it on; a false would
    // claim a decision nobody made.
    expect(p).not.toHaveProperty("allowNonPending");
  });

  it("refuses to compose when a chosen covenant carries no verdict", () => {
    const built = buildStagePayload("covenant", ctx, { covenants: ["cov1", "cov2"], covenantStatuses: { cov1: "Compliant" } }, "k");
    expect(built.ok).toBe(false);
    expect((built as { blocked: string }).blocked).toContain("needs a verdict");
  });

  /* RESTATED 0.9.24 (backlog row 49). This case used to assert the refusal
     NO_PACKAGE_ANCHOR on a relationship whose snapshot named no package. The
     account is the anchor now, so there is nothing to refuse: the same context
     composes, and the wire carries the relationship. */
  it("composes on a relationship whose snapshot names no package at all", () => {
    const noPackage = ctxFor({ snapshot: { accountId: "001X", name: "Testco" } as never });
    const answers = driveTo("covenant", noPackage, {
      covenants: ["cov1"],
      "covenantStatuses.cov1": "Compliant",
      "covenantObservedValues.cov1": 1.42,
      assessmentNarrative: "Q2 statements tested.",
    });
    const built = buildStagePayload("covenant", noPackage, answers, "k");
    expect(built.ok).toBe(true);
    const p = (built as { payload: StagePayloads["covenant-review"] }).payload;
    expect(p.accountId).toBe("001X");
    expect(p).not.toHaveProperty("productPackageId");
  });
});

describe("the collateral valuation is package-anchored bulk too", () => {
  const ctx = ctxFor();

  it("offers each asset ONCE, even cross-pledged, and only with a collateral id", () => {
    const step = nextStep("valuation", ctx, {})!;
    expect(step.key).toBe("records");
    expect(step.options?.map((o) => o.value)).toEqual(["a35A", "a35B"]);
  });

  it("asks a figure per asset, then the exercise's own four facts", () => {
    const a: Answers = { records: ["a35A"] };
    expect(nextStep("valuation", ctx, a)!.key).toBe("recordValues.a35A");
    a.recordValues = { a35A: 4_200_000 };
    expect(nextStep("valuation", ctx, a)!.key).toBe("valuationDate");
    a.valuationDate = "2026-08-31";
    expect(nextStep("valuation", ctx, a)!.key).toBe("type");
    a.type = "Net Orderly Liquidation Value";
    expect(nextStep("valuation", ctx, a)!.key).toBe("source");
  });

  it("offers the org's complete 16 bases and 14 sources, never an invented set", () => {
    const basis = nextStep("valuation", ctx, { records: ["a35A"], recordValues: { a35A: 1 }, valuationDate: "2026-08-31" })!;
    expect(basis.options).toHaveLength(16);
    expect(basis.options?.map((o) => o.value)).toContain("Net Orderly Liquidation Value");
  });

  it("composes items[] only, with the date and basis shared and the figure per record", () => {
    const answers = driveTo("valuation", ctx, {
      records: ["a35A", "a35B"],
      "recordValues.a35A": 4_200_000,
      "recordValues.a35B": 900_000,
      valuationDate: "2026-08-31",
      type: "Net Orderly Liquidation Value",
      source: "Appraisal",
      primary: "no",
    });
    const built = buildStagePayload("valuation", ctx, answers, "key-1");
    const p = (built as { payload: StagePayloads["collateral-valuation"] }).payload;
    // THE ACCOUNT IS THE ANCHOR HERE TOO (0.9.24). Restated from
    // `productPackageId`: an asset is owned by the borrower and pledged across
    // packages, so a valuation is relationship work.
    expect(p.accountId).toBe("001X");
    expect(p).not.toHaveProperty("productPackageId");
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toEqual({
      collateralId: "a35A",
      value: 4_200_000,
      valuationDate: "2026-08-31",
      type: "Net Orderly Liquidation Value",
      source: "Appraisal",
      description: null,
      primary: false,
    });
    // Mixing flat fields with items[] is REFUSED by the tool.
    expect(p).not.toHaveProperty("collateralId");
    expect(p).not.toHaveProperty("value");
  });

  it("refuses a batch past the tool's cap rather than letting the org refuse it", () => {
    const many = Array.from({ length: VALUATION_BATCH_CAP + 1 }, (_, i) => `a35${i}`);
    const built = buildStagePayload("valuation", ctx, { records: many, valuationDate: "2026-08-31" }, "k");
    expect(built.ok).toBe(false);
    expect((built as { blocked: string }).blocked).toContain(String(VALUATION_BATCH_CAP));
  });

  it("refuses without the valuation date, which the tool never defaults", () => {
    const built = buildStagePayload("valuation", ctx, { records: ["a35A"] }, "k");
    expect(built.ok).toBe(false);
  });
});

describe("the risk-rating review is account-level and carries no facility scope", () => {
  const ctx = ctxFor();

  it("asks the four named factors, then the grade and the override, every one skippable", () => {
    const answers = driveTo("rating", ctx, {});
    expect(Object.keys(answers)).toEqual([
      "cashFlowCoverage",
      "revenueGrowth",
      "managementExperience",
      "creditScore",
      "computedRiskGradeValue",
      "overriddenRiskGradeValue",
      "overrideComment",
    ]);
  });

  /* PERMANENT COVER for the relationship fixer's item 8 (backlog item 13). The
     four factors were four blank numeric boxes in a row, and the one the org's
     template actually scores was indistinguishable from the three it stores and
     never weighs. It was verified with a harness that was then deleted; this is
     the standing test. */
  it("leads the scored factor with the closest figure the read carries, named as the covenant's", () => {
    const measured = ctxFor({
      covenants: {
        covenants: [
          { covenantId: "cov1", covenantType: "Debt Service Coverage", latestComplianceStatus: "Pending", actualValue: 1.08 },
        ],
      },
    } as never);
    const first = nextStep("rating", measured, {})!;
    expect(first.key).toBe("cashFlowCoverage");
    expect(first.ask).toBe(
      "What is cash-flow coverage on this borrower? The closest figure the read carries is the Debt Service Coverage test at 1.08.",
    );
    // OFFERED, NEVER WRITTEN. The chip carries the covenant's own figure and
    // says whose figure it is, so nobody reads it as a rating input on file.
    expect(first.options).toEqual([
      { label: "1.08", value: "1.08", detail: "the Debt Service Coverage test's own figure" },
    ]);
    expect(first.optional).toBe(true);
    expect(first.target).toEqual({ object: "LLC_BI__Annual_Review__c", field: "cashFlowCoverageActual" });
  });

  it("says so plainly where the read carries nothing, and invents no figure", () => {
    // The baked fixture's covenant carries no `actualValue` at all.
    const blind = nextStep("rating", ctx, {})!;
    expect(blind.key).toBe("cashFlowCoverage");
    expect(blind.ask).toContain("No read on this cockpit carries it, so the figure is yours or the question is skipped.");
    expect(blind.options).toBeUndefined();
  });

  it("lands SCORED_VS_STORED on the FIRST unscored factor, and on no other", () => {
    /* Said over the scored factor it would tell the banker nothing about the
       three still coming; said on every one of them it is a lecture. */
    const a: Answers = {};
    const carrying: string[] = [];
    for (const _ of [0, 1, 2, 3]) {
      const step = nextStep("rating", ctx, a)!;
      if (step.ask.includes(SCORED_VS_STORED)) carrying.push(step.key);
      a[step.key] = SKIPPED;
    }
    expect(carrying).toEqual(["revenueGrowth"]);
    expect(SCORED_VS_STORED).toContain("scores cash-flow coverage and nothing else");
    expect(SCORED_VS_STORED).toContain("the tool cannot choose the template");
  });

  it("composes four NAMED scalars, never a factor map, and no override key", () => {
    const answers = driveTo("rating", ctx, { cashFlowCoverage: 1.35, creditScore: 680, overrideComment: "Held at 5." });
    const built = buildStagePayload("rating", ctx, answers, "key-1");
    const p = (built as { payload: StagePayloads["risk-rating-review"] }).payload;
    expect(p.accountId).toBe("001X");
    expect(p.cashFlowCoverageActual).toBe(1.35);
    expect(p.creditScoreActual).toBe(680);
    expect(p.revenueGrowthActual).toBeNull();
    expect(p.computedRiskGradeValue).toBe(5);
    expect(p.comments).toBe("Held at 5.");
    expect(p).not.toHaveProperty("factorScores");
    expect(Object.keys(p).some((k) => /override/i.test(k))).toBe(false);
  });

  it("reads an override ask, and refuses only the one thing the org refuses", () => {
    expect(asksForOverride("override the grade to 6", "rating")).toBe(true);
    expect(asksForOverride("override the grade to 6", "covenant")).toBe(false);
    // The old sentence told the banker the override could not be filed because
    // its wire name had never been observed. It is deployed and tested.
    expect(OVERRIDE_NEEDS_A_REASON).toContain("needs a written reason");
    expect(OVERRIDE_NEEDS_A_REASON).not.toContain("never been observed");
  });

  /* =========================================================== THE SCALE

     `StageRiskRatingReview.cls` states the review scale twice, in its header
     and on `computedRiskGradeValue`'s describe, and enforces it NOWHERE: the
     class validates `accountId`, `rationale` and Mandatory_comment and stops.
     So before this, 47, 99 and 0 were all accepted by the room and all filed.
     A grade is the whole point of the route, and one off the scale is a
     governance record nobody can read.                                       */

  it("declares the scale on both grade steps, and only on those", () => {
    const bounded: string[] = [];
    const a: Answers = {};
    for (let guard = 0; guard < 32; guard++) {
      const step = nextStep("rating", ctx, a);
      if (!step) break;
      if (step.bounds) bounded.push(step.key);
      a[step.key] = step.key === "overrideComment" ? "Held." : 1;
    }
    expect(bounded).toEqual(["computedRiskGradeValue", "overriddenRiskGradeValue"]);
  });

  it("refuses a grade off the scale by name, with the scale stated", () => {
    expect(GRADE_OFF_THE_SCALE).toContain(`${RISK_GRADE_SCALE.min} to ${RISK_GRADE_SCALE.max}`);
    const bounds = { min: RISK_GRADE_SCALE.min, max: RISK_GRADE_SCALE.max, whole: true, refusal: GRADE_OFF_THE_SCALE };
    for (const off of [47, 99, 0, -3, 13, 6.5]) expect(onScale(off, bounds)).toBe(false);
    for (const on of [1, 5, 12]) expect(onScale(on, bounds)).toBe(true);
  });

  it("refuses to compose a payload carrying a grade off the scale", () => {
    for (const bad of [47, 99, 0]) {
      const proposed = driveTo("rating", ctx, { computedRiskGradeValue: bad });
      expect(buildStagePayload("rating", ctx, proposed, "key-1")).toEqual({ ok: false, blocked: GRADE_OFF_THE_SCALE });
      const override = driveTo("rating", ctx, { overriddenRiskGradeValue: bad, overrideComment: "Downgraded on coverage." });
      const built = buildStagePayload("rating", ctx, override, "key-1");
      // Zero is not an override at all by the org's rule, so it must be refused
      // as a GRADE, never accepted as a silent "no override".
      expect(built).toEqual({ ok: false, blocked: GRADE_OFF_THE_SCALE });
    }
  });

  it("files both grades where both are on the scale", () => {
    const answers = driveTo("rating", ctx, {
      computedRiskGradeValue: 4,
      overriddenRiskGradeValue: 6,
      overrideComment: "Downgraded on coverage.",
    });
    const p = (buildStagePayload("rating", ctx, answers, "key-1") as { payload: StagePayloads["risk-rating-review"] }).payload;
    expect(p.computedRiskGradeValue).toBe(4);
    expect(p.overriddenRiskGradeValue).toBe(6);
    expect(p.comments).toBe("Downgraded on coverage.");
  });
});

describe("the service request is purely account-level, with its subject and body the right way round", () => {
  const ctx = ctxFor();

  /* THREE DEFECTS LIVED ON FOUR LINES OF `serviceStep`, all of them against the
     deployed StageServiceRequest.cls sitting in this repo. This block is the
     three of them, pinned. */

  it("asks WHAT THE CLIENT ASKED FOR first, because that is what becomes the Subject", () => {
    // The Apex: requestType is "Banker-language description of what the client
    // asked for. Becomes the case subject", and it maps
    // 'Subject' => req.requestType. The room used to ask "What kind of request
    // is this?" here, so a CATEGORY landed on the subject line.
    const step = nextStep("service", ctx, {})!;
    expect(step.key).toBe("requestType");
    expect(step.kind).toBe("text");
    expect(step.target).toEqual({ object: "Case", field: "Subject" });
    expect(step.ask).toContain("What did the client ask for");
  });

  it("then asks for the request IN FULL, because that is what becomes the Description", () => {
    // summary is "The request in full, as the servicing team needs to read it"
    // and maps 'Description' => describeWithSource(req). The room used to ask
    // "State the subject" here, so THE SUBJECT LANDED IN THE BODY.
    const step = nextStep("service", ctx, { requestType: "Copy of the June covenant certificate" })!;
    expect(step.key).toBe("summary");
    expect(step.target).toEqual({ object: "Case", field: "Description" });
    expect(step.ask).toContain("in full");
  });

  it("asks TWO questions, not three: there is no origin step and no origin key", () => {
    // StageServiceRequest declares no `origin` invocable variable at all. It
    // reads Case.Type and Case.Origin off this org's own picklists through
    // C360Picklist.preferredOrFallback. The banker answered "How did it reach
    // us?" and the answer was dropped on the floor.
    const answers = driveTo("service", ctx, {
      requestType: "Copy of the June covenant certificate",
      summary: "James Hartwell asked on 28 Aug for the June certificate for his own file.",
      detail: "No credit action requested.",
    });
    expect(Object.keys(answers)).toEqual(["requestType", "summary", "detail"]);
    expect(Object.keys(answers)).not.toContain("origin");

    const built = buildStagePayload("service", ctx, answers, "key-1");
    const p = (built as { payload: StagePayloads["create-service-request"] }).payload;
    expect(p.accountId).toBe("001X");
    expect(p.requestType).toBe("Copy of the June covenant certificate");
    expect(p.summary).toContain("James Hartwell asked on 28 Aug");
    expect(p).not.toHaveProperty("origin");
    // The detail rides the AUDIT RATIONALE, which is on the wire. There is no
    // `description` key on this request class and the room does not invent one.
    expect(p).not.toHaveProperty("description");
    expect(p.rationale).toContain("No credit action requested.");
  });

  /* PERMANENT COVER for the relationship fixer's item 9 (backlog item 13). The
     `detail` step claimed `{Case, Description}` on its peek — the field
     `summary` already owns and actually writes — so the founder was reading a
     wrong field name on the glass. `a.detail` rides the plan's RATIONALE and
     reaches no Case field at all, and a step with no target claims nothing. */
  it("the detail step claims no field, because the answer reaches none", () => {
    const step = nextStep("service", ctx, { requestType: "Payoff quote", summary: "The full request." })!;
    expect(step.key).toBe("detail");
    expect(step.optional).toBe(true);
    expect(step.target).toBeUndefined();
    // The ask itself says where the words go, which is what the peek cannot.
    expect(step.ask).toBe("Anything further for the audit record? It rides the plan's rationale, not the case body.");
  });

  it("every peek on this route names a key the staged payload actually writes", () => {
    const answers = driveTo("service", ctx, {
      requestType: "Payoff quote",
      summary: "James Hartwell asked for a payoff quote.",
      detail: "No credit action requested.",
    });
    const built = buildStagePayload("service", ctx, answers, "key-1");
    const p = (built as { payload: Record<string, unknown> }).payload;
    /* THE PEEK IS A PROMISE. A step that names an object and a field is telling
       the banker where their answer lands, so the set of fields the route
       claims has to be a subset of what the wire carries: Subject from
       `requestType`, Description from `summary`, and nothing else claimed. */
    const claimed: Array<{ key: string; target?: { object: string; field: string } }> = [];
    const a: Answers = {};
    for (let guard = 0; guard < 8; guard++) {
      const step = nextStep("service", ctx, a);
      if (!step) break;
      claimed.push({ key: step.key, target: step.target });
      a[step.key] = "x";
    }
    expect(claimed.map((c) => `${c.key}:${c.target ? `${c.target.object}.${c.target.field}` : "nothing"}`)).toEqual([
      "requestType:Case.Subject",
      "summary:Case.Description",
      "detail:nothing",
    ]);
    // And the wire's own key set, so a claim and a write cannot drift apart.
    expect(Object.keys(p).sort()).toEqual([
      "accountId",
      "idempotencyKey",
      "rationale",
      "referenceId",
      "referenceKind",
      "referenceWebLink",
      "requestType",
      "summary",
    ]);
  });

  it("offers the client's own words as the SUBJECT chip, never written silently", () => {
    const withRequest = ctxFor({
      requests: [{ summary: "Please send a payoff quote", reference: { kind: "email", id: "AAM1" } }],
    } as never);
    const step = nextStep("service", withRequest, {})!;
    expect(step.key).toBe("requestType");
    expect(step.options?.[0].value).toBe("Please send a payoff quote");
    expect(step.options?.[0].detail).toBe("from the client's request");
  });

  it("offers NO Case.Type and NO Case.Origin chips, in either state", () => {
    /* The catalog carries both now, and the wire-arms follow-up says to pass
       them into this room. Doing so would repeat the origin defect exactly: a
       chip set from a field that is on no wire is a question that cannot be
       filed. They are named in `produces` as facts the ORG sets. */
    const first = nextStep("service", ctx, {})!;
    const second = nextStep("service", ctx, { requestType: "x" })!;
    for (const step of [first, second]) {
      expect(step.options?.some((o) => o.value === "Question" || o.value === "Complaint")).toBeFalsy();
      expect(step.options?.some((o) => o.value === "Email" || o.value === "Phone" || o.value === "Web")).toBeFalsy();
    }
    expect(REL_FLOWS.service.produces).toContain("read off this org's own picklists by the tool");
    expect(REL_FLOWS.service.produces).toContain("Nobody is assigned, no turnaround is promised");
  });
});

/* ------------------------------------------------------------- staging path */

describe("staging and the token", () => {
  const ctx = ctxFor();
  const answers = driveTo("annual", ctx, { reviewType: "Annual" });

  it("stages against the route's own tool and returns the ORG's token", async () => {
    const deps = depsFor();
    const staged = await stageRelPlan("annual", ctx, answers, "key-1", deps);
    expect(deps.staged[0].actionId).toBe("annual-review");
    expect(deps.staged[0].payload.idempotencyKey).toBe("key-1");
    expect(staged.decisionToken).toBe("6b3490fc91cf");
    expect(staged.planHash).toBe("hash-abcd");
  });

  it("refuses to stage with no connector, and burns nothing getting there", async () => {
    const stage = vi.fn();
    const deps = depsFor({ available: () => false, stage });
    await expect(stageRelPlan("annual", ctx, answers, "k", deps)).rejects.toThrow(/not connected to the bank's systems/);
    expect(stage).not.toHaveBeenCalled();
    expect(NO_CONNECTOR).toContain("nothing here is ever simulated");
  });

  it("withholds the token when the ORG says execution is held", async () => {
    const deps = depsFor({
      stage: async () => ({ ok: true, result: { ...PLAN, executionHeld: true, heldReason: "LV06." } }) as ToolOutcome<StagedOutput>,
    });
    const staged = await stageRelPlan("annual", ctx, answers, "k", deps);
    expect(staged.decisionToken).toBeNull();
    expect(staged.plan.heldReason).toBe("LV06.");
  });

  it("refuses a plan that would write outside the transition allowlist", async () => {
    // Deliberately an object NOTHING in this cockpit is allowed to write. The
    // allowlist grows (the wave-2 objects landed on it), so this asserts the
    // GUARD rather than the membership of any one object.
    const deps = depsFor({
      stage: async () =>
        ({
          ok: true,
          result: { ...PLAN, steps: [{ id: "s1", type: "write", label: "x", objectName: "LLC_BI__Not_A_Real_Object__c" }] },
        }) as ToolOutcome<StagedOutput>,
    });
    await expect(stageRelPlan("annual", ctx, answers, "k", deps)).rejects.toThrow(/outside what this cockpit permits/);
  });

  it("refuses a plan carrying a write-target record id, because something was already written", async () => {
    const deps = depsFor({
      stage: async () => ({ ok: true, result: { ...PLAN, valuationId: "a34bb000003EzUvAAK" } }) as ToolOutcome<StagedOutput>,
    });
    await expect(stageRelPlan("annual", ctx, answers, "k", deps)).rejects.toThrow(/may already have been written/);
  });

  it("carries the org's legal list out of a refusal so the room can re-offer it", async () => {
    const deps = depsFor({
      stage: async () =>
        ({
          ok: false,
          error: { code: "VALIDATION_FAILED", message: "bad value", legalValues: ["Appraisal", "Invoice / Bill of Sale"] },
        }) as ToolOutcome<StagedOutput>,
    });
    await expect(stageRelPlan("annual", ctx, answers, "k", deps)).rejects.toMatchObject({
      legalValues: ["Appraisal", "Invoice / Bill of Sale"],
    });
  });
});

describe("executing", () => {
  it("redeems the token through the route's own execute tool", async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      result: { stagingId: "a8a000", terminalState: "success", outcome: "Filed.", steps: [] },
    });
    const deps = depsFor({ execute });
    await executeRelPlan("covenant", {
      idempotencyKey: "key-1",
      stagingId: "a8a000",
      planHash: "hash-abcd",
      decisionToken: "6b3490fc91cf",
      approverUserId: "005bb000001AAAAAAA",
    }, deps);
    expect(execute.mock.calls[0][0]).toBe("covenant-review");
    // The STAGE key is reused on execute, and the original token is resent.
    expect(execute.mock.calls[0][1]).toMatchObject({ idempotencyKey: "key-1", decisionToken: "6b3490fc91cf" });
  });

  it("stamps a post-dispatch refusal, so the room stops offering the approval", async () => {
    const deps = depsFor({
      execute: async () => ({ ok: false, error: { code: "TOKEN_REFUSED", message: "already redeemed" } }) as ToolOutcome<ExecuteResult>,
    });
    const err = await executeRelPlan("annual", {
      idempotencyKey: "k",
      stagingId: "s",
      planHash: "h",
      decisionToken: "t",
      approverUserId: "005bb000001AAAAAAA",
    }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(RelFlowError);
    expect((err as RelFlowError).dispatched).toBe(true);
  });
});

/* -------------------------------------------------------------- the dossier */

describe("the dossier is built from the real result", () => {
  const ctx = ctxFor();

  it("names each covenant and the verdict that was written", () => {
    const answers = { covenants: ["cov1"], covenantStatuses: { cov1: "Compliant" } };
    const rows = dossierRowsFor("covenant", ctx, answers, {
      stagingId: "s",
      terminalState: "success",
      outcome: "ok",
      steps: [],
      approvalChainStarted: true,
    } as ExecuteResult);
    expect(rows[0]).toEqual({ icon: "covenant", label: "Debt Service Coverage", value: "Compliant" });
    expect(rows[1]).toEqual({ icon: "package", label: "approval chain", value: "started" });
  });

  it("never claims a coverage improvement the org did not report", () => {
    const rows = dossierRowsFor("valuation", ctx, { records: ["a35A"], recordValues: { a35A: 4_200_000 } }, {
      stagingId: "s",
      terminalState: "success",
      outcome: "ok",
      steps: [],
      collateralValueMoved: false,
    } as ExecuteResult);
    expect(rows.at(-1)).toEqual({ icon: "commit", label: "collateral value", value: "unchanged" });
  });

  it("renders a null recordName as the failed verification it is", () => {
    // `recordName: null` means the read-back did not confirm the write. Papering
    // over it would hide a real failure behind copy that reads like success.
    const rows = dossierRowsFor("annual", ctx, {}, {
      stagingId: "s",
      terminalState: "success",
      outcome: "ok",
      steps: [],
      recordName: null,
    } as ExecuteResult);
    expect(rows[0].value).toBe("filed, unverified");
  });
});

/* --------------------------------------------------------- creation semantics */

describe("the two relationship-level creates are PROPOSAL-ONLY", () => {
  it("recognises a covenant create inside the covenant review", () => {
    expect(readCreateAsk("add a covenant on the relationship", "covenant")).toBe("covenant");
    expect(readCreateAsk("assess the covenant", "covenant")).toBeNull();
    // A create ask is route-scoped: the covenant gap is not raised in a valuation.
    expect(readCreateAsk("add a covenant", "valuation")).toBeNull();
  });

  it("recognises a collateral create inside the valuation", () => {
    expect(readCreateAsk("create a new collateral asset the borrower owns", "valuation")).toBe("collateral");
    expect(readCreateAsk("value the collateral", "valuation")).toBeNull();
  });

  it("states the refusal and names the org-side gap for each, without composing a payload", () => {
    expect(CREATE_GAPS.covenant.line).toContain("cannot file it");
    expect(CREATE_GAPS.covenant.orgGap).toContain("stage_covenant_review accepts no create input");
    expect(CREATE_GAPS.collateral.orgGap).toContain("always terminates in a pledge");
    for (const gap of Object.values(CREATE_GAPS)) expect(`${gap.line} ${gap.orgGap}`).not.toMatch(/[—!]/);
  });

  it("keeps every create key out of the two payloads the room composes", () => {
    // The only deployed covenant create and the only deployed collateral create
    // both live on stage_loan_modification and both terminate on a facility
    // clone. Neither key may appear in anything this room sends.
    const ctx = ctxFor();
    const covenant = buildStagePayload(
      "covenant",
      ctx,
      { covenants: ["cov1"], covenantStatuses: { cov1: "Compliant" } },
      "k",
    );
    const valuation = buildStagePayload(
      "valuation",
      ctx,
      { records: ["a35A"], recordValues: { a35A: 1 }, valuationDate: "2026-08-31" },
      "k",
    );
    const sent = JSON.stringify([covenant, valuation]);
    for (const key of ["covenantAddsJson", "pledgeAddsJson", "newCollateral", "accountCollateral"]) {
      expect(sent).not.toContain(key);
    }
  });
});

/* =============================================================================
   THE COVENANT ROUTE REFUSES FIRST, AND OFFERS THE OPT-IN THE TOOL TAKES.

   Two failures this holds against. The first is the worst moment the addendum
   names: a relationship with no compliance rows was asked which covenants, then
   a verdict each, then a figure each, then a narrative, and only then did the
   org refuse all six. The second is quieter: `allowNonPending` has been on the
   tool since WS0.5 and the room never offered it, so a row that was open and
   not Pending could only ever be REFUSED.
   ============================================================================= */

const ROWLESS = {
  covenants: {
    covenants: [
      { covenantId: "cov1", covenantType: "Debt Service Coverage of Borrower", thresholdValue: 1.25, actualValue: 1.38 },
      { covenantId: "cov2", covenantType: "Minimum Liquidity", thresholdValue: 5_000_000, actualValue: 6_800_000 },
    ],
  },
};

describe("the covenant review says what the book cannot do, before it asks", () => {
  it("blocks the whole route where NOT ONE covenant carries a compliance row", () => {
    const ctx = ctxFor(ROWLESS as never);
    const blocked = relRouteBlock("covenant", ctx);
    expect(blocked).toContain("no open test period on any of the 2 covenants");
    expect(blocked).toContain("recording an assessment needs a compliance row");
    // AND IT ASKS NOTHING. Not one step is reached.
    expect(nextStep("covenant", ctx, {})).toBeNull();
  });

  /* RESTATED 0.9.24 (backlog row 49). This case used to assert that a missing
     package anchor blocked BEFORE the compliance problem. There is no package
     precondition on either route any more, so what it pins now is that the
     absence of an anchor changes nothing: the covenant route still reaches its
     own refusal, and the valuation still reaches its own. */
  it("reaches its own refusal on a relationship whose snapshot names no package", () => {
    const ctx = ctxFor({ ...ROWLESS, snapshot: { accountId: "001X", name: "Testco" } } as never);
    expect(ctx.productPackageId).toBeNull();
    expect(relRouteBlock("covenant", ctx)).toContain("no open test period on any of the 2 covenants");
    expect(relRouteBlock("covenant", ctx)).not.toContain("anchored on the product package");
    // The valuation's own book is untouched by the snapshot, so it runs.
    expect(relRouteBlock("valuation", ctx)).toBeNull();
  });

  it("does not block a relationship whose rows are there", () => {
    expect(relRouteBlock("covenant", ctxFor())).toBeNull();
    expect(relRouteBlock("annual", ctxFor())).toBeNull();
    expect(relRouteBlock("rating", ctxFor())).toBeNull();
    expect(relRouteBlock("service", ctxFor())).toBeNull();
  });

  it("shows a covenant with no row DISABLED, carrying its reason, never hidden", () => {
    const mixed = ctxFor({
      covenants: {
        covenants: [
          { covenantId: "cov1", covenantType: "Debt Service Coverage", latestComplianceStatus: "Pending" },
          { covenantId: "cov2", covenantType: "Minimum Liquidity" },
        ],
      },
    } as never);
    const step = nextStep("covenant", mixed, {})!;
    expect(step.options?.map((o) => o.value)).toEqual(["cov1", "cov2"]);
    expect(step.options?.[0].disabled).toBeFalsy();
    expect(step.options?.[1].disabled).toBe(true);
    expect(step.options?.[1].reason).toContain("no compliance row");
  });

  it("carries the read's own rail on every covenant option", () => {
    const step = nextStep("covenant", ctxFor({
      covenants: {
        covenants: [
          {
            covenantId: "cov1",
            covenantType: "Debt Service Coverage",
            thresholdValue: 1.25,
            actualValue: 1.38,
            latestComplianceStatus: "Pending",
          },
        ],
      },
    } as never), {})!;
    expect(step.options?.[0].detail).toContain("1.38× vs ≥ 1.25×");
    expect(step.options?.[0].detail).toContain("row at Pending");
  });
});

describe("the covenant review proposes the figure and offers the opt-in", () => {
  const withRows = (statuses: string[]) =>
    ctxFor({
      covenants: {
        covenants: statuses.map((status, i) => ({
          covenantId: `cov${i + 1}`,
          covenantType: i === 0 ? "Debt Service Coverage" : "Minimum Liquidity",
          thresholdValue: 1.25,
          actualValue: 1.38,
          latestComplianceId: `a2X${i}`,
          latestComplianceStatus: status,
        })),
      },
    } as never);

  it("PROPOSES the figure the read carries rather than asking cold", () => {
    const ctx = withRows(["Pending"]);
    const step = nextStep("covenant", ctx, { covenants: ["cov1"], covenantStatuses: { cov1: "Compliant" } })!;
    expect(step.key).toBe("covenantObservedValues.cov1");
    expect(step.ask).toContain("The read carries 1.38× vs ≥ 1.25×");
    // AN OPTION, NEVER A DEFAULT. The banker still owns the answer.
    expect(step.options?.[0].value).toBe("1.38");
    expect(step.optional).toBe(true);
  });

  it("names the field the tool ACTUALLY writes on both display peeks", () => {
    const ctx = withRows(["Pending"]);
    const figure = nextStep("covenant", ctx, { covenants: ["cov1"], covenantStatuses: { cov1: "Compliant" } })!;
    // Was LLC_BI__Observed_Value__c, which the tool does not write.
    expect(figure.target?.field).toBe("LLC_BI__Historic_Financial_Indicator__c");
    const basis = nextStep("covenant", ctx, {
      covenants: ["cov1"],
      covenantStatuses: { cov1: "Compliant" },
      covenantObservedValues: { cov1: 1.38 },
    })!;
    // Was LLC_BI__Narrative__c. The tool writes Agentic_AI_Response__c.
    expect(basis.target?.field).toBe("Agentic_AI_Response__c");
  });

  it("offers allowNonPending ONLY where a chosen row is not Pending, and says the schedule holds", () => {
    const ctx = withRows(["In Progress"]);
    const step = nextStep("covenant", ctx, {
      covenants: ["cov1"],
      covenantStatuses: { cov1: "Compliant" },
      covenantObservedValues: { cov1: 1.38 },
    })!;
    expect(step.key).toBe("allowNonPending");
    expect(step.ask).toContain("at In Progress, not Pending");
    expect(step.options?.[0].detail).toContain("the schedule does not advance");
  });

  it("never offers it where every chosen row is Pending", () => {
    const ctx = withRows(["Pending", "In Progress"]);
    const answers: Answers = {
      covenants: ["cov1"],
      covenantStatuses: { cov1: "Compliant" },
      covenantObservedValues: { cov1: 1.38 },
    };
    // cov2 is the non-Pending one and it was NOT chosen.
    expect(nextStep("covenant", ctx, answers)!.key).toBe("assessmentNarrative");
  });

  it("travels the flag only where the banker said yes out loud", () => {
    const ctx = withRows(["In Progress"]);
    const base: Answers = {
      covenants: ["cov1"],
      covenantStatuses: { cov1: "Compliant" },
      covenantObservedValues: { cov1: 1.38 },
      assessmentNarrative: SKIPPED,
    };
    const yes = buildStagePayload("covenant", ctx, { ...base, allowNonPending: "yes" }, "key-1");
    expect((yes as { payload: StagePayloads["covenant-review"] }).payload.allowNonPending).toBe(true);
    // AN ABSENT KEY IS THE TOOL'S OWN DEFAULT. Sending `false` would claim the
    // question had been asked when it had not.
    const no = buildStagePayload("covenant", ctx, { ...base, allowNonPending: "no" }, "key-1");
    expect((no as { payload: StagePayloads["covenant-review"] }).payload).not.toHaveProperty("allowNonPending");
    const never = buildStagePayload("covenant", ctx, base, "key-1");
    expect((never as { payload: StagePayloads["covenant-review"] }).payload).not.toHaveProperty("allowNonPending");
  });
});

/* =============================================================================
   THE VALUATION STOPS HARDCODING TWO INPUTS THE TOOL ALWAYS TOOK.

   `primary: false` and `description: null` were written into every payload the
   room composed. So a banker filing the valuation that supersedes the one on
   file could not say so, and the appraiser who struck the figure went
   unrecorded on a record whose whole purpose is provenance.
   ============================================================================= */

describe("the valuation collects its primary flag and its note", () => {
  const ctx = ctxFor();
  const upTo = (extra: Record<string, unknown>): Answers => ({
    records: ["a35A"],
    recordValues: { a35A: 11_400_000 },
    valuationDate: "2026-08-31",
    type: "Net Orderly Liquidation Value",
    source: "Receivables Aging",
    ...extra,
  });

  it("asks whether it becomes the primary, and says what each answer means", () => {
    const step = nextStep("valuation", ctx, upTo({}))!;
    expect(step.key).toBe("primary");
    expect(step.kind).toBe("chips");
    expect(step.optional).toBeFalsy();
    expect(step.options?.[0].detail).toContain("supersedes");
    expect(step.options?.[1].detail).toContain("joins the ladder");
    expect(step.target?.field).toBe("LLC_BI__Primary__c");
  });

  it("then asks who struck the figure, and lets it be skipped", () => {
    const step = nextStep("valuation", ctx, upTo({ primary: "yes" }))!;
    expect(step.key).toBe("description");
    expect(step.optional).toBe(true);
    expect(step.target?.field).toBe("LLC_BI__Valuation_Description__c");
  });

  it("travels both when answered", () => {
    const built = buildStagePayload(
      "valuation",
      ctx,
      upTo({ primary: "yes", description: "Q3 field exam, Hilco" }),
      "key-1",
    );
    const p = (built as { payload: StagePayloads["collateral-valuation"] }).payload;
    expect(p.items[0].primary).toBe(true);
    expect(p.items[0].description).toBe("Q3 field exam, Hilco");
  });

  it("travels false and null when skipped, and never the skip sentinel", () => {
    const built = buildStagePayload("valuation", ctx, upTo({ primary: "no", description: SKIPPED }), "key-1");
    const p = (built as { payload: StagePayloads["collateral-valuation"] }).payload;
    expect(p.items[0].primary).toBe(false);
    expect(p.items[0].description).toBeNull();
    expect(JSON.stringify(p)).not.toContain(SKIPPED);
  });

  it("names the PLEDGE lendable value on every asset option, never the asset formula", () => {
    const withOverride = ctxFor({
      exposure: {
        facilities: [
          {
            loanId: "0Cb1",
            status: "Active",
            productPackageId: PACKAGE,
            collateral: [
              {
                collateralId: "a35A",
                collateralDescription: "Inventory, Fort Wayne",
                collateralType: "UCC-Inventory",
                collateralValue: 8_000_000,
                currentLendableValue: 4_000_000,
                advanceRateSource: "Pledge override",
              },
            ],
          },
        ],
      },
    } as never);
    const step = nextStep("valuation", withOverride, {})!;
    // $6.4MM would be the asset formula at the 80 percent type rate. The bank
    // lends against the pledge, and the pledge carries a 50 percent override.
    expect(step.options?.[0].detail).toContain("$4M lendable");
    expect(step.options?.[0].detail).toContain("Pledge override");
    expect(step.options?.[0].detail).not.toContain("$6.4");
  });

  it("says the org offers no BOV and no Field Exam, rather than picking one", () => {
    const step = nextStep("valuation", ctx, {
      records: ["a35A"],
      recordValues: { a35A: 1 },
      valuationDate: "2026-08-31",
      type: "Net Orderly Liquidation Value",
    })!;
    expect(step.key).toBe("source");
    expect(step.placeholder).toContain("No BOV and no Field Exam");
  });
});

/* =============================================================================
   THE ANNUAL REVIEW CARRIES THE SECTIONS A REAL ONE CARRIES.

   Six narrative wires were declared on StageAnnualReview.Request and HARD
   NULLED in buildStagePayload, so a review this room filed carried a position
   and a recommendation and nothing else. What this holds is that all six now
   reach the wire, that they reach it through ONE chip set rather than six
   sequential questions, and that a section nobody picked stays null.
   ============================================================================= */

describe("the annual review's further sections", () => {
  const ctx = ctxFor();
  const base = { reviewType: "Annual", relationshipSummary: "The position.", recommendation: "Affirm at 4." };

  it("offers the six sections as one chip set, defaulting to none", () => {
    const step = nextStep("annual", ctx, base)!;
    expect(step.key).toBe("sections");
    expect(step.kind).toBe("multi");
    expect(step.optional).toBe(true);
    expect(step.options?.map((o) => o.value)).toEqual([
      "strengths",
      "weaknesses",
      "collateral",
      "guarantors",
      "rating",
      "financial",
    ]);
    // Each chip names the field it writes, so the peek is the truth.
    expect(step.options?.[2].detail).toBe("Writes cm_Collateral_Analysis_Narrative__c.");
  });

  it("opens ONE text step per section picked, and no more", () => {
    const one = nextStep("annual", ctx, { ...base, sections: ["collateral"] })!;
    expect(one.key).toBe("sectionNarratives.collateral");
    expect(one.target?.field).toBe("cm_Collateral_Analysis_Narrative__c");
    const answers = driveTo("annual", ctx, { ...base, sections: ["collateral", "rating"] });
    expect(Object.keys(answers)).toEqual([
      "reviewType",
      "relationshipSummary",
      "recommendation",
      "sections",
      "sectionNarratives",
    ]);
  });

  it("travels each picked section on its own wire, and nulls the rest", () => {
    const built = buildStagePayload(
      "annual",
      ctx,
      {
        ...base,
        sections: ["collateral", "rating"],
        sectionNarratives: {
          collateral: "A/R and inventory carry the base; the equipment number is an OLV reading.",
          rating: "Affirm at 4 with the construction facility flagged.",
        },
      },
      "key-1",
    );
    const p = (built as { payload: StagePayloads["annual-review"] }).payload;
    expect(p.collateralAnalysisNarrative).toContain("OLV reading");
    expect(p.riskRatingComments).toContain("Affirm at 4");
    expect(p.strengthsNarrative).toBeNull();
    expect(p.weaknessNarrative).toBeNull();
    expect(p.guarantorNarrative).toBeNull();
    expect(p.financialAnalystNarrative).toBeNull();
  });

  it("nulls a section that was picked and then skipped, and never sends the sentinel", () => {
    const built = buildStagePayload(
      "annual",
      ctx,
      { ...base, sections: ["guarantors"], sectionNarratives: { guarantors: SKIPPED } },
      "key-1",
    );
    const p = (built as { payload: StagePayloads["annual-review"] }).payload;
    expect(p.guarantorNarrative).toBeNull();
    expect(JSON.stringify(p)).not.toContain(SKIPPED);
  });

  it("names the cm_ fields this org actually has on both narrative peeks", () => {
    // LLC_BI__Relationship_Summary__c and LLC_BI__Recommendation__c do not
    // exist in this org. The payload always sent the right names; the peek on
    // the founder's screen did not.
    const summary = nextStep("annual", ctx, { reviewType: "Annual" })!;
    expect(summary.target?.field).toBe("cm_Relationship_Summary__c");
    const recommendation = nextStep("annual", ctx, { reviewType: "Annual", relationshipSummary: "x" })!;
    expect(recommendation.target?.field).toBe("cm_Recommendation_Narrative__c");
  });
});

/* =============================================================================
   THE RATING ROUTE COLLECTS THE OVERRIDE THE TOOL HAS ALWAYS TAKEN.

   OVERRIDE_NOT_FILEABLE told the banker the override could not be filed because
   the input's wire name had never been observed. It is deployed
   (StageRiskRatingReview.Request.overriddenRiskGradeValue), it carries its own
   description, and StageExecuteRiskRatingReviewTest.overrideWithACommentIsAccepted
   covers it. The room was refusing a capability the tool already had.

   WHAT IS REAL is the org's Mandatory_comment rule: any override above zero
   requires a written reason and there is no bypass.
   ============================================================================= */

describe("the grade override, and the one thing the org really refuses", () => {
  const ctx = ctxFor();
  const factors = {
    cashFlowCoverage: 1.38,
    revenueGrowth: 4.2,
    managementExperience: 24,
    creditScore: 740,
  };

  it("states the grade on file and offers the read's own computed figure", () => {
    const step = nextStep("rating", ctx, factors)!;
    expect(step.key).toBe("computedRiskGradeValue");
    expect(step.ask).toContain("The grade on file is 4");
    expect(step.ask).toContain("the rating review's own scale");
    expect(step.options?.[0].value).toBe("5");
    expect(step.options?.[0].detail).toBe("the grade the read computes");
  });

  it("asks for the override, and makes the reason MANDATORY once there is one", () => {
    const asked = nextStep("rating", ctx, { ...factors, computedRiskGradeValue: 4 })!;
    expect(asked.key).toBe("overriddenRiskGradeValue");
    expect(asked.optional).toBe(true);

    const withOverride = nextStep("rating", ctx, {
      ...factors,
      computedRiskGradeValue: 4,
      overriddenRiskGradeValue: 5,
    })!;
    expect(withOverride.key).toBe("overrideComment");
    expect(withOverride.optional).toBe(false);
    expect(withOverride.ask).toContain("has no bypass");

    const without = nextStep("rating", ctx, {
      ...factors,
      computedRiskGradeValue: 4,
      overriddenRiskGradeValue: SKIPPED,
    })!;
    expect(without.key).toBe("overrideComment");
    expect(without.optional).toBe(true);
  });

  it("files the override with its reason, on the deployed wire name", () => {
    const built = buildStagePayload(
      "rating",
      ctx,
      {
        ...factors,
        computedRiskGradeValue: 4,
        overriddenRiskGradeValue: 5,
        overrideComment: "Construction facility above the 70 pct policy line.",
      },
      "key-1",
    );
    expect(built.ok).toBe(true);
    const p = (built as { payload: StagePayloads["risk-rating-review"] }).payload;
    expect(p.overriddenRiskGradeValue).toBe(5);
    expect(p.computedRiskGradeValue).toBe(4);
    // THE FIELD Mandatory_comment ACTUALLY TESTS, not LLC_BI__Override_Comment__c.
    expect(p.comments).toContain("70 pct policy line");
  });

  it("BLOCKS an override with no reason before the org has to refuse it", () => {
    const built = buildStagePayload(
      "rating",
      ctx,
      { ...factors, computedRiskGradeValue: 4, overriddenRiskGradeValue: 5, overrideComment: SKIPPED },
      "key-1",
    );
    expect(built.ok).toBe(false);
    expect((built as { blocked: string }).blocked).toBe(OVERRIDE_NEEDS_A_REASON);
  });

  it("sends no override key at all where the banker skipped it", () => {
    const built = buildStagePayload(
      "rating",
      ctx,
      { ...factors, computedRiskGradeValue: 4, overriddenRiskGradeValue: SKIPPED, overrideComment: SKIPPED },
      "key-1",
    );
    const p = (built as { payload: StagePayloads["risk-rating-review"] }).payload;
    expect(p.overriddenRiskGradeValue).toBeNull();
    expect(JSON.stringify(p)).not.toContain(SKIPPED);
  });

  it("files the grade the BANKER proposed, and falls back to the read only on a skip", () => {
    const owned = buildStagePayload("rating", ctx, { ...factors, computedRiskGradeValue: 6 }, "key-1");
    expect((owned as { payload: StagePayloads["risk-rating-review"] }).payload.computedRiskGradeValue).toBe(6);
    // computedRiskRating on the read is "5". A skipped answer is not a refusal
    // to file a grade; it is the banker taking the read's own figure.
    const skipped = buildStagePayload("rating", ctx, { ...factors, computedRiskGradeValue: SKIPPED }, "key-1");
    expect((skipped as { payload: StagePayloads["risk-rating-review"] }).payload.computedRiskGradeValue).toBe(5);
  });

  it("carries NO loanId, and that is the deliberate call", () => {
    const built = buildStagePayload("rating", ctx, factors, "key-1");
    const p = (built as { payload: StagePayloads["risk-rating-review"] }).payload;
    // The only facility-LGD hook on any of the five wires. A facility rating is
    // the facility room's subject; this route's whole frame is the borrower.
    expect(p).not.toHaveProperty("loanId");
    expect(REL_FLOWS.rating.produces).toContain("facility-level rating stays in the facility room");
  });

  it("reads a regulatory classification as a classification, never as a grade", () => {
    expect(asksForClassification("they are special mention now", "rating")).toBe(true);
    expect(asksForClassification("substandard", "rating")).toBe(true);
    expect(asksForClassification("downgrade them to a 5", "rating")).toBe(false);
    expect(asksForClassification("they are special mention now", "covenant")).toBe(false);
    expect(NOT_A_CLASSIFICATION).toContain("this org's scale is numeric");
  });
});

describe("a blocked route asks nothing, on EVERY route it blocks", () => {
  /* THE HEADLESS DRIVE CAUGHT THIS on 2026-09-02, line 5. The covenant route's
     honesty gate lived inside covenantStep, so the VALUATION route rendered its
     refusal under its brief and then asked "which collateral are we valuing?"
     underneath it: the room refusing and interrogating in the same breath.
     `relRouteBlock` is the one judgement now.

     RESTATED 0.9.24 (backlog row 49). The blocked context used to be "no
     package anchor", which no longer blocks anything: the account is the
     anchor. The invariant is unchanged and is what matters here, so the two
     refusals that are still real carry it — a relationship with nothing pledged
     and one whose covenants carry no compliance row. */
  const nothingPledged = ctxFor({ exposure: { totalCommitted: 0, facilities: [] } } as never);
  const noRows = ctxFor({
    covenants: { covenants: [{ covenantId: "cov1", covenantType: "Debt Service Coverage" }] },
  } as never);
  const noAnchor = ctxFor({ snapshot: { accountId: "001X", name: "Testco" } } as never);

  it("asks nothing on the valuation with nothing pledged to value", () => {
    expect(relRouteBlock("valuation", nothingPledged)).not.toBeNull();
    expect(nextStep("valuation", nothingPledged, {})).toBeNull();
  });

  it("asks nothing on the covenant review with no compliance row to close", () => {
    expect(relRouteBlock("covenant", noRows)).not.toBeNull();
    expect(nextStep("covenant", noRows, {})).toBeNull();
  });

  it("and a missing package anchor no longer blocks either of them", () => {
    expect(relRouteBlock("covenant", noAnchor)).toBeNull();
    expect(relRouteBlock("valuation", noAnchor)).toBeNull();
    expect(nextStep("covenant", noAnchor, {})).not.toBeNull();
    expect(nextStep("valuation", noAnchor, {})).not.toBeNull();
  });

  it("still asks on the three routes the anchor never gated", () => {
    expect(nextStep("annual", noAnchor, {})).not.toBeNull();
    expect(nextStep("rating", noAnchor, {})).not.toBeNull();
    expect(nextStep("service", noAnchor, {})).not.toBeNull();
  });
});
