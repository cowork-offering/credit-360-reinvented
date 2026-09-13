// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clearComposed } from "./workroom/engine";
import { createModifyEngine, type ModifyEngineDeps } from "./workroom/modifyEngine";
import { createRenewEngine, type RenewEngineDeps } from "./workroom/renewEngine";
import { readNewFacility, readProduct, readPurposeValue } from "./components/workroom/newFacilityArm";
import {
  nextStep,
  relContextFor,
  relRouteBlock,
  type Answers,
  type RelContext,
} from "./components/relationship/reviewFlows";
import type { ElicitMember } from "./components/workroom/elicit";
import type { BorrowerBundle, C360Data, Facility } from "./data/contract";
import type { WorkroomContext, WorkroomDelta } from "./workroom/types";

/* =============================================================================
   THE CHAT-BEHAVIOUR AUDIT, PINNED (A2, 2026-09-12).

   Founder brief: "run again some agents over the chat behaviours, patterns etc
   to avoid any fallbacks." Every case below was first driven against the real
   engines and the real step machine, reproduced a break of
   `knowledge/CHAT-GOLDEN-RULE.md`, and is kept here so the break cannot come
   back. The inputs are the stress script's own
   (`knowledge/IMPROVEMENTS-AND-BUGS.md`, sections A, B, C, D and cross-cutting)
   and the fixtures are the Hartwell figures the engine suites already use.

   Nothing here is a storyline. Every assertion is on what the engine actually
   said back.
   ============================================================================= */

const PACKAGE_ID = "a5Fbb000000IHFJEA4";
const LINE_ID = "a4Zbb0000027MaYEAU";
const EQUIPMENT_ID = "a4Zbb0000027MnREAU";

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

function bundleWith(facilities: Facility[] = [line, equipment]): BorrowerBundle {
  return {
    snapshot: {
      accountId: "001bb00001I7FPNAA3",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: PACKAGE_ID,
      packageStage: "Complete",
      primaryRiskRating: "4",
    },
    exposure: {
      totalCommitted: 23_000_000,
      totalOutstanding: 15_100_000,
      totalUniqueCollateralLendableValue: 34_600_000,
      uniqueCollateralCount: 5,
      coverageRatio: 1.13,
      facilities,
    },
    covenants: { covenants: [] },
    graph: { legalEntities: [], connections: [] },
  } as unknown as BorrowerBundle;
}

const data = {
  meta: {
    anchorAccountId: "001bb00001I7FPNAA3",
    generatedAt: "2026-08-27T08:00:00Z",
    user: "Fabian Goetzens",
    userId: "005bb00000ftouDAAQ",
  },
} as unknown as C360Data;

const modifyContext: WorkroomContext = {
  mode: "modify",
  door: "package",
  accountId: "001bb00001I7FPNAA3",
  accountName: "Hartwell Precision Manufacturing LLC",
  productPackageId: PACKAGE_ID,
  packageName: "Hartwell Precision Manufacturing LLC credit package",
  approver: "Fabian Goetzens",
};

const renewContext: WorkroomContext = { ...modifyContext, mode: "renew" };

/** The engine with its assist OFF, which is the state the room degrades to when
 *  neither the session door nor the gateway answers. Every case below has to
 *  hold there: a fallback that only reads well with a model behind it is the
 *  fallback the founder asked about. */
function modifyEngine(over: Partial<ModifyEngineDeps> = {}) {
  clearComposed();
  return createModifyEngine({
    context: modifyContext,
    data,
    bundle: bundleWith(),
    deps: { available: () => true, newKey: () => "audit-key", restate: undefined, today: () => "2026-09-12", ...over },
  });
}

function renewEngine(over: Partial<RenewEngineDeps> = {}) {
  clearComposed();
  return createRenewEngine({
    context: renewContext,
    data,
    bundle: bundleWith(),
    deps: { available: () => true, newKey: () => "audit-key", restate: undefined, ...over },
  });
}

type Said = { kind: string; reply: string; options?: Array<{ label: string; say: string }>; deltas?: WorkroomDelta[] };

async function say(engine: { parseIntent: (t: string, c: WorkroomContext) => Promise<unknown> }, text: string, ctx: WorkroomContext): Promise<Said> {
  const r = (await engine.parseIntent(text, ctx)) as Said;
  return r;
}

const wireOf = (r: Said) => r.deltas?.map((d) => d.wire);

/* ============================================================ A. MODIFICATION */

describe("A. modification: a miss is answered, never repeated", () => {
  it("names what it heard instead of putting the identical question back (A3, A7)", async () => {
    const engine = modifyEngine();
    const asked = await say(engine, "change the rate on the line of credit", modifyContext);
    expect(asked.reply).toMatch(/what rate should it move to/i);

    const missed = await say(engine, "asdf", modifyContext);
    // THE BREAK: this used to be `asked.reply` word for word, so the banker
    // could not tell whether the room had heard them at all.
    expect(missed.reply).not.toBe(asked.reply);
    expect(missed.reply).toContain('I heard "asdf"');
    expect(missed.reply).toContain("cannot read it as a rate");
    // And the question is still there, with its chip, so the way out is intact.
    expect(missed.reply).toMatch(/what rate should it move to/i);
    expect(missed.options?.some((o) => /^Keep 7\.6%$/.test(o.label))).toBe(true);
  });

  it("says the line came through empty rather than blaming the reading (A7, 3.j)", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const blank = await say(engine, "   ", modifyContext);
    expect(blank.reply).toContain("came through with nothing in it");
    expect(blank.reply).toMatch(/what rate should it move to/i);
  });

  it("keeps the pending question alive through a line that answered nothing (A7, 3.j)", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    await say(engine, "   ", modifyContext);
    // THE BREAK: the blank line used to retire the question, so this good
    // answer landed on no field at all and came back as the capability lecture.
    const answered = await say(engine, "7.25%", modifyContext);
    expect(answered.kind).toBe("deltas");
    expect(wireOf(answered)).toEqual([{ key: "requestedRate", value: 7.25, facilityId: LINE_ID }]);
  });

  it("names the chips on a second miss of the same question (cross-cutting, no loops)", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    await say(engine, "asdf", modifyContext);
    const twice = await say(engine, "!!!", modifyContext);
    expect(twice.reply).toContain("The chips under this answer it too: Keep 7.6%.");
  });

  it("takes every keep-current word as an answer, on the forced rate (A3c)", async () => {
    for (const word of ["hold", "keep it", "no change", "same", "unchanged", "as-is", "stet", "leave it"]) {
      const engine = modifyEngine();
      await say(engine, "change the rate on the line of credit", modifyContext);
      const held = await say(engine, word, modifyContext);
      expect(held.reply, word).toContain("Holding interest rate at 7.6%");
      expect(held.reply, word).not.toMatch(/what rate should it move to/i);
    }
  });
});

describe("A. modification: a relative move is computed off the figure on file", () => {
  /* THE STRESS SCRIPT'S OWN ROW 3.d: "computes from the CURRENT figure
     correctly; treats it as absolute" is the flag. Every one of these staged
     the MOVE as the target, so "increase the line by $5M" on a $15M line
     staged a $5M commitment: a two-thirds cut, filed under the word increase. */
  it("increase by $5M on a $15M line stages $20M, not $5M", async () => {
    const engine = modifyEngine();
    const r = await say(engine, "increase the line of credit by $5M", modifyContext);
    expect(wireOf(r)).toEqual([{ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID }]);
  });

  it("reduce by $2M on a $15M line stages $13M, not $2M", async () => {
    const engine = modifyEngine();
    const r = await say(engine, "reduce the line of credit by $2M", modifyContext);
    expect(wireOf(r)).toEqual([{ key: "requestedAmount", value: 13_000_000, facilityId: LINE_ID }]);
  });

  it("add 50bps on a 7.6% rate stages 8.10%, not 0.5%", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const r = await say(engine, "add 50bps", modifyContext);
    expect(wireOf(r)).toEqual([{ key: "requestedRate", value: 8.1, facilityId: LINE_ID }]);
  });

  it("lower by 25 basis points stages 7.35%", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const r = await say(engine, "lower by 25 basis points", modifyContext);
    expect(wireOf(r)).toEqual([{ key: "requestedRate", value: 7.35, facilityId: LINE_ID }]);
  });

  it("leaves a line that names a target exactly as it was", async () => {
    const engine = modifyEngine();
    const r = await say(engine, "increase the line of credit to $20M", modifyContext);
    expect(wireOf(r)).toEqual([{ key: "requestedAmount", value: 20_000_000, facilityId: LINE_ID }]);
  });
});

describe("A. modification: a figure the banker never typed is never staged", () => {
  it("refuses a minus rate instead of staging its positive (3.e, 3.h)", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const r = await say(engine, "-5%", modifyContext);
    // THE BREAK: the tokeniser dropped the sign and staged 5%.
    expect(r.kind).toBe("unparsed");
    expect(r.reply).toContain("I will not read a minus off the line as one");
  });

  it("refuses a minus commitment instead of staging its positive (3.e, 3.h)", async () => {
    const engine = modifyEngine();
    await say(engine, "increase the line of credit", modifyContext);
    const r = await say(engine, "-4,000,000", modifyContext);
    expect(r.kind).toBe("unparsed");
    expect(r.reply).toContain("A commitment is a positive figure");
  });
});

describe("A. modification: an absurd figure is questioned, not staged in silence (3.h)", () => {
  const adviceOn = (r: Said) => (r as unknown as { advisories?: Array<{ rule: string; line: string }> }).advisories ?? [];

  it("questions a 600% rate", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const r = await say(engine, "600%", modifyContext);
    const advice = adviceOn(r).find((a) => a.rule === "rate-off-the-scale");
    expect(advice?.line).toContain("is not a rate this book carries");
  });

  it("questions a 0% rate and offers the rate on file", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    const r = await say(engine, "0%", modifyContext);
    const advice = adviceOn(r).find((a) => a.rule === "rate-off-the-scale");
    expect(advice?.line).toContain("prices the facility at nothing");
  });

  it("questions a commitment off the package's own scale", async () => {
    const engine = modifyEngine();
    await say(engine, "increase the line of credit", modifyContext);
    const r = await say(engine, "999999999999", modifyContext);
    const advice = adviceOn(r).find((a) => a.rule === "commitment-off-the-scale");
    expect(advice?.line).toContain("times the $23M this package carries in total");
  });
});

describe("A. modification: a loose figure after an answer is not a dead end (3.k)", () => {
  /* SUPERSEDED, ON THE FOUNDER'S OWN DOCTRINE (0.9.19 "a correction supersedes",
     carried into D3 2026-09-13). This used to assert the dead end: the loose
     figure was refused and the banker was told to remove the entry and say it
     again. A correction is one gesture, not three, so the figure now lands on
     the member the room is standing on and the manifest says what it replaced.
     The assertion is stronger for it: the change is real and it is said. */
  it("takes the correction onto the member the room is standing on", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    await say(engine, "7%", modifyContext);
    const after = await say(engine, "actually 8%", modifyContext);
    const deltas = after.deltas ?? [];
    expect(after.kind).toBe("deltas");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].title).toContain("Interest rate");
    expect(deltas[0].after).toContain("8%");
    expect(deltas[0].target).toContain("Line of Credit");
  });
});

/* ================================================================= B. RENEWAL */

describe("B. renewal: the same guarantees", () => {
  it("leads with the current commitment, rate and maturity (B3)", async () => {
    const engine = renewEngine();
    const opened = await say(engine, "renew the line of credit", renewContext);
    expect(opened.reply).toContain("$15M committed");
    expect(opened.reply).toContain("7.6%");
    expect(opened.reply).toContain("matures Mar 15, 2027");
  });

  it("names what it heard on a miss rather than repeating the question (B4)", async () => {
    const engine = renewEngine();
    const asked = await say(engine, "change the rate on the line of credit", renewContext);
    const missed = await say(engine, "asdf", renewContext);
    expect(missed.reply).not.toBe(asked.reply);
    expect(missed.reply).toContain('I heard "asdf"');
  });

  it("keeps the pending question alive through a blank line (B4)", async () => {
    const engine = renewEngine();
    await say(engine, "change the rate on the line of credit", renewContext);
    await say(engine, "   ", renewContext);
    const answered = await say(engine, "7.25%", renewContext);
    expect(answered.kind).toBe("deltas");
    expect(wireOf(answered)).toEqual([{ key: "requestedRate", value: 7.25, facilityId: LINE_ID }]);
  });

  it("computes a relative repricing off the rate on file (B2)", async () => {
    const engine = renewEngine();
    await say(engine, "change the rate on the line of credit", renewContext);
    const r = await say(engine, "add 50bps", renewContext);
    expect(wireOf(r)).toEqual([{ key: "requestedRate", value: 8.1, facilityId: LINE_ID }]);
  });

  it("refuses to hold the maturity, and hands back the real dates (B2)", async () => {
    const engine = renewEngine();
    await say(engine, "change the maturity on the line of credit", renewContext);
    const held = await say(engine, "keep", renewContext);
    expect(held.reply).toContain("holding it is the one answer this room cannot file");
    expect(held.options?.map((o) => o.label)).toContain("+12 months (Mar 15, 2028)");
  });
});

/* ============================================================ C. NEW FACILITY */

describe("C. new facility: a chip answers the question it is printed under", () => {
  const armCtx = (line: string) => ({ line, mode: "modify" as const, members: [] as ElicitMember[], staged: 0, generatedAt: "2026-09-12T08:00:00Z" });

  it("reads its own purpose chip onto the org value the chip is named for (row 5)", () => {
    // THE BREAK: "Business credit line increase" carries "credit line" inside
    // it, and a first-match scan read the room's own chip onto the PLAIN credit
    // line. The card then asserted the wrong coded value back to the banker.
    expect(readPurposeValue("business credit line increase")).toBe("business_credit_line_increase");
    expect(readPurposeValue("business credit line")).toBe("business_credit_line");
  });

  it("does not let a purpose chip rename the product the banker already set (row 5)", () => {
    const seeded = "add a new heloc loan of $3,000,000 with a 36 month term";
    const purposeAsk = readNewFacility(armCtx(seeded));
    expect(purposeAsk?.kind).toBe("ask");
    const chip = purposeAsk?.kind === "ask" ? purposeAsk.options?.find((o) => o.label === "Equipment") : undefined;
    expect(chip).toBeDefined();
    // THE BREAK: the whole sentence is re-read every turn, so "for equipment"
    // was read back as the PRODUCT and the HELOC silently became an Equipment
    // loan under the banker.
    const back = readNewFacility(armCtx(chip!.say));
    expect(back?.kind === "ask" ? back.text : "").toContain("heloc");
    expect(readProduct("add a new heloc loan for equipment")).toBe("Equipment");
  });
});

/* ================== D. COVENANT REVIEW / COLLATERAL VALUATION (relationship) */

function relCtx(over: { covenants?: unknown[]; collateral?: unknown[] } = {}): RelContext {
  const bundle = {
    snapshot: { accountId: "001X", name: "Testco", productPackageId: PACKAGE_ID, primaryRiskRating: "4" },
    exposure: {
      totalCommitted: 18_400_000,
      facilities: [
        {
          loanId: "0Cb1",
          status: "Active",
          productPackageId: PACKAGE_ID,
          committed: 10_000_000,
          collateral: over.collateral ?? [
            { collateralId: "a35A", collateralName: "COL-000762", collateralType: "Equipment", collateralValue: 4_000_000 },
          ],
        },
      ],
    },
    covenants: {
      covenants: over.covenants ?? [
        {
          covenantId: "cov1",
          covenantType: "Debt Service Coverage",
          latestComplianceStatus: "Non-Compliant",
          actualValue: 1.05,
          thresholdValue: 1.25,
        },
      ],
    },
  } as unknown as BorrowerBundle;
  const data360 = {
    meta: { generatedAt: "2026-08-31", userId: "005bb000001AAAAAAA" },
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return relContextFor({ data: data360, bundle, accountId: "001X", accountName: "Testco" });
}

describe("D. covenant review: the test leads with where it stands", () => {
  it("puts the current value against the threshold in the first question the banker reads", () => {
    // The governance signal pre-seeds `covenants`, so the assessment ask IS the
    // opening line of the room. It used to carry no figure at all while the
    // room held the rail two questions away.
    const step = nextStep("covenant", relCtx(), { covenants: ["cov1"] } as Answers);
    expect(step?.key).toBe("covenantStatuses.cov1");
    expect(step?.ask).toMatch(/^The Debt Service Coverage reads /);
    expect(step?.ask).toContain("1.05");
    expect(step?.ask).toContain("1.25");
    expect(step?.ask).toContain("How does the Debt Service Coverage test assess?");
  });

  it("takes no view on how a breach assesses, because no band grounds one", () => {
    const step = nextStep("covenant", relCtx(), { covenants: ["cov1"] } as Answers);
    expect(step?.options?.some((o) => o.onFile)).toBeFalsy();
  });
});

describe("D. collateral valuation: the figure and the date on file lead", () => {
  it("states the date on file rather than asking for a date cold", () => {
    const ctx = relCtx();
    const a = { records: ["a35A"], recordValues: { a35A: 4_000_000 } } as unknown as Answers;
    const step = nextStep("valuation", ctx, a);
    expect(step?.key).toBe("valuationDate");
    expect(step?.ask).toContain("As of what date was this one struck?");
  });

  it("says the book carries no value rather than putting a blank form up", () => {
    const ctx = relCtx({ collateral: [{ collateralId: "a35B", collateralDescription: "Receivables", collateralType: "Accounts Receivable" }] });
    const step = nextStep("valuation", ctx, { records: ["a35B"] } as Answers);
    expect(step?.key).toBe("recordValues.a35B");
    expect(step?.ask).toContain("The book carries no value for Receivables");
  });
});

describe("D. a question with no legal answer is refused up front, not asked", () => {
  it("refuses the valuation route when the package pledges nothing, and names the way on", () => {
    const ctx = relCtx({ collateral: [] });
    // THE BREAK: the route was not blocked, so "Which collateral are we
    // valuing?" went out as a chooser with no options, no skip and no escape.
    const block = relRouteBlock("valuation", ctx);
    expect(block).toContain("pledges no collateral");
    expect(block).toContain("I can put a new asset onto the relationship");
    expect(nextStep("valuation", ctx, {})).toBeNull();
  });

  it("refuses the covenant route when nothing on the package is assessable, and names the way on", () => {
    const ctx = relCtx({ covenants: [] });
    const block = relRouteBlock("covenant", ctx);
    expect(block).toContain("no covenant this room can assess");
    expect(block).toContain("I can put a new covenant onto the relationship");
    expect(nextStep("covenant", ctx, {})).toBeNull();
  });
});

describe("D. relationship intake: a handoff is said once, not forever", () => {
  /** An account carrying one actively pledged asset and one that is not, which
   *  is what puts the "new asset, or one the book already holds" chooser up. */
  function intakeCtx(): RelContext {
    const bundle = {
      snapshot: { accountId: "001X", name: "Testco", productPackageId: PACKAGE_ID },
      graph: { connections: [], legalEntities: [{ accountName: "Testco" }] },
      covenants: { covenants: [] },
      exposure: {
        facilities: [
          { loanId: "0Cb1", status: "Active", collateral: [{ collateralId: "a341", collateralType: "Equipment", collateralDescription: "CNC line" }] },
          {
            loanId: "0Cb2",
            status: "Active",
            collateral: [
              { collateralId: "a342", collateralType: "UCC-Accounts", collateralDescription: "All present and future accounts receivable.", pledgedStatus: "Inactive" },
            ],
          },
        ],
      },
    } as unknown as BorrowerBundle;
    const data360 = { meta: { generatedAt: "2026-08-31" } } as unknown as C360Data;
    return relContextFor({ data: data360, bundle, accountId: "001X", accountName: "Testco" });
  }

  it("does not put the same handoff paragraph up again once it has been read", () => {
    const ctx = intakeCtx();
    const a = { intakeKind: "collateral" } as unknown as Answers;
    const chooser = nextStep("intake", ctx, a)!;
    expect(chooser.key).toBe("colExisting.0");
    const existing = chooser.options!.find((o) => o.value.startsWith("existing:"))!;
    (a as Record<string, unknown>).colExisting = { "0": existing.value };

    expect(nextStep("intake", ctx, a)!.key).toBe("colExistingHandoff");
    (a as Record<string, unknown>).colExistingHandoff = "understood";
    // THE BREAK: this step re-read `colExisting.0`, which never changes, so it
    // came back identically for every line the banker typed after it and the
    // route could never reach ready.
    expect(nextStep("intake", ctx, a)).toBeNull();
  });
});

/* ============================================================= cross-cutting */

describe("cross-cutting: the voice of every sentence this audit added", () => {
  const sentences: string[] = [];
  it("collects and checks them", async () => {
    const engine = modifyEngine();
    await say(engine, "change the rate on the line of credit", modifyContext);
    sentences.push((await say(engine, "asdf", modifyContext)).reply);
    sentences.push((await say(engine, "   ", modifyContext)).reply);
    sentences.push((await say(engine, "-5%", modifyContext)).reply);

    const amount = modifyEngine();
    await say(amount, "increase the line of credit", modifyContext);
    sentences.push((await say(amount, "-4,000,000", modifyContext)).reply);

    const valuation = relCtx({ collateral: [] });
    sentences.push(relRouteBlock("valuation", valuation)!);
    sentences.push(relRouteBlock("covenant", relCtx({ covenants: [] }))!);
    sentences.push(nextStep("covenant", relCtx(), { covenants: ["cov1"] } as Answers)!.ask);

    for (const s of sentences) {
      expect(s, s).not.toMatch(/[—–]/); // no em or en dash
      expect(s, s).not.toMatch(/!/);
      expect(s, s).not.toMatch(/iris/i);
      expect(s, s).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
