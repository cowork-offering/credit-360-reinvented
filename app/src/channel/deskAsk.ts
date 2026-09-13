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

   TWO CONTEXTS, ONE DOOR (2026-09-13). {@link deskContext} is the relationship,
   for a view with one open; {@link deskPortfolioContext} is the BOOK, for the
   worklist view, which had no context of its own and therefore no desk at all.
   Both travel through {@link askThroughDoor}, so the deadline, the guard and
   the failure shapes are identical wherever the banker asked.
   ============================================================================= */

import { bookTotalsOf } from "../book/livePortfolio";
import { MODIFICATION_IN_PROGRESS, packageRoster } from "../book/packages";
import { DISCARD_ACTION_ID } from "../actions/discardVersion";
import type { ActionHistoryRow, BorrowerBundle, C360Data, Facility, ReasonCode } from "../data/contract";
import { fmtRatio } from "../data/finance";
import { fmtDate, fmtMoney } from "../data/format";
import { queueSentence, type Queue } from "../data/queue";
import { overdueTestIds } from "../data/worklist";
import { buildWorklistRows, type WorklistRow } from "../data/worklistRows";
import { REASON_META } from "../components/reasons";
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

/** One member of a version, at the figures the version itself carries. */
function versionMemberLine(f: Facility): string {
  return line([
    f.name,
    typeof f.committed === "number" ? `${fmtMoney(f.committed)} committed` : null,
    typeof f.interestRate === "number" ? `${f.interestRate}%` : null,
    f.maturityDate ? `matures ${fmtDate(f.maturityDate)}` : null,
    f.stage ? `at ${f.stage}` : null,
  ]);
}

/**
 * THE VERSION'S OWN STATE, IN THE THREE WORDS THE COCKPIT USES FOR IT (0.9.23).
 *
 * 0.9.18 taught the desk that a version EXISTS, which is what made "why can't I
 * modify this" answerable. It still could not answer the two questions the
 * founder actually asked next: what is IN the version, and what happened to the
 * one we discarded. So an editable version now travels with its members at
 * their own figures (the whole point of a version is that its figures differ
 * from the booked package's), and a discard on the trail is stated with its
 * date, because a version that is gone is not a version the desk should still
 * be describing as in flight.
 */
function inFlightLines(bundle: BorrowerBundle, history?: readonly ActionHistoryRow[]): string[] {
  const out: string[] = [];
  for (const row of inFlightRoster({ bundle, accountName: "", productPackageId: null, history })) {
    if (row.version) {
      out.push(
        `${row.packageName} IS the unbooked modification version of another package, ${
          row.editable
            ? `${MODIFICATION_IN_PROGRESS}, editable until approval`
            : "in approval, locked: it is at Approval / Loan Committee and no longer the banker's to change"
        }. It carries no booked facility, so a modification or a renewal has nothing here to act against.`,
      );
      if (row.editable) {
        const members = packageRoster(bundle, history).find((e) => e.id === row.packageId)?.members ?? [];
        for (const f of members) out.push(`On the version: ${versionMemberLine(f)}`);
        out.push(
          `The version can be discarded from the cockpit, which removes it and its copies and leaves the booked package exactly as it is.`,
        );
      }
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
  for (const said of discardedLines(history)) out.push(said);
  return out;
}

/** A version this cockpit has already discarded, with the date it went. Read
 *  off the durable trail, so it survives the session that did it. */
function discardedLines(history?: readonly ActionHistoryRow[]): string[] {
  const out: string[] = [];
  for (const row of history ?? []) {
    if (row.actionId !== DISCARD_ACTION_ID) continue;
    if ((row.status ?? "").toLowerCase() !== "completed") continue;
    const when = row.executedAt ?? row.createdDate;
    out.push(
      `A modification version on this relationship was discarded${when ? ` on ${fmtDate(when.slice(0, 10))}` : ""}. ` +
        "It no longer exists in the org and the booked package it forked from was left untouched.",
    );
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
    if (block === "inFlight") for (const said of inFlightLines(bundle, opts.history)) push(said, what);
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
function assemble(parts: ContextPart[], standing = "", cap = CONTEXT_CAP): string {
  const budget = cap - NOTICE_RESERVE - standing.length;
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

/* ========================================================= THE BOOK, NOT A DEAL

   THE WORKLIST VIEW ASKED NOBODY (founder 2026-09-13, the "Composing" report;
   W1's finding (a)). The desk was tried only where an account was open AND a
   bundle resolved, so a question asked on the landing fell past the desk, past
   a connector that is not in every view, and into the legacy prompt bridge,
   which throws "no agent channel" where nothing is wired. The banker got a note
   and no answer, on the first surface the cockpit opens on.

   THE LANDING HAS A BOOK, AND IT IS ENOUGH TO ANSWER FROM. The page already
   derives the queue, ranks it, counts the quiet rest and sums the totals the
   KPI band prints. "Who needs attention today", "which relationship has the
   thinnest coverage", "how much is committed across the book" are all answered
   off that, and none of them needs a facility.

   SAME DISCIPLINE, SMALLER SCOPE. Every figure is printed by the function the
   glass prints it with ({@link bookTotalsOf}, `fmtMoney`, `fmtRatio`,
   `queueSentence`), so the chat and the landing can never state two books. What
   a book-level read CANNOT say is refused standing, by name, with the move that
   would get it: open the relationship.                                        */

/** The widest a portfolio context may travel. A fifth of the relationship
 *  budget because a book row is one line of an already-summarised read, not a
 *  facility, a covenant and a pledge each. MEASURED, not guessed: the real book
 *  (`artifact/live-data.json`, five relationships) spends 2,819 of it, and a
 *  60-relationship book fills it and is cut at rank 21 with the cut named. The
 *  widest prompt this makes is 8,955 B against a 48,000 B cap. */
export const PORTFOLIO_CONTEXT_CAP = 5_000;

/** How many quiet relationships travel by name. The quiet rest is a count with
 *  a few names on it, never a second queue. */
const QUIET_NAMED = 8;

/** The model's standing instruction on the landing. The two rules that hold
 *  every surface ({@link RECOMMEND_ONLY_WHEN_GROUNDED}, {@link VOICE}) are the
 *  pack's own constants, imported rather than paraphrased, exactly as
 *  {@link DESK_RULES} carries them: one rule, now three surfaces. */
export const DESK_PORTFOLIO_RULES =
  "You are the credit desk for this banker's whole book. Answer in plain prose, no headings, no markdown, no bullet characters. " +
  "Use only the figures in the context; when something is not there, say this view does not carry it, in one clause, and name the one move that would get it. " +
  "Never mention tabs, views or where the reader is standing. A rundown is a lead sentence, then the facts that matter, at most six sentences. " +
  "Every figure here is BOOK LEVEL: the portfolio read's own total per relationship, and the queue the page ranks from it. A relationship's facilities, covenant values and collateral are read one relationship at a time and are not here, so name the relationship and the room rather than reaching for a figure this view does not hold. " +
  "Lead with the current figure on file. Where the banker is deciding where to start, name the relationship, the reason it is on the queue and the figure that makes it matter, then the real options. " +
  RECOMMEND_ONLY_WHEN_GROUNDED +
  " " +
  "Close on the next step, in one clause: the relationship to open, or the question that follows. Never leave the banker with nothing to do. " +
  VOICE;

/** WHAT A BOOK-LEVEL READ CANNOT STATE, said standing rather than only when a
 *  cut happens to reach it, and ending on the one move that gets all four. */
const BOOK_NOT_CARRIED = [
  "the facilities on any one relationship, their commitments, rates and maturities",
  "covenant values and the thresholds they test against",
  "collateral, its valuations and what it secures",
  "the obligor group, the guarantors and who is on each deal",
];

/** The honesty list for the landing, as one sentence, reserved out of the
 *  budget the way the relationship desk reserves its own. */
const BOOK_NOT_CARRIED_SAID = `This view does not carry ${BOOK_NOT_CARRIED.join(
  "; ",
)}. Refuse those by name; the move that gets any of them is to open the relationship for those.`;

/** A day count as a banker reads it, or nothing where the read carries no date. */
function dayClause(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return " (today)";
  return days > 0 ? ` (in ${days} days)` : ` (${Math.abs(days)} days ago)`;
}

/** One reason, as the code AND the words the chip on the landing says, so the
 *  answer and the row a banker is looking at use one vocabulary. */
const reasonSaid = (code: ReasonCode): string => `${code} (${REASON_META[code].label.toLowerCase()})`;

/**
 * ONE QUEUE ROW.
 *
 * THE SCOPE RIDES EVERY TOTAL, for the same reason it does on the relationship
 * desk: `portfolio.accounts[].tce` is the portfolio read's rollup and a
 * relationship's own exposure read sums its active facilities. On Hartwell that
 * is $54.0M here and $57.0M in the room, both honest, and a figure with no
 * scope on it is how one relationship reads as two.
 */
function bookRowLine(row: WorklistRow, rank: number, overdue: boolean, coverage: string | null): string {
  const reasons = row.reasons.map(reasonSaid);
  return line([
    `${rank}. ${row.name}`,
    reasons.length ? `on the queue for ${reasons.join(" and ")}` : "on the queue with no reason code carried",
    overdue ? "the test is overdue" : null,
    row.riskRating != null ? `risk grade ${row.riskRating}` : null,
    typeof row.tce === "number" ? `${fmtMoney(row.tce)} total credit exposure as the portfolio read carries it` : null,
    typeof row.outstanding === "number" ? `${fmtMoney(row.outstanding)} drawn` : null,
    coverage ? `collateral coverage ${coverage} as the org computes it across that relationship` : null,
    row.nextTestDate ? `next covenant test ${fmtDate(row.nextTestDate)}${dayClause(row.nextTestDays)}` : null,
    row.maturityDate ? `nearest maturity ${fmtDate(row.maturityDate)}${dayClause(row.maturityDays)}` : null,
  ]);
}

/** What the landing holds: the book, the queue and the quiet rest. The panel
 *  hands this straight off `useApp`, so the chat reads the page's own state
 *  rather than deriving a second one. */
export interface DeskPortfolioState {
  data: C360Data;
  queue: Queue;
}

/**
 * THE WHOLE BOOK AS PROSE, at the landing's own scope.
 *
 * Cut the way the relationship context is cut: at a whole line, from the end,
 * naming the part of the book that did not travel. The queue is emitted loudest
 * first, so a cut reaches the quietest rows first and the work at the top of
 * the banker's day always survives it.
 */
export function deskPortfolioContext(state: DeskPortfolioState): string {
  const { data, queue } = state;
  const accounts = data.portfolio?.accounts ?? [];
  const totals = bookTotalsOf(accounts);
  const rows = buildWorklistRows(data, queue.worklist);
  const overdue = overdueTestIds(data);
  const byId = new Map(accounts.map((a) => [a.accountId, a]));

  const parts: ContextPart[] = [];
  const push = (text: string, what: string) => parts.push({ text, what });

  const count = totals.accountCount ?? accounts.length;
  push(
    line([
      `The book on this page is ${count} ${count === 1 ? "relationship" : "relationships"}`,
      typeof totals.totalCommitted === "number" ? `${fmtMoney(totals.totalCommitted)} committed` : null,
      typeof totals.totalOutstanding === "number" ? `${fmtMoney(totals.totalOutstanding)} drawn` : null,
      typeof totals.utilizationPct === "number" ? `${totals.utilizationPct}% drawn against commitment` : null,
      "summed over the rows on this page and over nothing else",
    ]),
    "the book totals",
  );

  push(queueSentence(queue.summary), "the queue's own count");
  push(
    "The rows below are in the queue's own order, loudest signal first: a client request waiting, then a covenant breach, a recorded exception, an overdue test, a test due, a maturity inside the window, a modification cluster, a guarantor signal, a recent modification. Position is the severity; there is no other scale.",
    "the order the queue ranks in",
  );

  rows.forEach((row, i) => {
    const bundle = data.borrowers?.[row.accountId];
    const ratio = bundle?.exposure?.coverageRatio;
    push(
      bookRowLine(row, i + 1, overdue.has(row.accountId), typeof ratio === "number" ? fmtRatio(ratio) : null),
      "the rest of the needs-action queue",
    );
  });

  if (queue.summary.quiet > 0) {
    const named = queue.quiet
      .slice(0, QUIET_NAMED)
      .map((id) => {
        const a = byId.get(id);
        if (!a) return null;
        return typeof a.tce === "number" ? `${a.name} (${fmtMoney(a.tce)})` : a.name;
      })
      .filter((n): n is string => Boolean(n));
    push(
      `${queue.summary.quiet} ${queue.summary.quiet === 1 ? "relationship carries" : "relationships carry"} no signal today${
        named.length ? `, the largest being ${named.join(", ")}` : ""
      }. Quiet is not clear: it means no reason code fired on this read.`,
      "the quiet rest of the book",
    );
  }

  return assemble(parts, BOOK_NOT_CARRIED_SAID, PORTFOLIO_CONTEXT_CAP);
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
  return askThroughDoor(prompt, args);
}

/**
 * ASK THE DESK ABOUT THE BOOK, from a view with no relationship open.
 *
 * The same door, the same deadline and the same guard as {@link askDesk}: the
 * two surfaces differ in the context they carry and in nothing else, so a
 * failure, a timeout or an empty answer behaves identically wherever the banker
 * asked it.
 */
export async function askDeskPortfolio(args: {
  state: DeskPortfolioState;
  question: string;
  /** The conversation so far, oldest first, WITHOUT this question. */
  thread?: readonly BrainTurn[];
  signal?: AbortSignal;
  deadlineMs?: number;
  onText?: (update: { text: string }) => void;
}): Promise<string> {
  const prompt = `${DESK_PORTFOLIO_RULES}\n\nContext:\n${deskPortfolioContext(args.state)}${deskThread(
    args.thread,
  )}\n\nQuestion: ${args.question}`;
  return askThroughDoor(prompt, args);
}

/** The door, the deadline and the guard, shared by both desk surfaces. */
async function askThroughDoor(
  prompt: string,
  args: { signal?: AbortSignal; deadlineMs?: number; onText?: (update: { text: string }) => void },
): Promise<string> {
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
