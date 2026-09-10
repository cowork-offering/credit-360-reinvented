import type { ReasonCode } from "../data/contract";
import type { WorklistRow } from "../data/worklistRows";

/* =============================================================================
   KPI FAST-ACTIONS — the ACTION REQUIREMENT, as data.

   The landing's actionable KPI cells (Needs action, Reviews due, EWS active) are
   triage launchers. Clicking one opens a popover that, per relationship, states
   the "so what" off that account's own figures and hands the banker a SPECIFIC
   next step: the workroom this opens knows exactly what it needs.

   Both surfaces — the popover row and the composer prompt it drops — read from
   ONE declaration here, so the read and the handoff never drift (KPI-FAST-
   ACTIONS-SPEC.md, the two principles: insightful, and specific). No new read:
   every bucket is a view of sets KpiBand already derives from the confined
   portfolio.
   ============================================================================= */

export type BucketId = "needs-action" | "reviews-due" | "ews";
export type ActionTone = "neutral" | "warn" | "bad";

export interface ActionRow {
  accountId: string;
  name: string;
  industry: string;
  naicsCode: string | null;
  tce: number | null;
  staged: boolean;
  tone: ActionTone;
  /** The "so what", in the banker's terms, off the account's own figures. */
  read: string;
  /** The primary CTA label — names the workroom this opens. */
  ctaLabel: string;
  /** The pre-typed instruction the secondary drops into the composer. */
  prompt: string;
}

export interface ActionBucket {
  id: BucketId;
  title: string;
  /** One-line triage sentence, briefing voice. */
  triage: string;
  rows: ActionRow[];
}

/** Reason precedence when a row carries several: the most acute wins the CTA. */
const REASON_RANK: ReasonCode[] = [
  "COVENANT_BREACH",
  "COVENANT_EXCEPTION",
  "COVENANT_DUE",
  "CLIENT_REQUEST",
  "MATURITY_NEAR",
  "MODIFICATION_CLUSTER",
  "GUARANTOR_SIGNAL",
  "RECENTLY_MODIFIED",
];

function dominantReason(reasons: ReasonCode[]): ReasonCode | null {
  for (const code of REASON_RANK) if (reasons.includes(code)) return code;
  return null;
}

/** "23d overdue" for a past due, "due in 5d" ahead, "due today" at zero. */
function duePhrase(days: number | null): string {
  if (days == null) return "date not on file";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  return `due in ${days}d`;
}

function maturityPhrase(days: number | null): string {
  if (days == null) return "maturity date not on file";
  if (days < 0) return `matured ${Math.abs(days)}d ago`;
  if (days === 0) return "matures today";
  return `matures in ${days}d`;
}

/** The one declaration. Given a row and the lens (which bucket asked), return
 *  its read, its tone, its CTA label and the composer prompt — all consistent. */
function requirementFor(
  r: WorklistRow,
  lens: BucketId,
): { tone: ActionTone; read: string; ctaLabel: string; prompt: string } {
  // Under Reviews due / EWS the lens fixes the dominant concern; on Needs action
  // the row's own most-acute reason leads.
  const reason =
    lens === "reviews-due"
      ? (["COVENANT_BREACH", "COVENANT_EXCEPTION", "COVENANT_DUE"] as ReasonCode[]).find((c) =>
          r.reasons.includes(c),
        ) ?? dominantReason(r.reasons)
      : lens === "ews"
        ? (["COVENANT_BREACH", "MATURITY_NEAR"] as ReasonCode[]).find((c) => r.reasons.includes(c)) ??
          dominantReason(r.reasons)
        : dominantReason(r.reasons);

  switch (reason) {
    case "COVENANT_BREACH":
      return {
        tone: "bad",
        read: `Covenant test breached — ${duePhrase(r.nextTestDays)}. A real miss to record against threshold, not a timing gap.`,
        ctaLabel: "Start covenant review",
        prompt: `Start a covenant review for ${r.name}. The covenant test is breached (${duePhrase(r.nextTestDays)}); lead with the current test result against its threshold and walk me through recording the result.`,
      };
    case "COVENANT_EXCEPTION":
      return {
        tone: "bad",
        read: `Exception recorded — the due date passed (${duePhrase(r.nextTestDays)}) before a result was measured.`,
        ctaLabel: "Start covenant review",
        prompt: `Start a covenant review for ${r.name}. An exception is on the covenant (${duePhrase(r.nextTestDays)}); help me clear it by recording the test result or the waiver.`,
      };
    case "COVENANT_DUE":
      return {
        tone: r.nextTestDays != null && r.nextTestDays < 0 ? "bad" : "warn",
        read: `Covenant test ${duePhrase(r.nextTestDays)}. It needs the current result entered against its threshold.`,
        ctaLabel: "Start covenant review",
        prompt: `Start a covenant review for ${r.name}. The covenant test is ${duePhrase(r.nextTestDays)}; lead with the current result versus threshold and record it.`,
      };
    case "CLIENT_REQUEST":
      return {
        tone: "warn",
        read: `Client request waiting. Open it to see exactly what the borrower asked for.`,
        ctaLabel: "Open the request",
        prompt: `Open ${r.name}'s client request and draft the loan modification it asks for — lead with each current term before proposing a change.`,
      };
    case "MATURITY_NEAR":
      return {
        tone: r.maturityDays != null && r.maturityDays <= 30 ? "bad" : "warn",
        read: `Facility ${maturityPhrase(r.maturityDays)}. A renewal or new facility should be underway.`,
        ctaLabel: "Start renewal",
        prompt: `Start a renewal for ${r.name} — the facility ${maturityPhrase(r.maturityDays)}. Lead with the current commitment, rate and maturity, then propose the renewed terms.`,
      };
    case "MODIFICATION_CLUSTER":
      return {
        tone: "warn",
        read: `Several recent modifications cluster here — worth a look before the next change.`,
        ctaLabel: "Open relationship",
        prompt: `Open ${r.name} and summarise the recent modification cluster before we consider another change.`,
      };
    case "GUARANTOR_SIGNAL":
      return {
        tone: "warn",
        read: `A guarantor signal is flagged on this relationship.`,
        ctaLabel: "Open relationship",
        prompt: `Open ${r.name} on the guarantor tab and walk me through the flagged guarantor signal.`,
      };
    default:
      return {
        tone: "neutral",
        read: `On the queue — open to see what it needs.`,
        ctaLabel: "Open relationship",
        prompt: `Open ${r.name}.`,
      };
  }
}

function toActionRow(r: WorklistRow, lens: BucketId): ActionRow {
  const req = requirementFor(r, lens);
  return {
    accountId: r.accountId,
    name: r.name,
    industry: r.industry,
    naicsCode: r.naicsCode,
    tce: r.tce,
    staged: r.staged,
    tone: req.tone,
    read: req.read,
    ctaLabel: req.ctaLabel,
    prompt: req.prompt,
  };
}

const hasCovenant = (r: WorklistRow) =>
  r.reasons.includes("COVENANT_BREACH") ||
  r.reasons.includes("COVENANT_EXCEPTION") ||
  r.reasons.includes("COVENANT_DUE");

const hasEws = (r: WorklistRow) =>
  r.reasons.includes("COVENANT_BREACH") || r.reasons.includes("MATURITY_NEAR");

/** Build a bucket from the SAME worklist rows the queue stands on, so the popup
 *  and the queue read identically and every row carries an id + exposure for its
 *  CTA. Rows are ordered most-acute first (bad before warn before neutral). */
export function buildActionBucket(id: BucketId, rows: WorklistRow[]): ActionBucket {
  const pick =
    id === "reviews-due" ? rows.filter(hasCovenant) : id === "ews" ? rows.filter(hasEws) : rows;
  const actionRows = pick.map((r) => toActionRow(r, id));
  const toneOrder: Record<ActionTone, number> = { bad: 0, warn: 1, neutral: 2 };
  actionRows.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

  const n = actionRows.length;
  const bad = actionRows.filter((r) => r.tone === "bad").length;
  let title: string;
  let triage: string;
  if (id === "reviews-due") {
    title = "Reviews due";
    triage =
      n === 0
        ? "No covenant tests due in the window."
        : `${n} covenant ${n === 1 ? "test" : "tests"} due${bad > 0 ? `, ${bad} overdue or breached` : ""}.`;
  } else if (id === "ews") {
    title = "Early-warning signals";
    triage =
      n === 0
        ? "No early-warning signals in the window."
        : `${n} early-warning ${n === 1 ? "signal" : "signals"} in window${bad > 0 ? `, ${bad} acute` : ""}.`;
  } else {
    title = "Needs action";
    triage =
      n === 0 ? "The queue is clear." : `${n} ${n === 1 ? "relationship needs" : "relationships need"} action.`;
  }
  return { id, title, triage, rows: actionRows };
}
