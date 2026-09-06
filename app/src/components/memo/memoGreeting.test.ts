/* =============================================================================
   WHAT THE ROOM SAYS IT IS STANDING ON.

   The memo room's one non-negotiable is that it states what was DONE to the
   relationship, from the org, so any viewer opening it later reads the same
   change list as the banker who filed it (requirements, 2026-09-04). This is
   the test of that sentence: the trail's own steps become the memo's changes,
   the greeting states them, and where the trail carries no steps the room says
   so rather than drafting quietly on nothing.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import type { ActionHistoryRow, ActionStep } from "../../data/contract";
import type { RenderPlan } from "../../memo/renderMemo";
import {
  changesFromSteps,
  executedRead,
  memoGreeting,
  parseOrgNumber,
  planLine,
  shortDate,
  NO_STEP_DETAIL,
  MEMO_ACTION_IDS,
} from "./memoGreeting";

const PACKAGE = "a5Fbb000000IHFJEA4";

const PLAN: RenderPlan = {
  modules: [
    { id: "executive_summary", name: "Executive Summary", on: true, reason: "always" },
    { id: "collateral", name: "Collateral", on: true, reason: "always" },
  ],
  suppressed: [{ id: "syndications", name: "Syndications", on: false, reason: "is_syndicated" }],
};

/** The shape the org hands back for Hartwell's curated new-facility row. */
const STEPS: ActionStep[] = [
  {
    id: "write_loan",
    type: "write",
    label: "Book the $3.0M equipment term loan",
    objectName: "LLC_BI__Loan__c",
    targetLabel: "Equipment term loan",
    field: "LLC_BI__Amount__c",
    after: "3000000",
    state: "verified",
    verification: "Customer360Exposure returned the new facility a4Zbb000002CECXEA4",
    orgRecordId: "a4Zbb000002CECXEA4",
  },
  {
    id: "wait_loan_detail",
    type: "wait",
    label: "Wait for the loan detail record",
    objectName: "LLC_BI__Loan_Detail__c",
    state: "verified",
    orgRecordId: "a4Wbb000001KM0bEAG",
  },
  {
    id: "hop_to_proposal",
    type: "handoff",
    label: "Move the package to Proposal",
    state: "verified",
  },
  {
    id: "write_amount",
    type: "write",
    label: "Increase the line of credit to $15.0M",
    objectName: "LLC_BI__Loan__c",
    targetLoanId: "a4Zbb0000027MaYEAU",
    targetLabel: "Line of Credit",
    field: "LLC_BI__Amount__c",
    before: "$12,000,000",
    after: "$15,000,000",
    state: "verified",
    verification: "Customer360Exposure returned committed 15000000",
    orgRecordId: "a4Zbb0000027MaYEAU",
  },
  {
    id: "write_maturity",
    type: "write",
    label: "Extend the maturity to 30 Jun 2029",
    objectName: "LLC_BI__Loan__c",
    targetLoanId: "a4Zbb0000027MaYEAU",
    targetLabel: "Line of Credit",
    field: "LLC_BI__Maturity_Date__c",
    before: "2027-06-30",
    after: "2029-06-30",
    state: "verified",
  },
  {
    id: "write_fee",
    type: "write",
    label: "A pricing row nCino refused",
    objectName: "LLC_BI__Pricing__c",
    targetLoanId: "a4Zbb0000027MaYEAU",
    field: "LLC_BI__Fee__c",
    after: "25000",
    state: "failed",
  },
];

const row = (over: Partial<ActionHistoryRow> = {}): ActionHistoryRow => ({
  stagingId: "a8abb00001NL6ZUAA1",
  actionId: "new-facility-request",
  status: "Completed",
  executedAt: "2026-09-03T14:02:00Z",
  productPackageId: PACKAGE,
  accountId: "001bb00001I7FPNAA3",
  steps: STEPS,
  stepCount: STEPS.length,
  changeCounts: { requested: 4, derived: 2 },
  ...over,
});

describe("the trail's steps, as the memo's change list", () => {
  it("groups the field-level steps by the facility they touched", () => {
    const changes = changesFromSteps(STEPS);
    // Two targets wrote: the new facility, and the line of credit.
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.target.name)).toEqual(["Equipment term loan", "Line of Credit"]);
  });

  it("merges the fields of one facility into one before and one after", () => {
    const loc = changesFromSteps(STEPS)[1];
    expect(loc.before).toEqual({ commitment: 12_000_000, maturity: "2027-06-30" });
    expect(loc.after).toEqual({ commitment: 15_000_000, maturity: "2029-06-30" });
    expect(loc.target.id).toBe("a4Zbb0000027MaYEAU");
  });

  it("leaves a created facility's before ABSENT, which is how the dossier knows it is new", () => {
    const created = changesFromSteps(STEPS)[0];
    expect(created.before).toBeUndefined();
    expect(created.after).toEqual({ commitment: 3_000_000 });
  });

  it("carries the org's own verification and record id, verbatim", () => {
    const changes = changesFromSteps(STEPS);
    expect(changes[0].orgId).toBe("a4Zbb000002CECXEA4");
    expect(changes[0].verification).toContain("Customer360Exposure returned the new facility");
  });

  it("drops the plan's machinery and anything that did not land", () => {
    const labels = changesFromSteps(STEPS).map((c) => c.label);
    expect(labels.join(" ")).not.toContain("Wait for the loan detail");
    expect(labels.join(" ")).not.toContain("Move the package to Proposal");
    // A failed write is not a change; the line of credit still carries its two
    // landed fields and nothing of the refused pricing row.
    expect(changesFromSteps(STEPS)[1].after).not.toHaveProperty("LLC_BI__Fee__c");
  });

  it("keeps every step of a plan that declares no types at all", () => {
    const untyped: ActionStep[] = [{ id: "s1", label: "Something the plan did", targetLabel: "LoC", after: "1" }];
    expect(changesFromSteps(untyped)).toHaveLength(1);
  });

  it("reads the org's printed figures, and keeps what it cannot read under its own field name", () => {
    expect(parseOrgNumber("$15,000,000")).toBe(15_000_000);
    expect(parseOrgNumber("7.5MM")).toBe(7_500_000);
    expect(parseOrgNumber("Booked")).toBeNull();
    const odd = changesFromSteps([
      { id: "s", type: "write", label: "Rate", targetLoanId: "L1", field: "LLC_BI__Amount__c", after: "prime + 250bps" },
    ]);
    expect(odd[0].after).toEqual({ LLC_BI__Amount__c: "prime + 250bps" });
  });
});

describe("which row a memo reads", () => {
  it("takes the newest completed credit action on this package", () => {
    const read = executedRead([row()], PACKAGE);
    expect(read.hasSteps).toBe(true);
    expect(read.split).toEqual({ requested: 4, derived: 2 });
  });

  it("ignores an executed action a memo is not written about", () => {
    const read = executedRead([row({ actionId: "collateral-valuation" })], PACKAGE);
    expect(read.row).toBeNull();
    expect(read.hasSteps).toBe(false);
    expect([...MEMO_ACTION_IDS]).toEqual(["loan-modification", "renewal", "new-facility-request"]);
  });

  it("ignores another package's row when the room is anchored", () => {
    expect(executedRead([row({ productPackageId: "a5Fother" })], PACKAGE).row).toBeNull();
  });

  it("prefers the newest row that CARRIES steps over a newer bare one", () => {
    const bare = row({ stagingId: "a8new", executedAt: "2026-09-04T08:00:00Z", steps: undefined, stepCount: undefined });
    const read = executedRead([bare, row()], PACKAGE);
    expect(read.row?.stagingId).toBe("a8abb00001NL6ZUAA1");
  });

  it("says when the per-row cap trimmed the plan", () => {
    const read = executedRead([row({ stepCount: 91 })], PACKAGE);
    expect(read.trimmed).toBe(91);
  });
});

describe("the greeting", () => {
  const base = { packageId: PACKAGE, trigger: "modify" as const, plan: PLAN, hasStoredMemo: false, carried: null };

  it("states the executed changes when the trail carries steps", () => {
    const g = memoGreeting({ ...base, executed: executedRead([row()], PACKAGE) });
    expect(g.fromOrg).toBe(true);
    expect(g.lead).toContain("Since the last memo on version a5Fbb000…");
    expect(g.lead).toContain("a new facility filed 3 Sep");
    expect(g.lead).toContain("6 changes: 4 requested, 2 derived");
    expect(g.lead).toContain("Drafting the memo for that version");
  });

  /* THE HANDOVER LEADS WHERE THERE IS ONE (founder, 2026-09-06). A room opened by
     a finale is standing on a filing that happened seconds ago, and the trail read
     that would confirm it has not come back yet - or comes back carrying the
     PREVIOUS filing on this package. The greeting names the version and the lines
     on its first commit, from what the sheet handed over. */
  const FILED = {
    title: "Filed on Hartwell Precision Manufacturing LLC, C&I Credit Package, version a5Fbb000000J61hEAC",
    version: "a5Fbb000000J61hEAC",
    kind: "modify" as const,
    items: [
      { id: "c1", label: "Commitment amount", target: "Line of Credit", before: "$15,000,000", after: "$18,000,000" },
      { id: "c2", label: "Maturity date", target: "Line of Credit", before: "30 Jun 2026", after: "30 Jun 2027" },
    ],
    exposureBefore: "$46.0M",
    exposureAfter: "$49.0M",
    pending: true,
  };

  it("leads on the version the finale filed, over the trail's own account of it", () => {
    const g = memoGreeting({ ...base, executed: executedRead([row()], PACKAGE), filed: FILED });
    expect(g.lead).toBe(
      "Drafting the memo for version a5Fbb000000J61hEAC: 2 changes filed on this package a moment ago.",
    );
    /* AND IT SAYS IT ONCE. The filed lines and the exposure are drawn above this
       as the room's first timeline row; a greeting that listed them again would
       be the same facts twice on one screen. */
    expect(g.lines).toHaveLength(0);
  });

  it("falls back to the package's own name where the org returned no version", () => {
    const g = memoGreeting({
      ...base,
      packageName: "Hartwell C&I Credit Package",
      executed: executedRead([], PACKAGE),
      filed: { ...FILED, version: null },
    });
    expect(g.lead).toContain("for version Hartwell C&I Credit Package");
  });

  it("reads the org when no finale handed anything over, which is every other door", () => {
    const g = memoGreeting({ ...base, executed: executedRead([row()], PACKAGE), filed: null });
    expect(g.fromOrg).toBe(true);
    expect(g.lead).toContain("Since the last memo");
  });

  it("says the honest line and works from the handover when the trail carries no steps", () => {
    const executed = executedRead([row({ steps: undefined, stepCount: undefined, changeCounts: undefined })], PACKAGE);
    const g = memoGreeting({
      ...base,
      executed,
      carried: [{ id: "c1", label: "Increase the line", target: { kind: "facility" } }],
      carriedSplit: { requested: 1, derived: 0 },
    });
    expect(g.fromOrg).toBe(false);
    expect(g.lead).toContain("Working from what this session just filed on version a5Fbb000…: 1 change");
  });

  it("says the honest line and states the package as it stands when nothing was handed over", () => {
    const g = memoGreeting({ ...base, executed: executedRead([], PACKAGE) });
    expect(g.lead).toContain(NO_STEP_DETAIL);
    expect(g.lead).toContain("as booked");
  });

  it("says the package by its org name when the host knows it", () => {
    const g = memoGreeting({ ...base, packageName: "Hartwell Industrial C&I Credit Package", executed: executedRead([row()], PACKAGE) });
    expect(g.lead).toContain("Since the last memo on Hartwell Industrial C&I Credit Package");
    expect(g.lead).not.toContain("a5Fbb000");
  });

  it("keeps to the founder's budget: one lead line and at most four under it", () => {
    const g = memoGreeting({ ...base, executed: executedRead([row({ stepCount: 91 })], PACKAGE) });
    expect(g.lines.length).toBeGreaterThan(0);
    expect(g.lines.length).toBeLessThanOrEqual(4);
    expect(g.lines.some((l) => l.startsWith("Render plan:"))).toBe(false);
    expect(g.ask).toBe("Draft it, or steer me first?");
  });

  it("offers the stored memo only when there is one", () => {
    const without = memoGreeting({ ...base, executed: executedRead([row()], PACKAGE) });
    expect(without.chips.map((c) => c.id)).toEqual(["draft", "steer"]);
    const withOne = memoGreeting({ ...base, hasStoredMemo: true, executed: executedRead([row()], PACKAGE) });
    expect(withOne.chips.map((c) => c.id)).toEqual(["draft", "steer", "open"]);
  });

  it("counts the render plan and never lists the suppressed modules in the line", () => {
    expect(planLine(PLAN)).toBe("Render plan: 2 modules on, 1 suppressed by the deal's own flags.");
    expect(planLine({ modules: PLAN.modules, suppressed: [] })).toContain("nothing suppressed");
    expect(planLine(PLAN)).not.toContain("Syndications");
  });

  it("writes a date the way a banker says one, and nothing at all without a stamp", () => {
    expect(shortDate("2026-09-03T14:02:00Z")).toBe("3 Sep");
    expect(shortDate(undefined)).toBeUndefined();
  });
});
