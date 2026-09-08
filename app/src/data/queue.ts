/* =============================================================================
   THE QUEUE: what the landing decides deserves a row, decided ON THE PAGE.

   FOUNDER, 2026-09-08, asking how the cockpit chooses, and blessing the change
   on three conditions in his own words: "it should not bring latency / stucking
   behaviour and needs to be smooth and easy to understand."

   WHAT WAS WRONG. Membership was baked at rebuild time: `worklist.accountIds`
   in the snapshot, decided by whoever last ran the assembler, with three SAMPLE
   relationships in it that do not exist in the org. The page refreshed the
   FIGURES on those rows and never asked whether the rows were still the right
   ones. Seed seven new relationships into the org and not one of them reaches
   the landing, because the landing was reading a list from July.

   WHAT IT IS NOW. One Portfolio read already lands on every open (the KPI
   band's watch). That read carries every packaged account with its rollups and
   the org's own signal block, so the queue is derived from it, here, on the
   page. No new connector call: the same watch, read by one more consumer.

   THE ORDER, and it is the founder's:
     CLIENT_REQUEST  a human is waiting (A30.4, unchanged and still first)
     COVENANT_BREACH
     COVENANT_EXCEPTION
     COVENANT_DUE    OVERDUE first, then merely due
     MATURITY_NEAR
     MODIFICATION_CLUSTER
     GUARANTOR_SIGNAL
     RECENTLY_MODIFIED
   Ties break on committed exposure, largest first.

   WHAT ONE PORTFOLIO READ CAN AND CANNOT SAY, stated plainly because the order
   above reads as if it could say all of it. `covenantsDueSoon` names accounts
   and flags the overdue ones; `maturitiesSoon` names accounts. `breachedCount`
   is BOOK-WIDE and names nobody. So `COVENANT_BREACH`, `COVENANT_EXCEPTION`,
   `CLIENT_REQUEST`, the modification signals and the guarantor signal rank from
   a STAGED BUNDLE, which the baked five and every relationship opened this
   session have. An account breaching with no bundle is not missed: a breached
   covenant is an active covenant with a next evaluation date, so it is in
   `covenantsDueSoon` and earns its row as an overdue or due test. It gets the
   louder word when its detail is read, not before.

   AND THE BOOK IS STILL THERE. A relationship with no signal is not deleted, it
   is quiet: it sits under a divider that says how many, collapsed, one click
   away. The queue is the top of the page because it is the work; the book is
   underneath it because it is the book.
   ============================================================================= */

import type { C360Data, Id, ReasonCode, Worklist } from "./contract";
import { deriveWorklist, overdueTestIds, SEVERITY } from "./worklist";

/** Past this the queue stops being a queue (cockpit skill, "worklist scope"). */
export const QUEUE_CAP = 30;

/** How many quiet rows the divider will actually render. The count it states is
 *  the TRUE remainder; this only bounds the DOM on a book of five hundred. */
export const QUIET_CAP = 30;

/** What a row is counted under in the briefing line. Not a `ReasonCode`: the
 *  contract's code list is unchanged, and "overdue" is a property of a
 *  COVENANT_DUE row, not a ninth code. */
export type QueueBucket = ReasonCode | "COVENANT_OVERDUE";

export interface QueueSummary {
  needsAction: number;
  quiet: number;
  /** Every packaged account the page can see, queue and quiet together. */
  bookSize: number;
  /** TRUE when the membership came off a live Portfolio read this session.
   *  False means these are the rows the snapshot baked. */
  live: boolean;
  /** One count per bucket, each row counted ONCE under its loudest reason, so
   *  the buckets sum to `needsAction` and the sentence cannot overstate. */
  byBucket: Partial<Record<QueueBucket, number>>;
}

export interface Queue {
  /** The needs-action rows. Every existing consumer reads this and nothing
   *  about its shape changed. */
  worklist: Worklist;
  /** The rest of the book, exposure first. Rendered under the divider. */
  quiet: Id[];
  summary: QueueSummary;
}

/** The bucket one row is counted under: its loudest reason, with an overdue
 *  covenant test told apart from one merely due. */
export function bucketOf(reasons: ReasonCode[], overdue: boolean): QueueBucket | null {
  const first = reasons[0];
  if (!first) return null;
  return first === "COVENANT_DUE" && overdue ? "COVENANT_OVERDUE" : first;
}

/** Rank within the queue. Lower sorts first. An overdue test sits between a
 *  recorded exception and a test that is merely due, which is a half-step
 *  inside COVENANT_DUE rather than a new code. */
function rankOf(reasons: ReasonCode[], overdue: boolean): number {
  const first = reasons[0];
  if (!first) return SEVERITY.length * 2;
  const base = SEVERITY.indexOf(first) * 2;
  return first === "COVENANT_DUE" && !overdue ? base + 1 : base;
}

/**
 * Decide the landing's rows.
 *
 * `live` says where the membership came from, and it is the caller's fact, not
 * a guess made here: the provider knows whether a Portfolio read has landed.
 */
export function deriveQueue(data: C360Data, live: boolean): Queue {
  const derived = deriveWorklist(data);
  const overdue = overdueTestIds(data);

  const accounts = data.portfolio?.accounts ?? [];
  const tce = new Map<Id, number>();
  for (const a of accounts) tce.set(a.accountId, a.tce ?? 0);

  /* A SERVER LIST IS STILL THE SERVER'S (A9). `deriveWorklist` has already
     ranked it; re-ranking it here would move the BAKED rows the page paints
     before any connector answers, and the founder's first condition is that
     nothing about that first paint changes. The overdue half-step applies where
     the page is deciding for itself, which is the live path. */
  const serverList = (data.worklist?.accountIds?.length ?? 0) > 0;
  const ranked = serverList
    ? derived.accountIds
    : [...derived.accountIds].sort((a, b) => {
        const r = rankOf(derived.reasons[a] ?? [], overdue.has(a)) - rankOf(derived.reasons[b] ?? [], overdue.has(b));
        if (r !== 0) return r;
        return (tce.get(b) ?? 0) - (tce.get(a) ?? 0);
      });

  const accountIds = ranked.slice(0, QUEUE_CAP);
  const onQueue = new Set(accountIds);

  const reasons: Record<Id, ReasonCode[]> = {};
  for (const id of accountIds) reasons[id] = derived.reasons[id] ?? [];

  /* THE REST OF THE BOOK. Every packaged account that did not make the queue,
     including the ones the cap pushed off it, exposure first. A relationship
     the page holds a bundle for but the portfolio read does not list is NOT
     invented here: the row would have no figures to show. */
  const rest = accounts
    .map((a) => a.accountId)
    .filter((id) => id && !onQueue.has(id))
    .sort((a, b) => (tce.get(b) ?? 0) - (tce.get(a) ?? 0));

  const byBucket: Partial<Record<QueueBucket, number>> = {};
  for (const id of accountIds) {
    const b = bucketOf(reasons[id], overdue.has(id));
    if (b) byBucket[b] = (byBucket[b] ?? 0) + 1;
  }

  return {
    worklist: { accountIds, reasons },
    quiet: rest.slice(0, QUIET_CAP),
    summary: {
      needsAction: accountIds.length,
      quiet: rest.length,
      bookSize: accounts.length,
      live,
      byBucket,
    },
  };
}

/* ------------------------------------------------------------- the sentence */

/** How each bucket reads in a count. Singular, plural. */
const BUCKET_WORDS: Record<QueueBucket, [string, string]> = {
  CLIENT_REQUEST: ["client request waiting", "client requests waiting"],
  COVENANT_BREACH: ["breach", "breaches"],
  COVENANT_EXCEPTION: ["recorded exception", "recorded exceptions"],
  COVENANT_OVERDUE: ["test overdue", "tests overdue"],
  COVENANT_DUE: ["test due", "tests due"],
  MATURITY_NEAR: ["maturity inside 90 days", "maturities inside 90 days"],
  MODIFICATION_CLUSTER: ["modification cluster", "modification clusters"],
  GUARANTOR_SIGNAL: ["guarantor signal", "guarantor signals"],
  RECENTLY_MODIFIED: ["recently modified", "recently modified"],
};

/** Loudest first, so the sentence opens on the worst thing in the book. */
const BUCKET_ORDER: QueueBucket[] = [
  "CLIENT_REQUEST",
  "COVENANT_BREACH",
  "COVENANT_EXCEPTION",
  "COVENANT_OVERDUE",
  "COVENANT_DUE",
  "MATURITY_NEAR",
  "MODIFICATION_CLUSTER",
  "GUARANTOR_SIGNAL",
  "RECENTLY_MODIFIED",
];

/**
 * THE RULE, IN ONE SENTENCE, WITH THE PAGE'S OWN NUMBERS IN IT.
 *
 * Founder condition three: easy to understand. A banker should not have to be
 * told what earns a row, they should be able to read it off the page. Every
 * figure here is counted from the rows underneath it, so the sentence cannot
 * drift away from the queue it describes.
 */
export function queueSentence(s: QueueSummary): string {
  const quiet =
    s.quiet === 0 ? "" : s.quiet === 1 ? " 1 more is quiet." : ` ${s.quiet} more are quiet.`;

  if (s.needsAction === 0) {
    return s.bookSize === 0
      ? "No packaged relationship is on the book yet."
      : `Nothing needs action.${quiet || ` All ${s.bookSize} are quiet.`}`;
  }

  const parts: string[] = [];
  for (const b of BUCKET_ORDER) {
    const n = s.byBucket[b];
    if (!n) continue;
    const [one, many] = BUCKET_WORDS[b];
    parts.push(`${n} ${n === 1 ? one : many}`);
  }

  const noun = s.needsAction === 1 ? "relationship needs" : "relationships need";
  const because = parts.length ? `: ${parts.join(", ")}` : "";
  return `${s.needsAction} ${noun} action${because}.${quiet}`;
}
