/* =============================================================================
   THE CONFIRM DOCTRINE, IN ONE PLACE (A33.2.7 / A33.3.1 / A33.5.3).

   Two surfaces now carry the same gesture: the confirm gate, which every action
   but one still opens, and the governed-action stage (0.9.29), which
   `discard-version` opens instead. The doctrine between the press and the wire
   is identical on both and must never be two implementations that drift:

     - every suggestion that fed the plan is RECOMPUTED. A moved FIGURE blocks;
       a newer read with every figure unchanged is stated and does not.
     - the plan is validated against the transition allowlist, and a DELETE plan
       against the discard's own fence rather than the write allowlist.
     - a staged plan carrying a write-target record id means something already
       wrote, and the gesture is refused.
     - the SERVER's token from the staging result goes back out verbatim; the
       client-minted record is bookkeeping and never reaches the wire.
     - the wait is bounded and a bounded wait is NEVER a verdict: at
       EXECUTE_CLOCK_MS the surface says the org has not answered and the call
       keeps running behind it.

   THE HOOK OWNS THE GESTURE AND NOTHING ELSE. It renders nothing and decides no
   copy: each surface says what it says in its own register, off the same state.
   ============================================================================= */

import { useCallback, useMemo, useRef, useState } from "react";
import { useApp } from "../state/appState";
import { assertNoRecordIds, type StagedOutput } from "../actions/stagedPlan";
import {
  blockingDrift,
  computeSuggestions,
  detectDrift,
  isRecheckOnly,
  type DriftReason,
} from "../actions/suggestionEngine";
import { validateDiscardPlan, validatePlan } from "../actions/transitionAllowlist";
import { mintDecisionToken, type DecisionToken } from "../actions/decisionToken";
import {
  EXECUTE_CLOCK_MS,
  EXECUTION_HELD_COPY,
  executeAction,
  executionHeldReason,
  isExecutionHeld,
  isWriteAction,
  resolveApproverUserId,
  TRANSPORT_SENTENCE,
  type ExecuteResult,
  type ToolError,
} from "../channel/writeTools";
import { mcpAvailable } from "../channel/mcp";
import { resolveBundle } from "../actions/registry";
import { DISCARD_ACTION_ID } from "../actions/discardVersion";

export interface GovernedConfirmInput {
  plan: StagedOutput;
  actionId: string;
  /** True when the plan came from the NOT-LIVE adapter. */
  simulated: boolean;
  /** Stable across the stage/execute pair and across resume. */
  idempotencyKey?: string;
  /** THE READ THE SURFACE IS ON, so the recompute runs against the same one the
   *  cards were computed from. Absent means the surface never synced. */
  liveStoredAt?: number | null;
  liveSections?: string[];
  /** The instant that read is quoted at. Defaults to the baked assembly time. */
  asOf?: string;
  /** `note` is the surface's own sentence about HOW the filing was obtained. */
  onConfirmed: (token: DecisionToken, executed?: ExecuteResult, note?: string) => void;
}

export interface GovernedConfirm {
  /** Figures that moved under the plan. Non-null blocks the gesture. */
  drift: DriftReason[] | null;
  /** A newer read with every figure unchanged. Information, never a block. */
  rechecked: boolean;
  /** Allowlist violations, one per offending step. */
  violations: ReturnType<typeof validatePlan>;
  /** A33.5.3 record-id leaks in the staged plan. */
  idLeaks: string[];
  held: boolean;
  heldReason: string;
  /** Violations, leaks or a hold: the gesture may not be offered. */
  blocked: boolean;
  executing: boolean;
  /** The attempt now going out while the same key is re-asked. Zero when idle. */
  asking: number;
  /** True once the surface's own clock ran out on a call still in flight. */
  unsettled: boolean;
  toolError: ToolError | null;
  /** A refusal this surface raised before anything went out. */
  error: string | null;
  confirm: () => Promise<void>;
  /** Asking again under the SAME key: the one gesture that cannot file twice. */
  retry: () => void;
}

export function useGovernedConfirm({
  plan,
  actionId,
  simulated,
  idempotencyKey,
  liveStoredAt,
  liveSections,
  asOf,
  onConfirmed,
}: GovernedConfirmInput): GovernedConfirm {
  const { data, state } = useApp();
  const [drift, setDrift] = useState<DriftReason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [toolError, setToolError] = useState<ToolError | null>(null);
  const [unsettled, setUnsettled] = useState(false);
  const [asking, setAsking] = useState(0);
  /** WHICH GESTURE OWNS THE SCREEN. The clock leaves a call running behind the
   *  notice and a retry starts another under the same key. Both may answer;
   *  only the LATEST may settle, or a superseded ask would land over the one
   *  the banker is watching. */
  const run = useRef(0);

  const bundle = resolveBundle(data, state.accountId);

  /** A33.2.7 recomputation, in one place: the gesture runs it to decide, and
   *  the render runs it to say whether the read moved on underneath. */
  const recompute = useCallback(
    () =>
      detectDrift(
        plan.suggestions,
        computeSuggestions({ data, bundle, actionId, liveStoredAt, liveSections }),
        asOf ?? data.meta?.generatedAt ?? "",
      ),
    [plan.suggestions, data, bundle, actionId, liveStoredAt, liveSections, asOf],
  );

  const rechecked = useMemo(() => isRecheckOnly(recompute()), [recompute]);

  /* A33.3.1: the plan must be allowlisted before a gesture is offered at all.
     THE DISCARD IS VALIDATED AGAINST ITS OWN FENCE. The allowlist governs
     WRITES and refuses the renewal chain rows by name; a discard's whole job is
     to take them, in order, so a plan that deletes is held to the objects the
     frozen contract names instead. */
  const violations = useMemo(
    () => (actionId === DISCARD_ACTION_ID ? validateDiscardPlan(plan.steps) : validatePlan(plan.steps)),
    [plan.steps, actionId],
  );
  const idLeaks = useMemo(() => assertNoRecordIds(plan), [plan]);

  // LV06: the plan is real and staged, and there is no execute tool to run it.
  // The ORG's own verdict wins when it speaks.
  const held = plan.executionHeld === true || isExecutionHeld(actionId);
  const heldReason = plan.heldReason ?? executionHeldReason(actionId) ?? EXECUTION_HELD_COPY;
  const blocked = violations.length > 0 || idLeaks.length > 0 || held;

  const confirm = useCallback(async () => {
    setError(null);
    setToolError(null);
    setUnsettled(false);

    // A33.2.7, MANDATORY recompute. A plan is never executed against figures
    // the banker did not see. A moved FIGURE stops here; a newer timestamp over
    // identical figures is stated by the surface and does not.
    const moved = blockingDrift(recompute());
    if (moved.length > 0) {
      setDrift(moved);
      return;
    }
    setDrift(null);

    const userId = data.meta?.user;
    if (!userId) {
      setError("The confirmation must name the banker making it, and this view has no user.");
      return;
    }

    // The org checks this against the RUNNING IDENTITY before it will redeem
    // the token. A display name fails that check and nothing is written.
    const approverUserId = resolveApproverUserId(data.meta);

    // The SERVER mints the authoritative token at stage time and redeems it on
    // execute. The client record below is a cache of that fact.
    let record: DecisionToken;
    try {
      record = mintDecisionToken({ stagingId: plan.stagingId, planHash: plan.planHash, userId });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return;
    }

    // No live capability, or a simulated plan: record the confirmation and show
    // the run. Nothing executes, which is the fail-closed path.
    if (simulated || !mcpAvailable() || !isWriteAction(actionId)) {
      onConfirmed(record);
      return;
    }

    if (!approverUserId) {
      setError(
        "This view has no Salesforce user id for the signed-in identity, and the org will not file a record without one. The cockpit needs meta.userId staged before this can be confirmed.",
      );
      return;
    }

    const serverToken = plan.decisionToken;
    if (!serverToken) {
      setError(
        "This plan carries no confirmation token from the staging call, so it cannot be executed. Stage it again.",
      );
      return;
    }

    setExecuting(true);
    setAsking(0);
    const mine = ++run.current;

    const work = executeAction(
      actionId,
      {
        // Exactly the five fields Execute*.cls reads, each taken from the
        // staging result verbatim. The idempotency key is the STAGE key.
        idempotencyKey: idempotencyKey ?? plan.stagingId,
        stagingId: plan.stagingId,
        planHash: plan.planHash,
        decisionToken: serverToken,
        approverUserId,
      },
      {
        accountId: plan.accountId ?? state.accountId,
        onAttempt: (n) => {
          if (run.current === mine) setAsking(n);
        },
      },
    );

    const settle = (outcome: Awaited<typeof work>) => {
      if (run.current !== mine) return;
      setUnsettled(false);
      setAsking(0);
      if (!outcome.ok) {
        setToolError(outcome.error);
        return;
      }
      /* SAID ONCE, WHERE THE BANKER LANDS. A filing that took two asks, or that
         had to be read off the trail, is a different fact from one that
         answered first time. */
      const note = outcome.recovered
        ? `The answer never came back over the connector. This is Salesforce's own trail for ${outcome.result.stagingId}, read after ${outcome.attempts} asks.`
        : outcome.attempts > 1
          ? `Filed as ${outcome.result.recordName ?? outcome.result.stagingId} on the ${outcome.attempts === 2 ? "second" : "third"} ask.`
          : undefined;
      onConfirmed(record, outcome.result, note);
    };

    const fail = (e: unknown) => {
      if (run.current !== mine) return;
      setUnsettled(false);
      setAsking(0);
      /* THE ROOM'S SENTENCE LEADS AND THE PLATFORM'S CODE FOLLOWS. "request
         failed (502)" in critical ink over a write nobody has heard back about
         reads as a verdict and it is not one. The org's own refusals still lead
         with their own words, because those are answers. */
      const f = e as { code?: string; fix?: string; message?: string; said?: string };
      const platform = [f.code, f.message].filter(Boolean).join(": ");
      setToolError({
        code: f.code ?? "TRANSPORT",
        message: f.said ?? f.fix ?? f.message ?? TRANSPORT_SENTENCE,
        orgError: f.said ? platform : f.message && f.fix && f.message !== f.fix ? f.fix : undefined,
        resumable: true,
      });
    };

    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clock = new Promise<"clock">((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        resolve("clock");
      }, EXECUTE_CLOCK_MS);
    });

    try {
      const first = await Promise.race([work, clock]);
      if (first === "clock") {
        /* THE WAIT ENDS, THE CALL DOES NOT. The banker is told the truth, the
           org has not answered, and the execute keeps running behind it. */
        setUnsettled(true);
        work.then(settle, fail);
        return;
      }
      settle(first);
    } catch (e) {
      // A rejection that beat the clock. One that loses to it is handled by the
      // continuation above, so nothing is reported twice.
      if (!expired) fail(e);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      setExecuting(false);
    }
  }, [recompute, data.meta, plan, simulated, actionId, idempotencyKey, state.accountId, onConfirmed]);

  const retry = useCallback(() => {
    setToolError(null);
    void confirm();
  }, [confirm]);

  return {
    drift,
    rechecked,
    violations,
    idLeaks,
    held,
    heldReason,
    blocked,
    executing,
    asking,
    unsettled,
    toolError,
    error,
    confirm,
    retry,
  };
}
