import type { ActionHistoryRow, ActionStep } from "../../data/contract";
import type { MemoChange, MemoChangeFields } from "../../memo/types";
import type { RenderPlan } from "../../memo/renderMemo";
import { shortPackageName } from "../workroom/filedSheet";
import type { MemoFiledSummary, MemoTrigger } from "./memoSession";

/* =============================================================================
   THE GREETING FROM THE ORG.

   NON-NEGOTIABLE 1 (memo requirements, 2026-09-04): the room knows what was
   done to the relationship, from the ORG and not from browser memory, so the
   memo can be opened at any time by any viewer and it still states what was
   recently executed. That is what this file composes.

   THE TRAIL CARRIES THE STEPS NOW (Phase B, 9434378).
   `Customer360ActionHistory` returns, for an executed row, the plan's own steps
   with the field that moved, the value on each side, the org's read-back
   sentence and the id of the record it wrote. So the change list the memo is
   built on is READ, not handed over, and a viewer who never saw the filing gets
   the same memo as the banker who filed it.

   TWO INPUTS RIDE THE READ. `includeSteps` lifts the 90-day window the read
   otherwise applies to step detail, and `productPackageId` narrows the trail to
   one package and the versions it forked into. The host sends both.

   THE FALLBACK IS NARROW NOW, AND STILL HONEST. A row that genuinely carries no
   steps is a row nothing can be built from: an older execution outside the
   window, a plan shape that never held steps, a row the per-row budget trimmed.
   Then, and only then, the room says so and works from the ledger a finale
   handed over, or states the package as it stands. A banker always knows which
   of the three the memo is standing on.

   THE BUDGET IS THE FOUNDER'S (2026-09-02): one lead line and at most four
   lines under it. Everything the greeting could say and does not is in the
   memo, which is on the glass beside it.
   ============================================================================= */

/* -------------------------------------------------- which rows a memo reads */

/**
 * THE THREE ACTIONS A CREDIT MEMO IS WRITTEN ABOUT.
 *
 * A collateral valuation and a covenant review are executed actions with steps
 * on the same trail, and neither one is a credit event this memo reports. So
 * the room reads the trail for the three that ARE, and a package whose newest
 * executed row is a valuation opens on the honest "nothing changed" line rather
 * than on a memo about a re-appraisal.
 */
export const MEMO_ACTION_IDS: ReadonlySet<string> = new Set([
  "loan-modification",
  "renewal",
  "new-facility-request",
]);

/* ------------------------------------------------ steps, as memo changes */

/** The step types that WROTE something. A wait, a verification query and a
 *  handoff are the plan's machinery, not changes to the relationship, and a
 *  memo that listed them as changes would be describing its own plumbing. */
const WRITING_TYPES: ReadonlySet<string> = new Set(["write", "observed_side_effect"]);

/** The step states that did NOT land. A failed write is not a change, and a
 *  step nobody attempted is not one either. */
const UNLANDED_STATES: ReadonlySet<string> = new Set(["failed", "skipped_not_attempted"]);

/** True for a step that changed the org. A plan whose steps declare no type at
 *  all is taken at face value: dropping every step of it would be worse than
 *  listing a wait. */
function wrote(step: ActionStep, typed: boolean): boolean {
  if (step.state && UNLANDED_STATES.has(step.state)) return false;
  if (!typed) return true;
  return !step.type || WRITING_TYPES.has(step.type);
}

/** Which dossier field a step's field name is about. The dossier's own
 *  `sidesFor` reads exactly these three by name; anything else rides through
 *  under the org's own field name, where it is evidence and not arithmetic. */
function dossierKey(field: string | undefined): "commitment" | "outstanding" | "maturity" | null {
  if (!field) return null;
  if (/maturity/i.test(field)) return "maturity";
  if (/balance|outstanding|drawn/i.test(field)) return "outstanding";
  if (/amount|commit|limit/i.test(field)) return "commitment";
  return null;
}

/**
 * A printed org value, as a number.
 *
 * The trail carries what the org showed, which is a STRING: "$5,000,000",
 * "7500000", "$7.5MM". The dossier's exposure arithmetic needs a number for the
 * two money fields and nothing else, so this parses conservatively and returns
 * null on anything it is not sure of. A null keeps the string on the change
 * under its own field name, and the memo's figures come from the bundle.
 */
export function parseOrgNumber(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*\$?\s*(-?[\d,]+(?:\.\d+)?)\s*(MM|M|K|B)?\s*$/i.exec(value);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toUpperCase();
  return base * (suffix === "K" ? 1e3 : suffix === "B" ? 1e9 : suffix === "M" || suffix === "MM" ? 1e6 : 1);
}

/** One side of one step, keyed the way the dossier reads it. */
function sideOf(step: ActionStep, which: "before" | "after"): MemoChangeFields | null {
  const printed = step[which];
  if (printed == null) return null;
  const key = dossierKey(step.field);
  if (key === "maturity") return { maturity: printed };
  if (key) {
    const n = parseOrgNumber(printed);
    return n == null ? { [step.field ?? key]: printed } : { [key]: n };
  }
  return { [step.field ?? "value"]: printed };
}

/**
 * THE EXECUTED STEPS, AS THE MEMO'S CHANGE LIST.
 *
 * ONE CHANGE PER TARGET, not one per step. The trail is FIELD level: a single
 * amendment to one facility arrives as a commitment step, a maturity step and
 * whatever pricing the org required alongside them. The dossier reads a change's
 * `before` as that facility's whole existing side (`dossier.ts`, `sidesFor`), so
 * three field steps on one loan have to arrive as one change carrying three
 * fields. Split into three, the second and third would be invisible to the
 * exposure arithmetic.
 *
 * A TARGET WITH NO `before` ON ANY STEP WAS CREATED, and the absence is
 * preserved rather than filled: that is exactly how the dossier recognises a new
 * facility, and a `before` of zero would read as a facility that used to exist.
 */
export function changesFromSteps(steps: readonly ActionStep[]): MemoChange[] {
  const typed = steps.some((s) => !!s.type);
  const landed = steps.filter((s) => wrote(s, typed));
  const order: string[] = [];
  const byTarget = new Map<string, { steps: ActionStep[]; loanId?: string; label?: string }>();

  for (const step of landed) {
    const key = step.targetLoanId ?? step.targetLabel ?? step.objectName ?? step.id;
    if (!byTarget.has(key)) {
      order.push(key);
      byTarget.set(key, { steps: [], loanId: step.targetLoanId, label: step.targetLabel });
    }
    const group = byTarget.get(key)!;
    group.steps.push(step);
    group.loanId = group.loanId ?? step.targetLoanId;
    group.label = group.label ?? step.targetLabel;
  }

  return order.map((key) => {
    const group = byTarget.get(key)!;
    const first = group.steps[0];
    let before: MemoChangeFields | undefined;
    let after: MemoChangeFields | undefined;
    for (const step of group.steps) {
      const b = sideOf(step, "before");
      if (b) before = { ...before, ...b };
      const a = sideOf(step, "after");
      if (a) after = { ...after, ...a };
    }
    return {
      id: first.id,
      /* THE PLAN'S OWN LABEL, and the org's field name behind it where the plan
         did not write one. Never a sentence composed here: the memo quotes the
         plan a banker confirmed. */
      label: group.steps.map((s) => s.label).find(Boolean) ?? group.label ?? first.field ?? first.id,
      target: {
        kind: first.objectName ?? (group.loanId ? "facility" : "package"),
        id: group.loanId,
        name: group.label,
      },
      before,
      after,
      /* THE ORG'S OWN READ-BACK SENTENCE. It is the proof the write landed, and
         it is carried verbatim: the room never paraphrases a verification. */
      verification: group.steps.map((s) => s.verification).find(Boolean),
      orgId: group.steps.map((s) => s.orgRecordId).find(Boolean),
    };
  });
}

/* ------------------------------------------------------- reading the trail */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Sep", off an ISO instant. Undefined where the row carries no stamp. */
export function shortDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** An org id, short enough to sit in a sentence and long enough to be one id. */
const shortId = (id: string): string => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

/** The room's word for what an action did. The org's own action id wins over
 *  the trigger, because the row is what actually happened. */
export function actionWord(actionId: string | undefined, trigger: MemoTrigger): string {
  const id = actionId ?? "";
  if (/modif/i.test(id)) return "a modification";
  if (/renew/i.test(id)) return "a renewal";
  if (/new-facility|new_facility|origination/i.test(id)) return "a new facility";
  return trigger === "renew"
    ? "a renewal"
    : trigger === "create"
      ? "a new facility"
      : trigger === "modify"
        ? "a modification"
        : "an action";
}

export interface ExecutedRead {
  /** The newest executed credit action on this package, or null. */
  row: ActionHistoryRow | null;
  /** Its steps as changes. Empty where the row carried no step detail. */
  changes: MemoChange[];
  /** Whether the row actually carried step detail. */
  hasSteps: boolean;
  /** The row's own requested/derived split, where the plan shape held one. */
  split: { requested: number; derived: number } | null;
  /** Present where the per-row cap trimmed the list, so the greeting can say
   *  the memo is standing on part of a longer plan rather than all of it. */
  trimmed: number | null;
}

/**
 * THE LAST CREDIT ACTION THE ORG RECORDS AGAINST THIS PACKAGE.
 *
 * Completed, one of the three memo actions, newest first. A row for another
 * package is not this memo's business, so a package anchor filters; a row with
 * no package on it is kept only when the room has no anchor either, which is
 * the honest reading of a trail that does not say which package it touched.
 *
 * THE ROW WITH STEPS WINS OVER THE ROW WITHOUT. The read returns step detail for
 * executed rows inside its window and, with `includeSteps`, beyond it; a newer
 * row that came back bare while an older one carries its plan is a worse memo
 * than the older one, so the newest row CARRYING STEPS is preferred and the
 * newest row overall is the fallback.
 */
export function executedRead(rows: readonly ActionHistoryRow[] | undefined, packageId: string | null): ExecutedRead {
  const candidates = (rows ?? [])
    .filter((r) => r.status === "Completed")
    .filter((r) => MEMO_ACTION_IDS.has(r.actionId ?? ""))
    .filter((r) => (packageId ? !r.productPackageId || r.productPackageId === packageId : true));
  // The read hands rows back newest first; sorting on the stamp keeps that true
  // for a caller that merged two reads, and is a no-op for the sweep's own.
  const sorted = [...candidates].sort((a, b) => (b.executedAt ?? "").localeCompare(a.executedAt ?? ""));
  const row = sorted.find((r) => (r.steps?.length ?? 0) > 0) ?? sorted[0] ?? null;
  const steps = row?.steps ?? [];
  const counts = row?.changeCounts;
  const split =
    counts && (counts.requested !== undefined || counts.derived !== undefined)
      ? { requested: counts.requested ?? 0, derived: counts.derived ?? 0 }
      : null;
  const trimmed = row?.stepCount != null && row.stepCount > steps.length ? row.stepCount : null;
  return { row, changes: changesFromSteps(steps), hasSteps: steps.length > 0, split, trimmed };
}

/* ---------------------------------------------------------- the greeting */

/** The chip the greeting offers. `open` is present only where a memo exists. */
export interface MemoChip {
  id: "draft" | "steer" | "open";
  label: string;
}

export interface MemoGreeting {
  lead: string;
  /** At most four. The render plan, and whatever honesty the read demands. */
  lines: string[];
  ask: string;
  chips: MemoChip[];
  /** True where the greeting is standing on the org's own step detail. */
  fromOrg: boolean;
}

/** How many of the filed changes the banker asked for, and how many the room
 *  added on its own. */
export interface ChangeSplit {
  requested: number;
  derived: number;
}

export interface MemoGreetingInput {
  packageId: string | null;
  /** The org's own name for the package. The greeting says this, never an id. */
  packageName?: string | null;
  /** The relationship, so the package name can drop it where nCino put it there
   *  (`shortPackageName`). Absent leaves the org's label exactly as it is. */
  accountName?: string | null;
  trigger: MemoTrigger;
  executed: ExecutedRead;
  /** The finale's own ledger, where a finale opened the room. */
  carried: readonly MemoChange[] | null;
  carriedSplit?: ChangeSplit | null;
  /** The finale's summary: the version, the lines and the exposure it moved. */
  filed?: MemoFiledSummary | null;
  plan: RenderPlan;
  /** True where `latestMemo()` came back with something. */
  hasStoredMemo: boolean;
}

const countPhrase = (n: number, split?: ChangeSplit | null): string => {
  const base = `${n} change${n === 1 ? "" : "s"}`;
  return split && split.derived > 0 ? `${base}: ${split.requested} requested, ${split.derived} derived` : base;
};

/** The render plan, in one line. Suppressed is counted, never listed here:
 *  the quiet expandable in the reading pane is where the reasons live. */
export function planLine(plan: RenderPlan): string {
  const on = plan.modules.length;
  const off = plan.suppressed.length;
  return off
    ? `Render plan: ${on} module${on === 1 ? "" : "s"} on, ${off} suppressed by the deal's own flags.`
    : `Render plan: ${on} module${on === 1 ? "" : "s"} on, nothing suppressed.`;
}

/** THE ASK. One question, three chips at most, and never a fourth. */
const MEMO_ASK = "Draft it, or steer me first?";

/** The line the room says when the trail carries no step detail for this
 *  package. Said out loud, because a memo that quietly drafted on no change
 *  list would look exactly like a memo that had read one. */
export const NO_STEP_DETAIL = "Nothing filed on this package since the last memo";

export function memoGreeting(input: MemoGreetingInput): MemoGreeting {
  const { executed, carried, packageId, filed } = input;
  /** The package as this room names it: the org's label with the relationship's
   *  own name off the front of it, where nCino put it there. */
  const packageName = input.packageName ? shortPackageName(input.accountName, input.packageName) : null;
  const version = packageName ?? (packageId ? `version ${shortId(packageId)}` : "this package");
  const lines: string[] = [];
  let lead: string;
  let fromOrg = false;

  if (filed?.items.length) {
    /* THE HANDOVER LEADS (founder, 2026-09-06). The room was opened by a finale
       that filed seconds ago and handed its own sheet across, so the greeting
       names the version on the FIRST commit rather than waiting on a trail read
       that would say the same thing a second later - or, worse, say the last
       filing on this package instead of this one.

       AND IT SAYS IT ONCE. The sheet is redrawn above this as the room's first
       timeline row (`MemoRoom`'s `FiledRow`), which is where the filed lines and
       the exposure are: a greeting that listed them again would be the same four
       facts twice on one screen, in two shapes, for no reader. */
    /* THE VERSION IS THE PACKAGE'S NAME WHERE THE ROOM KNOWS IT (the memo pass's
       own rule). A raw org id is not something a banker reads, and the id is on
       the sheet above this anyway; only where there is no name at all does the
       greeting fall back to naming the version by its short id. */
    const anchor = packageName
      ? `the ${packageName}`
      : filed.version
        ? `version ${shortId(filed.version)}`
        : version;
    lead = `Drafting the memo for ${anchor}: ${countPhrase(
      filed.items.length,
      input.carriedSplit,
    )} filed on this package a moment ago.`;
  } else if (executed.hasSteps && executed.row) {
    fromOrg = true;
    const when = shortDate(executed.row.executedAt ?? executed.row.createdDate);
    /* THE COUNT IS THE ORG'S OWN SPLIT WHERE THE ROW CARRIES ONE, and the
       number of changes the memo was actually built from where it does not.
       Never both, and never a recount of the same set under two names. */
    const count = executed.split
      ? countPhrase(executed.split.requested + executed.split.derived, executed.split)
      : countPhrase(executed.changes.length);
    lead = `Since the last memo on ${version}: ${actionWord(executed.row.actionId, input.trigger)} filed${
      when ? ` ${when}` : ""
    }, ${count}. Drafting the memo for that version.`;
    if (executed.trimmed) {
      lines.push(
        `The plan holds ${executed.trimmed} steps and the read returned the first ${executed.row.steps?.length ?? 0}; the memo stands on those.`,
      );
    }
  } else if (carried?.length) {
    lead = `Working from what this session just filed on ${version}: ${countPhrase(
      carried.length,
      input.carriedSplit,
    )}. Drafting the memo for that version.`;
  } else {
    lead = `${NO_STEP_DETAIL}, so the memo states ${version} as booked.`;
  }

  /* THE RENDER PLAN IS NOT A SENTENCE HERE (founder, 2026-09-04: the greeting
     read as clutter). It stands above the reading pane, where the modules are. */

  const chips: MemoChip[] = [
    { id: "draft", label: "Draft" },
    { id: "steer", label: "Steer" },
  ];
  if (input.hasStoredMemo) chips.push({ id: "open", label: "Open latest memo" });

  // THE BUDGET IS A CAP, NOT A TARGET (founder, 2026-09-02). Four is the most
  // the room may say; it says one or two, and the memo says the rest.
  return { lead, lines: lines.slice(0, 4), ask: MEMO_ASK, chips, fromOrg };
}
