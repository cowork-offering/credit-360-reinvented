/* =============================================================================
   NEXT STEPS — shared state, three consumers (SPEC §12 A30.4).

   `activity[].detail.nextSteps[]` is DATA, not popup copy. The same array feeds:
     (a) the Activity detail popup's action buttons,
     (b) the chat suggestion chips,
     (c) the Actions panel highlighting.
   The chat "knows" the next steps because they are data — never because
   somebody restated them in prose.

   Resolution is registry-bound and availability-gated: an actionId with no
   registry entry is DROPPED (never a dead button), and an action whose
   predicate fails is returned as unavailable-with-reason so the UI can show it
   disabled and honest, exactly like the Actions panel.
   ============================================================================= */

import type { ActionHistoryRow, BorrowerBundle, C360Data, Id, NextStep } from "../data/contract";
import { ACTIONS_BY_ID, renderPrompt, type Availability, type ClientAction } from "./registry";

export interface ResolvedNextStep {
  action: ClientAction;
  /** Banker context supplied alongside the action id, if any. */
  note?: string;
  availability: Availability;
  prompt: string;
}

/** Resolve a nextSteps[] array against the registry, in order, de-duplicated. */
export function resolveNextSteps(
  steps: NextStep[] | undefined,
  data: C360Data,
  accountId: Id,
  accountName: string,
  history?: readonly ActionHistoryRow[],
): ResolvedNextStep[] {
  const out: ResolvedNextStep[] = [];
  const seen = new Set<string>();
  for (const step of steps ?? []) {
    const action = ACTIONS_BY_ID[step.actionId];
    if (!action || seen.has(action.id)) continue; // unknown id -> dropped
    seen.add(action.id);
    out.push({
      action,
      note: step.note,
      availability: action.availability(data, accountId, history),
      prompt: renderPrompt(action, accountName, accountId),
    });
  }
  return out;
}

/** Every nextStep across an account's activity, newest entry first — the
 *  ordering the chat chips consume so the freshest conclusion ranks highest. */
export function collectNextSteps(bundle: BorrowerBundle | null): NextStep[] {
  if (!bundle) return [];
  const entries = [...(bundle.activity ?? [])].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  const out: NextStep[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const s of e.detail?.nextSteps ?? []) {
      if (seen.has(s.actionId)) continue;
      seen.add(s.actionId);
      out.push(s);
    }
  }
  return out;
}
