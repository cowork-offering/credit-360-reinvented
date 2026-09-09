import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, useLivePortfolioResult } from "../state/appState";
import { queueSentence } from "../data/queue";
import { buildWorklistRows, type WorklistRow } from "../data/worklistRows";
import { fmtMoney, fmtDays } from "../data/format";
import { gradeColor } from "./RiskGrade";
import type { ReasonCode } from "../data/contract";
import { REASON_META } from "./reasons";
import { CopyPromptDialog } from "./CopyPromptDialog";
import { flyName } from "./nameFlight";
import { Odo } from "./Odometer";
import { FiledChip } from "./FiledChip";
import { mcpAvailable } from "../channel/mcp";
import { announce, openAccountLive } from "../book/dynamicBook";
import { CMDK_OPEN_EVENT } from "./CommandPalette";
import { WorklistSkeleton } from "./HomeSkeleton";

/* =============================================================================
   THE WORKLIST — the landing's third beat.

   ROWS, NOT A TABLE. The mint's queue is a stack of solid white cards: who,
   what is wrong in words, what it is worth, and an arrow. The sortable
   tanstack header, the search field and the reason-filter rail are gone from
   this surface; rule 45 put search behind the header's ⌘K chip, which is the
   palette this app already ships. The DATA is untouched — the same
   buildWorklistRows over the same derived worklist, in the same severity order.

   STATUS IS TYPOGRAPHY (systemNonNegotiable), never pill soup: a coloured word
   with a 5px dot. Rule 20: hover is LIFT + SHADOW only — an inset accent bar
   reads as a spine and is banned. Rule 13: no per-row meters, no sparklines.
   The numbers carry it.
   ============================================================================= */

interface Status {
  tone: "good" | "warn" | "bad" | "acc" | "mut";
  text: string;
}

const REASON_TONE: Record<ReasonCode, Status["tone"]> = {
  CLIENT_REQUEST: "acc",
  COVENANT_BREACH: "bad",
  COVENANT_EXCEPTION: "warn",
  COVENANT_DUE: "warn",
  MATURITY_NEAR: "acc",
  MODIFICATION_CLUSTER: "mut",
  GUARANTOR_SIGNAL: "warn",
  RECENTLY_MODIFIED: "mut",
};


/** The row's status line. A reason that HAS a date says the date: "Test due" on
 *  its own is a category, "Test due · 2d ago" is the reason you are looking at
 *  this row. Reasons the data carries no clock for stay bare rather than
 *  borrowing one. */
function statusesFor(r: WorklistRow): Status[] {
  const out: Status[] = [];
  /* The grade left the pill row (founder, 2026-09-03: "I really hate how
     grade 6 floats around in there"). It renders as the row's own quiet ring
     instead, the same instrument the client hero uses, scaled down. */
  for (const code of r.reasons) {
    const short = REASON_META[code].short;
    let text = short;
    let tone = REASON_TONE[code];
    if ((code === "COVENANT_DUE" || code === "COVENANT_EXCEPTION") && r.nextTestDays != null) {
      text = `${short} · ${fmtDays(r.nextTestDays)}`;
      if (r.nextTestDays < 0) tone = "bad";
    } else if (code === "MATURITY_NEAR" && r.maturityDays != null) {
      text = `${short} · ${fmtDays(r.maturityDays)}`;
    }
    out.push({ tone, text });
  }
  if (!r.staged) out.push({ tone: "mut", text: "not staged" });
  if (r.sample) out.push({ tone: "mut", text: "sample" });
  /* A RELATIONSHIP READ LIVE SAYS WHEN. It is not in the baked snapshot, so the
     row must not pass itself off as one: "live read, 14:32" is the honest
     provenance chip for a bundle that came off the connector this session. */
  if (r.liveReadAt != null) out.push({ tone: "acc", text: `live read, ${clockOf(r.liveReadAt)}` });
  return out;
}

/** The wall clock of a LIVE read. Epoch ms is a page-session fact about a
 *  gesture, not a figure derived from the book, so reading it as local time is
 *  correct here and nowhere near A10. */
function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function initialsOf(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/** One queue row. Extracted so the quiet rest of the book renders through the
 *  SAME markup rather than a second, drifting copy of it. */
function Row({
  r,
  fresh,
  delayMs,
  deltaMM,
  newPackage,
  onOpen,
}: {
  r: WorklistRow;
  fresh: boolean;
  delayMs: number;
  deltaMM: number;
  newPackage?: boolean;
  onOpen: (r: WorklistRow, nameEl: HTMLElement | null) => void;
}) {
  const breach = r.reasons.includes("COVENANT_BREACH");
  const sts = statusesFor(r);
  const urgent = sts.some((s) => s.tone === "bad") ? "bad" : sts.some((s) => s.tone === "warn") ? "warn" : "";
  return (
    <div
      role="button"
      tabIndex={0}
      data-open={r.accountId}
      onClick={(e) => onOpen(r, e.currentTarget.querySelector(".who b"))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(r, e.currentTarget.querySelector(".who b"));
        }
      }}
      className="wlrow"
      /* THE ARRIVAL PLAYS ONCE, PER ROW, EVER. A row that was already on screen
         when the live read landed keeps its place and takes the new figures
         where it stands; only a row that is genuinely new rises. Re-running the
         entry on every refresh is the "stuck" feeling the founder named. */
      style={fresh ? { animationDelay: `${delayMs}ms` } : { animation: "none" }}
    >
      <span className={`mono${breach ? " bad" : ""}`}>{initialsOf(r.name)}</span>
      <span className="who">
        <b>{r.name}</b>
        <span>
          {r.industry}
          {r.naicsCode ? ` · NAICS ${r.naicsCode}` : ""}
        </span>
      </span>
      <span className="sts">
        {/* THE ROW STAYS CLEAN (founder, 2026-09-03, twice: the grades,
            requests, maturities and then the breach word floating in the card
            read as clutter). Nothing sits on the row but one quiet info dot, in
            line before the exposure figure; every status lives in its hover
            column, one under the other, the bad ones in red. */}
        {(sts.length > 0 || r.riskRating != null) && (
          <span className={`wl-info${urgent ? ` ${urgent}` : ""}`} tabIndex={0} aria-label="Details for this relationship">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 7.2v3.4M8 5.05v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="wl-pop" role="tooltip">
              {r.riskRating != null && (
                <span className="wl-pop-row">
                  <span>Risk rating</span>
                  <b style={{ color: gradeColor(String(r.riskRating)) ?? undefined }}>Grade {r.riskRating}</b>
                </span>
              )}
              {sts.map((s) => (
                <span key={s.text} className={`wl-pop-row ${s.tone}`}>
                  <span>{s.text.split(" · ")[0]}</span>
                  <b>{s.text.includes(" · ") ? s.text.split(" · ").slice(1).join(" · ") : ""}</b>
                </span>
              ))}
            </span>
          </span>
        )}
      </span>
      <span className="amt num">
        {/* THE BOOK'S OWN FIGURE, AND ONLY THAT (rule 1). It used to carry the
            workroom's committed delta summed into it, which made the row state
            an exposure the org had not booked. The delta is named under it
            instead, in the same chip the hero anchor and the exposure pane
            carry. */}
        <b>
          <Odo value={fmtMoney(r.tce ?? 0)} />
        </b>
        <span>total exposure</span>
        <FiledChip deltaMM={deltaMM} newPackage={newPackage} />
      </span>
      <span className="go">→</span>
    </div>
  );
}

export function Worklist() {
  const { data, queue, state, dispatch } = useApp();
  const booting = useLivePortfolioResult().booting;
  const worklist = queue.worklist;
  const rows = useMemo(() => buildWorklistRows(data, worklist), [data, worklist]);
  /* THE REST OF THE BOOK, built through the same row builder with no reasons:
     a quiet relationship has nothing to say about itself, and an empty reason
     list is how the popover already renders that. */
  const quietRows = useMemo(
    () => buildWorklistRows(data, { accountIds: queue.quiet, reasons: {} }),
    [data, queue.quiet],
  );
  const [unstaged, setUnstaged] = useState<WorklistRow | null>(null);
  /* COLLAPSED, AND IT STAYS COLLAPSED. The landing is the needs-action queue;
     the book is one click under it, never the thing a banker has to scroll
     past to reach their work. */
  const [restOpen, setRestOpen] = useState(false);

  /* WHICH ROWS THIS PAGE HAS ALREADY SHOWN. Written after the commit, read
     during it, so the first paint staggers everything and no later paint
     staggers anything that survived. */
  const entered = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const r of rows) entered.current.add(r.accountId);
    if (restOpen) for (const r of quietRows) entered.current.add(r.accountId);
  });

  /* THE FRESH-OPEN SKELETON. With a connector and no book yet, the queue is not
     "empty", it is not read; showing the baked samples' rows here is the flash
     this replaces. A returning viewer's cached book has already cleared
     `booting`, so this is the cold open only. Every hook above has run, so the
     early return leaves their order intact. */
  if (booting) return <WorklistSkeleton />;

  /* THE ROW IS THE ONE DOOR IN. Rule 58: nothing teleports, so opening a
     relationship flies its NAME out of this row and into the hero rather than
     cutting to it. Every other entry point (the whisper, and the palette when it
     lands) comes through here rather than dispatching its own navigation, which
     is also what keeps the unstaged branch from being bypassed. */
  function openRow(r: WorklistRow, nameEl: HTMLElement | null) {
    if (!r.staged) {
      /* A ROW WITHOUT A BUNDLE IS NOT A DEAD ROW ANY MORE. The rest of the book
         comes off the live Portfolio read, so the page holds the name and the
         id and can go and read the relationship, which is exactly what the
         palette does with an org match. Nothing is rendered from the row: the
         reads are what open it, and an org with nothing to say leaves the
         banker where they were and says so.

         WITH NO CONNECTOR the A17 copy-prompt explainer stands, unchanged: a
         share link cannot read anything, and an empty workspace is still the
         one thing this must never do. */
      if (mcpAvailable()) {
        void openAccountLive({
          accountId: r.accountId,
          name: r.name,
          // `industry` is a DISPLAY field on the row and carries the gap glyph
          // when the book has none. A glyph is not an industry.
          match: {
            accountId: r.accountId,
            name: r.name,
            industry: r.industry === "—" ? undefined : r.industry,
            naicsCode: r.naicsCode ?? undefined,
          },
        }).then((ok) => {
          if (ok) dispatch({ type: "OPEN_ACCOUNT", accountId: r.accountId });
          else announce(`the org had nothing to read for ${r.name}. Nothing was opened.`);
        });
        return;
      }
      setUnstaged(r); // A17 — copy-prompt explainer, never an empty workspace
      return;
    }
    const open = () => dispatch({ type: "OPEN_ACCOUNT", accountId: r.accountId });
    if (nameEl) flyName(nameEl, open);
    else open();
  }

  /** The stagger runs over the rows that are actually arriving, so one new row
   *  landing in twelfth place enters now rather than in half a second. */
  const stagger = (list: WorklistRow[]) => {
    let n = 0;
    return list.map((r) => {
      const fresh = !entered.current.has(r.accountId);
      return { r, fresh, delayMs: fresh ? n++ * 45 : 0 };
    });
  };

  const queued = stagger(rows);
  const quiet = restOpen ? stagger(quietRows) : [];

  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow">
        <span className="kicker">Worklist</span>
      </div>
      <div className="wl-head">
        Needs action
        {/* THE QUEUE IS NOT THE BOOK. A handful of relationships need something
            today; the org holds the rest, and a banker who came in to open one
            of them should not have to learn that the search chip in the header
            is where that lives. One line, and only where there is a connector
            to search with: with no channel this renders nothing, exactly as
            before. */}
        {mcpAvailable() && (
          <button
            type="button"
            className="wl-open-any"
            id="wlOpenAny"
            onClick={() => window.dispatchEvent(new Event(CMDK_OPEN_EVENT))}
          >
            Open any relationship by name
          </button>
        )}
      </div>
      {/* THE RULE, SAID OUT LOUD, WITH THE PAGE'S OWN NUMBERS IN IT (founder,
          2026-09-08: "needs to be smooth and easy to understand"). A banker
          should be able to read why these rows and not others straight off the
          page rather than being told. */}
      <p className="wl-rule" data-probe="queue-rule">
        {queueSentence(queue.summary)}
      </p>

      {rows.length === 0 ? (
        <div className="card wl-empty">
          Queue clear. No relationship in the book is outside tolerance on this snapshot.
        </div>
      ) : (
        <div className="wl">
          {queued.map(({ r, fresh, delayMs }) => (
            <Row
              key={r.accountId}
              r={r}
              fresh={fresh}
              delayMs={delayMs}
              deltaMM={state.writeBacks[r.accountId] ?? 0}
              newPackage={state.writeBackNewPackage[r.accountId]}
              onOpen={openRow}
            />
          ))}
        </div>
      )}

      {queue.summary.quiet > 0 && (
        <>
          {/* THE QUIET DIVIDER. Not a filter and not a tab: the rest of the
              book, named, counted, and one click from open. */}
          <button
            type="button"
            className="wl-rest"
            id="wlRest"
            aria-expanded={restOpen}
            onClick={() => setRestOpen((v) => !v)}
          >
            <span className="wl-rest-l">The rest of the book</span>
            <span className="wl-rest-n">{queue.summary.quiet}</span>
            <span className="wl-rest-a">{restOpen ? "Hide" : "Show"}</span>
          </button>
          {restOpen && (
            <div className="wl wl-quiet">
              {quiet.map(({ r, fresh, delayMs }) => (
                <Row
                  key={r.accountId}
                  r={r}
                  fresh={fresh}
                  delayMs={delayMs}
                  deltaMM={state.writeBacks[r.accountId] ?? 0}
                  newPackage={state.writeBackNewPackage[r.accountId]}
                  onOpen={openRow}
                />
              ))}
              {quietRows.length < queue.summary.quiet && (
                <p className="wl-rule">
                  {queue.summary.quiet - quietRows.length} more sit in the book. Open any of them by name.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {unstaged && (
        <CopyPromptDialog
          cause="unstaged"
          accountName={unstaged.name}
          accountId={unstaged.accountId}
          onClose={() => setUnstaged(null)}
        />
      )}
    </div>
  );
}
