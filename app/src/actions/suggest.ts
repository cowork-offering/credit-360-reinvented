/* =============================================================================
   ACTION SUGGESTIONS (SPEC §12 A27.5) — the chips above the chat input.

   Today these are computed CLIENT-SIDE by intersecting the action registry
   (what is actually available for this account) with the worklist reason codes
   (what the data says is wrong). Tomorrow the agent supplies them over the
   channel — this module is the seam: it returns a plain Suggestion[] and the
   chip component renders whatever it is given, so swapping the producer does
   not touch the UI.

   Honesty rule: a suggestion is only ever emitted for an action whose
   availability predicate passes. We never suggest something the data cannot
   support.
   ============================================================================= */

import type { ActionHistoryRow, C360Data, Id, ReasonCode, Worklist } from "../data/contract";
import { ACTIONS_BY_ID, renderPrompt, resolveBundle } from "./registry";
import { collectNextSteps } from "./nextSteps";

export interface Suggestion {
  id: string;
  label: string;
  prompt: string;
}

export const MAX_SUGGESTIONS = 3;

/** Reason code -> the action that answers it, most urgent first. */
const REASON_TO_ACTION: Array<{ reason: ReasonCode; actionId: string }> = [
  { reason: "COVENANT_BREACH", actionId: "covenant-review" },
  // An administrative Exception is answered by the same action — the covenant
  // review is where the evaluation or the document gets recorded.
  { reason: "COVENANT_EXCEPTION", actionId: "covenant-review" },
  { reason: "COVENANT_DUE", actionId: "covenant-review" },
  { reason: "MATURITY_NEAR", actionId: "renewal" },
  { reason: "MODIFICATION_CLUSTER", actionId: "loan-modification" },
  { reason: "GUARANTOR_SIGNAL", actionId: "risk-rating-review" },
  { reason: "RECENTLY_MODIFIED", actionId: "loan-modification" },
];

/** Fallbacks when nothing is flagged — still useful, still available-gated. */
const DEFAULT_ACCOUNT_ACTIONS = ["generate-spreading", "annual-review", "draft-credit-memo"];

/** Book-level prompts for the home view (no account in scope). */
const BOOK_SUGGESTIONS: Suggestion[] = [
  {
    id: "book-triage",
    label: "Triage the queue",
    prompt: "Walk the needs-action queue and tell me which relationships to work first, and why.",
  },
  {
    id: "book-concentration",
    label: "Concentration risk",
    prompt: "Summarise the book's industry and exposure concentration, and flag anything outside appetite.",
  },
  {
    id: "book-maturities",
    label: "Upcoming maturities",
    prompt: "Which facilities across the book mature next, and which renewals should start now?",
  },
];

export function suggestActions(
  data: C360Data,
  worklist: Worklist,
  accountId: Id | null,
  accountName: string | null,
  history?: readonly ActionHistoryRow[],
): Suggestion[] {
  // Home / book level is decided by ACCOUNT PRESENCE, never by the name (C4):
  // a real account with a missing name is still an account, and must get
  // account-scoped suggestions rather than silently falling back to the book.
  if (!accountId) return BOOK_SUGGESTIONS.slice(0, MAX_SUGGESTIONS);
  const name = accountName ?? "this relationship";

  const out: Suggestion[] = [];
  const seen = new Set<string>();

  const push = (actionId: string) => {
    if (out.length >= MAX_SUGGESTIONS || seen.has(actionId)) return;
    const action = ACTIONS_BY_ID[actionId];
    if (!action) return;
    // Availability gate — never suggest what the data can't support.
    if (!action.availability(data, accountId, history).available) return;
    seen.add(actionId);
    out.push({ id: action.id, label: action.label, prompt: renderPrompt(action, name, accountId) });
  };

  // 1) ACTIVITY next steps rank FIRST (A30.4). If an analysis has concluded on
  //    this relationship, its recommended actions beat anything we infer from
  //    raw signals — a concluded verdict is better evidence than a threshold.
  for (const step of collectNextSteps(resolveBundle(data, accountId))) push(step.actionId);

  // 2) Signal-driven: what the worklist says is wrong with THIS relationship.
  const reasons = new Set(worklist.reasons[accountId] ?? []);
  for (const { reason, actionId } of REASON_TO_ACTION) {
    if (reasons.has(reason)) push(actionId);
  }

  // 3) Top up with sensible defaults so the strip is never empty.
  for (const id of DEFAULT_ACCOUNT_ACTIONS) push(id);

  return out;
}
