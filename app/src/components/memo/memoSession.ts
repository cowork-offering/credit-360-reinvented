import { useSyncExternalStore } from "react";
import type { MemoChange } from "../../memo/types";

/* =============================================================================
   THE CREDIT MEMO ROOM'S SESSION.

   The third of three, and the same store as the other two for the same reason
   (`workroom/roomSession.ts`, `relationship/relSession.ts`): the doors that open
   this room sit outside any provider that owns it, and an open memo is not a
   view the cockpit persists.

   WHAT DIFFERS FROM THE OTHER TWO. There is no route to bind. A memo room has
   one job from the moment it opens, so it never asks which room it is; what it
   asks is whether to draft now or be steered first, which is a question about
   the memo and not about the engine behind it.

   WHAT IT CARRIES. A memo opened from a FINALE knows exactly what was just
   filed, because the room that filed it is handing over its own ledger. A memo
   opened from the FAB knows nothing but the package, and reads what was done
   from the ORG. Both are legitimate; the greeting says which one it is standing
   on, because a banker has to know whether the memo is reading the trail or a
   handover (requirements, non-negotiable 1).
   ============================================================================= */

/** What opened the room. It becomes the memo's type on the cover. */
export type MemoTrigger = "modify" | "renew" | "create" | "adhoc";

/**
 * WHAT THE FINALE JUST FILED, AS THE MEMO'S OWN FIRST FACT.
 *
 * FOUNDER, 2026-09-06: "this then directs you to the Credit memo workroom where
 * it inserts all the information."
 *
 * The ledger already crosses as `carried`; this is the SUMMARY around it - the
 * version the filing made, the exposure it moved, and the sentence the sheet
 * put at the top of itself. It exists so the memo room can name the version and
 * the filed lines in its greeting on its FIRST commit, without waiting on a read
 * of the trail, and so the sheet can be redrawn as the room's first timeline row
 * rather than described in prose.
 *
 * NOTHING HERE IS RECOMPUTED. Every field is the sheet's own, carried down the
 * shortest path there is.
 */
export interface MemoFiledSummary {
  /** The sheet's title line, verbatim. */
  title: string;
  /** The version the filing created, where the org returned one. */
  version: string | null;
  kind: MemoTrigger;
  /** One entry per filed change, in the order the ledger listed them. */
  items: Array<{ id: string; label: string; target?: string; before?: string; after?: string; orgId?: string }>;
  exposureBefore: string;
  exposureAfter: string;
  /** True while the org has not confirmed the figures. Carried so the memo does
   *  not restate a settled number as pending, or the reverse. */
  pending: boolean;
}

/** Where the request came from, where it came from anywhere. The intent's own
 *  shape, carried through rather than re-derived. */
export interface MemoRequestSource {
  kind: string;
  subject?: string;
  from?: string;
  received?: string;
}

export interface MemoSession {
  accountId: string;
  accountName: string;
  /** THE VERSION UNDER REVIEW. A memo is always about one package version, so
   *  this is the anchor and not an option; the doors resolve it before opening. */
  productPackageId: string | null;
  trigger: MemoTrigger;
  /** The finale's ledger, where a finale opened this. Null from the FAB. */
  carried: MemoChange[] | null;
  /** How that ledger split between what the banker asked for and what the room
   *  derived. The trail carries its own split; this is the handover's. */
  carriedSplit: { requested: number; derived: number } | null;
  /** The finale's summary, where a finale opened this. Null from the FAB. */
  filed: MemoFiledSummary | null;
  source: MemoRequestSource | null;
  /**
   * A HANDOVER IS RUNNING AND THE GLASS HAS NOT SETTLED YET.
   *
   * The facility room's sheet is still sliding off this room when it mounts, so
   * the memo is on the glass and must not start writing into it: a draft that
   * began under a moving surface is the "hangers" the founder named. It flips
   * once, from `settleMemoHandoff`, on the slide's own end or its ceiling.
   */
  settled: boolean;
}

let session: MemoSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Open the memo room on a package. */
export function openMemoRoom(args: {
  accountId: string;
  accountName: string;
  productPackageId: string | null;
  trigger?: MemoTrigger;
  /** The filed changes, where the caller is a finale that just filed them. */
  carried?: readonly MemoChange[] | null;
  carriedSplit?: { requested: number; derived: number } | null;
  filed?: MemoFiledSummary | null;
  source?: MemoRequestSource | null;
  /** True where the caller is a finale whose sheet is still sliding off. */
  handoff?: boolean;
}): void {
  session = {
    accountId: args.accountId,
    accountName: args.accountName,
    productPackageId: args.productPackageId,
    trigger: args.trigger ?? "adhoc",
    carried: args.carried?.length ? [...args.carried] : null,
    carriedSplit: args.carriedSplit ?? null,
    filed: args.filed ?? null,
    source: args.source ?? null,
    settled: !args.handoff,
  };
  emit();
}

/**
 * THE HANDOVER'S GLASS HAS SETTLED. The memo may start writing.
 *
 * Idempotent, and safe on a session that never had a handover: a room opened
 * from the FAB is settled from its first commit and this changes nothing.
 */
export function settleMemoHandoff(): void {
  if (!session || session.settled) return;
  session = { ...session, settled: true };
  emit();
}

export function closeMemoRoom(): void {
  if (!session) return;
  session = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): MemoSession | null {
  return session;
}

/** The open memo session, or null. One mount reads this. */
export function useMemoRoom(): MemoSession | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
