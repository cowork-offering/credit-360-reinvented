import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_VERSION_REASON,
  discardCounts,
  discardSummary,
  DISCARD_ACTION_ID,
  DISCARD_LABEL,
  DISCARD_LINE,
  groupInventory,
  inventoryRows,
  NO_VERSION_REASON,
  OTHER_GROUP_TITLE,
  STAGING_KEPT,
  whatStays,
} from "./discardVersion";
import { discardAvailability, discardTargetFor } from "./discardTarget";
import { ACTIONS_BY_ID } from "./registry";
import { PANEL_SCHEMAS } from "./schemas";
import { assertNoRecordIds, type StagedOutput } from "./stagedPlan";
import { DISCARD_VERSION_OBJECTS, validateDiscardPlan, validatePlan } from "./transitionAllowlist";
import { historyActivityEntry, versionDiscardedActivityEntry } from "./executedActivity";
import type { ExecuteResult } from "../channel/writeTools";
import { IN_APPROVAL_REFUSAL, packageRoster } from "../book/packages";
import type { BorrowerBundle, C360Data, Facility } from "../data/contract";
import live from "../../../artifact/live-data.json";

/* =============================================================================
   THE DISCARD DOOR, AGAINST HARTWELL'S OWN BOOK.

   The fixture is `artifact/live-data.json` with ONE fabricated in-flight
   version over it, built the way nCino builds one and the way the roster can
   see one: a member-for-member copy of the source package at Qualification,
   with the modified facility carrying the figure the filing renamed it to. The
   org's own verified fork of this package (2026-09-03, recorded in
   `book/packages.ts`) held seven Qualification loans against seven Booked ones
   and renamed exactly the facility the modification moved, which is what this
   reproduces.

   NOTHING HERE COMPOSES A DELETE SET. The inventory is the ORG's list, so every
   test that renders one hands it in as the tool would return it.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const SOURCE = "a5Fbb000000IHFJEA4";
const VERSION = "a5Fbb0000009TESTV1";

/** The clone of one booked member, at the stage a credit action leaves it. */
const cloneOf = (f: Facility, i: number, stage: string, rename?: string): Facility => ({
  ...f,
  loanId: `a4Zbb000009CLONE${i}`,
  name: rename ?? f.name,
  productPackageId: VERSION,
  stage,
  outstanding: 0,
});

/** Hartwell with one in-flight version of `a5Fbb000000IHFJEA4` over it. */
function forked(stage = "Qualification"): BorrowerBundle {
  const base = structuredClone(data.borrowers![HARTWELL]) as BorrowerBundle;
  const members = (base.exposure?.facilities ?? []).filter((f) => f.productPackageId === SOURCE);
  const clones = members.map((f, i) =>
    cloneOf(
      f,
      i,
      stage,
      // The filing renames the facility it moved: the $15M line went to $20M.
      f.committed === 15_000_000
        ? f.name?.replace("$15,000,000.00", "$20,000,000.00")
        : undefined,
    ),
  );
  base.exposure = { ...base.exposure, facilities: [...(base.exposure?.facilities ?? []), ...clones] };
  return base;
}

/** Hartwell exactly as the book holds it: booked, no version anywhere. */
const unforked = () => structuredClone(data.borrowers![HARTWELL]) as BorrowerBundle;

/* --------------------------------------------------------------- the gating */

describe("the door is offered only on the shapes that can carry it", () => {
  it("finds the version from the relationship, with the booked source beside it", () => {
    const target = discardTargetFor(forked(), null)!;
    expect(target.version.id).toBe(VERSION);
    expect(target.version.inFlightVersion).toBe(true);
    expect(target.version.inFlightEditable).toBe(true);
    expect(target.source?.id).toBe(SOURCE);
  });

  it("finds the same version from the booked source that names it", () => {
    expect(discardTargetFor(forked(), SOURCE)!.version.id).toBe(VERSION);
  });

  it("finds the same version from inside the version itself", () => {
    expect(discardTargetFor(forked(), VERSION)!.version.id).toBe(VERSION);
  });

  it("offers no door on a booked package with no version in flight", () => {
    expect(discardTargetFor(unforked(), SOURCE)).toBeNull();
    expect(discardAvailability([], null)).toEqual({ available: false, reason: NO_VERSION_REASON });
  });

  it("refuses a version the org has taken to approval, in the approval's own words", () => {
    const bundle = forked("Approval / Loan Committee");
    expect(discardTargetFor(bundle, VERSION)).toBeNull();
    const said = discardAvailability(rosterOf(bundle), VERSION);
    expect(said.available).toBe(false);
    expect(said.reason).toBe(IN_APPROVAL_REFUSAL);
  });

  it("refuses the same version reached through its booked source", () => {
    const bundle = forked("Approval / Loan Committee");
    expect(discardAvailability(rosterOf(bundle), SOURCE).reason).toBe(IN_APPROVAL_REFUSAL);
  });

  it("asks rather than choosing where two versions are in flight and nothing is anchored", () => {
    const bundle = forked();
    // A second, unrelated version: the other package's two members, copied.
    const other = (bundle.exposure?.facilities ?? []).filter((f) => f.productPackageId === "a5Fbb000000J6BNEA0");
    bundle.exposure!.facilities = [
      ...bundle.exposure!.facilities!,
      ...other.map((f, i) => ({ ...f, loanId: `a4Zbb00000SECOND${i}`, productPackageId: "a5Fbb00000SECONDV", stage: "Qualification", outstanding: 0 })),
    ];
    expect(discardTargetFor(bundle, null)).toBeNull();
    expect(discardAvailability(rosterOf(bundle), null).reason).toBe(AMBIGUOUS_VERSION_REASON);
  });
});

describe("the registry offers the row on the data and nothing else", () => {
  const action = ACTIONS_BY_ID[DISCARD_ACTION_ID];

  it("carries the founder's own label and line", () => {
    expect(action.label).toBe(DISCARD_LABEL);
    expect(action.description).toBe(DISCARD_LINE);
    expect(action.hasPanel).toBe(true);
  });

  it("is available on a relationship carrying an editable version", () => {
    expect(action.availability(dataWith(forked()), HARTWELL).available).toBe(true);
  });

  it("is disabled with the concrete reason where no version is in flight", () => {
    const said = action.availability(dataWith(unforked()), HARTWELL);
    expect(said.available).toBe(false);
    expect(said.reason).toBe(NO_VERSION_REASON);
  });

  it("is disabled on a version at approval, and says so in the approval's words", () => {
    const said = action.availability(dataWith(forked("Approval / Loan Committee")), HARTWELL);
    expect(said.available).toBe(false);
    expect(said.reason).toBe(IN_APPROVAL_REFUSAL);
  });

  it("has no writing seam of its own: it is not an apexAction", () => {
    // Every other write row carries one. A discard runs through the frozen
    // `discard-version` write tools, not through the unwired v2 seam.
    expect(action.apexAction).toBeUndefined();
  });
});

describe("the panel briefs the undo and asks for one thing", () => {
  const schema = () =>
    PANEL_SCHEMAS[DISCARD_ACTION_ID]({
      bundle: forked(),
      accountId: HARTWELL,
      accountName: "Hartwell",
      discard: discardTargetFor(forked(), null),
    });

  it("names the version and the booked package that stays", () => {
    const fields = schema().fields;
    expect(String(fields.find((f) => f.key === "version")!.value)).toContain("Modification in flight");
    expect(fields.find((f) => f.key === "source")!.value).toBeTruthy();
  });

  it("says what stays in the intro, not only what goes", () => {
    expect(schema().intro).toContain("stays exactly as it is");
  });

  it("asks the banker for the reason and nothing else", () => {
    const typed = schema().fields.filter((f) => f.prefill.source === "BANKER");
    expect(typed.map((f) => f.key)).toEqual(["discardReason"]);
    expect(typed[0].required).toBe(true);
  });

  it("blocks staging where the panel was opened with no version to discard", () => {
    const blocked = PANEL_SCHEMAS[DISCARD_ACTION_ID]({
      bundle: unforked(),
      accountId: HARTWELL,
      accountName: "Hartwell",
      discard: discardTargetFor(unforked(), null),
    });
    const version = blocked.fields.find((f) => f.key === "version")!;
    expect(version.gap?.blocksStaging).toBe(true);
    expect(version.gap?.reason).toBe(NO_VERSION_REASON);
  });
});

/* ------------------------------------------------------------ the inventory */

/** The org's own list, in the shape `stage_discard_version` returns it. */
const INVENTORY = [
  { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb000000CHAIN0", name: "LR-0001 revision 0", reason: "the self-anchor row on the booked parent" },
  { object: "LLC_BI__LoanRenewal__c", id: "a3Xbb000000CHAIN1", name: "LR-0002 revision 1", reason: "points the booked parent at the clone" },
  { object: "LLC_BI__Loan_Collateral2__c", id: "a3Ybb000000PLDG0", name: "Pledge on the $20,000,000.00 line", reason: "a copy of the parent pledge; the asset itself stays" },
  { object: "LLC_BI__Loan_Covenant__c", id: "a3Zbb000000JUNC0", name: "Minimum Debt Service Coverage junction", reason: "a copy of the parent junction; the covenant record stays" },
  { object: "LLC_BI__Pricing_Stream__c", id: "a40bb000000STRM0", name: "Pricing stream on the $20,000,000.00 line", reason: "cloned by the nCino pricing engine" },
  { object: "LLC_BI__Loan__c", id: "a4Zbb000009CLONE0", name: "Hartwell Precision Manufacturing LLC - Line of Credit - $20,000,000.00", reason: "a modification clone at Qualification" },
  { object: "LLC_BI__Loan__c", id: "a4Zbb000009CLONE1", name: "Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00", reason: "a modification clone at Qualification" },
  { object: "LLC_BI__Product_Package__c", id: VERSION, name: "Hartwell Precision Manufacturing LLC credit package", reason: "the version package itself" },
  { object: "cm_Action_Staging__c", id: "a5Sbb000000STG01", name: "Staging a5Sbb000000STG01", reason: "kept as the audit and marked Withdrawn" },
];

describe("the inventory is the org's list, grouped in the order the executor runs", () => {
  it("groups the chain rows first and the staging rows last", () => {
    expect(groupInventory(INVENTORY).map((g) => g.title)).toEqual([
      "Version chain rows",
      "Pledges and junctions",
      "Pricing and fees",
      "The version's facilities",
      "The version package",
      "Staging rows, marked Withdrawn",
    ]);
  });

  it("keeps every row the org named, with its own reason verbatim", () => {
    const rows = groupInventory(INVENTORY).flatMap((g) => g.items);
    expect(rows).toHaveLength(INVENTORY.length);
    expect(rows.find((r) => r.id === "a3Xbb000000CHAIN1")!.reason).toBe("points the booked parent at the clone");
  });

  it("shows a row on an object the contract's order does not name rather than dropping it", () => {
    const grouped = groupInventory([...INVENTORY, { object: "LLC_BI__Something_New__c", id: "a9Zbb000000NEW01", name: "A row nobody planned for" }]);
    const last = grouped[grouped.length - 1];
    expect(last.title).toBe(OTHER_GROUP_TITLE);
    expect(last.items[0].name).toBe("A row nobody planned for");
  });

  it("is not a bulk valuation's items, which share the same wire slot", () => {
    expect(inventoryRows([{ collateralId: "a3Kbb000000COL01", collateralName: "Plant and equipment" }])).toEqual([]);
    expect(groupInventory([{ collateralId: "a3Kbb000000COL01" }])).toEqual([]);
  });

  it("counts what goes and what is only marked", () => {
    expect(discardCounts(INVENTORY)).toEqual({ facilities: 2, packages: 1, supporting: 5, staging: 1 });
  });

  it("says the counts and the fact that the booked package is unchanged", () => {
    const said = discardSummary(discardCounts(INVENTORY), "Hartwell credit package");
    expect(said).toBe(
      "2 clone facilities, 1 version package, 5 supporting rows removed. 1 staging row marked Withdrawn. Hartwell credit package is unchanged.",
    );
  });

  it("never claims the staging rows were deleted", () => {
    expect(STAGING_KEPT).toContain("not deleted");
    expect(STAGING_KEPT).toContain("Withdrawn");
  });

  it("says what stays in one sentence, naming the booked package", () => {
    expect(whatStays("Hartwell credit package")).toContain("Hartwell credit package stays exactly as it is");
    expect(whatStays(null)).toContain("The booked package stays exactly as it is");
  });
});

describe("A33.5.3 — an inventory of real ids is not evidence that something was written", () => {
  /* The fence exists because a staged plan created nothing, so a record id in
     one means a write already happened. A DISCARD plan is the opposite case:
     every id in it belongs to a record that existed long before the plan, and
     the plan is naming what it is aimed at. Flagging those would block the one
     gate this release is for. */
  const plan = (): StagedOutput => ({
    stagingId: "a5Sbb0000001TEST",
    planHash: "deadbeefdeadbeef",
    summary: "Discards the unbooked version.",
    steps: [],
    warnings: [],
    suggestions: [],
    productPackageId: VERSION,
    items: INVENTORY,
  });

  it("accepts the inventory's own ids", () => {
    expect(assertNoRecordIds(plan())).toEqual([]);
  });

  it("still refuses an id anywhere else in the plan", () => {
    const leaky = { ...plan(), summary: "ok", steps: [{ id: "s1", type: "write" as const, label: "x", detail: "a34bb000000VAL01AB" }] };
    expect(assertNoRecordIds(leaky).join(" ")).toContain("collateral valuation");
  });
});

describe("the allowlist governs the one plan that deletes", () => {
  /* The write allowlist refuses `LLC_BI__LoanRenewal__c` by name, with
     "deletion: removing a chain row is permanent poison" in its own refused
     list. That is right for an ad-hoc delete and wrong for the one ordered,
     verified transaction whose whole job is to take those rows so the parents
     read hasRenewal false again. The discard is held to its own fence instead. */
  const step = (id: string, objectName: string) => ({ id, type: "write", objectName });

  it("refuses the chain rows on any ordinary plan, exactly as before", () => {
    const said = validatePlan([step("s1", "LLC_BI__LoanRenewal__c")]);
    expect(said).toHaveLength(1);
    expect(said[0].reason).toContain("may never be written by this tool");
  });

  it("allows every object the discard contract names", () => {
    expect(validateDiscardPlan(DISCARD_VERSION_OBJECTS.map((o, i) => step(`s${i}`, o)))).toEqual([]);
  });

  it("refuses an object the discard contract does not name", () => {
    const said = validateDiscardPlan([step("s1", "LLC_BI__Loan__c"), step("s2", "LLC_BI__Review__c")]);
    expect(said).toHaveLength(1);
    expect(said[0].stepId).toBe("s2");
    expect(said[0].reason).toContain("may not touch LLC_BI__Review__c");
  });

  it("passes a step that names no object, which removes nothing", () => {
    expect(validateDiscardPlan([{ id: "v1", type: "verification" }])).toEqual([]);
  });
});

/* ----------------------------------------------------------------- the trail */

describe("the trail records what no longer exists", () => {
  const result = (over: Partial<ExecuteResult> = {}): ExecuteResult => ({
    stagingId: "a5Sbb0000001TEST",
    terminalState: "success",
    outcome: "The version package and its members were deleted and the parents read hasRenewal false.",
    steps: [],
    items: INVENTORY as unknown as ExecuteResult["items"],
    ...over,
  });

  const at = () => new Date("2026-09-13T09:41:00.000Z");

  it("titles the row Version discarded and names the package that stayed", () => {
    const entry = versionDiscardedActivityEntry({
      outcome: result(),
      versionName: "Hartwell credit package",
      sourceName: "Hartwell booked package",
      now: at,
    })!;
    expect(entry.kind).toBe("ACTION_EXECUTED");
    expect(entry.title).toBe("Version discarded from Hartwell booked package");
  });

  it("carries the counts the org's own inventory adds up to", () => {
    const entry = versionDiscardedActivityEntry({ outcome: result(), versionName: null, sourceName: "Hartwell booked package", now: at })!;
    expect(entry.summary).toContain("2 clone facilities, 1 version package, 5 supporting rows removed");
    expect(entry.summary).toContain("1 staging row marked Withdrawn");
    expect(entry.summary).toContain("Hartwell booked package is unchanged");
  });

  it("references the SOURCE package, because the version's id resolves to nothing now", () => {
    const entry = versionDiscardedActivityEntry({
      outcome: result(),
      versionName: null,
      sourceName: null,
      sourcePackageId: SOURCE,
      instanceUrl: "https://example.my.salesforce.com",
      now: at,
    })!;
    expect(entry.reference?.id).toBe(SOURCE);
    expect(entry.reference?.webLink).toContain(SOURCE);
  });

  it("never claims a discard that did not complete", () => {
    const entry = versionDiscardedActivityEntry({
      outcome: result({ terminalState: "partial", steps: [{ id: "d3", type: "write", label: "Delete the clone loans", state: "failed", detail: "The org refused the delete." }] }),
      versionName: "Hartwell credit package",
      sourceName: null,
      now: at,
    })!;
    expect(entry.kind).toBe("ACTION_EXECUTION_FAILED");
    expect(entry.title).toBe("Version Hartwell credit package was not discarded");
    expect(entry.detail?.body).toContain("Stopped at: Delete the clone loans.");
    expect(entry.detail?.body).toContain("The org refused the delete.");
  });

  it("logs nothing where nothing terminal came back", () => {
    expect(versionDiscardedActivityEntry({ outcome: result({ terminalState: "" }), versionName: null, sourceName: null })).toBeNull();
  });

  it("reads an org-recorded discard back as a removal, not as a filing", () => {
    // The row the trail shows after a reload. "Version discard filed" would
    // read as a create; this one took something away.
    const entry = historyActivityEntry({
      stagingId: "a5Sbb0000001TEST",
      actionId: DISCARD_ACTION_ID,
      status: "Completed",
      executedAt: "2026-09-13T09:41:00.000Z",
      productPackageId: SOURCE,
    })!;
    expect(entry.title).toBe("Version discarded");
    expect(entry.kind).toBe("ACTION_EXECUTED");
    // And it dedupes against the session echo: same event, same key.
    expect(entry.id).toBe("exec-a5Sbb0000001TEST");
  });

  it("keys on the staging id, so one execution is one row however often it renders", () => {
    const one = versionDiscardedActivityEntry({ outcome: result(), versionName: null, sourceName: null, now: at })!;
    const again = versionDiscardedActivityEntry({ outcome: result(), versionName: null, sourceName: null, now: at })!;
    expect(one.id).toBe(again.id);
    expect(one.id).toBe("exec-a5Sbb0000001TEST");
  });
});

/* -------------------------------------------------------------- test plumbing */

const rosterOf = (bundle: BorrowerBundle) => packageRoster(bundle);

function dataWith(bundle: BorrowerBundle): C360Data {
  return { ...data, borrowers: { ...data.borrowers, [HARTWELL]: bundle } } as C360Data;
}
