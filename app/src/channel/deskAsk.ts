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

import { MODIFICATION_IN_PROGRESS } from "../book/packages";
import type { ActionHistoryRow, BorrowerBundle } from "../data/contract";
import { fmtDate, fmtMoney } from "../data/format";
import { threadDigest } from "../components/workroom/readBlocks";
import { RECOMMEND_ONLY_WHEN_GROUNDED, VOICE } from "./doctrine";
import type { BrainReadBlocks, BrainTurn } from "./brainLane";
import { clipBudget, narrationText, parseNarration } from "./narrate";
import {
  buildRelationshipFacts,
  CONTEXT_DROP_ORDER,
  inFlightRoster,
  notCarriedSentence,
} from "./relationshipContext";
import { askSession, sampleAvailable } from "./sampleDoor";

const CONTEXT_CAP = 7000;

/** Room reserved for the cut notice, so the one line that says the context was
 *  trimmed can never itself be the thing that does not fit. */
const NOTICE_RESERVE = 260;

/** The model's standing instruction on this surface. Exported so the suite can
 *  hold it to the scope rule rather than trusting the prose. */
export const DESK_RULES =
  "You are the credit desk for this relationship. Answer in plain prose, no headings, no markdown, no bullet characters. " +
  /* RULE 4, ON A REFUSAL. "Move on" was the whole instruction, so a question the
     read does not carry ended the conversation. The move that WOULD get the
     figure is the one thing the banker can act on. */
  "Use only the figures in the context; when something is not there, say this view does not carry it, in one clause, and name the one move that would get it. " +
  "Never mention tabs, views or where the reader is standing. A rundown is a lead sentence, then the facts that matter, at most six sentences. " +
  "Every total in this context is the WHOLE RELATIONSHIP, every package included. Say that scope in the same breath whenever you quote one, because a workroom quotes the anchored package and the two figures differ. " +
  /* THE GOLDEN RULE, ON THE SURFACE A DEMO OPENS ON (founder 2026-09-12, the
     fallback audit). The two rooms travel with the sliced pack; this one
     travelled with four sentences about scope and prose, so rules 2, 4 and 7
     bound the rooms and bound nothing here. The two constants are the pack's
     own, imported rather than paraphrased: one rule, two surfaces. */
  "Lead with the current figure on file. Where the banker is deciding a value, state it first, then the real options. " +
  RECOMMEND_ONLY_WHEN_GROUNDED +
  " " +
  "Close on the next step, in one clause: the question that follows, or the room that files it. Never leave the banker with nothing to do. " +
  VOICE;

/* ------------------------------------------------------------ one book, two voices

   THE DESK USED TO READ THE BUNDLE ITSELF (backlog item 9). It summed its own
   facilities, named them by `productType` where the rooms named them by product,
   read covenants its own way and never looked at collateral, parties or the
   obligor group at all. Every fact below now comes from
   `channel/relationshipContext.ts`, the same builder the two rooms select from,
   so the surfaces differ only in HOW MUCH of the book they carry and never in
   WHAT it says. The prose is the desk's; the figures are nobody's twice.      */

const line = (parts: Array<string | null | undefined>): string => parts.filter(Boolean).join(", ") + ".";

/** THE ASSET NAMED, NOT THE WHOLE PLEDGE CLAUSE. The org writes a collateral
 *  description as a paragraph of exclusions, and nine of them is most of this
 *  surface's budget spent on language the room already carries in full. The
 *  FIGURES beside it are never clipped: it is the same asset, named shorter. */
const ASSET_CLIP = 72;

function clipAsset(text: string): string {
  const said = text.replace(/\s+/g, " ").trim();
  if (said.length <= ASSET_CLIP) return said;
  const cut = said.slice(0, ASSET_CLIP);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > ASSET_CLIP / 2 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

function facilityLine(f: NonNullable<BrainReadBlocks["facilities"]>[number]): string {
  return line([
    f.name,
    f.commitment ? `${f.commitment} committed` : null,
    f.drawn ? `${f.drawn} drawn` : null,
    f.rate,
    f.maturity ? `matures ${f.maturity}` : null,
    f.coverage ? `coverage ${f.coverage}` : null,
    f.stage && f.stage !== "Booked" ? `(${f.stage})` : null,
  ]);
}

/* ---------------------------------------------------------- the version chain

   THE DESK WAS BLIND TO THE ONE FACT THAT LOCKS A ROOM. `book/packages.ts`
   already computes the fork for the pickers, the workroom envelope now carries
   it (`reads.inFlight`), and the chat carried nothing: "why can't I modify this"
   was answerable in a workroom and unanswerable on the surface a founder opens
   on. Same facts, same words, relationship-wide rather than package-anchored.  */

function inFlightLines(bundle: BorrowerBundle): string[] {
  const out: string[] = [];
  for (const row of inFlightRoster({ bundle, accountName: "", productPackageId: null })) {
    if (row.version) {
      out.push(
        `${row.packageName} IS the unbooked modification version of another package, ${
          row.editable ? "still editable until it reaches approval" : "at Approval / Loan Committee and no longer editable"
        }. It carries no booked facility, so a modification or a renewal has nothing here to act against.`,
      );
      continue;
    }
    if (row.hasInFlightModification) {
      out.push(
        `${MODIFICATION_IN_PROGRESS} on ${row.packageName}: a version of it is unbooked with the org${
          row.versionId ? ` (${row.versionId})` : ""
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

/** THE ONE DROP ORDER, READ FROM THE FRONT. The envelope gives blocks up in
 *  {@link CONTEXT_DROP_ORDER}; the desk cuts from the END of its own parts, so
 *  it emits them in the reverse of that list and the block the envelope
 *  surrenders first is the block the desk's cut reaches first. Exposure leads on
 *  both surfaces because it grounds nearly every question a banker asks. */
const DESK_BLOCK_ORDER = [...CONTEXT_DROP_ORDER].reverse();

/** The part of the book each block belongs to, in the words a cut notice uses. */
const DESK_BLOCK_WHAT: Record<(typeof CONTEXT_DROP_ORDER)[number], string> = {
  exposure: "the facility totals",
  covenants: "the covenants and their thresholds",
  facilities: "the facility list",
  inFlight: "the package versions in flight",
  group: "the obligor group",
  involvements: "who is on the deal",
  collateral: "the collateral and its valuations",
  pricing: "the rates as stored",
  history: "the actions already filed",
};

/**
 * The whole relationship as prose, uncapped by the gateway's tiny budget.
 *
 * `history` is THE TRAIL THIS COCKPIT HAS FILED, which the desk advertised in
 * its own cut notice ("the actions already filed") and could never carry: no
 * caller passed it, so `historyBlock` returned undefined on every call and the
 * block was unreachable by construction (founder 2026-09-12, the fallback
 * audit). The rooms have travelled with it since the one builder landed.
 */
export function deskContext(
  bundle: BorrowerBundle,
  accountName: string,
  opts: { history?: readonly ActionHistoryRow[] } = {},
): string {
  const parts: ContextPart[] = [];
  const push = (text: string, what: string) => parts.push({ text, what });
  const sn = (bundle.snapshot ?? {}) as unknown as Record<string, unknown>;
  /* THE SAME BUILDER THE ROOMS SELECT FROM, at the desk's own scope: no package
     anchor, so every figure here is the WHOLE relationship and says so. */
  const reads = buildRelationshipFacts({ bundle, accountName, productPackageId: null, history: opts.history }) ?? {
    notCarried: [],
  };

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

  for (const block of DESK_BLOCK_ORDER) {
    const what = DESK_BLOCK_WHAT[block];
    if (block === "exposure" && reads.exposure) {
      /* THE SCOPE IS SAID IN THE SAME BREATH AS THE FIGURE, and both figures
         come from the one builder. This total is every active facility on the
         RELATIONSHIP, across every package; a workroom's total is the anchored
         PACKAGE, and on Hartwell the two are $57M and $49M. Both are honest and
         neither used to say which, so a banker who asked here and then opened
         the room read two numbers for one deal. */
      push(
        `Facilities across the relationship, every package included: ${reads.exposure.committed} committed, ${reads.exposure.drawn} drawn across ${reads.exposure.facilities}.`,
        what,
      );
    }
    if (block === "covenants") {
      /* THE TEST AND WHAT IT IS MEASURED AGAINST. A current value with no
         threshold beside it is a figure with nothing to read it against, and
         "what is this covenant doing" was unanswerable on this surface. */
      for (const c of reads.covenants ?? []) {
        push(
          line([
            c.name,
            c.status,
            c.threshold === "not carried" ? "no threshold carried on this read" : `tests ${c.threshold}`,
            c.measured ? `last ${c.measured}` : null,
            c.frequency,
            c.nextTest ? `next test ${c.nextTest}` : null,
            c.scope,
          ]),
          what,
        );
      }
    }
    if (block === "facilities") for (const f of reads.facilities ?? []) push(facilityLine(f), what);
    if (block === "inFlight") for (const said of inFlightLines(bundle)) push(said, what);
    if (block === "group") {
      for (const g of reads.group ?? [])
        push(
          line([
            `${g.name} is the ${g.relation}`,
            g.role,
            g.ownership ? `${g.ownership} owned` : null,
            g.grade ? `own risk grade ${g.grade}` : null,
            // NO `counterpartyId` HERE. The id exists so a room can address
            // `connectedPartyBook` with it; this surface reaches no tool, so an
            // 18-character record id is noise a model might read out loud.
          ]),
          what,
        );
    }
    if (block === "involvements") {
      for (const i of reads.involvements ?? []) push(line([`${i.name} is ${i.role} on ${i.scope}`, i.detail]), what);
    }
    if (block === "collateral") {
      for (const c of reads.collateral ?? [])
        push(
          line([
            clipAsset(c.asset),
            c.type,
            c.pledged ? `${c.pledged} pledged` : null,
            c.lendable ? `${c.lendable} lendable` : null,
            c.advanceRate ? `${c.advanceRate} advance rate` : null,
            `securing ${c.scope}`,
            c.valuation,
          ]),
          what,
        );
    }
    if (block === "pricing") {
      // The rates already ride on the facility lines; the block travels only as
      // the honest statement that a rate is ALL this org stores.
      if (reads.pricing?.length) push("Pricing as stored is a rate only on every facility above.", what);
    }
    if (block === "history") for (const h of reads.history ?? []) push(line([`Filed: ${h.what}`, h.status]), what);
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

  /* THE STANDING HONESTY LIST (backlog item 14a). The desk named a gap only
     when its own cut happened to reach one; the rooms have carried `notCarried`
     since the envelope shipped. Same list, same words, same derivation, and it
     is reserved out of the budget so it can never be the line that does not
     fit. */
  return assemble(parts, notCarriedSentence(reads.notCarried));
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
 *
 * `standing` is the honesty list. It is reserved out of the budget the way the
 * cut notice is, because the envelope's `notCarried` never leaves either: the
 * one line that lets an answer refuse by name must not be the line that is cut.
 */
function assemble(parts: ContextPart[], standing = ""): string {
  const budget = CONTEXT_CAP - NOTICE_RESERVE - standing.length;
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
  const notice = lost.length
    ? ` This context was cut to fit, so it does not carry ${lost.join(", ")}. Say that it is not in front of you rather than reading what is here as the whole book.`
    : "";
  return `${kept.join(" ")}${notice}${standing ? ` ${standing}` : ""}`;
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

/* ------------------------------------------------------------- the deadline

   THE ONE LANE THAT WAS NOT BOUNDED (founder 2026-09-12, the fallback audit).
   The rooms bound every call they make: BRAIN_TIMEOUT_MS, the default-tier and
   tool-tier ceilings, RESTATE_TIMEOUT_MS. The desk started no clock and the
   panel passed no signal, so a session that never came back left "Composing"
   on the glass with no bound, no escape and nothing for the banker to do.

   THE WAIT IS SPENT, SO IT IS NOT SPENT TWICE. A deadline resolves with the
   sentence rather than throwing, which is deliberate: throwing would send the
   caller down to the gateway for a second round trip of the same length, and
   the banker has already waited. A door that REFUSES still throws, because
   that costs nothing and the next rung should have its turn.                 */

/** How long the desk may hold the chat open. The session door's own default
 *  tier is 5 to 60 seconds to first text, so this sits just past its far end. */
export const DESK_TIMEOUT_MS = 75_000;

/** What the desk says when the wait is spent. It names the wait, it refuses to
 *  claim an answer, and it hands the banker two moves that both exist here. */
export const deskTimeoutAnswer = (seconds: number): string =>
  `The desk has not come back within ${seconds} seconds, so I am not going to leave you waiting on it. Ask again, or open the relationship room, where this same book is already loaded.`;

/** Ask the desk. Resolves with the honest sentence where the wait runs out, and
 *  throws the sample door's own failure shapes where the door refuses, so the
 *  caller's next rung still gets its turn. */
export async function askDesk(args: {
  bundle: BorrowerBundle;
  accountName: string;
  question: string;
  /** The conversation so far, oldest first, WITHOUT this question. */
  thread?: readonly BrainTurn[];
  /** The trail this cockpit has already filed on this relationship. */
  history?: readonly ActionHistoryRow[];
  signal?: AbortSignal;
  deadlineMs?: number;
  onText?: (update: { text: string }) => void;
}): Promise<string> {
  const prompt = `${DESK_RULES}\n\nContext:\n${deskContext(args.bundle, args.accountName, { history: args.history })}${deskThread(
    args.thread,
  )}\n\nQuestion: ${args.question}`;
  const deadlineMs = args.deadlineMs ?? DESK_TIMEOUT_MS;

  const controller = new AbortController();
  const stop = () => controller.abort();
  args.signal?.addEventListener("abort", stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), deadlineMs);
  });

  try {
    const raced = await Promise.race([
      askSession(prompt, { tier: "default", kind: "reply", signal: controller.signal, onText: args.onText }),
      deadline,
    ]);
    if (raced === LATE) {
      controller.abort();
      return deskTimeoutAnswer(Math.round(deadlineMs / 1000));
    }
    return deskAnswer(raced);
  } finally {
    if (timer) clearTimeout(timer);
    args.signal?.removeEventListener("abort", stop);
  }
}

/** The deadline's own token, so a model answer can never be mistaken for it. */
const LATE = Symbol("desk-deadline");
