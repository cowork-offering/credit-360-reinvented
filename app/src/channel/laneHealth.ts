import { useSyncExternalStore } from "react";

/* =============================================================================
   CONNECTOR LANE HEALTH: one place that knows how each connector is doing.

   WHY THIS EXISTS. On 2026-09-03 the artifact-to-connector relay dropped its
   Salesforce session for two hours: every call the PAGE made came back
   `server_unavailable: request failed (502)` while the same tools answered
   normally in chat. The page said "Customer 360 is briefly unreachable" over
   empty modules, and there was nowhere on screen to learn which lane had
   failed, when it had last answered, or whether the grant was even there.

   So every call records its outcome here, at the one seam it already passes
   through (`callTool` and the watch wrapper in mcp.ts), keyed by the connector
   DISPLAY NAME the call was addressed to. Three facts per lane and no more:
   the grant, when it last answered, and what it is doing right now.

   AND IT KEEPS THE CLOCK. Every call's own wall time is recorded beside its
   outcome, and the last ten per lane are kept. FOUNDER, 2026-09-06: "latency
   free" is a claim somebody has to be able to check from their seat, and the
   only honest place to check it is the page itself, the relay hop between the
   artifact and the connector is invisible to every other instrument. So the
   health line carries the last call's duration in the same faint ink as the
   rest, and the last ten are one click away.

   THE DURATION IS ONE ATTEMPT'S, NOT ONE LANE'S. It is the wall time of the
   round trip that ANSWERED, which is what "relay latency" means; a lane that
   spent four seconds across three knocks says so through `unreachable` and its
   own history rows, not by inflating the number next to the word live.

   THIS FILE KNOWS NOTHING ABOUT WHICH CONNECTORS EXIST. It records what it is
   told, so it can be imported by mcp.ts without a cycle; the health line owns
   the ordering and the banker-facing labels.

   IT IS A REPORT, NEVER A GATE. Nothing branches on lane health: a call is
   attempted because a caller asked for it, not because this store thinks the
   lane is up. A stale opinion here must never be able to stop a read that
   would have worked.
   ============================================================================= */

/** Whether this view may call the lane at all. */
export type LaneGrant = "granted" | "not-granted" | "unavailable";

/**
 * What the lane is doing right now.
 *   idle         granted, nothing asked of it yet this page session
 *   live         its last call answered
 *   backup       it did not answer, but its BACKUP LANE did, so the figures on
 *                screen are the org's own and current
 *   stale        the page is painting a stored document for it, not a live read
 *   unreachable  its last call failed and the retries are spent
 */
export type LaneState = "idle" | "live" | "backup" | "stale" | "unreachable";

export interface LaneHealth {
  /** The connector display name, exactly as the call addressed it. */
  server: string;
  grant: LaneGrant;
  state: LaneState;
  /** When this lane last ANSWERED, epoch ms. Absent means it never has. */
  lastGoodAt?: number;
  /** The platform's own code, present only while `state` is unreachable. */
  code?: string;
  /** The platform's message, trimmed. Diagnostic, never the banker's copy. */
  message?: string;
  /** The wall time of the last call on this lane, ms. Absent until one has
   *  settled, a lane nobody has called has no latency to report. */
  lastMs?: number;
}

/** One call, as the health line replays it. */
export interface LaneCall {
  /** When it settled, epoch ms. */
  at: number;
  /** Its own wall time, ms. */
  ms: number;
  ok: boolean;
  /** The tool that was asked for, so a slow row says WHICH read was slow. */
  tool: string;
}

/** How many calls per lane the line can replay. Ten is a page's worth of open
 *  and sweep, which is the window a founder reads during a demo; a longer tail
 *  is a log, and this is a status line. */
export const LANE_CALL_HISTORY = 10;

/** The shape `noteLaneFailure` reads. Structurally an McpFailure, declared
 *  locally so this file imports nothing from the connector layer. */
export interface LaneFailureLike {
  code?: string;
  message?: string;
  retract?: boolean;
  noCapability?: boolean;
}

export type LaneHealthMap = Readonly<Record<string, LaneHealth>>;

let lanes: LaneHealthMap = {};
const listeners = new Set<() => void>();

/* THE HISTORY LIVES BESIDE THE SNAPSHOT, NOT INSIDE IT. A ring per lane, pushed
   in place: putting ten rows into the reactive object would allocate a fresh
   array and a fresh lane record on every single call, on the one seam every
   call already passes through. The snapshot still changes on each call (the
   duration is on it), so a surface subscribed to the store re-renders exactly
   when there is a new row to read, and reads it from here. */
const history = new Map<string, LaneCall[]>();
const NO_CALLS: readonly LaneCall[] = [];

/** The last ten calls on this lane, newest last. */
export function laneCalls(server: string): readonly LaneCall[] {
  return history.get(server) ?? NO_CALLS;
}

function record(server: string, call: LaneCall): void {
  const ring = history.get(server);
  if (!ring) {
    history.set(server, [call]);
    return;
  }
  ring.push(call);
  if (ring.length > LANE_CALL_HISTORY) ring.shift();
}

function commit(next: LaneHealthMap): void {
  lanes = next;
  for (const l of listeners) l();
}

function patch(server: string, next: Partial<LaneHealth>): void {
  const prev = lanes[server] ?? { server, grant: "granted" as LaneGrant, state: "idle" as LaneState };
  const merged: LaneHealth = { ...prev, ...next, server };
  // A no-op must not wake every subscriber: this is written on every call.
  if (
    prev.grant === merged.grant &&
    prev.state === merged.state &&
    prev.lastGoodAt === merged.lastGoodAt &&
    prev.lastMs === merged.lastMs &&
    prev.code === merged.code &&
    prev.message === merged.message
  ) {
    return;
  }
  commit({ ...lanes, [server]: merged });
}

/** Codes that mean the viewer has no grant for this lane, as opposed to a lane
 *  that is granted and briefly refusing. */
const NOT_GRANTED = new Set([
  "server_not_connected",
  "server_not_found",
  "not_in_manifest",
  "not_granted",
  "capability_removed",
]);

/** What a caller knows about the round trip it just made. */
export interface CallTiming {
  tool: string;
  ms: number;
}

/** The lane answered. This is the only thing that clears a failure. */
export function noteLaneSuccess(server: string, at: number = Date.now(), timing?: CallTiming): void {
  if (timing) record(server, { at, ms: timing.ms, ok: true, tool: timing.tool });
  patch(server, {
    grant: "granted",
    state: "live",
    lastGoodAt: at,
    // A caller with no clock leaves the last known duration standing rather
    // than blanking it: absence of a measurement is not a measurement of zero.
    ...(timing ? { lastMs: timing.ms } : {}),
    code: undefined,
    message: undefined,
  });
}

/** The lane refused, and whatever retries were owed have been spent. */
export function noteLaneFailure(server: string, failure: LaneFailureLike, timing?: CallTiming): void {
  const code = failure.code ?? "upstream_error";
  const grant: LaneGrant =
    code === "capability_disabled" ? "unavailable" : NOT_GRANTED.has(code) ? "not-granted" : "granted";
  if (timing) record(server, { at: Date.now(), ms: timing.ms, ok: false, tool: timing.tool });
  patch(server, {
    grant,
    state: "unreachable",
    ...(timing ? { lastMs: timing.ms } : {}),
    code,
    message: failure.message ? failure.message.slice(0, 140) : undefined,
  });
}

/**
 * This lane did not answer, but its BACKUP did, and the figures on screen came
 * back through that other door.
 *
 * Recorded against the lane the banker knows, not against the backup: the
 * question a health line answers is whether the relationship on screen is
 * current, and through a mirrored read it is. The backup's own row says
 * separately that it was the one that answered.
 *
 * Always follows a recorded failure on this lane, because a fallback only
 * happens after the primary has spent its retries; it is strictly more
 * informative than the `unreachable` it replaces.
 */
export function noteLaneBackup(server: string, at: number = Date.now()): void {
  patch(server, { state: "backup", lastGoodAt: at, code: undefined, message: undefined });
}

/**
 * The page is painting a STORED document for this lane.
 *
 * Recorded so the health line can say "stale since" rather than "live" over
 * figures that came out of the cache. It never overwrites a lane that has
 * already answered live this session, or one a backup answered for: both are
 * reads of the org as it is now, and either outranks a stored document.
 */
export function noteLaneStale(server: string, storedAt: number): void {
  const prev = lanes[server];
  if (prev?.state === "live" || prev?.state === "backup") return;
  patch(server, { state: "stale", lastGoodAt: Math.max(storedAt, prev?.lastGoodAt ?? 0) });
}

/** What `listTools()` said about this lane before anything was called. */
export function noteLaneGrant(server: string, granted: boolean): void {
  const prev = lanes[server];
  // An observed failure is later evidence than a grant probe; do not undo it.
  if (prev?.state === "unreachable") return;
  patch(server, { grant: granted ? "granted" : "not-granted" });
}

/** No connector bridge in this view at all. Every lane reads unavailable. */
export function noteNoBridge(servers: readonly string[]): void {
  const next: Record<string, LaneHealth> = { ...lanes };
  for (const server of servers) {
    next[server] = { ...(next[server] ?? { server }), server, grant: "unavailable", state: "unreachable" };
  }
  commit(next);
}

export function laneOf(server: string): LaneHealth | undefined {
  return lanes[server];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): LaneHealthMap => lanes;

export function useLaneHealth(): LaneHealthMap {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam: put the store back the way a fresh page finds it. */
export function __resetLaneHealthForTests(): void {
  history.clear();
  commit({});
}
