import { useEffect, useRef } from "react";
import { db } from "../channel/dbDoor";
import { laneOf, useLaneHealth } from "../channel/laneHealth";
import { SERVERS } from "../channel/mcp";
import { currentGlass } from "../glassMode";
import { readStoredPlan, type PlanRoute } from "../components/workroom/planStore";
import { useFacilityRoom } from "../components/workroom/roomSession";
import { useRelationshipRoom } from "../components/relationship/relSession";
import { useMemoRoom } from "../components/memo/memoSession";
import { useApp } from "./appState";
import { queueSentence, type QueueBucket } from "../data/queue";

/* =============================================================================
   THE COCKPIT STATE DOCUMENT, what the banker is actually looking at.

   FOUNDER, 2026-09-06, agreeing to it in one line: "a cockpit state document
   the page keeps current (open account, open room, staged plan, last filed
   version, health) and a line in the skill that reads it before answering, so
   'what am I looking at?' in Cowork gets a real answer."

   THE PROBLEM IT SOLVES. Cowork chat and the cockpit are two windows onto the
   same afternoon and neither can see the other. A banker says "file that" or
   "what's staged" or just "what am I looking at", and the session has no way to
   know which relationship is open, which room is up, or what was staged twenty
   minutes ago; the honest answers were all some version of "I cannot see your
   screen". The page CAN see its own screen, and it already has a store the
   session can read. So it writes one document and keeps it current.

   ONE DOCUMENT, SMALL, DEBOUNCED. `state/cockpit`, under 8 KB, at most one
   write every 500ms. It is a POSITION, not a log: no history, no message
   bodies, no figures, and it is overwritten in place. A session that wants the
   trail reads the systems of record, which is what the skill tells it to do.

   NOTHING FROM THE WRITE PATH TRAVELS. No decision token, no plan hash, no
   staging id, no idempotency key. The store is shared and every viewer of the
   artifact can read it; a token that survives in it is a token somebody else
   can replay, and the confirm gate's whole contract is that one banker saw one
   plan. The staged plan appears here as a COUNT and a stamp, never as a means
   of executing anything. Same rule `lastGood.ts` writes under, for the same
   reason.

   AND IT GOES THROUGH THE GUARDED DOOR. `dbDoor` screens every write for the
   shapes a web application firewall reads as an attack, which is how the
   founder got blocked by Cloudflare on 2026-09-06. Nothing here carries markup
   by construction (names, ids, counts and timestamps), and it is screened
   anyway, because "by construction" is what the memo store believed too.

   ABSENCE IS THE COMMON CASE. With no `db` grant this hook writes nothing and
   the cockpit is byte-identical to the one that shipped before it existed.
   ============================================================================= */

export const COCKPIT_STATE_COLLECTION = "state";
export const COCKPIT_STATE_DOC = "cockpit";

/** Never more often than this. A health lane updates on every connector call
 *  and six of those land inside a second on an open; the banker's position has
 *  not changed six times. */
export const COCKPIT_STATE_DEBOUNCE_MS = 500;

/** A ceiling this document has no honest way to reach: it holds one account,
 *  one room, a handful of counts and six lane rows. Enforced anyway, because a
 *  document that grew past it would mean something unbounded got in. */
export const MAX_COCKPIT_STATE_BYTES = 8 * 1024;

export interface CockpitLaneState {
  state: string;
  /** When the lane last answered, ISO. Absent means it never has. */
  lastGoodAt?: string;
  /** What its last round trip cost, ms. */
  lastMs?: number;
  code?: string;
}

/** WHAT THE LANDING SAYS NEEDS ATTENTION, so a session can answer "what needs
 *  my attention" from the banker's own screen instead of re-reading the org and
 *  possibly disagreeing with it. Counts only: no names, no figures, no ids. The
 *  relationships themselves are a read away and the skill says where. */
export interface CockpitQueueState {
  /** Rows on the needs-action queue right now. */
  needsAction: number;
  /** Packaged relationships carrying no signal, under the divider. */
  quiet: number;
  /** Every packaged relationship the page can see. */
  bookSize: number;
  /** TRUE when this membership came off a live Portfolio read this session;
   *  false means the page is still standing on the baked snapshot. */
  live: boolean;
  /** One count per reason, each relationship counted once under its loudest.
   *  Sums to `needsAction`. */
  byReason: Partial<Record<QueueBucket, number>>;
  /** The same sentence the banker is reading above the rows. */
  line: string;
}

export interface CockpitStateDoc {
  openAccount: { id: string; name: string } | null;
  /** The landing's queue, whichever surface the banker is standing on. */
  queue: CockpitQueueState;
  openTab: string;
  openRoom: { kind: "facility" | "relationship" | "memo"; route: string | null; packageId: string | null; since: string } | null;
  /** A MIRROR, read-only, and never the token. */
  stagedPlan: { packageId: string; route: string; lines: number; stagedAt: string } | null;
  lastFiled: { kind: string; title: string; at: string; packageId: string | null; recordName: string | null } | null;
  health: Record<string, CockpitLaneState>;
  glass: string;
  build: string;
  updatedAt: string;
}

/** The lanes the document reports, under the words the health line uses, so a
 *  session quoting this document and a founder reading the footer say the same
 *  thing about the same connector. */
const LANES: ReadonlyArray<readonly [string, string]> = [
  ["Salesforce", SERVERS.customer360],
  ["Backup", SERVERS.readBackup],
  ["Gateway", SERVERS.gateway],
  ["Inbox", SERVERS.m365],
  ["nCino", SERVERS.experience],
  ["AFS", SERVERS.afs],
];

const iso = (ms: number | undefined): string | undefined =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;

function healthNow(): Record<string, CockpitLaneState> {
  const out: Record<string, CockpitLaneState> = {};
  for (const [label, server] of LANES) {
    const lane = laneOf(server);
    // A lane nobody has called and nobody granted has nothing to say here
    // either. Same filter the health line applies, for the same reason.
    if (!lane || (lane.grant === "granted" && lane.state === "idle")) continue;
    const row: CockpitLaneState = { state: lane.grant === "granted" ? lane.state : lane.grant };
    const at = iso(lane.lastGoodAt);
    if (at) row.lastGoodAt = at;
    if (typeof lane.lastMs === "number") row.lastMs = lane.lastMs;
    if (lane.code) row.code = lane.code;
    out[label] = row;
  }
  return out;
}

/** How long a mirrored plan may be believed before it is read again. A room
 *  writes its plan as the banker builds it, so the count moves; re-reading on
 *  every debounce tick would put a store read behind every lane update. */
const PLAN_REREAD_MS = 2000;

/**
 * Keep the cockpit state document current for as long as the cockpit is open.
 *
 * Every dependency here is something the banker can see on their own screen;
 * nothing is derived and nothing is inferred.
 *
 * MOUNT IT THROUGH {@link CockpitState}, NEVER FROM THE SHELL DIRECTLY. This
 * hook subscribes to four stores, lane health and the three room sessions ,
 * and a hook subscribes whatever COMPONENT calls it. Called from AppShell, a
 * connector answering or a room opening would re-render the entire cockpit, and
 * the account view's panes are the most expensive commit in the app. In a
 * component of its own that renders null, the same four subscriptions wake
 * nothing but this file.
 */
export function useCockpitState(): void {
  const { data, state, queue } = useApp();
  /* SUBSCRIBED FOR THE RE-RENDER, which is what makes a lane change reach the
     document at all. The map itself is the dependency: it is a fresh object
     only when a lane actually changed, so a document write follows a real lane
     transition and never a render somebody else caused. The rows are read back
     through `laneOf` so the shape written is the one this file owns. */
  const lanes = useLaneHealth();
  const facility = useFacilityRoom();
  const relationship = useRelationshipRoom();
  const memo = useMemoRoom();

  /* WHEN EACH ROOM OPENED, not when this effect last ran. A room's own session
     carries no timestamp, so the first render that sees one stamps it and every
     render after keeps that stamp; closing the room clears it. Without this the
     document would say a room opened at whatever moment a connector answered. */
  const roomSince = useRef<Record<string, string>>({});
  const plan = useRef<{ key: string; at: number; doc: CockpitStateDoc["stagedPlan"] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accountId = state.accountId;
  const bundle = accountId ? (data.borrowers ?? {})[accountId] : undefined;
  const packageId =
    (state.accountId && (state.livePatches[state.accountId]?.snapshot ?? bundle?.snapshot)?.productPackageId) || null;

  const openRoom: CockpitStateDoc["openRoom"] = facility
    ? { kind: "facility", route: facility.bound ?? facility.route ?? null, packageId: facility.productPackageId ?? null, since: "" }
    : relationship
      ? { kind: "relationship", route: relationship.route ?? null, packageId: relationship.productPackageId ?? null, since: "" }
      : memo
        ? { kind: "memo", route: memo.trigger, packageId: memo.productPackageId ?? null, since: "" }
        : null;

  if (openRoom) {
    const key = `${openRoom.kind}:${openRoom.packageId ?? ""}`;
    roomSince.current[key] ??= new Date().toISOString();
    openRoom.since = roomSince.current[key];
  } else {
    roomSince.current = {};
  }

  /* THE LAST THING THIS PAGE ACTUALLY FILED. Session-local by design: it is the
     newest EXECUTED entry on the open relationship, which is the one the banker
     means by "the one I just filed". The org's durable trail is a separate and
     better source for anything older, and the skill sends the session there. */
  const filed = accountId
    ? (state.sessionActivity[accountId] ?? []).find((e) => e.kind === "ACTION_EXECUTED")
    : undefined;

  const tab = state.tab;
  const glass = currentGlass();
  /* THE SENTENCE, NOT A SECOND DERIVATION OF IT. The document carries exactly
     what the landing says, so a session quoting it and a banker reading the
     page never disagree about how many relationships need something today. */
  const queueLine = queueSentence(queue.summary);

  useEffect(() => {
    const store = db();
    if (!store) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void (async () => {
        /* THE PLAN IS A MIRROR AND IT IS READ, NOT REMEMBERED. The rooms own
           the staged plan; this file has no business holding a second copy of
           it, so it reads the room's own document and carries the two facts a
           session needs to answer a question: how many lines, and when. */
        let staged: CockpitStateDoc["stagedPlan"] = null;
        if (openRoom?.kind === "facility" && openRoom.packageId && openRoom.route && accountId) {
          const key = `${accountId}:${openRoom.packageId}:${openRoom.route}`;
          const cached = plan.current;
          if (cached && cached.key === key && Date.now() - cached.at < PLAN_REREAD_MS) {
            staged = cached.doc;
          } else {
            const doc = await readStoredPlan(accountId, openRoom.packageId, openRoom.route as PlanRoute);
            staged = doc
              ? { packageId: doc.packageId, route: doc.route, lines: doc.cards.length, stagedAt: doc.stagedAt }
              : null;
            plan.current = { key, at: Date.now(), doc: staged };
          }
        } else {
          plan.current = null;
        }

        const doc: CockpitStateDoc = {
          openAccount: accountId ? { id: accountId, name: bundle?.snapshot?.name ?? accountId } : null,
          queue: {
            needsAction: queue.summary.needsAction,
            quiet: queue.summary.quiet,
            bookSize: queue.summary.bookSize,
            live: queue.summary.live,
            byReason: queue.summary.byBucket,
            line: queueLine,
          },
          openTab: tab,
          openRoom,
          stagedPlan: staged,
          lastFiled: filed
            ? {
                kind: filed.kind,
                title: filed.title,
                at: filed.ts,
                packageId,
                recordName: filed.reference?.label ?? null,
              }
            : null,
          health: healthNow(),
          glass,
          build: __C360_BUILD__,
          updatedAt: new Date().toISOString(),
        };

        // A document this size means something unbounded got in. Refuse rather
        // than send it: the whole point of one small document is that a session
        // can read it in a breath.
        if (JSON.stringify(doc).length > MAX_COCKPIT_STATE_BYTES) return;

        try {
          await store.collection(COCKPIT_STATE_COLLECTION).doc(COCKPIT_STATE_DOC).set(doc as unknown as Record<string, unknown>);
        } catch {
          // No grant, no quota, no network. The banker's page is unaffected,
          // and the skill's own fallback is to read the systems of record.
        }
      })();
    }, COCKPIT_STATE_DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    // `openRoom` is rebuilt on every render, so it is compared by its parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    bundle?.snapshot?.name,
    packageId,
    tab,
    glass,
    filed?.id,
    openRoom?.kind,
    openRoom?.route,
    openRoom?.packageId,
    openRoom?.since,
    lanes,
    queue.summary,
  ]);
}

/**
 * The writer, as a component that draws nothing.
 *
 * A null render is the point: this is where the four subscriptions live, so
 * they can change as often as the connectors do without ever reaching a pane.
 */
export function CockpitState(): null {
  useCockpitState();
  return null;
}
