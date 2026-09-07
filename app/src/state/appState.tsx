import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { mergeDynamicBook, useDynamicBook } from "../book/dynamicBook";
import type { AgentChannel } from "../channel/adapter";
import { createChannel, formatProbe, probeChannels } from "../channel/adapter";
import type { ActionHistoryRow, ActivityEntry, BorrowerBundle, C360Data, Worklist } from "../data/contract";
import { deriveWorklist } from "../data/worklist";
import { loadUi, saveUi, type PersistedUi } from "./persist";
import { dataVersionOf, loadOverlays, type AccountOverlay } from "./syncOverlay";

export const ACCOUNT_TABS = [
  // A30.1 — Activity is FIRST: the account's narrative spine (what happened,
  // what the analysis concluded, what to do next) before the balance detail.
  { id: "activity", label: "Activity" },
  { id: "exposure", label: "Exposure & Collateral" },
  { id: "covenants", label: "Covenants" },
  { id: "graph", label: "Relationship Graph" },
  { id: "opportunities", label: "Opportunities" },
  { id: "signals", label: "Structural Signals" },
  { id: "financials", label: "Financials" },
] as const;

export type AccountTab = (typeof ACCOUNT_TABS)[number]["id"];

/** Session-local echo of a message. Mirrors AiMessage's A12 vocabulary so the
 *  merge in ChatPanel is type-identical (F7). */
export interface LocalMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  ts?: string;
  context?: { accountId?: string; tab?: string };
}

export type PanelKind = "none" | "chat" | "actions";

export interface ViewState {
  view: "home" | "account";
  accountId: string | null;
  tab: AccountTab;
  /** Floating panel state — chat and actions are mutually exclusive (A27). */
  panel: PanelKind;
  draft: string;
  localMessages: LocalMessage[];
  /** High-water mark over SERVER messages only; the FAB badges anything newer. */
  seenServerCount: number;
  /** Session-local ACTION_TRIGGERED entries per account (A31.3). */
  sessionActivity: Record<string, ActivityEntry[]>;
  /** Live patches fetched from the org this session, merged over the staged
   *  bundle at read time. Session-local — a fresh injection supersedes them. */
  livePatches: Record<string, Partial<BorrowerBundle>>;
  /** Freshness per account, from result.cache.storedAt (never Date.now). */
  liveStoredAt: Record<string, number>;
  /** The org's durable action trail per account, from the last sync. Absent
   *  means never fetched; empty means the org says nothing was filed. */
  actionHistory: Record<string, ActionHistoryRow[]>;
  /** When each slow-tier read last ran, per account then bundle key. Inside the
   *  window the sweep serves cache and does not call the tool at all. */
  slowTierFetchedAt: Record<string, Record<string, number>>;
  /** Display ids a sync just changed. The value pulses where it already sits,
   *  then this clears — it is a notification, not a data state. */
  pulse: string[];
  /**
   * WRITE-BACK THROUGH THE GLASS (rule 62).
   *
   * Millions added to a relationship's committed figure by a workroom execute
   * that actually landed. Held APART from `livePatches` on purpose: a live
   * patch rebuilds the workroom's engine, which would knock the room out of the
   * confirmation it is standing on the instant the write-back fired. This slice
   * is read by the cockpit's own figures and by nothing else, so the room can
   * watch the numbers move behind its own blur.
   *
   * A page session, and no longer. Nothing from an execution persists.
   */
  writeBacks: Record<string, number>;
  /**
   * WHICH OF THOSE DELTAS OPENED A PACKAGE OF ITS OWN.
   *
   * A new facility creates a new package (founder, 2026-09-06), so the pending
   * figure on the client page is not "more on the package you were reading" but
   * "a package that did not exist this morning". The chip beside the booked
   * figure says which, because the two are different facts to a banker deciding
   * what to look at next. Sticky per relationship for the page session: a
   * second filing onto an existing package does not un-say the first.
   */
  writeBackNewPackage: Record<string, boolean>;
  /** Relationships whose anchor still owes a violet wash. The wash plays once,
   *  when the glass LIFTS — while the room is open the figure has already
   *  rolled and a wash under the blur would be a light nobody saw. */
  washes: string[];
}

type Action =
  | { type: "OPEN_ACCOUNT"; accountId: string }
  | { type: "GO_HOME" }
  | { type: "SET_TAB"; tab: AccountTab }
  | { type: "SET_PANEL"; panel: PanelKind }
  | { type: "SET_SEEN"; count: number }
  | { type: "LOG_ACTION"; accountId: string; actionLabel: string }
  | { type: "LOG_ACTIVITY"; accountId: string; entry: ActivityEntry }
  | { type: "PATCH_BUNDLE"; accountId: string; patch: Partial<BorrowerBundle>; storedAt?: number }
  | { type: "INGEST_REQUESTS"; accountId: string; entries: ActivityEntry[] }
  | { type: "SET_ACTION_HISTORY"; accountId: string; rows: ActionHistoryRow[] }
  | { type: "SET_SLOW_TIER_FETCHED"; accountId: string; fetchedAt: Record<string, number> }
  | { type: "RESTORE_OVERLAY"; overlays: Record<string, AccountOverlay> }
  | { type: "PULSE"; ids: string[] }
  | { type: "CLEAR_PULSE" }
  | { type: "WRITE_BACK"; accountId: string; committedDeltaMM: number; newPackage?: boolean }
  | { type: "ARM_WASH"; accountId: string }
  | { type: "CLEAR_WASH"; accountId: string }
  | { type: "SET_DRAFT"; draft: string }
  | { type: "PUSH_MESSAGE"; message: LocalMessage }
  | { type: "RESTORE"; ui: Partial<PersistedUi> };

const initial: ViewState = {
  view: "home",
  accountId: null,
  tab: "activity",
  panel: "none",
  draft: "",
  localMessages: [],
  seenServerCount: 0,
  sessionActivity: {},
  livePatches: {},
  liveStoredAt: {},
  actionHistory: {},
  slowTierFetchedAt: {},
  pulse: [],
  writeBacks: {},
  writeBackNewPackage: {},
  washes: [],
};

function reducer(state: ViewState, action: Action): ViewState {
  switch (action.type) {
    case "OPEN_ACCOUNT":
      return { ...state, view: "account", accountId: action.accountId };
    case "GO_HOME":
      // Client Actions is an ACCOUNT-ONLY surface (founder feedback
      // 2026-07-25): there is no trigger on home, so it must not survive
      // navigation back there as an orphaned panel with nothing to act on.
      return { ...state, view: "home", panel: state.panel === "actions" ? "none" : state.panel };
    case "SET_TAB":
      return { ...state, tab: action.tab };
    case "SET_PANEL":
      return { ...state, panel: action.panel };
    case "LOG_ACTION": {
      // `Date.now()` is LEGITIMATE here and does not violate A10. A10 governs
      // DATA-DERIVED reasoning, which must be reproducible against the baked
      // meta.generatedAt snapshot. This is live user-generated state — the
      // banker just clicked, in this session, on this clock. Using the render
      // clock instead would timestamp their action in the past.
      const entry: ActivityEntry = {
        id: `local-${action.accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        kind: "ACTION_TRIGGERED",
        title: action.actionLabel,
        summary: "Sent to the desk",
        actor: "You",
        sessionLocal: true,
      };
      const prev = state.sessionActivity[action.accountId] ?? [];
      return {
        ...state,
        sessionActivity: {
          ...state.sessionActivity,
          // Newest first, capped so a long session cannot grow unbounded.
          [action.accountId]: [entry, ...prev].slice(0, 25),
        },
      };
    }
    case "LOG_ACTIVITY": {
      // Same session-local shelf and the same cap as LOG_ACTION. Deduped by id
      // so a re-render or a replayed execute cannot double-log one write.
      const prev = state.sessionActivity[action.accountId] ?? [];
      if (prev.some((e) => e.id === action.entry.id)) return state;
      return {
        ...state,
        sessionActivity: {
          ...state.sessionActivity,
          [action.accountId]: [action.entry, ...prev].slice(0, 25),
        },
      };
    }
    case "SET_SLOW_TIER_FETCHED": {
      const prev = state.slowTierFetchedAt[action.accountId] ?? {};
      return {
        ...state,
        slowTierFetchedAt: { ...state.slowTierFetchedAt, [action.accountId]: { ...prev, ...action.fetchedAt } },
      };
    }
    case "RESTORE_OVERLAY": {
      // Re-apply a persisted READ overlay over the baked bundle. The stored
      // storedAt is carried through unchanged: restored is not fresh.
      const livePatches = { ...state.livePatches };
      const liveStoredAt = { ...state.liveStoredAt };
      const actionHistory = { ...state.actionHistory };
      const sessionActivity = { ...state.sessionActivity };
      const slowTierFetchedAt = { ...state.slowTierFetchedAt };

      for (const [accountId, overlay] of Object.entries(action.overlays)) {
        if (overlay.patch) livePatches[accountId] = { ...(livePatches[accountId] ?? {}), ...overlay.patch };
        if (typeof overlay.storedAt === "number") liveStoredAt[accountId] = overlay.storedAt;
        if (overlay.history) actionHistory[accountId] = overlay.history;
        if (overlay.activity?.length) {
          const seen = new Set((sessionActivity[accountId] ?? []).map((e) => e.id));
          sessionActivity[accountId] = [
            ...(sessionActivity[accountId] ?? []),
            ...overlay.activity.filter((e) => !seen.has(e.id)),
          ].slice(0, 25);
        }
        if (overlay.fetchedAt) slowTierFetchedAt[accountId] = overlay.fetchedAt;
      }
      return { ...state, livePatches, liveStoredAt, actionHistory, sessionActivity, slowTierFetchedAt };
    }
    case "SET_ACTION_HISTORY":
      // Replaces wholesale: the org's answer is the whole trail as of that read,
      // not a delta to merge into a stale one.
      return { ...state, actionHistory: { ...state.actionHistory, [action.accountId]: action.rows } };
    case "PULSE":
      return { ...state, pulse: action.ids };
    case "CLEAR_PULSE":
      return state.pulse.length ? { ...state, pulse: [] } : state;
    // The delta ACCUMULATES: two executes in one session move the figure twice,
    // and the second must not throw the first away.
    case "WRITE_BACK":
      return {
        ...state,
        writeBacks: {
          ...state.writeBacks,
          [action.accountId]: (state.writeBacks[action.accountId] ?? 0) + action.committedDeltaMM,
        },
        writeBackNewPackage: {
          ...state.writeBackNewPackage,
          [action.accountId]: (state.writeBackNewPackage[action.accountId] ?? false) || action.newPackage === true,
        },
      };
    case "ARM_WASH":
      return state.washes.includes(action.accountId)
        ? state
        : { ...state, washes: [...state.washes, action.accountId] };
    case "CLEAR_WASH":
      return state.washes.includes(action.accountId)
        ? { ...state, washes: state.washes.filter((id) => id !== action.accountId) }
        : state;
    case "PATCH_BUNDLE": {
      const prev = state.livePatches[action.accountId] ?? {};
      return {
        ...state,
        livePatches: { ...state.livePatches, [action.accountId]: { ...prev, ...action.patch } },
        liveStoredAt:
          action.storedAt != null
            ? { ...state.liveStoredAt, [action.accountId]: action.storedAt }
            : state.liveStoredAt,
      };
    }
    case "INGEST_REQUESTS": {
      const prev = state.sessionActivity[action.accountId] ?? [];
      const seen = new Set(prev.map((e) => e.id));
      const fresh = action.entries.filter((e) => !seen.has(e.id));
      if (!fresh.length) return state;
      return {
        ...state,
        sessionActivity: {
          ...state.sessionActivity,
          [action.accountId]: [...fresh, ...prev].slice(0, 25),
        },
      };
    }
    case "SET_SEEN":
      // Exact set, not a max: the watermark must be able to move DOWN when the
      // server prunes its thread history (C7 clamp).
      return state.seenServerCount === action.count ? state : { ...state, seenServerCount: action.count };
    case "SET_DRAFT":
      return { ...state, draft: action.draft };
    case "PUSH_MESSAGE":
      return { ...state, localMessages: [...state.localMessages, action.message] };
    case "RESTORE":
      return {
        ...state,
        view: action.ui.view ?? state.view,
        accountId: action.ui.accountId ?? state.accountId,
        tab: (action.ui.tab as AccountTab) ?? state.tab,
        panel: action.ui.panel ?? state.panel,
        draft: action.ui.draft ?? state.draft,
        seenServerCount: action.ui.seenServerCount ?? state.seenServerCount,
      };
    default:
      return state;
  }
}

interface AppContextValue {
  data: C360Data;
  worklist: Worklist;
  channel: AgentChannel;
  state: ViewState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Only restore an account view if that account is actually staged (has a bundle
 *  / portfolio row) and the tab is a known one (SPEC §12 A16). Otherwise fall
 *  back to a safe home view rather than an empty workspace. */
function sanitizeRestore(ui: PersistedUi, data: C360Data): Partial<PersistedUi> {
  const knownTabs = new Set(ACCOUNT_TABS.map((t) => t.id));
  const staged = new Set([
    ...Object.keys(data.borrowers ?? {}),
    ...(data.borrower?.snapshot?.accountId ? [data.borrower.snapshot.accountId] : []),
  ]);
  const tab = knownTabs.has(ui.tab as AccountTab) ? ui.tab : "activity";
  const accountOk = !!ui.accountId && staged.has(ui.accountId);
  return {
    view: ui.view === "account" && accountOk ? "account" : "home",
    accountId: accountOk ? ui.accountId : null,
    tab,
    panel: ui.panel === "chat" || ui.panel === "actions" ? ui.panel : "none",
    draft: ui.draft,
    seenServerCount: typeof ui.seenServerCount === "number" ? ui.seenServerCount : 0,
  };
}

/**
 * THE account key for session-local state (A31.3 / A30).
 *
 * The panel that WRITES an entry and the tab that READS it must agree on the
 * key, and they used to resolve it independently: the panel from
 * `state.accountId` alone, the tab from `state.accountId` with a fallback to the
 * bundle. Any path that opens an action without an account selected (a chat
 * chip, a deep link mid-restore) writes under "" and the entry is then
 * invisible in a tab reading the real id. One definition, used by both.
 */
export function accountKey(stateAccountId: string | null | undefined, snapshotAccountId?: string): string {
  return stateAccountId || snapshotAccountId || "";
}

export function AppProvider({ data: injected, children }: { data: C360Data; children: ReactNode }) {
  /* THE BOOK, PLUS WHATEVER THIS SESSION READ LIVE.
     ONE MERGE POINT, HERE, so `resolveBundle`, the worklist, the palette, the
     workspace and both rooms pick a live relationship up without any of them
     learning a second way to find a bundle. `mergeDynamicBook` returns the
     SAME OBJECT when nothing has been read live, so a cockpit standing on the
     baked five is not merely equivalent to the one before this feature: every
     memo below sees the reference it always did. */
  const live = useDynamicBook();
  const data = useMemo(() => mergeDynamicBook(injected, live), [injected, live]);
  const anchor = data.meta.anchorAccountId;
  const worklist = useMemo(() => deriveWorklist(data), [data]);
  const channel = useMemo(() => createChannel(), []);

  // Channel diagnostics: log ONCE on mount so the founder can read the real
  // runtime surface straight out of the Cowork console (2026-07-25 — the live
  // test showed window.sendPrompt is not exposed; this is how we find what is).
  useEffect(() => {
    try {
      const report = probeChannels();
      console.log("[C360-CHANNEL-PROBE]\n" + formatProbe(report));
      console.log("[C360-CHANNEL-PROBE] raw", report);
    } catch {
      /* diagnostics must never break the render */
    }
  }, []);

  const [state, dispatch] = useReducer(reducer, initial, (base) => {
    const restored = loadUi(anchor);
    return restored ? reducer(base, { type: "RESTORE", ui: sanitizeRestore(restored, data) }) : base;
  });

  // A reload re-applies whatever the last sync fetched, at its true age.
  useEffect(() => {
    const overlays = loadOverlays(dataVersionOf(data.meta));
    if (Object.keys(overlays).length) dispatch({ type: "RESTORE_OVERLAY", overlays });
  }, [data.meta]);

  useEffect(() => {
    saveUi(anchor, {
      view: state.view,
      accountId: state.accountId,
      tab: state.tab,
      panel: state.panel,
      draft: state.draft,
      seenServerCount: state.seenServerCount,
    });
  }, [anchor, state.view, state.accountId, state.tab, state.panel, state.draft, state.seenServerCount]);

  const value = useMemo<AppContextValue>(
    () => ({ data, worklist, channel, state, dispatch }),
    [data, worklist, channel, state],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
