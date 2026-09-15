import { useSyncExternalStore } from "react";

import type { BoomFileHandle } from "../../workroom/spreadEngine";

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

   ONE THING DOES SURVIVE THE CLOSE (0.9.28, founder decision D3): the handle of
   a file already IN BOOM. Boom has been observed taking over six minutes on an
   8 KB workbook, which is longer than a banker will sit in one room, and the
   bytes are gone the moment the room shuts. Without the handle a re-entry would
   send the same file again and Boom would spread it twice. So the fileId, the
   company and the name are kept, per relationship, for exactly as long as the
   file is unsettled: the room resumes from `boom_get_file` and sends nothing.
   It is deliberately NOT the bytes and NOT the plan; it is a receipt, and
   there is one PER FILE: a plan of three statements leaves three.
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

/* ------------------------------------------------------- the file receipts */

/**
 * Per relationship, EVERY file Boom is still working on.
 *
 * ONE RECEIPT PER FILE, NOT PER RELATIONSHIP (0.9.29). It was a flat
 * `Map<accountId, handle>`, which is a store with room for exactly one file,
 * and a plan is routinely more than one: on 2026-09-15 the founder dropped
 * three statements on Hartwell in one gesture, so the second receipt overwrote
 * the first and the third overwrote the second. Whichever file the banker came
 * back for, at most one of the three could be found. The inner map is keyed by
 * Boom's own file id and holds them in the order they were sent, which is the
 * order the room walks them back.
 */
const pending = new Map<string, Map<string, BoomFileHandle>>();

/** Boom has these bytes. Written the moment a file id exists, not when the room
 *  gives up waiting: a session can die anywhere in between. */
export function rememberBoomFile(accountId: string, handle: BoomFileHandle): void {
  const forAccount = pending.get(accountId) ?? new Map<string, BoomFileHandle>();
  forAccount.set(handle.fileId, handle);
  pending.set(accountId, forAccount);
  emit();
}

/** The file settled, or the banker walked away from it deliberately. */
export function forgetBoomFile(accountId: string, fileId: string): void {
  const forAccount = pending.get(accountId);
  if (!forAccount?.delete(fileId)) return;
  if (!forAccount.size) pending.delete(accountId);
  emit();
}

/** The files this relationship left with Boom, oldest first. */
export function pendingBoomFiles(accountId: string): BoomFileHandle[] {
  return [...(pending.get(accountId)?.values() ?? [])];
}

/** Tests. */
export function resetBoomFiles(): void {
  pending.clear();
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
