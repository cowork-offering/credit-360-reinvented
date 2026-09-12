import { useSyncExternalStore } from "react";
import { db } from "../channel/dbDoor";
import type { AccountRow, ActionHistoryRow, BorrowerBundle, C360Data, Id } from "../data/contract";
import { aggregateBorrower, READ_COUNT, type AggregatedBorrower } from "./aggregate";
import type { AccountMatch } from "./search";

/* =============================================================================
   THE BOOK IS NO LONGER THE FIVE THE SNAPSHOT BAKED.

   A relationship opened by name is READ out of the org and registered as a live
   borrower beside the baked ones. One merge point — `mergeDynamicBook`, applied
   once in the provider — so `resolveBundle`, the worklist, the palette, the
   workspace, both rooms and every tab pick it up without any of them learning a
   second way to find a bundle.

   THE MERGE IS IDENTITY WHEN THE MAP IS EMPTY. It returns the SAME OBJECT the
   provider was given, so a cockpit with no dynamic account opened is not merely
   equivalent to the one before this file: it is the same data object, and every
   memo below it sees the same reference it always did.

   THE CACHE IS THE STORE, KEYED `books/<accountId>`. A re-open is instant off
   the cache and refreshes behind itself; with no store there is no cache and
   every open is eight reads, which is the behaviour with the feature and no
   grant. Nothing here is a source of truth: the cache is what the org said last
   time, stamped, and the refresh replaces it wholesale.
   ============================================================================= */

export interface DynamicBorrower {
  accountId: Id;
  name: string;
  bundle: BorrowerBundle;
  row: AccountRow;
  history?: ActionHistoryRow[];
  /** When these reads landed. The page's own clock: a live gesture, not a
   *  figure derived from the book (A10 governs the latter, not this). */
  readAt: number;
  /** Served from the store's cache and being refreshed behind itself. */
  fromCache?: boolean;
  /** Reads that did not come back. Their slices are absent, never guessed. */
  missing?: string[];
}

export type DynamicBook = Record<Id, DynamicBorrower>;

interface BookState {
  book: DynamicBook;
  /** What the reads are doing, while they do it. Null when nothing is running. */
  progress: string | null;
}

let state: BookState = { book: {}, progress: null };
const listeners = new Set<() => void>();

function set(next: Partial<BookState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const bookSnapshot = (): DynamicBook => state.book;
const progressSnapshot = (): string | null => state.progress;

export function useDynamicBook(): DynamicBook {
  return useSyncExternalStore(subscribe, bookSnapshot, bookSnapshot);
}

export function useBookProgress(): string | null {
  return useSyncExternalStore(subscribe, progressSnapshot, progressSnapshot);
}

export const dynamicBook = (): DynamicBook => state.book;

/** Is this relationship already something the cockpit can open? Baked into the
 *  snapshot, or read live earlier in this session. */
export function bookHas(data: C360Data, accountId: Id): boolean {
  if ((data.borrowers ?? {})[accountId]) return true;
  if (data.borrower?.snapshot?.accountId === accountId) return true;
  return !!state.book[accountId];
}

/* -------------------------------------------------------------- the merge */

/**
 * The cockpit's data, with the live relationships in it.
 *
 * IDENTITY WHEN THERE ARE NONE. Called on every provider render, and returning
 * a fresh object each time would invalidate every memo in the tree.
 */
export function mergeDynamicBook(data: C360Data, book: DynamicBook): C360Data {
  const ids = Object.keys(book);
  if (!ids.length) return data;

  const borrowers: Record<Id, BorrowerBundle> = { ...(data.borrowers ?? {}) };
  const accounts = [...(data.portfolio?.accounts ?? [])];
  const seen = new Set(accounts.map((a) => a.accountId));

  for (const id of ids) {
    const live = book[id];
    borrowers[id] = live.bundle;
    // The row carries the freshness so the worklist can say "live read, 14:32"
    // without a second lookup into this module from a pure display function.
    const row: AccountRow = { ...live.row, liveReadAt: live.readAt };
    if (seen.has(id)) {
      const at = accounts.findIndex((a) => a.accountId === id);
      accounts[at] = { ...accounts[at], ...row };
    } else {
      accounts.push(row);
    }
  }

  /* AND IT EARNS A ROW IN THE QUEUE. Where the org staged its OWN worklist the
     candidate set is that list, so a relationship read live this session would
     be openable and invisible at the same time. Appending the id lets the
     derivation decide whether it has a reason; it never invents one, and it
     never reorders or removes a server row. */
  const worklist =
    data.worklist?.accountIds?.length
      ? { ...data.worklist, accountIds: [...data.worklist.accountIds, ...ids.filter((id) => !data.worklist!.accountIds.includes(id))] }
      : data.worklist;

  return { ...data, borrowers, portfolio: { ...data.portfolio, accounts }, worklist };
}

/* -------------------------------------------------------------- the cache */

const cachePath = (accountId: Id) => `books/${accountId}`;
/** A document body is capped at 256 KiB. A relationship whose reads serialise
 *  larger than this is simply not cached; it is re-read on the next open. */
const CACHE_CAP = 200_000;

interface CachedBook {
  storedAt: number;
  name: string;
  bundle: BorrowerBundle;
  row: AccountRow;
  history?: ActionHistoryRow[];
}

async function readCache(accountId: Id): Promise<CachedBook | null> {
  const store = db();
  if (!store) return null;
  try {
    const snap = await store.doc(cachePath(accountId)).get();
    if (!snap.exists) return null;
    const body = snap.data() as Partial<CachedBook> | undefined;
    // UNTRUSTED, like everything the store returns. A cached document that is
    // not a bundle is not half-read: it is a cache miss.
    if (!body || typeof body.storedAt !== "number") return null;
    const bundle = body.bundle as BorrowerBundle | undefined;
    if (!bundle || typeof bundle !== "object" || !bundle.snapshot) return null;
    const row = body.row as AccountRow | undefined;
    if (!row || typeof row.accountId !== "string" || typeof row.name !== "string") return null;
    return { storedAt: body.storedAt, name: body.name ?? row.name, bundle, row, history: body.history };
  } catch {
    return null;
  }
}

async function writeCache(entry: DynamicBorrower): Promise<void> {
  const store = db();
  if (!store) return;
  const body: CachedBook = {
    storedAt: entry.readAt,
    name: entry.name,
    bundle: entry.bundle,
    row: entry.row,
  };
  if (entry.history) body.history = entry.history;
  try {
    if (JSON.stringify(body).length > CACHE_CAP) return;
    await store.doc(cachePath(entry.accountId)).set(body as unknown as Record<string, unknown>);
  } catch {
    // A cache that will not take a write is a cache miss next time. Never the
    // banker's business, and never a reason not to open the room.
  }
}

/* --------------------------------------------------------------- the open */

const register = (entry: DynamicBorrower): void => set({ book: { ...state.book, [entry.accountId]: entry } });

const toEntry = (agg: AggregatedBorrower, readAt: number): DynamicBorrower => ({
  accountId: agg.accountId,
  name: agg.name,
  bundle: agg.bundle,
  row: agg.row,
  history: agg.history,
  readAt,
  missing: agg.missing,
});

/** The progress line, in banker language. Eight reads, and how many are in. */
const progressLine = (name: string, done: number) => `reading ${name}: ${READ_COUNT} reads, ${done} done`;

/**
 * OPEN A RELATIONSHIP THE SNAPSHOT NEVER BAKED.
 *
 * Cache first, then the eight reads. Resolves TRUE once the relationship is
 * something the cockpit can open — which is as soon as the fast reads have
 * landed, not when the graph has. The graph fills in behind the open room.
 *
 * Resolves FALSE where the org returned nothing readable. The caller says so;
 * nothing is registered and no room opens on an empty bundle.
 *
 * THE VIEW SWITCHES ON `onOpen`, NOT ON THE RESOLVE (2026-09-12, founder
 * latency brief: "110% zero latency and smooth transitions"). Callers used to
 * navigate in `.then()`, which is the moment the WHOLE aggregate has settled —
 * the relationship graph included, and the graph is the heaviest and
 * deliberately-last read in the set. So the banker sat on the worklist watching
 * a read they were never going to look at first. `onOpen` fires the instant the
 * relationship is navigable, which is the instant it is registered, and the
 * graph lands behind the open view exactly as it does for a cached open.
 */
export async function openAccountLive(args: {
  accountId: Id;
  /** The name to say while the reads run. The org's own name replaces it. */
  name: string;
  match?: AccountMatch | null;
  /** The relationship is registered and the cockpit can open it. Fired at most
   *  once, and never where the org had nothing readable. */
  onOpen?: () => void;
}): Promise<boolean> {
  const { accountId } = args;

  // Already in this session's book: nothing to do, and no second round of reads.
  if (state.book[accountId]) {
    args.onOpen?.();
    return true;
  }

  const cached = await readCache(accountId);
  if (cached) {
    register({
      accountId,
      name: cached.name,
      bundle: cached.bundle,
      row: cached.row,
      history: cached.history,
      readAt: cached.storedAt,
      fromCache: true,
    });
    args.onOpen?.();
    // AND IT REFRESHES BEHIND ITSELF. The banker is already in the room; the
    // reads replace what they came in on when they land.
    void refresh(accountId, args.match ?? null);
    return true;
  }

  set({ progress: progressLine(args.name, 0) });
  let opened = false;
  try {
    const agg = await aggregateBorrower({
      accountId,
      match: args.match ?? null,
      onProgress: (p) => set({ progress: progressLine(args.name, p.done) }),
      onReady: (partial) => {
        register(toEntry(partial, Date.now()));
        opened = true;
        set({ progress: null });
        args.onOpen?.();
      },
    });
    const entry = toEntry(agg, Date.now());
    register(entry);
    void writeCache(entry);
    return true;
  } catch {
    // An unreadable relationship is an honest no. The whisper and the palette
    // say so; nothing is registered.
    return opened;
  } finally {
    set({ progress: null });
  }
}

/** Re-read a relationship already in the live book, quietly. */
async function refresh(accountId: Id, match: AccountMatch | null): Promise<void> {
  try {
    const agg = await aggregateBorrower({ accountId, match });
    const entry = toEntry(agg, Date.now());
    register(entry);
    void writeCache(entry);
  } catch {
    // The cached read stands. It is stamped, and the row says when.
  }
}

/**
 * The whisper's hook. An intent naming a relationship the snapshot never baked
 * reads it FIRST, with the progress line up, and the room opens on the result.
 */
export const openProgress = (accountId: Id, name: string): Promise<boolean> =>
  openAccountLive({ accountId, name });

/**
 * SAY ONE THING, BRIEFLY, ON THE SAME LINE THE PROGRESS USES.
 *
 * For the one outcome a banker has to be told about: the org had nothing
 * readable for a relationship something asked the cockpit to open. It is a
 * sentence, not an error surface, and it takes itself away.
 */
export function announce(line: string, ms = 6000): void {
  set({ progress: line });
  if (typeof window === "undefined") return;
  window.setTimeout(() => {
    if (state.progress === line) set({ progress: null });
  }, ms);
}

/** Test seam. */
export function __resetBookForTests(): void {
  state = { book: {}, progress: null };
  for (const l of listeners) l();
}
