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
import { closeSpreadingRoom, useSpreadingRoom } from "./spreadSession";
import { startPacer } from "../../channel/streamPacer";
import { prefersReducedMotion } from "../../data/motion";
import { fmtMoney, fmtPct } from "../../data/format";
import { covenantDirection, fmtRatio } from "../../data/finance";
import {
  createSpreadEngine,
  PROVISIONAL_NOTE,
  type LadderRow,
  type SpreadCard,
  type SpreadDeps,
  type SpreadEngine,
  type SpreadFigures,
  type SpreadState,
} from "../../workroom/spreadEngine";
import type { BoomFinancialStatement, StatementType, UploadState } from "../../spread/types";
import type { Boom, BorrowerBundle } from "../../data/contract";
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
import type { SpreadProvenance } from "../../spread/publishSpread";
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

const PLAN_HEAD = "The plan";
const PLAN_NOTE =
  "Boom spreads these and stays the record of the spread. The financials here refresh from its own read when it has them.";
const CONFIRM = "Send to Boom";
const LADDER_HEAD = "Boom";
const KEEP_WAITING = "Keep waiting";
const LEAVE_WITH_BOOM = "Leave it with Boom";
const FIN_HEAD = "Financials";
const VERIFY = "Verify in Boom";
const NOT_VALIDATED = "Not validated in Boom";
const VALIDATED = "Validated in Boom";
const PROVISIONAL_BADGE = "Provisional";
const POST_HEAD = "What this changes";
const NO_STATEMENTS =
  "Boom has not returned a spread for these files yet. The provisional read above is what the browser could place.";
const READING = "Reading";
const LEFT_OUT = "Out of this plan";

const RUNG_WORD: Record<UploadState, string> = {
  pending: "Queued",
  sending: "Sending",
  processing: "Processing",
  completed: "Completed",
  verified: "Verified",
  failed: "Failed",
};

const RUNGS: UploadState[] = ["pending", "sending", "processing", "completed", "verified"];

const TAB_WORD: Partial<Record<StatementType, string>> = {
  income_statement: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow_statement: "Cash flow",
};

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
}

function trendPath(points: TrendPoint[], scale: number): string {
  if (points.length < 2 || scale <= 0) return "";
  const x = (i: number) => (i / (points.length - 1)) * TW;
  const y = (v: number) => TREND_BOTTOM - (Math.max(0, v) / scale) * (TREND_BOTTOM - TREND_TOP);
  return points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.revenue ?? 0).toFixed(1)}`).join(" ");
}

function SpreadTrend({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const scale = Math.max(0, ...points.map((p) => p.revenue ?? 0)) * 1.08;
  const path = trendPath(points, scale);
  const lastX = TW;
  const lastY =
    TREND_BOTTOM - (Math.max(0, points[points.length - 1].revenue ?? 0) / (scale || 1)) * (TREND_BOTTOM - TREND_TOP);
  return (
    <svg className="sp-trend" viewBox={`0 0 ${TW} ${TH}`} role="img" aria-label="Revenue trend, including the new period">
      <path className="sp-trend-line" d={path} fill="none" pathLength={1} />
      <circle className="sp-trend-new" cx={lastX} cy={lastY} r="4" />
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
  onClose: () => void;
}

export function SpreadingRoom({ ctx, onFileBoom, trend = [], deps, onSpreadEvent, onClose }: SpreadingRoomProps) {
  const engineRef = useRef<SpreadEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createSpreadEngine({ ctx, deps: deps ?? liveDeps(), onFileBoom });
  }
  const engine = engineRef.current;
  const lane = deps?.lane ?? BOOM_UPLOAD_LANE;
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  /** One event per moment, however many times the store wakes this component. */
  const said = useRef<Set<SpreadRoomEvent["phase"]>>(new Set());

  useEffect(() => () => engine.dispose(), [engine]);

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

  const points = useMemo<TrendPoint[]>(() => {
    if (state.stage !== "spread" || state.figures.revenue == null) return trend;
    const period = state.newPeriod ?? "New period";
    if (trend.length && trend[trend.length - 1].period === period) return trend;
    return [...trend, { period, revenue: state.figures.revenue }];
  }, [state.stage, state.figures.revenue, state.newPeriod, trend]);

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
            <div
              className={`sp-drop${over ? " is-over" : ""}`}
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
              <div className="sp-drop-h">{DROP_HEAD(ctx.company)}</div>
              <div className="sp-drop-s">{DROP_SUB}</div>
              <span className="sp-drop-b">{BROWSE}</span>
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

            {state.plan && state.stage === "plan" && (
              <section className="sp-plan" aria-label={PLAN_HEAD}>
                <div className="sp-plan-k">{PLAN_HEAD}</div>
                <p className="sp-plan-s">{state.plan.summary}</p>
                <p className="sp-plan-n">{PLAN_NOTE}</p>
                <button type="button" className="sp-go" onClick={() => void engine.confirm()}>
                  {CONFIRM}
                </button>
              </section>
            )}

            {state.rows.length > 0 && (
              <section className="sp-ladder" aria-label={LADDER_HEAD}>
                <div className="sp-plan-k">{LADDER_HEAD}</div>
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
              </section>
            )}

            {(state.provisional || state.stage === "spread") && (
              <section className="sp-fin" aria-label={FIN_HEAD}>
                <div className="sp-fin-head">
                  <div className="sp-plan-k">{FIN_HEAD}</div>
                  {state.figuresProvisional ? (
                    <span className="sp-badge is-prov">{PROVISIONAL_BADGE}</span>
                  ) : (
                    <span className={`sp-badge${state.validationStatus === "validated" ? " is-ok" : ""}`}>
                      {state.validationStatus === "validated" ? VALIDATED : NOT_VALIDATED}
                    </span>
                  )}
                  {state.validationUrl && (
                    <a className="sp-verify" href={state.validationUrl} target="_blank" rel="noopener noreferrer">
                      {VERIFY}
                    </a>
                  )}
                </div>
                <div className="sp-tiles">
                  {tilesFor(state.figures).map((tile) => (
                    <SpreadTile key={tile.key} tile={tile} />
                  ))}
                </div>
                <SpreadTrend points={points} />
                {state.figuresProvisional && <p className="sp-note">{PROVISIONAL_NOTE}</p>}
                {state.provisional?.lines.map((line) => (
                  <p className="sp-note" key={line}>
                    {line}
                  </p>
                ))}
                {state.stage === "spread" &&
                  (state.statements.length ? (
                    <SpreadStatements statements={state.statements} newPeriod={state.newPeriod} />
                  ) : (
                    <p className="sp-note">{NO_STATEMENTS}</p>
                  ))}
              </section>
            )}

            {state.postRead.length > 0 && (
              <section className="sp-post" aria-label={POST_HEAD}>
                <div className="sp-plan-k">{POST_HEAD}</div>
                <SpreadProse lines={state.postRead} />
              </section>
            )}

            {state.notice && <p className="sp-note" role="status">{state.notice}</p>}
          </div>
        </div>
      </div>
    </Portal>
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
      <ul className="sp-card-l">
        {card.lines.map((line, i) => (
          <li key={`${i}:${line}`}>{line}</li>
        ))}
      </ul>
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

/** THE IS / BS / CF TABS, the Financials tab's table in the room's register.
 *  The new period is the last column and it is marked, because the whole reason
 *  a banker opens this is to see what the new one did. */
function SpreadStatements({
  statements,
  newPeriod,
}: {
  statements: BoomFinancialStatement[];
  newPeriod: string | null;
}) {
  const tabs = statements.filter((s) => TAB_WORD[s.statementType]);
  const [at, setAt] = useState(0);
  const active = tabs[Math.min(at, tabs.length - 1)];
  if (!active) return null;
  const periods = active.periods ?? [];
  return (
    <div className="sp-st">
      <div className="sp-st-tabs" role="tablist">
        {tabs.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === at}
            className={`sp-st-tab${i === at ? " is-on" : ""}`}
            onClick={() => setAt(i)}
          >
            {TAB_WORD[s.statementType]}
          </button>
        ))}
      </div>
      <div className="sp-st-scroll">
        <table className="sp-st-t num">
          <thead>
            <tr>
              <th>Line</th>
              {periods.map((p) => (
                <th key={p.id} className={`r${p.endDate && p.endDate === newPeriod ? " is-new" : ""}`}>
                  {p.endDate ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(active.lineItems ?? []).map((l) => (
              <tr key={l.id} data-hierarchy={l.hierarchy}>
                <td>{l.name}</td>
                {periods.map((p) => (
                  <td key={p.id} className={`r${p.endDate && p.endDate === newPeriod ? " is-new" : ""}`}>
                    {fmtMoney(l.periodValues?.[p.id] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the host */

/** The live dependency set. One place, so the swap to S2 and S3 is the import
 *  block at the top of this file and nothing else. */
function liveDeps(): SpreadDeps {
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
  };
}

/** What the Feedback pill carries. The room's own state in the report's words,
 *  never the file bytes. */
function transcriptOf(state: SpreadState, company: string): string {
  const lines = [
    `# Spread financials — ${company}`,
    `Stage: ${state.stage}`,
    ...state.cards.map((c) => `- ${c.name} (${c.phase}): ${c.lines.join("; ")}`),
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
    covenants: (bundle?.covenants?.covenants ?? []).map((c) => ({
      name: c.covenantType ?? "Covenant",
      operator: covenantDirection(c.covenantType, c.actualValue, c.thresholdValue) === "cap" ? "<=" : ">=",
      threshold: c.thresholdValue ?? null,
      current: c.actualValue ?? null,
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

  if (!ctx || !session) return null;
  return (
    <RoomBoundary what="the spreading room" scope="room">
      <SpreadingRoom
        key={session.accountId}
        ctx={ctx}
        onFileBoom={bundle?.boom ?? null}
        trend={trend}
        onSpreadEvent={onSpreadEvent}
        onClose={closeSpreadingRoom}
      />
    </RoomBoundary>
  );
}
