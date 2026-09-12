/* =============================================================================
   THE ONE SETTER FOR A PUBLISHED SPREAD (item 18), AND WHAT ELSE THE EVENT
   OWES THE RELATIONSHIP.

   `bundle.boom` is held in exactly one place for an anchored relationship: the
   live-patch slice in `state/appState.tsx`, merged OVER the staged bundle at
   read time by every consumer (`AppShell` for the Financials tab,
   `MemoRoomHost` for the memo's Boom graph, `RelationshipRoom`, `WorkroomHost`,
   `SpreadingRoomHost`). So publishing a spread is ONE `PATCH_BUNDLE` carrying a
   `boom` key, and every one of those surfaces picks it up on the next render
   with nothing else wired.

   IT IS A NEW FILE RATHER THAN A LINE IN `appState.tsx` because the narrowest
   possible seam between the room and the store is a function that calls the
   action the store already publishes. Nothing here is a second way to hold a
   bundle, and nothing here is a second reducer.

   THE APPLIER IS HERE AND NOT IN THE HOST so it can be driven by a test the way
   the room drives it. The host component holds no logic of its own: it hands
   over the event, the book it is standing on and the dispatch, and this decides
   what the relationship gets.

   LAST GOOD, ALWAYS. A publish REPLACES `boom` and can never clear it: a null
   or empty spread returns without dispatching, so a spread that came back with
   nothing leaves the banker reading the last figures that were true rather than
   a blank tab. No `storedAt` travels with it either — that stamp means "the org
   answered this freshly", and a spread the room just published is not an org
   read.
   ============================================================================= */

import { spreadActivityEntry } from "../actions/executedActivity";
import { newPeriodOf, publishSpread, type SpreadProvenance } from "../spread/publishSpread";
import type { BoomFinancialStatement } from "../spread/types";
import type { ActivityEntry, Boom, BorrowerBundle } from "../data/contract";

/* --------------------------------------------------- what leaves the room

   ITEM 18. A spread that only lives in the Spreading room is a demo. Everything
   the cockpit needs to act on — the plan's own sentence, the statements the
   spreading system returned, which system answered — leaves the room through
   ONE event, once per moment. The room itself holds no store and reaches no
   reducer. */

export interface SpreadRoomEvent {
  /** Sent, settled, or refused. One event each, at most. */
  phase: "sent" | "completed" | "failed";
  accountId: string;
  company: string;
  /** The governed sentence the banker confirmed, verbatim. */
  summary: string;
  /** The plan's content key: every file's sha256, in plan order. */
  planKey: string;
  fileCount: number;
  /** Boom's own spread. Empty on `sent` and on `failed`. */
  statements: BoomFinancialStatement[];
  provenance: SpreadProvenance;
  /** The spreading system, in words, for the trail. */
  system: string;
  /** TRUE only where an analyst has signed the spread off in Boom. */
  signedOff: boolean;
  /** The system's own words on a refusal, verbatim. */
  failure: string | null;
}

/** What the trail calls the system that answered. The stub is named as one: a
 *  trail row is the last place a provisional spread may read as Boom's. */
export const boomSystemWord = (lane: "stub" | "live"): string =>
  lane === "live" ? "Boom" : "Boom (stub, provisional)";

/**
 * The store's own dispatch, narrowed to the two actions this module sends.
 *
 * `React.Dispatch<Action>` from `appState.tsx` satisfies it, and nothing here
 * can reach for a third action by accident.
 */
export type PublishDispatch = (
  action:
    | { type: "PATCH_BUNDLE"; accountId: string; patch: Partial<BorrowerBundle> }
    | { type: "LOG_ACTIVITY"; accountId: string; entry: ActivityEntry },
) => void;

/**
 * Put a published spread on the relationship's book.
 *
 * Returns TRUE where it landed. False means there was nothing honest to
 * publish and the book is untouched.
 */
export function publishSpreadToBook(
  dispatch: PublishDispatch,
  accountId: string,
  boom: Boom | null | undefined,
): boolean {
  if (!accountId || !boom) return false;
  if (!boom.spread && !boom.ratios) return false;
  dispatch({ type: "PATCH_BUNDLE", accountId, patch: { boom } });
  return true;
}

export interface ApplySpreadEventArgs {
  event: SpreadRoomEvent;
  /** The spread on file when the event fired. */
  onFileBoom: Boom | null | undefined;
  dispatch: PublishDispatch;
  /** The signed-in user, for the trail entry's actor. */
  actor?: string;
}

/** What the relationship got: the period the book gained, and the entry the
 *  trail carries. A null period is not a failure — it means the spread added
 *  nothing the book did not already hold. */
export interface AppliedSpread {
  period: string | null;
  entry: ActivityEntry;
}

/**
 * ONE SPREADING EVENT, APPLIED TO THE RELATIONSHIP.
 *
 * THE BOOK MOVES FIRST, so the trail entry can NAME the period that landed. The
 * session trail dedupes on the entry id, so one plan gets one entry per moment
 * and a repeat of the same moment lands nowhere.
 */
export function applySpreadEvent(args: ApplySpreadEventArgs): AppliedSpread {
  const { event, onFileBoom, dispatch, actor } = args;

  let period: string | null = null;
  if (event.phase === "completed") {
    const boom = publishSpread({ onFile: onFileBoom, statements: event.statements, provenance: event.provenance });
    if (publishSpreadToBook(dispatch, event.accountId, boom)) period = newPeriodOf(onFileBoom, boom);
  }

  const entry = spreadActivityEntry({
    phase: event.phase,
    company: event.company,
    summary: event.summary,
    system: event.system,
    planKey: event.planKey,
    fileCount: event.fileCount,
    period,
    signedOff: event.signedOff,
    failure: event.failure,
    actor,
  });
  dispatch({ type: "LOG_ACTIVITY", accountId: event.accountId, entry });
  return { period, entry };
}
