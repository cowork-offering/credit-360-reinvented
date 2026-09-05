/* =============================================================================
   THE SYNC SWEEP (WP7)

   One gesture, one sweep. Every line on the console is BOUND TO A REAL CALL:
   the line goes running when its own call is fired and only ticks when that
   call has RETURNED. Display pacing sets a floor on how fast a line may tick,
   never a ceiling on how long the work takes, so the sequence can be slower
   than the pacing but never faster than the truth.

   NO FAKE THEATER. There is no line here without a call behind it, and no call
   here that the banker did not ask for: this runs on the Sync gesture only.
   There is no polling and no auto-sync.

   Failure doctrine (unchanged): a failed read keeps the last-good value and
   says so on its line. A failed sweep never blanks the workspace.
   ============================================================================= */

import type { ActionHistoryRow, ActivityEntry, BorrowerBundle, ClientRequest, Id } from "../data/contract";
import { readMailRequest, toClientRequest } from "../actions/mailIntake";
import {
  DETAIL_KEYS,
  DETAIL_TOOLS,
  isLaneTimeout,
  laneTimeout,
  READ_DEADLINE_MS,
  SERVERS,
  TOOLS,
  unwrapInvocable,
  withDeadline,
  type McpFailure,
  type McpOk,
} from "./mcp";
import { laneOf } from "./laneHealth";
import { fmtAsOf } from "../data/format";
import { readThroughEitherLane, type LaneResult } from "./gateway/lane";
import { putLastGood } from "./lastGood";
import { fetchActionHistory, matchesAccount, searchMailbox, type MailHit } from "./cockpitTools";

export type SyncLineState = "pending" | "running" | "done" | "failed";

export interface SyncLine {
  id: string;
  /** Banker language. What this call is actually doing. */
  label: string;
  state: SyncLineState;
  /** On failure: what the banker needs to know, in one line. */
  detail?: string;
}

export interface SyncResult {
  lines: SyncLine[];
  patch: Partial<BorrowerBundle>;
  /** Newest cache stamp across the reads. Never Date.now(). */
  storedAt?: number;
  /** Inbound mail that resolved to this account, as activity entries. */
  requests: ActivityEntry[];
  /** What those messages actually ASK for, where the text says plainly enough
   *  to prefill a ticket. Enters by the same door a staged request does. */
  clientRequests?: ClientRequest[];
  /** The org's durable action trail. Undefined when the tool is not in this
   *  view at all, which is different from an empty trail. */
  history?: ActionHistoryRow[];
  /** True when a read failed and its section kept the previous value. */
  partial: boolean;
  /** Lines whose own call came back with data this sweep. */
  refreshed: number;
  /** Lines that failed TRANSIENTLY, after `callTool` had already retried once.
   *  These are "still unreachable", which is a different sentence from a line
   *  that refused for a reason a retry could never fix. */
  unreachable: number;
  /** Slow-tier reads that actually ran, so the caller can remember when. */
  fetchedAt?: Record<string, number>;
}

/**
 * SLOW-MOVING READS. The relationship graph and the covenant set change on
 * deal-time scales: a holding structure or a covenant package is not edited
 * between two syncs on the same afternoon.
 *
 * The graph is also the heaviest and most id-dense call in the sweep, and the
 * one the founder saw fail most often. Serving it from cache inside a five
 * minute window means the flakiest call mostly stops happening, and the sweep
 * costs two fewer calls against the platform budget, at no staleness risk a
 * banker could notice.
 */
export const SLOW_TIER_KEYS: ReadonlySet<string> = new Set(["graph", "covenants", "snapshot"]);
export const SLOW_TIER_STALE_MS = 5 * 60 * 1000;
/** The snapshot is headline figures on deal-time scales too, but a banker
 *  refreshing after a real change (a booked modification) expects it to move
 *  sooner than the graph. Ninety seconds cuts the every-sync call volume —
 *  the budget burn the founder hit on rapid repeated syncs — without
 *  noticeable staleness. */
export const SNAPSHOT_STALE_MS = 90 * 1000;
export const slowTierWindowMs = (key: string) => (key === "snapshot" ? SNAPSHOT_STALE_MS : SLOW_TIER_STALE_MS);

const DETAIL_LABELS = [
  "Relationship snapshot",
  "Relationship graph",
  "Exposure and collateral",
  "Covenant positions",
  "Open opportunities",
  "Structural signals",
] as const;

/** Codes that mean the connector is simply not part of this view. A29's
 *  opportunistic rule: skip silently, never render it as a failure. */
const ABSENT: string[] = [
  "server_not_connected",
  "server_not_found",
  "not_in_manifest",
  "not_granted",
  "capability_disabled",
  "capability_removed",
];

const isAbsent = (e: unknown) =>
  Boolean((e as McpFailure)?.noCapability) || ABSENT.includes(String((e as McpFailure)?.code ?? ""));

export interface SweepOptions {
  accountId: Id;
  accountName: string;
  /** Render clock for the ingested mail timestamps; the staged generatedAt. */
  generatedAt: string;
  /** The staged relationship, so a request can be matched to a REAL facility. */
  bundle?: BorrowerBundle | null;
  /** Floor on how long a line is displayed before it may tick. */
  minPace?: number;
  onLines?: (lines: SyncLine[]) => void;
  /** When each slow-tier read last succeeded, by bundle key. Inside the window
   *  the sweep serves cache and does not call the tool at all. */
  slowTierFetchedAt?: Record<string, number>;
  /** Injected for tests; never used for data-derived reasoning (A10). */
  now?: () => number;
  /** Launch pacing, overridable for tests. */
  launchGapMs?: number;
  maxInFlight?: number;
  /** How long one lane may take before it is reported as timed out. Test seam;
   *  nothing in the app passes it. Zero or less disables the deadline. */
  deadlineMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ lane deadline

   A CALL THAT NEVER ANSWERS IS NOT A SLOW CALL, IT IS A STUCK SWEEP.

   `callTool` carries a wall clock of its own now (READ_DEADLINE_MS), and that
   bounds ONE ATTEMPT. A lane here is up to four of them: three on Customer 360
   as the retry policy spends its budget, and one more through the read backup.
   So the lane needs its own clock on top, or a hung door could hold a pacer
   slot, the console and the Sync button for a minute rather than for ever,
   which is not the improvement it sounds like.

   THE DEADLINE IS INSIDE THE PACER, deliberately. A hung call that only timed
   out at the settled() layer would still be holding its pacer slot, and the two
   in-flight slots are the whole sweep's throughput: the other lanes would wait
   on a lane that is never coming back. Timing out where the pacer can see it
   releases the slot and lets the rest of the sweep finish without it.

   RECOVERY IS NOT THIS FUNCTION'S JOB. The line reports failed with the lane's
   last good clock, the section keeps the value it had, and openRefresh's quiet
   60s knock is what brings the figures back. */

/** How long one lane in the sweep may take before it is treated as gone. The
 *  same fifteen seconds one attempt gets, because what a banker will sit
 *  through does not change with how many doors were tried behind the line. */
export const LANE_DEADLINE_MS = READ_DEADLINE_MS;

/** One lane's wall clock, in the CONSOLE's voice: a failed line names what did
 *  not come back and when its section was last true. */
const laneExpiry = (label: string, ms: number, lastGoodAt?: number) =>
  laneTimeout({
    server: SERVERS.customer360,
    tool: label,
    ms,
    // A read that never answered wrote nothing and may have written nothing.
    ambiguous: false,
    fix:
      `${label} did not answer in ${Math.round(ms / 1000)}s. The previous value is still shown` +
      `${lastGoodAt ? `, ${fmtAsOf(lastGoodAt)}` : ""}.`,
  });

/** At most this many connector calls in flight at once. */
export const MAX_IN_FLIGHT = 2;
/** Spacing between launches, so the bridge never sees a burst. */
export const LAUNCH_GAP_MS = 200;

/**
 * Start work with a concurrency cap and a gap between launches.
 *
 * Order is preserved: callers get their promise back immediately and the pacer
 * decides when the underlying call actually starts.
 */
export function createPacer({ gap, limit, sleep }: { gap: number; limit: number; sleep: (ms: number) => Promise<void> }) {
  let inFlight = 0;
  const queue: Array<() => void> = [];
  let lastLaunch: Promise<void> = Promise.resolve();

  const release = () => {
    inFlight -= 1;
    const next = queue.shift();
    if (next) next();
  };

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const slot = new Promise<void>((resolve) => {
      const take = () => {
        inFlight += 1;
        resolve();
      };
      if (inFlight < limit) take();
      else queue.push(take);
    });
    const spaced = lastLaunch.then(() => sleep(gap));
    lastLaunch = spaced;
    return Promise.all([slot, spaced]).then(() => {
      const p = fn();
      p.then(release, release);
      return p;
    });
  };
}


/**
 * Run the sweep. All calls are fired at the start, on the single gesture, so
 * the sweep costs one round of reads rather than one per line; the lines then
 * settle IN ORDER as their own call returns.
 */
export async function runSyncSweep(opts: SweepOptions): Promise<SyncResult> {
  const { accountId, accountName, generatedAt } = opts;
  const minPace = opts.minPace ?? 450;
  const sleep = opts.sleep ?? wait;

  // ---- launch, PACED, on the one gesture ---------------------------------
  //
  // These used to fire all nine at once. The artifact-connector bridge does not
  // like a nine-call burst: the founder saw random lines reporting the customer
  // briefly unreachable, intermittently and on no particular line, which is what
  // burst turbulence looks like from the inside.
  //
  // So at most TWO are in flight and each launch is spaced by a small gap. The
  // console already presents the lines sequentially, so perceived latency barely
  // moves; the bridge simply stops seeing a burst.
  //
  // There is NO retry here on purpose. `callTool` already retries once for a
  // read the platform stamped retryable (the one policy, shared with the
  // watches, see `retryDelayMs` in channel/mcp.ts), so a second layer here
  // would mean two retries and a bigger burst: the opposite of the fix. A line
  // that still fails after that retry is what `unreachable` counts.
  const pace = createPacer({ gap: opts.launchGapMs ?? LAUNCH_GAP_MS, limit: opts.maxInFlight ?? MAX_IN_FLIGHT, sleep });

  // Nothing here may reject unhandled while a slower line is still displaying.
  const settled = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));

  /* EITHER DOOR, AND `pace()` STAYS OUTSIDE IT. The pacer exists to keep the
     artifact-to-connector relay off a burst, and the backup rides that same
     relay: a fallback attempt has to cost a pacer slot or the budget the pacer
     protects is not being protected during exactly the outage it matters in. */
  /** One lane, paced, under its own wall clock. The deadline is INSIDE the
   *  pacer so a hung call releases its slot instead of stalling the sweep. */
  const deadlineMs = opts.deadlineMs ?? LANE_DEADLINE_MS;
  const lane = <T,>(label: string, run: () => Promise<T>) =>
    settled(
      pace(() => withDeadline(run(), deadlineMs, () => laneExpiry(label, deadlineMs, laneOf(SERVERS.customer360)?.lastGoodAt))),
    );

  const portfolio = lane("Portfolio position", () =>
    readThroughEitherLane(TOOLS.portfolio, [{}], { cache: { staleTime: 15_000 } }),
  );
  // SCOPE: only the OPEN account's detail is read. The sweep has never fanned
  // out across the book, and this is where that would show up if it ever did.
  const now = opts.now ?? (() => Date.now());
  const fetchedBefore = opts.slowTierFetchedAt ?? {};
  const startedAt = now();

  /** Is this slow-tier read still fresh enough to skip entirely? */
  const servedFromCache = (key: string) =>
    SLOW_TIER_KEYS.has(key) &&
    typeof fetchedBefore[key] === "number" &&
    startedAt - fetchedBefore[key] < slowTierWindowMs(key);

  const fetchedAt: Record<string, number> = {};

  const details = DETAIL_TOOLS.map((tool, i) => {
    const key = DETAIL_KEYS[i];
    // NOT CALLED AT ALL inside the window. This is the budget relief and the
    // flake relief both: a call that does not happen cannot fail.
    if (servedFromCache(key)) return null;
    return lane(DETAIL_LABELS[i], () => readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } }));
  });
  const mail = lane("Your inbox for this relationship", () => searchMailbox(accountName));
  const history = lane("Actions filed against this relationship", () => fetchActionHistory(accountId));

  const lines: SyncLine[] = [
    { id: "portfolio", label: "Portfolio position", state: "pending" },
    ...DETAIL_TOOLS.map((_, i) => ({ id: DETAIL_KEYS[i], label: DETAIL_LABELS[i], state: "pending" as SyncLineState })),
    { id: "history", label: "Actions filed against this relationship", state: "pending" },
    { id: "mail", label: "Your inbox for this relationship", state: "pending" },
  ];
  const emit = () => opts.onLines?.(lines.map((l) => ({ ...l })));

  const patch: Partial<BorrowerBundle> = {};
  let storedAt: number | undefined;
  let partial = false;
  let refreshed = 0;
  let unreachable = 0;
  let requests: ActivityEntry[] = [];
  let clientRequests: ClientRequest[] = [];
  let historyRows: ActionHistoryRow[] | undefined;

  const KEPT = "This section did not come back. The previous value is still shown.";
  /** What landing a result says about its line: a note, or an honest failure. */
  type Landing = string | void | { failed: string };

  /** Show the line, await its real call, hold it for the pacing floor, tick. */
  async function step<T>(
    id: string,
    settledCall: Promise<{ ok: true; v: T } | { ok: false; e: unknown }>,
    land: (v: T) => Landing,
  ): Promise<void> {
    const line = lines.find((l) => l.id === id)!;
    line.state = "running";
    emit();
    const [outcome] = await Promise.all([settledCall, sleep(minPace)]);

    if (!outcome.ok) {
      if (isAbsent(outcome.e)) {
        // Not connected in this view. The line leaves without a trace.
        lines.splice(lines.indexOf(line), 1);
        emit();
        return;
      }
      partial = true;
      // Retryable ⇒ the platform stamped it and `callTool` already spent the
      // one retry. A lane that ran out its own clock is unreachable by
      // definition: nothing answered at all. Anything else refused for its own
      // reason and is not an unreachability claim.
      if ((outcome.e as McpFailure)?.retryable === true || isLaneTimeout(outcome.e)) unreachable += 1;
      line.state = "failed";
      // The platform's code and message ride behind the fix sentence, so a
      // failed line names its layer (founder, 2026-09-03).
      const f = outcome.e as McpFailure | undefined;
      line.detail = f ? `${f.fix} (${f.code}${f.message ? `: ${f.message.slice(0, 140)}` : ""})` : KEPT;
      emit();
      return;
    }

    const landed = land(outcome.v);
    if (landed && typeof landed === "object") {
      partial = true;
      line.state = "failed";
      line.detail = landed.failed;
    } else {
      line.state = "done";
      refreshed += 1;
      if (landed) line.detail = landed;
    }
    emit();
  }

  // The portfolio read confirms the book around this relationship. The account
  // view renders from the bundle, so nothing is patched from it.
  await step("portfolio", portfolio, () => {});

  for (let i = 0; i < details.length; i++) {
    const key = DETAIL_KEYS[i];
    const call = details[i];

    if (!call) {
      // The line still ticks, and says why it was quick. Silent to the banker
      // in the sense that nothing is wrong; not silent about what happened.
      const line = lines.find((l) => l.id === key)!;
      line.state = "running";
      emit();
      await sleep(minPace);
      line.state = "done";
      line.detail = "unchanged since the last sync";
      emit();
      continue;
    }

    await step(key, call, (res: LaneResult<McpOk<unknown>>) => {
      const ok = res.value;
      if (ok.cache?.storedAt && (storedAt === undefined || ok.cache.storedAt > storedAt)) storedAt = ok.cache.storedAt;
      const slot = unwrapInvocable(ok.payload, 1)[0];
      if (!slot.ok) return { failed: KEPT };
      (patch as Record<string, unknown>)[key] = slot.data;
      // REMEMBERED, so the next open of this relationship has something true to
      // paint before the org answers. Reads only, fire and forget, and a backup
      // answer is remembered exactly like a primary one, stamped with its door.
      void putLastGood(
        accountId,
        key,
        DETAIL_TOOLS[i],
        slot.data,
        ok.cache?.storedAt ?? startedAt,
        res.via === "gateway" ? "gateway" : undefined,
      );
      if (SLOW_TIER_KEYS.has(key)) fetchedAt[key] = startedAt;
    });
  }

  // Until the read tool is deployed this line removes itself, exactly like the
  // mailbox line does when Microsoft 365 is absent.
  await step("history", history, ({ rows }: { rows: ActionHistoryRow[] }) => {
    historyRows = rows;
    return rows.length ? `${rows.length} on record` : "none on record";
  });

  await step("mail", mail, ({ hits }: { hits: MailHit[] }) => {
    const matched = hits.filter((h) => matchesAccount(h, accountName));
    requests = matched.map((m) => {
      // NO NEXT STEP IS HUNG OFF AN INBOUND MESSAGE (founder, 2026-09-03). It
      // used to carry one, pointing at the registry's `loan-modification`
      // action, which is the PRE-WORKROOM action panel, so an arriving mail
      // opened the old tab from three surfaces at once (the popup, the chat
      // chips and the actions panel all read `detail.nextSteps`). The trail row
      // opens the facility workroom on the message instead; see
      // `actions/mailRow.ts`. The registry action itself is untouched.
      return {
      id: `mail-${m.id ?? m.subject ?? Math.random().toString(36).slice(2)}`,
      // Clamp a skewed timestamp to the render clock rather than showing a
      // message that appears to arrive from the future.
      ts: m.receivedAt && m.receivedAt <= generatedAt ? m.receivedAt : generatedAt,
      kind: "REQUEST_RECEIVED",
      title: m.subject ?? "Client message",
      summary: m.preview,
      actor: m.from,
      sessionLocal: true,
      reference: { kind: "m365-message", id: m.id, webLink: m.webLink },
      };
    });
    // Read each matched message as a request. Nothing is invented: an
    // unreadable message simply produces no ClientRequest.
    clientRequests = matched
      .map((m) => {
        const req = readMailRequest(m, opts.bundle ?? null);
        return req ? toClientRequest(m, req) : null;
      })
      .filter((r): r is ClientRequest => r !== null);

    return matched.length ? `${matched.length} matched` : "nothing new";
  });

  return { lines, patch, storedAt, requests, clientRequests, history: historyRows, partial, refreshed, unreachable, fetchedAt };
}

/**
 * The one sentence the console closes on about REACHABILITY.
 *
 * The banker needs to know which of two things happened: the org answered and
 * the relationship was refreshed, or a line is still unreachable after the
 * retry the read layer already spent. Collapsing those into one "partial" was
 * how a transient covenant read came to look like a failing covenant position.
 */
export function reachReport({ refreshed, unreachable }: { refreshed: number; unreachable: number }): string {
  if (unreachable > 0) {
    return `${unreachable} ${unreachable === 1 ? "line" : "lines"} still unreachable after retry.`;
  }
  return `Reachable, ${refreshed} ${refreshed === 1 ? "line" : "lines"} refreshed.`;
}
