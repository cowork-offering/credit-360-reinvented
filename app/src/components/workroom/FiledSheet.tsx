import { forwardRef } from "react";
import { FiledList } from "./FiledList";
import { SHEET_UNCONFIRMED, type FiledSheetModel } from "./filedSheet";

/* =============================================================================
   THE FILED SHEET, DRAWN.

   ONE SHEET, READ IN TEN SECONDS, in the room's own tokens and type. Nothing on
   it is new vocabulary: the ledger is `FiledList` exactly as the card drew it,
   the figures wear the KPI band's own money voice, and the two doors are the
   afterglow's two doors moved onto the surface they belong to.

   THE SHEET IS THE CARD, GROWN. It carries the same aura and the same rim, and
   `./morph.ts` is what makes the growth a single motion rather than a swap. The
   aura is thinner here on purpose: the card is a moment and the sheet is a
   place, and a place does not pulse.

   IT RENDERS FROM WHAT THE ROOM ALREADY HOLDS. Every value on it is computed in
   `filedSheet.ts` from the execute result and the manifest, so the sheet is
   complete on its first commit. There is no loading state below, and there is
   no place to put one.
   ============================================================================= */

export interface FiledSheetProps {
  sheet: FiledSheetModel;
  /** Opens the memo room on this version. Absent where the view has no memo. */
  onDraftMemo?: () => void;
  onBack: () => void;
  /** The handoff is running: the sheet is on its way out to the memo room. */
  leaving?: boolean;
  /** Where the morph stands, for the stylesheet. `null` outside one. */
  morph?: "from" | "to" | null;
}

export const FiledSheet = forwardRef<HTMLDivElement, FiledSheetProps>(function FiledSheet(
  { sheet, onDraftMemo, onBack, leaving, morph },
  ref,
) {
  const { exposure, coverage } = sheet;
  return (
    <div
      className="wk-sheet"
      ref={ref}
      data-morph={morph ?? undefined}
      data-handoff={leaving ? "out" : undefined}
      role="group"
      aria-label="What was filed"
    >
      {/* THE RAINBOW, THINNED TO AN EDGE. Same element the card lights, at a
          fraction of its opacity: the light does not leave, it settles. */}
      <span className="aura" aria-hidden="true" />

      <div className="wk-sheet-h">
        <h3 className="wk-sheet-t">{sheet.title}</h3>
        <div className="wk-sheet-s">{sheet.stamp}</div>
      </div>

      <div className="wk-sheet-sec" data-block="filed">
        <FiledList head={sheet.head} lines={sheet.lines} at={0} />
      </div>

      <div className="wk-sheet-sec" data-block="exposure">
        <div className="wk-sheet-k">Exposure</div>
        <div className="wk-sheet-x">
          <span className="wk-sheet-was tnum">{exposure.before}</span>
          <span className="wk-sheet-arw" aria-hidden="true">
            →
          </span>
          <span className="wk-sheet-now tnum">{exposure.after}</span>
          {exposure.delta && (
            <span className="wk-sheet-d tnum" data-pending={exposure.pending ? "" : undefined}>
              {exposure.pending ? `${exposure.delta} pending` : exposure.delta}
            </span>
          )}
        </div>
        {/* THE ORG DID NOT ANSWER IN TIME, AND THE SHEET STAYS EXACTLY AS IT IS.
            One line, in the room's voice, claiming nothing either way. */}
        {sheet.unconfirmed && <div className="wk-sheet-note">{SHEET_UNCONFIRMED}</div>}
      </div>

      {/* WHAT IT DID TO THE BANK'S PROTECTION. The ledger above says what moved;
          this says what that cost in cover, in the room's own check's words. */}
      {coverage && (
        <div className="wk-sheet-sec" data-block="terms">
          <div className="wk-sheet-k">Terms and collateral</div>
          <div className="wk-sheet-r" data-row="coverage">
            <span className="wk-sheet-rl">{coverage.label}</span>
            <span className="wk-sheet-rd tnum">
              <span className="wk-sheet-now">{coverage.value}</span>
            </span>
          </div>
        </div>
      )}
      {sheet.next && (
        <div className="wk-sheet-sec" data-block="next">
          <div className="wk-sheet-k">Who acts next</div>
          <div className="wk-sheet-next">{sheet.next}</div>
        </div>
      )}

      <div className="wk-sheet-acts">
        {onDraftMemo && (
          <button type="button" className="wk-sheet-go" data-door="memo" onClick={onDraftMemo}>
            Draft the credit memo
          </button>
        )}
        <button type="button" className="wk-sheet-back" onClick={onBack}>
          Back to {sheet.accountName}
        </button>
      </div>
    </div>
  );
});
