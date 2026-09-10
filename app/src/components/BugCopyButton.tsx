import { useState } from "react";
import { BugReportSheet } from "./BugReportSheet";

/* =============================================================================
   THE FEEDBACK PILL — opens the report sheet.

   Sits in every workroom's chrome and in the chat: the same small pill in the
   same place. It carries the conversation (built lazily, so it catches the
   latest exchange) plus where it was raised, and hands them to the sheet, which
   files the report to the shared store bucket or copies it if there is no store.
   Read-only: it reports, it never changes the room.
   ============================================================================= */

export function BugCopyButton({
  build,
  surface,
  accountName,
  bookAsOf,
  label = "Report an issue with this conversation",
}: {
  /** Built on open so it captures the current exchange, as markdown. */
  build: () => string;
  /** Where the report is raised, e.g. "Modification — Hartwell Precision". */
  surface: string;
  accountName?: string | null;
  bookAsOf?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="bugcopy c360-press"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
      >
        {/* A bug: rounded body, head, six legs and two antennae. */}
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 4.4c1.4 0 2.5 1.2 2.5 3.1S9.4 12 8 12s-2.5-1.6-2.5-4.5S6.6 4.4 8 4.4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 4.4V3M6.7 3.1L5.9 2M9.3 3.1L10.1 2M5.5 6.4L3.4 5.7M10.5 6.4l2.1-.7M5.4 8.2H3.1M10.6 8.2h2.3M5.6 10.1l-2 .9M10.4 10.1l2 .9M8 5.4v6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <span className="bugcopy-say">Feedback</span>
      </button>
      {open && (
        <BugReportSheet
          build={build}
          surface={surface}
          accountName={accountName}
          bookAsOf={bookAsOf}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
