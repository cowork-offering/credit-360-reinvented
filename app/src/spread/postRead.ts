/* =============================================================================
   THE POST-READ: WHAT THE SPREAD DID TO THIS RELATIONSHIP.

   Boom has spread the file. Boom knows what the statement says; it does not
   know that this borrower tests interest coverage against a 1.25x floor on a
   term loan that matures next spring. That is the sentence a credit committee
   asks for, and it is the one this module writes.

   THE MODEL NEVER BRINGS A FIGURE, AND NEVER BRINGS A VIEW. The deterministic
   half below computes every number from the spread Boom returned and the read
   already on file, and the session door is handed those facts and asked to say
   them again in a paragraph. Its reply is then checked sentence by sentence
   against the facts it was given: a sentence carrying a figure, a subject or a
   judgement the facts do not carry is dropped and the deterministic sentences
   stand. There is no repair pass, because a half-trusted paragraph is worse
   than a plain one.

   NOT YET VERIFIED IS SAID OUT LOUD. Boom's ladder ends at `verified`, which is
   an analyst signing the spread off in Boom's own page. Until that has
   happened the post-read says so in its own sentence, every time.
   ============================================================================= */

import { askSession, sampleAvailable } from "../channel/sampleDoor";
import type { Boom } from "../data/contract";
import { fmtMoney, fmtPct } from "../data/format";
import { sentence, type RelationshipSpreadContext } from "./preRead";
import { covenantDirection, covenantFigureKey, onFileBoomFigures, thresholdSide, thresholdWord } from "./provisional";
import type { BoomFinancialStatement } from "./types";

export interface PostReadDeps {
  /** The session door, injected. Defaults to `askSession`. */
  ask?: (prompt: string) => Promise<string>;
  /** Whether the door is there at all. Defaults to `sampleAvailable`. */
  available?: () => boolean;
}

export const NOT_VERIFIED_LINE =
  "This spread is not yet verified in Boom, so the figures above are Boom's first pass and an analyst still signs them off.";

export const VERIFIED_LINE = "This spread is verified in Boom.";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ratio = (n: number): string => `${n.toFixed(2)}x`;

const DA_NAME = /deprecia|amorti[sz]/i;
const REVENUE_CODES = ["net_sales_revenue", "sales_revenue", "revenue", "total_revenue"];

/* ------------------------------------------------------------- the index

   Boom keys `periodValues` on the period's own id, and the statement's
   `periods[]` is the only place that id is tied to an end date. Reading the ids
   directly is the defect boom-normalise.mjs documents: a year regex over a UUID
   matched a four-digit fragment of it and picked the wrong period.            */

interface AfterIndex {
  byCode: Record<string, Record<string, number>>;
  byName: Array<{ name: string; values: Record<string, number> }>;
  endDates: string[];
  annual: boolean;
}

const dayOf = (v: string | null | undefined): string | null => {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
};

function indexAfter(statements: BoomFinancialStatement[]): AfterIndex {
  const byCode: Record<string, Record<string, number>> = {};
  const byName: Array<{ name: string; values: Record<string, number> }> = [];
  const endDates = new Set<string>();
  let annual = true;

  for (const statement of statements) {
    const dayById: Record<string, string> = {};
    for (const period of statement.periods ?? []) {
      const day = dayOf(period.endDate);
      if (!day) continue;
      dayById[period.id] = day;
      endDates.add(day);
      if (period.periodType && period.periodType !== "annual") annual = false;
    }
    for (const item of statement.lineItems ?? []) {
      const values: Record<string, number> = {};
      for (const [id, value] of Object.entries(item.periodValues ?? {})) {
        const day = dayById[id];
        if (!day || !isNum(value)) continue;
        values[day] = value;
      }
      if (!Object.keys(values).length) continue;
      if (item.accountCode) {
        const row = (byCode[item.accountCode] ??= {});
        // First writer wins, so a code carried on two statements never has one
        // statement's figure quietly overwritten by the other's.
        for (const [day, value] of Object.entries(values)) if (!(day in row)) row[day] = value;
      }
      byName.push({ name: item.name ?? "", values });
    }
  }
  return { byCode, byName, endDates: [...endDates].sort().reverse(), annual };
}

const pick = (index: AfterIndex, codes: string[], day: string): number | null => {
  for (const code of codes) {
    const v = index.byCode[code]?.[day];
    if (isNum(v)) return v;
  }
  return null;
};

const pickByName = (index: AfterIndex, re: RegExp, day: string): number | null => {
  for (const row of index.byName) {
    if (!re.test(row.name)) continue;
    const v = row.values[day];
    if (isNum(v)) return v;
  }
  return null;
};

export interface PostReadFigures {
  period: string;
  endDate: string;
  revenue: number | null;
  ebitda: number | null;
  operatingProfit: number | null;
  totalDebt: number | null;
  leverage: number | null;
  interestCoverage: number | null;
}

/** The new period's figures, from the spread Boom returned. EBITDA is derived
 *  here because the spread itself carries the depreciation and amortisation row
 *  the cockpit's chart-level read does not: it has no account code, and it is
 *  found by name, exactly as Boom's own ratio layer finds it. */
export function figuresFromSpread(statements: BoomFinancialStatement[]): PostReadFigures | null {
  const index = indexAfter(statements);
  const day = index.endDates[0];
  if (!day) return null;

  const revenue = pick(index, REVENUE_CODES, day);
  const operatingProfit = pick(index, ["operating_profit"], day);
  const da = pickByName(index, DA_NAME, day);
  const interest = pick(index, ["interest_expense"], day);
  const shortTerm = pick(index, ["st_loans_payable_bank"], day);
  const longTerm = pick(index, ["long_term_debt_bank"], day);

  const ebitda = operatingProfit !== null && da !== null ? operatingProfit + da : null;
  const totalDebt = shortTerm !== null || longTerm !== null ? (shortTerm ?? 0) + (longTerm ?? 0) : null;

  return {
    period: index.annual ? `FY${day.slice(0, 4)}` : day,
    endDate: day,
    revenue,
    ebitda,
    operatingProfit,
    totalDebt,
    leverage: ebitda !== null && ebitda > 0 && totalDebt !== null ? totalDebt / ebitda : null,
    interestCoverage:
      operatingProfit !== null && interest !== null && Math.abs(interest) > 0 ? operatingProfit / Math.abs(interest) : null,
  };
}

/* ------------------------------------------------------------- the facts */

function deltaWord(now: number, before: number): string {
  if (before === 0) return "";
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.05) return ", level with it";
  return `, ${pct > 0 ? "up" : "down"} ${fmtPct(Math.abs(pct))}`;
}

/** The deterministic post-read: what changed, which tests move, and where the
 *  spread stands in Boom's own ladder. These sentences are the output when the
 *  door is absent, and the facts the paragraph is composed from when it is not. */
export function postReadFacts(args: {
  company: string;
  before: Boom | null | undefined;
  after: BoomFinancialStatement[];
  covenants: RelationshipSpreadContext["covenants"];
  validationStatus: "not_validated" | "validated";
}): string[] {
  const now = figuresFromSpread(args.after);
  const { figures: before, period: beforePeriod } = onFileBoomFigures(args.before);
  const out: string[] = [];

  if (!now) {
    out.push(sentence(`Boom returned no spread this room could read for ${args.company}`));
    out.push(args.validationStatus === "validated" ? VERIFIED_LINE : NOT_VERIFIED_LINE);
    return out;
  }

  out.push(sentence(`Boom has spread ${now.period} for ${args.company}`));

  const against = (label: string, value: number | null, prior: number | null): void => {
    if (value === null) return;
    if (prior === null || !beforePeriod) {
      out.push(`${label} ${fmtMoney(value)} in ${now.period}.`);
      return;
    }
    out.push(`${label} ${fmtMoney(value)} in ${now.period} against ${fmtMoney(prior)} ${beforePeriod} on file${deltaWord(value, prior)}.`);
  };

  against("Revenue", now.revenue, before.revenue);
  against("EBITDA", now.ebitda, before.ebitda);
  against("Total bank debt", now.totalDebt, before.totalDebt);

  if (now.leverage !== null) {
    out.push(
      before.leverage !== null
        ? `Leverage ${ratio(now.leverage)} against ${ratio(before.leverage)} on file.`
        : `Leverage ${ratio(now.leverage)}, total bank debt over EBITDA.`,
    );
  }
  if (now.interestCoverage !== null) {
    out.push(
      before.interestCoverage !== null
        ? `Interest coverage ${ratio(now.interestCoverage)} against ${ratio(before.interestCoverage)} on file, operating profit over interest expense.`
        : `Interest coverage ${ratio(now.interestCoverage)}, operating profit over interest expense.`,
    );
  }

  const untested: string[] = [];
  for (const covenant of args.covenants) {
    const key = covenantFigureKey(covenant.name);
    const value = key ? now[key] : null;
    if (key === null || value === null || covenant.threshold === null) {
      untested.push(covenant.name);
      continue;
    }
    const direction = covenantDirection(covenant.operator);
    const word = thresholdWord(direction);
    const where = thresholdSide(direction, value, covenant.threshold);
    const side = where ? `, ${where}` : "";
    const moved =
      covenant.current !== null && covenant.current !== undefined
        ? ` The last test nCino carries is ${ratio(covenant.current)}.`
        : "";
    out.push(`${covenant.name} tests at ${ratio(value)} on this spread against its ${ratio(covenant.threshold)} ${word}${side}.${moved}`);
  }
  if (untested.length) {
    out.push(`${untested.join(", ")} ${untested.length === 1 ? "is" : "are"} not recomputable from this spread, so ${untested.length === 1 ? "it stands" : "they stand"} as nCino last tested ${untested.length === 1 ? "it" : "them"}.`);
  }

  out.push(args.validationStatus === "validated" ? VERIFIED_LINE : NOT_VERIFIED_LINE);
  return out;
}

/* ---------------------------------------------------------------- the guard

   THE MODEL REPHRASES THE FACTS. IT DOES NOT ADD TO THEM.

   A figure the model brought of its own was always caught. What the figure
   guard cannot see is the sentence that carries no figure at all: "the
   borrower's leverage stands inside policy and the coverage cushion is intact"
   reads like the desk and is an invention, because nothing handed to the model
   says anything about policy. SR 11-7 draws no line between an invented number
   and an invented judgement, and golden rule C lets the room judge only where
   the facts judge.

   So the guard now runs SENTENCE BY SENTENCE, and a sentence is kept on three
   conditions: every figure in it is a figure from the facts, it is anchored to
   something the facts actually name, and it carries no judgement word the facts
   did not carry first. What fails is dropped. What survives is rephrasing, and
   nothing else. Where nothing survives the deterministic read stands alone,
   which it already does.                                                     */

/** Every figure in a sentence, normalised so "$71.2M" and "71.2M" are the same
 *  token. Years and percentages count: a paragraph that names a period nobody
 *  gave it is as wrong as one that names a figure nobody gave it. */
export function numbersIn(text: string): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?\s*(?:%|x|[KMB]\b)?/gi) ?? [];
  return found.map((t) => t.replace(/[,\s]/g, "").toLowerCase());
}

const wordsIn = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** TRUE where every figure in `text` appears in `facts`. The model is a writer
 *  here and never a source, so anything it brought of its own is the
 *  sentence's problem. */
export function figuresAreGrounded(text: string, facts: string[]): boolean {
  const allowed = new Set(numbersIn(facts.join(" ")));
  return numbersIn(text).every((n) => allowed.has(n));
}

/** What a sentence may be anchored to: the concepts the deterministic read
 *  names. A term counts only where the facts themselves carry it, so this list
 *  is a vocabulary and never a licence. */
const ANCHOR_TERMS = [
  "revenue",
  "sales",
  "ebitda",
  "operating profit",
  "net income",
  "margin",
  "interest coverage",
  "interest expense",
  "coverage",
  "leverage",
  "bank debt",
  "total debt",
  "debt",
  "total assets",
  "total liabilities",
  "equity",
  "cash",
  "working capital",
  "inventory",
  "receivables",
  "fixed charge",
  "covenant",
  "threshold",
  "floor",
  "ceiling",
  "spread",
  "boom",
  "ncino",
];

const LEGAL_SUFFIXES = new Set(["corp", "corporation", "company", "limited", "incorporated", "plc", "gmbh"]);

/** The words that turn a restatement into a credit opinion. None of them is
 *  derivable from a spread, so each is kept out unless the facts said it
 *  first. */
export const JUDGEMENT_WORDS = new Set([
  "acceptable",
  "adequate",
  "aggressive",
  "ample",
  "approval",
  "approve",
  "approved",
  "breach",
  "breached",
  "breaches",
  "comfort",
  "comfortable",
  "comfortably",
  "compliance",
  "compliant",
  "concerning",
  "conservative",
  "cushion",
  "favourable",
  "favorable",
  "headroom",
  "healthy",
  "impressive",
  "manageable",
  "modest",
  "policies",
  "policy",
  "prudent",
  "reassuring",
  "recommend",
  "recommendation",
  "recommended",
  "recommends",
  "robust",
  "safe",
  "satisfactory",
  "should",
  "solid",
  "sound",
  "strength",
  "strong",
  "supportive",
  "weak",
  "weakness",
  "worrying",
]);

/** What the facts permit a sentence to reach for. */
export interface FactAnchors {
  /** Every figure the facts state. */
  numbers: Set<string>;
  /** Every concept, period and name the facts state. */
  terms: string[];
  /** Every word the facts state, which is what licenses a judgement word. */
  words: Set<string>;
  /** TRUE where the deterministic read has already put a test through its
   *  threshold, which is the one thing that lets the prose say "breach". */
  through: boolean;
}

/** The facts, read as the ground a sentence may stand on. */
export function factAnchors(facts: string[], company?: string): FactAnchors {
  const text = facts.join(" ").toLowerCase();
  const terms = ANCHOR_TERMS.filter((term) => text.includes(term));
  for (const period of text.match(/\bfy\d{4}\b/g) ?? []) terms.push(period);
  for (const token of wordsIn(company ?? "")) {
    if (token.length >= 4 && !LEGAL_SUFFIXES.has(token)) terms.push(token);
  }
  return {
    numbers: new Set(numbersIn(text)),
    terms,
    words: new Set(wordsIn(text)),
    through: /\bthrough it\b/.test(text),
  };
}

/** TRUE where a sentence is a rephrasing of the facts: its figures are their
 *  figures, it names something they name, and it passes no judgement they did
 *  not pass. */
export function sentenceIsGrounded(text: string, anchors: FactAnchors): boolean {
  const figures = numbersIn(text);
  if (!figures.every((n) => anchors.numbers.has(n))) return false;

  const lower = text.toLowerCase();
  if (!figures.length && !anchors.terms.some((term) => lower.includes(term))) return false;

  for (const word of wordsIn(lower)) {
    if (!JUDGEMENT_WORDS.has(word)) continue;
    if (anchors.words.has(word)) continue;
    if (word.startsWith("breach") && anchors.through) continue;
    return false;
  }
  return true;
}

/** The model's reply, cut at its sentence ends. */
export function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The paragraph with every ungrounded sentence removed, and "" where nothing
 *  the model wrote survived. */
export function groundedProse(paragraph: string, facts: string[], company?: string): string {
  const anchors = factAnchors(facts, company);
  return splitSentences(paragraph)
    .filter((s) => sentenceIsGrounded(s, anchors))
    .join(" ");
}

/* -------------------------------------------------------------- the prose */

const PARAGRAPH_RULES = [
  "You are the credit desk writing the note a credit committee reads after a new spread lands.",
  "Write ONE paragraph, at most five sentences, in sober banking prose.",
  "Use ONLY the facts below. Every figure in your paragraph must appear in them, exactly as written there.",
  "Never add a figure, a ratio, a period or a name that is not in the facts.",
  "Rephrase the facts and nothing else: no judgement, no view on policy, and no word on whether a figure is comfortable, strong or acceptable.",
  "Say what changed, which tests move and what the committee will ask. No headings, no bullets, no markdown.",
  "No exclamation points, no marketing words, no em dashes.",
];

/**
 * THE POST-READ THE ROOM PRINTS.
 *
 * The deterministic sentences always, and after them whatever the door wrote
 * that is a rephrasing of those sentences: the figures theirs, the subject
 * theirs, the judgement theirs. Never rejects: a door that is absent, declines
 * or writes only inventions leaves the deterministic read exactly as it was.
 */
export async function postRead(
  args: {
    company: string;
    before: Boom | null | undefined;
    after: BoomFinancialStatement[];
    covenants: RelationshipSpreadContext["covenants"];
    validationStatus: "not_validated" | "validated";
  },
  deps: PostReadDeps = {},
): Promise<string[]> {
  const facts = postReadFacts(args);

  const available = deps.available ?? sampleAvailable;
  if (!available()) return facts;

  const ask = deps.ask ?? ((prompt: string) => askSession(prompt, { kind: "reply", tier: "default", rung: 2 }));
  try {
    const paragraph = (await ask([...PARAGRAPH_RULES, "", "FACTS:", ...facts.map((f) => `- ${f}`)].join("\n"))).trim();
    const prose = paragraph ? groundedProse(paragraph, facts, args.company) : "";
    if (!prose) return facts;
    return [...facts, prose];
  } catch {
    // Absence, never an error on the glass. The deterministic read stands.
    return facts;
  }
}
