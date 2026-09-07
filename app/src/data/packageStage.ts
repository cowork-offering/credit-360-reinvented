import type { BorrowerBundle, Facility } from "./contract";
import { isActiveFacility } from "./worklist";

/* =============================================================================
   A NEW FACILITY CREATES A NEW PACKAGE.

   FOUNDER, 2026-09-06: "a new package needs to be created for a new facility.
   What's true is that you can add to product packages which are NOT approved
   (i.e. loans in pre-approval stages), of course not to the booked packages."

   So the default is the ACCOUNT anchor, on every relationship, and the question
   "which package does this join" disappears from the ordinary path. What is
   left is one narrow exception, and this module is the whole of it: which
   packages, if any, are still open enough to take a facility instead.

   THE SETS BELOW ARE THE ORG'S OWN, READ OFF THE ORG'S OWN INVENTORY. Nothing
   here is a category this cockpit invented, and nothing is a guess: every
   string appears verbatim in
   `knowledge/sf-build-v2/field-inventory-20260831.json`, and the pre-approval
   cut is the one `knowledge/ACTIONS-DESIGN.md` draws.

   IT FAILS CLOSED, EVERYWHERE. A package whose stage the read does not carry is
   NOT joinable, a facility whose stage is missing blocks its package, and a
   relationship the read says nothing about offers nothing. "Not staged in this
   view" is never "probably fine": the cost of a wrong yes is a facility filed
   onto a booked package, and the cost of a wrong no is one extra package.
   ============================================================================= */

/**
 * `LLC_BI__Product_Package__c.LLC_BI__Stage__c`, the MANAGED field, and the
 * declared authority (A33.3.7, and `knowledge/A33-DRAFT.md`: "The package field
 * stays the managed `LLC_BI__Stage__c`").
 *
 * The whole picklist, in the org's own order: Pending, In Review, Complete.
 * Complete is the end of the run, so the two before it are the ones a facility
 * may still join.
 */
const PACKAGE_STAGE_BEFORE_APPROVAL = ["Pending", "In Review"];

/**
 * `LLC_BI__Product_Package__c.cm_Credit_Stage__c`, the LOCAL field, which is
 * NOT an authority and is read anyway, because it is what the deployed
 * `Customer360Snapshot` actually returns as `primaryStage` today
 * (`Customer360Snapshot.cls:126`). Refusing to read it would make the rule blind
 * on every relationship in the shipped book.
 *
 * The whole picklist, in the org's own order: Application, Credit Underwriting,
 * Final Review, Credit Decisioning, Approved, Fulfillment, Booked. APPROVAL
 * STARTS AT CREDIT DECISIONING (that is the step where the answer is given), so
 * the three before it are the joinable ones. A package already in
 * decisioning is a package whose shape a credit officer is reading right now,
 * and adding a facility to it would change the thing being decided.
 */
const CREDIT_STAGE_BEFORE_APPROVAL = ["Application", "Credit Underwriting", "Final Review"];

/**
 * `LLC_BI__Loan__c.LLC_BI__Stage__c` values that CLOSE a package to a new
 * member. The full picklist is eleven long, Qualification, Proposal, Credit
 * Underwriting, Final Review, Approval / Loan Committee, Processing, Doc Prep,
 * Closing, Boarding, Booked, Complete, and the founder named the two that
 * matter: a package holding a Booked or Complete facility is live business,
 * whatever its own stage field says.
 *
 * CLOSED IS THE THIRD, and it is a STATUS rather than a stage: the org's loan
 * status carries Paid Out, Declined, Charge-Off, Lost and Withdrawn, which
 * `isActiveFacility` already reads. A package carrying one of those has had
 * business run to an end on it and is not a place to file new money either.
 */
const FACILITY_STAGE_CLOSED_TO_JOINING = ["Booked", "Complete"];

const same = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.toLowerCase();
const oneOf = (value: string | null | undefined, set: readonly string[]) => set.some((s) => same(value, s));

/**
 * Is a package's OWN stage before approval?
 *
 * Either field answers, because the org runs both and disagrees with itself
 * about which one is filled (`ACTIONS-DESIGN.md:390`, "Package stage data is
 * corrupt; there are two competing stage fields"). A stage this cockpit cannot
 * place in either picklist is not a stage it will act on.
 */
export function packageStageBeforeApproval(stage: string | null | undefined): boolean {
  const word = (stage ?? "").trim();
  if (!word) return false;
  return oneOf(word, PACKAGE_STAGE_BEFORE_APPROVAL) || oneOf(word, CREDIT_STAGE_BEFORE_APPROVAL);
}

/** Does this facility close its package to a new member? */
function closesPackage(f: Facility): boolean {
  if (!isActiveFacility(f)) return true;
  const stage = (f.stage ?? "").trim();
  // NO STAGE IS NOT NO PROBLEM. `stage` is additive on the exposure read and
  // absent means "not staged in this view" (contract.ts), which cannot be told
  // apart from Booked from here.
  if (!stage) return true;
  return oneOf(stage, FACILITY_STAGE_CLOSED_TO_JOINING);
}

/** Every package id the read places on this relationship, primary first. The
 *  same derivation `packageRecords` does, kept local so the data layer does not
 *  reach up into the action layer that reads it. */
function packageIdsOn(bundle: BorrowerBundle | null): string[] {
  const ids: string[] = [];
  const primary = bundle?.snapshot?.productPackageId;
  if (primary) ids.push(primary);
  for (const f of bundle?.exposure?.facilities ?? []) {
    if (f.productPackageId && !ids.includes(f.productPackageId)) ids.push(f.productPackageId);
  }
  return ids;
}

/**
 * THE STAGE THE READ CARRIES FOR ONE PACKAGE, or null.
 *
 * The bundle stages a package stage for the PRIMARY package only, the snapshot
 * is one record, not a list, so this answers for that package and refuses to
 * answer for any other. A relationship staging exactly one package IS that
 * package, whether or not the snapshot names its id, because `primaryStage` is
 * the highest-TCE package's own (`Customer360Portfolio.cls:207`).
 */
function stageOf(bundle: BorrowerBundle | null, packageId: string): string | null {
  const snapshot = bundle?.snapshot;
  if (!snapshot) return null;
  const named = snapshot.productPackageId;
  const ids = packageIdsOn(bundle);
  const isPrimary = named ? named === packageId : ids.length === 1 && ids[0] === packageId;
  if (!isPrimary) return null;
  // The managed field first, because it is the authority; the local one only
  // where the managed one is not staged, which is the whole shipped book.
  return (snapshot.packageStage ?? "").trim() || (snapshot.primaryStage ?? "").trim() || null;
}

/** One package, and why a new facility may or may not join it. */
export interface PackageJoinability {
  id: string;
  joinable: boolean;
  /** The one line the room says when it will not offer this package. Present
   *  exactly when NOT joinable. */
  reason?: string;
  /** The org's own word for where the package stands, where the read has one. */
  stage: string | null;
}

/**
 * WHICH PACKAGES A NEW FACILITY MAY JOIN, and the reason for every no.
 *
 * A package is JOINABLE when its own stage is before approval AND none of its
 * facilities is Booked, Complete or closed. Both halves are required: a package
 * still reading "In Review" that already carries a booked loan is a package the
 * bank has money out on, and the stage field is the half most likely to be
 * stale.
 */
export function packageJoinability(bundle: BorrowerBundle | null): PackageJoinability[] {
  const facilities = bundle?.exposure?.facilities ?? [];
  return packageIdsOn(bundle).map((id) => {
    const stage = stageOf(bundle, id);
    const on = facilities.filter((f) => f.productPackageId === id);
    if (!packageStageBeforeApproval(stage)) {
      return {
        id,
        stage,
        joinable: false,
        reason: stage
          ? `the package reads ${stage}, which is not a pre-approval stage`
          : "the read does not carry this package's own stage",
      };
    }
    const blocking = on.filter(closesPackage);
    if (blocking.length) {
      return {
        id,
        stage,
        joinable: false,
        reason: `${blocking.length} of its ${on.length} ${on.length === 1 ? "facility is" : "facilities are"} booked, complete or closed`,
      };
    }
    return { id, stage, joinable: true };
  });
}

/** The joinable ids alone, for a caller that only needs the set. */
export function joinablePackageIds(bundle: BorrowerBundle | null): Set<string> {
  return new Set(packageJoinability(bundle).filter((p) => p.joinable).map((p) => p.id));
}
