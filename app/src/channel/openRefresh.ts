import { useEffect, useRef } from "react";
import type { BorrowerBundle } from "../data/contract";
import { modalDepth } from "../components/modalStack";
import { useApp } from "../state/appState";
import {
  DETAIL_KEYS,
  DETAIL_TOOLS,
  laneTimeout,
  mcpAvailable,
  READ_DEADLINE_MS,
  SERVERS,
  unwrapInvocable,
  withDeadline,
  type DetailKey,
  type McpFailure,
} from "./mcp";
import { readThroughEitherLane } from "./gateway/lane";
import { noteLaneStale } from "./laneHealth";
import { loadLastGood, putLastGood, type CachedRead } from "./lastGood";
import { claimPrefetch, type PrefetchedLane } from "./openPrefetch";
import { createPacer, LAUNCH_GAP_MS, MAX_IN_FLIGHT, slowTierWindowMs, SLOW_TIER_KEYS } from "./syncSweep";

/* =============================================================================
   THE OPEN REFRESH: the relationship reads itself when the banker lands on it.

   WHY. The cockpit opens on a BAKED snapshot whose clock is whenever it was
   assembled: 2026-07-25 on the pinned artifact. Until this file existed the
   only thing that ever replaced those figures was the banker pressing Sync, so
   a cockpit opened from chat showed six-week-old exposure with nothing on
   screen admitting it. The fast-open path in the plugin skill makes that worse
   by design: it publishes nothing and opens the pinned page, so the page itself
   has to be the thing that goes and gets the truth.

   THE ORDER IS THE POINT.
     1. The stored last-good documents paint, marked with their age.
     2. The six detail reads go out AT ONCE, each on its own lane.
     3. Each lane lands over the figure it replaces as it returns, on its own.

   ALL SIX AT ONCE, AND THAT IS MEASURED. Until 2026-09-06 the open reads were
   paced two in flight, 200ms apart, which is the SWEEP's pacing borrowed for a
   path it does not fit: the sweep is nine calls on a deliberate gesture, the
   open is six calls the banker did not ask for and is waiting on. Two at a time
   makes the open three round trips deep instead of one, and against a 500ms
   relay that is the difference between the sixth slice landing at 1.96s and at
   0.7s. Measured against the real backup connector on 2026-09-06: six reads
   issued serially cost 243-542ms each; the same six issued together answered in
   534ms of wall clock TOTAL. The org and the transport serve six concurrently
   for very close to the price of one, so paying for three waves bought nothing.

   AND IT BACKS OFF THE MOMENT IT IS TOLD TO. One `rate_limited` from any lane
   drops this page session to the sweep's own two-in-flight, 200ms apart, for
   every open after it. The ceiling is read per slot rather than fixed at
   construction (see `createPacer`), so the lanes already in flight are not torn
   down to change it.

   ONE LANE'S TROUBLE IS ONE LANE'S TROUBLE. Every read is independent: it
   carries its own retry budget inside `callTool`, its own background recovery
   here, and its own failure. A covenant read that cannot reach the org leaves
   the covenant figures at their stored value and takes nothing else down.

   RECOVERY NEEDS NO CLICK. A lane that spends its retries goes quiet and tries
   again a minute later, and again after that, for as long as the banker is
   standing on the relationship. The 2026-09-03 relay outage lasted two hours;
   the banker who waited it out should find the page current, not a Retry
   button they had to remember to press.
   ============================================================================= */

/** How long a lane that gave up waits before trying again, quietly. */
export const BACKGROUND_RETRY_MS = 60_000;

/** All six at once. The open is one round trip deep, not three. */
export const OPEN_MAX_IN_FLIGHT = 6;
/** No spacing between them either: a burst of six is what the measurement says
 *  the transport is happy to answer, and a 200ms ladder in front of it only
 *  delays the last read by a second for nothing. */
export const OPEN_LAUNCH_GAP_MS = 0;

/**
 * ONE LANE'S WALL CLOCK on the open.
 *
 * `callTool` already bounds each ATTEMPT at READ_DEADLINE_MS, but a lane is not
 * an attempt: three retries and then the backup's own three is a minute and a
 * half of a slice that reads "still loading" and a pacer slot nobody else can
 * have. Fifteen seconds is the same number the sweep's lanes get, and a lane
 * that spends it is marked failed against its last good time exactly as a
 * refusal is, never blanked, never left spinning.
 */
export const OPEN_LANE_DEADLINE_MS = READ_DEADLINE_MS;

/* THE PLATFORM'S OWN WORD IS THE ONLY THING THAT NARROWS THIS. Not a guess, not
   a heuristic on latency: `rate_limited` is a code the runtime sends, and until
   it does, six is what the measurement supports. Page-session scoped, because
   a relay that is rationing calls at 22:34 is still rationing them at 22:35. */
let burstAllowed = true;

/** Calls in flight the next open may use. */
export const openInFlightLimit = (): number => (burstAllowed ? OPEN_MAX_IN_FLIGHT : MAX_IN_FLIGHT);
/** Spacing the next open may use. */
const openLaunchGapMs = (): number => (burstAllowed ? OPEN_LAUNCH_GAP_MS : LAUNCH_GAP_MS);

/** The platform said there were too many. Every open after this one is paced. */
export function noteOpenRateLimited(): void {
  burstAllowed = false;
}

/** Test seam: put the burst policy back the way a fresh page finds it. */
export function __resetOpenBurstForTests(): void {
  burstAllowed = true;
}

/** One of the six detail tools, each of which the backup lane mirrors. */
type DetailTool = (typeof DETAIL_TOOLS)[number];

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isEmptyPayload = (v: unknown): boolean =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;

export interface OpenRefreshOptions {
  accountId: string;
  /** When each slow-tier read last succeeded, so an open inside the window
   *  costs no call at all. Same tiering the Sync sweep applies. */
  fetchedAt?: Record<string, number>;
  /** Stored documents, shape-checked, keyed by slice. */
  onCached: (cached: Record<string, CachedRead>) => void;
  /** One live slice landed. */
  onSlice: (key: DetailKey, data: unknown, storedAt: number | undefined, slow: boolean) => void;
  /** One lane gave up for now. Never a reason to blank anything. */
  onFailure?: (key: DetailKey, failure: McpFailure) => void;
  /** True while the banker is standing inside a room or a sheet. A background
   *  recovery waits rather than patching the bundle under an open room: a live
   *  patch rebuilds the room's engine, which would knock a banker out of the
   *  confirmation they were reading. The first pass runs before anything can be
   *  open, so only the recovery ever asks. */
  busy?: () => boolean;
  now?: () => number;
  backgroundMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Start the open refresh for one relationship. Returns a stop function; call it
 * when the banker leaves, and every pending lane and timer goes with it.
 */
export function startOpenRefresh(opts: OpenRefreshOptions): () => void {
  const { accountId } = opts;
  const now = opts.now ?? (() => Date.now());
  const backgroundMs = opts.backgroundMs ?? BACKGROUND_RETRY_MS;
  const sleep = opts.sleep ?? wait;

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** Lanes that have answered live. A stored document never paints over one. */
  const landed = new Set<string>();
  const startedAt = now();
  const fetchedBefore = opts.fetchedAt ?? {};

  /* READ PER SLOT, NOT AT CONSTRUCTION. A `rate_limited` that lands while these
     six are in flight narrows the ones still queued behind it. */
  const pace = createPacer({ gap: openLaunchGapMs, limit: openInFlightLimit, sleep });

  /* THE HEAD START, WHERE SOMEBODY HAD ONE. main.tsx and the intent lane both
     know the relationship before React does and send the six reads then; this
     adopts those calls rather than issuing them a second time. Claimed once and
     drained per lane, so a lane that fails still knocks again for itself. */
  const prefetched = claimPrefetch(accountId);

  /* THE STORED DOCUMENTS FIRST, and they are a local read: they land long
     before any connector answers, which is the whole point of keeping them. */
  void (async () => {
    const cached = await loadLastGood(accountId, now());
    if (stopped) return;
    const usable: Record<string, CachedRead> = {};
    for (const [slice, doc] of Object.entries(cached)) {
      if (landed.has(slice)) continue;
      usable[slice] = doc;
      noteLaneStale(SERVERS.customer360, doc.storedAt);
    }
    if (Object.keys(usable).length) opts.onCached(usable);
  })();

  const schedule = (key: DetailKey, tool: DetailTool) => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (opts.busy?.()) {
        // Mid-confirmation. Come back in a minute; nothing is lost by waiting.
        schedule(key, tool);
        return;
      }
      void runLane(key, tool);
    }, backgroundMs);
    timers.add(timer);
  };

  async function runLane(key: DetailKey, tool: DetailTool): Promise<void> {
    if (stopped) return;
    const slow = SLOW_TIER_KEYS.has(key);
    /* THE HEAD START IS SPENT ONCE. Taken here rather than at the top of the
       function body's try, so a lane that goes on to fail and knock again a
       minute later issues a fresh call instead of awaiting the same dead
       promise for the life of the page. */
    const started: PrefetchedLane | undefined = prefetched?.get(key);
    prefetched?.delete(key);
    try {
      /* EITHER DOOR. The pacer stays OUTSIDE the fallback: a backup read rides
         the same artifact-to-connector relay and costs the same budget, so it
         takes a pacer slot exactly as the primary attempt did.

         AND THE WHOLE LANE IS BOUNDED, not just each attempt. Three retries
         through the front door and three more through the backup is a minute
         and a half; `OPEN_LANE_DEADLINE_MS` is where this page stops waiting
         and says so. A call that was already in flight before the refresh
         started keeps its own clock and is not re-bounded here: it has been
         running for a mount's worth of time already and restarting the count
         would give it longer than a lane that waited its turn. */
      const res = started
        ? await started
        : await withDeadline(
            pace(() => readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } })),
            OPEN_LANE_DEADLINE_MS,
            () =>
              laneTimeout({
                server: SERVERS.customer360,
                tool,
                ms: OPEN_LANE_DEADLINE_MS,
                ambiguous: false,
              }),
          );
      if (stopped) return;
      const ok = res.value;
      const slot = unwrapInvocable(ok.payload, 1)[0];
      if (!slot.ok) {
        // The org ran the tool and reported a per-element failure. A minute's
        // wait cannot change that answer, so this lane stops asking and the
        // stored value stands.
        opts.onFailure?.(key, { code: "tool_error", message: slot.error } as McpFailure);
        return;
      }
      /* AN EMPTY ENVELOPE IS NOT AN ANSWER. `outputValues: {}` carries no
         figures at all, and patching it over the staged slice does not render
         an honest gap: it deletes `snapshot.accountId` and every id hung off
         it. A tool with genuinely nothing to report still names its own keys
         (`covenants: []`, plus its note), so this only ever drops the empty
         case. The lane counts as landed either way: the org answered. */
      landed.add(key);
      if (!isEmptyPayload(slot.data)) {
        opts.onSlice(key, slot.data, ok.cache?.storedAt, slow);
        // A BACKUP ANSWER IS A GOOD ANSWER, and it is remembered like one. The
        // stamp records which door it came through, not whether to trust it.
        const via = res.via === "gateway" ? "gateway" : undefined;
        void putLastGood(accountId, key, tool, slot.data, ok.cache?.storedAt ?? now(), via);
      }
    } catch (err) {
      if (stopped) return;
      const failure = err as McpFailure;
      /* THE PLATFORM RATIONED THE CALLS. Narrow every open after this one, and
         narrow the lanes still queued behind this one, before anything else:
         the next thing this function does is schedule a retry, and a retry that
         went out at the same width would earn the same refusal. */
      if (failure?.code === "rate_limited") noteOpenRateLimited();
      opts.onFailure?.(key, failure);
      // A denial and a view with no bridge are not going to heal on a timer.
      // Everything else gets another quiet knock in a minute, a lane that ran
      // out its own wall clock included, which is exactly the transient this
      // background knock was written for.
      if (!failure?.retract && !failure?.noCapability) schedule(key, tool);
    }
  }

  DETAIL_TOOLS.forEach((tool, i) => {
    const key = DETAIL_KEYS[i];
    // NOT CALLED AT ALL inside the slow-tier window: a read that does not
    // happen cannot fail, and the banker saw this figure minutes ago.
    const fresh =
      SLOW_TIER_KEYS.has(key) &&
      typeof fetchedBefore[key] === "number" &&
      startedAt - fetchedBefore[key] < slowTierWindowMs(key);
    if (fresh) {
      landed.add(key);
      return;
    }
    void runLane(key, tool);
  });

  return () => {
    stopped = true;
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}

/**
 * Mount the open refresh for whichever relationship the banker is standing on.
 *
 * No connector, no refresh: the share link and the screenshot harness render
 * the baked book exactly as they did before this hook existed.
 */
export function useOpenRefresh(): void {
  const { state, dispatch } = useApp();
  const accountId = state.accountId;
  const active = mcpAvailable() && state.view === "account" && !!accountId;

  /* READ AT START, NOT WATCHED. Both of these change as the refresh itself
     lands, and a dependency on either would tear the refresh down and start it
     again on its own first result. */
  const fetchedAtRef = useRef(state.slowTierFetchedAt);
  fetchedAtRef.current = state.slowTierFetchedAt;
  const storedAtRef = useRef(state.liveStoredAt);
  storedAtRef.current = state.liveStoredAt;

  useEffect(() => {
    if (!active || !accountId) return;
    return startOpenRefresh({
      accountId,
      fetchedAt: fetchedAtRef.current[accountId],
      busy: () => modalDepth() > 0,
      onCached: (cached) => {
        // A stored document that is OLDER than what this browser already has
        // restored is not an improvement; it is a step backwards with a
        // freshness stamp on it.
        const known = storedAtRef.current[accountId] ?? 0;
        const patch: Partial<BorrowerBundle> = {};
        let newest = 0;
        for (const [slice, doc] of Object.entries(cached)) {
          if (doc.storedAt <= known) continue;
          (patch as Record<string, unknown>)[slice] = doc.payload;
          newest = Math.max(newest, doc.storedAt);
        }
        if (!newest) return;
        dispatch({ type: "PATCH_BUNDLE", accountId, patch, storedAt: newest });
      },
      onSlice: (key, data, storedAt, slow) => {
        dispatch({ type: "PATCH_BUNDLE", accountId, patch: { [key]: data } as Partial<BorrowerBundle>, storedAt });
        if (slow) dispatch({ type: "SET_SLOW_TIER_FETCHED", accountId, fetchedAt: { [key]: Date.now() } });
      },
    });
  }, [active, accountId, dispatch]);
}
