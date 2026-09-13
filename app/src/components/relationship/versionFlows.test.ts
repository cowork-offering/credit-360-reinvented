import { describe, expect, it } from "vitest";
import type { BorrowerBundle, C360Data, Facility } from "../../data/contract";
import { NOT_AMENDABLE_REFUSAL } from "../../book/packages";
import {
  REL_FLOWS,
  relContextFor,
  relPackageAsk,
  relPackagePending,
  relReadyLine,
  relRouteBlock,
  relRouteNeedsPackage,
  type RelContext,
} from "./reviewFlows";
import {
  AMEND_DOES_NOT,
  A_NEW_ASSET,
  AUTHOR_A_NEW_ONE,
  DESCRIPTION_CAP,
  DESCRIPTION_TOO_LONG,
  NOTHING_AMENDABLE,
  OVER_PLEDGE_NOT_AUTHORISED,
  TARGET_OFF_THE_VERSION,
  amendTarget,
  amendablePackages,
  buildVersionPayload,
  versionDossierRows,
  versionMembers,
  versionRows,
  versionStep,
} from "./versionFlows";
import type { Answers } from "./relStep";
import type { StagePayloads } from "../../channel/writeTools";

/* =============================================================================
   THE TWO VERSION ROUTES, AT THE WIRE.

   The render suite (`src/versionRoom.render.test.tsx`) drives the room; this
   one holds the judgements the room stands on: which packages can be shaped at
   all, which question the picker is asking, what the payload refuses, and what
   the plan card promises. Every refusal below is one the ORG would make, stated
   here first so the banker reads an answerable question instead of a rejection.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";
const CLONE_A = "a4Zbb000002KFD4EAO";
const CLONE_B = "a4Zbb000002KFD3EAO";

const loan = (over: Partial<Facility>): Facility => ({
  status: "Open",
  productPackageId: SOURCE,
  stage: "Booked",
  ...over,
});

const BOOKED: Facility[] = [
  loan({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000, outstanding: 6_340_000 }),
  loan({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, outstanding: 1_330_000 }),
];

const clones = (stage = "Qualification"): Facility[] => [
  loan({ loanId: CLONE_A, name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000, outstanding: 0, productPackageId: VERSION, stage }),
  loan({ loanId: CLONE_B, name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, outstanding: 0, productPackageId: VERSION, stage }),
];

function ctxFor(facilities: Facility[], anchor: string | null): RelContext {
  const bundle = {
    snapshot: { accountId: ACCOUNT, name: "Hartwell Precision Manufacturing LLC", productPackageId: SOURCE },
    exposure: {
      totalCommitted: facilities.reduce((s, f) => s + (f.committed ?? 0), 0),
      totalOutstanding: facilities.reduce((s, f) => s + (f.outstanding ?? 0), 0),
      totalUniqueCollateralLendableValue: 6_300_000,
      uniqueCollateralCount: 1,
      facilities,
    },
    covenants: { covenants: [] },
    requests: [],
  } as unknown as BorrowerBundle;
  const data = { meta: { generatedAt: "2026-09-13" } } as unknown as C360Data;
  return relContextFor({
    data,
    bundle,
    accountId: ACCOUNT,
    accountName: "Hartwell Precision Manufacturing LLC",
    productPackageId: anchor,
  });
}

/** Standing on the version, which is where both routes run. */
const onVersion = () => ctxFor([...BOOKED, ...clones()], VERSION);
/** Standing on the booked package, which is where the room starts. */
const onBooked = () => ctxFor([...BOOKED, ...clones()], SOURCE);
/** A relationship with nothing to shape at all. */
const bookedOnly = () => ctxFor(BOOKED, SOURCE);

/* -----------------------------------------------------------------------------
   WHAT CAN BE SHAPED
   ----------------------------------------------------------------------------- */

describe("what the room may shape in place", () => {
  it("names the editable version and nothing else", () => {
    expect(amendablePackages(onBooked()).map((p) => p.id)).toEqual([VERSION]);
    expect(amendTarget(onVersion())?.id).toBe(VERSION);
    // The booked package is never an amend target: a change to it is a
    // modification, and that forks a version rather than shaping one.
    expect(amendTarget(onBooked())).toBeNull();
  });

  it("drops the version the moment the org takes it to approval", () => {
    const taken = ctxFor([...BOOKED, ...clones("Approval / Loan Committee")], VERSION);
    expect(amendablePackages(taken)).toEqual([]);
    expect(amendTarget(taken)).toBeNull();
  });

  it("offers the version's own facilities as the only legal targets", () => {
    expect(versionMembers(onVersion()).map((f) => f.loanId)).toEqual([CLONE_A, CLONE_B]);
    expect(versionMembers(onBooked())).toEqual([]);
  });
});

/* -----------------------------------------------------------------------------
   THE PICKER, AND THE ROUTE GATE
   ----------------------------------------------------------------------------- */

describe("the package ask on a version route", () => {
  it("asks the picker for an AMEND, and leaves every review asking for a review", () => {
    expect(relPackageAsk("versionCovenant")).toBe("amend");
    expect(relPackageAsk("versionPledge")).toBe("amend");
    for (const route of ["annual", "covenant", "valuation", "rating", "service", "intake"] as const) {
      expect(relPackageAsk(route), route).toBe("review");
    }
    expect(relPackageAsk(null)).toBe("review");
  });

  it("asks wherever the anchor is not a package it may shape", () => {
    // The snapshot's own anchor is the BOOKED package, so a version route on a
    // fresh room is always asking.
    expect(relPackagePending("versionCovenant", onBooked())).toBe(true);
    expect(relPackagePending("versionPledge", onVersion())).toBe(false);
    // And it asks nothing where there is nothing to ask about.
    expect(relPackagePending("versionCovenant", bookedOnly())).toBe(false);
    expect(relRouteNeedsPackage("versionCovenant")).toBe(true);
    expect(relRouteNeedsPackage("versionPledge")).toBe(true);
  });

  it("refuses the route before it asks anything, where nothing is amendable", () => {
    expect(relRouteBlock("versionCovenant", bookedOnly())).toBe(NOTHING_AMENDABLE);
    expect(relRouteBlock("versionPledge", bookedOnly())).toBe(NOTHING_AMENDABLE);
    // A pending ask is a question, not a refusal.
    expect(relRouteBlock("versionCovenant", onBooked())).toBeNull();
    expect(relRouteBlock("versionCovenant", onVersion())).toBeNull();
  });

  it("names the gap AND the way on, because a refusal without a door is a dead end", () => {
    expect(NOTHING_AMENDABLE).toContain("every package on it is booked");
    expect(NOTHING_AMENDABLE).toContain("Facility Actions");
    expect(NOTHING_AMENDABLE).toContain("goes back a stage in Salesforce first");
    expect(NOT_AMENDABLE_REFUSAL).toContain("Open Modify");
  });
});

/* -----------------------------------------------------------------------------
   THE FLOW SPECS
   ----------------------------------------------------------------------------- */

describe("the two flow specs", () => {
  const specs = [REL_FLOWS.versionCovenant, REL_FLOWS.versionPledge];

  it("drives the ONE tool the contract froze for this", () => {
    for (const spec of specs) expect(spec.actionId).toBe("amend-version");
  });

  it("declares no per-tool object fence, exactly as every review does", () => {
    // A route that declares no key is validated by the object table alone,
    // which already permits every object these two arms write. The intake is
    // the one route that needs a narrower fence, because its identity is what
    // it must NOT touch.
    for (const spec of specs) expect(spec.toolId).toBeUndefined();
  });

  it("says in `produces` what the amendment does not do", () => {
    for (const spec of specs) {
      expect(spec.produces).toContain("forks no second version");
      expect(spec.produces).toContain("takes no credit action");
      expect(spec.produces).toContain("moves nothing on the booked package");
    }
  });

  it("keeps house style: no em dashes, no exclamation points", () => {
    const copy = [...specs.map((s) => `${s.covers} ${s.produces} ${s.word} ${s.approveLabel}`), NOTHING_AMENDABLE, AMEND_DOES_NOT].join(" ");
    expect(copy).not.toMatch(/[—!]/);
    expect(copy).not.toMatch(/IRIS/);
  });
});

/* -----------------------------------------------------------------------------
   THE PAYLOAD, AND WHAT IT REFUSES
   ----------------------------------------------------------------------------- */

/** A complete covenant author, aimed at the first version member. */
const COVENANT_ANSWERS: Answers = {
  vcType: "Minimum Liquidity",
  vcOperator: ">=",
  vcThreshold: "2500000",
  vcFrequency: "Quarterly",
  vcEffective: "2026-10-01",
  vcTarget: CLONE_A,
};

const arm = (payload: StagePayloads["amend-version"], key: keyof StagePayloads["amend-version"]): unknown[] =>
  JSON.parse((payload[key] as string | undefined) ?? "[]");

describe("the amend-version payload", () => {
  it("carries ONE arm, anchored on the version and on nothing else", () => {
    const built = buildVersionPayload("versionCovenant", onVersion(), COVENANT_ANSWERS, "key-1");
    expect(built.ok).toBe(true);
    const payload = (built as { payload: StagePayloads["amend-version"] }).payload;
    expect(payload.versionPackageId).toBe(VERSION);
    // No accountId, no productPackageId: `amend_version` is anchored on the
    // unbooked package and carries neither.
    expect(payload).not.toHaveProperty("accountId");
    expect(payload).not.toHaveProperty("productPackageId");
    expect(arm(payload, "covenantAddsJson")).toHaveLength(1);
    expect(payload.pledgeAddsJson).toBeUndefined();
    expect(payload.covenantAttachesJson).toBeUndefined();
  });

  it("refuses a target that is not a member of the version, by name", () => {
    const off = { ...COVENANT_ANSWERS, vcTarget: "a4Zbb000002ICnxEAG" };
    expect(buildVersionPayload("versionCovenant", onVersion(), off, "key-1")).toEqual({
      ok: false,
      blocked: TARGET_OFF_THE_VERSION,
    });
  });

  it("refuses a half-answered covenant rather than filing it under a default", () => {
    const half = { ...COVENANT_ANSWERS, vcFrequency: undefined };
    delete (half as Record<string, unknown>).vcFrequency;
    const built = buildVersionPayload("versionCovenant", onVersion(), half, "key-1");
    expect(built.ok).toBe(false);
    expect((built as { blocked: string }).blocked).toContain("a half-answered one is never staged under a default");
  });

  it("refuses to stage against a package the room may not shape", () => {
    const built = buildVersionPayload("versionCovenant", onBooked(), COVENANT_ANSWERS, "key-1");
    expect(built.ok).toBe(false);
    expect((built as { blocked: string }).blocked).toContain("lands on an unbooked version and none is anchored");
  });

  it("refuses a description past the field's own length, with the length", () => {
    const answers: Answers = {
      vpSource: A_NEW_ASSET,
      vpType: "Equipment",
      vpDescription: "x".repeat(DESCRIPTION_CAP + 1),
      vpValue: "800000",
      vpAdvanceRate: "50",
      vpTarget: CLONE_A,
    };
    const built = buildVersionPayload("versionPledge", onVersion(), answers, "key-1");
    expect(built).toEqual({ ok: false, blocked: DESCRIPTION_TOO_LONG(DESCRIPTION_CAP + 1) });
    expect(DESCRIPTION_TOO_LONG(256)).toContain("refuses a longer one rather than truncating it");
  });

  it("refuses an over-pledge nobody authorised, and takes one somebody did", () => {
    const over: Answers = {
      vpSource: A_NEW_ASSET,
      vpType: "Equipment",
      vpDescription: "Forklift fleet",
      vpValue: "800000",
      vpAdvanceRate: "50",
      vpAmount: "500000",
      vpTarget: CLONE_A,
    };
    expect(buildVersionPayload("versionPledge", onVersion(), over, "key-1")).toEqual({
      ok: false,
      blocked: OVER_PLEDGE_NOT_AUTHORISED(500_000, 400_000),
    });
    const authorised = buildVersionPayload("versionPledge", onVersion(), { ...over, vpAuthorise: "authorise" }, "key-1");
    expect(authorised.ok).toBe(true);
    expect(arm((authorised as { payload: StagePayloads["amend-version"] }).payload, "pledgeAddsJson")).toEqual([
      {
        newCollateral: { description: "Forklift fleet", collateralType: "Equipment", value: 800_000 },
        advanceRate: 50,
        amountPledged: 500_000,
        authoriseOverPledge: true,
        targetLoanId: CLONE_A,
      },
    ]);
  });

  it("sends the authorise flag only where it does work", () => {
    // Within the lendable value the org ignores the flag, so sending it would
    // put a checkbox on the wire for a decision nobody had to make.
    const within: Answers = {
      vpSource: A_NEW_ASSET,
      vpType: "Equipment",
      vpDescription: "Forklift fleet",
      vpValue: "800000",
      vpAdvanceRate: "50",
      vpAmount: "300000",
      vpAuthorise: "authorise",
      vpTarget: CLONE_A,
    };
    const built = buildVersionPayload("versionPledge", onVersion(), within, "key-1");
    const row = arm((built as { payload: StagePayloads["amend-version"] }).payload, "pledgeAddsJson")[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("authoriseOverPledge");
  });

  it("leaves the amount off the wire where the banker stated none", () => {
    // An absent key is the tool's own default of the lendable value. Sending
    // the derived figure would claim the room computed what the org computes.
    const answers: Answers = {
      vpSource: A_NEW_ASSET,
      vpType: "Equipment",
      vpDescription: "Forklift fleet",
      vpValue: "800000",
      vpAdvanceRate: "50",
      vpTarget: CLONE_A,
    };
    const built = buildVersionPayload("versionPledge", onVersion(), answers, "key-1");
    const row = arm((built as { payload: StagePayloads["amend-version"] }).payload, "pledgeAddsJson")[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty("amountPledged");
  });
});

/* -----------------------------------------------------------------------------
   THE MACHINE TERMINATES
   ----------------------------------------------------------------------------- */

describe("the step machine", () => {
  it("is done the moment the wire has everything it needs", () => {
    expect(versionStep("versionCovenant", onVersion(), COVENANT_ANSWERS)).toBeNull();
  });

  it("terminates under the step counter's own probe walk", () => {
    /* `plannedStepCount` walks this machine forward answering every step with
       a sentinel, to count what is still to come. A machine that never settles
       hangs the room's own spine. */
    for (const route of ["versionCovenant", "versionPledge"] as const) {
      const probe: Answers = {};
      let asked = 0;
      for (; asked < 64; asked++) {
        const step = versionStep(route, onVersion(), probe);
        if (!step) break;
        probe[step.key] = "__skipped__";
      }
      expect(asked, route).toBeLessThan(64);
    }
  });

  it("does not ask which asset where the borrower owns none, and files one instead", () => {
    // A choice of nothing is not a choice. Asking "which asset" over one chip
    // and then asking for its type underneath the answer is the double the
    // golden rule forbids.
    const step = versionStep("versionPledge", onVersion(), {})!;
    expect(step.key).toBe("vpType");
    expect(step.ask).toContain("The read carries no asset this borrower owns");
  });

  it("asks the attach question before it offers a duplicate, and stops asking after it", () => {
    const held = ctxFor([...BOOKED, ...clones()], VERSION);
    held.bundle!.covenants = {
      covenants: [
        { covenantId: "a2XA", covenantType: "Minimum Liquidity", thresholdValue: 2_000_000, actualValue: 2_400_000, frequency: "Quarterly" },
      ],
    } as never;
    const attachStep = versionStep("versionCovenant", held, { vcType: "Minimum Liquidity" })!;
    expect(attachStep.key).toBe("vcAttach");
    expect(attachStep.options?.map((o) => o.value)).toEqual(["a2XA", AUTHOR_A_NEW_ONE]);

    // ATTACHED: nothing below the junction is on its wire, so the member is the
    // only thing left to ask.
    const next = versionStep("versionCovenant", held, { vcType: "Minimum Liquidity", vcAttach: "a2XA" })!;
    expect(next.key).toBe("vcTarget");

    // AUTHORED: the full terms are collected, because a fresh covenant carries
    // its own threshold and its own schedule.
    const authored = versionStep("versionCovenant", held, { vcType: "Minimum Liquidity", vcAttach: AUTHOR_A_NEW_ONE })!;
    expect(authored.key).toBe("vcOperator");
  });
});

/* -----------------------------------------------------------------------------
   THE LANE AND THE PLAN CARD
   ----------------------------------------------------------------------------- */

describe("what the banker reads back", () => {
  it("reads the lane as what is being filed, one row per thing", () => {
    const rows = versionRows("versionCovenant", onVersion(), COVENANT_ANSWERS);
    expect(rows.map((r) => r.key)).toEqual(["version", "covenant", "target"]);
    expect(rows.find((r) => r.key === "covenant")!.value).toBe(">= $2.50M, quarterly, from 2026-10-01");
    expect(rows.find((r) => r.key === "target")!.value).toBe("Hartwell - Purchase - $12,000,000.00");
  });

  it("reads a filed row back under the org's own id, and unverified where the org named none", () => {
    const withId = versionDossierRows("versionCovenant", onVersion(), COVENANT_ANSWERS, [
      { recordName: "COV-0099", recordId: "a2Xbb000000AAAAEAW" },
    ]);
    expect(withId[0].value).toBe("COV-0099 · a2Xbb000000AAAAEAW");
    // The version row is the room's own context, not something the org filed,
    // so it is not matched against an item.
    expect(withId.map((r) => r.key)).toEqual(["covenant", "target"]);
    const unnamed = versionDossierRows("versionCovenant", onVersion(), COVENANT_ANSWERS, undefined);
    expect(unnamed[0].value).toBe(">= $2.50M, quarterly, from 2026-10-01");
  });

  it("promises what it changes, what it does not, and the next step", () => {
    const line = relReadyLine("versionCovenant", onVersion(), COVENANT_ANSWERS);
    expect(line).toContain("This authors a Minimum Liquidity covenant at >= $2.50M");
    expect(line).toContain(AMEND_DOES_NOT);
    expect(line).toContain("Review the plan below, then file it.");
    expect(line).not.toMatch(/[—!]/);
  });
});
