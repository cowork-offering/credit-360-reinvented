/* =============================================================================
   A NEW FACILITY INSIDE A MODIFICATION, AND INSIDE A RENEWAL.

   THE FOUNDER, 2026-09-03: "Do we allow new loans to be created as part of the
   modification and renewal? This should be fully possible."

   It was not. `readSteer` matched "add a new loan" as an ORIGINATION and the
   room RESTARTED in the create route, which throws away the manifest the banker
   has been building. That is the wrong answer twice over: it loses work, and it
   is wrong about Salesforce. A modification is anchored on the PRODUCT PACKAGE and
   produces the next VERSION of it; new money goes on the version being approved,
   not on a package nobody is looking at.

   SO THE LINE STAYS IN THIS ROOM and stages a card. The card rides the org arm
   `newFacilitiesJson` through the same sentinel `fieldWire` every other arm uses
   (see `orgArms.ts`), and the facility becomes a target the LATER lines can name:
   "add Elena Hartwell as limited guarantor on the new equipment loan" resolves to
   the label `new:1` and the org attaches it to the loan it just created.

   NOTHING HERE HOLDS STATE BETWEEN TURNS. Every question the room asks offers
   chips whose `say` is the WHOLE sentence again with one more answer in it, so
   the room re-reads the line from scratch and gets the same result. That is the
   rule `pricingGate.ts` already runs on, and it is why an elicitation can never
   drift out of step with what the banker actually typed.

   THE PRICING GATE IS PART OF THE GRAMMAR, not an afterthought. Salesforce hides the
   rate and the payment stream until the amount, the term, the AMORTISED term and
   the FIRST PAYMENT DATE are all set. A modification that moves a commitment is
   asked for the last two; a facility this room CREATES is asked for them on the
   same terms, because a new loan nobody can price is the same defect arriving
   from the other direction.
   ============================================================================= */

import type { WorkroomDelta, WorkroomMode } from "../../workroom/types";
import { ARM_FIELD, encodeArm, type ArmEntry, type NewFacilitySpec } from "./orgArms";
import type { Draft, ElicitContext, ElicitMember } from "./elicit";
import { clipTitle } from "./elicit";
import { PRICING_WHY, firstOfMonth, monthLabel, readDate } from "./pricingGate";
import type { FeeOpen } from "./fee";

/* ------------------------------------------------------------- the catalog */

/**
 * THE ORG-EXACT PRODUCTS, and the words a banker reaches for.
 *
 * The value on the left is what the Commercial Loan record type actually offers
 * (`C360NewFacilities.RT_PRODUCT_VALUES`, read off the org 2026-07-26). Record
 * type scoping is NOT enforced by the API: a product outside this list is
 * ACCEPTED and STORED and then renders wrong in nCino, so the room offers only
 * these and the org refuses anything else by name.
 */
const PRODUCTS: Array<{ product: string; words: RegExp }> = [
  { product: "Line of Credit", words: /\b(line\s+of\s+credit|revolver|revolving|loc|working\s+capital\s+line)\b/i },
  { product: "Equipment", words: /\bequipment\b/i },
  { product: "Construction", words: /\bconstruction\b/i },
  { product: "Purchase", words: /\bpurchase\b/i },
  { product: "HELOC", words: /\bheloc\b/i },
  { product: "Deposit", words: /\bdeposit\b/i },
];

/** Every product the room can offer, in the order a C&I banker meets them. */
export const NEW_FACILITY_PRODUCTS = PRODUCTS.map((p) => p.product);

/** THE LINE WITHOUT ITS PURPOSE CLAUSE. "for equipment" is an answer about the
 *  purpose and it must never be read as an answer about the product. */
function withoutPurposeClause(line: string): string {
  return line.replace(/\bfor\s+[^,;.]*/i, " ");
}

/** The product this line names, or null. */
export function readProduct(line: string): string | null {
  for (const p of PRODUCTS) if (p.words.test(line)) return p.product;
  return null;
}

/* ------------------------------------------------------------- the figures */

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, thousand: 1e3, million: 1e6, billion: 1e9 };

const MONEY_WORD =
  /(?:\$\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|mm|m|b|thousand|million|billion)?\b/gi;

/**
 * THE COMMITMENT THIS LINE ASKS FOR, or null.
 *
 * A figure carrying a magnitude ("3M", "$3,000,000", "3 million") is money. A
 * bare small number is NOT: "60 month term" would otherwise be read as a $60
 * commitment, which is the decimal-slip defect the room already knows about from
 * the pricing gate's own $1 incident.
 */
export function readAmount(line: string): number | null {
  const stripped = line.replace(/\b\d+\s*(?:month|months|mo|year|years|yr|yrs)\b/gi, " ");
  MONEY_WORD.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = MONEY_WORD.exec(stripped))) {
    const raw = Number(hit[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const mult = hit[2] ? MAGNITUDE[hit[2].toLowerCase()] : undefined;
    if (mult) return raw * mult;
    // No magnitude word: only a figure written out in full is money.
    if (raw >= 10000) return raw;
  }
  return null;
}

/** The term in months, or null. Years are converted; nothing else is guessed. */
export function readTermMonths(line: string): number | null {
  const months = /\b(\d{1,3})\s*(?:-|\s)?\s*month\b/i.exec(line) ?? /\b(\d{1,3})\s*months\b/i.exec(line);
  if (months) return Number(months[1]);
  const years = /\b(\d{1,2})\s*(?:-|\s)?\s*(?:year|yr)s?\b/i.exec(line);
  if (years) return Number(years[1]) * 12;
  return null;
}

/**
 * THE AMORTISED TERM, which is a different question to the term and is written
 * as one: "amortised over 240 months", "25 year amortisation".
 */
export function readAmortisation(line: string): number | null {
  const over = /\bamorti[sz](?:ed|ation|sation)?\s+(?:term\s+)?(?:of\s+|over\s+)?(\d{1,3})\s*(month|months|year|years|yr|yrs)?\b/i.exec(line);
  if (over) return /year|yr/i.test(over[2] ?? "month") ? Number(over[1]) * 12 : Number(over[1]);
  const ahead = /\b(\d{1,3})\s*(month|months|year|years|yr|yrs)?\s*amorti[sz]/i.exec(line);
  if (ahead) return /year|yr/i.test(ahead[2] ?? "month") ? Number(ahead[1]) * 12 : Number(ahead[1]);
  return null;
}

/**
 * The first payment date, in the forms a banker writes one.
 *
 * The date is taken WORD BY WORD from the front of what follows the marker,
 * longest first, because "Oct 1, 2026" carries a comma of its own and a clause
 * split on commas would hand `readDate` the string "Oct 1".
 */
export function readFirstPayment(line: string): string | null {
  const said = /\bfirst\s+payment(?:\s+date)?\s+(?:of\s+|on\s+|is\s+)?(.+)$/i.exec(line);
  if (!said) return null;
  const words = said[1].trim().split(/\s+/);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const hit = readDate(words.slice(0, n).join(" "));
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------- the purpose

   IT IS A RESTRICTED PICKLIST, and that is the fact everything here turns on.

   Confirmed by describing the org on 2026-09-03:
   `LLC_BI__Loan_Detail__c.LLC_BI__Primary_Loan_Purpose__c`, 23 active CODED
   values (`business_expansion`, `equipment`, `refinance_our_loan`, ...) with
   `restrictedPicklist = true`. The Loan itself carries no primary-purpose field
   at all. So the org REFUSES a banker's own words rather than storing them, and
   a room that put "CNC line expansion" on the wire would stage a plan the org
   throws out at the moment of the write.

   THE BANKER STILL TYPES THEIR OWN WORDS. What the room does is READ them onto
   one of the org's values and SAY which one it read, and where nothing reads it
   offers the values that fit. Nothing is invented and nothing is renamed in
   silence: the card names the coded value the org will hold. */

/** The org's own values, in the order a C&I banker meets them, with the words
 *  that reach each. Read off the live describe on 2026-09-03. */
const PURPOSES: Array<{ value: string; label: string; words: RegExp }> = [
  { value: "business_expansion", label: "Business expansion", words: /\b(expansion|expand|expanding|growth|capacity|new\s+line|line\s+expansion)\b/i },
  { value: "equipment", label: "Equipment", words: /\b(equipment|machinery|machine|plant|fleet|tooling)\b/i },
  { value: "business_startup", label: "Business startup", words: /\b(start[- ]?up|startup|launch)\b/i },
  { value: "business_acquisition", label: "Business acquisition", words: /\b(acquisition|acquire|buyout|purchase\s+of\s+the\s+business)\b/i },
  { value: "business_credit_line", label: "Business credit line", words: /\b(working\s+capital|revolver|credit\s+line|liquidity)\b/i },
  { value: "business_credit_line_increase", label: "Business credit line increase", words: /\bline\s+increase\b/i },
  { value: "construction_owner_occupied", label: "Construction, owner occupied", words: /\bconstruction\b/i },
  { value: "real_estate_purchase_owner_occupied", label: "Real estate purchase, owner occupied", words: /\b(real\s+estate|premises|building|campus)\b/i },
  { value: "property_improvement_owner_occupied", label: "Property improvement, owner occupied", words: /\b(improvement|refurbish|fit[- ]?out|renovation)\b/i },
  { value: "refinance_our_loan", label: "Refinance our loan", words: /\brefinanc\w*\s+(?:our|the\s+existing)\b/i },
  { value: "refinance_other_lender", label: "Refinance another lender", words: /\brefinanc\w*\b/i },
  { value: "other", label: "Other", words: /\bother\b/i },
];

/** Every purpose the room offers, for the chips. */
export const PURPOSE_OPTIONS = PURPOSES.map((p) => ({ value: p.value, label: p.label }));

/** How the room names a coded value on the card. */
export const purposeLabel = (value: string): string =>
  PURPOSES.find((p) => p.value === value)?.label ?? value;

/** The org value a phrase reads onto, or null. An exact coded value passes
 *  through untouched: a caller that already knows the org's word is not second
 *  guessed. */
export function readPurposeValue(said: string): string | null {
  const text = said.trim();
  if (!text) return null;
  const exact = PURPOSES.find((p) => p.value === text.toLowerCase().replace(/\s+/g, "_"));
  if (exact) return exact.value;
  /* THE LONGEST READING WINS (A2 audit, 2026-09-12). The org holds both
     "Business credit line" and "Business credit line increase", and the first
     one's words match "credit line" INSIDE the second one's label: scanned in
     declaration order, the room's own chip for the increase read back onto the
     plain credit line and the card then asserted the wrong coded value to the
     banker. Longest match is the only reading that can tell two values apart
     when one of their names contains the other. */
  let best: { value: string; length: number } | null = null;
  for (const p of PURPOSES) {
    const hit = p.words.exec(text);
    if (hit && (!best || hit[0].length > best.length)) best = { value: p.value, length: hit[0].length };
  }
  return best?.value ?? null;
}

/**
 * THE PURPOSE PHRASE, which is the only free-text the card gathers.
 *
 * "for CNC line expansion" is a purpose; "for the 15M line of credit" is a
 * target and never one, so the phrase is refused where it names a facility or a
 * figure. What comes back is the banker's own words; {@link readPurposeValue}
 * turns them into the value the org will hold.
 */
export function readPurpose(line: string): string | null {
  const said = /\bfor\s+([^,;.]+)/i.exec(line);
  if (!said) return null;
  /* THE PURPOSE ENDS WHERE THE NEXT ANSWER BEGINS. The banker's whole sentence
     is re-read on every turn, so by the last question it carries the pricing
     answers too, and a phrase that ran to the end of the line would file
     "CNC line expansion amortised over 60 months" as the purpose. */
  const text = said[1]
    .split(/\s+(?:amorti[sz]|first\s+payment|with\s+a\b|and\b|over\s+\d)/i)[0]
    .trim()
    .replace(/\s+$/, "");
  if (!text || text.split(/\s+/).length > 12) return null;
  /* A TARGET IS NOT A PURPOSE. "for the 15M line of credit" names a facility, and
     the tell is a definite article beside a facility noun, a dollar sign, or a
     figure carrying a magnitude. "CNC line expansion" carries the word "line"
     and is a purpose, so the noun alone can never be the test. */
  if (/\$/.test(text)) return null;
  if (/\b\d[\d,.]*\s*(k|mm|m|b|thousand|million|billion)\b/i.test(text)) return null;
  if (/\bthe\b/i.test(text) && /\b(loans?|facilit(?:y|ies)|lines?|notes?|revolver)\b/i.test(text)) return null;
  return text;
}

/* --------------------------------------------------------------- the intent */

/** The line asks this room to CREATE a facility rather than to change one. */
const CREATE_VERB = /\b(add|adding|structure|structuring|originate|originating|set\s+up|write|put\s+on|include)\b/i;
const NEW_LOAN = /\b(?:a\s+)?(?:new|another|additional|second|extra)\s+(?:[a-z$0-9,.\s]{0,28}?)\b(loan|facility|line|note|term\s+loan)\b/i;

/* THE WORD "NEW" POINTS TWO WAYS, and the difference is the whole reading.

   "add a new 3M equipment loan" ASKS for a facility. "add Elena Hartwell as
   limited guarantor ON THE NEW EQUIPMENT LOAN" names one that is already on the
   manifest and asks for something else entirely. Both carry a create verb and
   both carry "new ... loan", so the verb and the noun cannot settle it.

   TWO THINGS SETTLE IT, and both are about what the line is FOR:
     a preposition in front of "the new ..." makes it a TARGET, never the object
     of the create; and a create noun anywhere in the line means the object of
     the create is that noun, on whatever facility the line goes on to name. */

/** A preposition and an article in front of "new": the facility is the target. */
const AS_TARGET = /\b(?:on|onto|to|against|for|under|with)\s+(?:the|this|that|our)\s+new\b/i;

/** The object of a create that is not a facility. */
const CREATE_OBJECT =
  /\b(covenants?|tests?|guarantors?|borrowers?|co[- ]borrowers?|part(?:y|ies)|pledges?|collateral|security|assets?|fees?|exceptions?|involvements?|entit(?:y|ies))\b/i;

/** Does this line ask for a new facility on the version being approved? */
export function namesANewFacility(line: string): boolean {
  if (!CREATE_VERB.test(line) || !NEW_LOAN.test(line)) return false;
  if (AS_TARGET.test(line)) return false;
  if (CREATE_OBJECT.test(line)) return false;
  return true;
}

/* ---------------------------------------------------------------- the delta */

/** How the room says a commitment. Matches the manifest's own money voice. */
const money = (n: number): string =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}MM` : `$${n.toLocaleString("en-US")}`;

/**
 * An asset description runs to a paragraph in this org. The first sentence names
 * it; the exclusions inside it are the credit agreement's business. Same rule as
 * `orgArms.ts`'s own, and the truncation mark is ONE character rather than three
 * dots, which are a sentence end to anything that splits on one.
 */
function assetPhrase(label: string): string {
  const first = label.split(/(?<=\.)\s+/)[0].replace(/\.$/, "").trim() || label;
  return clipTitle(first, 64);
}

/** The phrase the manifest, the confirm and every later line know it by. */
export const newFacilityTitle = (spec: NewFacilitySpec): string => `${money(spec.amount)} ${spec.product}`;

export interface NewFacilityArgs {
  /** The BOOKED member the plan is anchored on. The engine builds `facilityIds`
   *  from every delta's `facilityId`, so a label there would put "new:1" into
   *  the payload's facility list and the org would refuse the whole plan. The
   *  arm carries the label; the wire carries a real member. */
  anchorId: string;
  anchorLabel: string;
}

/**
 * THE CARD. One entry on the manifest, one facility on the new version.
 *
 * `op` is "add" and `newMember` is true, because this genuinely moves the member
 * count on the package: the new version holds one facility more than the current
 * one, and the rail's "N of M members" would otherwise under-report it.
 */
export function newFacilityDelta(spec: NewFacilitySpec, args: NewFacilityArgs): WorkroomDelta {
  const arm: ArmEntry = { kind: "newFacility", recordId: spec.label, targetLoanId: spec.label, facility: spec };
  const said = newFacilityTitle(spec);
  const priced = spec.amortizedTermMonths !== undefined && spec.firstPaymentDate !== undefined;
  return {
    id: `facility.new:${spec.label}`,
    group: "terms",
    op: "add",
    kind: "New facility",
    kindTone: "new",
    badge: `${said} added to the new version`,
    title: said,
    target: "the new package version",
    before: "not on this relationship",
    after: `${spec.termMonths} month term, for ${purposeLabel(spec.purpose).toLowerCase()}`,
    newMember: true,
    committedDeltaMM: spec.amount / 1e6,
    map: [
      ["Object", "LLC_BI__Loan__c"],
      ["Product", spec.product],
      ["Amount", money(spec.amount)],
      ["Term", `${spec.termMonths} months`],
      ["Primary loan purpose", `${purposeLabel(spec.purpose)} (${spec.purpose})`],
      [
        "Pricing",
        priced
          ? `amortised over ${spec.amortizedTermMonths} months, first payment ${spec.firstPaymentDate}`
          : "not set. Salesforce will show no rate and no payment stream until it is",
      ],
      ["Purpose handoff", PURPOSE_HANDOFF],
      [
        "Written as",
        "A NEW loan on the new package version, filed at Qualification with the borrower on its own borrowing structure. It carries no chain row and no modification flag: it is not a version of anything, and nothing on the booked side of this relationship changes because of it.",
      ],
    ],
    fields: ["LLC_BI__Product__c", "LLC_BI__Amount__c", "LLC_BI__Term_Months__c"],
    fileable: true,
    fieldWire: {
      field: ARM_FIELD,
      label: "New facility",
      value: encodeArm(arm),
      display: `${said} is filed on the new package version, ${spec.termMonths} months, for ${purposeLabel(spec.purpose).toLowerCase()}`,
      facilityId: args.anchorId,
    },
    filed: {
      recordId: "assigned by the org on execution",
      verification:
        "The facility is re-read after the write and reported under the name the org assigned it, with its package, product, commitment and term proved against what was staged. " +
        "The primary loan purpose is reported as a handoff rather than claimed: the Loan Detail it belongs on does not exist inside the filing transaction.",
    },
  };
}

/* ----------------------------------------------------------- the elicitation

   THE CHIP TYPES BACK A COMPLETE SENTENCE. No state is held between turns: the
   room reads the whole line again and reaches the same answer, which is what
   keeps an elicitation from drifting out of step with what the banker typed. */

/** The line, with one more answer folded into it. */
const withAnswer = (line: string, more: string): string => `${line.trim().replace(/[.\s]+$/, "")} ${more}`;

export interface NewFacilityAsk {
  kind: "ask";
  text: string;
  options?: Array<{ label: string; say: string }>;
  /** THE LINE THIS ASK WAS READ FROM, answers folded in. The room holds it and
   *  hands it back as `composing`, so the NEXT typed answer is read against the
   *  whole composition rather than against the sentence it started as. */
  draft: string;
  /** WHERE THE COMPOSITION HAS GOT TO. The asks are a fixed sequence, so a
   *  typed answer has only answered something if it moved the sequence ON: a
   *  line that leaves the arm asking at the same slot, or sends it BACKWARDS by
   *  renaming the product, answered nothing and belongs to another lane. */
  slot: number;
  /** HOW THIS ASK'S OWN CHIPS PHRASE AN ANSWER. A typed "working capital" is
   *  the same answer as the chip, and the chip says "for working capital"; the
   *  bare word reads onto nothing, and so does a bare date at the first-payment
   *  question. Carried only by the asks whose readers need a marker — a
   *  product, a commitment and a term all read bare — and tried only where the
   *  bare fold answered nothing, so a line that already carries its own
   *  preposition is untouched. */
  phrase?: (answer: string) => string;
}
export interface NewFacilityCard {
  kind: "card";
  spec: NewFacilitySpec;
  said: string;
}
/** The route cannot file it, and the sentence names the one that can. */
export interface NewFacilityHandoff {
  kind: "handoff";
  text: string;
}
export type NewFacilityRead = NewFacilityAsk | NewFacilityCard | NewFacilityHandoff | null;

/**
 * WHY A RENEWAL DOES NOT FILE ONE, AND WHAT DOES.
 *
 * `stage_renewal` takes the same arm and validates it against the org's own
 * product catalog, so the plan a renewal builds NAMES the facility. What it does
 * not do is file it: execution of a renewal is held, because a credit action
 * needs a Booked facility and Booked is reachable only through nCino's own
 * Submit for Approval. Understating what the room can do is the same defect as
 * overstating it, so this says both halves.
 */
export const RENEWAL_HANDOFF =
  "A renewal versions the whole package too, so a new facility belongs on its new version and stage_renewal plans one. " +
  "What it does not do is FILE it: execution of a renewal is held, because a credit action needs a Booked facility and " +
  "Booked is reachable only through Salesforce's own Submit for Approval. Run this as a modification and I will stage the " +
  "facility and file it on the new version. Nothing has been staged and nothing has come off the manifest.";

export interface NewFacilityContext {
  line: string;
  mode: WorkroomMode;
  members: ElicitMember[];
  /** Net-new facilities already on the manifest, for the next label. */
  staged: number;
  /** The artifact's own instant, for the first-payment chips. Never a clock. */
  generatedAt?: string;
  /**
   * THE DRAFT THIS ANSWER BELONGS TO (OPEN-2, 2026-09-12).
   *
   * The chips type the whole sentence back, so the room needed no state — but a
   * banker who TYPES the answer does not type the sentence. "$3MM" at the
   * amount ask names no new facility, so it fell straight past this arm and the
   * composition the room had been building was lost in silence, under an ask
   * that had just promised "say the commitment and I will put it on the new
   * version". This is the line the arm last asked from; the answer is folded
   * into it exactly as a chip would have.
   */
  composing?: string;
  /** THE COMMITMENT THE CLIENT ASKED FOR, where the read carries a request.
   *  Offered as a chip at the amount ask and NOWHERE else: it is a figure on
   *  the book, not a default, and the banker is the one who sizes the loan. */
  requestedCommitment?: number | null;
}

/**
 * WHAT THIS LINE ASKS FOR, and what is still missing before it can be staged.
 *
 * Null hands the line back to every other lane, which is the right answer on the
 * CREATE route: that room's own tool files a facility against the current
 * package and this arm would be a second way to do one thing.
 */
export function readNewFacility(ctx: NewFacilityContext): NewFacilityRead {
  if (ctx.mode !== "modify" && ctx.mode !== "renew") return null;
  if (namesANewFacility(ctx.line)) return draftOn(readComposition(ctx, ctx.line), ctx.line);

  /* THE ANSWER TYPED INTO AN OPEN ASK (OPEN-2, 2026-09-12). It names no new
     facility on its own, so it is read against the draft the ask came from.

     IT ONLY CLAIMS THE LINE IF IT MOVED THE DRAFT ON. The draft is re-read as
     it stood and re-read with the answer folded in, and a fold that leaves the
     room asking the very same question answered nothing: that line belongs to
     whichever lane comes next, exactly as it did before this arm held any
     state. So a commitment lands and "what is the coverage on the line of
     credit" still falls through. */
  const draft = ctx.composing?.trim();
  if (!draft || !namesANewFacility(draft)) return null;
  const open = readComposition(ctx, draft);
  if (!open || open.kind !== "ask") return null;
  /* THE ANSWER, BARE FIRST. A commitment, a term and a product all read
     anywhere in the sentence, so most typed answers need nothing around them. */
  const bare = withAnswer(draft, ctx.line);
  const first = readComposition(ctx, bare);
  if (moved(open, first)) return draftOn(first, bare);

  /* AND THEN AS THE ASK'S OWN CHIP WOULD HAVE SAID IT. "working capital" typed
     at a question whose chips all read "for working capital" is the same
     answer, and dropping it would be the silent loss this fix exists for. */
  if (open.phrase) {
    const phrased = withAnswer(draft, open.phrase(ctx.line.trim()));
    const second = readComposition(ctx, phrased);
    if (moved(open, second)) return draftOn(second, phrased);
  }
  return null;
}

/** TRUE where the folded line took the composition FORWARD. Equal is a line
 *  that answered nothing; backwards is a line that renamed something already
 *  settled, which a question about another facility does by naming its product. */
function moved(open: NewFacilityAsk, next: NewFacilityRead): boolean {
  if (!next) return false;
  if (next.kind === "handoff") return false;
  if (next.kind === "card") return true;
  return next.slot > open.slot;
}

/** An ask carries the line it was read from; nothing else does, because nothing
 *  else leaves a composition open. */
function draftOn(read: NewFacilityRead, line: string): NewFacilityRead {
  return read && read.kind === "ask" ? { ...read, draft: line } : read;
}

/** The whole composition, read off ONE line. Stateless by construction: the
 *  same line always reaches the same place. */
function readComposition(ctx: NewFacilityContext, line: string): NewFacilityRead {
  if (ctx.mode === "renew") return { kind: "handoff", text: RENEWAL_HANDOFF };

  /* THE PRODUCT IS WHAT THE FACILITY IS, NEVER WHAT IT IS FOR (A2 audit,
     2026-09-12). The whole sentence is re-read on every turn, so once the
     purpose answer is on it the purpose vocabulary and the product vocabulary
     collide: the room's own "Equipment" purpose chip, clicked on a HELOC,
     re-read the product as Equipment and silently renamed the facility. The
     purpose clause is taken off before the product is read; where that leaves
     no product the room asks for one, which is the honest outcome. */
  const product = readProduct(withoutPurposeClause(line));
  if (!product) {
    return {
      kind: "ask",
      draft: line,
      slot: 1,
      text:
        "What product is the new facility? The org builds the loan's own name from it and self-populates Construction when it is blank, " +
        "so a facility filed without one ships mislabelled.",
      options: NEW_FACILITY_PRODUCTS.map((p) => ({ label: p, say: withAnswer(line, `as a ${p.toLowerCase()}`) })),
    };
  }

  const amount = readAmount(line);
  if (amount === null) {
    /* THE ONE FIGURE THE ROOM CAN OFFER HERE IS THE ONE THE CLIENT ASKED FOR,
       and only where the read carries a request. There is no doctrine band for
       the size of a facility nobody has structured yet, so with no request
       there is no chip: a default commitment would be the room sizing the loan
       (golden rule 2, the recommendation rule). */
    const asked = ctx.requestedCommitment;
    return {
      kind: "ask",
      draft: line,
      slot: 2,
      text: `How much is the new ${product.toLowerCase()}? Say the commitment and I will put it on the new version.`,
      options:
        typeof asked === "number" && asked > 0
          ? [{ label: `The client asked for ${money(asked)}`, say: withAnswer(line, money(asked)) }]
          : undefined,
    };
  }
  if (amount <= 0) {
    return { kind: "ask", draft: line, slot: 2, text: "A commitment is greater than zero. What is the amount on the new facility?" };
  }

  const termMonths = readTermMonths(line);
  if (termMonths === null) {
    return {
      kind: "ask",
      draft: line,
      slot: 3,
      text: `What term does the ${money(amount)} ${product.toLowerCase()} run for? Salesforce prices on the amount and the term, and a facility with neither cannot be priced at all.`,
      options: [36, 60, 84, 120].map((m) => ({ label: `${m} months`, say: withAnswer(line, `with a ${m} month term`) })),
    };
  }

  const said = readPurpose(line);
  if (!said) {
    return {
      kind: "ask",
      draft: line,
      slot: 4,
      phrase: (a) => `for ${a}`,
      text:
        "What is the primary loan purpose? It goes on the Loan Detail Salesforce creates for the facility, and the org leaves it null, " +
        "so nobody sets it unless this plan carries it. The org holds a fixed list, so say it in your own words and I will " +
        "tell you which of its values that lands on.",
      options: PURPOSE_OPTIONS.slice(0, 6).map((o) => ({ label: o.label, say: withAnswer(line, `for ${o.label.toLowerCase()}`) })),
    };
  }
  /* AND IT HAS TO BE ONE OF THE ORG'S OWN. The field is a RESTRICTED picklist,
     so a phrase that reads onto nothing is asked about with the org's values
     rather than sent up to be refused at the write. */
  const purpose = readPurposeValue(said);
  if (!purpose) {
    return {
      kind: "ask",
      draft: line,
      slot: 5,
      phrase: (a) => `for ${a}`,
      text:
        `"${said}" is not one of the values this org offers for the primary loan purpose, and the field is a restricted ` +
        "picklist so the org refuses anything outside its own list rather than storing it. Which of these is it?",
      options: PURPOSE_OPTIONS.map((o) => ({ label: o.label, say: withAnswer(line.replace(said, o.label.toLowerCase()), "") })),
    };
  }

  /* THE PRICING GATE, on the same terms a commitment change gets it. Two more
     questions, one at a time, and neither is optional-by-silence: a facility
     filed without them opens in Salesforce with no rate and no payment stream. */
  const amortizedTermMonths = readAmortisation(line);
  if (amortizedTermMonths === null) {
    const same = { label: `Same as the term (${termMonths} months)`, say: withAnswer(line, `amortised over ${termMonths} months`) };
    return {
      kind: "ask",
      draft: line,
      slot: 6,
      phrase: (a) => `amortised over ${a}`,
      text: `What is the amortisation term on the new ${product.toLowerCase()}? ${PRICING_WHY} It is a new loan, so nothing carries one for it.`,
      options: [
        same,
        ...[240, 300].filter((m) => m !== termMonths).map((m) => ({ label: `${m} months`, say: withAnswer(line, `amortised over ${m} months`) })),
      ],
    };
  }

  const firstPaymentDate = readFirstPayment(line);
  if (!firstPaymentDate) {
    const next = firstOfMonth(ctx.generatedAt, 1);
    const after = firstOfMonth(ctx.generatedAt, 2);
    const dates = [next, after].filter((d): d is string => d !== null);
    return {
      kind: "ask",
      draft: line,
      slot: 7,
      phrase: (a) => `first payment ${a}`,
      text:
        `What is the first payment date on the new ${product.toLowerCase()}? ${PRICING_WHY} This is the last of the four.` +
        (dates.length ? "" : " This view carries no snapshot instant, so I will not offer a month; say the date."),
      options: dates.map((iso) => ({
        label: `1 ${monthLabel(iso)}`,
        say: withAnswer(line, `first payment ${iso}`),
      })),
    };
  }

  const spec: NewFacilitySpec = {
    label: `new:${ctx.staged + 1}`,
    product,
    amount,
    termMonths,
    purpose,
    amortizedTermMonths,
    firstPaymentDate,
  };
  return {
    kind: "card",
    spec,
    said:
      `${newFacilityTitle(spec)} goes onto the new version of this package, at Qualification with the borrower on its own structure, ` +
      `over ${termMonths} months. The org holds a fixed list of loan purposes and "${said}" reads onto ${purposeLabel(purpose)} ` +
      `(${purpose}), which is what the plan carries. It is a new loan rather than a version of one, so nothing on the booked side of this ` +
      `relationship moves because of it, and booking it is Salesforce's own Submit for Approval like everything else on the version. ` +
      PURPOSE_HANDOFF,
  };
}

/* ------------------------------------------------- naming it on a later line

   "add Elena Hartwell as limited guarantor on the new equipment loan" is about a
   facility that has no id, so it can only be named by what the banker just
   staged. The room resolves it to the LABEL and the org resolves the label to
   the loan it created.                                                        */

/** A staged net-new facility, as the later lines need to see it. */
export interface StagedNewFacility {
  label: string;
  product: string;
  title: string;
}

/** The full spec of every net-new facility on the manifest, in staged order. */
export function stagedNewFacilitySpecs(deltas: WorkroomDelta[]): NewFacilitySpec[] {
  const out: NewFacilitySpec[] = [];
  for (const d of deltas) {
    if (d.fieldWire?.field !== ARM_FIELD) continue;
    try {
      const arm = JSON.parse(String(d.fieldWire.value)) as ArmEntry;
      if (arm.kind === "newFacility" && arm.facility) out.push(arm.facility);
    } catch {
      /* a delta whose arm will not decode is not one this reader claims. */
    }
  }
  return out;
}

/** Every net-new facility on the manifest, in the order they were staged. */
export function stagedNewFacilities(deltas: WorkroomDelta[]): StagedNewFacility[] {
  const out: StagedNewFacility[] = [];
  for (const d of deltas) {
    if (d.fieldWire?.field !== ARM_FIELD) continue;
    try {
      const arm = JSON.parse(String(d.fieldWire.value)) as ArmEntry;
      if (arm.kind === "newFacility" && arm.facility) {
        out.push({ label: arm.facility.label, product: arm.facility.product, title: d.title });
      }
    } catch {
      /* a delta whose arm will not decode is not one this reader claims. */
    }
  }
  return out;
}

/**
 * WHICH STAGED NEW FACILITY THIS LINE NAMES, or null.
 *
 * "the new loan" settles it where exactly one is staged. Where there are two,
 * the product word settles it, and where nothing settles it the caller asks
 * rather than guessing: an arm aimed at the wrong new facility is a covenant on
 * the wrong loan, and nothing downstream would catch it.
 */
export function readNewFacilityTarget(
  line: string,
  staged: StagedNewFacility[],
): { label: string; title: string } | { ambiguous: StagedNewFacility[] } | null {
  if (!staged.length) return null;
  if (!/\bthe\s+new\b|\bnew\s+(loan|facility|line|note)\b/i.test(line)) return null;
  const byProduct = staged.filter((s) => {
    const p = readProduct(line);
    return p !== null && p === s.product;
  });
  if (byProduct.length === 1) return { label: byProduct[0].label, title: byProduct[0].title };
  if (byProduct.length > 1) return { ambiguous: byProduct };
  if (staged.length === 1) return { label: staged[0].label, title: staged[0].title };
  return { ambiguous: staged };
}


/* ========================================================== THE SCOPE MEMBER

   A NET-NEW FACILITY IS A MEMBER OF THE PLAN BEFORE IT IS A MEMBER OF ANYTHING.

   The founder's standard is "fully possible", and half of that is the LATER
   lines: "add Elena Hartwell as limited guarantor on the new equipment loan",
   "add a DSC covenant >= 1.30 on the new loan", "pledge the Fort Wayne inventory
   to the new loan". Every one of those resolves a facility through `readScope`,
   and until the staged facility appears there it can only be named by asking.

   So it appears there, as a synthetic member whose ID IS ITS LABEL. That is the
   whole trick and it is deliberate: the id the room resolves is the id the wire
   carries and the id the org resolves, so no third identifier exists to get out
   of step with the other two.

   `orgName` and `shortName` are NULL, because the org has not named it yet: it
   names a loan on save and nothing here may pretend to know what it will pick.
   `committed` carries the amount, so "the 3M loan" settles on it through the
   dollar qualifier exactly as it does for a booked member.                    */

/** The staged facility, as every scope reader in the room needs to see it. */
export function newFacilityMember(spec: NewFacilitySpec): ElicitMember {
  return {
    id: spec.label,
    key: spec.product.toLowerCase(),
    label: newFacilityTitle(spec),
    orgName: null,
    shortName: null,
    committed: spec.amount,
  };
}

/** Is this member id a facility the plan is creating rather than one it holds? */
export const isNewFacilityMember = (id: string | null | undefined): boolean =>
  typeof id === "string" && /^new:\d+$/i.test(id);

/* ================================================= WHAT MAY NOT LAND ON ONE

   THE APEX REFUSES A CARRY EXCLUSION AND A BORROWING-STRUCTURE REMOVE ON A
   FACILITY THE PLAN IS CREATING, and the reason is the same one in both places:
   an exclusion is the new version NOT carrying a junction the parent holds, and
   a facility being created holds nothing. The room says it here rather than
   sending a plan up to have it said, because a refusal at the confirm gate is a
   refusal the banker reads after signing.                                     */

/** Why a removal cannot name a facility this plan is creating. */
export function newFacilityRemovalRefusal(title: string, noun: string): string {
  return (
    `${title} is a facility this plan is CREATING, so there is no ${noun} on it to take off. ` +
    "A removal on a modification is a carry exclusion: the booked facility keeps its own row and the new version " +
    "starts without it. A new facility starts with the borrower and nothing else, so everything on it is an ADD. " +
    "Nothing has been staged and nothing has come off the manifest."
  );
}

/* ================================================ THE CARDS THAT LAND ON ONE

   THEY ARE BUILT HERE AND NEVER BY THE PARSER, for the same reason the associate
   card is: there is no sentence worth composing. The fenced engine resolves a
   facility against the PACKAGE, and a facility this plan is creating is not on
   it, so a composed sentence would come back unresolved or, worse, resolved onto
   a booked member with the same product word.

   Everything these carry was already settled by the room's own create grammar.
   The wire is the ordinary one for each surface, with `facilityId` set to the
   LABEL: `wirePayload` copies it into each arm's `targetLoanId` untouched, and
   the org resolves the label to the loan it has just created.                 */

const WIRED_FREQUENCY = "Quarterly";

/** The threshold as the banker wrote it, matching the create grammar's own voice. */
const thresholdSaid = (threshold: number, unit?: "ratio" | "money"): string =>
  unit === "money" ? money(threshold) : unit === "ratio" ? `${threshold}x` : String(threshold);

/**
 * WHAT THE CARD SAYS ABOUT THE PURPOSE, on every card that lands on a new
 * facility as well as on the facility's own.
 *
 * The purpose does not land inside the filing transaction: it lives on the Loan
 * Detail, which nCino creates in its own transaction afterwards. The room used
 * to carry the purpose on the wire and say nothing about where it goes, which
 * reads as a field that was filed. It says it now.
 */
export const PURPOSE_HANDOFF =
  "Purpose goes on the Loan Detail after filing, handed off: Salesforce creates that record in its own transaction moments " +
  "after the facility is written, so nothing in the filing transaction can set it. It is on the plan and it is the one " +
  "thing on this facility a person still sets in Salesforce.";

export interface NewFacilityEntryArgs {
  draft: Draft;
  ctx: ElicitContext;
  /** The staged facility this create lands on. */
  spec: NewFacilitySpec;
  /** Position among the composed lines, so two creates on one facility differ. */
  seq: number;
}

/**
 * ONE CREATE, ON A FACILITY THIS PLAN IS CREATING.
 *
 * Covenant, borrowing structure and collateral, which are the three surfaces the
 * create grammar gathers and the three arms whose org-side `targetLoanId` takes
 * a label. Returns null for an ASSOCIATE, which is a junction to an existing
 * covenant and rides its own arm.
 */
export function newFacilityCreateEntry(args: NewFacilityEntryArgs): WorkroomDelta | null {
  const { draft, ctx, spec, seq } = args;
  const s = draft.slots;
  const title = newFacilityTitle(spec);
  const onIt = `on the ${title}, the facility this plan is creating`;

  if (draft.surface === "covenant") {
    // An associate is a junction to a covenant that already exists; it rides
    // `covenantAttachesJson` and is composed by `readCovenantAttach`, not here.
    if (s.associate || s.threshold === undefined || !s.test) return null;
    const frequency = s.frequency ?? WIRED_FREQUENCY;
    return {
      id: `covenant.add:${spec.label}:${seq}`,
      group: "covenants",
      op: "add",
      kind: "New covenant",
      badge: `${s.test} on ${title}`,
      title: s.test,
      target: title,
      before: "not on the facility, which does not exist yet",
      after: `${thresholdSaid(s.threshold, s.unit)}, tested ${frequency.toLowerCase()}`,
      member: spec.label,
      map: [
        ["Object", "LLC_BI__Covenant2__c"],
        ["Attached to", `${title}, which this same plan files on the new package version`],
        [
          "Written as",
          "The covenant is created Pending and Active on the borrower and junctioned to the facility this plan creates. " +
            "The org resolves the label to the loan it has just written, so the junction lands on the new facility and on nothing else.",
        ],
      ],
      fields: ["LLC_BI__Covenant_Type__c", "LLC_BI__Financial_Indicator_Value__c"],
      fileable: true,
      covenantWire: {
        typeName: s.test,
        threshold: s.threshold,
        operator: ">=",
        frequency,
        facilityId: spec.label,
      },
      filed: {
        recordId: "assigned by the org on execution",
        verification: `The covenant and its junction are re-read on ${title} after the write.`,
      },
    };
  }

  if (draft.surface === "involvement") {
    if (!s.party || !s.role) return null;
    return {
      id: `party.add:${spec.label}:${seq}`,
      group: "structure",
      op: "add",
      kind: "New involvement",
      badge: `${s.party} on ${title}`,
      title: s.party,
      target: title,
      before: "not on the facility, which does not exist yet",
      after: `${s.role} ${onIt}`,
      member: spec.label,
      map: [
        ["Object", "LLC_BI__Legal_Entities__c"],
        ["Role", s.role],
        [
          "Written as",
          "A borrowing-structure row authored on the facility this plan creates, beside the borrower row the facility is filed with.",
        ],
      ],
      fields: ["LLC_BI__Account__c", "LLC_BI__Borrower_Type__c"],
      fileable: true,
      involvementWire: { op: "add", role: s.role, accountName: s.party, facilityId: spec.label },
      filed: {
        recordId: "assigned by the org on execution",
        verification: `The involvement is re-read on ${title} after the write.`,
      },
    };
  }

  // Collateral. Both shapes: an asset the borrower already owns, and one this
  // plan authors first. The BOOK's own label wins where the asset is on it:
  // `Name` on a collateral is an autonumber, so the description is the only
  // readable identity the asset carries.
  const onBook = s.assetId ? ctx.book.assets.find((a) => a.id === s.assetId) : undefined;
  const label = onBook?.label ?? s.assetLabel ?? s.assetDescription ?? "the asset";
  const said = assetPhrase(label);
  if (!s.assetId && !s.isNew) return null;
  if (s.isNew && (!s.assetDescription || !s.assetKind || s.assetValue === undefined || s.advanceRate === undefined)) {
    return null;
  }
  return {
    id: `collateral.pledge:${spec.label}:${seq}`,
    group: "security",
    op: "add",
    kind: "New pledge",
    kindTone: "collateral",
    badge: `${said} to ${title}`,
    title: said,
    target: title,
    before: "not pledged to the facility, which does not exist yet",
    after: `pledged ${onIt}${s.lien ? `, ${s.lien} position` : ""}`,
    member: spec.label,
    map: [
      ["Object", "LLC_BI__Loan_Collateral2__c"],
      ["Asset", s.isNew ? `${s.assetDescription} (authored by this plan)` : said],
      [
        "Written as",
        s.isNew
          ? "The asset, then the borrower's ownership junction, then the pledge onto the facility this plan creates. The asset is a permanent relationship record and survives whatever the bank decides about this version."
          : "A pledge onto the facility this plan creates. The asset and the borrower's ownership of it are relationship records and are not touched.",
      ],
    ],
    fields: ["LLC_BI__Collateral__c", "LLC_BI__Loan__c"],
    fileable: true,
    pledgeWire: {
      ...(s.assetId ? { collateralId: s.assetId } : {}),
      ...(s.isNew
        ? { newCollateral: { description: s.assetDescription!, collateralType: s.assetKind!, value: s.assetValue! } }
        : {}),
      ...(s.advanceRate !== undefined ? { advanceRate: s.advanceRate } : {}),
      facilityId: spec.label,
    },
    filed: {
      recordId: "assigned by the org on execution",
      verification: `The pledge is re-read on ${title} after the write, with the advance rate the org resolved.`,
    },
  };
}

/** The org's own fee-type value for each kind the fee lane settles, mirrored
 *  from `parseModify.ts`'s FEE_TYPE_MAP. This org's picklist is residential, so
 *  the C&I fees it cannot express file as "Other" with the banker's own words in
 *  the description, where `Name` on a fee is an autonumber. */
const FEE_TYPE: Record<string, { typeName: string; recordType: "Fees" | "Costs" }> = {
  "Origination fee": { typeName: "Loan Origination", recordType: "Fees" },
  "Attorney fee": { typeName: "Attorney", recordType: "Fees" },
  "Appraisal fee": { typeName: "Appraisal", recordType: "Costs" },
  "Commitment fee": { typeName: "Other", recordType: "Fees" },
  "Amendment fee": { typeName: "Other", recordType: "Fees" },
  "Agency fee": { typeName: "Other", recordType: "Fees" },
};

/** ONE NET-NEW FEE, on a facility this plan is creating. */
export function newFacilityFeeEntry(open: FeeOpen, spec: NewFacilitySpec, seq: number): WorkroomDelta | null {
  if (open.percentage === undefined && open.amount === undefined) return null;
  const kind = open.kind ?? "Origination fee";
  const mapped = FEE_TYPE[kind] ?? { typeName: "Other", recordType: "Fees" as const };
  const title = newFacilityTitle(spec);
  const figure = open.percentage !== undefined ? `${open.percentage.toFixed(2)}% of the committed amount` : money(open.amount!);
  return {
    id: `fee.add:${spec.label}:${seq}`,
    group: "terms",
    op: "add",
    kind: "New fee",
    badge: `${kind} on ${title}`,
    title: kind,
    target: title,
    before: "not charged on the facility, which does not exist yet",
    after: figure,
    member: spec.label,
    map: [
      ["Object", "LLC_BI__Fee__c"],
      ["Fee type", mapped.typeName],
      [
        "Written as",
        open.percentage !== undefined
          ? "A percentage fee carrying its rate and no money figure: Salesforce's own FeeTrigger derives the amount from the facility's commitment, and a hand-set figure would be a number nobody derived."
          : "A flat fee on the facility this plan creates.",
      ],
    ],
    fields: ["LLC_BI__Fee_Type__c", "LLC_BI__Calculation_Type__c"],
    fileable: true,
    feeWire: {
      feeType: mapped.typeName,
      description: `${kind} - ${figure}`,
      calculationType: open.percentage !== undefined ? "Percentage" : "Flat Amount",
      ...(open.percentage !== undefined ? { percentage: open.percentage } : { amount: open.amount }),
      recordType: mapped.recordType,
      facilityId: spec.label,
    },
    filed: {
      recordId: "assigned by the org on execution",
      verification: `The fee is re-read on ${title} after the write, with whatever the org computed for a percentage.`,
    },
  };
}
