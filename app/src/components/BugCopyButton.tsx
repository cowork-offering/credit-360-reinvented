import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "./transcript";

/* =============================================================================
   THE BUG BUTTON — one click copies the whole conversation for feedback.

   Sits quietly in every workroom's chrome and in the chat, the same small ink
   glyph in the same place. It builds the transcript LAZILY on click (so it
   catches the latest state, not the state at mount) and copies it, then says so
   for a beat. Read-only: it reports what happened, it never changes the room.

   Rule 21 holds: no purple on the ground. The glyph is quiet ink; the only
   colour it ever takes is the positive tick for the instant after a copy.
   ============================================================================= */

export function BugCopyButton({
  build,
  label = "Copy conversation for feedback",
}: {
  /** Built on click so it captures the current exchange. */
  build: () => string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = useCallback(async () => {
    let text = "";
    try {
      text = build();
    } catch {
      text = "";
    }
    const ok = text ? await copyText(text) : false;
    setState(ok ? "ok" : "fail");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  }, [build]);

  return (
    <button
      type="button"
      className={`bugcopy c360-press${state === "ok" ? " ok" : state === "fail" ? " fail" : ""}`}
      onClick={onClick}
      aria-label={state === "ok" ? "Conversation copied" : state === "fail" ? "Copy failed" : label}
      title={label}
    >
      {state === "ok" ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        /* A bug: rounded body, head, six legs and two antennae. */
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
      )}
      <span className="bugcopy-say" aria-hidden="true">
        {state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : "Feedback"}
      </span>
    </button>
  );
}
