/* =============================================================================
   THE DISCARD DOOR (0.9.23, knowledge/SPEC-0.9.23-VERSION-LIFECYCLE.md 2b).

   Founder, 2026-09-13: "a rollback, undo the whole package creation on an
   in-flight modification so it is back to the booked package only."

   0.9.17 gave the version a STATE. It gave it no way out. A banker who forked a
   package by mistake had exactly two options, both outside the cockpit: work the
   version through approval, or delete seven objects by hand in Salesforce in the
   right order (proven 2026-09-11 on Hartwell: delete the clone alone and every
   later roll is refused, because the renewal chain rows keep the parents reading
   `hasRenewal = true`). This module is the door, and it is the only place that
   decides whether the door is offered at all.

   WHAT IT DOES NOT DO. It never composes the delete set: the ORG discovers that
   by query and returns it as `items[]`, which is what the confirm gate renders.
   Nothing here guesses what would go, because a list this page invented and the
   list the org would actually delete are two different lists, and the banker
   would be confirming ours.

   THE TOOL CONTRACT IS FROZEN (knowledge/SPEC-0.9.23-TOOL-CONTRACT.md, pair 2):
   `stage_discard_version` / `execute_discard_version`, action id
   `discard-version`, payload `{ idempotencyKey, rationale, versionPackageId }`.

   THIS FILE IMPORTS NOTHING, DELIBERATELY. `book/packages.ts` reads
   `packageRecords` out of `actions/schemas.ts`, and `actions/schemas.ts` builds
   this door's panel, so anything here that reached for the roster would close a
   module cycle through three files and leave one of the three half-evaluated at
   the moment the next one reads a constant off it. The roster-aware half lives
   in `actions/discardTarget.ts`, which may import both.
   ============================================================================= */


/** The registry id, the trail's action id and the write-tool key: one string. */
export const DISCARD_ACTION_ID = "discard-version";

/** The row in the actions panel and the button on the trail, word for word. */
export const DISCARD_LABEL = "Discard this version";

/** The one line under it. What goes and, in the same breath, what does not. */
export const DISCARD_LINE =
  "Removes the unbooked version and its copies; the booked package stays exactly as it is.";

/* ------------------------------------------------------- what the gate says */

/** No version, so no undo. Said as the absence of a thing rather than a failure. */
export const NO_VERSION_REASON =
  "No unbooked version on this relationship. A discard undoes a modification that is still in flight.";

/** Two in flight and nothing anchored: the door asks rather than choosing. */
export const AMBIGUOUS_VERSION_REASON =
  "More than one unbooked version on this relationship. Open the version you want to undo and discard it from there.";

/**
 * WHAT STAYS, in one sentence (spec 2b.1).
 *
 * A confirm gate that lists only what is deleted reads as a much bigger act
 * than it is. The version holds COPIES: the assets, the covenant records and
 * the booked package itself were never the version's to take with it.
 */
export function whatStays(sourceName: string | null): string {
  return (
    `${sourceName ?? "The booked package"} stays exactly as it is, and so do the collateral assets and the ` +
    "covenant records themselves; only the version's own copies of them go."
  );
}

/** Why the staging rows are in the inventory and are not being deleted. */
export const STAGING_KEPT =
  "The staging rows are not deleted. They are the audit of what was staged and confirmed, and the org marks them Withdrawn.";

/* ------------------------------------------------------------ the inventory

   THE ORG'S OWN LIST, IN THE ORG'S OWN ORDER. `stage_discard_version` returns
   `items[]` (object, id, name and the reason each row goes), discovered by
   query from the version package id. The contract deletes in a fixed order
   because the chain rows are what flip the parents `hasRenewal` formula back
   and the loans cannot go before the rows that reference them, so the gate
   presents the inventory in that same order: the banker reads the sequence the
   executor will actually run.                                                */

export interface InventoryGroup {
  title: string;
  objects: readonly string[];
}

/**
 * ONE INVENTORY ROW, at the four fields the contract puts on it.
 *
 * It is read STRUCTURALLY rather than as `StagedItem` or `ExecutedItem`,
 * because the same list arrives twice: on the staged plan, where it is what the
 * banker confirms, and on the execute result, where it is what actually went. A
 * row with no `object` is not an inventory row at all (a bulk valuation's items
 * share the same wire slot), which is what `groupInventory` filters on.
 */
export interface InventoryRow {
  object?: string;
  id?: string;
  name?: string;
  reason?: string;
}

export const INVENTORY_GROUPS: readonly InventoryGroup[] = [
  { title: "Version chain rows", objects: ["LLC_BI__LoanRenewal__c"] },
  {
    title: "Pledges and junctions",
    objects: ["LLC_BI__Loan_Collateral2__c", "LLC_BI__Loan_Covenant__c", "LLC_BI__Loan_Collateral_Aggregate__c"],
  },
  {
    title: "Pricing and fees",
    objects: [
      "LLC_BI__Pricing_Rate_Component__c",
      "LLC_BI__Pricing_Payment_Component__c",
      "LLC_BI__Pricing_Stream__c",
      "LLC_BI__Fee__c",
      "LLC_BI__Legal_Entities__c",
      "LLC_BI__Loan_Detail__c",
    ],
  },
  { title: "The version's facilities", objects: ["LLC_BI__Loan__c"] },
  { title: "The version package", objects: ["LLC_BI__Product_Package__c"] },
  { title: "Staging rows, marked Withdrawn", objects: ["cm_Action_Staging__c"] },
];

/** Anything the org names that the contract's own order does not. Never
 *  dropped: a row the gate cannot place is still a row that goes, and hiding it
 *  would make the inventory a shorter list than the delete set. */
export const OTHER_GROUP_TITLE = "Also going";

export interface GroupedInventory {
  title: string;
  items: InventoryRow[];
}

/**
 * The inventory rows out of a plan's or an executor's `items[]`.
 *
 * READ STRUCTURALLY, and deliberately: the staged and executed item types both
 * carry rows that are NOT inventory (a bulk valuation's collateral shares the
 * same wire slot), and the fact that tells them apart is the org object. A row
 * with no `object` is not an inventory row, here and nowhere else.
 */
export function inventoryRows(items: readonly object[] | undefined): InventoryRow[] {
  return (items ?? []).filter((i): i is InventoryRow => typeof (i as InventoryRow).object === "string");
}

/** The inventory, grouped as the contract orders it. Empty groups are dropped. */
export function groupInventory(items: readonly object[] | undefined): GroupedInventory[] {
  const inventory = inventoryRows(items);
  const out: GroupedInventory[] = [];
  const placed = new Set<InventoryRow>();

  for (const group of INVENTORY_GROUPS) {
    const rows = inventory.filter((i) => group.objects.includes(i.object!));
    rows.forEach((r) => placed.add(r));
    if (rows.length) out.push({ title: group.title, items: rows });
  }

  const rest = inventory.filter((i) => !placed.has(i));
  if (rest.length) out.push({ title: OTHER_GROUP_TITLE, items: rest });
  return out;
}

export interface DiscardCounts {
  /** Version loans. */
  facilities: number;
  /** Version packages. Always one where the org resolved the version. */
  packages: number;
  /** Chain rows, pledges, junctions, pricing, fees and involvements. */
  supporting: number;
  /** Staging rows the org marks Withdrawn rather than deleting. */
  staging: number;
}

/** What the inventory adds up to, counted off the org's own rows. */
export function discardCounts(items: readonly object[] | undefined): DiscardCounts {
  const inventory = inventoryRows(items);
  const of = (object: string) => inventory.filter((i) => i.object === object).length;
  const facilities = of("LLC_BI__Loan__c");
  const packages = of("LLC_BI__Product_Package__c");
  const staging = of("cm_Action_Staging__c");
  return { facilities, packages, staging, supporting: inventory.length - facilities - packages - staging };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The trail's own sentence: what went, counted, and what was kept. */
export function discardSummary(counts: DiscardCounts, sourceName: string | null): string {
  const gone = [
    counts.facilities ? plural(counts.facilities, "clone facility", "clone facilities") : null,
    counts.packages ? plural(counts.packages, "version package", "version packages") : null,
    counts.supporting ? plural(counts.supporting, "supporting row", "supporting rows") : null,
  ].filter(Boolean);
  return [
    gone.length ? `${gone.join(", ")} removed.` : "Nothing was removed.",
    counts.staging ? `${plural(counts.staging, "staging row", "staging rows")} marked Withdrawn.` : null,
    `${sourceName ?? "The booked package"} is unchanged.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/* ----------------------------------------------------------- the refusals

   THE ORG IS THE AUTHORITY ON BOTH (tool contract, pair 2). `stage_discard_-
   version` refuses a version any member of which has reached approval, and
   refuses one carrying children the cockpit did not create (an approval
   submission, a document with content, a review), naming them. Both land
   verbatim: a refusal restated in our words is a refusal the banker cannot
   check against the record the org is pointing at.                           */

/** Refusal codes this door expects. Used to decide whether the panel offers the
 *  deep link into the version, not to rewrite what the org said. */
export const DISCARD_REFUSALS = ["VERSION_IN_APPROVAL", "HAS_FOREIGN_CHILDREN"] as const;

export function isDiscardRefusal(code: string | undefined): boolean {
  return !!code && (DISCARD_REFUSALS as readonly string[]).includes(code);
}
