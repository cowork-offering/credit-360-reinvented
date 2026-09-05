/* =============================================================================
   THE SECOND DOOR.

   On 2026-09-03 the claude.ai artifact-to-connector relay dropped its upstream
   session to api.salesforce.com/platform/mcp for about two hours. Every page
   call returned server_unavailable / 502 on four builds and both contracts,
   while chat sessions and the org itself were healthy, and it cleared on its
   own with no new login. The cockpit's reads all went through that one hop, so
   the cockpit had nothing to show.

   This lane is the other hop: a Connectry-hosted MCP connector that serves the
   SAME ten reads from the SAME org with a SERVER-SIDE credential. Same tool
   names with a `gw_` prefix, same `{ inputs: [ ... ] }` shape, same Salesforce
   invocable envelope (verified byte-identical against the Customer 360
   connector on 2026-09-05 for Snapshot and Covenants), so every existing
   unwrapper reads a gateway answer without knowing which door it came through.

   READS ONLY, AND THAT IS STRUCTURAL. The gateway holds one service credential.
   A write filed through it would carry the gateway's identity, not the banker's,
   and the whole staged-plan pattern rests on approverUserId being the running
   human. The eighteen staging and execute tools stay on Customer 360, and
   {@link callGateway} refuses by name anything that is not one of the ten reads.
   ============================================================================= */

import { callTool, describeFailure, SERVERS, TOOLS, type CallOptions, type McpFailure, type McpOk } from "../mcp";

/** The connector's DISPLAY NAME, exactly as the viewer's connector list spells
 *  it. A differently named connector is invisible to the page, so this is the
 *  name the founder must type when adding it in claude.ai. */
export const GATEWAY_SERVER = "Connectry C360 Gateway";

/** The ten Customer 360 READS this lane mirrors. Nothing else is callable. */
export const MIRRORED_READS = [
  TOOLS.portfolio,
  TOOLS.searchAccounts,
  TOOLS.snapshot,
  TOOLS.exposure,
  TOOLS.covenants,
  TOOLS.graph,
  TOOLS.opportunities,
  TOOLS.structuralSignals,
  TOOLS.actionHistory,
  TOOLS.catalog,
] as const;

export type MirroredRead = (typeof MIRRORED_READS)[number];

const MIRRORED = new Set<string>(MIRRORED_READS);

/** The gateway's own health tool. No inputs, no Salesforce data. */
export const GATEWAY_HEALTH_TOOL = "gw_health";

/** Customer 360 tool name to its gateway twin. */
export function gatewayToolName(tool: string): string {
  return `gw_${tool}`;
}

export function isMirroredRead(tool: string): tool is MirroredRead {
  return MIRRORED.has(tool);
}

/**
 * Call one mirrored read through the gateway connector.
 *
 * `inputs` is the SAME array the Customer 360 call would carry, and the result
 * is the same {@link McpOk} the rest of the cockpit already unwraps.
 *
 * Rejects synchronously-shaped (as a rejected promise) with a bad_request
 * failure for any tool that is not one of the ten reads. That guard is the
 * reason this function exists rather than callers reaching for `callTool`
 * with a `gw_` string: it makes "no writes through the gateway" a property of
 * the code, not a convention in a comment.
 */
export function callGateway<T = unknown>(
  tool: string,
  inputs: Array<Record<string, unknown>>,
  options: CallOptions = {},
): Promise<McpOk<T>> {
  if (!isMirroredRead(tool)) {
    return Promise.reject(
      describeFailure(
        {
          code: "bad_request",
          message: `${tool} is not a gateway read. Writes stay on Customer 360, where the acting identity is the banker's.`,
        },
        GATEWAY_SERVER,
        tool,
      ),
    );
  }
  return callTool<T>(GATEWAY_SERVER, gatewayToolName(tool), { inputs }, { read: true, ...options });
}

/** The gateway's health answer, for the cockpit's health line (backlog item 10). */
export interface GatewayHealth {
  ok: boolean;
  orgReachable: boolean;
  orgError: string | null;
  instanceUrl?: string;
  tokenAgeMs?: number | null;
  lastError?: unknown;
  checkedAt?: string;
  roundTripMs?: number;
}

export async function gatewayHealth(options: CallOptions = {}): Promise<GatewayHealth> {
  const res = await callTool<GatewayHealth>(GATEWAY_SERVER, GATEWAY_HEALTH_TOOL, {}, { read: true, ...options });
  const p = res.payload as GatewayHealth | undefined;
  if (!p || typeof p.orgReachable !== "boolean") {
    throw describeFailure({ code: "transform_error", message: "gw_health returned no health object" }, GATEWAY_SERVER, GATEWAY_HEALTH_TOOL);
  }
  return p;
}

/* --------------------------------------------------------- fallback policy */

/**
 * The failure codes that mean "this hop is down, the data is not".
 *
 * `server_unavailable` is what the 2026-09-03 outage stamped on every call.
 * `upstream_error` is where the contract puts an unknown code, which is where a
 * bare 502 lands. `cancelled` covers the runtime giving up on a reply that never
 * came. Nothing else falls back: a lapsed grant, a policy block or a tool error
 * would fail on the second door too, and retrying them there only delays the one
 * message that tells the banker what to fix.
 */
export const FALLBACK_CODES = new Set(["server_unavailable", "upstream_error", "cancelled"]);

/** Does this Customer 360 failure justify trying the other door? */
export function shouldFallBack(failure: McpFailure): boolean {
  if (failure.noCapability) return false;
  // An authz denial is about WHO is asking. The gateway asks as somebody else,
  // so falling back would quietly serve data the viewer was just refused.
  if (failure.retract) return false;
  if (FALLBACK_CODES.has(failure.code)) return true;
  // A 502 or a timeout can arrive with an unhelpful code but a legible message.
  return /\b502\b|bad gateway|timed? ?out|timeout/i.test(failure.message ?? "");
}

/** Which door answered. The page stamps this on the data so the health line can
 *  say "showing gateway data" rather than implying the primary lane is fine. */
export type Lane = "customer360" | "gateway";

export interface LaneResult<T> {
  value: T;
  via: Lane;
  /** Present only when the gateway answered: why the primary lane did not. */
  primaryFailure?: McpFailure;
}

/**
 * Try the Customer 360 lane; on a hop failure, try the gateway.
 *
 * Both arguments are thunks so the gateway call is never CONSTRUCTED unless it
 * is needed. The gateway's own failure is reported as the PRIMARY failure, not
 * the gateway's: a banker asked the cockpit for a relationship, not for a lane,
 * and "Customer 360 is briefly unreachable" is the fix copy that helps. The
 * gateway's failure is attached for the health line and the console.
 */
export async function readWithFallback<T>(
  primary: () => Promise<T>,
  gateway: () => Promise<T>,
  hooks: { onFallback?: (failure: McpFailure) => void; onGatewayFailure?: (failure: McpFailure) => void } = {},
): Promise<LaneResult<T>> {
  try {
    return { value: await primary(), via: "customer360" };
  } catch (err) {
    const failure = err as McpFailure;
    if (!failure || typeof failure.code !== "string" || !shouldFallBack(failure)) throw err;
    hooks.onFallback?.(failure);
    try {
      return { value: await gateway(), via: "gateway", primaryFailure: failure };
    } catch (gwErr) {
      hooks.onGatewayFailure?.(gwErr as McpFailure);
      // Both doors are shut. The banker is told about the door they know.
      throw failure;
    }
  }
}

/**
 * The whole fallback for one mirrored read, when the caller has nothing to add.
 *
 * `refreshAccountDetail`, the sync sweep and the book aggregate all make the
 * same call shape, so wrapping is one line at each site:
 *   readThroughEitherLane(TOOLS.snapshot, [{ accountId }], { cache: ... })
 */
export function readThroughEitherLane<T = unknown>(
  tool: MirroredRead,
  inputs: Array<Record<string, unknown>>,
  options: CallOptions = {},
  hooks?: Parameters<typeof readWithFallback>[2],
): Promise<LaneResult<McpOk<T>>> {
  return readWithFallback<McpOk<T>>(
    () => callTool<T>(SERVERS.customer360, tool, { inputs }, { read: true, ...options }),
    () => callGateway<T>(tool, inputs, options),
    hooks,
  );
}
