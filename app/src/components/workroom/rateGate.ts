import type { Facility } from "../../data/contract";
import type { WorkroomDelta } from "../../workroom/types";
import type { ElicitMember } from "./elicit";

/* =============================================================================
   THE RATE, ASKED WITH FIGURES ON IT.

   FOUNDER, 2026-09-03, driving the ninth publish. The room staged the
   amortisation and the first payment date, then said "This org does not store
   an index name, and no spread is carried on this read. The all-in rate must be
   supplied" and asked "What all-in rate applies to the $15.0MM line?". He asked
   what options he had and was told again that there was no index. He clicked
   "I have a new all-in rate" and the room answered "The banker has supplied an
   all-in rate. All-in rate updated on file" WITH NO FIGURE ANYWHERE. A dead end
   that reported success.

   THREE THINGS ARE WRONG WITH THAT AND THIS FILE FIXES ALL THREE.

   1. AN ASK WITH NO FIGURES IN IT IS A FORM. The room holds the facility's own
      rate; the question offers it back as a chip the banker can take in one
      click ("Hold 7.60% fixed"), beside the two ways of changing it, and it
      carries an EXAMPLE of the answer it wants.
   2. SAYING "I HAVE A NEW RATE" IS NOT A RATE. It is the banker choosing which
      way to answer. Nothing stages until a NUMBER lands, and the card that
      stages carries the figure and what it was.
   3. "THIS ORG DOES NOT STORE AN INDEX NAME" IS AN ASIDE, not an answer. It is
      said at most once per facility, and never in reply to "what options do I
      have" - the answer to that question is the options.

   THE ORG STORES THE RATE ITSELF (`LLC_BI__InterestRate__c`), not an index and a
   spread, so every answer this gate takes resolves to ONE ALL-IN FIGURE. A
   banker pricing off an index says which one and what it comes to; the index
   travels as a NOTE on the card, because it is what the banker was thinking and
   not what the org will hold.

   NOTHING HERE INVENTS A RATE. With no rate on the read there is no hold chip:
   the room says it has none rather than offering a figure nobody read.
   ============================================================================= */

/** The answer the room is asking for, in the banker's own shorthand. */
export const RATE_EXAMPLE = "e.g. 7.25% fixed, paid monthly";

/** THE ASIDE. Once per facility, never as the answer to a question about
 *  options. */
export const RATE_NO_INDEX =
  "This read carries no index name and no spread, so the room works in all-in rates: the org stores the rate itself.";

/** The indexes a banker prices off on this book. A LIST OF NAMES, never a
 *  level: no read on this cockpit carries what Prime or SOFR is today, and a
 *  level nobody read is the one thing this gate may not print. */
export const RATE_INDEXES = ["Prime", "SOFR"] as const;
export type RateIndex = (typeof RATE_INDEXES)[number];

/* ------------------------------------------------------------ what is on file

   THE STREAM FIRST, THEN THE LOAN. nCino prices a loan through its payment
   streams, and a stream's rate component is the figure a banker recognises
   ("7.60 Fixed, monthly"). Where the read carries no streams - which is every
   read this cockpit takes today - the loan's own rate stands. Where it carries
   neither, THERE IS NO RATE ON FILE and the room says so.                     */

/** A rate component on a payment stream, at the shape nCino holds one. Optional
 *  on the contract because no read supplies it yet; read defensively so a book
 *  that gains one is read without another build. */
interface StreamLike {
  rate?: number | null;
  rateType?: string | null;
  frequency?: string | null;
  active?: boolean | null;
}

export interface RateOnFile {
  /** The figure, as a percentage. */
  pct: number;
  /** "fixed", "variable": the org's own word, lower-cased, or null. */
  basis: string | null;
  /** "monthly", "quarterly": the stream's frequency, or null. */
  frequency: string | null;
  /** Which read it came off. */
  from: "stream" | "loan";
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const word = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.toLowerCase() : null;
};

/** The rate this facility carries, or null where the read carries none. */
export function rateOnFile(facility: Facility | null | undefined): RateOnFile | null {
  if (!facility) return null;
  const streams = (facility as { streams?: StreamLike[] }).streams;
  if (Array.isArray(streams)) {
    for (const s of streams) {
      if (s?.active === false) continue;
      const pct = num(s?.rate);
      if (pct === null) continue;
      return { pct, basis: word(s?.rateType), frequency: word(s?.frequency), from: "stream" };
    }
  }
  const loan = num(facility.interestRate);
  return loan === null ? null : { pct: loan, basis: null, frequency: null, from: "loan" };
}

/** The figure, as the glass prints it. Two decimals only where they say
 *  something: 7.6 is "7.60%" and 7 is "7.00%", because a rate is money. */
export const ratePct = (pct: number): string => `${pct.toFixed(2)}%`;

/** "7.60% fixed, paid monthly" - as much of it as the read actually carries. */
export function rateLabel(on: RateOnFile): string {
  return [ratePct(on.pct), on.basis, on.frequency ? `paid ${on.frequency}` : null]
    .filter(Boolean)
    .join(" ")
    .replace(/%\s(\w+)\spaid/, "% $1, paid");
}

/* ------------------------------------------------------------- the sentences

   EVERY CHIP TYPES BACK A COMPLETE SENTENCE, so no state is held between turns:
   the room reads the whole thing again and gets the same answer. The facility is
   named by the ORG's own loan name wherever a change is being STAGED, which
   resolves exactly one member inside the parser; the room's own label is enough
   for the sentences that stage nothing.                                       */

const targetOf = (m: ElicitMember): string => m.orgName ?? m.label;

/** THE ONE SENTENCE THAT STAGES. It is an ordinary rate instruction, so it
 *  travels through the same parser, the same wire and the same manifest a typed
 *  "move the line of credit rate to 7.25%" does, and it shows up on the plan
 *  read-back like any other entry. */
export const rateSay = (member: ElicitMember, pct: string): string =>
  `move the ${targetOf(member)} rate to ${pct}%`;

/** "Hold the rate": an answer that stages nothing and settles the gate. */
export const rateHoldSay = (member: ElicitMember): string => `hold the rate on the ${member.label}`;

/** "New all-in rate": the banker will type a figure. Stages NOTHING. */
export const rateNewSay = (member: ElicitMember): string => `set the rate on the ${member.label} myself`;

/** "Index + spread": the banker prices off an index and will say which. */
export const rateIndexSay = (member: ElicitMember): string => `price the ${member.label} off an index`;

/** The index picked, which is still not a rate: the figure comes next. */
export const rateIndexPickSay = (member: ElicitMember, index: RateIndex): string =>
  `price the ${member.label} off ${index}`;

/* ------------------------------------------------------------------ the ask */

export interface RateAsk {
  memberId: string;
  text: string;
  options: Array<{ label: string; say: string }>;
}

/**
 * THE RATE QUESTION, WITH THE FIGURES ON IT.
 *
 * @param onFile     what the read carries for this facility, or null.
 * @param indexSaid  has the "no index name" aside already been said here?
 */
export function rateAsk(member: ElicitMember, onFile: RateOnFile | null, indexSaid: boolean): RateAsk {
  /* THE ASK INFORMS, IT NEVER FORCES (founder, 2026-09-03: "I also get forced
     to fill this out"). The first chip is always the way OUT of the question:
     the figure on file where the read carries one, and the plain "keep it as
     booked" where it does not. Both stage nothing. */
  const options = [
    { label: onFile ? `Hold ${rateLabel(onFile)}` : "Keep the rate as booked", say: rateHoldSay(member) },
    { label: "New all-in rate", say: rateNewSay(member) },
    { label: "Index + spread", say: rateIndexSay(member) },
  ];
  const carried = onFile
    ? `The read carries ${rateLabel(onFile)} on it${onFile.from === "stream" ? ", off its payment stream" : ""}.`
    : "This read carries no rate on it, so there is nothing here to hold.";
  return {
    memberId: member.id,
    text: [`What rate should the ${member.label} carry?`, carried, indexSaid ? null : RATE_NO_INDEX, RATE_EXAMPLE]
      .filter(Boolean)
      .join(" "),
    options,
  };
}

/** WHICH INDEX, which is a second question and not the same one. It names no
 *  level, because no read on this cockpit carries one. */
export function rateIndexAsk(member: ElicitMember): RateAsk {
  return {
    memberId: member.id,
    text: `Which index is the ${member.label} priced off? The all-in figure comes next: this read carries no index level, and the org stores the rate itself rather than an index and a spread.`,
    options: RATE_INDEXES.map((index) => ({ label: index, say: rateIndexPickSay(member, index) })),
  };
}

/** THE FIGURE, ASKED FOR PLAINLY, once the banker has said how they want to give
 *  it. One line, with the example, and nothing stages until a number lands. */
export function rateFigureAsk(member: ElicitMember, index: RateIndex | null): string {
  return index
    ? `What does the ${member.label} come to all-in over ${index}? ${RATE_EXAMPLE}, and I will note that it is priced off ${index}.`
    : `What is the new all-in rate on the ${member.label}? ${RATE_EXAMPLE}.`;
}

/** What the card says about a rate the banker priced off an index. The org holds
 *  the rate and not the index, so the index is a NOTE and never a figure. */
export const rateIndexNote = (index: RateIndex): string =>
  `Priced off ${index}. The org stores the all-in rate itself, so the index travels as a note on the plan and not as a field.`;

/** What the banker reads when they hold the rate. */
export function rateHeldLine(member: ElicitMember, onFile: RateOnFile | null): string {
  return onFile
    ? `The ${member.label} keeps ${rateLabel(onFile)}. Nothing is staged for the rate and the new version carries it forward.`
    : `The ${member.label} keeps the rate the org holds. Nothing is staged for it.`;
}

/* ------------------------------------------------------- reading the answers */

const matchLabel = (members: ElicitMember[], said: string): ElicitMember | undefined => {
  const want = said.trim().toLowerCase();
  return members.find(
    (m) =>
      m.label.toLowerCase() === want ||
      (m.shortName ?? "").toLowerCase() === want ||
      (m.orgName ?? "").toLowerCase() === want,
  );
};

/** "Hold the rate on the $15.0MM Line of Credit". */
export function readRateHold(line: string, members: ElicitMember[]): string | null {
  const hit = /^hold the rate on the (.+?)\s*$/i.exec((line ?? "").trim());
  return hit ? (matchLabel(members, hit[1])?.id ?? null) : null;
}

/**
 * A BARE KEEP-CURRENT WORD, at a rate ask that already knows its member. The
 * chip says the whole sentence ("hold the rate on the …"), but the rate gate is
 * FORCED — the banker must answer it — so a banker who simply types "hold" or
 * "keep it" must be understood too, or they are stuck with no way out but the
 * chip. The member is the gate's; only the intent is read here. "keep it at 7%"
 * carries a figure and is read as the figure elsewhere, so a digit disqualifies.
 */
export function readRateKeepWord(line: string): boolean {
  const t = (line ?? "").trim();
  if (!t || /\d/.test(t)) return false;
  return /^(?:hold|keep(?:\s+(?:it|current|the\s+same|as[-\s]?is|as\s+it\s+is))?|no\s+change|don'?t\s+change(?:\s+it)?|leave\s+(?:it|as[-\s]?is|as\s+it\s+is|unchanged)?|unchanged|same|as[-\s]?is|stet)\b/i.test(
    t,
  );
}

/** "Set the rate on the $15.0MM Line of Credit myself". */
export function readRateNew(line: string, members: ElicitMember[]): string | null {
  const hit = /^set the rate on the (.+?) myself$/i.exec((line ?? "").trim());
  return hit ? (matchLabel(members, hit[1])?.id ?? null) : null;
}

/** "Price the $15.0MM Line of Credit off an index". */
export function readRateIndexOpen(line: string, members: ElicitMember[]): string | null {
  const hit = /^price the (.+?) off an index$/i.exec((line ?? "").trim());
  return hit ? (matchLabel(members, hit[1])?.id ?? null) : null;
}

/** "Price the $15.0MM Line of Credit off Prime". */
export function readRateIndexPick(
  line: string,
  members: ElicitMember[],
): { memberId: string; index: RateIndex } | null {
  const hit = /^price the (.+?) off (Prime|SOFR)$/i.exec((line ?? "").trim());
  if (!hit) return null;
  const member = matchLabel(members, hit[1]);
  if (!member) return null;
  const index = RATE_INDEXES.find((i) => i.toLowerCase() === hit[2].toLowerCase());
  return index ? { memberId: member.id, index } : null;
}

/* ===================== THE ANSWER, IN THE FORMS A BANKER WRITES IT (2026-09-03)

   FOUNDER'S TRANSCRIPT: he typed "Yes, 7.25% all-in" and the room asked "What
   rate should it move to? A percentage, or a move in basis points." The figure
   was in the line. Re-asking a question the banker has just answered is the
   worst thing a room can do, and it happened because only a BARE percentage was
   read as an answer.

   FIVE FORMS, ALL OF THEM ANSWERS:

     7.25%, 7.25 percent, 7.25% fixed paid monthly   an all-in figure
     Yes, 7.25% all-in                               the same, behind a courtesy
     up 25 bps, +0.25%, down 50 basis points         a MOVE on the rate on file
     prime plus 1, SOFR + 2.25                       an INDEX, and the all-in
                                                     figure is asked for next
     240 (bare, no per-cent mark)                    NOT a rate. It is an
                                                     amortisation, and the same
                                                     composer reaches this lane.

   A MOVE NEEDS A RATE ON FILE. "Up 25 bps" from nothing is not a figure, so
   with no rate on the read the move is not an answer and the room says what it
   needs instead of staging arithmetic on an unknown.                          */

/** The courtesies a banker puts in front of an answer. Stripped, never read. */
const AFFIRM =
  /^\s*(?:(?:yes|yep|yeah|yup|sure|ok|okay|correct|right|agreed|confirmed|please|go\s+with|let'?s\s+(?:go\s+with|say|use|do))\b[\s,.:;-]*)+/i;

/** The correction a banker opens an amendment on. Mirrors `elicit.ts`. */
const RATE_CORRECTION =
  /^\s*(?:(?:no|actually|instead|rather|sorry)[,\s]+)*(?:(?:let'?s\s+)?(?:change|make|set|put|move|use)\s+(?:it|that|the\s+rate)?\s*)?(?:to\s+|at\s+|it\s+)?/i;

/** The tail a banker adds to a rate and the room does not need. */
const RATE_TAIL = /\s*(?:all[-\s]?in|fixed|variable|floating)?\s*(?:,?\s*paid\s+\w+)?\s*[.]?$/i;

/** The plausible band for an all-in commercial rate. A figure outside it is far
 *  likelier to be a term, an amount or a typo than a rate, and staging it would
 *  be the $1 commitment again in a different field. */
const RATE_MIN = 0.01;
const RATE_MAX = 40;

const inBand = (pct: number): boolean => Number.isFinite(pct) && pct >= RATE_MIN && pct <= RATE_MAX;

/** Two decimals, which is how the org holds a rate and how the card prints it. */
const asPct = (pct: number): string => pct.toFixed(2);

export interface RateAnswer {
  /** The all-in figure, where the line carried or implied one. Null where the
   *  banker named an index and the figure is still to come. */
  pct: string | null;
  /** The index the banker priced off, where they named one. */
  index: RateIndex | null;
}

export function readRateFreeText(text: string, ctx: { onFile: number | null }): RateAnswer | null {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 90) return null;
  const said = raw.replace(AFFIRM, "").replace(RATE_CORRECTION, "").trim();
  if (!said) return null;

  /* AN INDEX AND A SPREAD. The index is the answer; the all-in figure is the
     next question, because no read on this cockpit carries what Prime is. */
  const overIndex = /^(prime|sofr)\s*(?:\+|plus|over)?\s*(\d{1,3}(?:\.\d{1,4})?)?\s*(?:%|percent|bps|bp|basis\s*points?)?\s*$/i.exec(
    said.replace(RATE_TAIL, ""),
  );
  if (overIndex) {
    const index = RATE_INDEXES.find((i) => i.toLowerCase() === overIndex[1].toLowerCase()) ?? null;
    if (index) return { pct: null, index };
  }

  /* A MOVE ON THE RATE ON FILE. Basis points or per cent, up or down. */
  const move = /^(up|down|\+|-|plus|minus)\s*(\d{1,4}(?:\.\d{1,4})?)\s*(%|percent|pct|bps|bp|basis\s*points?)\s*$/i.exec(
    said.replace(RATE_TAIL, ""),
  );
  if (move) {
    if (ctx.onFile === null) return null;
    const unit = move[3].toLowerCase();
    const step = Number(move[2]) / (unit.startsWith("b") ? 100 : 1);
    const down = /^(down|-|minus)$/i.test(move[1]);
    const next = ctx.onFile + (down ? -step : step);
    return inBand(next) ? { pct: asPct(next), index: null } : null;
  }

  /* THE FIGURE ITSELF. A per-cent mark, the word, or a decimal point: a bare
     integer is an amortisation and reaches this lane from the same composer. */
  const plain = /^(\d{1,2}(?:\.\d{1,4})?)\s*(?:%|percent|pct)?/i.exec(said.replace(RATE_TAIL, "").trim());
  if (!plain) return null;
  const whole = said.replace(RATE_TAIL, "").trim();
  if (!/^\d{1,2}(?:\.\d{1,4})?\s*(?:%|percent|pct)?$/i.test(whole)) return null;
  if (!/[%]|percent|pct/i.test(whole) && !whole.includes(".")) return null;
  const pct = Number(plain[1]);
  return inBand(pct) ? { pct: asPct(pct), index: null } : null;
}

/** "What index and rate options do I have?" - a question about the OFFER, which
 *  is answered by making the offer again rather than by prose. */
export function asksRateOptions(text: string): boolean {
  const said = (text ?? "").trim().toLowerCase();
  if (said.length > 120) return false;
  const asks = /\b(what|which|any)\b/.test(said) || /^options\b/.test(said);
  const about = /\b(option|options|choice|choices|index|indexes|indices|rate|rates|spread)\b/.test(said);
  return asks && about;
}

/** Does the plan already carry a rate change on this facility? */
export function carriesRate(entries: WorkroomDelta[], memberId: string): boolean {
  return entries.some((e) => e.member === memberId && e.wire?.key === "requestedRate");
}
