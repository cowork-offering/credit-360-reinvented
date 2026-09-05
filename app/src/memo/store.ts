/* =============================================================================
   WHERE A MEMO LIVES BETWEEN SESSIONS.

   THE PORT PLAN'S SHAPE, ON THE COCKPIT'S EXISTING DOOR. `channel/dbDoor.ts` is
   the one store this page reaches for, and everything that file says holds
   here: ABSENCE IS THE COMMON CASE, a page with no `db` grant renders exactly
   as it did before this file existed, and nothing read back is ever an
   instruction. A memo document is written by whoever can open the artifact, so
   what comes back is evidence: it is rendered, never executed, and the room
   re-renders the memo from the DOSSIER rather than trusting stored HTML
   wherever it can.

   THE PATH. The port plan writes it `memos/<packageId>/<memoId>`, which is a
   COLLECTION path under the store's own alternation (odd segments name a
   collection, even name a document), so a `versions` segment sits between the
   two and a memo document is `memos/<packageId>/versions/<memoId>`. The
   hierarchy the plan asked for is unchanged: one package, its memos, newest
   readable without reading any other package's.

   THE HTML IS NEVER STORED (2026-09-06). This file used to attempt the full
   rendered memo first and fall back to a lean document when the store refused
   it. On 2026-09-06 the founder's browser was blocked by claude.ai's web
   application firewall while the cockpit was open, and the one thing this page
   sends to claude.ai that looks like an attack is exactly that write: a JSON
   body carrying a complete HTML document with an inline review-shell script,
   which is what an XSS signature matches. So the draft is always written lean:
   plan, sections, narratives, and `htmlStored: false`. A read re-renders from
   the dossier and the stored narratives, which is what the room does anyway
   (`renderMemo(liveDossier)`), and nothing stored is ever executed. The `html`
   field stays on the type for the in-memory draft the room holds.
   ============================================================================= */

import { db } from "../channel/dbDoor";
import type { MemoNarratives } from "./types";
import type { RenderPlan } from "./renderMemo";

/**
 * Where one section stands. `draft` until a banker has looked at it.
 *
 * `approved` and `edited` are the memo review shell's own two words for a
 * section that has been signed off: reviewed as drafted, or reviewed after
 * the banker rewrote its narrative. Both are carried rather than flattened,
 * because "the AI wrote this and I agreed" and "I wrote this" are not the same
 * sentence in an SR 11-7 record. `flagged` is the room's retired edge control
 * and survives only so a memo stored before 2026-09-04 still reads back.
 */
export type MemoSectionStatus = "draft" | "approved" | "edited" | "flagged";

/** One attestable section of the memo: a manifest module, and its sign-off. */
export interface MemoSectionRecord {
  id: string;
  title: string;
  status: MemoSectionStatus;
  /** The banker's own words on a flag. Never rewritten. */
  note?: string;
  /** Display name of whoever attested. `meta.user`. */
  by?: string;
  /** The cockpit's clock, not a wall clock. */
  at?: string;
}

/** The port plan's `MemoDraft`, as this build writes it. */
export interface MemoDraft {
  memoId: string;
  accountId: string;
  packageId: string;
  /** What opened the room, so a reader knows what the memo was for. */
  trigger: string;
  /** `meta.generatedAt` of the session that drafted it. */
  generatedAt: string;
  /** Who produced the memo. `mcp` is the day the renderer becomes a server. */
  generator: "cockpit" | "mcp";
  renderPlan: RenderPlan;
  sections: MemoSectionRecord[];
  /** The prose the session brain wrote, keyed as the renderer reads it. Kept
   *  SEPARATELY from the HTML because it is what a re-render needs. */
  narratives: MemoNarratives;
  /** The rendered memo, where the store took it. Absent means re-render. */
  html?: string;
  /** Whether the full HTML made it into the store on the write. */
  htmlStored: boolean;
}

const versionsPath = (packageId: string) => `memos/${packageId}/versions`;
const memoPath = (packageId: string, memoId: string) => `${versionsPath(packageId)}/${memoId}`;

/** Reviewed as drafted, or reviewed after an edit. Both are a sign-off. */
const reviewed = (s: MemoSectionRecord): boolean => s.status === "approved" || s.status === "edited";

/** How many sections are attested, and out of how many. The progress line. */
export function attestedCount(sections: readonly MemoSectionRecord[]): { done: number; total: number } {
  return { done: sections.filter(reviewed).length, total: sections.length };
}

/** Every section reviewed, and there is at least one. The publish gate. */
export const fullyAttested = (sections: readonly MemoSectionRecord[]): boolean =>
  sections.length > 0 && sections.every(reviewed);

/**
 * WRITE THE DRAFT, LEAN. Never the HTML (see the header).
 *
 * Returns the draft as it was actually stored, so the caller's own copy carries
 * the same `htmlStored` the document does. A page with no store resolves the
 * draft unchanged and writes nothing, which is the absence contract: the room
 * works, the memo simply does not outlive the view. A store that refuses even
 * the lean document is silent: a memo that could not be persisted is still a
 * memo on the glass, and the room never shows a banker a store error.
 */
export async function saveMemoDraft(draft: MemoDraft): Promise<MemoDraft> {
  const store = db();
  if (!store) return draft;
  const lean: MemoDraft = { ...draft, html: undefined, htmlStored: false };
  try {
    await store.doc(memoPath(draft.packageId, draft.memoId)).set({ ...lean } as unknown as Record<string, unknown>);
  } catch {
    return { ...draft, htmlStored: false };
  }
  return lean;
}

/** Land one section's attestation. Last writer wins, exactly as the intent
 *  store's writes do: there is one banker in one room per memo. */
export async function saveAttestations(draft: MemoDraft): Promise<void> {
  const store = db();
  if (!store) return;
  try {
    await store.doc(memoPath(draft.packageId, draft.memoId)).update({ sections: draft.sections });
  } catch {
    // Bookkeeping, never a gate. The glass already shows the attestation.
  }
}

/** Everything a stored document has to carry before the room will read it. */
function readDraft(id: string, raw: Record<string, unknown> | undefined): MemoDraft | null {
  if (!raw) return null;
  const packageId = typeof raw.packageId === "string" ? raw.packageId : null;
  const sections = Array.isArray(raw.sections) ? (raw.sections as MemoSectionRecord[]) : null;
  if (!packageId || !sections) return null;
  return {
    memoId: typeof raw.memoId === "string" ? raw.memoId : id,
    accountId: typeof raw.accountId === "string" ? raw.accountId : "",
    packageId,
    trigger: typeof raw.trigger === "string" ? raw.trigger : "adhoc",
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
    generator: raw.generator === "mcp" ? "mcp" : "cockpit",
    renderPlan: (raw.renderPlan as RenderPlan) ?? { modules: [], suppressed: [] },
    sections,
    narratives: (raw.narratives as MemoNarratives) ?? {},
    html: typeof raw.html === "string" ? raw.html : undefined,
    htmlStored: raw.htmlStored === true,
  };
}

/**
 * THE LATEST MEMO ON THIS PACKAGE, or null.
 *
 * Newest first by the cockpit's own stamp. Null covers every kind of absence:
 * no store, no memo, a document the reader could not make sense of. The room
 * offers its "Open latest memo" chip on a non-null answer and on nothing else,
 * so a chip is never offered for a memo that is not there.
 */
export async function latestMemo(packageId: string): Promise<MemoDraft | null> {
  const store = db();
  if (!store) return null;
  try {
    const snap = await store.collection(versionsPath(packageId)).orderBy("generatedAt", "desc").limit(1).get();
    const doc = snap.docs[0];
    return doc?.exists ? readDraft(doc.id, doc.data()) : null;
  } catch {
    return null;
  }
}
