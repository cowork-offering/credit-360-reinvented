/* =============================================================================
   THE PLAN SURVIVES.

   FOUNDER, 2026-09-05: the rooms must not get stuck, and the syncs must work.
   A room that loses a half-built plan to a reload is a quieter version of the
   same failure: the banker did the work, the glass forgot it, and the only way
   back is to say all of it again.

   THE ENGINE ALREADY REMEMBERS A CLOSE. `engine.resume()` hands back the
   manifest the package was left composing, which is why closing a room and
   opening it again picks up where it left off. What it does not survive is a
   RELOAD: that memory is a module in this page, and a new page is a new module.
   This file is the half that outlives the page.

   WHAT IS STORED IS WHAT THE BANKER SAID, AND NOTHING ELSE.

   Not the decision token: it is single-use, it expires, and a token in a
   document anyone with write_db can read is a token that should never have
   been written down. Not the staging id or the plan hash: they name a staging
   row that a resumed plan must not reuse. Not the execute payload: nothing in
   this store may ever be close enough to a write to be mistaken for one.

   So the document holds the banker's own instructions and a readable summary
   of the cards they produced. RESUMING RE-SAYS THE LINES through the room's
   own dispatch, which re-derives the cards, re-runs every gate and stages
   again against the org. That is slower than restoring a plan and it is the
   only honest way to do it: the org, not this page, decides what a plan is.

   WHAT IS READ BACK IS UNTRUSTED, on the same rule as `intent/contract.ts`.
   Any Claude session with the Artifact tool's write_db can put a document in
   this collection. Everything here is clipped, type-checked and dropped on
   doubt, and the lines travel the same dispatch a banker's typing does, one at
   a time, with every refusal and question still in force.
   ============================================================================= */

import { db } from "../../channel/dbDoor";
import { DEADLINES, withDeadline } from "./deadline";

export const PLAN_COLLECTION = "stagedPlans";

/** The three engines a facility plan can be composed on. */
export type PlanRoute = "modify" | "renew" | "create";

const ROUTES: PlanRoute[] = ["modify", "renew", "create"];

/** One card, as the banker read it on the rail. Labels, never wire fields. */
export interface PlanCardSummary {
  title: string;
  target: string;
  after: string;
}

export interface StagedPlanDoc {
  id: string;
  accountId: string;
  accountName: string;
  packageId: string;
  packageName: string;
  route: PlanRoute;
  /** The banker's own instructions, in the order they were said. */
  said: string[];
  /** What those instructions put on the manifest, for the offer's sentence. */
  cards: PlanCardSummary[];
  /** When the manifest last changed. ISO, this page's own clock. */
  stagedAt: string;
}

/* -------------------------------------------------------------------- caps

   A plan a banker built by hand is a handful of lines. These are the ceiling
   on what a document may cost to read, not a limit anyone should reach.     */

export const MAX_SAID = 24;
export const MAX_SAID_CHARS = 400;
export const MAX_CARDS = 40;
export const MAX_LABEL_CHARS = 120;

/** How long a stored plan is worth offering. Past a week the package has moved
 *  and re-saying week-old lines is not a favour. */
export const PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const clip = (v: unknown, cap: number): string | null => {
  if (typeof v !== "string") return null;
  const line = v.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, cap) : null;
};

/** One live plan per package per engine. Deterministic, so a second session on
 *  the same package overwrites rather than accumulating. */
export const planDocId = (accountId: string, packageId: string, route: PlanRoute): string =>
  `${accountId}.${packageId}.${route}`;

/* ------------------------------------------------------------- the reading */

/** Read one document into the shape the room may use, or null. Never throws:
 *  a document that is wrong in any way is a document there is no offer for. */
export function readPlanDoc(id: string, raw: unknown): StagedPlanDoc | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;

  const accountId = clip(d.accountId, MAX_LABEL_CHARS);
  const packageId = clip(d.packageId, MAX_LABEL_CHARS);
  const stagedAt = clip(d.stagedAt, 40);
  const route = typeof d.route === "string" && ROUTES.includes(d.route as PlanRoute) ? (d.route as PlanRoute) : null;
  if (!accountId || !packageId || !route || !stagedAt) return null;
  if (Number.isNaN(Date.parse(stagedAt))) return null;

  const said = Array.isArray(d.said)
    ? d.said.map((l) => clip(l, MAX_SAID_CHARS)).filter((l): l is string => Boolean(l)).slice(0, MAX_SAID)
    : [];
  if (!said.length) return null;

  const cards = Array.isArray(d.cards)
    ? d.cards
        .map((c): PlanCardSummary | null => {
          if (typeof c !== "object" || c === null) return null;
          const row = c as Record<string, unknown>;
          const title = clip(row.title, MAX_LABEL_CHARS);
          const target = clip(row.target, MAX_LABEL_CHARS);
          if (!title || !target) return null;
          return { title, target, after: clip(row.after, MAX_LABEL_CHARS) ?? "" };
        })
        .filter((c): c is PlanCardSummary => c !== null)
        .slice(0, MAX_CARDS)
    : [];

  return {
    id,
    accountId,
    accountName: clip(d.accountName, MAX_LABEL_CHARS) ?? "this relationship",
    packageId,
    packageName: clip(d.packageName, MAX_LABEL_CHARS) ?? "the package you had open",
    route,
    said,
    cards,
    stagedAt,
  };
}

/** True where a stored plan is still worth offering. */
export const planIsFresh = (doc: StagedPlanDoc, now: number = Date.now()): boolean =>
  now - Date.parse(doc.stagedAt) < PLAN_TTL_MS;

/**
 * The plan this package was left holding, or null.
 *
 * DEADLINED LIKE EVERY OTHER READ. A store that accepts the get and never
 * answers would otherwise hold the room's opening beat open, which is the
 * exact failure this wave exists to remove. Null covers every kind of absence:
 * no store, no document, a document that did not survive the reader, a read
 * that ran out of clock.
 */
export async function readStoredPlan(accountId: string, packageId: string, route: PlanRoute): Promise<StagedPlanDoc | null> {
  const store = db();
  if (!store) return null;
  const id = planDocId(accountId, packageId, route);
  try {
    const snap = await withDeadline(
      () => store.collection(PLAN_COLLECTION).doc(id).get(),
      "read",
      "the plan you left here",
      DEADLINES.read,
    );
    if (!snap?.exists) return null;
    const doc = readPlanDoc(id, snap.data());
    return doc && planIsFresh(doc) ? doc : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the writing */

export interface PlanSnapshot {
  accountId: string;
  accountName: string;
  packageId: string;
  packageName: string;
  route: PlanRoute;
  said: string[];
  cards: PlanCardSummary[];
  /** Injected in the suite; the page's own clock everywhere else. */
  now?: () => number;
}

/**
 * Remember what this package is holding. FIRE AND FORGET, ALWAYS.
 *
 * The manifest is already on the glass. A store that refused the write leaves
 * the room exactly as it is, and a room that awaited its own bookkeeping would
 * be the stuck room this wave is about. Never rejects.
 */
export async function savePlan(snapshot: PlanSnapshot): Promise<void> {
  const store = db();
  if (!store) return;
  if (!snapshot.said.length) return;
  const id = planDocId(snapshot.accountId, snapshot.packageId, snapshot.route);
  const doc = {
    accountId: snapshot.accountId,
    accountName: snapshot.accountName.slice(0, MAX_LABEL_CHARS),
    packageId: snapshot.packageId,
    packageName: snapshot.packageName.slice(0, MAX_LABEL_CHARS),
    route: snapshot.route,
    said: snapshot.said.map((l) => l.slice(0, MAX_SAID_CHARS)).slice(-MAX_SAID),
    cards: snapshot.cards.slice(0, MAX_CARDS).map((c) => ({
      title: c.title.slice(0, MAX_LABEL_CHARS),
      target: c.target.slice(0, MAX_LABEL_CHARS),
      after: c.after.slice(0, MAX_LABEL_CHARS),
    })),
    stagedAt: new Date(snapshot.now?.() ?? Date.now()).toISOString(),
  };
  try {
    await withDeadline(() => store.collection(PLAN_COLLECTION).doc(id).set(doc), "read", "the plan store", DEADLINES.read);
  } catch {
    // Bookkeeping, not the banker's business.
  }
}

/** The plan is filed, or the banker started over. Either way it is spent. */
export async function clearPlan(accountId: string, packageId: string, route: PlanRoute): Promise<void> {
  const store = db();
  if (!store) return;
  try {
    await withDeadline(
      () => store.collection(PLAN_COLLECTION).doc(planDocId(accountId, packageId, route)).delete(),
      "read",
      "the plan store",
      DEADLINES.read,
    );
  } catch {
    /* a plan that outlives its filing is offered once and re-said harmlessly */
  }
}

/* ---------------------------------------------------------------- the offer

   THE ROOM ASKS, IT DOES NOT ACT. Re-saying a banker's lines runs the room's
   whole grammar again, and doing that unasked to somebody who came back to
   start over is the room deciding what the session is about.                */

/** "20:14" in the viewer's own clock. Never a date: a plan older than a week
 *  is not offered at all, and a time is what a banker recognises. */
export function plannedAt(doc: StagedPlanDoc): string {
  const d = new Date(doc.stagedAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** The sentence the room opens the offer with. */
export function resumeOffer(doc: StagedPlanDoc): string {
  const n = doc.cards.length || doc.said.length;
  const word = n === 1 ? "change" : "changes";
  return (
    /* NO ARTICLE IN FRONT OF THE NAME. The package's own name is whatever the
       org calls it and some of them start with "the"; a sentence that supplies
       one as well says "the the" in front of a client. */
    `You left a plan on ${doc.packageName} at ${plannedAt(doc)}, ${n} ${word} on the manifest. ` +
    "I can say those lines again and put the manifest back, or you can start over on an empty rail."
  );
}

/** What the room says the moment a resumed plan is back on the rail. The
 *  re-stage is not a footnote: the token from before is spent, and a banker
 *  who thinks they are looking at a staged plan is a banker one click from
 *  finding out otherwise. */
export const RESUMED_NOTE =
  "These are your lines, put up again. Nothing is staged yet: the decision token from before is spent, " +
  "and the org stages this afresh when you put it up.";

/** The chips the offer carries. */
export const RESUME_CHIP = { label: "Resume the plan", say: "resume the plan I left" } as const;
export const START_OVER_CHIP = { label: "Start over", say: "start over on an empty rail" } as const;

/** True where a line is the banker taking the resume offer. */
export const isResumeSay = (text: string): boolean => /^\s*resume the plan i left\s*$/i.test(text);
/** True where a line is the banker declining it. */
export const isStartOverSay = (text: string): boolean => /^\s*start over on an empty rail\s*$/i.test(text);
