import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useApp, ACCOUNT_TABS } from "../state/appState";
import { mcpAvailable } from "../channel/mcp";
import { BrandGlyph } from "./brand";
import { CMDK_OPEN_EVENT } from "./CommandPalette";
import { TabIcon } from "./TabIcon";
import { BoomWaitLine } from "./BoomWaitLine";

/* =============================================================================
   THE APP HEADER — DIRECTION-LOCKED rule 45.

   MINIMAL. The original ">" alone carries the brand (no "accenture" wordmark,
   no divider), then "Credit 360", then the workspace capsule dead-centre, then
   a spacer, a live dot, the cmd-K chip and the avatar. 52px slim glass bar. The
   spelled-out "accenture / Commercial Credit 360 / Live · Salesforce + AFS" header
   is retired, and the user's name and snapshot date went with it: the briefing
   kicker carries the date now, and the avatar carries the name.

   THE CAPSULE (rule 11, Surface 2) is the seven workspace tabs, absolutely
   centred in the bar, visible only on a client. It is rendered on BOTH views —
   invisible, inert and still `display:block` on the landing — because the nav
   has to breathe in rather than pop, and a `display:none` capsule has nothing
   to transition from. Its data source is ACCOUNT_TABS, the same seven panes the
   workspace has always had, re-skinned as icon tabs.

   THE LIVE DOT IS HONEST. The dummy's dot is always green because the dummy has
   nothing behind it. Here it reports the actual connector state: green and
   "Live · Salesforce + AFS" when the MCP surface is present, quiet and "Snapshot"
   when the artifact is running on baked data. A green light over a static
   snapshot is a claim this app does not get to make.
   ============================================================================= */

/** rule 70.5 / INTENT-OVERRIDES #2 — the header knows when content slides
 *  beneath it. `body.scrolled` past 8px, and the bar's shadow eases in and back
 *  out over .4s (the dummy writes that transition and then loses it to a later
 *  lens rule; the port implements the written intent). */
function useScrolledFlag() {
  useEffect(() => {
    const onScroll = () => document.body.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.body.classList.remove("scrolled");
    };
  }, []);
}

/** Rule 60, the light: a 90px specular radial follows the cursor across the
 *  capsule. Hover-gated in CSS; this only feeds it the position. */
function useSpecular() {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const cap = ref.current;
    if (!cap) return;
    const onMove = (e: PointerEvent) => {
      const r = cap.getBoundingClientRect();
      cap.style.setProperty("--mx", `${e.clientX - r.left}px`);
      cap.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    cap.addEventListener("pointermove", onMove, { passive: true });
    return () => cap.removeEventListener("pointermove", onMove);
  }, []);
  return ref;
}

export function TopBar() {
  const { data, state, dispatch } = useApp();
  const user = data.meta?.user ?? "Credit Officer";
  const initials = user.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const live = mcpAvailable();
  useScrolledFlag();
  const capsule = useSpecular();

  return (
    <header className="topbar">
      <div className="topbar-in">
        <BrandGlyph className="brandmark" label="accenture" />
        <span className="apptitle">Credit 360</span>
        <div className="topnav">
          <nav className="icotabs" id="tabs" aria-label="Workspace" ref={capsule}>
            {ACCOUNT_TABS.map((t) => {
              const active = state.view === "account" && state.tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`itab${active ? " active" : ""}`}
                  data-pane={t.id}
                  data-tip={t.label}
                  aria-current={active ? "page" : undefined}
                  tabIndex={state.view === "account" ? undefined : -1}
                  /* THE PANE CHANGES IN THE SAME TICK AS THE PRESS. React's
                     default sync lane commits in a MICROTASK, so for one turn
                     of the loop the outgoing pane is still the shown one and
                     the incoming one does not exist — the tab reads as pressed
                     before anything under it has moved, and the pane's settle
                     animation starts a beat late. A tab is a discrete
                     navigation; it lands now. */
                  onClick={() => flushSync(() => dispatch({ type: "SET_TAB", tab: t.id }))}
                >
                  <TabIcon tab={t.id} />
                  <span className="lbl">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
        <span className="spacer" />
        {/* BOOM IS STILL READING (0.9.31). It sits in the header's own status
            cluster, beside the live dot, because that is the only chrome on the
            page a banker can see from every view without scrolling: the
            connector health line is at the FOOT of the document, and a wait a
            banker has to scroll to find is not one that followed them. It
            renders nothing at all when Boom is holding nothing. */}
        <BoomWaitLine />
        <span
          className="dot-live"
          style={live ? undefined : { background: "var(--ink-faint)" }}
          title={live ? "Live · Salesforce + AFS" : "Snapshot · no live connection"}
        />
        <button
          type="button"
          className="kbd"
          id="cmdkOpen"
          aria-label="Search clients, actions, records"
          onClick={() => window.dispatchEvent(new CustomEvent(CMDK_OPEN_EVENT))}
        >
          ⌘K
        </button>
        <span className="avatar" title={user}>
          {initials}
        </span>
      </div>
    </header>
  );
}
