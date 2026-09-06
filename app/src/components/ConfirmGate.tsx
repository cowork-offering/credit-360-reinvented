import { useCallback, useMemo, useState } from "react";
import { useApp } from "../state/appState";
import type { StagedOutput } from "../actions/stagedPlan";
import { SIMULATION_BANNER, assertNoRecordIds } from "../actions/stagedPlan";
import {
  RECHECK_LINE,
  blockingDrift,
  computeSuggestions,
  detectDrift,
  isRecheckOnly,
  type DriftReason,
} from "../actions/suggestionEngine";
import { packageFacilityCount } from "../actions/dealTicket";
import { validatePlan } from "../actions/transitionAllowlist";
import { mintDecisionToken, type DecisionToken } from "../actions/decisionToken";
import {
  EXECUTION_HELD_COPY,
  executeAction,
  executionHeldReason,
  isExecutionHeld,
  isWriteAction,
  resolveApproverUserId,
  type ExecuteResult,
  type ToolError,
} from "../channel/writeTools";
import { mcpAvailable } from "../channel/mcp";
import { STEP_TYPE_LABEL } from "../actions/tracker";
import { resolveBundle } from "../actions/registry";

/* =============================================================================
   THE CONFIRM GATE (A33.3.1)

   The confirm step is a STAGING SUMMARY, not a credit approval. The copy states
   what will be written, to which object, and what automation the write is
   expected to wake. It must never use "approve", "submit for credit approval",
   or any phrasing implying a credit decision, and it always ends with the fixed
   closing line.

   Before the gesture is offered:
     - every suggestion that fed the plan is RECOMPUTED (A33.2.7). Drift that
       moved a FIGURE blocks the confirm and the panel re-renders naming what
       moved, with a way forward: re-stage on the current data. A read that is
       merely newer, with every figure unchanged, is stated and does not block.
     - the plan is validated against the transition allowlist (A33.3.1).
     - warnings[] are surfaced, because a banker must see the side effects
       BEFORE confirming, not after.
   ============================================================================= */

/**
 * HOW LONG THE GATE WAITS BEFORE IT SAYS SO.
 *
 * `callTool` bounds a write at WRITE_DEADLINE_MS (60s) and stamps the result
 * AMBIGUOUS, which is correct at the transport but arrives too late and in the
 * wrong clothes: the gate rendered it as "This did not go through", in critical
 * ink, over a write that may well have landed. Filing it a second time is the
 * one mistake this cockpit cannot undo from here.
 *
 * So the gate keeps its own, shorter clock. At 45 seconds it stops making the
 * banker watch a spinner and says what is actually true, the org has not
 * answered, and nobody knows yet. IT DOES NOT CANCEL THE CALL: the execute is
 * still running, and if it answers a moment later the gate takes that answer
 * and replaces the notice with it. A page clock is a limit on WAITING, never a
 * verdict on the write.
 */
export const EXECUTE_CLOCK_MS = 45_000;

/** What the banker is told while nobody knows. Never the word failed. */
export const UNSETTLED_TITLE = "The org has not answered yet";
export const UNSETTLED_BODY =
  `This has been running for ${Math.round(EXECUTE_CLOCK_MS / 1000)}s and the org has not come back. ` +
  "It may still land: nothing has said it failed. Check the record in Salesforce before staging this " +
  "again, filing it twice is the one thing that cannot be undone from here.";

/** The fixed closing line. Not a variant, not a template. */
export const CLOSING_LINE = "Real approval happens in Salesforce's credit-risk process.";

/** Vocabulary the summary may never contain (A33.3.1). */
export const FORBIDDEN_GATE_WORDS = ["approve", "approval of", "submit for credit approval", "authorise credit", "credit decision"];

/** The label on the way out of a blocked gate. Named once so the copy and the
 *  test that guards it cannot drift apart. */
export const RESTAGE_LABEL = "Refresh figures and re-stage";

/**
 * WHAT MOVED, AND THE WAY FORWARD.
 *
 * The notice used to end at "review the new figures and confirm again", which
 * on a blocked gate is an instruction with nothing behind it: the plan holds
 * the figures it was staged with, so confirming again recomputes the same
 * divergence and refuses again. The banker is standing in a dead end.
 *
 * `onRestage` is the exit. It re-runs the SAME staging call with the SAME
 * inputs against the current data and replaces the stale plan in place; the
 * banker then confirms the fresh one. It never executes anything.
 */
function DriftNotice({ drift, onRestage }: { drift: DriftReason[]; onRestage?: () => void }) {
  return (
    <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--warning-bg)" }}>
      <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
        The figures moved
      </div>
      <ul className="mt-1.5 space-y-1">
        {drift.map((d, i) => (
          <li key={i} className="text-[12px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
            {d.kind === "value_moved" && `${d.figure} was ${d.was}, now ${d.now}.`}
            {d.kind === "policy_changed" && `The bank policy pack changed from ${d.was} to ${d.now}.`}
            {d.kind === "data_replaced" && "The staged data was replaced after this plan was built."}
            {d.kind === "suggestion_vanished" && `The ${d.suggestionId} finding no longer applies.`}
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[11.5px]" style={{ color: "var(--warning-prose)" }}>
        {onRestage
          ? "This plan was built on the earlier figures, so it cannot be confirmed. Re-stage it on the current data and confirm the plan that comes back. Nothing runs against numbers you did not see."
          : "Review the new figures and confirm again. Nothing runs against numbers you did not see."}
      </div>
      {onRestage && (
        <button
          type="button"
          onClick={onRestage}
          className="c360-btn mt-2.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {RESTAGE_LABEL}
        </button>
      )}
    </div>
  );
}

export function ConfirmGate({
  plan,
  actionId,
  simulated,
  idempotencyKey,
  liveStoredAt,
  liveSections,
  asOf,
  onRestage,
  onConfirmed,
  onBack,
}: {
  plan: StagedOutput;
  actionId: string;
  /** True when the plan came from the NOT-LIVE adapter. */
  simulated: boolean;
  /** Stable across the stage/execute pair and across resume. */
  idempotencyKey?: string;
  /** THE READ THE PANEL IS ON, threaded so the gate recomputes against the same
   *  one the cards were computed from. Without these the gate recomputed on the
   *  BAKED bundle while the plan carried live-merged figures, which reported a
   *  move backwards to stale numbers on every synced ticket. Absent means the
   *  surface never synced, which is the test case. */
  liveStoredAt?: number | null;
  liveSections?: string[];
  /** The instant that read is quoted at. Defaults to the baked assembly time. */
  asOf?: string;
  /** Re-runs the staging call on the current data with the same inputs and
   *  replaces this plan. The only way out of a blocked gate; never executes. */
  onRestage?: () => void;
  onConfirmed: (token: DecisionToken, executed?: ExecuteResult) => void;
  onBack: () => void;
}) {
  const { data, state } = useApp();
  const [drift, setDrift] = useState<DriftReason[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [toolError, setToolError] = useState<ToolError | null>(null);
  /** True once the gate's own clock has run out on a call still in flight. */
  const [unsettled, setUnsettled] = useState(false);

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

  /** A newer read with every figure unchanged. Informational, never a block. */
  const rechecked = useMemo(() => isRecheckOnly(recompute()), [recompute]);

  // A33.3.1 — the plan must be allowlisted before a gesture is offered at all.
  const violations = useMemo(() => validatePlan(plan.steps), [plan.steps]);
  // A33.5.3 — a staged plan carrying a record id means something already wrote.
  const idLeaks = useMemo(() => assertNoRecordIds(plan), [plan]);

  // LV06: the plan is real and staged, and there is no execute tool to run it.
  // The ORG's own verdict wins when it speaks: `executionHeld` + `heldReason`
  // come back on the observed stage response, and the reason is rendered
  // verbatim rather than restated from our own copy.
  const held = plan.executionHeld === true || isExecutionHeld(actionId);
  // The ORG's reason when it gives one, else THIS action's own reason: LV06 and
  // a founder gate are different facts and must not borrow each other's words.
  const heldReason = plan.heldReason ?? executionHeldReason(actionId) ?? EXECUTION_HELD_COPY;
  const blocked = violations.length > 0 || idLeaks.length > 0 || held;
  /** A package-anchored plan over SEVERAL facilities. Drives the plural copy
   *  below: "the new facility" is wrong when the plan clones four of them. */
  const multi = (plan.facilities?.length ?? 0) > 1;
  /** How many members the deal HAS, so the plan's member count is stated as a
   *  selection out of it rather than as a bare figure a banker can read as the
   *  package's own size. Zero means the read cannot place the package. */
  const dealSize = packageFacilityCount(bundle, plan.productPackageId);

  async function confirm() {
    setError(null);
    setToolError(null);
    setUnsettled(false);

    // A33.2.7 — MANDATORY recompute. A plan is never executed against figures
    // the banker did not see. A moved FIGURE stops here; a newer timestamp over
    // identical figures is stated above and does not.
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
    // the token. A display name fails that check and nothing is written, so
    // the gesture stops here rather than producing a generic tool failure.
    const approverUserId = resolveApproverUserId(data.meta);

    // The SERVER mints the authoritative token at stage time and redeems it on
    // execute. The client record below is a cache of that fact, exactly as the
    // tracker's step state is a cache of the staging record (A33.3.3).
    let record: DecisionToken;
    try {
      record = mintDecisionToken({ stagingId: plan.stagingId, planHash: plan.planHash, userId });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return;
    }

    // No live capability, or a simulated plan: record the confirmation and show
    // the tracker. Nothing executes, which is the fail-closed path.
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

    // The SERVER token from the staging result, verbatim. The client-minted
    // record above is a bookkeeping cache and must never reach the wire.
    const serverToken = plan.decisionToken;
    if (!serverToken) {
      setError(
        "This plan carries no confirmation token from the staging call, so it cannot be executed. Stage it again.",
      );
      return;
    }

    setExecuting(true);

    const work = executeAction(actionId, {
      // Exactly the five fields Execute*.cls reads, each taken from the
      // staging result verbatim. The idempotency key is the STAGE key: that
      // pairing is what the proven Apex round trip used.
      idempotencyKey: idempotencyKey ?? plan.stagingId,
      stagingId: plan.stagingId,
      planHash: plan.planHash,
      decisionToken: serverToken,
      approverUserId,
    });

    /** The org's answer, whenever it comes, and whichever way it goes. Named
     *  because the clock below hands the SAME function to a late answer. */
    const settle = (outcome: Awaited<typeof work>) => {
      setUnsettled(false);
      if (!outcome.ok) {
        setToolError(outcome.error);
        return;
      }
      onConfirmed(record, outcome.result);
    };

    const fail = (e: unknown) => {
      setUnsettled(false);
      // The org's own words first. The platform's generic "ran the tool but
      // reported a failure" hid a precondition refusal for a whole live test
      // session, so the raw message and code lead and the fix copy follows.
      const f = e as { code?: string; fix?: string; message?: string };
      setToolError({
        code: f.code ?? "TRANSPORT",
        message: f.message ?? f.fix ?? String(e),
        orgError: f.message && f.fix && f.message !== f.fix ? f.fix : undefined,
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
           org has not answered, and the execute keeps running behind it. When
           it lands, this replaces the notice with the real outcome. */
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
  }

  return (
    <div className="flex flex-col">
      {simulated && (
        <div className="border-b border-divider px-5 py-2 text-[11px] font-semibold" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>
          {SIMULATION_BANNER}
        </div>
      )}

      <div className="border-b border-divider px-5 py-4">
        <div className="kicker mb-1.5">What will happen</div>
        <p className="text-[13px] leading-relaxed text-ink">{plan.summary}</p>
      </div>

      {/* A SYNC LANDED UNDER THIS PLAN AND MOVED NOTHING. Stated, because the
          banker who ran that sync is owed the result of the recheck — and
          stated as information, because there is nothing here to act on. */}
      {rechecked && !drift && (
        <div className="border-b border-divider px-5 py-3 text-[11.5px] leading-relaxed text-ink-muted">
          {RECHECK_LINE}
        </div>
      )}

      {/* PACKAGE-ANCHORED CREDIT ACTION. The org returned one plan over N
          facilities, so the gate shows what each facility gets rather than
          leaving the banker to count step ids. Rendered only for a real batch:
          with one facility the summary already names it. */}
      {multi && (
        <div className="border-b border-divider px-5 py-4">
          <div className="kicker mb-2">
            {dealSize >= plan.facilities!.length
              ? `${plan.facilities!.length} of ${dealSize} facilities in this credit action`
              : `${plan.facilities!.length} facilities in this credit action`}
          </div>
          <ul className="space-y-2.5">
            {plan.facilities!.map((f) => (
              <li key={f.facilityId}>
                <div className="text-[12.5px] font-semibold text-ink">{f.facilityName ?? f.facilityId}</div>
                {[f.creditActionStepId, f.verifyStepId, f.applyStepId].some(Boolean) && (
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    {[f.creditActionStepId, f.verifyStepId, f.applyStepId].filter(Boolean).join(" · ")}
                  </div>
                )}
                {typeof f.covenantCarryoverCount === "number" && (
                  <div className="text-[11px] text-ink-muted">
                    {f.covenantCarryoverCount === 0
                      ? "No loan-level covenants would carry over."
                      : `${f.covenantCarryoverCount} loan-level ${f.covenantCarryoverCount === 1 ? "covenant carries" : "covenants carry"} over.`}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {/* The whole point of the facilityIds shape, said plainly. */}
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-muted">
            One plan, one confirmation and one decision token cover all of them. Each facility carries its own
            steps, so a failure on one is reported against that facility and does not discard the others.
          </p>
        </div>
      )}

      {/* PACKAGE-SCOPED COVENANT REVIEW. One plan over N covenants, and a
          refusal is per covenant. Every covenant the plan touched is listed —
          planned and refused alike — with the org's own reason verbatim, so a
          banker who assessed six and gets four written learns which two did not
          and why, BEFORE confirming rather than after. */}
      {(plan.covenants?.length ?? 0) > 0 && (
        <div className="border-b border-divider px-5 py-4">
          <div className="kicker mb-2">
            {plan.covenants!.length} {plan.covenants!.length === 1 ? "covenant" : "covenants"} in this plan
            {typeof plan.scopeCount === "number" ? ` · ${plan.scopeCount} in the package` : ""}
          </div>
          <ul className="space-y-2.5">
            {plan.covenants!.map((c) => {
              const refused = c.state !== undefined && c.state !== "planned";
              return (
                <li key={c.covenantId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-ink">{c.covenantName ?? c.covenantId}</span>
                    <span
                      className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                      style={
                        refused
                          ? { background: "var(--warning-bg)", color: "var(--warning)" }
                          : { background: "var(--accent-wash)", color: "var(--accent)" }
                      }
                    >
                      {refused ? "not written" : (c.assessedStatus ?? "planned")}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    {[
                      c.covenantType,
                      c.attachment ? `${c.attachment}-level` : null,
                      c.currentComplianceStatus ? `compliance row at ${c.currentComplianceStatus}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {/* The steps below that belong to THIS covenant. A ten-step
                      plan over three covenants is otherwise unattributed. */}
                  {[c.writeStepId, c.statusStepId, c.verifyStepId, c.generationStepId].some(Boolean) && (
                    <div className="text-[11px] text-ink-muted">
                      {[c.writeStepId, c.statusStepId, c.verifyStepId, c.generationStepId].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {/* The org's sentence, verbatim. It carries the reason a row
                      is refused AND, under allowNonPending, what will not
                      happen when it is written anyway. */}
                  {c.reason && (
                    <div className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
                      {c.reason}
                    </div>
                  )}
                  {c.generatesNextRow === true && (
                    <div className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
                      This covenant is Active with a Frequency Template and an Effective Date, the combination Salesforce
                      uses to mint the next compliance record on a complete status. Execution measures whether it did.
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {typeof plan.refusedCount === "number" && plan.refusedCount > 0 && (
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-muted">
              {plan.assessedCount ?? 0} of {(plan.assessedCount ?? 0) + plan.refusedCount} assessed covenants will be
              written. The rest are reported with a reason each and nothing about them is changed.
            </p>
          )}
        </div>
      )}

      {/* The plan, step by step, with types visually distinct. */}
      <div className="border-b border-divider px-5 py-4">
        <div className="kicker mb-2">The plan</div>
        <ol className="space-y-2">
          {plan.steps.map((s, i) => (
            <li key={s.id} className="flex gap-2.5">
              <span className="mt-0.5 w-5 flex-none text-[11px] font-bold text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-[5px] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                    style={
                      s.type === "write"
                        ? { background: "var(--accent-wash)", color: "var(--accent)" }
                        : s.type === "verification"
                          ? { background: "var(--positive-bg)", color: "var(--positive)" }
                          : s.type === "wait"
                            ? { background: "var(--warning-bg)", color: "var(--warning)" }
                            : s.type === "handoff"
                              ? { background: "var(--user-tone-wash)", color: "var(--user-tone)" }
                              : { background: "var(--wash-2)", color: "var(--ink-muted)" }
                    }
                  >
                    {STEP_TYPE_LABEL[s.type]}
                  </span>
                  <span className="text-[12.5px] font-medium text-ink">{s.label}</span>
                </span>
                {(s.automationWoken?.length ?? 0) > 0 && (
                  <span className="mt-0.5 block text-[11px] text-ink-muted">
                    Wakes: {s.automationWoken!.join("; ")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* A33.5.3 — warnings are seen BEFORE the gesture, never after. */}
      {plan.warnings.length > 0 && (
        <div className="border-b border-divider px-5 py-4">
          <div className="kicker mb-2">Before you confirm</div>
          <ul className="space-y-1.5">
            {plan.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-ink-body">
                <span className="mt-[7px] h-1 w-1 flex-none rounded-full" style={{ background: "var(--warning)" }} />
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <div className="border-b border-divider px-5 py-4">
          <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--critical-bg)" }}>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--critical)" }}>
              This plan cannot be confirmed
            </div>
            <ul className="mt-1.5 space-y-1">
              {violations.map((v, i) => (
                <li key={`v${i}`} className="text-[12px] leading-relaxed" style={{ color: "var(--critical)" }}>
                  Step {v.stepId}: {v.reason}
                </li>
              ))}
              {idLeaks.map((v, i) => (
                <li key={`l${i}`} className="text-[12px] leading-relaxed" style={{ color: "var(--critical)" }}>
                  {v}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {held && (
        <div className="border-b border-divider px-5 py-4">
          <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--warning-bg)" }}>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
              Staged, not filed
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
              {heldReason}
            </p>
          </div>
        </div>
      )}

      {typeof plan.covenantCarryoverCount === "number" && (
        <div className="border-b border-divider px-5 py-3 text-[11.5px] leading-relaxed text-ink-muted">
          {plan.covenantCarryoverCount === 0
            ? `No loan-level covenants are attached to ${multi ? "these facilities" : "this facility"}, so nothing would carry over.`
            : `${plan.covenantCarryoverCount} loan-level ${plan.covenantCarryoverCount === 1 ? "covenant carries" : "covenants carry"} over to the new ${multi ? "facilities" : "facility"}.`}
        </div>
      )}

      {drift && (
        <div className="border-b border-divider px-5 py-4">
          <DriftNotice drift={drift} onRestage={onRestage} />
        </div>
      )}

      {/* NOBODY KNOWS YET, AND THAT IS ITS OWN STATE. Warning ink, not critical:
          critical is what the cockpit uses when the org has said no, and the
          org has said nothing at all. A banker who reads "did not go through"
          over a write that landed files it again, and a duplicated facility is
          not something this page can take back. */}
      {unsettled && (
        <div className="border-b border-divider px-5 py-4" data-unsettled="1">
          <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--warning-bg)" }}>
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
              {UNSETTLED_TITLE}
            </div>
            <div className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--warning-prose)" }}>
              {UNSETTLED_BODY}
            </div>
          </div>
        </div>
      )}

      {toolError && (
        <div className="border-b border-divider px-5 py-4">
          <div className="rounded-[10px] px-3.5 py-3" style={{ background: "var(--critical-bg)" }}>
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
              <div className="mt-1 font-mono text-[10.5px] leading-relaxed" style={{ color: "var(--critical)" }}>
                {toolError.orgError}
              </div>
            )}
            {toolError.resumable === false && (
              <div className="mt-1 text-[11.5px]" style={{ color: "var(--critical)" }}>
                Nothing was written. Adjust the details and stage it again.
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="border-b border-divider px-5 py-3 text-[12px]" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      <div className="px-5 py-4">
        <p className="text-[11.5px] leading-relaxed text-ink-muted">{CLOSING_LINE}</p>
      </div>

      <div className="flex items-center gap-2 border-t border-divider px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="c360-press rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink"
        >
          Back
        </button>
        <div className="flex-1" />
        <button
          type="button"
          // A blocked gate with a re-stage affordance offers ONE way forward.
          // Leaving Confirm live beside it would recompute the same divergence
          // and refuse again, which is the dead end this pass removes.
          disabled={blocked || executing || Boolean(drift && onRestage)}
          onClick={() => void confirm()}
          className="c360-btn rounded-md px-3.5 py-1.5 text-[12px] font-semibold disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          {held ? "Filing is on hold" : executing ? "Working…" : drift ? "Confirm the new figures" : simulated ? "Confirm" : "Confirm and file"}
        </button>
      </div>
    </div>
  );
}
