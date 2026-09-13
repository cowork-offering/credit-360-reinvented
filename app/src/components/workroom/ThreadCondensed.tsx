/* =============================================================================
   THE RECAP LINE — one earlier turn, as a banker would say it back.

   The register is the rooms' own settled row (`.wk-settled`, workroom.css): a
   quiet pill in muted ink with the figure in full ink, and the way back to the
   whole turn on the right. Nothing new to learn, because nothing here is new:
   an earlier turn ALREADY ends in a receipt, and this is that receipt standing
   for the turn rather than for one decision inside it.

   WHAT IT SAYS is `threadCondense.ts`'s, not this file's. The renderer prints;
   the rule composes. See the founder note there (2026-09-13).
   ============================================================================= */
import { expandLabel } from "./settle";
import type { Recap } from "./threadCondense";

import "../../styles/recap.css";

export function ThreadRecap({
  id,
  recap,
  onToggle,
}: {
  id: string;
  recap: Recap;
  /** Absent where the line only READS the history and something else opens it. */
  onToggle?: (id: string) => void;
}) {
  const face = (
    <>
      {recap.kicker && <span className="wk-settled-k">{recap.kicker}</span>}
      <span className="wk-settled-w">{recap.text}</span>
    </>
  );
  /* NOTHING TO BRING BACK, NO CONTROL. Same face, no affordance — the rule the
     settled row already keeps for a receipt that covers nothing. */
  if (!recap.control || !onToggle) {
    return (
      <div className="wk-settled wk-settled-flat" data-recap={id}>
        {face}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="wk-settled"
      data-recap={id}
      aria-expanded={recap.open}
      onClick={() => onToggle(id)}
    >
      {face}
      <span className="wk-settled-x">{expandLabel(recap.open)}</span>
    </button>
  );
}
