import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../state/appState";
import { GroundSheet } from "./GroundSheet";
import { TopBar } from "./TopBar";
import { Landing } from "./Landing";
import { Whisper } from "./Whisper";
import { IntentWhisper } from "./IntentWhisper";
import { MailWhisper } from "./MailWhisper";
import { AccountWorkspace } from "./AccountWorkspace";
import { ChatFab } from "./ChatFab";
import { CommandPalette } from "./CommandPalette";
import { EmptyState } from "./ui";
import { WorkroomHost } from "./workroom/WorkroomHost";
import { RelationshipRoomHost } from "./relationship/RelationshipRoom";
import { MemoRoomHost } from "./memo/MemoRoomHost";
import { buildWorklistRows } from "../data/worklistRows";
import { useKeepAlive } from "../channel/keepAlive";
import { useOpenRefresh } from "../channel/openRefresh";
import { CockpitState } from "../state/cockpitState";
import { HealthLine } from "./HealthLine";

type ViewRef = React.RefObject<HTMLDivElement | null>;

/**
 * The mint's `show()`, translated. Both views stay mounted; one of them carries
 * `show`. The class work is imperative rather than rendered because the name
 * flight writes `noanim` onto the client view from OUTSIDE React, between the
 * two measurements of its ghost — a rendered className would overwrite it on the
 * very next commit.
 *
 * TRAP 2 IS THE ORDER OF THESE TWO LINES. `noanim` comes off a view that is
 * about to be hidden, never one that is visible: clearing it while the view is
 * shown flips animation none -> viewin and restarts the whole entry animation.
 */
function useViewSwitch(home: ViewRef, account: ViewRef, current: "home" | "account") {
  useEffect(() => {
    for (const [name, ref] of [["home", home], ["account", account]] as const) {
      const el = ref.current;
      if (!el) continue;
      if (name !== current) el.classList.remove("noanim");
      el.classList.toggle("show", name === current);
    }
  }, [home, account, current]);
}

export function AppShell() {
  const { data, worklist, state } = useApp();
  /* KEEP THE CONNECTOR SESSION WARM while the cockpit is open. One cheap read
     every four minutes, silent, paused while the page is hidden. See
     channel/keepAlive.ts for why the Salesforce-hosted session needs it. */
  useKeepAlive();
  /* THE RELATIONSHIP READS ITSELF ON OPEN. The cockpit is opened from chat
     against a pinned artifact whose baked clock is weeks old, so landing on an
     account has to be the thing that goes and gets the truth: stored last-good
     first, then the six detail reads, each on its own lane. See
     channel/openRefresh.ts. */
  useOpenRefresh();
  const staged =
    state.accountId
      ? (data.borrowers ?? {})[state.accountId] ??
        (data.borrower?.snapshot?.accountId === state.accountId ? data.borrower : undefined)
      : undefined;
  // Live refreshes are merged OVER the staged snapshot at read time, so a
  // partial refresh never blanks a slice the org failed to return.
  const patch = state.accountId ? state.livePatches[state.accountId] : undefined;
  /* SHALLOW MERGE, WITH ONE KEYHOLE. A live snapshot REPLACES the staged one,
     but a patch stored before the read carried the review dates would blank
     the review card forever (founder, 2026-09-03, three rounds of "why is
     there no review"). The two review fields fall back to the staged snapshot
     when the synced one does not carry them. */
  const bundle = useMemo(() => {
    if (!staged || !patch) return staged;
    const merged = { ...staged, ...patch };
    const ps = patch.snapshot as (typeof staged)["snapshot"] & { nextReviewDate?: string; lastReviewDate?: string };
    const ss = staged.snapshot as typeof ps;
    if (ps && ss) {
      merged.snapshot = {
        ...ps,
        nextReviewDate: ps.nextReviewDate ?? ss.nextReviewDate,
        lastReviewDate: ps.lastReviewDate ?? ss.lastReviewDate,
      } as typeof ps;
    }
    return merged;
  }, [staged, patch]);
  const home = state.view === "home";

  // The header capsule appears only on a client (rule 11). The flag is a body
  // class rather than a prop because the capsule is positioned chrome, and CSS
  // is where its enter and exit live.
  useEffect(() => {
    document.body.classList.toggle("on-client", !home);
    return () => document.body.classList.remove("on-client");
  }, [home]);

  const homeRef = useRef<HTMLDivElement | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);
  useViewSwitch(homeRef, accountRef, state.view);

  const topRow = useMemo(() => buildWorklistRows(data, worklist)[0], [data, worklist]);

  return (
    /* THE WINDOW SCROLLS BOTH VIEWS. The client view used to be a
       viewport-locked shell with its own inner scroller, which meant the sticky
       bar could never learn that content had slid beneath it (rule 70.5) and the
       hero could never leave the top of the screen. Both views are documents
       now, exactly as the mint has them. */
    <div className="flex min-h-screen flex-col">
      {/* THE GROUND, BEFORE ANY OF IT. Refraction bends what is behind a panel
          and the cockpit canvas is flat by design, so on the main pages the
          bend had nothing to act on. In liquid mode this is what it acts on:
          two slow blooms, and no linework, which the founder ruled out for the
          page ground on 2026-09-03. */}
      <GroundSheet />
      <TopBar />
      <div className="flex flex-1">
        <main className="flex flex-1 flex-col">
          {/* EACH VIEW'S CONTENT MOUNTS ON ENTRY and unmounts on the way out,
              while the view element itself stays. That is what makes the anchor
              cascade and the grade ring replay on EVERY entry (rules 60 and
              62.1) instead of once per session, it leaves the flight and trap 2
              an element to write their classes onto, and it stops the weave's
              rAF loop from breathing a band nobody is looking at. */}
          <div className="view" id="view-home" ref={homeRef}>
            {home && <Landing />}
          </div>
          <div className="view" id="view-account" ref={accountRef}>
            {!home &&
              (bundle ? (
                <AccountWorkspace bundle={bundle} />
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <EmptyState
                    title="Account not staged"
                    body="This account has no bundle in the current snapshot. Return to the worklist and open it via the agent."
                  />
                </div>
              ))}
          </div>
        </main>
      </div>
      {home && <Whisper row={topRow} />}
      {/* THE INTENT LANE'S ONE SURFACE. It renders null on every view with no
          pending intent for where the banker is standing, which is every view
          on a page with no store at all. */}
      <IntentWhisper />
      <MailWhisper />
      <ChatFab />
      <CommandPalette />
      {/* The workroom is a FULL-SURFACE overlay over the cockpit, so it mounts
          at the shell rather than inside the panel that opened it: closing that
          panel must not take the room down with it. */}
      <WorkroomHost />
      {/* The second unified room, mounted beside the first for the same reason:
          it is a full-surface overlay, so closing whatever opened it must not
          take the room down. The two sessions are independent stores and only
          one is ever open. */}
      <RelationshipRoomHost />
      {/* The third, and the last of the rooms. Same reason, same independence:
          the memo session is its own store, and the doors that open it close
          whichever room they were standing in. */}
      <MemoRoomHost />
      {/* THE PAGE SAYS WHERE IT IS STANDING. One small document in the
          artifact's own store, kept current, so a Cowork session asked "what am
          I looking at" can answer from the cockpit rather than from a guess.
          A COMPONENT, NOT A HOOK ON THE SHELL: it subscribes to lane health and
          all three room sessions, and those must never be able to re-render the
          account view's panes. See state/cockpitState.ts and the SKILL section
          that reads the document. */}
      <CockpitState />
      {/* THE CONNECTOR STATUS LINE, last in the document and last in the eye.
          It is the source the unreachable banner quotes its "why" from, so the
          two can never disagree about which lane went and when. */}
      <HealthLine />
    </div>
  );
}
