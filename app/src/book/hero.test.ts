import { describe, expect, it } from "vitest";
import { covenantLabel, covenantValue, heroOf, shortName } from "./hero";
import type { BorrowerBundle } from "../data/contract";

const NOW = Date.UTC(2026, 8, 9);

const hartwell: BorrowerBundle = {
  snapshot: { accountId: "H", name: "Hartwell Precision Manufacturing LLC", primaryRiskRating: "4", primaryStage: "Booked", totalCreditExposure: 54_000_000 },
  exposure: {
    totalCommitted: 57_000_000, totalOutstanding: 38_700_000, totalAvailable: 18_300_000, coverageRatio: 1.09, uniqueCollateralCount: 7,
    facilities: [
      { name: "LoC", stage: "Booked", status: "Open", committed: 15_000_000, outstanding: 9_200_000 },
      { name: "Construction", stage: "Booked", status: "Open", committed: 12_000_000, outstanding: 7_350_000 },
      { name: "Equipment proposal", stage: "Proposal", status: "Open", committed: 3_000_000, outstanding: 0 },
    ],
  },
  covenants: { covenants: [
    { covenantType: "Debt Service Coverage of Borrower", thresholdValue: 1.25, actualValue: 1.38, lastEvaluationStatus: "Compliant", daysUntilNextEvaluation: 27 },
    { covenantType: "Fixed Charge Coverage", thresholdValue: 1.15, actualValue: 1.22, lastEvaluationStatus: "Compliant", daysUntilNextEvaluation: 27 },
    { covenantType: "Maximum Debt to Worth", thresholdValue: 3.0, actualValue: 2.42, lastEvaluationStatus: "Compliant", daysUntilNextEvaluation: 27 },
    { covenantType: "Minimum Liquidity", thresholdValue: 5_000_000, actualValue: 6_200_000, lastEvaluationStatus: "Compliant", daysUntilNextEvaluation: 27 },
    { covenantType: "Term Covenants", covenantStatus: "In Progress", daysUntilNextEvaluation: 59 },
  ] },
};

describe("shortName", () => {
  it("drops the legal suffix and keeps what a banker says", () => {
    expect(shortName("Hartwell Precision Manufacturing LLC")).toBe("Hartwell");
    expect(shortName("Blue Ridge Orthopedic Partners PC")).toBe("Blue Ridge");
    expect(shortName("Prairie Ag Holdings LP")).toBe("Prairie Ag");
    expect(shortName("Piedmont Precision Components, Inc.")).toBe("Piedmont");
    expect(shortName("Sunbelt Hospitality Group Inc")).toBe("Sunbelt");
    expect(shortName(undefined)).toBe("The relationship");
  });
});

describe("covenant reading", () => {
  it("labels and formats in the covenant's own unit", () => {
    expect(covenantLabel("Debt Service Coverage of Borrower")).toBe("DSC");
    expect(covenantLabel("Debt Service Coverage with and without Distributions")).toBe("DSC (dist.)");
    expect(covenantLabel("Maximum Debt to Worth")).toBe("D/W");
    expect(covenantValue("Debt Service Coverage", 1.38)).toBe("1.38×");
    expect(covenantValue("Minimum Liquidity", 6_200_000)).toBe("$6.2M");
    expect(covenantValue("Minimum Liquidity", 1_180_000)).toBe("$1.18M");
    expect(covenantValue("Loan to Value", 72.1)).toBe("72.1%");
    expect(covenantValue("Accounts Receivable", 80)).toBe("80%");
  });
});

describe("heroOf", () => {
  it("is null until the bundle can say what the relationship carries", () => {
    expect(heroOf(null)).toBeNull();
    expect(heroOf({ snapshot: { accountId: "X", name: "X Co" } })).toBeNull();
  });

  it("writes the position from the exposure read, states the BOOKED committed, and names the unbooked apart", () => {
    const h = heroOf(hartwell, NOW)!;
    expect(h.verdict).toContain("Booked at Grade 4, Hartwell carries $54.0M committed across 2 facilities with $38.7M drawn and $15.3M of headroom, plus $3.0M unbooked;");
    expect(h.verdict).toContain("4 of 5 covenants test compliant (FCC 1.22×, DSC 1.38×).");
  });

  it("calls the tight covenant the figure to watch when nothing is in exception or overdue", () => {
    const h = heroOf(hartwell, NOW)!;
    expect(h.verdict).toMatch(/Collateral coverage sits at 1\.09× across 7 pledged assets, so FCC at 1\.22× against a 1\.15× floor is the figure to watch\.$/);
    expect(h.anchors.map((a) => a.label)).toEqual(["Rating", "Committed", "FCC", "DSC"]);
    expect(h.anchors[0]).toEqual({ label: "Rating", value: "Grade 4", sub: "Booked", dir: null });
    expect(h.anchors[1]).toEqual({ label: "Committed", value: "$54.0M", sub: "$38.7M drawn", dir: null });
    expect(h.anchors[2]).toEqual({ label: "FCC", value: "1.22×", sub: "Floor 1.15× tight", dir: "down" });
    expect(h.anchors[3]).toEqual({ label: "DSC", value: "1.38×", sub: "Floor 1.25×", dir: null });
  });

  it("puts an exception first, in the sentence and on the chips", () => {
    const sunbelt: BorrowerBundle = {
      snapshot: { accountId: "S", name: "Sunbelt Hospitality Group Inc", primaryRiskRating: "6", primaryStage: "Booked" },
      exposure: { totalCommitted: 38_500_000, totalOutstanding: 34_700_000, coverageRatio: 0.97, uniqueCollateralCount: 6, facilities: [] },
      covenants: { covenants: [
        { covenantType: "Loan to Value", thresholdValue: 70, actualValue: 72.1, lastEvaluationStatus: "Exception", breached: true },
        { covenantType: "Debt Service Coverage of Borrower", thresholdValue: 1.25, actualValue: 1.31, lastEvaluationStatus: "Compliant" },
      ] },
    };
    const h = heroOf(sunbelt, NOW)!;
    expect(h.verdict).toContain("1 of 2 covenants test compliant (LTV 72.1% in exception, DSC 1.31×).");
    expect(h.verdict).toMatch(/LTV sits in exception at 72\.1% against 70%, so that is the figure to clear first; collateral coverage sits at 0\.97× across 6 pledged assets\.$/);
    expect(h.anchors[2]).toEqual({ label: "LTV", value: "72.1%", sub: "Ceiling 70% exception", dir: "down" });
  });

  it("names an overdue test by its days, from the next evaluation date when the org gives no count", () => {
    const blueRidge: BorrowerBundle = {
      snapshot: { accountId: "B", name: "Blue Ridge Orthopedic Partners PC", primaryRiskRating: "4", primaryStage: "Booked" },
      exposure: { totalCommitted: 27_750_000, totalOutstanding: 24_600_000, coverageRatio: 1.14, uniqueCollateralCount: 7, facilities: [] },
      covenants: { covenants: [
        { covenantType: "Debt Service Coverage of Borrower", thresholdValue: 1.25, actualValue: 1.42, lastEvaluationStatus: "Compliant", nextEvaluationDate: "2026-08-20" },
      ] },
    };
    const h = heroOf(blueRidge, NOW)!;
    expect(h.verdict).toContain("Blue Ridge carries $27.75M committed with $24.6M drawn and $3.15M of headroom; 1 of 1 covenant test compliant (the DSC test 20 days overdue).");
    expect(h.verdict).toContain("The DSC test is 20 days overdue, so the file, not the figures, is what needs attention; collateral coverage sits at 1.14× across 7 pledged assets.");
    expect(h.anchors[2]).toEqual({ label: "DSC", value: "1.42×", sub: "Floor 1.25× overdue 20d", dir: "down" });
    expect(h.anchors[3].label).toBe("Coverage");
  });

  it("says a clean book is clean, and falls back to snapshot totals when there is no exposure read yet", () => {
    const h = heroOf({ snapshot: { accountId: "C", name: "Cascade Software Solutions Inc", primaryRiskRating: "5", totalCreditExposure: 19_950_000, totalOutstanding: 17_000_000 } }, NOW)!;
    expect(h.verdict).toBe("Booked at Grade 5, Cascade carries $19.95M committed with $17.0M drawn and $2.95M of headroom; no covenants are attached at the relationship level. With no covenant package attached, the facilities themselves are the whole story.");
    expect(h.anchors.map((a) => a.label)).toEqual(["Rating", "Committed", "Headroom"]);
  });
});
