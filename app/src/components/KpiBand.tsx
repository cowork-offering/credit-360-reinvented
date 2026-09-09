import { useApp, useLivePortfolioResult } from "../state/appState";
import { fmtAsOf, fmtMoney, fmtPct, fmtRelative } from "../data/format";
import { useCountUp } from "../data/motion";
import { SERVERS } from "../channel/mcp";
import { useLaneHealth } from "../channel/laneHealth";
import { bookTotalsOf } from "../book/livePortfolio";
import { KpiBandSkeleton } from "./HomeSkeleton";

/* =============================================================================
   THE KPI BAND — the landing's second beat.

   Rule 13 is HARD: no sparklines, no mini-meter spines, on clients or on KPI
   cells. The figures carry it, and the only colour in the band is the purple
   UNIT (rule: purple discipline — units, deltas, the active dot, one chart
   line, the primary execute; nothing else).

   The cells are unchanged data: the same seven figures off the same live-or-
   staged portfolio read. This wave re-skins the presentation only.
   ============================================================================= */

type Tone = "neutral" | "warning" | "critical";

interface Kpi {
  label: string;
  /** Raw figure for the count-up; formatting stays with the presenter so the
   *  tween runs on the number, not on a string. Null renders an honest "—". */
  raw: number | null;
  format: (n: number) => string;
  sub: string;
  tone?: Tone;
}

const asCount = (n: number) => String(Math.round(n));

/** Split the trailing unit off a formatted figure so it can take the purple.
 *  "$81M" -> ["$81", "M"], "72.9%" -> ["72.9", "%"], "4" -> ["4", ""]. */
function splitUnit(s: string): [string, string] {
  const m = /^(.*?)([MBK%×]|days)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ""];
}

/** One cell — counts its figure up on mount (A25.4). Resolves to the final
 *  value immediately under reduced motion / jsdom (see data/motion.ts). */
function KpiCell({ kpi }: { kpi: Kpi }) {
  const animated = useCountUp(kpi.raw ?? 0);
  const [figure, unit] = kpi.raw == null ? ["—", ""] : splitUnit(kpi.format(animated));
  return (
    <div className="kpi">
      <div className="l">{kpi.label}</div>
      <div className={`v${kpi.tone === "warning" ? " warn" : kpi.tone === "critical" ? " bad" : ""}`}>
        {figure}
        {unit && <span className="u">{unit}</span>}
      </div>
      <div className="s">{kpi.sub}</div>
    </div>
  );
}

export function KpiBand() {
  const { data, worklist } = useApp();
  /* THE SAME READ THE QUEUE STANDS ON. Registered once, in the provider: this
     band used to own the watch, and since 2026-09-08 the landing's membership
     comes off the same result, so one subscription serves both rather than the
     page holding two. A failed refresh keeps the staged figures visible. */
  const live = useLivePortfolioResult();
  /* THE BANNER'S "WHY" COMES OFF THE SAME STORE THE FOOTER READS. The watch's
     own cache stamp is only present when the platform served this identity from
     cache, so a banner raised on a lane that HAS answered recently used to say
     nothing at all about when. The lane's last good call is the fact the banker
     needs, and taking it from one place is what stops the hero, the banner and
     the status line disagreeing about the same outage. */
  const lane = useLaneHealth()[SERVERS.customer360];
  const lastGoodAt = live.storedAt ?? lane?.lastGoodAt;
  /* THE FRESH-OPEN SKELETON. Only ever true with a connector and no book yet,
     cached or live (see useLivePortfolio). A returning viewer's cached book has
     already cleared it, and a share link never sets it, so this replaces the
     old flash of the five baked samples and nothing else. The hooks above all
     ran first, so this early return keeps their order. */
  if (live.booting) return <KpiBandSkeleton />;
  /* THE FIGURES COME OFF `data`, THE BANNER OFF `live`, and the split is not
     cosmetic. `live.portfolio` is the read exactly as the org answered it: 115
     rows, 105 of them legacy, a 25-row signal block that is mostly abandoned
     demos. `data.portfolio` is that same read after book/livePortfolio.ts has
     confined it to the book, which is what the queue and every row underneath
     this band stand on. Reading the raw one here is how the band came to say
     "32 relationships" over twelve rows and "27 overdue" over two (caught by
     the lane drive's legacy scenario, 2026-09-08). The hook is still the source
     of the freshness stamp and the failure, which are facts about the CALL and
     have no confined equivalent. */
  const pf = data.portfolio ?? { accounts: [] };
  const accts = pf.accounts ?? [];

  /* THE FOUR FIGURES ARE ARITHMETIC ON THE ROWS UNDERNEATH THEM, never the
     org's `bookTotals`. That rollup spans EVERY packaged account, and in this
     org 105 of the 115 are legacy demo rows with no exposure and years of
     abandoned balances: read straight, it says 354 percent utilisation, $1.09B
     drawn against $308M committed (TEST-PORTFOLIO-DESIGN.md, appendix B). There
     is no server-side total that excludes them, so the band sums what it is
     showing. A banker can now add the rows up by hand and get the band.

     book/livePortfolio.ts re-sums `bookTotals` the same way for every other
     consumer; this is the same arithmetic, done where it is displayed, so the
     band cannot quietly go back to trusting a figure it did not check. */
  const book = bookTotalsOf(accts);
  const committed = book.totalCommitted ?? 0;
  const drawn = book.totalOutstanding ?? 0;
  const acctCount = book.accountCount ?? 0;
  const util = book.utilizationPct ?? null;

  const sig = pf.signals;
  const due = sig?.covenantsDueSoon ?? [];
  const overdue = due.filter((c) => c.overdue === true).length;
  const breached = sig?.breachedCount ?? 0;
  const maturities = (sig?.maturitiesSoon ?? []).length;

  const kpis: Kpi[] = [
    { label: "Managed exposure", raw: committed, format: fmtMoney, sub: `Committed · ${acctCount} relationships` },
    { label: "Drawn balance", raw: drawn, format: fmtMoney, sub: "Across the book" },
    { label: "Utilization", raw: util, format: (n) => fmtPct(n), sub: "Drawn / committed" },
    /* THE RELATIONSHIPS CELL IS GONE, and no figure went with it: it was
       `accountCount`, which the Managed exposure cell already states underneath
       itself. Seven cells across the mint's 1180px measure wrapped their own
       labels; six read. A cell that repeats its neighbour is the one to cut. */
    {
      label: "Needs action",
      raw: worklist.accountIds.length,
      format: asCount,
      sub: "On the queue",
      tone: worklist.accountIds.length > 0 ? "warning" : "neutral",
    },
    {
      label: "Reviews due",
      raw: due.length,
      format: asCount,
      sub: overdue > 0 ? `${overdue} overdue` : "None overdue",
      tone: overdue > 0 ? "warning" : "neutral",
    },
    {
      label: "EWS active",
      raw: breached + maturities,
      format: asCount,
      sub:
        [breached > 0 ? `${breached} breached` : null, maturities > 0 ? `${maturities} maturity` : null]
          .filter(Boolean)
          .join(" · ") || "None in window",
      tone: breached > 0 ? "critical" : maturities > 0 ? "warning" : "neutral",
    },
  ];

  return (
    <div className="card kpis num" id="kpiband">
      {kpis.map((k) => (
        <KpiCell key={k.label} kpi={k} />
      ))}
      {(live.storedAt != null || live.failure) && (
        <div className="kpi-live">
          {live.storedAt != null && !live.failure && (
            <span style={{ color: "var(--ink-faint)" }}>
              Live book data as of {fmtRelative(new Date(live.storedAt).toISOString(), data.meta?.generatedAt ?? "")}
            </span>
          )}
          {live.failure && (
            <span style={{ color: live.failure.retract ? "var(--critical)" : "var(--warning)" }}>
              {live.failure.fix}
              {/* Freshness comes off the served result's cache stamp, never a
                  clock read here: it says when the figures on screen were true,
                  which is the one thing a stale band has to be honest about. */}
              {lastGoodAt != null && (
                <span style={{ color: "var(--ink-faint)" }}> Last good data, {fmtAsOf(lastGoodAt)}.</span>
              )}
              {/* THE RAW CODE, QUIETLY (founder, 2026-09-03: the banner sat on
                  screen with no way to tell which layer had failed). The
                  platform's code and its own message, trimmed, so a screenshot
                  names the layer without a console. */}
              <span data-live-code={live.failure.code} style={{ color: "var(--ink-faint)", fontSize: 10.5, marginLeft: 6 }}>
                {live.failure.code}
                {live.failure.message ? `: ${live.failure.message.slice(0, 140)}` : ""}
              </span>
            </span>
          )}
          {live.failure && live.retry && (
            /* QUIET, and a real gesture: the watch is torn down and registered
               again, which is the only recovery for a registration that failed
               outright. The banner itself clears on the next good event, not on
               the click. */
            <button
              type="button"
              onClick={live.retry}
              disabled={live.retrying}
              className="c360-press rounded-[6px] border border-border px-2 py-[2px] text-[11px] font-semibold disabled:opacity-50"
              style={{ color: "var(--ink-muted)" }}
            >
              {live.retrying ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
