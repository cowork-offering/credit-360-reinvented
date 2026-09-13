import type { Facility } from "../../data/contract";
import type { WorkroomDelta } from "../../workroom/types";
import type { ElicitMember } from "./elicit";
import { carriesRate } from "./rateGate";

/* =============================================================================
   THE FOUR FIELDS nCINO PRICES ON (founder, 2026-09-02).

   Salesforce hides the rate and the payment stream on a loan until FOUR fields are
   defined on it:

     LLC_BI__Amount__c                  the loan amount
     LLC_BI__Term_Months__c             the term
     LLC_BI__Amortized_Term_Months__c   the amortised term (a double)
     LLC_BI__First_Payment_Date__c      the first payment date

   ON HARTWELL, TWO OF THE FOUR ARE BLANK. First Payment Date is blank on every
   loan, and Amortized Term is blank on both lines of credit and on Construction,
   booked AND on the new version. So a modification that moves the $15M line to
   $20M produces a version nobody can price in the Salesforce UI: the banker signs a
   change, the org files it, and the screen the next person opens shows no rate
   and no payment stream.

   NO READ ON THIS COCKPIT CARRIES THEM. `Customer360Exposure` returns the
   amount, the maturity and the rate and nothing else about the schedule, so the
   room treats both as UNKNOWN and ASKS. Absent is not zero and it is not "fine".

   THE ANSWERS RIDE THE ORDINARY FIELD WAVE. Both fields are already in the
   room's own field catalog (`loan.amortisedTerm`, `loan.firstPaymentDate`), both
   are `live-verified`, and both travel in `fieldChangesJson` like any other loan
   field: the org resolves each against its own describe at stage time. Neither
   is on `C360WriteGuard`'s OBJ_LOAN deny-list (which holds only hasRenewal,
   Number_Of_Renewals and RootLoanId) and neither is in
   `StageLoanModification.FIELD_WAVE_DENY` (which holds the four scalars, the
   stage and status, the anchors and the versioning flags). Verified against
   `knowledge/sf-build-v2/wp2/classes/` on 2026-09-02.

   ONE QUESTION AT A TIME, and the banker can decline. "Leave pricing for later"
   is a real answer: it is recorded on the plan, nothing is staged for it, and
   the room says plainly what the consequence is.

   NOTHING HERE READS A CLOCK. Every date the room offers is computed from the
   artifact's own `meta.generatedAt`, which is the only instant any derivation in
   this room is allowed to read.
   ============================================================================= */

/* THE RATE JOINS THE GATE (founder, 2026-09-03). nCino prices on four fields
   and the room asked for two of them; the RATE is the figure the banker
   actually argues about, and the live room was asking for it through the brain
   lane with no figures on the question and no figure on the answer. It is a
   slot here now, asked last, with `rateGate.ts` owning its own sentences. */
export type PricingSlot = "amortisedTerm" | "firstPaymentDate" | "rate";

/** The org's own API names, which is what the field wave travels under. */
export const PRICING_FIELD: Record<PricingSlot, string> = {
  amortisedTerm: "LLC_BI__Amortized_Term_Months__c",
  firstPaymentDate: "LLC_BI__First_Payment_Date__c",
  /* THE RATE IS NOT A FIELD-WAVE FIELD. `LLC_BI__InterestRate__c` is one of the
     four SCALARS the modification already files (`requestedRate`), so it rides
     the wire it has always ridden and this entry exists only so the record is
     total. Nothing looks it up through `carriesPricing`. */
  rate: "LLC_BI__InterestRate__c",
};

/** The room's own field-catalog ids for the same two fields. */
export const PRICING_CATALOG_ID: Record<PricingSlot, string> = {
  amortisedTerm: "loan.amortisedTerm",
  firstPaymentDate: "loan.firstPaymentDate",
  rate: "loan.rate",
};

/** Why the room is asking, in the banker's own vocabulary. Said on the card and
 *  on the confirm, because a question with no reason behind it reads as a form. */
export const PRICING_WHY =
  "Salesforce needs the amount, the term, the amortised term and the first payment date before it will price this loan.";

/**
 * WHAT A SKIPPED PRICING ASK BECOMES, in one quiet row.
 *
 * FOUNDER, 2026-09-03: "I also get forced to fill this out." Every pricing ask
 * is INFORMATION - the version cannot be priced until these are set - and none
 * of them is a gate. Leaving them is a real answer, it stages nothing, and the
 * row says what the consequence is without asking again.
 */
export const PRICING_SKIPPED =
  "Pricing left for later: Salesforce will ask for the amortised term and first payment date before the rate and payment stream can be set";

/** What the banker reads when they leave it. */
export const PRICING_LATER =
  "Left for later. Nothing is staged for it, and until it is set the new version will not show a rate or a payment stream in Salesforce.";

/* --------------------------------------------------- what moves the pricing */

/** The two scalars whose movement makes the pricing fields matter. A rate or a
 *  maturity does not: nCino prices on the amount and the term. */
const PRICING_SCALARS = new Set(["requestedAmount", "requestedTermMonths"]);

/** Does this entry move the facility's amount or its term? */
export function movesPricing(delta: WorkroomDelta): boolean {
  const key = delta.wire?.key;
  return typeof key === "string" && PRICING_SCALARS.has(key);
}

/** The term this plan is putting on that facility, where it is putting one. The
 *  "same as the term" chip stands on this and on nothing else: the read carries
 *  no term, so a term nobody staged is a term this room does not know. */
export function stagedTermMonths(entries: WorkroomDelta[], memberId: string): number | null {
  for (const e of entries) {
    if (e.member !== memberId) continue;
    if (e.wire?.key === "requestedTermMonths" && typeof e.wire.value === "number") return e.wire.value;
  }
  return null;
}

/** Does the plan already carry this field on this facility? */
export function carriesPricing(entries: WorkroomDelta[], memberId: string, slot: PricingSlot): boolean {
  return entries.some((e) => e.member === memberId && e.fieldWire?.field === PRICING_FIELD[slot]);
}

/**
 * WHY THIS ENTRY IS ON THE PLAN WITHOUT THE BANKER HAVING NAMED IT (Cowork
 * feedback, 2026-09-03). A whisper naming only an amount and a term landed
 * FOUR cards, because this gate adds the amortised term and the first payment
 * date once either scalar moves, and the manifest said "4 changes" with
 * nothing telling the banker two of them were the room's own doing.
 *
 * READ STRUCTURALLY, off the field the delta wires, rather than a flag set at
 * construction: the entry lands through `Workroom.tsx`'s `landPricing`, off
 * `engine.parseIntent`, and the engine is byte-fenced (`workroom/engine.ts`),
 * so there is no construction site in this tree to mark. The two fields this
 * gate owns are the only ones that answer true; every other delta, including
 * an amount or a term the banker DID name, reads null here.
 */
export function pricingDerivedReason(delta: WorkroomDelta): string | null {
  const field = delta.fieldWire?.field;
  return field === PRICING_FIELD.amortisedTerm || field === PRICING_FIELD.firstPaymentDate ? PRICING_WHY : null;
}

/** Does the BOOK already carry it? Absent is UNKNOWN, and unknown is asked. */
export function bookCarriesPricing(facility: Facility | null | undefined, slot: PricingSlot): boolean {
  if (!facility) return false;
  /* THE RATE IS ALWAYS ASKED, and that is not an oversight. A rate the org
     already holds is not an answer to "what should this carry now": the banker
     may keep it, and KEEPING IT IS A DECISION they make in one click. The other
     two are blanks; this one is a choice. */
  if (slot === "rate") return false;
  return slot === "amortisedTerm"
    ? typeof facility.amortizedTermMonths === "number"
    : typeof facility.firstPaymentDate === "string" && facility.firstPaymentDate.trim().length > 0;
}

export interface PricingNeed {
  memberId: string;
  slot: PricingSlot;
}

export interface PricingSource {
  /** The manifest, in landing order. */
  entries: WorkroomDelta[];
  /** The facilities the room is standing on, by loan id. */
  facilities: Map<string, Facility>;
  /** The facilities the banker has left for later, by member id. */
  declined: ReadonlySet<string>;
  /** The facilities whose rate the banker chose to HOLD. Holding is an answer
   *  and it stages nothing, so nothing on the plan can record it: the room has
   *  to remember that it asked and was answered. */
  held: ReadonlySet<string>;
}

/**
 * THE ONE PRICING FIELD THIS PLAN STILL NEEDS, or null.
 *
 * In manifest order, so the first facility the banker moved is the first one
 * asked about, and the amortised term before the first payment date, because
 * that is the order a banker settles them in.
 */
export function pricingNeed(src: PricingSource): PricingNeed | null {
  const moved: string[] = [];
  for (const e of src.entries) {
    if (!movesPricing(e) || !e.member) continue;
    if (!moved.includes(e.member)) moved.push(e.member);
  }
  for (const memberId of moved) {
    if (src.declined.has(memberId)) continue;
    const facility = src.facilities.get(memberId);
    for (const slot of ["amortisedTerm", "firstPaymentDate", "rate"] as PricingSlot[]) {
      if (bookCarriesPricing(facility, slot)) continue;
      if (slot === "rate") {
        /* THE RATE IS ONLY ASKED ABOUT A FACILITY THE BOOK HOLDS. A create
           composes a loan the org has not booked and cannot carry the pricing
           fields anyway; the room says so on the plan rather than asking for a
           rate to hold on a record that does not exist yet. The two FIELD slots
           keep the behaviour they have always had. */
        if (!facility) continue;
        if (carriesRate(src.entries, memberId)) continue;
        if (src.held.has(memberId)) continue;
        return { memberId, slot };
      }
      if (carriesPricing(src.entries, memberId, slot)) continue;
      return { memberId, slot };
    }
  }
  return null;
}

/* ------------------------------------------------------------- the sentences

   THE CHIP TYPES BACK A COMPLETE SENTENCE, so no state is held between turns for
   a chip: the room reads the whole thing again and gets the same answer. The
   facility is named by the ORG's own loan name, which resolves exactly one
   member inside the parser rather than relying on a filter afterwards.         */

const targetOf = (m: ElicitMember): string => m.orgName ?? m.label;

export function pricingSay(member: ElicitMember, slot: PricingSlot, value: string): string {
  return slot === "amortisedTerm"
    ? `on the ${targetOf(member)} set the amortisation term to ${value} months`
    : `on the ${targetOf(member)} set the first payment date to ${value}`;
}

/** "Leave pricing for later" is an answer, and it is one sentence. */
export const pricingLaterSay = (member: ElicitMember): string => `leave pricing for later on the ${member.label}`;

/** "Other" is an answer too: the room asks for the figure and holds the slot. */
export const pricingOtherSay = (member: ElicitMember, slot: PricingSlot): string =>
  slot === "amortisedTerm"
    ? `set the amortisation term on the ${member.label} myself`
    : `set the first payment date on the ${member.label} myself`;

/* ----------------------------------------------------------------- the dates

   THE FIRST OF A MONTH, COMPUTED FROM THE ARTIFACT'S OWN INSTANT. `Date.now()`
   is never read: a cockpit rendered from a snapshot has one clock and it is the
   snapshot's. With no instant at hand the room offers no dates and asks for one
   in the banker's own words, which is the honest state rather than an invented
   month.                                                                      */

/** The first of the month `ahead` months after `generatedAt`, as YYYY-MM-DD,
 *  which is the format `StageLoanModification` coerces a DATE field from. */
export function firstOfMonth(generatedAt: string | undefined, ahead: number): string | null {
  if (!generatedAt) return null;
  const at = new Date(generatedAt);
  if (Number.isNaN(at.getTime())) return null;
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth() + ahead;
  const shifted = new Date(Date.UTC(year, month, 1));
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-01`;
}

/** The month a YYYY-MM-DD reads as, for a chip label. */
export function monthLabel(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/* ------------------------------------------------------------------ the ask */

export interface PricingAsk {
  need: PricingNeed;
  text: string;
  options: Array<{ label: string; say: string }>;
}

/** The bank's own amortisation lengths, offered beside the plan's own term.
 *  A BAND, NOT A DEFAULT: the approved credit terms are the authority. */
const AMORTISATION_MONTHS = [240, 300];

export function pricingAsk(
  need: PricingNeed,
  member: ElicitMember,
  args: { entries: WorkroomDelta[]; generatedAt?: string },
): PricingAsk {
  if (need.slot === "amortisedTerm") {
    const term = stagedTermMonths(args.entries, need.memberId);
    const options = [
      ...(term !== null ? [{ label: `Same as the term (${term} months)`, say: pricingSay(member, "amortisedTerm", String(term)) }] : []),
      ...AMORTISATION_MONTHS.filter((m) => m !== term).map((m) => ({
        label: `${m} months`,
        say: pricingSay(member, "amortisedTerm", String(m)),
      })),
      { label: "Another figure", say: pricingOtherSay(member, "amortisedTerm") },
      { label: "Leave pricing for later", say: pricingLaterSay(member) },
    ];
    return {
      need,
      text:
        `What is the amortisation term on the ${member.label}? ${PRICING_WHY} ` +
        "This read carries no amortisation for it, and the org holds it blank on the booked loan and on the new version, so nobody can price the change until it is set." +
        (term === null ? " This plan sets no term either, so there is nothing here for me to match it to." : ""),
      options,
    };
  }

  const next = firstOfMonth(args.generatedAt, 1);
  const after = firstOfMonth(args.generatedAt, 2);
  const dates = [next, after].filter((d): d is string => d !== null);
  return {
    need,
    text:
      `What is the first payment date on the ${member.label}? ${PRICING_WHY} ` +
      "The org holds it blank on every loan on this relationship, so this is the last of the four." +
      (dates.length ? "" : " This view carries no snapshot instant, so I will not offer a month; say the date."),
    options: [
      ...dates.map((iso) => ({ label: `1 ${monthLabel(iso)}`, say: pricingSay(member, "firstPaymentDate", iso) })),
      { label: "Another date", say: pricingOtherSay(member, "firstPaymentDate") },
      { label: "Leave pricing for later", say: pricingLaterSay(member) },
    ],
  };
}

/* ------------------------------------------------------- reading the answers */

/** The chip's own sentence, read back. Null where the line is not one. */
export function readPricingLine(
  line: string,
  members: ElicitMember[],
): { memberId: string; slot: PricingSlot; value: string } | null {
  const text = (line ?? "").trim();
  const amort = /^on the (.+?) set the amortisation term to (\d+(?:\.\d+)?) months$/i.exec(text);
  const date = /^on the (.+?) set the first payment date to (\d{4}-\d{2}-\d{2})$/i.exec(text);
  const hit = amort ?? date;
  if (!hit) return null;
  const member = members.find((m) => (m.orgName ?? m.label).toLowerCase() === hit[1].trim().toLowerCase());
  if (!member) return null;
  return { memberId: member.id, slot: amort ? "amortisedTerm" : "firstPaymentDate", value: hit[2] };
}

/** "Leave pricing for later on the $15.0MM Line of Credit". */
export function readPricingDecline(line: string, members: ElicitMember[]): string | null {
  const hit = /^leave pricing for later on the (.+?)\s*$/i.exec((line ?? "").trim());
  if (!hit) return null;
  const said = hit[1].trim().toLowerCase();
  return members.find((m) => m.label.toLowerCase() === said || (m.shortName ?? "").toLowerCase() === said)?.id ?? null;
}

/**
 * A KEEP WORD, ANSWERING THE GATE (D4, orchestrator drive 2026-09-13).
 *
 * "keep it", "no change", "leave it", "hold": a banker's way of declining to
 * move a field. The org holds BOTH pricing fields blank on every loan on this
 * relationship, so keeping what is booked IS leaving the pricing for later, and
 * the word lands on that chip rather than falling through to the general parser
 * as a line it cannot read.
 *
 * Anchored at both ends, so "leave pricing for later on the ..." (the chip's own
 * sentence, read by `readPricingDecline`) is never swallowed here.
 */
export function readPricingKeep(line: string): boolean {
  return /^(?:hold|keep(?:\s+(?:it|as\s+booked|current|the\s+same|as[-\s]?is))?|no\s+change|leave\s+(?:it|as[-\s]?is)?|unchanged|same|as[-\s]?is)\s*$/i.test(
    (line ?? "").trim(),
  );
}

/** "Set the amortisation term on the $15.0MM Line of Credit myself". */
export function readPricingOther(line: string, members: ElicitMember[]): PricingNeed | null {
  const hit = /^set the (amortisation term|first payment date) on the (.+?) myself$/i.exec((line ?? "").trim());
  if (!hit) return null;
  const said = hit[2].trim().toLowerCase();
  const member = members.find((m) => m.label.toLowerCase() === said);
  if (!member) return null;
  return { memberId: member.id, slot: /amortisation/i.test(hit[1]) ? "amortisedTerm" : "firstPaymentDate" };
}

/* ============================ THE ANSWER, IN THE WORDS A BANKER WRITES IT IN

   THE $1 COMMITMENT (founder drive, 2026-09-02). The room asked for the first
   payment date. The banker typed "actually change it to Oct 1, 2026". Only
   YYYY-MM-DD was read as a date, so the line fell through to the general
   parser, "1" was read as a COMMITMENT and the room staged
   "Commitment amount $15M -> $1" with a magnitude warning beside it.

   TWO READINGS, AND BOTH OF THEM BELONG TO THE OPEN QUESTION. A correction
   opener ("actually", "change it to", "make it") in front of an answer is the
   same answer, corrected: rule 5 of the create grammar, applied to the room's
   own gate. And a date is a date in the four forms a banker actually writes.

   THE STRIP IS DELIBERATELY NARROW. What is left after the opener must be the
   WHOLE answer and nothing else, so "extend the maturity to 2027-06-30" is
   still an instruction: it carries a verb and a field the strip does not take
   off, and what remains is not a bare date.                                  */

/** The correction a banker opens an amendment on, and nothing more of the
 *  sentence than that. Mirrors `elicit.ts`'s own CORRECTION, which is what
 *  amends an open create card. */
const CORRECTION =
  /^\s*(?:(?:no|actually|instead|rather|sorry)[,\s]+)*(?:(?:let'?s\s+)?(?:change|make|set|put|move|use)\s+(?:it|that|the\s+date|the\s+term)?\s*)?(?:to\s+|at\s+|it\s+)?/i;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** The month a word names, 1 to 12, or null. Three letters is enough, and the
 *  full name is what a banker usually types. */
function monthNumber(word: string): number | null {
  const said = word.toLowerCase().replace(/\.$/, "");
  const at = MONTHS.findIndex((m) => m === said || (said.length >= 3 && m.startsWith(said)));
  return at < 0 ? null : at + 1;
}

const iso = (y: number, m: number, d: number): string | null =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;

/**
 * A DATE, IN THE FORMS A BANKER WRITES ONE: 2026-10-01, Oct 1, 2026,
 * October 1st 2026, 1 October 2026. Null where the text is not a whole date and
 * nothing else, which is what keeps an instruction out of this lane.
 */
export function readDate(text: string): string | null {
  const said = text.trim().replace(/[.,;]+$/, "");
  const plain = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(said);
  if (plain) return iso(Number(plain[1]), Number(plain[2]), Number(plain[3]));

  // Oct 1, 2026 / October 1st 2026
  const monthFirst = /^([A-Za-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})$/.exec(said);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]);
    if (month) return iso(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }

  // 1 October 2026 / 1st Oct 2026
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}\.?)\s*,?\s*(\d{4})$/.exec(said);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]);
    if (month) return iso(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }
  return null;
}

/** The line with its correction opener taken off, where it carries one. */
const corrected = (text: string): string => text.replace(CORRECTION, "").replace(/[?\s]+$/, "").trim();

/** The banker's own free-text answer to a held question. A bare number is a
 *  count of months; a bare date is a date, in any of the forms one is written
 *  in. A correction opener in front of either is the SAME answer, corrected.
 *  Anything else is not an answer, and the room lets its ordinary lanes take
 *  the line. */
export function readPricingFreeText(line: string, slot: PricingSlot): string | null {
  const raw = (line ?? "").trim();
  for (const text of raw === corrected(raw) ? [raw] : [raw, corrected(raw)]) {
    if (slot === "amortisedTerm") {
      const months = /^(\d{1,3})(?:\s*months?)?$/i.exec(text);
      if (months) return months[1];
      const years = /^(\d{1,2})\s*years?$/i.exec(text);
      if (years) return String(Number(years[1]) * 12);
      continue;
    }
    const date = readDate(text);
    if (date) return date;
  }
  return null;
}

/** "Another date", "a different figure": the banker wants to type it. Read as
 *  an answer to the OPEN gate, so the room holds the slot and asks rather than
 *  handing the words to the general parser. */
export function readPricingAnother(line: string, slot: PricingSlot): boolean {
  const text = (line ?? "").trim();
  const noun = slot === "amortisedTerm" ? /(figure|term|number|amount)/i : /(date|day|month)/i;
  return /^\s*(?:an?\s+)?(?:other|another|different)\s+/i.test(text) && noun.test(text);
}

/** The sentence the room says when a pricing field lands on the plan. */
export function pricingLanded(slot: PricingSlot, member: ElicitMember, display: string): string {
  return slot === "amortisedTerm"
    ? `The amortisation term on the ${member.label} goes onto the plan at ${display}. ${PRICING_WHY}`
    : `The first payment date on the ${member.label} goes onto the plan at ${display}. ${PRICING_WHY}`;
}

/** What the plan says about a facility the banker left for later. */
export function pricingDeclinedLine(member: ElicitMember): string {
  return `Pricing fields on the ${member.label}: left for later. The amortisation term and the first payment date are not on this plan, so the new version will not show a rate or a payment stream in Salesforce until somebody sets them.`;
}
