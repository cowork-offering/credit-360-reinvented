/* Ephemeral UI state survival across full-artifact replaces (SPEC §7, §12 A16).
   Versioned blob, 24h expiry, keyed by meta.anchorAccountId. Every op is wrapped
   in try/catch and degrades silently when sessionStorage is unavailable. The
   caller (appState) additionally validates the restored account/tab is still
   valid for the freshly injected data before applying it. */

/** Bumped to 5 when the KYC & Onboarding zone was removed: a v4 blob carries a
 *  `zone` that no longer exists, so it is dropped rather than half-read. */
const SCHEMA_VERSION = 5;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PersistedUi {
  view: "home" | "account";
  accountId: string | null;
  tab: string;
  /** Which floating panel is open (A27.1). Replaces the old `chatOpen` flag;
   *  SCHEMA_VERSION bumped to 2 so v1 blobs are dropped, not misread. */
  panel: "none" | "chat" | "actions";
  draft: string;
  /** High-water mark over SERVER (agent-authored) messages only (C7).
   *  Locally echoed messages are never counted: they do not survive a full
   *  artifact replace, so counting them would push the watermark above the
   *  server total and silently swallow the next real reply. Schema bumped to 3
   *  because the field's meaning changed, not just its name. */
  seenServerCount: number;
}

interface Envelope {
  v: number;
  savedAt: number;
  ui: PersistedUi;
}

const key = (anchor: string) => `c360:ui:${anchor}`;

export function loadUi(anchor: string): PersistedUi | null {
  try {
    const raw = sessionStorage.getItem(key(anchor));
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (!env || env.v !== SCHEMA_VERSION) return null;
    if (typeof env.savedAt !== "number" || Date.now() - env.savedAt > MAX_AGE_MS) return null;
    return env.ui ?? null;
  } catch {
    return null;
  }
}

/**
 * The relationship this browser was standing on when the page was replaced.
 *
 * READ WITHOUT THE BOOK, and that is the whole reason it exists. `loadUi` needs
 * the anchor id, which lives in the injected payload, and parsing that payload
 * is the very cost the pre-mount head start is trying to overlap. So this
 * SCANS for the one key this cockpit writes instead, through exactly the same
 * envelope checks: a v-mismatched or expired blob is no more usable here than
 * it is there.
 *
 * Null unless the blob says the banker was on a client view with an account.
 * A worklist is not an account, and guessing one would send six reads for a
 * relationship nobody asked for.
 */
export function persistedOpenAccount(): string | null {
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (!k || !k.startsWith("c360:ui:")) continue;
      const raw = sessionStorage.getItem(k);
      if (!raw) continue;
      const env = JSON.parse(raw) as Envelope;
      if (!env || env.v !== SCHEMA_VERSION) continue;
      if (typeof env.savedAt !== "number" || Date.now() - env.savedAt > MAX_AGE_MS) continue;
      const ui = env.ui;
      if (ui?.view === "account" && typeof ui.accountId === "string" && ui.accountId) return ui.accountId;
    }
  } catch {
    /* storage unavailable, or a blob somebody else wrote, no head start */
  }
  return null;
}

export function saveUi(anchor: string, ui: PersistedUi): void {
  try {
    const env: Envelope = { v: SCHEMA_VERSION, savedAt: Date.now(), ui };
    sessionStorage.setItem(key(anchor), JSON.stringify(env));
  } catch {
    /* storage unavailable — degrade silently */
  }
}
