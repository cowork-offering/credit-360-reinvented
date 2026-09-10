import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fmtMoney } from "../data/format";
import type { ActionBucket, ActionRow } from "./kpiActions";

/* =============================================================================
   KPI ACTION SHEET — the anchored fast-actions popover.

   Drops from the clicked KPI cell (rule 20 lift, not an inset spine; rule 13 no
   meters). Each row states the account's "so what" and offers TWO doors: open
   the workroom pre-seeded (primary, the one accent), or drop the pre-typed
   instruction into the composer (quiet secondary), because the cockpit is
   chat-native. Esc closes; the CTAs are real buttons, so Tab/Enter and arrow
   keys move through them. Falls back to a centered sheet on narrow widths.

   It routes only. Every figure and every prompt comes from the ActionBucket the
   domain layer (kpiActions.ts) built; this file draws them.
   ============================================================================= */

function initialsOf(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

export function KpiActionSheet({
  bucket,
  anchor,
  onClose,
  onOpen,
  onCopyPrompt,
}: {
  bucket: ActionBucket;
  anchor: DOMRect;
  onClose: () => void;
  onOpen: (row: ActionRow, nameEl: HTMLElement | null) => void;
  onCopyPrompt: (row: ActionRow) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; narrow: boolean } | null>(
    null,
  );

  /* MEASURE AND CLAMP to the viewport once mounted. Below the cell, left-aligned
     to it, nudged in from either edge; under ~520px it becomes a centered sheet. */
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const narrow = vw < 520;
    const width = narrow ? vw - 24 : 380;
    const left = narrow ? 12 : Math.min(Math.max(anchor.left, 12), vw - width - 12);
    const top = Math.min(anchor.bottom + 8, window.innerHeight - 80);
    setPos({ top, left, width, narrow });
  }, [anchor]);

  /* ESC anywhere closes; focus lands in the panel so keyboard drives it. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const btns = panelRef.current?.querySelectorAll<HTMLButtonElement>("button.kpi-sheet-cta");
        if (!btns || btns.length === 0) return;
        e.preventDefault();
        const arr = Array.from(btns);
        const i = arr.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? Math.min(i + 1, arr.length - 1) : Math.max(i - 1, 0);
        arr[next < 0 ? 0 : next]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLButtonElement>("button.kpi-sheet-cta")?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [onClose]);

  return (
    <div className="kpi-sheet-layer" onMouseDown={onClose} role="presentation">
      <div
        ref={panelRef}
        className="kpi-sheet"
        role="dialog"
        aria-label={`${bucket.title} — fast actions`}
        onMouseDown={(e) => e.stopPropagation()}
        style={
          pos
            ? {
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: pos.width,
                visibility: "visible",
              }
            : { position: "fixed", visibility: "hidden" }
        }
      >
        <div className="kpi-sheet-head">
          <span className="kpi-sheet-title">{bucket.title}</span>
          <span className="kpi-sheet-triage">{bucket.triage}</span>
        </div>

        {bucket.rows.length === 0 ? (
          <div className="kpi-sheet-empty">Nothing here right now.</div>
        ) : (
          <div className="kpi-sheet-rows">
            {bucket.rows.map((r) => (
              <div key={r.accountId} className={`kpi-sheet-row ${r.tone}`}>
                <span className="kpi-sheet-ava mono">{initialsOf(r.name)}</span>
                <div className="kpi-sheet-body">
                  <div className="kpi-sheet-row-top">
                    <b className="kpi-sheet-name">{r.name}</b>
                    <span className="kpi-sheet-amt num">{fmtMoney(r.tce ?? 0)}</span>
                  </div>
                  <div className="kpi-sheet-read">{r.read}</div>
                  <div className="kpi-sheet-actions">
                    <button
                      type="button"
                      className="kpi-sheet-cta"
                      onClick={(e) => {
                        const nameEl = (e.currentTarget.closest(".kpi-sheet-row") ?? null)?.querySelector<HTMLElement>(
                          ".kpi-sheet-name",
                        );
                        onOpen(r, nameEl ?? null);
                      }}
                    >
                      {r.ctaLabel}
                    </button>
                    <button
                      type="button"
                      className="kpi-sheet-copy"
                      onClick={() => onCopyPrompt(r)}
                      title="Drop a ready instruction into the composer"
                    >
                      Copy prompt
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
