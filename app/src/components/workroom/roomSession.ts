import { useSyncExternalStore } from "react";
import { clearCarriedMail } from "../../actions/mailCarry";
import type { WorkroomMode } from "../../workroom/types";
import type { SmartOpening } from "./route";

/* =============================================================================
   THE UNIFIED ROOM'S SESSION.

   `openWorkroom` (app/src/workroom/openWorkroom.ts) opens a room that ALREADY
   KNOWS its mode — the command palette and a deep link both name one, and that
   path is untouched. The FAB's Facility Actions satellite does not: it opens
   the room on a relationship and lets the room's first question decide which
   engine takes the session.

   That is what this holds. A module store rather than a slice of ViewState for
   the same reason `openWorkroom` is one: the arc button has to be able to open
   the room from outside any provider that owns it, and an unbound room is not a
   view the cockpit persists.

   THE PROVISIONAL ROUTE IS ALWAYS `modify`, and that is a presentation choice
   with nothing riding on it. The room has to STAND on an engine to read the
   package at all — the greeting, the member strip and the figures are the same
   read in all three modes — and `modify` is the grammar the arc has always
   opened on. It writes nothing, stages nothing and names nothing until a route
   is bound; the header says "Facility Actions" for exactly as long as that is
   true. Binding a different route rebuilds the room on that engine.
   ============================================================================= */

export interface RoomSession {
  accountId: string;
  accountName: string;
  /** The engine the room is standing on. Provisional until `bound` is set. */
  route: WorkroomMode;
  /** Null while the room is still asking which route this is. */
  bound: WorkroomMode | null;
  /** The deal signal the room opened on, or null for the neutral question. */
  opening: SmartOpening | null;
  /** A typed line that bound the route. The bound room SAYS it — a banker who
   *  typed "renew the revolver" asked for something, and a room that only
   *  echoed it would have taken the instruction and dropped it. Null for a chip
   *  binding, which answers the question and asks nothing. */
  say: string | null;
  /** The member the binding preselected, where the signal named one. */
  memberId: string | null;
  /** The package the banker anchored the room on, once a relationship carrying
   *  more than one has been narrowed. Null until then. */
  productPackageId: string | null;
  /**
   * THE PACKAGE THE BANKER CHOSE, as distinct from the one they arrived in.
   *
   * A create anchors on the ACCOUNT by default on every relationship (founder,
   * 2026-09-06), so the ambient package above must not pin it. This is set only
   * by `anchorFacilityRoom`, the banker clicking a package chip, and it is
   * the one thing that files a new facility into an existing package instead of
   * a new one. Null means the create room is on its default path.
   */
  joinPackageId: string | null;
}

/** The route the room stands on before the banker has chosen one. */
const PROVISIONAL: WorkroomMode = "modify";

let session: RoomSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the unified room on a relationship, unbound. */
export function openFacilityRoom(args: {
  accountId: string;
  accountName: string;
  opening: SmartOpening | null;
  /** THE PACKAGE THE CALLER ALREADY KNEW. An intent that names one has already
   *  answered the room's package question, so the room binds it and never asks.
   *  Absent is the common case: the FAB and the mail row name a relationship,
   *  and a relationship staging more than one package is asked about. */
  productPackageId?: string | null;
}): void {
  session = {
    accountId: args.accountId,
    accountName: args.accountName,
    route: PROVISIONAL,
    bound: null,
    opening: args.opening,
    say: null,
    memberId: null,
    productPackageId: args.productPackageId ?? null,
    // ARRIVING IN A PACKAGE IS NOT CHOOSING ONE. Only `anchorFacilityRoom` sets
    // the join, and it is the only gesture that speaks for the banker.
    joinPackageId: null,
  };
  emit();
}

/** The banker chose which package to work in. One session is one package is one
 *  plan is one approval, so this rebuilds the room on that anchor.
 *
 *  NULL IS A CHOICE TOO: it is the create room's "New package" chip, taking the
 *  room back to the account anchor after a join. */
export function anchorFacilityRoom(productPackageId: string | null): void {
  if (!session) return;
  session = { ...session, productPackageId: productPackageId ?? session.productPackageId, joinPackageId: productPackageId };
  emit();
}

/**
 * The route is chosen. The room rebuilds on that engine.
 *
 * ROUTE BINDING IS FINAL PER PLAN (founder, 2026-08-31). This is the only way a
 * session changes engine, it is never called while a manifest is staged — the
 * room refuses that out loud and offers an explicit discard first — and there is
 * no path back to the unbound state short of closing the room.
 */
export function bindFacilityRoute(
  route: WorkroomMode,
  opts?: { say?: string | null; memberId?: string | null },
): void {
  if (!session) return;
  session = {
    ...session,
    route,
    bound: route,
    say: opts?.say ?? null,
    memberId: opts?.memberId ?? null,
    /* AND THE JOIN GOES WITH THE ROUTE. The package question runs BEFORE the
       route is picked, the room has to stand on a package to read the
       relationship at all, so the answer to it is not a banker saying "file
       the new facility into this one". A create's join is a decision made
       inside the bound create room, off that room's own offer, and nowhere
       else (founder, 2026-09-06: a new facility creates a new package). */
    joinPackageId: null,
  };
  emit();
}

export function closeFacilityRoom(): void {
  if (!session) return;
  session = null;
  /* THE MESSAGE THE ROOM WAS OPENED ON DIES WITH THE ROOM. A carried mail that
     outlived its session would lead the NEXT room's greeting with a message
     nobody clicked, and would outrank a newer one a sweep had since landed. */
  clearCarriedMail();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): RoomSession | null {
  return session;
}

/** The open unified-room session, or null. One mount reads this. */
export function useFacilityRoom(): RoomSession | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
