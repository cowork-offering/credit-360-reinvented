import { describe, expect, it } from "vitest";
import {
  forkTargetVersion,
  lockedInFlightVersion,
  lockedSourcePackage,
  MODIFICATION_IN_PROGRESS,
  packagePick,
  packageRoster,
} from "./packages";
import { heroOf } from "./hero";
import { APPROVAL_STAGE, atOrPastApproval, stageRung } from "../data/facilityStage";
import type { BorrowerBundle, Facility } from "../data/contract";

/* =============================================================================
   THE THREE STATES OF A MODIFICATION, AGAINST THE LIVE ORG'S OWN VOCABULARY.

   Spec: knowledge/PACKAGE-LIFECYCLE-SPEC.md. Every stage word and every archival
   status below was READ from bankinggpt-at on 2026-09-12, not assumed:

     the ladder    `LLC_BI__Stage__c` is an eleven-value picklist, in order:
                   Qualification, Proposal, Credit Underwriting, Final Review,
                   Approval / Loan Committee, Processing, Doc Prep, Closing,
                   Boarding, Booked, Complete.

     the fork      Hartwell (001bb00001I7FPNAA3) carries a real one today.
                   Package a5Fbb000000JFzREAW holds two Qualification loans, both
                   `LLC_BI__Is_Modification__c = true`, copied from the two
                   Booked loans on a5Fbb000000J6BNEA0, whose own
                   `LLC_BI__hasRenewal__c` is true. The Purchase facility was
                   renamed $6,500,000.00 -> $12,000,000.00 by the filing.

     the archive   A superseded original carries `LLC_BI__Status__c = Superseded`
                   (a4Zbb000000xU0eEAE, Stage Complete); a discarded modification
                   carries `Withdrawn` (a4Zbb000000zbkDEAQ). Neither value is in
                   the field's active picklist, so both arrive as free text.

   The fixture below is Hartwell's live shape, at the cockpit's own contract.
   ============================================================================= */

const ACCOUNT = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000J6BNEA0";
const VERSION = "a5Fbb000000JFzREAW";

const loan = (over: Partial<Facility>): Facility => ({
  status: "Open",
  productPackageId: SOURCE,
  stage: "Booked",
  ...over,
});

/** The two booked members of the source package, at the org's own figures. */
const BOOKED_MEMBERS: Facility[] = [
  loan({ loanId: "a4Zbb000002ICnyEAG", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, outstanding: 900_000 }),
  loan({ loanId: "a4Zbb000002ICnxEAG", name: "Hartwell - Purchase - $6,500,000.00", committed: 6_500_000, outstanding: 4_000_000 }),
];

/** The forked copy: same names but for the facility the filing moved. */
const versionMembers = (stage = "Qualification"): Facility[] => [
  loan({ loanId: "a4Zbb000002KFD3EAO", name: "Hartwell - Equipment - $1,500,000.00", committed: 1_500_000, outstanding: 0, productPackageId: VERSION, stage }),
  loan({ loanId: "a4Zbb000002KFD4EAO", name: "Hartwell - Purchase - $12,000,000.00", committed: 12_000_000, outstanding: 0, productPackageId: VERSION, stage }),
];

function bundleOf(facilities: Facility[]): BorrowerBundle {
  const committed = facilities.reduce((s, f) => s + (f.committed ?? 0), 0);
  const outstanding = facilities.reduce((s, f) => s + (f.outstanding ?? 0), 0);
  return {
    snapshot: { accountId: ACCOUNT, name: "Hartwell Precision Manufacturing LLC", primaryRiskRating: "4", primaryStage: "Booked" },
    /* THE ORG'S OWN TOTAL, summed the way Customer360Exposure.cls:320 sums it:
       over every loan it returns, which is every loan whose status is not
       `Closed`. The version's members are in it. That is the read the cockpit
       has to correct, so the fixture must not correct it first. */
    exposure: { totalCommitted: committed, totalOutstanding: outstanding, facilities },
  };
}

/* ------------------------------------------------------------ the ladder */

describe("the nCino stage ladder, read off the org", () => {
  it("ranks by position, so approval is a rung and not a word", () => {
    expect(stageRung("Qualification")).toBe(0);
    expect(stageRung(APPROVAL_STAGE)).toBe(4);
    expect(stageRung("Booked")).toBe(9);
    expect(stageRung("Complete")).toBe(10);
  });

  it("does not rank a stage this org never names", () => {
    expect(stageRung("Underwriting")).toBe(-1);
    expect(stageRung(undefined)).toBe(-1);
    // Fail closed: an unknown stage is never CLAIMED to be past approval.
    expect(atOrPastApproval({ stage: "Underwriting" })).toBe(false);
    expect(atOrPastApproval({ stage: "Final Review" })).toBe(false);
    expect(atOrPastApproval({ stage: APPROVAL_STAGE })).toBe(true);
    expect(atOrPastApproval({ stage: "Doc Prep" })).toBe(true);
  });
});

/* ------------------------------------------ state 1: the fork, pre-approval */

describe("state 1 — a modification in flight", () => {
  const roster = packageRoster(bundleOf([...BOOKED_MEMBERS, ...versionMembers()]));
  const source = roster.find((p) => p.id === SOURCE)!;
  const version = roster.find((p) => p.id === VERSION)!;

  it("names the version and links it back to the booked package it forked", () => {
    expect(version.inFlightVersion).toBe(true);
    expect(version.committed).toBe(13_500_000);
    expect(source.hasInFlightModification).toBe(true);
    expect(source.inFlightVersionId).toBe(VERSION);
    expect(lockedSourcePackage(roster, SOURCE)?.id).toBe(SOURCE);
    expect(forkTargetVersion(roster, VERSION)?.id).toBe(VERSION);
  });

  it("keeps the version EDITABLE below the approval rung, and says so", () => {
    expect(version.inFlightEditable).toBe(true);
    expect(version.reason).toBe("Modification in flight · editable until approval · 2 facilities · $13.50M");
    expect(lockedInFlightVersion(roster, VERSION)).toBeNull();
  });

  it("hard-blocks the ORIGINAL in the modification flow, by name", () => {
    const pick = packagePick(source, "fork");
    expect(pick.blocked).toBe(true);
    expect(pick.line).toBe(`${MODIFICATION_IN_PROGRESS} · a version of this package is unbooked with the org`);
  });

  it("names the original without blocking it where the route forks nothing", () => {
    // A review and a new facility both leave the package alone (rule 2), so the
    // state is stated and the door stays open.
    for (const ask of ["review", "open"] as const) {
      const pick = packagePick(source, ask);
      expect(pick.blocked).toBe(false);
      expect(pick.line.startsWith(MODIFICATION_IN_PROGRESS)).toBe(true);
    }
  });

  it("refuses the VERSION as a fresh target, and as a room to review", () => {
    expect(packagePick(version, "fork").blocked).toBe(true);
    expect(packagePick(version, "review").blocked).toBe(true);
    // But the banker may walk back into their own pre-approval draft.
    expect(packagePick(version, "open").blocked).toBe(false);
  });
});

/* ----------------------------------- state 1b: the fork, once it is in approval */

describe("state 1b — the version reaches Approval / Loan Committee", () => {
  const roster = packageRoster(bundleOf([...BOOKED_MEMBERS, ...versionMembers(APPROVAL_STAGE)]));
  const version = roster.find((p) => p.id === VERSION)!;

  it("locks it: the org has taken it and the row says which", () => {
    expect(version.inFlightVersion).toBe(true);
    expect(version.inFlightEditable).toBe(false);
    expect(version.reason).toBe("Modification in flight · in approval · locked · 2 facilities · $13.50M");
    expect(lockedInFlightVersion(roster, VERSION)?.id).toBe(VERSION);
    expect(packagePick(version, "open").blocked).toBe(true);
  });

  it("takes ONE member past the rung to lock the whole version", () => {
    // The org approves a version, not a loan, so `some` is the right test.
    const mixed = versionMembers();
    mixed[1] = { ...mixed[1], stage: APPROVAL_STAGE };
    const one = packageRoster(bundleOf([...BOOKED_MEMBERS, ...mixed])).find((p) => p.id === VERSION)!;
    expect(one.inFlightEditable).toBe(false);
  });
});

/* ------------------------------ state 2 + 3: booked, archived, and the exposure */

describe("state 2 and 3 — the modification books and REPLACES what it superseded", () => {
  /* The org's shape after the booking run: the version's members are Booked and
     the originals carry the archival status the org writes on them. */
  const afterBooking = [
    ...BOOKED_MEMBERS.map((f) => ({ ...f, status: "Superseded", stage: "Complete" })),
    ...versionMembers("Booked"),
  ];
  const bundle = bundleOf(afterBooking);

  it("drops the archived originals from the roster entirely", () => {
    const roster = packageRoster(bundle);
    expect(roster.find((p) => p.id === SOURCE)).toBeUndefined();
    const live = roster.find((p) => p.id === VERSION)!;
    // Booked, so it is no longer a version in flight: it is the package now.
    expect(live.inFlightVersion).toBe(false);
    expect(live.booked).toBe(2);
    expect(live.committed).toBe(13_500_000);
  });

  it("counts the NEW set only: $12.0M, never $6.5M + $12.0M", () => {
    const hero = heroOf(bundle, Date.UTC(2026, 8, 12))!;
    // The org's own totalCommitted still carries both sets ($21.5M); the book
    // corrects it to the live $13.5M rather than repeating the double count.
    expect(bundle.exposure!.totalCommitted).toBe(21_500_000);
    expect(hero.anchors.find((a) => a.label === "Committed")!.value).toBe("$13.5M");
    expect(hero.verdict).toContain("carries $13.5M committed across 2 facilities");
    expect(hero.verdict).not.toContain("$21.5M");
  });

  it("counts the booked set only BEFORE the booking too: the fork never sums beside its source", () => {
    // Pre-booking, the version is an unbooked copy of the same two facilities.
    // Summing both is the same double count one stage earlier.
    const inFlight = bundleOf([...BOOKED_MEMBERS, ...versionMembers()]);
    const hero = heroOf(inFlight, Date.UTC(2026, 8, 12))!;
    expect(inFlight.exposure!.totalCommitted).toBe(21_500_000);
    expect(hero.anchors.find((a) => a.label === "Committed")!.value).toBe("$8.0M");
    expect(hero.verdict).toContain("plus $13.5M unbooked");
  });

  it("archives a DISCARDED modification the same way: Withdrawn never counts", () => {
    const discarded = bundleOf([
      ...BOOKED_MEMBERS,
      ...versionMembers("Complete").map((f) => ({ ...f, status: "Withdrawn" })),
    ]);
    expect(packageRoster(discarded).find((p) => p.id === VERSION)).toBeUndefined();
    expect(heroOf(discarded, Date.UTC(2026, 8, 12))!.anchors.find((a) => a.label === "Committed")!.value).toBe("$8.0M");
  });
});
