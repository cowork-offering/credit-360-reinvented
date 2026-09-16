import { useEffect, useState, useSyncExternalStore } from "react";

import { withDeadline } from "./deadline";
import {
  allBoomReceipts,
  forgetBoomFile,
  rememberBoomFile,
  subscribeBoomReceipts,
  type SpreadAccountRef,
} from "./spreadSession";
import type { BoomAdapter, BoomFileStatus, BoomUploadResult } from "../../spread/types";

/* =============================================================================
   THE WAIT FOLLOWS THE BANKER (0.9.31).

   FOUNDER, 2026-09-16, after the first live Boom drop: "so i can leave the
   workroom of spreading and there is a progress indicator somewhere?"

   Until 0.9.31 the poll lived INSIDE the Spreading room's engine. Close the
   room and the loop died with the component; nothing anywhere on the cockpit
   said Boom was still reading, and the spread waited for a re-entry that had to
   rebuild the wait from scratch. Boom takes five to seven minutes on a real
   statement set, which is longer than anyone sits in one room.

   SO THE POLL LIVES HERE, AT PAGE LEVEL, KEYED ON THE PERSISTED RECEIPTS
   (`spreadSession.ts`). One poll PER FILE, started the moment a receipt exists
   and ended only when Boom puts the file somewhere terminal. Closing the room,
   switching relationship and reloading the page all leave it running: the room
   SUBSCRIBES to a ticket rather than owning a loop, and a room re-entered on a
   file already being watched joins the poll instead of starting a second.

   WHAT THIS MODULE IS NOT. It holds no room copy and no room state: the rows,
   the notice, the stall doors and the two-minute budget are the ROOM's clock
   over these observations (`spreadEngine.ts`). What lives here is the loop, the
   receipt lifecycle, the per-relationship tally the header indicator reads, and
   the arrival.

   THE 0.9.29 RULES ARE CARRIED WHOLE, because they were right and the bug they
   closed was expensive. A rejected `boom_await_file` or `boom_get_file` says
   NOTHING about the file: the rung stays where Boom last put it, the poll
   re-arms, and after two consecutive misses the loop drops from the blocking
   wait to the plain read. Only Boom's own `failed` rung ends a file badly.
   ============================================================================= */

/** What has to survive a closed room, and now a reloaded page, for the wait to
 *  be picked back up. */
export interface BoomFileHandle {
  fileId: string;
  companyId: string | null;
  fileName: string;
  /** When the room first sent it, so a resumed wait can say how long it has been. */
  startedAt: number;
  /** The file's own size. The only thing the honest expectation line has to go
   *  on: "sets this size" is a claim about bytes, not about file count. */
  bytes?: number;
}

/** How often the loop asks Boom where a file has got to. */
export const POLL_EVERY_MS = 1_200;

/**
 * Seconds handed to ONE `boom_await_file`.
 *
 * TEN, AND THE NUMBER IS THE FIX (founder, 2026-09-15 19:37 UTC). It was
 * twenty, chosen against the SERVER's 25-second ceiling, and the ceiling was
 * never the binding clock: a read at the connector seam carries
 * `READ_DEADLINE_MS`, fifteen seconds, so a wait asked to block for twenty
 * could not answer inside the page's own budget under any circumstances.
 *
 * Ten seconds plus the relay hop is `awaitDeadlineMs` (`channel/boomUpload.ts`),
 * which the live adapter hands the seam explicitly, so this number and the
 * clock over it move together. 0.9.31 did not widen it: the poll is longer
 * now, each call is not.
 */
export const BOOM_AWAIT_SECONDS = 10;

/**
 * Consecutive wait REJECTIONS before the loop stops blocking and reads instead.
 *
 * `boom_await_file` holds a socket open for its whole answer; `boom_get_file`
 * answers at once. Where the blocking call is the thing the transport cannot
 * carry, asking it a third time is asking the same question of the same broken
 * pipe. Two is enough to tell a blip from a shape.
 */
export const BOOM_AWAIT_MISS_FALLBACK = 2;

/** How long the arrival stays LIT before it settles into its quiet pill.
 *  Two beats: one is the `>` law's own beat and too short to read a sentence
 *  in, and anything longer stops being a marker and becomes a banner. */
const ARRIVAL_MARKER_MS = 920;

/* ------------------------------------------------------------ what is seen */

/** One file, as the poll last saw it. The room reads this and nothing else. */
export interface BoomObservation {
  fileId: string;
  fileName: string;
  /** The last rung BOOM named. A missed call never moves it. */
  status: BoomFileStatus;
  /** Boom's own words, where it gave any. */
  message: string | null;
  /** The last call did not come back. The file is exactly where it was. */
  checking: boolean;
  startedAt: number;
  /** Boom's terminal answer, with the spread on it. */
  result: BoomUploadResult | null;
}

/** What one watched file left behind. `open` says the ROOM stopped watching
 *  while Boom still holds it; the page-level poll never stops that way. */
export interface BoomWatchOutcome {
  result: BoomUploadResult | null;
  open: boolean;
}

/** The room's handle on one file's poll. */
export interface BoomTicket {
  fileId: string;
  get(): BoomObservation;
  subscribe(listener: () => void): () => void;
  settled: Promise<BoomWatchOutcome>;
}

interface Watch extends BoomObservation {
  accountId: string;
  accountName: string;
  bytes: number;
  settled: Promise<BoomWatchOutcome>;
}

/** Per relationship, the batch of files this page is waiting on. What the
 *  header indicator counts: "2 of 3 files". */
export interface BoomWait extends SpreadAccountRef {
  /** The earliest file in the batch, so the clock is the wait's, not a file's. */
  startedAt: number;
  total: number;
  done: number;
  /** Every byte in the batch, which is what "sets this size" is measured on. */
  bytes: number;
}

/** One file the page watched all the way to a rung Boom settled it on. It is
 *  what the room walks back in to: the receipt's facts, and Boom's own answer
 *  with the spread on it. */
export interface BoomArrivalFile {
  fileId: string;
  fileName: string;
  bytes: number;
  startedAt: number;
  status: BoomFileStatus;
  message: string | null;
  result: BoomUploadResult | null;
}

/** A batch that landed, and whether the banker has looked at it yet. */
export interface BoomArrival extends SpreadAccountRef {
  at: number;
  /** The period Boom spread, where its answer named one. */
  period: string | null;
  /** Boom's own words, where the batch ended on its `failed` rung. */
  failure: string | null;
  /**
   * THE SPREAD ITSELF, HELD UNTIL THE BANKER LOOKS.
   *
   * The receipt is cleared the moment Boom settles a file, which is right: the
   * bytes are no longer in flight. But the ANSWER has to survive that, or a
   * banker who walked away comes back to a drop zone and the spread they were
   * brought a marker about is nowhere. The room reads this on the way in and
   * settles onto it without asking Boom a second time.
   */
  files: BoomArrivalFile[];
}

const watches = new Map<string, Watch>();
/** Files that settled and have not been folded into an arrival yet. */
const settledFiles = new Map<string, BoomArrivalFile[]>();
const waits = new Map<string, BoomWait>();
const arrivals = new Map<string, BoomArrival>();
/** Arrivals whose marker beat has not yet run out. */
const lit = new Set<string>();

const storeListeners = new Set<() => void>();
let version = 0;

function bumped(): void {
  version += 1;
  for (const l of storeListeners) l();
}

/* -------------------------------------------------- what Boom has taken so far

   THE EXPECTATION LINE IS OBSERVED OR IT IS ABSENT (design 0.9.31). "Boom's
   last N sets this size took about 5 to 7 minutes" is a claim, and the only
   honest source for it is what THIS page has watched Boom do. Nothing is
   seeded, nothing is averaged in from a constant, and before the first
   observation the line simply is not drawn. */

interface BoomObserved {
  bytes: number;
  ms: number;
}

const OBSERVED_KEY = "c360:boom:observed";
/** Sets within a factor of this of each other count as "this size". */
const SIZE_BAND = 4;
const KEEP_OBSERVED = 12;

let observed: BoomObserved[] | null = null;

function readObserved(): BoomObserved[] {
  if (observed) return observed;
  observed = [];
  try {
    const raw = sessionStorage.getItem(OBSERVED_KEY);
    const rows = raw ? (JSON.parse(raw) as BoomObserved[]) : [];
    if (Array.isArray(rows)) {
      observed = rows.filter((r) => typeof r?.bytes === "number" && typeof r?.ms === "number" && r.ms > 0);
    }
  } catch {
    /* nothing observed is the state the line is written for */
  }
  return observed;
}

function noteObserved(bytes: number, ms: number): void {
  if (!(bytes > 0) || !(ms > 0)) return;
  const rows = [...readObserved(), { bytes, ms }].slice(-KEEP_OBSERVED);
  observed = rows;
  try {
    sessionStorage.setItem(OBSERVED_KEY, JSON.stringify(rows));
  } catch {
    /* the line is then only as long as this document */
  }
}

/** Every set this page has watched Boom finish at about this size. */
function boomObservations(bytes: number): BoomObserved[] {
  if (!(bytes > 0)) return [];
  return readObserved().filter((o) => o.bytes > 0 && o.bytes / bytes <= SIZE_BAND && bytes / o.bytes <= SIZE_BAND);
}

/**
 * The one honest line about how long this will take, or null.
 *
 * NO CONSTANT EVER REACHES IT. N is how many sets of about this size this page
 * has watched, and the minutes are the fastest and the slowest of them, rounded
 * to whole minutes because Boom's own spread is minutes long and a banker
 * reading seconds would be reading noise.
 */
export function boomExpectationLine(bytes: number): string | null {
  const seen = boomObservations(bytes);
  if (!seen.length) return null;
  const mins = seen.map((o) => Math.max(1, Math.round(o.ms / 60_000)));
  const low = Math.min(...mins);
  const high = Math.max(...mins);
  const sets = `${seen.length} set${seen.length === 1 ? "" : "s"}`;
  const span = low === high ? `about ${low} minute${low === 1 ? "" : "s"}` : `about ${low} to ${high} minutes`;
  return `Boom's last ${sets} this size took ${span}.`;
}

/* ------------------------------------------------------------- the one loop */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const WAITING: ReadonlySet<BoomFileStatus> = new Set<BoomFileStatus>(["processing", "waiting_for_upload"]);

/**
 * Wait on one file until Boom has it somewhere terminal.
 *
 * THE SERVER OWNS THE BLOCKING (`boom_await_file`) and this owns the sequence.
 * Where an adapter offers no bounded wait it polls `status` on its own clock
 * instead, which is the same shape a beat slower.
 *
 * THERE IS NO TOTAL BUDGET HERE, and that is the whole of 0.9.31. The budget
 * belonged to a room a banker was sitting in; this loop is the promise that the
 * room made on its way out ("I will keep checking"), and it ends when Boom ends
 * it. The room's two-minute statement and its stall doors are unchanged and
 * still the room's, applied over these observations.
 *
 * A WAIT THAT FAILED IS NOT A FILE THAT FAILED. Once a file id exists the bytes
 * are Boom's, and the only thing a rejected call can mean is that the PAGE did
 * not hear back. Every such rejection is a miss: the rung stays, `checking`
 * says so, and the poll re-arms.
 */
async function poll(watch: Watch, adapter: BoomAdapter, first?: BoomUploadResult): Promise<BoomWatchOutcome> {
  let latest: BoomUploadResult =
    first ?? { fileId: watch.fileId, companyId: null, fileGroupId: null, status: "processing" };
  let misses = 0;
  /** A `status` answer has been taken SINCE the file became readable, which is
   *  the only answer that carries the statements: the wait reports a rung and
   *  nothing else. */
  let readFull = false;
  /** NOTHING IS KNOWN ABOUT THIS FILE YET, so the first call is the plain read
   *  rather than the blocking wait. It is the resume's case: a file the page is
   *  picking back up may already have settled while the room was shut, and
   *  `boom_get_file` answers at once and carries the spread with it. */
  let unread = first === undefined;
  const waiting = () => WAITING.has(latest.status);

  const seen = (patch: Partial<BoomObservation>) => {
    Object.assign(watch, patch);
    bumped();
  };
  seen({ status: latest.status, message: latest.message ?? null, checking: false });

  for (;;) {
    if (!watches.has(watch.fileId)) return { result: null, open: true };

    if (latest.status === "failed") {
      seen({ status: "failed", message: latest.message ?? null, checking: false });
      return { result: null, open: false };
    }
    if (!waiting() && readFull) {
      seen({ status: latest.status, message: latest.message ?? null, checking: false, result: latest });
      return { result: latest, open: false };
    }

    /* WHICH CALL. The blocking wait while the file is moving and the transport
       is carrying it; the plain read once Boom is ready (it is the answer that
       carries the spread) or once the blocking call has missed twice in a row. */
    const blocking = !unread && waiting() && Boolean(adapter.awaitSettled) && misses < BOOM_AWAIT_MISS_FALLBACK;
    unread = false;
    try {
      /* A FLOOR UNDER THE LOOP, WHATEVER THE ADAPTER DOES. The server's own wait
         blocks for its seconds, so the pause is normally its. An adapter that
         answers instantly would otherwise spin this loop as fast as the event
         loop allows and hammer the connector for as long as Boom takes. */
      const askedAt = Date.now();
      latest = blocking
        ? await withDeadline(
            (signal) => adapter.awaitSettled!(latest.fileId, BOOM_AWAIT_SECONDS, { signal }),
            "stage",
            `${watch.fileName} at Boom`,
          )
        : await withDeadline((signal) => adapter.status(latest.fileId, { signal }), "read", `${watch.fileName} at Boom`);
      misses = 0;
      readFull = !blocking && !waiting();
      seen({ status: latest.status, message: latest.message ?? null, checking: false });
      if (waiting() && Date.now() - askedAt < POLL_EVERY_MS) await sleep(POLL_EVERY_MS);
    } catch {
      /* THE MISS. Nothing about the FILE changed, so nothing on its row does
         either: `latest` is untouched and the loop asks again. The only visible
         effect is `checking`, which the room says out loud. */
      misses += 1;
      seen({ checking: true });
      await sleep(POLL_EVERY_MS);
    }
  }
}

/* ---------------------------------------------------------- the page's view */

function tally(account: SpreadAccountRef, startedAt: number, bytes: number): void {
  const wait = waits.get(account.accountId);
  if (!wait) {
    waits.set(account.accountId, { ...account, startedAt, total: 1, done: 0, bytes });
    return;
  }
  wait.total += 1;
  wait.bytes += bytes;
  wait.accountName = account.accountName || wait.accountName;
  wait.startedAt = Math.min(wait.startedAt, startedAt);
}

/** The batch this file belonged to has nothing left in flight. */
function arrive(wait: BoomWait, watch: Watch): void {
  waits.delete(wait.accountId);
  const files = settledFiles.get(wait.accountId) ?? [];
  settledFiles.delete(wait.accountId);
  const statements = files.flatMap((f) => f.result?.financialStatements ?? []);
  arrivals.set(wait.accountId, {
    accountId: wait.accountId,
    accountName: wait.accountName,
    at: Date.now(),
    period: periodOf(statements),
    failure: watch.status === "failed" ? watch.message : null,
    files,
  });
  lit.add(wait.accountId);
  setTimeout(() => {
    lit.delete(wait.accountId);
    bumped();
  }, ARRIVAL_MARKER_MS);
}

/** The period Boom spread, as the room's own labels read it. Null where the
 *  answer named no end date, which is a state and not a gap to fill. */
function periodOf(statements: BoomUploadResult["financialStatements"]): string | null {
  const ends = (statements ?? []).map((s) => s.endDate).filter((d): d is string => Boolean(d));
  if (!ends.length) return null;
  const end = ends.slice().sort().at(-1) as string;
  const year = end.slice(0, 4);
  return /^\d{4}$/.test(year) ? `FY${year}` : end;
}

/**
 * START OR JOIN THE POLL ON ONE FILE.
 *
 * ONE POLL PER FILE, and the dedupe is the point: the room re-entered on a file
 * the page is already watching takes the SAME ticket, so a banker walking in and
 * out of the room three times costs Boom one loop and not three.
 *
 * The receipt is written here, the moment there is a file id, and cleared here,
 * the moment Boom settles the file. Nothing else owns that lifecycle.
 */
export function watchBoomFile(args: {
  account: SpreadAccountRef;
  handle: BoomFileHandle;
  adapter: BoomAdapter;
  /** The answer that produced the file id, where the caller has one. */
  first?: BoomUploadResult;
}): BoomTicket {
  const { account, handle, adapter } = args;
  const existing = watches.get(handle.fileId);
  if (existing) return ticketFor(existing);

  /* THE STORE IS WRITTEN BEFORE THE RECEIPT IS, and the order is the whole
     guard. `rememberBoomFile` wakes the page watcher's own subscription, which
     immediately asks whether this file is being watched; with the receipt
     written first that question was answered no and a SECOND loop opened on the
     same file, counted twice on the header. The watch goes in first, so the
     re-entrant caller finds it and joins. */
  let landed: (outcome: BoomWatchOutcome) => void = () => {};
  const watch: Watch = {
    accountId: account.accountId,
    accountName: account.accountName,
    fileId: handle.fileId,
    fileName: handle.fileName,
    bytes: handle.bytes ?? 0,
    status: args.first?.status ?? "processing",
    message: args.first?.message ?? null,
    checking: false,
    startedAt: handle.startedAt,
    result: null,
    settled: new Promise<BoomWatchOutcome>((resolve) => {
      landed = resolve;
    }),
  };
  watches.set(handle.fileId, watch);
  tally(account, handle.startedAt, watch.bytes);
  rememberBoomFile(account, handle);

  void poll(watch, adapter, args.first).then((outcome) => {
    const wait = waits.get(watch.accountId);
    watches.delete(watch.fileId);
    forgetBoomFile(watch.accountId, watch.fileId);
    if (!outcome.open) {
      const held = settledFiles.get(watch.accountId) ?? [];
      held.push({
        fileId: watch.fileId,
        fileName: watch.fileName,
        bytes: watch.bytes,
        startedAt: watch.startedAt,
        status: watch.status,
        message: watch.message,
        result: watch.result,
      });
      settledFiles.set(watch.accountId, held);
    }
    if (wait) {
      wait.done += 1;
      const stillGoing = [...watches.values()].some((w) => w.accountId === watch.accountId);
      if (!stillGoing) {
        noteObserved(wait.bytes, Date.now() - wait.startedAt);
        arrive(wait, watch);
      }
    }
    bumped();
    landed(outcome);
  });

  bumped();
  return ticketFor(watch);
}

function ticketFor(watch: Watch): BoomTicket {
  return {
    fileId: watch.fileId,
    get: () => ({
      fileId: watch.fileId,
      fileName: watch.fileName,
      status: watch.status,
      message: watch.message,
      checking: watch.checking,
      startedAt: watch.startedAt,
      result: watch.result,
    }),
    /* EVERY CHANGE, NOT JUST THIS FILE'S. The store bumps once per observation
       and the room reads the ticket on each bump; a second listener set per
       file would be a second bookkeeping for the same event. */
    subscribe,
    settled: watch.settled,
  };
}

/**
 * THE PAGE PICKS THE WAIT BACK UP.
 *
 * Called once from the shell. Every receipt this browser left behind gets its
 * poll straight away, and every receipt written later (the room's own ladder,
 * or a resume that recovered handles from `boom_list_files`) gets one as it
 * lands. The receipts are the key; nothing here knows about a room.
 */
export function startBoomWatcher(adapter: BoomAdapter): () => void {
  const ensure = () => {
    for (const account of allBoomReceipts()) {
      for (const handle of account.files) {
        if (watches.has(handle.fileId)) continue;
        watchBoomFile({ account, handle, adapter });
      }
    }
  };
  ensure();
  return subscribeBoomReceipts(ensure);
}

/* ------------------------------------------------------------- the surfaces */

function subscribe(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

const snapshot = () => version;

/** Newest first: a banker who just dropped a set is looking for that one. */
export function boomWaits(): BoomWait[] {
  return [...waits.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Arrivals the banker has not looked at, newest first. */
export function boomArrivals(): Array<BoomArrival & { marker: boolean }> {
  return [...arrivals.values()]
    .sort((a, b) => b.at - a.at)
    .map((a) => ({ ...a, marker: lit.has(a.accountId) }));
}

/** What this relationship's last arrival landed, without clearing it. The room
 *  reads it on the way in and settles onto it rather than asking Boom again. */
export function boomArrivalFiles(accountId: string): BoomArrivalFile[] {
  return arrivals.get(accountId)?.files ?? [];
}

/** The banker looked. Every door into that Spreading room counts as looking. */
export function lookedAtBoom(accountId: string): void {
  if (!arrivals.delete(accountId)) return;
  lit.delete(accountId);
  bumped();
}

/** Is Boom reading, or has it just finished, for this relationship. The
 *  worklist row's own question. */
export function boomRowState(accountId: string): "reading" | "arrived" | null {
  if (waits.has(accountId)) return "reading";
  return arrivals.has(accountId) ? "arrived" : null;
}

/** One subscription for every surface that draws the wait. */
export function useBoomWatch(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * THE WALL CLOCK, TICKING, for the one thing on these surfaces that moves by
 * itself: how long Boom has been reading. `everyMs` of zero is a clock that is
 * not running, which is every surface with no wait on it and every jsdom test.
 *
 * NOT MOTION. An elapsed figure that stopped counting would be a wrong figure,
 * so reduced motion does not silence it; what reduced motion silences is the
 * choreography around it.
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!everyMs) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Tests, and the suite is many page sessions. */
export function resetBoomWatch(): void {
  watches.clear();
  settledFiles.clear();
  waits.clear();
  arrivals.clear();
  lit.clear();
  observed = null;
  try {
    sessionStorage.removeItem(OBSERVED_KEY);
  } catch {
    /* nothing to clear */
  }
  bumped();
}
