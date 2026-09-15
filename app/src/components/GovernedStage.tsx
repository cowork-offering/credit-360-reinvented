import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Portal } from "./Portal";
import { useApp } from "../state/appState";
import { prefersReducedMotion } from "../data/motion";
import type { StagedOutput } from "../actions/stagedPlan";
import { SIMULATION_BANNER } from "../actions/stagedPlan";
import type { DecisionToken } from "../actions/decisionToken";
import { ASKING_AGAIN, toolErrorCopy, type ExecuteResult } from "../channel/writeTools";
import { CLOSING_LINE, UNSETTLED_BODY, UNSETTLED_TITLE } from "./ConfirmGate";
import { useGovernedConfirm } from "./governedConfirm";
import {
  closingSentences,
  groupOutcome,
  observedSentences,
  stageGroups,
  verifiedLine,
  type StageGroup,
} from "../actions/stageModel";
import { RESUME_LABEL, RESUME_LINE, type OpenRun } from "../actions/resumeRun";
import "../styles/stage.css";

/* =============================================================================
   THE GOVERNED-ACTION STAGE (0.9.29, backlog row 65).

   knowledge/DESIGN-0.9.29-ROLLBACK-STAGE.md, gated on the option built from the
   live Sunbelt plan: `preview-site/builds/stage-0929-option/`. That prototype's
   motion, layout and copy are the spec and this is the port of them.

   A STAGE, NOT A ROOM. The relationship stays behind the glass and RECEDES;
   there is no modal chrome and no dark scrim, which is the whole difference
   between this and the confirm gate it replaces. No thread, no composer, no
   chips, no rails, nothing the action does not need.

   THREE BEATS ON ONE SURFACE:
     plan     the title, the org's own count line, and one row per write group
              in the org's order, expandable to its exact strings and reasons.
     confirm  one recording line naming the banker, and one ink commit pill
              (rule 27/41: the commit moment is ink, never violet, and this is
              the ONE control on the stage that is not in the glass register).
     run      the same rows. The group being written carries the filling ">" at
              the beat; on its verification it settles for one beat and then
              dissolves, and the rows below hold their place until it is gone.
              The page empties as the version leaves the org, and what remains
              is the closing, typed one sentence at a time.

   THE RUN IS A REVEAL, AND THE REVEAL IS PRESENTATION ONLY (the same doctrine
   as StepTracker's). `execute_*` is one call that returns every step's settled
   state; nothing here polls and no row ever shows a state the executor did not
   return. What the reveal changes is the PACE at which those settled states are
   read, so the banker watches the version leave instead of being handed a wall.

   A STOP LEAVES THE PAGE STANDING. The refused group keeps its place with the
   org's own words under it, every row after it says it was never attempted, and
   the resume control sits beneath them with the room's two doors (row 64).

   REDUCED MOTION REACHES THE SAME ENDING. No fill, no dissolve, no typing: the
   list is empty, the closing is complete and the doors are there, in one
   commit. That is also what every jsdom test sees.
   ============================================================================= */

/** The clock. Every beat is the prototype's own number. */
const T = {
  toFirst: 560,
  /** 620ms for an empty group, 1250ms for a group of seven. */
  writeBase: 620,
  writePer: 90,
  /** The row settles for one beat before it goes. */
  verifyHold: 340,
  dissolve: 560,
  /** A row that was written but not proven holds instead of dissolving. */
  keptHold: 620,
  toClose: 420,
  typeChar: 27,
  /** However long a sentence is, it lands inside this. The org's closing
   *  sentences are its own and can run to a hundred and fifty characters; at a
   *  flat 27ms each that is four seconds of watching a line arrive. */
  typeMax: 1300,
  typeMin: 400,
  saidPause: 460,
  afterAt: 520,
} as const;

/** The list says at its edge when it has more under it. */
function useScrollMask(deps: unknown[]): (el: HTMLUListElement | null) => void {
  const ref = useRef<HTMLUListElement | null>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollHeight - el.clientHeight > 2) el.setAttribute("data-scroll", "");
    else el.removeAttribute("data-scroll");
  }, []);
  useEffect(measure, [measure, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return useCallback(
    (el: HTMLUListElement | null) => {
      ref.current = el;
      if (el) {
        el.addEventListener("scroll", measure);
        measure();
      }
    },
    [measure],
  );
}

type RowState = "queued" | "writing" | "verified" | "leaving" | "gone" | "kept" | "stopped" | "skipped";
type Phase = "plan" | "run" | "close" | "stopped";

export interface GovernedStageProps {
  plan: StagedOutput;
  actionId: string;
  /** The action in banker words, e.g. "Discard the version <name>". The book
   *  names the target; the stage never derives a name from a plan string. */
  title: string;
  /** Short banker titles per org object. An object it does not name renders off
   *  its API name rather than not at all. */
  objectTitles?: Record<string, string>;
  /** The word on the commit pill, e.g. "Discard this version". */
  commitLabel: string;
  simulated: boolean;
  idempotencyKey?: string;
  liveStoredAt?: number | null;
  liveSections?: string[];
  asOf?: string;
  /** A run this page already made that stopped part way. The stage opens on its
   *  stop scene rather than on the plan: the plan is frozen and already
   *  confirmed, and the only gesture left is the resume. */
  resume?: OpenRun | null;
  /** The org address to offer when the run STOPPED: the thing that is still
   *  there, which the banker may need to clear by hand. */
  stopDoor?: ReactNode;
  /** The org address to offer when the action COMPLETED. A different record
   *  entirely: what the run removed cannot be opened, and offering a link to it
   *  is the one dishonest thing this scene could do. */
  closeDoor?: ReactNode;
  /** What "back" is called, e.g. "Back to Sunbelt Hospitality Group Inc". */
  backLabel: string;
  onConfirmed: (token: DecisionToken, executed?: ExecuteResult, note?: string) => void;
  /** The sheet folds back into the relationship and the stage closes. */
  onClose: () => void;
}

export function GovernedStage({
  plan,
  actionId,
  title,
  objectTitles,
  commitLabel,
  simulated,
  idempotencyKey,
  liveStoredAt,
  liveSections,
  asOf,
  resume,
  stopDoor,
  closeDoor,
  backLabel,
  onConfirmed,
  onClose,
}: GovernedStageProps) {
  const { data } = useApp();
  const reduced = prefersReducedMotion();
  const groups = useMemo(() => stageGroups(plan, objectTitles), [plan, objectTitles]);

  const [phase, setPhase] = useState<Phase>(resume ? "stopped" : "plan");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const [fills, setFills] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  const [typing, setTyping] = useState(-1);
  const [afterOn, setAfterOn] = useState(false);
  const [stopDetail, setStopDetail] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ExecuteResult | null>(resume?.outcome ?? null);

  /** The banker this page is signed in as, as the page names people. */
  const approver = resume?.approver ?? data.meta?.user ?? null;

  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const sheetRef = useRef<HTMLElement | null>(null);
  const at = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  const stopClock = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    cancelAnimationFrame(raf.current);
  }, []);
  useEffect(() => stopClock, [stopClock]);

  /* THE GESTURE, AND THE DOCTRINE BEHIND IT, ARE THE CONFIRM GATE'S. The
     recompute, the allowlist, the id fence, the server token and the bounded
     wait all run exactly as they do on the gate; this surface only decides what
     it says and when it moves. */
  const gate = useGovernedConfirm({
    plan,
    actionId,
    simulated,
    idempotencyKey,
    liveStoredAt,
    liveSections,
    asOf,
    onConfirmed: (token, executed, note) => {
      setOutcome(executed ?? null);
      onConfirmed(token, executed, note);
    },
  });

  const listRef = useScrollMask([phase, rows]);

  /* ------------------------------------------------------------- the beats */

  const closing = useCallback(() => {
    setPhase("close");
    const lines = closingSentences(plan, groups, outcome?.steps ?? []);
    if (reduced) {
      setSaid(lines);
      setTyping(-1);
      setAfterOn(true);
      return;
    }
    setSaid(lines.map(() => ""));
    let delay = 360;
    lines.forEach((text, i) => {
      const span = Math.min(T.typeMax, Math.max(T.typeMin, text.length * T.typeChar));
      const per = span / Math.max(1, text.length);
      at(delay, () => {
        setTyping(i);
        for (let c = 1; c <= text.length; c++) {
          at(delay + c * per - delay, () => setSaid((prev) => prev.map((v, j) => (j === i ? text.slice(0, c) : v))));
        }
      });
      delay += 360 + span + T.saidPause;
    });
    at(delay - T.saidPause + T.afterAt, () => {
      setTyping(-1);
      setAfterOn(true);
    });
  }, [plan, groups, outcome, reduced, at]);

  /** The org refused this group: the run ends here and nothing after it ran. */
  const stopped = useCallback(
    (index: number, detail: string | undefined, steps: readonly { id: string; state?: string; detail?: string }[]) => {
      setRows((prev) => {
        const next = { ...prev };
        next[groups[index].id] = "stopped";
        for (let j = index + 1; j < groups.length; j++) next[groups[j].id] = "skipped";
        return next;
      });
      setDetails((prev) => {
        const next = { ...prev, [groups[index].id]: "The org stopped the chain here." };
        for (let j = index + 1; j < groups.length; j++) {
          next[groups[j].id] = steps.find((s) => s.id === groups[j].id)?.detail ?? "Not attempted.";
        }
        return next;
      });
      setStopDetail(detail ?? null);
      setPhase("stopped");
      setSaid(["The org refused this group."]);
      setTyping(-1);
      setAfterOn(true);
    },
    [groups],
  );

  /** The ">" fills with brand ink over the group's own write. It never travels
   *  and nothing else on the sheet moves while it does. */
  const fill = useCallback((id: string, ms: number, done: () => void) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setFills((prev) => ({ ...prev, [id]: p }));
      if (p < 1) raf.current = requestAnimationFrame(step);
      else done();
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  const runGroup = useCallback(
    (i: number, steps: readonly { id: string; state?: string; detail?: string }[]) => {
      if (i >= groups.length) {
        at(T.toClose, closing);
        return;
      }
      const g = groups[i];
      const ended = groupOutcome(g, steps);
      setRows((prev) => ({ ...prev, [g.id]: "writing" }));
      setDetails((prev) => ({ ...prev, [g.id]: g.label }));

      fill(g.id, T.writeBase + T.writePer * g.count, () => {
        if (ended.outcome === "stopped") {
          stopped(i, ended.detail, steps);
          return;
        }
        if (ended.outcome === "skipped") {
          // The chain never reached this group. That is the same scene as a
          // refusal, told in the org's own words for why it was not attempted.
          stopped(i, ended.detail, steps);
          return;
        }
        if (ended.outcome === "kept") {
          setRows((prev) => ({ ...prev, [g.id]: "kept" }));
          setDetails((prev) => ({ ...prev, [g.id]: ended.detail ?? "Written, and the re-query did not confirm it." }));
          at(T.keptHold, () => runGroup(i + 1, steps));
          return;
        }
        setRows((prev) => ({ ...prev, [g.id]: "verified" }));
        setDetails((prev) => ({ ...prev, [g.id]: ended.detail ?? verifiedLine(g.count) }));
        at(T.verifyHold, () => {
          setRows((prev) => ({ ...prev, [g.id]: "leaving" }));
          at(T.dissolve, () => {
            setRows((prev) => ({ ...prev, [g.id]: "gone" }));
            runGroup(i + 1, steps);
          });
        });
      });
    },
    [groups, at, fill, closing, stopped],
  );

  /**
   * THE ANSWER LANDED, SO THE RUN PLAYS.
   *
   * Reduced motion lands the ending in one commit: every group takes the state
   * the executor gave it, and a stop is a stop without having been watched.
   */
  useEffect(() => {
    if (!outcome || phase === "close" || phase === "stopped") return;
    const steps = outcome.steps ?? [];
    const firstBad = groups.findIndex((g) => {
      const e = groupOutcome(g, steps).outcome;
      return e === "stopped" || e === "skipped";
    });
    if (reduced) {
      if (firstBad >= 0) {
        stopped(firstBad, groupOutcome(groups[firstBad], steps).detail, steps);
        return;
      }
      const landed: Record<string, RowState> = {};
      const lines: Record<string, string> = {};
      for (const g of groups) {
        const e = groupOutcome(g, steps);
        landed[g.id] = e.outcome === "kept" ? "kept" : "gone";
        lines[g.id] = e.detail ?? verifiedLine(g.count);
      }
      setRows(landed);
      setDetails(lines);
      setPhase("close");
      setSaid(closingSentences(plan, groups, steps));
      setAfterOn(true);
      return;
    }
    setPhase("run");
    at(T.toFirst, () => runGroup(0, steps));
    // The run is armed once, by the answer arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  /* -------------------------------------------------------------- the fold */

  const fold = useCallback(() => {
    stopClock();
    const sheet = sheetRef.current;
    if (!sheet || reduced) {
      onClose();
      return;
    }
    /* FLIP, the finale's language: transform and opacity only, and the lens
       stands down while it moves. A FOLD IS A SHRINK, NOT A SLIDE: the row the
       sheet folds into is twice its width, so matching that box would scale the
       sheet UP and the beat would read as a cross-fade. It takes the row's
       place at the size a row is. */
    const target = document.querySelector('[data-inflight-row="1"]');
    const a = sheet.getBoundingClientRect();
    const b = target?.getBoundingClientRect() ?? null;
    document.body.dataset.c360Stage = "folding";
    sheet.setAttribute("data-morph", "from");
    // The pre-fold style has to be COMMITTED first: written in the same recalc
    // as the post-fold style, the transition has no start value and the sheet
    // simply disappears. One forced reflow is the whole fix.
    void sheet.offsetHeight;
    const dx = b ? b.left + b.width / 2 - (a.left + a.width / 2) : 0;
    const dy = b ? b.top - a.top : a.height * 0.25;
    sheet.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.38)`;
    sheet.style.opacity = "0";
    at(760, onClose);
  }, [stopClock, reduced, at, onClose]);

  /* THE RELATIONSHIP RECEDES while the stage has the page, and comes back when
     it leaves. The attribute is on `body` because `#root` is what dims and the
     stage is portalled out of it. */
  useEffect(() => {
    document.body.dataset.c360Stage = "open";
    return () => {
      delete document.body.dataset.c360Stage;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc leaves only while nothing is in flight: a run that is writing is
      // not something a keystroke may walk away from.
      if (e.key !== "Escape" || phase !== "plan" || gate.executing) return;
      e.stopPropagation();
      fold();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, gate.executing, fold]);

  /* ------------------------------------------------------------ the gesture */

  const press = useCallback(() => {
    stopClock();
    setOpen(null);
    setPhase("run");
    void gate.confirm();
  }, [stopClock, gate]);

  const planning = phase === "plan";
  const running = phase === "run";
  /* THE SHEET EMPTIES ONLY WHEN THE VERSION HAS LEFT THE ORG. A STOP KEEPS ITS
     LIST: the refused group, the org's own words under it and every row that
     was never attempted all stay standing, which is the whole point of the stop
     scene. Collapsing them would leave the banker a resume control over a blank
     sheet with no account of where the chain got to. */
  const emptied = phase === "close";
  const closed = phase === "close" || phase === "stopped";
  /* The count line is the ORG'S, verbatim: the first warning is the one that
     says how many records leave and what is not touched. */
  const [countLine, ...restWarnings] = plan.warnings;
  const observed = useMemo(
    () => observedSentences(plan, groups, outcome?.steps ?? []),
    [plan, groups, outcome],
  );

  return (
    <Portal>
      <div className="gs-stage" data-governed-stage={actionId}>
        <section
          ref={(el) => {
            sheetRef.current = el;
          }}
          className="gs-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          data-phase={phase}
        >
          <div className="gs-aura" aria-hidden="true">
            <i />
          </div>

          <header className="gs-hd" data-quiet={emptied ? "" : undefined}>
            <div className="gs-kick">Governed action</div>
            <h2>{title}</h2>
            {simulated && <p className="gs-lede">{SIMULATION_BANNER}</p>}
            {countLine && <p className="gs-lede">{countLine}</p>}
          </header>

          {/* ------------------------------------------------- the inventory */}
          <section className="gs-inv" data-gone={emptied ? "" : undefined} data-off={afterOn && emptied ? "" : undefined}>
            <div className="gs-inv-in">
              <div className="gs-colhead">
                <span>{running ? "Working through the plan" : "The inventory, as the org grouped it"}</span>
                <span>Records</span>
              </div>
              <ul className="gs-rows" ref={listRef}>
                {groups.map((g) => (
                  <StageRow
                    key={g.id}
                    group={g}
                    state={rows[g.id] ?? "queued"}
                    detail={details[g.id] ?? g.names}
                    p={fills[g.id] ?? 0}
                    open={open === g.id}
                    interactive={planning}
                    stopDetail={stopDetail}
                    onToggle={() => setOpen((prev) => (prev === g.id ? null : g.id))}
                  />
                ))}
              </ul>
            </div>
          </section>

          {/* ---------------------------------------------------- the close */}
          <div className="gs-close" data-on={closed ? "" : undefined}>
            <div>
              <div className="gs-said">
                {said.map((line, i) => (
                  <p key={i}>
                    {line}
                    {typing === i && <span className="gs-caret" aria-hidden="true" />}
                  </p>
                ))}
              </div>
              <div className="gs-after" data-on={afterOn ? "" : undefined}>
                {phase === "stopped" ? (
                  <p>{RESUME_LINE}</p>
                ) : (
                  observed.map((line, i) => <p key={i}>{line}</p>)
                )}
                <p className="gs-prov">
                  Plan {plan.planHash.slice(0, 8)} · staging {plan.stagingId}
                  {approver ? ` · confirmed by ${approver}` : ""} · {groups.length}{" "}
                  {groups.length === 1 ? "group" : "groups"}, each re-queried before the next.
                </p>
                {gate.toolError && (
                  <div className="gs-notice" data-tone="critical">
                    <b>{gate.toolError.code === "TRANSPORT" ? "The answer did not come back" : "This did not go through"}</b>
                    {toolErrorCopy(gate.toolError)}
                  </div>
                )}
                <div className="gs-doors">
                  {phase === "stopped" && (
                    <button
                      type="button"
                      className="eg-btn-ink c360-press"
                      disabled={gate.executing}
                      onClick={() => void gate.confirm()}
                      data-resume="stage"
                    >
                      {gate.executing ? "Working…" : RESUME_LABEL}
                    </button>
                  )}
                  {phase === "stopped" ? stopDoor : closeDoor}
                  <button type="button" className="wk-sheet-back" onClick={fold}>
                    {backLabel}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ----------------------------------------------------- the foot */}
          <footer className="gs-foot" data-quiet={planning ? undefined : ""}>
            {/* A33.5.3: every side effect the org named is read BEFORE the
                gesture, never after. The first warning is the lede above; the
                rest sit here in the sheet's quietest type, inside their own
                budget: four org paragraphs at full height pushed the commit
                pill off a 940px screen, and an action the banker has to scroll
                to reach is not "all on this page". */}
            {restWarnings.length > 0 && (
              <div className="gs-gov gs-notes">
                {restWarnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            )}
            <p className="gs-gov">{CLOSING_LINE}</p>
            {gate.blocked && (
              <div className="gs-notice" data-tone="critical">
                <b>This plan cannot be confirmed</b>
                <ul>
                  {gate.violations.map((v, i) => (
                    <li key={`v${i}`}>
                      Step {v.stepId}: {v.reason}
                    </li>
                  ))}
                  {gate.idLeaks.map((v, i) => (
                    <li key={`l${i}`}>{v}</li>
                  ))}
                  {gate.held && <li>{gate.heldReason}</li>}
                </ul>
              </div>
            )}
            {gate.drift && (
              <div className="gs-notice" data-tone="warning">
                <b>The figures moved</b>
                This plan was built on the earlier figures, so it cannot be confirmed. Stage it again on the current
                data. Nothing runs against numbers you did not see.
              </div>
            )}
            {gate.error && (
              <div className="gs-notice" data-tone="critical">
                {gate.error}
              </div>
            )}
            {/* THE SAME KEY IS GOING BACK OUT, AND THE BANKER IS TOLD SO. A
                surface that says nothing for four seconds is how a banker
                decides the page is broken and files the work a second time
                somewhere else. */}
            {gate.asking > 1 && (
              <div className="gs-notice" data-tone="warning" data-asking={gate.asking}>
                {ASKING_AGAIN}
              </div>
            )}
            {gate.toolError && planning && (
              <div className="gs-notice" data-tone="critical">
                <b>{gate.toolError.code === "TRANSPORT" ? "The answer did not come back" : "This did not go through"}</b>
                {toolErrorCopy(gate.toolError)}
              </div>
            )}
            <div className="gs-acts">
              <button
                type="button"
                className="eg-btn-ink c360-press"
                disabled={gate.blocked || gate.executing || Boolean(gate.drift)}
                onClick={press}
                data-commit="stage"
              >
                {gate.executing ? "Working…" : commitLabel}
              </button>
              <button type="button" className="wk-sheet-back" onClick={fold} disabled={gate.executing}>
                Not now
              </button>
            </div>
          </footer>

          {/* THE RECORDING LINE. One name, one sentence, and it claims nothing
              more than it says. */}
          <p className="gs-conf" data-on={planning ? undefined : ""}>
            {approver
              ? `Confirmed by ${approver}. This records that a named person saw this plan, and nothing more.`
              : "This view has no signed-in banker, so nothing can be confirmed from here."}
          </p>

          {/* NOBODY KNOWS YET, AND THAT IS ITS OWN STATE. Warning ink, never
              critical: critical is what the cockpit uses when the org has said
              no, and the org has said nothing at all. */}
          {gate.unsettled && (
            <div className="gs-notice" data-tone="warning" data-unsettled="1">
              <b>{UNSETTLED_TITLE}</b>
              {UNSETTLED_BODY}
            </div>
          )}
        </section>
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------------ one row */

function StageRow({
  group,
  state,
  detail,
  p,
  open,
  interactive,
  stopDetail,
  onToggle,
}: {
  group: StageGroup;
  state: RowState;
  detail: string;
  p: number;
  open: boolean;
  interactive: boolean;
  stopDetail: string | null;
  onToggle: () => void;
}) {
  return (
    <li className="gs-row" data-state={state} data-open={open ? "" : undefined} data-group={group.id}>
      <div className="gs-row-in">
        <button
          className="gs-row-b"
          type="button"
          aria-expanded={open}
          disabled={!interactive}
          onClick={onToggle}
        >
          <span className="gs-mk" aria-hidden="true">
            <span className="gs-mk-dot">·</span>
            <span className="gs-mk-g">&gt;</span>
            <span className="gs-mk-f" style={{ ["--gs-p" as string]: p.toFixed(3) }}>
              &gt;
            </span>
          </span>
          <span className="gs-t">{group.title}</span>
          <span className="gs-d">{detail}</span>
          <span className="gs-n tnum">{group.count}</span>
        </button>

        <div className="gs-why">
          <div>
            <ul>
              {group.reasons.map((r, i) => (
                <li key={i}>
                  {r.text}
                  <b>{r.names}</b>
                </li>
              ))}
              {group.automation && <li className="gs-auto">Wakes {group.automation}.</li>}
            </ul>
          </div>
        </div>

        {/* A REFUSED GROUP STAYS STANDING WITH THE ORG'S OWN WORDS. Rendered
            verbatim, in monospace: a refusal restated in our words is one the
            banker cannot check against the record the org is pointing at. */}
        <div className="gs-stopblk">
          <div>
            <div className="gs-stop-in">
              {stopDetail && <p className="gs-orgsays">{stopDetail}</p>}
              <p>
                Nothing in this group was removed and nothing after it was attempted. The plan is frozen exactly as it
                was confirmed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
