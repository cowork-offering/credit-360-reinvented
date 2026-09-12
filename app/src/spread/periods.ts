/* =============================================================================
   WHAT THE TEXT ITSELF SAYS: PERIODS, UNITS, STATEMENT HINTS, QUALITY HINTS.

   Pure and deterministic. No model, no I/O, no clock. Everything here is a
   reading of characters that are printed on the statement, which is why the
   room may show it before any door has answered and why the suite can hold it
   to a fixture.

   THE RULE THAT SHAPES EVERY FUNCTION BELOW: a period, a unit or a quality is
   returned only where the file PRINTS it. A fiscal year with no end date on the
   page comes back with `endDate: null` rather than a date this module invented,
   because Boom keys its periods on the end date and a guessed one would fork a
   borrower's history. The one derivation allowed is the merge at the end: an
   "FY2025" that carries no date of its own adopts a full date printed elsewhere
   in the same file for the same year.
   ============================================================================= */

import type { PeriodRead, PeriodType, StatementQuality, StatementType } from "./types";

/* ------------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_LABEL = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "December 31, 2025", "Dec. 31 2025", "12/31/2025", "2025-12-31". */
const DATE_SOURCE =
  "(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})" +
  "|(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})" +
  "|(\\d{4})-(\\d{2})-(\\d{2}))";

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2199) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** The ISO day a date match carries, or null where the groups do not form one. */
function dateFrom(m: RegExpMatchArray, at: number): string | null {
  const name = m[at];
  if (name) return iso(Number(m[at + 2]), MONTHS[name.toLowerCase()] ?? 0, Number(m[at + 1]));
  if (m[at + 3]) return iso(Number(m[at + 5]), Number(m[at + 3]), Number(m[at + 4]));
  if (m[at + 6]) return iso(Number(m[at + 6]), Number(m[at + 7]), Number(m[at + 8]));
  return null;
}

const yearOf = (day: string): number => Number(day.slice(0, 4));
const monthOf = (day: string): number => Number(day.slice(5, 7));

/* ----------------------------------------------------------------- the key

   The display key the room prints and the plan carries. It is derived from the
   period type and the end date and from nothing else, so two files that print
   the same period produce the same key and the room can dedupe them.          */

export function periodKey(periodType: PeriodType, endDate: string | null, hintYear?: number, hintQuarter?: number): string {
  const year = endDate ? yearOf(endDate) : hintYear;
  const month = endDate ? monthOf(endDate) : null;
  switch (periodType) {
    case "annual":
      return year ? `FY${year}` : "FY";
    case "quarterly": {
      const q = hintQuarter ?? (month ? Math.ceil(month / 3) : null);
      return q && year ? `Q${q} ${year}` : year ? `Q ${year}` : "Q";
    }
    case "semi_annual":
      if (month === 6 && year) return `H1 ${year}`;
      return month && year ? `6M ${MONTH_LABEL[month]} ${year}` : year ? `6M ${year}` : "6M";
    case "year_to_date":
      return month && year ? `YTD ${MONTH_LABEL[month]} ${year}` : year ? `YTD ${year}` : "YTD";
    case "trailing_twelve_months":
      return month && year ? `TTM ${MONTH_LABEL[month]} ${year}` : "TTM";
    case "monthly":
      return month && year ? `${MONTH_LABEL[month]} ${year}` : "Month";
    default:
      return endDate ?? "unknown period";
  }
}

/* ------------------------------------------------------------- the patterns */

interface Found {
  periodType: PeriodType;
  endDate: string | null;
  key: string;
}

const push = (out: Found[], periodType: PeriodType, endDate: string | null, hintYear?: number, hintQuarter?: number): void => {
  out.push({ periodType, endDate, key: periodKey(periodType, endDate, hintYear, hintQuarter) });
};

/** "year ended December 31, 2025", "six months ended June 30, 2026", and the
 *  rest of the family, each carrying the date it ends on. */
const PHRASES: Array<{ re: RegExp; periodType: PeriodType }> = [
  { re: new RegExp(`(?:fiscal\\s+)?years?\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"), periodType: "annual" },
  // A twelve-month period is a fiscal year UNLESS the file called it trailing:
  // "trailing twelve months ended June 30" is a TTM and is read as one below.
  { re: new RegExp(`(?<!\\b(?:trailing|last)\\s)(?:twelve|12)\\s+months\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"), periodType: "annual" },
  { re: new RegExp(`(?:six|6)\\s+months\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"), periodType: "semi_annual" },
  { re: new RegExp(`(?:three|3)\\s+months\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"), periodType: "quarterly" },
  { re: new RegExp(`(?:nine|9)\\s+months\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"), periodType: "year_to_date" },
  {
    re: new RegExp(`(?:trailing|last)\\s+twelve\\s+months\\s+end(?:ed|ing)\\s+${DATE_SOURCE}`, "gi"),
    periodType: "trailing_twelve_months",
  },
];

/** A full date followed by the comparative years a statement prints beside it:
 *  "December 31, 2025 and 2024". Same month and day, the year it names. */
const COMPARATIVE = new RegExp(`${DATE_SOURCE}\\s+and\\s+(\\d{4})(?:\\s+and\\s+(\\d{4}))?`, "gi");

const FY = /\bFY\s?(\d{4})\b/gi;
const FISCAL_YEAR = /\bfiscal\s+(\d{4})\b/gi;
const QUARTER = /\bQ([1-4])\s*(?:FY\s?)?(\d{4})\b/gi;
const QUARTER_WORD = /\b(first|second|third|fourth)\s+quarter\s+(?:of\s+)?(?:FY\s?)?(\d{4})\b/gi;
const TTM_BARE = /\b(?:TTM|LTM|trailing\s+twelve\s+months|last\s+twelve\s+months)\b/i;
const QUARTER_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };

/** A run of fiscal years used as column headers: "2025 2024 2023". Two or more,
 *  descending or ascending, on one line, with nothing but spacing between them. */
const HEADER_RUN = /(?:^|[\s|])((?:19|20)\d{2})(?:[\s|]+((?:19|20)\d{2}))(?:[\s|]+((?:19|20)\d{2}))?(?:[\s|]+((?:19|20)\d{2}))?(?=[\s|]*$)/gm;

/** Every full date printed anywhere, for the merge that gives a bare FY its day. */
const ANY_DATE = new RegExp(DATE_SOURCE, "gi");

/**
 * THE PERIODS THIS FILE PRINTS, newest first.
 *
 * Deduped on the display key: where the same period is found twice, the reading
 * that carries an end date wins, because that is the one Boom can be keyed on.
 */
export function detectPeriods(text: string): PeriodRead[] {
  if (!text) return [];
  const found: Found[] = [];

  for (const { re, periodType } of PHRASES) {
    for (const m of text.matchAll(re)) {
      const day = dateFrom(m, 1);
      push(found, periodType, day);
    }
  }

  for (const m of text.matchAll(COMPARATIVE)) {
    const day = dateFrom(m, 1);
    if (!day) continue;
    // The date itself is a period, not just the anchor of the years beside it:
    // "Balance Sheets as of December 31, 2025 and 2024" carries both.
    push(found, "annual", day);
    for (const group of [10, 11]) {
      const year = m[group];
      if (!year) continue;
      const sibling = iso(Number(year), monthOf(day), Number(day.slice(8, 10)));
      if (sibling) push(found, "annual", sibling);
    }
  }

  for (const re of [FY, FISCAL_YEAR]) {
    for (const m of text.matchAll(re)) push(found, "annual", null, Number(m[1]));
  }

  for (const m of text.matchAll(QUARTER)) {
    push(found, "quarterly", null, Number(m[2]), Number(m[1]));
  }
  for (const m of text.matchAll(QUARTER_WORD)) {
    push(found, "quarterly", null, Number(m[2]), QUARTER_WORDS[m[1].toLowerCase()]);
  }

  if (TTM_BARE.test(text)) push(found, "trailing_twelve_months", null);

  for (const m of text.matchAll(HEADER_RUN)) {
    const years = [m[1], m[2], m[3], m[4]].filter(Boolean).map(Number);
    // A run is a column header only where the years step by one. Three unrelated
    // four-digit numbers on a line are an address, an invoice or a page of notes.
    const stepped = years.every((y, i) => i === 0 || Math.abs(y - years[i - 1]) === 1);
    if (!stepped) continue;
    for (const y of years) push(found, "annual", null, y);
  }

  // THE ONE DERIVATION: a bare FY adopts a full date printed in the same file
  // for the same year. Nothing is invented; the date is on the page.
  const days = [...text.matchAll(ANY_DATE)].map((m) => dateFrom(m, 1)).filter((d): d is string => Boolean(d));
  for (const f of found) {
    if (f.endDate || f.periodType !== "annual") continue;
    const year = Number(f.key.replace(/\D/g, ""));
    const match = days.find((d) => yearOf(d) === year);
    if (match) f.endDate = match;
  }

  const byKey = new Map<string, Found>();
  for (const f of found) {
    const held = byKey.get(f.key);
    if (!held || (!held.endDate && f.endDate)) byKey.set(f.key, f);
  }

  const rank = (f: Found): string => f.endDate ?? `${f.key.replace(/\D/g, "") || "0000"}-00-00`;
  return [...byKey.values()]
    .sort((a, b) => rank(b).localeCompare(rank(a)))
    .map((f) => ({ key: f.key, endDate: f.endDate, periodType: f.periodType }));
}

/* ------------------------------------------------------------------ units */

const THOUSANDS = /\(?\s*(?:dollars|amounts|\$)?\s*in\s+thousands|\$\s?000(?:'?s)?\b|\bin\s+000(?:'?s)?\b/i;
const MILLIONS = /\(?\s*(?:dollars|amounts|\$)?\s*in\s+millions|\$\s?(?:mm|MM)\b/i;

/**
 * THE SCALE THE STATEMENT IS PRINTED IN, AND WHETHER IT SAID SO.
 *
 * Millions is tested first: a statement that says "in millions, except per
 * share amounts in thousands" is a millions statement. Absent any statement of
 * scale the figures are absolute, which is the only safe default: reading a
 * dollar statement as thousands would overstate a borrower a thousandfold.
 *
 * `stated` is the half the room needs and the multiplier alone cannot carry: a
 * statement that PRINTS its own scale has already answered the question, and
 * asking a banker about it anyway is the wall the golden rule forbids.
 */
export function detectUnitsStatement(text: string): { multiplier: number; stated: boolean } {
  if (MILLIONS.test(text)) return { multiplier: 1_000_000, stated: true };
  if (THOUSANDS.test(text)) return { multiplier: 1_000, stated: true };
  return { multiplier: 1, stated: false };
}

/** The scale alone, for every caller that only spends the multiplier. */
export function detectUnits(text: string): number {
  return detectUnitsStatement(text).multiplier;
}

/** Banker words for a scale. */
export function unitsWord(multiplier: number): string {
  if (multiplier >= 1_000_000) return "millions";
  if (multiplier >= 1_000) return "thousands";
  return "dollars";
}

/* -------------------------------------------------------- statement hints */

const STATEMENT_HINTS: Array<{ type: StatementType; re: RegExp }> = [
  { type: "income_statement", re: /statements?\s+of\s+(?:income|operations|earnings)|income\s+statements?|profit\s+and\s+loss/i },
  { type: "balance_sheet", re: /balance\s+sheets?|statements?\s+of\s+financial\s+position/i },
  { type: "cash_flow_statement", re: /statements?\s+of\s+cash\s+flows?|cash\s+flow\s+statements?/i },
  {
    type: "shareholders_equity",
    re: /statements?\s+of\s+(?:changes\s+in\s+)?(?:stockholders|shareholders|members|partners)[’']?\s*(?:equity|capital)/i,
  },
  { type: "personal_statement", re: /personal\s+financial\s+statement/i },
];

/** Which statements this file announces, in the contract's own enum. An annual
 *  report announces three; a single export announces one. */
export function detectStatementTypes(text: string): StatementType[] {
  return STATEMENT_HINTS.filter((h) => h.re.test(text)).map((h) => h.type);
}

/* ---------------------------------------------------------- quality hints */

/** "Auditor", "Auditors", "Auditor's", "Auditors'". A statement prepared for a
 *  single company titles its report "Independent Auditor's Report" far more
 *  often than not, and a possessive that only reads the PLURAL apostrophe
 *  (`auditors?['’]?`, which is what this carried until 2026-09-12) matches
 *  "Auditors' Report" and misses "Auditor's Report" entirely: the s of the
 *  singular possessive sits where the space belongs. The file then reads as no
 *  report at all and the room asks a banker about words the file prints. */
const possessive = (noun: string): string => `${noun}(?:[’']s|s[’']?)?`;

const QUALITY_HINTS: Array<{ quality: StatementQuality; re: RegExp }> = [
  {
    quality: "cpa_audited",
    re: new RegExp(
      [
        `independent\\s+${possessive("auditor")}\\s+report`,
        `report\\s+of\\s+independent\\s+(?:registered\\s+public\\s+)?(?:certified\\s+public\\s+)?${possessive("accountant")}`,
        `${possessive("auditor")}\\s+report`,
        "we\\s+have\\s+audited",
      ].join("|"),
      "i",
    ),
  },
  {
    quality: "cpa_reviewed",
    re: new RegExp(`(?:${possessive("accountant")}\\s+)?review\\s+report|we\\s+have\\s+reviewed`, "i"),
  },
  { quality: "cpa_compiled", re: /compilation\s+report|we\s+have\s+compiled/i },
  { quality: "internal", re: /prepared\s+by\s+management|management[\s-]prepared|\bunaudited\b|no\s+assurance\s+is\s+provided/i },
];

/** The sentence a hint sits in, clipped, so the room can show the banker the
 *  words the proposal stands on rather than asking them to take it on trust. */
function sentenceAround(text: string, index: number, length: number): string {
  // A LINE BREAK BOUNDS A SENTENCE AS FIRMLY AS A FULL STOP. A statement's own
  // lines carry no punctuation at the end of them, so reading back to the last
  // period walks off the top of the page and the banker is shown the column
  // headers instead of the words the reading stands on.
  const start = Math.max(0, text.lastIndexOf(".", index) + 1, text.lastIndexOf("\n", index) + 1);
  const dot = text.indexOf(".", index + length);
  const line = text.indexOf("\n", index + length);
  let end = dot === -1 ? Math.min(text.length, index + length + 160) : dot + 1;
  if (line !== -1 && line < end) end = line;
  const said = text.slice(start, end).replace(/\s+/g, " ").trim();
  return said.length > 220 ? `${said.slice(0, 217)}...` : said;
}

/**
 * WHAT KIND OF STATEMENT THIS IS, and the words that say so.
 *
 * Precedence runs audited, reviewed, compiled, internal, because an audited
 * annual report also prints "unaudited" over its interim notes and the report
 * that governs the file is the strongest one in it.
 */
export function detectQuality(text: string): { quality: StatementQuality | null; grounding: string | null } {
  for (const hint of QUALITY_HINTS) {
    const m = hint.re.exec(text);
    if (m) return { quality: hint.quality, grounding: sentenceAround(text, m.index, m[0].length) };
  }
  return { quality: null, grounding: null };
}

/* --------------------------------------------------------------- currency */

/** The currency the statement prints, where it names one. USD is the default
 *  and is stated as an assumption rather than a reading. */
export function detectCurrency(text: string): string {
  if (/\bEUR\b|€/.test(text)) return "EUR";
  if (/\bGBP\b|£/.test(text)) return "GBP";
  if (/\bCAD\b|Canadian\s+dollars/i.test(text)) return "CAD";
  return "USD";
}
