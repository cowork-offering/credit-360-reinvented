import { DETAIL_KEYS, DETAIL_TOOLS, mcpAvailable, type DetailKey, type McpOk } from "./mcp";
import { readThroughEitherLane, type LaneResult } from "./gateway/lane";

/* =============================================================================
   THE HEAD START: the six reads leave before React does.

   WHY. The open refresh runs out of a React effect, so the six detail reads
   cannot leave until the account view has been committed. On a page that has
   just been handed over in Cowork that commit costs a JSON parse of the whole
   baked book and a mount of the entire cockpit, and every millisecond of it is
   dead time on a wire that was going to be busy for half a second anyway. The
   relay round trip and the first paint are independent work, and there is no
   reason for the page to do them one after the other.

   SO: when the account is known BEFORE the mount, the reads go out then, and
   the refresh adopts them when it starts. Nothing is called twice.

   WHO KNOWS AN ACCOUNT THAT EARLY. Two callers, and only two:

     main.tsx      the relationship this browser was standing on when the page
                   was last replaced (`persistedOpenAccount`). An artifact
                   replace and a reload both land straight back on a client
                   view, so the reads for it can leave before React exists.
     intent/open   an intent NAMES its relationship, and the cockpit then
                   spends 520ms flying the name across the screen before the
                   room opens. The reads can ride that animation.

   A COLD OPEN FROM THE WORKLIST IS NOT ONE OF THEM, and it must not pretend to
   be: nobody knows which relationship the banker will click until they click
   it. That path is served by the open refresh going six-wide, not by this file.

   NOTHING HERE RETRIES, CACHES OR RENDERS. A prefetched lane is one in-flight
   call held for a few seconds. It is claimed once, by the refresh, which owns
   every decision about what to do with the answer; unclaimed it is dropped, and
   the refresh calls the tool itself exactly as it always has.
   ============================================================================= */

export type PrefetchedLane = Promise<LaneResult<McpOk<unknown>>>;

/** How long an unclaimed head start is held before it is forgotten. Long
 *  enough to cover a mount and a name flight, short enough that a banker who
 *  went somewhere else is not holding a stale promise. */
export const PREFETCH_TTL_MS = 30_000;

interface Entry {
  lanes: Map<DetailKey, PrefetchedLane>;
  timer: ReturnType<typeof setTimeout>;
}

const started = new Map<string, Entry>();

/**
 * Send the six detail reads for one relationship, now.
 *
 * Idempotent per account: a second call while the first is still held is a
 * no-op, so a caller may ask without checking. A no-op with no connector, for
 * the same reason every other lane in this cockpit is.
 */
export function prefetchOpen(accountId: string): void {
  if (!accountId || !mcpAvailable() || started.has(accountId)) return;

  const lanes = new Map<DetailKey, PrefetchedLane>();
  DETAIL_TOOLS.forEach((tool, i) => {
    const p = readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } });
    /* A REJECTION NOBODY IS AWAITING YET IS STILL A REJECTION. Held in a map
       for a mount's worth of time, an unattached rejected promise reaches the
       page as `unhandledrejection`, which is a page error the lane drive fails
       on and a red line in the founder's console for a lane that merely needs
       a retry. The no-op catch marks it handled; `p` itself is untouched, so
       the refresh still sees the failure and still owns what to do about it. */
    p.catch(() => {});
    lanes.set(DETAIL_KEYS[i], p);
  });

  started.set(accountId, { lanes, timer: setTimeout(() => started.delete(accountId), PREFETCH_TTL_MS) });
}

/**
 * Take the head start for one relationship, if there is one.
 *
 * ONCE. The refresh gets the in-flight calls and this file forgets them, so a
 * lane that fails and comes back a minute later issues a fresh call rather than
 * awaiting the same dead promise for the life of the page.
 */
export function claimPrefetch(accountId: string): Map<DetailKey, PrefetchedLane> | undefined {
  const entry = started.get(accountId);
  if (!entry) return undefined;
  clearTimeout(entry.timer);
  started.delete(accountId);
  return entry.lanes;
}

/** Test seam: put the module back the way a fresh page finds it. */
export function __resetPrefetchForTests(): void {
  for (const entry of started.values()) clearTimeout(entry.timer);
  started.clear();
}
