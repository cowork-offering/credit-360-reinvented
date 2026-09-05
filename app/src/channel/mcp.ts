/* =============================================================================
   window.claude.mcp — the live connector layer (runtime contract 0.1.15).

   Written against the platform type definitions, not from memory. Two arms:
   `callTool` for actions/one-shot reads, `watchTool` for data that must stay
   current. Calls run with the VIEWER's credentials; this page never sees tokens.

   FAILURE DESIGN IS NOT OPTIONAL. Connector calls fail routinely (lapsed auth,
   a connector the viewer never added, a briefly unreachable upstream) and each
   code has a different correct response. Collapsing them into one generic
   banner is the named anti-pattern: it hides the single action that would fix
   the page. `describeFailure()` below is the one place that mapping lives.
   ============================================================================= */

import { noteLaneFailure, noteLaneGrant, noteLaneSuccess, noteNoBridge } from "./laneHealth";

/* ---------------------------------------------------------------- ambient */

interface McpCallResult {
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  payload?: unknown;
  cache?: { storedAt: number; revalidating: boolean };
}

type WatchEvent = { type: "data"; result: McpCallResult } | { type: "error"; error: unknown };

interface McpNamespace {
  callTool(server: string, tool: string, input?: unknown, options?: unknown): Promise<McpCallResult>;
  watchTool(
    server: string,
    tool: string,
    input: unknown,
    handler: (ev: WatchEvent) => void,
    options?: { cache?: { staleTime?: number; gcTime?: number }; refetchInterval?: number },
  ): () => void;
  listTools(): Promise<{ servers: Array<{ server: string; authStatus: string; tools: Array<{ name: string }> }> }>;
  invalidate(server?: string, tool?: string, input?: unknown): Promise<void>;
}

/* RUNTIME CONTRACT SHIFT (observed live 2026-08-29, probe on the 0.2.31 line):
   the platform stopped pre-injecting `window.claude.mcp`. The runtime now
   exposes ONLY `window.claude.use(name)`, which resolves the capability
   namespace asynchronously — same members (callTool/listTools/invalidate/
   watchTool), new acquisition. `acquireMcp()` below handles BOTH generations:
   a pre-injected `.mcp` (older runtimes, and every test that stubs it) wins
   immediately; otherwise `use("mcp")` is awaited once and stashed. main.tsx
   awaits acquisition before first render so the synchronous `mcpAvailable()`
   gate keeps its meaning everywhere downstream. */

type ClaudeRoot = { mcp?: McpNamespace; use?: (name: string) => Promise<McpNamespace | null> };

let acquired: McpNamespace | undefined;
let acquisition: Promise<void> | undefined;

export function acquireMcp(timeoutMs = 4000): Promise<void> {
  if (acquisition) return acquisition;
  acquisition = (async () => {
    if (typeof window === "undefined") return;
    const root = (window as unknown as { claude?: ClaudeRoot }).claude;
    if (!root) return;
    if (root.mcp) {
      acquired = root.mcp;
      return;
    }
    if (typeof root.use !== "function") return;
    try {
      const ns = await Promise.race([
        root.use("mcp"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (ns && typeof ns.callTool === "function") acquired = ns;
    } catch {
      // Unavailable is a state, not an error: the offline chip renders.
    }
  })();
  return acquisition;
}

function mcp(): McpNamespace | undefined {
  if (acquired) return acquired;
  if (typeof window === "undefined") return undefined;
  // Older runtimes (and tests) pre-inject the member; honor it synchronously.
  return (window as unknown as { claude?: ClaudeRoot }).claude?.mcp;
}

export function mcpAvailable(): boolean {
  return mcp() !== undefined;
}

/* ------------------------------------------------------- manifest constants */

/** Connector DISPLAY NAMES — the `server` argument. Never a connector id. */
export const SERVERS = {
  customer360: "Customer 360",
  gateway: "IDB Gateway",
  m365: "Microsoft 365",
  /* THE MEMO ROOM'S TWO WRITEBACK CONNECTORS (2026-09-04). The Experience
     connector owns the nCino credit-memo surface (the cm_* narrative fields,
     the nFORMS document, the approval submit and the notice) plus the
     Experience decision and audit ledger; AFS owns servicing. They are named
     here exactly as the viewer's connector list spells them: a display name,
     never an id, and a differently named connector is invisible to the page. */
  experience: "Experience / nCino",
  afs: "AFS",
} as const;

/** Upstream tool names exactly as `listTools()` returns them.
 *  NOTE: colons are invalid in manifest tool names (422 at publish). */
export const TOOLS = {
  snapshot: "Customer360Snapshot",
  portfolio: "Customer360Portfolio",
  graph: "Customer360RelationshipGraph",
  exposure: "Customer360Exposure",
  covenants: "Customer360Covenants",
  opportunities: "Customer360Opportunities",
  structuralSignals: "Customer360StructuralSignals",
  /* THE BOOK IS THE ORG'S BOOK (2026-09-03). Partial-name account search, and
     the door to every relationship this snapshot did not bake. IN THE MANIFEST
     as of this wave: the Customer 360 grant is 25 tools with this one in it
     (design/proposals/intent-handoff-addendum.md carries the exact declaration
     for the integrator). OBSERVED SHAPE:
       input  { name, industry?, maxResults? }   maxResults defaults to 25
       output { count, results: [{ accountId, name, industry, naicsCode,
                annualRevenue }] }
     A READ, and the only figures it carries are labels: everything the cockpit
     renders about a relationship comes off the eight reads that follow, never
     off the search hit. */
  searchAccounts: "Customer360SearchAccounts",
  // The durable action trail. Read-only; deploying in parallel with this UI.
  actionHistory: "Customer360ActionHistory",
  /* THE ORG'S OWN CHIP SETS, deployed 2026-09-02 as the 25th tool on the
     Customer 360 definition. One read, no input, every picklist and both lookup
     catalogs the create grammar draws chips from. Read-only: one
     @InvocableMethod, WITH USER_MODE on both queries, no DML anywhere.

     THE CONNECTOR'S TOOL LIST CHANGED WHEN THE DEFINITION DEPLOYED, so the
     client's tool-schema cache needs a fresh session before this name resolves.
     Until it does, `readCatalog` returns null and every chip set falls back to
     the shell's mirror, which is where they have been since the room shipped. */
  catalog: "Customer360Catalog",
  boomRatios: "boom-mcp-js___boom_get_ratios",
  boomSpread: "boom-mcp-js___boom_get_spread",
  llm: "idb-bg-api-target-get-llm-response-staging___get_llm_response",
  mailSearch: "outlook_email_search",
  // WP5 write tools, deployed 2026-07-26. stage_* performs ZERO domain DML;
  // every org write is behind the token-gated execute_*.
  stageCollateralValuation: "stage_collateral_valuation",
  executeCollateralValuation: "execute_collateral_valuation",
  stageServiceRequest: "stage_service_request",
  executeServiceRequest: "execute_service_request",
  stageAnnualReview: "stage_annual_review",
  executeAnnualReview: "execute_annual_review",
  // Wave 2. Built against the frozen contracts; the seam swaps on observation.
  stageNewFacility: "stage_new_facility",
  executeNewFacility: "execute_new_facility",
  stageRiskRatingReview: "stage_risk_rating_review",
  executeRiskRatingReview: "execute_risk_rating_review",
  stageCovenantReview: "stage_covenant_review",
  executeCovenantReview: "execute_covenant_review",
  // WS0.5, deployed 2026-08-22. The modification pair is complete: executing a
  // staged plan clones the facility, writes the chain junction row and applies
  // the changes to the clone. BOOKING that clone is still nCino's own Submit
  // for Approval run (LV06), which the plan's warnings state.
  stageLoanModification: "stage_loan_modification",
  executeLoanModification: "execute_loan_modification",
  /* RELATIONSHIP INTAKE (2026-09-03). The pair that authors on the relationship:
     a covenant with an account junction and no loan junction, and a collateral
     asset with its ownership junction and no pledge. Built to the frozen
     contract; the connector publishes it when the definition deploys, and until
     it does the room reports the tool as unavailable rather than pretending. */
  stageRelationshipIntake: "stage_relationship_intake",
  executeRelationshipIntake: "execute_relationship_intake",
  /* THE SECOND HOP FOR A NET-NEW FACILITY'S PURPOSE (2026-09-03).
     `LLC_BI__Primary_Loan_Purpose__c` lives on `LLC_BI__Loan_Detail__c`, which
     nCino creates from an after-commit flow of its own, so nothing in the
     transaction that files the facility can set it. This finishes it, in its own
     hop so the 2026-08-31 governor fix stays intact. */
  completeNewFacilityDetail: "complete_new_facility_detail",
  // Renewal STAGES only. There is no execute_renewal: the clone's collateral
  // aggregate has never been re-probed, so no execute tool was built.
  stageRenewal: "stage_renewal",
  /* THE MEMO WRITEBACK (2026-09-04), on "Experience / nCino". Upstream names
     exactly, observed live on 2026-09-04 (app/src/memo/OBSERVED.md). The first
     five WRITE to the system of record and are never auto-retried; the ledger
     pair writes to Snowflake; the last two are reads the memo room draws on. */
  syncMemoSections: "ncino_sync_memo_sections",
  publishCreditMemo: "ncino_publish_credit_memo",
  finalizeCreditMemo: "ncino_finalize_credit_memo",
  submitForApproval: "ncino_submit_for_approval",
  ncinoNotify: "ncino_notify",
  recordDecision: "record_decision",
  logAuditEvent: "log_audit_event",
  recallDecisions: "recall_decisions",
  // Deterministic: the grade is the connector's comparison, never the model's.
  covenantGrade: "deal_covenant_grade",
  /* SERVICING (2026-09-04), on "AFS". Every one of these DEFAULTS its key to
     the AFS sample loan, which belongs to a real and different borrower, so
     nothing here is ever called without a mapping (app/src/memo/afsMapping.ts). */
  afsLoanSummary: "loan_summary",
  afsPaymentHistory: "payment_history",
  afsRevolverUtilization: "revolver_utilization",
  afsCreateWorkpackage: "create_workpackage",
} as const;

/** The six per-account detail tools, in the order the app stages them. */
export const DETAIL_TOOLS = [
  TOOLS.snapshot,
  TOOLS.graph,
  TOOLS.exposure,
  TOOLS.covenants,
  TOOLS.opportunities,
  TOOLS.structuralSignals,
] as const;

/** The bundle keys those six tools map onto, POSITIONALLY. One definition:
 *  three files used to carry their own copy of this list and a re-order in any
 *  one of them would have silently filed the exposure read as the graph. */
export const DETAIL_KEYS = ["snapshot", "graph", "exposure", "covenants", "opportunities", "signals"] as const;

export type DetailKey = (typeof DETAIL_KEYS)[number];

/* ---------------------------------------------------------- error doctrine */

export type McpErrorCode =
  | "needs_reauth"
  | "server_not_connected"
  | "selection_required"
  | "server_not_found"
  | "server_unavailable"
  | "not_in_manifest"
  | "blocked_by_policy"
  | "approval_required"
  | "tool_error"
  | "bad_request"
  | "cancelled"
  | "rate_limited"
  | "upstream_error"
  | "not_granted"
  | "capability_disabled"
  | "capability_removed"
  | "transform_error";

export interface McpFailure {
  code: McpErrorCode;
  server?: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  /** Copy telling the viewer the ONE action that fixes this state. */
  fix: string;
  /** Authz denial ⇒ rendered data must be RETRACTED, not left stale. */
  retract: boolean;
  /** No connector bridge in this view at all ⇒ render the no-MCP experience. */
  noCapability: boolean;
  /** Outcome genuinely unknown — the tool may still have run. Never auto-retry
   *  a write in this state; re-issue only behind a fresh user gesture. */
  ambiguous: boolean;
}

const RETRACT_CODES = new Set<McpErrorCode>([
  "needs_reauth",
  "server_not_connected",
  "blocked_by_policy",
  "approval_required",
]);

const NO_CAPABILITY_CODES = new Set<McpErrorCode>(["not_granted", "capability_disabled", "capability_removed"]);

/** Outcome-unknown for writes (a rejection is NOT proof the tool did not run). */
const AMBIGUOUS_CODES = new Set<McpErrorCode>(["server_unavailable", "upstream_error", "cancelled"]);

function fixCopy(code: McpErrorCode, server: string, tool: string): string {
  switch (code) {
    case "needs_reauth":
      return `Reconnect ${server} in claude.ai Settings → Connectors.`;
    case "server_not_connected":
      return `Add ${server} in claude.ai Settings → Connectors.`;
    case "selection_required":
      return `You have more than one ${server} connector. Choose one when claude.ai prompts.`;
    case "server_not_found":
      return `${server} no longer exists upstream. Check the connector in claude.ai Settings.`;
    case "server_unavailable":
      return `${server} is briefly unreachable. Showing the last good data. Try again in a moment.`;
    case "not_in_manifest":
      return `This cockpit isn't authorised to call ${tool} on ${server}.`;
    case "blocked_by_policy":
      // NOT an org policy and NOT the connector. Settled diagnosis: this is the
      // claude.ai shell's per-page-session trust budget on the artifact-to-
      // connector bridge — it burns with call volume and payload shape, hides
      // the whole connector from the page when tripped, and expires on its own.
      // Blaming "your organisation's policy" alarmed bankers and sent them
      // hunting a non-existent IT ticket, so the copy names the real cause and
      // the real fix.
      return "The workspace paused AI chat for this page session. That is a platform safety limit, not the Gateway and not your bank's policy. Reload the cockpit to continue; your place is kept.";
    case "approval_required":
      return `${tool} needs per-call approval, which artifacts don't support yet.`;
    case "tool_error":
      return `${server} ran ${tool} but reported a failure.`;
    case "bad_request":
    case "transform_error":
      return `The cockpit sent a malformed request to ${server}. This is a bug, not your setup.`;
    case "cancelled":
      return `Cancelled before it finished. It may still have run.`;
    case "rate_limited":
      return `Too many connector calls just now. Wait a moment and retry.`;
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
      return `This view is running without connector access.`;
    default:
      return `${server} couldn't complete ${tool}.`;
  }
}

/** Normalize an unknown rejection into the branchable failure shape. */
export function describeFailure(err: unknown, server: string, tool: string): McpFailure {
  const e = (err ?? {}) as { code?: string; server?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
  // Unknown codes are treated as upstream_error, per the contract.
  const known: McpErrorCode[] = [
    "needs_reauth", "server_not_connected", "selection_required", "server_not_found", "server_unavailable",
    "not_in_manifest", "blocked_by_policy", "approval_required", "tool_error", "bad_request", "cancelled",
    "rate_limited", "upstream_error", "not_granted", "capability_disabled", "capability_removed", "transform_error",
  ];
  const code = (known.includes(e.code as McpErrorCode) ? e.code : "upstream_error") as McpErrorCode;
  return {
    code,
    server: e.server ?? server,
    message: e.message ?? String(err),
    // Trust ONLY the platform's stamp — never infer retryability from the code.
    retryable: e.retryable === true,
    retryAfterMs: e.retryAfterMs,
    fix: fixCopy(code, e.server ?? server, tool),
    retract: RETRACT_CODES.has(code),
    noCapability: NO_CAPABILITY_CODES.has(code),
    ambiguous: AMBIGUOUS_CODES.has(code),
  };
}

/* -------------------------------------------------------------- call layer */

export interface McpOk<T> {
  payload: T;
  /** Present only when served from cache. Drive "last updated" from
   *  `cache.storedAt` — NEVER Date.now(). Absent ⇒ executed fresh. */
  cache?: { storedAt: number; revalidating: boolean };
  raw: McpCallResult;
}

export interface CallOptions {
  /** Reads may be retried once when the platform stamps `retryable`.
   *  Writes never auto-retry: a rejection is not proof the tool did not run. */
  read?: boolean;
  cache?: false | { staleTime?: number; gcTime?: number; refresh?: boolean };
  signal?: AbortSignal;
}

/* ------------------------------------------------------------ retry policy

   ONE policy, for READS ONLY, shared by `callTool` and by the watch wrapper
   below. The Salesforce-hosted MCP session expires on idle, so the first call
   after a pause fails `server_unavailable` and the very next one succeeds once
   the connector has re-handshaked. Surfacing that first failure to the banker
   is the defect: it reads as an outage and, on a watch with no polling, it
   stuck until the view remounted.

   THREE ATTEMPTS, NOT TWO, AND THE STAMP IS NO LONGER REQUIRED FOR 502.
   On 2026-09-03 the artifact-to-connector relay lost its Salesforce session for
   two hours: every call the PAGE made answered `server_unavailable: request
   failed (502)` while the same tools answered normally in chat. One retry
   500-1500ms later lands inside the same dead window, and a `server_unavailable`
   that arrives WITHOUT `retryable: true` was not retried at all, which is the
   shape that stood for two hours. So `server_unavailable` is retryable on its
   own code, and a read gets three attempts with the delay doubling between
   them: worst case 500+1500 to 1500+3000ms of waiting, comfortably inside the
   twelve seconds a banker will sit through before deciding the page is broken.

   WHAT DID NOT CHANGE, and must not: never for a write, because
   `server_unavailable` on a write is an ambiguous outcome and not proof the
   tool did not run; never for an authz denial, because repeating it cannot
   succeed on its own; never longer than the platform's own `retryAfterMs`
   asked for, and never past the shell's own minute-long clamp. */

export const RETRY_MIN_MS = 500;
export const RETRY_MAX_MS = 1500;
/** Total attempts for a read: the call itself plus two retries. */
export const RETRY_ATTEMPTS = 3;
/** The shell clamps `retryAfterMs` at 60s; never wait longer than that. */
const RETRY_CEILING_MS = 60_000;

/** Worst case time a read spends WAITING between its attempts: the whole window
 *  the retry policy can keep a banker in the dark before something renders.
 *  Held to a number so "inside twelve seconds" is a fact and not a hope. */
export const RETRY_BUDGET_MS = RETRY_MAX_MS * (2 ** (RETRY_ATTEMPTS - 1) - 1);

/** Randomised 500-1500ms on the first retry and doubling per attempt after it,
 *  never earlier than the platform's own `retryAfterMs`. */
export function retryDelayMs(
  failure: { retryAfterMs?: number },
  random: () => number = Math.random,
  attempt = 0,
): number {
  const jittered = (RETRY_MIN_MS + Math.floor(random() * (RETRY_MAX_MS - RETRY_MIN_MS + 1))) * 2 ** attempt;
  return Math.min(Math.max(jittered, failure.retryAfterMs ?? 0), RETRY_CEILING_MS);
}

/** Codes a READ may retry on the code alone, with no platform stamp. The relay
 *  outage's own code is the whole list: it means "the door was shut", which is
 *  the one failure that answers a second knock. */
const SELF_RETRYABLE = new Set<McpErrorCode>(["server_unavailable"]);

/** May this READ failure be retried unattended? Never for a denial a retry
 *  could not fix, and never for a view with no bridge at all. */
export function isRetryableRead(failure: McpFailure): boolean {
  if (failure.retract || failure.noCapability) return false;
  return failure.retryable === true || SELF_RETRYABLE.has(failure.code);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------- connector activity meter

   Two facts the keep-alive needs and nothing else reads: is a call happening
   right now, and when did the last one start. Both are about the CONNECTOR
   SESSION, not about data, so they live at the seam that owns every call.  */

let inFlightCalls = 0;
let lastCallStartedAt = 0;

/** True while at least one connector call is in flight. */
export function connectorBusy(): boolean {
  return inFlightCalls > 0;
}

/** When the most recent connector call STARTED (epoch ms), 0 if none has.
 *  Session warmth only, never a data freshness claim, which comes off
 *  `result.cache.storedAt`. */
export function lastConnectorCallAt(): number {
  return lastCallStartedAt;
}

/** Call a connector tool. Resolves with the unwrapped envelope, or rejects
 *  with a normalized {@link McpFailure} — never a raw platform error. */
export async function callTool<T = unknown>(
  server: string,
  tool: string,
  input?: unknown,
  options: CallOptions = {},
): Promise<McpOk<T>> {
  const api = mcp();
  if (!api) {
    const absent = describeFailure({ code: "capability_disabled", message: "window.claude.mcp is not available" }, server, tool);
    noteLaneFailure(server, absent);
    throw absent;
  }

  const invoke = async (): Promise<McpOk<T>> => {
    inFlightCalls += 1;
    lastCallStartedAt = Date.now();
    try {
      const result = await api.callTool(server, tool, input, {
        cache: options.cache,
        signal: options.signal,
      });
      return { payload: result.payload as T, cache: result.cache, raw: result };
    } finally {
      inFlightCalls -= 1;
    }
  };

  try {
    const ok = await invoke();
    noteLaneSuccess(server);
    return ok;
  } catch (err) {
    let failure = describeFailure(err, server, tool);
    // READS ONLY, up to RETRY_ATTEMPTS in total, each after a longer randomised
    // wait than the last. A write falls straight through: its outcome is
    // unknown and re-issuing it is the banker's gesture, never ours.
    if (options.read) {
      for (let attempt = 0; attempt < RETRY_ATTEMPTS - 1 && isRetryableRead(failure); attempt += 1) {
        await sleep(retryDelayMs(failure, Math.random, attempt));
        try {
          const ok = await invoke();
          noteLaneSuccess(server);
          return ok;
        } catch (err2) {
          failure = describeFailure(err2, server, tool);
        }
      }
    }
    noteLaneFailure(server, failure);
    throw failure;
  }
}

/* --------------------------------------------------------------- the grants

   WHAT THE VIEWER ACTUALLY GRANTED, asked once, before anything is read.

   A lane that was never granted and a lane that is briefly down look identical
   from a failed call, and the fix for them is opposite: one is a connector to
   add in claude.ai Settings, the other is a moment to wait. `listTools()` is
   the only thing that can tell them apart before the first read, so the health
   line asks it once at boot and reports what it said. */

/** Auth states that mean the lane is present but cannot be called as things
 *  stand. Anything else that appears in the list counts as granted. */
const UNUSABLE_AUTH = new Set(["not_connected", "needs_reauth", "unauthenticated", "disconnected"]);

export async function probeConnectorGrants(servers: readonly string[]): Promise<void> {
  const api = mcp();
  if (!api || typeof api.listTools !== "function") {
    noteNoBridge(servers);
    return;
  }
  try {
    const res = await api.listTools();
    const seen = new Map((res?.servers ?? []).map((s) => [s.server, String(s.authStatus ?? "")]));
    for (const server of servers) {
      const status = seen.get(server);
      noteLaneGrant(server, status !== undefined && !UNUSABLE_AUTH.has(status));
    }
  } catch {
    // A probe that cannot answer says nothing. The lanes keep whatever the
    // calls themselves have taught them, which is better evidence anyway.
  }
}

/** Register a live subscription. Returns a SYNCHRONOUS unsubscribe; store it
 *  before anything can fire. All failures — registration included — arrive on
 *  the handler as error events, so the caller keeps its static experience.
 *
 *  A watch is a READ, so it carries the same retry-once policy `callTool` does:
 *  a retryable failure is re-read once after a randomised 500-1500ms before the
 *  handler is told anything went wrong. That is the whole fix for the banner
 *  that stuck after an idle MCP session expired: the re-handshake lands inside
 *  the retry window and the viewer never sees a failure at all. */
export function watchTool(
  server: string,
  tool: string,
  input: unknown,
  handler: (ev: { data?: McpOk<unknown>; failure?: McpFailure }) => void,
  options?: { staleTime?: number; refetchInterval?: number },
): () => void {
  const api = mcp();
  if (!api) {
    const absent = describeFailure({ code: "capability_disabled" }, server, tool);
    noteLaneFailure(server, absent);
    handler({ failure: absent });
    return () => {};
  }

  let stopped = false;
  let retrying = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deliver = (result: McpCallResult) => {
    noteLaneSuccess(server);
    handler({ data: { payload: result.payload, cache: result.cache, raw: result } });
  };

  /** Re-read the SAME identity with a forced refresh, so the result also
   *  overwrites the cache entry the watch replays from. Chains up to the shared
   *  attempt budget: a two-hour relay outage is not survived by one knock, but
   *  a re-handshake almost always lands inside the second or third. */
  const scheduleRetry = (failure: McpFailure) => {
    retrying = true;
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped) return;
      void (async () => {
        try {
          const result = await api.callTool(server, tool, input, { cache: { refresh: true } });
          retrying = false;
          attempt = 0;
          if (!stopped) deliver(result ?? {});
        } catch (err) {
          const next = describeFailure(err, server, tool);
          attempt += 1;
          if (attempt < RETRY_ATTEMPTS - 1 && isRetryableRead(next) && !stopped) {
            scheduleRetry(next);
            return;
          }
          retrying = false;
          attempt = 0;
          noteLaneFailure(server, next);
          if (!stopped) handler({ failure: next });
        }
      })();
    }, retryDelayMs(failure, Math.random, attempt));
  };

  const onFailure = (failure: McpFailure) => {
    if (stopped) return;
    // A retry already in flight owns this refresh: a second error event while
    // it runs must not start a second retry, and must not raise the banner the
    // retry is about to settle.
    if (retrying) return;
    if (!isRetryableRead(failure)) {
      noteLaneFailure(server, failure);
      handler({ failure });
      return;
    }
    attempt = 0;
    scheduleRetry(failure);
  };

  let stop: () => void = () => {};
  try {
    stop = api.watchTool(
      server,
      tool,
      input,
      (ev) => {
        if (stopped) return;
        if (ev.type === "data") {
          // Live data cancels a pending retry: the refresh already landed.
          retrying = false;
          attempt = 0;
          if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
          deliver(ev.result);
        } else {
          onFailure(describeFailure(ev.error, server, tool));
        }
      },
      {
        cache: options?.staleTime !== undefined ? { staleTime: options.staleTime } : undefined,
        // Polling is clamped to a ~30s floor by the platform; never go tighter.
        refetchInterval: options?.refetchInterval,
      },
    );
  } catch (e) {
    const failure = describeFailure(e, server, tool);
    noteLaneFailure(server, failure);
    handler({ failure });
    return () => {};
  }

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    stop();
  };
}

/* ------------------------------------------------------ envelope unwrapping

   OBSERVED shapes (founder's live session 2026-07-25). Each unwrapper is
   defensive: an envelope that does not match reports a failure rather than
   silently yielding undefined figures.                                      */

/**
 * A PLAIN MCP TOOL'S JSON RESULT.
 *
 * The Customer 360 tools answer in the Salesforce invocable envelope, which the
 * unwrappers below take apart. The two memo-writeback connectors are ordinary
 * MCP servers: each tool answers with its own JSON object. Through this
 * session's tool bridge that object arrives whole (OBSERVED.md), but the
 * ARTIFACT bridge has not been observed carrying one, so this reads the three
 * places the runtime contract allows a result to live rather than assuming the
 * first: `payload`, then `structuredContent`, then a single JSON text block.
 *
 * Returns undefined when none of them carries an object, which every caller
 * treats as a failed call rather than as an empty success.
 */
export function unwrapJson<T = Record<string, unknown>>(result: McpOk<unknown>): T | undefined {
  const asObject = (v: unknown): T | undefined =>
    typeof v === "object" && v !== null && !Array.isArray(v) ? (v as T) : undefined;

  const direct = asObject(result.payload) ?? asObject((result.raw as { structuredContent?: unknown })?.structuredContent);
  if (direct) return direct;

  const block = (result.raw?.content ?? [])[0] as { text?: unknown } | undefined;
  if (typeof block?.text !== "string") return undefined;
  try {
    return asObject(JSON.parse(block.text));
  } catch {
    return undefined;
  }
}

/** One element of the Salesforce invocable envelope. */
export type InvocableSlot<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Customer 360 tools return the SALESFORCE INVOCABLE ENVELOPE:
 *   { content: [ { actionName, isSuccess, errors, outputValues, sortOrder, version } ] }
 * One element per request in the inputs array, POSITIONAL — element i belongs
 * to input i. `isSuccess: false` / non-null `errors` is a per-element failure
 * and must not contaminate its siblings.
 */
export function unwrapInvocable<T = Record<string, unknown>>(payload: unknown, expected?: number): Array<InvocableSlot<T>> {
  const content = (payload as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) {
    return Array.from({ length: expected ?? 1 }, () => ({
      ok: false as const,
      error: "unexpected envelope: no content[] array",
    }));
  }
  const slots = content.map((el): InvocableSlot<T> => {
    const e = (el ?? {}) as { isSuccess?: boolean; errors?: unknown; outputValues?: T };
    const failed = e.isSuccess === false || (e.errors != null && e.errors !== "");
    if (failed) {
      const msg = Array.isArray(e.errors) ? e.errors.join("; ") : String(e.errors ?? "action reported failure");
      return { ok: false, error: msg };
    }
    if (!e.outputValues) return { ok: false, error: "element carried no outputValues" };
    return { ok: true, data: e.outputValues };
  });
  // Positional integrity: a short envelope must not silently misalign inputs.
  if (expected !== undefined && slots.length !== expected) {
    return Array.from({ length: expected }, (_, i) =>
      slots[i] ?? { ok: false as const, error: `envelope returned ${slots.length} elements for ${expected} inputs` },
    );
  }
  return slots;
}

/** Convenience for the single-input case. */
export function unwrapInvocableOne<T = Record<string, unknown>>(payload: unknown): InvocableSlot<T> {
  return unwrapInvocable<T>(payload, 1)[0];
}

export interface LlmAnswer {
  text: string;
  model?: string;
  costUsd?: number;
}

/**
 * get_llm_response returns { statusCode, headers, body: "<JSON STRING>" }.
 * The body must be JSON.parsed; `.response` is markdown TEXT which we render
 * as plain text (A13 — never as HTML/Markdown).
 */
export function unwrapLlm(payload: unknown): LlmAnswer {
  const env = (payload ?? {}) as { statusCode?: number; body?: unknown };
  const raw = env.body;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A non-JSON body is still an answer — surface the text rather than fail.
      return { text: raw };
    }
  }
  const b = (parsed ?? {}) as { response?: unknown; model?: unknown; cost_usd?: unknown };
  const text = typeof b.response === "string" ? b.response : typeof parsed === "string" ? parsed : "";
  return {
    text,
    model: typeof b.model === "string" ? b.model : undefined,
    costUsd: typeof b.cost_usd === "number" ? b.cost_usd : undefined,
  };
}

/** outlook_email_search returns a list; [] is an honest "no matches". */
/** Fields that make a row a MESSAGE rather than an envelope artefact. */
const MESSAGE_FIELDS = ["subject", "id", "internetMessageId", "sender", "receivedDateTime", "webLink", "summary"];

function looksLikeMessage(row: Record<string, unknown>): boolean {
  return MESSAGE_FIELDS.some((f) => row[f] !== undefined);
}

const isRow = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every shape the mail search has actually answered in.
 *
 * LIVE DEFECT 2026-07-27: a search matching exactly ONE email returns a single
 * BARE OBJECT — not an array, not `{value}`. This returned [] and the sweep
 * reported "nothing new", which is precisely the founder's one-test-email case:
 * the tool found the mail and the cockpit threw it away.
 *
 * So: an array passes through; a wrapper key is unwrapped; a bare object is a
 * list of one; a string payload is parsed as JSON and then, failing that, as
 * JSONL. A trailing paging row is dropped rather than rendered as a message
 * with no subject.
 */
export function unwrapMail(payload: unknown): Array<Record<string, unknown>> {
  // A paging tail carries no message fields, so the same predicate drops it:
  // one rule, rather than a list of shapes to keep in step.
  return collectMailRows(payload).filter(looksLikeMessage);
}

function collectMailRows(payload: unknown): Array<Record<string, unknown>> {
  if (payload === null || payload === undefined) return [];
  if (Array.isArray(payload)) return payload.filter(isRow);

  if (typeof payload === "string") {
    const text = payload.trim();
    if (!text) return [];
    try {
      return collectMailRows(JSON.parse(text));
    } catch {
      // JSONL: one JSON document per line, which is how some gateways stream
      // multiple results. A line that will not parse is skipped, not guessed at.
      const rows: Array<Record<string, unknown>> = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          rows.push(...collectMailRows(parsed));
        } catch {
          /* not a document; skip */
        }
      }
      return rows;
    }
  }

  if (!isRow(payload)) return [];

  const p = payload as { results?: unknown; messages?: unknown; value?: unknown; items?: unknown };
  for (const candidate of [p.results, p.messages, p.value, p.items]) {
    if (Array.isArray(candidate)) return candidate.filter(isRow);
    // A wrapper around a single result is still a single result.
    if (isRow(candidate)) return [candidate];
    if (typeof candidate === "string") return collectMailRows(candidate);
  }

  // A BARE MESSAGE OBJECT: the observed single-match shape. An object with no
  // message fields at all is an empty envelope, not a message.
  return looksLikeMessage(payload) ? [payload] : [];
}
