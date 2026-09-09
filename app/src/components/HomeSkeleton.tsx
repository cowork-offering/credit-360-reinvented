/* =============================================================================
   THE COLD-OPEN SKELETON — what the landing shows while the org's book is still
   on its way.

   THE DEFECT THIS DRESSES. The cockpit ships with a baked book of five test
   relationships; the live Customer360Portfolio read replaces it a few seconds
   after open. Until 2026-09-09 those five painted first and swapped under the
   banker's eye. A returning viewer now sees their own last book from the store
   (channel/lastGood.ts, putBook/loadBook) with no skeleton at all; a genuinely
   fresh open, with nothing cached, sees THIS instead of the samples, and the
   real book settles into its place.

   IT IS THE SAME GEOMETRY, NOT AN APPROXIMATION OF IT. Every skeleton here
   renders through the very class the real surface uses (`.brief`, `.kpis`,
   `.kpi`, `.wl`, `.wlrow`), with shimmer bars sized to the type they stand in
   for, so nothing shifts a pixel when the book lands over it. Rule 13 holds
   even here: no meters, no spines, just the figures' own shape resolving.

   MOTION IS THE HOUSE SWEEP. `.c360-skb` runs the same left-to-right wash as
   the workroom's loaders, one accent glint riding through on the KPI band's
   value row so the wait reads as the product thinking, not a spinner.
   `prefers-reduced-motion` stills every bar to a flat wash (landing.css), and
   the bars are visible at rest, so nothing here depends on a keyframe to be
   seen.
   ============================================================================= */

/** One shimmer bar. Width and height are the caller's, so a bar stands in for a
 *  label, a figure or a name at that element's real size. */
function Bar({ w, h, mt, glint }: { w: number | string; h: number; mt?: number; glint?: boolean }) {
  return (
    <span
      className={glint ? "c360-skb c360-skb-glint" : "c360-skb"}
      style={{ width: typeof w === "number" ? `${w}px` : w, height: h, marginTop: mt }}
      aria-hidden="true"
    />
  );
}

/** The KPI band, unlit. Six cells in the real grid, each carrying the label /
 *  value / sub stack the figures land into. The value bar takes the accent
 *  glint, since that row is where the book's weight shows. */
export function KpiBandSkeleton() {
  return (
    <div className="card kpis num c360-skel" id="kpiband" aria-hidden="true" data-skeleton="kpi">
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="kpi" key={i}>
          <Bar w={i === 0 ? 92 : 64} h={9} />
          <Bar w={i === 0 ? 108 : 78} h={24} mt={8} glint />
          <Bar w={i === 0 ? 132 : 94} h={9} mt={9} />
        </div>
      ))}
    </div>
  );
}

/** The briefing, unlit: the two headline lines and the lead paragraph, at their
 *  real weights, so the morning brief resolves in place rather than jumping. */
export function BriefingSkeleton() {
  return (
    <div className="brief c360-skel" aria-hidden="true" data-skeleton="brief">
      <div className="eyebrow">
        <Bar w={168} h={10} />
      </div>
      <div style={{ margin: "10px 0 12px" }}>
        <Bar w={340} h={30} />
        <Bar w={250} h={30} mt={8} />
      </div>
      <Bar w="min(56ch, 90%)" h={12} mt={6} />
    </div>
  );
}

/** One queue row, unlit: the avatar, the who-column, the exposure figure, in
 *  the real `.wlrow` shell so hover geometry and spacing match the moment the
 *  rows land. A short, settling stack, not a full page of bars. */
function RowSkeleton({ delay }: { delay: number }) {
  return (
    <div className="wlrow c360-skel-row" style={{ animationDelay: `${delay}ms` }} aria-hidden="true">
      <span className="c360-skb c360-skb-avatar" />
      <span className="who">
        <Bar w={150} h={13} />
        <Bar w={96} h={9} mt={7} />
      </span>
      <span className="sts" />
      <span className="amt" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <Bar w={78} h={14} />
        <Bar w={54} h={9} />
      </span>
    </div>
  );
}

/** The worklist, unlit: the eyebrow and header, then four settling rows. Four,
 *  not the book's real length, because the count is one of the things the read
 *  brings; a fixed short stack reads as "loading your queue", never as a claim
 *  about how many. */
export function WorklistSkeleton() {
  return (
    <div style={{ marginTop: 36 }} data-skeleton="worklist">
      <div className="eyebrow">
        <span className="kicker">Worklist</span>
      </div>
      <div className="wl-head">Needs action</div>
      <div className="c360-skel" style={{ marginTop: 6, marginBottom: 4 }}>
        <Bar w="min(46ch, 80%)" h={11} />
      </div>
      <div className="wl">
        {[0, 1, 2, 3].map((i) => (
          <RowSkeleton key={i} delay={i * 60} />
        ))}
      </div>
    </div>
  );
}
