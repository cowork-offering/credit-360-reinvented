import type { BorrowerBundle, Covenant } from "../../data/contract";
import { fmtMoney, fmtPct } from "../../data/format";
import { fmtRatio } from "../../data/finance";
import { isProvisionalPeriod } from "../../spread/publishSpread";
import { EmptyPane, Fig, Note, Pane, PaneCard, SecHead, Status, type StatusTone } from "./paneKit";

const EXPLAIN =
  "Explain these financials: the EBITDA trend, leverage, and interest coverage.";

/* THE SPREADING ROOM'S PERIOD SAYS WHAT IT IS (item 18, BOOM-UPLOAD-SPEC §3).
   A period this session published from the Spreading room while the Boom
   connector does not exist is the room's own read of the banker's file, not
   Boom's spread and not signed off by an analyst. It shows here, in the tab's
   own register, with the word on it. The badge renders ONLY on a provisional
   period, so a tab reading Boom's own spread is the tab it has always been. */
const PROVISIONAL_BADGE = "Provisional, Boom verification pending";

/* The trend chart's own box, the dummy's: a 720x190 field with three grid
   lines and the axis labels on the baseline. */
const CW = 720;
const CH = 190;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 158;
/** Headroom above the tallest point, so the line never welds itself to the top
 *  edge of the field. */
const SCALE_HEADROOM = 1.08;

function findLeverage(covs: Covenant[]): Covenant | null {
  for (const c of covs) {
    const t = (c.covenantType ?? "").toLowerCase();
    if (t.includes("leverage") || t.includes("debt-to-worth") || t.includes("debt to worth")) return c;
  }
  return null;
}

/** ONE CHART LINE (systemNonNegotiable: purple discipline). Straight segments
 *  between period ends on purpose: a spline through four quarter-ends would
 *  draw interpolation the spread does not contain. */
function revenuePath(values: Array<number | null | undefined>, scale: number): string {
  const n = values.length;
  if (!n || scale <= 0) return "";
  const x = (i: number) => (n === 1 ? CW / 2 : (i / (n - 1)) * CW);
  const y = (v: number) => PLOT_BOTTOM - (Math.max(0, v) / scale) * (PLOT_BOTTOM - PLOT_TOP);
  return values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`).join(" ");
}

/** A ratio against its ceiling, in one word. Null threshold means the org gave
 *  no ceiling to read it against, and silence is the honest answer. */
function ratioTone(
  val: number | undefined,
  threshVal: number | null,
  higherIsWorse: boolean,
): StatusTone | null {
  if (val == null || threshVal == null) return null;
  const bad = higherIsWorse ? val > threshVal : val < threshVal;
  if (bad) return "bad";
  return Math.abs(threshVal - val) < 0.4 ? "warn" : "good";
}

export function FinancialsTab({ bundle }: { bundle: BorrowerBundle }) {
  const boom = bundle.boom;
  if (!boom || (!boom.spread && !boom.ratios)) {
    return (
      <Pane id="financials">
        <PaneCard>
          <SecHead kicker="Financials" sub="Boom spreading" explain={EXPLAIN} />
          <EmptyPane title="Boom spread not fetched this session" body="Ask for the spread and it fills in." />
        </PaneCard>
      </Pane>
    );
  }

  const spread = boom.spread ?? {};
  const ratios = boom.ratios ?? {};
  const periods = spread.periods ?? [];
  const covs = bundle.covenants?.covenants ?? [];
  const levCov = findLeverage(covs);
  const items = spread.lineItems ?? [];

  const revenues = periods.map((p) => p.revenue ?? 0);
  const scale = Math.max(0, ...revenues) * SCALE_HEADROOM;
  const revPath = revenuePath(revenues, scale);
  const latest = periods.length ? periods[periods.length - 1] : null;
  const prior = periods.length > 1 ? periods[periods.length - 2] : null;
  const revDelta =
    latest?.revenue != null && prior?.revenue != null && prior.revenue !== 0
      ? ((latest.revenue - prior.revenue) / Math.abs(prior.revenue)) * 100
      : null;

  const levTone = ratioTone(ratios.totalLeverage, levCov?.thresholdValue ?? null, true);
  /* THE BADGE FINDS THE PROVISIONAL PERIOD WHEREVER IT SITS. A spread can land
     on a period that is not the last one on the trend: a book carrying its own
     trailing-twelve-months row keeps that row last while the year the banker
     just dropped sits before it. Badging only the last period hid the word
     entirely on exactly those relationships. The newest period carrying it is
     the one named, and it is NAMED whenever it is not the headline period,
     because a badge beside a figure it is not about is worse than no badge. */
  const provisional = [...periods].reverse().find((p) => isProvisionalPeriod(p)) ?? null;
  const provisionalLabel =
    provisional && provisional !== latest && provisional.period
      ? `${provisional.period} · ${PROVISIONAL_BADGE}`
      : PROVISIONAL_BADGE;

  return (
    <Pane id="financials">
      <div className="pane-grid">
        {periods.length > 0 && (
          <PaneCard style={{ gridColumn: "1/-1" }}>
            <SecHead kicker="Boom spreading" sub="Revenue trend" explain={EXPLAIN} />
            <div className="bigfig num">
              <span className="n">
                <Fig>{fmtMoney(latest?.revenue)}</Fig>
              </span>
              {revDelta != null && (
                <span className={`chg${revDelta < 0 ? " down" : ""}`}>
                  {revDelta >= 0 ? "▲" : "▼"} {Math.abs(revDelta).toFixed(1)}% revenue vs prior period
                </span>
              )}
              <span className="cap">
                Boom · {periods.length} period{periods.length === 1 ? "" : "s"}
                {provisional && (
                  <>
                    {" "}
                    <Status tone="warn" data-provisional-period={provisional.period ?? ""}>
                      {provisionalLabel}
                    </Status>
                  </>
                )}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${CW} ${CH}`}
              style={{ width: "100%", height: "auto" }}
              role="img"
              aria-label="Revenue trend"
            >
              <g className="grid">
                <line x1="0" y1="38" x2={CW} y2="38" />
                <line x1="0" y1="86" x2={CW} y2="86" />
                <line x1="0" y1="134" x2={CW} y2="134" />
              </g>
              {revPath && (
                <>
                  <path d={`${revPath} L${CW},${CH} L0,${CH} Z`} fill="#a100ff" opacity=".06" />
                  <path
                    className="finline"
                    pathLength={1}
                    d={revPath}
                    fill="none"
                    stroke="#a100ff"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    style={{ filter: "drop-shadow(0 3px 8px rgba(161,0,255,.3))" }}
                  />
                </>
              )}
              <g className="axis">
                {periods.map((p, i) => (
                  <text
                    key={i}
                    // The end labels sit a hair inside the field so neither
                    // touches the card edge at any page width.
                    x={
                      periods.length === 1
                        ? CW / 2
                        : i === 0
                          ? 2
                          : i === periods.length - 1
                            ? CW - 2
                            : (i / (periods.length - 1)) * CW
                    }
                    y={CH - 4}
                    textAnchor={i === 0 ? "start" : i === periods.length - 1 ? "end" : "middle"}
                  >
                    {p.period ?? ""}
                    {p.margin != null ? ` · ${fmtPct(p.margin)}` : ""}
                  </text>
                ))}
              </g>
            </svg>
          </PaneCard>
        )}

        {/* KEY RATIOS, the dummy's second card. The leverage row carries the
            covenant it is measured against, which is the whole reason a banker
            reads it, and the status word says which side of it the figure sits
            on. */}
        {/* One full-width row shared half and half, so the pair always spans
            exactly the trend card above (founder, 2026-09-03: same length as
            the card above; auto-fit had left spare columns at wide widths). */}
        <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <PaneCard>
          <div className="kicker" style={{ marginBottom: 12 }}>
            Key ratios
          </div>
          <div className="ratio-rows num">
            {latest?.revenue != null && (
              <div className="rr">
                <span>Revenue</span>
                <b>
                  <Fig>{fmtMoney(latest.revenue)}</Fig>
                </b>
              </div>
            )}
            {ratios.ebitda != null && (
              <div className="rr">
                <span>EBITDA</span>
                <b>
                  <Fig>{fmtMoney(ratios.ebitda)}</Fig>
                </b>
              </div>
            )}
            {ratios.ebitdaMargin != null && (
              <div className="rr">
                <span>EBITDA margin</span>
                <b>
                  <Fig>{fmtPct(ratios.ebitdaMargin)}</Fig>
                </b>
              </div>
            )}
            <div className="rr">
              <span>
                Total leverage
                {levCov?.thresholdValue != null ? ` · covenant ${fmtRatio(levCov.thresholdValue)}` : ""}{" "}
                {levTone && (
                  <Status tone={levTone}>
                    {levTone === "bad" ? "over covenant" : levTone === "warn" ? "near covenant" : "within covenant"}
                  </Status>
                )}
              </span>
              <b>
                <Fig>{fmtRatio(ratios.totalLeverage)}</Fig>
              </b>
            </div>
            <div className="rr">
              <span>Interest coverage</span>
              <b>
                <Fig>{fmtRatio(ratios.interestCoverage)}</Fig>
              </b>
            </div>
          </div>
        </PaneCard>

        {items.length > 0 && (
          /* Beside Key ratios in one row (founder, 2026-09-03): a full-width
             statement left a bare column to the right of the ratios card. */
          <PaneCard>
            <div className="kicker" style={{ marginBottom: 12 }}>
              Income statement · LTM vs prior year
            </div>
            <table className="dt num">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="r">LTM</th>
                  <th className="r">Prior FY</th>
                  <th className="r">Change</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => {
                  const chg =
                    r.ltm != null && r.priorFy != null && r.priorFy !== 0
                      ? ((r.ltm - r.priorFy) / Math.abs(r.priorFy)) * 100
                      : null;
                  return (
                    <tr key={i}>
                      <td>{r.line ?? ""}</td>
                      <td className="r">
                        <Fig>{fmtMoney(r.ltm)}</Fig>
                      </td>
                      <td className="r">
                        <Fig>{fmtMoney(r.priorFy)}</Fig>
                      </td>
                      <td className="r">
                        {chg == null ? (
                          "—"
                        ) : (
                          <Status tone={chg < 0 ? "warn" : "good"}>
                            {(chg >= 0 ? "+" : "−") + Math.abs(chg).toFixed(1) + "%"}
                          </Status>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PaneCard>
        )}
        </div>
      </div>

      <Note note={boom.note ?? (spread.sourceFile ? `Source: Boom spreading · ${spread.sourceFile}` : "Source: Boom spreading")} />
    </Pane>
  );
}
