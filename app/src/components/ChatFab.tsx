import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { useApp, ACCOUNT_TABS } from "../state/appState";
import { FloatingPanel } from "./FloatingPanel";
import { ChatPanelBody } from "./ChatPanel";
import { ActionsPanelBody } from "./ActionsPanel";
import { ActionPanel } from "./ActionPanel";
import { closeActionTicket, openActionTicket, useActionTicket } from "./actionTicket";
import { ActionGlyph } from "./ActionIcon";
import { BrandGlyph } from "./brand";
import { Portal } from "./Portal";
import { isTopmost, pushModal } from "./modalStack";
import { resolveBundle, type ActionIcon as IconName } from "../actions/registry";
import { packageRecords } from "../actions/schemas";
import { packageDeepLink, recordDeepLink } from "./DeepLink";
import { openFacilityRoom } from "./workroom/roomSession";
import { openRelationshipRoom } from "./relationship/relSession";
import { openMemoRoom } from "./memo/memoSession";
import { openSpreadingRoom } from "./workroom/spreadSession";
import { relOpeningForAccount } from "./relationship/RelationshipRoom";
import { smartOpeningFor } from "./workroom/route";
import { sowSeed } from "./workroom/seed";
import "../styles/fab.css";
import "../styles/chat.css";

/* =============================================================================
   SURFACE 4 — THE FAB, THE ARC, THE NARRATOR CHIP, THE CHAT LIFECYCLE.

   The mark in the corner is the app's ONE floating control. On the landing it
   opens the assist directly, because credit actions make no sense without a
   client (rule 50). On a client it fans a quarter-circle of FOUR satellites —
   the assist at the top, the two credit rooms between, and the Salesforce cloud
   at the horizontal (rule 49) — narrated by ONE anchored chip beneath the mark
   (rule 54), over a barely-there radial scrim so the glass discs read against a
   busy content page rather than dissolving into it (founder, 2026-09-01).
   Opening the assist makes the mark YIELD entirely; the panel takes its exact
   spot, minimize folds it into a glass pill holding that same spot, and close
   brings the mark back (rule 56).

   THREE ROUTE, ONE BRANCHES (founder, 2026-09-01). Modification and Renewal
   collapsed into ONE "Facility Actions" satellite on 2026-08-31 — they are the
   same room now, and which route a session takes is the room's own first
   question rather than a decision the arc makes on the banker's behalf. The
   seat that freed up went to the CLOUD, which is a door to the org rather than
   a room: pressing it fans a SECOND TIER of two smaller bubbles, the client's
   Account page and their latest Product Package, each opening the real record
   in a new tab. It is the reason the hero no longer carries a text link to the
   same place: the cloud is the door now.

   ONE HANDLER, ONE GATE (HANDOVER §4, trap 5). Every satellite routes through
   `runArcAction`, which resolves the client ONCE and refuses to act without
   one. The bug this trap is named for was a satellite carrying its own direct
   listener straight into the room, past the gate the shared handler applies.
   No satellite here has an onClick of its own.
   ============================================================================= */

type ArcAct = "chat" | "facility" | "memo" | "spread" | "relationship" | "salesforce";

/** The arc: SIX satellites on a 150px radius, evenly spread across the quarter,
 *  staggered 28ms apart by index.
 *
 *  THE TWO ANCHORS NEVER MOVE and they are the only thing the geometry is
 *  allowed to fix: the chat at the top, the Salesforce cloud at the horizontal.
 *  Everything between them is the SWEEP, and the sweep is respread whenever a
 *  seat is added rather than squeezing the new one in beside the old ones.
 *
 *  THE HISTORY, because each step was a founder call and the next person should
 *  not have to re-derive them: four seats on r=96 at 30° steps (2026-09-01,
 *  49.7px neighbour rhythm), five on r=124 at 22.5° steps (2026-09-04, 48.4px),
 *  and now six on r=150 at 18° steps (2026-09-12, the Spreading room took a
 *  seat of its own per BOOM-UPLOAD-SPEC §2). Six 40px discs at r=124 would land
 *  2·124·sin(11.25°) = 38.8px apart and TOUCH; at r=150 they land
 *  2·150·sin(9°) = 46.9px apart, which is the ~46px rhythm rule 49 has held
 *  since the five-arc, to the pixel.
 *
 *  The offsets below ARE that geometry, rounded to the pixel the transform will
 *  paint at: (0,-150) (-46,-143) (-88,-121) (-121,-88) (-143,-46) (-150,0).
 *  They are written out rather than computed for the same reason the dummy's
 *  were — the arc is a set of approved positions, and a formula in the source
 *  invites the next person to re-tune the sweep instead of asking the founder. */
const ARC: {
  act: ArcAct;
  /** The narrator chip's word for it. One or two words so the centred chip can
   *  never spill the viewport at 1360w (rule 54). */
  label: string;
  aria: string;
  tx: number;
  ty: number;
  /** The registry action this satellite routes to, and its icon in the app's
   *  ONE icon language (rule 35) — the same glyph the Client Actions row for
   *  this action wears, so the two entry points read as the same thing. */
  actionId?: string;
  icon?: IconName;
  domId?: string;
}[] = [
  // SIX SEATS ON THE QUARTER ARC (2026-09-12: the Spreading room is a room of
  // its own and gets its own chip, BOOM-UPLOAD-SPEC §2). The arc's two anchors
  // are unchanged and are the only things the geometry is allowed to fix: the
  // chat at the top, the cloud at the horizontal. What moved is the SWEEP, and
  // it had to: six 40px discs at the five-arc's r=124 would land 38.8px apart
  // and touch. So the radius goes to 150 and the six respread at 18deg steps,
  // which puts neighbouring centres 2·150·sin(9°) = 46.9px apart — the ~46px
  // rhythm rule 49 has held since the five-arc, to the pixel.
  //
  // WRITTEN OUT, NOT COMPUTED, for the reason the four-arc and the five-arc
  // were: the arc is a set of positions somebody approved, and a formula in the
  // source invites the next person to re-tune the sweep instead of asking.
  // These six are (0,-150) (-46,-143) (-88,-121) (-121,-88) (-143,-46) (-150,0).
  { act: "chat", label: "Assist", aria: "Assist chat", tx: 0, ty: -150 },
  { act: "facility", label: "Facility Actions", aria: "Facility Actions", tx: -46, ty: -143, actionId: "loan-modification", icon: "modify", domId: "actFacility" },
  { act: "memo", label: "Credit memo", aria: "Credit memo workroom", tx: -88, ty: -121, icon: "memo", domId: "actMemo" },
  // THE STATEMENT SHEET WITH AN UP-ARROW. It has no entry in the registry's
  // icon language yet, so it is drawn inline here exactly as the chat's speech
  // bubble is, at the same 16-unit grid and the same 1.5 stroke.
  { act: "spread", label: "Spread financials", aria: "Spread financials", tx: -121, ty: -88, domId: "actSpread" },
  { act: "relationship", label: "Relationship", aria: "Relationship Actions", tx: -143, ty: -46, icon: "person", domId: "actRelationship" },
  // THE CLOUD AT THE HORIZONTAL (founder, 2026-09-01). It is not a fifth room:
  // it is the door to the org, and it opens a second tier rather than routing.
  { act: "salesforce", label: "Salesforce", aria: "Salesforce records", tx: -150, ty: 0, icon: "cloud", domId: "actSalesforce" },
];

/** THE SECOND TIER — the cloud's own two doors.
 *
 *  A BRANCH, NOT A THIRD ARC. The two bubbles sit on a small bow AROUND the
 *  Salesforce satellite — the main arc's curvature echoed at r=54 from the
 *  cloud, sweeping from just above its outward radial up toward the arc's own
 *  bend. A mirror-symmetric fan put both at the same x and the pair read as a
 *  straight vertical stack (founder, 2026-09-01); breaking the mirror is what
 *  makes it a bow. Written as absolute offsets from the mark, like the arc's,
 *  because that is what the transform paints: the cloud's own (-150,0) plus
 *  54·(−cosθ, −sinθ) at θ=48° and θ=4° above the radial = (-186,-40) and
 *  (-204,-4).
 *
 *  They drive the SAME anchored narrator chip the satellites do (rule 54). A
 *  floating label on a 34px disc would be the exact thing that rule bans.
 *
 *  THEY MOVE WITH THEIR PARENT. The cloud went from (-96,0) to (-124,0) to
 *  (-150,0) as the arc respread; the bow is measured from the cloud, so both
 *  offsets carry the same 26px the cloud just took. The bow itself, r=54 at
 *  θ=48° and θ=4° above the outward radial, is untouched. */
const SF_TIER: {
  key: "account" | "package";
  label: string;
  aria: string;
  icon: IconName;
  tx: number;
  ty: number;
  domId: string;
}[] = [
  { key: "account", label: "Account page", aria: "Open the Account page in Salesforce", icon: "building", tx: -186, ty: -40, domId: "sfAccount" },
  { key: "package", label: "Latest package", aria: "Open the latest Product Package in Salesforce", icon: "package", tx: -204, ty: -4, domId: "sfPackage" },
];

/** The honest reason a tier bubble is dead. It is a title, never a toast: the
 *  bubble is visible so the banker knows the door exists, and disabled so they
 *  never get a wrong record or a login page for an org they are not in (A29). */
const SF_UNRESOLVED = "Not connected to the org";

const ARC_LABEL_AT_REST = "Client actions";

/** Count of SERVER (agent-authored) messages only — the unread watermark basis.
 *  Locally echoed messages are deliberately excluded: they vanish on a full
 *  artifact replace, so counting them would inflate the watermark past the
 *  server total and swallow the next genuine reply (C7). */
function useServerMessageCount(): number {
  const { data } = useApp();
  return useMemo(() => {
    let n = 0;
    for (const t of data.aiPanel?.threads ?? []) n += (t.messages ?? []).length;
    return n;
  }, [data.aiPanel]);
}

/** One satellite. It renders and it narrates; it does not decide anything.
 *
 *  NARRATION IS A NATIVE LISTENER ON PURPOSE. React synthesises onMouseEnter
 *  from delegated mouseover/mouseout at the root and never listens for
 *  `mouseenter` itself, so a raw dispatched `mouseenter` — which is how the
 *  acceptance probe drives the chip, and how any automation would — would go
 *  unheard. The chip is the only thing that tells a banker what a bare icon
 *  does, so it answers the real event. */
function ArcSatellite({
  spec,
  index,
  open,
  onNarrate,
  onPick,
}: {
  spec: (typeof ARC)[number];
  index: number;
  open: boolean;
  onNarrate: (label: string | null) => void;
  onPick: (act: ArcAct) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const label = spec.label;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => onNarrate(label);
    const leave = () => onNarrate(null);
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
    };
  }, [label, onNarrate]);

  return (
    <button
      ref={ref}
      type="button"
      id={spec.domId}
      className="arcbtn eg-glass eg-glass-satellite"
      data-act={spec.act}
      aria-label={spec.aria}
      /* Closed, the arc is not a place: it is folded into the mark, does not
         answer the pointer, and must not answer the Tab key either. */
      tabIndex={open ? 0 : -1}
      aria-hidden={open ? undefined : true}
      style={{ "--tx": `${spec.tx}px`, "--ty": `${spec.ty}px`, "--i": index } as CSSProperties}
      onClick={() => onPick(spec.act)}
    >
      {spec.icon ? (
        <ActionGlyph name={spec.icon} />
      ) : spec.act === "spread" ? (
        /* A statement sheet with an up-arrow: the page, its folded corner, and
           the arrow that says the sheet goes somewhere. */
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 2.4h5.4L12.6 5.6v8H4z" />
          <path d="M9.4 2.4v3.2h3.2" />
          <path d="M8.3 11.9V8.1M6.7 9.7l1.6-1.6 1.6 1.6" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 7.6c0 3-2.7 5.4-6 5.4-.7 0-1.4-.1-2-.3L2.6 13.7l.8-2.5C2.5 10.2 2 9 2 7.6c0-3 2.7-5.4 6-5.4s6 2.4 6 5.4Z" />
        </svg>
      )}
    </button>
  );
}

/** One second-tier bubble: an org record, one tab away.
 *
 *  IT NARRATES THE SAME WAY ITS PARENT DOES, and for the same reason — the raw
 *  `mouseenter` React never listens for is what the acceptance probe dispatches,
 *  and the anchored chip is the only thing that tells a banker what a 34px disc
 *  opens.
 *
 *  NO LISTENER OF ITS OWN (trap 5). The href is resolved ONCE, upstream, behind
 *  the same client gate every satellite passes through; this renders what it is
 *  handed. Where the resolver came back null — no `meta.instanceUrl`, or no
 *  package id on the bundle — it renders as a DISABLED span rather than a link,
 *  because a guessed host is worse than no door at all (A29). `onPick` is the
 *  arc's shared fold-the-corner handler, not a second route into the record. */
function SfBubble({
  spec,
  index,
  open,
  href,
  onNarrate,
  onPick,
}: {
  spec: (typeof SF_TIER)[number];
  index: number;
  open: boolean;
  href: string | null;
  onNarrate: (label: string | null) => void;
  onPick: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const label = spec.label;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const enter = () => onNarrate(label);
    const leave = () => onNarrate(null);
    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);
    return () => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
    };
  }, [label, onNarrate]);

  const style = { "--tx": `${spec.tx}px`, "--ty": `${spec.ty}px`, "--i": index } as CSSProperties;
  const glyph = <ActionGlyph name={spec.icon} />;

  if (!href) {
    return (
      <span
        ref={ref as React.RefObject<HTMLSpanElement>}
        id={spec.domId}
        className="sfbtn eg-glass eg-glass-chip is-dead"
        data-sf={spec.key}
        role="link"
        aria-label={`${spec.label}, ${SF_UNRESOLVED.toLowerCase()}`}
        aria-disabled="true"
        title={SF_UNRESOLVED}
        style={style}
      >
        {glyph}
      </span>
    );
  }

  return (
    <a
      ref={ref as React.RefObject<HTMLAnchorElement>}
      id={spec.domId}
      className="sfbtn eg-glass eg-glass-chip"
      data-sf={spec.key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={spec.aria}
      tabIndex={open ? 0 : -1}
      aria-hidden={open ? undefined : true}
      style={style}
      onClick={onPick}
    >
      {glyph}
    </a>
  );
}

/** The assist itself: the panel at the mark's spot, its two ghost controls, and
 *  the pill that holds the spot while the panel is folded away.
 *
 *  IT IS NEVER UNMOUNTED, and that is the point. "The conversation is kept"
 *  (rule 56) is not a promise about the thread alone — it is about the whole
 *  in-flight state of the exchange, the half-typed question, the answer still
 *  arriving, the ticket a chip just opened. React would reset every bit of that
 *  on a remount, so the assist lives exactly as the dummy's does: one element,
 *  always in the page, whose `show` class is the entire state machine. Closed
 *  it also drops its dialog role, so nothing offers a dialog that is not there.
 *
 *  All three of its effects are gated on `open` rather than on mounting, so the
 *  modal layer, the focus handoff and the Escape key still begin and end with
 *  the conversation. */
function Assist({
  open,
  subtitle,
  minimized,
  onMinimize,
  onRestore,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  subtitle: string;
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const layerId = useId();

  useEffect(() => (open ? pushModal(layerId) : undefined), [open, layerId]);

  // Focus enters on open and returns to the mark on close. Minimising is not a
  // close, so this does not run for it.
  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    if (node && !node.contains(document.activeElement)) {
      (node.querySelector<HTMLElement>("[data-autofocus]") ?? node).focus({ preventScroll: true });
    }
    return () => returnFocusTo()?.focus?.({ preventScroll: true });
  }, [open, returnFocusTo]);

  // A folded panel is `display:none`, which drops whatever was focused inside
  // it on the floor. Focus follows the conversation into the pill and back.
  useEffect(() => {
    if (!open) return;
    const target = minimized
      ? pillRef.current
      : (panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? null);
    target?.focus({ preventScroll: true });
  }, [open, minimized]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A31.1 — Escape belongs to the innermost layer. A ticket opened from a
      // chat chip is deeper than this, and closing here would take both down.
      if (!isTopmost(layerId)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, layerId]);

  const showPanel = open && !minimized;
  return (
    <Portal>
      <div
        ref={panelRef}
        id="chatpanel"
        {...(open ? { role: "dialog", "aria-modal": "false" as const } : { "aria-hidden": true as const })}
        aria-label="Ask the desk"
        tabIndex={-1}
        className={`chatpanel eg-glass eg-glass-panel${showPanel ? " show" : ""}`}
      >
        <div className="chatctl">
          <button type="button" className="chatx" id="chatMin" aria-label="Minimize chat" onClick={onMinimize}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className="chatx" id="chatX" aria-label="Close chat" onClick={onClose}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="chathead">
          <div className="chattitle">Ask the desk</div>
          <div className="chatsub">{subtitle}</div>
        </div>
        <ChatPanelBody />
      </div>

      <button
        ref={pillRef}
        type="button"
        id="chatMini"
        className={`chatmini eg-glass${open && minimized ? " show" : ""}`}
        aria-label="Restore the assist"
        aria-hidden={open && minimized ? undefined : true}
        tabIndex={open && minimized ? 0 : -1}
        onClick={onRestore}
      >
        Assist
      </button>
    </Portal>
  );
}

/** Page-agnostic floating action surface: the mark, bottom right, present on
 *  the landing and every client tab. */
export function ChatFab() {
  const { data, state, dispatch } = useApp();
  const fabRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const serverCount = useServerMessageCount();

  const [arcOpen, setArcOpen] = useState(false);
  /** The cloud's second tier. It is a state of the OPEN arc, never a surface of
   *  its own: folding the arc folds this with it, always. */
  const [tierOpen, setTierOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  /** The staged-action ticket a satellite opened, if any. Held in a module
   *  store so the arc's shared handler and every other caller reach it the same
   *  way (components/actionTicket.ts). */
  const panelActionId = useActionTicket();
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);

  const open = state.panel === "chat";
  const unread = Math.max(0, serverCount - state.seenServerCount);

  const account =
    state.view === "account" && state.accountId
      ? data.portfolio.accounts.find((a) => a.accountId === state.accountId)
      : null;
  const onClient = state.view === "account" && !!state.accountId;

  // Clamp DOWN when the server prunes its history, so a shrunken thread cannot
  // leave a stale watermark that hides the next reply (C7).
  useEffect(() => {
    if (state.seenServerCount > serverCount) dispatch({ type: "SET_SEEN", count: serverCount });
  }, [serverCount, state.seenServerCount, dispatch]);

  // Opening the panel marks everything currently on the server as seen.
  useEffect(() => {
    if (open && state.seenServerCount !== serverCount) dispatch({ type: "SET_SEEN", count: serverCount });
  }, [open, serverCount, state.seenServerCount, dispatch]);

  // Folding the arc also puts the narrator back to rest, and takes the cloud's
  // second tier down with it. Clicking a satellite closes the arc without a
  // mouseleave ever firing, so without this the chip would still be reading the
  // last thing you touched when it next opens.
  const closeArc = useCallback(() => {
    setArcOpen(false);
    setTierOpen(false);
    setHoverLabel(null);
  }, []);

  // The arc belongs to the client it was fanned on. Leaving takes it with you.
  useEffect(() => {
    if (!onClient) closeArc();
  }, [onClient, closeArc]);

  // Outside click and Escape collapse the arc, exactly as the dummy does. The
  // listener is always live and asks whether the click landed inside the mark's
  // corner, rather than being armed and disarmed around the open state.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeArc();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeArc();
    };
    document.addEventListener("click", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [closeArc]);

  const openAssist = useCallback(() => {
    setMinimized(false);
    dispatch({ type: "SET_PANEL", panel: "chat" });
  }, [dispatch]);

  const closeAssist = useCallback(() => {
    setMinimized(false);
    dispatch({ type: "SET_PANEL", panel: "none" });
  }, [dispatch]);

  /**
   * THE SHARED HANDLER, AND ITS CLIENT GATE (HANDOVER §4, trap 5).
   *
   * Every satellite ends here. The client is resolved once, from view state,
   * and nothing downstream of the gate runs without one — so there is exactly
   * one place where "which client is this for?" is answered, and no second path
   * that can be wired past it later.
   *
   * The three credit actions route to the surfaces the app already has:
   * Facility Actions opens the UNIFIED room, unbound, and the room's first
   * question decides whether this session is a modification, a renewal or a new
   * facility; the other two open the same staged-action ticket they always have.
   * Per-action availability is deliberately NOT re-litigated here — the
   * destination surface owns the honest reason a thing cannot be done, and a
   * second copy of that judgement in the corner would be the next thing to
   * drift out of step with it.
   */
  const runArcAction = useCallback(
    (act: ArcAct) => {
      const accountId = state.view === "account" ? state.accountId : null;

      /* THE CLOUD BRANCHES, IT DOES NOT ROUTE (founder, 2026-09-01). It is the
         one satellite that leaves the corner open behind it: pressing it fans
         the second tier, pressing it again folds it. The gate still applies —
         the records it offers belong to a client, and there is no tier without
         one — which is why this sits INSIDE the shared handler rather than on
         the button, where a second listener would be trap 5 all over again. */
      if (act === "salesforce") {
        if (!accountId) return; /* the gate */
        setTierOpen((v) => !v);
        setHoverLabel(null);
        return;
      }

      closeArc();
      if (act === "chat") {
        openAssist();
        return;
      }
      if (!accountId) return; /* the gate */
      const accountName =
        data.portfolio.accounts.find((a) => a.accountId === accountId)?.name ??
        data.borrower?.snapshot?.name ??
        "this relationship";

      if (act === "facility") {
        // NOTHING TELEPORTS (rule 58). A glass seed circle ripples out of the
        // exact satellite that was pressed, timed with the room's opacity
        // entrance. It is sown HERE, inside the shared handler and AFTER the
        // client gate — trap 5: a second direct listener on the button would
        // fire the seed on a press the gate then refused, which is how the arc
        // opened a room on a client it had no business opening.
        sowSeed(document.querySelector('.arcbtn[data-act="facility"]'));
        // THE OPENING IS DERIVED, NEVER INVENTED. `smartOpeningFor` consults the
        // deal and hands back a signal or null; null opens on the neutral
        // three-way, and the room never suggests a route the data did not make.
        const bundle = resolveBundle(data, accountId);
        openFacilityRoom({
          accountId,
          accountName,
          opening: smartOpeningFor({ data, bundle, accountName, productPackageId: null }),
        });
        return;
      }
      if (act === "memo") {
        // THE MEMO ROOM, from the arc: no route to bind, the room reads the org
        // for what was done on the relationship and opens on the package it
        // finds (the greeting names it). Same seed, same gate as the others.
        sowSeed(document.querySelector('.arcbtn[data-act="memo"]'));
        openMemoRoom({ accountId, accountName, productPackageId: null, trigger: "adhoc" });
        return;
      }
      if (act === "spread") {
        // THE SPREADING ROOM, from the arc: no route to bind and nothing to
        // fetch. Everything it needs at open is in the book, so the drop zone
        // paints on the first frame. Same seed, same gate as the others.
        sowSeed(document.querySelector('.arcbtn[data-act="spread"]'));
        openSpreadingRoom({ accountId, accountName });
        return;
      }
      if (act === "relationship") {
        // Same doctrine as the facility room: seed from the pressed satellite,
        // opening derived from the data or honestly neutral (rule 58 + the
        // channel-none discipline), all inside the shared handler's gate.
        sowSeed(document.querySelector('.arcbtn[data-act="relationship"]'));
        openRelationshipRoom({
          accountId,
          accountName,
          opening: relOpeningForAccount({ data, accountId }),
        });
        return;
      }
      const spec = ARC.find((a) => a.act === act);
      if (spec?.actionId) openActionTicket(spec.actionId);
    },
    [closeArc, openAssist, state.view, state.accountId, data],
  );

  /**
   * THE TIER'S TWO HREFS, RESOLVED ONCE, HERE.
   *
   * Same doctrine the hero and the dossier have always followed: the org's
   * Lightning host is `meta.instanceUrl` at RUNTIME and is never hardcoded,
   * never rebuilt from an org id, never guessed at a My Domain (A29). The
   * package is the one the ROOMS anchor on — `packageRecords` puts the
   * relationship's own package first — so the cloud and the workroom can never
   * disagree about which deal "the package" means.
   *
   * Either href comes back null when the piece it needs is missing, and the
   * bubble renders disabled rather than wrong.
   */
  const sfHrefs = useMemo(() => {
    const accountId = state.view === "account" ? state.accountId : null;
    const instanceUrl = data.meta?.instanceUrl;
    const packageId = packageRecords(resolveBundle(data, accountId))[0]?.id;
    return {
      account: recordDeepLink(instanceUrl, "Account", accountId ?? undefined),
      package: packageDeepLink(instanceUrl, packageId),
    };
  }, [data, state.view, state.accountId]);

  const tabLabel =
    state.view === "account" ? (ACCOUNT_TABS.find((t) => t.id === state.tab)?.label ?? null) : "Worklist";
  const subtitle = `${account ? account.name : "Whole book"}${tabLabel ? ` · ${tabLabel}` : ""}`;

  /* The mark's own label. On a client it fans the arc, so it says so and
     announces its expanded state; on the landing it is the assist and nothing
     else. It never says "close": the mark YIELDS while the assist is open, and
     a control that has stood down is not the one that dismisses it. */
  const fabLabel = onClient
    ? ARC_LABEL_AT_REST
    : unread > 0
      ? `Open chat, ${unread} new`
      : "Open chat";

  let fabWrapClass = "fabwrap";
  if (arcOpen) fabWrapClass += " open";
  if (arcOpen && tierOpen) fabWrapClass += " tier";
  if (open) fabWrapClass += " tucked";

  return (
    <>
      <Assist
        open={open}
        subtitle={subtitle}
        minimized={minimized}
        onMinimize={() => setMinimized(true)}
        onRestore={() => setMinimized(false)}
        onClose={closeAssist}
        returnFocusTo={() => fabRef.current}
      />

      {panelActionId && (
        <ActionPanel actionId={panelActionId} onClose={closeActionTicket} returnFocusTo={() => fabRef.current} />
      )}

      {state.panel === "actions" && (
        <FloatingPanel
          title="Client Actions"
          subtitle={subtitle}
          variant="sheet"
          onClose={() => dispatch({ type: "SET_PANEL", panel: "none" })}
        >
          <ActionsPanelBody />
        </FloatingPanel>
      )}

      {/* One floating surface at a time: the mark stands down while the Client
          Actions panel is open, and returns when it closes (founder feedback
          2026-07-25). */}
      {/* THE ARC'S GROUND (rule 63's dim family). It fades in under the fanned
          satellites so they read over a busy content page, and it never takes
          the pointer: the document listener above is what closes the arc. */}
      {state.panel !== "actions" && onClient && (
        <Portal>
          <div className={`fabscrim${arcOpen ? " show" : ""}`} id="fabScrim" aria-hidden="true" />
        </Portal>
      )}

      {state.panel !== "actions" && (
        <div ref={wrapRef} className={fabWrapClass} id="fabwrap">
          {onClient &&
            ARC.map((spec, i) => (
              <ArcSatellite
                key={spec.act}
                spec={spec}
                index={i}
                open={arcOpen}
                onNarrate={setHoverLabel}
                onPick={runArcAction}
              />
            ))}

          {/* The cloud's branch. Mounted with the corner exactly as the
              satellites are, never with the tier state, so the fan is a
              TRANSITION out of the mark's own spot rather than a mount — and
              the global reduced-motion switch in electric-glass.css turns that
              transition into an instant show/hide without this file needing a
              kill-switch of its own. */}
          {onClient &&
            SF_TIER.map((spec, i) => (
              <SfBubble
                key={spec.key}
                spec={spec}
                index={i}
                open={tierOpen}
                href={sfHrefs[spec.key]}
                onNarrate={setHoverLabel}
                onPick={closeArc}
              />
            ))}

          <button
            ref={fabRef}
            id="fab"
            type="button"
            className="fab"
            aria-label={fabLabel}
            aria-expanded={onClient ? arcOpen : open}
            onClick={() => (onClient ? (arcOpen ? closeArc() : setArcOpen(true)) : openAssist())}
          >
            <BrandGlyph className="gt" />
            {unread > 0 && !open && (
              <span
                className="c360-fab-badge absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10.5px] font-bold"
                style={{ background: "var(--critical)", color: "var(--ink-inverse)", border: "2px solid var(--surface)" }}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {/* Rule 54 — ONE anchored narrator chip, centred under the mark. The
              satellites stay unlabeled icons; per-satellite floating labels are
              banned. It is decorative to a screen reader, which reads each
              satellite's own aria-label instead. */}
          {onClient && (
            <span className="arclbl eg-glass eg-glass-micro" id="arcLbl" aria-hidden="true">
              {hoverLabel ?? ARC_LABEL_AT_REST}
            </span>
          )}
        </div>
      )}
    </>
  );
}
