import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry, BorrowerBundle, RequestAsk } from "../data/contract";
import { fmtDate, fmtMoney, fmtRelative } from "../data/format";
import { useApp } from "../state/appState";
import { newRequestId } from "../channel/adapter";
import { resolveNextSteps } from "../actions/nextSteps";
import { ActionGlyph } from "./ActionIcon";
import { ReferenceCitation } from "./tabs/ActivityTab";
import { CopyPromptDialog } from "./CopyPromptDialog";
import { Portal } from "./Portal";
import { ActionPanel } from "./ActionPanel";

/* Activity detail popup (SPEC §12 A30.3) — the demo centerpiece.
   FloatingPanel family contract: focus-trapped, Esc-closable, focus returns to
   the timeline row that opened it. Every popup ends in Suggested next steps,
   resolved through the action registry and availability-gated exactly like the
   Actions panel — one source of truth, three consumers (A30.4). */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-divider px-6 py-5 first:border-t-0">
      <div className="kicker mb-2.5">{label}</div>
      {children}
    </section>
  );
}

/** Humanise the producer's ask type ("facility_increase" -> "Facility increase"). */
function askLabel(type?: string): string | null {
  if (!type) return null;
  const s = type.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : null;
}

/** The commercial ask, rendered as a from → to movement. */
function AskBlock({ ask }: { ask: RequestAsk }) {
  const hasMove = ask.from != null && ask.to != null;
  const label = askLabel(ask.type);
  return (
    <div className="rounded-[12px] px-4 py-3.5" style={{ background: "var(--accent-wash)" }}>
      {label && (
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
          {label}
        </div>
      )}
      {hasMove ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-2.5">
          <span className="tnum text-[20px] font-semibold text-ink-muted line-through decoration-1">
            {fmtMoney(ask.from)}
          </span>
          <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true" style={{ color: "var(--accent)" }}>
            <path d="M2 7h13M11 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="tnum text-[26px] font-extrabold tracking-tight" style={{ color: "var(--accent)" }}>
            {fmtMoney(ask.to)}
          </span>
        </div>
      ) : (
        <div className="mt-1 text-[14px] font-semibold text-ink">{fmtMoney(ask.to ?? ask.from)}</div>
      )}
      {ask.facilityName && <div className="mt-1 text-[12px] text-ink-body">{ask.facilityName}</div>}
    </div>
  );
}

export function ActivityDetailModal({
  entry,
  bundle,
  onClose,
}: {
  entry: ActivityEntry;
  bundle: BorrowerBundle;
  onClose: () => void;
}) {
  const { data, channel, state, dispatch } = useApp();
  const panelRef = useRef<HTMLDivElement>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ prompt: string } | null>(null);
  // A33.1.1 entry point 2 of 3.
  const [panelActionId, setPanelActionId] = useState<string | null>(null);

  const accountId = state.accountId ?? bundle.snapshot?.accountId ?? "";
  const accountName =
    data.portfolio.accounts.find((a) => a.accountId === accountId)?.name ?? bundle.snapshot?.name ?? "this relationship";
  const generatedAt = data.meta?.generatedAt ?? "";
  const detail = entry.detail;

  // The producer carries the commercial ask on requests[], not on the activity
  // entry. Resolve it by matching the entry's reference id, falling back to the
  // sole request when there is exactly one.
  const request = useMemo(() => {
    const reqs = bundle.requests ?? [];
    if (!reqs.length || entry.kind !== "REQUEST_RECEIVED") return undefined;
    const byRef = reqs.find((r) => r.reference?.id && r.reference.id === entry.reference?.id);
    return byRef ?? (reqs.length === 1 ? reqs[0] : undefined);
  }, [bundle.requests, entry]);

  const ask = detail?.ask ?? request?.ask;

  // The linked analysis for a request (A30.3) — its verdict shows in-place.
  const linked = useMemo(
    () => (detail?.linkedActivityId ? (bundle.activity ?? []).find((a) => a.id === detail.linkedActivityId) : undefined),
    [detail?.linkedActivityId, bundle.activity],
  );
  const verdict = detail?.verdict ?? linked?.detail?.verdict;
  const headroom = detail?.headroom ?? linked?.detail?.headroom;
  const risks = detail?.risks ?? linked?.detail?.risks;

  const steps = useMemo(
    () =>
      resolveNextSteps(
        detail?.nextSteps ?? linked?.detail?.nextSteps,
        data,
        accountId,
        accountName,
        state.actionHistory[accountId],
      ),
    [detail?.nextSteps, linked, data, accountId, accountName, state.actionHistory],
  );

  // Focus trap + Esc, matching FloatingPanel's contract.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const ring = [...node.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])")].filter(
        (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true",
      );
      if (!ring.length) return;
      const first = ring[0];
      const last = ring[ring.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const index = active ? ring.indexOf(active) : -1;
      if (index === -1) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function run(step: (typeof steps)[number]) {
    if (!step.availability.available) return;
    if (step.action.hasPanel) {
      setPanelActionId(step.action.id);
      return;
    }
    if (!channel.available()) {
      setFallback({ prompt: step.prompt });
      return;
    }
    try {
      await channel.request(step.prompt, { requestId: newRequestId(), accountId, accountName, tab: "Activity" });
      dispatch({ type: "LOG_ACTION", accountId, actionLabel: step.action.label });
      setSentId(step.action.id);
    } catch {
      setFallback({ prompt: step.prompt });
    }
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-modal)", background: "var(--scrim)" }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={entry.title}
        onClick={(e) => e.stopPropagation()}
        className="c360-panel-in flex max-h-[86vh] w-full max-w-[620px] flex-col overflow-hidden rounded-[18px] bg-raised"
        style={{ boxShadow: "var(--shadow-panel)", border: "1px solid var(--border)", transformOrigin: "center" }}
      >
        {/* Header */}
        <div className="flex flex-none items-start gap-3 border-b border-divider px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-extrabold leading-snug tracking-tight text-ink">{entry.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[11.5px] text-ink-muted">
                {fmtRelative(entry.ts, generatedAt)} · {fmtDate(entry.ts)}
              </span>
              <ReferenceCitation reference={entry.reference} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="c360-press flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-border text-ink-muted hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden="true">
              <path d="M4 4l7 7M11 4l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto">
          {ask && (
            <Section label="The ask">
              <AskBlock ask={ask} />
            </Section>
          )}

          {(entry.summary || detail?.body || request?.summary) && (
            <Section label="Detail">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-body">
                {detail?.body ?? request?.summary ?? entry.summary}
              </p>
            </Section>
          )}

          {verdict && (
            <Section label={linked ? "Analysis concluded" : "Verdict"}>
              <p className="text-[15px] font-semibold leading-relaxed text-ink" style={{ textWrap: "pretty" as never }}>
                {verdict}
              </p>
              {headroom && (
                <div className="mt-3 rounded-[10px] px-3.5 py-2.5" style={{ background: "var(--surface-overlay)" }}>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint">Headroom</div>
                  <div className="mt-0.5 text-[13px] text-ink-body">{headroom}</div>
                </div>
              )}
              {(risks?.length ?? 0) > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {risks!.map((r, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink-body">
                      <span className="mt-[7px] h-1 w-1 flex-none rounded-full" style={{ background: "var(--warning)" }} />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* A31.2 amends A30.3: last, but ONLY when this entry actually has
              resolved next steps. A REQUEST_RECEIVED entry whose steps live on
              the linked analysis shows no empty section. */}
          {steps.length > 0 && (
            <Section label="Suggested next steps">
              <div className="flex flex-col gap-2">
                {steps.map((s) => {
                  const { available, reason } = s.availability;
                  const sent = sentId === s.action.id;
                  return (
                    <button
                      key={s.action.id}
                      type="button"
                      disabled={!available}
                      onClick={() => run(s)}
                      className="c360-action-row flex items-start gap-3 rounded-[11px] border border-border px-3.5 py-3 text-left disabled:cursor-not-allowed"
                      style={available ? undefined : { background: "var(--surface-overlay)" }}
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[9px]"
                        style={{
                          background: available ? "var(--accent-wash)" : "var(--wash-2)",
                          color: available ? "var(--accent)" : "var(--ink-faint)",
                        }}
                      >
                        <ActionGlyph name={s.action.icon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span
                            className="text-[13px] font-bold"
                            style={{ color: available ? "var(--ink)" : "var(--ink-muted)" }}
                          >
                            {s.action.label}
                          </span>
                          {sent && (
                            <span
                              className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                              style={{ background: "var(--positive-bg)", color: "var(--positive)" }}
                            >
                              Sent to desk
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                          {s.note ?? s.action.description}
                        </span>
                        {!available && reason && (
                          <span className="mt-1.5 block text-[11px] font-semibold text-ink-faint">{reason}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}
        </div>
      </div>

      {panelActionId && (
        <ActionPanel actionId={panelActionId} onClose={() => setPanelActionId(null)} />
      )}

      {fallback && (
        <CopyPromptDialog
          // Next steps come off a staged bundle's activity, so the account is
          // staged by construction — the only cause here is a missing channel.
          cause="no-channel"
          accountName={accountName}
          accountId={accountId}
          prompt={fallback.prompt}
          onClose={() => setFallback(null)}
        />
      )}
    </div>
    </Portal>
  );
}
