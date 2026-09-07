import { describe, expect, it } from "vitest";
import { packageJoinability, packageStageBeforeApproval } from "./packageStage";
import type { BorrowerBundle, Facility } from "./contract";

/* =============================================================================
   THE ONE EXCEPTION TO THE NEW-PACKAGE RULE.

   FOUNDER, 2026-09-06: "you can add to product packages which are NOT approved
   (i.e. loans in pre-approval stages), of course not to the booked packages."

   Every stage string below is the ORG'S OWN, off
   `knowledge/sf-build-v2/field-inventory-20260831.json`. That is what these
   tests are really guarding: not the branching, which is four lines, but the
   sets. A wrong string here files a facility onto a booked package.
   ============================================================================= */

const PACKAGE = "a5Fbb000000IHFJEA4";
const OTHER = "a5Fbb000000J6BNEA0";

function facility(over: Partial<Facility> = {}): Facility {
  return { loanId: `l${Math.random()}`, productPackageId: PACKAGE, stage: "Proposal", status: "Active", committed: 1_000_000, ...over };
}

function bundle(over: { stage?: string; primaryStage?: string; facilities?: Facility[]; packageId?: string | null }): BorrowerBundle {
  return {
    snapshot: {
      accountId: "001bb00001I7FPNAA3",
      name: "Hartwell Precision Manufacturing LLC",
      productPackageId: over.packageId === null ? undefined : (over.packageId ?? PACKAGE),
      packageStage: over.stage,
      primaryStage: over.primaryStage,
    },
    exposure: { facilities: over.facilities ?? [facility()] },
  } as BorrowerBundle;
}

const verdict = (b: BorrowerBundle, id = PACKAGE) => packageJoinability(b).find((p) => p.id === id)!;

describe("the package stage picklists, as the org holds them", () => {
  it("takes the two managed values before Complete, and refuses Complete", () => {
    // LLC_BI__Product_Package__c.LLC_BI__Stage__c: Pending, In Review, Complete.
    expect(packageStageBeforeApproval("Pending")).toBe(true);
    expect(packageStageBeforeApproval("In Review")).toBe(true);
    expect(packageStageBeforeApproval("Complete")).toBe(false);
  });

  it("takes the three local values before Credit Decisioning, and refuses the rest", () => {
    // cm_Credit_Stage__c: Application, Credit Underwriting, Final Review,
    // Credit Decisioning, Approved, Fulfillment, Booked. Approval starts at
    // Credit Decisioning, which is where the answer is given.
    expect(packageStageBeforeApproval("Application")).toBe(true);
    expect(packageStageBeforeApproval("Credit Underwriting")).toBe(true);
    expect(packageStageBeforeApproval("Final Review")).toBe(true);
    expect(packageStageBeforeApproval("Credit Decisioning")).toBe(false);
    expect(packageStageBeforeApproval("Approved")).toBe(false);
    expect(packageStageBeforeApproval("Fulfillment")).toBe(false);
    expect(packageStageBeforeApproval("Booked")).toBe(false);
  });

  it("refuses a stage it cannot place, and an absent one", () => {
    // The org's picklists are all `restrictedPicklist: false`, so a value the
    // API accepted is not proof of a value the cockpit understands.
    expect(packageStageBeforeApproval("Superseded")).toBe(false);
    expect(packageStageBeforeApproval("")).toBe(false);
    expect(packageStageBeforeApproval(null)).toBe(false);
    expect(packageStageBeforeApproval(undefined)).toBe(false);
  });
});

describe("which packages a new facility may join", () => {
  it("offers a package that is before approval and holds nothing booked", () => {
    const out = verdict(bundle({ stage: "In Review", facilities: [facility({ stage: "Proposal" })] }));
    expect(out.joinable).toBe(true);
    expect(out.stage).toBe("In Review");
  });

  it("reads the local stage where the managed one is not staged, because the deployed read returns it", () => {
    // Customer360Snapshot.cls returns cm_Credit_Stage__c as `primaryStage`;
    // refusing to read it would make the rule blind on the whole shipped book.
    const out = verdict(bundle({ primaryStage: "Credit Underwriting", facilities: [facility({ stage: "Qualification" })] }));
    expect(out.joinable).toBe(true);
  });

  it("refuses a package holding a Booked facility, whatever its own stage says", () => {
    const out = verdict(bundle({ stage: "In Review", facilities: [facility({ stage: "Proposal" }), facility({ stage: "Booked" })] }));
    expect(out.joinable).toBe(false);
    expect(out.reason).toContain("booked, complete or closed");
  });

  it("refuses a package holding a Complete facility", () => {
    expect(verdict(bundle({ stage: "Pending", facilities: [facility({ stage: "Complete" })] })).joinable).toBe(false);
  });

  it("refuses a package holding a facility that is no longer active", () => {
    expect(verdict(bundle({ stage: "Pending", facilities: [facility({ stage: "Proposal", status: "Paid Out" })] })).joinable).toBe(false);
  });

  it("refuses a package whose own stage is past approval", () => {
    const out = verdict(bundle({ stage: "Complete", facilities: [facility({ stage: "Proposal" })] }));
    expect(out.joinable).toBe(false);
    expect(out.reason).toContain("not a pre-approval stage");
  });

  it("FAILS CLOSED where a facility carries no stage at all", () => {
    // `stage` is additive on the exposure read: absent is "not staged in this
    // view", which cannot be told apart from Booked from here.
    const out = verdict(bundle({ stage: "In Review", facilities: [facility({ stage: undefined })] }));
    expect(out.joinable).toBe(false);
  });

  it("FAILS CLOSED where the read carries no stage for the package", () => {
    const out = verdict(bundle({ facilities: [facility({ stage: "Proposal" })] }));
    expect(out.joinable).toBe(false);
    expect(out.reason).toContain("does not carry this package's own stage");
  });

  it("answers for the primary package only, because the snapshot is one record", () => {
    /* THE BUNDLE STAGES ONE PACKAGE STAGE, and it is the primary's. A second
       package on the relationship therefore has no stage this cockpit can read,
       and an unreadable stage is a no. */
    const two = bundle({
      stage: "In Review",
      facilities: [facility({ stage: "Proposal" }), facility({ productPackageId: OTHER, stage: "Proposal" })],
    });
    expect(verdict(two, PACKAGE).joinable).toBe(true);
    expect(verdict(two, OTHER).joinable).toBe(false);
    expect(verdict(two, OTHER).reason).toContain("does not carry this package's own stage");
  });

  it("reads a lone package as the primary even where the snapshot does not name its id", () => {
    // Hartwell's own snapshot names no `productPackageId`; `primaryStage` is
    // still the highest-TCE package's, which on a one-package book is that one.
    const lone = bundle({ packageId: null, primaryStage: "Application", facilities: [facility({ stage: "Qualification" })] });
    expect(verdict(lone).joinable).toBe(true);
  });

  it("says nothing about a relationship the read says nothing about", () => {
    expect(packageJoinability(null)).toEqual([]);
  });
});
