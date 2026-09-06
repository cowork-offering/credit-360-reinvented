import type { FiledLine } from "../workroom/FiledList";
import type { FiledSheetModel } from "../workroom/filedSheet";
import type { MemoChange } from "../../memo/types";
import type { MemoFiledSummary, MemoTrigger } from "./memoSession";

/* =============================================================================
   THE HANDOVER, FROM THE FINALE TO THE MEMO.

   THE ORG IS THE SOURCE OF TRUTH AND THIS IS NOT IT (memo requirements,
   non-negotiable 1). The memo room reads what was executed from the trail, so
   that any viewer opening the room at any later moment sees the same change
   list. This carries the SAME facts down the shortest path, for the one moment
   the trail cannot serve: the seconds right after a filing, in the session that
   filed it, before the org read has caught up and while Phase B's step detail
   is not on the read at all.

   SO IT IS A FALLBACK AND THE ROOM SAYS SO. `memoGreeting` leads with the org's
   own account when it has one and names this handover when it does not; a
   banker always knows which of the two the memo is standing on.

   NOTHING IS RECOMPUTED HERE. The rows are the ones the finale card drew, which
   are the ones the rail staged, which are the ones execute verified: the card's
   `recordId` is the org's proof and it rides across as `orgId`.
   ============================================================================= */

/** The `before`/`after` a filed row carries. The rail prints them as strings
 *  ("$5.0M", "30 Jun 2027"), so they cross as strings: parsing a printed figure
 *  back into a number here would be a second arithmetic over a value the org
 *  already settled, and the memo's own figures come from the bundle. */
const side = (value: string | undefined): Record<string, unknown> | undefined =>
  value == null ? undefined : { printed: value };

/**
 * The finale's ledger, as the memo's change list.
 *
 * A row with no `before` was a CREATE, and the absence is preserved rather than
 * filled with a blank: `MemoChange` reads an absent `before` as "the step
 * created the record", which is how a new facility is recognised downstream.
 */
export function changesFromFiled(lines: readonly FiledLine[]): MemoChange[] {
  return lines.map((line) => ({
    id: line.key,
    label: line.title,
    target: { kind: line.target ? "facility" : "package", name: line.target },
    before: side(line.before),
    after: side(line.after),
    verification: line.handoff ? line.handoffReason : undefined,
    orgId: line.recordId,
  }));
}

/** How many of the filed changes the banker asked for, and how many the room
 *  derived. The finale card already carries the reason on each row; this is the
 *  same set counted once, for the greeting's one line. */
export function splitOfFiled(lines: readonly FiledLine[]): { requested: number; derived: number } {
  const derived = lines.filter((l) => !!l.derivedReason).length;
  return { requested: lines.length - derived, derived };
}

/**
 * THE SHEET, AS THE MEMO'S OPENING FACT.
 *
 * The finale's summary screen and the memo's first timeline row are the same
 * five facts, so they are the same object: the title the sheet stated, the
 * version it filed against, the lines it listed and the exposure it moved. The
 * memo redraws it in its own timeline grammar rather than restating it in prose,
 * which is why nothing here is a sentence.
 *
 * IT IS A HANDOVER AND NOT A READ, exactly like `changesFromFiled` above. The
 * org's own trail remains the record; this is what lets the room greet the
 * banker on its first commit instead of on the first answer.
 */
export function filedSummaryFrom(sheet: FiledSheetModel, kind: MemoTrigger): MemoFiledSummary {
  return {
    title: sheet.title,
    version: sheet.version,
    kind,
    items: sheet.lines.map((line) => ({
      id: line.key,
      label: line.title,
      target: line.target,
      before: line.before,
      after: line.after,
      orgId: line.recordId,
    })),
    exposureBefore: sheet.exposure.before,
    exposureAfter: sheet.exposure.after,
    pending: sheet.exposure.pending,
  };
}
