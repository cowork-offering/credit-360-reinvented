import { db, MAX_STRING_BYTES } from "../channel/dbDoor";

/* =============================================================================
   THE FEEDBACK REPORT — one bug, into the shared store bucket.

   The Feedback control opens a small form: pick what went wrong, add a note, and
   the current conversation rides along so a bug can be reproduced. Submit writes
   ONE document to the `bugs` collection in the artifact's shared store — the same
   guarded door the cockpit already uses for its book cache and cockpit state, so
   every viewer's reports land in one bucket a session can read back with
   `read_db` and triage (status: open -> fixed -> closed).

   TWO THINGS THE STORE'S DOOR ENFORCES, and this file respects up front rather
   than tripping the silent refusal (see channel/dbDoor.ts): no single string may
   exceed 32 KB, and nothing may carry a markup-shaped token a web-application
   firewall reads as an attack. A pasted transcript is the one field big or
   markup-ish enough to hit either, so it is byte-clipped and neutralised here.

   NO STORE, NO LOSS. On a share link or an older runtime `db()` is undefined;
   the report is copied to the clipboard instead, so the banker can paste it. The
   form never claims a write that did not happen.
   ============================================================================= */

export const BUG_CATEGORIES = [
  "Inaccurate information",
  "Loop / stuck",
  "Repeating itself",
  "Wrong action taken",
  "Missing data",
  "UI / visual",
  "Too slow",
  "Crash / error",
  "Other",
] as const;
export type BugCategory = (typeof BUG_CATEGORIES)[number];

export interface BugDraft {
  categories: string[];
  comment: string;
  /** The conversation, already rendered to markdown by the caller. */
  transcript: string;
  /** Where the report was raised, e.g. "Modification — Hartwell Precision". */
  surface: string;
  accountName?: string | null;
  /** The book's own as-of stamp, for reproduction. */
  bookAsOf?: string | null;
}

export type SubmitOutcome = "stored" | "copied" | "empty" | "failed";

/** Break the exact tokens the store's firewall screen rejects, without dropping
 *  information: a zero-width space inside the token is invisible in a paste but
 *  no longer matches `/<script/i`, `javascript:` and the inline-handler forms. */
export function sanitizeForStore(s: string): string {
  return s
    .replace(/</g, "<​")
    .replace(/javascript:/gi, "javascript​:")
    .replace(/on(error|load)(\s*)=/gi, "on$1​$2=");
}

const enc = () => (typeof TextEncoder === "undefined" ? null : new TextEncoder());

/** Byte-safe clip well under the 32 KB field cap, with a little headroom for the
 *  zero-width spaces the sanitiser adds. */
export function clipBytes(s: string, maxBytes = 28 * 1024): string {
  const e = enc();
  if (!e || e.encode(s).length <= maxBytes) return s;
  let lo = 0;
  let hi = s.length;
  const budget = maxBytes - 24;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (e.encode(s.slice(0, mid)).length <= budget) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}\n…(truncated)`;
}

/** The stored shape. Everything is a plain string or string[]: nothing here is
 *  ever executed, and it is read back as evidence for triage. */
export interface BugRecord {
  categories: string[];
  comment: string;
  transcript: string;
  surface: string;
  accountName: string | null;
  bookAsOf: string | null;
  userAgent: string;
  createdAt: string;
  status: "open";
}

export function buildRecord(draft: BugDraft): BugRecord {
  // Sanitise first (it adds zero-width bytes), THEN clip, so the final field is
  // guaranteed under the store's 32 KB cap however many tokens it broke.
  const one = (s: string, maxBytes: number) => clipBytes(sanitizeForStore(s), maxBytes);
  return {
    categories: draft.categories.slice(0, BUG_CATEGORIES.length),
    comment: one(draft.comment.trim(), 8 * 1024),
    transcript: one(draft.transcript, 28 * 1024),
    surface: one(draft.surface, 512).slice(0, 300),
    accountName: draft.accountName ? one(draft.accountName, 512).slice(0, 200) : null,
    bookAsOf: draft.bookAsOf ?? null,
    userAgent: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 320),
    createdAt: new Date().toISOString(),
    status: "open",
  };
}

/** A human-readable rendering, for the clipboard fallback. */
export function recordToMarkdown(r: BugRecord): string {
  return [
    `# Cockpit feedback`,
    `**Surface:** ${r.surface}`,
    r.accountName ? `**Account:** ${r.accountName}` : "",
    `**Issues:** ${r.categories.length ? r.categories.join(", ") : "(none picked)"}`,
    `**When:** ${r.createdAt}`,
    r.bookAsOf ? `**Book as-of:** ${r.bookAsOf}` : "",
    ``,
    r.comment ? `## Note\n${r.comment}\n` : "",
    `## Transcript`,
    r.transcript || "_(no exchange yet)_",
    ``,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Write the report to the shared store, or copy it if there is no store. Empty
 * (no category and no note) is a no-op the form guards against too.
 */
export async function submitBug(
  draft: BugDraft,
  copyFallback: (text: string) => Promise<boolean>,
): Promise<SubmitOutcome> {
  const hasContent = draft.categories.length > 0 || draft.comment.trim().length > 0;
  if (!hasContent) return "empty";

  const record = buildRecord(draft);
  const store = db();
  if (store) {
    try {
      const id = `bug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await store.collection("bugs").doc(id).set(record as unknown as Record<string, unknown>);
      return "stored";
    } catch {
      // Fall through to the clipboard so the report is not lost.
    }
  }
  const ok = await copyFallback(recordToMarkdown(record));
  return ok ? "copied" : "failed";
}

/** Byte length helper, exported for the field-cap guarantee test. */
export function byteLen(s: string): number {
  const e = enc();
  return e ? e.encode(s).length : s.length;
}

export { MAX_STRING_BYTES };
