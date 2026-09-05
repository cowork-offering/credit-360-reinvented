import { useEffect, useRef } from "react";
import type { BorrowerBundle } from "../data/contract";
import { modalDepth } from "../components/modalStack";
import { useApp } from "../state/appState";
import {
  callTool,
  DETAIL_KEYS,
  DETAIL_TOOLS,
  mcpAvailable,
  SERVERS,
  unwrapInvocable,
  type DetailKey,
  type McpFailure,
} from "./mcp";
import { noteLaneStale } from "./laneHealth";
import { loadLastGood, putLastGood, type CachedRead } from "./lastGood";
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
     2. The six detail reads go out, PACED, each on its own lane.
     3. Each lane lands over the figure it replaces as it returns, on its own.

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

  const pace = createPacer({ gap: LAUNCH_GAP_MS, limit: MAX_IN_FLIGHT, sleep });

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

  const schedule = (key: DetailKey, tool: string) => {
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

  async function runLane(key: DetailKey, tool: string): Promise<void> {
    if (stopped) return;
    const slow = SLOW_TIER_KEYS.has(key);
    try {
      const ok = await pace(() =>
        callTool(SERVERS.customer360, tool, { inputs: [{ accountId }] }, { read: true, cache: { staleTime: 15_000 } }),
      );
      if (stopped) return;
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
        void putLastGood(accountId, key, tool, slot.data, ok.cache?.storedAt ?? now());
      }
    } catch (err) {
      if (stopped) return;
      const failure = err as McpFailure;
      opts.onFailure?.(key, failure);
      // A denial and a view with no bridge are not going to heal on a timer.
      // Everything else gets another quiet knock in a minute.
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
