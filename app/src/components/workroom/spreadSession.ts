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

   AND SINCE 0.9.31 THE RECEIPTS SURVIVE THE PAGE. They were module memory, so a
   reload lost every one of them while Boom was still spreading and the wait had
   to be rebuilt from `boom_list_files`. They are written to `sessionStorage`
   now, in the same envelope shape `state/persist.ts` uses (version, savedAt, a
   day) and with the same silent degradation where storage is not there: the
   receipts are what the page-level poll is keyed on (`boomWatch.ts`), so losing
   them is losing the wait the banker was promised.

   THE RELATIONSHIP'S NAME TRAVELS WITH THEM, because the surface that reads
   them is no longer inside the room. The header says which relationship Boom is
   reading for and clicking it opens that room; a page reloaded mid-wait has no
   book to look that name up in until the worklist has landed.
   ============================================================================= */

export interface SpreadSession {
  accountId: string;
  accountName: string;
}

/** The relationship a receipt belongs to: which one, and what to call it. */
export interface SpreadAccountRef {
  accountId: string;
  accountName: string;
}

/** Every file one relationship has left with Boom, oldest first. */
export interface BoomReceipts extends SpreadAccountRef {
  files: BoomFileHandle[];
}

let session: SpreadSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the Spreading room on a relationship. The opener the arc calls. */
export function openSpreadingRoom(context: SpreadAccountRef): void {
  session = { accountId: context.accountId, accountName: context.accountName };
  emit();
}

/* ------------------------------------------------------- the file receipts */

interface AccountReceipts {
  accountName: string;
  files: Map<string, BoomFileHandle>;
}

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
const pending = new Map<string, AccountReceipts>();

const receiptListeners = new Set<() => void>();
let receiptsVersion = 0;

const STORE_KEY = "c360:boom:receipts";
const STORE_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredEnvelope {
  v: number;
  savedAt: number;
  accounts: BoomReceipts[];
}

let loaded = false;

/** The receipts this browser left behind, read once per page. A blob of another
 *  version, or one older than a day, is dropped rather than half-read: a file
 *  Boom was spreading yesterday is not this session's work. */
function hydrate(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return;
    const env = JSON.parse(raw) as StoredEnvelope;
    if (!env || env.v !== STORE_VERSION) return;
    if (typeof env.savedAt !== "number" || Date.now() - env.savedAt > MAX_AGE_MS) return;
    for (const account of env.accounts ?? []) {
      if (!account?.accountId || !Array.isArray(account.files)) continue;
      const files = new Map<string, BoomFileHandle>();
      for (const h of account.files) if (h?.fileId) files.set(h.fileId, h);
      if (files.size) pending.set(account.accountId, { accountName: account.accountName || account.accountId, files });
    }
  } catch {
    /* an unreadable blob is no receipt at all */
  }
}

function persist(): void {
  try {
    const accounts = [...pending.entries()].map(([accountId, r]) => ({
      accountId,
      accountName: r.accountName,
      files: [...r.files.values()],
    }));
    if (!accounts.length) sessionStorage.removeItem(STORE_KEY);
    else sessionStorage.setItem(STORE_KEY, JSON.stringify({ v: STORE_VERSION, savedAt: Date.now(), accounts }));
  } catch {
    /* storage unavailable: the wait is then only as long as this document */
  }
}

function changed(): void {
  receiptsVersion += 1;
  persist();
  for (const l of receiptListeners) l();
}

/** Boom has these bytes. Written the moment a file id exists, not when the room
 *  gives up waiting: a session can die anywhere in between. */
export function rememberBoomFile(account: SpreadAccountRef, handle: BoomFileHandle): void {
  hydrate();
  const forAccount = pending.get(account.accountId) ?? { accountName: account.accountName, files: new Map() };
  if (account.accountName) forAccount.accountName = account.accountName;
  pending.set(account.accountId, forAccount);
  if (forAccount.files.has(handle.fileId)) return;
  forAccount.files.set(handle.fileId, handle);
  changed();
}

/** The file settled, or the banker walked away from it deliberately. */
export function forgetBoomFile(accountId: string, fileId: string): void {
  hydrate();
  const forAccount = pending.get(accountId);
  if (!forAccount?.files.delete(fileId)) return;
  if (!forAccount.files.size) pending.delete(accountId);
  changed();
}

/** The files this relationship left with Boom, oldest first. */
export function pendingBoomFiles(accountId: string): BoomFileHandle[] {
  hydrate();
  return [...(pending.get(accountId)?.files.values() ?? [])];
}

/** Every relationship with work still at Boom. What the page-level poll is
 *  keyed on, and the only record a reloaded page opens with. */
export function allBoomReceipts(): BoomReceipts[] {
  hydrate();
  return [...pending.entries()].map(([accountId, r]) => ({
    accountId,
    accountName: r.accountName,
    files: [...r.files.values()],
  }));
}

/** The receipts changed. The page-level watcher is the one subscriber. */
export function subscribeBoomReceipts(listener: () => void): () => void {
  receiptListeners.add(listener);
  return () => receiptListeners.delete(listener);
}

/** Tests. */
export function resetBoomFiles(): void {
  pending.clear();
  loaded = true;
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing to clear */
  }
  changed();
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
