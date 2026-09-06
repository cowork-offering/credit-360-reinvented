/* =============================================================================
   WAITING OUT A FILING WHOSE ANSWER WAS LOST.

   THE DEFECT, LIVE 2026-09-03 12:15. A modification carrying a net-new facility
   was approved from the room. The connector's invocation timeout is shorter than
   that execute's wall time, so the room got "Timeout while invoking the tool
   ExecuteLoanModification" and told the banker the filing MIGHT have completed
   and not to approve again. It had completed: package version a5Fbb000000J61hEAC
   at 12:15:22, six clones at 12:15:26, the new facility a4Zbb000002ICRNEA4 at
   12:15:39, the run finished at 12:16:05. Fifty-five seconds from token to done.

   A ROOM THAT CANNOT SEE THE ANSWER IS NOT A ROOM THAT DOES NOT KNOW. The org
   holds the answer on the staging record the whole time, and `Customer360ActionHistory`
   reads it. So the room stops guessing and waits.

   WHAT IT WAITS FOR IS A TERMINAL STATUS, and `Executing` is not one: consuming
   the decision token sets it, and the engine hop's interim write leaves it there
   while the arm hop is still writing. A poller that settled on Executing would
   land the executed card over a run half done.

   WHAT IT DOES NOT DO IS DECIDE. It reports which of the two things happened and
   the room does the rest — because the thing the room does next is call the SAME
   execute again under the SAME idempotency key, and that is a gesture the room
   owns rather than one a helper should make on its behalf. That second call is
   not a retry: the Apex answers it off the staging record before any check runs.
   Measured live at 0.27s over three consecutive calls, zero rows written.

   THE 90s BUDGET. The longest modification this org has recorded ran 156s and
   most run under 30. Ninety covers the shape the demo files with room to spare;
   past it the room says so rather than spinning, and the banker asks again with
   a chip that re-enters HERE, never at the approval.
   ============================================================================= */

import { readActionState } from "../../channel/cockpitTools";
import type { ActionHistoryRow } from "../../data/contract";

/** How often the room asks the org, and for how long. */
export const POLL_EVERY_MS = 3_000;
export const POLL_BUDGET_MS = 90_000;

/**
 * THE OTHER BUDGET: CONFIRMING A FILING THAT ALREADY ANSWERED.
 *
 * `POLL_BUDGET_MS` is the room waiting for an outcome it does not have, and
 * ninety seconds of that is right because there is nothing else to do. This one
 * is the sheet asking the org to CONFIRM figures it is already showing, behind a
 * surface the banker is already reading. Nothing waits on it, so the honest
 * budget is short: four polls, and then the sheet says the org has not answered
 * rather than carrying "pending" for a minute and a half.
 */
export const CONFIRM_BUDGET_MS = 12_000;

/** The one line the room says while it waits. Quiet, present tense, no alarm:
 *  the filing is happening, and nothing is being asked of the banker. */
export const FILING_IN_FLIGHT = "Filing in progress, nCino is still writing.";

/** The honest line when the budget runs out. It claims nothing either way, and
 *  it never offers the approval again. */
export const STILL_WRITING =
  "The org has not finished this filing yet, and I will not claim an outcome I cannot read. " +
  "Nothing needs approving again: the plan is with the org under a token that is already spent. " +
  "Ask me to check it whenever you like and I will read the record.";

/** The org read a terminal FAILURE back. Its own fact, said as its own fact
 *  rather than folded into the timeout copy. */
export const FILED_FAILED =
  "The org reports this filing as failed, so there is no executed record to show. " +
  "Nothing needs approving again: the staging record holds exactly how far the run got.";

/** The statuses `cm_Action_Staging__c` only reaches once the run is over. */
const TERMINAL = new Set(["Completed", "Partial", "Failed"]);

export interface SettleDeps {
  /** One fresh read of this run's row on the durable trail. Undefined while the
   *  row is not visible yet, which is a state and not an error. */
  readState: (accountId: string, stagingId: string) => Promise<ActionHistoryRow | undefined>;
  /** Injected so a test does not spend ninety real seconds waiting. */
  wait: (ms: number) => Promise<void>;
  /** Injected so the budget is measured rather than counted in ticks. */
  now: () => number;
  /** How long to wait before giving up. {@link POLL_BUDGET_MS} where the caller
   *  says nothing, which is the room waiting out a lost answer. */
  budgetMs?: number;
}

/** The live wait: the org's own trail, and the wall clock. */
export const LIVE_SETTLE: SettleDeps = {
  readState: readActionState,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export type Settlement =
  /** The run is over. `status` is the org's own word for how it ended. */
  | { kind: "terminal"; status: string }
  /** The token was never redeemed, so nothing ran. The refusal the room already
   *  holds is the whole truth and it should say it. */
  | { kind: "never-ran" }
  /** The budget ran out with the org still writing, or the trail unreadable. */
  | { kind: "unsettled" };

/** How many consecutive `Staged` reads before the room believes nothing ran.
 *
 *  ONE IS NOT ENOUGH. `Staged` is also the row's state for the moment between
 *  the outer leg's callout and the inner leg claiming the token, so a single
 *  read can catch a real dispatch mid-flight. Two, six seconds apart, cannot:
 *  the inner leg claims in its opening statements. */
const STAGED_BEFORE_BELIEVED = 2;

/**
 * Wait until the org's staging record answers, one way or the other.
 *
 * TWO ANSWERS END THE WAIT, and they are both answers rather than guesses. The
 * row goes terminal, which means the run finished; or the row reads `Staged`
 * twice running, which means the decision token was never redeemed and nothing
 * ran at all — `claimForExecute` stamps the token and moves the row to
 * `Executing` in the same breath, so a run that started can never read Staged.
 *
 * Never throws. A trail read that fails is treated exactly like a trail read
 * that has not seen the row yet: one unreachable poll is not evidence about a
 * filing, and the org remains the authority on what it did.
 */
export async function awaitFiling(accountId: string, stagingId: string, deps: SettleDeps): Promise<Settlement> {
  const deadline = deps.now() + (deps.budgetMs ?? POLL_BUDGET_MS);
  let staged = 0;

  while (deps.now() < deadline) {
    // The wait comes FIRST. The answer was lost a moment ago, not a minute ago,
    // and a read fired on the same tick as the timeout would only ever catch the
    // engine hop mid-flight.
    await deps.wait(POLL_EVERY_MS);

    let row: ActionHistoryRow | undefined;
    try {
      row = await deps.readState(accountId, stagingId);
    } catch {
      continue;
    }
    if (row?.status && TERMINAL.has(row.status)) return { kind: "terminal", status: row.status };

    // A row that is not visible yet is silence, not evidence. Only the org
    // SAYING Staged counts against a run having started.
    staged = row?.status === "Staged" ? staged + 1 : 0;
    if (staged >= STAGED_BEFORE_BELIEVED) return { kind: "never-ran" };
  }

  return { kind: "unsettled" };
}
