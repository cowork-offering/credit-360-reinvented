import type { BorrowerBundle, Covenant, Facility, LegalEntity } from "../../data/contract";
import { isActiveFacility } from "../../data/worklist";
import { chipSet, orgAccepted, orgRefused, orgValues, type OrgCatalog } from "../../channel/catalog";
import { shortAssetTitle } from "../../domain/collateralAssets";
import { partyShorthand } from "../../workroom/parseModify";
import type { WorkroomDelta, WorkroomMode, WorkroomRefusal } from "../../workroom/types";

/* =============================================================================
   THE CREATE GRAMMAR - WHAT THIS CREATE STILL NEEDS.

   THE DEFECT THIS EXISTS FOR. "add another covenant to all of the loans" put a
   chip on the table reading `New covenant / not on the facility today / to all
   of the loans`. The leftover words became the covenant. A create that has not
   resolved must never reach a chip (D1), a scope word must never be narrowed to
   the focused member in silence (D2), and the sentence over the chips must never
   say the change lands somewhere the chips do not (D3).

   WHAT THIS MODULE IS. A state machine over ONE create: what the human owns,
   what has been settled, what is still missing, and the single next question -
   grounded, in the room's own vocabulary, with the answers as chips. It is
   surface-agnostic: a surface is DESCRIBED (its slots, how it reads a line, how
   it composes the sentence the parser already knows, what it cannot file) and
   the machine does the rest.

   IT PARSES NOTHING THAT MATTERS AND IT STAGES NOTHING. The sentence it composes
   goes through the SAME deterministic parser every typed line goes through, and
   the delta that comes back is VERIFIED against what was elicited before it can
   become a chip. `app/src/workroom/` is untouched by all of it: this adds no
   write arm, no wire and no field. Everything it can compose is something the
   engines already file.

   ONLY ASK FOR WHAT THE HUMAN ACTUALLY OWNS. The bank decides the test, the
   threshold, the frequency, the scope, which asset and the lien position. The
   ORG computes the advance rate, the lendable value and the compliance
   schedule, and this room never asks for those. Asking for a computed field is
   noise; inventing a decided one is a fabrication, and the threshold in
   particular comes from the approved credit agreement and from nowhere else.

   TWO PICTURES, HELD BEFORE ANYTHING IS PROPOSED OR ASKED.
     THE BOOK - what the relationship already carries. Proposals mirror it
       first, a create that duplicates it is named rather than staged blindly,
       and a question the book already answers is not asked.
     THE PLAN - what this session already staged. Nothing already on the plan is
       proposed again, and a line touching a staged entry amends THAT entry
       instead of putting a second, contradicting one beside it.
   ============================================================================= */

/* ------------------------------------------------------------- the surfaces */

/** The create surfaces this room knows. Phase 2 added `involvement`; nothing
 *  else in the machine changed for it. */
export type SurfaceId = "covenant" | "collateral" | "involvement";

/** Every slot any surface can need. A surface declares which ones it uses; the
 *  machine never invents one, and a slot no surface declares is inert. */
export type SlotId =
  | "scope"
  | "test"
  | "threshold"
  | "frequency"
  | "asset"
  | "assetKind"
  | "assetValue"
  | "assetDescription"
  | "advanceRate"
  | "lien"
  | "party"
  | "role";

/** What a create has settled so far. Every field is optional because a create
 *  arrives in pieces and the room asks for the piece it is missing. */
export interface Slots {
  /** The org catalog's own covenant type name, exactly as the book carries it. */
  test?: string;
  /**
   * HOW THE THRESHOLD IS WRITTEN, where the room can tell.
   *
   * "ratio" and "money" come from the banker's own words: an "x" or a currency
   * mark. Absent is the honest third state and it is the BOOK's state: the org
   * keeps every threshold on one numeric field with no unit beside it, so an
   * 80 on a receivables test is an 80 and printing it as "80x" would be a unit
   * this room invented.
   */
  unit?: "ratio" | "money";
  threshold?: number;
  /** The org's own schedule word: Quarterly, Monthly, Annually, One-Off. */
  frequency?: string;
  /** Where the frequency came from, so the card can say it. */
  frequencyFrom?: "said" | "book";
  /**
   * THE BANKER CHOSE TO ASSOCIATE THE COVENANT THE BOOK ALREADY CARRIES rather
   * than create a second record of the same test. In nCino that is a
   * LLC_BI__Loan_Covenant__c junction create pointing at an existing Covenant2,
   * which is a create and not a delete. The ordinary covenant wire carries a
   * TYPE NAME and never an existing covenant id, so this rides
   * `covenantAttachesJson`, the junction-only arm, and stages a real card on a
   * modification. {@link associateGap} is what is left of it on the other two
   * routes.
   */
  associate?: boolean;
  /** The covenant record an associate would attach. The org's own id. */
  existingCovenantId?: string;
  /** An asset the deal already carries. The org's own record id travels. */
  assetId?: string;
  assetLabel?: string;
  /** The org's autonumber (COL-000762), which names exactly one row. */
  assetName?: string;
  /** The banker asked for a SECOND pledge of an asset already on the member. */
  second?: boolean;
  /** The asset is net-new: the whole chain has to be authored. */
  isNew?: boolean;
  /** THE BANKER PICKED "NONE OF THESE, A NEW ASSET" ON THE PLEDGE CHIPS
   *  (founder, 2026-09-03). Unlike a NEW asset composed inline (`isNew`), a
   *  net-new asset is filed at the relationship level first and pledged onto
   *  a facility only afterward, as a modification: this room says so and
   *  stages nothing. Distinct from `isNew` so a line naming an asset the room
   *  CAN compose here is never redirected by a stale pick. */
  newAssetElsewhere?: boolean;
  assetKind?: string;
  assetValue?: number;
  /** The banker's own words for a net-new asset. What the org files as the
   *  collateral description, so it is his and never composed. */
  assetDescription?: string;
  /**
   * THE ADVANCE RATE ON A NET-NEW PLEDGE, as a percentage.
   *
   * Asked for only where the asset is being CREATED, because there the wire
   * requires it: it rides `LLC_BI__Advance_Rate_Override__c`, the plain rate
   * being a formula. On an existing asset the org resolves it and this room
   * never asks.
   */
  advanceRate?: number;
  /** First, second, third. The bank's decision, and no wire carries it. */
  lien?: string;
  /** The party, spelled the way the ORG spells it wherever the book carries the
   *  name. The org has to find the row, so the spelling is the book's. */
  party?: string;
  /** The party is already on this book somewhere. A net-new name is a legitimate
   *  add and is kept verbatim; this is what tells the two apart. */
  partyOnBook?: boolean;
  /** One of the five legal borrowing-structure roles, in the org's own words. */
  role?: string;
}

/* ------------------------------------------------------------- the members */

/** A member, as the create grammar needs it. */
export interface ElicitMember {
  id: string;
  /** The product word. Legitimately repeats across a deal with two lines. */
  key: string;
  /** The room's own display label, with the commitment in front where the
   *  product repeats. What the banker is shown and what a chip says. */
  label: string;
  /**
   * THE ORG'S OWN LOAN NAME, and the reason it is carried.
   *
   * The parser resolves a member on the product word, so "$15.0MM Line of
   * Credit" lands on BOTH lines of credit and the shell's qualifier filter is
   * what narrows it afterwards. The org names a loan `<Borrower> - <Product> -
   * <$Amount>` and that name resolves exactly one member inside the parser
   * itself, which is what lets a composed sentence be exact rather than
   * narrowed. Null where the read carries no name; composition then falls back
   * to the label and verification catches a fan-out.
   */
  orgName: string | null;
  /**
   * THE ORG'S OWN NAME WITH THE BORROWER'S NAME OFF THE FRONT.
   *
   * `<Product> - <$Amount>`, which resolves exactly one member inside the parser
   * (it is one of the member's own identity tokens) AND carries no account name.
   * The involvement surface composes with this rather than with `orgName`
   * because the party reader resolves the first account name it finds in the
   * line, and a full loan name begins with the borrower's. Null where the read
   * carries no name.
   */
  shortName: string | null;
  committed: number | null;
}

/* ================================ SHORTENING A TITLE (2026-09-02)

   "First mortgage on the owner-occupied Fort Wayne manufacturing c… on
   Construction" is what the confirm sentence and the manifest read. The cut
   landed mid-word, because every shortener in this room sliced at a character
   count and stopped.

   ONE RULE, AND IT IS USED EVERYWHERE A TITLE IS SHORTENED. Cut at the last
   word boundary inside the cap, and mark it with the SINGLE ELLIPSIS CHARACTER.
   Three dots end a sentence to every reader that splits on one, and an asset
   title long enough to be cut then carried a false sentence boundary into
   `armConfirmSentence`, which is how half the engine's opening clause leaked
   onto the glass in the first place.

   A cut that would leave less than half the cap falls back to the hard slice:
   a title whose first word is longer than the cap has no boundary to find, and
   a two-character stub is worse than a cut word.                             */

/** The mark. One character, never three dots. */
export const ELLIPSIS = "\u2026";

/** A title, shortened to `cap` characters on a word boundary. */
export function clipTitle(text: string, cap: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= cap) return line;
  const cut = line.slice(0, cap);
  const lastSpace = cut.lastIndexOf(" ");
  const kept = (lastSpace > cap / 2 ? cut.slice(0, lastSpace) : cut).trim().replace(/[\s,;:.-]+$/, "");
  return `${kept}${ELLIPSIS}`;
}

/* ---------------------------------------------------------------- the book */

export interface BookCovenant {
  /** The org's own covenant record id, where the read carries one. What an
   *  ASSOCIATE would have to send: the junction points at THIS record, not at a
   *  fresh one of the same type. */
  id: string | null;
  /** The org catalog's own type name. */
  type: string;
  threshold: number | null;
  frequency: string | null;
  /** The facilities the covenant is attached to. */
  loanIds: string[];
  /** Attached to the relationship rather than to any facility. */
  accountLevel: boolean;
}

export interface BookAsset {
  id: string;
  label: string;
  name: string | null;
  kind: string | null;
  value: number | null;
  lien: string | null;
  /** The facilities this asset is pledged to today. */
  loanIds: string[];
}

/**
 * ONE INVOLVEMENT ROW, as the org holds it.
 *
 * The org holds involvement as ROWS, one per facility, so the same name carries
 * one row per facility and a name can hold different roles on different
 * facilities. That is why the role is read PER FACILITY and never per party:
 * "Elena Hartwell is a guarantor" is not a fact this book carries, and treating
 * it as one is what put the wrong role on the wire (E8, 2026-09-01).
 */
export interface BookParty {
  /** The account name, spelled the way the org spells it. */
  name: string;
  /** The org's own role word for THIS row. */
  role: string;
  /** The facility the row sits on. Null where the row is relationship-wide. */
  loanId: string | null;
}

export interface Book {
  covenants: BookCovenant[];
  assets: BookAsset[];
  /** The lien positions this relationship actually uses, most common first. */
  liens: string[];
  /** Who is on the deal, per facility, in the org's own roles. */
  parties: BookParty[];
}

export const EMPTY_BOOK: Book = { covenants: [], assets: [], liens: [], parties: [] };

/**
 * THE BOOK, READ OFF THE BUNDLE THE ROOM IS ALREADY HOLDING.
 *
 * No read is issued for it. Where the room stands on no bundle the book is
 * empty, every proposal falls back to the doctrine band and every duplicate
 * check simply finds nothing - which is the channel-none doctrine applied to
 * awareness rather than a degraded mode of it.
 */
export function buildBook(bundle: BorrowerBundle | null | undefined, memberIds: string[]): Book {
  if (!bundle) return EMPTY_BOOK;
  const inScope = new Set(memberIds);

  const covenants: BookCovenant[] = [];
  for (const c of (bundle.covenants?.covenants ?? []) as Covenant[]) {
    const type = (c.covenantType ?? "").trim();
    if (!type) continue;
    const attached = c.attachedLoans;
    const loanIds = (attached ?? []).map((a) => a.loanId ?? "").filter((id) => id && inScope.has(id));
    covenants.push({
      id: (c.covenantId ?? "").trim() || null,
      type,
      threshold: typeof c.thresholdValue === "number" ? c.thresholdValue : null,
      frequency: (c.frequency ?? "").trim() || null,
      loanIds,
      // ABSENT AND EMPTY ARE DIFFERENT FACTS. An empty array is the org saying
      // the covenant hangs off the relationship; an absent one is a read that
      // does not carry the field, and neither may be read as the other.
      accountLevel: Array.isArray(attached) && attached.length === 0,
    });
  }

  const byId = new Map<string, BookAsset>();
  const lienCount = new Map<string, number>();
  for (const f of (bundle.exposure?.facilities ?? []) as Facility[]) {
    if (!isActiveFacility(f) || !f.loanId || !inScope.has(f.loanId)) continue;
    for (const row of f.collateral ?? []) {
      if (!row.collateralId) continue;
      const lien = (row.lienPosition ?? "").trim();
      if (lien) lienCount.set(lien, (lienCount.get(lien) ?? 0) + 1);
      const held = byId.get(row.collateralId);
      if (held) {
        held.loanIds.push(f.loanId);
        continue;
      }
      byId.set(row.collateralId, {
        id: row.collateralId,
        label: (row.collateralDescription ?? row.collateralName ?? row.collateralType ?? row.collateralId).trim(),
        name: (row.collateralName ?? "").trim() || null,
        kind: (row.collateralType ?? "").trim() || null,
        value: typeof row.collateralValue === "number" ? row.collateralValue : null,
        lien: lien || null,
        loanIds: [f.loanId],
      });
    }
  }

  /* THE PARTIES, PER FACILITY. `relationshipType` is the graph read's own role
     word and `borrowerType` is what the same rows carry when it is blank; a row
     carrying neither has no role this room may assert, so it is dropped rather
     than defaulted to Borrower. Rows off every in-scope facility are kept with a
     null loan id: a relationship-wide row still names somebody on the deal. */
  const parties: BookParty[] = [];
  for (const e of (bundle.graph?.legalEntities ?? []) as LegalEntity[]) {
    const name = (e.accountName ?? "").trim();
    const role = ((e.relationshipType ?? "").trim() || (e.borrowerType ?? "").trim()).trim();
    if (!name || !role) continue;
    const loanId = (e.loanId ?? "").trim() || null;
    if (loanId && !inScope.has(loanId)) continue;
    parties.push({ name, role, loanId });
  }

  return {
    covenants,
    assets: [...byId.values()],
    liens: [...lienCount.entries()].sort((a, b) => b[1] - a[1]).map(([lien]) => lien),
    parties,
  };
}

/* ------------------------------------------------------- reading the parties

   Two names are the same party when the org would resolve them to the same
   account. Case and the legal suffix are noise a banker drops in speech
   ("Hartwell Industrial Holdings" for "Hartwell Industrial Holdings LLC"), and
   an exact-string rule would miss every one of them.                        */

const ENTITY_SUFFIX = /[\s,.]*\b(?:llc|l\.l\.c\.|inc|inc\.|incorporated|ltd|ltd\.|limited|lp|llp|corp|corp\.|corporation|co|co\.|company|plc)\b[\s,.]*$/i;

/** A name reduced to what identifies it: lower case, no legal suffix, no
 *  punctuation. Never shown; only compared. */
function partyKey(name: string): string {
  return name
    .trim()
    .replace(ENTITY_SUFFIX, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const samePartyName = (a: string, b: string): boolean => {
  const [x, y] = [partyKey(a), partyKey(b)];
  return Boolean(x) && x === y;
};

/** Every distinct name this book carries, longest first so a line naming
 *  "Hartwell Industrial Holdings LLC" is never read as "Hartwell". */
function bookPartyNames(book: Book): string[] {
  const seen = new Map<string, string>();
  for (const p of book.parties) {
    const key = partyKey(p.name);
    const held = seen.get(key);
    if (!held || p.name.length > held.length) seen.set(key, p.name);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

/** The roles this book holds for one name on one facility. */
export function rolesOnFacility(book: Book, name: string, loanId: string): string[] {
  const held = book.parties.filter((p) => p.loanId === loanId && samePartyName(p.name, name));
  return [...new Set(held.map((p) => p.role))];
}

/** The facilities this book holds this name on, with the role each row carries. */
export function facilitiesFor(book: Book, name: string): Array<{ loanId: string; role: string }> {
  return book.parties
    .filter((p) => p.loanId && samePartyName(p.name, name))
    .map((p) => ({ loanId: p.loanId as string, role: p.role }));
}

/**
 * THE PARTY THIS LINE NAMES, resolved against the book FIRST.
 *
 * The book's spelling wins wherever the book carries the name, because the org
 * has to find the row. A name the book does not carry is kept verbatim: putting
 * somebody new on the deal is exactly what an add is.
 */
function readPartyName(line: string, book: Book): { name: string; onBook: boolean } | null {
  const lower = ` ${line.toLowerCase()} `;
  for (const name of bookPartyNames(book)) {
    const key = partyKey(name);
    if (!key) continue;
    if (lower.includes(` ${key} `) || lower.includes(` ${name.toLowerCase()} `)) return { name, onBook: true };
  }
  const fresh = NEW_PARTY_NAMED.exec(line)?.[1]?.trim();
  if (!fresh || NOT_A_PARTY_NAME.test(fresh)) return null;
  /* A SHORTHAND IS STILL THE BOOK'S NAME. "add James as guarantor on the 15M
     line" names James Hartwell, and the parser resolves it that way; a guided
     lane holding the banker's own word instead would compose a sentence and
     then refuse the delta it produced for naming somebody else. One reader,
     shared (`partyShorthand`). Ambiguity settles nothing and the machine asks. */
  const fits = partyShorthand(fresh, bookPartyNames(book));
  if (fits.length === 1) return { name: fits[0], onBook: true };
  if (fits.length > 1) return null;
  return { name: fresh, onBook: false };
}

/* ---------------------------------------------------------------- the plan */

/** One create this session has already put up: open on a chip, or staged on the
 *  manifest. The room reads it back rather than proposing the same thing twice. */
export interface PlanEntry {
  deltaId: string;
  surface: SurfaceId;
  memberId: string | null;
  /** What it is, in the words the plan will show. */
  title: string;
  target: string;
  slots: Slots;
  /** Still a chip waiting on a decision, rather than staged on the manifest. */
  open: boolean;
}

export interface ElicitContext {
  members: ElicitMember[];
  focused: ElicitMember | null;
  book: Book;
  plan: PlanEntry[];
  relationship: string;
  /**
   * THE ORG'S OWN CHIP SETS (`Customer360Catalog`, 2026-09-02).
   *
   * Absent is the channel-none case and every chip set below falls back to the
   * shell's mirror, which is where they have been since the room shipped. A
   * mirror drifts silently; a live read does not, and the first anyone hears of
   * a drift should not be a refusal at the confirm gate.
   */
  catalog?: OrgCatalog | null;
}

/* --------------------------------------------------------------- the draft */

export interface Draft {
  surface: SurfaceId;
  slots: Slots;
  /** The members this create lands on. Empty until the scope is settled. */
  scope: string[];
  /** The line carried a scope word. It is honoured or it is asked about; it is
   *  never narrowed to the focused member in silence (D2). */
  scopeWord: boolean;
  /** What the opening line said that the room could not use (rule 8). */
  unused: string | null;
  /** The catalog names a line matched more than one of. The room asks which
   *  rather than filing one test as another. */
  ambiguousTests?: string[];
  /**
   * THE TEST THE BANKER NAMED THAT THE BANK'S CATALOG DOES NOT CARRY.
   *
   * The banker's own words, held so the room can say them back. An interest
   * coverage test is a real covenant family and this org's catalog has no
   * entry for it, and the difference between those two facts is the whole
   * answer: the room names the gap rather than asking again as if nothing had
   * been typed.
   */
  notInCatalog?: string;
  /**
   * A ROLE THE OBJECT HOLDS AND THIS ROOM REFUSES. `Grantor` and `Contractor`
   * are collateral and construction semantics rather than borrowing structure,
   * and the banker's own word is held so the refusal can name it.
   */
  refusedRole?: string;
  /**
   * THE COLLATERAL FAMILY THE BANKER'S WORD LANDED ON (E6, 2026-09-02).
   *
   * "real estate" is one word and eleven names in this org, and the org refuses
   * the word by name at staging. The family is held so the room can ask WHICH,
   * with the org's own names as the answers, rather than staging a type the
   * catalog cannot resolve.
   */
  typeFamily?: { word: string; values: string[] };
  /**
   * CONSECUTIVE LINES THAT DID NOT SETTLE THE SLOT THE ROOM IS ASKING FOR.
   *
   * WORKROOM-ITERATION-SPEC section 2 is explicit about this machine: "an
   * UNRECOGNIZED answer must not re-emit the identical question". It did.
   * "a solar array" / "photovoltaic panels" / "solar" all fall through the
   * catalog and the six shell words, and the asset-kind question came back
   * verbatim every time, with no escalation and no sign that anything had been
   * read. The value question did the same, including on "first lien", which it
   * had ALREADY ACTED ON.
   *
   * `settled` is what that line DID move, so the re-ask can say so; `count`
   * escalates the ask that settled nothing at all.
   */
  missed?: { slot: SlotId; signature: string; count: number; heard: string; settled: string | null };
}

/** The slot `collateralAsk` is standing on, and the shape of the question it
 *  would put. A line that moved the FAMILY changed the question, so the family
 *  is part of the signature and never counts as a miss. */
function pendingCollateralSlot(draft: Draft): SlotId | null {
  if (draft.surface !== "collateral") return null;
  const s = draft.slots;
  if (!s.isNew && !s.assetId) return "asset";
  if (s.isNew) {
    if (!s.assetKind) return "assetKind";
    if (!s.assetDescription) return "assetDescription";
    if (s.assetValue === undefined) return "assetValue";
    if (s.advanceRate === undefined) return "advanceRate";
  }
  return s.lien ? null : "lien";
}

function pendingSignature(draft: Draft): string | null {
  const slot = pendingCollateralSlot(draft);
  return slot ? `${slot}|${draft.typeFamily?.word ?? ""}` : null;
}

/** The slots a line can settle, in the words the room says them back in. */
const SETTLED_WORDS: Array<{ key: keyof Slots; word: string }> = [
  { key: "lien", word: "lien position" },
  { key: "assetKind", word: "collateral type" },
  { key: "assetDescription", word: "description" },
  { key: "assetValue", word: "value" },
  { key: "advanceRate", word: "advance rate" },
];

/** What this line moved that the room had not held before, or null. */
function settledPhrase(before: Slots, after: Slots): string | null {
  const moved = SETTLED_WORDS.filter((s) => before[s.key] === undefined && after[s.key] !== undefined).map((s) => s.word);
  return moved.length ? sentenceList(moved) : null;
}

/** A line that settled nothing escalates on the SECOND miss. One that settled
 *  something else says so at once: the room acted on it and must not claim it
 *  read nothing. */
const MISS_ESCALATION = 2;

export interface Ask {
  slot: SlotId;
  text: string;
  options: Array<{ label: string; say: string }>;
}

/* ============================================================== scope reading

   A SCOPE WORD FANS OUT OR IT ASKS. It is never dropped and it is never
   narrowed to whatever member happened to be focused (D2, the founder's own
   "he said ALL of the loans; it landed silently on the focused member").

   "LOANS" IS AMBIGUOUS AND THE ROOM SAYS SO. A package carrying revolving lines
   beside term facilities is one where "all of the loans" may mean all six or
   may mean the four that are not lines, and a room that picked one reading
   would be guessing about the scope of a credit action. "Facilities", "all of
   them" and a COUNT that matches are not ambiguous, and they resolve straight
   through.                                                                   */

const ALL_WORD = /\b(all|every|each|both)\b/i;
const GENERIC_NOUN = /\b(facilit(?:y|ies)|members?|them|these|those|loans?)\b/i;
const LOAN_NOUN = /\b(loans?)\b/i;
const RELATIONSHIP_LEVEL = /\b(relationship\s+level|whole\s+relationship|account\s+level|across\s+the\s+relationship)\b/i;

const NUMBER_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, both: 2,
};

/** The count a line states about facilities, or null. */
function statedCount(line: string): number | null {
  const words = line.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|both)\b/);
  if (words) return NUMBER_WORD[words[1]];
  // A BARE DIGIT COUNTS ONLY BESIDE A FACILITY NOUN. "1.25" is a threshold and
  // "20" is a term, and reading either as a count would be the mirror of D1.
  const digits = line.toLowerCase().match(/\b(\d{1,2})\s+(?:facilit(?:y|ies)|members?|loans?|lines?)\b/);
  return digits ? Number(digits[1]) : null;
}

/**
 * THE DESK'S OWN SHORTHAND FOR A PRODUCT.
 *
 * A banker writes LOC, not "line of credit" (founder drive, 2026-09-02: "add a
 * 1% origination fee to LOC"). The alias is not a product word the package
 * carries, so it can never be derived from the members: it is the banker's
 * abbreviation FOR one, and it resolves to the same family the full words do.
 * Nothing here is a list of products; it is a list of ways to say one.
 */
const PRODUCT_ALIAS: Array<{ said: RegExp; key: RegExp }> = [
  { said: /\blocs?\b/i, key: /\bline of credit\b/i },
  { said: /\brevolvers?\b/i, key: /\bline of credit\b/i },
];

/** The product words this package actually uses, longest first so "line of
 *  credit" wins over "line". Derived from the members, never from a list. */
function productWords(members: ElicitMember[]): Array<{ word: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const m of members) {
    const key = m.key.toLowerCase().trim();
    if (!key) continue;
    for (const word of [key, key.split(/\s+/)[0]]) {
      if (!word || word.length < 4) continue;
      const held = groups.get(word) ?? [];
      if (!held.includes(m.id)) held.push(m.id);
      groups.set(word, held);
    }
  }
  return [...groups.entries()]
    .map(([word, ids]) => ({ word, ids }))
    .sort((a, b) => b.word.length - a.word.length);
}

/** The members an abbreviation names, by the product word it stands for. */
function aliasedMembers(line: string, members: ElicitMember[]): string[] {
  const out: string[] = [];
  for (const alias of PRODUCT_ALIAS) {
    if (!alias.said.test(line)) continue;
    for (const m of members) if (alias.key.test(m.key) && !out.includes(m.id)) out.push(m.id);
  }
  return out;
}

/** Two figures are the same figure. The room prints commitments to one decimal
 *  in millions, so "2.5M" and a $2,499,000 record are the same thing said two
 *  ways. Held to the same tolerance the qualifier filter uses. */
function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(50_000, Math.abs(b) * 0.005);
}

const MAGNITUDE: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9,
};

/** Every dollar figure a line carries. A figure counts as money only where it is
 *  written as money: with a currency mark, a magnitude word, or in full. */
export function moneyIn(line: string): number[] {
  const out: number[] = [];
  const re = /(\$\s*)?(\d[\d,]*(?:\.\d+)?)\s*(mm|m|k|bn|b|million|thousand|billion)?\b/gi;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const bare = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(bare)) continue;
    const suffix = (m[3] ?? "").toLowerCase();
    if (!suffix && !m[1] && !(m[2].includes(",") || bare >= 1000)) continue;
    out.push(bare * (MAGNITUDE[suffix] ?? 1));
  }
  return out;
}

export interface ScopeRead {
  ids: string[];
  /** The line carried a scope word of some kind. */
  word: boolean;
  /** The word is there and the set is not settled. The room asks. */
  ambiguous: boolean;
  /** The room said this about the reading, where the reading is worth saying. */
  said: string | null;
}

/**
 * WHICH MEMBERS THE LINE NAMES.
 *
 * Four readings, in the order they should win: a relationship-level word, a
 * dollar qualifier naming exactly one member, a product word naming a group,
 * and an all-word over a generic noun. A line naming none of them carries no
 * scope word at all, and the caller then falls back to the focused member -
 * which is the ONLY place a focus may settle a scope, and only because the line
 * asked for nothing else.
 */
export function readScope(line: string, members: ElicitMember[], claimed: number[] = []): ScopeRead {
  const none: ScopeRead = { ids: [], word: false, ambiguous: false, said: null };
  const lower = line.toLowerCase();
  if (!members.length) return none;

  if (RELATIONSHIP_LEVEL.test(lower)) {
    return { ids: [], word: true, ambiguous: true, said: null };
  }

  /* ================ A FACILITY THIS PLAN IS CREATING (founder, 2026-09-03)

     A modification versions the whole package, so a net-new facility staged on
     the manifest is a member of the plan before it is a member of anything in
     the org. It reaches this reader as a synthetic member whose id IS its label
     ("new:1"), and "the new equipment loan" has to settle on it rather than
     fanning out over the booked equipment loans that share its product word.

     SO IT IS READ FIRST, and only on a line that says NEW. Without that word
     "the equipment loan" means what it always meant, and the product-group
     reading below decides it exactly as before. Where the word is there and two
     new facilities answer to it, the room asks: an arm aimed at the wrong new
     facility is a covenant on the wrong loan, and nothing downstream catches it. */
  const creating = members.filter((m) => /^new:\d+$/i.test(m.id));
  if (creating.length && /\bthe\s+new\b|\bnew\s+(?:loan|facility|line|note)\b/i.test(lower)) {
    const byProduct = creating.filter((m) =>
      new RegExp(`\\b${m.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(lower),
    );
    const settled = byProduct.length === 1 ? byProduct : creating.length === 1 && !byProduct.length ? creating : [];
    if (settled.length === 1) {
      return {
        ids: [settled[0].id],
        word: true,
        ambiguous: false,
        said: `Reading that as the ${settled[0].label}, the facility this plan is creating.`,
      };
    }
    return { ids: [], word: true, ambiguous: true, said: null };
  }

  const all = ALL_WORD.test(lower);
  const generic = GENERIC_NOUN.test(lower);
  const count = statedCount(lower);

  /* A DOLLAR QUALIFIER NAMES ONE MEMBER, and it is the most precise thing a
     banker writes. It only counts where it matches exactly one commitment: a
     figure matching two members names neither. */
  /* A FIGURE THE CREATE ITSELF CLAIMED IS NOT A QUALIFIER. "add a minimum
     liquidity covenant of $5,000,000" on a package carrying a $5.0MM Purchase
     facility would otherwise read its own THRESHOLD as the name of a facility
     and land the covenant somewhere nobody said. Same reading the qualifier
     filter makes on the other side of the parse. */
  const figures = moneyIn(lower).filter((n) => !claimed.some((c) => sameMoney(n, c)));
  const qualified = new Set<string>();
  for (const figure of figures) {
    const hits = members.filter((m) => typeof m.committed === "number" && sameMoney(figure, m.committed));
    if (hits.length === 1) qualified.add(hits[0].id);
  }

  /* THE PRODUCT WORDS THE LINE USES, from the package's own vocabulary. */
  const products = productWords(members);
  const named = new Set<string>();
  let namedGroup: { word: string; ids: string[] } | null = null;
  for (const p of products) {
    if (!new RegExp(`\\b${p.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(lower)) continue;
    namedGroup = namedGroup ?? p;
    for (const id of p.ids) named.add(id);
  }
  /* AND THE DESK'S OWN SHORTHAND FOR THE SAME FAMILY. "LOC" names the lines of
     credit exactly as "line" does, and lands on the same ambiguity question
     where the package carries two of them. */
  if (!namedGroup) {
    const aliased = aliasedMembers(lower, members);
    if (aliased.length) {
      namedGroup = { word: "line of credit", ids: aliased };
      for (const id of aliased) named.add(id);
    }
  }

  // The qualifier wins over the group it sits inside: "the 2.5M line of credit"
  // names one line, not both.
  if (qualified.size === 1) {
    const id = [...qualified][0];
    const member = members.find((m) => m.id === id)!;
    return { ids: [id], word: true, ambiguous: false, said: `Reading that as the ${member.label}.` };
  }
  if (qualified.size > 1) {
    return { ids: [...qualified], word: true, ambiguous: false, said: null };
  }

  /* ALL, over a generic noun. "all six facilities", "every facility", "all of
     them". A COUNT that does not match what the room holds is not a scope: it
     is a disagreement about the package, and the room says so. */
  if (all && generic && !namedGroup) {
    if (LOAN_NOUN.test(lower) && !/\bfacilit(?:y|ies)\b/i.test(lower) && hasLines(members)) {
      // "all of the loans" on a package that also carries lines. Ambiguous by
      // construction, and the founder's own worked line.
      return { ids: [], word: true, ambiguous: true, said: null };
    }
    if (count !== null && count !== members.length) {
      return { ids: [], word: true, ambiguous: true, said: null };
    }
    return { ids: members.map((m) => m.id), word: true, ambiguous: false, said: null };
  }

  /* A PRODUCT GROUP. "both lines", "the two equipment loans", "the lines of
     credit". A stated count that contradicts the group is asked about. */
  if (namedGroup) {
    const ids = namedGroup.ids;
    if (count !== null && count !== ids.length) {
      return { ids: [], word: true, ambiguous: true, said: null };
    }
    // A single product word matching several members, with no count and no
    // all-word, names a PRODUCT rather than a facility. That is exactly the
    // silent fan-out the room was fixed for, so it asks.
    if (ids.length > 1 && !all && count === null) {
      return { ids: [], word: true, ambiguous: true, said: null };
    }
    return { ids, word: true, ambiguous: false, said: null };
  }

  if (all || (count !== null && generic)) {
    if (count !== null && count === members.length) {
      return { ids: members.map((m) => m.id), word: true, ambiguous: false, said: null };
    }
    return { ids: [], word: true, ambiguous: true, said: null };
  }

  return none;
}

/**
 * THE PRODUCT FAMILY THIS LINE NAMES, by id, or an empty list.
 *
 * `readScope` deliberately answers a product word that matches several members
 * with AMBIGUOUS and no ids: naming a product is not naming a facility, and the
 * silent fan-out is the defect it exists to stop. A caller that is about to ASK
 * which one still needs the candidates, and they are exactly this. The room's
 * own abbreviations resolve here too, so "LOC" offers the lines of credit.
 */
export function namedFamily(line: string, members: ElicitMember[]): string[] {
  const lower = (line ?? "").toLowerCase();
  for (const p of productWords(members)) {
    if (new RegExp(`\\b${p.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(lower)) return p.ids;
  }
  return aliasedMembers(lower, members);
}

/** The package carries a revolving line beside something that is not one. */
function hasLines(members: ElicitMember[]): boolean {
  const lines = members.filter((m) => /\bline\b/i.test(m.key));
  return lines.length > 0 && lines.length < members.length;
}

/** The scope question, with the package's own groups as the answers. */
function scopeAsk(ctx: ElicitContext): Ask {
  const groups = new Map<string, string[]>();
  for (const m of ctx.members) {
    const held = groups.get(m.key) ?? [];
    held.push(m.id);
    groups.set(m.key, held);
  }
  const options: Array<{ label: string; say: string }> = [
    { label: `All ${ctx.members.length}`, say: `all ${ctx.members.length} facilities` },
  ];
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    options.push({
      label: `The ${ids.length} ${key} facilities`,
      say: `all ${ids.length} ${key.toLowerCase()} facilities`,
    });
  }
  for (const m of ctx.members) options.push({ label: m.label, say: `the ${m.orgName ?? m.label}` });
  return {
    slot: "scope",
    text:
      `${count(ctx.members.length)} ${ctx.members.length === 1 ? "facility" : "facilities"} on this package. ` +
      "Which of them should this land on?",
    options,
  };
}

const COUNT_WORDS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => COUNT_WORDS[n] ?? String(n);

/* ======================================================= the covenant surface

   THE HUMAN SUPPLIES the test, the threshold, the frequency and the scope. The
   ORG fixes the effective date at creation and owns the compliance schedule.
   THE THRESHOLD IS NEVER INVENTED: it comes from the approved credit agreement,
   and the most the room does is PROPOSE - labelled as a proposal - what this
   relationship already tests, or the band the bank typically writes.

   AN ADD IS SAFE AND AN AMEND IS NOT. The junction fields are non-updateable,
   so a covenant is right at creation or it is wrong forever. That is the whole
   reason a hollow covenant must never stage.                                 */

/** The bands a credit officer would quote, and they are QUOTED, never applied.
 *  No entry here ever becomes a threshold: it is the sentence the room says
 *  while asking the banker for the figure the credit agreement carries. */
const DOCTRINE_BAND: Array<{ match: RegExp; band: string }> = [
  { match: /debt service coverage|dscr/i, band: "banks typically write debt service coverage between 1.20x and 1.25x" },
  { match: /fixed charge|fccr/i, band: "banks typically write fixed charge coverage between 1.15x and 1.25x" },
  { match: /debt to worth|leverage|debt.to.net worth|tnw/i, band: "banks typically cap debt to tangible net worth at 3.00x" },
];

const COVENANT_OPENS =
  /\b(add|create|put|impose|include|attach|set\s+up|write)\b[^.]{0,40}\b(covenants?|tests?)\b|\b(covenants?)\b[^.]{0,20}\b(add|create)\b/i;

/** Reading verbs. "waive the covenant" and "drop the covenant" are not creates,
 *  and neither is a question the read card already answers. */
const NOT_A_CREATE = /\b(waive|waived|drop|remove|delete|release|reset|assess|review|value|show|list|what|which)\b/i;

const FREQUENCIES = ["Quarterly", "Monthly", "Annually", "Semi-Annually", "One-Off"];

const FREQUENCY_WORDS: Array<{ match: RegExp; word: string }> = [
  { match: /\bquarterly|each quarter|every quarter\b/i, word: "Quarterly" },
  { match: /\bmonthly|each month|every month\b/i, word: "Monthly" },
  { match: /\bsemi[- ]?annual(?:ly)?|half[- ]?yearly\b/i, word: "Semi-Annually" },
  { match: /\bannual(?:ly)?|yearly|each year|every year\b/i, word: "Annually" },
  { match: /\bone[- ]?off|once\b/i, word: "One-Off" },
];

/**
 * THE ONE SCHEDULE THE MODIFICATION WIRE WRITES.
 *
 * `covenantAddsJson` files every covenant on the quarterly schedule; there is no
 * frequency input on it. A room that took "tested monthly" and filed a quarterly
 * test would be putting a figure on the glass the org would not receive, which
 * is the fabrication this whole grammar exists to prevent. So the frequency is
 * asked for, and a schedule the wire cannot carry is named as a gap rather than
 * quietly rounded to the one it can.
 */
export const WIRED_FREQUENCY = "Quarterly";

function readFrequency(line: string): string | null {
  for (const f of FREQUENCY_WORDS) if (f.match.test(line)) return f.word;
  return null;
}

/** The threshold a line states, in the unit the line stated it in. A bare
 *  number is a threshold only where an anchor word puts it there: a lone "1.25"
 *  beside a facility is a figure about the deal, not an instruction, and the
 *  unit is left ABSENT rather than assumed. */
function readThreshold(line: string): { value: number; unit?: "ratio" | "money" } | null {
  const lower = line.toLowerCase();
  const ratio = /(\d+(?:\.\d+)?)\s*x\b/.exec(lower);
  if (ratio) return { value: Number(ratio[1]), unit: "ratio" };
  /* AN OPERATOR IN FRONT OF A FIGURE IS THE THRESHOLD, and it is the strongest
     anchor there is: it is how the credit agreement writes it. Found on the
     founder's own line, "add a Debt Service Coverage of Borrower covenant >=
     1.30 on the 8M equipment loan": with no operator in the anchor list the
     reader fell through to the single money token, filed $8,000,000 as the
     THRESHOLD and took the facility's own figure out of the scope reading with
     it, so the room then asked which facility a fully-specified line meant. */
  const operator = /(?:>=|<=|=>|=<|≥|≤|>|<)\s*(\$?)\s*(\d[\d,]*(?:\.\d+)?)\s*(mm|m|k|bn|b|million|thousand|billion)?/i.exec(lower);
  if (operator) {
    const suffix = (operator[3] ?? "").toLowerCase();
    const value = Number(operator[2].replace(/,/g, "")) * (MAGNITUDE[suffix] ?? 1);
    if (Number.isFinite(value)) return { value, unit: operator[1] || suffix ? "money" : undefined };
  }
  const money = moneyIn(lower);
  if (money.length === 1) return { value: money[0], unit: "money" };
  /* "ACTUALLY MAKE IT 1.30" IS THE FOUNDER'S OWN CORRECTION, and it carries no
     unit. The anchor is the verb rather than an operator word: a card is open,
     the figure on it is the thing being corrected, and the unit already on the
     card is the unit it keeps. */
  const anchored =
    /\b(?:max(?:imum)?|min(?:imum)?|at least|at most|no more than|no less than|of|to|above|below|over|under|make\s+(?:it|that)|set\s+(?:it|that)\s+(?:to|at))\s+(\d+(?:\.\d+)?)\b/.exec(lower);
  return anchored ? { value: Number(anchored[1]) } : null;
}

/* ------------------------------------------------------------ the org catalog

   THE TESTS THIS BANK CAN ACTUALLY FILE.

   The org's covenant catalog carries sixty types and several of them duplicate
   a name, so the deployed write settles only the banker vocabulary that lands
   on a UNIQUELY-NAMED entry and refuses everything else. That map is the
   authority; this is a SHELL-SIDE MIRROR of it, and it exists for one reason:
   the room has to be able to say "the catalog does not carry that" BEFORE it
   composes a sentence, rather than gathering three more answers and reading the
   refusal back afterwards.

   A MIRROR IS ONLY HONEST WHILE IT MATCHES. `elicit.test.ts` drives every name
   below through the real engine and asserts the catalog settles on it, so a
   change behind the fence breaks a test rather than a demo.                  */

const ORG_CATALOG: Array<{ match: RegExp; type: string }> = [
  { match: /\bleverage\b/i, type: "Leverage" },
  { match: /\bliquidity\b/i, type: "Minimum Liquidity" },
  { match: /\b(dscr|debt service coverage)\b/i, type: "Debt Service Coverage of Borrower" },
  { match: /\bdebt.to.worth\b/i, type: "Maximum Debt to Worth" },
  { match: /\bcurrent ratio\b/i, type: "Minimum Current Ratio" },
  { match: /\bnet worth\b/i, type: "Net Worth" },
  { match: /\bebitda\b/i, type: "EBITDA" },
  { match: /\bdebt.to.equity\b/i, type: "Debt to Equity" },
  { match: /\bnet profit\b/i, type: "Net Profit" },
];

/** The catalog's own names, in the order the room offers them. */
export const CATALOG_TESTS: string[] = ORG_CATALOG.map((c) => c.type);

/** Words in front of a test that name no test. Stripped before the leftover is
 *  read as what the banker called the covenant. */
const TEST_STOP = new Set([
  "i", "we", "you", "please", "can", "could", "would", "like", "want", "need", "lets", "let", "us", "to",
  "add", "adding", "create", "put", "impose", "include", "attach", "set", "up", "write", "another", "second",
  "third", "new", "additional", "more", "also", "same", "different", "other", "a", "an", "the", "this", "that",
  "these", "those", "one", "some", "any", "and", "on", "for", "of", "with", "extra", "further", "hard", "financial",
  "covenant", "covenants", "test", "tests", "facility", "facilities", "loan", "loans", "line", "lines", "it",
]);

/** The phrase in front of the word "covenant" or "test", which is what a banker
 *  calls the test. Lazy, so it ends on the FIRST such noun in the line. */
const TEST_PHRASE = /([a-z][a-z0-9/'\- ]{2,44}?)\s+(?:covenants?|tests?)\b/i;

/**
 * WHAT THE BANKER CALLED THE TEST, in their own words, or null.
 *
 * Null is the honest answer to "add another covenant": that line names no test
 * at all, and the room's grounded ask is the right answer to it. A phrase comes
 * back only where words the banker chose sit in front of the noun.
 */
export function namedTest(line: string): string | null {
  const found = TEST_PHRASE.exec(line);
  if (!found) return null;
  const words = found[1].toLowerCase().split(/\s+/).filter(Boolean);
  while (words.length && TEST_STOP.has(words[0])) words.shift();
  if (!words.length || words.length > 4) return null;
  if (words.some((w) => TEST_STOP.has(w))) return null;
  return words.join(" ");
}

/**
 * THE COVENANT TYPE THE LINE NAMES.
 *
 * Four readings, in the order they should win: a name the BOOK already carries
 * verbatim, a banker's shorthand over the book's own families, the ORG CATALOG
 * for a test this relationship does not run yet, and finally the honest fourth
 * state - the banker named a test and this bank's catalog does not carry it.
 *
 * THE BOOK COMES BEFORE THE CATALOG ON PURPOSE. "DSCR" names a family this
 * relationship runs twice, and answering it out of the catalog would file one
 * test as another; answering it out of the book asks which, which is the only
 * safe answer to it.
 */
function readTest(
  line: string,
  book: Book,
): { type: string } | { ambiguous: string[] } | { notInCatalog: string } | null {
  const lower = ` ${line.toLowerCase()} `;
  const exact = [...book.covenants]
    .sort((a, b) => b.type.length - a.type.length)
    .find((c) => lower.includes(` ${c.type.toLowerCase()} `) || lower.includes(`${c.type.toLowerCase()} covenant`));
  if (exact) return { type: exact.type };

  /* A BANKER'S SHORTHAND. "dscr" names a FAMILY, and this book carries two
     tests in that family, so the shorthand resolves to a question rather than
     to whichever one sorted first. Each family is its OWN family: leverage and
     debt to worth are two different tests in this catalog, and answering one
     with the other is the memo failure the doctrine names by name. */
  const SHORTHAND: Array<{ match: RegExp; family: RegExp }> = [
    { match: /\b(dscr|debt service coverage|debt service)\b/i, family: /debt service coverage/i },
    { match: /\b(liquidity)\b/i, family: /liquidity/i },
    { match: /\bleverage\b/i, family: /\bleverage\b/i },
    { match: /\b(debt to worth|debt.to.net worth|tnw)\b/i, family: /debt to worth/i },
    { match: /\b(current ratio)\b/i, family: /current ratio/i },
    { match: /\b(net worth)\b/i, family: /net worth/i },
    { match: /\b(fixed charge|fccr)\b/i, family: /fixed charge/i },
  ];
  for (const s of SHORTHAND) {
    if (!s.match.test(line)) continue;
    const hits = book.covenants.filter((c) => s.family.test(c.type));
    const names = [...new Set(hits.map((h) => h.type))];
    if (names.length === 1) return { type: names[0] };
    if (names.length > 1) return { ambiguous: names };
  }

  /* THE CATALOG, for a test this relationship does not run today. A banker who
     types the whole answer skips the questions (rule 3), and a test the bank
     carries is an answer whether or not this book happens to use it. */
  const carried = ORG_CATALOG.find((c) => c.match.test(line));
  if (carried) return { type: carried.type };

  const named = namedTest(line);
  return named ? { notInCatalog: named } : null;
}

/* ===================================================== the collateral surface

   THE HUMAN SUPPLIES which asset - or, for a net-new one, its description, kind
   and value - and the lien position.

   ON AN ASSET THE DEAL ALREADY CARRIES the org resolves the advance rate and the
   lendable value in-transaction and this room asks for neither: the advance rate
   on the pledge is a formula with an override, the lendable value is derived
   from it, and asking a banker to type a figure the org computes is noise
   dressed as diligence.

   ON A NET-NEW ASSET IT IS ASKED FOR, AND NEVER REFUSED (P3, founder
   2026-09-02). "Pledge something the deal already carries" was offered as the
   fallback to creating one, which is pointless: the deal's collateral carries
   onto the clone by itself. Creating an asset and pledging it must be possible.
   The wire genuinely requires the rate on a create - `advanceRate` rides
   `LLC_BI__Advance_Rate_Override__c` because the plain rate is a formula, and
   the org's own Advance_Rate_Override rule demands a written reason beside it -
   so the room ASKS for it, with the bank's own guideline bands as labelled
   proposals and the approved credit terms named as the authority. It proposes;
   it does not set.                                                           */

const COLLATERAL_OPENS =
  /\b(pledge|add|attach|take\s+security|secure)\b[^.]{0,40}\b(collateral|security|asset|lien|receivables?|inventory|equipment|machinery|real\s*estate|warehouse|property|vehicles?|deposits?)\b|\bpledge\b/i;

const LIEN_WORDS: Array<{ match: RegExp; word: string }> = [
  { match: /\b(first|1st)\b/i, word: "1st" },
  { match: /\b(second|2nd)\b/i, word: "2nd" },
  { match: /\b(third|3rd)\b/i, word: "3rd" },
];

const LIEN_OPTIONS = ["1st", "2nd", "3rd"];

/** Words that name no asset in particular, so a hit on one proves nothing. */
const ASSET_STOP = new Set([
  "the", "and", "for", "all", "llc", "inc", "collateral", "asset", "assets", "value", "loan", "pledge", "with",
  "present", "future", "over", "per", "cap", "from", "that", "this", "under", "into", "onto", "position", "lien",
]);

/** The assets a line could mean, best match first. An exact autonumber or record
 *  id names one row and settles it; otherwise the distinctive words of each
 *  label are counted and only the top score survives. */
function matchAsset(line: string, assets: BookAsset[]): BookAsset[] {
  const lower = line.toLowerCase();
  const scored: Array<{ a: BookAsset; score: number }> = [];
  for (const a of assets) {
    if (lower.includes(a.id.toLowerCase())) return [a];
    if (a.name && a.name.length > 3 && lower.includes(a.name.toLowerCase())) return [a];
    const tokens = [...new Set(`${a.label} ${a.kind ?? ""}`.toLowerCase().split(/[^a-z0-9]+/))].filter(
      (t) => t.length > 3 && !ASSET_STOP.has(t),
    );
    const score = tokens.filter((t) => lower.includes(t)).length;
    if (score) scored.push({ a, score });
  }
  if (!scored.length) return [];
  const top = Math.max(...scored.map((s) => s.score));
  return scored.filter((s) => s.score === top).map((s) => s.a);
}

const NEW_ASSET = /\b(new|newly|another|additional|just\s+(?:bought|financed)|not\s+on\s+the\s+deal)\b/i;

/* "THE NEW LOAN" IS A FACILITY, AND THE WORD "NEW" THERE SAYS NOTHING ABOUT THE
   ASSET (founder, 2026-09-03).

   `pledge COL-000763 to the new loan` set `isNew` on the COLLATERAL, because
   NEW_ASSET matched the word qualifying the FACILITY. The room then asked what
   kind of asset it was and what it was worth, about an asset the borrower has
   held all along. Since a net-new facility became a scope member, that phrase
   appears in ordinary lines, so it comes off before either asset reader runs. */
const NEW_FACILITY_PHRASE = /\b(?:the|this|that|our)\s+new\s+(?:[a-z]+\s+){0,2}?(?:loans?|facilit(?:y|ies)|lines?|notes?)\b/gi;

/** The line with the facility phrase taken off, for the asset readers alone. */
const assetText = (text: string): string => text.replace(NEW_FACILITY_PHRASE, " ");

/** Fragments that name the KIND and nothing else. A line saying "real estate"
 *  has answered "what kind", not "what is it". */
const KIND_ALONE = new Set([
  "equipment", "machinery", "real estate", "realestate", "property", "land", "inventory",
  "accounts receivable", "receivables", "a/r", "vehicles", "vehicle", "fleet", "securities",
  "deposits", "cash", "cash and securities",
]);

const escapeRe = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * THE BANKER'S OWN WORDS FOR A NET-NEW ASSET (P3).
 *
 * "pledge new collateral on the construction loan: Kokomo plant expansion, real
 * estate, valued at 6,500,000" names the asset "Kokomo plant expansion", and
 * that phrase is what the org files as the collateral description. It is HIS
 * and it is never composed, so it is read here rather than derived from the
 * sentence the room composes back.
 *
 * WHAT IS STRIPPED is everything that is not the asset: the facility it lands
 * on, read off the package's own names; the pledge verb; the words "new
 * collateral"; the figure; the rate; the lien. What is left is split on the
 * banker's own punctuation and the first substantive fragment wins, because a
 * fragment that is only a collateral TYPE is the answer to a different question.
 */
export function readAssetDescription(text: string, ctx: ElicitContext): string | undefined {
  let rest = ` ${text} `;

  // The facility is not the asset. Named off the package, longest name first.
  const names = ctx.members
    .flatMap((m) => [m.orgName, m.shortName, m.label, m.key])
    .filter((n): n is string => Boolean(n))
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    rest = rest.replace(
      new RegExp(`\\b(?:on|onto|to|against|for|under)\\s+(?:the\\s+|this\\s+|our\\s+)?(?:[$\\d][\\w.,$]*\\s+)?${escapeRe(name)}(?:\\s+(?:loan|line|facility|note|revolver))?\\b`, "gi"),
      " ",
    );
  }
  rest = rest
    .replace(/\b(?:on|onto|to|against|for|under)\s+(?:the|this|our)\s+[^,:;]*?\b(?:loans?|lines?|facilit(?:y|ies)|revolvers?|notes?)\b/gi, " ")
    .replace(/^\s*(?:please\s+)?(?:add|pledge|attach|include|take\s+security\s+over|secure(?:\s+it)?(?:\s+with)?)\b/i, " ")
    .replace(/\b(?:a|an|the)?\s*(?:new|net-new|additional|another)\s+(?:piece\s+of\s+)?(?:collateral|asset|security)\b/gi, " ")
    .replace(/\bas\s+(?:new\s+|additional\s+)*collateral\b/gi, " ")
    .replace(/\b(?:at|of)\s+an?\s+[\d.]+\s*(?:%|per\s?cent|percent)\s*(?:advance(?:\s+rate)?)?/gi, " ")
    .replace(/\b(?:advance\s+rate|advance)\s*(?:of|at)?\s*[\d.]+\s*(?:%|per\s?cent|percent)?/gi, " ")
    .replace(/[\d.]+\s*(?:%|per\s?cent|percent|bps|basis\s+points?)/gi, " ")
    .replace(/\b(?:worth|valued\s+at|value\s+of|value)\s*(?:\$\s*)?[\d,]+(?:\.\d+)?\s*(?:mm|million|k|thousand|bn|billion)?/gi, " ")
    .replace(/(?:\$\s*)?\b\d[\d,]*(?:\.\d+)?\s*(?:mm|million|k|thousand|bn|billion)?\b/gi, " ")
    .replace(/\blien\s+position\b/gi, " ")
    .replace(/\b(?:first|1st|second|2nd|third|3rd)\s+(?:lien|position|mortgage)(?:\s+position)?\b/gi, " ");

  for (const part of rest.split(/[,:;]/)) {
    const said = part
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^(?:and|of|as|it|is)\s+/i, "")
      .replace(/^(?:an?|the)\s+/i, "")
      .replace(/^(?:new|net-new|additional|another)\s+/i, "")
      .replace(/[.,;:]+$/, "")
      .trim();
    if (said.length < 3) continue;
    // A fragment that is ONLY the collateral kind answers "what kind", not
    // "what is it". It is not a description. Matched as the WHOLE fragment: a
    // forklift fleet carries the word "forklift" and is still an asset.
    if (KIND_ALONE.has(said.toLowerCase().replace(/\s+/g, " "))) continue;
    if (/^(?:collateral|assets?|security|pledges?|positions?|liens?|it|this|that)$/i.test(said)) continue;
    return said.length > 200 ? clipTitle(said, 199) : said[0].toUpperCase() + said.slice(1);
  }
  return undefined;
}

/** THE BANKER TOOK THE ASSOCIATE (P1). "the existing one" on its own is enough:
 *  the chip says it and it is the only thing in the room that word can mean. */
const ASSOCIATE_EXISTING = /\b(?:associate|attach|link)\b[^.]*\bexisting\b|\bthe\s+existing\s+one\b|\buse\s+the\s+existing\b/i;

const ASSET_KINDS: Array<{ match: RegExp; word: string }> = [
  { match: /\b(equipment|machine|machines|machinery|tooling|press|lathe|cnc|forklift)\b/i, word: "Equipment" },
  { match: /\b(warehouse|building|plant|premises|real\s*estate|property|land)\b/i, word: "Real Estate" },
  { match: /\b(inventory|raw\s+materials?|finished\s+goods)\b/i, word: "Inventory" },
  { match: /\b(receivables?|accounts\s+receivable|a\/r)\b/i, word: "Accounts Receivable" },
  { match: /\b(vehicles?|trucks?|trailers?|fleet)\b/i, word: "Vehicle" },
  { match: /\b(securities|deposits?|certificate\s+of\s+deposit)\b/i, word: "Cash" },
];

/* ================================ THE ORG'S OWN COLLATERAL TYPES (E6, 2026-09-02)

   FOUNDER DRIVE: "pledge new collateral on the construction loan: Kokomo plant
   expansion, real estate, valued at 6,500,000" staged the asset with the type
   "Real Estate", which is a WORD and not one of this org's types. The org
   refused it at staging, in its own sentence:

     "Real Estate" matches 12 collateral types on this org: Real Estate-1-4
     Family, Real Estate-Construction, Real Estate-Construction, Real Estate-Farm
     Land, Real Estate-Land, Real Estate-Lot, Real Estate-Mobile Home, Real
     Estate-Multi-Family, Real Estate-Office, Real Estate-Other RE, Real
     Estate-Retail, Real Estate-Warehouse. Name one of them exactly.

   Twelve records, eleven distinct names: this org holds `Real Estate-Construction`
   TWICE, which is exactly why the type is a LOOKUP and why the catalog reader
   keeps a record id beside every name.

   SO THE MIRROR CARRIES THE ORG'S OWN FAMILY NAMES. Only the Real Estate family
   is attested here, by the org's own refusal, and it is the family the generic
   word actually collides on. The other five stay the shell's word because no
   read on this cockpit has ever named them and inventing a hyphenated form for
   them would be the same defect from the other side. */
const ORG_REAL_ESTATE_TYPES = [
  "Real Estate-1-4 Family",
  "Real Estate-Construction",
  "Real Estate-Farm Land",
  "Real Estate-Land",
  "Real Estate-Lot",
  "Real Estate-Mobile Home",
  "Real Estate-Multi-Family",
  "Real Estate-Office",
  "Real Estate-Other RE",
  "Real Estate-Retail",
  "Real Estate-Warehouse",
];

/** The shell's own collateral-type list. THE MIRROR, and it stands only where
 *  `Customer360Catalog` carries nothing. Exported so the relationship intake
 *  stands on the SAME mirror rather than refusing every name with an empty chip
 *  set the moment the catalog read comes back empty. */
export const ASSET_KIND_OPTIONS = [
  ...ORG_REAL_ESTATE_TYPES,
  "Equipment",
  "Inventory",
  "Accounts Receivable",
  "Vehicle",
  "Cash",
];

/**
 * THE BANK'S OWN ADVANCE-RATE GUIDELINES, per collateral kind.
 *
 * A BAND, NOT A FIGURE. The approved credit terms are the authority on the rate
 * and the room says so; what it offers is what the bank's guideline carries for
 * that kind of asset, so the banker is choosing rather than typing blind. A kind
 * with no guideline offers nothing and the question stands on its own.
 *
 * Source: WORKROOM-BRAIN 5.1.
 */
const ADVANCE_BANDS: Record<string, { rates: number[]; basis: string }> = {
  Equipment: { rates: [80], basis: "up to 80 percent of orderly liquidation value, on an approved appraisal" },
  "Real Estate": { rates: [75, 80], basis: "75 to 80 percent of appraised value on owner-occupied commercial real estate, and 70 percent of cost on construction, which is the tightest line the bank carries" },
  Inventory: { rates: [50], basis: "up to 50 percent on eligible raw material and finished goods, work in process excluded" },
  "Accounts Receivable": { rates: [80], basis: "up to 80 percent on eligible receivables aged 90 days or less" },
  Cash: { rates: [50, 70], basis: "50 to 70 percent by asset class" },
};

/** The bank's guideline for a type, found by its FAMILY where the org's own
 *  name carries a qualifier after it: the guideline is written for real estate,
 *  and `Real Estate-Construction` is real estate. */
function bandFor(kind: string | undefined): { rates: number[]; basis: string } | undefined {
  if (!kind) return undefined;
  const exact = ADVANCE_BANDS[kind];
  if (exact) return exact;
  const root = Object.keys(ADVANCE_BANDS).find((k) => inFamily(kind, k));
  return root ? ADVANCE_BANDS[root] : undefined;
}

/* ==================================================== the involvement surface

   THE HUMAN SUPPLIES the party, the role and the facility. THE ORG OWNS
   everything else on the row: the entity type, the guaranty amount type and the
   ownership/contingent pair (mutually exclusive by validation rule), none of
   which this room asks for and none of which it invents.

   FIVE ROLES ARE LEGAL HERE. `Grantor` and `Contractor` exist on the object and
   are refused: they are collateral and construction semantics, not borrowing
   structure. Naming one is answered by name rather than by silence.

   AN ADD IS A ROW, NOT AN EDIT. The org holds involvement as rows, so adding a
   party already involved stages a SECOND row for the same name rather than
   correcting the first. That is the trap {@link awarenessFor} exists to catch on
   this surface, and it is why the role is compared per FACILITY.             */

/** The five roles a borrowing-structure change may carry, in the org's own
 *  words. THE MIRROR: the live set is `Customer360Catalog`'s `acceptedValues` on
 *  `LLC_BI__Legal_Entities__c.LLC_BI__Borrower_Type__c`, and this is what stands
 *  where the room has no bridge. Offered in the order a banker reads them. */
export const INVOLVEMENT_ROLES = ["Borrower", "Co-Borrower", "Guarantor", "Limited Guarantor", "Related Entity"];

/** On the object, refused here. Named rather than silently dropped. */
const REFUSED_ROLES: Array<{ match: RegExp; word: string; why: string }> = [
  { match: /\bgrantor\b/i, word: "Grantor", why: "collateral semantics" },
  { match: /\bcontractor\b/i, word: "Contractor", why: "construction semantics" },
];

/* ============================================ the chips, from the org (2026-09-02)

   Founder: "picklist values, fee types, it shows them up." Each reader below
   takes the ORG's live set where the read carries one and the shell's mirror
   where it does not, so a room with no bridge behaves exactly as it always has.
   Nothing extra is said about where a set came from unless the DIFFERENCE
   matters to the banker: a value the org offers that the write path refuses. */

/** The five legal roles, live. */
const involvementRoles = (ctx: ElicitContext): string[] =>
  chipSet(ctx.catalog, "borrowerType", INVOLVEMENT_ROLES).values;

/** The roles the object holds and this room refuses, live. Named, never hidden. */
const refusedRoleWords = (ctx: ElicitContext): string[] => {
  const live = orgRefused(ctx.catalog, "borrowerType");
  return live.length ? live : REFUSED_ROLES.map((r) => r.word);
};

/** How many collateral types to put on the glass at once. The org holds 43 and
 *  a banker reading forty chips is reading none of them; the sentence carries
 *  the count and free text still reaches every one. */
const KIND_CHIP_CAP = 8;

/** THE COLLATERAL TYPES THE WRITE PATH ACCEPTS, live, most useful first: the
 *  kinds this deal already pledges, then the rest of the org's own list. A type
 *  whose advance rate is null is refused before the org's own validation rule
 *  can fire on the insert, which is why `acceptedValues` and not `values`. */
function assetKinds(ctx: ElicitContext): { chips: string[]; total: number; families: number; fromOrg: boolean } {
  const { values, fromOrg } = assetTypeUniverse(ctx);
  /* ONE CHIP PER FAMILY (E6). This org holds eleven Real Estate types and six
     families; offering eleven of the one and none of the others is a chip set
     that answers a different question. The FAMILY is the first question and the
     name is the second, which is the same two beats the org's own refusal
     walks a banker through. */
  const roots: string[] = [];
  for (const value of values) {
    const root = familyRoot(value);
    if (!roots.some((r) => r.toLowerCase() === root.toLowerCase())) roots.push(root);
  }
  const held = new Set(ctx.book.assets.map((a) => familyRoot(a.kind ?? "").toLowerCase()).filter(Boolean));
  const ordered = roots.sort((a, b) => Number(held.has(b.toLowerCase())) - Number(held.has(a.toLowerCase())));
  return { chips: ordered.slice(0, KIND_CHIP_CAP), total: values.length, families: roots.length, fromOrg };
}

/** The family a type name belongs to: everything in front of the qualifier the
 *  org hangs off it. "Real Estate-Warehouse" is Real Estate's; "Equipment" is
 *  its own. */
function familyRoot(value: string): string {
  const cut = value.search(/[-/]/);
  const root = cut > 0 ? value.slice(0, cut) : value;
  return root.trim() || value;
}

/* ------------------------------------------- the type, resolved to the org's

   ONE RULE, IN ONE PLACE. The room never sends a WORD where the org holds a
   NAME. The universe is the org's own accepted set wherever the catalog is in
   hand and the mirror where it is not, and the same three readings run over
   either: a name the banker typed wins outright, a generic word that lands on
   one name settles to it, and a generic word that lands on several is a
   QUESTION with those names as the answers. */

/** How many family names go on the glass at once. A family is bounded by
 *  construction and the Real Estate one is eleven, so it is shown whole. */
const FAMILY_CHIP_CAP = 12;

/** Every collateral type this room may settle on, and where it came from. */
function assetTypeUniverse(ctx: ElicitContext): { values: string[]; fromOrg: boolean } {
  const live = orgAccepted(ctx.catalog, "collateralType");
  return live.length
    ? { values: [...new Set(live)], fromOrg: true }
    : { values: ASSET_KIND_OPTIONS, fromOrg: false };
}

/** Is `value` a member of `root`'s family? The org names a family member by
 *  putting a separator and a qualifier after the family's own words, so
 *  "Real Estate-Construction" is Real Estate's and "Real Estate Investment
 *  Trust" would be too. A bare prefix is not enough: "Cashflow" is not "Cash". */
function inFamily(value: string, root: string): boolean {
  const v = value.toLowerCase();
  const r = root.toLowerCase();
  if (v === r) return true;
  return v.startsWith(r) && /[^a-z0-9]/.test(v.charAt(r.length));
}

export type AssetTypeRead =
  /** One org name, settled. */
  | { kind: "exact"; value: string }
  /** A word the org holds several names under. The room asks which. */
  | { kind: "family"; word: string; values: string[] };

/**
 * THE COLLATERAL TYPE THIS LINE NAMES, against the org's own catalog.
 *
 * Null is not a failure: the line said nothing about the kind of asset, and the
 * slot stays where it was.
 */
export function readAssetType(text: string, ctx: ElicitContext): AssetTypeRead | null {
  const { values } = assetTypeUniverse(ctx);
  const lower = text.toLowerCase();

  /* AN ORG NAME THE BANKER TYPED WINS OUTRIGHT, longest first, so
     "Real Estate-Construction" is never read as the word in front of it. Where
     the longest name the line carries has kin, the banker typed the FAMILY's
     own words and the question still stands. */
  const contained = values.filter((v) => lower.includes(v.toLowerCase())).sort((a, b) => b.length - a.length);
  if (contained.length) {
    const best = contained[0];
    const kin = values.filter((v) => v !== best && inFamily(v, best));
    if (!kin.length) return { kind: "exact", value: best };
    return { kind: "family", word: best, values: [best, ...kin].slice(0, FAMILY_CHIP_CAP) };
  }

  const generic = ASSET_KINDS.find((k) => k.match.test(text));
  if (!generic) return null;
  const family = values.filter((v) => inFamily(v, generic.word));
  if (family.length === 1) return { kind: "exact", value: family[0] };
  if (family.length > 1) return { kind: "family", word: generic.word, values: family.slice(0, FAMILY_CHIP_CAP) };
  /* THE WORD, WHERE THE CATALOG HOLDS NOTHING UNDER IT. The org resolves it and
     refuses it with its own list, which is the state this room was always in. */
  return { kind: "exact", value: generic.word };
}

/** The lien positions, live. */
const lienPositions = (ctx: ElicitContext): string[] => chipSet(ctx.catalog, "lienPosition", LIEN_OPTIONS).values;

/**
 * THE NINE THE ROOM'S OWN PARSER CAN SETTLE, and the rest named honestly.
 *
 * The org accepts all 71 of its covenant types by `typeId`; the NINE are the
 * names `parseModify.ts`'s `COVENANT_TYPE_MAP` resolves uniquely from a typed
 * line, and that filter is the SHELL's rather than the bank's. So the chips are
 * the nine, and what the catalog carries beyond them is stated as present in
 * the org and not fileable from a name here, never offered as a chip that ends
 * in a refusal.
 *
 * The list is a mirror of the fenced map, which does not export it. It is the
 * one mirror on this surface that is honest, because what it mirrors is this
 * client's own vocabulary and not the org's data.
 */
export const FILEABLE_COVENANT_TYPES = [
  "Leverage",
  "Minimum Liquidity",
  "Debt Service Coverage of Borrower",
  "Maximum Debt to Worth",
  "Minimum Current Ratio",
  "Net Worth",
  "EBITDA",
  "Debt to Equity",
  "Net Profit",
];

function covenantTypeChips(ctx: ElicitContext): { fileable: string[]; presentNotFileable: number } {
  const live = orgValues(ctx.catalog, "covenantType");
  if (!live.length) return { fileable: FILEABLE_COVENANT_TYPES, presentNotFileable: 0 };
  const nine = new Set(FILEABLE_COVENANT_TYPES.map((t) => t.toLowerCase()));
  const fileable = [...new Set(live.filter((t) => nine.has(t.toLowerCase())))];
  return { fileable, presentNotFileable: new Set(live.map((t) => t.toLowerCase())).size - fileable.length };
}

/** Longest first, so "limited guarantor" is never read as "guarantor" with a
 *  stray word in front. The same order the parser under this room uses. */
const ROLE_WORDS: Array<{ match: RegExp; word: string }> = [
  { match: /\blimited\s+guarantor\b/i, word: "Limited Guarantor" },
  { match: /\bco[-\s]?borrower\b/i, word: "Co-Borrower" },
  { match: /\brelated\s+entity\b/i, word: "Related Entity" },
  { match: /\bguarantor\b/i, word: "Guarantor" },
  { match: /\bborrower\b/i, word: "Borrower" },
];

function readRoleWord(line: string): string | null {
  for (const r of ROLE_WORDS) if (r.match.test(line)) return r.word;
  return null;
}

const refusedRole = (line: string) => REFUSED_ROLES.find((r) => r.match.test(line)) ?? null;

/** A line that puts somebody ON the deal. A REMOVE is not a create: it has its
 *  own lane and files as a carry exclusion. */
const INVOLVEMENT_OPENS =
  /\b(?:add|bring\s+in|put)\b[^.]{0,60}?\b(?:as\s+(?:an?\s+|the\s+)?)?(?:limited\s+guarantor|co[-\s]?borrower|related\s+entity|guarantor|borrower|grantor|contractor)\b|\badd\b[^.]{0,20}\b(?:legal\s+entity|entity|party|obligor)\b/i;

/** Verb, optional article, optional role, then the capitalised name. The shell's
 *  own reading of the shape the parser also walks: a banker writes the role in
 *  lower case and the entity name capitalised. */
const NEW_PARTY_NAMED =
  /\b(?:add|bring\s+in|put|remove|release|drop|take)\s+(?:(?:the|an?)\s+)?(?:(?:limited\s+guarantor|co[-\s]?borrower|related\s+entity|guarantor|borrower)\s+)?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/;

/** Not a name, whatever the capitalisation. */
const NOT_A_PARTY_NAME =
  /^(?:an?|the|entity|party|second|new|another|limited\s+guarantor|co[-\s]?borrower|related\s+entity|guarantor|borrower|grantor|contractor)$/i;

/* ========================================================== opening a create */

/**
 * WHICH CREATE THIS LINE OPENS, with everything it already carries read into it.
 *
 * Null is the common case and it is not a failure: the line is not a create,
 * and the room's existing lanes take it exactly as they always have.
 */
export function openCreate(line: string, ctx: ElicitContext): Draft | null {
  const text = line.trim();
  if (!text) return null;

  /* THE INVOLVEMENT SURFACE IS TESTED FIRST, and the order is load-bearing. A
     line naming a legal ROLE beside a party verb is a borrowing-structure line
     and nothing else, while "add Elena Hartwell as limited guarantor on the 8M
     equipment loan" carries the word "equipment" and would otherwise open a
     collateral pledge on it. The role word is what makes it unambiguous.

     AND SO IS A NAME THE BOOK CARRIES. "add Elena Hartwell to the 8M equipment
     loan" names no role at all, and the only thing in the line that says what
     kind of change it is, is that Elena Hartwell is a party on this deal. That
     is grounded rather than guessed: a name the book does not carry does NOT
     open this surface, because there the line could be anything. */
  /* A COVENANT LINE IS A COVENANT LINE, whatever role word its TEST NAME
     happens to carry. "add a Debt Service Coverage of Borrower covenant >= 1.30
     on the 8M equipment loan" names the org's own catalog entry, and the word
     "Borrower" inside it is part of that name rather than a borrowing-structure
     role. So the covenant surface is decided first, and the involvement surface
     stands down on any line naming a covenant or a pledge at all. */
  const covenantLine = COVENANT_OPENS.test(text);
  const namedParty = /\b(?:add|adds|bring\s+in|put)\b/i.test(text) && readPartyName(text, ctx.book)?.onBook;
  const involvementLine =
    !covenantLine &&
    (INVOLVEMENT_OPENS.test(text) || namedParty) &&
    !/\b(covenants?|tests?|collateral|pledges?|liens?|security)\b/i.test(text);
  const surface: SurfaceId | null = covenantLine
    ? "covenant"
    : involvementLine
      ? "involvement"
      : COLLATERAL_OPENS.test(text)
        ? "collateral"
        : null;
  if (!surface) return null;
  // A REMOVAL IS NOT A CREATE, and neither is a question. Both have lanes of
  // their own and both would be ruined by being gathered for.
  if (NOT_A_CREATE.test(text) && !/\bsecond\b/i.test(text)) return null;

  const draft: Draft = { surface, slots: {}, scope: [], scopeWord: false, unused: null };
  return readInto(draft, text, ctx, { opening: true });
}

/* ============================================================ reading a line */

/**
 * EVERYTHING THIS LINE SETTLES, folded onto what the draft already holds.
 *
 * FREE TEXT ALWAYS WINS. The room asks one question at a time and offers chips,
 * and a banker who types the whole answer skips every one of them: this reads
 * the line for EVERY slot the surface takes, not only for the one just asked.
 */
export function readInto(draft: Draft, line: string, ctx: ElicitContext, opts: { opening?: boolean } = {}): Draft {
  const next: Draft = { ...draft, slots: { ...draft.slots }, scope: [...draft.scope] };
  const text = line.trim();
  /** The figures this create claimed for itself. Never read as a facility. */
  const claimed: number[] = [];

  if (next.surface === "covenant") {
    /* ASSOCIATE THE ONE THE BOOK ALREADY CARRIES (P1). The chip says it in
       these words and a banker may type them; either way it names an EXISTING
       covenant record rather than a new one, so the record's own id, threshold
       and schedule come off the book and nothing here is invented. */
    if (ASSOCIATE_EXISTING.test(text)) next.slots.associate = true;
    const test = readTest(text, ctx.book);
    if (test && "type" in test) {
      next.slots.test = test.type;
      next.ambiguousTests = undefined;
      next.notInCatalog = undefined;
    } else if (test && "ambiguous" in test) {
      /* THE CATALOG CARRIES THE FAMILY TWICE. "dscr" on this book names two
         different tests, and the parser under this room resolves both to the
         first one it matches, so a room that picked would file one test as
         another. It asks instead, with the catalog's own two names. */
      next.ambiguousTests = test.ambiguous;
      next.notInCatalog = undefined;
    } else if (test && "notInCatalog" in test) {
      /* HE NAMED A TEST AND THE BANK DOES NOT CARRY IT. Re-asking "what is it
         though" over a line that already said what it is would be the room
         pretending nothing was typed, which is the defect this branch exists
         to end. The threshold and the schedule he typed stay on the draft and
         travel onto whichever test he names. */
      next.notInCatalog = test.notInCatalog;
    }
    const threshold = readThreshold(text);
    if (threshold) {
      next.slots.threshold = threshold.value;
      if (threshold.unit) next.slots.unit = threshold.unit;
      if (threshold.unit === "money") claimed.push(threshold.value);
    }
    const frequency = readFrequency(text);
    if (frequency) {
      next.slots.frequency = frequency;
      next.slots.frequencyFrom = "said";
    }

    /* THE EXISTING RECORD, RESOLVED. An associate that cannot name the record
       it would attach is not an associate, so the flag comes off rather than
       travelling as a claim nothing backs. */
    if (next.slots.associate) {
      const held = ctx.book.covenants.find((c) => c.type === next.slots.test && c.id);
      if (held) {
        next.slots.existingCovenantId = held.id!;
        if (held.threshold !== null) {
          next.slots.threshold = held.threshold;
          delete next.slots.unit;
        }
        if (held.frequency) {
          next.slots.frequency = held.frequency;
          next.slots.frequencyFrom = "book";
        }
      } else {
        delete next.slots.associate;
      }
    }
  }

  if (next.surface === "involvement") {
    /* THE NAME FIRST, AGAINST THE BOOK. The org has to find the row, so a name
       the deal already carries travels spelled the way the org spells it; a
       name the book does not carry is kept verbatim, because putting somebody
       new on the deal is exactly what an add is. */
    const party = readPartyName(text, ctx.book);
    if (party) {
      next.slots.party = party.name;
      next.slots.partyOnBook = party.onBook;
    }
    const refused = refusedRole(text);
    const role = readRoleWord(text);
    if (role) {
      next.slots.role = role;
      next.refusedRole = undefined;
    } else if (refused) {
      /* HE NAMED A ROLE THE OBJECT HOLDS AND THIS ROOM WILL NOT WRITE. Asking
         "which role?" over a line that already said one would be the room
         pretending nothing was typed. The name and the facility he gave stay on
         the draft and travel onto whichever legal role he names. */
      next.refusedRole = refused.word;
    }
  }

  if (/\bsecond\b/i.test(text)) next.slots.second = true;

  if (next.surface === "collateral") {
    /* THE BANKER CAME BACK TO WHAT THE DEAL ALREADY HOLDS. A net-new asset is
       the one shape this room cannot compose on its own, so the way back out of
       it has to exist and has to be explicit. */
    const said = assetText(text);
    /* "NONE OF THESE, A NEW ASSET" (founder, 2026-09-03). The chip's own
       phrase, matched before the ordinary NEW_ASSET reading so it never falls
       into `isNew` and gets composed here: a net-new asset is filed at the
       relationship level first, and pledging it rides a modification once it
       exists. Any later line naming an asset this room CAN resolve, or saying
       it is one the deal already carries, takes the flag back off. */
    if (/\bnone of these\b/i.test(said)) next.slots.newAssetElsewhere = true;
    if (/\bexisting\b|\balready carries\b|\bon the deal\b/i.test(said)) delete next.slots.isNew;
    else if (NEW_ASSET.test(said) && !next.slots.second) next.slots.isNew = true;
    if (!next.slots.isNew) {
      const hits = matchAsset(said, ctx.book.assets);
      if (hits.length === 1) {
        next.slots.assetId = hits[0].id;
        next.slots.assetLabel = hits[0].label;
        next.slots.assetName = hits[0].name ?? undefined;
        if (hits[0].lien && next.slots.lien === undefined) next.slots.lien = hits[0].lien;
        delete next.slots.newAssetElsewhere;
      }
    }
    /* FREE TEXT WINS ON THE TYPE (E3, the founder's own line: "Kokomo plant
       expansion, real estate, valued at 6,500,000" was answered with "what kind
       of asset is it?"). The typed type is read against the catalog on EVERY
       line and before the net-new flag is known, because a banker who wrote the
       type has answered the question whether or not the room had got round to
       deciding the asset was new. */
    /* AND THE TYPE IS THE ORG'S NAME, NEVER THE WORD (E6). A word this org
       holds several names under is a question with those names as the answers;
       a name the banker typed settles the slot outright. */
    const typed = readAssetType(text, ctx);
    if (typed?.kind === "exact") {
      next.slots.assetKind = typed.value;
      delete next.typeFamily;
    } else if (typed?.kind === "family") {
      delete next.slots.assetKind;
      next.typeFamily = typed;
    }
    if (next.slots.isNew) {
      /* THE RATE IS READ BEFORE THE VALUE, and the order is load-bearing: a
         percentage carries its own mark, so taking it out of the line first
         stops "75" being read as $75 and filed as what the asset is worth. */
      const pct = /(\d+(?:\.\d+)?)\s*(?:%|per\s?cent|percent)/i.exec(text);
      if (pct) next.slots.advanceRate = Number(pct[1]);
      const money = moneyIn(pct ? text.replace(pct[0], " ") : text);
      if (money.length) {
        next.slots.assetValue = money[money.length - 1];
        claimed.push(money[money.length - 1]);
      }
      /* HIS OWN WORDS FOR THE ASSET. Only where the line carries some, and
         never overwritten by a later line that carries none: the description
         settles once, the way the lien and the kind do. */
      /* IT SETTLES ONCE. Every later line still reads for every slot (free text
         always wins), and "1st lien position" answered into an open create would
         otherwise overwrite the banker's own words for the asset with the answer
         to a different question. */
      if (next.slots.assetDescription === undefined) {
        const said = readAssetDescription(text, ctx);
        if (said) next.slots.assetDescription = said;
      }
    }
    const lien = LIEN_WORDS.find((l) => l.match.test(text));
    if (lien) next.slots.lien = lien.word;
  }

  /* ---- WHAT THIS LINE DID NOT ANSWER, counted. The room may ask again; it may
          not ask again in the same words as if nothing had been said. */
  if (next.surface === "collateral" && !opts.opening) {
    const before = pendingSignature(draft);
    const after = pendingSignature(next);
    if (after && after === before) {
      next.missed = {
        slot: pendingCollateralSlot(next)!,
        signature: after,
        count: draft.missed?.signature === after ? draft.missed.count + 1 : 1,
        heard: text,
        settled: settledPhrase(draft.slots, next.slots),
      };
    } else if (next.missed) {
      delete next.missed;
    }
  }

  /* ---- the scope, LAST, so the create's own figures cannot be mistaken for a
          facility. A scope word is honoured or asked about, never narrowed.

          AND A PARTY'S OWN NAME IS NOT A FACILITY EITHER (D1, the three-book
          matrix, 2026-09-13). `productWords` indexes each member by its key AND
          by the key's FIRST WORD, which is what lets "equipment" name the
          equipment loans. On a book whose loans are not named
          `<Borrower> - <Product> - <$Amount>` the key keeps the borrower's name
          on the front, so that first word is the BORROWER'S: on Kingsley,
          "kingsley" names all three facilities at once. "add Kingsley Family
          Trust as guarantor on the 8M Kingsley Working Capital Revolver"
          therefore asked which of the three it should land on, over a line that
          had already named one, because by the time the scope was read the
          facility phrase had been scrubbed out and the GUARANTOR'S OWN NAME was
          the only thing left carrying the word.

          Same judgement as `claimed` above, one slot further along: a word this
          surface has already settled as the PARTY cannot also be the facility. */
  const settledParty = next.surface === "involvement" ? String(next.slots.party ?? "").trim() : "";
  const forScope = settledParty
    ? text.replace(new RegExp(settledParty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    : text;
  const scope = readScope(forScope, ctx.members, claimed);
  if (scope.word) {
    next.scopeWord = true;
    next.scope = scope.ids;
  } else if (opts.opening && ctx.focused) {
    // NO SCOPE WORD AT ALL. The focused member is the answer to "which one?"
    // for a line that asked nothing else, and only for such a line.
    next.scope = [ctx.focused.id];
  }

  return next;
}

/* ================================================== the one question, grounded

   OFFER BEFORE ASKING, AND SAY WHERE THE ANSWER COMES FROM. Every proposal is
   grounded in this relationship FIRST - what the book already tests, what the
   deal already pledges - then in the org's own catalog, and only then in the
   doctrine band, which is quoted as guidance and never applied as a value.  */

export function nextAsk(draft: Draft, ctx: ElicitContext): Ask | null {
  /* THE CATALOG GAP IS ANSWERED BEFORE ANYTHING ELSE. A banker who typed an
     interest coverage test has said what he wants; asking him which facilities
     it lands on before telling him the bank cannot write it at all would spend
     his gesture on a decision that turns out not to exist. */
  if (draft.surface === "covenant" && !draft.slots.test && draft.notInCatalog) return catalogAsk(draft, ctx);

  /* THE SCOPE WORD IS ANSWERED FIRST WHERE IT IS THE THING IN DOUBT. The
     founder's own line opens on one: "add another covenant to all of the loans"
     is a question about WHICH FACILITIES before it is a question about which
     test, and a room that asked for the threshold first would have parked the
     word it could not read. Where the line carried no scope word the scope is
     the LAST question, because by then the room can say what it is scoping. */
  /* THE REFUSED ROLE IS ANSWERED BEFORE ANYTHING ELSE, for the same reason the
     catalog gap is: a banker who typed "grantor" has said what he wants, and
     asking which facility it lands on before telling him the room will not
     write that role at all would spend his gesture on a decision that turns out
     not to exist. */
  if (draft.surface === "involvement" && !draft.slots.role && draft.refusedRole) return refusedRoleAsk(draft, ctx);

  if (draft.scopeWord && !draft.scope.length) return scopeAskFor(draft, ctx);
  if (draft.surface === "covenant") return covenantAsk(draft, ctx);
  if (draft.surface === "involvement") return involvementAsk(draft, ctx);
  return collateralAsk(draft, ctx);
}

/**
 * WHAT THE BOOK ALREADY ANSWERS, TAKEN FROM THE BOOK.
 *
 * Streamlined means fewer GESTURES, not fewer facts. A relationship that tests
 * this covenant on one schedule everywhere it carries it has already answered
 * "how often", so the room takes the answer instead of asking for it - and the
 * card says where it came from, because a fact taken silently is indistinguish-
 * able from one invented. The threshold and the scope are never settled here:
 * those are the banker's, and awareness is never spent on skipping a decision.
 */
export function settleFromBook(draft: Draft, ctx: ElicitContext): Draft {
  if (draft.surface !== "covenant" || !draft.slots.test || draft.slots.frequency) return draft;
  const schedules = [
    ...new Set(ctx.book.covenants.filter((c) => c.type === draft.slots.test).map((c) => c.frequency).filter((f): f is string => Boolean(f))),
  ];
  if (schedules.length !== 1) return draft;
  return { ...draft, slots: { ...draft.slots, frequency: schedules[0], frequencyFrom: "book" } };
}

/** The draft with everything the book settles folded in, and the one question
 *  that is left. `ask` null means the create is complete and can be composed. */
export function advance(draft: Draft, ctx: ElicitContext): { draft: Draft; ask: Ask | null } {
  const settled = settleFromBook(draft, ctx);
  return { draft: settled, ask: nextAsk(settled, ctx) };
}

/**
 * THE BANK DOES NOT CARRY THAT TEST, SAID PLAINLY.
 *
 * A room that answered "add an interest coverage covenant of 3.0x tested
 * quarterly" by listing what the relationship already runs has thrown away
 * three things the banker typed and told him nothing about why. So the gap is
 * NAMED, the catalog is offered in its own words, and the figures he already
 * gave are said back so he can see they are still held: the next line names a
 * test and nothing else, and the create completes on it.
 *
 * WHAT THE RELATIONSHIP ALREADY RUNS COMES FIRST (rule 2), because a test this
 * book already carries is the grounded answer and the rest of the catalog is
 * the fallback behind it.
 */
function catalogAsk(draft: Draft, ctx: ElicitContext): Ask {
  const onBook = new Set(ctx.book.covenants.map((c) => c.type));
  const ordered = [...CATALOG_TESTS].sort((a, b) => Number(onBook.has(b)) - Number(onBook.has(a)));
  const held = [
    draft.slots.threshold !== undefined ? thresholdText(draft.slots.threshold, draft.slots.unit) : null,
    draft.slots.frequency ? `the ${draft.slots.frequency.toLowerCase()} schedule` : null,
  ].filter((h): h is string => Boolean(h));
  return {
    slot: "test",
    text:
      `The bank's catalog does not carry ${article(draft.notInCatalog!)} ${draft.notInCatalog} test, so there is nothing for me to file it against. ` +
      `It carries ${sentenceList(ordered)}. ` +
      (held.length
        ? `I am holding ${sentenceList(held)} and will carry ${held.length === 1 ? "it" : "them"} onto whichever of those you name.`
        : "Name one of those and I will take the threshold from there."),
    options: ordered.map((name) => ({ label: name, say: `a ${name} covenant` })),
  };
}

const article = (word: string) => (/^[aeiou]/i.test(word.trim()) ? "an" : "a");

function covenantAsk(draft: Draft, ctx: ElicitContext): Ask | null {
  const s = draft.slots;

  /* THE FAMILY NAMES TWO TESTS. The catalog carries "Debt Service Coverage of
     Borrower" and "Debt Service Coverage with and without Distributions", and a
     banker who writes "DSCR" has named the family rather than the test. Saying
     one when the covenant means the other is a classic memo failure, and it is
     unrecoverable here: covenant AMEND is refused outright, so a covenant is
     right at creation or it is wrong forever. */
  if (!s.test && draft.ambiguousTests?.length) {
    return {
      slot: "test",
      text: `The bank's catalog carries ${count(draft.ambiguousTests.length).toLowerCase()} tests in that family, and they are not the same test. Which one?`,
      options: draft.ambiguousTests.map((name) => ({ label: name, say: `a ${name} covenant` })),
    };
  }

  if (!s.test) {
    /* MIRROR THE BOOK FIRST. What this relationship already tests is the
       grounded proposal, it carries its own threshold and its own schedule, and
       taking one is a single gesture that settles three slots. */
    const mirrors = mirrorChips(ctx.book);
    /* AND WHAT THE BANK'S CATALOG CARRIES BEYOND THE BOOK. The nine are the
       names this room's own parser settles uniquely; the rest of the org's
       catalog is named as present and not fileable from a name here, rather
       than offered as a chip that ends in a refusal. */
    const catalog = covenantTypeChips(ctx);
    const mirrored = new Set(mirrors.map((m) => m.what.toLowerCase()));
    const more = catalog.fileable.filter((t) => ![...mirrored].some((w) => w.startsWith(t.toLowerCase())));
    return {
      slot: "test",
      text:
        "To file one I need the test, the threshold and how often it is tested. " +
        (mirrors.length
          ? `This relationship already runs ${sentenceList(mirrors.map((m) => m.what))}. I can mirror one of those, or take new terms from the approved credit agreement. I will not set a threshold myself.`
          : "The approved credit agreement is the authority on all three, and I will not set a threshold myself. Name the test and I will take it from there.") +
        (catalog.presentNotFileable
          ? ` The bank's catalog carries ${catalog.presentNotFileable} more types beyond these; they are in the org, and this room cannot settle one from a name, so it does not offer them.`
          : ""),
      options: [
        ...mirrors.map((m) => ({ label: m.label, say: m.say })),
        ...more.map((t) => ({ label: t, say: `a ${t.toLowerCase()} covenant` })),
        { label: "A different test", say: "a different test" },
      ],
    };
  }

  /* AN ASSOCIATE ASKS FOR NEITHER. The threshold and the schedule are the
     EXISTING record's, and a room that asked for them would be offering to
     change a covenant it is only attaching - which is the amend this fence
     refuses outright. */
  if (s.threshold === undefined && !s.associate) {
    const band = DOCTRINE_BAND.find((b) => b.match.test(s.test!));
    const held = ctx.book.covenants.filter((c) => c.type === s.test && typeof c.threshold === "number");
    return {
      slot: "threshold",
      text:
        `What should the ${s.test} test be set at? The threshold IS the covenant and it comes from the approved credit agreement, so I will not pick one. ` +
        (held.length
          ? `This relationship carries it at ${thresholdText(held[0].threshold!)} today.`
          : band
            ? `As a band rather than a figure: ${band.band}.`
            : "Say it the way the agreement writes it."),
      options: held.length
        ? [{ label: `Keep it at ${thresholdText(held[0].threshold!)}`, say: `of ${thresholdText(held[0].threshold!)}` }]
        : [],
    };
  }

  if (!s.frequency && !s.associate) {
    /* WHERE THE BOOK ANSWERS IT, THE ROOM DOES NOT ASK. A relationship that
       tests this covenant on one schedule everywhere it carries it has already
       answered the question, and the card says where the answer came from. */
    const schedules = [...new Set(ctx.book.covenants.filter((c) => c.type === s.test).map((c) => c.frequency).filter(Boolean))];
    if (schedules.length === 1) {
      // Settled from the book. Not an ask.
      return null;
    }
    const seen = [...new Set(ctx.book.covenants.map((c) => c.frequency).filter((f): f is string => Boolean(f)))];
    const offered = seen.length ? seen : FREQUENCIES;
    return {
      slot: "frequency",
      text: `How often is the ${s.test} test measured?`,
      options: offered.map((f) => ({ label: f, say: `tested ${f.toLowerCase()}` })),
    };
  }

  if (!draft.scope.length) return scopeAskFor(draft, ctx);
  return null;
}

/**
 * A ROLE THE OBJECT HOLDS AND THIS ROOM WILL NOT WRITE, said plainly.
 *
 * The refusal names the word, names why it is not a borrowing-structure role,
 * and offers the five that are. Nothing the banker already gave is thrown away.
 */
function refusedRoleAsk(draft: Draft, ctx: ElicitContext): Ask {
  const refused = REFUSED_ROLES.find((r) => r.word === draft.refusedRole)!;
  const held = draft.slots.party ? ` I am holding ${draft.slots.party} and will carry the name onto whichever of those you name.` : "";
  const roles = involvementRoles(ctx);
  return {
    slot: "role",
    text:
      `${refused.word} is on the object, and it is ${refused.why} rather than borrowing structure, so I will not file it as an involvement here. ` +
      `The ${count(roles.length).toLowerCase()} roles a borrowing-structure change carries are ${sentenceList(roles)}.${held}`,
    options: roles.map((role) => ({ label: role, say: `as a ${role.toLowerCase()}` })),
  };
}

/**
 * THE ONE QUESTION A BORROWING-STRUCTURE ADD STILL NEEDS.
 *
 * The party by NAME, grounded in the book (who is already on this deal comes
 * first, because a guaranty restructure usually moves somebody who is already
 * here), then the role from the five legal ones, then the facility. Never a
 * sentence fragment as a value (D1, and E4b on this surface).
 */
function involvementAsk(draft: Draft, ctx: ElicitContext): Ask | null {
  const s = draft.slots;

  if (!s.party) {
    const household = bookPartyNames(ctx.book);
    return {
      slot: "party",
      text:
        "Who goes on the deal? An involvement row names one account, so I need the name before anything else. " +
        (household.length
          ? `This relationship already carries ${sentenceList(household.slice(0, 4))}${household.length > 4 ? " and others" : ""}, and somebody new is a legitimate add: name them either way.`
          : "This read carries no parties on the deal, so name them and I will take it from there."),
      options: household.slice(0, 5).map((name) => ({ label: name, say: `add ${name}` })),
    };
  }

  if (!s.role) {
    /* WHAT THE BOOK ALREADY HOLDS THIS NAME AS comes first: a party already on
       the deal in one role is almost always going onto another facility in the
       same one, and the book is the grounded answer rather than a guess. */
    const held = [...new Set(facilitiesFor(ctx.book, s.party).map((f) => f.role))];
    const roles = involvementRoles(ctx);
    const ordered = [...roles].sort((a, b) => Number(held.includes(b)) - Number(held.includes(a)));
    /* THE TWO THE OBJECT HOLDS AND THIS ROOM REFUSES ARE NAMED, not hidden. The
       catalog returns all seven for exactly that reason: a banker who says
       "grantor" should be answered by name rather than by a list that quietly
       does not contain it. */
    const refused = refusedRoleWords(ctx);
    return {
      slot: "role",
      text:
        `What role does ${s.party} take? The org holds involvement as rows and the role is the row, so I will not pick one. ` +
        (held.length
          ? `This book already carries ${s.party} as ${sentenceList(held)} elsewhere on the package.`
          : `The ${count(roles.length).toLowerCase()} a borrowing-structure change carries are ${sentenceList(roles)}.`) +
        (refused.length
          ? ` ${sentenceList(refused)} ${refused.length === 1 ? "is" : "are"} on the object too and ${refused.length === 1 ? "is" : "are"} not borrowing structure, so I do not file ${refused.length === 1 ? "it" : "them"} here.`
          : ""),
      options: ordered.map((role) => ({ label: role, say: `as a ${role.toLowerCase()}` })),
    };
  }

  if (!draft.scope.length) return scopeAskFor(draft, ctx);
  return null;
}

function collateralAsk(draft: Draft, ctx: ElicitContext): Ask | null {
  const s = draft.slots;

  /* "NONE OF THESE, A NEW ASSET" WAS PICKED (founder, 2026-09-03). One honest
     line and nothing staged: a net-new asset is filed at the relationship
     level first, through the intake route next door, and pledging it onto
     this facility rides a modification once it exists. This room does not
     compose a net-new asset from a chip pick the way a fully-typed line
     still can (`isNew`, below); see the surrounding comment on
     `newAssetElsewhere`. */
  if (s.newAssetElsewhere) {
    return {
      slot: "asset",
      text:
        "A new asset is filed on the relationship first, not here: open Relationship Actions, file it there, and pledging it onto this facility " +
        "then rides a modification once the org holds the record. Nothing is staged for it on this create.",
      options: [],
    };
  }

  if (!s.assetId && !s.isNew) {
    /* THE ACCOUNT'S COLLATERAL, NOT ALREADY PLEDGED TO THIS FACILITY (founder,
       2026-09-03: "is it not offering the collaterals from my account to
       pledge towards it?"). The same read the composer catalog's own
       `collateral.pledge` action offers (`components/composer/catalog.ts`,
       `pledgesOff`): every asset the book knows of, off whichever facility
       this create is scoped to. A facility this plan is itself staging (a net-
       new loan, "the new loan") carries no pledge yet on any asset, so every
       asset on the book clears the filter for it without a special case. Where
       the scope is not yet settled, every asset on the book is offered: there
       is no facility to narrow against. */
    const target = draft.scope[0];
    const assets = target ? ctx.book.assets.filter((a) => !a.loanIds.includes(target)) : ctx.book.assets;
    /* THE CHIP LABEL IS THE SHORT TITLE AND THE VALUE, never the collateral
       pane's long generated name (`domain/collateralAssets.ts`, the same
       shortener the pane uses) and never the org's autonumber. */
    const chipLabel = (a: BookAsset) =>
      typeof a.value === "number" ? `${shortLabel(a)} · ${exactMoney(a.value)}` : shortLabel(a);
    return {
      slot: "asset",
      text: assets.length
        ? `Which asset? ${count(assets.length)} on the account ${assets.length === 1 ? "is" : "are"} not already pledged to this facility, and a pledge sends the bank's own record rather than a name, so I will not choose between them.`
        : "This read carries no collateral on the account that is not already pledged to this facility, so there is nothing here to pledge by name. Say it is a new asset and what it is.",
      options: [
        ...assets.map((a) => ({ label: chipLabel(a), say: `pledge ${a.name ?? a.id}` })),
        { label: "None of these, a new asset", say: "none of these, a new asset" },
      ],
    };
  }

  if (s.isNew) {
    if (!s.assetKind) {
      /* THE WORD LANDED ON A FAMILY (E6). The org holds eleven Real Estate
         types and refuses the bare words at staging with all of them listed, so
         the room asks HERE, with the org's own names as the answers, instead of
         staging a type the catalog cannot resolve and relaying a refusal. */
      const family = draft.typeFamily;
      if (family) {
        return {
          slot: "assetKind",
          text:
            `"${family.word}" is ${family.values.length} collateral types on this org, not one, and the catalog resolves a type by its exact name. ` +
            "Which of them is it? Typing the name works as well as the chip.",
          options: family.values.map((v) => ({ label: v, say: v })),
        };
      }
      /* THE CATALOG IS NAMED IN THE QUESTION. A banker whose word the catalog
         does not carry needs to see what it does carry, not be asked the same
         question again. */
      const kinds = assetKinds(ctx);
      /* AND THE SECOND MISS IS NOT THE FIRST QUESTION AGAIN. What was heard,
         that the catalog does not carry it, and the two families closest to it.
         A line that settled something ELSE says so at once: the room acted on
         it, so claiming it read nothing is worse than asking again. */
      const missed = draft.missed;
      if (missed?.slot === "assetKind" && (missed.count >= MISS_ESCALATION || missed.settled)) {
        const closest = kinds.chips.slice(0, 2);
        return {
          slot: "assetKind",
          text:
            (missed.settled ? `That line settled the ${missed.settled}. ` : "") +
            `I cannot place "${missed.heard}" in the bank's collateral catalog and I will not invent a type for it. ` +
            (closest.length === 2
              ? `The closest families it carries are ${closest[0]} and ${closest[1]}. Pick one and I will name the types inside it, or type an exact name.`
              : "Pick a family below and I will name the types inside it, or type an exact name."),
          options: kinds.chips.map((k) => ({ label: k, say: `a new ${k.toLowerCase()} asset` })),
        };
      }
      return {
        slot: "assetKind",
        text:
          "What kind of asset is it? The bank keeps its own collateral-type catalog and resolves the word against it, so I will not invent a type. " +
          (kinds.total > kinds.chips.length
            ? `${
                kinds.fromOrg
                  ? `The catalog carries ${kinds.total} types the bank will lend against`
                  : `I resolve a name against ${kinds.total} types`
              }, in ${kinds.families} famil${kinds.families === 1 ? "y" : "ies"}${
                kinds.families > kinds.chips.length
                  ? `; these are the ${kinds.chips.length} this deal is closest to`
                  : "; say the family and I will name the types inside it"
              }. Typing an exact name reaches any of them.`
            : `The kinds I can resolve a word against are ${sentenceList(kinds.chips.map((k) => k.toLowerCase()))}.`),
        options: kinds.chips.map((k) => ({ label: k, say: `a new ${k.toLowerCase()} asset` })),
      };
    }
    if (!s.assetDescription) {
      return {
        slot: "assetDescription",
        text:
          "What is the asset, in your own words? The description is the only readable identity the collateral record carries, " +
          "so it is yours to write and I will not compose one for you.",
        options: [],
      };
    }
    if (s.assetValue === undefined) {
      /* THE SAME RULE, ONE SLOT ON. "first lien" settled the lien and the value
         question came back verbatim, so the room had acted on the line and
         still claimed not to have read it. */
      const missed = draft.missed;
      if (missed?.slot === "assetValue" && (missed.count >= MISS_ESCALATION || missed.settled)) {
        return {
          slot: "assetValue",
          text:
            (missed.settled ? `That line settled the ${missed.settled}. ` : "") +
            `What is still open is the value. "${missed.heard}" carries no amount I can read as money, so give me the figure on its own: $2,000,000 or 2 million.`,
          options: [],
        };
      }
      return {
        slot: "assetValue",
        text: "What is it worth? Say it in full, $2,000,000 or 2 million; I will not read a bare number as money.",
        options: [],
      };
    }
    /* THE RATE, ASKED FOR RATHER THAN REFUSED (P3). On an asset the bank has
       never lent against there is no rate for the org to fall back on: the
       pledge carries it as an override and the org's own validation rule wants
       a written reason beside it. The approved credit terms are the authority
       and the bank's guideline is the proposal. */
    if (s.advanceRate === undefined) {
      const band = bandFor(s.assetKind);
      return {
        slot: "advanceRate",
        text:
          `The credit terms carry an advance rate for this asset: which? On an asset the bank has never lent against there is nothing for the org to fall back on, ` +
          `so the rate rides the pledge as an override and travels with its own written reason. ` +
          (band
            ? `The bank's guideline for ${(s.assetKind ?? "").toLowerCase()} is ${band.basis}. The approved credit terms are the authority, not the guideline.`
            : "The approved credit terms are the authority on it, and I will not set one myself."),
        options: (band?.rates ?? []).map((rate) => ({ label: `${rate} percent`, say: `at a ${rate}% advance rate` })),
      };
    }
  }

  if (!s.lien) {
    const held = ctx.book.liens;
    const positions = lienPositions(ctx);
    const offered = held.length ? [...new Set([...held, ...positions])] : positions;
    return {
      slot: "lien",
      text:
        "What lien position does the bank take on it?" +
        (held.length === 1 ? ` Every pledge on this relationship sits at ${held[0]} today.` : ""),
      options: offered.map((l) => ({ label: `${l} position`, say: `${l} lien position` })),
    };
  }

  if (!draft.scope.length) return scopeAskFor(draft, ctx);
  return null;
}

function scopeAskFor(draft: Draft, ctx: ElicitContext): Ask {
  const ask = scopeAsk(ctx);
  if (!draft.scopeWord) return ask;
  /* THE SCOPE WORD IS THERE AND THE SET IS NOT SETTLED. The room says the word
     back rather than dropping it, which is the whole of D2. */
  return {
    ...ask,
    text: `${count(ctx.members.length)} facilities on this package, and more than one reading of that. Which of them should this land on?`,
  };
}

/**
 * THE FAMILIES THE BANK'S OWN CATALOG SETTLES FROM A SENTENCE.
 *
 * A HINT, NEVER AN AUTHORITY. The catalog resolution lives in the fenced
 * parser and this is a shell-side reading of which of the book's own tests are
 * worth OFFERING: a chip that leads to "the catalog did not settle on that" is
 * a wasted gesture. Getting the hint wrong costs a gesture and never costs
 * correctness, because every composed sentence is verified afterwards anyway.
 * `elicit.test.ts` drives every offered mirror through the real engine, so a
 * change in the catalog map breaks a test rather than a demo.
 */
const CATALOG_FAMILIES =
  /leverage|liquidity|debt service coverage|debt.to.worth|current ratio|net worth|ebitda|debt.to.equity|net profit/i;

/** What the relationship already tests, as chips that carry their own terms. */
export function mirrorChips(book: Book): Array<{ what: string; label: string; say: string }> {
  const out: Array<{ what: string; label: string; say: string }> = [];
  const seen = new Set<string>();
  for (const c of book.covenants) {
    if (seen.has(c.type) || typeof c.threshold !== "number" || !c.frequency) continue;
    if (!CATALOG_FAMILIES.test(c.type)) continue;
    seen.add(c.type);
    const threshold = thresholdText(c.threshold);
    out.push({
      what: `${c.type} ${c.frequency.toLowerCase()}`,
      label: `${c.type} at ${threshold}`,
      say: `a ${c.type} covenant of ${threshold} tested ${c.frequency.toLowerCase()}`,
    });
    if (out.length === 4) break;
  }
  return out;
}

/**
 * THE THRESHOLD, IN THE UNIT IT WAS ACTUALLY GIVEN IN.
 *
 * An absent unit prints the bare figure. That is not a gap: the org stores no
 * unit beside a covenant threshold, so a book-derived 80 on a receivables test
 * prints as 80, and printing it as "80x" or "$80" would be this room asserting
 * something nobody wrote down.
 */
export function thresholdText(value: number, unit?: "ratio" | "money"): string {
  if (unit === "ratio") return `${value}x`;
  if (unit === "money") return `$${value.toLocaleString("en-US")}`;
  // Separators are formatting, not a claim: 5000000 and 5,000,000 are the same
  // figure, and only one of them can be read at a glance.
  return value.toLocaleString("en-US");
}

/** THE SHORT TITLE, everywhere this room speaks or cards a pledged asset
 *  (founder finding, 2026-09-03): the org's own type name and a compact
 *  descriptor, never `a.label` whole (which is the full legal description
 *  wherever the org wrote one), and never the org's autonumber. Capped at 60
 *  characters as the last defence against a description with no sentence
 *  break in it at all. */
const shortLabel = (a: BookAsset) => clipTitle(shortAssetTitle(a.kind, a.label), 60);

/** A figure written the way a credit agreement writes it. Never abbreviated:
 *  "$6.5M" and "$6,500,000" are the same money and only one of them is what the
 *  org files. */
const exactMoney = (value: number) => `$${value.toLocaleString("en-US")}`;

/**
 * THE SHORT TITLE FOR A PLEDGE WIRE, wherever the collateral it names is
 * known (founder finding, 2026-09-03). `restateEntry` below applies this on
 * the guided lane; `dispatch.ts`'s `shortenPledgeTitles` applies the same
 * correction on a line typed straight through the parser, which is where the
 * founder actually saw the org's full description on the card: a composed
 * sentence resolved cleanly on the first try and never reached `restateEntry`
 * at all. Null where the wire names no collateral this room can identify, so
 * the caller keeps whatever title it already had.
 */
export function pledgeAssetTitle(wire: WorkroomDelta["pledgeWire"], book: Book): string | null {
  if (!wire) return null;
  if (wire.collateralId) {
    const asset = book.assets.find((a) => a.id === wire.collateralId);
    return asset ? shortLabel(asset) : null;
  }
  if (wire.newCollateral) {
    return clipTitle(shortAssetTitle(wire.newCollateral.collateralType, wire.newCollateral.description), 60);
  }
  return null;
}

function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ============================================== what the room already knows

   THE BOOK AND THE PLAN, READ BACK BEFORE ANYTHING IS PUT UP. A create that
   duplicates what the relationship already carries is NAMED, and a create
   already on this session's plan is not proposed a second time.             */

export interface Awareness {
  /** What the book already carries that makes this create a duplicate. */
  onTheBook: string | null;
  /** What this session already put up that makes it a duplicate. */
  onThePlan: string | null;
  /** The members this create can still land on. */
  fresh: string[];
  /** The chips the room offers instead of staging a duplicate blindly. */
  options: Array<{ label: string; say: string }>;
  /**
   * THE ROOM'S CLOSING SENTENCE over those chips. Null takes the default, which
   * is the DUPLICATE's sentence: nothing here needs putting up twice. A test on
   * the book that is NOT on this loan is not a duplicate and must not be told it
   * is one (P1), so that state carries its own close.
   */
  close: string | null;
  /**
   * WHICH FACILITIES `onTheBook` IS ABOUT, where the caller needs the set and
   * not only the sentence (founder finding, 2026-09-03, on a pledge fanned
   * out over several facilities). A facility this create skips because the
   * book already carries it is a SETTLED ROW, not a fact folded into one
   * prose sentence naming several facilities at once. Set on the collateral
   * surface only; every other surface still reads through `onTheBook`.
   */
  alreadyOn?: string[];
}

/**
 * THE ENTRY ON THE PLAN THIS LINE IS ACTUALLY ABOUT.
 *
 * "A line that touches something already staged ACTS ON THAT ENTRY - it amends
 * it - rather than putting a second, parallel entry beside it." Two entries
 * moving the same test on the same facility is a contradiction the banker has
 * to reconcile by hand, which is the work this room exists to remove.
 *
 * NARROW ON PURPOSE. It fires only where the line lands on ONE member, that
 * member already carries a STAGED entry for the same test or the same asset,
 * and something the banker owns has actually changed. An identical line is not
 * an amendment and is answered by the awareness ("already on this plan"); an
 * explicit "a second one" is not an amendment either, and is taken at its word.
 */
export interface PlanAmendment {
  entry: PlanEntry;
  changed: string[];
}

/** Two net-new pledges are the same pledge where the banker's own words for the
 *  asset are the same words. Case and inner spacing are not a difference. */
const sameAssetWords = (a: string | undefined, b: string | undefined): boolean => {
  const norm = (t: string | undefined) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(norm(a)) && norm(a) === norm(b);
};

export function planAmendmentFor(draft: Draft, ctx: ElicitContext): PlanAmendment | null {
  if (draft.slots.second || draft.scope.length !== 1) return null;
  const memberId = draft.scope[0];
  const s = draft.slots;
  const sameSubject = (p: PlanEntry): boolean => {
    if (draft.surface === "covenant") return Boolean(s.test) && p.slots.test === s.test;
    if (draft.surface === "involvement") {
      return Boolean(s.party) && Boolean(p.slots.party) && samePartyName(p.slots.party!, s.party!);
    }
    /* A NET-NEW ASSET HAS NO RECORD ID YET, so `assetId` names nothing and the
       plan-awareness rule fell straight through it: the founder staged the
       Kokomo create twice and the manifest ended with it twice. What identifies
       a net-new pledge is the DESCRIPTION, which is the banker's own words and
       the only readable identity the collateral record carries. */
    if (s.isNew || p.slots.isNew) return sameAssetWords(s.assetDescription, p.slots.assetDescription);
    return Boolean(s.assetId) && p.slots.assetId === s.assetId;
  };
  const entry = ctx.plan.find((p) => !p.open && p.surface === draft.surface && p.memberId === memberId && sameSubject(p));
  if (!entry) return null;

  const changed: string[] = [];
  if (draft.surface === "covenant") {
    if (s.threshold !== undefined && s.threshold !== entry.slots.threshold) {
      changed.push(`the threshold is now ${thresholdText(s.threshold, s.unit)}`);
    }
    if (s.frequency && s.frequency !== entry.slots.frequency) changed.push(`it is tested ${s.frequency.toLowerCase()}`);
  } else if (draft.surface === "involvement") {
    if (s.role && s.role !== entry.slots.role) changed.push(`the role is now ${s.role}`);
  } else {
    if (s.lien && s.lien !== entry.slots.lien) changed.push(`the lien position is now ${s.lien}`);
    if (s.assetKind && s.assetKind !== entry.slots.assetKind) changed.push(`the collateral type is now ${s.assetKind}`);
    if (s.assetValue !== undefined && s.assetValue !== entry.slots.assetValue) {
      changed.push(`it is worth ${exactMoney(s.assetValue)}`);
    }
    if (s.advanceRate !== undefined && s.advanceRate !== entry.slots.advanceRate) {
      changed.push(`the advance rate is now ${s.advanceRate} percent`);
    }
  }
  return changed.length ? { entry, changed } : null;
}

/** What a correction lands as on an entry that is already staged. */
export function amendedPlanLine(changed: string[]): string {
  return `That is already on the plan here, so I have moved the entry rather than putting a second one beside it: ${sentenceList(changed)}.`;
}

export function awarenessFor(draft: Draft, ctx: ElicitContext): Awareness {
  const label = (id: string) => ctx.members.find((m) => m.id === id)?.label ?? id;
  const none: Awareness = { onTheBook: null, onThePlan: null, fresh: draft.scope, options: [], close: null };

  /* ================================= THE DEDUPE IS PER LOAN JUNCTION (P1)

     "DSC of Borrower already runs at the relationship level, so it already
     reaches every facility, nothing needs putting up twice" is WRONG, and the
     founder said so in the words the model uses: a covenant is relationship-
     level or loan-level depending on WHICH JUNCTION it carries, and a covenant
     with an Account_Covenant association and no Loan_Covenant junction is NOT
     associated to the loan (WORKROOM-BRAIN 2.4). The package VIEW is a union;
     the association is not.

     SO THERE ARE THREE STATES AND THEY ARE DIFFERENT ANSWERS:

       on THIS loan          - the true duplicate. Named as one, nothing staged;
       on the book, NOT here - not a duplicate at all. The room says exactly
                               that and offers three ways through: a new one on
                               this facility, ASSOCIATING the existing record to
                               it, or a different test;
       not on the book       - nothing to say. It stages.

     An ASSOCIATE is a junction create for an existing Covenant2, never a
     delete, so it is inside the fence. What it is not is fileable by the
     deployed wire, which carries a type name and no covenant id: that is
     `covenantAttachesJson`, the junction-only arm, so on a modification the
     third chip stages a real card. On the other two routes it is a handoff and
     {@link associateGap} says which route carries it. */
  if (draft.surface === "covenant" && draft.slots.test) {
    const already = ctx.book.covenants.filter((c) => c.type === draft.slots.test);
    const staged = ctx.plan.filter(
      (p) => p.surface === "covenant" && p.slots.test === draft.slots.test && p.memberId && draft.scope.includes(p.memberId),
    );
    const onPlan = staged.map((p) => p.memberId!).filter((id, i, all) => all.indexOf(id) === i);

    /* THE JUNCTION, AND NOTHING ELSE. `loanIds` is exactly the covenant's
       LLC_BI__Loan_Covenant__c set, so this asks the one question that decides
       it: is this test on THIS facility? */
    const onBook = draft.slots.second || draft.slots.associate ? [] : draft.scope.filter((id) => already.some((c) => c.loanIds.includes(id)));
    const blocked = new Set([...onBook, ...onPlan]);
    const fresh = draft.scope.filter((id) => !blocked.has(id));

    if (onBook.length || onPlan.length) {
      return {
        onTheBook: onBook.length
          ? `${draft.slots.test} is already on ${sentenceList(onBook.map(label))}, and a modification carries it onto the clone.`
          : null,
        onThePlan: onPlan.length ? `${draft.slots.test} is already on this plan for ${sentenceList(onPlan.map(label))}.` : null,
        fresh,
        options: [
          { label: "Put a second one on the facility", say: `add a second ${draft.slots.test} covenant` },
          { label: "A different test", say: "a different test" },
        ],
        close: null,
      };
    }

    /* ON THE BOOK, NOT ON THIS LOAN. The elsewhere covenant is worth naming
       because it is what an ASSOCIATE would attach, and because a banker who
       wrote this test is usually looking at the one the relationship already
       runs. It is NOT a reason to refuse and it does not narrow the scope. */
    const elsewhere = draft.slots.second || draft.slots.associate ? null : already[0] ?? null;
    if (elsewhere && draft.scope.length) {
      const one = draft.scope.length === 1;
      const here = one ? "this facility" : "these facilities";
      const terms = [
        elsewhere.threshold !== null ? `at ${thresholdText(elsewhere.threshold)}` : null,
        elsewhere.frequency ? `tested ${elsewhere.frequency.toLowerCase()}` : null,
      ].filter((t): t is string => Boolean(t));
      const where = elsewhere.loanIds.length
        ? `attached to ${sentenceList(elsewhere.loanIds.map(label))}`
        : "at the relationship level, with no loan junction on it at all";
      return {
        onTheBook:
          `${draft.slots.test} is on this book${terms.length ? ` ${sentenceList(terms)}` : ""}, ${where}, ` +
          `and it is NOT associated to ${sentenceList(draft.scope.map(label))}. A covenant reaches a facility through its loan junction, ` +
          `so a test that carries no junction here does not run on ${one ? "this facility" : "these"}, whatever it does elsewhere. ` +
          `Two ways to put it on ${here}, and they are different records.`,
        onThePlan: null,
        fresh: [],
        options: [
          { label: `Create a new one on ${here}`, say: `add a second ${draft.slots.test} covenant` },
          {
            label: `Associate the existing ${draft.slots.test} to ${here}`,
            say: `associate the existing ${draft.slots.test} covenant to ${here}`,
          },
          { label: "A different test", say: "a different test" },
        ],
        close: "Say which and I will put it up.",
      };
    }

    return { onTheBook: null, onThePlan: null, fresh, options: [], close: null };
  }

  /* ============================ THE BORROWING-STRUCTURE DUPLICATE (E4a)

     "add Hartwell Industrial Holdings as guarantor on the construction loan"
     when Holdings IS already Guarantor there. The room staged a second row and
     said "not on the facility today", which is false twice over: the org holds
     involvement as ROWS, so the second row is a duplicate rather than a
     correction, and the book already answered the question.

     THE ROLE IS COMPARED PER FACILITY, because that is how the org holds it.
     Same name, same role, same facility is a duplicate and is named. Same name,
     DIFFERENT role on that facility is a role change and is named as one: an
     add would put a second, contradicting row beside the first.             */
  if (draft.surface === "involvement" && draft.slots.party && draft.slots.role) {
    const party = draft.slots.party;
    const role = draft.slots.role;
    const sameRole: string[] = [];
    const otherRole: Array<{ id: string; roles: string[] }> = [];
    for (const id of draft.scope) {
      const roles = rolesOnFacility(ctx.book, party, id);
      if (!roles.length) continue;
      if (roles.some((r) => r.toLowerCase() === role.toLowerCase())) sameRole.push(id);
      else otherRole.push({ id, roles });
    }
    const staged = ctx.plan.filter(
      (p) =>
        p.surface === "involvement" &&
        p.slots.party &&
        samePartyName(p.slots.party, party) &&
        p.slots.role === role &&
        p.memberId &&
        draft.scope.includes(p.memberId),
    );
    const onPlan = staged.map((p) => p.memberId!).filter((id, i, all) => all.indexOf(id) === i);
    const blocked = new Set([...sameRole, ...otherRole.map((o) => o.id), ...onPlan]);

    const duplicate = sameRole.length
      ? `${party} is already ${role} on ${sentenceList(sameRole.map(label))}, and a modification carries the row onto the clone. The org holds involvement as rows, so adding the same name again stages a SECOND row rather than correcting the first.`
      : null;
    const roleChange = otherRole.length
      ? `${party} is already ${sentenceList([...new Set(otherRole.flatMap((o) => o.roles))])} on ${sentenceList(otherRole.map((o) => label(o.id)))}. Putting them on as ${role} is a ROLE CHANGE rather than an addition, and no tool here files a role change: the way it is done is to take the row off the clone as a carry exclusion and put the new one on beside it. Confirm that is what you mean and I will take them off first.`
      : null;

    return {
      onTheBook: [duplicate, roleChange].filter(Boolean).join(" ") || null,
      onThePlan: onPlan.length ? `That involvement is already on this plan for ${sentenceList(onPlan.map(label))}.` : null,
      fresh: draft.scope.filter((id) => !blocked.has(id)),
      options: blocked.size
        ? [
            ...(sameRole.length || otherRole.length
              ? [
                  {
                    label: `Take ${party} off that facility`,
                    say: `remove ${party} from the ${label([...sameRole, ...otherRole.map((o) => o.id)][0])}`,
                  },
                ]
              : []),
            { label: "A different facility", say: "a different facility" },
          ]
        : [],
      close: null,
    };
  }

  /* ================= THE NET-NEW PLEDGE ALREADY ON THIS PLAN (2026-09-02)

     The awareness below keys on `assetId`, which a net-new asset does not have
     yet, so staging the same create twice put a second, identical entry beside
     the first. The banker's own description is what identifies it, exactly as
     it does for {@link planAmendmentFor}. */
  if (draft.surface === "collateral" && draft.slots.isNew && draft.slots.assetDescription) {
    const staged = ctx.plan.filter(
      (p) =>
        p.surface === "collateral" &&
        sameAssetWords(p.slots.assetDescription, draft.slots.assetDescription) &&
        p.memberId &&
        draft.scope.includes(p.memberId),
    );
    const onPlan = staged.map((p) => p.memberId!).filter((id, i, all) => all.indexOf(id) === i);
    if (!onPlan.length) return none;
    return {
      onTheBook: null,
      onThePlan: `${draft.slots.assetDescription} is already on this plan for ${sentenceList(onPlan.map(label))}, created and pledged there.`,
      fresh: draft.scope.filter((id) => !onPlan.includes(id)),
      options: [
        { label: "A different facility", say: "a different facility" },
        { label: "Take it off the plan", say: `remove the ${draft.slots.assetDescription} pledge from the ${label(onPlan[0])}` },
      ],
      close: "Say it again with a different figure and I will move that entry rather than putting a second one beside it.",
    };
  }

  if (draft.surface === "collateral" && draft.slots.assetId) {
    const asset = ctx.book.assets.find((a) => a.id === draft.slots.assetId);
    const onBook = draft.slots.second ? [] : draft.scope.filter((id) => asset?.loanIds.includes(id));
    const staged = ctx.plan.filter(
      (p) => p.surface === "collateral" && p.slots.assetId === draft.slots.assetId && p.memberId && draft.scope.includes(p.memberId),
    );
    const onPlan = staged.map((p) => p.memberId!).filter((id, i, all) => all.indexOf(id) === i);
    const blocked = new Set([...onBook, ...onPlan]);
    return {
      onTheBook: onBook.length
        ? `${shortLabel(asset!)} is already pledged to ${sentenceList(onBook.map(label))}, and a modification carries the pledge onto the clone.`
        : null,
      onThePlan: onPlan.length ? `That pledge is already on this plan for ${sentenceList(onPlan.map(label))}.` : null,
      fresh: draft.scope.filter((id) => !blocked.has(id)),
      options:
        onBook.length || onPlan.length
          ? [
              { label: "Add a second", say: `add a second pledge of ${draft.slots.assetName ?? draft.slots.assetId}` },
              { label: "A different facility", say: "a different facility" },
            ]
          : [],
      close: null,
      alreadyOn: onBook,
    };
  }

  return none;
}

/**
 * ONE SETTLED ROW for a facility a pledge fan-out skips because the book
 * already carries it (founder finding, 2026-09-03: "the room staged cards for
 * Construction and Purchase, correctly skipped the two lines already holding
 * it", correctly SKIPPED, but as one prose sentence naming both facilities
 * together, which reads as an afterthought beside four real cards. This is
 * the structured row instead: nothing is staged and nothing is new, and the
 * reason is on the card rather than folded into the reply above it.
 */
export function pledgeAlreadySettled(
  asset: BookAsset,
  args: { facilityId: string; facilityLabel: string },
): WorkroomRefusal & { why: string } {
  const title = shortLabel(asset);
  return {
    id: `collateral.pledge:${args.facilityId}:${asset.id}:settled`,
    target: args.facilityLabel,
    title,
    why: `${title} is already pledged to the ${args.facilityLabel}, and a modification carries the pledge onto the clone. Nothing new is filed for it.`,
    reason: "A second pledge of the same asset on the same facility is a duplicate, and the org refuses one by name.",
    detail: "",
  };
}

/* ================================================================= composing

   THE SENTENCE THE PARSER ALREADY KNOWS. Nothing here is a new write path: the
   composed line goes through `parseIntent` exactly as a typed one does, and the
   delta that comes back is verified against what was elicited before it is
   allowed to become a chip.

   THE MEMBER IS NAMED BY THE ORG'S OWN LOAN NAME. A product word lands on every
   facility of that product - proven twice in the drive and again here - so the
   composed sentence uses the name the org gives the loan, which resolves one
   member inside the parser rather than relying on a filter afterwards.

   THE FACILITY COMES FIRST AND THE FIGURE COMES LAST. The covenant reader takes
   the LAST money token in the line as the threshold, so a sentence ending in the
   facility's own commitment would file the facility's size as the covenant. */

export interface ComposedLine {
  memberId: string;
  say: string;
}

export interface Composition {
  lines: ComposedLine[];
  /** What a complete create still cannot file, named rather than dropped. */
  gaps: string[];
  /** The room's own sentence over the chips. */
  lede: string;
}

export function compose(draft: Draft, ctx: ElicitContext): Composition {
  const member = (id: string) => ctx.members.find((m) => m.id === id)!;
  const target = (id: string) => member(id).orgName ?? member(id).label;
  const lines: ComposedLine[] = [];
  const gaps: string[] = [];
  const s = draft.slots;

  if (draft.surface === "covenant") {
    const threshold = thresholdText(s.threshold!, s.unit);
    for (const id of draft.scope) {
      lines.push({ memberId: id, say: `on the ${target(id)} add a ${s.test!.toLowerCase()} covenant of ${threshold}` });
    }
    if (s.frequency && s.frequency !== WIRED_FREQUENCY) {
      gaps.push(
        `A ${s.frequency.toLowerCase()} schedule. The modification files a new covenant on the ${WIRED_FREQUENCY.toLowerCase()} schedule and carries no other, so the ${s.frequency.toLowerCase()} test is recorded on the plan for the credit file and is not written to the bank's systems.`,
      );
    }
    return {
      lines,
      gaps,
      lede: s.associate
        ? `The ${s.test} the book already carries, at ${threshold} tested ${(s.frequency ?? WIRED_FREQUENCY).toLowerCase()}, put onto ${sentenceList(draft.scope.map((id) => member(id).label))}. The covenant record is not touched: what this authors is the junction to the facility, so its threshold, its schedule and its effective date stay exactly as they are.`
        : `${s.test} of ${threshold}, tested ${(s.frequency ?? WIRED_FREQUENCY).toLowerCase()}${s.frequencyFrom === "book" ? " as this relationship already tests it" : ""}, on ${sentenceList(draft.scope.map((id) => member(id).label))}. The effective date is set once when it is created and never updated afterwards.`,
    };
  }

  if (draft.surface === "involvement") {
    /* THE FACILITY COMES FIRST AND THE ROLE COMES LAST, and both halves of that
       are load-bearing. The parser reads the value as the tail after the phrase
       it matched, so a sentence ending on the role leaves NO tail at all - which
       is what keeps a sentence fragment off the chip (E4b). And the facility is
       named by the org's own short label rather than by the loan's full name,
       because the full name begins with the BORROWER's name and the party
       reader would resolve the borrower instead of the party. */
    for (const id of draft.scope) {
      const named = member(id).shortName ?? member(id).label;
      lines.push({ memberId: id, say: `on the ${named} add ${s.party} as a ${s.role!.toLowerCase()}` });
    }
    return {
      lines,
      gaps,
      lede:
        `${s.party} as ${s.role} on ${sentenceList(draft.scope.map((id) => member(id).label))}. ` +
        "The row is authored on the clone; the booked facility keeps exactly the structure it has today.",
    };
  }

  /* ============================================ CREATE THEN PLEDGE (P3)

     THE BANKER'S OWN WORDS ARE NOT IN THE COMPOSED SENTENCE, and that is
     deliberate. The engine reads a description out of the line it is given by
     stripping the figure, the rate and the pledge clause out of it, which
     mangles any noun sitting between them - and the words a collateral record
     is filed under are the one thing here that must not be mangled. So the
     sentence carries the KIND, the VALUE, the RATE and the TARGET, which are
     exactly what the wire needs, and {@link restateEntry} puts the banker's own
     description back onto the entry afterwards.

     "ADDITIONAL" IS IN THE SENTENCE ON PURPOSE. The engine asks its own
     amend-or-add question when a create's words brush against something already
     on the facility, and a net-new asset named after a plant the deal already
     mortgages would trip it. The word says what this is: a new record beside
     what is there, which is what the banker asked for. */
  if (s.isNew) {
    const kind = (s.assetKind ?? "").toLowerCase();
    for (const id of draft.scope) {
      lines.push({
        memberId: id,
        say: `pledge an additional new ${kind} asset worth ${exactMoney(s.assetValue!)} at a ${s.advanceRate}% advance rate to the ${target(id)}`,
      });
    }
    if (s.lien) {
      gaps.push(
        `The ${s.lien} lien position. No deployed write carries a lien position onto a pledge, so it is recorded on the plan for the credit file rather than written to the bank's systems.`,
      );
    }
    return {
      lines,
      gaps,
      lede:
        `${s.assetDescription}, ${kind} at ${exactMoney(s.assetValue!)}, pledged to ${sentenceList(draft.scope.map((id) => member(id).label))} at a ${s.advanceRate} percent advance rate. ` +
        "The asset is created, the borrower's ownership is recorded and only then is it pledged: three connected writes, in that order, and the lendable value is the org's to derive from the rate.",
    };
  }

  for (const id of draft.scope) {
    const lead = s.second ? "add a second pledge of" : "pledge";
    lines.push({ memberId: id, say: `${lead} ${s.assetName ?? s.assetId} to the ${target(id)}` });
  }
  if (s.lien) {
    gaps.push(
      `The ${s.lien} lien position. No deployed write carries a lien position onto a pledge, so it is recorded on the plan for the credit file rather than written to the bank's systems.`,
    );
  }
  const asset = ctx.book.assets.find((a) => a.id === s.assetId);
  const lien = s.lien
    ? ` at ${s.lien} position${asset?.lien === s.lien ? ", as the deal already holds it" : ""}`
    : "";
  return {
    lines,
    gaps,
    lede:
      `Pledging ${shortLabel(asset ?? ({ label: s.assetLabel ?? "the asset" } as BookAsset))}` +
      `${lien} to ${sentenceList(draft.scope.map((id) => member(id).label))}. ` +
      "What the bank will lend against it is worked out when the change is filed, so there is no advance rate for you to set here.",
  };
}

/* ============================================== what THIS ROUTE can file

   ONE ROOM, THREE ROUTES, THREE DIFFERENT TOOLS UNDER IT.

   The grammar is the shell's and it is the same on every route. The WIRE is
   the route's, and it is not: a renewal files a new maturity and a repricing,
   a new facility files four scalars against the package anchor, and neither of
   them carries a covenant or a pledge.

   WHAT THIS TABLE IS NOT ABOUT, SINCE 2026-09-03. It says nothing about a NEW
   FACILITY on the version being approved. That is not a covenant or a pledge
   arriving on the wrong route: a modification versions the whole PACKAGE, so a
   new loan on the new version is ordinary practice, `newFacilitiesJson` carries
   it and `newFacilityArm.ts` stages the card. This table is still exactly right
   about the three surfaces it names, and it has never governed that one.

   A room that gathered a complete covenant
   on the renewal route and then said nothing about it would be dropping the
   whole thing silently (rule 8); a room that staged it as though it were going
   to be written would be worse.

   SO IT IS NAMED, BY THE ROUTE'S NAME, AFTER GATHERING, AND IT GOES ON THE
   PLAN. The entry is not fileable and says so: no wire, a handoff reason the
   staged plan carries into the submitted summary, and a refusal-toned chip.
   Nothing new is written anywhere, which is exactly the point.               */

/** What the route's own tool files, where it is not the modification. Null is
 *  the modification: it files covenants and pledges and needs no caveat. */
const ROUTE_FILES: Record<WorkroomMode, string | null> = {
  modify: null,
  renew:
    "The renewal files a new maturity and a repricing onto the clone, and plans a net-new facility on the new version without filing one, " +
    "because execution of a renewal is held.",
  create: "The new facility files the product, the amount, the term and the purpose against the package anchor, and nothing else.",
  /* AN AMENDMENT FILES THE SAME ARMS AS A MODIFICATION, on the version's own
     loans instead of on a clone, so it needs no caveat either. */
  amend: null,
};

/** Why this route cannot file this create, in the route's own words, or null
 *  where it can. */
const SURFACE_NOUN: Record<SurfaceId, string> = {
  covenant: "A covenant",
  collateral: "A pledge",
  involvement: "A borrowing-structure change",
};

/**
 * ASSOCIATING AN EXISTING COVENANT, AND WHICH ROUTE CARRIES IT (P1).
 *
 * The MODEL was always right and inside the fence: a loan junction for a
 * Covenant2 that already exists is a create, not a delete, and it is exactly
 * what "put the test the book already runs onto this loan" means in nCino.
 *
 * The WIRE was the problem, and it is not any more. `covenantAddsJson` carries a
 * covenant TYPE and names no covenant RECORD, so sending an associate down it
 * would mint a second covenant of the same type and call it an association;
 * `covenantAttachesJson` deployed on 2026-09-02 as the junction-only arm, and on
 * a MODIFICATION the room stages a real card carrying it.
 *
 * It rides the modification and nothing else, so this sentence is what is left:
 * a renewal files a new maturity and a repricing, a new facility files the
 * product, the amount, the term and the purpose, and neither of them authors a
 * junction. There the associate still goes on the plan for the credit file.
 */
export function associateGap(draft: Draft, mode: WorkroomMode): string | null {
  if (draft.surface !== "covenant" || !draft.slots.associate) return null;
  if (mode === "modify") return null;
  return (
    "Associating the covenant the book already carries is a loan-covenant junction create for an existing record, which is a create rather than a delete and is inside the fence. " +
    `The arm that files one rides the modification alone. ${ROUTE_FILES[mode] ?? ""} A junction is not one of them. ` +
    "Run it as a modification and I will stage it. Here it rides the plan for the credit file, with the record it would attach named on it, and nothing about it is written to the bank's systems."
  );
}

export function routeGap(surface: SurfaceId, mode: WorkroomMode): string | null {
  const files = ROUTE_FILES[mode];
  if (!files) return null;
  return (
    `${files} ${SURFACE_NOUN[surface]} is not one of them, so this rides the plan for the credit file ` +
    "and nothing about it is written to the bank's systems."
  );
}

/**
 * THE ENTRY A ROUTE THAT CANNOT FILE STILL PUTS ON THE PLAN.
 *
 * Everything the banker settled, recorded, with the reason nothing writes it
 * attached to the entry rather than to a sentence that scrolls away. It carries
 * no wire and `fileable` is false, so both engines already read it as a handoff
 * and both staged plans already carry it into the summary as one.
 */
export function handoffEntry(
  draft: Draft,
  ctx: ElicitContext,
  memberId: string,
  reason: string,
  seq: number,
): WorkroomDelta {
  const member = ctx.members.find((m) => m.id === memberId)!;
  const s = draft.slots;
  const covenant = draft.surface === "covenant";
  const involvement = draft.surface === "involvement";
  const asset = ctx.book.assets.find((a) => a.id === s.assetId);
  const after = covenant
    ? `${s.test}${s.threshold !== undefined ? ` at ${thresholdText(s.threshold, s.unit)}` : ""}, tested ${(s.frequency ?? WIRED_FREQUENCY).toLowerCase()}`
    : involvement
      ? `${s.party} as ${s.role}`
      : `${shortLabel(asset ?? ({ label: s.assetLabel ?? "the asset" } as BookAsset))}${s.lien ? ` at ${s.lien} position` : ""}`;
  /* AN ASSOCIATE IS NOT A NEW COVENANT, and the card must not call it one: the
     record exists, and what this would author is the junction to it. */
  const associate = covenant && Boolean(s.associate);
  const noun = associate ? "Associate a covenant" : covenant ? "New covenant" : involvement ? "New involvement" : "New pledge";
  const object = associate
    ? "LLC_BI__Loan_Covenant__c"
    : covenant
      ? "LLC_BI__Covenant2__c"
      : involvement
        ? "LLC_BI__Legal_Entities__c"
        : "LLC_BI__Loan_Collateral2__c";
  const fieldId = covenant ? "covenant.add" : involvement ? "party.add" : "collateral.pledge";
  return {
    id: `${fieldId}:${memberId}:handoff:${seq}`,
    group: covenant ? "covenants" : involvement ? "structure" : "security",
    op: "add",
    kind: noun,
    kindTone: "refusal",
    badge: `${noun} handed off`,
    title: involvement ? (s.party ?? noun) : noun,
    target: member.label,
    before: associate ? "on the book, with no junction to this facility" : "not on the facility today",
    after,
    member: memberId,
    map: [
      ["Object", object],
      ["Field", "not established on this route"],
      ["Written as", "Nothing. This route's own tool does not carry it, so it travels as a handoff on the staged plan."],
    ],
    fields: [object],
    caveat: reason,
    filed: { recordId: "not filed", verification: "Handed off. Nothing was written." },
    fileable: false,
    handoff: { reason },
  };
}

/* ================================================================ verifying

   A CREATE WHOSE VALUE DID NOT RESOLVE MUST NEVER REACH A CHIP (D1).

   The parser is generous where a catalog match fails: the leftover words of the
   line become a text value and a handoff chip goes up reading `New covenant /
   not on the facility today / to all of the loans`. That chip is the defect.
   So every delta a composed sentence produces is checked against what was
   elicited - the right member, the right kind of wire, the right catalog type,
   the right figure - and anything that does not match is refused BY NAME.  */

export type Verdict = { ok: true; delta: WorkroomDelta } | { ok: false; why: string };

export function verify(draft: Draft, memberId: string, deltas: WorkroomDelta[]): Verdict {
  const mine = deltas.filter(
    (d) => (d.member ?? d.covenantWire?.facilityId ?? d.pledgeWire?.facilityId ?? d.involvementWire?.facilityId) === memberId,
  );
  const others = deltas.filter((d) => !mine.includes(d));

  if (draft.surface === "involvement") {
    const wired = mine.filter((d) => d.involvementWire?.op === "add");
    if (wired.length !== 1) {
      return { ok: false, why: "the borrowing-structure change did not resolve to one party on one facility" };
    }
    const wire = wired[0].involvementWire!;
    if (!samePartyName(wire.accountName, draft.slots.party ?? "")) {
      return { ok: false, why: `the sentence resolved ${wire.accountName} rather than ${draft.slots.party}, and filing one party as another is not something I will do` };
    }
    if (wire.role !== draft.slots.role) {
      return { ok: false, why: `the role came back as ${wire.role ?? "nothing"} rather than ${draft.slots.role}, so the role did not survive the reading` };
    }
    if (others.length) return { ok: false, why: "that sentence reached more facilities than the one it named" };
    return { ok: true, delta: wired[0] };
  }

  if (draft.surface === "covenant") {
    const wired = mine.filter((d) => d.covenantWire);
    if (wired.length !== 1) {
      return {
        ok: false,
        why: `the bank's covenant catalog did not settle on "${draft.slots.test}" from that sentence, and I will not file a test the catalog did not name`,
      };
    }
    const wire = wired[0].covenantWire!;
    if (wire.typeName !== draft.slots.test) {
      return {
        ok: false,
        why: `the catalog read that as ${wire.typeName} rather than ${draft.slots.test}, and filing one test as another is not something I will do`,
      };
    }
    if (Math.abs(wire.threshold - (draft.slots.threshold ?? NaN)) > 1e-9) {
      return {
        ok: false,
        why: `the threshold came back as ${wire.threshold} rather than ${draft.slots.threshold}, so the figure did not survive the reading`,
      };
    }
    if (others.length) return { ok: false, why: "that sentence reached more facilities than the one it named" };
    return { ok: true, delta: wired[0] };
  }

  const wired = mine.filter((d) => d.pledgeWire);
  if (wired.length !== 1) return { ok: false, why: "the pledge did not resolve to one asset and one facility" };
  const wire = wired[0].pledgeWire!;
  if (draft.slots.assetId && wire.collateralId !== draft.slots.assetId) {
    return { ok: false, why: "the asset the sentence resolved is not the one you picked" };
  }
  if (others.length) return { ok: false, why: "that sentence reached more facilities than the one it named" };
  return { ok: true, delta: wired[0] };
}

/**
 * THE CHIP SAYS WHAT WAS ELICITED (E4b).
 *
 * The parser reads a record amendment's VALUE as the tail of the sentence after
 * the phrase it matched, which is the right rule for a line a banker typed and
 * the wrong one for a sentence this room composed: an involvement chip came back
 * reading "on the construction loan", a sentence fragment sitting where the role
 * belongs. The wire is untouched - it already carries the party and the role,
 * verified - and only the two strings a banker READS are restated, from the
 * slots that were elicited and nothing else.
 */
export function restateEntry(draft: Draft, ctx: ElicitContext, delta: WorkroomDelta): WorkroomDelta {
  /* A NET-NEW ASSET IS FILED UNDER THE BANKER'S OWN WORDS (P3). The composed
     sentence deliberately carries no description - see {@link compose} - so the
     one he wrote goes onto the entry and onto the wire here, which is the only
     place that holds both. Nothing else about the wire is touched. */
  /* AND UNDER THE ORG'S OWN TYPE NAME (E6, 2026-09-02). The fenced parser maps
     every real-estate word onto the single word "Real Estate", which is not one
     of this org's 43 collateral types: the org refuses it at staging and lists
     the eleven it holds. The room settled an exact name with the banker before
     composing, so the name goes onto the wire here, in the one place that holds
     both the elicited slots and the delta. */
  if (draft.surface === "collateral" && draft.slots.isNew && delta.pledgeWire?.newCollateral) {
    const said = draft.slots.assetDescription;
    const type = draft.slots.assetKind;
    if (!said && !type) return delta;
    /* THE 60-CHARACTER CAP IS THE LAST DEFENCE (founder, 2026-09-03), not the
       rule: the banker's own words are the title exactly as he wrote them,
       and `clipTitle` only touches them where he wrote more than a title's
       worth. */
    const title = clipTitle(said ?? delta.title, 60);
    return {
      ...delta,
      title,
      badge: `${title} → ${delta.after}`,
      pledgeWire: {
        ...delta.pledgeWire,
        newCollateral: {
          ...delta.pledgeWire.newCollateral,
          ...(said ? { description: said } : {}),
          ...(type ? { collateralType: type } : {}),
        },
      },
    };
  }
  /* AN EXISTING ASSET'S PLEDGE CARRIES THE FENCED ENGINE'S OWN TITLE
   * (founder finding, 2026-09-03): it resolves the asset off the deal's own
   * pledges and titles the delta from the org's full legal description, which
   * is exactly the record's `LLC_BI__Description__c`, not a name. The short
   * title replaces it here, the way the isNew branch above replaces the
   * engine's title with the banker's own words. Nothing else on the wire
   * moves: the collateral id, the facility, the plan hash are the engine's.
   */
  if (draft.surface === "collateral" && !draft.slots.isNew && delta.pledgeWire?.collateralId) {
    const short = pledgeAssetTitle(delta.pledgeWire, ctx.book);
    if (short && short !== delta.title) {
      return { ...delta, title: short, badge: `${short} → ${delta.after}` };
    }
    return delta;
  }
  if (draft.surface !== "involvement") return delta;
  const { party, role } = draft.slots;
  if (!party || !role) return delta;
  /* AND THE "BEFORE" IS ONLY CLAIMED WHERE THE READ SUPPORTS IT. "not on the
     facility today" is an assertion about the bank's record, and the drive
     caught the room making it about a party that WAS on the facility. Where
     this read carries no borrowing structure for the facility at all, the room
     says what it actually knows instead. */
  const facilityId = delta.involvementWire?.facilityId ?? delta.member;
  const carried = ctx.book.parties.some((p) => p.loanId === facilityId);
  return {
    ...delta,
    title: party,
    after: role,
    badge: `${party} → ${role}`,
    before: carried ? "not on the facility today" : "not carried on this read",
  };
}

/* =============================================================== amendment

   THE CARD IS AMENDABLE. "actually make it 1.30x", "no, quarterly", "on the
   construction loan instead" corrects THE OPEN CARD in place and says what
   changed. It never stages a second, contradicting chip: amending the open card
   IS the one decision, so it does not violate one-decision-at-a-time. It is the
   same decision, corrected.

   The plan is amendable on the same terms. A line touching something already
   staged acts on THAT entry rather than putting a parallel one beside it, and
   two entries moving the same test is exactly the contradiction the banker
   would otherwise have to reconcile by hand.                                */

/** The words a correction opens on. A bare value counts too: "1.30x" answered
 *  into an open card is a correction, not a new instruction. */
const CORRECTION =
  /^\s*(?:no[,\s]+|actually[,\s]*|instead[,\s]*|rather[,\s]*|sorry[,\s]*|make\s+(?:it|that)\b|change\s+(?:it|that)\b|let'?s\s+make\s+it\b)/i;
const INSTEAD = /\binstead\b/i;

/**
 * VERBS THAT MOVE A FACILITY'S OWN TERMS, and therefore never correct a create.
 *
 * "take the 2.5M line of credit to $4,000,000" over an open covenant card is a
 * NEW instruction. Reading it as a correction would move the covenant onto the
 * facility that line happened to name and answer a commitment change with
 * "updated on the card", which is the room agreeing with something nobody said.
 * The room's own one-decision-at-a-time refusal is the right answer to it.
 */
const TERM_VERB = /\b(take|takes|increase|decrease|reduce|raise|lower|bump|extend|shorten|reprice|renew|waive|price)\b/i;

export interface Amendment {
  draft: Draft;
  /** What changed, in the room's own words. */
  changed: string[];
}

/**
 * THE CORRECTION THIS LINE MAKES TO AN OPEN CREATE, or null.
 *
 * Null means the line is not a correction of this create and the room's other
 * lanes should take it. A correction that changes NOTHING is also null: saying
 * "actually make it 1.25x" over a card that already reads 1.25x has corrected
 * nothing, and answering it with "updated" would be the room agreeing with
 * itself.
 */
export function amendmentOf(line: string, draft: Draft, ctx: ElicitContext): Amendment | null {
  const text = line.trim();
  if (!text) return null;

  if (TERM_VERB.test(text)) return null;
  const looksLikeCorrection =
    CORRECTION.test(text) ||
    INSTEAD.test(text) ||
    // A BARE VALUE. "quarterly", "1.30x", "$5,000,000" and "the construction
    // loan" are all complete corrections when a card is open.
    isBareValue(text, draft, ctx);
  if (!looksLikeCorrection) return null;

  const after = readInto(draft, text, ctx);
  const changed: string[] = [];
  const before = draft.slots;

  if (after.slots.test !== before.test && after.slots.test) changed.push(`the test is now ${after.slots.test}`);
  if (after.slots.threshold !== before.threshold && after.slots.threshold !== undefined) {
    changed.push(`the threshold is now ${thresholdText(after.slots.threshold, after.slots.unit)}`);
  }
  if (after.slots.frequency !== before.frequency && after.slots.frequency) {
    changed.push(`it is tested ${after.slots.frequency.toLowerCase()}`);
  }
  if (after.slots.party !== before.party && after.slots.party) changed.push(`the party is now ${after.slots.party}`);
  if (after.slots.role !== before.role && after.slots.role) changed.push(`the role is now ${after.slots.role}`);
  if (after.slots.assetId !== before.assetId && after.slots.assetId) changed.push("the asset has changed");
  if (after.slots.lien !== before.lien && after.slots.lien) changed.push(`the lien position is now ${after.slots.lien}`);
  if (after.scope.join("|") !== draft.scope.join("|") && after.scope.length) {
    changed.push(`it lands on ${sentenceList(after.scope.map((id) => ctx.members.find((m) => m.id === id)?.label ?? id))}`);
  }

  return changed.length ? { draft: after, changed } : null;
}

/** A line that is nothing but an answer: a value, a schedule, a facility. */
function isBareValue(text: string, draft: Draft, ctx: ElicitContext): boolean {
  if (text.split(/\s+/).length > 8) return false;
  if (readFrequency(text)) return true;
  if (/^\s*\$?[\d,.]+\s*x?\s*$/i.test(text)) return true;
  if (readScope(text, ctx.members).ids.length === 1 && !/\b(add|pledge|change|set)\b/i.test(text)) return true;
  if (draft.surface === "covenant" && readTest(text, ctx.book)) return true;
  // "limited guarantor" answered into an open involvement card is a complete
  // correction, and so is a bare name the book carries.
  if (draft.surface === "involvement" && (readRoleWord(text) || readPartyName(text, ctx.book)?.onBook)) return true;
  return false;
}

/* ------------------------------------------------------------- the summary */

/** The one line the room says when a create finally goes up, and the sentence a
 *  correction lands as. Banker language, no schema words, no field names. */
export function changedLine(changed: string[]): string {
  return `Updated on the card: ${sentenceList(changed)}.`;
}
