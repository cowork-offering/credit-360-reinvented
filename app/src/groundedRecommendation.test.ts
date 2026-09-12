import { describe, expect, it } from "vitest";
import { ALWAYS_BLOCK_IDS, DOCTRINE_BLOCKS, RECOMMEND_ONLY_WHEN_GROUNDED } from "./channel/doctrine";
import { ON_FILE_RECOMMENDATION, nextStep, relContextFor } from "./components/relationship/reviewFlows";
import { SKIPPED } from "./components/relationship/relStep";
import type { C360Data } from "./data/contract";
import live from "../../artifact/live-data.json";

/* =============================================================================
   DOCTRINE C — RECOMMEND ONLY WHAT IS ALREADY GROUNDED (founder, 2026-09-12).

   "The room recommends ONLY when the recommendation is already grounded — a
   figure on file, or a doctrine band — and it says which it is. It never invents
   a number or a default it cannot trace to the book or to doctrine; where
   nothing is grounded it states the current figure and the options and stays
   silent on preference."  (knowledge/CHAT-GOLDEN-RULE.md, rule 2.)

   SO HALF OF THIS SUITE ASSERTS AN ABSENCE, and that half is the important
   half. A recommendation that appears where nothing grounds it is the failure
   this doctrine exists to prevent, and it is the failure a suite that only
   checked for presence would never catch.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const PACKAGE = "a5Fbb000000IHFJEA4";
const bundle = () => data.borrowers![HARTWELL];

const ctx = () =>
  relContextFor({
    data,
    bundle: bundle(),
    accountId: HARTWELL,
    accountName: bundle().snapshot!.name!,
    productPackageId: PACKAGE,
  });

describe("the two grounded asks say 'use it', with the figure on file beside them", () => {
  it("the covenant's observed figure leads, is recommended, and the alternative stands", () => {
    const c = ctx();
    const picker = nextStep("covenant", c, {})!;
    const first = picker.options![0].value;
    const status = nextStep("covenant", c, { covenants: [first] })!;
    expect(status.key).toBe(`covenantStatuses.${first}`);
    const figure = nextStep("covenant", c, { covenants: [first], covenantStatuses: { [first]: "Compliant" } })!;
    expect(figure.key).toBe(`covenantObservedValues.${first}`);

    // THE FIGURE IS THE READ'S OWN. It is printed in the covenant's own unit by
    // the same rail the card renders, and it is a real figure off the book.
    const measured = bundle().covenants!.covenants!.find((x) => x.covenantId === first)!.actualValue;
    expect(typeof measured).toBe("number");
    // The rail as the card prints it: the observed figure against its threshold.
    expect(figure.ask).toBe(
      `The read carries 80% vs ≤ 80% on the Accounts Receivable. ${ON_FILE_RECOMMENDATION} File that figure, or give me the certificate's own.`,
    );
    // The grounded recommendation, verbatim, and the option it points at.
    expect(figure.ask).toContain(ON_FILE_RECOMMENDATION);
    expect(figure.ask).toContain("File that figure, or give me the certificate's own.");
    expect(figure.options).toHaveLength(1);
    expect(Number(figure.options![0].value)).toBe(measured);
    // A CHIP, NEVER A PRE-FILLED ANSWER. Nothing is recorded until the banker
    // takes it, which is the second half of rule C.
    expect(figure.options![0].onFile).toBe(true);
  });

  it("the valuation's value ask leads with the appraisal on file, its date, and 'use it'", () => {
    const c = ctx();
    const picker = nextStep("valuation", c, {})!;
    const asset = picker.options![0].value;
    const ask = nextStep("valuation", c, { records: [asset] })!;
    expect(ask.key).toBe(`recordValues.${asset}`);
    // The figure on the book, and when it was last struck: both on the ask.
    expect(ask.ask).toMatch(/carries \$[\d.,]+[KM]? on the book/);
    expect(ask.ask).toMatch(/last valued \w+ \d{1,2}, \d{4}|with no valuation on file/);
    expect(ask.ask).toContain(ON_FILE_RECOMMENDATION);
    expect(ask.ask).toContain("File that figure, or give me the new one.");
    expect(ask.options).toHaveLength(1);
    expect(Number(ask.options![0].value)).toBeGreaterThan(0);
    // Still the banker's answer: offered, never written for them.
    expect(ask.optional).toBeUndefined();
  });

  it("says nothing about a preference where the read carries no figure at all", () => {
    /* A covenant the org holds no actual for. The ask degrades to the bare
       question, and the recommendation goes with the figure that grounded it. */
    const b = bundle();
    const blind = {
      ...b,
      covenants: {
        covenants: [{ covenantId: "cov-blind", covenantType: "Minimum Liquidity", latestComplianceStatus: "Pending" }],
      },
    } as unknown as typeof b;
    const c = relContextFor({ data, bundle: blind, accountId: HARTWELL, accountName: "Hartwell", productPackageId: PACKAGE });
    const ask = nextStep("covenant", c, { covenants: ["cov-blind"], covenantStatuses: { "cov-blind": "Compliant" } })!;
    expect(ask.key).toBe("covenantObservedValues.cov-blind");
    expect(ask.ask).toBe("What figure was tested on the Minimum Liquidity?");
    expect(ask.ask).not.toContain(ON_FILE_RECOMMENDATION);
    expect(ask.options).toBeUndefined();
  });
});

/* ---------------------------------------------------------------- the absences

   WHERE NOTHING IN THIS CODEBASE GROUNDS A PREFERENCE, NOTHING IS SAID.

   THE RATING ASKS. Verified against the source: this org states four grade
   surfaces that do not agree (facility 0-15, package 1-10, review 1-12, rating
   review unbounded) and NO band for any of them. `RISK_GRADE_SCALE` is a bound,
   not a recommendation, and the `risk-rating` doctrine block names the
   interagency categories and the downgrade triggers and no target grade. So the
   four factor asks and the grade ask lead with the closest figure the read
   carries and stop there.

   THE RENEWAL MATURITY. The only tenor language in the codebase is one line of
   the `credit-policy` doctrine block ("revolver tenor 3 years or less; general
   machinery and equipment 7 years or less; owner-occupied CRE 25 year
   amortization with a balloon at 5 to 10 years"). Those are CAPS, keyed to
   product words this engine does not carry: it holds nCino's `productType`
   ("Non-Real Estate") and a product name, and nothing in this repo maps one to
   the other. Naming a standard tenor off that would invent both the mapping and
   the figure, so the renewal offers +12, +24 and +36 months and recommends
   none. `renewEngine.ts` says so at `maturityChips`.                          */

describe("no recommendation appears where nothing grounds one", () => {
  it("the four rating factors lead with the closest figure and recommend nothing", () => {
    const c = ctx();
    const answers: Record<string, unknown> = {};
    const asks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const step = nextStep("rating", c, answers)!;
      asks.push(step.ask);
      answers[step.key] = SKIPPED;
    }
    // The scored factor leads with the covenant that measures the same thing,
    // NAMED as the covenant's figure rather than offered as a rating input.
    expect(asks[0]).toContain("The closest figure the read carries is the Debt Service Coverage of Borrower test at");
    for (const ask of asks) {
      expect(ask).not.toContain(ON_FILE_RECOMMENDATION);
      expect(ask).not.toMatch(/I would|you should|recommend|suggest|typically|usually|standard/i);
    }
  });

  it("the grade ask states the grade on file and takes no view on the next one", () => {
    const c = ctx();
    const answers: Record<string, unknown> = {
      cashFlowCoverage: SKIPPED,
      revenueGrowth: SKIPPED,
      managementExperience: SKIPPED,
      creditScore: SKIPPED,
    };
    const grade = nextStep("rating", c, answers)!;
    expect(grade.key).toBe("computedRiskGradeValue");
    expect(grade.ask).toContain(`The grade on file is ${bundle().snapshot!.primaryRiskRating}, on the relationship.`);
    expect(grade.ask).not.toContain(ON_FILE_RECOMMENDATION);
    expect(grade.ask).not.toMatch(/I would|recommend|suggest/i);
  });

  // The renewal maturity ask is held to the same absence in
  // `workroom/renewEngine.test.ts`, beside the engine's own fixture.
});

describe("the doctrine states rule C to the model, verbatim", () => {
  const always = DOCTRINE_BLOCKS.filter((b) => ALWAYS_BLOCK_IDS.includes(b.id))
    .flatMap((b) => b.lines)
    .join("\n");

  it("travels on every reply, in the always-on blocks", () => {
    expect(always).toContain(RECOMMEND_ONLY_WHEN_GROUNDED);
  });

  it("names the two groundings, requires the model to say which, and forbids the rest", () => {
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain("ALREADY GROUNDED");
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain("a figure on file in CONTEXT, or a band stated in this doctrine");
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain("Say which of the two it is");
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain(
      "Where neither is there, give the figure on file and the real options and say nothing about which you would take",
    );
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain("Never invent a number or a default");
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).toContain("a chip the banker takes, never an answer already filled in");
    // House style, on the rule that will be read out most often.
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).not.toContain("—");
    expect(RECOMMEND_ONLY_WHEN_GROUNDED).not.toContain("!");
  });
});
