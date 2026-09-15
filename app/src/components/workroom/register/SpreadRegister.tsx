import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoomFinancialStatement } from "../../../spread/types";
import {
  NOT_MEANINGFUL,
  NOT_VALIDATED,
  VALIDATED,
  codeCoverageLine,
  coverage,
  fmtCell,
  isNewPeriod,
  registerStatements,
  unitCaption,
  varianceText,
  type RatioSupportLine,
  type RegisterStatement,
  type Unit,
} from "./registerModel";
import "../../../styles/register.css";

/* =============================================================================
   THE STATEMENT REGISTER: Boom's own spreadsheet, in the room's glass.

   A SIBLING OF NOLAND'S BOOM WIDGET, not a second idea of what a spread looks
   like: the statement picker, the period picker, the Full / K / M scale, the
   Variance pair, the account-code chip, the per-period coverage mark and the
   provenance footer are his, ported onto the cockpit's own tokens.

   NO FACT TWICE. The register draws no tiles, no sparkline and no ratio: the
   room's own `sp-tiles` and `SpreadTrend` already carry revenue, EBITDA and
   leverage, and a second copy of them under the grid would be the same fact in
   two places with two chances to disagree. What the register adds is the thing
   the tiles cannot show: every line, every period, and where each figure came
   from.

   THE REGISTER IS CONTENT, NEVER A DOOR. The room's two doors stay on
   `.wk-sheet-acts` below it. The only thing here that leaves the cockpit is the
   provenance footer's link back into Boom, which is a citation and not an
   action.

   COMPACT IS A SUMMARY, NOT A SMALLER ROOM (founder, 2026-09-15). The mapped
   account code and the row gutter are the ROOM's insight: which Boom code each
   line landed on is what a banker checks when they are auditing the spread, and
   at the tab's 506 px card those two columns took 190 px and pushed FY2025, the
   column read first, off the right edge. The tab therefore drops both, keeps the
   mis-map flag as a dot after the line name, and prints Variance % without the
   absolute pair, so the three newest periods fit the card with nothing to
   scroll. Where the card is narrower still the grid scrolls, and it OPENS ON THE
   NEWEST PERIOD: a spread that opens on the oldest column is a spread the banker
   has to drag before they can read it.

   ADJUSTED IS A RE-READ, NOT A FILTER. `onAdjustedChange` hands the decision
   back to the caller, which calls Boom again with `adjusted` flipped. The
   register never derives an adjusted figure locally, because every derived
   figure on the surface changes with it.
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
  /** Every statement the file carries, as Boom returned them. */
  statements: BoomFinancialStatement[];
  /** `boom_get_ratios` `support.lines`: which line feeds which headline figure. */
  support?: RatioSupportLine[] | null;
  mode?: "room" | "compact";
  adjusted: boolean;
  /** The caller re-reads the server. The register never filters for adjusted. */
  onAdjustedChange?: (next: boolean) => void;
  /** The period a fresh upload added, marked the room's way. */
  newPeriodEnd?: string | null;
  /** The analyst verification page, where the room holds one. */
  verificationUrl?: string | null;
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
const SPREAD_BY_BOOM = "Spread by Boom";
const MISMAP_TITLE = "Boom returned no account code for this line, so it is not in Boom's aggregate.";
const NOT_MEANINGFUL_TITLE = "Not meaningful: the prior period is zero or negative.";
const COMPACT_PERIODS = 3;

const UNITS: Array<[Unit, string]> = [["full", "Full"], ["k", "K"], ["m", "M"]];

const coverageTitle = (label: string, on: boolean): string =>
  on
    ? `Every line on this statement carries a figure for ${label}.`
    : `At least one line carries no figure for ${label}.`;

export function SpreadRegister({
  statements,
  support = null,
  mode = "room",
  adjusted,
  onAdjustedChange,
  newPeriodEnd = null,
  verificationUrl = null,
  provenance = null,
}: SpreadRegisterProps) {
  const compact = mode === "compact";
  const shaped = useMemo(
    () => registerStatements(statements, { adjusted, support }),
    [statements, adjusted, support],
  );

  const [at, setAt] = useState(0);
  const [unit, setUnit] = useState<Unit>("k");
  const [showVariance, setShowVariance] = useState(true);
  /* Hidden rather than shown, so a statement the banker has not touched opens on
     every period it carries and a period Boom adds later is not silently out. */
  const [hidden, setHidden] = useState<Record<string, true>>({});

  const active: RegisterStatement | undefined = shaped[Math.min(at, shaped.length - 1)];
  const variance = compact ? true : showVariance;
  /* The absolute pair is the room's. The tab has one variance column, the
     percentage, because a change in dollars is the figure the room already
     carries and the percentage is the one that reads at a glance. */
  const varianceAbs = variance && !compact;
  const scale: Unit = compact ? "k" : unit;

  const periods = useMemo(() => {
    if (!active) return [];
    const kept = compact ? active.periods : active.periods.filter((p) => !hidden[p.id]);
    return compact ? kept.slice(-COMPACT_PERIODS) : kept;
  }, [active, compact, hidden]);

  /* THE TAB OPENS ON THE NEWEST PERIOD. Where the card is too narrow for the
     grid, the default scroll position would sit on the oldest column, which is
     the one a banker reads last. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!compact || !box) return;
    box.scrollLeft = box.scrollWidth;
  }, [compact, active?.id, periods.length]);

  if (!active) return null;

  const keptIndexes = periods.map((p) => active.periods.findIndex((q) => q.id === p.id));
  const rows = active.rows.map((r) => ({ ...r, values: keptIndexes.map((i) => r.values[i] ?? null) }));
  const covered = coverage(rows, periods.length);
  const last = periods.length - 1;
  const latestEnd = active.periods.length ? active.periods[active.periods.length - 1].label : null;

  const provLine = [
    provenance?.fileName,
    latestEnd ? `period ending ${latestEnd}` : null,
    provenance?.source,
    provenance?.method ? `method ${provenance.method}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="rg" data-mode={mode} aria-label="Statement register">
      <div className="rg-ctl">
        <label className="rg-pick">
          <span className="rg-sr">{STATEMENT_LABEL}</span>
          <select
            className="rg-sel"
            value={String(at)}
            aria-label={STATEMENT_LABEL}
            onChange={(e) => {
              setAt(Number(e.target.value));
              setHidden({});
            }}
          >
            {shaped.map((s, i) => (
              <option key={s.id} value={String(i)}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {!compact && (
          <div className="rg-chips" role="group" aria-label={PERIODS_LABEL}>
            {active.periods.map((p) => {
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
        )}

        {!compact && (
          <div className="rg-seg" role="group" aria-label={UNITS_LABEL}>
            {UNITS.map(([u, word]) => (
              <button
                key={u}
                type="button"
                className="wk-opt rg-segb"
                aria-pressed={u === unit}
                onClick={() => setUnit(u)}
              >
                {word}
              </button>
            ))}
          </div>
        )}

        {!compact && (
          <button
            type="button"
            className={`wk-opt rg-tog${showVariance ? " is-on" : ""}`}
            aria-pressed={showVariance}
            onClick={() => setShowVariance((v) => !v)}
          >
            {VARIANCE}
          </button>
        )}

        {!compact && onAdjustedChange && (
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
      </div>

      <p className="rg-line">
        <span className={`sp-badge${active.validated ? " is-ok" : " is-prov"}`}>
          {active.validated ? VALIDATED : NOT_VALIDATED}
        </span>
        <span className="rg-sep" aria-hidden="true">
          ·
        </span>
        {codeCoverageLine(active.mapped, active.mappable)}
        <span className="rg-sep" aria-hidden="true">
          ·
        </span>
        {unitCaption(scale)}
      </p>

      <div className="rg-scroll" ref={scrollRef}>
        <table className="rg-t">
          <colgroup>
            {!compact && <col className="rg-cg" />}
            {!compact && <col className="rg-cc" />}
            <col className="rg-ci" />
            {periods.map((p) => (
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
              {periods.map((p, i) => (
                <th
                  key={p.id}
                  scope="col"
                  className={`rg-v${isNewPeriod(p.endDate, newPeriodEnd) ? " is-new" : ""}`}
                >
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
          <tbody>
            {rows.map((r, idx) => {
              if (r.hierarchy === "header") {
                return (
                  <tr key={r.id} className="rg-sect" data-hierarchy="header">
                    {!compact && <td className="rg-g">{idx + 1}</td>}
                    <td colSpan={(compact ? 1 : 2) + periods.length + (varianceAbs ? 1 : 0) + (variance ? 1 : 0)}>
                      {r.name}
                    </td>
                  </tr>
                );
              }
              const pair = variance ? varianceText(r.values[last] ?? null, r.values[last - 1] ?? null, scale) : null;
              return (
                <tr key={r.id} data-hierarchy={r.hierarchy}>
                  {!compact && <td className="rg-g">{idx + 1}</td>}
                  {!compact && (
                    <td className="rg-c">
                      <span className={`rg-cat rg-cat--${r.family}`} title={r.code ? `Boom account code ${r.code}` : MISMAP_TITLE}>
                        <span className="rg-cat-a">{r.abbr}</span>
                        <span className="rg-cat-l">{r.code ?? UNMAPPED}</span>
                      </span>
                      {r.mismapped && (
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
                  </td>
                  {periods.map((p, i) => {
                    const v = r.values[i] ?? null;
                    return (
                      <td
                        key={p.id}
                        className={`rg-v${v != null && v < 0 ? " is-neg" : ""}${isNewPeriod(p.endDate, newPeriodEnd) ? " is-new" : ""}`}
                      >
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
            })}
          </tbody>
        </table>
      </div>

      {!compact && (provLine || verificationUrl) && (
        <div className="rg-prov">
          <b>{SPREAD_BY_BOOM}</b>
          {provLine && <span className="rg-provline">{provLine}</span>}
          {verificationUrl && (
            <a className="rg-provlink" href={verificationUrl} target="_blank" rel="noreferrer">
              {OPEN_IN_BOOM}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
