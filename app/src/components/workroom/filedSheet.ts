import type { FiledLine } from "./FiledList";
import type { WorkroomChallenge, WorkroomMode } from "../../workroom/types";

/* =============================================================================
   THE FILED SHEET. THE CLEAN SUMMARY THE ROOM ENDS ON.

   FOUNDER, 2026-09-06: "make the modification / renewal and loan creation at the
   end a little bit more cinematic, I liked the rainbow card morphing into this
   but I need a clean room at the end when it's done with a clean Summary screen."

   THE CARD SAID WHAT LANDED. IT DID NOT SAY WHAT THE RELATIONSHIP NOW IS. A
   banker closing a modification wants five facts and no more: what was filed and
   on which version, what the exposure is now, what moved on terms and security,
   and who has it next. The card carried the first of the five and the room
   carried the rest away with the drain.

   SO THE CARD GROWS INTO A SHEET. Everything on it is a fact the room already
   holds at the instant the execute answers: the manifest it staged, the ledger
   execute verified, the baseline it opened on. NOTHING HERE READS THE ORG, which
   is the whole reason the sheet can be on the glass inside a second and can never
   spin.

   WHAT IS PRO FORMA SAYS SO. The exposure figure is the room's own arithmetic
   over the manifest, not a number nCino has read back, so it carries the word
   "pending" until the staging record goes terminal. A confirmation that never
   arrives leaves the sheet exactly as it is plus one honest line; it never takes
   the sheet away and it never blocks it.
   ============================================================================= */

/** The one line under the exposure block when the org has not answered in time.
 *  It claims nothing either way and it leaves every figure standing. */
export const SHEET_UNCONFIRMED =
  "The org has not confirmed the figures yet; what is shown is what was sent.";

/** Where the exposure figure stands with the org. */
export type SheetConfirmation = "pending" | "confirmed" | "unconfirmed";

/** Millions, in the cockpit's own KPI voice: "$46.0M". One decimal always, so a
 *  column of them aligns and "$46M" never sits under "$46.5M". */
export function moneyM(mm: number): string {
  return `$${Math.abs(mm).toFixed(1)}M`;
}

/** The same figure as a movement: "+$3.5M", "-$1.2M", "no change". */
export function deltaM(mm: number): string {
  if (Math.abs(mm) < 0.05) return "no change";
  return `${mm > 0 ? "+" : "-"}${moneyM(mm)}`;
}

/* ------------------------------------------------------------- the heading */

/** Past this the package part of a heading is trimmed in the middle. Long enough
 *  for every package name this book carries once the relationship's own name is
 *  off the front of it. */
export const PACKAGE_NAME_CAP = 40;

/**
 * THE PACKAGE, WITHOUT THE RELATIONSHIP'S NAME IN IT TWICE.
 *
 * nCino names a package after the borrower, so the org's own label is
 * "Hartwell Precision Manufacturing LLC credit package - Non-Real Estate and
 * Real Estate" and a heading that already says "Filed on Hartwell Precision
 * Manufacturing LLC" then says it again, in the same line, four words later.
 * The account is the subject of the sentence; the package is what it was filed
 * against, and only the part that distinguishes it is news.
 *
 * TRIMMED IN THE MIDDLE, NEVER AT THE END, where the label still runs long. What
 * distinguishes two packages on one relationship is as often the tail ("Real
 * Estate") as the head, so a trailing ellipsis would cut off the half that
 * identifies it. The cut lands on word boundaries so neither end is a fragment.
 *
 * IT NEVER RETURNS NOTHING. A package named exactly after the account keeps the
 * org's own label rather than becoming an empty string.
 */
export function shortPackageName(accountName: string | null | undefined, packageName: string): string {
  const full = (packageName ?? "").trim();
  const account = (accountName ?? "").trim();
  let name = full;
  if (account && full.toLowerCase().startsWith(account.toLowerCase())) {
    name = full.slice(account.length).replace(/^[\s,:·\-]+/, "").trim() || full;
  }
  if (name.length <= PACKAGE_NAME_CAP) return name;
  // A head that ends on the separator it was cut before ("credit package ·…")
  // is a dangling mark; the ellipsis is the mark.
  const head = name.slice(0, 20).replace(/\s+\S*$/, "").replace(/[\s,:·\-]+$/, "");
  const tail = name.slice(-19).replace(/^\S*\s+/, "").trimStart();
  return `${head}…${tail}`;
}

/** What the room did, in the word the mode uses for it. A renewal names the date
 *  it renewed TO, because that is the fact a banker reads a renewal for. */
export function filedTitle(args: {
  mode: WorkroomMode;
  accountName: string;
  packageName: string;
  /** The version the filing created, from the execute result. Omitted from the
   *  line where the org returned none: a guessed version id is worse than none. */
  version?: string | null;
  /** The maturity the renewal filed, where the manifest carried one. */
  renewedTo?: string | null;
}): string {
  const where = [args.accountName, shortPackageName(args.accountName, args.packageName)].filter(Boolean).join(", ");
  const tail = args.version ? `${where}, version ${args.version}` : where;
  if (args.mode === "renew") return args.renewedTo ? `Renewed to ${args.renewedTo} on ${tail}` : `Renewed on ${tail}`;
  if (args.mode === "create") return `Proposed on ${tail}`;
  return `Filed on ${tail}`;
}

/** "09:07, by Fabian Goetzens". The room's own clock at the moment the org
 *  answered, which is when the filing happened. */
export function filedStamp(at: Date, user: string | null | undefined): string {
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return user ? `${hh}:${mm}, by ${user}` : `${hh}:${mm}`;
}

/** The date a renewal moved maturity to, off the ledger the room just filed.
 *  Absent where no row moved a maturity, which is every modification that did
 *  not touch one. */
export function renewedTo(lines: readonly FiledLine[]): string | null {
  const row = lines.find((l) => /maturit|expir/i.test(l.title) && !!l.after);
  return row?.after ?? null;
}

/* ------------------------------------------------------------- the exposure */

export interface SheetExposure {
  before: string;
  after: string;
  /** The movement, or null where nothing moved. */
  delta: string | null;
  /** True while the org has not confirmed the run. Drives the word "pending". */
  pending: boolean;
}

/**
 * COMMITTED EXPOSURE, BEFORE AND AFTER, off the figures the room already has.
 *
 * `afterMM` is `figuresFor`'s own running total over the manifest and `beforeMM`
 * is the baseline the room opened on; neither is recomputed here. The delta is
 * the difference between them and nothing else, which is why it can be shown
 * before any read has come back.
 */
export function sheetExposure(beforeMM: number, afterMM: number, confirmation: SheetConfirmation): SheetExposure {
  const moved = Math.abs(afterMM - beforeMM) >= 0.05;
  return {
    before: moneyM(beforeMM),
    after: moneyM(afterMM),
    delta: moved ? deltaM(afterMM - beforeMM) : null,
    pending: confirmation !== "confirmed",
  };
}

/* -------------------------------------------------- terms and collateral */

/**
 * WHAT THE FILING DID TO COVERAGE.
 *
 * THE LEDGER ABOVE ALREADY SAYS WHAT MOVED. Every filed change is on the sheet
 * once, with its target and its two figures, so a "terms and collateral" block
 * that listed the same rows again would be the same facts twice on a surface
 * whose whole claim is that it reads in ten seconds. What the ledger does NOT
 * say is what those changes did to the bank's protection, and that is this.
 *
 * IT IS QUOTED, NEVER RECOMPUTED. The figure comes from the check the room
 * already ran and the banker already acknowledged (`WorkroomChallenge.rows`); a
 * sheet that computed its own coverage could disagree with the challenge on the
 * glass twenty seconds earlier. Null where no check in this session carried one,
 * and the sheet omits the block rather than printing an empty heading.
 */
export function sheetCoverage(challenges: readonly WorkroomChallenge[]): { label: string; value: string } | null {
  let found: { label: string; value: string } | null = null;
  for (const challenge of challenges) {
    for (const [label, value] of challenge.rows) {
      if (/coverage/i.test(label) && /x\b/.test(value)) found = { label, value };
    }
  }
  return found;
}

/* ------------------------------------------------------------- who acts next */

/**
 * WHO HAS IT NOW, WITHOUT A PROMISE ABOUT WHEN.
 *
 * The org's own queue name where the result carries one; the org's own handoff
 * sentence where it does not, because that sentence is exactly the statement of
 * who acts next ("Booking runs through nCino's own Submit for Approval"). Null
 * where neither exists, and the sheet omits the block: a room that invented an
 * approver would be the worst sentence on the sheet.
 */
export function whoActsNext(queue: string | null | undefined, handoff: string | null | undefined): string | null {
  if (queue && queue.trim()) return queue.trim();
  if (handoff && handoff.trim()) return handoff.trim();
  return null;
}

/* ---------------------------------------------------------------- the model */

export interface FiledSheetModel {
  title: string;
  stamp: string;
  /** The version the filing created, where the org returned one. Carried in its
   *  own right as well as inside the title, because the memo room anchors on it. */
  version: string | null;
  /** The ledger the card carried, unchanged. */
  lines: readonly FiledLine[];
  /** The rail head's own count sentence over that set. */
  head: string;
  exposure: SheetExposure;
  /** What the filing did to coverage, where a check in this session said. */
  coverage: { label: string; value: string } | null;
  next: string | null;
  /** The account, for the door that goes back to it. */
  accountName: string;
  /** The org has not answered inside the room's budget. */
  unconfirmed: boolean;
}
