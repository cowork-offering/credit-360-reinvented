/* =============================================================================
   THE GRANT WARM-UP (founder, 2026-09-13).

   "The connector permission prompts come one by one on different pages or on
   Sync. I want them all at the beginning."

   WHY THEY ARRIVE SPREAD OUT. `probeConnectorGrants` asks `listTools()` once at
   boot, and that call does NOT make the host ask the viewer for anything: the
   per-connector prompt fires on the first real `callTool` against each server.
   Those first calls are scattered across the whole flow: Customer 360 on the
   landing, IDB Gateway when a room asks Boom for ratios, Microsoft 365 on the
   first Sync, Experience / nCino and AFS deep inside the memo room. So the
   banker is interrupted four separate times, each one in the middle of work.

   WHAT THIS DOES. Once per page session, AFTER the worklist has painted, it
   fires ONE cheap read at every connector the cockpit is configured to use and
   has not already called. The answers are thrown away. The point is the prompt,
   not the payload: the viewer accepts the whole set at the start and is never
   asked again mid-gesture.

   RULES, all of them load-bearing:
     - READS ONLY. Never a write, never a stage, never an execute. A warm-up
       that changed anything in the org would be the worst bug in this file.
     - SILENT. Every failure is swallowed. A connector the viewer did not add is
       not an error here, it is the normal case, and nothing about this renders.
     - NEVER BEFORE FIRST PAINT, and never blocking one: it is scheduled on a
       short timer by the shell, and nothing waits on it.
     - ONCE. A second call in the same page session is a no-op.
     - THROUGH THE NORMAL CALL PATH, so the health line records the lane exactly
       as it records every other read.

   WHY THE DEADLINE IS LONGER THAN A READ'S. This call is waiting on a HUMAN,
   not on the org: the host holds it while the consent dialog is on screen. At
   the standard fifteen seconds a banker who reads the prompt before accepting
   would have the lane marked unreachable for their trouble.
   ============================================================================= */

import type { AfsCoordinates } from "../data/contract";
import { callTool, mcpAvailable, SERVERS, TOOLS, type CallOptions } from "./mcp";
import { GATEWAY_HEALTH_TOOL, GATEWAY_SERVER } from "./gateway/lane";
import { laneOf } from "./laneHealth";

/** How long after the shell mounts the warm-up goes out. Past the first paint
 *  and past the landing's own first read, well before a banker can be standing
 *  in a room whose connector would otherwise prompt them there. */
/* OFF BY DEFAULT (orchestrator, 2026-09-13). The founder's first real-host run of
   0.9.20 saw the cockpit chat sit on "Composing" for over three minutes and a
   workroom stop answering. The chat's own deadline is 75 s, so something outside
   the page held those calls, and the one thing this release added at open is
   four connector reads fired 1.2 s after first paint, each of which raises the
   host's consent dialog. Until a real-host run proves the host does not queue
   the session door behind an open dialog, the warm-up stays armed but not
   fired: the prompts return to arriving on first use, which the founder had
   before. Flip to true after that run (backlog row 31). */
export const GRANT_WARMUP_ENABLED = false;
export const GRANT_WARMUP_DELAY_MS = 1_200;

/** One warm-up's wall clock. It covers the consent dialog, not a round trip. */
export const GRANT_WARMUP_DEADLINE_MS = 60_000;

/** The mailbox search that warms Microsoft 365. A fixed short token, in the
 *  keep-alive's spirit: the grant is the point, not the hits, so this page never
 *  goes looking through a mailbox for a relationship nobody opened. */
export const WARMUP_MAIL_QUERY = "zz";

export interface WarmupOptions {
  /** The relationship the worklist opens on. Boom is keyed by company name, so
   *  with no name there is nothing to ask it for. */
  accountName?: string | null;
  /** That relationship's AFS servicing key, when it carries one. AFS tools
   *  DEFAULT their key to a real and different borrower's obligation, so the
   *  seam rule holds here too: no mapping, no AFS call (see memo/afsMapping.ts). */
  afs?: AfsCoordinates;
  /** Injected for tests. */
  call?: typeof callTool;
  /** What the boot probe learned about a lane. Injected for tests. */
  grantOf?: (server: string) => string | undefined;
}

let warmed = false;

/** Test seam: put the module back the way a fresh page finds it. */
export function __resetGrantWarmupForTests(): void {
  warmed = false;
}

/**
 * Ask every configured connector for one cheap read, so the viewer is prompted
 * for all of them at once. Resolves when they have all settled; nothing waits
 * on it, and nothing it returns is used.
 */
export async function warmConnectorGrants(opts: WarmupOptions = {}): Promise<void> {
  if (warmed || !mcpAvailable()) return;
  warmed = true;

  const call = opts.call ?? callTool;
  const grantOf = opts.grantOf ?? ((server: string) => laneOf(server)?.grant);
  /* UNCACHED, because a warm-up that is served from the store touches no
     connector and prompts for nothing, which is the one thing it is for. Boom
     is the exception below: its answer is the same one the room asks for. */
  const warm: CallOptions = { read: true, cache: false, deadlineMs: GRANT_WARMUP_DEADLINE_MS };

  const reads: Array<Promise<unknown>> = [];

  /* CUSTOMER 360 IS NOT WARMED. The landing's portfolio read is the first thing
     this page does, so its prompt already arrives at the beginning; asking a
     second time would spend budget to change nothing. */

  /* THE READ BACKUP IS OPTIONAL, and it is the one connector a viewer is
     expected not to have. Warming it would prompt for something they never
     added, so it is asked only when the boot probe saw it in the list. Its own
     health tool takes no input and reads no Salesforce data. A probe that has
     not answered by now leaves this lane alone, which is the one lane the page
     can most afford not to warm: it is only ever a fallback. */
  if (grantOf(GATEWAY_SERVER) === "granted") {
    reads.push(call(GATEWAY_SERVER, GATEWAY_HEALTH_TOOL, {}, warm));
  }

  /* IDB GATEWAY, through the Boom read the spreading surfaces make anyway, on
     the relationship at the top of the worklist. Cached exactly as
     `refreshBoom` caches it, so a room that asks inside the window is served
     rather than charged twice. */
  if (opts.accountName) {
    reads.push(
      call(
        SERVERS.boom,
        TOOLS.boomRatios,
        { company: opts.accountName },
        { ...warm, cache: { staleTime: 30_000 } },
      ),
    );
  }

  // MICROSOFT 365, through the same search tool the sweep's inbox line uses.
  reads.push(call(SERVERS.m365, TOOLS.mailSearch, { query: WARMUP_MAIL_QUERY }, warm));

  /* EXPERIENCE / nCino. Every other tool on this connector writes to the system
     of record; `deal_covenant_grade` is a read whose inputs are all optional
     (memo/OBSERVED.md), so grading an empty covenant list is the cheapest
     honest thing this page can ask it for. */
  reads.push(call(SERVERS.experience, TOOLS.covenantGrade, { covenants: [] }, warm));

  // AFS, and only with a real servicing key. See `afs` above for why.
  if (opts.afs) {
    const { bank, obligor, obligation } = opts.afs;
    reads.push(call(SERVERS.afs, TOOLS.afsLoanSummary, { bank, obligor, obligation }, warm));
  }

  await Promise.allSettled(reads);
}
