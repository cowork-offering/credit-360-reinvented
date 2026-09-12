import { moneyTokens, monthTokens, type ParsedValue } from "./parseModify";
import type { ManifestGroupId } from "./types";

/* =============================================================================
   THE CREATION INDEX.

   A modification amends a facility that exists; a creation composes one that
   does not. So the field catalog behind `parseModify` — 40-odd amendments,
   every one of them a delta against a booked record — is the wrong index here.
   What `stage_new_facility` actually takes is FOUR scalars and one anchor, and
   three of the four are refused by the tool when they are absent:

     product              REQUIRED. Blank, the org files `Construction` and then
                          REBUILDS the loan's name from it, so an omitted
                          product ships a facility labelled wrong.
     amount               REQUIRED, greater than zero. It gates LV11 on the hop.
     primaryLoanPurpose   REQUIRED. It gates LV12, and the org leaves it null on
                          the Loan Detail it creates for us.
     termMonths           optional.

   Read from the deployed `StageNewFacility.build()` (its own ToolException
   messages), not inferred. The room therefore ASKS for the three before it can
   stage, one question at a time, which is what makes the composition a
   conversation rather than a form.

   THE PRODUCT SET IS THE ORG'S, RECORD-TYPE SCOPED. `Term` is a legal value on
   the field and NOT offered by the Commercial Loan record type: the API would
   accept it, store it, and then render wrong in nCino. The tool refuses it by
   name, so this parser refuses it first, with the same six values.
   ============================================================================= */

/** The four request keys `stage_new_facility` accepts as terms. */
export type CreateWireKey = "product" | "amount" | "termMonths" | "primaryLoanPurpose";

export interface CreateField {
  id: string;
  object: string;
  apiName: string | null;
  label: string;
  group: ManifestGroupId;
  /** Present ⇒ THIS TRAVELS. Absent ⇒ manifest and honest handoff only. */
  wireKey?: CreateWireKey;
  /** The tool refuses a plan without it, in its own words. */
  requiredByTool?: boolean;
  /** The org's own value set, where the tool validates against one. */
  values?: string[];
  /** Why nothing files it. Required whenever `wireKey` is absent. */
  gap?: string;
  closes?: string;
  /** What the org checks that this parser cannot. Rendered as the caveat. */
  caveat?: string;
  synonyms: string[];
}

/** The Commercial Loan record type's own six, sorted as the tool sorts them in
 *  its refusal message. `Term` is deliberately absent — see the module note. */
export const CREATE_PRODUCTS = ["Construction", "Deposit", "Equipment", "HELOC", "Line of Credit", "Purchase"];

const NO_SECOND_INVOLVEMENT =
  "execute_new_facility files exactly one borrowing-structure row: the package's own borrower, at 100 percent ownership. No tool adds a second entity to a facility it is creating.";

export const CREATE_FIELDS: CreateField[] = [
  {
    id: "create.product",
    object: "LLC_BI__Loan__c",
    apiName: "LLC_BI__Product__c",
    label: "Product",
    group: "terms",
    wireKey: "product",
    requiredByTool: true,
    values: CREATE_PRODUCTS,
    synonyms: ["product", "facility type", "loan type"],
  },
  {
    id: "create.amount",
    object: "LLC_BI__Loan__c",
    apiName: "LLC_BI__Amount__c",
    label: "Amount",
    group: "terms",
    wireKey: "amount",
    requiredByTool: true,
    synonyms: ["amount", "commitment", "limit", "line size", "size", "facility amount"],
  },
  {
    id: "create.termMonths",
    object: "LLC_BI__Loan__c",
    apiName: "LLC_BI__Term_Months__c",
    label: "Term (months)",
    group: "terms",
    wireKey: "termMonths",
    synonyms: ["term", "tenor", "term months"],
  },
  {
    id: "create.purpose",
    object: "LLC_BI__Loan_Detail__c",
    apiName: "LLC_BI__Primary_Loan_Purpose__c",
    label: "Primary loan purpose",
    group: "terms",
    wireKey: "primaryLoanPurpose",
    requiredByTool: true,
    // The org holds 23 active values on this field and this cockpit has never
    // read the list. So the banker's own word travels, and the ORG names the
    // legal values if it refuses one — which is a better answer than a guess.
    caveat:
      "The org validates the purpose against its own active list on the Loan Detail. If it refuses this one it names the legal values, verbatim, and nothing is written.",
    synonyms: ["purpose", "loan purpose", "use of proceeds", "reason"],
  },
  {
    id: "create.party",
    object: "LLC_BI__Legal_Entities__c",
    apiName: null,
    label: "Borrowing structure",
    group: "structure",
    gap: NO_SECOND_INVOLVEMENT,
    closes:
      "Extend the new-facility pair with a typed involvements[] block, each row created behind the same guard the borrower row already passes and verified by re-query.",
    synonyms: ["guarantor", "co-borrower", "borrower", "add", "involve", "entity"],
  },
];

export function createField(id: string): CreateField | undefined {
  return CREATE_FIELDS.find((f) => f.id === id);
}

/** Banker nicknames onto the org's own six. "The revolver" is a Line of Credit
 *  here; nothing in this org's data ever uses the word. */
const PRODUCT_ALIASES: Record<string, string[]> = {
  "Line of Credit": ["line of credit", "loc", "revolver", "revolving", "operating line", "working capital line", "credit line", "line"],
  Equipment: ["equipment", "machinery", "kit", "plant"],
  Construction: ["construction", "build", "development"],
  HELOC: ["heloc", "home equity"],
  Purchase: ["purchase", "acquisition"],
  Deposit: ["deposit"],
};

/** Products a banker can say that this record type does not offer. Named, so
 *  the refusal can quote the word back rather than saying "not understood". */
const OFF_RECORD_TYPE: Record<string, string[]> = {
  Term: ["term loan", "term facility", "amortising loan", "amortizing loan"],
};

function wordIn(haystack: string, needle: string): boolean {
  const at = haystack.indexOf(needle);
  if (at < 0) return false;
  const before = at === 0 ? " " : haystack[at - 1];
  const after = at + needle.length >= haystack.length ? " " : haystack[at + needle.length];
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/** The product the line names, the off-record-type word it names, or neither.
 *  Longest alias first, so "line of credit" never resolves through "line". */
function readProduct(lower: string): { product?: string; refused?: string } {
  for (const [name, aliases] of Object.entries(OFF_RECORD_TYPE)) {
    if (aliases.some((a) => wordIn(lower, a))) return { refused: name };
  }
  const hits: Array<{ product: string; length: number }> = [];
  for (const [product, aliases] of Object.entries(PRODUCT_ALIASES)) {
    for (const alias of aliases) {
      if (wordIn(lower, alias)) hits.push({ product, length: alias.length });
    }
  }
  if (!hits.length) return {};
  return { product: hits.sort((a, b) => b.length - a.length)[0].product };
}

/* -------------------------------------------------------------------- parse */

export interface CreateValue {
  field: CreateField;
  value: ParsedValue;
  /** The entity a borrowing-structure line names, with the role it asks for. */
  party?: { name: string; role: string };
}

export interface CreateParseContext {
  /** Entities already around the relationship, so "add Hartwell Logistics"
   *  resolves against the household rather than against free text. */
  household: Array<{ name: string; role: string }>;
  /** The relationship itself. It is the borrower the tool files on its own, so
   *  naming it is not a second involvement row and must not stage as one. */
  relationship: string;
}

export type CreateOutcome =
  | { kind: "values"; values: CreateValue[] }
  | { kind: "clarify"; question: string; awaiting?: CreateField }
  | { kind: "none" };

const ROLE_WORDS: Array<{ role: string; test: RegExp }> = [
  { role: "Guarantor", test: /\bguarantor\b|\bguarantee/ },
  { role: "Co-Borrower", test: /\bco-?borrower\b/ },
  { role: "Borrower", test: /\bborrower\b/ },
];

/** The entity a structure line names, matched against the household. Free text
 *  is not an entity: an involvement row points at an Account, and an Account
 *  this cockpit cannot find is one it must not claim to have read. */
function readParty(text: string, ctx: CreateParseContext): { name: string; role: string } | null {
  const lower = text.toLowerCase();
  const role = ROLE_WORDS.find((r) => r.test.test(lower))?.role;
  if (!role) return null;
  const hit = ctx.household.find((h) => h.name && lower.includes(h.name.toLowerCase()));
  return hit ? { name: hit.name, role } : null;
}

/**
 * WHAT THE BANKER JUST SAID ABOUT THE FACILITY BEING COMPOSED.
 *
 * One line can carry several: "a $5MM equipment line over 60 months" is three
 * values, and reading it as one would make the room ask twice for facts it had
 * already been given. What it will NOT do is infer: a bare number is a question,
 * an unknown product is a refusal with the org's list, and a purpose is only
 * read where the banker introduced one.
 */
export function parseCreate(text: string, ctx: CreateParseContext): CreateOutcome {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };
  const lower = trimmed.toLowerCase();
  const values: CreateValue[] = [];

  const { product, refused } = readProduct(lower);
  if (refused) {
    return {
      kind: "clarify",
      question: `${refused} is a legal value on the field and is not offered by the Commercial Loan record type, so the org would store it and then render it wrong. Pick one of ${CREATE_PRODUCTS.join(", ")}.`,
      awaiting: createField("create.product"),
    };
  }
  if (product) {
    values.push({ field: createField("create.product")!, value: { kind: "text", text: product } });
  }

  const money = moneyTokens(lower);
  if (money.length) {
    values.push({
      field: createField("create.amount")!,
      value: { kind: "currency", amount: money[0].value, text: money[0].text },
    });
  }

  const months = monthTokens(lower);
  if (months.length) {
    values.push({
      field: createField("create.termMonths")!,
      value: { kind: "months", months: months[0].value, text: months[0].text },
    });
  }

  const party = readParty(trimmed, ctx);
  if (party) {
    // NAMING THE RELATIONSHIP IS NOT A SECOND ROW. The tool files that one.
    if (party.name.toLowerCase() !== ctx.relationship.toLowerCase()) {
      values.push({
        field: createField("create.party")!,
        value: { kind: "text", text: `${party.name} as ${party.role}` },
        party,
      });
    }
  }

  const purpose = readPurpose(trimmed);
  if (purpose) {
    values.push({ field: createField("create.purpose")!, value: { kind: "text", text: purpose } });
  }

  if (values.length) return { kind: "values", values };

  // A BARE NUMBER IS A QUESTION, never an amount. "Take it to 20" is twenty
  // dollars as readily as twenty million, and the org would file whichever one
  // this parser decided to prefer.
  if (/\b\d+\b/.test(lower)) {
    return {
      kind: "clarify",
      question: "I read a number but not what it is. Say it with its magnitude ($5MM, or 60 months) and I will place it.",
    };
  }
  return { kind: "none" };
}

/** The purpose, only where the banker introduced one. `for` is the word bankers
 *  actually use, and the phrase after it is theirs — this never invents one. */
function readPurpose(text: string): string | null {
  const m = text.match(/\b(?:purpose(?:\s+is)?|use of proceeds|to fund|for)\s+(?:the\s+)?([a-z][a-z0-9 '/-]{2,60})/i);
  if (!m) return null;
  const said = m[1].trim().replace(/[.,;]+$/, "");
  // "for 60 months" and "for $5MM" are a term and an amount, already read above.
  if (/^\d/.test(said) || /^(months?|years?)\b/i.test(said)) return null;
  return said;
}

/**
 * ANSWER THE QUESTION THE ROOM ASKED. The field is settled; the line carries
 * only the value. Returns null where the line is not an answer either.
 */
export function parseCreateAnswer(field: CreateField, text: string): CreateOutcome | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (field.id === "create.product") {
    const { product, refused } = readProduct(lower);
    if (refused || !product) {
      return {
        kind: "clarify",
        question: `That is not one of the six the Commercial Loan record type offers. Pick one of ${CREATE_PRODUCTS.join(", ")}.`,
        awaiting: field,
      };
    }
    return { kind: "values", values: [{ field, value: { kind: "text", text: product } }] };
  }

  if (field.id === "create.amount") {
    const money = moneyTokens(lower);
    if (!money.length) {
      return {
        kind: "clarify",
        question: "Say the amount with its magnitude: $5,000,000 or $5MM. A bare number could be either.",
        awaiting: field,
      };
    }
    return {
      kind: "values",
      values: [{ field, value: { kind: "currency", amount: money[0].value, text: money[0].text } }],
    };
  }

  if (field.id === "create.termMonths") {
    const months = monthTokens(lower);
    if (!months.length) return null;
    return { kind: "values", values: [{ field, value: { kind: "months", months: months[0].value, text: months[0].text } }] };
  }

  if (field.id === "create.purpose") {
    // The whole line IS the purpose here: the room asked for nothing else.
    const said = trimmed.replace(/[.]+$/, "");
    if (!/[a-z]/i.test(said)) return null;
    return { kind: "values", values: [{ field, value: { kind: "text", text: said } }] };
  }

  return null;
}
