import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../state/appState";
import { resolveBundle } from "../../actions/registry";
import { packageRecords } from "../../actions/schemas";
import { fetchActionHistory } from "../../channel/cockpitTools";
import { askSession, sampleAvailable } from "../../channel/sampleDoor";
import { buildMemoDossier } from "../../memo/dossier";
import { renderPlanFor } from "../../memo/renderMemo";
import { latestMemo, saveAttestations, saveMemoDraft, type MemoDraft } from "../../memo/store";
import { publishDraft } from "../../memo/publishAdapter";
import type { ActionHistoryRow } from "../../data/contract";
import { MemoRoom, type MemoContext, type MemoDeps, type MemoNarrator } from "./MemoRoom";
import { closeMemoRoom, useMemoRoom } from "./memoSession";
import { executedRead, memoGreeting } from "./memoGreeting";
import { RoomBoundary } from "../workroom/RoomBoundary";

/* =============================================================================
   THE ONE MOUNT.

   The third sibling of `WorkroomHost` and `RelationshipRoomHost`, and it exists
   for the same reason both of them do: it is the only place in this room's tree
   that sits inside the app provider and can see the read. The room itself takes
   a context, a dossier and a greeting and asks nothing about where they came
   from, which is what keeps it testable against injected deps and shipping
   against the live doors.

   THREE READS, AND EVERY ONE OF THEM MAY COME BACK EMPTY:

     the bundle          the relationship, as the cockpit staged it. Without it
                         there is no dossier and the room does not open.
     the action trail    what the org records against this package. The sweep
                         has usually loaded it, WITHOUT step detail; the room
                         asks again with `includeSteps` and the package anchor,
                         which is the read the memo is actually built on.
     the stored memo     the last memo written for this package, if the artifact
                         has a store at all.

   None of the three is awaited before the room opens. The memo is deterministic
   from the bundle alone, so the room appears immediately and the greeting
   restates itself when the trail lands, which is the same discipline the other
   two rooms follow with their own slow reads.
   ============================================================================= */

/** The session brain, as the memo room's narrator. Absent where the door is
 *  not in this view, which the room reads as "no prose" and says out loud. */
function memoNarrator(): MemoNarrator | undefined {
  if (!sampleAvailable()) return undefined;
  return ({ prompt, onText, signal }) =>
    askSession(prompt, {
      tier: "default",
      kind: "reply",
      rung: 2,
      signal,
      onText: (update) => onText?.(update.text),
    });
}

export function MemoRoomHost() {
  const session = useMemoRoom();
  const { data, state } = useApp();

  const accountId = session?.accountId ?? null;
  const bundle = useMemo(() => {
    if (!accountId) return null;
    const baked = resolveBundle(data, accountId);
    const patch = state.livePatches[accountId];
    return baked && patch ? { ...baked, ...patch } : baked;
  }, [data, state.livePatches, accountId]);

  /* THE PACKAGE THE MEMO IS ABOUT. The caller's anchor wins; a room opened from
     the FAB on a relationship staging one package takes that one. A room with
     no anchor at all renders a memo that says so rather than picking. */
  const packages = useMemo(() => packageRecords(bundle), [bundle]);
  const packageId = session?.productPackageId ?? packages[0]?.id ?? null;
  const packageName = packages.find((p) => p.id === packageId)?.label ?? null;

  /* THE TRAIL, WITH STEP DETAIL. The sweep's rows are the floor and they carry
     no steps: `includeSteps` is what lifts the read's 90-day window on step
     detail, and `productPackageId` narrows the trail to this package and the
     versions it forked into. This is the read the change list comes from. */
  const [orgRows, setOrgRows] = useState<ActionHistoryRow[] | null>(null);
  useEffect(() => {
    if (!accountId) {
      setOrgRows(null);
      return;
    }
    let alive = true;
    /* THE PUBLISHED TOOL SCHEMA STILL NAMES ONLY accountId AND maxResults (the API
       catalog lags the Apex deploy), so the two new inputs are not sent yet: the
       read's default already returns steps for executed rows of the last 90 days,
       and executedRead narrows to the package on this side. */
    fetchActionHistory(accountId, 25)
      .then(({ rows }) => {
        if (alive) setOrgRows(rows);
      })
      .catch(() => {
        // A read that did not answer is not an error on the glass: the greeting
        // falls back to the sweep's rows, and says what it is standing on.
      });
    return () => {
      alive = false;
    };
  }, [accountId, packageId]);

  /* THE STORED MEMO, for "Open latest memo". Null covers every absence. */
  const [latest, setLatest] = useState<MemoDraft | null>(null);
  useEffect(() => {
    if (!packageId) {
      setLatest(null);
      return;
    }
    let alive = true;
    void latestMemo(packageId).then((memo) => {
      if (alive) setLatest(memo);
    });
    return () => {
      alive = false;
    };
  }, [packageId]);

  const rows = orgRows ?? (accountId ? state.actionHistory[accountId] : undefined);
  const executed = useMemo(() => executedRead(rows, packageId), [rows, packageId]);

  /* THE CHANGES THIS MEMO IS ABOUT.

     THE HANDOVER LEADS WHERE THERE IS ONE (founder, 2026-09-06: "it inserts all
     the information, but all super super gentle, no hangers"). A room opened by
     a finale is standing on a filing that happened seconds ago, in this session,
     and the trail read that would confirm it has not come back yet - and may
     come back carrying the PREVIOUS filing on this package, which would put the
     wrong change list under the banker's own. So the just-filed ledger is the
     first source and the org's step detail is the second.

     NON-NEGOTIABLE 1 IS UNTOUCHED FOR EVERY OTHER DOOR. A memo opened from the
     FAB, or by anyone at any later moment, carries no handover and reads the
     org, which is the case the requirement is about: the same memo for a viewer
     who never saw the filing. The greeting still says which of the two it is
     standing on, so a banker is never guessing. */
  const changes = session?.carried?.length ? session.carried : executed.changes;

  const dossier = useMemo(() => {
    if (!bundle) return null;
    return buildMemoDossier({
      bundle,
      changes,
      instanceUrl: data.meta?.instanceUrl ?? null,
      productPackageName: packageName,
      creditEvent: session?.trigger === "create" ? "new_relationship" : "existing_material",
    });
  }, [bundle, changes, data.meta?.instanceUrl, packageName, session?.trigger]);

  const greeting = useMemo(() => {
    if (!dossier) return null;
    return memoGreeting({
      packageId,
      packageName,
      trigger: session?.trigger ?? "adhoc",
      executed,
      carried: session?.carried ?? null,
      carriedSplit: session?.carriedSplit ?? null,
      filed: session?.filed ?? null,
      plan: renderPlanFor(dossier),
      hasStoredMemo: latest !== null,
    });
  }, [dossier, packageId, session?.trigger, session?.carried, session?.carriedSplit, session?.filed, executed, latest]);

  const deps = useMemo<MemoDeps>(
    () => ({
      narrate: memoNarrator(),
      save: saveMemoDraft,
      saveAttestations,
      /* THE REAL LANES (phase D), through the adapter: the acting banker and the
         approval address come off the view's meta, never off the page. */
      publish: (draft) =>
        publishDraft(draft, { accountId: draft.accountId, packageId: draft.packageId, meta: data.meta }),
    }),
    [data.meta],
  );

  if (!session || !bundle || !dossier || !greeting) return null;

  const ctx: MemoContext = {
    accountId: session.accountId,
    accountName: session.accountName,
    packageId,
    packageName,
    trigger: session.trigger,
    user: data.meta?.user ?? null,
    generatedAt: data.meta?.generatedAt ?? "",
    source: session.source,
  };

  /* THE ROOM'S OUTER BOUNDARY (2026-09-05). It should never fire: every item
     in the thread already has one of its own. If it does, the room says so in
     its own voice, over the cockpit, and the banker still has every way out.
     A component stack on the glass in front of a client is the failure, not
     the diagnosis, so the detail goes to the console and nowhere else. */
  return (
    <RoomBoundary what="the memo room" scope="room">
      <MemoRoom
        /* Keyed on the package: a memo composed against one version must never
           survive into another, exactly as a manifest must not. */
        key={`memo-${session.accountId}-${packageId ?? "none"}`}
        ctx={ctx}
        dossier={dossier}
        changes={changes}
        greeting={greeting}
        /* THE SHEET, REDRAWN AS THE ROOM'S FIRST TIMELINE ROW, and the flag that
           says the sheet has finished sliding off it. */
        filed={session.filed}
        settled={session.settled}
        latest={latest}
        deps={deps}
        onClose={closeMemoRoom}
      />
    </RoomBoundary>
  );
}
