import {
  DETAIL_KEYS,
  DETAIL_TOOLS,
  READ_DEADLINE_MS,
  SERVERS,
  TOOLS,
  callTool,
  laneTimeout,
  unwrapInvocable,
  withDeadline,
  type DetailKey,
  type McpFailure,
  type McpOk,
} from "./mcp";
import { readThroughEitherLane, type LaneResult } from "./gateway/lane";
import { noteOpenRateLimited } from "./openBurst";

/* =============================================================================
   THE SIX IN ONE CALL (0.9.36, 2026-11-14).

   WHY. A relationship opens on six detail reads, and every one of them crosses
   the claude.ai artifact-to-connector hop on its own. Since 0.9.30 that hop is
   capped at four in flight, so six reads are two waves, and the hop's round
   trip is what a banker feels: the founder's page recorded 14.5 s for ONE read
   on 2026-11-10, while the read backup's own gateway answered the same reads in
   about 250 ms. The org already holds `Customer360Bundle`, which runs the same
   six reads in one Apex transaction (393 ms in the org, 2026-09-06). This file
   pays the hop once instead of six times.

   SAME ANSWER, SAME PATH. Each bundle slice is the JSON string of that tool's
   own `outputValues`, byte-identical to calling the tool alone (verified on
   Hartwell for all six, 2026-11-14). It is re-wrapped here in the invocable
   envelope the lane would have returned, so the open refresh, the last-good
   store, lane health and every reader downstream see exactly what they always
   saw. Nothing downstream knows the bundle exists.

   ONE SLICE'S TROUBLE IS STILL ONE SLICE'S TROUBLE. A slice the bundle names in
   `errorsBySlice`, or one that does not parse, falls back to its own read
   through either door. A bundle that fails outright falls back to all six.

   REFUSED ONCE, NOT ASKED AGAIN THIS SESSION. Until a viewer refreshes their
   Customer 360 connector in claude.ai its cached tool list has no bundle, and a
   cockpit published before 0.9.36 has no grant for it. Either answers with a
   refusal that a retry cannot change, so the page stops asking for the rest of
   the session and opens six-wide exactly as it did before. A timeout or a rate
   limit is transient and does NOT switch it off.
   ============================================================================= */

export type BundledLane = Promise<LaneResult<McpOk<unknown>>>;

/** Which bundle field carries each detail slice. */
export const BUNDLE_FIELDS: Record<DetailKey, string> = {
  snapshot: "snapshot",
  graph: "relationshipGraph",
  exposure: "exposure",
  covenants: "covenants",
  opportunities: "opportunities",
  signals: "structuralSignals",
};

/** Refusals a retry cannot change: no grant, no such tool on this connector. */
const UNAVAILABLE_CODES = new Set<string>(["not_in_manifest", "bad_request", "tool_error", "server_not_found"]);

let unavailable = false;

/** False once the bundle has been refused in this page session. */
export function bundleAvailable(): boolean {
  return !unavailable;
}

/** Test seam: a fresh page, which has not been refused yet. */
export function __resetBundleForTests(available = true): void {
  unavailable = !available;
}

/** One detail slice through its own tool, either door, bounded like a lane. */
function laneRead(i: number, accountId: string): BundledLane {
  const tool = DETAIL_TOOLS[i];
  return withDeadline(
    readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } }),
    READ_DEADLINE_MS,
    () => laneTimeout({ server: SERVERS.customer360, tool, ms: READ_DEADLINE_MS, ambiguous: false }),
  );
}

/** Wrap one parsed slice in the envelope its own tool would have answered with. */
function asLane(source: McpOk<unknown>, outputValues: unknown): LaneResult<McpOk<unknown>> {
  return {
    value: { ...source, payload: { content: [{ isSuccess: true, errors: null, outputValues }] } },
    via: "customer360",
  };
}

/**
 * The six detail lanes for one relationship, served by ONE bundle call.
 *
 * Returns the same per-key promises the head start and the open refresh already
 * consume. Every promise carries a no-op catch, so a rejection held in the map
 * before anybody awaits it never reaches the page as `unhandledrejection`.
 */
export function bundledLanes(accountId: string): Map<DetailKey, BundledLane> {
  const bundle = withDeadline(
    callTool<unknown>(SERVERS.customer360, TOOLS.bundle, [{ accountId }], {
      read: true,
      cache: { staleTime: 15_000 },
    }),
    READ_DEADLINE_MS,
    () => laneTimeout({ server: SERVERS.customer360, tool: TOOLS.bundle, ms: READ_DEADLINE_MS, ambiguous: false }),
  );

  const answered = bundle.then(
    (ok) => ({ ok, slot: unwrapInvocable<Record<string, unknown>>(ok.payload, 1)[0] }),
    (err) => {
      const failure = err as McpFailure | undefined;
      if (failure?.code === "rate_limited") noteOpenRateLimited();
      if (failure && UNAVAILABLE_CODES.has(failure.code)) unavailable = true;
      return null;
    },
  );

  const lanes = new Map<DetailKey, BundledLane>();
  DETAIL_KEYS.forEach((key, i) => {
    const lane: BundledLane = answered.then((res) => {
      if (!res || !res.slot.ok) return laneRead(i, accountId);
      const data = res.slot.data;
      const field = BUNDLE_FIELDS[key];
      const errors = Array.isArray(data.errorsBySlice) ? data.errorsBySlice : [];
      const failed = errors.some((line) => typeof line === "string" && line.startsWith(`${field}:`));
      const raw = data[field];
      if (failed || typeof raw !== "string") return laneRead(i, accountId);
      try {
        return asLane(res.ok, JSON.parse(raw));
      } catch {
        return laneRead(i, accountId);
      }
    });
    lane.catch(() => {});
    lanes.set(key, lane);
  });
  return lanes;
}

/* -------------------------------------------------- the worklist pre-read */

/** How many needs-action relationships are read ahead of the banker's click. */
export const WARM_TOP_N = 3;

const warmed = new Set<string>();

/**
 * READ THE TOP OF THE QUEUE BEFORE ANYBODY CLICKS IT (0.9.36).
 *
 * Once the live queue has landed, the first few needs-action relationships are
 * read through the bundle, ONE AT A TIME, and every slice is stored as a
 * last-good document. Clicking one then paints from the store at once, and the
 * open refresh replaces it with a live read as it always does. Only while the
 * bundle answers: three relationships through six lanes each would be
 * eighteen calls on the hop the founder already finds slow, which costs more
 * than it saves. Each relationship is warmed once per page session, and a
 * failure is simply not stored; nothing here is ever shown or retried.
 */
export async function warmTopAccounts(
  accountIds: string[],
  store: (accountId: string, key: DetailKey, tool: string, data: unknown, storedAt: number) => void,
): Promise<void> {
  for (const accountId of accountIds.slice(0, WARM_TOP_N)) {
    if (!bundleAvailable() || warmed.has(accountId)) continue;
    warmed.add(accountId);
    const lanes = bundledLanes(accountId);
    await Promise.all(
      DETAIL_KEYS.map(async (key, i) => {
        try {
          const res = await lanes.get(key)!;
          const slot = unwrapInvocable(res.value.payload, 1)[0];
          if (slot.ok && slot.data && typeof slot.data === "object" && Object.keys(slot.data).length) {
            store(accountId, key, DETAIL_TOOLS[i], slot.data, res.value.cache?.storedAt ?? Date.now());
          }
        } catch {
          /* a warm-up that fails stores nothing; the open will read for itself */
        }
      }),
    );
  }
}

/** Test seam: forget which relationships this page session has warmed. */
export function __resetWarmForTests(): void {
  warmed.clear();
}
