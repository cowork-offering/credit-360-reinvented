import { db } from "./dbDoor";

/* =============================================================================
   LAST GOOD: the org's answers, kept where the next open can find them.

   THE DEFECT THIS CLOSES. On 2026-09-03 the artifact-to-connector relay lost
   its Salesforce session for two hours. The page had nothing but the baked
   snapshot and whatever this browser happened to have in localStorage, so a
   banker on a second machine, or in a fresh window, watched empty modules under
   a red line for two hours. Empty is the one thing the figures were not: they
   were true at 22:14 the night before, and saying so is both more useful and
   more honest than showing nothing.

   So every successful READ is written to the artifact's own store, per account
   and per slice, with the freshness stamp the connector gave it. On open the
   stored documents are painted first, marked with their age, and the live reads
   land over them.

   WHAT IS NEVER WRITTEN HERE, and the rule is absolute: nothing from the write
   path. No staged plans, no plan hashes, no decision tokens, no idempotency
   keys, and no intents. A token that survives in a shared store is a token
   somebody else can replay, and the confirm gate's whole contract is that one
   banker saw one plan. READS ONLY.

   THE STORE IS SHARED AND IT IS UNTRUSTED. Every viewer of this artifact can
   write to it, so nothing read back is believed on sight: each document is
   shape-checked here before a single figure reaches a surface, exactly as the
   intent lane checks its own documents.

   ABSENCE IS THE COMMON CASE. With no `db` grant every function here is a
   silent no-op and the cockpit renders exactly as it did before this file
   existed.
   ============================================================================= */

/** `cache/accounts/<accountId>` is the collection; the slice is the document. */
const ROOT = "cache/accounts";

/** One stored read. Small on purpose: the payload is the tool's own answer,
 *  unshaped, because the surfaces render it and stripping it here would put a
 *  hole in a module the page believes it filled. */
export interface CachedRead {
  /** The connector's own freshness stamp, or the page's clock when it gave none. */
  storedAt: number;
  /** The tool that produced it, so a stored answer can always be traced. */
  tool: string;
  payload: unknown;
  /** Present only when the READ BACKUP answered instead of Customer 360. A
   *  backup answer is a good answer (same org, same envelope, same instant),
   *  so it is stored like any other, and the stamp is there so a stored
   *  document can always say which door it came through. Absent means the
   *  primary lane, which is what every document written before the backup
   *  existed says by saying nothing. */
  via?: "gateway";
}

/** A single document past this size is not worth a quota error on somebody
 *  else's write. Skipped whole rather than truncated: half a covenant set
 *  rendered as the covenant set is worse than no cache at all. */
export const MAX_DOC_BYTES = 180 * 1024;

/** Documents older than this are not painted. A figure from last week under a
 *  banker's eye is worse than an honest gap, however well it is labelled. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Shape-check one document off the shared store. Anything malformed is
 *  dropped whole; there is no half-read cached slice. */
export function readCachedDoc(raw: unknown, now: number = Date.now()): CachedRead | null {
  if (!isRecord(raw)) return null;
  const storedAt = raw.storedAt;
  const tool = raw.tool;
  if (typeof storedAt !== "number" || !Number.isFinite(storedAt)) return null;
  if (typeof tool !== "string" || !tool) return null;
  // A stamp from the future is a broken clock somewhere, not fresher data.
  if (storedAt > now + 60_000) return null;
  if (now - storedAt > MAX_AGE_MS) return null;
  if (raw.payload === undefined || raw.payload === null) return null;
  // Anything but the one word this field can carry is dropped rather than
  // rendered: the store is shared, and a document is only as trusted as its
  // shape check.
  return raw.via === "gateway"
    ? { storedAt, tool, payload: raw.payload, via: "gateway" }
    : { storedAt, tool, payload: raw.payload };
}

/**
 * Remember one successful read.
 *
 * Fire-and-forget: a failed write is bookkeeping nobody is waiting on, and the
 * banker already has the live figures on screen.
 */
export async function putLastGood(
  accountId: string,
  slice: string,
  tool: string,
  payload: unknown,
  storedAt: number = Date.now(),
  via?: "gateway",
): Promise<void> {
  const store = db();
  if (!store || !accountId || !slice) return;
  const doc: CachedRead = via ? { storedAt, tool, payload, via } : { storedAt, tool, payload };
  let serialised: string;
  try {
    serialised = JSON.stringify(doc);
  } catch {
    // A payload with a cycle in it is not a payload this page rendered from.
    return;
  }
  if (serialised.length > MAX_DOC_BYTES) return;
  try {
    await store.collection(`${ROOT}/${accountId}`).doc(slice).set(doc as unknown as Record<string, unknown>);
  } catch {
    // No grant, no quota, no network. The page is unaffected either way.
  }
}

/**
 * Every stored read for one account, by slice.
 *
 * ONE collection read, not one per slice: the open path pays for this before
 * the live reads land, so it has to be a single round trip.
 */
export async function loadLastGood(accountId: string, now: number = Date.now()): Promise<Record<string, CachedRead>> {
  const store = db();
  if (!store || !accountId) return {};
  try {
    const snap = await store.collection(`${ROOT}/${accountId}`).get();
    const out: Record<string, CachedRead> = {};
    for (const d of snap?.docs ?? []) {
      if (!d?.exists) continue;
      const doc = readCachedDoc(d.data(), now);
      if (doc) out[d.id] = doc;
    }
    return out;
  } catch {
    return {};
  }
}

/* =============================================================================
   THE BOOK CACHE: the org's LANDING, kept where the next open can find it.

   The per-account store above keeps the six DETAIL reads for a relationship the
   banker opened. This keeps the one read the LANDING stands on: the org-wide
   Customer360Portfolio answer that the KPI band, the briefing line and the
   queue are all built from.

   THE DEFECT THIS CLOSES. The cockpit ships with a BAKED book of five test
   relationships, three of them samples, there so a share link with no connector
   still shows a page. On a real seat the live Portfolio read replaces it, but
   that read takes a few seconds, so every open painted the five, then swapped
   to the org's real book under the banker's eye. A returning viewer should see
   the book they saw last, marked with its age, and the live read should settle
   over it, identically when nothing moved so nothing on screen jumps.

   ONE DOCUMENT, not a collection. The book is org-wide, not per-account, so it
   is a single `cache/book` doc, read in one round trip on open beside the
   account stores. Same screening at the door, same age ceiling, same absolute
   READS-ONLY rule as everything else in this file, and the same silent no-op
   when there is no `db` grant.
   ============================================================================= */

/** `cache/book` — one document, the whole book. `cache` is the same collection
 *  the per-account stores hang their `accounts` document under, so the book
 *  sits beside them as a sibling doc rather than in a store of its own. */
const BOOK_COLLECTION = "cache";
const BOOK_DOC = "book";

/**
 * Remember the org's book. Fire-and-forget, exactly like `putLastGood`: the
 * banker already has the live figures, and a failed cache write is bookkeeping
 * nobody is waiting on.
 */
export async function putBook(
  tool: string,
  payload: unknown,
  storedAt: number = Date.now(),
  via?: "gateway",
): Promise<void> {
  const store = db();
  if (!store) return;
  const doc: CachedRead = via ? { storedAt, tool, payload, via } : { storedAt, tool, payload };
  let serialised: string;
  try {
    serialised = JSON.stringify(doc);
  } catch {
    return;
  }
  if (serialised.length > MAX_DOC_BYTES) return;
  try {
    await store.collection(BOOK_COLLECTION).doc(BOOK_DOC).set(doc as unknown as Record<string, unknown>);
  } catch {
    // No grant, no quota, no network. The landing is unaffected either way.
  }
}

/**
 * The org's last good book, or null. One document, shape-checked exactly as a
 * per-account slice is: a malformed or stale document is dropped whole rather
 * than painted, and an absent `db` grant is null with no error.
 */
export async function loadBook(now: number = Date.now()): Promise<CachedRead | null> {
  const store = db();
  if (!store) return null;
  try {
    const snap = await store.collection(BOOK_COLLECTION).doc(BOOK_DOC).get();
    if (!snap?.exists) return null;
    return readCachedDoc(snap.data(), now);
  } catch {
    return null;
  }
}
