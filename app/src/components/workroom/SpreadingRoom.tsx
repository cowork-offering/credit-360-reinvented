import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import { useApp } from "../../state/appState";
import { resolveBundle } from "../../actions/registry";
import { BrandGlyph } from "../brand";
import { BugCopyButton } from "../BugCopyButton";
import { Portal } from "../Portal";
import { odoRoll } from "../Odometer";
import { RoomBoundary } from "./RoomBoundary";
import { SpreadRegister } from "./register/SpreadRegister";
import { closeSpreadingRoom, forgetBoomFile, pendingBoomFiles, rememberBoomFile, useSpreadingRoom } from "./spreadSession";
import { openMemoRoom } from "../memo/memoSession";
import { startPacer } from "../../channel/streamPacer";
import { prefersReducedMotion } from "../../data/motion";
import { fmtMoney, fmtPct } from "../../data/format";
import { covenantDirection, covenantUnit, fmtRatio } from "../../data/finance";
import {
  createSpreadEngine,
  provisionalBrief,
  PROVISIONAL_NOTE,
  SPREAD_STEPS,
  spreadGuidance,
  spreadSteps,
  type LadderRow,
  type SpreadCard,
  type SpreadDeps,
  type SpreadEngine,
  type SpreadFact,
  type SpreadFigures,
  type SpreadStage,
  type SpreadState,
} from "../../workroom/spreadEngine";
import type { UploadState } from "../../spread/types";
import type { Boom, BoomPeriod, BorrowerBundle } from "../../data/contract";
/* THE TWO SIBLING MODULES, IN ONE IMPORT BLOCK. The two reads around the spread
   come from `spread/`; the transport comes from the one adapter in
   `channel/boomUpload.ts`. This is the only place in the room that knows either
   of them exists, and `BOOM_UPLOAD_LANE` is what says whether the spread on
   stage is Boom's or the stub's. */
import {
  extractDocument,
  postRead,
  preReadFile,
  provisionalRead,
  readDroppedFile,
  type RelationshipSpreadContext,
} from "../../spread";
import { mergeDisplayPeriods, type SpreadProvenance } from "../../spread/publishSpread";
import { applySpreadEvent, boomSystemWord, type SpreadRoomEvent } from "../../state/spreadPublish";
import { BOOM_UPLOAD_LANE, boomAdapter, registerPreRead, resetStubBoom } from "../../channel/boomUpload";
import "../../styles/workroom.css";
import "../../styles/spreading.css";

/* =============================================================================
   THE SPREADING ROOM — drop statements, Boom spreads them, the financials move.

   A SIBLING OF THE BOOM FINANCIALS WIDGET, not a new register. The tiles, the
   revenue trend and the statement table are the Financials tab's, in the
   workroom's glass: one accent, hairlines, solid content on blurred chrome.
   The chrome itself is the other two rooms' — `.wk-room`, `.wk-head`, the
   Feedback pill, the close — because a fourth idea of what a room looks like is
   how three rooms stop being one product.

   IT OPENS ON THE FIRST FRAME. Nothing is fetched to open: the relationship,
   the periods Boom already carries and the covenant thresholds are in the
   cockpit's book and arrive as props. The drop zone is painted before anything
   else exists, and every later surface appears in place beneath it.

   EVERYTHING PROVISIONAL SAYS SO. The pre-read's figures are read in the
   browser before a byte has left; the stub's spread is not Boom's either. Both
   carry the word, and the moment Boom's own read lands the label goes.

   NOTHING FLASHES EMPTY. The tiles open on the last good figures on file and
   roll to the new ones; a period that Boom has not returned leaves the tile
   exactly where it was rather than blanking it.
   ============================================================================= */

const ROOM_TITLE = "Spread financials";

const DROP_HEAD = (company: string) => `Drop financial statements for ${company}.`;
const DROP_SUB =
  "PDF, XLSX, CSV or an image of a statement. Up to ten files, 5 MB each. Boom spreads them and the financials here refresh from Boom's own read.";
const BROWSE = "Browse files";
const DROP_ARIA = "Drop financial statements here, or browse for them";
const ACCEPT = ".pdf,.xlsx,.xls,.csv,image/png,image/jpeg";

/** Past the first file the zone is a bar, so the card is the first thing the
 *  banker's eye lands on (founder, 2026-09-13). */
const ADD_MORE = "Add another statement";
const addedWord = (n: number): string => `${n} file${n === 1 ? "" : "s"} in this plan`;

const STEPS_ARIA = "Where this spread has got to";
const PLAN_HEAD = "The plan";
const PLAN_SEC_HEAD = "What goes to Boom";
const SPREAD_HEAD = "The spread is in";
const DRAFT_MEMO = "Draft the credit memo";
const backTo = (company: string): string => `Back to ${company}`;
const PLAN_NOTE =
  "When you confirm, these files go to Boom. Boom spreads them and stays the record of the spread; the financials here refresh from its own read.";
/* THE STAND-IN SAYS SO, WHENEVER IT IS THE ONE ANSWERING (0.9.28). The lane is
   live by default now; this sentence is what the room says on the day somebody
   flips it back, and it must never read as though Boom had spread the file. */
const STUB_NOTE =
  "The Boom lane is on its stand-in, so this spread is the browser's own read and stays provisional.";
const PROVISIONAL_HEAD = "What the file reads as, before it goes";
const CONFIRM = "Confirm and spread";
const LEAVE = "Leave it for now";
const KEEP_WAITING = "Keep waiting";
const LEAVE_WITH_BOOM = "Leave it with Boom";
const FIN_HEAD = "Financials";
const FIN_EXPLAIN =
  "Explain these financials: revenue trend, leverage, coverage, and which covenant tests move.";
const PROVISIONAL_BADGE = "Provisional";
const POST_HEAD = "What this changes";
const NO_STATEMENTS =
  "Boom has not returned a spread for these files yet. The provisional read above is what the browser could place.";
const READING = "Reading";
const LEFT_OUT = "Out of this plan";

/** WHO IS SPREADING, AND IS IT BOOM. The stub is named on the ladder's own
 *  heading, because the ladder is the moment a banker believes the spread left
 *  the building. */
const ladderHead = (lane: "stub" | "live", settled: boolean): string =>
  `${lane === "live" ? "Boom" : "Boom (stub)"} ${settled ? "has spread these files" : "is spreading"}`;

/** THE SHEET'S OWN TITLE, one per stage. The middle one names the system doing
 *  the work, stub included, for the same reason the ladder's heading does. */
const sheetTitle = (stage: SpreadStage, lane: "stub" | "live"): string => {
  if (stage === "spread") return SPREAD_HEAD;
  if (stage === "sending") return ladderHead(lane, false);
  return PLAN_HEAD;
};

const RUNG_WORD: Record<UploadState, string> = {
  pending: "Queued",
  sending: "Sending",
  processing: "Processing",
  completed: "Completed",
  verified: "Verified",
  failed: "Failed",
};

const RUNGS: UploadState[] = ["pending", "sending", "processing", "completed", "verified"];

/* ---------------------------------------------------------------- the tiles */

interface Tile {
  key: keyof SpreadFigures;
  label: string;
  text: string;
}

function tilesFor(f: SpreadFigures): Tile[] {
  return [
    { key: "revenue", label: "Revenue", text: fmtMoney(f.revenue) },
    { key: "ebitda", label: "EBITDA", text: fmtMoney(f.ebitda) },
    { key: "marginPct", label: "EBITDA margin", text: fmtPct(f.marginPct) },
    { key: "leverage", label: "Total leverage", text: fmtRatio(f.leverage) },
    { key: "coverage", label: "Interest coverage", text: fmtRatio(f.coverage) },
  ];
}

/** A figure ROLLS to its new value (rule 61), it never swaps. The first paint
 *  writes the last-good figure straight in; every later one is an odometer. */
function SpreadTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (shown.current === tile.text) return;
    if (shown.current === null) {
      if (ref.current) ref.current.textContent = tile.text;
    } else {
      odoRoll(ref.current, tile.text);
    }
    shown.current = tile.text;
  }, [tile.text]);
  return (
    <div className="sp-tile">
      <div className="sp-tile-k">{tile.label}</div>
      <div className="sp-tile-v num" ref={ref} />
    </div>
  );
}

/* ---------------------------------------------------------------- the trend */

const TW = 640;
const TH = 128;
const TREND_TOP = 12;
const TREND_BOTTOM = 104;

export interface TrendPoint {
  period: string;
  revenue: number | null;
  /** The point this spread just put on the chart. */
  isNew?: boolean;
}

function trendPath(points: TrendPoint[], scale: number): string {
  if (points.length < 2 || scale <= 0) return "";
  const x = (i: number) => (i / (points.length - 1)) * TW;
  const y = (v: number) => TREND_BOTTOM - (Math.max(0, v) / scale) * (TREND_BOTTOM - TREND_TOP);
  return points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.revenue ?? 0).toFixed(1)}`).join(" ");
}

function SpreadTrend({ points, provisional }: { points: TrendPoint[]; provisional?: boolean }) {
  if (points.length < 2) return null;
  const scale = Math.max(0, ...points.map((p) => p.revenue ?? 0)) * 1.08;
  const path = trendPath(points, scale);
  /* THE MARK SITS ON THE PERIOD THIS SPREAD MOVED, wherever that period fell in
     the book's own order. It is not always the last point: a re-spread of a
     year the book already carries lands mid-axis, with LTM after it. */
  const at = Math.max(0, points.findIndex((p) => p.isNew));
  const lastX = (at / (points.length - 1)) * TW;
  const lastY = TREND_BOTTOM - (Math.max(0, points[at].revenue ?? 0) / (scale || 1)) * (TREND_BOTTOM - TREND_TOP);
  return (
    <svg className="sp-trend" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label="Revenue trend, including the new period">
      <path className="sp-trend-line" d={path} fill="none" pathLength={1} />
      <circle
        className="sp-trend-new"
        cx={lastX}
        cy={lastY}
        r="4"
        data-provisional-period={provisional ? points[at].period : undefined}
      />
      <g className="sp-trend-ax">
        {points.map((p, i) => (
          <text
            key={p.period + i}
            x={i === 0 ? 2 : i === points.length - 1 ? TW - 2 : (i / (points.length - 1)) * TW}
            y={TH - 4}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          >
            {p.period}
          </text>
        ))}
      </g>
    </svg>
  );
}

/* ----------------------------------------------------------------- the prose

   THE POST-READ ARRIVES AT A READING PACE, the same pacer the rooms' narration
   uses. Reduced motion and every jsdom test land it whole, which is the pacer's
   own contract and not a branch invented here. */
function SpreadProse({ lines }: { lines: string[] }) {
  const text = lines.join("\n");
  const [visible, setVisible] = useState(text);
  useEffect(() => {
    if (!text) {
      setVisible("");
      return;
    }
    const pacer = startPacer({ emit: (v) => setVisible(v), instant: prefersReducedMotion() });
    pacer.finish(text);
    return () => pacer.cancel();
  }, [text]);
  if (!visible) return null;
  return (
    <div className="sp-prose">
      {visible.split("\n").map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ the room */

export interface SpreadingRoomProps {
  ctx: RelationshipSpreadContext;
  /** `bundle.boom`: the last-good figures the panel opens on, and what both
   *  analysis modules read the new period against. */
  onFileBoom?: Boom | null;
  /** The revenue trend the new period extends by one point. */
  trend?: TrendPoint[];
  /** Injected by the host; the suite injects its own. */
  deps?: SpreadDeps;
  /** What the room did, for the surfaces outside it: the relationship's
   *  activity trail and `bundle.boom`. The host wires it; the room itself holds
   *  no store and reaches no reducer. */
  onSpreadEvent?: (event: SpreadRoomEvent) => void;
  /** Opens the cockpit's own chat on a grounded question about this panel, the
   *  way every section of the Financials tab already does. Absent where the
   *  host has no chat to open, and then the affordance is not drawn. */
  onExplain?: (prompt: string) => void;
  /** THE DOOR OUT OF THE FINALE, the modification room's own: the spread is in,
   *  and the next thing a banker does with it is write it up. The room hands up
   *  the period it just spread so the memo can name what asked for it; the host
   *  owns the session. Absent where the host has no memo room to open. */
  onDraftMemo?: (period: string | null) => void;
  onClose: () => void;
}

export function SpreadingRoom({
  ctx,
  onFileBoom,
  trend = [],
  deps,
  onSpreadEvent,
  onExplain,
  onDraftMemo,
  onClose,
}: SpreadingRoomProps) {
  const engineRef = useRef<SpreadEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createSpreadEngine({ ctx, deps: deps ?? liveDeps(ctx.accountId), onFileBoom });
  }
  const engine = engineRef.current;
  const lane = deps?.lane ?? BOOM_UPLOAD_LANE;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  /** One event per moment, however many times the store wakes this component. */
  const said = useRef<Set<SpreadRoomEvent["phase"]>>(new Set());

  useEffect(() => () => engine.dispose(), [engine]);

  /* THE FILES LEFT WITH BOOM ARE PICKED BACK UP ON THE WAY IN (decision D3).
     The room opens on its drop zone as always; where this relationship has work
     Boom is still doing, the wait rejoins it instead and nothing is sent.
     Once, on mount: each handle is cleared by the engine when its file settles.

     EVERY FILE, NOT ONE (0.9.29), and handed NOTHING the engine asks Boom
     itself: the receipts are module memory and a reloaded page has none, which
     is the state the founder's own re-entry landed in on 2026-09-15. */
  useEffect(() => {
    void engine.resume(pendingBoomFiles(ctx.accountId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  /* THE TWO MOMENTS THE COCKPIT CARES ABOUT: the plan left, and Boom settled
     it. Both are read off the engine's own state rather than fired from inside
     the ladder, so a room re-rendered mid-flow cannot miss one or send it
     twice. */
  useEffect(() => {
    if (!onSpreadEvent) return;
    const plan = state.plan;
    if (!plan) return;
    const sending = state.stage === "sending" || state.stage === "spread";
    const base = {
      accountId: ctx.accountId,
      company: ctx.company,
      summary: plan.summary,
      planKey: plan.items.map((i) => i.sha256).join("+"),
      fileCount: plan.items.length,
      provenance: (lane === "live" ? "boom" : "stub-provisional") as SpreadProvenance,
      system: boomSystemWord(lane),
    };

    if (sending && !said.current.has("sent")) {
      said.current.add("sent");
      onSpreadEvent({ ...base, phase: "sent", statements: [], signedOff: false, failure: null });
    }
    if (state.stage === "spread" && !said.current.has("completed") && !said.current.has("failed")) {
      const landed = state.statements.length > 0;
      said.current.add(landed ? "completed" : "failed");
      onSpreadEvent({
        ...base,
        phase: landed ? "completed" : "failed",
        statements: state.statements,
        signedOff: state.validationStatus === "validated",
        failure: state.rows.find((r) => r.state === "failed")?.message ?? null,
      });
    }
  }, [state.stage, state.plan, state.statements, state.rows, state.validationStatus, ctx.accountId, ctx.company, lane, onSpreadEvent]);

  useEffect(() => {
    document.body.classList.add("wk-open");
    return () => document.body.classList.remove("wk-open");
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const take = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      void engine.drop([...files]);
    },
    [engine],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer?.files ?? null);
  };

  /* THE NEW PERIOD IS MERGED BY ITS LABEL, NOT APPENDED (founder, 2026-09-13:
     the axis read FY2023, FY2024, FY2025, LTM, FY2025). A re-spread of a year
     the book already carries REPLACES that year's point; a year it does not
     carry is added at the end. It is `publishSpread`'s own display merge, the
     one the Financials tab's periods already go through, called and not
     copied. */
  const points = useMemo<TrendPoint[]>(() => {
    if (state.stage !== "spread" || state.figures.revenue == null) return trend;
    const period = state.newPeriod ?? "New period";
    const book: BoomPeriod[] = trend.map((p) => ({ period: p.period, revenue: p.revenue ?? undefined }));
    return mergeDisplayPeriods(book, [{ period, revenue: state.figures.revenue }]).map((p) => ({
      period: p.period ?? "",
      revenue: p.revenue ?? null,
      isNew: p.period === period,
    }));
  }, [state.stage, state.figures.revenue, state.newPeriod, trend]);

  /* THE ZONE IS A BAR ONCE A FILE IS IN, and a stage again while something is
     being dragged over it. */
  const collapsed = state.cards.length > 0 && !over;
  const brief = useMemo(() => provisionalBrief(state.provisional), [state.provisional]);

  /* WHAT THE SHEET IS ABOUT, IN ITS STAMP. Before the spread the period is the
     one the browser read out of the file; after it, the one Boom moved. */
  const settled = state.stage === "spread";
  const period = (settled ? state.newPeriod : null) ?? state.provisional?.period ?? null;
  const title = sheetTitle(state.stage, lane);
  const stamp = period ? `${ctx.company} · ${period}` : ctx.company;

  return (
    <Portal>
      <div className="wk-root">
        <div className="wk-scrim" onClick={onClose} role="presentation" />
        <div
          className="wk-room sp-room eg-glass eg-glass-workroom"
          role="dialog"
          aria-modal="true"
          aria-label={ROOM_TITLE}
          data-room="spread"
        >
          <header className="wk-head">
            <BrandGlyph />
            <span className="wk-title">{ROOM_TITLE}</span>
            <span className="sp-anchor">{ctx.company}</span>
            <span className="wk-spacer" />
            <BugCopyButton
              build={() => transcriptOf(state, ctx.company)}
              surface={`Spread financials — ${ctx.company}`}
              accountName={ctx.company}
            />
            <button type="button" className="wk-icobtn" onClick={onClose} aria-label="Close the spreading room">
              ×
            </button>
          </header>

          <div className="sp-body">
            {/* WHERE THE BANKER IS, AND WHAT TO DO NEXT. The spine first, then
                the one sentence that leads this stage. Both are derived from the
                engine's own stage, so the room cannot be in one place and say it
                is in another. */}
            <SpreadSteps stage={state.stage} />
            <p className="sp-guide">{spreadGuidance(state)}</p>

            <div
              className={`sp-drop${over ? " is-over" : ""}${collapsed ? " is-bar" : ""}`}
              data-stage={state.stage}
              role="button"
              tabIndex={0}
              aria-label={DROP_ARIA}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <svg className="sp-drop-g" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 3.5h8.5L19 8v12.5H6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M14.5 3.5V8H19" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M12 18v-6.4M9.4 14.2 12 11.6l2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="sp-drop-h">{collapsed ? ADD_MORE : DROP_HEAD(ctx.company)}</div>
              <div className="sp-drop-s">{DROP_SUB}</div>
              {collapsed ? (
                <span className="sp-drop-c">{addedWord(state.cards.length)}</span>
              ) : (
                <span className="sp-drop-b">{BROWSE}</span>
              )}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="sp-file"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  take(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {state.refusals.length > 0 && (
              <div className="sp-refusals" role="status">
                {state.refusals.map((r) => (
                  <p key={r}>{r}</p>
                ))}
              </div>
            )}

            {state.cards.length > 0 && (
              <div className="sp-cards">
                {state.cards.map((card) => (
                  <SpreadFileCard key={card.id} card={card} />
                ))}
              </div>
            )}

            {state.ask && (
              <section className="sp-ask" aria-label="One question about these files">
                <p className="sp-ask-lead">{state.ask.lead}</p>
                <div className="sp-chips">
                  {state.ask.chips.map((chip) => (
                    <button
                      key={chip.value}
                      type="button"
                      className={`sp-chip${chip.recommended ? " is-rec" : ""}`}
                      onClick={() => engine.answer(state.ask!.id, chip.value)}
                    >
                      {chip.label}
                      {chip.why ? <em className="sp-chip-why">{chip.why}</em> : null}
                    </button>
                  ))}
                </div>
                {state.asks.length > 1 && (
                  <p className="sp-ask-rest">{`${state.asks.length - 1} more after this one.`}</p>
                )}
              </section>
            )}

            {/* ============ THE SHEET THE ROOM ENDS ON (founder, 2026-09-13)

                "Ideally make it at the end also with this glowing rainbow card
                so it is all unified."

                FROM CONFIRM ONWARD `.sp-act` IS THE FILED SHEET. It is the same
                element all the way through — the plan grows into the ladder and
                the ladder into the spread, one node, so the room never swaps a
                surface for another one wearing its clothes. Every class that
                draws it is the modification finale's own (`FiledSheet.tsx`,
                workroom.css `.wk-sheet*`): the glass, the rim, the rainbow
                thinned to an edge, the section rule, and the two doors. Nothing
                about the look is written twice.

                AND THE ROOM ENDS IN DOORS, like the modification finale: the
                memo, and the way back to the relationship. */}
            {(state.plan || state.rows.length > 0) && (
              <section
                className={`sp-act wk-sheet ${state.rows.length > 0 ? "sp-ladder" : "sp-plan"}`}
                data-stage={state.stage}
                role="group"
                aria-label={title}
              >
                {/* THE RAINBOW, THINNED TO AN EDGE. The finale's own element at
                    the finale's own opacity: the light settles, it does not
                    pulse. */}
                <span className="aura" aria-hidden="true" />

                <div className="wk-sheet-h">
                  <h3 className="wk-sheet-t">{title}</h3>
                  <div className="wk-sheet-s">{stamp}</div>
                </div>

                {state.rows.length > 0 ? (
                  <div className="wk-sheet-sec" data-block="ladder">
                    {/* NOT THE SAME WORDS TWICE (the filed sheet's own rule for
                        its ledger head). While Boom is spreading, the SHEET is
                        already titled "Boom is spreading"; a label under it
                        saying so again is a label. Once the spread is in, the
                        title moves on and the block says whose spread it is. */}
                    {settled && <div className="wk-sheet-k">{ladderHead(lane, true)}</div>}
                    {state.rows.map((row) => (
                      <SpreadLadderRow key={row.fileId} row={row} />
                    ))}
                    {state.stall && (
                      <div className="sp-stall" role="status">
                        <p>{state.stall.line}</p>
                        <div className="sp-chips">
                          <button type="button" className="sp-chip" onClick={() => engine.keepWaiting()}>
                            {KEEP_WAITING}
                          </button>
                          <button type="button" className="sp-chip" onClick={() => engine.leaveWithBoom()}>
                            {LEAVE_WITH_BOOM}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="wk-sheet-sec" data-block="plan">
                      <div className="wk-sheet-k">{PLAN_SEC_HEAD}</div>
                      <p className="sp-plan-s">{state.plan?.summary}</p>
                      <p className="sp-plan-n">{PLAN_NOTE}</p>
                      {lane !== "live" && <p className="sp-plan-w">{STUB_NOTE}</p>}
                    </div>
                    {brief.length > 0 && (
                      <div className="wk-sheet-sec sp-brief" data-block="read">
                        <div className="wk-sheet-k">{PROVISIONAL_HEAD}</div>
                        {brief.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* THE PANEL EXISTS WHEN THERE IS A SPREAD AND NOT ONE FRAME
                    BEFORE. It used to open on the provisional read, under the
                    confirm, so a banker saw tiles, a trend and statement tabs
                    for a spread nobody had sent yet. What the file reads as sits
                    in the plan above, in four lines; this is the thing that
                    lands. */}
                {settled && (
                  <section className="wk-sheet-sec sp-fin" data-block="financials" aria-label={FIN_HEAD}>
                    <div className="sp-fin-head">
                      <div className="wk-sheet-k">{FIN_HEAD}</div>
                      {/* THE VALIDATION IS THE REGISTER'S, PER STATEMENT (0.9.28).
                          A file-level "Validated in Boom" beside a register that
                          says it statement by statement, over a link the
                          register's own footer carries, is the same fact three
                          times. What stays here is the word about the FIGURES:
                          provisional is about the tiles, which are the browser's
                          own read until Boom answers. */}
                      {state.figuresProvisional && <span className="sp-badge is-prov">{PROVISIONAL_BADGE}</span>}
                      {onExplain && (
                        <button
                          type="button"
                          className="sp-explain"
                          aria-label="Explain these financials"
                          onClick={() => onExplain(FIN_EXPLAIN)}
                        >
                          Explain
                        </button>
                      )}
                    </div>
                    <div className="sp-tiles">
                      {tilesFor(state.figures).map((tile) => (
                        <SpreadTile key={tile.key} tile={tile} />
                      ))}
                    </div>
                    <SpreadTrend points={points} provisional={state.figuresProvisional} />
                    {state.figuresProvisional && <p className="sp-note">{PROVISIONAL_NOTE}</p>}
                    {state.statements.length ? (
                      <SpreadRegister
                        statements={state.statements}
                        support={state.support}
                        mode="room"
                        adjusted={state.adjusted}
                        onAdjustedChange={
                          state.adjustable ? (next) => void engine.setAdjusted(next) : undefined
                        }
                        newPeriodEnd={state.newPeriod}
                        verificationUrl={state.validationUrl}
                        /* LAZY, ON THE CLICK (row 61, 0.9.29). Boom's
                           verification session lives 60 minutes; minting one for
                           every banker who opened a spread to read it would
                           spend a token on somebody who never verifies
                           anything. The control asks, and only then is there a
                           URL to open. */
                        onVerify={state.verifiable ? () => void engine.openVerification() : undefined}
                        verifying={state.verifying}
                        verifyError={state.verifyError}
                        provenance={{
                          /* ONE FILE, NAMED; several, and the period and the
                             system carry the citation instead of a list. */
                          fileName: state.rows.length === 1 ? state.rows[0].name : null,
                          /* The footer already opens "Spread by Boom", so the
                             live lane's own word would be Boom twice. What is
                             worth saying is when the answer is NOT Boom's. */
                          source: lane === "live" ? null : boomSystemWord(lane),
                        }}
                      />
                    ) : (
                      <p className="sp-note">{NO_STATEMENTS}</p>
                    )}
                  </section>
                )}

                {state.postRead.length > 0 && (
                  <section className="wk-sheet-sec sp-post" data-block="changes" aria-label={POST_HEAD}>
                    <div className="wk-sheet-k">{POST_HEAD}</div>
                    <SpreadProse lines={state.postRead} />
                  </section>
                )}

                {/* TWO DOORS, AND NEVER A THIRD (workroom.css `.wk-sheet-acts`).
                    While Boom is spreading there is no door at all: the sheet is
                    working, the stall above is the only question it can ask, and
                    the room's own close is always on the header. */}
                {(state.stage === "plan" || settled) && (
                  <div className="wk-sheet-acts">
                    {settled
                      ? onDraftMemo && (
                          <button
                            type="button"
                            className="wk-sheet-go"
                            data-door="memo"
                            onClick={() => onDraftMemo(period)}
                          >
                            {DRAFT_MEMO}
                          </button>
                        )
                      : (
                          <button type="button" className="sp-go wk-sheet-go" onClick={() => void engine.confirm()}>
                            {CONFIRM}
                          </button>
                        )}
                    <button type="button" className="sp-back wk-sheet-back" onClick={onClose}>
                      {settled ? backTo(ctx.company) : LEAVE}
                    </button>
                  </div>
                )}
              </section>
            )}

            {state.notice && <p className="sp-note" role="status">{state.notice}</p>}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** THE FIVE STEPS, IN THE WORKROOMS' OWN SPINE: derived from the stage, nothing
 *  clickable, the current one lit and the passed ones ticked. */
function SpreadSteps({ stage }: { stage: SpreadStage }) {
  const states = spreadSteps(stage);
  return (
    <ol className="sp-steps" aria-label={STEPS_ARIA}>
      {SPREAD_STEPS.map((step, i) => (
        <li key={step.id} className="sp-step" data-state={states[i]} aria-current={states[i] === "on" ? "step" : undefined}>
          <span className="sp-step-d" aria-hidden="true">
            {states[i] === "done" ? "✓" : ""}
          </span>
          <span className="sp-step-l">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** ONE FACT, ONE ROW. The tag qualifies the value and is never a sentence; the
 *  quote is the fragment of the file the value was read from. */
function SpreadFactRow({ fact }: { fact: SpreadFact }) {
  return (
    <div className="sp-fact" data-fact={fact.key}>
      <dt className="sp-fact-k">{fact.label}</dt>
      <dd className="sp-fact-v">
        <span>{fact.value}</span>
        {fact.tag && <span className="sp-fact-t">{fact.tag}</span>}
        {fact.quote && <span className="sp-fact-q">{`"${fact.quote}"`}</span>}
      </dd>
    </div>
  );
}

function SpreadFileCard({ card }: { card: SpreadCard }) {
  return (
    <article className={`sp-card${card.excluded ? " is-out" : ""}`} data-phase={card.phase}>
      <div className="sp-card-h">
        <span className="sp-card-n">{card.name}</span>
        <span className="sp-card-b">{`${(card.bytes / (1024 * 1024)).toFixed(1)} MB`}</span>
        {card.phase === "reading" && <span className="sp-card-s">{READING}</span>}
        {card.excluded && <span className="sp-card-s">{LEFT_OUT}</span>}
      </div>
      {card.refusal && <p className="sp-card-r">{card.refusal}</p>}
      <dl className="sp-card-f">
        {card.facts.map((fact) => (
          <SpreadFactRow key={fact.key} fact={fact} />
        ))}
      </dl>
      {card.warnings.map((line) => (
        <p className="sp-card-w" key={line}>
          {line}
        </p>
      ))}
      {card.footnote && <p className="sp-card-fn">{card.footnote}</p>}
    </article>
  );
}

function SpreadLadderRow({ row }: { row: LadderRow }) {
  const at = RUNGS.indexOf(row.state);
  return (
    <div className="sp-rung" data-state={row.state}>
      <span className="sp-rung-n">{row.name}</span>
      <span className="sp-rung-d" aria-hidden="true">
        {RUNGS.map((rung, i) => (
          <i key={rung} className={`sp-dot${at >= 0 && i <= at ? " is-on" : ""}${at === i ? " is-now" : ""}`} />
        ))}
      </span>
      <span className="sp-rung-w">{row.stalled ? RUNG_WORD.processing : RUNG_WORD[row.state]}</span>
      {row.message && <span className="sp-rung-m">{row.message}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ the host */

/** The live dependency set. One place, so the swap to S2 and S3 is the import
 *  block at the top of this file and nothing else. */
function liveDeps(accountId: string): SpreadDeps {
  return {
    readDroppedFile,
    extractDocument,
    preReadFile,
    provisionalRead,
    postRead,
    adapter: boomAdapter(),
    lane: BOOM_UPLOAD_LANE,
    registerPreRead,
    resetStub: resetStubBoom,
    rememberFile: (handle) => rememberBoomFile(accountId, handle),
    forgetFile: (fileId) => forgetBoomFile(accountId, fileId),
  };
}

/** What the Feedback pill carries. The room's own state in the report's words,
 *  never the file bytes. */
function transcriptOf(state: SpreadState, company: string): string {
  const lines = [
    `# Spread financials — ${company}`,
    `Stage: ${state.stage}`,
    ...state.cards.map(
      (c) => `- ${c.name} (${c.phase}): ${c.facts.map((f) => `${f.label}: ${f.value}`).join("; ")}`,
    ),
    ...(state.plan ? [`Plan: ${state.plan.summary}`] : []),
    ...state.rows.map((r) => `- ${r.name}: ${r.state}${r.message ? ` — ${r.message}` : ""}`),
    ...state.refusals.map((r) => `- ${r}`),
    ...state.postRead,
  ];
  return lines.join("\n");
}

/** The book, read the way the two analysis modules want it. Everything here is
 *  already in the cockpit's bundle, which is why opening the room fetches
 *  nothing. */
export function spreadContextFor(args: {
  bundle: BorrowerBundle | null;
  accountId: string;
  accountName: string;
}): RelationshipSpreadContext {
  const bundle = args.bundle;
  const periods = bundle?.boom?.spread?.periods ?? [];
  return {
    accountId: args.accountId,
    company: args.accountName,
    onFilePeriods: periods.map((p) => p.period ?? "").filter(Boolean),
    /* THE UNIT TRAVELS WITH THE TEST (added 2026-09-13). The post-read speaks to
       EVERY covenant on the book now, and an advance test at 80 percent read
       "80.00x" and a liquidity floor of five million read "5000000.00x" while
       the unit was left behind. `covenantUnit` is the cockpit's own rule for
       this and the book is where the answer comes from, so it is carried here
       rather than guessed downstream. */
    covenants: (bundle?.covenants?.covenants ?? []).map((c) => ({
      name: c.covenantType ?? "Covenant",
      operator: covenantDirection(c.covenantType, c.actualValue, c.thresholdValue) === "cap" ? "<=" : ">=",
      threshold: c.thresholdValue ?? null,
      current: c.actualValue ?? null,
      unit: covenantUnit(c.covenantType, c.actualValue ?? c.thresholdValue),
    })),
    obligorGroup: (bundle?.graph?.connections ?? [])
      .filter((c) => c.counterpartyName)
      .map((c) => ({ name: c.counterpartyName as string, role: c.role ?? "" })),
  };
}

export function SpreadingRoomHost() {
  const session = useSpreadingRoom();
  const { data, state, dispatch } = useApp();
  const accountId = session?.accountId ?? null;

  const bundle = useMemo(() => {
    if (!accountId) return null;
    const baked = resolveBundle(data, accountId);
    const patch = state.livePatches[accountId];
    return baked && patch ? { ...baked, ...patch } : baked;
  }, [data, state.livePatches, accountId]);

  const ctx = useMemo<RelationshipSpreadContext | null>(() => {
    if (!accountId || !session) return null;
    return spreadContextFor({ bundle, accountId, accountName: session.accountName });
  }, [accountId, bundle, session]);

  const trend = useMemo<TrendPoint[]>(
    () =>
      (bundle?.boom?.spread?.periods ?? [])
        .filter((p) => p.period)
        .map((p) => ({ period: p.period as string, revenue: p.revenue ?? null })),
    [bundle],
  );

  /* WHERE THE SPREAD LEAVES THE ROOM (item 18).
     Two things happen and they happen in this order: the relationship's
     activity trail gets the entry (a governed action is trail-worthy whether
     or not the figures moved), and `bundle.boom` is REPLACED with the same
     object the Financials tab, the memo's Boom graph and the covenant
     challenge already read. Nothing is cleared: a spread that returned nothing
     leaves the last good figures exactly where they were. */
  const onSpreadEvent = useCallback(
    (event: SpreadRoomEvent) => {
      applySpreadEvent({ event, onFileBoom: bundle?.boom ?? null, dispatch, actor: data.meta?.user });
    },
    [bundle?.boom, data.meta?.user, dispatch],
  );

  /* THE EXPLAIN AFFORDANCE, the Financials tab's own (`SecHead explain=`): it
     seeds the cockpit chat with the section's question. The room closes first,
     because the chat drawer lives behind this room's scrim and a drawer nobody
     can see is not an explanation. */
  const onExplain = useCallback(
    (prompt: string) => {
      closeSpreadingRoom();
      dispatch({ type: "SET_PANEL", panel: "chat" });
      dispatch({ type: "SET_DRAFT", draft: prompt });
    },
    [dispatch],
  );

  /* THE MEMO DOOR, THE WAY THE MODIFICATION FINALE OPENS IT (`WorkroomHost`'s
     `openMemo`). The spread filed no package version, so the anchor is the
     relationship and the trigger is the neutral one, exactly as the FAB's own
     memo door passes them; what this room adds is the SOURCE, so the memo's
     first line can say the spread is what asked for it. The spreading room then
     closes: one room at a time on the glass. */
  const onDraftMemo = useCallback(
    (period: string | null) => {
      if (!session) return;
      openMemoRoom({
        accountId: session.accountId,
        accountName: session.accountName,
        productPackageId: null,
        trigger: "adhoc",
        source: { kind: period ? `the ${period} spread` : "the spread just filed" },
      });
      closeSpreadingRoom();
    },
    [session],
  );

  if (!ctx || !session) return null;
  return (
    <RoomBoundary what="the spreading room" scope="room">
      <SpreadingRoom
        key={session.accountId}
        ctx={ctx}
        onFileBoom={bundle?.boom ?? null}
        trend={trend}
        onSpreadEvent={onSpreadEvent}
        onExplain={onExplain}
        onDraftMemo={onDraftMemo}
        onClose={closeSpreadingRoom}
      />
    </RoomBoundary>
  );
}
