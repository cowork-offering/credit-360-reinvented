import { boomArrivals, boomWaits, useBoomWatch, useNow } from "./workroom/boomWatch";
import { openSpreadingRoom } from "./workroom/spreadSession";
import { elapsedWord } from "./workroom/SpreadingRoom";

/* =============================================================================
   BOOM IS STILL READING, AND THE BANKER IS SOMEWHERE ELSE (0.9.31).

   FOUNDER, 2026-09-16: "so i can leave the workroom of spreading and there is a
   progress indicator somewhere?"

   THIS IS THAT SOMEWHERE. It sits in the header, in the same quiet register as
   the connector health line at the foot of the document, and it says the three
   things a banker who walked away needs: which relationship Boom is reading
   for, how long it has been, and how much of the set has landed. Clicking it
   opens that Spreading room.

   IT IS NOT A PROGRESS BAR AND IT NEVER WILL BE. Boom reports four rungs and no
   sub-stages, so there is no percentage to draw that would not be invented. The
   filling ">" is the cockpit's one loading motif (tokens.css) and the count is
   files, which is a fact.

   THEN IT BRINGS THE ARRIVAL. When Boom finishes, the line settles into the
   arrival marker for a beat and then stays as a quiet pill until the banker
   looks; the relationship's worklist row glows until then. No sounds and no
   browser notifications: the host does not grant them reliably, and a promise
   that fails is worse than none.

   TWO RELATIONSHIPS AT ONCE CARRY BOTH, newest first. Nothing about this
   surface is per relationship except the words in it.
   ============================================================================= */

/** "Hartwell Precision Manufacturing LLC's". Possessive the way a banker writes
 *  it, including the bare apostrophe on a name that already ends in s. */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

export const readingLine = (name: string): string => `Reading ${possessive(name)} statements`;

const readLine = (name: string, period: string | null): string =>
  period ? `Boom has read ${possessive(name)} ${period} statements` : `Boom has read ${possessive(name)} statements`;

export function BoomWaitLine() {
  useBoomWatch();
  const waits = boomWaits();
  const arrivals = boomArrivals();
  /* THE CLOCK RUNS ONLY WHILE SOMETHING IS BEING READ. A cockpit with no wait
     on it sets no interval at all. */
  const now = useNow(waits.length ? 1_000 : 0);
  if (!waits.length && !arrivals.length) return null;

  return (
    <div className="bw" aria-label="Boom is reading">
      {arrivals.map((a) => (
        <button
          key={a.accountId}
          type="button"
          className="bw-pill"
          data-boom-state={a.marker ? "marker" : "arrived"}
          data-boom-account={a.accountId}
          onClick={() => openSpreadingRoom({ accountId: a.accountId, accountName: a.accountName })}
        >
          <span className="bw-mk" aria-hidden="true">
            <i className="bw-dot">·</i>
          </span>
          <span className="bw-t">{a.failure ?? readLine(a.accountName, a.period)}</span>
        </button>
      ))}
      {waits.map((w) => (
        <button
          key={w.accountId}
          type="button"
          className="bw-pill"
          data-boom-state="reading"
          data-boom-account={w.accountId}
          onClick={() => openSpreadingRoom({ accountId: w.accountId, accountName: w.accountName })}
        >
          <span className="bw-mk" aria-hidden="true">
            <i className="c360-glyph c360-beat">&gt;</i>
          </span>
          <span className="bw-t">{readingLine(w.accountName)}</span>
          <span className="bw-sep" aria-hidden="true">
            ·
          </span>
          <span className="bw-s num">{elapsedWord(now - w.startedAt)}</span>
          <span className="bw-sep" aria-hidden="true">
            ·
          </span>
          <span className="bw-s num">{`${w.done} of ${w.total} file${w.total === 1 ? "" : "s"}`}</span>
        </button>
      ))}
    </div>
  );
}
