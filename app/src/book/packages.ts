import { packageRecords } from "../actions/schemas";
import type { ActionHistoryRow, BorrowerBundle, Facility } from "../data/contract";
import { atOrPastApproval, BOOKED } from "../data/facilityStage";
import { fmtMoney } from "../data/format";
import { isActiveFacility } from "../data/worklist";

/* =============================================================================
   EVERY PRODUCT PACKAGE ON THE RELATIONSHIP, AS ONE LIST.

   Founder, 2026-09-02: "why does it know that we are talking about this package
   (there is only one but what happens on multiple ones)?"

   THE ANSWER IS THIS LIST, and it is DERIVED, never read. No connector tool
   returns product packages: `Customer360Exposure` returns FACILITIES, each
   carrying its own `productPackageId`, `stage`, `status`, `productType` and
   `committed`, and `Customer360Snapshot` names the relationship's own package
   where the org staged one. So the roster is the distinct package ids over the
   active facilities, with the snapshot's leading, and the stage/commitment
   figures are summed from the members. That derivation is identical for the
   BAKED book (`artifact/live-data.json`, whose bundles are exactly the shape the
   reads return) and for the DYNAMIC book (`book/aggregate.ts`, which builds the
   same bundle out of the eight live reads). One list, one shape, both books.

   IT IS NOT THE ENGINES' `packageChoices`. That list is ROUTE-SCOPED: it marks a
   package ineligible when no member of it is booked, because a modification only
   runs against a booked facility. This one is route-NEUTRAL, because the room now
   asks which package BEFORE it asks which route, and a package that cannot carry
   a modification can still carry a new facility. Eligibility stays where it
   belongs, on the route's own card.
   ============================================================================= */

/** One package on the relationship, with what it holds. */
export interface PackageEntry {
  id: string;
  /** The deal's headline, derived exactly as every ticket derives it. */
  name: string;
  /** The org's own stage words over the members. Null where none staged. */
  stage: string | null;
  /** Booked, In progress, Part booked, or Stage not staged. */
  status: string;
  /** Members whose stage is Booked and whose status is active. */
  booked: number;
  /** Active members that are not booked yet. */
  inProgress: number;
  /** The active facilities that name this package. */
  members: Facility[];
  /** The summed commitment over the members. */
  committed: number;
  /** "2 facilities · $18.0MM committed", for the ticket's compact line. */
  detail: string;
  /** The ask's own line item: stage, member count, total commitment. */
  line: string;
  /**
   * THIS PACKAGE IS AN UNBOOKED MODIFICATION VERSION (rule 2).
   *
   * nCino files a modification as a NEW package version whose loans all start
   * at an unbooked stage. Booked is the only committed, so a version is a
   * proposal until the booking run approves it: the room lists it, names what
   * it is, and refuses to run in it.
   */
  inFlightVersion: boolean;
  /**
   * THE VERSION IS STILL THE BANKER'S (founder, 2026-09-11).
   *
   * A forked version is not frozen the moment it exists. nCino leaves it
   * workable — loans added, figures moved — until it climbs to
   * `Approval / Loan Committee`, and from that rung up it is the org's. So
   * `inFlightVersion` alone was one boolean doing two jobs: this is the second,
   * and it is keyed on the ladder in `data/facilityStage.ts` rather than on a
   * stage name anyone assumed.
   *
   * False on every package that is not a version at all.
   */
  inFlightEditable: boolean;
  /** The in-flight version forked FROM this package, where the read links one.
   *  Null on the version itself and on a package with none. */
  inFlightVersionId: string | null;
  /** A modification of this package is already in flight and unbooked, so a
   *  second one would fork the version chain. */
  hasInFlightModification: boolean;
  /** Why this package cannot be picked at all, for the disabled row. Null on
   *  every package the room can still run in. */
  reason: string | null;
}

const isBooked = (f: Facility) => (f.stage ?? "").trim().toLowerCase() === BOOKED.toLowerCase();

/* -----------------------------------------------------------------  rule 2

   ONE MODIFICATION IN FLIGHT PER PACKAGE (founder, 2026-09-03).

   A modification does not edit a package. nCino FORKS it: a new package
   version is created holding a COPY of every member, at an unbooked stage, with
   the changed facility carrying the new figure. Booked is the only committed,
   so that version is a proposal until the booking run approves it, and the room
   must not start a second one — two forks off one package is a version chain
   nobody can reconcile.

   WHAT THE SHELL CAN HONESTLY READ. Two sources, both field-level, and the
   fork's own shape is the one that does not need a sweep to have run:

     the mirror      A package whose ACTIVE members are ALL at an unbooked stage
                     (Qualification, Proposal, Final Review) and which MIRRORS a
                     booked package member-for-member is a copy of it. nCino
                     carries the loan NAMES across verbatim, so the mirror is
                     read off `Facility.name` and `Facility.stage` alone.
                     Verified against the live org 2026-09-03: package
                     a5Fbb000000J6PtEAK holds seven loans, every one
                     `stage: "Qualification"`, six of the seven named identically
                     to the seven Booked loans on a5Fbb000000IHFJEA4 — the
                     seventh differs because the filing is what renamed it
                     ("- $15,000,000.00" became "- $20,000,000.00").

     the trail       A `Customer360ActionHistory` row with
                     `actionId: "loan-modification"` and a terminal status names
                     the SOURCE package in `productPackageId` and — this is the
                     field that surprised the seam — a LOAN id in
                     `resultRecordId`, never the output package's. Observed:
                     `resultRecordId: "a4Zbb000002IEpoEAG"`, a member of the
                     version. So the version is resolved by finding the roster
                     package that HOLDS that loan.

   THE MIRROR IS WHY A COUNT ALONE IS NOT ENOUGH. "All members unbooked" on its
   own is also the shape of a brand-new deal staged into its own package, which
   is a room the banker must still be able to work in. The mirror is what tells
   a fork from a first draft.
   ============================================================================ */

/** The statuses a filing only reaches once the org has finished with it. A
 *  Staged row wrote nothing, so it forked no version. */
const FILED_STATUS = new Set(["Completed", "Partial"]);
const MODIFICATION_ACTION = "loan-modification";

const memberNames = (entry: PackageEntry): string[] =>
  entry.members.map((f) => (f.name ?? "").trim()).filter(Boolean);

/**
 * Is `version` a member-for-member copy of `source`?
 *
 * SAME SIZE, MOSTLY SAME NAMES. The size has to match exactly: a fork copies
 * every member, so a package holding fewer or more is a different deal. The
 * names are allowed to disagree on the facilities the modification CHANGED,
 * because the figure a banker moved is part of the loan's own name — so the
 * test is a majority rather than an identity, which is what keeps a two-facility
 * change from reading as an unrelated package.
 */
function mirrors(version: PackageEntry, source: PackageEntry): boolean {
  const theirs = memberNames(source);
  const mine = memberNames(version);
  if (!mine.length || mine.length !== theirs.length || mine.length !== version.members.length) return false;
  const pool = [...theirs];
  let shared = 0;
  for (const name of mine) {
    const at = pool.indexOf(name);
    if (at === -1) continue;
    pool.splice(at, 1);
    shared += 1;
  }
  return shared >= Math.ceil(mine.length / 2);
}

/** Every product package this relationship stages, the snapshot's leading.
 *
 *  `history` is the durable action trail, where the caller holds one. The
 *  roster names an in-flight version and its source without it; the trail only
 *  ever CORRECTS which booked package a version was forked from. */
export function packageRoster(
  bundle: BorrowerBundle | null | undefined,
  history?: readonly ActionHistoryRow[],
): PackageEntry[] {
  const facilities = (bundle?.exposure?.facilities ?? []).filter(isActiveFacility);
  const entries: PackageEntry[] = packageRecords(bundle ?? null).map((record): PackageEntry => {
    const members = facilities.filter((f) => f.productPackageId === record.id);
    const committed = members.reduce((sum, f) => sum + (typeof f.committed === "number" ? f.committed : 0), 0);
    const booked = members.filter(isBooked).length;
    const inProgress = members.length - booked;
    const stages = [...new Set(members.map((f) => (f.stage ?? "").trim()).filter(Boolean))];
    const status = !stages.length
      ? "Stage not staged"
      : booked === members.length
        ? "Booked"
        : booked === 0
          ? "In progress"
          : "Part booked";
    const count = `${members.length} ${members.length === 1 ? "facility" : "facilities"}`;
    return {
      id: record.id,
      name: record.label,
      stage: stages.length ? stages.join(", ") : null,
      status,
      booked,
      inProgress,
      members,
      committed,
      detail: record.detail,
      // WHAT THE BANKER READS BEFORE PICKING. Stage first, because a package
      // still in review is a different kind of thing from a booked one, and the
      // commitment last, because that is the figure the eye lands on.
      line: [status, count, committed > 0 ? `${fmtMoney(committed)} committed` : null].filter(Boolean).join(" · "),
      inFlightVersion: false,
      inFlightEditable: false,
      inFlightVersionId: null,
      hasInFlightModification: false,
      reason: null,
    };
  });

  /* THE FORK, READ OFF THE ROSTER. An all-unbooked package that mirrors a
     booked one is a copy of it, and the copy is the version in flight. The
     snapshot's own anchor is never a version: it is the relationship's package.
     Where the mirror finds a source, the link comes with it — no trail needed. */
  const anchorId = bundle?.snapshot?.productPackageId ?? null;
  const unbooked = entries.filter((e) => e.members.length > 0 && e.booked === 0 && e.stage && e.id !== anchorId);
  const booked = entries.filter((e) => e.booked > 0);
  for (const version of unbooked) {
    const source = booked.find((b) => mirrors(version, b));
    if (!source) continue;
    const count = `${version.members.length} ${version.members.length === 1 ? "facility" : "facilities"}`;
    version.inFlightVersion = true;
    /* EDITABLE UNTIL APPROVAL. One member at `Approval / Loan Committee` or
       above takes the whole version out of the banker's hands — the org
       approves a version, not a loan — so the test is `some`, not `every`. */
    version.inFlightEditable = !version.members.some(atOrPastApproval);
    version.reason = [
      "Modification in flight",
      version.inFlightEditable ? "editable until approval" : "in approval · locked",
      count,
      fmtMoney(version.committed),
    ].join(" · ");
    source.hasInFlightModification = true;
    source.inFlightVersionId = version.id;
  }

  /* THE TRAIL'S OWN LINK, over the top. It cannot name a version the mirror
     missed — a package the roster cannot see as a copy is not one this shell
     will lock a room on — but it CAN correct which booked package a version
     was forked from, which the mirror can only infer. */
  for (const row of history ?? []) {
    if (row.actionId !== MODIFICATION_ACTION || !FILED_STATUS.has(row.status ?? "")) continue;
    const version = entries.find((e) => e.inFlightVersion && e.members.some((m) => m.loanId === row.resultRecordId));
    const source = entries.find((e) => e.id === row.productPackageId && !e.inFlightVersion);
    if (!version || !source) continue;
    for (const e of entries) {
      if (e.inFlightVersionId === version.id && e !== source) {
        e.inFlightVersionId = null;
        e.hasInFlightModification = false;
      }
    }
    source.hasInFlightModification = true;
    source.inFlightVersionId = version.id;
  }
  return entries;
}

/** The package the room is standing in, where a modification of it is already
 *  in flight. Null wherever the room is free to run. */
export function lockedSourcePackage(
  roster: readonly PackageEntry[],
  productPackageId: string | null,
): PackageEntry | null {
  const entry = roster.find((e) => e.id === productPackageId);
  return entry?.hasInFlightModification ? entry : null;
}

/**
 * The room is standing IN an in-flight version, where a fork route was asked for.
 *
 * The other half of rule 2, and it was missing: `lockedSourcePackage` refuses a
 * SECOND fork off a booked package, but a banker who walked the room onto the
 * version itself met no refusal at all — and nCino takes a credit action only
 * against a booked loan, of which a version holds none. Null everywhere else.
 */
export function forkTargetVersion(
  roster: readonly PackageEntry[],
  productPackageId: string | null,
): PackageEntry | null {
  const entry = roster.find((e) => e.id === productPackageId);
  return entry?.inFlightVersion ? entry : null;
}

/**
 * The in-flight version the room is STANDING IN, once the org has taken it.
 *
 * The mirror image of `lockedSourcePackage`: that one refuses a second fork off
 * a booked package, this one refuses work inside a version that has climbed to
 * `Approval / Loan Committee`. Null while the version is still the banker's,
 * and null on every package that is not a version.
 */
export function lockedInFlightVersion(
  roster: readonly PackageEntry[],
  productPackageId: string | null,
): PackageEntry | null {
  const entry = roster.find((e) => e.id === productPackageId);
  return entry?.inFlightVersion && !entry.inFlightEditable ? entry : null;
}

/* -----------------------------------------------------------------------------
   ONE LOCK, THREE PICKERS (founder, 2026-09-11).

   The rule-2 lock used to be wired into the JSX of each package picker, and
   there are three of them: the facility room's own ask, the relationship room's
   review ask, and the room header's switch peek. The switch peek had no lock at
   all — a banker could walk the room onto an unbooked version through it. That
   is the failure mode of a rule that lives in markup, so it lives here now and
   the pickers render what it returns.

   WHAT THE PICK WOULD START IS PART OF THE QUESTION, and there are three kinds:

     "fork"     The route is settled on MODIFICATION or RENEWAL. These are the
                two that version a package, and they are what rule 2 refuses.
     "review"   A relationship review. It writes no version, so a package with a
                modification in flight is fine — but an UNBOOKED version holds
                nothing to review, so it is never a room either.
     "open"     The route is not settled: the facility room's own ask, before the
                banker has said which of the three this is. Nothing is refused
                that a later route would allow, because the route chips refuse
                Modify and Renew by name when it comes to it.
   ----------------------------------------------------------------------------- */

/** The first-class state the founder asked for by name (2026-09-11). */
export const MODIFICATION_IN_PROGRESS = "Modification in Progress";

export type PackageAsk = "fork" | "review" | "open";

export interface PackagePick {
  /** Hard-blocked: the row is disabled, unclickable, and carries no arrow. */
  blocked: boolean;
  /** The one line under the package's name. Never a figure where the row is
   *  blocked — a commitment the banker cannot act on is noise. */
  line: string;
}

/** May this package be picked here, and what does its row say? */
export function packagePick(entry: PackageEntry, ask: PackageAsk): PackagePick {
  /* THE VERSION ITSELF. Never a fresh modification target at any stage — nCino
     takes a credit action only against a booked loan and a version holds none —
     and never a review either. What it IS, until it reaches approval, is the
     banker's own draft: the facility room's open ask lets them back into it to
     add a loan or move a figure, and the moment it climbs to
     `Approval / Loan Committee` even that closes. */
  if (entry.inFlightVersion) {
    return { blocked: ask !== "open" || !entry.inFlightEditable, line: entry.reason ?? entry.line };
  }
  /* THE ORIGINAL, WITH A FORK ALREADY OPEN. First-class, named, and hard: a
     second fork off one booked package is a version chain nobody reconciles. */
  if (entry.hasInFlightModification) {
    return ask === "fork"
      ? { blocked: true, line: `${MODIFICATION_IN_PROGRESS} · a version of this package is unbooked with the org` }
      : { blocked: false, line: `${MODIFICATION_IN_PROGRESS} · ${entry.line}` };
  }
  return { blocked: false, line: entry.reason ?? entry.line };
}

/** THE ONE SENTENCE THE ROOM REFUSES WITH (founder, 2026-09-03). */
export const IN_FLIGHT_REFUSAL =
  "A modification of this package is already in flight and unbooked. Book or discard it in Salesforce first; a second one would fork the version chain.";

/** THE SENTENCE FOR A ROOM STANDING IN THE VERSION ITSELF. A version holds no
 *  booked loan, so there is nothing here for a modification or a renewal to act
 *  against; the change belongs in the version the banker is already in. */
export const VERSION_TARGET_REFUSAL =
  "This package is the unbooked modification version itself, so it carries no booked facility to modify or renew. Change the figures in this version, or book it in Salesforce first.";

/** THE SENTENCE FOR A VERSION THE ORG HAS TAKEN (founder, 2026-09-11). The
 *  version was the banker's to shape right up to this rung; it is not any more,
 *  and the door is the approval, not a second version. */
export const IN_APPROVAL_REFUSAL =
  "This version is at Approval / Loan Committee, so it is no longer editable. Work it through approval in Salesforce, or send it back a stage there before changing it.";

/** The facilities of ONE package, or all of them where nothing is anchored. */
export function facilitiesInPackage(facilities: Facility[], productPackageId: string | null): Facility[] {
  if (!productPackageId) return facilities;
  return facilities.filter((f) => f.productPackageId === productPackageId);
}

/**
 * DOES THIS ROOM HAVE TO ASK?
 *
 * More than one package on the relationship and none anchored. One package is
 * not a choice, so the room binds it silently and says on the glass that it did;
 * none is the create door, which is already honest.
 */
export function mustChoosePackage(
  bundle: BorrowerBundle | null | undefined,
  productPackageId: string | null,
): boolean {
  if (productPackageId) return false;
  return packageRoster(bundle).length > 1;
}
