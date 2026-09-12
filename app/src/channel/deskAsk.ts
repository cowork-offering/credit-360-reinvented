/* =============================================================================
   THE CLIENT PAGE'S DESK, ON THE SESSION BRAIN.

   The client chat used to travel a 600-character gateway prompt with the
   current tab injected, and a "rundown" came back as tab talk and generic
   credit padding (founder, 2026-09-03: "the normal chat is awful; it should be
   page agnostic"). The rooms feel like a session because the model answers
   with the whole book in view; the desk now gets the same footing.

   PAGE-AGNOSTIC BY CONSTRUCTION: the context is the relationship, never the
   tab. Figures come from the bundle the cockpit already read from the bank's
   systems; nothing here calls a tool, so nothing here can invent a read.
   ============================================================================= */

import { MODIFICATION_IN_PROGRESS, packageRoster } from "../book/packages";
import type { BorrowerBundle, C360Data } from "../data/contract";
import { fmtCovThreshold, fmtCovVal } from "../data/finance";
import { fmtDate, fmtMoney } from "../data/format";
import { isActiveFacility } from "../data/worklist";
import { threadDigest } from "../components/workroom/readBlocks";
import type { BrainTurn } from "./brainLane";
import { clipBudget, narrationText, parseNarration } from "./narrate";
import { askSession, sampleAvailable } from "./sampleDoor";

const CONTEXT_CAP = 7000;

/** Room reserved for the cut notice, so the one line that says the context was
 *  trimmed can never itself be the thing that does not fit. */
const NOTICE_RESERVE = 260;

/** The model's standing instruction on this surface. Exported so the suite can
 *  hold it to the scope rule rather than trusting the prose. */
export const DESK_RULES =
  "You are the credit desk for this relationship. Answer in plain prose, no headings, no markdown, no bullet characters. " +
  "Use only the figures in the context; when something is not there, say this view does not carry it, in one clause, and move on. " +
  "Never mention tabs, views or where the reader is standing. A rundown is a lead sentence, then the facts that matter, at most six sentences. " +
  "Every total in this context is the WHOLE RELATIONSHIP, every package included. Say that scope in the same breath whenever you quote one, because a workroom quotes the anchored package and the two figures differ.";

function facilityLine(f: {
  productType?: string | null;
  committed?: number | null;
  outstanding?: number | null;
  maturityDate?: string | null;
  interestRate?: number | null;
  stage?: string | null;
}): string {
  return [
    f.productType ?? "facility",
    f.committed != null ? `${fmtMoney(f.committed)} committed` : null,
    f.outstanding != null ? `${fmtMoney(f.outstanding)} drawn` : null,
    f.interestRate != null ? `${f.interestRate}%` : null,
    f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : null,
    f.stage && f.stage !== "Booked" ? `(${f.stage})` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/* ---------------------------------------------------------- the version chain

   THE DESK WAS BLIND TO THE ONE FACT THAT LOCKS A ROOM. `book/packages.ts`
   already computes the fork for the pickers, the workroom envelope now carries
   it (`reads.inFlight`), and the chat carried nothing: "why can't I modify this"
   was answerable in a workroom and unanswerable on the surface a founder opens
   on. Same facts, same words, relationship-wide rather than package-anchored.  */

function inFlightLines(bundle: BorrowerBundle): string[] {
  const out: string[] = [];
  for (const entry of packageRoster(bundle)) {
    if (entry.inFlightVersion) {
      out.push(
        `${entry.name} IS the unbooked modification version of another package, ${
          entry.inFlightEditable
            ? "still editable until it reaches approval"
            : "at Approval / Loan Committee and no longer editable"
        }. It carries no booked facility, so a modification or a renewal has nothing here to act against.`,
      );
      continue;
    }
    if (entry.hasInFlightModification) {
      out.push(
        `${MODIFICATION_IN_PROGRESS} on ${entry.name}: a version of it is unbooked with the org${
          entry.inFlightVersionId ? ` (${entry.inFlightVersionId})` : ""
        }, so a second modification or renewal on that package is refused until the version is booked or discarded. That is WHY the room is locked; say it rather than refusing blind.`,
      );
    }
  }
  return out;
}

/** One line of the context, and which part of the book it came from, so a cut
 *  can name what it dropped instead of stopping mid-sentence. */
interface ContextPart {
  text: string;
  what: string;
}

/** The whole relationship as prose, uncapped by the gateway's tiny budget. */
export function deskContext(bundle: BorrowerBundle, accountName: string): string {
  const parts: ContextPart[] = [];
  const push = (text: string, what: string) => parts.push({ text, what });
  const sn = (bundle.snapshot ?? {}) as unknown as Record<string, unknown>;

  push(
    [
      `${accountName}`,
      sn.industry ? `${sn.industry}` : null,
      sn.primaryRiskRating != null ? `risk grade ${sn.primaryRiskRating}` : null,
      sn.annualRevenue != null ? `annual revenue ${fmtMoney(Number(sn.annualRevenue))}` : null,
    ]
      .filter(Boolean)
      .join(", ") + ".",
    "the relationship's own identity",
  );

  const facs = (bundle.exposure?.facilities ?? []).filter(isActiveFacility);
  if (facs.length) {
    const committed = facs.reduce((a, f) => a + (f.committed ?? 0), 0);
    const drawn = facs.reduce((a, f) => a + (f.outstanding ?? 0), 0);
    /* THE SCOPE IS SAID IN THE SAME BREATH AS THE FIGURE. This total is every
       active facility on the RELATIONSHIP, across every package; the workroom's
       own total is the anchored PACKAGE, and on Hartwell the two are $57M and
       $49M. Both are honest and neither used to say which, so a banker who
       asked here and then opened the room read two numbers for one deal. */
    push(
      `Facilities across the relationship, every package included: ${fmtMoney(committed)} committed, ${fmtMoney(drawn)} drawn across ${facs.length}.`,
      "the facility list and its totals",
    );
    for (const f of facs) push(facilityLine(f) + ".", "the facility list and its totals");
  }

  for (const line of inFlightLines(bundle)) push(line, "the package versions in flight");

  /* THE TEST AND WHAT IT IS MEASURED AGAINST. A current value with no threshold
     beside it is a figure with nothing to read it against, and "what is this
     covenant doing" was unanswerable on this surface because of it. The
     threshold is printed through the same helper the workroom envelope and the
     covenant card use (`fmtCovThreshold`), so the operator and the unit are the
     org's own and the three surfaces cannot write one test three ways. */
  const covs = bundle.covenants?.covenants ?? [];
  for (const c of covs) {
    const threshold = typeof c.thresholdValue === "number" ? fmtCovThreshold(c.covenantType, c.actualValue, c.thresholdValue) : null;
    push(
      [
        c.covenantType ?? "Covenant",
        c.latestComplianceStatus ? `${c.latestComplianceStatus}` : null,
        threshold ? `tests ${threshold}` : "no threshold carried on this read",
        c.actualValue != null ? `last ${fmtCovVal(c.actualValue, c.covenantType)}` : null,
        c.frequency ? `${c.frequency}` : null,
        c.nextEvaluationDate ? `next test ${fmtDate(c.nextEvaluationDate)}` : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
      "the covenants and their thresholds",
    );
  }

  if (sn.nextReviewDate) push(`Next annual review ${fmtDate(String(sn.nextReviewDate))}.`, "the review clock");

  const acts = bundle.activity ?? [];
  for (const a of acts.slice(0, 6)) {
    const t = (a as { title?: string; ts?: string }).title;
    const ts = (a as { ts?: string }).ts;
    if (t) push(`Recent: ${t}${ts ? ` (${fmtDate(ts.slice(0, 10))})` : ""}.`, "the recent activity");
  }

  const opps = (bundle.opportunities as { opportunities?: Array<{ name?: string; amount?: number; stage?: string }> } | undefined)
    ?.opportunities;
  for (const o of (opps ?? []).slice(0, 4)) {
    if (o?.name)
      push(
        `Open opportunity: ${o.name}${o.amount != null ? `, ${fmtMoney(o.amount)}` : ""}${o.stage ? `, ${o.stage}` : ""}.`,
        "the open pipeline",
      );
  }

  return assemble(parts);
}

/**
 * THE CONTEXT, CUT AT A WHOLE LINE AND HONEST ABOUT IT.
 *
 * It used to be `out.slice(0, CONTEXT_CAP)`: a book cut mid-sentence, with
 * nothing to tell the model it had been cut, so a truncated relationship and a
 * relationship with nothing in it read exactly the same. The cut is now at a
 * whole line, everything from the cut on is named by the part of the book it
 * came from, and the notice travels with the context. An absent block is never
 * an empty fact; that contract is the envelope's and it is now the desk's.
 */
function assemble(parts: ContextPart[]): string {
  const budget = CONTEXT_CAP - NOTICE_RESERVE;
  const kept: string[] = [];
  const lost: string[] = [];
  let size = 0;
  let cutting = false;
  for (const part of parts) {
    if (!cutting && size + part.text.length + 1 <= budget) {
      kept.push(part.text);
      size += part.text.length + 1;
      continue;
    }
    cutting = true;
    if (!lost.includes(part.what)) lost.push(part.what);
  }
  if (!lost.length) return kept.join(" ");
  return `${kept.join(" ")} This context was cut to fit, so it does not carry ${lost.join(", ")}. Say that it is not in front of you rather than reading what is here as the whole book.`;
}

/* ----------------------------------------------------------- the conversation

   THE DESK WAS STATELESS (golden rule 5, finding I8). It took one question and
   no thread, so every follow-up was answered as if it were the first: "and the
   other one?" reached the model with nothing to attach "the other one" to. The
   rooms have carried a thread since the envelope shipped; this is the same
   digest, through the same function, so the two surfaces clip a conversation
   the same way rather than each inventing a rule.                            */

/** How many exchanges travel. The room's own number: as far back as a banker's
 *  "it" and "that one" ever reach. */
export const DESK_THREAD_TURNS = 6;

/** The whole thread block's budget. The context is the answer's grounding and
 *  the thread is only what makes it a conversation, so the thread is what gives
 *  way, oldest first. */
export const DESK_THREAD_CAP = 1_800;

/** The conversation so far, oldest first, or nothing where none has happened. */
export function deskThread(turns: readonly BrainTurn[] | undefined): string {
  const digest = threadDigest([...(turns ?? [])], DESK_THREAD_TURNS) ?? [];
  const lines = digest.map((t) => `${t.who === "banker" ? "Banker" : "You"}: ${t.text}`);
  while (lines.length > 1 && lines.join("\n").length > DESK_THREAD_CAP) lines.shift();
  if (!lines.length) return "";
  return `\n\nThe conversation so far, oldest first. This is ONE conversation: read it, never re-ask what has been answered, and never answer the same input twice.\n${lines.join("\n")}`;
}

/* ------------------------------------------------------------- the one bubble

   THE ROOMS' OWN GUARD, ON THE DESK'S ANSWER. `ChatPanel` rendered the model's
   text raw, so a markdown heading, a bullet run and a fenced block all reached
   the glass as punctuation, and nothing held the answer to a length. These are
   the same two functions the rooms run every remark through
   (`channel/narrate.ts`), at the desk's own act budget: a rundown is a lead
   sentence and the facts that matter, which is what DESK_RULES already asks
   for and nothing enforced.                                                  */

/** DESK_RULES' own ceiling, enforced rather than requested. */
export const DESK_ANSWER_SENTENCES = 6;
/** The words those six sentences may spend. Wider than a room's remark, which
 *  sits under a card that already carries the figures. */
export const DESK_ANSWER_WORDS = 140;

/** The model's text, as one bubble: markdown stripped, held to its budget. An
 *  answer the guard empties falls back to the raw text rather than to silence. */
export function deskAnswer(raw: string): string {
  const guarded = narrationText(clipBudget(parseNarration(raw ?? "", DESK_ANSWER_SENTENCES), DESK_ANSWER_WORDS));
  return guarded.trim() || (raw ?? "").trim();
}

/** Whether the desk can take this ask on the session brain. */
export const deskAvailable = (): boolean => sampleAvailable();

/** Ask the desk. Throws the sample door's own failure shapes; the caller keeps
 *  its gateway fallback. */
export async function askDesk(args: {
  data: C360Data;
  bundle: BorrowerBundle;
  accountName: string;
  question: string;
  /** The conversation so far, oldest first, WITHOUT this question. */
  thread?: readonly BrainTurn[];
  signal?: AbortSignal;
  onText?: (update: { text: string }) => void;
}): Promise<string> {
  const prompt = `${DESK_RULES}\n\nContext:\n${deskContext(args.bundle, args.accountName)}${deskThread(args.thread)}\n\nQuestion: ${args.question}`;
  const text = await askSession(prompt, { tier: "default", kind: "reply", signal: args.signal, onText: args.onText });
  return deskAnswer(text);
}
