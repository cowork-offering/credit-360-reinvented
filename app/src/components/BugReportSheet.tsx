import { useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "./transcript";
import { BUG_CATEGORIES, submitBug, type SubmitOutcome } from "./bugReport";

/* =============================================================================
   THE FEEDBACK SHEET — a small, quiet modal the Feedback pill opens.

   Pick what went wrong (multi-select), add a note, send. The conversation is
   attached automatically so a bug can be reproduced. It writes through
   bugReport.ts to the shared store bucket, or copies to the clipboard when there
   is no store. Glass card in the cockpit register: hairlines, ink type, ONE
   --brand accent, on Send alone. Esc closes; the chips are real buttons.
   ============================================================================= */

export function BugReportSheet({
  build,
  surface,
  accountName,
  bookAsOf,
  onClose,
}: {
  build: () => string;
  surface: string;
  accountName?: string | null;
  bookAsOf?: string | null;
  onClose: () => void;
}) {
  // The conversation does not change while the modal is open, so capture once.
  const transcript = useState(() => build())[0];
  const lineCount = useMemo(() => transcript.split("\n").filter((l) => l.trim()).length, [transcript]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "done" | "copied" | "failed">("form");
  const firstChip = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "sending") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => firstChip.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [onClose, phase]);

  const toggle = (c: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const canSend = picked.size > 0 || comment.trim().length > 0;

  async function send() {
    if (!canSend || phase === "sending") return;
    setPhase("sending");
    let outcome: SubmitOutcome = "failed";
    try {
      outcome = await submitBug(
        { categories: [...picked], comment, transcript, surface, accountName, bookAsOf },
        copyText,
      );
    } catch {
      outcome = "failed";
    }
    if (outcome === "stored") {
      setPhase("done");
      window.setTimeout(onClose, 1100);
    } else if (outcome === "copied") {
      setPhase("copied");
      window.setTimeout(onClose, 1600);
    } else {
      setPhase("failed");
    }
  }

  const sent = phase === "done" || phase === "copied";

  return (
    <div className="bugsheet-layer" onMouseDown={() => phase !== "sending" && onClose()} role="presentation">
      <div
        className="bugsheet"
        role="dialog"
        aria-modal="true"
        aria-label="Report an issue"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="bugsheet-sent" data-outcome={phase}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="bugsheet-tick">
              <path d="M5 12.5l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="bugsheet-sent-t">{phase === "copied" ? "No store here — copied to your clipboard" : "Sent — thank you"}</div>
            <div className="bugsheet-sent-s">
              {phase === "copied"
                ? "Paste it wherever you're tracking feedback."
                : "It's in the feedback bucket for triage."}
            </div>
          </div>
        ) : (
          <>
            <div className="bugsheet-h">
              <span className="bugsheet-t">Report an issue</span>
              <span className="bugsheet-s">{surface}</span>
            </div>

            <div className="bugsheet-lbl">What went wrong?</div>
            <div className="bugsheet-cats">
              {BUG_CATEGORIES.map((c, i) => {
                const on = picked.has(c);
                return (
                  <button
                    key={c}
                    ref={i === 0 ? firstChip : undefined}
                    type="button"
                    className={`bugsheet-cat${on ? " on" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggle(c)}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <label className="bugsheet-lbl" htmlFor="bugsheet-note">
              Anything to add <span className="bugsheet-opt">(optional)</span>
            </label>
            <textarea
              id="bugsheet-note"
              className="bugsheet-note"
              placeholder="What did you expect, and what happened instead?"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
            />

            <div className="bugsheet-foot">
              <span className="bugsheet-attach" title="Your conversation is included so we can reproduce it">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                Transcript attached · {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
              <span className="bugsheet-acts">
                <button type="button" className="bugsheet-cancel" onClick={onClose} disabled={phase === "sending"}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="bugsheet-send"
                  onClick={send}
                  disabled={!canSend || phase === "sending"}
                >
                  {phase === "sending" ? "Sending…" : phase === "failed" ? "Retry" : "Send"}
                </button>
              </span>
            </div>
            {phase === "failed" && <div className="bugsheet-err">Could not send. Try again, or copy from the workroom.</div>}
          </>
        )}
      </div>
    </div>
  );
}
