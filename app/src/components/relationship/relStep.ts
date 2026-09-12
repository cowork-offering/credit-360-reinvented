/* =============================================================================
   THE STEP PRIMITIVES THE RELATIONSHIP ROOM'S FLOWS SHARE.

   Lifted out of `reviewFlows.ts` unchanged when the INTAKE route arrived. Both
   modules describe questions in the same grammar and both read the same answer
   map, and a second copy of the shape or of the SKIPPED sentinel is exactly how
   the two would come to disagree about what "answered" means.

   NOTHING HERE IS NEW. Every declaration below is the one `reviewFlows.ts` has
   carried since the room shipped, moved so that a module the review flows import
   can speak the same language without importing them back. `reviewFlows.ts`
   re-exports the public names, so no caller anywhere changes.
   ============================================================================= */

export type StepKind = "chips" | "multi" | "text" | "number" | "date";

export interface StepOption {
  label: string;
  value: string;
  /** A second line under the label, where the org has one worth reading. */
  detail?: string;
  /** OTHER NAMES THE BANK ITSELF USES FOR THIS ROW, matched alongside the label
   *  and the value. An option whose value is a Salesforce record id and whose
   *  label is a long description is otherwise unreachable by the name printed on
   *  the org's own pane (COL-000762), and the room refused the bank's own
   *  vocabulary. Never rendered; only ever read. */
  synonyms?: string[];
  /** THIS OPTION IS THE FIGURE ALREADY ON FILE. A banker who answers "keep" or
   *  "no change" is naming it, and the room records it rather than reading a
   *  perfectly good answer as an unreadable line. */
  onFile?: boolean;
  /** THE OPTION STAYS, DISABLED, CARRYING ITS REASON (A27.3). A choice the org
   *  will not accept is shown and refused by name; hiding it would take the map
   *  of what exists away from the banker. */
  disabled?: boolean;
  reason?: string;
}

export interface RelStep {
  /** Where the answer lands in the answer map. */
  key: string;
  /** The question, banker-formal. One sentence, no exclamation points. */
  ask: string;
  kind: StepKind;
  /** Closed-set answers, offered as chips. Every value here is the ORG's own. */
  options?: StepOption[];
  /** The step may be answered with "Not assessed" and left out of the payload. */
  optional?: boolean;
  /** The composer's placeholder while this step is live. */
  placeholder?: string;
  /** The org field this answer is aimed at, for the "what this writes" peek. */
  target?: { object: string; field: string };
  /** A NUMBER STEP WHOSE SCALE IS REAL. The room refuses a figure outside it
   *  with `refusal`, by name, before it becomes an answer. Only set where a
   *  scale exists in the org and a number off it would be a governance record
   *  nobody could read. */
  bounds?: { min: number; max: number; whole: boolean; refusal: string };
  /** THE ANSWER IS A GOVERNANCE RECORD SOMEBODY DOWNSTREAM HAS TO READ. A case
   *  subject of "!!!" or a body of "asdf" is a box being got past, and this room
   *  challenges it once rather than filing it under the bank's name. */
  substantive?: boolean;
}

/** Everything the banker has answered, keyed by step. Multi-answers are arrays;
 *  per-record answers are keyed maps. */
export type Answers = Record<string, unknown>;

/** The sentinel a banker's "skip" writes, so an optional step that was ANSWERED
 *  WITH NOTHING is distinguishable from one never reached. */
export const SKIPPED = "__skipped__";

export const isSkipped = (v: unknown) => v === SKIPPED;

export const answered = (a: Answers, key: string) => Object.prototype.hasOwnProperty.call(a, key);

export const pickedList = (a: Answers, key: string): string[] =>
  Array.isArray(a[key]) ? (a[key] as unknown[]).filter((v): v is string => typeof v === "string") : [];

export const perRecord = (a: Answers, key: string): Record<string, unknown> =>
  a[key] && typeof a[key] === "object" && !Array.isArray(a[key]) ? (a[key] as Record<string, unknown>) : {};

export const asOptions = (values: readonly string[] | undefined): StepOption[] =>
  (values ?? []).map((v) => ({ label: v, value: v }));

/** A figure off a typed line, with the money marks a banker types stripped. */
export const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** A written answer, or null where the banker skipped the question. */
export const text = (v: unknown): string | null => {
  if (isSkipped(v)) return null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
