/* =============================================================================
   WHICH VERSION THE DISCARD DOOR IS AIMED AT (0.9.23).

   Separate from `discardVersion.ts` for one structural reason: this half reads
   the package roster, `book/packages.ts` reads `packageRecords` out of
   `actions/schemas.ts`, and `actions/schemas.ts` builds this door's panel. Put
   the two halves in one file and that is a cycle through three modules, with
   the panel registry reading an action id off a module that has not finished
   evaluating. The copy and the inventory therefore live in a leaf; the gating
   lives here, where importing the roster is safe.
   ============================================================================= */

import { amendablePackage, IN_APPROVAL_REFUSAL, packageRoster, type PackageEntry } from "../book/packages";
import type { ActionHistoryRow, BorrowerBundle } from "../data/contract";
import { AMBIGUOUS_VERSION_REASON, NO_VERSION_REASON } from "./discardVersion";

/* ------------------------------------------------------------ who it is for */

/** The version a discard would take, and the booked package it would leave. */
export interface DiscardTarget {
  /** The unbooked version. Always `inFlightVersion` and always editable. */
  version: PackageEntry;
  /** The booked package the version forked from, where the roster links one. */
  source: PackageEntry | null;
}

/** Editable in-flight versions on this relationship, in roster order. */
function editableVersions(roster: readonly PackageEntry[]): PackageEntry[] {
  return roster.filter((e) => e.inFlightVersion && amendablePackage(e));
}

/**
 * The version this door would discard, or null where there is no door.
 *
 * THREE ENTRIES, ONE ANSWER (spec 2b.1). Standing IN the version, standing on
 * the booked package whose `inFlightVersionId` names it, or standing on the
 * relationship with no package anchored at all, which is what both the Client
 * Actions panel and the Activity trail are. A relationship carrying two
 * unbooked versions gets no door from the third entry: which one to undo is a
 * question, and a door that picks for the banker is how the wrong version goes.
 */
export function discardTarget(
  roster: readonly PackageEntry[],
  anchoredPackageId: string | null,
): DiscardTarget | null {
  const anchored = anchoredPackageId ? (roster.find((e) => e.id === anchoredPackageId) ?? null) : null;

  let version: PackageEntry | null;
  if (anchored?.inFlightVersion) {
    version = anchored;
  } else if (anchored) {
    // The booked source names its own version. A booked package with none is
    // not a discard door, it is an ordinary package.
    version = anchored.inFlightVersionId
      ? (roster.find((e) => e.id === anchored.inFlightVersionId) ?? null)
      : null;
  } else {
    const versions = editableVersions(roster);
    version = versions.length === 1 ? versions[0] : null;
  }

  // `amendablePackage` is the SAME gate `StageAmendVersion` re-reads on the org:
  // a version that has climbed to Approval / Loan Committee is the org's now.
  if (!version?.inFlightVersion || !amendablePackage(version)) return null;

  return { version, source: roster.find((e) => e.inFlightVersionId === version.id) ?? null };
}

/** The door's target for a BUNDLE. Every surface asks this way, so none of them
 *  has to remember how the roster is built or which history it reads. */
export function discardTargetFor(
  bundle: BorrowerBundle | null | undefined,
  anchoredPackageId: string | null,
  history?: readonly ActionHistoryRow[],
): DiscardTarget | null {
  return discardTarget(packageRoster(bundle, history), anchoredPackageId);
}

/** May this door be taken, and what does the disabled row say?
 *
 *  The registry's honesty rule (A27.3): an unavailable action stays visible with
 *  a concrete reason, and the reason has to be the one a banker can act on. A
 *  version at approval is a different fact from no version at all, and the copy
 *  says which. */
export function discardAvailability(
  roster: readonly PackageEntry[],
  anchoredPackageId: string | null,
): { available: boolean; reason?: string } {
  if (discardTarget(roster, anchoredPackageId)) return { available: true };

  const anchored = anchoredPackageId ? (roster.find((e) => e.id === anchoredPackageId) ?? null) : null;
  const locked = anchored?.inFlightVersion
    ? anchored
    : anchored?.inFlightVersionId
      ? (roster.find((e) => e.id === anchored.inFlightVersionId) ?? null)
      : roster.filter((e) => e.inFlightVersion).length === 1
        ? (roster.find((e) => e.inFlightVersion) ?? null)
        : null;
  if (locked && !amendablePackage(locked)) return { available: false, reason: IN_APPROVAL_REFUSAL };
  if (!anchored && roster.filter((e) => e.inFlightVersion).length > 1) {
    return { available: false, reason: AMBIGUOUS_VERSION_REASON };
  }
  return { available: false, reason: NO_VERSION_REASON };
}
