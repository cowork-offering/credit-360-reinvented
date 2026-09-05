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
 *   stale        the page is painting a stored document for it, not a live read
 *   unreachable  its last call failed and the retries are spent
 */
export type LaneState = "idle" | "live" | "stale" | "unreachable";

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
}

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

/** The lane answered. This is the only thing that clears a failure. */
export function noteLaneSuccess(server: string, at: number = Date.now()): void {
  patch(server, { grant: "granted", state: "live", lastGoodAt: at, code: undefined, message: undefined });
}

/** The lane refused, and whatever retries were owed have been spent. */
export function noteLaneFailure(server: string, failure: LaneFailureLike): void {
  const code = failure.code ?? "upstream_error";
  const grant: LaneGrant =
    code === "capability_disabled" ? "unavailable" : NOT_GRANTED.has(code) ? "not-granted" : "granted";
  patch(server, {
    grant,
    state: "unreachable",
    code,
    message: failure.message ? failure.message.slice(0, 140) : undefined,
  });
}

/**
 * The page is painting a STORED document for this lane.
 *
 * Recorded so the health line can say "stale since" rather than "live" over
 * figures that came out of the cache. It never overwrites a lane that has
 * already answered live this session: a real read outranks a stored one.
 */
export function noteLaneStale(server: string, storedAt: number): void {
  const prev = lanes[server];
  if (prev?.state === "live") return;
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
  commit({});
}
