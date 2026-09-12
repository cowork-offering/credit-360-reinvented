/* =============================================================================
   THE PRE-READ: WHAT THIS FILE IS, WHOSE IT IS, AND WHAT IT SAYS, PROVISIONALLY.

   This is the half of the room Boom does not do. Boom classifies, extracts and
   maps, and an analyst verifies it in Boom's own page. None of that has
   happened yet when the banker is standing over a drop zone deciding what to
   send. The pre-read is what turns that decision from a form into a
   confirmation: the file's own periods, its own scale, its own auditor's
   report, and the company as PRINTED against the relationship the room is
   anchored on.

   DETERMINISTIC FIRST, ALWAYS. `periods.ts` reads the characters on the page;
   only what needs understanding goes to the session door, under a strict JSON
   schema, and every field that comes back is validated against the contract
   before it reaches the glass. A model reply that cannot be validated is
   discarded rather than repaired, and the deterministic read stands on its own
   with `confidence: "low"` and a note that says so.

   THE MISMATCH IS NEVER SILENT. A statement printed for the parent, or for an
   affiliate in the obligor group, is surfaced as a finding. Spreading a
   subsidiary's statements under the parent is the one error in this flow that
   is expensive to undo, because Boom keys a company on its external id.

   NOTHING HERE IS THE SPREAD. Every figure this module produces is
   PROVISIONAL and the room labels it so.
   ============================================================================= */

import { askSessionJson, sampleAvailable } from "../channel/sampleDoor";
import { cellFigure, deterministicLines, mapLineCodes } from "./lineMap";
import { detectCurrency, detectPeriods, detectQuality, detectStatementTypes, detectUnitsStatement, unitsWord } from "./periods";
import type {
  ExtractedDocument,
  FilePreRead,
  PeriodRead,
  PeriodType,
  PreReadLine,
  StatementQuality,
  StatementType,
} from "./types";

/* --------------------------------------------------------- the relationship

   WHAT THE ROOM ALREADY KNOWS when the banker drops a file. All of it is in the
   cockpit's book before the room opens, so nothing is fetched to compose this
   and the pre-read never asks for something the book already holds.           */

export interface RelationshipSpreadContext {
  accountId: string;
  company: string;
  /** The period keys the on-file Boom spread already carries, newest first. */
  onFilePeriods: string[];
  /** As nCino carries them, so the pre-read can say which test a figure moves. */
  covenants: Array<{ name: string; operator: string; threshold: number | null; current: number | null; unit?: string }>;
  /** Guarantors, principals, affiliates, subsidiaries: who else this statement
   *  could legitimately belong to. */
  obligorGroup: Array<{ name: string; role: string }>;
}

export interface PreReadDeps {
  /** The session door, injected. Defaults to `askSessionJson`. */
  ask?: (prompt: string, options?: { signal?: AbortSignal }) => Promise<string>;
  /** Whether the door is there at all. Defaults to `sampleAvailable`. */
  available?: () => boolean;
  signal?: AbortSignal;
}

/* ------------------------------------------------------------ the codes

   Boom's own account codes live in `lineMap.ts` beside the dictionary that
   places them, and are re-exported here because the prompt below is the other
   thing that spends them. The model is given the list and told to use null
   rather than a code it is not confident of: a mis-mapped code is a wrong
   figure in the right row, which is worse than an unmapped line.             */

export { BOOM_ACCOUNT_CODES } from "./lineMap";
import { BOOM_ACCOUNT_CODES } from "./lineMap";

const STATEMENT_TYPES: StatementType[] = [
  "income_statement",
  "balance_sheet",
  "cash_flow_statement",
  "shareholders_equity",
  "personal_statement",
];

const PERIOD_TYPES: PeriodType[] = [
  "monthly",
  "quarterly",
  "annual",
  "year_to_date",
  "trailing_twelve_months",
  "semi_annual",
  "unknown",
  "none",
];

const QUALITIES: StatementQuality[] = ["cpa_audited", "cpa_reviewed", "cpa_compiled", "internal"];

const UNIT_MULTIPLIERS = [1, 1_000, 1_000_000];

/** How much of the file's text travels with the prompt. The bridge burns on
 *  very large payloads, and the face of a statement set is at the front of it. */
const PRE_READ_TEXT_CAP = 12_000;

/* -------------------------------------------------------- the company match */

const SUFFIXES =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|lp|llp|plc|gmbh|holdings?|group)\b/g;

/** A company name reduced to the letters that identify it. */
export function normaliseCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'’"()]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** TRUE where the printed name is the anchored relationship, FALSE where it is
 *  somebody else, NULL where the file prints no name at all. A named member of
 *  the obligor group counts as a match for the purpose of the flag; the room
 *  still surfaces WHICH member, because that decides the company the spread is
 *  filed under. */
export function companyMatch(
  printed: string | null,
  ctx: RelationshipSpreadContext,
): { matches: boolean | null; member: string | null } {
  if (!printed || !printed.trim()) return { matches: null, member: null };
  const said = normaliseCompany(printed);
  if (!said) return { matches: null, member: null };
  // CONTAINMENT RUNS ONE WAY ONLY. A printed name that CONTAINS the whole
  // relationship name is the relationship ("Piedmont Precision Components and
  // Subsidiaries"). The reverse is not: "Hartwell Holdings" sits inside
  // "Hartwell Holdings Precision" and is a different borrower. Reading it both
  // ways is how a parent's statements get spread under a subsidiary in silence.
  const anchor = normaliseCompany(ctx.company);
  if (anchor && (said === anchor || said.includes(anchor))) return { matches: true, member: null };
  for (const party of ctx.obligorGroup) {
    const other = normaliseCompany(party.name);
    if (other && (said === other || said.includes(other))) {
      return { matches: false, member: `${party.name} (${party.role})` };
    }
  }
  return { matches: false, member: null };
}

/* --------------------------------------------------- the deterministic read */

const CAPS = /^[A-Z0-9][A-Z0-9 &.,'’()\-]{5,70}$/;

/**
 * THE COMPANY AS PRINTED, from the head of the file.
 *
 * A statement puts its own name at the top, usually in capitals and usually
 * above the words "balance sheet". These are CANDIDATES: the model confirms
 * one, and where the door is absent the first candidate is offered to the
 * banker rather than asserted.
 */
export function companyCandidates(text: string): string[] {
  const head = text.slice(0, 1500);
  const out: string[] = [];
  for (const raw of head.split(/\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || line.length < 6) continue;
    if (/balance sheet|income|cash flow|statement|report|financial|unaudited|page \d/i.test(line)) continue;
    if (CAPS.test(line) || /\b(Inc|LLC|Ltd|Corp|Company|Holdings|Group|L\.L\.C|LP)\b\.?$/.test(line)) {
      if (!out.includes(line)) out.push(line);
    }
    if (out.length >= 3) break;
  }
  return out;
}

/** What the file says about itself, with no model in the path. This is what the
 *  room shows while the door is still thinking, and what it keeps if the door
 *  never answers. */
export function deterministicPreRead(doc: ExtractedDocument, ctx: RelationshipSpreadContext): FilePreRead {
  const periods = detectPeriods(doc.text);
  const types = detectStatementTypes(doc.text);
  const units = detectUnitsStatement(doc.text);
  const { quality, grounding } = detectQuality(doc.text);
  const candidates = companyCandidates(doc.text);
  const company = candidates[0] ?? null;
  const match = companyMatch(company, ctx);

  /* THE LINES, PLACED FROM THE TEXT ITSELF. Boom still maps what it maps; this
     is what the room, the provisional read and the stand-in have to work with
     until it does, and it is the difference between a spread that survives an
     absent desk and one that dies on it. */
  const mapped = deterministicLines(doc, periods, units.multiplier);
  const linesFor = (type: StatementType): PreReadLine[] => mapped.find((m) => m.statementType === type)?.lines ?? [];
  const statementTypes = [...new Set([...types, ...mapped.map((m) => m.statementType)])];

  const notes: FilePreRead["quality"] = [];
  for (const w of doc.warnings) notes.push({ level: "info", text: w });
  if (quality && grounding) notes.push({ level: "info", text: `Read as ${qualityWord(quality)}: "${grounding}"` });
  if (units.stated) notes.push({ level: "info", text: unitsStatedNote(units.multiplier) });
  if (match.matches === false) {
    notes.push({
      level: "warn",
      text: match.member
        ? `This reads as ${company}, which is ${match.member} on this relationship, not ${sentence(ctx.company)} Confirm which borrower it is spread under.`
        : `This reads as ${company}, not ${sentence(ctx.company)} Confirm which borrower it is spread under.`,
    });
  }
  for (const note of periodNotes(periods, ctx)) notes.push(note);

  return {
    fileId: doc.fileId,
    statements: statementTypes.map((statementType) => ({ statementType, periods, lines: linesFor(statementType) })),
    company,
    companyMatchesRelationship: match.matches,
    currency: detectCurrency(doc.text),
    unitsMultiplier: units.multiplier,
    statementQuality: quality,
    quality: notes,
    // LOW, WHATEVER IT PLACED. These lines are a reading of characters, not an
    // understanding of a statement, and the room labels them accordingly.
    confidence: "low",
  };
}

/**
 * THE NOTE A STATEMENT THAT PRINTS ITS OWN SCALE EARNS, and the way that fact
 * travels. `FilePreRead` is the shared contract with Boom's own shapes and does
 * not grow a field for this layer's bookkeeping, so the reading is carried as
 * the note the card already prints and read back with {@link unitsStated}. A
 * room that asks a banker about a scale the statement states plainly is the
 * wall the golden rule forbids.
 */
export function unitsStatedNote(multiplier: number): string {
  return `Figures in ${unitsWord(multiplier)}, as the statement says.`;
}

/** Did the file state its own scale, at the scale this read is holding. False
 *  where the read's multiplier is no longer the one the text printed, which is
 *  itself a disagreement worth asking about. */
export function unitsStated(pre: FilePreRead): boolean {
  return pre.quality.some((q) => q.text === unitsStatedNote(pre.unitsMultiplier));
}

/** A sentence that ends exactly once. A relationship's legal name ends in a
 *  period more often than not ("Piedmont Precision Components, Inc."), and a
 *  second one after it is the kind of thing a banker notices first. */
export function sentence(text: string): string {
  const said = text.trim();
  return /[.?!]$/.test(said) ? said : `${said}.`;
}

/** Banker words for Boom's quality enum. */
export function qualityWord(quality: StatementQuality): string {
  switch (quality) {
    case "cpa_audited":
      return "audited";
    case "cpa_reviewed":
      return "reviewed";
    case "cpa_compiled":
      return "compiled";
    default:
      return "management prepared";
  }
}

const yearOfKey = (key: string): number | null => {
  const m = /((?:19|20)\d{2})/.exec(key);
  return m ? Number(m[1]) : null;
};

/** What the periods in this file mean against the periods already on file: a
 *  repeat, or a gap nobody has spread. */
function periodNotes(periods: PeriodRead[], ctx: RelationshipSpreadContext): FilePreRead["quality"] {
  const out: FilePreRead["quality"] = [];
  if (!periods.length) {
    out.push({ level: "warn", text: "No fiscal period is printed where this room could read it. Confirm the period before this goes to Boom." });
    return out;
  }
  const repeat = periods.filter((p) => ctx.onFilePeriods.includes(p.key)).map((p) => p.key);
  if (repeat.length) {
    out.push({
      level: "info",
      text: `${repeat.join(", ")} ${repeat.length === 1 ? "is" : "are"} already on file from the last spread. Boom keys the file on its hash, so the same document does not fork a second period.`,
    });
  }
  const newestHere = yearOfKey(periods[0].key);
  const newestOnFile = ctx.onFilePeriods.map(yearOfKey).filter((y): y is number => y !== null).sort((a, b) => b - a)[0];
  if (newestHere !== null && newestOnFile !== undefined && newestHere - newestOnFile > 1) {
    out.push({
      level: "warn",
      text: `The on-file spread ends at FY${newestOnFile} and this file starts at ${periods[0].key}, so ${newestHere - newestOnFile - 1} year${newestHere - newestOnFile - 1 === 1 ? "" : "s"} would stay unspread.`,
    });
  }
  return out;
}

/* ----------------------------------------------------------- the prompt */

const clip = (text: string, cap: number): string =>
  text.length <= cap ? text : `${text.slice(0, cap)}\n[the rest of this file was not carried]`;

/** The rules the model answers under. */
const PRE_READ_RULES = [
  "You are reading ONE financial statement file for a commercial bank, before it is sent to a spreading engine.",
  "Report only what the document text carries. Never infer a figure, a period or a company that is not printed.",
  "Report every value EXACTLY as printed, without applying any scale stated in the header; report the scale separately.",
  "A negative printed in parentheses is a negative number.",
  "Use null for an account code you are not confident of. A wrong code is worse than no code.",
  "Reply with the JSON object and nothing else. No prose, no markdown, no code fence.",
];

export function composePreReadPrompt(doc: ExtractedDocument, ctx: RelationshipSpreadContext, base: FilePreRead): string {
  const context = {
    relationship: ctx.company,
    obligorGroup: ctx.obligorGroup,
    periodsAlreadyOnFile: ctx.onFilePeriods,
    covenants: ctx.covenants.map((c) => ({ name: c.name, operator: c.operator, threshold: c.threshold, current: c.current, unit: c.unit })),
    readDeterministically: {
      kind: doc.kind,
      pages: doc.pages ?? null,
      periods: base.statements[0]?.periods ?? [],
      statementTypes: base.statements.map((s) => s.statementType),
      unitsMultiplier: base.unitsMultiplier,
      statementQuality: base.statementQuality,
      companyCandidates: companyCandidates(doc.text),
    },
  };
  const schema = {
    statements: [
      {
        statementType: `one of ${STATEMENT_TYPES.join(" | ")}`,
        periods: [{ key: "FY2025", endDate: "YYYY-MM-DD or null", periodType: `one of ${PERIOD_TYPES.join(" | ")}` }],
        lines: [
          {
            label: "the line as printed",
            accountCode: `one of ${BOOM_ACCOUNT_CODES.join(" | ")} or null`,
            values: { FY2025: 64486, FY2024: null },
            confidence: "high | medium | low",
          },
        ],
      },
    ],
    company: "the company as printed, or null",
    companyMatchesRelationship: "true | false | null",
    currency: "USD",
    unitsMultiplier: "1 | 1000 | 1000000",
    statementQuality: `one of ${QUALITIES.join(" | ")} or null`,
    quality: [{ level: "info | warn | bad", text: "one sober sentence a credit officer would accept" }],
    confidence: "high | medium | low",
  };
  return [
    ...PRE_READ_RULES,
    "",
    "Findings to report in `quality`: a balance sheet that does not balance, a subtotal that does not foot,",
    "a statement that appears to be missing pages, a period that is missing between the periods already on file",
    "and the periods here, and a company name that is not the relationship named in CONTEXT.",
    "Keep every sentence sober and specific. No exclamation points, no marketing words, no em dashes.",
    "",
    "SCHEMA:",
    JSON.stringify(schema),
    "",
    "CONTEXT:",
    JSON.stringify(context),
    "",
    "DOCUMENT:",
    clip(doc.text, PRE_READ_TEXT_CAP),
  ].join("\n");
}

/* --------------------------------------------------------- the validator */

export class PreReadParseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The object inside a reply, whether or not the model wrapped a sentence
 *  around it. The same reason `askSessionJson` hands the raw text back on
 *  `invalid_json`: our own extractor gets its chance before the read degrades. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) throw new PreReadParseError("the reply carried no JSON object");
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!isObj(parsed)) throw new PreReadParseError("the reply was not a JSON object");
    return parsed;
  } catch (err) {
    if (err instanceof PreReadParseError) throw err;
    throw new PreReadParseError(`the reply was not parseable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A figure out of a model's JSON value. A number is itself; a string is read
 *  the way a statement prints one ({@link cellFigure}); a printed dash and
 *  anything that is not a figure at all are both nothing here, because the
 *  caller has already distinguished an explicit null in the reply. */
export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const figure = cellFigure(v);
  return typeof figure === "number" ? figure : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function validPeriods(raw: unknown): PeriodRead[] {
  if (!Array.isArray(raw)) return [];
  const out: PeriodRead[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const key = str(item.key);
    if (!key) continue;
    const endDate = str(item.endDate);
    const periodType = PERIOD_TYPES.includes(item.periodType as PeriodType) ? (item.periodType as PeriodType) : "unknown";
    out.push({ key, endDate: endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null, periodType });
  }
  return out;
}

/** Lines, scaled to absolute currency units. A line with a value that is
 *  neither a figure nor an explicit null is DROPPED: the model was asked for
 *  printed figures, and something else in that slot means the row was not read. */
function validLines(raw: unknown, multiplier: number): PreReadLine[] {
  if (!Array.isArray(raw)) return [];
  const out: PreReadLine[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const label = str(item.label);
    if (!label) continue;
    const accountCode = str(item.accountCode);
    if (accountCode && !(BOOM_ACCOUNT_CODES as readonly string[]).includes(accountCode)) continue;
    if (!isObj(item.values)) continue;
    const values: Record<string, number | null> = {};
    let usable = false;
    let broken = false;
    for (const [key, value] of Object.entries(item.values)) {
      if (value === null || value === undefined) {
        values[key] = null;
        continue;
      }
      const n = coerceNumber(value);
      if (n === null) {
        broken = true;
        break;
      }
      values[key] = n * multiplier;
      usable = true;
    }
    if (broken || !usable) continue;
    const confidence = item.confidence === "high" || item.confidence === "medium" ? item.confidence : "low";
    out.push({ label, accountCode, values, confidence });
  }
  return out;
}

function validQuality(raw: unknown): FilePreRead["quality"] {
  if (!Array.isArray(raw)) return [];
  const out: FilePreRead["quality"] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const text = str(item.text);
    if (!text) continue;
    const level = item.level === "warn" || item.level === "bad" ? item.level : "info";
    out.push({ level, text });
  }
  return out;
}

/**
 * THE MODEL'S READ, HELD TO THE CONTRACT.
 *
 * Unknown enums are rejected, figures are coerced from what a statement prints,
 * and anything the reply left out falls back to the deterministic read rather
 * than to a default. Throws {@link PreReadParseError} only where the reply is
 * not a usable object at all, which is the one case worth a second ask.
 */
export function validateModelPreRead(
  raw: string,
  base: FilePreRead,
  ctx: RelationshipSpreadContext,
): FilePreRead {
  const parsed = extractJsonObject(raw);

  const multiplier = UNIT_MULTIPLIERS.includes(Number(parsed.unitsMultiplier))
    ? Number(parsed.unitsMultiplier)
    : base.unitsMultiplier;

  if (!Array.isArray(parsed.statements)) throw new PreReadParseError("the reply carried no statements array");

  const statements: FilePreRead["statements"] = [];
  const dropped: string[] = [];
  for (const item of parsed.statements) {
    if (!isObj(item)) continue;
    const statementType = item.statementType;
    if (!STATEMENT_TYPES.includes(statementType as StatementType)) {
      if (typeof statementType === "string") dropped.push(statementType);
      continue;
    }
    const periods = validPeriods(item.periods);
    statements.push({
      statementType: statementType as StatementType,
      periods: periods.length ? periods : (base.statements[0]?.periods ?? []),
      /* THE MODEL'S CODES STAND. The dictionary only fills the rows it left
         empty: the model read the statement and this list did not, so it is the
         floor under the read and never a correction of it. */
      lines: mapLineCodes(validLines(item.lines, multiplier)),
    });
  }
  const company = str(parsed.company) ?? base.company;
  const match = companyMatch(company, ctx);
  const quality = validQuality(parsed.quality);
  if (dropped.length) {
    quality.push({
      level: "warn",
      text: `The read named a statement type this cockpit does not carry (${dropped.join(", ")}), so that statement was left out.`,
    });
  }
  // The deterministic findings are the floor: a model that did not mention the
  // company mismatch or the period gap does not make either of them go away.
  for (const note of base.quality) {
    if (!quality.some((q) => q.text === note.text)) quality.push(note);
  }

  const statementQuality = QUALITIES.includes(parsed.statementQuality as StatementQuality)
    ? (parsed.statementQuality as StatementQuality)
    : base.statementQuality;

  const currency = typeof parsed.currency === "string" && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : base.currency;

  const confidence =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";

  return {
    fileId: base.fileId,
    statements: statements.length ? statements : base.statements,
    company,
    companyMatchesRelationship: match.matches,
    currency,
    unitsMultiplier: multiplier,
    statementQuality,
    quality,
    confidence: statements.some((s) => s.lines.length) ? confidence : "low",
  };
}

/* ------------------------------------------------------------ the read */

export const DOOR_ABSENT_NOTE =
  "The desk is not connected, so the lines below were placed from the text of this file alone. Boom reads the file itself and maps it when it spreads.";

export const MODEL_FAILED_NOTE =
  "The desk did not return a usable read, so the lines below were placed from the text of this file alone. Boom reads the file itself and maps it when it spreads.";

export const SCAN_NOTE =
  "This file carries no text layer, so it reads as a scan. Boom reads it. Confirm the statement type, the period and the statement quality before it goes.";

/**
 * READ ONE FILE, BEFORE ANYTHING IS SENT.
 *
 * Deterministic first and always; the session door only for what needs
 * understanding. Never rejects: every kind of absence comes back as the
 * deterministic read with a note that says what was not done, because a room
 * that threw here would leave the banker holding a file and no next step.
 */
export async function preReadFile(
  doc: ExtractedDocument,
  ctx: RelationshipSpreadContext,
  deps: PreReadDeps = {},
): Promise<FilePreRead> {
  const base = deterministicPreRead(doc, ctx);

  if (doc.isScan) {
    // Nothing to read and nothing to ask the model about. The room asks the
    // banker the three facts instead, off the empty statements and this note.
    return { ...base, statements: [], quality: [{ level: "warn", text: SCAN_NOTE }, ...base.quality] };
  }

  const available = deps.available ?? sampleAvailable;
  const ask = deps.ask ?? ((prompt: string, options?: { signal?: AbortSignal }) =>
    askSessionJson(prompt, { kind: "reply", tier: "default", rung: 2, signal: options?.signal }));

  if (!available()) {
    return { ...base, quality: [{ level: "info", text: DOOR_ABSENT_NOTE }, ...base.quality] };
  }

  const prompt = composePreReadPrompt(doc, ctx, base);
  try {
    return validateModelPreRead(await ask(prompt, { signal: deps.signal }), base, ctx);
  } catch (first) {
    // ONE retry, with the reason appended. The contract forbids retrying from a
    // loop, and a second failure is a fact about this file rather than a blip.
    const why = first instanceof Error ? first.message : String(first);
    try {
      return validateModelPreRead(
        await ask(`${prompt}\n\nYour previous reply could not be used: ${why}. Reply with the JSON object only.`, { signal: deps.signal }),
        base,
        ctx,
      );
    } catch {
      return { ...base, quality: [{ level: "warn", text: MODEL_FAILED_NOTE }, ...base.quality] };
    }
  }
}
