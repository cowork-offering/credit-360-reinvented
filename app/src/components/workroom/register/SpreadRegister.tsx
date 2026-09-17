import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoomFileStatus, BoomFinancialStatement } from "../../../spread/types";
import { prefersReducedMotion } from "../../../data/motion";
import {
  NOT_MEANINGFUL,
  VALIDATED,
  codeCoverageLine,
  coverage,
  fmtCell,
  isNewPeriod,
  unitCaption,
  validationWord,
  varianceText,
  type RatioSupportLine,
  type RegisterRow,
  type Unit,
} from "./registerModel";
import {
  GHOST_BADGE,
  registerSources,
  sourceRows,
  type GhostStatement,
  type MergedRow,
  type RegisterSource,
} from "./ghostModel";
import "../../../styles/register.css";

/* =============================================================================
   THE STATEMENT REGISTER: Boom's own spreadsheet, in the room's glass.

   A SIBLING OF NOLAND'S BOOM WIDGET, not a second idea of what a spread looks
   like: the statement picker, the period picker, the Full / K / M scale, the
   Variance pair, the account-code chip, the per-period coverage mark and the
   provenance footer are his, ported onto the cockpit's own tokens.

   SINCE 0.9.32 IT HAS TWO STATES ON ONE GRID.

   GHOST. Before Boom has answered, the rows are the room's own pre-read of the
   file's text: every printed line with its figures, in faint ink, at the scale
   the file prints at, with the chip column reserved and RULED so not one row
   moves when the codes land. The rows are APPENDED as they are read, never
   pre-laid and revealed: a table already holding eleven row-heights while one
   row has landed reads as an empty box rather than a register filling. The
   banker can PIN a row here, and a pinned row lights first when Boom answers.

   LIT. Boom's mapped lines land ON those rows. The chips settle at the beat,
   pinned first; a line Boom folded dissolves from its own left edge and the
   line it became settles into the gap; the file's figure is struck beside
   Boom's where the two differ; and one derived sentence accounts for the
   difference. Nothing here is a constant: every word of it comes out of
   `ghostModel.reconcile`, which compares the two sides.

   NO FACT TWICE. The register draws no tiles, no sparkline and no ratio: the
   room's own `sp-tiles` and `SpreadTrend` already carry revenue, EBITDA and
   leverage, and a second copy of them under the grid would be the same fact in
   two places with two chances to disagree.

   THE REGISTER IS CONTENT, NEVER A DOOR. The room's two doors stay on
   `.wk-sheet-acts` below it. The only thing here that leaves the cockpit is the
   provenance footer's link back into Boom, which is a citation and not an
   action.

   COMPACT IS A SUMMARY, NOT A SMALLER ROOM (founder, 2026-09-15). The mapped
   account code and the row gutter are the ROOM's insight, and at the tab's
   506 px card those two columns took 190 px and pushed FY2025, the column read
   first, off the right edge. The tab therefore drops both, keeps the mis-map
   flag as a dot after the line name, and prints Variance % without the absolute
   pair. Compact never carries a ghost: the tab reads the book, not a drop.

   ADJUSTED IS A RE-READ, NOT A FILTER. `onAdjustedChange` hands the decision
   back to the caller, which calls Boom again with `adjusted` flipped. The
   register never derives an adjusted figure locally.
   ============================================================================= */

export interface SpreadRegisterProvenance {
  /** Boom's own name for the file. */
  fileName?: string | null;
  /** The envelope's `_source`: "BOOM-LIVE" on the live lane. */
  source?: string | null;
  /** `boom_get_ratios` `support.method`, where the ratios were fetched. */
  method?: string | null;
}

export interface SpreadRegisterProps {
  /** Every statement Boom returned. Empty until it answers. */
  statements: BoomFinancialStatement[];
  /** `boom_get_ratios` `support.lines`: which line feeds which headline figure. */
  support?: RatioSupportLine[] | null;
  /** THE ROOM'S OWN PRE-READ, as the register draws it before Boom answers. */
  ghost?: readonly GhostStatement[] | null;
  /** THE FILES BOOM COULD NOT READ, by dropped file id, with its own words
   *  where it gave any. A key with an empty value is a refusal with no reason,
   *  which is still a refusal. */
  failures?: Readonly<Record<string, string>> | null;
  /** BOOM HAS ANSWERED FOR THIS DROP. A statement still carrying the room's own
   *  reading after that is one Boom did not read, and the line says so rather
   *  than going on promising a mapping that is not coming. */
  settled?: boolean;
  /** Where the file got to on Boom's ladder, which is what the validation word
   *  is read off: a `completed` file is not a validated one. */
  fileStatus?: BoomFileStatus | null;
  mode?: "room" | "compact";
  adjusted: boolean;
  /** The caller re-reads the server. The register never filters for adjusted. */
  onAdjustedChange?: (next: boolean) => void;
  /** The period a fresh upload added, marked the room's way. */
  newPeriodEnd?: string | null;
  /** The rows the banker is watching, by row key, and the way to set one. */
  pinned?: ReadonlySet<string> | null;
  onTogglePin?: (key: string, name: string) => void;
  /** The analyst verification page, ONCE the room has been asked to mint one.
   *  Null until then, and that is the design: the session token lives 60
   *  minutes and is spent on a click, never at render (row 61, 0.9.29). */
  verificationUrl?: string | null;
  /** Ask Boom for that page. Absent where the lane has none to give, and the
   *  control is then not drawn at all. */
  onVerify?: () => void;
  /** The call is out. */
  verifying?: boolean;
  /** Boom's own words on a refusal. Shown INSTEAD of a link, never beside one. */
  verifyError?: string | null;
  provenance?: SpreadRegisterProvenance | null;
}

const STATEMENT_LABEL = "Statement";
const PERIODS_LABEL = "Periods shown";
const UNITS_LABEL = "Display units";
const FIGURES_LABEL = "Figures";
const VARIANCE = "Variance";
const VARIANCE_PCT = "Variance %";
const ADJUSTED = "Adjusted";
const AS_GIVEN = "As given";
const CODE_HEAD = "Mapped account code";
const LINE_HEAD = "Reported line item";
const UNMAPPED = "unmapped";
const OPEN_IN_BOOM = "Open in Boom";
const OPENING_BOOM = "Opening Boom";
const SPREAD_BY_BOOM = "Spread by Boom";
const MISMAP_TITLE = "Boom returned no account code for this line, so it is not in Boom's aggregate.";
const NOT_MEANINGFUL_TITLE = "Not meaningful: the prior period is zero or negative.";
const NOT_READ_BADGE = "Boom did not read this file";
const NO_SPREAD_BADGE = "Boom returned no spread for this statement";
const COMPACT_PERIODS = 3;

const pinLabel = (name: string, on: boolean): string => `${on ? "Stop watching" : "Watch"} ${name}`;
const unmappedStand = (n: number): string =>
  `The ${n} line${n === 1 ? "" : "s"} this room read off the page stand below, unmapped`;

const UNITS: Array<[Unit, string]> = [["full", "Full"], ["k", "K"], ["m", "M"]];

/* THE BEATS OF THE ARRIVAL, at the governed stage's own pace (stage.css): rows
   append at the fast step, the chips settle one per 80 ms, the difference is
   held for a moment so the eye finds it, and then the fold dissolves. */
const BEAT = { row: 130, chip: 80, hold: 340, dissolve: 520 } as const;

const coverageTitle = (label: string, on: boolean): string =>
  on
    ? `Every line on this statement carries a figure for ${label}.`
    : `At least one line carries no figure for ${label}.`;

/** The columns the grid draws, whichever side the source has. */
interface Column {
  id: string;
  label: string;
  endDate: string | null;
}

function columnsOf(source: RegisterSource): Column[] {
  if (source.boom) return source.boom.periods.map((p) => ({ id: p.id, label: p.label, endDate: p.endDate }));
  return (source.ghost?.periods ?? []).map((p) => ({ id: p.key, label: p.key, endDate: p.endDate }));
}

export function SpreadRegister({
  statements,
  support = null,
  ghost = null,
  failures = null,
  settled = false,
  fileStatus = null,
  mode = "room",
  adjusted,
  onAdjustedChange,
  newPeriodEnd = null,
  pinned = null,
  onTogglePin,
  verificationUrl = null,
  onVerify,
  verifying = false,
  verifyError = null,
  provenance = null,
}: SpreadRegisterProps) {
  const compact = mode === "compact";
  const reduced = prefersReducedMotion();
  const sources = useMemo(
    () => registerSources({ statements, ghost: compact ? null : ghost, adjusted, support }),
    [statements, ghost, compact, adjusted, support],
  );

  const [at, setAt] = useState(0);
  const [unit, setUnit] = useState<Unit>("k");
  const [showVariance, setShowVariance] = useState(true);
  /* Hidden rather than shown, so a statement the banker has not touched opens on
     every period it carries and a period Boom adds later is not silently out. */
  const [hidden, setHidden] = useState<Record<string, true>>({});

  const active: RegisterSource | undefined = sources[Math.min(at, sources.length - 1)];
  const activeId = active?.id ?? "";
  const lit = Boolean(active?.lit);
  const hasGhost = Boolean(active?.ghost);
  const ghostCount = active?.ghost?.rows.length ?? 0;
  const folds = active?.recon?.folded ?? 0;

  /* ------------------------------------------------ the register writes itself

     THE ROWS ARE APPENDED AS THEY ARE READ. `reveal` is how many entries of the
     list are on the glass; null is all of them, which is what reduced motion and
     every jsdom test see, in one commit. */
  const [reveal, setReveal] = useState<number | null>(null);
  useEffect(() => {
    if (compact || reduced || lit || !ghostCount) {
      setReveal(null);
      return;
    }
    setReveal((held) => (held == null ? 0 : Math.min(held, ghostCount)));
    const timers: number[] = [];
    for (let i = 1; i <= ghostCount; i += 1) {
      timers.push(window.setTimeout(() => setReveal(i >= ghostCount ? null : i), (i - 1) * BEAT.row));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [compact, reduced, lit, ghostCount, activeId]);

  /* ------------------------------------------------------- the arrival beats

     CHIPS -> HOLD -> DISSOLVE -> SETTLED. The printed lines stay on the glass
     until the fold has dissolved, which is what makes the line they became
     settle into their gap rather than appear beside them. */
  const [beat, setBeat] = useState<"chips" | "hold" | "dissolve" | "settled">("settled");
  const [chipped, setChipped] = useState<number>(Number.MAX_SAFE_INTEGER);
  useEffect(() => {
    if (!lit || !hasGhost || reduced) {
      setBeat("settled");
      setChipped(Number.MAX_SAFE_INTEGER);
      return;
    }
    setBeat("chips");
    setChipped(0);
    const timers: number[] = [];
    for (let i = 1; i <= ghostCount; i += 1) {
      timers.push(window.setTimeout(() => setChipped(i), i * BEAT.chip));
    }
    const chipsDone = ghostCount * BEAT.chip;
    timers.push(window.setTimeout(() => setBeat("hold"), chipsDone));
    if (folds) {
      timers.push(window.setTimeout(() => setBeat("dissolve"), chipsDone + BEAT.hold));
      timers.push(window.setTimeout(() => setBeat("settled"), chipsDone + BEAT.hold + BEAT.dissolve));
    } else {
      timers.push(window.setTimeout(() => setBeat("settled"), chipsDone + BEAT.hold));
    }
    return () => timers.forEach(window.clearTimeout);
  }, [lit, hasGhost, reduced, ghostCount, folds, activeId]);

  /* THE TAB OPENS ON THE NEWEST PERIOD. Where the card is too narrow for the
     grid, the default scroll position would sit on the oldest column, which is
     the one a banker reads last. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const allColumns = active ? columnsOf(active) : [];
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!compact || !box) return;
    box.scrollLeft = box.scrollWidth;
  }, [compact, activeId, allColumns.length]);

  if (!active) return null;

  const unread = Boolean(active.ghost) && !lit && settled;
  /* A FILE BOOM REFUSED AND A STATEMENT BOOM SIMPLY DID NOT RETURN ARE NOT THE
     SAME THING, and the badge says which. Boom read the file that carries this
     balance sheet; what it did not do is return a balance sheet. */
  const fileId = active.ghost?.fileId;
  const refused = fileId != null && failures != null && Object.hasOwn(failures, fileId);
  const failure = refused && fileId != null ? failures[fileId] : "";
  /* THE VARIANCE PAIR IS THE REGISTER'S ARITHMETIC, NOT THE FILE'S. The ghost
     is the page as printed, and a derived column over it would be the room
     asserting a comparison Boom has not made yet. It arrives with the control. */
  const variance = compact ? true : lit && showVariance;
  /* The absolute pair is the room's. The tab has one variance column, the
     percentage, because a change in dollars is the figure the room already
     carries and the percentage is the one that reads at a glance. */
  const varianceAbs = variance && !compact;
  /* THE GHOST IS READ AT THE SCALE THE FILE PRINTS AT, which is what the label
     beside it claims; Boom's own spread is read at the banker's scale. */
  const scale: Unit = compact ? "k" : lit ? unit : (active.ghost?.unit ?? unit);

  const kept = compact ? allColumns : allColumns.filter((p) => !hidden[p.id]);
  const columns = compact ? kept.slice(-COMPACT_PERIODS) : kept;
  const keptIndexes = columns.map((p) => allColumns.findIndex((q) => q.id === p.id));

  const merged: MergedRow[] = sourceRows(active, beat !== "settled");
  const visible = reveal == null || lit ? merged : merged.slice(0, reveal);
  const rows = visible.map((r) => ({
    ...r,
    values: keptIndexes.map((i) => r.values[i] ?? null),
    fileValues: r.fileValues ? keptIndexes.map((i) => r.fileValues?.[i] ?? null) : null,
  }));
  const covered = coverage(rows as unknown as RegisterRow[], columns.length);
  const last = columns.length - 1;
  const latestEnd = allColumns.length ? allColumns[allColumns.length - 1].label : null;

  const provLine = [
    provenance?.fileName,
    latestEnd ? `period ending ${latestEnd}` : null,
    provenance?.source,
    provenance?.method ? `method ${provenance.method}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  /* THE PINNED ROW ANSWERS FIRST. The order the chips settle in is the banker's
     own: the line they said they were watching is the line that lights first. */
  const chipOrder = new Map<number, number>();
  rows
    .map((r, i) => ({ i, on: pinned?.has(r.key) ?? false }))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.i - b.i)
    .forEach((x, order) => chipOrder.set(x.i, order));

  /* ONE LOCAL FOR BOOM'S SIDE OF THE SOURCE, and it is not called `boom` or
     `spread`: those are the BUNDLE's own roots everywhere else in this app, and
     the provenance audit (`data/provenance.test.ts`) reads the names literally. */
  const answered = active.boom;
  const word = validationWord({ statementValidated: answered?.validated ?? null, fileStatus });

  const body = rows.map((r, idx) => {
    const isPinned = pinned?.has(r.key) ?? false;
    const settled = hasGhost ? lit && (chipOrder.get(idx) ?? 0) < chipped : lit;
    if (r.hierarchy === "header") {
      return (
        <tr key={r.id} className="rg-sect" data-hierarchy="header">
          {!compact && <td className="rg-g">{idx + 1}</td>}
          <td colSpan={(compact ? 1 : 2) + columns.length + (varianceAbs ? 1 : 0) + (variance ? 1 : 0)}>{r.name}</td>
        </tr>
      );
    }
    const pair = variance ? varianceText(r.values[last] ?? null, r.values[last - 1] ?? null, scale) : null;
    return (
      <tr
        key={r.id}
        data-hierarchy={r.hierarchy}
        data-ghost={settled ? undefined : ""}
        data-lit={settled && hasGhost ? "" : undefined}
        data-verdict={settled && r.verdict ? r.verdict : undefined}
        data-fold={r.folding && beat === "dissolve" ? "out" : undefined}
        data-pin={isPinned ? "" : undefined}
        data-row={r.key}
      >
        {!compact && (
          <td className="rg-g">
            {onTogglePin ? (
              <button
                type="button"
                className="rg-pin"
                aria-pressed={isPinned}
                aria-label={pinLabel(r.name, isPinned)}
                onClick={() => onTogglePin(r.key, r.name)}
              >
                <span className="rg-pin-n">{idx + 1}</span>
                <span className="rg-pin-m" aria-hidden="true">
                  {isPinned ? "●" : "○"}
                </span>
              </button>
            ) : (
              idx + 1
            )}
          </td>
        )}
        {!compact && (
          <td className="rg-c">
            {/* THE BLANK THE CHIP SETTLES ONTO. The column is reserved and ruled
                from the first ghost row, so the row height is identical before
                and after Boom answers and not one line moves when they land. */}
            <span className="rg-chipbox">
              <i className="rg-rule" aria-hidden="true" />
              {settled && (
                <span
                  className={`rg-cat rg-cat--${r.family}`}
                  title={r.code ? `Boom account code ${r.code}` : MISMAP_TITLE}
                >
                  <span className="rg-cat-a">{r.abbr}</span>
                  <span className="rg-cat-l">{r.code ?? UNMAPPED}</span>
                </span>
              )}
            </span>
            {settled && r.mismapped && (
              <span className="rg-flag" title={MISMAP_TITLE} aria-label={MISMAP_TITLE}>
                !
              </span>
            )}
          </td>
        )}
        <td className="rg-i">
          <span className="rg-nm">{r.name}</span>
          {compact && r.mismapped && (
            <span className="rg-dot" role="img" title={MISMAP_TITLE} aria-label={MISMAP_TITLE} />
          )}
          {r.feeds.length > 0 && <span className="rg-feeds">{`feeds ${r.feeds.join(", ")}`}</span>}
          {settled && r.note && <span className="rg-note">{r.note}</span>}
        </td>
        {columns.map((p, i) => {
          const v = r.values[i] ?? null;
          const was = settled ? (r.fileValues?.[i] ?? null) : null;
          return (
            <td
              key={p.id}
              className={`rg-v${v != null && v < 0 ? " is-neg" : ""}${isNewPeriod(p.endDate, newPeriodEnd) ? " is-new" : ""}`}
            >
              {was != null && was !== v && <span className="rg-was">{fmtCell(was, scale)}</span>}
              {fmtCell(v, scale)}
            </td>
          );
        })}
        {pair && varianceAbs && <td className="rg-v rg-var">{pair.value}</td>}
        {pair && (
          <td className="rg-p rg-var" title={pair.pct === NOT_MEANINGFUL ? NOT_MEANINGFUL_TITLE : undefined}>
            {pair.pct}
          </td>
        )}
      </tr>
    );
  });

  return (
    <section className="rg" data-mode={mode} data-ghost={lit ? undefined : ""} aria-label="Statement register">
      <div className="rg-ctl">
        <label className="rg-pick">
          <span className="rg-sr">{STATEMENT_LABEL}</span>
          <select
            className="rg-sel"
            value={String(Math.min(at, sources.length - 1))}
            aria-label={STATEMENT_LABEL}
            onChange={(e) => {
              setAt(Number(e.target.value));
              setHidden({});
            }}
          >
            {sources.map((s, i) => (
              <option key={s.id} value={String(i)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {/* THE CONTROLS ARRIVE WITH THE SPREAD. Before Boom answers there is one
            reading of one file and nothing to switch between; a period chip, a
            scale and an adjusted basis over a register that is not Boom's would
            each be offering a choice the room cannot honour. */}
        {!compact && lit && (
          <span className="rg-late">
            <div className="rg-chips" role="group" aria-label={PERIODS_LABEL}>
              {allColumns.map((p) => {
                const on = !hidden[p.id];
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`wk-opt rg-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      setHidden((h) => {
                        const next = { ...h };
                        if (on) next[p.id] = true;
                        else delete next[p.id];
                        return next;
                      })
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="rg-seg" role="group" aria-label={UNITS_LABEL}>
              {UNITS.map(([u, said]) => (
                <button
                  key={u}
                  type="button"
                  className="wk-opt rg-segb"
                  aria-pressed={u === unit}
                  onClick={() => setUnit(u)}
                >
                  {said}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`wk-opt rg-tog${showVariance ? " is-on" : ""}`}
              aria-pressed={showVariance}
              onClick={() => setShowVariance((v) => !v)}
            >
              {VARIANCE}
            </button>

            {onAdjustedChange && (
              <div className="rg-seg rg-adj" role="group" aria-label={FIGURES_LABEL}>
                <button
                  type="button"
                  className="wk-opt rg-segb"
                  aria-pressed={adjusted}
                  onClick={() => onAdjustedChange(true)}
                >
                  {ADJUSTED}
                </button>
                <button
                  type="button"
                  className="wk-opt rg-segb"
                  aria-pressed={!adjusted}
                  onClick={() => onAdjustedChange(false)}
                >
                  {AS_GIVEN}
                </button>
              </div>
            )}
          </span>
        )}
      </div>

      {/* WHAT THIS REGISTER IS, IN ONE LINE. Before Boom: the file, its periods
          and the scale it prints at, under the word that says nothing on it is
          Boom's yet. After Boom: the validation word Boom's own ladder earns,
          the code coverage, and the scale on the glass. */}
      <p className="rg-line">
        {unread ? (
          <>
            <span className="sp-badge is-prov">{refused ? NOT_READ_BADGE : NO_SPREAD_BADGE}</span>
            {/* BOOM'S OWN WORDS WHERE IT GAVE ANY, and nothing invented where it
                did not: a refusal with no reason is still a refusal. */}
            {failure && (
              <>
                <span className="rg-sep" aria-hidden="true">
                  ·
                </span>
                <span>{`Boom's words: ${failure}`}</span>
              </>
            )}
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            <span>{unmappedStand(active.ghost?.rows.length ?? 0)}</span>
          </>
        ) : lit ? (
          <>
            <span className={`sp-badge${word === VALIDATED ? " is-ok" : " is-prov"}`}>{word}</span>
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            {codeCoverageLine(answered?.mapped ?? 0, answered?.mappable ?? 0)}
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            {unitCaption(scale)}
          </>
        ) : (
          <>
            <span className="sp-badge is-ghost">{GHOST_BADGE}</span>
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            <span>{active.ghost?.fileName}</span>
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            <span>{allColumns.map((p) => p.label).join(", ")}</span>
            <span className="rg-sep" aria-hidden="true">
              ·
            </span>
            <span>{active.ghost?.unitsWord}</span>
          </>
        )}
      </p>

      {/* THE RECONCILIATION, DERIVED. A statement where Boom changed nothing
          gets no sentence: written where there is no difference it is
          furniture, and written for the wrong statement it is false. */}
      {lit && beat === "settled" && active.recon?.sentence && <p className="rg-recon">{active.recon.sentence}</p>}

      <div className="rg-scroll" ref={scrollRef}>
        <table className="rg-t">
          <colgroup>
            {!compact && <col className="rg-cg" />}
            {!compact && <col className="rg-cc" />}
            <col className="rg-ci" />
            {columns.map((p) => (
              <col key={p.id} className="rg-cv" />
            ))}
            {varianceAbs && <col className="rg-cv" />}
            {variance && <col className="rg-cp" />}
          </colgroup>
          <thead>
            <tr>
              {!compact && (
                <th className="rg-g" scope="col">
                  <span className="rg-sr">Row</span>
                </th>
              )}
              {!compact && (
                <th className="rg-c" scope="col">
                  {CODE_HEAD}
                </th>
              )}
              <th className="rg-i" scope="col">
                {LINE_HEAD}
              </th>
              {columns.map((p, i) => (
                <th key={p.id} scope="col" className={`rg-v${isNewPeriod(p.endDate, newPeriodEnd) ? " is-new" : ""}`}>
                  <span
                    className={`rg-tick${covered[i] ? " is-on" : ""}`}
                    title={coverageTitle(p.label, covered[i])}
                    aria-hidden="true"
                  >
                    {covered[i] ? "✓" : "○"}
                  </span>
                  {p.label}
                </th>
              ))}
              {varianceAbs && (
                <th className="rg-v" scope="col">
                  {VARIANCE}
                </th>
              )}
              {variance && (
                <th className="rg-p" scope="col">
                  {VARIANCE_PCT}
                </th>
              )}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      {/* THE FOOTER IS THE ROOM'S; THE CONTROL IS EVERYONE'S (0.9.31, founder
          live: "where is the open in boom button there is none"). The citation
          is the room's alone, because the tab already names its own source in
          its Note and a second copy would be a fact twice. What the tab was
          missing is the DOOR, and a banker who can read a spread must be able to
          open it where it lives, so compact carries the control alone. NEITHER
          is drawn over a register Boom has not answered: there is nothing there
          to cite and nothing to open. */}
      {lit && ((!compact && provLine) || verificationUrl || onVerify || verifyError) ? (
        <div className="rg-prov" data-mode={mode}>
          {!compact && <b>{SPREAD_BY_BOOM}</b>}
          {!compact && provLine && <span className="rg-provline">{provLine}</span>}
          {verifyError && <span className="rg-proverr">{verifyError}</span>}
          {/* THE LINK ONLY ONCE BOOM HAS MINTED THE SESSION. Before that the
              control is a BUTTON that asks for one, because there is no URL to
              put in an href and a link to nowhere is the defect row 61 opened
              on. After it, the real anchor, so the banker's own click is what
              navigates and no popup blocker sits between them and the page. */}
          {verificationUrl ? (
            <a className="rg-provlink" href={verificationUrl} target="_blank" rel="noreferrer">
              {OPEN_IN_BOOM}
            </a>
          ) : (
            onVerify && (
              <button type="button" className="rg-provlink" onClick={onVerify} disabled={verifying}>
                {verifying ? OPENING_BOOM : OPEN_IN_BOOM}
              </button>
            )
          )}
        </div>
      ) : null}
    </section>
  );
}
