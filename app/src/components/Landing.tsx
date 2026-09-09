import { useMemo } from "react";
import { useApp, useLivePortfolioResult } from "../state/appState";
import { buildWorklistRows } from "../data/worklistRows";
import { Briefing } from "./Briefing";
import { KpiBand } from "./KpiBand";
import { Worklist } from "./Worklist";
import { Weave } from "./Weave";

/* =============================================================================
   SURFACE 1 — THE LANDING.

   Briefing, then the KPI band, then the queue, over the weave. The order is the
   argument: what needs you, what the book is worth, which files. Rule 21 keeps
   the ground clean — no purple bloom on the page; the only ambient violet on
   this surface is the weave, which is sanctioned identity texture.

   THE VIEW ELEMENT IS THE SHELL'S. `#view-home` and its `show` class live in
   AppShell, which owns the view contract for both surfaces: the flight has to
   write onto the client view before it is shown, so neither view can be a thing
   its own content renders.
   ============================================================================= */

export function Landing() {
  const { data, worklist } = useApp();
  /* THE COLD-OPEN FLAG, from the one read the whole landing stands on. Passed
     to the briefing so its assembled sentence waits for the org's book rather
     than narrating the baked samples for a second; the KPI band and the queue
     read the same flag for themselves. */
  const booting = !!useLivePortfolioResult().booting;
  const rows = useMemo(() => buildWorklistRows(data, worklist), [data, worklist]);
  const bookSize = data.portfolio?.accounts?.length ?? rows.length;

  return (
    <>
      <Weave />
      <div className="page" style={{ paddingTop: 40, paddingBottom: 100, position: "relative", zIndex: 1 }}>
        <Briefing rows={rows} bookSize={bookSize} generatedAt={data.meta?.generatedAt ?? ""} booting={booting} />
        <KpiBand />
        <Worklist />
      </div>
    </>
  );
}
