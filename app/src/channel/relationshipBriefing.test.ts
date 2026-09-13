import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle, C360Data, Covenant } from "../data/contract";
import type { RelRoute } from "../components/relationship/relRoute";
import {
  briefingItemSentence,
  buildBriefing,
  covenantMeaning,
  valuationBasisMeaning,
  type Briefing,
  type BriefingItem,
} from "./relationshipBriefing";

/* =============================================================================
   THE BRIEFING, ON THE BOOK THE COCKPIT ACTUALLY OPENS ON.

   FOUNDER, 2026-09-13: "it says there is a covenant test due or a collateral
   valuation, but what does that really mean, what does the room need from me
   and why, and it should pull in information from all sorts of information from
   the relationship."

   Everything below is measured against `artifact/live-data.json`: the real
   Hartwell read (six covenants, seven distinct collateral records, Boom FY2023
   to LTM, five filed actions) for depth, and the other four baked relationships
   for the property that matters more than any single sentence: the builder
   never throws and never invents, and an empty lane comes back as a gap.
   ============================================================================= */

const data = live as unknown as C360Data;
const asOf = data.meta.generatedAt;
const HARTWELL = "001bb00001I7FPNAA3";
const hartwell = (data.borrowers ?? {})[HARTWELL] as BorrowerBundle;

const ROUTES: Array<RelRoute | null> = ["covenant", "valuation", "annual", "rating", "service", null];

/** Every sentence the banker reads, in one array. */
function sentencesOf(b: Briefing): string[] {
  return [
    b.opening,
    ...b.due.map(briefingItemSentence),
    ...b.changedSince.map((c) => c.sentence),
    ...b.needs.flatMap((n) => [n.ask, n.why]),
    ...b.committee,
    ...b.gaps,
  ];
}

const dscr = (b: Briefing): BriefingItem =>
  b.due.find((i) => i.what.includes("Debt Service Coverage of Borrower")) as BriefingItem;

/* ------------------------------------------------------------ the covenant */

describe("the covenant review briefing on Hartwell", () => {
  const briefing = buildBriefing("covenant", hartwell, { asOf });

  it("names the threshold and the measured figure with its source and its date", () => {
    const item = dscr(briefing);
    expect(item.threshold).toBe("≥ 1.25×");
    expect(item.measured).toBe("1.38×");
    expect(item.measuredSource).toBe("nCino's own evaluation on the compliance row");
    expect(item.measuredAsOf).toBe("Jul 15, 2026");
    expect(item.nextTest).toBe("Sep 30, 2026, in 36 days");
    expect(briefingItemSentence(item)).toContain("It is measured against ≥ 1.25×.");
    expect(briefingItemSentence(item)).toContain("reads 1.38× as at Jul 15, 2026");
  });

  it("says what the covenant TESTS, which is the thing the read does not carry", () => {
    expect(dscr(briefing).meansSentence).toContain("principal and interest falling due in the period");
    const liquidity = briefing.due.find((i) => i.what.includes("Minimum Liquidity")) as BriefingItem;
    expect(liquidity.meansSentence).toContain("floor under cash and equivalents");
  });

  it("names the facilities AND the packages the covenant is associated with", () => {
    const item = dscr(briefing);
    expect(item.associations.some((a) => a.includes("Purchase") && a.includes("$6.50M committed"))).toBe(true);
    expect(item.associations.some((a) => a.includes("credit package"))).toBe(true);
    // The exposure and the coverage behind the facility travel with it.
    expect(item.associations.join(" ")).toContain("$6.34M drawn");
    expect(item.associations.join(" ")).toContain("coverage 0.99×");
  });

  it("shows an account-level covenant as relationship scope, not as an unattached one", () => {
    const worth = briefing.due.find((i) => i.what.includes("Maximum Debt to Worth")) as BriefingItem;
    expect(worth.associations[0]).toContain("the relationship as a whole");
    expect(worth.associations.filter((a) => a.includes("credit package"))).toHaveLength(2);
  });

  it("carries at least one change since the last test, from a named lane and a named source", () => {
    expect(briefing.changedSince.length).toBeGreaterThan(0);
    for (const change of briefing.changedSince) {
      expect(change.source.trim().length).toBeGreaterThan(0);
      expect(change.sentence.trim().length).toBeGreaterThan(0);
    }
    const lanes = new Set(briefing.changedSince.map((c) => c.lane));
    // Not one lane restated: the spread, the book and the trail all reach it.
    expect(lanes.size).toBeGreaterThanOrEqual(3);
    const financials = briefing.changedSince.find((c) => c.lane === "financials");
    expect(financials?.source).toBe("Boom, Hartwell_Precision_FY2025_LTM.xlsx");
    expect(financials?.sentence).toContain("FY2025 $63.80M");
    const trail = briefing.changedSince.find((c) => c.lane === "trail");
    expect(trail?.sentence).toContain("Aug 25, 2026");
  });

  it("asks for what it needs and says why", () => {
    expect(briefing.needs.length).toBeGreaterThan(0);
    for (const need of briefing.needs) {
      expect(need.ask.trim().length).toBeGreaterThan(0);
      expect(need.why.trim().length).toBeGreaterThan(0);
    }
    const certificate = briefing.needs.find((n) => n.ask.includes("compliance certificate"));
    expect(certificate).toBeDefined();
    expect(certificate?.why).toContain("No spread measures");
    const verdict = briefing.needs.find((n) => n.ask.startsWith("Decide the verdict"));
    expect(verdict?.why).toContain("Pending");
    expect(verdict?.why).toContain("exception on the committee's list");
  });

  it("says what the committee will ask without passing a policy verdict", () => {
    expect(briefing.committee.length).toBeGreaterThan(0);
    expect(briefing.committee.length).toBeLessThanOrEqual(2);
    expect(briefing.committee[0]).toContain("The committee will ask about Accounts Receivable");
    expect(briefing.committee[0]).toContain("inside a tenth of it");
    // The post-read's guard: no view on policy, comfort or approval.
    const POLICY = /\b(policy|acceptable|adequate|comfortable|recommend|approve|should|strong|weak|prudent|healthy)\b/i;
    for (const line of briefing.committee) expect(line).not.toMatch(POLICY);
  });

  it("names the inbox gap rather than filling it", () => {
    expect(briefing.gaps.join(" | ")).toContain("no inbox rows are loaded");
    const searched = buildBriefing("covenant", hartwell, { asOf, inbox: [] });
    expect(searched.gaps.join(" | ")).toContain("the inbox search returned no rows");
    const loaded = buildBriefing("covenant", hartwell, {
      asOf,
      inbox: [{ id: "m1", subject: "Q3 shipping schedule", preview: "nothing to do with the credit", from: "ops@hartwell.com" }],
    });
    expect(loaded.gaps.join(" | ")).toContain("the compliance certificate is not among the 1 inbox row");
  });

  it("names the covenants it cannot describe and the threshold it does not hold", () => {
    const term = briefing.due.find((i) => i.what.includes("Term Covenants")) as BriefingItem;
    expect(term.meansSentence).toBe("");
    expect(term.threshold).toBeNull();
    expect(briefing.gaps.join(" | ")).toContain("the read does not say what Term Covenants covenant tests");
    expect(briefing.gaps.join(" | ")).toContain("Term Covenants covenant carries no threshold on this read");
  });

  it("states no trend where the book carries one measurement, and says so", () => {
    for (const item of briefing.due) expect(item.trend).toBeNull();
    expect(briefing.gaps.join(" | ")).toContain("no second measurement is carried for these tests");
  });

  it("reads a trend where a SECOND measurement of the same thing exists", () => {
    /* THE FOUNDER'S OWN SENTENCE ("the cushion has thinned by 0.11x"), built on
       a bundle whose Boom set publishes the measure the covenant tests. The
       baked book carries no such pair, which is why the gap above is the honest
       answer there and this is the proof the path works. */
    const covenant: Covenant = {
      covenantId: "cov-lev",
      covenantType: "Maximum Total Leverage",
      thresholdValue: 4,
      actualValue: 3.5,
      lastEvaluationStatus: "Compliant",
      lastEvaluationDate: "2026-03-31",
      nextEvaluationDate: "2026-09-30",
      attachedLoans: [],
    };
    const bundle = {
      snapshot: { accountId: "a", name: "Levered Co" },
      covenants: { covenants: [covenant] },
      boom: {
        ratios: { revenue: 100, totalLeverage: 3.8 },
        spread: { sourceFile: "Levered_FY2025.xlsx", periods: [{ period: "FY2025", revenue: 100 }] },
      },
    } as unknown as BorrowerBundle;
    const item = buildBriefing("covenant", bundle, { asOf }).due[0];
    expect(item.trend).toBe(
      "The last test read 3.50× and the FY2025 spread Boom, Levered_FY2025.xlsx holds 3.80×, so the cushion has thinned by 0.30×.",
    );
  });
});

/* ----------------------------------------------------------- the valuation */

describe("the collateral valuation briefing on Hartwell", () => {
  const briefing = buildBriefing("valuation", hartwell, { asOf });
  const equipment = briefing.due.find((i) => i.what.startsWith("COL-000764")) as BriefingItem;

  it("names the asset, the basis of value and the lendable figure with its date", () => {
    expect(equipment.what).toBe("COL-000764, UCC-Equipment");
    expect(equipment.meansSentence).toContain("An orderly liquidation value is what a managed sale would realise");
    expect(equipment.threshold).toBe("a 75% advance rate, pledge override");
    expect(equipment.measured).toBe("$7.50M of lendable value");
    expect(equipment.measuredSource).toBe("Customer360Exposure");
    expect(equipment.measuredAsOf).toBe("Apr 30, 2026");
    expect(equipment.lastVerdict).toContain("CV-0000000011");
    expect(equipment.nextTest).toBe("Apr 30, 2027");
  });

  it("carries the pledges across facilities and packages, with the coverage on each", () => {
    // COL-000764 is cross-pledged to two Equipment facilities: ONE item, two pledges.
    expect(equipment.associations.filter((a) => a.startsWith("the Equipment"))).toHaveLength(2);
    expect(equipment.associations.join(" ")).toContain("coverage 1.00×");
    expect(equipment.associations.join(" ")).toContain("coverage 0.53×");
    expect(equipment.associations.some((a) => a.includes("credit package"))).toBe(true);
    // Seven distinct records, never ten pledge rows.
    expect(briefing.due).toHaveLength(7);
  });

  it("states the coverage the org computed and never one of its own", () => {
    const collateral = briefing.changedSince.filter((c) => c.lane === "collateral");
    expect(collateral[0].sentence).toContain("nCino computes relationship coverage at 1.09×");
    expect(collateral[0].source).toBe("Customer360Exposure");
    const needs = briefing.needs.map((n) => `${n.ask} ${n.why}`).join(" | ");
    expect(needs).toContain("cannot compute the one after it until a figure exists");
  });

  it("names a passed revaluation date and asks about it", () => {
    const overdue = briefing.changedSince.find((c) => c.sentence.includes("past their next revaluation date"));
    expect(overdue?.sentence).toContain("COL-000762 since Jul 31, 2026");
    expect(briefing.needs.some((n) => n.ask.includes("COL-000762"))).toBe(true);
    expect(briefing.committee[0]).toContain("The committee will ask");
  });

  it("says an asset was never READ rather than never valued", () => {
    const unvalued = briefing.due.find((i) => i.what.startsWith("COL-000773")) as BriefingItem;
    expect(unvalued.lastVerdict).toContain("no read looked and never that it was never valued");
    expect(briefing.gaps.join(" | ")).toContain("no basis of value is on this read for COL-000773");
  });
});

/* ---------------------------------------------------- the other three routes */

describe("the annual, risk-rating and service briefings on Hartwell", () => {
  it("the annual review states the year on the relationship", () => {
    const b = buildBriefing("annual", hartwell, { asOf });
    const item = b.due[0];
    expect(item.what).toBe("The annual review of Hartwell Precision Manufacturing LLC");
    expect(item.measured).toBe("$57M committed");
    expect(item.measuredSource).toBe("Customer360Exposure");
    expect(item.nextTest).toBe("Dec 1, 2026, in 98 days");
    expect(item.associations[0]).toBe("9 active facilities and 6 covenants");
    const lanes = new Set(b.changedSince.map((c) => c.lane));
    expect(lanes.has("financials")).toBe(true);
    expect(lanes.has("exposure")).toBe(true);
    expect(lanes.has("collateral")).toBe(true);
    expect(b.needs.some((n) => n.why.includes("Hartwell_Precision_FY2025_LTM.xlsx"))).toBe(true);
  });

  it("the risk-rating review reads the org's grade and computes none", () => {
    const b = buildBriefing("rating", hartwell, { asOf });
    const item = b.due[0];
    expect(item.measured).toBe("4");
    expect(item.measuredSource).toBe("The nCino risk grade on Customer360Snapshot");
    expect(item.meansSentence).toContain("it computes no grade of its own");
    expect(item.associations[0]).toContain("graded 4, 5");
    // The drivers arrive from the lanes that move a grade.
    const lanes = b.changedSince.map((c) => c.lane);
    expect(lanes).toContain("signals");
    expect(lanes).toContain("financials");
    expect(b.needs[0].ask).toContain("against the 4 the org carries");
  });

  it("the service request names what is open, and says so when nothing is", () => {
    const none = buildBriefing("service", hartwell, { asOf });
    expect(none.due).toHaveLength(0);
    expect(none.gaps.join(" | ")).toContain("no inbound client request is on this relationship");
    expect(none.needs[0].why).toContain("No inbound ask is on this read");

    const sterling = (data.borrowers ?? {})["001SAMPLE0000STRL"] as BorrowerBundle;
    const open = buildBriefing("service", sterling, { asOf });
    expect(open.due).toHaveLength(1);
    expect(open.due[0].measured).toContain("$13M asked for");
    expect(open.due[0].associations[0]).toContain("Working Capital Revolver");
  });

  it("the neutral opening leads on the clock that runs out first", () => {
    const b = buildBriefing(null, hartwell, { asOf });
    expect(b.opening).toContain("before you choose a review");
    expect(b.due[0].what).toContain("Accounts Receivable");
    expect(b.due[1].what).toContain("the next maturity on the relationship");
    expect(b.due[1].nextTest).toBe("Mar 15, 2027, in 202 days");
    expect(b.needs[0].ask).toBe("Pick the review you are running on this relationship.");
  });
});

/* -------------------------------------------------------- the golden rule */

describe("the golden-rule scan", () => {
  it("never writes an em dash on any route of any relationship", () => {
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        for (const said of sentencesOf(buildBriefing(route, bundle as BorrowerBundle, { asOf }))) {
          expect(said).not.toContain("—");
          expect(said).not.toContain("–");
        }
      }
    }
  });

  /* NOTHING SAID TWICE, read the way the founder meant it. A CLAUSE can
     legitimately coincide between two items: two assets carrying the same
     advance rate, two facilities with the same coverage note. What must never
     repeat is a whole paragraph, a sentence inside one paragraph, or a sentence
     across the sections that speak once about the relationship. */
  const split = (text: string): string[] =>
    text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 24);

  it("never repeats a paragraph, and never repeats a sentence inside one", () => {
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        const briefing = buildBriefing(route, bundle as BorrowerBundle, { asOf });
        const paragraphs = briefing.due.map(briefingItemSentence);
        expect(new Set(paragraphs).size).toBe(paragraphs.length);
        for (const paragraph of paragraphs) {
          const said = split(paragraph);
          expect(new Set(said).size).toBe(said.length);
        }
      }
    }
  });

  it("never repeats a sentence across the sections that speak once", () => {
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        const b = buildBriefing(route, bundle as BorrowerBundle, { asOf });
        const once = [
          b.opening,
          ...b.changedSince.map((c) => c.sentence),
          ...b.needs.flatMap((n) => [n.ask, n.why]),
          ...b.committee,
          ...b.gaps,
        ].flatMap(split);
        expect(new Set(once).size).toBe(once.length);
      }
    }
  });

  it("explains a measure once, and points the second test at the first", () => {
    const covenant = buildBriefing("covenant", hartwell, { asOf });
    const first = covenant.due.find((i) => i.what.includes("Debt Service Coverage of Borrower")) as BriefingItem;
    const second = covenant.due.find((i) => i.what.includes("with and without Distributions")) as BriefingItem;
    expect(first.meansSentence).toContain("principal and interest falling due");
    expect(second.meansSentence).toBe(
      "It measures what the Debt Service Coverage of Borrower covenant measures, against its own threshold and on its own facility.",
    );
  });

  it("never states a measured figure without a source and a date", () => {
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        for (const item of buildBriefing(route, bundle as BorrowerBundle, { asOf }).due) {
          if (item.measured === null) {
            expect(item.measuredSource).toBeNull();
            expect(item.measuredAsOf).toBeNull();
            continue;
          }
          expect(item.measuredSource).not.toBeNull();
          // A date the read does not carry is SAID, never quietly dropped.
          const sentence = briefingItemSentence(item);
          if (item.measuredAsOf === null) expect(sentence).toContain("on a date this read does not carry");
          else expect(sentence).toContain(`as at ${item.measuredAsOf}`);
        }
      }
    }
  });

  it("gives every change a lane and a source", () => {
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        for (const change of buildBriefing(route, bundle as BorrowerBundle, { asOf }).changedSince) {
          expect(change.lane.length).toBeGreaterThan(0);
          expect(change.source.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("passes no policy verdict in the committee lines, on any relationship", () => {
    const POLICY = /\b(policy|acceptable|adequate|comfortable|comfortably|recommend|recommended|approve|approval|should|strong|weak|prudent|healthy|satisfactory|robust|concerning)\b/i;
    for (const bundle of Object.values(data.borrowers ?? {})) {
      for (const route of ROUTES) {
        for (const line of buildBriefing(route, bundle as BorrowerBundle, { asOf }).committee) {
          expect(line).not.toMatch(POLICY);
          expect(line.startsWith("The committee will ask")).toBe(true);
        }
      }
    }
  });

  it("names a cut rather than dropping a change silently", () => {
    const briefing = buildBriefing(null, hartwell, { asOf });
    expect(briefing.changedSince.length).toBeLessThanOrEqual(9);
    expect(briefing.gaps[0]).toMatch(/^\d+ further changes? on the .*lanes?, which sits? on the relationship tabs$/);
    // The gap is a NOUN PHRASE: the component reads the list out after one lead.
    for (const gap of briefing.gaps) expect(gap[0]).toBe(gap[0].toLowerCase());
  });
});

/* ------------------------------------------------ the rest of the book */

describe("the other four baked relationships", () => {
  const others = Object.entries(data.borrowers ?? {}).filter(([id]) => id !== HARTWELL);

  it("covers Piedmont, Brightwater, Sterling and Kingsley", () => {
    expect(others.map(([, b]) => (b as BorrowerBundle).snapshot.name).sort()).toEqual([
      "Brightwater Foods Group",
      "Kingsley Precision Works",
      "Piedmont Precision Components, Inc.",
      "Sterling Fabrication Co.",
    ]);
  });

  it("never throws on any route", () => {
    for (const [, bundle] of others) {
      for (const route of ROUTES) {
        expect(() => buildBriefing(route, bundle as BorrowerBundle, { asOf })).not.toThrow();
        expect(() => buildBriefing(route, bundle as BorrowerBundle, { asOf, inbox: [], history: [] })).not.toThrow();
      }
    }
  });

  it("turns an empty lane into a gap and never into a fact", () => {
    for (const [, raw] of others) {
      const bundle = raw as BorrowerBundle;
      const briefing = buildBriefing("valuation", bundle, { asOf });
      if (!(bundle.collateralValuations ?? []).length) {
        expect(briefing.gaps.join(" | ")).toContain("no valuation read is staged on this bundle");
        for (const item of briefing.due) expect(item.measuredAsOf).toBeNull();
      }
      const lanes = new Set(briefing.changedSince.map((c) => c.lane));
      if (!(bundle.activity ?? []).length) expect(lanes.has("trail")).toBe(false);
      if (!bundle.boom) expect(lanes.has("financials")).toBe(false);
    }
  });

  it("survives a relationship the read staged nothing for", () => {
    const empty = buildBriefing("covenant", { snapshot: { accountId: "x" } } as BorrowerBundle, { asOf });
    expect(empty.due).toHaveLength(0);
    expect(empty.changedSince).toHaveLength(0);
    expect(empty.committee).toHaveLength(0);
    expect(empty.opening).toContain("this relationship");
    expect(empty.gaps.length).toBeGreaterThan(0);
    expect(() => buildBriefing(null, null, { asOf })).not.toThrow();
    expect(buildBriefing(null, null, { asOf }).gaps[0]).toContain("no relationship is staged on this read");
  });
});

/* ------------------------------------------------------- the vocabularies */

describe("the vocabularies refuse what they do not know", () => {
  it("describes a covenant only where the vocabulary reaches it", () => {
    expect(covenantMeaning("Debt Service Coverage Ratio")).toContain("principal and interest");
    expect(covenantMeaning("Fixed Asset Purchases")).toContain("fixed assets");
    expect(covenantMeaning("Term Covenants")).toBe("");
    expect(covenantMeaning(undefined)).toBe("");
  });

  it("reads a debt service test as debt service and not as a distributions cap", () => {
    expect(covenantMeaning("Debt Service Coverage with and without Distributions")).toBe(
      covenantMeaning("Debt Service Coverage Ratio"),
    );
  });

  it("describes a basis of value only where the picklist word is one it knows", () => {
    expect(valuationBasisMeaning("Orderly Liquidation Value")).toContain("managed sale");
    expect(valuationBasisMeaning("Fair Market Value - Real Estate")).toContain("willing buyer");
    expect(valuationBasisMeaning("Balance Sheet")).toContain("own reported figure");
    expect(valuationBasisMeaning("Some Basis Nobody Defined")).toBe("");
    expect(valuationBasisMeaning(null)).toBe("");
  });
});
