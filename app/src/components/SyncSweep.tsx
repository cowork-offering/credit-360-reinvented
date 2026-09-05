import { useRef, useState } from "react";
import { useApp } from "../state/appState";
import { Portal } from "./Portal";
import { mcpAvailable, SERVERS } from "../channel/mcp";
import { useLaneHealth } from "../channel/laneHealth";
import { reachReport, runSyncSweep, type SyncLine } from "../channel/syncSweep";
import { noteMailArrival } from "../actions/mailRow";
import { dataVersionOf, saveOverlay } from "../state/syncOverlay";
import { diffBundles, deltaReport, type DeltaField } from "../data/delta";
import type { BorrowerBundle } from "../data/contract";
import { fmtAsOf, fmtRelative } from "../data/format";

/* =============================================================================
   SYNC (WP7)

   One button in the account header, replacing the separate refresh and inbox
   controls that used to sit on the Activity tab. The entries those produced are
   unchanged; only the trigger moved.

   The sweep is GESTURE ONLY. No polling, no auto-sync, and the button is
   disabled while a sweep runs, so one gesture is one round of reads.
   ============================================================================= */

function Tick({ state }: { state: SyncLine["state"] }) {
  if (state === "done") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ color: "var(--positive)" }}>
        <path d="M3.5 8.4l3 3 6-6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ color: "var(--warning)" }}>
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "running") {
    return (
      <span
        className="c360-sync-spin block h-[11px] w-[11px] rounded-full"
        style={{ border: "1.8px solid var(--accent)", borderTopColor: "transparent" }}
        aria-hidden="true"
      />
    );
  }
  return <span className="block h-[11px] w-[11px] rounded-full" style={{ border: "1.5px solid var(--border)" }} aria-hidden="true" />;
}

function SweepConsole({ lines, report }: { lines: SyncLine[]; report: string | null }) {
  return (
    <Portal>
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        style={{ zIndex: "var(--z-modal)", background: "var(--scrim)" }}
        role="presentation"
      >
        <div
          role="status"
          aria-live="polite"
          aria-label="Syncing this relationship"
          className="c360-panel-in w-full max-w-[380px] rounded-[16px] bg-raised px-5 py-4"
          style={{ boxShadow: "var(--shadow-panel)", border: "1px solid var(--border)", transformOrigin: "center" }}
        >
          <div className="kicker mb-3">Syncing</div>
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.id} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex-none">
                  <Tick state={l.state} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="text-[12.5px] leading-snug"
                    style={{ color: l.state === "pending" ? "var(--ink-faint)" : "var(--ink-body)" }}
                  >
                    {l.label}
                  </span>
                  {l.detail && (
                    <span
                      className="block text-[11px] leading-snug"
                      style={{ color: l.state === "failed" ? "var(--warning)" : "var(--ink-faint)" }}
                    >
                      {l.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {report && <div className="mt-3 border-t border-divider pt-3 text-[12.5px] font-semibold text-ink">{report}</div>}
        </div>
      </div>
    </Portal>
  );
}

/* =============================================================================
   "AS OF": what the figures beside it are, while they are not live yet.

   The cockpit opens on baked figures, then on whatever stored last-good the
   artifact store had, and only then on the org's own answer. The first two
   states are honest data and dishonest presentation unless the hero says so, so
   it says so, in the smallest words that stay true, and STOPS saying it the
   moment the Customer 360 lane answers live. When that lane is down the same
   line carries why, from the health store the footer reads: one source, so the
   hero and the status line can never disagree.
   ============================================================================= */
function AsOfNote({ storedAt, generatedAt }: { storedAt?: number; generatedAt?: string }) {
  const lanes = useLaneHealth();
  const lane = lanes[SERVERS.customer360];
  // Live means the org answered this session. Nothing to caveat.
  if (lane?.state === "live") return null;

  const baked = generatedAt ? Date.parse(generatedAt) : NaN;
  const at = storedAt ?? (Number.isNaN(baked) ? undefined : baked);
  if (at === undefined) return null;

  const down = lane?.state === "unreachable" && lane.grant === "granted";
  return (
    <span
      className="self-center text-[11px] leading-none"
      style={{ color: down ? "var(--warning)" : "var(--ink-faint)" }}
      data-asof={at}
    >
      As of {fmtAsOf(at)}
      {down && ` \u00b7 ${SERVERS.customer360} unreachable`}
    </span>
  );
}

/** Cooldown between sweeps for the SAME account view. UI pacing only — never
 *  used for data-derived reasoning (A10). */
const SYNC_COOLDOWN_MS = 5_000;

export function SyncButton({ accountId, accountName, bundle }: { accountId: string; accountName: string; bundle: BorrowerBundle }) {
  const { data, state, dispatch } = useApp();
  const [lines, setLines] = useState<SyncLine[] | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [fresh, setFresh] = useState(false);
  const lastSweepStartedAt = useRef(0);

  if (!mcpAvailable()) {
    // DIAGNOSTIC, not decoration: name WHICH layer is missing so a viewer can
    // read the code out loud. R0 = no Claude runtime at all (static hosting,
    // e.g. the /s/ share). R1 = Claude runtime present but the connector
    // capability was not granted to this view (consent missing or withheld).
    const hasClaude = typeof window !== "undefined" && (window as { claude?: unknown }).claude !== undefined;
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
        style={{ background: "var(--neutral-bg)", color: "var(--ink-muted)", border: "1px solid var(--border)" }}
        title={
          hasClaude
            ? "This view has a Claude runtime but no bank connection was granted. Reload the page and accept the connection prompt."
            : "This copy is static hosting with no Claude runtime; live sync can never run here. Open the claude.ai artifact instead."
        }
      >
        offline · {hasClaude ? "R1 no grant" : "R0 no runtime"}
      </span>
    );
  }

  const storedAt = state.liveStoredAt[accountId];

  async function sync() {
    if (running) return; // one gesture, one sweep
    // Rapid re-syncs are the platform-budget burn pattern: a second sweep
    // seconds after the first can only return what the first just fetched,
    // while still spending connector budget. Acknowledge instead of firing.
    const sinceLast = Date.now() - lastSweepStartedAt.current;
    if (sinceLast < SYNC_COOLDOWN_MS) {
      setFresh(true);
      setTimeout(() => setFresh(false), 1600);
      return;
    }
    lastSweepStartedAt.current = Date.now();
    setRunning(true);
    setReport(null);
    dispatch({ type: "CLEAR_PULSE" });

    /** The bundle as the banker was reading it when the sweep started. */
    const before = bundle;
    let deltas: DeltaField[] = [];
    let requestCount = 0;
    /* Reachability is its own sentence, ahead of the delta. "Everything
       current, nothing new" after a line failed transiently read as an
       all-clear, which is part of why the covenant position looked like it was
       failing on Sync. */
    let reach: string | null = null;
    try {
      const result = await runSyncSweep({
        accountId,
        accountName,
        generatedAt: data.meta?.generatedAt ?? new Date().toISOString(),
        bundle,
        slowTierFetchedAt: state.slowTierFetchedAt[accountId],
        onLines: setLines,
      });
      // The delta is measured on what the banker was actually reading, against
      // what the org just returned, merged the same way the view merges it.
      deltas = diffBundles(before, { ...before, ...result.patch });
      requestCount = result.requests.length;
      reach = reachReport(result);

      // The client's ask enters by the SAME door a staged request does, so the
      // modification ticket prefills from it with CLIENT_REQUEST provenance and
      // the message as its citation. No second prefill mechanism.
      const patch = result.clientRequests?.length
        ? { ...result.patch, requests: [...result.clientRequests, ...(bundle?.requests ?? [])] }
        : result.patch;
      dispatch({ type: "PATCH_BUNDLE", accountId, patch, storedAt: result.storedAt });
      if (result.history) dispatch({ type: "SET_ACTION_HISTORY", accountId, rows: result.history });
      if (result.fetchedAt) dispatch({ type: "SET_SLOW_TIER_FETCHED", accountId, fetchedAt: result.fetchedAt });

      // Persist the READ overlay so a reload does not lose the fetched email.
      // Nothing from staging or execution goes in here, ever.
      saveOverlay(dataVersionOf(data.meta), accountId, {
        patch: { ...(state.livePatches[accountId] ?? {}), ...patch },
        activity: [...result.requests, ...(state.sessionActivity[accountId] ?? [])].slice(0, 25),
        history: result.history ?? state.actionHistory[accountId],
        storedAt: result.storedAt ?? state.liveStoredAt[accountId],
        fetchedAt: { ...(state.slowTierFetchedAt[accountId] ?? {}), ...result.fetchedAt },
      });
      if (result.requests.length) {
        dispatch({ type: "INGEST_REQUESTS", accountId, entries: result.requests });
        /* THE ARRIVAL IS A WHISPER, NOT A POPUP. The corner offers the newest
           message and the room it points at; nothing opens on its own. */
        noteMailArrival(accountId, accountName, result.requests);
      }
    } catch {
      // A sweep that falls over keeps the workspace exactly as it was. The
      // per-line failures already said what did not come back.
    } finally {
      const summary = [reach, deltaReport(deltas, requestCount)].filter(Boolean).join(" ");
      setReport(summary);
      // Hold the report on the console briefly, then lift the scrim and let
      // the changed values pulse where they sit.
      setTimeout(() => {
        setLines(null);
        setRunning(false);
        if (deltas.length) {
          dispatch({ type: "PULSE", ids: deltas.map((d) => d.id) });
          setTimeout(() => dispatch({ type: "CLEAR_PULSE" }), 2000);
        }
      }, 900);
    }
  }

  return (
    <>
      <AsOfNote storedAt={storedAt} generatedAt={data.meta?.generatedAt} />
      <button
        type="button"
        onClick={() => void sync()}
        disabled={running}
        title={
          storedAt != null
            ? `Live data as of ${fmtRelative(new Date(storedAt).toISOString(), data.meta?.generatedAt ?? "")}`
            : "Read this relationship from the org and check your inbox"
        }
        className="c360-press inline-flex flex-none items-center gap-1.5 self-center rounded-[8px] border border-border px-3 py-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
      >
        <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
          <path
            d="M15 9a6 6 0 1 1-1.8-4.3M15 3v3.4h-3.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {running ? "Syncing…" : fresh ? "Already fresh" : "Sync"}
      </button>
      {lines && <SweepConsole lines={lines} report={report} />}
    </>
  );
}
