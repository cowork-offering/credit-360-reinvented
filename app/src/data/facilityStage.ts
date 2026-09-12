/* =============================================================================
   BOOKED FACILITIES (wave 2.1 correction)

   nCino accepts a credit action only against a BOOKED facility. Probe 9 read
   every real renewal chain in the org and found the same shape every time:
   parent loan `Stage = Booked`, `Status = Open`, non-null core lookup key.
   Anything else is refused with "The request contains invalid facilities", at
   any pre-approval stage, for both Renewal and Modification.

   So modification and renewal are offered only where a booked facility exists,
   and the reason is stated where it does not.

   FAIL CLOSED. `stage` is an additive output on the Customer360Exposure read and
   may not be flowing yet. A bundle whose facilities carry NO stage at all is
   "not staged in this view", which is not the same as "not booked" and must
   never be read as "probably fine": the action is withheld either way, but the
   banker is told which of the two it is.
   ============================================================================= */

import type { BorrowerBundle, Facility } from "./contract";
import { isActiveFacility } from "./worklist";

export const BOOKED = "Booked";

/* -----------------------------------------------------------------------------
   THE STAGE LADDER, READ OFF THE LIVE ORG (2026-09-12).

   `sf sobject describe --sobject LLC_BI__Loan__c` on bankinggpt-at returns
   `LLC_BI__Stage__c` as an eleven-value picklist, every value active, in this
   order. It is the ladder a loan climbs, so the ORDER is the fact — not just
   the membership — and "past approval" is a position on it rather than a word
   anyone can guess at.

   The approval stage is named `Approval / Loan Committee`. It is the fifth rung,
   and it is the one a modification version stops being editable at: below it the
   banker is still shaping the version, at it and above the org has taken it.
   ----------------------------------------------------------------------------- */
export const STAGE_LADDER = [
  "Qualification",
  "Proposal",
  "Credit Underwriting",
  "Final Review",
  "Approval / Loan Committee",
  "Processing",
  "Doc Prep",
  "Closing",
  "Boarding",
  "Booked",
  "Complete",
] as const;

/** The rung a version locks at. The org's own words, verbatim. */
export const APPROVAL_STAGE = "Approval / Loan Committee";

const RUNG = new Map(STAGE_LADDER.map((s, i) => [s.toLowerCase(), i]));
const APPROVAL_RUNG = RUNG.get(APPROVAL_STAGE.toLowerCase())!;

/** Where on the ladder, or -1 for a stage this org does not name. An unknown
 *  stage is never ranked against a known one: -1 compares below everything and
 *  every caller treats it as "cannot tell" rather than "early". */
export function stageRung(stage: string | null | undefined): number {
  return RUNG.get((stage ?? "").trim().toLowerCase()) ?? -1;
}

/** Has this facility reached the approval stage or gone past it? Unknown and
 *  unstaged both read false, which is the same fail-closed rule the rest of
 *  this file keeps: we withhold the CLAIM, never invent one. */
export function atOrPastApproval(f: Facility): boolean {
  const rung = stageRung(f.stage);
  return rung >= 0 && rung >= APPROVAL_RUNG;
}

/**
 * Whether EVERY candidate facility carries a stage.
 *
 * `some` was wrong and dangerously so: with one facility staged and three not,
 * the cockpit would confidently report "none of these are booked" when it had
 * only ever seen one of them. Partial data is "cannot tell", and the difference
 * between cannot-tell and no is the whole point of failing closed.
 */
export function facilityStagesStaged(bundle: BorrowerBundle | null): boolean {
  const facilities = bundle?.exposure?.facilities ?? [];
  if (!facilities.length) return false;
  return facilities.every((f) => typeof f.stage === "string" && f.stage.trim() !== "");
}

const isBooked = (f: Facility) => (f.stage ?? "").trim().toLowerCase() === BOOKED.toLowerCase();

/**
 * Facilities a credit action may run against: booked, and still live.
 *
 * `status` is checked through the existing active-facility rule rather than
 * against nCino's own `Open`, because the staged vocabulary is the cockpit's
 * (`Active` / `Paid Off`), not the org's. Conflating the two would be a guess
 * about a field whose values have not been observed here.
 */
export function bookedFacilities(bundle: BorrowerBundle | null): Facility[] {
  return (bundle?.exposure?.facilities ?? []).filter((f) => isBooked(f) && isActiveFacility(f));
}

/** Facilities that exist but cannot carry a credit action, with the reason. */
export function unbookedFacilities(bundle: BorrowerBundle | null): Array<{ facility: Facility; reason: string }> {
  return (bundle?.exposure?.facilities ?? [])
    .filter((f) => !(isBooked(f) && isActiveFacility(f)))
    .map((f) => ({
      facility: f,
      reason: !isActiveFacility(f)
        ? (f.status ?? "not active")
        : f.stage
          ? `at ${f.stage}`
          : "stage not staged in this view",
    }));
}

/** One facility, named the way the ticket and the payload both name it. Single
 *  definition so the selector's label and the id it resolves to cannot drift. */
export function facilityLabel(f: Facility): string {
  return f.name ?? f.loanId ?? "Facility";
}

/**
 * The same facility, named for a LIST the banker is scanning.
 *
 * nCino names a loan `<Borrower> - <Product> - <$Amount>`, so a six-member deal
 * renders as six rows that all begin with the same forty characters and differ
 * only at the end. The relationship name is already the headline of the screen,
 * so it is dropped from each row and what is left is the product and the amount
 * — the founder's own reading of what a member row should say.
 *
 * FAIL SAFE, and the separator is what makes it safe. The prefix is dropped
 * only where the name starts with the relationship's name AND an explicit
 * separator follows it. Without that rule "Testcorp Working Capital Revolver"
 * under "Testco" would be cut to "rp Working Capital Revolver" — half-stripping
 * a name is worse than not stripping it. "Sterling Working Capital Revolver"
 * under "Sterling Fabrication Co." does not match at all and stays whole.
 *
 * DISPLAY ONLY. `facilityLabel` remains the canonical name; nothing that
 * resolves a record or builds a payload reads this.
 */
export function shortFacilityLabel(f: Facility, relationship?: string | null): string {
  return shortFacilityName(facilityLabel(f), relationship);
}

/** The same rule against a bare NAME, for the reads that carry a loan's name
 *  without the facility row behind it (covenant junctions name their loan). */
export function shortFacilityName(name: string | null | undefined, relationship?: string | null): string {
  const full = (name ?? "").trim();
  const rel = (relationship ?? "").trim();
  if (!full) return "";
  if (!rel || full.length <= rel.length) return full;
  if (full.slice(0, rel.length).toLowerCase() !== rel.toLowerCase()) return full;
  const rest = full.slice(rel.length).match(/^\s*[-–—:·|]\s*(\S.*)$/);
  return rest ? rest[1].trim() : full;
}

/**
 * THE PRODUCT, out of the org's own loan name.
 *
 * `Facility.productType` is `LLC_BI__Product_Type__c` — "Real Estate" or
 * "Non-Real Estate", a regulatory classification, not what anyone calls the
 * facility. The PRODUCT ("Line of Credit", "Equipment", "Construction") reaches
 * the cockpit only inside the name, because nCino's before-save flow rebuilds
 * every loan name as `<Borrower> - <Product> - <$Amount>`.
 *
 * So the product is the middle segment: strip the relationship prefix, then
 * drop a trailing money segment. Anything that does not fit the convention
 * falls back to the whole short label and then to the classification, because
 * an unrecognised name is not a licence to invent a product.
 */
export function facilityProduct(f: Facility, relationship?: string | null): string {
  const short = shortFacilityLabel(f, relationship).trim();
  if (short) {
    const cut = short.replace(/\s*[-–—]\s*\$[\d,.]+\s*$/, "").trim();
    if (cut) return cut;
  }
  return (f.productType ?? "").trim() || facilityLabel(f);
}

export interface BookedAvailability {
  available: boolean;
  reason?: string;
}

/**
 * Whether a modification or renewal may be offered at all.
 *
 * Three outcomes, and they are three different facts:
 *   - stages not staged  -> withheld, because we cannot tell
 *   - staged, none booked -> withheld, and we can say exactly why
 *   - at least one booked -> offered
 */
/** The reason a ticket cannot be staged, in the SAME words the availability
 *  gate uses. The panel can be reached outside that gate (a deep link, a stale
 *  chip), and a banker who gets there deserves the real reason rather than a
 *  generic one. */
export function bookedFacilityGap(bundle: BorrowerBundle | null, actionNoun = "modifications"): string | null {
  const r = bookedFacilityAvailability(bundle, actionNoun);
  return r.available ? null : (r.reason ?? "No booked facility is staged on this relationship.");
}

export function bookedFacilityAvailability(bundle: BorrowerBundle | null, actionNoun = "modifications"): BookedAvailability {
  const facilities = bundle?.exposure?.facilities ?? [];
  if (!facilities.length) return { available: false, reason: "No facilities are staged for this relationship" };

  if (!facilityStagesStaged(bundle)) {
    return { available: false, reason: "Facility stages are not staged in this view, so a booked facility cannot be confirmed" };
  }

  if (bookedFacilities(bundle).length) return { available: true };

  const stages = [...new Set(facilities.map((f) => f.stage).filter(Boolean))] as string[];
  const where = stages.length ? `This relationship's facilities are in ${stages.join(", ")}` : "None of this relationship's facilities are booked";
  return { available: false, reason: `Requires a booked facility. ${where}; ${actionNoun} apply to booked loans.` };
}
