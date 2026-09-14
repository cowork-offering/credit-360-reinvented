import type { Facility, LegalEntity } from "../data/contract";
import { facilityProduct, shortFacilityLabel } from "../data/facilityStage";
import { fmtMoney } from "../data/format";
import { catalogField, isFileable, matchCatalog, type CatalogField, type CatalogMatch, type CatalogType } from "./fieldCatalog";
import { LOAN_FIELD_INDEX, type IndexedField } from "./fieldIndex.gen";

/** The only money field the modification tool carries. See `inferAmount`. */
const FILEABLE_AMOUNT = catalogField("loan.amount")!;
/** The only priced field it carries. See `inferRate`. */
const FILEABLE_RATE = catalogField("loan.interestRate")!;

/* =============================================================================
   THE DETERMINISTIC PARSE.

   Natural language in, AMENDMENTS out, or a question, or nothing. There is no
   fourth outcome and, in particular, there is no "best guess": a line this
   cannot read comes back as a question naming what is missing, because a chip
   the banker did not mean is worse than a chip that never arrived.

   IT STANDS ALONE. The gateway LLM is an optional assist in the engine above
   this, gated behind a deterministic miss, and whatever it returns is validated
   back through THIS module before it can become a chip. Nothing reaches the org
   that this file did not resolve against the field catalog and the real package.

   Two refusals worth naming, because both are places a parser is tempted to
   invent money:
     - a bare number with no magnitude ("increase the line to 20") is a
       question, never twenty million;
     - a spread ("SOFR+300") is not an absolute rate, and the tool writes an
       absolute rate. It asks rather than converting.
   ============================================================================= */

export type ParsedValue =
  | { kind: "currency"; amount: number; text: string }
  | { kind: "percent"; rate: number; text: string }
  | { kind: "months"; months: number; text: string }
  | { kind: "date"; iso: string; text: string }
  | { kind: "text"; text: string }
  /** A NET-NEW COVENANT, fully resolved: the exact org catalog type name, the
   *  threshold, and the operator symbol the org's picklists express. Only a
   *  value this complete files; anything looser stays a question or a handoff. */
  | { kind: "covenant"; typeName: string; threshold: number; operator: "<" | "<=" | "=" | ">=" | ">"; text: string }
  /** A NET-NEW FEE, fully resolved: a legal `LLC_BI__Fee_Type__c` value, the
   *  human label the autonumber Name cannot carry, and EITHER a percentage or a
   *  flat amount, never both, because the org computes the money for a
   *  percentage fee and a hand-set figure would contradict it. */
  | {
      kind: "fee";
      feeType: string;
      /** The banker's own name for it, which titles the chip. */
      noun: string;
      /** The label the row carries in `LLC_BI__Fee_Type_Description__c`, which is
       *  where it has to go: `Name` on a fee is an autonumber. */
      description: string;
      calculationType: "Percentage" | "Flat Amount";
      percentage?: number;
      amount?: number;
      recordType: "Fees" | "Costs";
      text: string;
    }
  /** A COLLATERAL PLEDGE, in one of its two shapes. Either the asset already
   *  exists and the deal carries it, in which case the ORG'S OWN RECORD ID is
   *  what travels, never a name, or it is net-new and the whole chain has to be
   *  authored: the asset, the ownership junction that is its only link to the
   *  borrower, then the pledge. There is no third shape, and in particular there
   *  is no pledging an asset named but not resolved. */
  | {
      kind: "pledge";
      /** An EXISTING `LLC_BI__Collateral__c` the borrower already owns. */
      collateralId?: string;
      /** A NET-NEW asset. `collateralType` is the banker's word for the kind;
       *  the ORG resolves it against its own collateral-type catalog at stage
       *  time, because this client holds no copy of those 43 records. */
      create?: { description: string; collateralType: string; value: number; advanceRate: number };
      /** The asset as the chip names it. */
      noun: string;
      text: string;
    }
  /** A POLICY EXCEPTION, fully resolved. The three things a banker says about
   *  one, what is out of policy, whether it is waived, mitigated or standing,
   *  and what mitigates it, are ONE record rather than three amendments, so
   *  they travel on one value. `title` is the row's only readable identity: the
   *  org backfills an omitted `Name` with the record's own Id. */
  | {
      kind: "policyException";
      title: string;
      status: ExceptionStatus;
      /** One per mitigant, at most three, each at most 100 characters, the
       *  org's three `LLC_BI__Mitigation_Reason_N__c` fields. */
      reasons: string[];
      /** Free text on this org ("Major" is a convention, not a picklist), so it
       *  travels only where the banker labelled it as severity. */
      severity?: string;
      text: string;
    };

/** The org's own closed set on `LLC_BI__Status__c` (live describe 2026-08-31). */
export type ExceptionStatus = "Waived" | "Mitigated" | "Unmitigated";

/** One amendment the banker asked for, resolved against the catalog and the
 *  package. `value` is null where the field takes no scalar (a party add, a
 *  pledge), the amendment is still real, it just has nothing to compare. */
export interface Amendment {
  field: CatalogField;
  /** The member it lands on. Null for package-level and party-level asks. */
  facility: Facility | null;
  value: ParsedValue | null;
  /** The entity named, for a party amendment. */
  party?: string;
  /** The borrowing-structure role the line names, for a party amendment. */
  role?: string;
  /** Ownership percentage, when the line states one for a party add. */
  ownership?: number;
  /** The banker's own word for the field, so a reply can quote it back. */
  matched: string;
  /**
   * WHAT THIS DOES TO THE ROLL-OVER BASELINE.
   *
   * A modification carries the parent's whole record graph onto the clone ,
   * covenants, pledges, borrowing structure, fees, pricing, so every amendment
   * is a DELTA against what is already there. Keeping is the default and is
   * never staged; the three that are staged are change, add and remove, and
   * REMOVE is the one that has to be unmistakable in the manifest.
   */
  op: AmendmentOp;
}

export type AmendmentOp = "change" | "add" | "remove";

/** WHAT A QUESTION IS ABOUT, so the next line can answer it with the missing
 *  fact alone, "$20,000,000" is an answer, and a room that made the banker
 *  restate the whole instruction would not be a conversation. */
export interface Awaiting {
  field: CatalogField;
  facility: Facility | null;
  /**
   * A PARTY QUESTION IS ANSWERED WITH A NAME, not a value.
   *
   * "Which entity?" is asked over a line that already settled the op, the role
   * and the member; only the name was missing. Holding those here is what lets
   * "James Hartwell" complete the amendment, instead of arriving as a bare noun
   * the room has to read as a whole new instruction.
   */
  party?: { op: AmendmentOp; role?: string; ownership?: number };
  /**
   * A FEE QUESTION IS ANSWERED WITH THE HALF THAT WAS MISSING.
   *
   * "add a 1% fee to the line of credit" settles the member and the figure and
   * leaves only the KIND; "add an origination fee to the line of credit" does
   * the opposite. Holding what was read is what lets the next line be "1%" or
   * "origination fee" alone, instead of the whole instruction again.
   */
  fee?: FeeRead;
  /**
   * A PLEDGE QUESTION IS ANSWERED WITH THE PIECE THAT WAS MISSING.
   *
   * A create-then-pledge needs three facts the banker rarely says in one line ,
   * what kind of asset, what it is worth, what it lends at, so each answer has
   * to land on the read the previous question already held. `isNew` is the one
   * that MUST persist: without it, "equipment" answered to "what kind of asset?"
   * would go back through the existing-collateral resolver and try to find an
   * asset the deal never carried.
   */
  pledge?: PledgeRead;
  /**
   * AN EXCEPTION QUESTION IS ANSWERED WITH THE PIECE THAT WAS MISSING.
   *
   * An exception arrives in up to three beats, what is out of policy, what the
   * bank decided about it, what stands behind that decision, and each answer
   * has to land on the read the previous question held. `status` is the one that
   * changes what the NEXT line means: once it reads Mitigated and the title is
   * settled, a bare line is the mitigant rather than a new instruction.
   */
  exception?: ExceptionRead;
  /**
   * A MEMBER QUESTION IS ANSWERED WITH A MEMBER, and the line that raised it is
   * still the instruction.
   *
   * "Increase the line of credit by 20M" on a package carrying two of them
   * names neither, so the room asks which. The answer is "the $15M one" and
   * nothing else, because a banker does not write the whole instruction twice.
   * The line that asked is held here and re-read against the member they pick.
   */
  member?: { said: string; choices: Facility[] };
  /**
   * A ROLE-SCOPED REMOVAL, LISTED AND WAITING ON ONE YES.
   *
   * "remove all limited guarantors" names no party and is nonetheless exact: the
   * org holds involvement as rows, so the role plus the member resolves a closed
   * set of them off the book. Three carry exclusions is three decisions a banker
   * signs, so the rows are named first and staged only on the confirmation.
   */
  roleRemoval?: RoleRemovalRead;
}

/** The involvement rows one role names on one member, in the book's own order. */
export interface RoleRemovalRead {
  /** The org's own role word. */
  role: string;
  rows: Array<{ party: string; facility: Facility }>;
}

/** What a fee line has settled so far. Every field is optional because a fee
 *  arrives in pieces and the room asks for the piece it is missing. */
export interface FeeRead {
  /** The org's own legal `LLC_BI__Fee_Type__c` value. */
  typeName?: string;
  /** The banker's word for it, which becomes the human label on the row. */
  said?: string;
  recordType?: "Fees" | "Costs";
  percentage?: number;
  amount?: number;
}

/** What a pledge line has settled so far. */
export interface PledgeRead {
  /** The banker said the asset is NEW, so the existing-collateral resolver is
   *  off for the rest of this exchange. */
  isNew?: boolean;
  /** The banker's word for the kind of asset. Resolved ORG-SIDE against
   *  `LLC_BI__Collateral_Type__c`; nothing here claims the org holds it. */
  assetType?: string;
  /** The banker's own words for the asset, which become its readable label:
   *  `Name` on a collateral is an autonumber (COL-000762). */
  said?: string;
  value?: number;
  advanceRate?: number;
}

/** What an exception line has settled so far. */
export interface ExceptionRead {
  /** The row's readable identity. Once settled it is never re-read off a later
   *  answer: every question after the first is about something else, and a
   *  "Mitigated" typed into the status question is not a new title. */
  title?: string;
  status?: ExceptionStatus;
  reasons?: string[];
  severity?: string;
}

export type ParseOutcome =
  | { kind: "amendments"; amendments: Amendment[] }
  /** Read, but not resolvable without one more fact. Never a guess. */
  | {
      kind: "clarify";
      question: string;
      awaiting?: Awaiting;
      /** The closed set of legal answers, where one exists (an org picklist).
       *  The engine turns these into clickable chips; each click is SAID and
       *  re-parsed like any typed answer. */
      options?: string[];
    }
  /** KEEP CURRENT. The banker answered a term question with "hold" / "keep it" /
   *  "no change" / "leave as is": the field does not move. Not a clarify (that
   *  re-asks and loops) and not an amendment (nothing files); the engine says so
   *  and stops waiting on the field. */
  | {
      kind: "hold";
      field: CatalogField;
      facility: Facility | null;
      /** THE ROOM'S OWN SENTENCE, where "holding <field> at <figure>" is not the
       *  one. A declined role removal holds nothing at a value: it leaves a set
       *  of involvement rows alone, and that is what it has to say. */
      said?: string;
    }
  | { kind: "none" };

export interface ParseContext {
  /** Members of the package, booked and otherwise. */
  facilities: Facility[];
  /** Members a credit action may actually run against. */
  booked: Facility[];
  /** The relationship's name, so member labels read short. */
  relationship: string;
  /** Entities already on the deal, for resolving "remove Elena". */
  entities: LegalEntity[];
  /**
   * THE MEMBER THE BANKER IS STANDING ON.
   *
   * Set when they picked one off the package strip. It is a default, never an
   * override: a line that NAMES a member always resolves to what it named, and
   * the focus only answers the question "which one?" for a line that names
   * none. Without it, picking a facility and then saying "take it to twenty
   * million" would be answered with "which member?" about the member just
   * clicked, which is the room forgetting what the banker did one turn ago.
   */
  focus?: Facility | null;
  /**
   * THE MEMBER THE BANKER JUST PICKED OUT OF A "WHICH ONE?".
   *
   * Set only while the line that raised that question is being re-read. It
   * settles the target outright: re-reading the line's own words would fit the
   * same two members again and ask the same question forever.
   */
  picked?: Facility[] | null;
}

/* ------------------------------------------------------------------- money */

const MAGNITUDE: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  mm: 1e6,
  million: 1e6,
  millions: 1e6,
  bn: 1e9,
  b: 1e9,
  billion: 1e9,
};

/* THE SCALAR READERS ARE SHARED, and deliberately so. `parseCreate` reads the
   same money, the same months and the same dates out of a banker's line, and a
   second implementation of "is 20 twenty million or twenty dollars" is a second
   place for the answer to drift. Exported: `Scalar`, `moneyTokens`,
   `monthTokens`, `DateRead`, `readDate`. Everything else here stays private. */
export interface Scalar {
  value: number;
  text: string;
  index: number;
}

/** Money tokens, with position. A magnitude suffix or a `$` is REQUIRED, or the
 *  number has to be written out in full, see the module note on bare numbers. */
export function moneyTokens(lower: string): Scalar[] {
  const out: Scalar[] = [];
  const re = /(\$\s*)?(\d[\d,]*(?:\.\d+)?)\s*(mm|million|millions|bn|billion|k|m|b)?\b/g;
  for (let m = re.exec(lower); m; m = re.exec(lower)) {
    const [text, dollar, digits, suffix] = m;
    const bare = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(bare)) continue;
    const factor = suffix ? MAGNITUDE[suffix] : 1;
    // Written out in full ($18,000,000 or 18000000) counts on its own; a short
    // number needs either a magnitude word or a currency mark to be money.
    const written = digits.includes(",") || bare >= 1000;
    if (!suffix && !dollar && !written) continue;
    out.push({ value: bare * (factor ?? 1), text: text.trim(), index: m.index });
  }
  return out;
}

function percentTokens(lower: string): Scalar[] {
  const out: Scalar[] = [];
  const pct = /(\d+(?:\.\d+)?)\s*(?:%|per\s?cent|percent)/g;
  for (let m = pct.exec(lower); m; m = pct.exec(lower)) {
    out.push({ value: Number(m[1]), text: m[0].trim(), index: m.index });
  }
  const bps = /(\d+(?:\.\d+)?)\s*(?:bps|basis\s+points?|bp)\b/g;
  for (let m = bps.exec(lower); m; m = bps.exec(lower)) {
    out.push({ value: Number(m[1]) / 100, text: m[0].trim(), index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

export function monthTokens(lower: string): Scalar[] {
  const out: Scalar[] = [];
  const months = /(\d+)\s*(?:months?|mos?\b)/g;
  for (let m = months.exec(lower); m; m = months.exec(lower)) {
    out.push({ value: Number(m[1]), text: m[0].trim(), index: m.index });
  }
  const years = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?\b|-year\b)/g;
  for (let m = years.exec(lower); m; m = years.exec(lower)) {
    out.push({ value: Math.round(Number(m[1]) * 12), text: m[0].trim(), index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/* -------------------------------------------------------------------- date */

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const iso2 = (n: number) => String(n).padStart(2, "0");

export interface DateRead {
  iso?: string;
  text: string;
  /** A month and a year with no day. Refused, with the reason. */
  dayMissing?: true;
}

export function readDate(lower: string): DateRead | null {
  const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return { iso: isoMatch[0], text: isoMatch[0] };

  const monthAlt = MONTH_NAMES.map((m) => `${m}|${m.slice(0, 3)}`).join("|");
  // "15 March 2028" and "March 15, 2028" both, and the day is what separates a
  // date from a month.
  const dmy = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthAlt})\\.?\\,?\\s+(\\d{4})\\b`));
  if (dmy) {
    const month = MONTH_NAMES.findIndex((m) => m.startsWith(dmy[2]));
    return { iso: `${dmy[3]}-${iso2(month + 1)}-${iso2(Number(dmy[1]))}`, text: dmy[0] };
  }
  const mdy = lower.match(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\,?\\s+(\\d{4})\\b`));
  if (mdy) {
    const month = MONTH_NAMES.findIndex((m) => m.startsWith(mdy[1]));
    return { iso: `${mdy[3]}-${iso2(month + 1)}-${iso2(Number(mdy[2]))}`, text: mdy[0] };
  }
  const my = lower.match(new RegExp(`\\b(${monthAlt})\\.?\\s+(\\d{4})\\b`));
  if (my) return { text: my[0], dayMissing: true };

  return null;
}

/** "extend by 18 months" against a maturity the org staged. Derived, not
 *  invented: without a staged maturity there is nothing to extend from. */
function shiftMaturity(from: string | undefined, months: number): string | null {
  if (!from) return null;
  const m = from.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Clamp into the target month rather than rolling into the next one: an
  // 18-month extension of the 31st must not silently become the 1st.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return `${d.getUTCFullYear()}-${iso2(d.getUTCMonth() + 1)}-${iso2(d.getUTCDate())}`;
}

/* ---------------------------------------------------------------- members */

/** HOW a member was named, because it changes what an ambiguity means.
 *  `identity`, the banker named THIS member (its label, its name, its id).
 *  `product` , the banker named a product, which legitimately spreads across
 *               every member carrying it ("the equipment facilities").
 *  `alias`   , the banker used a nickname. It resolves to a product, so more
 *               than one match is a question rather than a selection: "the
 *               revolver" on a deal with two lines of credit names neither. */
type NameMatch = { facilities: Facility[]; how: "identity" | "product" | "alias" };

/** Words that name THIS member and no other: its own label, name and record id. */
function identityTokens(f: Facility, relationship: string): string[] {
  const out = [shortFacilityLabel(f, relationship), f.name ?? ""].map((t) => t.toLowerCase().trim()).filter(Boolean);
  if (f.loanId) out.push(f.loanId.toLowerCase());
  return [...new Set(out)];
}

function namedFacilities(lower: string, ctx: ParseContext): NameMatch {
  // IDENTITY FIRST. A line carrying "Line of Credit - $15,000,000.00" names one
  // member, and the product word inside it must not sweep in its siblings.
  const identity = ctx.facilities.filter((f) =>
    identityTokens(f, ctx.relationship).some((t) => t.length > 2 && lower.includes(t)),
  );
  if (identity.length) return { facilities: identity, how: "identity" };

  // A product word on its own ("the equipment facility") names every member of
  // that product, which is a real selection and not an ambiguity to refuse.
  // THE PRODUCT COMES OUT OF THE NAME, not out of `productType`, that field is
  // the regulatory classification ("Non-Real Estate"), and matching a banker's
  // "equipment facility" against it would never hit.
  const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const byProduct = ctx.facilities.filter((f) => {
    const product = facilityProduct(f, ctx.relationship).toLowerCase();
    return product.length > 3 && words.some((w) => product.includes(w));
  });
  if (byProduct.length) return { facilities: byProduct, how: "product" };

  // AND THE WORDS BANKERS ACTUALLY USE. The org's product picklist says "Line
  // of Credit"; the word "revolver" appears nowhere in the data, and it is what
  // every banker says. The keys below are the org's own picklist values (live
  // describe of LLC_BI__Loan__c.LLC_BI__Product__c, 2026-08-27), so this maps
  // vocabulary onto real products rather than inventing a product set.
  const aliased = new Set(
    Object.entries(PRODUCT_ALIASES)
      .filter(([, nicknames]) => nicknames.some((n) => wordIn(lower, n)))
      .map(([product]) => product.toLowerCase()),
  );
  return {
    facilities: aliased.size
      ? ctx.facilities.filter((f) => aliased.has(facilityProduct(f, ctx.relationship).toLowerCase()))
      : [],
    how: "alias",
  };
}

/**
 * DOES THE LINE ITSELF TELL THESE MEMBERS APART?
 *
 * "the 2.5M line of credit" carries a figure written against the product word,
 * and on a package with two lines that figure names one of them. The reference
 * is not ambiguous and asking "which one?" over it would be the room failing to
 * read what the banker wrote.
 *
 * THE NARROWING IS NOT DONE HERE. `qualifierFilter` in
 * `components/workroom/dispatch.ts` does it over the staged deltas and says
 * which member it read; one rule said out loud in one place beats the same rule
 * kept in two. This only decides whether there is a question to ask.
 *
 * THE FIGURE HAS TO SIT AGAINST THE PRODUCT WORD. A figure further down the
 * sentence is the new value: "take the line of credit to $2.5M" names no
 * member at all, and reading its target as a name would silence the question.
 */
function figureNamesAMember(bookable: Facility[], lower: string, relationship: string): boolean {
  const tokens = moneyTokens(lower);
  if (!tokens.length) return false;
  return bookable.some((f) => {
    if (typeof f.committed !== "number") return false;
    const words = facilityProduct(f, relationship)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    return tokens.some((t) => {
      if (t.value !== f.committed) return false;
      const next = /^[\s-]*([a-z]+)/.exec(lower.slice(t.index + t.text.length));
      return !!next && words.includes(next[1]);
    });
  });
}

/** WHICH MEMBERS A LINE NAMED, for a refusal that can say what it DID read.
 *  "I could not read an amendment in that" is a true answer and a useless one;
 *  "I read the Line of Credit, but not what should change on it" is the same
 *  refusal with the half that landed named. */
export function membersNamedIn(text: string, ctx: ParseContext): Facility[] {
  return namedFacilities(text.toLowerCase(), ctx).facilities;
}

/** The org's own `LLC_BI__Product__c` picklist, and what bankers call each one. */
const PRODUCT_ALIASES: Record<string, string[]> = {
  "Line of Credit": ["revolver", "revolving line", "revolving facility", "operating line", "working capital line", "the line", "loc", "rcf"],
  Equipment: ["equipment line", "kit", "machinery", "tooling facility"],
  Construction: ["construction loan", "build facility"],
  Term: ["term loan"],
  Purchase: ["purchase loan", "acquisition facility"],
  HELOC: ["home equity line"],
};

function wordIn(haystack: string, needle: string): boolean {
  const at = haystack.indexOf(needle);
  if (at === -1) return false;
  const before = at === 0 ? " " : haystack[at - 1];
  const after = at + needle.length >= haystack.length ? " " : haystack[at + needle.length];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/* ---------------------------------------------------------- delta semantics */

const REMOVE_VERBS = /\b(remove|removing|drop|dropping|release|releasing|detach|unpledge|take\s+off|strike|cancel)\b/;
const ADD_VERBS = /\b(add|adding|pledge|pledging|impose|introduce|bring\s+in|attach|include)\b/;

/** Which way an amendment moves against the baseline. The FIELD decides where
 *  it can only be one thing (a `.remove` entry is a removal, a record entry is
 *  an add); otherwise the banker's own verb does. */
function operationFor(field: CatalogField, lower: string): AmendmentOp {
  if (field.id.endsWith(".remove") || field.id === "collateral.release") return "remove";
  if (REMOVE_VERBS.test(lower)) return field.type === "record" || field.category === "party" ? "remove" : "change";
  if (field.type === "record") return ADD_VERBS.test(lower) ? "add" : "add";
  return "change";
}

/* ---------------------------------------------------------------- parties */

/* A BORROWING-STRUCTURE LINE NAMES THREE THINGS, a verb, a role and an entity
  , and it may name a member as well. Bankers say them in that order ("remove
   the guarantor James Hartwell from the line of credit"), so the reader below
   walks the same order rather than assuming the name follows the verb. */

const PARTY_VERB = "(?:[Aa]dd|[Rr]emove|[Rr]elease|[Dd]rop|[Bb]ring\\s+in|[Tt]ake\\s+off)";
/** The roles the borrowing structure holds, longest first so "limited
 *  guarantor" is never read as "guarantor" with a stray word in front. LOWER
 *  CASE on purpose: a banker writes the role in lower case and an entity name
 *  capitalised, and that is what keeps "add Borrower Holdings LLC" from reading
 *  its own first word as a role and filing "Holdings LLC". */
const PARTY_ROLE = "(?:limited\\s+guarantor|co[-\\s]?borrower|related\\s+entity|guarantor|borrower)";
const PARTY_NAME =
  "[A-Z][\\w&.'-]*(?:\\s+[A-Z][\\w&.'-]*)*(?:\\s+(?:LLC|Inc\\.?|Ltd\\.?|LP|LLP|Corp\\.?|Co\\.?|Holdings|Industrial))?";
/** Verb, optional article, optional ROLE, then the name. */
const PARTY_NAMED = new RegExp(`\\b${PARTY_VERB}\\b\\s+(?:(?:the|an?)\\s+)?(?:${PARTY_ROLE}\\s+)?(${PARTY_NAME})`);
/** Not a name, whatever the capitalisation: "add a guarantor" names nobody. */
const PARTY_NOT_A_NAME = new RegExp(`^(?:an?|the|entity|${PARTY_ROLE})$`, "i");
/**
 * WHERE THE NAME ENDS.
 *
 * "remove the guarantor James Hartwell from the Line of Credit" names a party
 * AND a member, and the org capitalises its own product names, so a capture
 * left to run swallows the member and files an entity called "James Hartwell
 * From The Line Of Credit". The member is resolved separately by
 * `namedFacilities`; here it is only in the way.
 *
 * "off" is deliberately not in the list: "take off" is one of the verbs above.
 */
const FACILITY_CLAUSE = /\s+\b(?:from|on|under|against)\s+the\b.*$/i;

/* ------------------------------------------------ THE NAME A BANKER ACTUALLY USES

   (Founder, 0.9.22 preview; IMPROVEMENTS row 44.) "remove Elena from this loan"
   matched nothing at all. The org spells her "Elena Hartwell" and the room would
   only answer to the spelling the org holds, which is not how anybody talks
   about a deal they have had open all morning.

   SO A PARTY MAY BE NAMED BY ANY WORD THAT IDENTIFIES IT: the first name, the
   surname, the distinctive word of a company name. AND THE RULE IS
   UNIQUENESS, never proximity. One name matched is that party; two are a
   question with both names on chips ("Hartwell" is four of the five parties on
   this book); none is a name the deal does not carry, which is exactly what an
   ADD is and never what a REMOVE is. A guess here would take a guarantor off
   the wrong facility, so there is no guess.                                   */

/** A line POINTING AT a member without naming one: "from this loan", "off that
 *  facility", "on it". A party removal aimed at one of those is aimed at a loan
 *  the party is actually on, and the book says which; a line naming no member at
 *  all is deal-scoped and stays the handoff it has always been. */
const POINTS_AT_A_MEMBER = /\b(?:this|that|the)\s+(?:loan|facility|line|note|one)\b|\b(?:from|off|on)\s+it\b/i;

/** A legal suffix makes one word a company NAME rather than a shorthand. */
const LEGAL_SUFFIX = /\b(?:llc|inc|ltd|lp|llp|corp|corporation|company|co|plc)\b\.?$/i;

/** Words that dress a company name rather than identify it. */
const NAME_NOISE = new Set([
  "llc", "inc", "incorporated", "ltd", "limited", "lp", "llp", "corp", "corporation",
  "co", "company", "plc", "the", "and", "group", "holdings",
]);

/** What identifies a name, one word at a time. "Holdings" is noise on its own
 *  and so is the legal suffix; everything else a banker could say to mean this
 *  party and no other is here. */
function nameTokens(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !NAME_NOISE.has(w)),
    ),
  ];
}

/** Every distinct party the deal carries, longest name first so "Hartwell
 *  Industrial Holdings LLC" is never read as one of the shorter Hartwells. */
function dealNames(ctx: ParseContext): string[] {
  return [...new Set(ctx.entities.map((e) => (e.accountName ?? "").trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

/**
 * THE BOOK NAMES A SHORTHAND FITS, in the book's own spelling.
 *
 * Every significant word the banker typed has to belong to the party it
 * resolves to: "Elena" is Elena Hartwell, "Logistics" is Hartwell Logistics
 * LLC, "Hartwell" is five of them and resolves to nothing on its own, and
 * "Vertex Precision LLC" is a name this deal does not carry however many words
 * it shares with the borrower.
 *
 * EXPORTED so the guided create lane resolves a name exactly as the parser
 * does (`elicit.ts`). Two readers of one shorthand is how a room ends up
 * refusing its own composed sentence for naming somebody else.
 */
export function partyShorthand(said: string, names: string[]): string[] {
  const words = nameTokens(said);
  if (!words.length) return [];
  return names.filter((n) => {
    const held = new Set(nameTokens(n));
    return words.every((w) => held.has(w));
  });
}

export type PartyNamed =
  /** One party on the deal, spelled the way the org spells it. */
  | { kind: "one"; name: string }
  /** The word fits more than one party. The room asks; it does not pick. */
  | { kind: "many"; names: string[] }
  /** Nobody on the deal. A new name for an add, and a miss for a remove. */
  | { kind: "none"; said?: string };

/** THE PARTY A LINE NAMES, resolved against the deal's own involvement rows. */
export function partyNamed(text: string, ctx: ParseContext): PartyNamed {
  const names = dealNames(ctx);
  // The member's own name carries the borrower's inside it ("<Borrower> -
  // <Product> - <$Amount>"), so a line naming a facility would otherwise name
  // the borrower as the party. The identity is taken out before anybody is read.
  const said = scrubIdentity(text, ctx.facilities, ctx.relationship);
  const lower = ` ${said.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;

  const spelled = names.find((n) => lower.includes(` ${n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
  if (spelled) return { kind: "one", name: spelled };

  /* THE SHORTHAND IS READ OUT OF THE NAME THE LINE ACTUALLY GIVES, never out of
     the whole sentence. Matching loose words against the book would read "add
     Vertex Precision LLC as a guarantor" as the borrower, because the borrower
     is a Precision too: every word of the shorthand has to belong to the party
     it resolves to, or it is a name the deal does not carry, which is what an
     add is for. */
  const candidate = said.replace(FACILITY_CLAUSE, "").match(PARTY_NAMED)?.[1]?.trim();
  if (!candidate || PARTY_NOT_A_NAME.test(candidate)) return { kind: "none" };
  const fits = partyShorthand(candidate, names);
  if (fits.length === 1) return { kind: "one", name: fits[0] };
  if (fits.length > 1) return { kind: "many", names: [...fits].sort((a, b) => a.localeCompare(b)) };
  return { kind: "none", said: candidate };
}

/** The BOOKED members this party sits on, with the role each row carries. A row
 *  the org hung off the relationship rather than off a loan is on every member,
 *  which is the same reading the structure card makes. */
function partyOn(name: string, ctx: ParseContext): Array<{ facility: Facility; role: string }> {
  const rows = ctx.entities.filter((e) => (e.accountName ?? "").trim() === name);
  if (!rows.length) return [];
  const out: Array<{ facility: Facility; role: string }> = [];
  for (const facility of ctx.booked) {
    const row =
      rows.find((e) => e.loanId && facility.loanId && e.loanId === facility.loanId) ?? rows.find((e) => !e.loanId);
    if (row) out.push({ facility, role: ((row.relationshipType ?? "").trim() || (row.borrowerType ?? "").trim()).trim() });
  }
  return out;
}

/** "the Line of Credit $15M as Limited Guarantor", for a sentence that has to
 *  say where a party sits before it asks which row comes off. */
const heldAs = (held: Array<{ facility: Facility; role: string }>, relationship: string): string =>
  held
    .map((h) => `the ${memberChipLabel(h.facility, relationship)}${h.role ? ` as ${h.role}` : ""}`)
    .join(held.length === 2 ? " and " : ", ");

/** The borrowing-structure role the line names. Longest match first, so
 *  "limited guarantor" never reads as "guarantor". */
function readRole(lower: string): string | undefined {
  if (/\blimited guarantor\b/.test(lower)) return "Limited Guarantor";
  if (/\bco[- ]?borrower\b/.test(lower)) return "Co-Borrower";
  if (/\brelated entity\b/.test(lower)) return "Related Entity";
  if (/\bguarantor\b/.test(lower)) return "Guarantor";
  if (/\bborrower\b/.test(lower)) return "Borrower";
  return undefined;
}

/** Ownership, when the line states it: "at 40% ownership", "owns 25%". */
function readOwnership(lower: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*%\s*(?:ownership|owner|stake)?/.exec(lower);
  return m ? Number(m[1]) : undefined;
}

/* ------------------------------------------------------------------- parse */

/**
 * DID THE BANKER COUNT MORE THAN ONE?
 *
 * "The equipment facilities" and "both lines" are a selection: the banker said
 * plural and meant it. "The line of credit" is singular and definite, and on a
 * package carrying two of them it names NEITHER. Reading it as both stages a
 * change set nobody asked for, on a member nobody named.
 */
const PLURAL_REFERENCE = /\b(?:both|all|each|every|facilities|lines|loans|notes|revolvers|commitments)\b/;

/** A member, named for a chip: the product and what it commits today. */
function memberChipLabel(f: Facility, relationship: string): string {
  const product = facilityProduct(f, relationship);
  return typeof f.committed === "number" ? `${product} ${fmtMoney(f.committed)}` : product;
}

/** The scalar terms a move lands on ONE member. A commitment, a rate, a term or
 *  a maturity is a figure per facility, so "Both" is never an honest option for
 *  one; a covenant, a pledge or a guarantor legitimately rides several. */
const PER_MEMBER_SCALAR = new Set<CatalogType>(["currency", "percent", "months", "date"]);

type TargetAsk = { question: string; options?: string[]; choices?: Facility[] };

/** The question that resolves an ambiguous reference, with one chip per member
 *  the reference fits. "Both" only where the ask could honestly ride both. */
function whichMember(question: string, choices: Facility[], ctx: ParseContext, fields: CatalogField[]): TargetAsk {
  const options = choices.map((f) => memberChipLabel(f, ctx.relationship));
  const shared = fields.length > 0 && fields.every((f) => !PER_MEMBER_SCALAR.has(f.type));
  if (shared) options.push(choices.length === 2 ? "Both" : "All of them");
  return { question, options, choices };
}

/**
 * THE ONE SENTENCE FOR A PACKAGE A CREDIT ACTION CANNOT RUN AGAINST.
 *
 * It was written inline inside `resolveTarget` and therefore only ever reached
 * the lines that go THROUGH `resolveTarget`, which is every member-scoped
 * amendment and none of the deal-scoped ones. See `nothingToModify` below.
 */
const NOTHING_TO_MODIFY =
  "No booked facility is staged on this package, and a credit action only runs against a booked one. There is nothing here I can modify.";

/**
 * A PACKAGE WITH NOTHING BOOKED TAKES NO CHANGE OF ANY KIND (D1, the three-book
 * matrix, 2026-09-13).
 *
 * `resolveTarget` has refused a commitment, a rate, a maturity and a term on an
 * unbooked package since the wave shipped. A PARTY and a PACKAGE field are not
 * member-scoped (a guarantor joins the deal, not one facility), so neither of
 * them ever asked `resolveTarget` for a member, and neither of them ever met the
 * refusal. On Piedmont, whose three facilities are all at Final Review, the room
 * therefore refused "increase the line of credit" with the org's own reason and
 * in the same breath put "remove Margaret Holloway" on the manifest: a carry
 * exclusion against a version that cannot exist, on a plan nCino would refuse
 * whole.
 *
 * The rule is the package's, not the field's, so it is asked here by both lanes.
 * An AMEND room is unaffected: its `booked` is every member still below the
 * approval rung (`modifyEngine.ts`), which is never empty on a version it can
 * shape.
 */
function nothingToModify(ctx: ParseContext): ParseOutcome | null {
  return ctx.booked.length === 0 ? { kind: "clarify", question: NOTHING_TO_MODIFY } : null;
}

/** Which member(s) an amendment lands on, or the question that resolves it. */
function resolveTarget(lower: string, ctx: ParseContext, fields: CatalogField[] = []): { facilities: Facility[] } | TargetAsk {
  // ALREADY ANSWERED. The banker picked one out of a "which one?" and this is
  // the line that raised it, being read again against what they picked.
  if (ctx.picked?.length) return { facilities: ctx.picked };
  const named = namedFacilities(lower, ctx);
  if (named.facilities.length) {
    // BOOKED AND OPEN, OR NOT AT ALL. nCino accepts a credit action only against
    // a booked facility, and the showcase Proposal member is exactly the kind of
    // row a product word would otherwise sweep up. Naming an unbookable member
    // is answered with the org's reason rather than staged and refused later.
    const bookable = named.facilities.filter((f) => ctx.booked.some((b) => b.loanId === f.loanId));
    if (!bookable.length) {
      const stages = [...new Set(named.facilities.map((f) => f.stage).filter(Boolean))];
      return {
        question: `${named.facilities.map((f) => shortFacilityLabel(f, ctx.relationship)).join(", ")} ${
          named.facilities.length === 1 ? "is" : "are"
        } ${stages.length ? `at ${stages.join(", ")}` : "not staged as booked in this read"}, and a credit action only runs against a booked facility. Nothing there can be modified.`,
      };
    }
    // A SINGULAR REFERENCE THAT FITS SEVERAL NAMES NONE OF THEM. "The revolver"
    // and "the line of credit" on a deal with two lines are both questions;
    // "the equipment facilities" and "both lines" are selections, because the
    // banker counted.
    if (bookable.length > 1 && !PLURAL_REFERENCE.test(lower) && !figureNamesAMember(bookable, lower, ctx.relationship)) {
      return whichMember(
        `This package carries ${bookable.length} of those: ${bookable
          .map((f) => shortFacilityLabel(f, ctx.relationship))
          .join(", ")}. Which one?`,
        bookable,
        ctx,
        fields,
      );
    }
    return { facilities: bookable };
  }
  const focused = ctx.focus && ctx.booked.find((b) => b.loanId === ctx.focus!.loanId);
  if (focused) return { facilities: [focused] };
  if (ctx.booked.length === 1) return { facilities: ctx.booked };
  if (ctx.booked.length === 0) return { question: NOTHING_TO_MODIFY };
  const names = ctx.booked.map((f) => shortFacilityLabel(f, ctx.relationship)).filter(Boolean);
  return whichMember(
    `Which member should this land on? The package has ${ctx.booked.length}: ${names.join(", ")}.`,
    ctx.booked,
    ctx,
    fields,
  );
}

/**
 * WHICH OF THE CHOICES AN ANSWER NAMES, out of the set the question offered.
 *
 * The chip's own label first, then the org's label and the record id, then the
 * committed figure in whatever form it was written: "the $15M one", "15
 * million" and "Line of Credit $15M" are all the same answer.
 */
function pickMembers(text: string, choices: Facility[], relationship: string): Facility[] {
  const lower = text.toLowerCase().trim();
  if (/^(?:both|all)\b/.test(lower)) return choices;
  const byName = choices.filter((f) =>
    [memberChipLabel(f, relationship), shortFacilityLabel(f, relationship), f.name ?? "", f.loanId ?? ""]
      .map((t) => t.toLowerCase().trim())
      .some((t) => t.length > 2 && lower.includes(t)),
  );
  if (byName.length) return byName;
  const tokens = moneyTokens(lower);
  return tokens.length
    ? choices.filter((f) => typeof f.committed === "number" && tokens.some((t) => t.value === f.committed))
    : [];
}

/** The clarify a member question becomes: the question, its chips, and the line
 *  that raised it, held so the answer completes it rather than restating it. */
function memberClarify(ask: TargetAsk, said: string, field: CatalogField): ParseOutcome {
  return {
    kind: "clarify",
    question: ask.question,
    options: ask.options,
    awaiting: ask.choices?.length ? { field, facility: null, member: { said, choices: ask.choices } } : undefined,
  };
}

/**
 * THE MEMBER'S OWN NAME IS NOT A VALUE.
 *
 * nCino names a loan "<Borrower> - <Product> - <$Amount>", so a line that names
 * the member by its label carries that member's CURRENT figure inside the name.
 * Read naively, "increase the Line of Credit - $15,000,000.00" becomes a change
 * to fifteen million, the number the facility already reads at. So the
 * identity the line matched on is removed before any value is read out of it.
 */
function scrubIdentity(text: string, facilities: Array<Facility | null>, relationship: string): string {
  let out = text;
  for (const f of facilities) {
    if (!f) continue;
    for (const token of identityTokens(f, relationship)) {
      if (token.length < 3) continue;
      const at = out.toLowerCase().indexOf(token);
      if (at >= 0) out = `${out.slice(0, at)} ${out.slice(at + token.length)}`;
    }
  }
  return out;
}

/* ----------------------------------------------------- net-new covenant read

   THE TYPE MAP IS DELIBERATELY PARTIAL. The org's catalog carries 60 covenant
   types, several with DUPLICATE names ("Minimum Working Capital" twice,
   "Minimum Times Interest Earned" twice, two distinct DSCR-with-distributions
   rows); the server refuses an ambiguous name and demands an id. So the room
   maps only banker vocabulary that lands on a UNIQUELY-NAMED catalog type, and
   everything else stays a manifest handoff, named, never guessed. */

const COVENANT_TYPE_MAP: Array<{ match: RegExp; typeName: string; defaultOp: "<=" | ">=" }> = [
  { match: /\bleverage\b/, typeName: "Leverage", defaultOp: "<=" },
  { match: /\bliquidity\b/, typeName: "Minimum Liquidity", defaultOp: ">=" },
  { match: /\b(dscr|debt service coverage)\b/, typeName: "Debt Service Coverage of Borrower", defaultOp: ">=" },
  { match: /\bdebt.to.worth\b/, typeName: "Maximum Debt to Worth", defaultOp: "<=" },
  { match: /\bcurrent ratio\b/, typeName: "Minimum Current Ratio", defaultOp: ">=" },
  { match: /\bnet worth\b/, typeName: "Net Worth", defaultOp: ">=" },
  { match: /\bebitda\b/, typeName: "EBITDA", defaultOp: ">=" },
  { match: /\bdebt.to.equity\b/, typeName: "Debt to Equity", defaultOp: "<=" },
  { match: /\bnet profit\b/, typeName: "Net Profit", defaultOp: ">=" },
];

/**
 * Reads a net-new covenant out of the line: catalog type, threshold, operator.
 * Returns null when the type is not one the map can settle (the caller keeps
 * the honest handoff), and a QUESTION when the type is known but the threshold
 * is not, the threshold IS the covenant, and the room never picks one.
 */
function readCovenant(lower: string): { value: ParsedValue } | { question: string } | null {
  const mapped = COVENANT_TYPE_MAP.find((m) => m.match.test(lower));
  if (!mapped) return null;

  // "maximum 3.5x" wording beats the type's own default; the default only
  // settles a line that states the figure bare.
  const op: "<" | "<=" | "=" | ">=" | ">" = /\b(max|maximum|no more than|not exceed|not to exceed|under|below|cap|at most)\b/.test(lower)
    ? "<="
    : /\b(min|minimum|at least|above|over|floor|no less than)\b/.test(lower)
      ? ">="
      : mapped.defaultOp;

  // A ratio covenant reads "3.5x" or "1.25x"; a dollar covenant (liquidity, net
  // worth, EBITDA) reads money. A bare number is accepted only when an operator
  // word anchors it, "max 3.5" is a threshold, a lone "3.5" is not.
  const ratio = /(\d+(?:\.\d+)?)\s*x\b/.exec(lower);
  const money = moneyTokens(lower).at(-1);
  const anchored = /(?:max(?:imum)?|min(?:imum)?|at least|at most|under|below|above|over|of|to)\s+(\d+(?:\.\d+)?)(?:\s|$|[.,;])/.exec(lower);
  const threshold = ratio ? Number(ratio[1]) : money ? money.value : anchored ? Number(anchored[1]) : null;
  if (threshold === null) {
    return {
      question:
        `What threshold should the ${mapped.typeName} covenant test? The threshold IS the covenant, say it like "maximum 3.5x" or "at least $5,000,000".`,
    };
  }

  return {
    value: {
      kind: "covenant",
      typeName: mapped.typeName,
      threshold,
      operator: op,
      text: `${mapped.typeName} ${op} ${ratio ? ratio[1] + "x" : money ? money.text : String(threshold)}`,
    },
  };
}

/* ---------------------------------------------------------- net-new fee read

   THE ORG'S FEE-TYPE PICKLIST IS RESIDENTIAL. Live describe, 2026-08-31: it
   carries Appraisal, Attorney, Credit Report, Loan Origination, Survey, Title
   Insurance and a long tail of closing costs, and NO commitment, unused,
   facility, amendment, agency or waiver value. That is a real finding about
   this org's fee model rather than a lookup failure, so the map below does two
   different things with one shape: banker vocabulary that lands on a legal
   value uses it, and the C&I fees the picklist cannot express file as the legal
   value "Other" with the banker's own words as the label. Nothing is invented,
   and nothing is silently renamed into a fee type nobody said.

   `recordType` is the INDEPENDENT picklist LLC_BI__Record_Type__c, not a record
   type id: no Fee record type is assigned to the integration user's profile, so
   RecordTypeId is refused outright by the org (recon Task 1, finding 1). Income
   fees are "Fees"; third-party pass-through costs are "Costs". */

const FEE_TYPE_MAP: Array<{ match: RegExp; said: string; typeName: string; recordType: "Fees" | "Costs" }> = [
  { match: /\b(origination|arrangement|upfront|up[- ]front|front[- ]end|structuring)\b/, said: "Origination fee", typeName: "Loan Origination", recordType: "Fees" },
  { match: /\b(attorney|legal|counsel|documentation)\b/, said: "Attorney fee", typeName: "Attorney", recordType: "Fees" },
  { match: /\b(appraisal|reappraisal)\b/, said: "Appraisal fee", typeName: "Appraisal", recordType: "Costs" },
  { match: /\bsurvey\b/, said: "Survey fee", typeName: "Survey", recordType: "Costs" },
  { match: /\bcredit report\b/, said: "Credit report fee", typeName: "Credit Report", recordType: "Costs" },
  { match: /\btitle\b/, said: "Title insurance fee", typeName: "Title Insurance", recordType: "Costs" },
  // Below here the picklist has nothing, so the legal value is "Other" and the
  // description carries what the banker actually called it.
  { match: /\b(unused|non[- ]utilisation|non[- ]utilization)\b/, said: "Unused commitment fee", typeName: "Other", recordType: "Fees" },
  { match: /\b(commitment|facility)\s+fee\b/, said: "Commitment fee", typeName: "Other", recordType: "Fees" },
  { match: /\bamendment\b/, said: "Amendment fee", typeName: "Other", recordType: "Fees" },
  { match: /\b(waiver|consent)\b/, said: "Waiver fee", typeName: "Other", recordType: "Fees" },
  { match: /\b(agency|agent)\b/, said: "Agency fee", typeName: "Other", recordType: "Fees" },
];

/** The kinds offered as chips when the line says "fee" and nothing else. Each
 *  one is a phrase this same reader resolves, so a click is a typed answer. */
const FEE_TYPE_OPTIONS = [
  "Origination fee",
  "Commitment fee",
  "Amendment fee",
  "Attorney fee",
  "Appraisal fee",
  "Agency fee",
];

/** An exact money reading for the fee's own label. `fmtMoney` abbreviates to
 *  "$5K", which is a fine chip and a poor description on a bank record. */
function exactMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Reads a net-new fee out of the line: the org's legal fee type, the label, and
 * either a percentage or a flat amount. A missing half is a QUESTION carrying
 * what was already read, so the answer can be the missing half alone.
 */
function readFee(lower: string, held?: FeeRead): { value: ParsedValue } | { question: string; options?: string[]; fee: FeeRead } {
  const mapped = FEE_TYPE_MAP.find((m) => m.match.test(lower));
  const pct = percentTokens(lower).at(-1);
  const money = moneyTokens(lower).at(-1);
  const fee: FeeRead = {
    typeName: mapped?.typeName ?? held?.typeName,
    said: mapped?.said ?? held?.said,
    recordType: mapped?.recordType ?? held?.recordType,
    percentage: pct ? pct.value : held?.percentage,
    amount: money ? money.value : held?.amount,
  };

  if (!fee.typeName || !fee.said || !fee.recordType) {
    return {
      question:
        "What kind of fee? The org's own fee list is a closing-cost set, so a commercial fee files as Other with your words as the label, but I will not pick the kind for you.",
      options: FEE_TYPE_OPTIONS,
      fee,
    };
  }
  if (fee.percentage !== undefined && fee.amount !== undefined) {
    return {
      question: `Is the ${fee.said.toLowerCase()} ${fee.percentage}% or ${exactMoney(fee.amount)}? A fee is one or the other: on a percentage fee the org computes the money itself from the commitment, so a figure beside it would contradict what it works out.`,
      // Both readings are dropped, because keeping either would decide the
      // question the banker is being asked.
      fee: { ...fee, percentage: undefined, amount: undefined },
    };
  }
  if (fee.percentage === undefined && fee.amount === undefined) {
    return {
      question: `How much is the ${fee.said.toLowerCase()}? A percentage of the commitment ("1%", "25bps") or a flat amount ("$5,000").`,
      fee,
    };
  }

  const percentage = fee.percentage;
  const figure = percentage !== undefined ? `${percentage.toFixed(2)}% of the committed amount` : exactMoney(fee.amount!);
  return {
    value: {
      kind: "fee",
      feeType: fee.typeName,
      noun: fee.said,
      description: `${fee.said} - ${figure}`,
      calculationType: percentage !== undefined ? "Percentage" : "Flat Amount",
      percentage,
      amount: percentage !== undefined ? undefined : fee.amount,
      recordType: fee.recordType,
      text: figure,
    },
  };
}

/* ------------------------------------------------------------- pledge read

   TWO VERBS THROUGH ONE READER, because they are the same ask with a different
   answer to one question: does the bank already hold this asset?

   PLEDGE EXISTING resolves the banker's words against THE COLLATERAL THE DEAL
   ITSELF CARRIES, the pledges on the package's own facilities, deduped by
   collateral id, because a cross-pledged asset appears on every facility it
   secures and counting it twice is the double-count the coverage math exists to
   avoid. What travels is the org's record id. A phrase matching two assets, or
   none, is a QUESTION naming what the deal actually holds: there is no asset
   this room will pick on the banker's behalf, and no name it will send instead
   of an id.

   CREATE-THEN-PLEDGE authors the whole chain, and the org's model dictates its
   shape: `LLC_BI__Collateral__c` has NO account lookup at all, so the borrower
   link is the separate `LLC_BI__Account_Collateral__c` ownership junction, and
   the pledge to the clone comes third. `Name` on a collateral is an autonumber,
   so the banker's own words ride the description exactly as a fee's label does.

   THE ADVANCE RATE IS REQUIRED and it is never defaulted. It is a credit
   decision on an asset nobody has lent against before, and it lands on the
   PLEDGE as `LLC_BI__Advance_Rate_Override__c`, `LLC_BI__Advance_Rate__c` is a
   formula, and the org's own `Advance_Rate_Override` rule then demands a written
   reason beside it, which the stage arm composes as provenance rather than as a
   credit justification nobody gave. */

/** One asset the deal already carries, as this room can name it. */
interface DealCollateral {
  id: string;
  /** The description where the read carries one, the autonumber otherwise. */
  label: string;
  /** The org's autonumber (COL-000762), which names exactly one row. */
  name?: string;
}

/** Every distinct collateral the package's own pledges reach, deduped by id.
 *  An asset with no id is deliberately dropped: a pledge needs the org's record,
 *  and a row this read could not identify is not one to send. */
function dealCollateral(ctx: ParseContext): DealCollateral[] {
  const byId = new Map<string, DealCollateral>();
  for (const f of ctx.facilities) {
    for (const c of f.collateral ?? []) {
      if (!c.collateralId || byId.has(c.collateralId)) continue;
      byId.set(c.collateralId, {
        id: c.collateralId,
        label: c.collateralDescription ?? c.collateralName ?? c.collateralType ?? c.collateralId,
        name: c.collateralName,
      });
    }
  }
  return [...byId.values()];
}

/** Words that name no asset in particular, so a hit on one proves nothing. */
const ASSET_STOP = new Set(["the", "and", "for", "llc", "inc", "collateral", "asset", "assets", "value", "loan", "pledge"]);

/** The assets a line could mean, best match first. An exact id or autonumber
 *  names one row and settles it; otherwise the distinctive words of each label
 *  are counted, and only the top score survives. */
function matchDealCollateral(phrase: string, pool: DealCollateral[]): DealCollateral[] {
  const scored: Array<{ c: DealCollateral; score: number }> = [];
  for (const c of pool) {
    if (phrase.includes(c.id.toLowerCase())) return [c];
    if (c.name && c.name.length > 3 && phrase.includes(c.name.toLowerCase())) return [c];
    const tokens = c.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3 && !ASSET_STOP.has(t));
    const score = tokens.filter((t) => phrase.includes(t)).length;
    if (score) scored.push({ c, score });
  }
  if (!scored.length) return [];
  const top = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === top).map((s) => s.c);
}

/** THE ASSET IS NET-NEW. "purchase" and "acquire" are deliberately absent: the
 *  org's product picklist carries a Purchase facility, and a line pledging to it
 *  would read its own target as a statement about the asset. */
const NEW_ASSET = /\b(new|newly|another|additional|just\s+(?:bought|financed)|not\s+on\s+the\s+deal)\b/;

/** The kinds of asset a banker names, and the word each one sends to the org.
 *  The org keeps 43 collateral-type records and this client holds none of them,
 *  so the word is a PROPOSAL that stage resolves against the real catalog and
 *  refuses with the org's own list. */
const ASSET_TYPE_MAP: Array<{ match: RegExp; said: string; typeWord: string }> = [
  { match: /\b(equipment|machine|machines|machinery|tooling|press|lathe|cnc|forklift)\b/, said: "equipment", typeWord: "Equipment" },
  { match: /\b(warehouse|building|plant|premises|real\s*estate|property|land)\b/, said: "real estate", typeWord: "Real Estate" },
  { match: /\b(inventory|raw\s+materials?|finished\s+goods)\b/, said: "inventory", typeWord: "Inventory" },
  { match: /\b(receivables?|accounts\s+receivable|a\/r)\b/, said: "receivables", typeWord: "Accounts Receivable" },
  { match: /\b(vehicles?|trucks?|trailers?|fleet)\b/, said: "vehicles", typeWord: "Vehicle" },
  { match: /\b(securities|deposits?|certificate\s+of\s+deposit)\b/, said: "cash and securities", typeWord: "Cash" },
];

/** Offered as chips when the kind is the missing half. Each is a phrase this
 *  same reader resolves, so a click is a typed answer. */
const ASSET_TYPE_OPTIONS = ["Equipment", "Real estate", "Inventory", "Accounts receivable", "Vehicles", "Securities"];

/** The facility the pledge lands on, which is the target rather than the asset.
 *  Stripped before anything is read, or "pledge the warehouse to the equipment
 *  loan" reads its own destination as the kind of asset. */
const PLEDGE_CLAUSE = /\s+\b(?:to|onto|on|against|under|for)\s+(?:the|our|this)\b.*$/i;
const PLEDGE_LEAD = /^\s*(?:please\s+)?(?:add|pledge|attach|include|take\s+security\s+over|secure\s+it\s+with)\b\s*/i;

/** The banker's own words for the asset, which become its readable label. */
function readAssetNoun(text: string): string | undefined {
  const s = text
    .replace(PLEDGE_CLAUSE, "")
    .replace(PLEDGE_LEAD, "")
    .replace(/\bas\s+(?:new\s+|additional\s+)*collateral\b/gi, "")
    .replace(/\bat\s+an?\s+advance\s+rate\s+of\b/gi, "")
    .replace(/\badvance\s+rate\b/gi, "")
    .replace(/(\$\s*)?\d[\d,]*(?:\.\d+)?\s*(?:mm|million|millions|bn|billion|k|m|b)?\b/gi, "")
    .replace(/\d+(?:\.\d+)?\s*(?:%|per\s?cent|percent|bps|basis\s+points?)/gi, "")
    .replace(/^\s*(?:an?|the)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
  return s.length > 2 ? s[0].toUpperCase() + s.slice(1) : undefined;
}

/**
 * Reads a pledge out of the line: an existing asset resolved to the org's own
 * record id, or a net-new asset complete enough to author. A missing piece is a
 * QUESTION carrying what was already read.
 */
function readPledge(
  text: string,
  lower: string,
  ctx: ParseContext,
  held?: PledgeRead,
): { value: ParsedValue } | { question: string; options?: string[]; pledge: PledgeRead } {
  // The destination is not the asset, so it goes before anything is read.
  const phrase = lower.replace(PLEDGE_CLAUSE, "");
  const wantsNew = held?.isNew === true || NEW_ASSET.test(phrase);

  if (!wantsNew) {
    const pool = dealCollateral(ctx);
    const hits = matchDealCollateral(phrase, pool);
    if (hits.length === 1) {
      return {
        value: { kind: "pledge", collateralId: hits[0].id, noun: hits[0].label, text: "pledged on the modification" },
      };
    }
    if (hits.length > 1) {
      return {
        question: `The deal carries ${hits.length} assets that could be it: ${hits
          .map((h) => h.label)
          .join(", ")}. Which one? A pledge sends the org's own collateral record, so I will not choose between them.`,
        options: hits.map((h) => h.label),
        pledge: {},
      };
    }
    const names = pool.map((c) => c.label);
    return {
      question: names.length
        ? `I could not find that asset among the ${names.length} this deal carries: ${names.join(
            ", ",
          )}. Which of those is it, or say it is a NEW asset and I will create it, take the ownership down and pledge it.`
        : "This read carries no collateral on the deal, so there is nothing here to pledge by name. Say it is a NEW asset and what it is, and I will create it, record the borrower's ownership and pledge it to the modification.",
      options: [...names, "A new asset"],
      pledge: {},
    };
  }

  const mapped = ASSET_TYPE_MAP.find((m) => m.match.test(phrase));
  const money = moneyTokens(phrase).at(-1);
  const pct = percentTokens(phrase).at(-1);
  const pledge: PledgeRead = {
    isNew: true,
    assetType: mapped?.typeWord ?? held?.assetType,
    said: readAssetNoun(text) ?? held?.said,
    value: money ? money.value : held?.value,
    advanceRate: pct ? pct.value : held?.advanceRate,
  };

  if (!pledge.assetType) {
    return {
      question:
        "What kind of asset is it? The org keeps its own collateral-type catalog and resolves the word against it, I will not invent a type, and a type it does not hold comes back with the list it does.",
      options: ASSET_TYPE_OPTIONS,
      pledge,
    };
  }
  const noun = pledge.said ?? `New ${mapped?.said ?? pledge.assetType.toLowerCase()} collateral`;
  if (pledge.value === undefined) {
    return { question: `What is it worth? Say it in full, $2,000,000 or 2 million; I will not read a bare number as money.`, pledge };
  }
  if (pledge.advanceRate === undefined) {
    return {
      question: `What advance rate does the bank lend against it at? The rate is a credit decision on an asset nobody has lent against yet, so there is no default here, the org records it as an override on the pledge and keeps the reason with it.`,
      pledge,
    };
  }

  return {
    value: {
      kind: "pledge",
      create: {
        description: noun.slice(0, 255),
        collateralType: pledge.assetType,
        value: pledge.value,
        advanceRate: pledge.advanceRate,
      },
      noun,
      text: `created and pledged, ${exactMoney(pledge.value)} at ${pledge.advanceRate}% advance`,
    },
  };
}

/* --------------------------------------------------- policy exception read

   AN EXCEPTION IS A NARRATIVE, and that is what makes it different from every
   other entry in this file. A commitment change names a field and a figure; an
   exception names WHAT IS OUT OF POLICY, in the vocabulary of the thing that is
   out of policy, "advance rate above guideline", "leverage through the covenant
   ceiling", "commitment over the hold limit". Those words are the exception's
   own title and not a second amendment, which is why `parseModify` gives this
   entry the rest of its line and why the reader below is handed that clause
   rather than the whole sentence.

   THREE FACTS, ASKED FOR IN THE ORDER THEY MATTER:

     THE TITLE is the row's only readable identity. `Name` here is plain text
     rather than an autonumber, and an omitted one is worse than either: the
     org's trigger stack backfills it with the record's own Id, so a demo ends
     up with an exception called a4rbb000003OwSX. It is required, it is never
     invented, and a line that carries no words of its own is a question.

     THE STATUS is a credit judgement between Waived, Mitigated and Unmitigated.
     The org defaults a new row to Unmitigated, which READS AS A DECISION rather
     than as an absent value, a bank looking at the file cannot tell "nobody
     said" from "nobody mitigated it", so the room asks rather than taking it.

     THE MITIGANT is what stands behind a Mitigated status, and a Mitigated
     exception without one is a claim with nothing under it. Each rides its own
     `LLC_BI__Mitigation_Reason_N__c`, three of them, ONE HUNDRED CHARACTERS
     EACH. A longer one is refused with its length: truncating a mitigant leaves
     a sentence that stops mid-clause on a credit record, and splitting one
     across the three fields would file one mitigant as three, which is exactly
     what the org's own hand-authored row uses those fields to distinguish.

   SEVERITY IS FREE TEXT on this org and "Major" is a convention rather than a
   picklist, so it travels only where the banker LABELLED it as severity. The
   numeric companion `LLC_BI__Severity_Value__c` never travels at all: the one
   row this org holds by hand reads Major = 2.0, and a scale inferred from a
   single point is invented rather than read.                                  */

/** A stated severity, and only a stated one: the room does not read "major" out
 *  of a banker's prose and file it as a bank grading. */
const SEVERITY_WORDS = "major|minor|moderate|material|critical";
const SEVERITY_SAID = new RegExp(
  `\\b(?:severity\\s*(?:is\\s*|[:=]\\s*)?(${SEVERITY_WORDS})|(${SEVERITY_WORDS})\\s+severity)\\b`,
  "i",
);
/** The same phrase seen from the title's side, with the comma that introduced
 *  it: a severity is a field of its own and never part of the row's name. */
const SEVERITY_TAIL = new RegExp(
  `[,;]?\\s*(?:and\\s+|with\\s+)?(?:severity\\s*(?:is\\s*|[:=]\\s*)?(?:${SEVERITY_WORDS})|(?:${SEVERITY_WORDS})\\s+severity)\\b`,
  "gi",
);

/** The bank's decision, seen from the title's side. "mitigated" is deliberately
 *  absent: MITIGATION_TAIL below already claims it and everything after it. */
const STATUS_TAIL =
  /[,;]?\s*(?:and\s+)?\b(?:status\s*(?:is\s*|[:=]\s*)?)?(?:unmitigated|waived|waive it|waive this|as a waiver)\b/gi;

/** Where a mitigant clause starts, and everything after it belongs to it. */
const MITIGATION_LEAD = /\bmitigat(?:ed|ing|ion|ions|ant|ants)\b\s*(?:by|with|are|is|:)?\s*/i;
/** The same clause seen from the title's side: it is the exception's answer,
 *  not its name, so the title stops where it begins. */
const MITIGATION_TAIL = /[,;]?\s*(?:and\s+)?\bmitigat(?:ed|ing|ion|ions|ant|ants)\b[\s\S]*$/i;

/** 80 on `Name`, 100 on each mitigation reason, 50 on `LLC_BI__Severity__c`
 *  (live describe 2026-08-31). Each one refuses rather than truncating. */
const EXCEPTION_TITLE_MAX = 80;
const MITIGATION_REASON_MAX = 100;
const EXCEPTION_REASON_SLOTS = 3;

const EXCEPTION_STATUS_OPTIONS: ExceptionStatus[] = ["Waived", "Mitigated", "Unmitigated"];

/** The status the line states, if it states one. "Unmitigated" is tested first
 *  for readability only, the word boundary already keeps `\bmitigated\b` from
 *  firing inside it. */
function readExceptionStatus(lower: string): ExceptionStatus | undefined {
  if (/\bunmitigated\b/.test(lower)) return "Unmitigated";
  if (/\b(?:waived|waive it|waive this|as a waiver)\b/.test(lower)) return "Waived";
  // MITIGATION_LEAD's trailing "by / with / :" is optional, so a bare "mitigated"
  // matches it too and the status needs no second test of its own.
  if (MITIGATION_LEAD.test(lower)) return "Mitigated";
  return undefined;
}

/** The banker's own words for what is out of policy, with everything that is a
 *  field of its own taken off: the mitigant, the member, the severity, and the
 *  verb-and-noun they opened with. */
function readExceptionTitle(clause: string): string | undefined {
  const s = clause
    .replace(MITIGATION_TAIL, "")
    .replace(FACILITY_CLAUSE, "")
    .replace(SEVERITY_TAIL, "")
    .replace(STATUS_TAIL, "")
    .replace(/^\s*(?:please\s+)?(?:log|logged|record|raise|grant|note|add|register|file)\s+/i, "")
    .replace(/^\s*(?:an?|the)\s+/i, "")
    .replace(/^\s*(?:policy\s+)?(?:exception|waiver)\b/i, "")
    .replace(/^\s*(?:to|against)\s+policy\b/i, "")
    .replace(/^\s*[:\-–,]\s*/, "")
    .replace(/^\s*(?:for|on|about|regarding|covering|to|because\s+of)\b\s*/i, "")
    .replace(/^\s*(?:an?|the)\s+/i, "")
    // Taking a clause out mid-sentence leaves the comma that introduced the NEXT
    // one behind it, and sometimes the conjunction that joined them, "advance
    // rate above guideline, though" once the mitigant clause after "though" was
    // claimed. Both are tidied once at the end rather than by every strip above
    // guessing at its own neighbours. No conjunction below can legitimately end
    // an exception's name.
    .replace(/\s*,\s*(?=,)/g, "")
    .replace(/[,;]?\s*\b(?:though|although|but|however|while|whereas|and|with|as)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[\s.,;:]+$/, "");
  return s.length > 2 ? s[0].toUpperCase() + s.slice(1) : undefined;
}

/** The mitigants the line states. Split on semicolons and line breaks ONLY: "and"
 *  joins two mitigants as often as it sits inside one ("fixed-price contract and
 *  5% retainage" is a single mitigant), and guessing wrong files one reason as
 *  two or two as one. */
function readMitigants(clause: string): string[] {
  const at = MITIGATION_LEAD.exec(clause);
  if (!at) return [];
  return tidyMitigants(clause.slice(at.index + at[0].length));
}

function tidyMitigants(text: string): string[] {
  return text
    .split(/[;\n]+/)
    .map((r) => r.trim().replace(/[.,;:]+$/, ""))
    .filter((r) => r.length > 2);
}

/**
 * Reads a policy exception out of the banker's own clause: what is out of
 * policy, what the bank decided, and what stands behind that decision. A missing
 * piece is a QUESTION carrying everything already read.
 */
function readException(
  clause: string,
  lower: string,
  held?: ExceptionRead,
): { value: ParsedValue } | { question: string; options?: string[]; exception: ExceptionRead } {
  const saidStatus = readExceptionStatus(lower);
  // THE TITLE, ONCE SETTLED, IS NEVER RE-READ. Every question after the first is
  // about something else, so "Mitigated" typed into the status question must not
  // become the name of the exception.
  const title = held?.title ?? readExceptionTitle(clause);
  const status = saidStatus ?? held?.status;
  const said = SEVERITY_SAID.exec(clause)?.slice(1).find(Boolean)?.toLowerCase();
  const severity = said ? said[0].toUpperCase() + said.slice(1) : held?.severity;

  // A BARE LINE ANSWERS THE MITIGANT QUESTION. It can only be one when the
  // question was actually asked, the title settled, the status already reading
  // Mitigated before this line, and no mitigant held yet, and a line that
  // states a status of its own is the banker changing their mind rather than
  // naming a mitigant.
  const stated = readMitigants(clause);
  const awaitingMitigant =
    Boolean(held?.title) && held?.status === "Mitigated" && !(held?.reasons ?? []).length && !saidStatus;
  const reasons = stated.length
    ? stated
    : awaitingMitigant
      ? tidyMitigants(clause)
      : (held?.reasons ?? []);

  const carried: ExceptionRead = { title, status, reasons, severity };

  if (!title) {
    return {
      question:
        "What should the exception be called? It is the only readable identity the record carries, the org backfills an omitted name with the record's own Id, so say what is out of policy in your own words.",
      exception: carried,
    };
  }
  if (title.length > EXCEPTION_TITLE_MAX) {
    return {
      question: `"${title}" is ${title.length} characters and the exception's name holds ${EXCEPTION_TITLE_MAX}. Give me a shorter one, I will not cut it off mid-sentence on a credit record.`,
      exception: { ...carried, title: undefined },
    };
  }
  if (!status) {
    return {
      question: `Is "${title}" waived, mitigated, or standing unmitigated? The org defaults a new exception to Unmitigated, which reads as a decision rather than as nobody having said, so I will not take that default for you.`,
      options: EXCEPTION_STATUS_OPTIONS,
      exception: carried,
    };
  }
  // "NOTHING MITIGATES THIS" AND "HERE IS WHAT MITIGATES IT" cannot both be on
  // one record, and the org refuses the pair at stage time, so the room asks
  // rather than composing a chip that would come back refused. Both readings are
  // dropped: keeping the mitigants would make an answer of "Unmitigated" loop
  // straight back into this same question.
  if (status === "Unmitigated" && reasons.length) {
    return {
      question: `"${title}" cannot be both unmitigated and mitigated by ${reasons[0]}. Which is it? The bank's file has to say one or the other.`,
      options: ["Mitigated", "Unmitigated"],
      exception: { ...carried, status: undefined, reasons: [] },
    };
  }
  if (status === "Mitigated" && !reasons.length) {
    return {
      question: `What mitigates it? A mitigated exception with nothing recorded beside it is a claim the credit file cannot stand on. Say each mitigant on its own, separated by a semicolon.`,
      exception: carried,
    };
  }
  if (reasons.length > EXCEPTION_REASON_SLOTS) {
    return {
      question: `The org holds ${EXCEPTION_REASON_SLOTS} mitigation reasons on an exception and this line carries ${reasons.length}. Give me the ${EXCEPTION_REASON_SLOTS} that matter, I will not drop the rest quietly.`,
      exception: { ...carried, reasons: [] },
    };
  }
  const tooLong = reasons.find((r) => r.length > MITIGATION_REASON_MAX);
  if (tooLong) {
    return {
      question: `"${tooLong}" is ${tooLong.length} characters and a mitigation reason holds ${MITIGATION_REASON_MAX}. Shorten it, or split it into separate mitigants with a semicolon, I will not truncate a mitigant on a credit record.`,
      exception: { ...carried, reasons: [] },
    };
  }

  return {
    value: {
      kind: "policyException",
      title,
      status,
      reasons,
      severity,
      text:
        status === "Mitigated"
          ? `mitigated by ${reasons[0]}${reasons.length > 1 ? ` (+${reasons.length - 1} more)` : ""}`
          : `logged as ${status.toLowerCase()}`,
    },
  };
}

/* ===========================================================================
   A MOVE IS NOT A TARGET (A2 audit, 2026-09-12).

   "increase the Line of Credit by $5M" on a $15M line was staged as a
   commitment of $5,000,000: a two-thirds CUT, filed under the word "increase",
   with the room reporting "1 of these goes on the clone" and no check on it.
   "add 50bps" on a 7.6% rate staged 0.5%. Both are the most natural sentence a
   C&I banker writes, and both produced a plan that says the opposite of what
   was asked.

   So a relative line is COMPUTED off the figure the read carries, and where the
   read carries no figure it is a question rather than a guess. The tell is a
   direction word with no target marker: "to", "at" and "becomes" all name a
   target, and a line carrying one is read exactly as it always was.
   =========================================================================== */

/** Words that move a figure UP. */
const MOVE_UP = /\b(increase[sd]?|increasing|raise[sd]?|raising|add|adds|added|adding|plus|bump|bumps|bumped|up)\b/i;
/** Words that move a figure DOWN. */
const MOVE_DOWN = /\b(reduce[sd]?|reducing|lower|lowers|lowered|lowering|cut|cuts|decrease[sd]?|decreasing|drop|drops|dropped|shave[sd]?|down|minus|less|off)\b/i;
/** A target marker. "take it to $19M" and "price it at 810 bps" are absolutes. */
const NAMES_A_TARGET = /\b(?:to|at|becomes?|of)\s+(?:\$\s*)?\d/i;

/** Which way this line moves a figure, or 0 where it names a target. */
function moveDirection(lower: string): 1 | -1 | 0 {
  if (NAMES_A_TARGET.test(lower)) return 0;
  if (MOVE_DOWN.test(lower)) return -1;
  if (MOVE_UP.test(lower)) return 1;
  return 0;
}

/** Is the token at `index` written with a minus in front of it? A sign the
 *  tokenisers drop is a figure the banker never typed, and staging 5% off "-5%"
 *  is the room putting a number in their mouth. */
function negated(lower: string, index: number): boolean {
  return /[-\u2212]\s*$/.test(lower.slice(0, index));
}

/** Read the value for ONE catalog field out of the line. */
function readValue(
  field: CatalogField,
  text: string,
  lower: string,
  match: CatalogMatch,
  facility: Facility | null,
  ctx: ParseContext,
):
  | { value: ParsedValue }
  | { question: string; options?: string[]; fee?: FeeRead; pledge?: PledgeRead; exception?: ExceptionRead }
  | { value: null } {
  if (field.type === "currency") {
    const tokens = moneyTokens(lower);
    if (!tokens.length) {
      // A bare number is a question, never money. This is the "increase the
      // line to 20" case, and twenty of what is the banker's to say.
      return /\bto\s+\d/.test(lower)
        ? { question: "Say the amount in full, $20,000,000 or 20 million. I will not read a bare number as money." }
        : { question: `What should ${field.label.toLowerCase()} become?` };
    }
    // "from 15 to 20 million", the target is the one after the last "to".
    const to = lower.lastIndexOf(" to ");
    const target = (to >= 0 ? tokens.filter((t) => t.index > to) : []).at(0) ?? tokens.at(-1)!;
    if (negated(lower, target.index)) {
      return {
        question: `A commitment is a positive figure, and I will not read a minus off the line as one. Say what ${field.label.toLowerCase()} should become, or say the move in words, for example "reduce it by ${exactMoney(target.value)}".`,
      };
    }
    // A MOVE IS COMPUTED OFF THE FIGURE ON FILE, never staged as the target.
    const way = field.id === "loan.amount" ? moveDirection(lower) : 0;
    if (way !== 0) {
      const held = typeof facility?.committed === "number" ? facility.committed : null;
      if (held === null) {
        return {
          question: `This read carries no committed amount for that member, so there is nothing here to move ${
            way > 0 ? "up" : "down"
          } from. Say what ${field.label.toLowerCase()} should become.`,
        };
      }
      const moved = held + way * target.value;
      if (moved <= 0) {
        return {
          question: `${exactMoney(target.value)} ${way > 0 ? "on" : "off"} ${exactMoney(held)} leaves ${exactMoney(
            moved,
          )}, and a commitment is a positive figure. Say what ${field.label.toLowerCase()} should become.`,
        };
      }
      return { value: { kind: "currency", amount: moved, text: `${target.text} ${way > 0 ? "on" : "off"} ${exactMoney(held)}` } };
    }
    return { value: { kind: "currency", amount: target.value, text: target.text } };
  }

  if (field.type === "percent" || field.type === "months" || field.type === "date") {
    if (field.id === "loan.interestRate") {
      // A SPREAD is not an absolute rate, and the tool writes an absolute rate.
      if (/\b(sofr|libor|prime|base\s+rate)\b/.test(lower)) {
        return {
          question:
            "That is a spread over an index, and the field the modification writes is an absolute rate. Give me the all-in rate as a percentage.",
        };
      }
      const pcts = percentTokens(lower);
      if (!pcts.length) return { question: "What rate should it move to? A percentage, or a move in basis points." };
      const last = pcts.at(-1)!;
      if (negated(lower, last.index)) {
        return {
          question: `A rate on this facility is an absolute figure, not a move, and I will not read a minus off the line as one. Say the all-in rate, or say the move in words, for example "lower it by ${last.value}%".`,
        };
      }
      // A MOVE IS COMPUTED OFF THE RATE ON FILE. The question itself offers "a
      // move in basis points", so a move has to mean one.
      const way = moveDirection(lower);
      if (way !== 0) {
        const held = typeof facility?.interestRate === "number" ? facility.interestRate : null;
        if (held === null) {
          return {
            question: `This read carries no rate for that member, so there is nothing here to move ${
              way > 0 ? "up" : "down"
            } from. Give me the all-in rate as a percentage.`,
          };
        }
        const moved = Math.round((held + way * last.value) * 1e6) / 1e6;
        if (moved <= 0) {
          return {
            question: `${last.text} ${way > 0 ? "on" : "off"} ${held}% leaves ${moved}%, which is not a rate this files. Give me the all-in rate as a percentage.`,
          };
        }
        return { value: { kind: "percent", rate: moved, text: `${last.text} ${way > 0 ? "on" : "off"} ${held}%` } };
      }
      return { value: { kind: "percent", rate: last.value, text: last.text } };
    }

    if (field.type === "months") {
      const months = monthTokens(lower);
      if (months.length) {
        const last = months.at(-1)!;
        return { value: { kind: "months", months: last.value, text: last.text } };
      }
      // THE LABEL ALREADY CARRIES THE UNIT. The org names these fields
      // "Amortized Term (Months)" and "Loan Term (Months)", so a banker who
      // quotes the org's own label and then states a figure HAS said the unit,
      // and asking "months or years?" back is the room failing to read its own
      // field name. The anchor word is still required, a length is a move to a
      // figure, and a figure sitting loose in a sentence is not one.
      const unit = /\((month|year)s?\)/i.exec(field.label);
      const stated = unit ? /\b(?:to|at|of)\s+(\d+(?:\.\d+)?)\b/.exec(lower) : null;
      if (unit && stated) {
        const said = Number(stated[1]);
        const isYears = unit[1].toLowerCase() === "year";
        return {
          value: { kind: "months", months: isYears ? Math.round(said * 12) : said, text: `${stated[1]} ${isYears ? "years" : "months"}` },
        };
      }
      /* NO EM DASH IN A BANKER-FACING SENTENCE (house rule). `bankerly` in
         `components/workroom/ask.ts` neutralises one on the way to the glass;
         it should not have to. */
      return { question: "How long is it, in months or years?" };
    }

    if (field.type === "date") {
      const read = readDate(lower);
      if (read?.iso) return { value: { kind: "date", iso: read.iso, text: read.text } };
      if (read?.dayMissing) {
        return { question: `${read.text} names a month. A ${field.label.toLowerCase()} is a day, and I will not pick one for you.` };
      }
      // "extend by 18 months" is a real, derivable maturity move, and ONLY a
      // maturity move. The baseline it shifts from is the member's own maturity,
      // so no other date field may borrow it (the field wave brought a second
      // one: a first payment date derived off maturity would be fiction).
      const months = monthTokens(lower);
      if (field.id === "loan.maturityDate" && months.length && /\b(extend|push|roll|out\s+by)\b/.test(lower)) {
        const shifted = shiftMaturity(facility?.maturityDate, months.at(-1)!.value);
        if (shifted) {
          return { value: { kind: "date", iso: shifted, text: `${months.at(-1)!.text} from ${facility?.maturityDate}` } };
        }
        return {
          question: "This member's maturity is not staged in the read, so there is nothing here to extend from. Give me the new maturity date.",
        };
      }
      return { question: `What should the new ${field.label.toLowerCase()} be?` };
    }

    const pcts = percentTokens(lower);
    if (pcts.length) return { value: { kind: "percent", rate: pcts.at(-1)!.value, text: pcts.at(-1)!.text } };
    return { value: null };
  }

  // A net-new covenant files (2026-08-30), so its read is exact or it is a
  // question: the type must map to the org's own catalog and the threshold must
  // be stated. A covenant the map does not know falls through to the manifest
  // handoff below, named, never guessed.
  if (field.id === "covenant.add") {
    const cov = readCovenant(lower);
    if (cov) return cov;
  }

  // A net-new fee files (2026-08-31) on the same terms: the type must land on a
  // legal picklist value and the figure must be stated, or it is a question.
  if (field.id === "fee.row") {
    return readFee(lower);
  }

  // A COLLATERAL PLEDGE files (2026-08-31) in either of its two shapes, and both
  // are exact: an existing asset resolves to the org's own record id off the
  // deal's own pledges, and a net-new one carries a kind, a value and an advance
  // rate or it is a question.
  if (field.id === "collateral.pledge") {
    return readPledge(text, lower, ctx);
  }

  // A POLICY EXCEPTION files (2026-08-31) and reads its OWN CLAUSE rather than
  // the line: everything from the banker's verb onward is the exception's own
  // narrative, and `parseModify` has already dropped the catalog matches inside
  // it. `match.index` is where that clause starts.
  if (field.id === "exception.record") {
    const clause = text.slice(match.index);
    const read = readException(clause, clause.toLowerCase());
    return "question" in read ? { question: read.question, options: read.options, exception: read.exception } : read;
  }

  // A PICKLIST IS THE ORG'S OWN CLOSED SET, so the value is quoted from it or it
  // is a question. Longest value first, because "Monthly" sits inside
  // "Bi-Monthly" and the shorter read would file a schedule nobody said. The
  // scan runs on the line the branch was handed, which is the SCRUBBED one: the
  // org names a loan "<Borrower> - <Product> - <$Amount>", so an unscrubbed line
  // carries a product picklist value inside the member's own name.
  if (field.type === "picklist" && field.values?.length) {
    const said = [...field.values].sort((a, b) => b.length - a.length).find((v) => wordIn(lower, v.toLowerCase()));
    if (said) return { value: { kind: "text", text: said } };
    // A FIELD THAT FILES ASKS, and names every value it would accept. One that
    // only ever travels as a handoff keeps the banker's own words instead:
    // sending them to pick off a list and then handing the ask off regardless
    // would be a question with nothing behind it.
    if (isFileable(field)) {
      return {
        question: `${field.label} takes one of the org's own values, and I will not write one it does not hold. The org offers: ${field.values.join(", ")}.`,
        options: field.values,
      };
    }
  }

  // Everything else is spoken about rather than filed, so a scalar is optional:
  // the amendment is the ask, and the handoff carries the banker's own words.
  const money = moneyTokens(lower).at(-1);
  const pct = percentTokens(lower).at(-1);
  if (field.type === "record" || field.type === "picklist" || field.type === "text" || field.type === "number") {
    if (money && field.type !== "picklist") return { value: { kind: "currency", amount: money.value, text: money.text } };
    if (pct) return { value: { kind: "percent", rate: pct.value, text: pct.text } };
    const tail = text.slice(match.index + match.matched.length).trim();
    return tail ? { value: { kind: "text", text: tail } } : { value: null };
  }
  return { value: null };
}

/**
 * THE ONE INFERENCE, and it is over a CLOSED SET.
 *
 * Of the four changes the modification tool carries, exactly one is money. So a
 * line that ESTABLISHES a member and moves a figure "to" something has only one
 * field it can mean, and reading it as the commitment is a deduction rather than
 * a guess. Both halves are required: without a member the line names nothing,
 * and without the "to" there is no move, a figure on its own is a fact about
 * the deal, not an instruction.
 *
 * A member is established by being NAMED, or by having been picked off the
 * package strip one turn ago. "Take it to twenty million" is a complete
 * instruction when the banker has just clicked the facility it refers to, and a
 * room that answered it with "which member?" would be a room asking about the
 * thing the banker had pointed at.
 */
/** A figure quoted in basis points. `bps` sits inside `50bps`, so the catalog's
 *  word-bounded synonyms never see it. */
const BPS_TOKEN = /\d\s*(?:bps|bp|basis\s+points?)\b/;

/**
 * THE SECOND INFERENCE, over the same closed set.
 *
 * "add 50bps on the line of credit" names a member and a move and no field at
 * all. A BASIS POINT IS A PRICE: nothing else this room files is quoted in one,
 * so a bps token is the rate and reading it as anything else is the room
 * inventing a field. A bare percentage needs a move verb or a TARGET MARKER as
 * well, because a percentage beside a member could be a great many things, and
 * only a move or a target makes it a price.
 *
 * THE TARGET HALF (0.9.23). `inferAmount` already reads "take the line to $19M"
 * as the commitment off the word "to"; the same sentence about a price, "take
 * the line of credit to 7.10%", read as nothing at all, and the room answered
 * that it had found the member but not what should change on it. A figure a
 * banker puts after "to" / "at" / "becomes" is an absolute, which is exactly
 * what `NAMES_A_TARGET` says, so the percentage carrying one is a price for the
 * same reason the money is a commitment.
 *
 * The value itself is read by the rate field's own reader, so a spread, a minus
 * and a move off the figure on file all behave exactly as they do when the
 * banker says the word "rate".
 */
function inferRate(text: string, lower: string, ctx: ParseContext): ParseOutcome | null {
  const pcts = percentTokens(lower);
  if (!pcts.length) return null;
  // A BARE PERCENTAGE IS A PRICE ONLY WHERE THE ROOM IS ALREADY STANDING ON ONE
  // MEMBER. "8%" on its own, one line after a change landed on the $15M line, is
  // that facility's rate; typed into an idle room it is a fact about the deal.
  const targeted = NAMES_A_TARGET.test(lower.slice(0, pcts.at(-1)!.index + 1));
  if (!BPS_TOKEN.test(lower) && moveDirection(lower) === 0 && !targeted && !ctx.focus) return null;
  const resolved = resolveTarget(lower, ctx, [FILEABLE_RATE]);
  if ("question" in resolved) return memberClarify(resolved, text, FILEABLE_RATE);
  const scrubbed = scrubIdentity(text, resolved.facilities, ctx.relationship);
  const scrubbedLower = scrubbed.toLowerCase();
  const at: CatalogMatch = { field: FILEABLE_RATE, matched: "", index: 0 };
  const amendments: Amendment[] = [];
  const said = percentTokens(scrubbedLower).at(-1)!;
  for (const facility of resolved.facilities) {
    // A MINUS IS TWO INSTRUCTIONS, and the room says both readings with the
    // figure each lands on rather than refusing with one of them.
    if (negated(scrubbedLower, said.index)) {
      const ask = signedFigureAsk(said, facility);
      return { kind: "clarify", question: ask.question, options: ask.options.length ? ask.options : undefined };
    }
    const read = readValue(FILEABLE_RATE, scrubbed, scrubbedLower, at, facility, ctx);
    if ("question" in read) {
      return { kind: "clarify", question: read.question, awaiting: { field: FILEABLE_RATE, facility } };
    }
    if (read.value === null) return null;
    amendments.push({ field: FILEABLE_RATE, facility, value: read.value, matched: read.value.text, op: "change" });
  }
  return amendments.length ? { kind: "amendments", amendments } : null;
}

function inferAmount(lower: string, ctx: ParseContext): ParseOutcome | null {
  const named = namedFacilities(lower, ctx).facilities;
  const established = named.length ? named : ctx.focus ? [ctx.focus] : [];
  if (!established.length) return null;
  const scrubbed = scrubIdentity(lower, established, ctx.relationship).toLowerCase();
  const to = scrubbed.lastIndexOf(" to ");
  if (to < 0) return null;
  const target = moneyTokens(scrubbed).find((t) => t.index > to);
  if (!target) return null;
  // THROUGH THE SAME GATE as a named field: booked only, nicknames resolved.
  const resolved = resolveTarget(lower, ctx, [FILEABLE_AMOUNT]);
  if ("question" in resolved) return memberClarify(resolved, lower, FILEABLE_AMOUNT);
  return {
    kind: "amendments",
    amendments: resolved.facilities.map((facility) => ({
      field: FILEABLE_AMOUNT,
      facility,
      value: { kind: "currency" as const, amount: target.value, text: target.text },
      matched: target.text,
      op: "change" as const,
    })),
  };
}

/**
 * ANSWER A QUESTION THE ROOM ASKED. The field and the member are already
 * settled; all that was missing is the value, and this reads it out of a line
 * that carries nothing else. Returns null when the answer is not one either ,
 * an unreadable answer is still unreadable.
 */
/**
 * KEEP-CURRENT WORDS. A banker's way of saying a term does not move: "hold",
 * "keep", "keep it", "keep current", "keep the same", "no change", "don't change
 * it", "leave it", "leave as is", "leave unchanged", "unchanged", "same", "as
 * is", "stet". Anchored at the start, and only ever consulted when the field's
 * own reader found no value, a line that names a figure ("keep it at 7%") reads
 * the figure and never reaches this.
 */
const KEEP_CURRENT =
  /^(?:hold|keep(?:\s+(?:it|current|the\s+same|as[-\s]?is|as\s+it\s+is))?|no\s+change|don'?t\s+change(?:\s+it)?|leave\s+(?:it|as[-\s]?is|as\s+it\s+is|unchanged)?|unchanged|same|as[-\s]?is|stet)\b/i;

/**
 * A SIGNED FIGURE IS TWO INSTRUCTIONS AND THE ROOM WILL NOT PICK ONE.
 *
 * "-5%" against a facility is the rate down five points, or the commitment cut
 * by five per cent. Those are different credit actions with different figures,
 * so both readings are stated with what they land on, computed off the book,
 * and the banker takes one. Where the read carries neither figure there is
 * nothing to ground a reading in, and the refusal says only what it could not
 * read.
 */
function signedFigureAsk(said: Scalar, facility: Facility): { question: string; options: string[] } {
  const rate =
    typeof facility.interestRate === "number" ? Math.round((facility.interestRate - said.value) * 1e6) / 1e6 : null;
  const cut = typeof facility.committed === "number" ? Math.round(facility.committed * (1 - said.value / 100)) : null;
  const readings: string[] = [];
  const options: string[] = [];
  if (rate !== null && rate > 0) {
    readings.push(`the rate down ${said.value} points, to ${rate}%`);
    options.push(`Lower the rate to ${rate}%`);
  }
  if (cut !== null && cut > 0) {
    readings.push(`the commitment cut ${said.value}%, to ${exactMoney(cut)}`);
    options.push(`Reduce the commitment to ${exactMoney(cut)}`);
  }
  return readings.length
    ? {
        // QUOTED WITH ITS SIGN. The tokeniser drops the minus and the minus is
        // the whole reason this is a question.
        question: `"-${said.text}" could be ${readings.join(", or ")}. Those are different changes, so say which.`,
        options,
      }
    : {
        question: `I will not read a minus off the line as a move. Say the all-in rate, or say the move in words, for example "lower it by ${said.value}%".`,
        options: [],
      };
}

/**
 * A PRICE READ OFF A LINE TYPED INTO ANOTHER FIELD'S QUESTION, or the question
 * that has to be settled before it can be one.
 *
 * Null where the line carries no percentage, or carries a length or a date:
 * those belong to whatever question is actually open. Exported because the
 * PRICING GATE's open question is the SHELL's own (`Workroom.tsx`) rather than
 * this module's `Awaiting`, and a rate typed into it is the same out-of-order
 * answer either way.
 */
export type RateAside = { value: ParsedValue } | { question: string; options: string[] };

export function readRateAside(text: string, facility: Facility | null | undefined): RateAside | null {
  if (!facility) return null;
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!lower || monthTokens(lower).length || readDate(lower)?.iso) return null;
  const pcts = percentTokens(lower);
  if (!pcts.length) return null;
  const last = pcts.at(-1)!;
  if (negated(lower, last.index)) return signedFigureAsk(last, facility);
  const at: CatalogMatch = { field: FILEABLE_RATE, matched: "", index: 0 };
  const alone: ParseContext = { facilities: [facility], booked: [facility], relationship: "", entities: [] };
  const read = readValue(FILEABLE_RATE, trimmed, lower, at, facility, alone);
  if ("question" in read) return { question: read.question, options: read.options ?? [] };
  return read.value?.kind === "percent" ? { value: read.value } : null;
}

/**
 * THE ANSWER THAT BELONGS TO ANOTHER FIELD.
 *
 * A banker who types a rate while the term question is open has answered the
 * rate, out of order; they have not typed noise. Re-asking the term over it
 * loses the figure they just gave, which is the loop that made the room feel
 * deaf. So the figure is staged on the field it could only have been about, on
 * the member the open question is about, and the engine puts the open question
 * back underneath it.
 *
 * TWO SHAPES ONLY, and both are unambiguous on this package: a percentage or a
 * basis-point figure is the rate, and money is the commitment. A length and a
 * date are read by the open field itself and never reach here.
 */
function readOutOfOrder(awaiting: Awaiting, text: string, lower: string, ctx: ParseContext): ParseOutcome | null {
  const facility = awaiting.facility;
  if (!facility) return null;
  if (monthTokens(lower).length || readDate(lower)?.iso) return null;
  if (percentTokens(lower).length && awaiting.field.type !== "percent") {
    const aside = readRateAside(text, facility);
    if (!aside) return null;
    if ("question" in aside) {
      return { kind: "clarify", question: aside.question, options: aside.options.length ? aside.options : undefined };
    }
    return {
      kind: "amendments",
      amendments: [{ field: FILEABLE_RATE, facility, value: aside.value, matched: aside.value.text, op: "change" }],
    };
  }
  if (moneyTokens(lower).length && awaiting.field.type !== "currency") {
    const at: CatalogMatch = { field: FILEABLE_AMOUNT, matched: "", index: 0 };
    const read = readValue(FILEABLE_AMOUNT, text, lower, at, facility, ctx);
    if ("question" in read) {
      return { kind: "clarify", question: read.question, awaiting: { field: FILEABLE_AMOUNT, facility } };
    }
    if (read.value === null) return null;
    return {
      kind: "amendments",
      amendments: [{ field: FILEABLE_AMOUNT, facility, value: read.value, matched: read.value.text, op: "change" }],
    };
  }
  return null;
}

/**
 * A LINE THAT NAMES ITS OWN RECORD IS AN INSTRUCTION, NOT AN ANSWER (founder's
 * Blue Ridge run, 2026-09-14, defect d).
 *
 * The amortisation question was still open when the banker opened a fee, so
 * "on the Term Loan add a 5% origination fee" arrived here as an answer to it:
 * the percentage went through the out-of-order reader as a RATE, the fee was
 * lost, and the term question then surfaced again inside the fee exchange with
 * a "Keep as booked" chip under it. A term question waits for a length; a line
 * carrying a covenant, a fee, a pledge, a party or an exception is the next
 * piece of work, and the arm that owns it takes the whole line.
 *
 * SCOPED TO RECORD FIELDS on purpose. "240 months" and "7.25%" carry no record
 * and still answer the question on the table, exactly as they always have.
 */
function opensItsOwnAsk(awaiting: Awaiting, text: string): boolean {
  if (awaiting.member || awaiting.party || awaiting.fee || awaiting.pledge || awaiting.exception) return false;
  // PER_MEMBER_SCALAR is the same four: the terms a banker moves to a figure,
  // which are exactly the questions that wait for one.
  if (awaiting.roleRemoval || !PER_MEMBER_SCALAR.has(awaiting.field.type)) return false;
  return matchCatalog(text).some((m) => m.field.type === "record" && m.field.id !== awaiting.field.id);
}

export function parseAnswer(awaiting: Awaiting, text: string, ctx: ParseContext): ParseOutcome | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (opensItsOwnAsk(awaiting, trimmed)) return null;

  /* THE LISTED REMOVAL WAITS ON ONE WORD. Yes stages every row that was named;
     no leaves them all on and stops asking. Anything else is not an answer to
     this question at all and goes back through the ordinary lanes. */
  if (awaiting.roleRemoval) {
    const { role, rows } = awaiting.roleRemoval;
    if (DECLINE_WORDS.test(lower)) {
      return {
        kind: "hold",
        field: awaiting.field,
        facility: awaiting.facility,
        said: `Nothing comes off then. ${rows.length === 1 ? "That" : `All ${rows.length} of those`} ${role.toLowerCase()} ${
          rows.length === 1 ? "row rides" : "rows ride"
        } onto the new version exactly as the booked facility carries ${rows.length === 1 ? "it" : "them"}.`,
      };
    }
    if (!CONFIRM_WORDS.test(lower)) return null;
    return {
      kind: "amendments",
      amendments: rows.map((r) => ({
        field: awaiting.field,
        facility: r.facility,
        value: null,
        party: r.party,
        role,
        matched: `remove ${r.party}`,
        op: "remove" as AmendmentOp,
      })),
    };
  }

  // THE ANSWER TO "WHICH ONE?" IS A MEMBER, and the instruction is the line that
  // raised the question. It is read again against the member they picked rather
  // than asked for again, which is what makes "the $15M one" a complete reply.
  if (awaiting.member) {
    const chosen = pickMembers(trimmed, awaiting.member.choices, ctx.relationship);
    if (chosen.length) return parseModify(awaiting.member.said, { ...ctx, picked: chosen });
    /* THE SAME INSTRUCTION, SAID AGAIN. A banker who restates the line instead
       of picking ("remove Elena from this loan", then "remove Elena Hartwell
       from this loan") has not answered the question, and re-issuing the
       sentence word for word reads as a room that did not hear. The ask narrows
       to the one thing still open, over the same chips. */
    const again = parseModify(trimmed, ctx);
    const choices = (a: Awaiting | undefined) => (a?.member?.choices ?? []).map((f) => f.loanId ?? "").join("|");
    const standing = choices(awaiting);
    if (standing && again.kind === "clarify" && choices(again.awaiting) === standing && again.options?.length) {
      return {
        kind: "clarify",
        question: `That is the same instruction, and the facility is still what is open. Pick one: ${again.options.join(" or ")}.`,
        options: again.options,
        awaiting: again.awaiting,
      };
    }
    return null;
  }

  // THE ANSWER TO "WHICH ENTITY?" IS A NAME, and the op, the role and the member
  // were all read off the line that asked. Resolved against the deal's own
  // involvement rows where it is one of them, so the row the org has to find
  // travels spelled the way the org spells it; kept verbatim where it is not,
  // because naming somebody who is not on the deal yet is exactly what an add
  // is. The verb is synthesised so one reader does both jobs.
  if (awaiting.party) {
    const said = partyNamed(`add ${trimmed}`, ctx);
    /* THE ANSWER ITSELF MAY NAME TWO. "Hartwell" answers "which entity?" with
       four of them on this book, and the room asks again with the names rather
       than filing whichever sorted first. */
    if (said.kind === "many") {
      return {
        kind: "clarify",
        question: `${said.names.length} parties on this package answer to that: ${said.names.join(", ")}. Which one?`,
        options: said.names,
        awaiting,
      };
    }
    const party = (said.kind === "one" ? said.name : said.said) ?? trimmed;
    // "the line of credit" is an answer to a different question.
    if (PARTY_NOT_A_NAME.test(party) || /^(?:an?|the)\b/i.test(party)) return null;
    /* AND A REMOVAL STILL HAS TO LAND ON ONE ROW. Where the name the banker
       just gave sits on more than one member and the question that asked for it
       carried none, the next question is which, the same one a fully named
       line raises, asked in the same words. */
    if (said.kind === "one" && awaiting.party.op === "remove" && !awaiting.facility) {
      const held = partyOn(party, ctx);
      if (held.length > 1) {
        return {
          kind: "clarify",
          question: `${party} is on ${held.length} of these facilities: ${heldAs(held, ctx.relationship)}. Which one should come off?`,
          options: held.map((h) => memberChipLabel(h.facility, ctx.relationship)),
          awaiting: { field: awaiting.field, facility: null, member: { said: `remove ${party}`, choices: held.map((h) => h.facility) } },
        };
      }
      if (held.length === 1) {
        return {
          kind: "amendments",
          amendments: [
            {
              field: awaiting.field,
              facility: held[0].facility,
              value: null,
              party,
              role: readRole(lower) ?? awaiting.party.role,
              ownership: readOwnership(lower) ?? awaiting.party.ownership,
              matched: trimmed,
              op: awaiting.party.op,
            },
          ],
        };
      }
    }
    return {
      kind: "amendments",
      amendments: [
        {
          field: awaiting.field,
          facility: awaiting.facility,
          value: null,
          party,
          // A role stated in the ANSWER beats the one the question carried.
          role: readRole(lower) ?? awaiting.party.role,
          ownership: readOwnership(lower) ?? awaiting.party.ownership,
          matched: trimmed,
          op: awaiting.party.op,
        },
      ],
    };
  }

  // THE ANSWER TO A FEE QUESTION IS THE MISSING HALF. The kind, the figure and
  // the member were settled by whichever line asked, so "1%" completes a fee
  // whose kind is already known and "origination fee" completes one whose
  // figure is. Routed here rather than through readValue because only this path
  // holds what was already read.
  if (awaiting.field.id === "fee.row") {
    const fee = readFee(lower, awaiting.fee);
    if ("question" in fee) {
      return { kind: "clarify", question: fee.question, awaiting: { ...awaiting, fee: fee.fee }, options: fee.options };
    }
    return {
      kind: "amendments",
      amendments: [
        {
          field: awaiting.field,
          facility: awaiting.facility,
          value: fee.value,
          matched: trimmed,
          op: operationFor(awaiting.field, lower),
        },
      ],
    };
  }

  // THE ANSWER TO A PLEDGE QUESTION IS THE PIECE THAT WAS MISSING, the asset
  // off the list the question named, or the kind, or the value, or the rate.
  // Routed here for the same reason the fee is: only this path holds what the
  // asking line already settled, and `isNew` in particular must survive, or an
  // answer of "equipment" would go looking for an asset the deal never had.
  if (awaiting.field.id === "collateral.pledge") {
    const pledge = readPledge(trimmed, lower, ctx, awaiting.pledge);
    if ("question" in pledge) {
      return {
        kind: "clarify",
        question: pledge.question,
        awaiting: { ...awaiting, pledge: pledge.pledge },
        options: pledge.options,
      };
    }
    return {
      kind: "amendments",
      amendments: [
        {
          field: awaiting.field,
          facility: awaiting.facility,
          value: pledge.value,
          matched: trimmed,
          op: operationFor(awaiting.field, lower),
        },
      ],
    };
  }

  // THE ANSWER TO AN EXCEPTION QUESTION IS THE PIECE THAT WAS MISSING, the
  // name, the status off the org's own three, or the mitigant. Routed here for
  // the same reason the fee and the pledge are: only this path holds what the
  // asking line settled, and a title once settled must survive, or "Mitigated"
  // typed into the status question would rename the exception.
  if (awaiting.field.id === "exception.record") {
    const exception = readException(trimmed, lower, awaiting.exception);
    if ("question" in exception) {
      return {
        kind: "clarify",
        question: exception.question,
        awaiting: { ...awaiting, exception: exception.exception },
        options: exception.options,
      };
    }
    return {
      kind: "amendments",
      amendments: [
        {
          field: awaiting.field,
          facility: awaiting.facility,
          value: exception.value,
          matched: trimmed,
          op: operationFor(awaiting.field, lower),
        },
      ],
    };
  }

  const at: CatalogMatch = { field: awaiting.field, matched: "", index: 0 };
  const read = readValue(awaiting.field, trimmed, lower, at, awaiting.facility, ctx);
  if ("question" in read) {
    // AN ANSWER TO A DIFFERENT QUESTION IS STILL AN ANSWER. A banker who types a
    // percentage while the term is open has answered the rate, out of order; the
    // room takes the figure and puts the open question back underneath it
    // instead of losing what they just said.
    const elsewhere = readOutOfOrder(awaiting, trimmed, lower, ctx);
    if (elsewhere) return elsewhere;
    // KEEP CURRENT IS AN ANSWER, NOT A NON-ANSWER. "hold" / "keep it" / "no
    // change" / "leave as is" to a term question means the field does not move,
    // and re-asking the same question over it is the loop that made the room
    // feel deaf. Only where the field's own reader found no value (a line naming
    // a figure is read as the figure and never reaches here) and the line
    // carries no digit, so "keep it at 7%" is never swallowed.
    if (KEEP_CURRENT.test(lower) && !/\d/.test(trimmed)) {
      return { kind: "hold", field: awaiting.field, facility: awaiting.facility };
    }
    return { kind: "clarify", question: read.question, awaiting, options: read.options };
  }
  if (read.value === null) return null;
  return {
    kind: "amendments",
    amendments: [
      {
        field: awaiting.field,
        facility: awaiting.facility,
        value: read.value,
        matched: trimmed,
        op: operationFor(awaiting.field, lower),
      },
    ],
  };
}

/* ------------------------------------------------ the live-describe fallback

   THE INDEX PROPOSES WHAT THE CURATED VOCABULARY DOES NOT KNOW. Two hundred
   and six writable loan fields ride the bundle as a generated snapshot of the
   org's own describe (fieldIndex.gen.ts). When the synonyms miss, the line is
   matched against the INDEX's labels: a full-label hit with a readable value
   becomes a normal amendment through a synthetic catalog entry, and a hit
   without one becomes the question a colleague would ask, with the org's legal
   values inside it. Below this tier sits the gateway assist; above it, the
   curated synonyms; underneath everything, the org re-validates at stage time
   whatever this file believed.                                                */

const INDEX_TYPE: Record<string, CatalogType> = {
  currency: "currency",
  percent: "percent",
  date: "date",
  picklist: "picklist",
  multipicklist: "picklist",
  double: "number",
  int: "number",
  string: "text",
  textarea: "text",
};

/** A synthetic catalog entry, minted from one index row. It files through the
 *  same dynamicField wire as the curated wave and claims nothing the org's
 *  describe did not say. */
function indexEntry(row: IndexedField): CatalogField {
  const [api, label, type, values] = row;
  return {
    id: `dyn.${api}`,
    object: "LLC_BI__Loan__c",
    apiName: api,
    label,
    type: INDEX_TYPE[type] ?? "text",
    category: "loan-other",
    group: "terms",
    source: "live-verified",
    dynamicField: api,
    values,
    synonyms: [label.toLowerCase()],
  };
}

const INDEX_STOP = new Set(["the", "and", "loan", "date", "amount", "total", "type", "current"]);

/**
 * The index tier: EVERY significant token of a field's label must appear in the
 * line, and at least one of them must be a word that could not match half the
 * catalog. Longest label wins. A miss returns null and the caller keeps its
 * "none", the tier proposes, it never guesses.
 */
function indexFallback(trimmed: string, lower: string, ctx: ParseContext): ParseOutcome | null {
  let best: { row: IndexedField; strength: number } | null = null;
  for (const row of LOAN_FIELD_INDEX) {
    const tokens = row[1].toLowerCase().split(/[^a-z0-9/]+/).filter((t) => t.length > 2);
    const significant = tokens.filter((t) => !INDEX_STOP.has(t));
    if (!significant.length) continue;
    const all = tokens.every((t) => INDEX_STOP.has(t) || new RegExp(`(?:^|[^a-z0-9])${t}(?:[^a-z0-9]|$)`).test(lower));
    const anchor = significant.some((t) => new RegExp(`(?:^|[^a-z0-9])${t}(?:[^a-z0-9]|$)`).test(lower));
    if (!all || !anchor) continue;
    const strength = significant.length;
    if (!best || strength > best.strength) best = { row, strength };
  }
  if (!best) return null;

  const field = indexEntry(best.row);
  const target = resolveTarget(lower, ctx, [field]);
  if ("question" in target) return memberClarify(target, trimmed, field);
  const facility = target.facilities[0] ?? null;
  const scrubbed = scrubIdentity(trimmed, target.facilities, ctx.relationship);
  const scrubbedLower = scrubbed.toLowerCase();

  // Numbers are read here rather than through readValue: the synthetic match
  // has no position in the line, and a bare figure is acceptable for a plain
  // number field in a way it never is for money.
  if (field.type === "number") {
    const m = /(?:to|at|=)\s+(-?\d+(?:\.\d+)?)/.exec(scrubbedLower) ?? /(-?\d+(?:\.\d+)?)\s*$/.exec(scrubbedLower);
    if (!m) {
      return {
        kind: "clarify",
        question: `${field.label} is a field this room can file (${field.apiName}). What number should it become?`,
        awaiting: { field, facility },
      };
    }
    return {
      kind: "amendments",
      amendments: [{ field, facility, value: { kind: "text", text: m[1] }, matched: field.label.toLowerCase(), op: "change" }],
    };
  }

  const at: CatalogMatch = { field, matched: "", index: 0 };
  const read = readValue(field, scrubbed, scrubbedLower, at, facility, ctx);
  if ("question" in read) {
    return {
      kind: "clarify",
      question: `${field.label} (${field.apiName}) is a field this room can file. ${read.question}`,
      awaiting: { field, facility },
      options: read.options,
    };
  }
  if (read.value === null) {
    const offer = field.values?.length ? ` The org offers: ${field.values.join(", ")}.` : "";
    return {
      kind: "clarify",
      question: `${field.label} is a field this room can file (${field.apiName}). What should it become?${offer}`,
      awaiting: { field, facility },
      options: field.values,
    };
  }
  return {
    kind: "amendments",
    amendments: [{ field, facility, value: read.value, matched: field.label.toLowerCase(), op: "change" }],
  };
}

/**
 * AN EXCEPTION CLAIMS THE REST OF ITS OWN LINE.
 *
 * "log a policy exception: advance rate above guideline on the equipment loan,
 * mitigated by the personal guaranty" carries three catalog synonyms and is ONE
 * ask. "advance rate" is the thing that is out of policy, the exception's own
 * title, and not a second amendment moving an advance rate; "mitigated" is this
 * exception's status and not a request to change somebody else's. An exception
 * is a NARRATIVE about a term, so it is written in that term's vocabulary, and
 * reading that vocabulary twice would stage two chips for one sentence.
 *
 * Everything said BEFORE the exception verb is still the banker's own amendment
 * and is kept: "take the line to $20M and log a policy exception for the advance
 * rate" is two asks, and only the second one's words belong to the exception.
 */
function claimExceptionClause(matches: CatalogMatch[]): CatalogMatch[] {
  const at = matches.find((m) => m.field.id === "exception.record")?.index;
  return at === undefined ? matches : matches.filter((m) => m.index <= at);
}

/* ================================ A BORROWING-STRUCTURE CHANGE, END TO END

   (Founder, 0.9.22 preview; IMPROVEMENTS row 44.) Four lines about the same
   guarantor, and only the fully specified one worked:

     "remove Elena from this loan"                     - matched nothing at all
     "remove Elena Hartwell from this loan"            - read every facility on
                                                         the package instead of
                                                         the two she guarantees
     "remove Elena Hartwell as guarantor from the
      15M line of credit"                              - staged, correctly

   A PARTY QUESTION IS ANSWERED FROM THE BOOK BEFORE IT IS ASKED. The org holds
   one involvement row per facility, so the room already knows which facilities
   a named party sits on: "this loan" for a removal means one of THOSE, never
   the whole package, and where there are two of them the question names both
   with the role each row carries. The banker is asked one thing, once.       */

interface PartyLine {
  field: CatalogField;
  /** The banker's own words that matched, for the chip. */
  matched: string;
  trimmed: string;
  lower: string;
  ctx: ParseContext;
  /** What the ordinary member resolution made of the line. */
  target: { facilities: Facility[] } | TargetAsk;
}

/** Who is on the package, in the org's own roles, for a sentence that has to
 *  say so rather than refuse in the abstract. */
function roster(ctx: ParseContext): string[] {
  const held = new Map<string, string>();
  for (const e of ctx.entities) {
    const name = (e.accountName ?? "").trim();
    const role = ((e.relationshipType ?? "").trim() || (e.borrowerType ?? "").trim()).trim();
    if (!name || held.has(name)) continue;
    held.set(name, role);
  }
  return [...held.entries()].map(([name, role]) => (role ? `${name} as ${role}` : name));
}

const rosterNames = (ctx: ParseContext): string[] => [
  ...new Set(ctx.entities.map((e) => (e.accountName ?? "").trim()).filter(Boolean)),
];

function partyAmendment({ field, matched, trimmed, lower, ctx, target }: PartyLine): ParseOutcome {
  /* A PARTY IS A CHANGE TO THE PACKAGE, so it meets the package's own gate
     before anything else is read off the line. See `nothingToModify`. */
  const barren = nothingToModify(ctx);
  if (barren) return barren;
  const op = operationFor(field, lower);
  const role = readRole(lower);
  const ownership = readOwnership(lower);
  const waiting = (facility: Facility | null): Awaiting => ({ field, facility, party: { op, role, ownership } });
  const named = partyNamed(trimmed, ctx);

  // ONE WORD, TWO PARTIES. "Hartwell" is four of the five names on this book.
  if (named.kind === "many") {
    return {
      kind: "clarify",
      question: `${named.names.length} parties on this package answer to that: ${named.names.join(", ")}. Which one?`,
      options: named.names,
      awaiting: waiting(null),
    };
  }

  const onDeal = named.kind === "one";
  const party = named.kind === "one" ? named.name : named.said;

  /* NOBODY IS NAMED AT ALL. The question the room has always asked, with the
     roster under it where the ask is a removal: a banker who has to be asked
     "which entity" should be able to answer it off the same line. */
  if (!party) {
    const who = roster(ctx);
    return {
      kind: "clarify",
      question:
        op === "remove" && who.length
          ? `Which entity should come off? This package carries ${who.join(", ")}.`
          : "Which entity? Name it and I will stage the involvement.",
      options: op === "remove" && who.length ? rosterNames(ctx) : undefined,
      // The op, the role and the member are already settled. Carrying them
      // is what lets the next line be the name and nothing else.
      awaiting: waiting("facilities" in target ? (target.facilities[0] ?? null) : null),
    };
  }

  /* A SHORTHAND THAT MATCHED NOBODY. "remove Elena" resolves; "remove Sandra"
     does not, and the room says who is actually on the package rather than
     sending an exclusion up for a name nothing corroborates.

     A FULL NAME IS NOT REFUSED, and that is deliberate (`stampRemovalRoles`):
     the ORG is the authority on who is on a facility and this read can be
     thinner than it. One word is a shorthand and the room is the authority on
     whether it resolved; two is a name, and it goes up as it always has. */
  if (op === "remove" && !onDeal && nameTokens(party).length < 2 && !LEGAL_SUFFIX.test(party)) {
    const who = roster(ctx);
    if (who.length) {
      return {
        kind: "clarify",
        question:
          `I could not match ${party} to a party on this package's borrowing structure, so there is no row to take off. ` +
          `It carries ${who.join(", ")}. Which of them did you mean? ` +
          `If you meant something the deal has pledged, say "release ${party}" and I will read it as collateral.`,
        options: rosterNames(ctx),
        awaiting: waiting(null),
      };
    }
  }

  const held = onDeal ? partyOn(party, ctx) : [];
  const onLoans = new Set(held.map((h) => h.facility.loanId ?? ""));
  /** The members the LINE itself named, out of the ones a credit action can run
   *  against. A focus or a lone member is not a naming: see below. */
  const bookable = (f: Facility) => ctx.booked.some((b) => b.loanId === f.loanId);
  const fits = ctx.picked?.length ? ctx.picked : namedFacilities(lower, ctx).facilities.filter(bookable);
  /* AND A FIGURE AGAINST THE PRODUCT WORD NAMES ONE OF THEM. "the 8M equipment"
     on a package carrying three equipment loans is not ambiguous, and a
     sentence that read it as all three would be the room not reading. */
  const qualified = fits.filter(
    (f) => typeof f.committed === "number" && moneyTokens(lower).some((t) => t.value === f.committed),
  );
  const said = qualified.length === 1 ? qualified : fits;

  let facilities: Array<Facility | null>;
  if (said.length) {
    const hers = said.filter((f) => onLoans.has(f.loanId ?? ""));
    /* NAMED A FACILITY THEY ARE NOT ON. The read knows it, so the room says it
       and names where they ARE, rather than sending an exclusion up for a row
       the org would not find. */
    if (op === "remove" && onDeal && !hers.length && held.length) {
      return {
        kind: "clarify",
        question: `${party} is not on ${said
          .map((f) => `the ${memberChipLabel(f, ctx.relationship)}`)
          .join(" or ")} today, so there is nothing there to take off. This book carries ${party} on ${heldAs(
          held,
          ctx.relationship,
        )}. Which one should come off?`,
        options: held.map((h) => memberChipLabel(h.facility, ctx.relationship)),
        awaiting: { field, facility: null, member: { said: trimmed, choices: held.map((h) => h.facility) } },
      };
    }
    const landing = hers.length ? hers : said;
    /* A SINGULAR REFERENCE THAT FITS SEVERAL NAMES NONE OF THEM (D1, the
       three-book matrix, 2026-09-13). `resolveTarget` has asked "which one?"
       over exactly this shape since the wave shipped; the party lane resolves
       its own member and therefore never reached the question, so a line whose
       words happened to fit three facilities staged three carry exclusions.

       KINGSLEY IS WHERE IT SHOWS. Its loans are not named `<Borrower> - <Product>
       - <$Amount>`, so the relationship prefix is not stripped and the product
       word of every member begins "Kingsley": "remove Owen Kingsley from this
       loan" matched all three by the guarantor's own surname and took him off
       each of them. On a book whose loan names follow the convention the party's
       name never touches the product and the fan-out is invisible.

       A PLURAL IS STILL A SELECTION ("take them off both lines"), and a figure
       written against the product still names one. Only the singular reference
       that fits several becomes a question. */
    if (landing.length > 1 && !PLURAL_REFERENCE.test(lower) && !figureNamesAMember(landing, lower, ctx.relationship)) {
      return {
        kind: "clarify",
        question: `This package carries ${landing.length} of those: ${landing
          .map((f) => shortFacilityLabel(f, ctx.relationship))
          .join(", ")}. Which one should ${party} ${op === "remove" ? "come off" : "go on"}?`,
        options: landing.map((f) => memberChipLabel(f, ctx.relationship)),
        awaiting: { field, facility: null, member: { said: trimmed, choices: landing } },
      };
    }
    facilities = landing;
  } else if (op === "remove" && held.length === 1 && POINTS_AT_A_MEMBER.test(lower)) {
    // ONE FACILITY CARRIES THE ROW, so "this loan" names it and nothing is asked.
    facilities = [held[0].facility];
  } else if (op === "remove" && held.length > 1 && POINTS_AT_A_MEMBER.test(lower)) {
    return {
      kind: "clarify",
      question: `${party} is on ${held.length} of these facilities: ${heldAs(held, ctx.relationship)}. Which one should come off?`,
      options: held.map((h) => memberChipLabel(h.facility, ctx.relationship)),
      awaiting: { field, facility: null, member: { said: trimmed, choices: held.map((h) => h.facility) } },
    };
  } else {
    // An ADD is deal-scoped until a line binds it to a member, exactly as it was.
    facilities = "facilities" in target && target.facilities.length ? target.facilities : [null];
  }

  const scrubbed = scrubIdentity(trimmed, facilities, ctx.relationship);
  const scrubbedLower = scrubbed.toLowerCase();
  const amendments: Amendment[] = [];
  for (const facility of facilities) {
    const at: CatalogMatch = { field, matched, index: Math.max(0, scrubbedLower.indexOf(matched)) };
    const read = readValue(field, scrubbed, scrubbedLower, at, facility, ctx);
    if ("question" in read) {
      return { kind: "clarify", question: read.question, awaiting: { field, facility }, options: read.options };
    }
    amendments.push({
      field,
      facility,
      value: read.value,
      party,
      // The role the LINE stated. Where it states none, the shell stamps the
      // book's own role onto the wire and says it (`stampRemovalRoles`); a
      // second reading of the same fact here would be the same rule twice.
      role: readRole(scrubbedLower),
      ownership: readOwnership(scrubbedLower),
      matched,
      op,
    });
  }
  return { kind: "amendments", amendments };
}

/* ==================================== A ROLE IS NOT A NAME (founder's Blue
   Ridge run, 2026-09-14, feedback bug-1789409908236-mwwh9n).

   "remove all limited guarantors" named no party, so every party reader in this
   file came back with nothing and the line fell through to the index tier and
   out the other side. The ask is perfectly clear and it is over a CLOSED SET:
   the org holds involvement as rows, so a role plus a member resolves exactly
   the rows that carry that role, off the book, with nothing invented.

   IT IS LISTED BEFORE IT IS STAGED. Taking three guarantors off a facility in
   one sentence is three carry exclusions, and a banker signs what they can see:
   the rows are named, the confirmation is one word, and only then does each row
   go up through the ordinary single-party removal arm.                        */

/** The five roles, written the way a line about SEVERAL of them writes them.
 *  `readRole` is word-bounded on the singular and therefore blind to every one
 *  of these, which is the whole of the defect: "remove all limited guarantors"
 *  matched no role at all. Longest first, so a plural "limited guarantors" is
 *  never read as "guarantors" with a stray word in front. */
const ROLE_PLURALS: Array<{ match: RegExp; role: string }> = [
  { match: /\blimited\s+guarantors?\b/, role: "Limited Guarantor" },
  { match: /\bco[-\s]?borrowers?\b/, role: "Co-Borrower" },
  { match: /\brelated\s+entit(?:y|ies)\b/, role: "Related Entity" },
  { match: /\bguarantors?\b/, role: "Guarantor" },
  { match: /\bborrowers?\b/, role: "Borrower" },
];

/** A role the line wrote PLURAL, or counted. "remove all limited guarantors" and
 *  "take the guarantors off" are role-scoped; "remove the guarantor Elena" is a
 *  named removal and belongs to `partyAmendment`. */
function roleScoped(lower: string): string | undefined {
  const hit = ROLE_PLURALS.find((r) => r.match.test(lower));
  if (!hit) return undefined;
  const word = hit.role.toLowerCase().replace(/[-\s]/g, "[-\\s]?");
  const plural = new RegExp(`${word}s\\b`).test(lower) || /\bentities\b/.test(lower);
  return plural || /\b(all|every|each|both)\b/.test(lower) ? hit.role : undefined;
}

/** The involvement rows one role carries on one member. A row the org hung off
 *  the relationship rather than off a loan is on every member, which is the
 *  same reading `partyOn` and the structure card both make. */
function rowsInRole(role: string, facility: Facility, ctx: ParseContext): Array<{ party: string; facility: Facility }> {
  const out: Array<{ party: string; facility: Facility }> = [];
  const seen = new Set<string>();
  for (const e of ctx.entities) {
    const name = (e.accountName ?? "").trim();
    const held = ((e.relationshipType ?? "").trim() || (e.borrowerType ?? "").trim()).trim();
    if (!name || seen.has(name) || held.toLowerCase() !== role.toLowerCase()) continue;
    if (e.loanId && facility.loanId && e.loanId !== facility.loanId) continue;
    seen.add(name);
    out.push({ party: name, facility });
  }
  return out;
}

/** "take the guarantors off" puts the object between the verb and its particle,
 *  which `REMOVE_VERBS` reads only where the two sit together. */
const TAKE_OFF = /\btakes?\b[^.]{0,40}\boff\b/;

/** The yes and the no a listed removal waits on. Anchored at the start: a line
 *  that says anything else is the next instruction, not an answer to this. */
const CONFIRM_WORDS = /^(?:yes|yep|yeah|ok(?:ay)?|do it|go ahead|confirm(?:ed)?|please\s+do|stage\s+(?:it|them)|take\s+(?:it|them)\s+off)\b/i;
const DECLINE_WORDS = /^(?:no\b|nope|leave\s+(?:it|them)|keep\s+(?:it|them)|don'?t|cancel|stop|not\s+now)/i;

/**
 * A ROLE-SCOPED REMOVAL, READ OFF THE BOOK. Null where the line names a party
 * (that is `partyAmendment`'s), where no role is written plural or counted, or
 * where the deal carries no involvement rows to read.
 */
function inferRoleRemoval(trimmed: string, lower: string, ctx: ParseContext): ParseOutcome | null {
  if (!ctx.entities.length) return null;
  if (!REMOVE_VERBS.test(lower) && !TAKE_OFF.test(lower)) return null;
  const role = roleScoped(lower);
  if (!role) return null;
  // A LINE THAT NAMES A PARTY IS ABOUT THAT PARTY, whatever role it also writes.
  const named = partyNamed(trimmed, ctx);
  if (named.kind !== "none" || named.said) return null;
  const barren = nothingToModify(ctx);
  if (barren) return barren;
  const field = catalogField("party.remove");
  if (!field) return null;
  const target = resolveTarget(lower, ctx, [field]);
  if ("question" in target) return memberClarify(target, trimmed, field);
  const facility = target.facilities[0];
  if (!facility) return null;

  const rows = rowsInRole(role, facility, ctx);
  const on = memberChipLabel(facility, ctx.relationship);
  if (!rows.length) {
    const who = roster(ctx);
    return {
      kind: "clarify",
      question:
        `The ${on} carries no ${role.toLowerCase()} row today, so there is nothing there to take off.` +
        (who.length ? ` This package carries ${who.join(", ")}. Which of them did you mean?` : ""),
      options: who.length ? rosterNames(ctx) : undefined,
      awaiting: { field, facility, party: { op: "remove" } },
    };
  }
  const one = rows.length === 1;
  return {
    kind: "clarify",
    question:
      `${role}${one ? "" : "s"} on the ${on}: ${rows.map((r) => r.party).join(", ")}. ` +
      `Taking the role off is ${one ? "one involvement row" : `${rows.length} involvement rows, one for each party`}, ` +
      `each staged as a carry exclusion so the row never travels to the new version. ` +
      `Say yes and I will put ${one ? "it" : "them"} up.`,
    options: ["Yes, take them off", "Leave them on"],
    awaiting: { field, facility, roleRemoval: { role, rows } },
  };
}

/* ========================== A COVENANT WAIVER IS NOT THIS ROOM'S (founder's
   Blue Ridge run, 2026-09-14, defect f).

   "waive this one", then the covenant's own name, then "waive for 6 months" ,
   and the last line was staged as a SIX MONTH TERM on the facility, because the
   duration fell through to the term reader while the waiver itself was never
   recognised at all. A waiver is a decision not to enforce a covenant and it
   moves a compliance status, which is `covenant.complianceStatus`: its own
   credit action, founder-gated, and never a side effect of a modification.

   SO THE ASK IS REFUSED BY NAME AND THE EXCHANGE IS HELD. While it is open,
   naming the covenant or typing a duration is still the waiver, and no reader
   in this file may take either as a value.                                   */

/** The words a banker uses to ask the bank not to enforce a test. */
const WAIVER_VERB =
  /\b(waive[sd]?|waiving|waivers?|forbear(?:s|ed|ing|ance)?|grant\s+(?:an?\s+)?exception|extend\s+the\s+test|defer\s+the\s+test|suspend\s+the\s+(?:test|covenant)|reset\s+the\s+(?:test|covenant))\b/;
/** The nouns that make a waiver ask a COVENANT waiver. */
const WAIVER_NOUN = /\b(covenants?|tests?|ratios?|compliance|breach(?:e[sd])?|default)\b/;
/** A waiver aimed at something this room does file, which is not a covenant. */
const NOT_A_COVENANT_WAIVER = /\b(fees?|charges?|costs?|penalt(?:y|ies)|pledges?|collateral|securit(?:y|ies))\b/;
/** A POLICY EXCEPTION RECORD, which this room files and which carries "Waived"
 *  as one of the org's own three statuses. It is not a waiver ask. */
const AN_EXCEPTION_RECORD = /\b(policy\s+exception|log\s+(?:an?\s+)?exception|record\s+(?:an?\s+)?exception|mitigat)/;
/** A line pointing at the covenant on screen with no noun of its own. */
const POINTS_AT_ONE = /\b(this|that|it)\b/;

/** A waiver ask, with the covenant where the banker named one. */
export interface CovenantWaiverRead {
  covenant?: string;
}

/**
 * THE WAIVER THIS LINE ASKS FOR, or null.
 *
 * `covenants` is what the package tests, so a line naming one of them inside an
 * open exchange is still that exchange. `exchangeOpen` is the engine's, because
 * the engine is what holds the conversation; this reader holds nothing.
 */
export function readCovenantWaiver(
  text: string,
  covenants: string[],
  exchangeOpen: boolean,
): CovenantWaiverRead | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (AN_EXCEPTION_RECORD.test(lower)) return null;
  /* THE CATALOG ALREADY ANSWERS THE FULLY-WRITTEN ASK. "waive the covenant on
     the Line of Credit" is a `covenant.complianceStatus` synonym and comes back
     as the org's own structured refusal, with the reason and the route out on
     it. This reader is for the halves that carry no synonym at all: the
     demonstrative, the covenant's bare name, and the duration typed after. */
  if (matchCatalog(trimmed).some((m) => m.field.id === "covenant.complianceStatus")) return null;
  const named = covenants.find((c) => c.trim().length > 2 && lower.includes(c.trim().toLowerCase()));
  const verb = WAIVER_VERB.test(lower);
  // A FEE WAIVER IS A DIFFERENT ASK, and a fee is something this room does file.
  if (verb && NOT_A_COVENANT_WAIVER.test(lower) && !WAIVER_NOUN.test(lower) && !named) return null;
  if (verb && (WAIVER_NOUN.test(lower) || named || (POINTS_AT_ONE.test(lower) && covenants.length > 0))) {
    return named ? { covenant: named } : {};
  }
  if (!exchangeOpen) return null;
  // INSIDE THE EXCHANGE the covenant's own name is an answer to it, and so is a
  // duration: "waive for 6 months" is six months of forbearance, never a term.
  if (named) return { covenant: named };
  if (verb) return {};
  /* A BARE DURATION IS THE WAIVER'S, and only where the line names no field of
     its own: "extend the maturity by 6 months" inside the exchange is a real
     maturity move and leaves it. A months match is the duration itself. */
  return monthTokens(lower).length && matchCatalog(trimmed).every((m) => m.field.type === "months") ? {} : null;
}

/**
 * A REMOVAL THE CATALOG CANNOT SEE, because the banker named the party and not
 * the role. "remove Elena from this loan" carries no synonym any party field
 * holds, and it is nonetheless unmistakable: a removal verb over a name this
 * deal's own involvement rows carry. The inference is over a CLOSED SET (the
 * parties on the book) and it never invents a name.
 */
function inferPartyRemoval(trimmed: string, lower: string, ctx: ParseContext): ParseOutcome | null {
  if (!REMOVE_VERBS.test(lower) || !ctx.entities.length) return null;
  const named = partyNamed(trimmed, ctx);
  /* A NAME THE BOOK DOES NOT CARRY IS STILL A NAME, and a removal aimed at one
     is answered rather than met with silence: a full name goes up as an
     exclusion the org resolves, and a shorthand that fits nobody is answered
     with who IS on the package. Where the word is an ASSET rather than a party
     ("remove the Mazak tooling"), the sentence says so and names the collateral
     door: the room reads one line, so it offers both readings instead of
     picking one. */
  if (named.kind === "none" && !named.said) return null;
  const field = catalogField("party.remove");
  if (!field) return null;
  const verb = REMOVE_VERBS.exec(lower)?.[0] ?? "remove";
  return partyAmendment({
    field,
    matched: named.kind === "one" ? `${verb} ${named.name}` : verb,
    trimmed,
    lower,
    ctx,
    target: resolveTarget(lower, ctx, [field]),
  });
}

/**
 * Read a banker's line into amendments.
 *
 * ORDER OF WORK: match the catalog, resolve the member, read the value. A miss
 * at any step is a question about THAT step rather than a silent drop, which is
 * what keeps "I did not understand" from being the only failure mode.
 */
export function parseModify(text: string, ctx: ParseContext): ParseOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };
  const lower = trimmed.toLowerCase();

  const matches = claimExceptionClause(matchCatalog(trimmed));
  if (!matches.length) {
    const priced = inferRate(trimmed, lower, ctx);
    if (priced) return priced;
    const inferred = inferAmount(lower, ctx);
    if (inferred) return inferred;
    // A ROLE BEFORE A NAME: "remove all limited guarantors" names nobody, and
    // the reader that looks for a name would come back empty over a line whose
    // closed set the book already holds.
    const byRole = inferRoleRemoval(trimmed, lower, ctx);
    if (byRole) return byRole;
    const party = inferPartyRemoval(trimmed, lower, ctx);
    if (party) return party;
    return indexFallback(trimmed, lower, ctx) ?? { kind: "none" };
  }

  const target = resolveTarget(lower, ctx, matches.map((m) => m.field));
  const amendments: Amendment[] = [];

  for (const match of matches) {
    const { field } = match;

    // Party and package amendments are not member-scoped: a guarantor joins the
    // deal, not one facility, and asking which member would be the wrong
    // question. Everything else needs a member before it needs a value.
    const memberScoped = field.category !== "party" && field.category !== "package";
    if (memberScoped && "question" in target) return memberClarify(target, trimmed, field);
    /* AND A PACKAGE-LEVEL CHANGE MEETS THE PACKAGE'S OWN GATE: a package with no
       booked member carries nothing a credit action can fork, whatever the
       change is about. The party lane asks the same question inside
       `partyAmendment`, which is also where the INFERRED removals arrive. */
    if (field.category === "package") {
      const barren = nothingToModify(ctx);
      if (barren) return barren;
    }
    /* A PARTY AMENDMENT RESOLVES ON THE PARTY, not on the package. It names an
       entity, and the org's own involvement rows say which facilities that
       entity sits on; see `partyAmendment`. */
    if (field.category === "party") {
      const outcome = partyAmendment({ field, matched: match.matched, trimmed, lower, ctx, target });
      if (outcome.kind !== "amendments") return outcome;
      amendments.push(...outcome.amendments);
      continue;
    }
    const facilities = memberScoped && "facilities" in target ? target.facilities : [null];

    // Values are read from the line WITHOUT the member's own name in it.
    const scrubbed = scrubIdentity(trimmed, facilities, ctx.relationship);
    const scrubbedLower = scrubbed.toLowerCase();
    for (const facility of facilities) {
      const at: CatalogMatch = { ...match, index: Math.max(0, scrubbedLower.indexOf(match.matched)) };
      const read = readValue(field, scrubbed, scrubbedLower, at, facility, ctx);
      if ("question" in read) {
        return {
          kind: "clarify",
          question: read.question,
          awaiting: { field, facility, fee: read.fee, pledge: read.pledge, exception: read.exception },
          options: read.options,
        };
      }
      amendments.push({ field, facility, value: read.value, matched: match.matched, op: operationFor(field, lower) });
    }
  }

  return amendments.length ? { kind: "amendments", amendments } : { kind: "none" };
}
