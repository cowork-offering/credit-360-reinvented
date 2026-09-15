/* =============================================================================
   THE GOVERNED-ACTION STAGE, AS A MODEL (0.9.29, knowledge/DESIGN-0.9.29-ROLLBACK-STAGE.md).

   The stage reads a staged plan and an executed result and nothing else. This
   file is the reading: it turns the `stage_*` / `execute_*` contract into the
   rows the sheet renders, and it is GENERIC over that contract so every
   stage/execute pair can host the same stage later. Only `discard-version` is
   wired in this release.

   WHAT A GROUP IS, STRUCTURALLY. The frozen contract runs each object in its
   own write step and proves it in a verification step named `<stepId>_verify`
   immediately after. That pairing is the group, and it is discovered rather
   than listed: a pair means a group, and everything after the last pair is the
   plan's closing. Nothing here knows an object name, an action id or a record.

   NOTHING HERE COMPOSES A FACT. The counts are the org's rows counted, the
   names and reasons are the org's strings verbatim, the labels are the org's
   step labels, and the closing sentences are the executor's own verification
   details. The one authored layer is the short banker title per object, which
   the caller hands in.
   ============================================================================= */

import type { PlanStep, StagedOutput } from "./stagedPlan";
import { inventoryRows, type InventoryRow } from "./discardVersion";

/** One distinct org reason, carrying the record names that gave it. */
export interface StageReason {
  /** The org's sentence, verbatim. */
  text: string;
  /** The org's record names for it, compressed. */
  names: string;
}

/** One write group: an object, its rows, and the step that proves it gone. */
export interface StageGroup {
  /** The write step's id. */
  id: string;
  /** The verification step that proves this group, `<id>_verify`. */
  verifyId: string;
  objectName: string;
  /** Short banker title for the object. The one authored string on the row. */
  title: string;
  /** The org's own step label, with the count it repeats taken off the end. */
  label: string;
  count: number;
  /** The org's record names, shared prefix removed and duplicates counted. */
  names: string;
  reasons: StageReason[];
  /** The first automation this write is expected to wake, or null. */
  automation: string | null;
}

/** What a group with no rows says on the plan. */
export const EMPTY_GROUP_LINE = "None found on this version";

/** What a group says once its re-query has answered. */
export function verifiedLine(count: number): string {
  return count === 0 ? "Re-query confirms 0. Nothing was there to remove." : `Re-query confirms all ${count} gone.`;
}

/* ------------------------------------------------------------ the strings */

/** Identical org names, counted. Counting is not invention. */
function collapse(names: readonly string[]): string[] {
  const out: Array<[string, number]> = [];
  for (const name of names) {
    const seen = out.find((e) => e[0] === name);
    if (seen) seen[1] += 1;
    else out.push([name, 1]);
  }
  return out.map(([n, c]) => (c === 1 ? n : `${n} ×${c}`));
}

/**
 * Where every name in a group opens with the same words, the row shows what
 * differs. The disclosure still carries the org's exact names.
 *
 * The cut is taken at a SEPARATOR inside the shared opening, never mid-word: a
 * prefix trimmed at an arbitrary character produces names no banker can match
 * against the record they are looking at.
 */
function stripShared(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  let lcp = names[0];
  for (const other of names.slice(1)) {
    while (lcp && !other.startsWith(lcp)) lcp = lcp.slice(0, -1);
  }
  const cut = Math.max(lcp.lastIndexOf(" - ") + 3, lcp.lastIndexOf(" on ") + 4);
  if (cut < 12) return [...names];
  return names.map((n) => n.slice(cut));
}

/** The org puts its own count in parentheses at the end of its label. The row
 *  carries that count in its own column, so the label is shown without it. */
function bareLabel(label: string): string {
  return label.endsWith(")") ? label.replace(/\s*\(\d+\)$/, "") : label;
}

/** A readable title for an org object the caller did not name. Never a guess at
 *  meaning: the API name with its namespace and suffix taken off. */
function objectTitle(objectName: string): string {
  const bare = objectName.replace(/^[A-Za-z0-9]+__/, "").replace(/__c$/, "").replace(/_/g, " ");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/* ------------------------------------------------------------- the groups */

/** Is this step a group write, i.e. does the plan prove it in the next step? */
function verifierOf(steps: readonly PlanStep[], index: number): PlanStep | null {
  const step = steps[index];
  const next = steps[index + 1];
  if (step.type !== "write" || !step.objectName) return null;
  return next && next.type === "verification" && next.id === `${step.id}_verify` ? next : null;
}

/**
 * The plan's write groups, in the org's own order.
 *
 * `titles` is the caller's banker vocabulary, keyed by org object API name. An
 * object it does not name falls back to the API name read plainly, so an org
 * that grows a twelfth object still renders rather than rendering blank.
 */
export function stageGroups(plan: StagedOutput, titles: Record<string, string> = {}): StageGroup[] {
  const rows = inventoryRows(plan.items);
  const byObject = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const list = byObject.get(row.object!) ?? [];
    list.push(row);
    byObject.set(row.object!, list);
  }

  const groups: StageGroup[] = [];
  plan.steps.forEach((step, i) => {
    const verify = verifierOf(plan.steps, i);
    if (!verify) return;
    const object = step.objectName!;
    const mine = byObject.get(object) ?? [];

    // One line per DISTINCT reason, carrying the names that gave it. Repeating
    // one sentence seven times is not detail.
    const byReason = new Map<string, string[]>();
    for (const row of mine) {
      if (!row.reason) continue;
      const names = byReason.get(row.reason) ?? [];
      names.push(row.name ?? row.id ?? object);
      byReason.set(row.reason, names);
    }

    groups.push({
      id: step.id,
      verifyId: verify.id,
      objectName: object,
      title: titles[object] ?? objectTitle(object),
      label: bareLabel(step.label),
      count: mine.length,
      names: mine.length ? stripShared(collapse(mine.map((r) => r.name ?? r.id ?? object))).join(", ") : EMPTY_GROUP_LINE,
      reasons: [...byReason].map(([text, names]) => ({ text, names: collapse(names).join(", ") })),
      automation: step.automationWoken?.[0] ?? null,
    });
  });
  return groups;
}

/** Every step a group owns: the write and the verification that proves it. */
function groupStepIds(groups: readonly StageGroup[]): Set<string> {
  return new Set(groups.flatMap((g) => [g.id, g.verifyId]));
}

/**
 * THE CLOSING: what the plan does once the list is empty.
 *
 * The steps no group owns, minus the observed side effects, which report what
 * the org noticed rather than what the plan did. These are the sentences the
 * sheet types out one beat apart.
 */
export function closingSteps(plan: StagedOutput, groups: readonly StageGroup[]): PlanStep[] {
  const owned = groupStepIds(groups);
  return plan.steps.filter((s) => !owned.has(s.id) && s.type !== "observed_side_effect");
}

/** What the org OBSERVED rather than wrote. Reported under the closing. */
function observedSteps(plan: StagedOutput, groups: readonly StageGroup[]): PlanStep[] {
  const owned = groupStepIds(groups);
  return plan.steps.filter((s) => !owned.has(s.id) && s.type === "observed_side_effect");
}

/* --------------------------------------------------------------- the run */

/** One executed step, read structurally: the run only ever needs these three. */
export interface RunStep {
  id: string;
  state?: string;
  detail?: string;
}

/** How a group ENDED, off the executor's own step states.
 *
 *  `gone`    the write and its re-query both landed: the row leaves the sheet.
 *  `kept`    written, not proven. Not a failure and never rendered as one, so
 *            the row stays standing with the org's reason under it.
 *  `stopped` the org refused: the run ends here and nothing after it ran.
 *  `skipped` never attempted.
 *  `open`    the executor said nothing about it. */
export type GroupOutcome = "gone" | "kept" | "stopped" | "skipped" | "open";

export function groupOutcome(group: StageGroup, steps: readonly RunStep[]): { outcome: GroupOutcome; detail?: string } {
  const write = steps.find((s) => s.id === group.id);
  const verify = steps.find((s) => s.id === group.verifyId);
  if (!write) return { outcome: "open" };
  if (write.state === "failed" || write.state === "ambiguous") return { outcome: "stopped", detail: write.detail };
  if (verify?.state === "failed" || verify?.state === "ambiguous") return { outcome: "stopped", detail: verify.detail };
  if (write.state === "skipped_not_attempted") return { outcome: "skipped", detail: write.detail };
  if (write.state === "filed_unverified" || verify?.state === "filed_unverified") {
    return { outcome: "kept", detail: verify?.detail ?? write.detail };
  }
  if (verify?.state === "verified") return { outcome: "gone", detail: verify.detail ?? verifiedLine(group.count) };
  if (write.state === "verified") return { outcome: "gone", detail: verifiedLine(group.count) };
  return { outcome: "open", detail: write.detail };
}

/**
 * The closing sentences, in the executor's own words.
 *
 * A step the executor verified says what it found; one it skipped says why it
 * never ran. A step with no detail falls back to its own label, which is what a
 * plan that has not been executed has to show.
 */
export function closingSentences(plan: StagedOutput, groups: readonly StageGroup[], steps: readonly RunStep[]): string[] {
  return closingSteps(plan, groups).map((step) => {
    const run = steps.find((s) => s.id === step.id);
    return run?.detail || step.label;
  });
}

/** What the org observed, in its own words. Absent where it observed nothing. */
export function observedSentences(plan: StagedOutput, groups: readonly StageGroup[], steps: readonly RunStep[]): string[] {
  return observedSteps(plan, groups)
    .map((step) => steps.find((s) => s.id === step.id)?.detail ?? "")
    .filter(Boolean);
}
