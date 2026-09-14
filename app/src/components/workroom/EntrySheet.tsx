import type { ReactNode } from "react";
import { ThreadRecap } from "./ThreadCondensed";
import type { PackageEntry } from "../../book/packages";
import { fmtMoney } from "../../data/format";

import "../../styles/entry.css";

/* =============================================================================
   THE ENTRY SHEET: what there is to act on, and the doors.

   FOUNDER, design-intent gate 2026-09-14 (knowledge/DESIGN-0.9.24-ENTRY.md):
   "a credit officer's desk note, not a chat. The banker opens a relationship to
   act on it; the first thing on the glass is what there is to act on and the
   three doors, not a greeting bubble with pills under it."

   THE FINALE'S MIRROR. The room already ends on one centred sheet, the filing
   card of 0.9.20; it now OPENS on one. Same glass, same radius, same shadow,
   same type: `.wk-sheet` and `.wk-sheet-go` are reused by class from
   workroom.css and `entry.css` adds only what a row of doors needs. Not one
   colour is invented here.

   ONE SHEET, TWO ROOMS. The facility room offers the routes that version a
   package; the relationship room offers the reviews and, above them, the
   briefing. Both compose their own doors and their own state line and hand them
   in; this file owns the shape and owns no words about any particular room.

   IT DERIVES NOTHING NEW. `entryStateLine` reads the figures the rooms already
   hold to say what they say in their headline: the grade off the snapshot, the
   committed total off the exposure, the version off the package roster.

   A DOOR THE BOOK HAS SHUT IS DISABLED WITH ITS REASON, NEVER HIDDEN (A27.3).
   Taking the map away from the banker is worse than showing a door that will
   not open today and saying why.
   ============================================================================= */

/** One door on the sheet. */
export interface EntryDoor {
  /** The route this door binds, on `data-door` so a drive can read it. */
  id: string;
  label: string;
  /** One line of what it does, in the room's voice. */
  what: string;
  /** The book's own reason this door is shut today, verbatim. Null where it is
   *  open, which is the common case. */
  locked?: string | null;
  onPick: () => void;
}

export interface EntrySheetProps {
  /** The relationship, by name. The sheet's title. */
  name: string;
  /** ONE line of state: what there is to act on before any door is opened. */
  state: string;
  doors: readonly EntryDoor[];
  /** The relationship room's briefing. It renders UNDER the doors: the state
   *  line above the doors already carries the signal, so the doors are on the
   *  first screen and the briefing is the why under them (gate 2026-09-14: with
   *  the briefing above, every door sat below the fold on Hartwell). The banker
   *  reads what is due and what it means before the room offers a door. */
  briefing?: ReactNode;
  /** The read chips, exactly as `.wk-posfoot` renders them in the room today. */
  reads?: ReactNode;
  /** The room's own explainer control, in the sheet's top-right corner. */
  why?: ReactNode;
}

export function EntrySheet({ name, state, doors, briefing, reads, why }: EntrySheetProps) {
  return (
    <div className="wk-sheet wk-entry" data-entry="open" role="group" aria-label={`${name}. ${state}`}>
      {why}
      <div className="wk-sheet-h">
        <h3 className="wk-sheet-t">{name}</h3>
        <div className="wk-sheet-s wk-entry-state">{state}</div>
      </div>
      <div className="wk-entry-doors">
        {doors.map((door) => (
          <button
            type="button"
            key={door.id}
            className="wk-sheet-go wk-entry-door"
            data-door={door.id}
            data-locked={door.locked ? "1" : undefined}
            disabled={!!door.locked}
            title={door.locked ?? undefined}
            onClick={door.onPick}
          >
            <span className="wk-entry-dl">{door.label}</span>
            <span className="wk-entry-dw">{door.locked ?? door.what}</span>
          </button>
        ))}
      </div>
      {briefing}
      {reads && <div className="wk-posfoot wk-entry-reads">{reads}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- the fold

   PICKING A DOOR FOLDS THE SHEET INTO THE THREAD. It becomes the first recap
   line, in the register every spent turn in both rooms already uses
   (`threadCondense.ts`, `.wk-settled`), and what follows is the room's own flow:
   the package question where the route needs one, or the first step.

   IT CARRIES NO CONTROL. There is nothing under it to bring back: the sheet
   asked one question and the line is the answer.                             */

/** "Modify, chosen". */
export function entryRecapText(label: string): string {
  return `${label}, chosen`;
}

export function EntryFold({ label }: { label: string }) {
  return (
    <div data-recap-line="" data-entry="chosen">
      <ThreadRecap id="entry" recap={{ text: entryRecapText(label), control: false, open: false }} />
    </div>
  );
}

/* -------------------------------------------------------- the state line */

/** ONE LINE OF STATE, from what the rooms already hold.
 *
 *  Each clause is present only where the read carries it. A relationship whose
 *  read names no grade and no committed total says so rather than printing a
 *  placeholder: an absent figure is a fact, and inventing one here would be the
 *  channel-none doctrine broken on the first line the banker sees.
 */
export function entryStateLine(args: {
  /** The borrower's risk rating, off the snapshot. */
  grade?: string | number | null;
  /** The relationship's committed total, off the exposure. */
  committed?: number | null;
  /** The package roster both rooms build with `packageRoster`. */
  packages: readonly PackageEntry[];
  /** The deal signal the room opened on, where it opened on one. */
  signal?: string | null;
}): string {
  const clauses: string[] = [];
  const booked = args.packages.reduce((n, p) => n + p.booked, 0);
  if (args.grade !== null && args.grade !== undefined && String(args.grade).trim()) {
    clauses.push(booked > 0 ? `Booked at Grade ${args.grade}` : `Graded ${args.grade}, nothing booked yet`);
  }
  if (typeof args.committed === "number") clauses.push(`${fmtMoney(args.committed)} committed`);
  const version = args.packages.find((p) => p.inFlightVersion);
  if (version) {
    clauses.push(
      `a modification in flight, ${version.inFlightEditable ? "editable until approval" : "in approval and locked"}`,
    );
  }
  const state = clauses.length
    ? `${clauses.join(", ")}.`
    : "The read carries no grade and no committed total for this relationship.";
  /* THE SIGNAL STANDS ON THE SAME LINE. Where the room opened on a deal signal
     rather than the neutral question, that sentence IS what the room was going
     to lead with, and the sheet keeps it: dropping it would take the room's one
     piece of guidance away in the pass that was meant to lead better. */
  return args.signal ? `${state} ${args.signal.trim()}` : state;
}
