/* =============================================================================
   RESUME ON THE GLASS (0.9.29, backlog row 64).

   FOUNDER, 2026-09-15 17:51 UTC, Sunbelt discard STG-0000000169 stopped at
   `delete_chain`: the tracker's own text said "Re-run execute_discard_version
   with the same idempotency key to resume from where it stopped" and the page
   offered nothing to press.

   A STOPPED RUN IS AN OPEN RUN. The executor leaves the staging row at
   `Executing` WITH a result id exactly when the chain stopped part way
   (ExecuteDiscardVersion.cls: "Status Executing plus a result id is what makes
   the same idempotency key resumable rather than replayable"). That pair is the
   whole test, and it is the org's own state rather than a guess of ours.

   WHAT A RESUME MAY SEND, AND WHAT IT MAY NEVER INVENT. The same idempotency
   key, the same staging id, the same plan hash, the same decision token, the
   same approver. All five are the page's own record of the run it made; the
   token in particular is minted server-side at stage time and is nowhere else.

   SO THE RECORD LIVES FOR EXACTLY AS LONG AS THE PAGE DOES. Module scope, never
   persisted, never serialised, never on the wire except back to the tool that
   issued it. A reload, a republish or another banker's session holds no token
   for this staging id, and the honest answer there is one line saying the run
   must be staged afresh, NOT a control that would have to invent one.
   ============================================================================= */

import type { ActionHistoryRow } from "../data/contract";
import type { StagedOutput } from "./stagedPlan";
import type { ExecuteResult } from "../channel/writeTools";

/** The label on the control, in banker words. */
export const RESUME_LABEL = "Resume from here";

/** What the page says where it no longer holds the run's own token. ONE line,
 *  and no control beside it: there is nothing here that can be pressed. */
export const RESUME_NEEDS_RESTAGE =
  "This run's confirmation token lives only on the page that made it, and this page no longer holds it, so the discard has to be staged afresh.";

/** What resuming does, said before it is pressed. */
export const RESUME_LINE =
  "Resuming sends the same idempotency key, the same decision token and the same frozen plan, from the group that stopped. Nothing already written is written twice.";

/**
 * EVERYTHING A RESUME NEEDS, held for this page's lifetime.
 *
 * `plan` is the CONFIRMED plan, frozen (A6): a resume runs the rows the banker
 * saw and no others. `outcome` is the last answer the org gave, which is what
 * says where the chain stopped.
 */
export interface OpenRun {
  actionId: string;
  plan: StagedOutput;
  idempotencyKey: string;
  approverUserId: string;
  /** The banker who confirmed it, as the page names people. */
  approver?: string;
  outcome: ExecuteResult;
}

const RUNS = new Map<string, OpenRun>();

/** Hold a run that ended without finishing, so the glass can offer a resume. */
export function rememberRun(run: OpenRun): void {
  RUNS.set(run.plan.stagingId, run);
}

/** The run this page made under that staging id, or null. */
export function recallRun(stagingId: string | undefined): OpenRun | null {
  return (stagingId && RUNS.get(stagingId)) || null;
}

/** Drop a run that has since completed. A finished run is not resumable. */
export function forgetRun(stagingId: string): void {
  RUNS.delete(stagingId);
}

/** Test seam only: the map is page state and a test is a page that never ends. */
export function forgetAllRuns(): void {
  RUNS.clear();
}

/**
 * Did this run stop part way?
 *
 * Read off the executor's own terminal state rather than off a step scan: the
 * org derives it and the page mirrors it. `in_progress` is the executor saying
 * the chain is still open, which after a returned call means it stopped.
 */
export function stoppedMidRun(outcome: ExecuteResult | null | undefined): boolean {
  if (!outcome) return false;
  return outcome.terminalState === "partial" || outcome.terminalState === "in_progress";
}

/**
 * Is this trail row an Executing staging row carrying a result id?
 *
 * The org's own pair, and the only thing that makes a row resumable. A row at
 * any other status either finished or never started.
 */
export function stoppedRunRow(row: ActionHistoryRow): boolean {
  return (row.status ?? "").toLowerCase() === "executing" && Boolean(row.resultRecordId);
}

/** The staging id inside a trail entry's id, which is minted as `exec-<id>`. */
export function stagingIdOf(entryId: string): string | null {
  return entryId.startsWith("exec-") ? entryId.slice(5) : null;
}
