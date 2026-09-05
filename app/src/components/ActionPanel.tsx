import { useEffect, useMemo, useRef, useState, useId } from "react";
import { accountKey, useApp } from "../state/appState";
import { Portal } from "./Portal";
import { isTopmost, pushModal } from "./modalStack";
import { ACTIONS_BY_ID, stageRationale } from "../actions/registry";
import {
  buildPanelSchema,
  overrideIsSet,
  overrideNeedsComment,
  OVERRIDE_COMMENT_REQUIRED,
  OVERRIDE_NOT_YET_FILEABLE,
  NO_FACILITY_SELECTED,
  FACILITIES_SPAN_PACKAGES,
  batchStagingGap,
} from "../actions/schemas";
import { chipFor, stagingBlockers, unfilledRequired, type NarrativeAttribution, type PanelField } from "../actions/panelSchema";
import {
  bundleAsOf,
  computeSuggestions,
  detectDrift,
  freshnessSentence,
  type NamedGap,
  type Severity,
  type Suggestion,
} from "../actions/suggestionEngine";
import { runCompile, type CompileLine } from "../actions/compile";
import { CompileScreen } from "./CompileScreen";
import { validatePlan } from "../actions/transitionAllowlist";
import { assertNoRecordIds } from "../actions/stagedPlan";
import { withDrafts } from "../actions/drafts";
import { buildBriefing } from "../actions/briefing";
import { DealTicket } from "./DealTicket";
import type { Facility, ProvenanceKind, ReasonCode } from "../data/contract";
import { fmtMoney } from "../data/format";
import { bookedFacilities } from "../data/facilityStage";
import { ConfirmGate } from "./ConfirmGate";
import { StepTracker } from "./StepTracker";
import { TechnicalToggle } from "./ui";
import { isSimulationAllowed, simulateStagedOutput, type StagedOutput } from "../actions/stagedPlan";
import { byDeadline, isDeadline } from "./workroom/deadline";
import {
  executeAction,
  isWriteAction,
  resolveApproverUserId,
  stageAction,
  type ExecuteResult,
  type FacilityAnchor,
  type StagePayloads,
  type ToolError,
} from "../channel/writeTools";
import { mcpAvailable } from "../channel/mcp";
import { observedPicklistMap } from "../actions/observedPicklists";
import { newRequestId } from "../channel/adapter";
import { initTracker, type TrackerState } from "../actions/tracker";
import { executedActivityEntry } from "../actions/executedActivity";
import type { DecisionToken } from "../actions/decisionToken";

/* =============================================================================
   THE ACTION PANEL (A33.1.1)

   ONE modal, THREE entry points (Client Actions row, activity next-step, chat
   chip). All three open the same modal for a given action id with the same
   schema and the same prefill. There is no per-action form component: the
   schema drives the render.

   Modal chrome follows A31.1 — portalled above the sticky nav, focus-trapped,
   Esc to close, focus returned to the opener.
   ============================================================================= */

/** A26 chip styling, reusing the established status tokens. */
const CHIP_STYLE: Record<ProvenanceKind, { bg: string; fg: string; label: string }> = {
  NCINO: { bg: "var(--accent-wash)", fg: "var(--accent)", label: "nCino" },
  BOOM: { bg: "var(--positive-bg)", fg: "var(--positive)", label: "Boom" },
  AGENT: { bg: "var(--user-tone-wash)", fg: "var(--user-tone)", label: "Agent" },
  DERIVED: { bg: "var(--wash-2)", fg: "var(--ink-body)", label: "Derived" },
  PENDING: { bg: "var(--warning-bg)", fg: "var(--warning)", label: "Pending" },
  GAP: { bg: "var(--neutral-bg)", fg: "var(--ink-muted)", label: "Not in source" },
};

function ProvenanceChip({ kind, citation, edited }: { kind: ProvenanceKind; citation?: string; edited?: boolean }) {
  const s = CHIP_STYLE[kind];
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
        style={{ background: s.bg, color: s.fg }}
        title={citation ? `Source: ${citation}` : undefined}
      >
        {s.label}
      </span>
      {/* A33.1.7 — the marker is PANEL ONLY. Nothing is injected into the org
          field text; the audit answer lives in the ledger. */}
      {edited && <span className="text-[9.5px] font-semibold text-ink-faint">edited by you</span>}
    </span>
  );
}

function FieldRow({
  field,
  value,
  edited,
  onChange,
}: {
  field: PanelField;
  value: unknown;
  edited: boolean;
  onChange: (v: unknown) => void;
}) {
  const chip = chipFor(field);
  const disabled = !field.editable;
  // A33.1.6 — a picklist whose options the org has not supplied is disabled and
  // says so. We never invent a value set.
  const optionsMissing = field.type === "picklist" && (field.options?.length ?? 0) === 0;

  const common = "w-full rounded-md border px-2.5 py-1.5 text-[12.5px] text-ink disabled:opacity-60";
  const border = { borderColor: "var(--border)", background: disabled ? "var(--wash-2)" : "var(--surface)" };

  return (
    <div className="border-b border-divider px-5 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] font-semibold text-ink" htmlFor={`f-${field.key}`}>
          {field.label}
          {field.required && <span style={{ color: "var(--critical)" }}> *</span>}
        </label>
        {chip && <ProvenanceChip kind={chip} citation={field.prefill.citation} edited={edited} />}
        {!field.editable && field.editableReason && (
          <span className="text-[10px] text-ink-faint">{field.editableReason}</span>
        )}
      </div>

      {field.type === "readonly" ? (
        <div className="text-[13px] font-medium text-ink-body">
          {value === null || value === undefined || value === "" ? "—" : String(value)}
        </div>
      ) : field.type === "boolean" ? (
        <label className="flex items-center gap-2 text-[12.5px] text-ink-body">
          <input
            id={`f-${field.key}`}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          Yes
        </label>
      ) : field.type === "picklist" ? (
        <>
          <select
            id={`f-${field.key}`}
            className={common}
            style={border}
            disabled={disabled || optionsMissing}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select…</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {optionsMissing && (
            <div className="mt-1 text-[10.5px] text-ink-faint">
              Options are read from the org and have not loaded in this view.
            </div>
          )}
        </>
      ) : field.type === "longtext" ? (
        <textarea
          id={`f-${field.key}`}
          rows={3}
          className={`${common} resize-none`}
          style={border}
          disabled={disabled}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={`f-${field.key}`}
          type={field.type === "date" ? "date" : "text"}
          inputMode={field.type === "currency" ? "decimal" : undefined}
          className={common}
          style={border}
          disabled={disabled}
          value={
            field.type === "currency" && typeof value === "number" ? String(value) : ((value as string) ?? "")
          }
          onChange={(e) => onChange(field.type === "currency" ? Number(e.target.value) || null : e.target.value)}
        />
      )}

      {field.gap && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: "var(--warning)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 flex-none">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 4.8v.1M8 7v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {field.gap.reason}
        </div>
      )}
      {field.help && <div className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">{field.help}</div>}
    </div>
  );
}

/** What this panel IS, said once, above the cards (F2). A banker asked "what
 *  should I do with this information?" — the honest answer starts with what the
 *  information is and where the decision sits. */
export const CHALLENGE_PANEL_INTRO =
  "Pre-decision checks the cockpit runs on the proposed change. Advisory only: the decision stays with you.";

const SEVERITY_TONE: Record<Severity, { fg: string; bg: string }> = {
  critical: { fg: "var(--critical)", bg: "var(--critical-bg)" },
  warning: { fg: "var(--warning)", bg: "var(--warning-bg)" },
  info: { fg: "var(--accent)", bg: "var(--accent-wash)" },
};

function SuggestionCard({
  suggestion,
  acknowledged,
  onAcknowledge,
  onOverride,
}: {
  suggestion: Suggestion;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onOverride: (reason: string) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const tone = SEVERITY_TONE[suggestion.severity];

  // Acknowledged collapses to one line. The check does not disappear — it is
  // recorded and it stays readable — but it stops asking for a decision that
  // has already been made.
  if (acknowledged) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 rounded-[8px] border border-border px-3 py-2">
        <span className="text-[11px] font-bold" style={{ color: tone.fg }}>
          {suggestion.verdict}
        </span>
        <span className="text-[10.5px] text-ink-faint">acknowledged</span>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-border px-3.5 py-3" style={{ background: "var(--surface-overlay)" }}>
      {/* THE VERDICT FIRST, toned by severity. What the figures MEAN for the
          decision, before the arithmetic that produced it. */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {suggestion.severity === "info" ? "For information" : suggestion.severity === "critical" ? "Breach" : "Alert"}
        </span>
        <ProvenanceChip kind={suggestion.source} citation={suggestion.trigger.formula} />
      </div>
      <p className="mt-1.5 text-[13px] font-bold leading-snug" style={{ color: tone.fg }}>
        {suggestion.verdict}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-body">{suggestion.rationale}</p>
      {/* F3 — the read this ran on, said in banker language, and it is the read
          the TICKET is using rather than whatever the bundle was baked from. */}
      <div className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
        {suggestion.policyLabel} · {freshnessSentence(suggestion.freshness)}
      </div>

      {/* A33.2.3 — declining requires a reason, which lands in Activity and the
          decision ledger. It is not panel decoration. */}
      {declining ? (
        <div className="mt-2">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you declining this suggestion?"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink"
          />
          <div className="mt-1.5 flex gap-2">
            <button
              type="button"
              disabled={!reason.trim()}
              onClick={() => onOverride(reason.trim())}
              className="c360-press rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
            >
              Record and decline
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="c360-press rounded-md px-2.5 py-1 text-[11px] font-medium text-ink-muted"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAcknowledge}
            className="c360-press rounded-md px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            Acknowledge and continue
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            className="c360-press rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:text-ink"
          >
            Decline with reason
          </button>
        </div>
      )}
    </div>
  );
}

/** A33.2.6 — a named gap. Never rendered as an all-clear.
 *
 *  F4: the BANKER SENTENCE renders; the path, the source system and the raw
 *  guard detail sit behind the toggle. */
function GapNote({ gap }: { gap: NamedGap }) {
  return (
    <div className="rounded-[8px] border border-dashed border-border px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
      {gap.note}
      <TechnicalToggle detail={`${gap.detail} · ${gap.path} · ${gap.sourceSystem}`} />
    </div>
  );
}

/**
 * Why a payload could not be built, per action.
 *
 * The old copy said "This relationship has no pledged collateral to value" for
 * EVERY action, which was true of one of them. A precondition that names the
 * wrong thing is worse than a generic one, because a banker acts on it.
 */
const NOTHING_TO_STAGE: Record<string, string> = {
  "collateral-valuation": "This relationship has no pledged collateral to value.",
  "covenant-review": "This deal has no covenant that can be assessed from here.",
};
const GENERIC_NOTHING_TO_STAGE = "This action has nothing to stage against on this relationship.";

export type Phase = "form" | "compile" | "confirm" | "tracker";

/** Briefing -> Plan -> Execution. Compile is the bridge between the first two,
 *  so it shows as the Plan step already being worked on. */
const STEPS: Array<{ id: Phase; label: string }> = [
  { id: "form", label: "Briefing" },
  { id: "confirm", label: "Plan" },
  { id: "tracker", label: "Execution" },
];

/** The ticket stepper. Exported rather than copied: one ceremony, one chrome,
 *  whatever the write seam behind it. */
export function Stepper({
  phase,
  steps = STEPS,
  onBack,
}: {
  phase: Phase;
  steps?: Array<{ id: Phase; label: string }>;
  onBack: () => void;
}) {
  const index = phase === "compile" ? 1 : steps.findIndex((s) => s.id === phase);
  // Only the Plan step may walk back. Once a plan has been filed there is no
  // stepping back to edit it: the record exists, and pretending otherwise would
  // be the one dishonest thing on this screen.
  const canGoBack = phase === "confirm";

  return (
    <div className="flex items-center gap-1.5 border-b border-divider px-5 py-2">
      {steps.map((s, i) => {
        const here = i === index;
        return (
          <span key={s.id} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-[10px] text-ink-faint" aria-hidden="true">
                /
              </span>
            )}
            {i < index && canGoBack ? (
              <button
                type="button"
                onClick={onBack}
                className="c360-press rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-ink-muted hover:text-ink"
              >
                {s.label}
              </button>
            ) : (
              <span
                aria-current={here ? "step" : undefined}
                className="px-1.5 py-0.5 text-[11px] font-semibold"
                style={{ color: here ? "var(--accent)" : i < index ? "var(--ink-muted)" : "var(--ink-faint)" }}
              >
                {s.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function ActionPanel({
  actionId,
  onClose,
  returnFocusTo,
}: {
  actionId: string;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const { data, state, worklist, dispatch } = useApp();
  const panelRef = useRef<HTMLDivElement>(null);
  const layerId = useId();

  useEffect(() => pushModal(layerId), [layerId]);

  const action = ACTIONS_BY_ID[actionId];
  const accountId = state.accountId ?? "";
  const accountName =
    data.portfolio.accounts.find((a) => a.accountId === accountId)?.name ?? data.borrower?.snapshot?.name ?? "this relationship";
  const staged = (data.borrowers ?? {})[accountId] ?? (data.borrower?.snapshot?.accountId === accountId ? data.borrower : null);
  // Merge the live patch the SAME way the workspace does. Without this a ticket
  // opened after a Sync still reads pre-sync exposure, and a client request the
  // sync just ingested is invisible to the prefill that exists to use it.
  const livePatch = state.livePatches[accountId];
  const bundle = staged && livePatch ? { ...staged, ...livePatch } : staged;
  /** F3 — WHICH READ THE TICKET IS ACTUALLY USING.
   *
   *  The effective-challenge math has always run on `bundle`, which is the
   *  live-merged one. It stamped its cards with `data.meta.generatedAt`, which
   *  is the BAKED bundle's assembly time, so a card recomputed seconds after a
   *  sync still claimed the date the artifact was built. The two facts now
   *  travel together: the instant comes from the same overlay the patch did,
   *  and the sections that sync replaced are named so a partially refreshed
   *  read cannot claim to be wholly live. */
  const liveStoredAt = livePatch ? (state.liveStoredAt[accountId] ?? null) : null;
  const liveSectionKey = livePatch ? Object.keys(livePatch).sort().join(",") : "";
  const liveSections = useMemo(() => (liveSectionKey ? liveSectionKey.split(",") : []), [liveSectionKey]);
  const asOf = bundleAsOf({ data, liveStoredAt });
  /** The key session-local activity is stored under. Resolved the same way the
   *  Activity tab resolves it, so a written entry is always a readable one. */
  const activityAccountId = accountKey(state.accountId, bundle?.snapshot?.accountId);

  /** Legal values the tool returned on a VALIDATION_FAILED. Authoritative:
   *  they supersede the partial observed cache for that field. */
  const [legalValues, setLegalValues] = useState<Record<string, string[]>>({});

  /** Why this action is on the queue. Seeds the drafted recommendation and the
   *  briefing's opening line; never invented, always the derived worklist.
   *  Keyed so the memos below depend on the reasons, not on a fresh array. */
  const reasonKey = (worklist.reasons[accountId] ?? []).join("|");
  const reasons = useMemo(() => (reasonKey ? (reasonKey.split("|") as ReasonCode[]) : []), [reasonKey]);

  /**
   * The banker's own deal pick, held OUTSIDE the value bag.
   *
   * It has to be: the schema is what the value bag is initialised from, so a
   * schema that read the pick out of `values` would depend on itself. Null
   * means "the schema's own default", which is the relationship's package.
   */
  const [pickedPackage, setPickedPackage] = useState<string | null>(null);

  /** The schema, then the agent's drafts overlaid onto it (WP7.2). The overlay
   *  only fills AGENT_NARRATIVE fields the panel would otherwise open empty, so
   *  every contract the classic form obeys is untouched. */
  const schema = useMemo(() => {
    const base = buildPanelSchema(actionId, {
      bundle,
      accountId,
      accountName,
      orgPicklists: { ...observedPicklistMap(), ...legalValues },
      // A10: the view's own clock, never the wall clock. A date the panel
      // defaults must agree with every other date on the screen.
      asOf: data.meta?.generatedAt,
      // The banker's own deal pick, so the covenant and collateral lists are
      // the CHOSEN package's rather than the default one's. Undefined on the
      // first build, where the schema picks the default itself.
      packageId: pickedPackage ?? undefined,
    });
    return base ? withDrafts(base, actionId, bundle, reasons) : null;
  }, [actionId, bundle, accountId, accountName, legalValues, reasons, data.meta?.generatedAt, pickedPackage]);

  const briefing = useMemo(
    () => buildBriefing(actionId, schema, bundle, accountName, reasons),
    [actionId, schema, bundle, accountName, reasons],
  );

  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries((schema?.fields ?? []).map((f) => [f.key, f.value])),
  );
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const [declined, setDeclined] = useState<Record<string, string>>({});
  /** F2 — an acknowledgement is a DECISION, so the ticket records it: which
   *  check, and when the banker took it. Unlike a decline it does not remove
   *  the finding from the plan's stated rationale, because acknowledging is
   *  accepting; it collapses the card and nothing more. */
  const [acknowledged, setAcknowledged] = useState<Record<string, string>>({});
  /** briefing -> compile -> plan -> execution. Compile is the bridge, not a
   *  stop on the stepper: it is how the plan gets built. */
  const [phase, setPhase] = useState<Phase>("form");
  const [showAllFields, setShowAllFields] = useState(false);
  /** The panel element, as STATE: a ref alone never re-renders, so the sheet's
   *  portal host would stay null forever after the first pass. */
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const [compileLines, setCompileLines] = useState<CompileLine[]>([]);
  /** The values the current plan was built from. Editing away from these means
   *  the plan on the next screen is stale and has to be rebuilt. */
  const [stagedValues, setStagedValues] = useState<string | null>(null);
  const [plan, setPlan] = useState<StagedOutput | null>(null);
  const [tracker, setTracker] = useState<TrackerState | null>(null);
  const [token, setToken] = useState<DecisionToken | null>(null);
  const [toolError, setToolError] = useState<ToolError | null>(null);
  const [live, setLive] = useState(false);
  const [outcome, setOutcome] = useState<ExecuteResult | null>(null);
  const [continuing, setContinuing] = useState(false);
  /** The Salesforce id of the banker who CONFIRMED this plan. Bound at confirm
   *  and used for every resume, so a resume can never run as someone else. */
  const approverRef = useRef<string | null>(null);
  /** Stable across a stage/execute pair and across resume (A33.3.5). Ours, not
   *  nCino's: the platform is known to duplicate on failed background Apex. */
  const idempotencyKeyRef = useRef<string>(newRequestId());
  /** Set by the ticket while an option sheet is open (A31.1 stacking). */
  const sheetCloserRef = useRef<(() => void) | null>(null);

  const engine = useMemo(
    () => computeSuggestions({ data, bundle, actionId, liveStoredAt, liveSections }),
    [data, bundle, actionId, liveStoredAt, liveSections],
  );

  // A31.1 modal chrome: focus in on open, focus back to the opener on close.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    return () => returnFocusTo?.()?.focus?.({ preventScroll: true });
  }, [returnFocusTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!isTopmost(layerId)) return;
        // A31.1 stacking: an open option sheet is the innermost layer, so Esc
        // closes that first and the panel stays where the banker left it.
        if (sheetCloserRef.current) {
          sheetCloserRef.current();
          return;
        }
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const ring = [
        ...node.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
        ),
      ].filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
      if (!ring.length) return;
      const first = ring[0];
      const last = ring[ring.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? ring.indexOf(active) : -1;
      if (idx === -1) {
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
  }, [onClose, layerId]);

  if (!action || !schema) return null;

  const missing = unfilledRequired({ ...schema, fields: schema.fields.map((f) => ({ ...f, value: values[f.key] })) });
  // Honest-gap discipline: a missing write anchor blocks staging outright. We
  // never substitute a different record's id to get past it.
  const blockers = stagingBlockers(schema);
  /** What is wrong with the FACILITY SELECTION itself, before any payload is
   *  built. Several facilities are now a supported shape (`facilityIds`), so the
   *  only two answers left are "you named none" and "you named two deals". */
  const facilityGap = (() => {
    if (actionId !== "loan-modification" && actionId !== "renewal") return null;
    const picked = [...new Set(Array.isArray(values.facility) ? (values.facility as string[]) : [])];
    if (!picked.length) return NO_FACILITY_SELECTED;
    const booked = bookedFacilities(bundle);
    const packages = new Set(picked.map((id) => booked.find((f) => f.loanId === id)?.productPackageId));
    return packages.size > 1 ? FACILITIES_SPAN_PACKAGES : null;
  })();

  /** The DEAL the batch is anchored on: the banker's pick when the schema
   *  offered one, else the package the schema defaulted to. ONE answer, read by
   *  both the gate and the payload builder — two readings of the same field
   *  would let a batch be blocked on a package it was about to send, or sent
   *  under one the gate never checked. */
  function selectedPackageId(): string | null {
    const picked = values.package;
    if (typeof picked === "string" && picked.trim()) return picked.trim();
    const fallback = schema?.fields.find((f) => f.key === "package")?.value;
    return typeof fallback === "string" && fallback.trim() ? fallback.trim() : null;
  }

  /** What is wrong with the BATCH the banker assembled, before a payload is
   *  built. Every sentence is one the tool would send back anyway; it is stated
   *  here so a banker learns the rule from the ticket rather than from a round
   *  trip that refused the whole batch. */
  const batchGap = batchStagingGap(actionId, values, schema);

  /** The org's validation rule, enforced here so the banker learns it from the
   *  ticket rather than from a rejected write. */
  const overrideGap =
    actionId === "risk-rating-review"
      ? overrideNeedsComment(values)
        ? OVERRIDE_COMMENT_REQUIRED
        : // An override the wire cannot carry blocks the action rather than
          // being dropped on the floor: the banker typed it deliberately.
          overrideIsSet(values)
          ? OVERRIDE_NOT_YET_FILEABLE
          : null
      : null;

  /** True once the banker has edited away from the values the plan was built
   *  from. The plan on the Plan step is then a description of something that is
   *  no longer what would be filed. */
  const planIsStale = plan !== null && stagedValues !== null && stagedValues !== JSON.stringify(values);

  /** A33.1.7 — attribution for edited agent prose. Ledger-bound, never injected. */
  const attribution: NarrativeAttribution | null = editedFields.length
    ? { provenance: "AGENT", editedBy: data.meta?.user, editedAt: new Date().toISOString(), editedFields }
    : null;

  /** #11 — a REBUILD is a new intent: the values changed, so the plan and its
   *  hash change, and reusing the key would invite the org to replay the old
   *  staging row. Stepping back and forward without editing keeps the key,
   *  because that is the same intent looked at twice. */
  function keyForThisStage(): string {
    if (planIsStale) idempotencyKeyRef.current = newRequestId();
    return idempotencyKeyRef.current;
  }

  /** Stage the plan.
   *
   *  FAIL-CLOSED (unchanged): the real `stage_*` tools do not exist yet, so in a
   *  SHIPPED artifact there is nothing to call and the action stays
   *  analysis-only exactly as today. The simulation adapter is gated to tests
   *  and the dev server, and it says so on the gate when it is used. */
  /** Build the tool payload from the panel values. Field names come from the
   *  deployed Apex Request classes, read not guessed. */
  function stagePayload(): StagePayloads[keyof StagePayloads] | null {
    const idempotencyKey = keyForThisStage();
    const v = (k: string) => (values[k] === "" ? null : (values[k] ?? null));
    const nOf = (k: string) => {
      const raw = v(k);
      if (raw === null || raw === undefined) return null;
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : null;
    };
    /** The booked facilities the banker picked, resolved BY ID. Two facilities
     *  can share a name, so a label lookup would silently pick whichever came
     *  first.
     *
     *  ALL OR NOTHING: a selected id that does not resolve to a booked facility
     *  carrying its OWN package is not quietly dropped. Filing three of four
     *  facilities under a plan the banker read as covering four is the failure
     *  this returns empty to avoid. */
    const selectedFacilities = (): Facility[] => {
      const picked = [...new Set(Array.isArray(values.facility) ? (values.facility as string[]) : [])];
      const booked = bookedFacilities(bundle);
      const rows = picked
        .map((id) => booked.find((f) => f.loanId === id))
        .filter((f): f is Facility => !!f?.loanId && !!f.productPackageId);
      return rows.length === picked.length ? rows : [];
    };
    // #3 — the Apex contract requires a non-blank rationale, and an undefined
    // one is simply omitted by JSON. When no suggestion is carrying the reason,
    // the action states its own, deterministically.
    const accepted = engine.suggestions.filter((s) => !declined[s.id]).map((s) => s.rationale).join(" ").trim();
    const typed = [values.modificationReason, values.renewalReason, values.purposeNote]
      .filter((x): x is string => typeof x === "string" && x.trim() !== "")
      .join(" ")
      .trim();
    const rationale = stageRationale({ actionId, accountName, accepted, typed });
    const packageId = bundle?.snapshot?.productPackageId ?? null;

    if (actionId === "collateral-valuation") {
      // ITEMS[] ONLY. One selection is a batch of one: the tool has no separate
      // single-item shape, and mixing flat fields with items[] is REFUSED.
      const chosen = Array.isArray(values.records) ? (values.records as string[]) : [];
      // A duplicate collateralId in a batch is refused too. The chooser cannot
      // produce one; this makes sure a future edit cannot either.
      const unique = [...new Set(chosen)];
      if (!unique.length) return null;

      // HARD REQUIREMENTS since WS0.5, both refused by the tool by name. They
      // are checked here as well so nothing knowingly wrong leaves the page.
      const dealId = selectedPackageId();
      const valuationDate = v("valuationDate") as string | null;
      if (!dealId || !valuationDate) return null;

      const perItem = (values.recordValues as Record<string, unknown>) ?? {};
      // Basis, origin, date and notes describe the valuation EXERCISE and apply
      // to every item in it. Only the figure is per collateral record.
      const shared = {
        valuationDate,
        type: v("type") as string | null,
        source: v("source") as string | null,
        description: v("description") as string | null,
        primary: values.primary === true,
      };

      return {
        idempotencyKey,
        rationale,
        productPackageId: dealId,
        items: unique.map((collateralId) => ({
          collateralId,
          value: typeof perItem[collateralId] === "number" ? (perItem[collateralId] as number) : nOf("value"),
          ...shared,
        })),
      };
    }

    if (actionId === "create-service-request") {
      const req = (bundle?.requests ?? [])[0];
      return {
        idempotencyKey,
        accountId,
        rationale,
        requestType: v("type") as string | null,
        origin: v("origin") as string | null,
        summary: (v("subject") ?? v("description")) as string | null,
        referenceKind: req?.reference?.kind ?? null,
        referenceId: req?.reference?.id ?? null,
        referenceWebLink: req?.reference?.webLink ?? null,
      };
    }

    if (actionId === "new-facility-request") {
      // EXACTLY ONE ANCHOR, both variants observed: the package when the
      // relationship has one, otherwise the account, which is the org's cue to
      // create the package first. Sending both, or neither, is not a shape the
      // tool has ever accepted — and a BLANK account id is neither.
      if (!packageId && !accountId.trim()) return null;
      return {
        idempotencyKey,
        rationale,
        ...(packageId ? { productPackageId: packageId } : { accountId: accountId.trim() }),
        product: v("productType") as string | null,
        amount: nOf("amount"),
        termMonths: nOf("termMonths"),
        primaryLoanPurpose: v("purpose") as string | null,
      };
    }

    if (actionId === "risk-rating-review") {
      const computed = Number(bundle?.snapshot?.computedRiskRating);
      return {
        idempotencyKey,
        accountId,
        rationale,
        computedRiskGradeValue: Number.isFinite(computed) ? computed : null,
        cashFlowCoverageActual: nOf("cashFlowCoverage"),
        revenueGrowthActual: nOf("revenueGrowth"),
        managementExperienceActual: nOf("managementExperience"),
        creditScoreActual: nOf("creditScore"),
        comments: v("overrideComment") as string | null,
        // NO override key. Its wire name has never been observed, and the
        // ticket blocks staging when the banker sets one rather than dropping
        // what they typed on the floor.
      };
    }

    if (actionId === "covenant-review") {
      // PACKAGE-ANCHORED BULK. The old single shape (accountId +
      // covenantComplianceId + result) is gone from the org: its fields carried
      // required=true, so sending them makes this shape unreachable on the wire.
      const dealId = selectedPackageId();
      if (!dealId) return null;

      const chosen = [...new Set(Array.isArray(values.covenants) ? (values.covenants as string[]) : [])];
      const statuses = (values.covenantStatuses as Record<string, unknown>) ?? {};
      const observed = (values.covenantObservedValues as Record<string, unknown>) ?? {};
      const reasons = (values.covenantReasons as Record<string, unknown>) ?? {};
      const comments = (values.covenantComments as Record<string, unknown>) ?? {};
      const narrative = v("assessmentNarrative") as string | null;

      // ALL OR NOTHING on the verdict. A covenant the banker selected but never
      // answered is not filed under a default: the batch simply is not sent.
      const assessments = chosen
        .filter((covenantId) => typeof statuses[covenantId] === "string" && statuses[covenantId] !== "")
        .map((covenantId) => ({
          covenantId,
          status: statuses[covenantId] as string,
          // A NUMBER on this wire: the invocable declares Decimal.
          observedValue: typeof observed[covenantId] === "number" ? (observed[covenantId] as number) : null,
          reasonForException: typeof reasons[covenantId] === "string" && reasons[covenantId] ? (reasons[covenantId] as string) : null,
          narrative,
          comments: typeof comments[covenantId] === "string" && comments[covenantId] ? (comments[covenantId] as string) : null,
        }));
      if (!assessments.length || assessments.length !== chosen.length) return null;

      return {
        idempotencyKey,
        rationale,
        productPackageId: dealId,
        assessments,
        // The member selection, stated rather than left implicit: it is what
        // narrows the package survey to the covenants the banker chose.
        covenantIds: chosen,
        // Sent only when the banker turned it on. The default is the org's
        // refusal, and a false would claim a decision nobody made.
        ...(values.allowNonPending === true ? { allowNonPending: true } : {}),
      };
    }

    if (actionId === "loan-modification" || actionId === "renewal") {
      const picked = selectedFacilities();
      if (!picked.length) return null;
      // FAIL CLOSED on the package. The anchor must be the package the CHOSEN
      // facilities hang off, not whichever one the relationship snapshot names:
      // a facility from another package staged against this one is a write
      // aimed at the wrong deal. When the exposure rows do not agree on one
      // package, the correspondence cannot be proven and nothing is sent.
      const packages = new Set(picked.map((f) => f.productPackageId));
      if (packages.size !== 1) return null;
      const productPackageId = picked[0].productPackageId!;
      // And the deal the TICKET is showing must be that same package. The
      // package chooser and the member list are two readings of one anchor, so
      // a disagreement between them is a bug, never something to send.
      const shown = selectedPackageId();
      if (shown && shown !== productPackageId) return null;

      if (actionId === "loan-modification") {
        // ALWAYS THE PACKAGE-ANCHORED SHAPE. The ticket is package-first, so it
        // names its members as members — one facility is a selection of one,
        // not a different kind of request. The flat `loanId` remains supported
        // on the wire (see FacilityAnchor) and renewal still sends it for one;
        // nothing that already worked stopped working.
        return {
          idempotencyKey,
          rationale,
          facilityIds: picked.map((f) => f.loanId!),
          productPackageId,
          requestedAmount: nOf("newCommitment"),
          requestedMaturityDate: v("requestedMaturityDate") as string | null,
          requestedTermMonths: nOf("requestedTermMonths"),
          requestedRate: nOf("requestedRate"),
        };
      }

      // Renewal, unchanged: XOR on the anchor, and the tool refuses anything
      // else. SEVERAL facilities travel as `facilityIds` and come back as one
      // plan with one hash and one token; ONE travels as the flat `loanId`,
      // byte-identical to what shipped before the package-anchored shape landed.
      const anchor: FacilityAnchor =
        picked.length > 1 ? { facilityIds: picked.map((f) => f.loanId!) } : { loanId: picked[0].loanId! };
      return {
        idempotencyKey,
        rationale,
        ...anchor,
        productPackageId,
        newMaturityDate: v("newMaturityDate") as string | null,
        requestedRate: nOf("requestedRate"),
      };
    }

    return {
      idempotencyKey,
      accountId,
      rationale,
      reviewType: v("reviewType") as string | null,
      productPackageId: packageId,
      narrative: v("narrative") as string | null,
      relationshipSummary: v("relationshipSummary") as string | null,
      strengthsNarrative: v("strengths") as string | null,
      weaknessNarrative: v("weaknesses") as string | null,
      recommendationNarrative: v("recommendation") as string | null,
      collateralAnalysisNarrative: v("collateralAnalysis") as string | null,
      financialAnalystNarrative: v("financialAnalysis") as string | null,
      guarantorNarrative: v("guarantor") as string | null,
      riskRatingComments: v("riskRatingComments") as string | null,
    };
  }

  /** USER GESTURE ONLY, and the whole sequence runs on that one gesture.
   *
   *  Each line below wraps a REAL operation. Nothing is narrated that does not
   *  happen, and a line cannot tick before its own operation has returned. A
   *  failure stops the sequence on its line and the error is rendered there. */
  async function stage() {
    setToolError(null);
    setPhase("compile");

    let payload: ReturnType<typeof stagePayload> = null;
    let built: StagedOutput | null = null;
    let fromLiveTool = false;

    const outcome = await runCompile(
      [
        {
          id: "prefills",
          label: "Gathering the prefills",
          run: () => {
            // Defence in depth: the gesture is disabled on a blocking gap, and
            // the sequence refuses it again here.
            if (blockers.length) {
              throw { code: "NOT_STAGEABLE", message: blockers.map((b) => b.gap!.reason).join(" ") };
            }
            if (overrideGap) throw { code: "VALIDATION_FAILED", message: overrideGap };
            if (facilityGap) throw { code: "NOT_STAGEABLE", message: facilityGap };
            if (batchGap) throw { code: "VALIDATION_FAILED", message: batchGap };
            payload = stagePayload();
            if (!payload && mcpAvailable() && isWriteAction(actionId)) {
              throw { code: "PRECONDITION", message: NOTHING_TO_STAGE[actionId] ?? GENERIC_NOTHING_TO_STAGE };
            }
            const filled = schema!.fields.filter((f) => values[f.key] !== null && values[f.key] !== undefined && values[f.key] !== "");
            return `${filled.length} of ${schema!.fields.length} fields carry a value`;
          },
        },
        {
          id: "recompute",
          label: "Recomputing the figures and checking for drift",
          run: () => {
            // Recomputed on the SAME read the cards were computed from, or the
            // drift check would report "data replaced" on every synced ticket.
            const fresh = computeSuggestions({ data, bundle, actionId, liveStoredAt, liveSections });
            const moved = detectDrift(engine.suggestions, fresh, asOf);
            if (moved.length) {
              throw {
                code: "VALIDATION_FAILED",
                message: "The figures moved while this was open, so the plan would have been built on numbers you did not see. Reopen the briefing and check them.",
              };
            }
            return fresh.suggestions.length
              ? `${fresh.suggestions.length} finding${fresh.suggestions.length === 1 ? "" : "s"} still stands`
              : "no findings outstanding";
          },
        },
        {
          id: "stage",
          label: "Sending it to the org to be staged",
          run: async () => {
            if (!(mcpAvailable() && isWriteAction(actionId))) {
              built = simulateStagedOutput({
                actionId,
                accountName,
                suggestions: engine.suggestions.filter((s) => !declined[s.id]),
              });
              if (!built) throw { code: "NOT_STAGEABLE", message: "There is no staging tool for this action in this view." };
              return "simulated, nothing left this page";
            }
            /* THE STAGING CALL CARRIES A CLOCK (2026-09-05). This line is
               inside the compile sequence, and a line that cannot tick is a
               sequence that cannot end: the panel would sit on a filling
               chevron for the life of the page. Staging writes nothing, so an
               expiry here is clean and the sequence fails on its own line. */
            const res = await byDeadline(stageAction(actionId, payload as never), "stage", "staging this plan").catch((e) => {
              if (isDeadline(e)) {
                throw {
                  code: "TRANSPORT",
                  message:
                    "The org has not answered the staging call in 25 seconds, so I have stopped waiting on it. " +
                    "Staging writes nothing, so nothing has been filed and the briefing is exactly as you left it.",
                };
              }
              throw e;
            });
            if (!res.ok) {
              // The tool returns the legal picklist set on a mismatch; adopt it
              // so the briefing can offer the real values on the next attempt.
              if (res.error.legalValues?.length) {
                const target = /type/i.test(res.error.message) ? "LLC_BI__Type__c" : "LLC_BI__Source__c";
                setLegalValues((prev) => ({
                  ...prev,
                  [`LLC_BI__Collateral_Valuation__c.${target}`]: res.error.legalValues!,
                }));
              }
              throw res.error;
            }
            built = { ...res.result, suggestions: engine.suggestions.filter((s) => !declined[s.id]) };
            fromLiveTool = true;
            return "the org accepted it";
          },
        },
        {
          id: "plan",
          label: "Checking the plan that came back",
          run: () => {
            if (!built) throw { code: "TRANSPORT", message: "The staging call returned no plan." };
            const violations = validatePlan(built.steps);
            if (violations.length) {
              throw {
                code: "VALIDATION_FAILED",
                message: `Step ${violations[0].stepId}: ${violations[0].reason}`,
              };
            }
            const leaks = assertNoRecordIds(built);
            if (leaks.length) throw { code: "VALIDATION_FAILED", message: leaks[0] };
            return `${built.steps.length} step${built.steps.length === 1 ? "" : "s"}`;
          },
        },
      ],
      { onLines: setCompileLines },
    );

    if (!outcome.ok) {
      setToolError(outcome.error);
      return; // the compile screen holds, with the error on its own line
    }
    setPlan(built);
    setLive(fromLiveTool);
    setStagedValues(JSON.stringify(values));
    setPhase("confirm");
  }

  function onConfirmed(t: DecisionToken, executed?: ExecuteResult) {
    setToken(t);
    if (!approverRef.current) approverRef.current = resolveApproverUserId(data.meta);

    // A30 — the trail records what the banker did, success or not. Rendered
    // immediately on the Activity tab; no Sync required, because this event
    // happened here rather than being read from the org.
    if (executed) {
      const entry = executedActivityEntry({
        actionId,
        outcome: executed,
        target: readonlyAnchorLabel(),
        actor: data.meta?.user,
        instanceUrl: data.meta?.instanceUrl,
      });
      if (entry) dispatch({ type: "LOG_ACTIVITY", accountId: activityAccountId, entry });
    }

    if (plan) {
      const base = initTracker(plan.steps);
      // The tracker consumes the executor's step states verbatim; the state
      // machine still owns every transition from here.
      setTracker(
        executed
          ? {
              steps: base.steps.map((s) => {
                const live = executed.steps.find((x) => x.id === s.id);
                return live ? { id: s.id, state: live.state as typeof s.state, note: live.detail } : s;
              }),
            }
          : base,
      );
      setOutcome(executed ?? null);
    }
    setPhase("tracker");
  }

  /** What the action was filed against, in the panel's own banker language:
   *  the readonly anchor field the schema already renders. Staged text, never
   *  a record name the executor did not return. */
  function readonlyAnchorLabel(): string | undefined {
    const anchor = schema?.fields.find((f) => f.key === "collateral" || f.key === "account");
    return typeof anchor?.value === "string" && anchor.value ? anchor.value : undefined;
  }

  /**
   * The SECOND invocation of a two-phase execute (new facility).
   *
   * USER GESTURE ONLY, and it re-sends the same stagingId, planHash and token:
   * the org treats it as a resume, not a new write, and its idempotency key is
   * the one the stage minted. Nothing polls; if the org is still not finished
   * it says so again and the affordance stays.
   */
  async function continueExecution() {
    if (!plan || !token || continuing) return;

    // #4 — the approver is the identity that CONFIRMED this plan, captured at
    // confirm time and carried with it. Re-resolving it here would let a
    // different signed-in user finish someone else's write, and the Apex resume
    // branch dispatches on staging status without re-checking the token.
    const bound = approverRef.current;
    const current = resolveApproverUserId(data.meta);
    if (!bound) return;
    if (current !== bound) {
      setToolError({
        code: "IDENTITY_MISMATCH",
        message:
          "This plan was confirmed by a different user. Only the banker who confirmed it can continue it, so nothing was sent.",
        resumable: false,
      });
      return;
    }
    if (!plan.decisionToken) return;

    setToolError(null);
    setContinuing(true);
    try {
      /* THE RESUME CARRIES THE WRITE BUDGET, and the budget is never a verdict:
         a resume that ran out of clock says only that the panel stopped
         waiting, and the affordance stays exactly where it was. */
      const again = await byDeadline(executeAction(actionId as never, {
        idempotencyKey: idempotencyKeyRef.current,
        stagingId: plan.stagingId,
        planHash: plan.planHash,
        // The wire requires the token's PRESENCE on a resume even though the
        // Apex resume path never reads it; a null is refused by the platform.
        decisionToken: plan.decisionToken,
        approverUserId: bound,
      }), "execute", "the filing");
      // #10 — a failed resume goes through the same doctrine as a failed first
      // execution: typed code, the org's own words, and no invented retry.
      if (!again.ok) {
        setToolError(again.error);
        return;
      }
      onConfirmed(token, again.result);
    } catch (e) {
      if (isDeadline(e)) {
        setToolError({
          code: "TRANSPORT",
          message:
            "The org has not answered in 45 seconds. I will not tell you this failed, because I cannot see that. " +
            "Check the record in Salesforce before sending it again; nothing here has changed.",
          resumable: true,
        });
        return;
      }
      const f = e as { code?: string; fix?: string; message?: string };
      setToolError({ code: f.code ?? "TRANSPORT", message: f.message ?? f.fix ?? String(e) });
    } finally {
      setContinuing(false);
    }
  }

  /** Stepping back preserves everything the banker entered. The plan is kept
   *  too, so a step forward without edits shows the same plan and the same
   *  hash; edits make it stale, and the briefing says so. */
  function stepBack() {
    setToolError(null);
    setPhase(phase === "tracker" ? "confirm" : "form");
  }

  function setField(f: PanelField, v: unknown) {
    setValues((prev) => {
      const next = { ...prev, [f.key]: v };
      // CHANGING THE DEAL CHANGES WHAT IS SELECTABLE. The covenants and the
      // collateral are the previous package's; carrying them forward would send
      // package B with members resolved against package A, which the tool
      // refuses by name. The selection is cleared rather than re-mapped: there
      // is no honest mapping between two deals' members.
      if (f.key === "package" && prev[f.key] !== v) {
        for (const k of [
          "covenants",
          "covenantStatuses",
          "covenantObservedValues",
          "covenantReasons",
          "covenantComments",
          "records",
          "recordValues",
          // Same rule for the credit action's own members: a facility of deal A
          // carried into deal B is refused by the tool by name.
          "facility",
        ]) {
          delete next[k];
        }
      }
      return next;
    });
    if (f.key === "package") setPickedPackage(typeof v === "string" && v.trim() ? v.trim() : null);
    if (f.prefill.source === "AGENT_NARRATIVE") {
      setEditedFields((prev) => (prev.includes(f.key) ? prev : [...prev, f.key]));
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
          ref={(el) => {
            panelRef.current = el;
            setPanelEl(el);
          }}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={action.label}
          onClick={(e) => e.stopPropagation()}
          className="c360-panel-in relative flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] bg-raised"
          style={{ boxShadow: "var(--shadow-panel)", border: "1px solid var(--border)", transformOrigin: "center" }}
        >
          {/* Header */}
          <div className="flex flex-none items-start gap-3 border-b border-divider px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-extrabold tracking-tight text-ink">{action.label}</h2>
              <div className="mt-0.5 text-[11.5px] text-ink-muted">{accountName}</div>
              {schema.intro && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-body">{schema.intro}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="c360-press flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-border text-ink-muted hover:text-ink"
            >
              <svg width="14" height="14" viewBox="0 0 15 15" aria-hidden="true">
                <path d="M4 4l7 7M11 4l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <Stepper phase={phase} onBack={stepBack} />

          <div key={phase} className="c360-step-in min-h-0 flex-1 overflow-auto">
            {phase === "compile" && (
              <CompileScreen lines={compileLines} onRetry={() => void stage()} onBack={() => setPhase("form")} />
            )}

            {phase === "confirm" && plan && (
              <ConfirmGate
                plan={plan}
                actionId={actionId}
                simulated={!live}
                idempotencyKey={idempotencyKeyRef.current}
                // The gate recomputes on the SAME read the ticket computed on.
                liveStoredAt={liveStoredAt}
                liveSections={liveSections}
                asOf={asOf}
                // The way out of a blocked gate: the same staging call, the
                // same inputs, the current data. It replaces the plan and the
                // banker confirms the fresh one; nothing executes.
                onRestage={() => void stage()}
                onBack={stepBack}
                onConfirmed={onConfirmed}
              />
            )}

            {/* #10 — a resume failure is rendered where the banker is standing.
                The error block used to live only in the briefing phase, so a
                failed Continue set state that nothing displayed. */}
            {phase === "tracker" && toolError && (
              <div className="border-b border-divider px-5 py-3">
                <div className="rounded-[10px] px-3.5 py-2.5" style={{ background: "var(--critical-bg)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--critical)" }}>
                      This did not go through
                    </span>
                    <span
                      className="rounded-[5px] px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-wide"
                      style={{ background: "var(--critical-bg)", color: "var(--critical)", border: "1px solid var(--critical)" }}
                    >
                      {toolError.code}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--critical)" }}>
                    {toolError.message}
                  </div>
                  {toolError.orgError && (
                    <div className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--critical)" }}>
                      {toolError.orgError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {phase === "tracker" && plan && tracker && (
              <StepTracker
                plan={plan}
                actionId={actionId}
                state={tracker}
                token={token}
                snapshot={bundle?.snapshot}
                outcome={outcome}
                continuing={continuing}
                onContinue={outcome?.resumable ? () => void continueExecution() : undefined}
                onChange={setTracker}
              />
            )}

            {phase === "form" && (
            <>
            {/* A re-stage after edits is a NEW plan and a new hash. Say so
                rather than letting the banker assume the plan they already saw
                still describes what would be filed. */}
            {planIsStale && (
              <div className="border-b border-divider px-5 py-3">
                <div className="rounded-[10px] px-3.5 py-2.5" style={{ background: "var(--warning-bg)" }}>
                  <div className="text-[12px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
                    The figures changed, so the plan will be rebuilt. The one you saw no longer describes what would be filed.
                  </div>
                </div>
              </div>
            )}

            {/* WP7.1 — the panel opens on the composed proposal, not a form. */}
            {briefing && (
              <DealTicket
                actionId={actionId}
                briefing={briefing}
                schema={schema}
                bundle={bundle}
                values={values}
                editedFields={editedFields}
                reasons={reasons}
                onChange={setField}
                onValueMap={(key, map) => setValues((prev) => ({ ...prev, [key]: map }))}
                sheetCloserRef={sheetCloserRef}
                sheetHost={panelEl}
                renderChip={(f, edited) => {
                  const kind = chipFor(f);
                  return kind ? <ProvenanceChip kind={kind} citation={f.prefill.citation} edited={edited} /> : null;
                }}
              />
            )}

            {/* Effective challenge next: it may change what the banker enters. */}
            {(engine.suggestions.length > 0 || engine.gaps.length > 0) && (
              <div className="flex flex-col gap-2 border-b border-divider px-5 py-4">
                <div className="kicker">Effective challenge</div>
                <p className="-mt-1 text-[11px] leading-relaxed text-ink-muted">{CHALLENGE_PANEL_INTRO}</p>
                {engine.suggestions
                  .filter((s) => !declined[s.id])
                  .map((s) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      acknowledged={Boolean(acknowledged[s.id])}
                      onAcknowledge={() =>
                        setAcknowledged((prev) => ({ ...prev, [s.id]: new Date().toISOString() }))
                      }
                      onOverride={(reason) => setDeclined((prev) => ({ ...prev, [s.id]: reason }))}
                    />
                  ))}
                {/* A declined check is named by its VERDICT, not by its rule id:
                    "coverage-shortfall declined" is a slug, not a sentence. */}
                {Object.entries(declined).map(([id, reason]) => (
                  <div key={id} className="rounded-[8px] border border-border px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                    <span className="font-semibold">
                      {engine.suggestions.find((s) => s.id === id)?.verdict ?? "This check"}
                    </span>{" "}
                    declined: {reason}
                  </div>
                ))}
                {engine.gaps.map((g, i) => (
                  <GapNote key={`${g.ruleId}-${i}`} gap={g} />
                ))}
              </div>
            )}

            {toolError && (
              <div className="border-b border-divider px-5 py-3">
                <div className="rounded-[10px] px-3.5 py-2.5" style={{ background: "var(--critical-bg)" }}>
                  <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--critical)" }}>
                    {toolError.code === "VALIDATION_FAILED" ? "The org rejected a value" : "The tool could not stage this"}
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--critical)" }}>
                    {toolError.message}
                  </div>
                  {toolError.orgError && (
                    <div className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--critical)" }}>
                      {toolError.orgError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* The completeness and audit view. Every field the write touches,
                in schema order, with its provenance. Kept, not replaced. */}
            {briefing && (
              <button
                type="button"
                aria-expanded={showAllFields}
                onClick={() => setShowAllFields((v) => !v)}
                className="c360-press flex w-full items-center gap-2 border-t border-divider px-5 py-2.5 text-[11.5px] font-semibold text-ink-muted hover:text-ink"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="c360-twist flex-none"
                  style={{ transform: showAllFields ? "rotate(90deg)" : "none" }}
                >
                  <path d="M4 2.5l4 3.5-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                All fields ({schema.fields.length})
              </button>
            )}

            {(!briefing || showAllFields) &&
              schema.fields.map((f) => (
                <FieldRow
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  edited={editedFields.includes(f.key)}
                  onChange={(v) => setField(f, v)}
                />
              ))}
            </>
            )}
          </div>

          {/* Footer: schema completeness, and the gesture that builds the plan. */}
          {phase === "form" && (
          <div className="flex flex-none items-center gap-3 border-t border-divider px-5 py-3">
            <div className="flex-1 text-[11px] text-ink-muted">
              {blockers.length > 0
                ? blockers.map((b) => b.gap!.reason).join(" ")
                : (overrideGap ?? facilityGap ?? batchGap)
                  ? (overrideGap ?? facilityGap ?? batchGap)
                  : missing.length > 0
                  ? `${missing.length} required ${missing.length === 1 ? "field" : "fields"} still to complete.`
                  : `Creates a ${schema.writeObjectLabel}.`}
            </div>
            {attribution && <span className="text-[10px] text-ink-faint">narrative edited</span>}
            <button
              type="button"
              onClick={onClose}
              className="c360-press rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink"
            >
              Close
            </button>
            {(mcpAvailable() && isWriteAction(actionId)) || isSimulationAllowed() ? (
              <button
                type="button"
                disabled={
                  missing.length > 0 ||
                  blockers.length > 0 ||
                  overrideGap !== null ||
                  facilityGap !== null ||
                  batchGap !== null
                }
                onClick={() => (plan && !planIsStale ? setPhase("confirm") : void stage())}
                className="c360-btn rounded-md px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-40"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                {plan && !planIsStale ? "Back to the plan" : planIsStale ? "Rebuild the plan" : "Review the plan"}
              </button>
            ) : (
              <span className="text-[11px] text-ink-faint" title="The staging tools are not deployed yet">
                Analysis only until the staging tools are live
              </span>
            )}
          </div>
          )}
        </div>
      </div>
    </Portal>
  );
}

/** Currency rendering helper reused by tests and the confirm summary. */
export const formatPanelCurrency = fmtMoney;
