import { heroOf } from "../book/hero";
import { useEffect, useRef, useMemo } from "react";
import { useApp } from "../state/appState";
import { readAnchors, type Anchor, type BorrowerBundle } from "../data/contract";
import { FiledChip } from "./FiledChip";
import { STATUS } from "../data/finance";
import { gradeColor } from "./RiskGrade";
import { TabContent } from "./tabs";
import { Weave } from "./Weave";
import { SyncButton } from "./SyncSweep";

import { prefersReducedMotion } from "../data/motion";
import { Odo } from "./Odometer";

/* =============================================================================
   SURFACE 2 — THE CLIENT HERO.

   Rule 8: the client identity is its OWN floating glass hero panel — bloom
   inside the glass, an oversized > watermark leaning against the cursor, the
   crumb, the name, the verdict and the anchor strip. The frosted verdict BAR it
   replaces was the app's one glass census violation (0 rims, an 18px blur of its
   own, sticky at the top of an inner scroller); the hero takes the `.eg-glass`
   recipe, so the rims are structural now rather than remembered.

   THE TAB RAIL IS GONE FROM HERE. Rule 11 moved the workspace nav into the
   header capsule, dead centre, where TopBar renders it from the same
   ACCOUNT_TABS this file used to lay out along a border. What is left here is
   the pane the capsule selects.
   ============================================================================= */

/** The circumference the mint draws the grade ring on: 2πr at r=19. */
const RING_CIRCUMFERENCE = 119.4;
/**
 * The rating scale the ring reads against. The mint draws grade 3 at offset
 * 74.6 and grade 7 at 14.9 on that circumference, which is exactly g/8 of the
 * ring in both cases; its third client (grade 5) is authored at 41.8, three
 * pixels off the line those two define and the one hand-typed figure in the
 * set. The rule the pair agree on is the rule.
 */
const GRADE_SCALE = 8;

function ringOffset(grade: string | null): number {
  const n = grade == null ? NaN : parseInt(grade, 10);
  if (Number.isNaN(n)) return RING_CIRCUMFERENCE;
  const filled = Math.max(0, Math.min(1, n / GRADE_SCALE));
  return +(RING_CIRCUMFERENCE * (1 - filled)).toFixed(1);
}

/** True for the strip's rating cell, whatever the agent labelled it. */
function isRatingAnchor(a: Anchor): boolean {
  return /^(risk\s*)?(rating|grade)$/i.test(a.label.trim());
}

/**
 * THE ANCHOR A FILED MODIFICATION IS ABOUT (rules 62 + 1).
 *
 * The workroom's manifest carries a COMMITTED delta, so the cell it belongs
 * beside is the one the read calls committed or total exposure — whatever the
 * agent labelled it. The FIGURE DOES NOT MOVE: booked is the only committed
 * (rule 1), and an unbooked version is not a number this cell may state. The
 * delta lands next to it as a labelled chip instead.
 */
function isExposureAnchor(a: Anchor): boolean {
  return /^(total\s+)?(committed|exposure|total\s+exposure|commitment)$/i.test(a.label.trim());
}

/** Split "$12.5M" / "1.42×" / "75 days" into the figure and its unit. Purple
 *  discipline allows exactly one violet on a number, and it is the unit. */
function splitUnit(value: string): [string, string] {
  const m = value.match(/^(.*?\d)(\s*[^\d]+)$/);
  return m ? [m[1], m[2]] : [value, ""];
}

function AnchorCell({ a, deltaMM, newPackage, washed }: { a: Anchor; deltaMM: number; newPackage: boolean; washed: boolean }) {
  const moved = isExposureAnchor(a);
  const [figure, unit] = splitUnit(a.value);
  const arrow = a.dir === "down" ? "↓" : a.dir === "up" ? "↑" : "";
  const arrowColor = a.dir === "down" ? STATUS.red.fg : STATUS.green.fg;
  return (
    <div className={`anchor ${moved && washed ? "washed" : ""}`} id={moved ? "ancExposure" : undefined}>
      <div className="l">{a.label}</div>
      <div className="v num">
        {/* THE BOOKED FIGURE, and the odometer still owns its text node so a
            live sync landing a new committed is watched turning over rather
            than found already changed (rule 61). What it no longer does is
            roll on an execute: nothing was booked by one. */}
        {moved ? <Odo id="ancExpV" value={figure} /> : figure}
        {unit && <span className="u">{unit}</span>}
        {arrow && (
          <span className="dn" style={{ color: arrowColor }}>
            {arrow}
          </span>
        )}
      </div>
      {/* THE FILED DELTA, ADJACENT AND LABELLED (rule 1). Never summed into the
          figure above it: an unbooked version is a separate fact. */}
      {moved && <FiledChip deltaMM={deltaMM} id="ancExpFiled" newPackage={newPackage} />}
      {a.sub && <div className="s">{a.sub}</div>}
    </div>
  );
}

/** The grade cell: the ring states the rating as a quantity, the text states it
 *  as a word. A28.2 keeps the package STAGE out of here — it is a different
 *  fact about a different object, and package facts live with the package — so
 *  the anchor's own `sub` is dropped and provenance stays where it has always
 *  been, on the cell's title. The mint spells a source and a rating date on
 *  this line; this book carries neither, and a caption is not worth inventing
 *  one for. */
function GradeCell({ anchor, grade }: { anchor: Anchor | undefined; grade: string | null }) {
  if (!anchor) return null;
  return (
    <div className="anchor grade-cell" title="Salesforce risk rating">
      <svg className="gr" viewBox="0 0 46 46" aria-hidden="true">
        <circle className="bg" cx="23" cy="23" r="19" fill="none" strokeWidth="4" />
        <circle
          className="fg"
          cx="23"
          cy="23"
          r="19"
          fill="none"
          strokeWidth="4"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={ringOffset(grade)}
          transform="rotate(-90 23 23)"
        />
        <text x="23" y="28" textAnchor="middle">
          {grade ?? "—"}
        </text>
      </svg>
      <div>
        <div className="l">{anchor.label}</div>
        <div className="v" style={{ fontSize: 13, color: gradeColor(grade) ?? undefined }}>
          {anchor.value}
        </div>
      </div>
    </div>
  );
}

/** Rule 62.1 — the ring DRAWS itself on every client entry: pinned back to the
 *  full circumference with the transition off, then released to the grade over
 *  1s. Without the reflow between the two writes the browser coalesces them and
 *  nothing moves. */
function useRingDraw(accountId: string | null) {
  useEffect(() => {
    const fg = document.querySelector<SVGCircleElement>("#view-account .gr .fg");
    if (!fg || prefersReducedMotion()) return;
    const target = fg.getAttribute("stroke-dashoffset") ?? "";
    fg.style.transition = "none";
    fg.style.strokeDashoffset = String(RING_CIRCUMFERENCE);
    fg.getBoundingClientRect();
    fg.style.transition = "";
    const raf = requestAnimationFrame(() => {
      fg.style.strokeDashoffset = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [accountId]);
}

/** Rule 62.3 — hero depth. The watermark leans up to 6px/4px AGAINST the
 *  cursor over a 1.2s settle. Depth, never a gimmick wobble, so the pointer has
 *  to be near the panel for it to answer at all. */
function useWatermarkLean(hero: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    /* READ ONCE, WRITE ON A FRAME (founder, 2026-09-04: the cockpit "seems to
       overload"). This handler used to call getBoundingClientRect on every
       pointermove, which forces a synchronous layout of the whole document
       between the browser's own hit test and its next paint, hundreds of times
       a second, on the thread the pointer lives on, to move a watermark six
       pixels. The rect is measured when the pointer ARRIVES and on the two
       things that can move the hero underneath it; the move handler only
       records where the pointer is, and a single scheduled frame does the
       write. Identical depth, no reflow. */
    let rect: DOMRect | null = null;
    let at: { x: number; y: number } | null = null;
    let queued = false;

    const measure = () => {
      rect = hero.current?.getBoundingClientRect() ?? null;
    };

    const paint = () => {
      queued = false;
      const wm = hero.current?.querySelector<HTMLElement>(".acct-wm");
      if (!wm || !rect || !at) return;
      if (at.y < rect.top - 80 || at.y > rect.bottom + 80) return;
      const dx = ((at.x - rect.left) / rect.width - 0.5) * -6;
      const dy = ((at.y - rect.top) / rect.height - 0.5) * -4;
      wm.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    };

    const onMove = (e: PointerEvent) => {
      at = { x: e.clientX, y: e.clientY };
      if (rect === null) measure();
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    };

    const invalidate = () => {
      rect = null;
    };

    measure();
    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", invalidate, { passive: true });
    window.addEventListener("resize", invalidate, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", invalidate);
      window.removeEventListener("resize", invalidate);
    };
  }, [hero]);
}

export function AccountWorkspace({ bundle }: { bundle: BorrowerBundle }) {
  const { data, state, dispatch } = useApp();
  const snap = bundle.snapshot;
  const account = data.portfolio.accounts.find((a) => a.accountId === state.accountId);
  const name = account?.name ?? snap?.name ?? "—";
  const sector = [snap?.industry, snap?.naicsCode ? `NAICS ${snap.naicsCode}` : null].filter(Boolean).join(" · ") || "—";
  const grade = snap?.primaryRiskRating ?? null;

  /* THE HERO IS DERIVED FROM THE READS (founder, 2026-09-09: a live relationship
     opened as a name over an empty strip, because the summary and the chips
     had only ever been hand-written into the baked snapshot). `heroOf` writes
     both from the exposure and covenant reads the panes below show; the baked
     text stands only while the bundle cannot yet say what it carries. */
  const derived = useMemo(() => heroOf(bundle), [bundle]);
  const verdict = derived?.verdict ?? bundle.verdict;
  const anchors = derived ? derived.anchors : readAnchors(bundle);
  const ratingAnchor = anchors.find(isRatingAnchor);
  const rest = anchors.filter((a) => a !== ratingAnchor);

  /* THE FILED DELTA (rules 62 + 1). An execute in the workroom filed an unbooked
     version; the anchor states what is BOOKED and carries the filed delta beside
     it as a chip, and the violet wash settles on the cell ONCE when the glass
     lifts — the wash marks the relationship as touched, not the figure as moved. */
  const deltaMM = (state.accountId && state.writeBacks[state.accountId]) || 0;
  const deltaNewPackage = Boolean(state.accountId && state.writeBackNewPackage[state.accountId]);
  const washing = !!state.accountId && state.washes.includes(state.accountId);
  useEffect(() => {
    if (!washing || !state.accountId) return;
    const id = state.accountId;
    const t = window.setTimeout(() => dispatch({ type: "CLEAR_WASH", accountId: id }), 1900);
    return () => clearTimeout(t);
  }, [washing, state.accountId, dispatch]);

  const hero = useRef<HTMLDivElement | null>(null);
  useRingDraw(state.accountId);
  useWatermarkLean(hero);

  return (
    <>
      <div className="page" style={{ paddingTop: 22 }}>
        <div className="hero eg-glass" ref={hero}>
          {/* THE LANDING'S WEAVE, INSIDE THE GLASS (founder, 2026-09-01): the
              same generated threads the home page breathes, clipped to the
              hero's radius and masked hard toward the name so the identity
              texture carries over without ever competing with the words. It
              paints at z -1 — above the hero's own bloom, below everything
              written. The > watermark stays; the two share the corner. */}
          <Weave className="hero-weave" />
          {/* Rule 40: the hero watermark is one of the six sanctioned mark
              sites, and it is the SAME typographic ">" the rest of the app
              uses — never a second, drawn rendition of the shape. */}
          <span aria-hidden="true" className="c360-glyph acct-wm">
            &gt;
          </span>
          <div className="crumb">
            <button type="button" id="goHome" onClick={() => dispatch({ type: "GO_HOME" })}>
              ‹ Worklist
            </button>
            <span>/</span>
            <span>{sector}</span>
          </div>
          <div className="acct-name-row">
            <span className="acct-name">{name}</span>
            {/* The package STAGE CHIP is RETIRED from this row (founder,
                2026-09-01): the hero is the RELATIONSHIP, and a package-stage
                fact against the client's name was the wrong object's status in
                the wrong place. The stage still lives where the package does. */}
            {/* The Client Actions button is RETIRED (founder call, 2026-08-31
                night): the > FAB arc owns client actions now, full stop. Sync
                stays as the hero's one quiet secondary control. */}
            <span className="hero-controls">
              {/* THE HERO'S nCINO LINK IS GONE (founder, 2026-09-01): "the
                  cloud is the door now". The Account record is reached from the
                  Salesforce satellite's second tier in the corner, which is
                  where every org door lives, so the hero is back to ONE control
                  and the client's identity is not sharing its line with a
                  destination. */}
              <SyncButton accountId={snap.accountId} accountName={name} bundle={bundle} />
            </span>
          </div>
          {verdict && <p className="verdict">{verdict}</p>}
          <div className="anchors num">
            <GradeCell anchor={ratingAnchor} grade={grade} />
            {rest.map((a) => (
              <AnchorCell key={a.label} a={a} deltaMM={deltaMM} newPackage={deltaNewPackage} washed={washing} />
            ))}
          </div>
        </div>
      </div>

      {/* The pane the capsule selected. Re-keyed per tab so `panein` replays:
          a 3px settle, never the view-level 8px jump (rule 61). */}
      <div className="page">
        <section className="pane show" id={`pane-${state.tab}`} key={state.tab}>
          <TabContent tab={state.tab} bundle={bundle} />
        </section>
      </div>
    </>
  );
}
