import { useSyncExternalStore } from "react";

/* =============================================================================
   THE SPREADING ROOM'S SESSION.

   The third of the pattern `roomSession.ts` set and `relSession.ts` mirrored: a
   module store rather than a slice of ViewState, because the FAB's arc has to
   open the room from outside any provider that owns it, and a room holding
   unsent files is not a view the cockpit persists.

   IT HOLDS LESS THAN THE OTHER TWO, and that is the whole shape of it. There is
   no route to bind and no package to anchor: the room is one flow from a drop
   zone to a spread, anchored on a relationship and nothing else. Everything
   else it needs at open — the periods Boom already carries, the covenant
   thresholds, the obligor group — is in the cockpit's book, which is why the
   drop zone can paint on the first frame with nothing fetched.

   CLOSING DROPS THE FILES. A session that survived the close would carry a
   half-answered plan into the next relationship, and the bytes are the
   banker's, not the room's.
   ============================================================================= */

export interface SpreadSession {
  accountId: string;
  accountName: string;
}

let session: SpreadSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the Spreading room on a relationship. The opener the arc calls. */
export function openSpreadingRoom(context: { accountId: string; accountName: string }): void {
  session = { accountId: context.accountId, accountName: context.accountName };
  emit();
}

export function closeSpreadingRoom(): void {
  if (!session) return;
  session = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): SpreadSession | null {
  return session;
}

/** The open Spreading-room session, or null. One mount reads this. */
export function useSpreadingRoom(): SpreadSession | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
