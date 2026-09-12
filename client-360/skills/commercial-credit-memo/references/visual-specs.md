# Visual Specs — Acme Bank target-state memo visuals (inline SVG / HTML, no CDN)

Reproduces the Visual Inventory. **No external chart libraries** (no Vega/Plotly/Chart.js/D3) —
hand-authored inline SVG + styled HTML tables only, so the artifact is fully self-contained for the
Cowork panel and the HTML→PDF step. Brand tokens: primary `#2D1A47`, secondary `#1B2D5B`,
pass `#1F7A3A`, watch `#B45309`, breach `#A8211B`, slate `#D6D3D1`, tint `#EFE9F4`.

> Reference implementations of every chart below are in `test/build-memo.mjs` (`svgRevolver`,
> `svgBars`, and the trend-table renderers). The orchestrator runs the same renderer.

## Exposure tables (Executive Summary)

Two stacked HTML tables — **Existing Exposure** then **Proposed Exposure** — followed by a
**Change in Exposure** callout. Columns (Core): `Facility | Borrower | Purpose | Acme Bank Exposure |
Outstanding | Maturity | PRISM`. Enhanced adds `Global Exposure | Global Outstanding | SBE Inclusion`.
Right-align numerics (`td.numeric`). The Proposed table's changed rows (new TL; revolver increase) get
the `.changed` tint to draw the eye.

## Risk Rating trend (Trend Reporting)

HTML table, dates as columns: row 1 `Risk Rating`, row 2 `PD %`, row 3 `Band`. The **Proposed**
column sits at the right end with a left border to separate it. Cell background by band:
Pass = none; Low Pass (13–15) = watch tint; Criticized (16)/Classified (17) = breach tint
(`.cell-nonpass`). Atlas is all Pass (rating 4) → no fills, demonstrating the green path; the rule is present.

## Covenant Compliance trend (Trend Reporting) — the signature visual

HTML table: `Covenant | Required | <q1..q6> | Proposed`. Each actual cell shows the value plus:
- **▲ / ▼** when the value moved ≥10% vs the prior period (material change),
- **amber** (`.cell-watch`) when within 10% of the trigger (caution),
- **red** (`.cell-breach`) when breached.
Legend beneath: `▲ material ↑ (≥10%) · ▼ material ↓ (≥10%) · amber = within 10% of breach · red = breach`.
Atlas: Total Leverage and FCCR jump at Proposed (new money); FCCR Proposed 1.28x vs ≥1.20x = amber caution.

## Revolver Usage trend (Trend Reporting) — inline SVG line chart

12 monthly points. SVG ~`520×170`. Elements: utilization-% polyline in primary purple; dashed
High/Average/Low reference lines with right-edge labels; x-axis month ticks (every other month);
a "Days at zero: N" annotation. Below: a stat row — Commitment, High, Avg, Low, Days at Zero.
Atlas: sustained 42–78% utilization, 0 days at zero → justifies the increase.

## Spreading trend (Trend Reporting) — inline SVG grouped bars

Revenue + Adjusted EBITDA as grouped bars over periods (primary + secondary fills), with a legend.
Keep it small (~`520×170`). A clean table is acceptable if bars get cramped.

## Payment History (Trend Reporting)

Small HTML table: `Days Past Due | # Events`. Buckets 30-60 / 60-90 / 90+. Cell tinted amber/red
when populated, neutral when zero. Atlas: one historical 30-60 event, else clean.

## KPI strip (Executive Summary)

`.kpi-strip` / `.kpi-card`: Revenue (LTM + YoY), Adj. EBITDA (+ margin), Total Leverage (vs trigger),
FCCR (vs trigger). Value in primary purple, trigger/sub in muted.

## SVG authoring notes

- Use a `viewBox` + `style="width:100%;height:auto"` so it scales in the panel and prints cleanly.
- Map data → pixels with a tiny linear scale (min/max with ~10% padding).
- Label numbers with `<text>` at `6.5–8pt`, muted fill.
- No `<script>`, no external `href` — everything inline.
