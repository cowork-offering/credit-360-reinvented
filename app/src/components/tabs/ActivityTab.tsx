import { useMemo, useState } from "react";
import type { ActivityEntry, ActivityKind, BorrowerBundle } from "../../data/contract";
import { fmtDate, fmtRelative } from "../../data/format";
import { accountKey, useApp } from "../../state/appState";
import { historyActivityEntry, mergeTrail } from "../../actions/executedActivity";
import { openMailRoom, readMailRow } from "../../actions/mailRow";
import { staggerDelay } from "../../data/motion";
import { ActivityDetailModal } from "../ActivityDetailModal";
import { ActionPanel } from "../ActionPanel";
import { DISCARD_ACTION_ID, DISCARD_LABEL, DISCARD_LINE } from "../../actions/discardVersion";
import { discardTargetFor } from "../../actions/discardTarget";
import {
  recallRun,
  RESUME_LABEL,
  RESUME_LINE,
  RESUME_NEEDS_RESTAGE,
  stagingIdOf,
  stoppedRunRow,
} from "../../actions/resumeRun";
import { MODIFICATION_IN_PROGRESS } from "../../book/packages";
import { EmptyPane, Note, Pane, PaneCard, SecHead } from "./paneKit";

const EXPLAIN =
  "Walk me through this activity: what came in, what was concluded, what is next.";

/* THE AUDIT TRAIL IS PORCELAIN (rule 48): a fading spine, 9px dots with a white
   halo so the line passes behind them, and the latest entry as solid ink with
   its own aura. It carries no icon rail — the dot IS the marker, and a column
   of 30px tinted circles beside it was the "pill soup" the system bans. What
   the kinds still decide is the WORD beside a title and whether an entry is
   user-originated, which is a fact about who acted, not decoration. */
const KIND_META: Record<ActivityKind, { label: string; tone: "accent" | "neutral" | "user" }> = {
  ACTION_TRIGGERED: { label: "You", tone: "user" },
  // A30.4 — both execution kinds are USER-ORIGINATED and carry the user tone,
  // exactly like ACTION_TRIGGERED. A write the banker attempted and lost is
  // still a thing the banker did.
  ACTION_EXECUTED: { label: "You · filed", tone: "user" },
  ACTION_EXECUTION_FAILED: { label: "You · not filed", tone: "user" },
  ACTION_STAGED: { label: "You · staged", tone: "user" },
  REQUEST_RECEIVED: { label: "Client request", tone: "accent" },
  ANALYSIS_CONCLUDED: { label: "Analysis", tone: "neutral" },
  COVENANT_EVALUATED: { label: "Covenant", tone: "neutral" },
  FACILITY_MODIFIED: { label: "Facility", tone: "neutral" },
  RENDER_AUDIT: { label: "Audit", tone: "neutral" },
};

/** Source citation. NO fake links: without a webLink the id renders as plain
 *  monospace text (A29/A30.2). */
export function ReferenceCitation({ reference }: { reference?: ActivityEntry["reference"] }) {
  if (!reference?.id && !reference?.label) return null;
  const text = reference.label ?? reference.id!;
  return (
    <span className="cite">
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
        <path d="M6.5 9.5a3 3 0 004.2 0l2.1-2.1a3 3 0 10-4.2-4.2l-.7.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M9.5 6.5a3 3 0 00-4.2 0L3.2 8.6a3 3 0 104.2 4.2l.7-.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {(reference.source ?? reference.kind) && <b style={{ fontWeight: 600 }}>{reference.source ?? reference.kind}</b>}
      <span style={{ fontFamily: "var(--font-mono)" }}>{text}</span>
    </span>
  );
}

/* =============================================================================
   AN INBOUND MESSAGE ON THE TRAIL (founder, 2026-09-03: "it looks pretty bad,
   it has this long winded text, and the pop up still opens up the old loan
   modification tab, not our workroom. I need it sleek and elegant.")

   ONE COMPACT ROW. The subject, who sent it, when, and the ask in one line.
   THE BODY IS NOT IN THE DEFAULT DOM AT ALL. It arrives on one click and
   leaves on the next, which is the difference between a trail and an inbox.

   ONE QUIET ACTION, and it opens OUR facility workroom on this message (rule
   41: a plain ink pill, never a violet one). The old detail modal is not on
   this row: it ended in a registry action that opened the pre-workroom panel,
   which is exactly the defect. Every other kind of entry keeps it.
   ============================================================================= */
function MailEntry({
  entry,
  row,
  index,
  onOpen,
}: {
  entry: ActivityEntry;
  row: NonNullable<ReturnType<typeof readMailRow>>;
  index: number;
  onOpen: () => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div
      data-origin="system"
      data-mail-row={entry.id}
      className={`tli mail${index === 0 ? " hot" : ""}`}
      style={{ animationDelay: staggerDelay(index, 70, 420) }}
    >
      <div className="mhead">
        <span className="mwho">
          <b>{row.subject}</b>
          <span className="m" title={fmtDate(entry.ts)}>
            {row.from ? `${row.from} · ` : ""}
            {fmtRelative(entry.ts, new Date().toISOString())}
          </span>
        </span>
        <button type="button" className="eg-btn-ink mopen" data-mail-open={entry.id} onClick={onOpen}>
          Open in workroom
        </button>
      </div>
      {row.ask && <span className="mask">{row.ask}</span>}
      {row.body && (
        <button
          type="button"
          className="mmore"
          aria-expanded={shown}
          data-mail-expand={entry.id}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? "Hide message" : "Show message"}
        </button>
      )}
      {shown && row.body && (
        <div className="mbody" data-mail-body={entry.id}>
          <p>{row.body}</p>
          <ReferenceCitation reference={entry.reference} />
        </div>
      )}
    </div>
  );
}

/** One entry on the trail. The row is a button because it opens the detail
 *  modal; it wears no box for that, only the dot and the pointer. */
function TrailEntry({
  entry,
  index,
  onOpen,
}: {
  entry: ActivityEntry;
  index: number;
  onOpen: () => void;
}) {
  const meta = KIND_META[entry.kind] ?? KIND_META.RENDER_AUDIT;
  const isRequest = entry.kind === "REQUEST_RECEIVED";
  const isUser = meta.tone === "user";
  const steps = entry.detail?.nextSteps?.length ?? 0;

  return (
    <button
      type="button"
      // A30.4 — user-originated entries are marked as such, not merely tinted.
      data-origin={isUser ? "user" : "system"}
      onClick={onOpen}
      // The latest entry is the hot one: solid ink dot with a 7px aura.
      className={`tli${index === 0 ? " hot" : ""}${isUser ? " c360-activity-user" : ""}`}
      style={{ animationDelay: staggerDelay(index, 70, 420) }}
    >
      <b>{entry.title}</b>
      <span className="m" title={fmtDate(entry.ts)}>
        {isUser && !entry.orgConfirmed
          ? `${entry.actor ?? "You"} · just now`
          : fmtRelative(entry.ts, new Date().toISOString())}
      </span>
      {isRequest && <span className="m">{meta.label}</span>}
      {entry.summary && <span className="d">{entry.summary}</span>}
      <span className="meta">
        {/* Session echo and org record are different claims and look it: one
            says "this page just did that", the other says "the system of
            record holds it". */}
        {entry.orgConfirmed ? (
          <span data-origin-detail="org" className="tag rec">
            On record in Salesforce
          </span>
        ) : (
          entry.sessionLocal &&
          isUser && (
            <span data-origin-detail="session" className="tag ses">
              This session
            </span>
          )
        )}
        <ReferenceCitation reference={entry.reference} />
        {steps > 0 && (
          <span className="next">
            {steps} suggested next step{steps > 1 ? "s" : ""} →
          </span>
        )}
      </span>
    </button>
  );
}

/* =============================================================================
   THE VERSION IN FLIGHT, ON THE TRAIL (0.9.23, spec 2b.1).

   A fork is the one thing this cockpit does that leaves a STANDING state rather
   than an event: the version sits unbooked with the org, its source is locked
   against a second modification, and until 0.9.23 nothing on this tab said so.
   The banker read a trail of things that had happened and no account of the
   thing that still was.

   IT IS NOT A TRAIL ENTRY. It carries no timestamp and takes no place in the
   chronology, because it is not something that happened at an instant; it is
   what is true now. So it sits above the spine as a standing row, and the door
   on it is the same `discard-version` panel the Client Actions row opens, gated
   by the same `discardAvailability`.
   ============================================================================= */
function ModificationInProgressRow({ bundle, onDiscard }: { bundle: BorrowerBundle; onDiscard: () => void }) {
  const target = discardTargetFor(bundle, null);
  // The standing row is about a version the banker can still act on. A version
  // the org has taken to approval is the approval's business, not this tab's.
  if (!target) return null;
  const { version, source } = target;

  return (
    <div className="mb-3 rounded-[10px] px-3.5 py-3" data-inflight-row="1" style={{ background: "var(--warning-bg)" }}>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
        {MODIFICATION_IN_PROGRESS}
      </div>
      <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
        {version.name} is unbooked with the org: {version.reason ?? version.line}.{" "}
        {source ? `${source.name} stays booked and cannot take a second modification until this version is booked or discarded.` : ""}
      </div>
      <button
        type="button"
        onClick={onDiscard}
        data-discard-door="trail"
        className="c360-press mt-2 rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold"
        style={{ background: "var(--surface)", color: "var(--ink)" }}
      >
        {DISCARD_LABEL}
      </button>
      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>{DISCARD_LINE}</div>
    </div>
  );
}

/* =============================================================================
   A STOPPED RUN, AND SOMETHING TO PRESS (0.9.29, backlog row 64).

   FOUNDER, 2026-09-15 17:51 UTC, Sunbelt discard STG-0000000169 stopped at
   `delete_chain`: the tracker's own text said to re-run the executor with the
   same idempotency key and the page offered nothing at all.

   THE CONTROL IS OFFERED ONLY WHERE THE RUN CAN ACTUALLY BE RESUMED. The
   decision token is minted server-side at stage time and lives only on the page
   that made the run; a reload, a republish or another banker holds none. Where
   this page no longer holds it the row says so in one line and offers nothing,
   because the alternative is a button that would have to invent a token.
   ============================================================================= */
function StoppedRunRow({ stagingId, onResume }: { stagingId: string; onResume: () => void }) {
  const run = recallRun(stagingId);
  return (
    <div className="mb-3 rounded-[10px] px-3.5 py-3" data-stopped-run={stagingId} style={{ background: "var(--warning-bg)" }}>
      <div className="text-[12px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
        {run ? RESUME_LINE : RESUME_NEEDS_RESTAGE}
      </div>
      {run && (
        <button type="button" className="eg-btn-ink c360-press mt-2" data-resume={stagingId} onClick={onResume}>
          {RESUME_LABEL}
        </button>
      )}
    </div>
  );
}

export function ActivityTab({ bundle }: { bundle: BorrowerBundle }) {
  const { data, state, dispatch } = useApp();
  const [openId, setOpenId] = useState<string | null>(null);
  // A33.1.1 entry point 4: the standing in-flight row opens the same panel.
  const [panelActionId, setPanelActionId] = useState<string | null>(null);
  /** The staging id a resume is aimed at, where the banker pressed one. */
  const [resumeStagingId, setResumeStagingId] = useState<string | null>(null);
  const generatedAt = data.meta?.generatedAt ?? "";
  const accountId = accountKey(state.accountId, bundle.snapshot?.accountId);
  const accountName =
    data.portfolio.accounts.find((a) => a.accountId === accountId)?.name ?? bundle.snapshot?.name ?? accountId;

  // The org's durable trail + this session's own entries + the baked events,
  // newest first. The org row wins over the session echo of the same execution,
  // so a reload shows the same history a fresh session would (A30 / A31.3).
  const entries = useMemo(() => {
    const local = state.sessionActivity[accountId] ?? [];
    const org = (state.actionHistory[accountId] ?? [])
      .map((r) => historyActivityEntry(r, data.meta?.instanceUrl))
      .filter((e): e is ActivityEntry => e !== null);
    return mergeTrail(org, local, bundle.activity ?? []);
  }, [bundle.activity, state.sessionActivity, state.actionHistory, accountId, data.meta?.instanceUrl]);
  const open = entries.find((e) => e.id === openId) ?? null;

  /** The org's own Executing-plus-result-id rows: the runs that stopped. */
  const stopped = useMemo(
    () => new Set((state.actionHistory[accountId] ?? []).filter(stoppedRunRow).map((r) => r.stagingId)),
    [state.actionHistory, accountId],
  );

  return (
    <Pane id="activity">
      <PaneCard>
        <SecHead kicker="Audit trail" sub="Activity" explain={EXPLAIN} />
        <ModificationInProgressRow bundle={bundle} onDiscard={() => setPanelActionId(DISCARD_ACTION_ID)} />
        {entries.length === 0 ? (
          <EmptyPane
            title="No recorded activity in this view"
            body="Recorded events, concluded analyses and client requests land here."
          />
        ) : (
          <div className="tl">
            {entries.map((e, i) => {
              /* An inbound message is read as a row rather than rendered as
                 prose. A message the reader refuses (a REQUEST_RECEIVED entry
                 that is not a mailbox message) falls through to the trail's
                 ordinary entry, which is what it always was. */
              const mail = readMailRow(e, bundle);
              const row = mail ? (
                <MailEntry
                  key={e.id}
                  entry={e}
                  row={mail}
                  index={i}
                  onOpen={() =>
                    openMailRoom({
                      entry: e,
                      bundle,
                      accountId,
                      accountName,
                      generatedAt,
                      navigate: (id) => dispatch({ type: "OPEN_ACCOUNT", accountId: id }),
                    })
                  }
                />
              ) : (
                <TrailEntry
                  key={e.id}
                  entry={e}
                  index={i}
                  onOpen={() => setOpenId(e.id)}
                />
              );
              const stagingId = stagingIdOf(e.id);
              return stagingId && stopped.has(stagingId) ? (
                <div key={`${e.id}-open`}>
                  {row}
                  <StoppedRunRow
                    stagingId={stagingId}
                    onResume={() => {
                      setResumeStagingId(stagingId);
                      setPanelActionId(DISCARD_ACTION_ID);
                    }}
                  />
                </div>
              ) : (
                row
              );
            })}
          </div>
        )}
      </PaneCard>

      <Note
        note={
          entries.length
            ? "Timestamps are shown relative to this render. Source references cite the originating record."
            : undefined
        }
      />

      {open && <ActivityDetailModal entry={open} bundle={bundle} onClose={() => setOpenId(null)} />}
      {panelActionId && (
        <ActionPanel
          actionId={panelActionId}
          resumeStagingId={resumeStagingId ?? undefined}
          onClose={() => {
            setPanelActionId(null);
            setResumeStagingId(null);
          }}
        />
      )}
    </Pane>
  );
}
