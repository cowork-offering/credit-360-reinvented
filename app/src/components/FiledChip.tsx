import { Odo } from "./Odometer";

/* =============================================================================
   BOOKED IS THE ONLY COMMITTED (rule 1, founder 2026-09-03).

   A modification files an UNBOOKED new package version. It becomes real when
   nCino's booking run approves it and not one moment before, so no booked
   figure in this cockpit moves because a room executed. What the execute earns
   is THIS: a quiet chip beside the figure, naming the delta that was filed and
   saying out loud that it is still waiting on the booking run.

   IT REPLACED THE WALK-FORWARD. The delta used to be added into the hero
   anchor, the worklist row's exposure and the exposure pane's committed total,
   which made every one of those figures a number the org could not reproduce.
   The delta is the same `state.writeBacks` reading; what changed is that it is
   now LABELLED and ADJACENT rather than summed into the committed.

   THE ODO STAYS, for the chip's own arrival: the amount is written by the
   odometer, so the figure lands as a mechanism rather than appearing pasted.
   ============================================================================= */

/** "+$5.0M". The filed delta, in the millions the manifest carried it in. */
export function filedAmount(deltaMM: number): string {
  const sign = deltaMM < 0 ? "-" : "+";
  return `${sign}$${Math.abs(deltaMM).toFixed(1)}M`;
}

/**
 * The filed-but-unbooked delta, beside the booked figure it does NOT move.
 *
 * Renders nothing on a zero delta: a relationship with no execute behind it in
 * this session has no pending version to declare.
 */
export function FiledChip({ deltaMM, id, newPackage }: { deltaMM: number; id?: string; newPackage?: boolean }) {
  if (!deltaMM) return null;
  return (
    <span className="filedchip" id={id} role="note" data-newpkg={newPackage ? "1" : undefined}>
      <Odo value={filedAmount(deltaMM)} />
      {/* WHERE IT LANDED, where that is news. A new facility creates a new
          package, so the pending figure is a package that did not exist rather
          than more on the one the banker was reading. */}
      <span className="filedchip-w">{newPackage ? " filed on a new package · booking pending" : " filed · booking pending"}</span>
    </span>
  );
}
