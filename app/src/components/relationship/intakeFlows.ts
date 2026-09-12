import type { Collateral, Covenant } from "../../data/contract";
import { fmtMoney } from "../../data/format";
import { stageRationale } from "../../actions/registry";
import { observedOptions } from "../../actions/observedPicklists";
import { orgAccepted, orgValues } from "../../channel/catalog";
import type { StagePayloads } from "../../channel/writeTools";
import { collateralAssets, shortAssetTitle, type CollateralAsset } from "../../domain/collateralAssets";
import { ASSET_KIND_OPTIONS, FILEABLE_COVENANT_TYPES, clipTitle } from "../workroom/elicit";
import { FACILITY_HANDOFF } from "./relRoute";
import type { IconKind } from "../workroom/TypeIcon";
import {
  answered,
  asOptions,
  num,
  perRecord,
  text,
  type Answers,
  type RelStep,
  type StepOption,
} from "./relStep";
import type { PayloadResult, RelContext } from "./reviewFlows";

/* =============================================================================
   INTAKE - PUTTING A COVENANT OR AN ASSET ONTO THE RELATIONSHIP.

   THE SIXTH ROUTE, AND THE ONLY ONE THAT CREATES. The other five act on records
   the org already holds: they assess a covenant, they value an asset, they file
   a review, they raise a case. This one AUTHORS. A covenant the credit agreement
   struck and Salesforce has never seen, and an asset the borrower owns that no
   facility is secured by yet, both anchored on the RELATIONSHIP and neither one
   touching a facility.

   TWO FLOWS, ONE ROUTE, BECAUSE THEY ARE THE SAME GESTURE. "The approved terms
   carry a new test" and "the borrower bought a building" are both a banker
   putting something on the book that is not there yet. They share the tool, the
   plan, the token and the trail; what differs is which half of the wire they
   fill.

   WHAT THIS IS NOT. It is not a pledge and it is not a lien. An asset filed here
   is OWNED and unencumbered: the ownership junction is written and no
   LLC_BI__Loan_Collateral2__c row is. Securing a facility with it is a facility
   action and this room says so by name rather than half doing it. Nor is it a
   covenant amendment: every junction field is non-updateable, so getting a
   covenant right at creation is the whole game, which is why this flow asks for
   the operator and the threshold rather than guessing either.

   ONLY ASK FOR WHAT THE HUMAN OWNS (CREATE-GRAMMAR spec). The bank decides the
   test, the direction, the threshold, the schedule, the effective date, which
   asset, what it is worth and on what basis. The ORG computes the advance rate,
   the lendable value, the compliance schedule and every autonumber, and this
   flow never asks for one of those and never sends one.

   THE CHIPS COME FROM THE ORG. Covenant types and collateral types are read off
   `Customer360Catalog`, live, once per view. The two picklists the catalog does
   not carry (the covenant frequency, the valuation basis and source) come from
   the observed describes the rest of the room already stands on, and where this
   file holds a mirror it says so in the comment above it.
   ============================================================================= */

/** The two flows this route runs. Chosen once, at the top, and never swapped
 *  underneath a collected draft: a covenant and an asset share no answer. */
export type IntakeKind = "covenant" | "collateral";

/** The room's own word for each flow. */
export const INTAKE_KIND_WORD: Record<IntakeKind, string> = {
  covenant: "covenant intake",
  collateral: "collateral intake",
};

/** THE TOOL'S OWN CAP, per side. Ten covenants and ten assets in one plan. It
 *  is a governor budget, not a preference, and the room says so. */
export const INTAKE_CAP = 10;

/** The refusal when a banker asks for an eleventh. */
export const INTAKE_CAP_REFUSAL = `The tool files at most ${INTAKE_CAP} in one plan. That is a governor budget, not a preference: file these ${INTAKE_CAP} and open a second intake for the rest.`;

/** SAID OUT LOUD, EVERY TIME, ON THE COLLATERAL FLOW. An asset filed here is
 *  owned and unpledged, and a banker who expected coverage to move has to hear
 *  that from the room rather than discover it on the exposure tab. */
export const NO_PLEDGE_NO_LIEN =
  "This files the asset and the borrower's ownership of it, and nothing else. No pledge, no lien position, no advance rate and no coverage: pledging an asset to a facility is a facility action and it runs in Facility Actions on this relationship.";

/** The effective date is set once and is never updated afterwards. */
export const EFFECTIVE_DATE_IS_FINAL =
  "The effective date is set once at creation and never updated: it is what the whole compliance schedule is counted from.";

/** What the org works out, so the room does not ask and does not claim. */
export const ORG_DERIVES =
  "The compliance schedule, the advance rate, the lendable value and every record name are the org's own arithmetic. I file what the credit agreement decided; Salesforce works out the rest.";

/* --------------------------------------------------------------- the wire */

export interface IntakeCovenantWire {
  covenantTypeName: string;
  operator: string;
  threshold: number;
  frequency: string;
  effectiveDate: string;
  nextEvaluationDate?: string | null;
  notes?: string | null;
}

export interface IntakeAddress {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface IntakeCollateralWire {
  collateralType: string;
  description: string;
  value: number;
  valuationBasis?: string | null;
  valuationSource?: string | null;
  valuationDate?: string | null;
  address?: IntakeAddress | null;
  ownerAccountId?: string | null;
}

/**
 * THE FIVE OPERATORS THE ORG HOLDS on `Acnpex_Operator__c` ("Actual Must Be"),
 * read off the live describe 2026-09-03 and byte-identical to this list.
 *
 * The tool ALSO maps each onto `Financial_Indicator_Operator__c`, whose own five
 * values are worded ("Equals", "Greater Than", "Less Than", "Greater Tan or
 * Equal To", "Less Than or Equal To" - the misspelling is the org's). The room
 * never composes that second value: it sends the symbol and the mapping is the
 * tool's, because a client guessing at a label with a typo in it would file a
 * refusal.
 */
export const INTAKE_OPERATORS = ["<", "<=", "=", ">=", ">"] as const;
export type IntakeOperator = (typeof INTAKE_OPERATORS)[number];

/** How each operator reads in banker language, for the chip and the read-back. */
export const OPERATOR_WORD: Record<string, string> = {
  "<": "must stay below",
  "<=": "must not exceed",
  "=": "must equal",
  ">=": "must be at least",
  ">": "must stay above",
};

/* ------------------------------------------------------ the org's own sets */

const VALUATION_BASIS = observedOptions("LLC_BI__Collateral_Valuation__c", "LLC_BI__Type__c");
const VALUATION_SOURCE = observedOptions("LLC_BI__Collateral_Valuation__c", "LLC_BI__Source__c");

/**
 * THE COVENANT FREQUENCIES, AND THIS IS A MIRROR THAT SAYS SO.
 *
 * `Customer360Catalog` carries eleven entries and `LLC_BI__Frequency__c` is not
 * one of them, so there is no live read for this set in the room. The seven
 * below are the field's own describe, read off this org on 2026-09-03
 * (`LLC_BI__Covenant2__c.LLC_BI__Frequency__c`, active values, in the org's own
 * order). Verified is not the same as live: this drifts silently if the picklist
 * moves, and the fix is a twelfth catalog entry rather than a longer list here.
 *
 * WHAT THE RELATIONSHIP ALREADY RUNS COMES FIRST regardless. A relationship that
 * tests quarterly is almost certainly adding a quarterly test.
 */
const FREQUENCY_MIRROR = ["Annually", "Semi-Annually", "Quarterly", "Every 2 Months", "Monthly", "One-Off", "Custom"];

/** How many org names go on the glass at once. The org holds 71 covenant types
 *  and a chip set of 71 is a list, not a question. */
const CHIP_CAP = 10;

/* ------------------------------------------------- the covenant type, resolved

   THE ORG RESOLVES THE NAME, and this room's only job is to hand it one it will
   recognise. The tool takes `covenantTypeName` and matches it against
   `LLC_BI__Covenant_Type__c.Name`, so a near miss is a refusal rather than a
   near-miss record. The chips are therefore the org's OWN names, book-first,
   and a typed line is accepted only where it lands on one of them exactly.

   THIS IS DELIBERATELY NOT THE FACILITY ROOM'S FILTER. `elicit.ts` narrows the
   catalog to the nine names its own parser can settle from a sentence, because
   that path resolves a TYPE ID client-side. Here the org does the resolving, so
   narrowing to nine would hide 62 types the tool would have accepted. */

/**
 * Every covenant type name this relationship can file: the ORG's own list where
 * the catalog read carries one, and the shell's mirror where it does not.
 *
 * THE MIRROR IS NOT AN INVENTION, it is the one `elicit.ts` has stood on since
 * the facility room shipped, and `assetTypeUniverse` reads its collateral twin
 * the same way. Reading the org only left a null catalog refusing EVERY typed
 * name with an empty chip set under it, which is the channel-none doctrine
 * applied backwards: with no connector the room asks the banker to write the
 * name, it does not refuse the name they write.
 */
export function covenantTypeNames(ctx: RelContext): string[] {
  const live = orgValues(ctx.catalog, "covenantType");
  return live.length ? [...new Set(live)] : [...FILEABLE_COVENANT_TYPES];
}

/** The types this relationship already tests, in the order the book carries
 *  them. These lead the chip set: a proposal mirrored from the book is grounded
 *  in what the bank already decided about this borrower. */
export function bookCovenantTypes(ctx: RelContext): string[] {
  const held = (ctx.bundle?.covenants?.covenants ?? [])
    .map((c: Covenant) => (c.covenantType ?? "").trim())
    .filter(Boolean);
  return [...new Set(held)];
}

/** An org name a typed line names exactly, case-insensitively. Null where the
 *  line names none: the room then asks with the org's own names as chips rather
 *  than filing a type the org would refuse. */
export function resolveCovenantType(said: string, names: string[]): string | null {
  const line = said.trim().toLowerCase();
  if (!line) return null;
  const exact = names.find((n) => n.toLowerCase() === line);
  if (exact) return exact;
  /* A NAME INSIDE A SENTENCE STILL COUNTS, longest first, so "add a Minimum
     Tangible Net Worth covenant" resolves and "Net Worth" does not win over
     "Minimum Tangible Net Worth" just by being shorter. */
  const contained = names.filter((n) => line.includes(n.toLowerCase())).sort((a, b) => b.length - a.length);
  return contained[0] ?? null;
}

/** The refusal when a name lands on nothing the org holds. */
export const UNKNOWN_COVENANT_TYPE = (said: string): string =>
  `The org holds no covenant type called ${said.trim()}. The type name is the org's own record and the tool matches it exactly, so pick one below or give me the name as the bank writes it.`;

/* ---------------------------------------------- the collateral type, resolved

   FAMILIES FIRST (E6). This org holds eleven Real Estate types and six
   families. Offering eleven of one family and none of the others is a chip set
   answering a different question, so the FAMILY leads and the exact name is the
   second beat, which is the same two moves the org's own refusal walks a banker
   through. */

/** The family a type name belongs to: everything in front of the qualifier the
 *  org hangs off it. "Real Estate-Warehouse" is Real Estate's. */
export function familyRoot(value: string): string {
  const cut = value.search(/[-/]/);
  const root = cut > 0 ? value.slice(0, cut) : value;
  return root.trim() || value;
}

/** Every collateral type the write path accepts. `acceptedValues`, never
 *  `values`: a type whose own advance rate is null is refused by the org's
 *  Advance_Rate_should_not_be_null rule on the insert, and a chip that ends in
 *  a refusal is worse than no chip. */
export function collateralTypeNames(ctx: RelContext): string[] {
  /* AND THE MIRROR BEHIND IT, exactly as `assetTypeUniverse` reads it. An empty
     catalog used to leave `colPick` with no chips at all, so every typed type
     was refused with nothing under the refusal to pick. */
  const live = orgAccepted(ctx.catalog, "collateralType");
  return live.length ? [...new Set(live)] : [...ASSET_KIND_OPTIONS];
}

/** The families this relationship already holds, so they lead the chip set. */
function heldFamilies(ctx: RelContext): Set<string> {
  const out = new Set<string>();
  for (const f of ctx.bundle?.exposure?.facilities ?? []) {
    for (const c of f.collateral ?? []) {
      const root = familyRoot((c as Collateral).collateralType ?? "").toLowerCase();
      if (root) out.add(root);
    }
  }
  return out;
}

/** An org collateral type a typed line names exactly. Same rule as the covenant
 *  type: the org matches the name, so the room offers the org's names. */
export function resolveCollateralType(said: string, names: string[]): string | null {
  return resolveCovenantType(said, names);
}

export const UNKNOWN_COLLATERAL_TYPE = (said: string): string =>
  `The org's collateral catalog holds nothing called ${said.trim()}, or holds it with no advance rate, which its own validation refuses on the insert. Pick a type below.`;

/* ------------------------------------------------------------ reading a line

   FREE TEXT ALWAYS WINS. A banker who types the whole thing skips the
   questions, which is rule 3 of the create grammar and the reason the intent
   route can hand this flow a single line and have it land. Everything the read
   cannot settle is still ASKED; nothing is guessed and nothing is dropped in
   silence. */

/** "tested annually", "quarterly", "every month". */
const FREQUENCY_WORDS: Array<{ match: RegExp; word: string }> = [
  { match: /\bquarterly|each quarter|every quarter\b/i, word: "Quarterly" },
  { match: /\bmonthly|each month|every month\b/i, word: "Monthly" },
  { match: /\bsemi[- ]?annual(?:ly)?\b|\bhalf[- ]?yearly\b/i, word: "Semi-Annually" },
  { match: /\bannual(?:ly)?\b|\byearly\b|\beach year\b|\bevery year\b/i, word: "Annually" },
  { match: /\bone[- ]?off\b|\bonce\b/i, word: "One-Off" },
];

export function readFrequency(said: string): string | null {
  for (const f of FREQUENCY_WORDS) if (f.match.test(said)) return f.word;
  return null;
}

/** The operator a line writes, in symbols or in words. */
const OPERATOR_WORDS: Array<{ match: RegExp; op: IntakeOperator }> = [
  { match: />=|=>|\bat least\b|\bno less than\b|\bnot less than\b|\bminimum of\b|\bmin(?:imum)? +of\b/i, op: ">=" },
  { match: /<=|=<|\bno more than\b|\bnot more than\b|\bat most\b|\bmaximum of\b|\bmax(?:imum)? +of\b/i, op: "<=" },
  { match: /(?<![<>])>(?!=)|\bgreater than\b|\babove\b|\bstrictly above\b/i, op: ">" },
  { match: /(?<![<>])<(?!=)|\bless than\b|\bbelow\b|\bstrictly below\b/i, op: "<" },
  { match: /\bexactly\b|\bequal to\b/i, op: "=" },
];

export function readOperator(said: string): IntakeOperator | null {
  for (const o of OPERATOR_WORDS) if (o.match.test(said)) return o.op;
  return null;
}

/**
 * A FIGURE THE OPENING LINE ACTUALLY STATED, or null.
 *
 * `readAmount` alone is too eager for a SEED. "add collateral: two Haas VF-4SS
 * machining centres" carries a 4 inside a model number, and reading it as the
 * asset's value files a forklift fleet worth four dollars. A seed figure has to
 * LOOK like a figure: a currency mark, a thousands separator, a scale suffix, a
 * ratio's x, a decimal, or a phrase that says this is the value. Inside an
 * answer to the room's own question the eager read is right, because the
 * question asked for a number and nothing else.
 */
export function readSeedAmount(said: string): number | null {
  const stated =
    /[$£€]\s*\d/.test(said) ||
    /\d[\d,]*\.\d/.test(said) ||
    /\d{1,3}(,\d{3})+/.test(said) ||
    /\d\s*(mm|m|k|bn|b|million|billion|thousand)\b/i.test(said) ||
    /\dx\b/i.test(said) ||
    /\b(valued at|value of|worth|priced at|of)\s+\$?\d/i.test(said);
  return stated ? readAmount(said) : null;
}

/** A figure a banker wrote, with the shorthand a banker actually types:
 *  `12M`, `$12.5MM`, `1.25x`, `80%`, `12,000,000`. Null where the line carries
 *  no number at all, which is not a failure: the question then still stands. */
export function readAmount(said: string): number | null {
  const m = said.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const base = Number(m[0].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  /* THE UNIT IS READ OFF THE TAIL rather than inside the number's own match.
     A word boundary after the optional suffix defeats "1.25x": there is no
     boundary between the 5 and the x, so the whole match backtracks to "1" and
     a 1.25x covenant files at 1. The tail is looked at separately, so a ratio
     keeps its decimals and "12M" and "5 million" both scale. */
  const tail = said.slice((m.index ?? 0) + m[0].length);
  const unit = tail.match(/^\s*(mm|million|m|bn|billion|b|k|thousand)\b/i);
  const suffix = (unit?.[1] ?? "").toLowerCase();
  if (suffix === "k" || suffix === "thousand") return base * 1_000;
  if (suffix === "m" || suffix === "mm" || suffix === "million") return base * 1_000_000;
  if (suffix === "b" || suffix === "bn" || suffix === "billion") return base * 1_000_000_000;
  return base;
}

/** A YYYY-MM-DD a banker typed. The room never reaches a clock, so a date the
 *  banker did not write is one the room computed from `meta.generatedAt`. */
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

export function readDate(said: string): string | null {
  const m = said.match(ISO_DATE);
  return m ? m[1] : null;
}

/**
 * THE DIRECTION THE BANK'S OWN FAMILIES RUN IN, or null.
 *
 * Doctrine 4.2 and 4.3 name the two: a coverage, liquidity or net-worth test is
 * a FLOOR and a leverage or debt test is a CEILING. Where the family is one of
 * those the room proposes the operator and says it is proposing; where it is
 * not, the room asks, because inventing the direction of a covenant is inventing
 * the covenant.
 */
export function inferOperator(typeName: string): IntakeOperator | null {
  const t = typeName.toLowerCase();
  if (/\b(debt to worth|debt[- ]to[- ]equity|debt to equity|leverage|debt\/|capex|capital expenditure)\b/.test(t)) {
    return "<=";
  }
  if (/\bdebt\b/.test(t) && !/\bservice\b/.test(t) && !/\bcoverage\b/.test(t)) return "<=";
  if (/\b(coverage|liquidity|net worth|current ratio|quick ratio|ebitda|net profit|tangible)\b/.test(t)) return ">=";
  return null;
}

/** Why the room proposed that direction, said out loud on the question. */
export const DIRECTION_IS_A_PROPOSAL =
  "That direction is the bank's own family convention, offered as a proposal. The approved credit agreement is the authority and I will file whichever way you say.";

/* --------------------------------------------------------------- the dates */

/** The 1st of the month after `asOf`, which is the date most covenants in this
 *  book actually run from. Computed from `meta.generatedAt` and never a clock. */
export function firstOfNextMonth(asOf: string | null): string | null {
  const m = (asOf ?? "").match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** The day the artifact was generated on, as a plain date. */
export function today(asOf: string | null): string | null {
  const m = (asOf ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** The chip a banker picks to write a date the two offers do not cover. */
export const OTHER_DATE = "__other_date__";

/* ------------------------------------------------------------ the address */

/** THE ADDRESS IS ONE QUESTION, not four. A banker writes an address the way an
 *  address is written, so the room reads it that way and shows what it read
 *  back rather than marching through four boxes. */
export function readAddress(said: string): IntakeAddress | null {
  const line = said.trim();
  if (!line) return null;
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: IntakeAddress = {};
  /* THE LAST PART CARRIES THE STATE AND THE POSTCODE where it is written the
     way this country writes them: "IN 46802". Where it is not, the part is a
     state on its own or a postcode on its own, and each is taken as what it
     looks like rather than positionally. */
  const tail = parts[parts.length - 1];
  const stateZip = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (stateZip) {
    out.state = stateZip[1].toUpperCase();
    out.zip = stateZip[2];
    parts.pop();
  } else if (/^\d{5}(-\d{4})?$/.test(tail)) {
    out.zip = tail;
    parts.pop();
    const nextTail = parts[parts.length - 1];
    if (nextTail && /^[A-Za-z]{2}$/.test(nextTail)) {
      out.state = nextTail.toUpperCase();
      parts.pop();
    }
  } else if (/^[A-Za-z]{2}$/.test(tail)) {
    out.state = tail.toUpperCase();
    parts.pop();
  }
  if (parts.length) out.street = parts.shift() ?? null;
  if (parts.length) out.city = parts.join(", ");
  return out.street || out.city || out.state || out.zip ? out : null;
}

/** The address as one line, for the read-back. */
export function addressLine(a: IntakeAddress | null | undefined): string | null {
  if (!a) return null;
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street, a.city, stateZip].filter(Boolean).join(", ") || null;
}

/* ============================================================== THE DRAFTS

   WHAT THE ROOM IS HOLDING, read back out of the answer map. One object per
   covenant and one per asset, each complete or not, because the read-back, the
   lane, the payload and the plan all have to be looking at the same thing. A
   second reader over the same answers is how a card and a wire come to
   disagree. */

export interface CovenantDraft {
  index: number;
  typeName: string | null;
  operator: IntakeOperator | null;
  threshold: number | null;
  frequency: string | null;
  effectiveDate: string | null;
  notes: string | null;
  /** The org already carries a covenant of this type on this relationship. */
  alreadyHeld: boolean;
}

export interface CollateralDraft {
  index: number;
  collateralType: string | null;
  description: string | null;
  value: number | null;
  valuationBasis: string | null;
  valuationSource: string | null;
  valuationDate: string | null;
  address: IntakeAddress | null;
  ownerAccountId: string | null;
  ownerName: string | null;
}

const at = (a: Answers, group: string, i: number): unknown => perRecord(a, group)[String(i)];
const has = (a: Answers, group: string, i: number): boolean => answered(perRecord(a, group), String(i));

/**
 * WHICH FLOW THIS INTAKE IS, out of whatever the banker first said.
 *
 * The route can be bound by a chip ("Covenants") or by a whole sentence ("add a
 * relationship covenant: minimum tangible net worth of 12M tested annually"),
 * and both land in the same answer. Null where the line named neither, and the
 * machine then asks with two chips, which terminates.
 */
export function intakeKindOf(a: Answers): IntakeKind | null {
  const said = text(a.intakeKindPick) ?? text(a.intakeKind);
  if (!said) return null;
  const line = said.toLowerCase();
  if (/\bcovenant|\btest\b|\bratio\b|\bdscr\b|\bfccr\b/.test(line)) return "covenant";
  if (/\bcollateral|\basset|\bsecurity\b|\bequipment\b|\bproperty\b|\breal estate\b|\binventory\b|\breceivable/.test(line)) {
    return "collateral";
  }
  return null;
}

/** WHAT THE OPENING LINE ALREADY SETTLED, so the room does not ask for it again.
 *  Only ever read for the FIRST entry: a banker's opening sentence is about the
 *  first thing they are filing, and carrying it onto the second would be the
 *  room filling in an answer nobody gave. */
/** The words the disambiguation itself is made of. A line that is only these is
 *  the banker choosing WHICH of the two, and says nothing about the thing. */
const KIND_WORDS = /\b(an?|the|is|it|its|this|new|please|file|add|put|create|record|register)\b|\b(covenants?|tests?|ratios?|collateral|securit(?:y|ies)|assets?)\b/gi;

function seedLine(a: Answers): string {
  const said = text(a.intakeKind) ?? "";
  /* A CHIP LABEL IS NOT A SENTENCE. "covenant" and "collateral" are what the two
     chips write, and reading a description or a threshold out of one is the room
     inventing an answer nobody gave.
     AND NEITHER IS THE DISAMBIGUATION SAID IN WORDS. "an asset" carries a space,
     so it used to count as the banker's opening sentence: `collateralDrafts`
     read the asset's DESCRIPTION out of it and filed the record under the words
     "an asset", which is the only readable identity a collateral row carries,
     then suppressed "How is the asset described?" and asked "What is an asset
     worth?". A line seeds only where something survives the kind words. */
  if (!/\s/.test(said)) return "";
  const rest = said.replace(KIND_WORDS, " ").replace(/[^a-z0-9]+/gi, " ").trim();
  return rest ? said : "";
}

export function covenantDrafts(ctx: RelContext, a: Answers): CovenantDraft[] {
  const names = covenantTypeNames(ctx);
  const held = new Set(bookCovenantTypes(ctx).map((t) => t.toLowerCase()));
  const out: CovenantDraft[] = [];
  for (let i = 0; i < INTAKE_CAP; i++) {
    const seed = i === 0 ? seedLine(a) : "";
    const saidType = text(at(a, "covPick", i)) ?? text(at(a, "covTest", i));
    const typeName = saidType ? resolveCovenantType(saidType, names) : resolveCovenantType(seed, names);
    if (!typeName && !has(a, "covTest", i)) break;

    const terms = text(at(a, "covTerms", i)) ?? "";
    const inferred = typeName ? inferOperator(typeName) : null;
    const operator =
      (text(at(a, "covOperator", i)) as IntakeOperator | null) ??
      readOperator(terms) ??
      readOperator(seed) ??
      inferred;
    const threshold =
      num(at(a, "covThreshold", i)) ?? readAmount(terms) ?? (i === 0 ? readSeedAmount(stripDates(seed)) : null);
    const frequency = text(at(a, "covFrequency", i)) ?? readFrequency(terms) ?? (i === 0 ? readFrequency(seed) : null);

    /* A DATE ANSWER IS A DATE. The chips write one; free text is read for one
       and anything that is not one leaves the slot empty, so a covenant is never
       filed with a sentence where its schedule anchor should be. */
    const picked = text(at(a, "covEffective", i));
    const effectiveDate =
      readDate(text(at(a, "covEffectiveOther", i)) ?? "") ??
      (picked && picked !== OTHER_DATE ? readDate(picked) : null) ??
      (i === 0 ? readDate(seed) : null);

    out.push({
      index: i,
      typeName,
      operator: operator ?? null,
      threshold,
      frequency,
      effectiveDate,
      notes: text(at(a, "covNotes", i)),
      alreadyHeld: Boolean(typeName && held.has(typeName.toLowerCase())),
    });
    if (text(at(a, "covMore", i)) !== "more") break;
  }
  return out;
}

/** A DATE IS NOT A THRESHOLD. "effective 2026-10-01" carries a four digit year
 *  that `readAmount` would otherwise take for the figure, and a covenant filed
 *  at a threshold of 2026 is a governance record nobody could read. */
function stripDates(said: string): string {
  return said.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
}

export function collateralDrafts(ctx: RelContext, a: Answers): CollateralDraft[] {
  const names = collateralTypeNames(ctx);
  const owners = ownerOptions(ctx);
  const out: CollateralDraft[] = [];
  for (let i = 0; i < INTAKE_CAP; i++) {
    const seed = i === 0 ? seedLine(a) : "";
    const saidType = text(at(a, "colPick", i)) ?? text(at(a, "colType", i));
    const collateralType = saidType ? resolveCollateralType(saidType, names) : resolveCollateralType(seed, names);
    if (!collateralType && !has(a, "colType", i)) break;

    const ownerId = text(at(a, "colOwner", i)) ?? ctx.accountId;
    const picked = text(at(a, "colValuationDate", i));
    out.push({
      index: i,
      collateralType,
      description: text(at(a, "colDescription", i)) ?? (i === 0 ? readDescription(seed) : null),
      value: num(at(a, "colValue", i)) ?? (i === 0 ? readSeedAmount(stripDates(seed)) : null),
      valuationBasis: text(at(a, "colBasis", i)),
      valuationSource: text(at(a, "colSource", i)),
      valuationDate:
        readDate(text(at(a, "colValuationOther", i)) ?? "") ??
        (picked && picked !== OTHER_DATE ? readDate(picked) : null),
      address: readAddress(text(at(a, "colAddress", i)) ?? ""),
      ownerAccountId: ownerId,
      ownerName: owners.find((o) => o.value === ownerId)?.label ?? ctx.accountName,
    });
    if (text(at(a, "colMore", i)) !== "more") break;
  }
  return out;
}

/** The asset's own description out of an opening line: everything after the
 *  colon and before the type or the value, which is how the intent route writes
 *  it ("add collateral: forklift fleet, Equipment, valued at 250,000"). */
function readDescription(said: string): string | null {
  const afterColon = said.includes(":") ? said.slice(said.indexOf(":") + 1) : said;
  const first = afterColon.split(",")[0]?.trim() ?? "";
  const cleaned = first.replace(/^\s*(?:add|create|file|register|record)\s+(?:a|an|the)?\s*/i, "").trim();
  return cleaned || null;
}

/* ---------------------------------------------------------- the owner chips

   THE ASSET IS OWNED BY SOMEBODY, and the ownership junction is what anchors it
   to an account. The relationship is the default and is almost always right;
   the other parties on the book are offered where the read carries an account
   id for them, and NAMED AND DISABLED where it carries only a name. A junction
   cannot be anchored on a name. */
export function ownerOptions(ctx: RelContext): StepOption[] {
  const out: StepOption[] = [
    { label: ctx.accountName, value: ctx.accountId, detail: "the relationship this room is standing on" },
  ];
  for (const c of ctx.bundle?.graph?.connections ?? []) {
    const id = (c.counterpartyId ?? "").trim();
    const name = (c.counterpartyName ?? "").trim();
    if (!name || out.some((o) => o.value === id || o.label === name)) continue;
    if (id) {
      out.push({ label: name, value: id, detail: c.role ? `${c.role} on this relationship` : "on this relationship" });
    } else {
      out.push({
        label: name,
        value: name,
        disabled: true,
        reason: "The read carries this party by name and no account id, so the ownership junction cannot be anchored on it from here.",
      });
    }
  }
  for (const e of ctx.bundle?.graph?.legalEntities ?? []) {
    const name = (e.accountName ?? "").trim();
    if (!name || out.some((o) => o.label === name)) continue;
    out.push({
      label: name,
      value: name,
      disabled: true,
      reason: "The legal-entity read carries this party by name and no account id, so the ownership junction cannot be anchored on it from here.",
    });
  }
  return out;
}

/* ============================================================ THE MACHINE

   ONE QUESTION AT A TIME, DERIVED FROM WHAT HAS BEEN ANSWERED. Null is the
   readiness test and it is the only one, exactly as the five reviews do it. The
   loops terminate by construction: every follow-up question is a CLOSED set, and
   `covMore` / `colMore` answered with anything but "more" ends the walk. */

/**
 * WHERE THE LOOP IS STANDING.
 *
 * `covenantDrafts` and `collateralDrafts` return one entry per thing STARTED, so
 * the last of them is the entry being answered unless the banker has already
 * said "another one" on it, in which case the next entry is open and empty. A
 * machine that read the last draft either way would ask the last entry's
 * questions again and the loop would never advance past the first thing filed.
 */
function cursorOf<T extends { index: number }>(
  drafts: T[],
  a: Answers,
  moreGroup: string,
): { index: number; draft: T | null } {
  const last = drafts[drafts.length - 1] ?? null;
  if (!last) return { index: 0, draft: null };
  const opened = text(at(a, moreGroup, last.index)) === "more";
  return opened ? { index: last.index + 1, draft: null } : { index: last.index, draft: last };
}

export function intakeStep(ctx: RelContext, a: Answers): RelStep | null {
  const kind = intakeKindOf(a);
  if (!answered(a, "intakeKind")) {
    return {
      key: "intakeKind",
      ask: "Are we putting a covenant on this relationship, or an asset?",
      kind: "text",
      options: [
        { label: "A covenant", value: "covenant", detail: "A test the credit agreement struck and Salesforce has not seen." },
        { label: "An asset", value: "collateral", detail: "Something the borrower owns. Filed unpledged: no facility is secured by it." },
      ],
      placeholder: "Name it, or say the whole thing and I will read it back.",
    };
  }
  /* THE DISAMBIGUATION IS ASKED ONCE. Its two chips are the only answers a
     banker can give it, so a second unreadable answer can only come from the
     step counter's own probe walk, which answers every step with the skip
     sentinel to count what is still to come. Returning null there is what makes
     that walk terminate; `buildIntakePayload` still refuses a plan that does not
     know which of the two it is filing, so nothing can be staged on a guess. */
  if (!kind && answered(a, "intakeKindPick")) return null;
  if (!kind) {
    return {
      key: "intakeKindPick",
      ask: "I could not tell which of the two that is. A covenant, or an asset?",
      kind: "chips",
      options: [
        { label: "A covenant", value: "covenant" },
        { label: "An asset", value: "collateral" },
      ],
      placeholder: "A covenant, or an asset.",
    };
  }
  return kind === "covenant" ? covenantIntakeStep(ctx, a) : collateralIntakeStep(ctx, a);
}

/* ----------------------------------------------------------- the covenants */

/** The org's own names, what this relationship already tests first, and what is
 *  already on THIS plan named as such. The two facts are different and the chip
 *  says whichever are true rather than one standing in for the other. */
function covenantChips(ctx: RelContext, a: Answers): StepOption[] {
  const names = covenantTypeNames(ctx);
  const held = bookCovenantTypes(ctx);
  const heldSet = new Set(held.map((t) => t.toLowerCase()));
  const staged = new Set(
    covenantDrafts(ctx, a)
      .map((d) => (d.typeName ?? "").toLowerCase())
      .filter(Boolean),
  );
  const ordered = [
    ...held.filter((t) => names.some((n) => n.toLowerCase() === t.toLowerCase())),
    ...names.filter((n) => !heldSet.has(n.toLowerCase())),
  ];
  return ordered.slice(0, CHIP_CAP).map((n) => {
    const key = n.toLowerCase();
    const detail = [
      heldSet.has(key) ? "already tested on this relationship" : null,
      staged.has(key) ? "already on this plan" : null,
    ]
      .filter(Boolean)
      .join(", ");
    return { label: n, value: n, detail: detail || undefined };
  });
}

function covenantIntakeStep(ctx: RelContext, a: Answers): RelStep | null {
  const names = covenantTypeNames(ctx);
  const drafts = covenantDrafts(ctx, a);
  const { index: i, draft } = cursorOf(drafts, a, "covMore");
  /* THE CAP IS A HARD STOP, not a chip the banker could get past. The tenth
     entry's own question offers only "that is all", so this is the second gate
     rather than the only one. */
  if (i >= INTAKE_CAP) return null;

  if (!has(a, "covTest", i) && !(i === 0 && draft?.typeName)) {
    const chips = covenantChips(ctx, a);
    const more = names.length - chips.length;
    return {
      key: `covTest.${i}`,
      ask: i === 0 ? "Which test is this covenant?" : "And the next test?",
      kind: "text",
      options: chips.length ? chips : undefined,
      placeholder: chips.length
        ? more > 0
          ? `Pick one, or name any of the org's ${names.length} covenant types.`
          : "Pick one, or name the test."
        : "Name the test, exactly as the org holds it.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Covenant_Type__c" },
    };
  }

  /* A NAME THE ORG DOES NOT HOLD IS REFUSED BY NAME, AND THE QUESTION IS ASKED
     AGAIN WITH THE ORG'S OWN NAMES. The tool matches `covenantTypeName` against
     the catalog exactly, so a near miss here is a refusal at the confirm gate,
     which is a refusal the banker reads instead of a question they can answer. */
  if (!draft?.typeName) {
    /* THE PICK IS ASKED ONCE. Its chips are the org's own names and a chips step
       refuses anything else, so an answer that still does not resolve can only
       come from the step counter's probe walk. The entry then contributes
       nothing to the wire and the loop moves on rather than asking forever. */
    if (has(a, "covPick", i)) {
      return has(a, "covMore", i) ? null : morStep(`covMore.${i}`, i, "covenant", drafts.filter((d) => d.typeName).length);
    }
    const said = text(at(a, "covTest", i)) ?? "";
    return {
      key: `covPick.${i}`,
      ask: UNKNOWN_COVENANT_TYPE(said),
      kind: "chips",
      options: covenantChips(ctx, a),
      placeholder: "Pick the org's own name for it.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Covenant_Type__c" },
    };
  }

  /* THE RELATIONSHIP ALREADY CARRIES THIS TEST, AND THAT IS NAMED RATHER THAN
     STAGED BLINDLY. A second covenant of one type is a real thing a bank files
     (a stepped threshold, a different measurement basis), so the room asks
     instead of refusing, which is the collateral lane's own pattern. */
  if (draft.alreadyHeld && !has(a, "covSecond", i)) {
    return {
      key: `covSecond.${i}`,
      ask: `This relationship already carries a ${draft.typeName} covenant. Add a second one?`,
      kind: "chips",
      options: [
        { label: "Add a second", value: "second", detail: "Two covenants of one type, each with its own threshold and schedule." },
        { label: "Drop this one", value: "drop", detail: "Nothing is filed for this test." },
      ],
      placeholder: "Add a second, or drop it.",
    };
  }
  if (text(at(a, "covSecond", i)) === "drop") {
    /* THE ENTRY IS DROPPED AND THE LOOP STILL HAS TO END. The drop answers the
       "another one" question too: a banker who dropped the only covenant on the
       plan is asked whether they want a different one. */
    if (!has(a, "covMore", i)) return morStep(`covMore.${i}`, i, "covenant", 0);
    return null;
  }

  /* THE TERMS ARE ONE QUESTION, and the inferred direction does not answer it.
     The direction is a PROPOSAL the room makes on the family; the threshold is
     the banker's and comes from the approved credit agreement. A machine that
     skipped this question because it had guessed the direction would leave the
     figure to a bare number step with none of that said. */
  if (draft.threshold === null && !has(a, "covTerms", i)) {
    const inferred = inferOperator(draft.typeName);
    return {
      key: `covTerms.${i}`,
      ask: inferred
        ? `What does the ${draft.typeName} test have to hold? On the bank's own families that runs as a "${OPERATOR_WORD[inferred]}" test, so I will file ${inferred} unless you say otherwise.`
        : `What does the ${draft.typeName} test have to hold, and which way does it run? The bank's families do not settle the direction on this one, so I will not guess it.`,
      kind: "text",
      options: INTAKE_OPERATORS.map((op) => ({
        label: `${OPERATOR_WORD[op]} (${op})`,
        value: op,
        detail: inferred === op ? "the direction the bank's own family runs" : undefined,
      })),
      placeholder: "The threshold, for example 12,000,000 or >= 1.25x.",
      target: { object: "LLC_BI__Covenant2__c", field: "Acnpex_Operator__c" },
    };
  }
  if (!draft.operator && !has(a, "covOperator", i)) {
    return {
      key: `covOperator.${i}`,
      ask: `Which way does the ${draft.typeName} test run?`,
      kind: "chips",
      options: INTAKE_OPERATORS.map((op) => ({ label: `${OPERATOR_WORD[op]} (${op})`, value: op })),
      placeholder: "Pick the direction.",
      target: { object: "LLC_BI__Covenant2__c", field: "Acnpex_Operator__c" },
    };
  }
  if (draft.threshold === null && !has(a, "covThreshold", i)) {
    return {
      key: `covThreshold.${i}`,
      /* THE DIRECTION MAY STILL BE OUTSTANDING HERE. The question above asks
         for it and is asked once; a banker who answered it with nothing leaves
         the room asking for the figure without a direction to name, and the
         entry will not be filed without both. */
      ask: draft.operator
        ? `And the figure the ${draft.typeName} test ${OPERATOR_WORD[draft.operator]}?`
        : `And the figure the ${draft.typeName} test is measured against?`,
      kind: "number",
      placeholder: "The threshold, from the approved credit agreement.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Financial_Indicator_Value__c" },
    };
  }
  if (!draft.frequency && !has(a, "covFrequency", i)) {
    return {
      key: `covFrequency.${i}`,
      ask: "How often is it tested?",
      kind: "chips",
      options: frequencyChips(ctx),
      placeholder: "The schedule the agreement sets.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Frequency__c" },
    };
  }
  /* THE DATE IS ASKED TWICE AT MOST: once with the two offers, once on its own
     where neither fitted and what the banker wrote was not a date. Past that the
     entry is simply not complete, and `buildIntakePayload` refuses it by name
     rather than the room asking a third time. Every step in this machine asks
     ONCE for the same reason: a question already answered is never re-asked,
     whatever the answer parsed to, which is also what makes the step counter's
     own probe walk terminate. */
  if (!draft.effectiveDate && !has(a, "covEffectiveOther", i)) {
    if (!has(a, "covEffective", i)) {
      return {
        key: `covEffective.${i}`,
        ask: `From what date does the ${draft.typeName} test run? ${EFFECTIVE_DATE_IS_FINAL}`,
        kind: "text",
        options: dateChips(ctx),
        placeholder: "Pick one, or give me the date as YYYY-MM-DD.",
        target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Effective_Date__c" },
      };
    }
    return {
      key: `covEffectiveOther.${i}`,
      ask: "What date does it run from?",
      kind: "date",
      placeholder: "YYYY-MM-DD.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Effective_Date__c" },
    };
  }
  if (!has(a, "covNotes", i)) {
    return {
      key: `covNotes.${i}`,
      ask: "Anything for the record on this covenant?",
      kind: "text",
      optional: true,
      placeholder: "A note, or skip it.",
      target: { object: "LLC_BI__Covenant2__c", field: "LLC_BI__Notes__c" },
    };
  }
  if (!has(a, "covMore", i)) return morStep(`covMore.${i}`, i, "covenant", drafts.filter((d) => d.typeName).length);
  return null;
}

/** The org's own schedules, what this relationship already runs first. */
function frequencyChips(ctx: RelContext): StepOption[] {
  const running = [
    ...new Set(
      (ctx.bundle?.covenants?.covenants ?? [])
        .map((c: Covenant) => (c.frequency ?? "").trim())
        .filter((f): f is string => Boolean(f)),
    ),
  ];
  const rest = FREQUENCY_MIRROR.filter((f) => !running.some((r) => r.toLowerCase() === f.toLowerCase()));
  return [
    ...running.map((f) => ({ label: f, value: f, detail: "already run on this relationship" })),
    ...rest.map((f) => ({ label: f, value: f })),
  ];
}

/** Today, the 1st of next month, another date. RELATIVE labels are measured
 *  against the real clock (the banker reads the screen on the real day), never
 *  against the bundle's own instant; absolute dates elsewhere stay the org's. */
function dateChips(_ctx: RelContext): StepOption[] {
  const out: StepOption[] = [];
  const clock = new Date().toISOString();
  const now = today(clock);
  const next = firstOfNextMonth(clock);
  if (now) out.push({ label: `Today, ${now}`, value: now });
  if (next) out.push({ label: `The 1st of next month, ${next}`, value: next, detail: "the date most schedules on this book run from" });
  out.push({ label: "Another date", value: OTHER_DATE });
  return out;
}

/** "Another one", or "that is all". The one question that makes this a loop,
 *  and the cap is stated on it rather than discovered at the confirm gate. */
function morStep(key: string, i: number, what: "covenant" | "asset", filed: number): RelStep {
  const room = INTAKE_CAP - (i + 1);
  return {
    key,
    ask: room > 0 ? `Another ${what}, or is that all?` : `That is ${INTAKE_CAP}, which is the cap. ${INTAKE_CAP_REFUSAL}`,
    kind: "chips",
    options:
      room > 0
        ? [
            { label: "Another one", value: "more", detail: `${filed} on the plan, room for ${room} more.` },
            { label: "That is all", value: "done" },
          ]
        : [{ label: "That is all", value: "done" }],
    placeholder: room > 0 ? "Another one, or that is all." : "That is all.",
  };
}

/* ---------------------------------------------------------- the collateral */

function collateralChips(ctx: RelContext): StepOption[] {
  const names = collateralTypeNames(ctx);
  const held = heldFamilies(ctx);
  const roots: string[] = [];
  for (const n of names) {
    const root = familyRoot(n);
    if (!roots.some((r) => r.toLowerCase() === root.toLowerCase())) roots.push(root);
  }
  const ordered = roots.sort((x, y) => Number(held.has(y.toLowerCase())) - Number(held.has(x.toLowerCase())));
  /* THE FAMILY IS THE FIRST QUESTION AND THE EXACT NAME IS THE SECOND. Where a
     family has exactly one member the chip IS the exact name and there is no
     second beat, which is why the value is the member rather than the root. */
  return ordered.slice(0, CHIP_CAP).map((root) => {
    const members = names.filter((n) => inFamily(n, root));
    return {
      label: root,
      value: members.length === 1 ? members[0] : root,
      detail: members.length === 1
        ? held.has(root.toLowerCase())
          ? "already pledged on this relationship"
          : undefined
        : `${members.length} types in the org under this name`,
    };
  });
}

/** Is `value` a member of `root`'s family? A bare prefix is not enough:
 *  "Cashflow" is not "Cash". */
function inFamily(value: string, root: string): boolean {
  const v = value.toLowerCase();
  const r = root.toLowerCase();
  if (v === r) return true;
  return v.startsWith(r) && /[^a-z0-9]/.test(v.charAt(r.length));
}

/* ------------------------------------- the asset the book already holds

   THE FOUNDER'S OWN QUESTION (2026-09-03, on the facility room's pledge
   lane): "is it not offering the collaterals from my account to pledge
   towards it?" This room's own half of the same fix. An asset filed here is
   OWNED AND UNPLEDGED (`NO_PLEDGE_NO_LIEN`), so before a banker re-files one
   the account already holds, the room asks which of the two he means, using
   the same "Unpledged" set the collateral pane badges (`domain/collateralAssets`,
   `pledges.length === 0`), because that is the account's own definition of an
   asset with nothing yet claiming it.                                     */

/** Every asset the account holds that no active pledge secures today. */
function unpledgedBookAssets(ctx: RelContext): CollateralAsset[] {
  return collateralAssets(ctx.bundle).filter((asset) => asset.pledges.length === 0);
}

/** The chip label for one of them: the org's own type and a compact
 *  descriptor, never the full description and never the org's autonumber
 *  (the same shortener the collateral pane itself uses). */
function unpledgedAssetChipLabel(asset: CollateralAsset): string {
  return clipTitle(shortAssetTitle(asset.collateralType, asset.description), 60);
}

function collateralIntakeStep(ctx: RelContext, a: Answers): RelStep | null {
  const names = collateralTypeNames(ctx);

  /* THE FIRST STEP, BEFORE THE TYPE QUESTION: FILE NEW, OR IS THIS ONE THE
     BOOK ALREADY HOLDS? Asked once, only where the account carries an
     unpledged asset, and never where the opening line already described one
     in full, since free text has already answered it, the same rule the type
     question below stands on. Picking an existing asset files NOTHING: an
     asset already on the book does not get filed a second time, and pledging
     it onto a facility is a facility action, said with the room's own
     facility-handoff line rather than a paraphrase of it. */
  const unpledged = unpledgedBookAssets(ctx);
  if (unpledged.length && !seedLine(a) && !has(a, "colExisting", 0)) {
    return {
      key: "colExisting.0",
      ask: "File a new asset, or is this one the book already holds?",
      kind: "chips",
      options: [
        { label: "A new asset", value: "new" },
        ...unpledged.map((asset) => ({ label: unpledgedAssetChipLabel(asset), value: `existing:${asset.key}` })),
      ],
      placeholder: "A new asset, or pick the one the book already holds.",
    };
  }
  const existingPick = text(at(a, "colExisting", 0));
  /* ANSWERED ONCE IS ANSWERED (A2 audit, 2026-09-12). This step used to re-read
     `colExisting.0`, which never changes, so it came back identical for every
     line the banker typed after it: the route could not reach ready and the
     room repeated the same paragraph forever. It is a handoff, so once it has
     been read the machine is done with the intake rather than standing on it. */
  if (existingPick && existingPick !== "new") {
    if (answered(a, "colExistingHandoff")) return null;
    return {
      key: "colExistingHandoff",
      ask: `That asset is already on the book. ${FACILITY_HANDOFF} Nothing is filed here for it.`,
      kind: "text",
      optional: true,
      options: [],
      placeholder: "Say what you would like to file next, or close this out.",
    };
  }

  const drafts = collateralDrafts(ctx, a);
  const { index: i, draft } = cursorOf(drafts, a, "colMore");
  if (i >= INTAKE_CAP) return null;

  if (!has(a, "colType", i) && !(i === 0 && draft?.collateralType)) {
    return {
      key: `colType.${i}`,
      ask: i === 0 ? `What kind of asset is it? ${NO_PLEDGE_NO_LIEN}` : "And the next asset, what kind is it?",
      kind: "text",
      options: collateralChips(ctx),
      placeholder: names.length ? "Pick a family, or name the type." : "Name the collateral type as the org holds it.",
      target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Collateral_Type__c" },
    };
  }
  if (!draft?.collateralType) {
    if (has(a, "colPick", i)) {
      return has(a, "colMore", i) ? null : morStep(`colMore.${i}`, i, "asset", drafts.filter((d) => d.collateralType).length);
    }
    const said = text(at(a, "colType", i)) ?? "";
    const root = resolveFamily(said, names);
    return {
      key: `colPick.${i}`,
      ask: root.length
        ? `The org holds ${root.length} collateral types under that name. Which one is it?`
        : UNKNOWN_COLLATERAL_TYPE(said),
      kind: "chips",
      options: (root.length ? root : names.slice(0, CHIP_CAP)).map((n) => ({ label: n, value: n })),
      placeholder: "Pick the org's own name for it.",
      target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Collateral_Type__c" },
    };
  }
  if (!draft.description && !has(a, "colDescription", i)) {
    return {
      key: `colDescription.${i}`,
      ask: "How is the asset described? This is what everyone downstream reads it under.",
      kind: "text",
      placeholder: "The asset, in the bank's own words.",
      target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Description__c" },
    };
  }
  if (draft.value === null && !has(a, "colValue", i)) {
    return {
      key: `colValue.${i}`,
      ask: `What is ${draft.description} worth?`,
      kind: "number",
      bounds: { min: 0.01, max: Number.MAX_SAFE_INTEGER, whole: false, refusal: VALUE_MUST_BE_POSITIVE },
      placeholder: "The value, in dollars.",
      target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Value__c" },
    };
  }
  if (!has(a, "colBasis", i)) {
    return {
      key: `colBasis.${i}`,
      ask: "On what basis is that figure struck?",
      kind: "chips",
      optional: true,
      options: asOptions(VALUATION_BASIS?.values),
      placeholder: "The valuation basis, or skip it.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Type__c" },
    };
  }
  if (!has(a, "colSource", i)) {
    return {
      key: `colSource.${i}`,
      ask: "And where did that figure come from?",
      kind: "chips",
      optional: true,
      options: asOptions(VALUATION_SOURCE?.values),
      /* THE ORG'S LIST CARRIES NEITHER A BROKER OPINION OF VALUE NOR A FIELD
         EXAM, and a banker who says either is told which of the org's own values
         covers it rather than watching the room pick one silently. */
      placeholder: "The source. No BOV and no Field Exam on this org's list, or skip it.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Source__c" },
    };
  }
  if (!has(a, "colValuationDate", i)) {
    return {
      key: `colValuationDate.${i}`,
      ask: "As of what date is that figure good?",
      kind: "text",
      optional: true,
      options: dateChips(ctx),
      placeholder: "Pick one, give me YYYY-MM-DD, or skip it.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Valuation_Date__c" },
    };
  }
  if (text(at(a, "colValuationDate", i)) === OTHER_DATE && !has(a, "colValuationOther", i)) {
    return {
      key: `colValuationOther.${i}`,
      ask: "What date is it good as of?",
      kind: "date",
      optional: true,
      placeholder: "YYYY-MM-DD.",
      target: { object: "LLC_BI__Collateral_Valuation__c", field: "LLC_BI__Valuation_Date__c" },
    };
  }
  if (!has(a, "colAddress", i)) {
    return {
      key: `colAddress.${i}`,
      ask: "Where is it? Street, city, state and postcode, in one line.",
      kind: "text",
      optional: true,
      placeholder: "For example 1400 Industrial Parkway, Fort Wayne, IN 46802. Skip it where the asset has no address.",
      target: { object: "LLC_BI__Collateral__c", field: "LLC_BI__Street_Address__c" },
    };
  }
  if (!has(a, "colOwner", i)) {
    return {
      key: `colOwner.${i}`,
      ask: "Who owns it?",
      kind: "chips",
      options: ownerOptions(ctx),
      placeholder: "The owning party.",
      target: { object: "LLC_BI__Account_Collateral__c", field: "LLC_BI__Account__c" },
    };
  }
  if (!has(a, "colMore", i)) return morStep(`colMore.${i}`, i, "asset", drafts.filter((d) => d.collateralType).length);
  return null;
}

/** The org names under one family word a banker typed, or an empty list. */
function resolveFamily(said: string, names: string[]): string[] {
  const line = said.trim().toLowerCase();
  if (!line) return [];
  const root = names.map(familyRoot).find((r) => line.includes(r.toLowerCase()));
  return root ? names.filter((n) => inFamily(n, root)) : [];
}

export const VALUE_MUST_BE_POSITIVE =
  "A collateral value cannot be zero or negative. The org refuses it on the insert, and an asset worth nothing is not an asset the bank records.";

/* ============================================================ THE PAYLOAD

   EVERY KEY BELOW IS THE CONTRACT'S. `covenantsJson` and `collateralJson` travel
   as JSON STRINGS because the invocable declares them that way, exactly as
   `covenantAddsJson` and `pledgeAddsJson` do on the modification wire. A draft
   that is not complete does not travel: the machine will not have let the flow
   reach the confirm gate with one, and this is the second gate rather than the
   only one. */

export function buildIntakePayload(ctx: RelContext, a: Answers, idempotencyKey: string): PayloadResult {
  const kind = intakeKindOf(a);
  if (!kind) return { ok: false, blocked: "This intake has not said whether it is filing a covenant or an asset." };

  /* THE AUDIT RATIONALE IS ALWAYS A SENTENCE. `stageRationale` falls back to
     the registry's own label for the action, and the intake carries no registry
     card on purpose (see `routeAvailability`), so the fallback would read as an
     id. What travels instead is what the banker actually said: their opening
     line where they wrote one, and every note they attached to a draft. A chip
     label is not a sentence and is not passed off as one. */
  const opening = text(a.intakeKind);
  const said = opening && /\s/.test(opening) ? opening : null;
  const typed = [said, ...intakeNotes(ctx, a)].filter((x): x is string => !!x).join(" ");
  const rationale = stageRationale({
    actionId: "relationship-intake",
    accountName: ctx.accountName,
    typed: typed || `Banker-initiated ${INTAKE_KIND_WORD[kind]} on ${ctx.accountName}, filed from the approved credit terms.`,
  });

  if (kind === "covenant") {
    const rows: IntakeCovenantWire[] = [];
    for (const d of covenantDrafts(ctx, a)) {
      if (text(at(a, "covSecond", d.index)) === "drop") continue;
      if (!d.typeName || !d.operator || d.threshold === null || !d.frequency || !d.effectiveDate) continue;
      rows.push({
        covenantTypeName: d.typeName,
        operator: d.operator,
        threshold: d.threshold,
        frequency: d.frequency,
        effectiveDate: d.effectiveDate,
        notes: d.notes,
      });
    }
    if (!rows.length) return { ok: false, blocked: NOTHING_COMPLETE("covenant") };
    if (rows.length > INTAKE_CAP) return { ok: false, blocked: INTAKE_CAP_REFUSAL };
    return {
      ok: true,
      payload: {
        idempotencyKey,
        accountId: ctx.accountId,
        rationale,
        covenantsJson: JSON.stringify(rows),
      } satisfies StagePayloads["relationship-intake"],
    };
  }

  const rows: IntakeCollateralWire[] = [];
  for (const d of collateralDrafts(ctx, a)) {
    if (!d.collateralType || !d.description || d.value === null) continue;
    if (d.value <= 0) return { ok: false, blocked: VALUE_MUST_BE_POSITIVE };
    const row: IntakeCollateralWire = {
      collateralType: d.collateralType,
      description: d.description,
      value: d.value,
      valuationBasis: d.valuationBasis,
      valuationSource: d.valuationSource,
      valuationDate: d.valuationDate,
      ownerAccountId: d.ownerAccountId ?? ctx.accountId,
    };
    if (d.address) row.address = d.address;
    rows.push(row);
  }
  if (!rows.length) return { ok: false, blocked: NOTHING_COMPLETE("asset") };
  if (rows.length > INTAKE_CAP) return { ok: false, blocked: INTAKE_CAP_REFUSAL };
  return {
    ok: true,
    payload: {
      idempotencyKey,
      accountId: ctx.accountId,
      rationale,
      collateralJson: JSON.stringify(rows),
    } satisfies StagePayloads["relationship-intake"],
  };
}

const NOTHING_COMPLETE = (what: string): string =>
  `Nothing on this intake is complete enough to file. A ${what} travels only with everything the org needs on it, and a half-answered one is not staged under a default.`;

/** Every note the banker wrote on this intake, for the audit rationale. */
function intakeNotes(ctx: RelContext, a: Answers): string[] {
  return covenantDrafts(ctx, a)
    .map((d) => d.notes)
    .filter((n): n is string => !!n);
}

/* ============================================================= THE READ-BACK

   ONE ROW PER THING FILED. A lane that listed the eleven answers behind three
   covenants would be a transcript; the banker is filing covenants, so the lane
   reads as covenants. Both the lane and the confirm card are built here, from
   the same drafts the payload is built from. */

export interface IntakeRow {
  key: string;
  icon: IconKind;
  label: string;
  value: string;
}

export function intakeRows(ctx: RelContext, a: Answers): IntakeRow[] {
  const kind = intakeKindOf(a);
  if (!kind) return [];
  if (kind === "covenant") {
    return covenantDrafts(ctx, a)
      .filter((d) => d.typeName && text(at(a, "covSecond", d.index)) !== "drop")
      .map((d) => ({
        key: `covenant-${d.index}`,
        icon: "covenant" as IconKind,
        label: d.typeName ?? "covenant",
        value: covenantRowValue(d),
      }));
  }
  return collateralDrafts(ctx, a)
    .filter((d) => d.collateralType)
    .map((d) => ({
      key: `asset-${d.index}`,
      icon: "collateral" as IconKind,
      label: d.description || (d.collateralType ?? "asset"),
      value: collateralRowValue(d),
    }));
}

function covenantRowValue(d: CovenantDraft): string {
  const test = d.operator && d.threshold !== null ? `${d.operator} ${fmtThreshold(d.threshold)}` : "terms outstanding";
  return [test, d.frequency?.toLowerCase(), d.effectiveDate ? `from ${d.effectiveDate}` : null]
    .filter(Boolean)
    .join(", ");
}

function collateralRowValue(d: CollateralDraft): string {
  return [
    d.collateralType,
    d.value !== null ? fmtMoney(d.value) : "value outstanding",
    d.valuationBasis,
    addressLine(d.address),
    d.ownerName ? `owned by ${d.ownerName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A threshold reads as money above a thousand and as a plain figure below it.
 *  The org keeps every threshold on one numeric field with no unit beside it, so
 *  the room never prints an "x" it invented. */
function fmtThreshold(n: number): string {
  return Math.abs(n) >= 1000 ? fmtMoney(n) : String(n);
}

/** The confirm sentence: what files, and what does not. */
export function intakeConfirmSentence(ctx: RelContext, a: Answers): string {
  const kind = intakeKindOf(a);
  const rows = intakeRows(ctx, a);
  const n = rows.length;
  if (kind === "covenant") {
    return `${n === 1 ? "One covenant is" : `${n} covenants are`} authored on ${ctx.accountName} and anchored on the relationship, each with an account junction and no loan junction, so ${n === 1 ? "it belongs" : "they belong"} to the borrower rather than to any one facility. No compliance row is minted, no approval is raised and no email is sent. ${EFFECTIVE_DATE_IS_FINAL} ${ORG_DERIVES}`;
  }
  return `${n === 1 ? "One asset is" : `${n} assets are`} filed against ${ctx.accountName} with the ownership junction that is the only link collateral has to an account. ${NO_PLEDGE_NO_LIEN}`;
}

/* ------------------------------------------------------------- the dossier */

/** The trail rows, built from the ORG'S OWN account of what it created. A row
 *  the org did not name reads as filed and unverified, which is what a failed
 *  read-back actually is. */
export function intakeDossierRows(
  ctx: RelContext,
  a: Answers,
  items: Array<{ recordName?: string | null; recordId?: string | null; detail?: string | null }> | undefined,
): IntakeRow[] {
  const rows = intakeRows(ctx, a);
  return rows.map((row, i) => {
    const item = items?.[i];
    /* THE ORG'S OWN NAME AND THE ORG'S OWN ID, in that order, because the name
       is what a banker reads and the id is what they paste into a search. A row
       the org named neither way is `filed, unverified`, which is what a failed
       verification read-back actually is and never a generic label over it. */
    const named = [(item?.recordName ?? "").trim(), (item?.recordId ?? "").trim()].filter(Boolean).join(" · ");
    return { ...row, value: named || "filed, unverified" };
  });
}
