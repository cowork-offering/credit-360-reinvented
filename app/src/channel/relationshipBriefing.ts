import { packageRoster } from "../book/packages";
import type { ReadSource } from "../components/workroom/readCard";
import type { RelRoute } from "../components/relationship/relRoute";
import { assetValuation, valuationsOf, type ValuationBook } from "../data/collateralValuation";
import type {
  ActionHistoryRow,
  ActivityEntry,
  BorrowerBundle,
  ClientRequest,
  Collateral,
  Covenant,
  CovenantChallenge,
  Facility,
} from "../data/contract";
import { facilityProduct } from "../data/facilityStage";
import { covenantCushion, fmtCovThreshold, fmtCovVal, fmtRatio } from "../data/finance";
import { fmtDate, fmtMoney, fmtPct } from "../data/format";
import { dayDiff } from "../data/time";
import { isActiveFacility } from "../data/worklist";
import { classifyCovenant } from "../domain/covenantStatus";
import { extractAmounts, matchFacility } from "../actions/mailIntake";
import type { MemoDossier } from "../memo/types";
import { covenantMeasure, covenantNotDerivable } from "../spread/postRead";
import type { MailHit } from "./cockpitTools";
import { buildRelationshipFacts, inFlightRoster } from "./relationshipContext";

/* =============================================================================
   THE BRIEFING: THE ROOM OPENS BY EXPLAINING, NOT BY ASKING.

   FOUNDER, 2026-09-13: "it feels awfully flat and out of touch, like yes ok it
   is a covenant review, but for what. It says there is a covenant test due or a
   collateral valuation, but what does that really mean, what does the room need
   from me and why, and it should pull in information from all sorts of
   information from the relationship."

   A room that says "a covenant test is due" has told the banker the name of the
   ritual and nothing about the credit. This module writes what a credit officer
   would say standing at the desk: what is due and what it TESTS, what it is
   tied to, what has moved on the relationship since it was last tested, what
   the room needs from the banker and why, and what the committee will ask.

   FIVE RULES, AND THEY ARE THE WHOLE MODULE.

   1. IT FORMATS AND CONNECTS; IT NEVER DERIVES A CREDIT FIGURE. Every number is
      printed by the helper the glass prints it with (`fmtMoney`, `fmtCovVal`,
      `fmtCovThreshold`, `fmtRatio`, `classifyCovenant`), and every ratio the org
      computes is READ. Collateral coverage is the org's own `coverageRatio`, per
      the contract's standing rule that the cockpit derives no coverage of its
      own; interest coverage, where it is spoken to, is `spread/coverage.ts`'s one
      definition, reached through `covenantMeasure`.

   2. EVERY FIGURE CARRIES ITS SOURCE AND ITS DATE. A measured value with no
      `measuredSource` and no `measuredAsOf` is a figure a banker cannot defend,
      so the three travel together or none of them is stated.

   3. A GAP IS NAMED AND NEVER FILLED. "The FY2025 compliance certificate is not
      in the inbox" is a sentence the room is allowed to say; inventing the
      certificate is not. An absent lane is a gap, never an empty fact, and an
      inbox nobody loaded is a different gap from an inbox that carries nothing.

   4. NOTHING IS SAID TWICE. A fact that lands in `due` does not come back in
      `changedSince`, and the changes are cut at a budget with the cut NAMED,
      the same contract `channel/deskAsk.ts` holds its context to.

   5. THE COMMITTEE LINES CARRY NO POLICY VERDICT. They fire on conditions the
      figures themselves satisfy and they name the figures that made them fire,
      exactly as `spread/postRead.ts`'s `committeeQuestions` does. This room has
      no policy book, so it has no view on whether a cushion is comfortable.

   ONE CLOCK. `opts.asOf` is `meta.generatedAt` and it is the only clock any
   derivation here reads, including the valuation clock: `data/collateralValuation.ts`
   measures staleness on the reader's real day by design, and a BRIEFING has to be
   reproducible from the snapshot it was built on, so the snapshot instant is
   passed in rather than borrowed from `Date.now()`.

   PURE. No React, no I/O, no tool call. Everything it knows arrives in the
   bundle and in `opts`.
   ============================================================================= */

/** Which part of the relationship a change was read out of. */
export type BriefingLane =
  | "financials"
  | "exposure"
  | "collateral"
  | "trail"
  | "inbox"
  | "signals"
  | "memo"
  | "pipeline";

/** One thing the review is standing on: a covenant, an asset, a grade, a case. */
export interface BriefingItem {
  /** The subject, named as a banker would name it. */
  what: string;
  /** WHAT THIS SUBJECT DOES ON ITS NEXT DATE. A covenant tests again, an asset
   *  is due for revaluation, a grade is next reviewed: one verb per kind, so
   *  the opening sentence reads as a banker would say it rather than calling a
   *  warehouse appraisal a test. */
  dueVerb: string;
  /** What it actually TESTS, in plain words. Empty where the read carries no
   *  vocabulary for it, which is a gap and is named as one. */
  meansSentence: string;
  /** The test, in the covenant's own unit and with its direction ("≥ 1.25×"). */
  threshold: string | null;
  /** The figure measured against it. */
  measured: string | null;
  /** WHERE that figure came from. Never null while `measured` is set. */
  measuredSource: string | null;
  /** WHEN it was struck. Never null while `measured` is set. */
  measuredAsOf: string | null;
  /** The last verdict, in the org's own words through `classifyCovenant`. */
  lastVerdict: string | null;
  /** The next test, with the days to it counted off `asOf`. */
  nextTest: string | null;
  /** The move since the last test, where TWO comparable points exist. Null is
   *  the honest answer on a relationship carrying one measurement. */
  trend: string | null;
  /** The facilities, packages, exposure and coverage this item is tied to. */
  associations: string[];
}

/** One thing that has moved, with the lane it was read out of. */
export interface BriefingChange {
  sentence: string;
  lane: BriefingLane;
  source: string;
}

/** One thing the room needs before it can file, and why it needs it. */
export interface BriefingNeed {
  ask: string;
  why: string;
}

export interface Briefing {
  /** The route the briefing was built for. Null is the neutral opening. */
  route: RelRoute | null;
  /** The one sentence that says what this room is doing and on whom. */
  opening: string;
  due: BriefingItem[];
  changedSince: BriefingChange[];
  needs: BriefingNeed[];
  committee: string[];
  gaps: string[];
}

export interface BriefingOptions {
  /** `meta.generatedAt`. The only clock this module reads. */
  asOf: string;
  /** The durable action trail, where the host holds one. */
  history?: readonly ActionHistoryRow[];
  /** The inbox rows, WHERE THEY WERE LOADED. `undefined` means no search ran,
   *  which is a different gap from an empty array, and both are named. */
  inbox?: readonly MailHit[] | null;
  /** The memo, where one exists for this relationship. */
  memo?: MemoDossier | null;
  /** The package the room is anchored on, where it is anchored on one. */
  productPackageId?: string | null;
}

/* --------------------------------------------------------------- primitives */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * TEXT THIS MODULE DID NOT WRITE, MADE FIT TO SPEAK.
 *
 * Two jobs, one funnel. A long org description is cut at a word so it reads as
 * a clause and not as a paragraph the banker scrolls past. And the EM DASH
 * becomes a spaced hyphen: the trail's summaries and the analysis bodies are
 * agent-composed prose (the contract says so) and org record names carry the
 * character too, the founder's standing style rule bans it on every surface,
 * and a briefing that quotes one prints one. A hyphen rather than a comma so a
 * record name a banker will go and search for still reads as itself, which is
 * the same substitution `channel/relationshipContext.ts` already writes with.
 * Figures, dates and words are untouched; only the punctuation is.
 */
function clip(text: string, cap: number): string {
  const said = text.replace(/\s*[\u2014\u2013]\s*/g, " - ").replace(/\s+/g, " ").trim();
  if (said.length <= cap) return said;
  const cut = said.slice(0, cap);
  const space = cut.lastIndexOf(" ");
  return `${(space > cap / 2 ? cut.slice(0, space) : cut).trim()}...`;
}

/** A date with the days to it counted off the snapshot, in the room's words. */
function whenPhrase(iso: string | null | undefined, asOf: string): string | null {
  if (!iso) return null;
  const days = dayDiff(iso, asOf);
  const date = fmtDate(iso);
  if (days === null) return date;
  if (days === 0) return `${date}, today`;
  if (days > 0) return `${date}, in ${days === 1 ? "1 day" : `${days} days`}`;
  const past = Math.abs(days);
  return `${date}, ${past === 1 ? "1 day" : `${past} days`} ago`;
}

const list = (items: string[]): string => items.join("; ");

/** "a, b and c". Used where the items are a list a banker reads aloud. */
const and = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** "an 80% advance rate", "a 75% advance rate". The article is decided by how
 *  the figure is SAID, not by how it is spelled, which is why it cannot be a
 *  vowel test on the first character. */
const article = (n: number): string => (/^(8|11$|11\D|18$|18\D)/.test(String(n)) ? "an" : "a");

/** A clause the ORG ended itself keeps its own full stop; one this module wrote
 *  gets one. Two full stops in a row is the only thing this is guarding. */
const stop = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/* ----------------------------------------------------------- the vocabulary

   WHAT A COVENANT ACTUALLY TESTS. The read carries a type name and two numbers
   and nothing that says what the test is FOR, which is the exact hole the
   founder put his finger in. This is the covenant vocabulary, matched on the
   type name the org wrote, and a type that matches nothing gets NO sentence and
   a named gap: a made-up description of a test the bank enforces is worse than
   silence. Order matters, because "Debt Service Coverage with and without
   Distributions" is a debt service test and not a distributions cap.           */

const COVENANT_MEANING: Array<[RegExp, string]> = [
  [
    /debt\s*service|dscr|fixed\s*charge/i,
    "It measures the cash the business generates against the principal and interest falling due in the period, so it is the test of whether the borrower services this debt out of its own operations.",
  ],
  [
    /interest\s*coverage|times\s*interest/i,
    "It measures operating profit against interest expense, so it is the test of whether earnings carry the cost of the debt before any principal is repaid.",
  ],
  [
    /debt\s*[-\s]*to\s*[-\s]*(?:net\s*)?worth|liabilities\s*to\s*(?:net\s*)?worth/i,
    "It measures total liabilities against equity, so it is the test of how much the balance sheet owes for every dollar the owners have left in the business.",
  ],
  [
    /leverage|debt\s*(?:to|\/)\s*ebitda|funded\s*debt/i,
    "It measures total bank debt against EBITDA, so it is the test of how many years of current earnings the debt represents.",
  ],
  [
    /tangible\s*net\s*worth|net\s*worth|minimum\s*equity/i,
    "It sets a floor under equity, so it is the test of how much of the balance sheet the owners have to keep behind the bank.",
  ],
  [
    /liquidity|minimum\s*cash/i,
    "It sets a floor under cash and equivalents, so it is the test of whether the borrower can absorb a shock without coming to the bank for it.",
  ],
  [
    /current\s*ratio|working\s*capital/i,
    "It measures current assets against current liabilities, so it is the test of whether the next year of obligations is covered by the next year of assets.",
  ],
  [
    /accounts?\s*receivable|receivables?|borrowing\s*base|advance\s*rate/i,
    "It caps the share of eligible receivables the facility may be advanced against, so it is the test that keeps the drawn balance inside the collateral securing it.",
  ],
  [
    /inventory/i,
    "It caps the share of eligible inventory the facility may be advanced against, so it is the test that keeps the drawn balance inside the collateral securing it.",
  ],
  [
    /loan\s*[-\s]*to\s*[-\s]*value|ltv/i,
    "It measures the balance against the value of the security behind it, so it is the test of how much of the asset the bank is lending.",
  ],
  [
    /capital\s*expenditure|capex|fixed\s*asset/i,
    "It caps what the borrower may spend on fixed assets in the period, so it is the test that keeps cash from leaving the business into the balance sheet faster than the credit assumed.",
  ],
  [
    /distribution|dividend/i,
    "It caps what the borrower may pay out to its owners in the period, so it is the test that keeps earnings inside the business while the debt is outstanding.",
  ],
];

/** What this covenant tests, or "" where the vocabulary does not reach it. */
export function covenantMeaning(type: string | undefined): string {
  const name = clean(type);
  if (!name) return "";
  return COVENANT_MEANING.find(([rx]) => rx.test(name))?.[1] ?? "";
}

/** WHAT A BASIS OF VALUE MEANS. `LLC_BI__Type__c` is a picklist and the three
 *  words on it are three different numbers for one asset, which is the fact a
 *  banker ordering a valuation has to hold. Unmatched is a gap, as above. */
const VALUATION_BASIS: Array<[RegExp, string]> = [
  [/orderly\s*liquidation/i, "An orderly liquidation value is what a managed sale would realise: below fair market and above a forced sale."],
  [/fair\s*market/i, "A fair market value is what a willing buyer would pay for it in an open sale."],
  [/balance\s*sheet/i, "A balance sheet value is the borrower's own reported figure for it, not what a sale would realise."],
  [/book\s*value/i, "A book value is what the borrower's own ledger carries it at, not what a sale would realise."],
  [/forced|auction/i, "A forced sale value is what a time-limited sale would realise."],
];

export function valuationBasisMeaning(type: string | null | undefined): string {
  const said = clean(type);
  if (!said) return "";
  return VALUATION_BASIS.find(([rx]) => rx.test(said))?.[1] ?? "";
}

/* --------------------------------------------------------------- the reads */

/** The active facilities, scoped the way every other room surface scopes them. */
function scoped(bundle: BorrowerBundle | null | undefined, productPackageId: string | null): Facility[] {
  return (bundle?.exposure?.facilities ?? [])
    .filter(isActiveFacility)
    .filter((f) => !productPackageId || f.productPackageId === productPackageId);
}

/** THE FACILITY, NAMED SO TWO OF THEM CANNOT BE CONFUSED. This package carries
 *  three Equipment loans and two Lines of Credit, so a bare product word names
 *  any of them; the commitment is what tells them apart, exactly as
 *  `channel/relationshipContext.ts` tells them apart. */
function facilityName(f: Facility, relationship: string, among: readonly Facility[]): string {
  const product = facilityProduct(f, relationship) || "Facility";
  const twins = among.filter((m) => (facilityProduct(m, relationship) || "Facility") === product).length > 1;
  return twins && isNum(f.committed) ? `${product} at ${fmtMoney(f.committed)}` : product;
}

/** The facility, with the exposure and the coverage that hang off it. The
 *  commitment rides inside the figures, so this form needs no disambiguator. */
function facilityAssociation(f: Facility, relationship: string): string {
  const figures = [
    isNum(f.committed) ? `${fmtMoney(f.committed)} committed` : null,
    isNum(f.outstanding) ? `${fmtMoney(f.outstanding)} drawn` : null,
    isNum(f.coverageRatio) ? `coverage ${fmtRatio(f.coverageRatio)}` : clip(clean(f.coverageNote), 120) || null,
  ].filter(Boolean);
  const name = facilityProduct(f, relationship) || "Facility";
  return figures.length ? `the ${name} (${figures.join(", ")})` : `the ${name}`;
}

/** The packages those facilities hang off, SHOWN and never used as a filter
 *  (backlog row 49: the anchor is the account). */
function packageAssociations(
  bundle: BorrowerBundle | null | undefined,
  history: readonly ActionHistoryRow[] | undefined,
  ids: ReadonlySet<string>,
): string[] {
  return packageRoster(bundle, history)
    .filter((p) => ids.has(p.id))
    .map((p) => `the ${p.name} (${p.line})`);
}

/** The Boom period the ratio set belongs to, and the file it was spread from.
 *  `ratios.asOf` leads; where the normalised block carries none, the period the
 *  ratios' own revenue was struck on names it, which is the same binding
 *  `client-360/render/boom-normalise.mjs` documents. */
function boomPeriod(bundle: BorrowerBundle | null | undefined): { label: string | null; source: string } {
  const boom = bundle?.boom;
  const file = clean(boom?.spread?.sourceFile);
  const source = file ? `Boom, ${file}` : "Boom";
  const asOf = clean(boom?.ratios?.asOf);
  const revenue = boom?.ratios?.revenue;
  const named = isNum(revenue) ? (boom?.spread?.periods ?? []).find((p) => p.revenue === revenue)?.period : undefined;
  return { label: clean(named) || (asOf ? fmtDate(asOf) : null), source };
}

/** The Boom figure that measures this covenant, or null. Only the two ratios
 *  the normalised set actually carries: a covenant whose measure Boom does not
 *  publish has no second point and says so by having no trend. */
function boomMeasureFor(covenant: Covenant, bundle: BorrowerBundle | null | undefined): number | null {
  const measure = covenantMeasure(clean(covenant.covenantType));
  if (!measure) return null;
  const ratios = bundle?.boom?.ratios;
  if (measure.key === "leverage" && isNum(ratios?.totalLeverage)) return ratios.totalLeverage;
  if (measure.key === "interestCoverage" && isNum(ratios?.interestCoverage)) return ratios.interestCoverage;
  return null;
}

/** The assembler's own effective challenge, where the bundle carries one. It is
 *  the purpose-built second point: Boom's figure for this covenant, with the
 *  period it was struck on. */
function challengeFor(covenant: Covenant, bundle: BorrowerBundle | null | undefined): CovenantChallenge | null {
  const id = clean(covenant.covenantId);
  if (!id) return null;
  return (bundle?.covenantChallenge ?? []).find((c) => clean(c.covenantId) === id) ?? null;
}

/**
 * THE MOVE SINCE THE LAST TEST, where two comparable points exist.
 *
 * The first point is nCino's own last evaluation; the second is the newer
 * measurement of the SAME thing, from the assembler's effective challenge where
 * the bundle carries one and from Boom's ratio set otherwise. `covenantMeasure`
 * is what guarantees the two measure the same thing: a leverage covenant is
 * compared to Boom's leverage and never to a ratio that merely reads like it.
 *
 * The cushion is the sentence, not the raw delta, because a covenant moving
 * toward its threshold and a covenant moving away from it are the same
 * arithmetic and opposite credits.
 */
function covenantTrend(covenant: Covenant, bundle: BorrowerBundle | null | undefined): string | null {
  const then = covenant.actualValue;
  if (!isNum(then)) return null;
  const challenge = challengeFor(covenant, bundle);
  const period = boomPeriod(bundle);
  const now = isNum(challenge?.boomImplied?.value) ? challenge.boomImplied.value : boomMeasureFor(covenant, bundle);
  if (!isNum(now)) return null;
  const label = clean(challenge?.boomImplied?.period) || period.label;
  const type = covenant.covenantType;
  const where = label ? `the ${label} spread ${period.source} holds` : `${period.source} holds`;
  const moved = `The last test read ${fmtCovVal(then, type)} and ${where} ${fmtCovVal(now, type)}`;
  const threshold = covenant.thresholdValue;
  if (!isNum(threshold)) return `${moved}.`;
  const before = covenantCushion(type, then, threshold).cushion;
  const after = covenantCushion(type, now, threshold).cushion;
  if (before === null || after === null) return `${moved}.`;
  const delta = Math.abs(after - before);
  const word = after < before ? "thinned" : after > before ? "widened" : "held";
  const by = word === "held" ? "" : ` by ${fmtCovVal(delta, type)}`;
  return `${moved}, so the cushion has ${word}${by}.`;
}

/* ------------------------------------------------------------- the due items */

function covenantItems(
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
  relationship: string,
): BriefingItem[] {
  const covenants = bundle?.covenants?.covenants ?? [];
  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const byLoan = new Map(facilities.map((f) => [clean(f.loanId), f]));
  /* ONE MEANING, SAID ONCE. Two of Hartwell's six covenants are debt service
     tests, and printing the same explanation under both is the room saying one
     thing twice. The second points at the first instead, which is also the
     truer sentence: they measure the same thing on different thresholds. */
  const explained = new Map<string, string>();

  return covenants.map((c) => {
    const type = clean(c.covenantType) || "Covenant";
    const verdict = classifyCovenant(c);
    const attached = (c.attachedLoans ?? [])
      .map((a) => byLoan.get(clean(a.loanId)))
      .filter((f): f is Facility => Boolean(f));
    const packageIds = new Set(attached.map((f) => clean(f.productPackageId)).filter(Boolean));
    const associations: string[] = [];
    if (attached.length) {
      for (const f of attached) associations.push(facilityAssociation(f, relationship));
      associations.push(...packageAssociations(bundle, opts.history, packageIds));
    } else {
      /* AN ACCOUNT-LEVEL COVENANT IS NOT AN UNATTACHED ONE. An empty
         `attachedLoans` is the org saying the test runs on the relationship;
         an ABSENT one is the read not carrying the field, and the two are
         different facts (see the contract's note on the field). */
      const said = c.attachedLoans
        ? `the relationship as a whole, ${facilities.length} active ${facilities.length === 1 ? "facility" : "facilities"}`
        : "a scope this read does not carry, because it stages no attachment for this covenant";
      associations.push(said);
      if (c.attachedLoans) {
        associations.push(...packageAssociations(bundle, opts.history, new Set(facilities.map((f) => clean(f.productPackageId)).filter(Boolean))));
      }
    }

    const measured = isNum(c.actualValue) ? fmtCovVal(c.actualValue, type) : null;
    const evaluatedOn = clean(c.lastEvaluationDate);
    const compliance = clean(c.latestComplianceStatus);
    const meaning = covenantMeaning(type);
    const saidBy = meaning ? explained.get(meaning) : undefined;
    const means = !meaning ? "" : saidBy ? `It measures what the ${saidBy} covenant measures, against its own threshold and on its own facility.` : meaning;
    if (meaning && !saidBy) explained.set(meaning, type);
    return {
      what: `The ${type} covenant`,
      dueVerb: "tests again",
      meansSentence: means,
      threshold: isNum(c.thresholdValue) ? fmtCovThreshold(type, c.actualValue, c.thresholdValue) : null,
      measured,
      measuredSource: measured ? "nCino's own evaluation on the compliance row" : null,
      measuredAsOf: measured ? (evaluatedOn ? fmtDate(evaluatedOn) : null) : null,
      /* THE COMPLIANCE ROW IS NAMED ONLY WHERE IT IS THE FACT THAT MATTERS.
         Every row on this book reads Pending, so saying so six times is six
         sentences carrying one fact; saying it on the row whose date has
         already passed is the sentence a banker acts on. */
      lastVerdict:
        measured || clean(c.lastEvaluationStatus)
          ? `The org records it ${verdict.label}${compliance && (dayDiff(c.nextEvaluationDate, opts.asOf) ?? 1) < 0 ? `, on a compliance row it still holds ${compliance} as at ${fmtDate(opts.asOf)}` : ""}`
          : null,
      nextTest: whenPhrase(c.nextEvaluationDate, opts.asOf),
      trend: covenantTrend(c, bundle),
      associations,
    };
  });
}

/** Every distinct collateral record behind the relationship, with the pledges
 *  that reach it. A cross-pledged asset is ONE item carrying several pledges,
 *  never one item per pledge: that repetition is the double count the exposure
 *  contract warns about and it would also say the same asset four times. */
function collateralItems(
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
  relationship: string,
): BriefingItem[] {
  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const book = valuationsOf(bundle);
  const now = Date.parse(opts.asOf);
  const seen = new Map<string, { pledge: Collateral; on: Facility[] }>();
  for (const f of facilities) {
    for (const c of f.collateral ?? []) {
      const key = clean(c.collateralId) || clean(c.collateralName) || clean(c.collateralDescription);
      if (!key) continue;
      const held = seen.get(key);
      if (held) held.on.push(f);
      else seen.set(key, { pledge: c, on: [f] });
    }
  }

  return [...seen.values()].map(({ pledge, on }) => {
    const name = clean(pledge.collateralName) || clean(pledge.collateralType) || "Collateral";
    const described = clean(pledge.collateralDescription);
    const valuation = assetValuation(pledge, book, Number.isNaN(now) ? undefined : now);
    const row = book.get(clean(pledge.collateralId));
    /* THE BASIS IS READ OFF `LLC_BI__Type__c` AND NOTHING ELSE. `method` joins
       the basis to its SOURCE ("Balance Sheet, Receivables Aging"), and a
       vocabulary matched against the joined string would describe an appraisal
       by the name of the report that carried it. */
    const basis = valuationBasisMeaning(row?.valuationType);
    const packageIds = new Set(on.map((f) => clean(f.productPackageId)).filter(Boolean));
    const associations = [
      ...on.map((f) => facilityAssociation(f, relationship)),
      ...packageAssociations(bundle, opts.history, packageIds),
    ];
    const lendable = isNum(pledge.currentLendableValue) ? fmtMoney(pledge.currentLendableValue) : null;
    /* THE ORG'S OWN DESCRIPTION, CUT AT ITS FIRST SENTENCE. The lien language
       runs to a paragraph and the briefing is read in one breath; the tab
       carries the rest verbatim. */
    const first = described ? clip((described.split(/(?<=[.!?])\s/)[0] ?? described).replace(/[.]$/, ""), 150) : "";
    return {
      what: `${name}${clean(pledge.collateralType) ? `, ${clean(pledge.collateralType)}` : ""}`,
      dueVerb: "is due for revaluation",
      /* THE ORG'S OWN WORDS, IN THE ORG'S OWN CASE. Lower-casing the first
         letter to splice it into a sentence turned "TEST SHOWCASE" into "tEST
         SHOWCASE" and "Zeiss" into "zeiss", so the description is QUOTED
         instead of spliced. */
      meansSentence: [first ? `The org describes it as "${first}".` : "", basis].filter(Boolean).join(" "),
      threshold: isNum(pledge.advanceRate)
        ? `${article(pledge.advanceRate)} ${pledge.advanceRate}% advance rate${clean(pledge.advanceRateSource) ? `, ${clean(pledge.advanceRateSource).toLowerCase()}` : ""}`
        : null,
      measured: lendable ? `${lendable} of lendable value` : null,
      measuredSource: lendable ? "Customer360Exposure" : null,
      measuredAsOf: lendable ? (valuation.lastValued ?? null) : null,
      lastVerdict: valuation.lastValued
        ? `Last valued ${valuation.lastValued}${valuation.value ? ` at ${valuation.value}` : ""}${row?.valuationType ? ` on a ${clean(row.valuationType)} basis` : ""}${row?.valuationSource ? ` from ${clean(row.valuationSource)}` : ""}${valuation.name ? `, ${valuation.name}` : ""}`
        : "No valuation is on file for it, which means no read looked and never that it was never valued",
      nextTest: valuation.nextDue
        ? `${valuation.nextDue}${valuation.nextDueDerived ? ", worked out from the cycle rather than read" : ""}${valuation.overdue ? ", which has passed" : ""}`
        : null,
      trend: null,
      associations,
    };
  });
}

/** The grade, and what the read says about it. The cockpit computes no grade of
 *  its own (contract: `computedRiskRating` is rendered only where the org
 *  stages one), so the item states the org's and nothing more. */
function gradeItem(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions, relationship: string): BriefingItem[] {
  const snapshot = bundle?.snapshot;
  if (!snapshot) return [];
  const reviews = snapshot as { nextReviewDate?: string; lastReviewDate?: string };
  const current = clean(snapshot.primaryRiskRating);
  const computed = clean(snapshot.computedRiskRating);
  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const graded = facilities.filter((f) => clean(f.riskGrade));
  const distinct = [...new Set(graded.map((f) => clean(f.riskGrade)))];
  const associations: string[] = [];
  if (distinct.length) {
    associations.push(
      distinct.length === 1
        ? `${graded.length} of ${facilities.length} facilities, every one of them graded ${distinct[0]}`
        : `${graded.length} of ${facilities.length} facilities, graded ${distinct.join(", ")}`,
    );
  }
  associations.push(...packageAssociations(bundle, opts.history, new Set(facilities.map((f) => clean(f.productPackageId)).filter(Boolean))));
  return [
    {
      what: `The risk grade on ${relationship}`,
      dueVerb: "is next reviewed",
      meansSentence:
        "It is the grade nCino carries on the relationship. This room reads it and files the one you decide; it computes no grade of its own.",
      threshold: null,
      measured: current || null,
      measuredSource: current ? "The nCino risk grade on Customer360Snapshot" : null,
      measuredAsOf: current ? (reviews.lastReviewDate ? fmtDate(reviews.lastReviewDate) : null) : null,
      lastVerdict: reviews.lastReviewDate ? `The org last reviewed it ${fmtDate(reviews.lastReviewDate)}` : null,
      nextTest: whenPhrase(reviews.nextReviewDate, opts.asOf),
      trend: computed && computed !== current ? `The org's computed grade reads ${computed} against the ${current} it carries.` : null,
      associations,
    },
  ];
}

function reviewItem(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions, relationship: string): BriefingItem[] {
  const snapshot = bundle?.snapshot;
  if (!snapshot) return [];
  const reviews = snapshot as { nextReviewDate?: string; lastReviewDate?: string };
  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const committed = bundle?.exposure?.totalCommitted;
  const covenants = bundle?.covenants?.covenants ?? [];
  const associations: string[] = [
    `${facilities.length} active ${facilities.length === 1 ? "facility" : "facilities"} and ${covenants.length} ${covenants.length === 1 ? "covenant" : "covenants"}`,
    ...packageAssociations(bundle, opts.history, new Set(facilities.map((f) => clean(f.productPackageId)).filter(Boolean))),
  ];
  return [
    {
      what: `The annual review of ${relationship}`,
      dueVerb: "falls due",
      meansSentence:
        "It is the periodic look at the whole relationship: the year's financials, the exposure, every covenant on the book, the security behind it and the grade that follows from all four.",
      threshold: null,
      measured: isNum(committed) ? `${fmtMoney(committed)} committed` : null,
      measuredSource: isNum(committed) ? "Customer360Exposure" : null,
      measuredAsOf: isNum(committed) ? fmtDate(opts.asOf) : null,
      lastVerdict: reviews.lastReviewDate ? `The org last reviewed it ${fmtDate(reviews.lastReviewDate)}` : null,
      nextTest: whenPhrase(reviews.nextReviewDate, opts.asOf),
      trend: null,
      associations,
    },
  ];
}

/** What is open on the relationship: the client's own asks, off the requests
 *  seam and off the inbound rows on the trail. */
function serviceItems(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions, relationship: string): BriefingItem[] {
  const requests: ClientRequest[] = [...(bundle?.requests ?? [])];
  const inbound = (bundle?.activity ?? []).filter((a) => a.kind === "REQUEST_RECEIVED");
  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const items: BriefingItem[] = requests.map((r) => {
    const ask = r.ask;
    const named = clean(ask?.facilityName);
    /* THE COCKPIT'S ONE MATCHER, not a second one. `actions/mailIntake.ts`
       already resolves a client's words to a real facility on this book, by the
       product word and by how close a stated figure is to a commitment, and it
       returns NOTHING where naming one of several would be a guess. */
    const text = [clean(r.summary), named].filter(Boolean).join(" ");
    const facility = text ? matchFacility(text, bundle ?? null, extractAmounts(text)) : null;
    return {
      what: `The client's ${clean(r.channel) || "message"} on this relationship`,
      dueVerb: "arrived",
      meansSentence:
        "It is what the client asked for, in their own words. A service request records the ask and routes it; it moves no money and changes no term.",
      threshold: null,
      measured: isNum(ask?.to)
        ? `${fmtMoney(ask.to)} asked for${isNum(ask?.from) ? `, against the ${fmtMoney(ask.from)} the client says is committed today` : ""}`
        : null,
      measuredSource: isNum(ask?.to) ? "The client's own message, as the intake read it," : null,
      measuredAsOf: isNum(ask?.to) ? (r.receivedAt ? fmtDate(r.receivedAt) : null) : null,
      lastVerdict: clip(clean(r.summary), 220) || (clean(r.status) ? `The org records it ${clean(r.status)}` : null),
      nextTest: whenPhrase(r.receivedAt, opts.asOf),
      trend: null,
      associations: facility
        ? [facilityAssociation(facility, relationship), ...packageAssociations(bundle, opts.history, new Set([clean(facility.productPackageId)]))]
        : [named ? `${named}, which no active facility on this read matches` : "no facility the read can match to the ask"],
    };
  });
  /* ONE MESSAGE, ONE ITEM. The requests seam and the trail carry the SAME
     inbound email on this book, keyed by the same `reference.id`, so listing
     both would put one client ask in front of the banker twice. */
  const carried = new Set(requests.map((r) => clean(r.reference?.id)).filter(Boolean));
  for (const entry of inbound) {
    if (carried.has(clean(entry.reference?.id))) continue;
    items.push({
      what: `The inbound message "${clip(clean(entry.title) || "Client message", 72)}"`,
      dueVerb: "arrived",
      meansSentence:
        "It is an inbound message on the trail. A service request records what the client asked for and routes it; it moves no money and changes no term.",
      threshold: null,
      measured: null,
      measuredSource: null,
      measuredAsOf: null,
      lastVerdict: clip(clean(entry.summary), 200) || null,
      nextTest: whenPhrase(entry.ts, opts.asOf),
      trend: null,
      associations: [`the relationship, ${facilities.length} active ${facilities.length === 1 ? "facility" : "facilities"}`],
    });
  }
  return items;
}

/**
 * THE NEUTRAL OPENING: WHAT IS DUE SOONEST, ACROSS EVERY CLOCK THE READ HOLDS.
 *
 * The room without a route is not the room with nothing to say. Four clocks run
 * on a relationship and all four are on the bundle: the next covenant test, the
 * next maturity, the next revaluation and the next annual review. The one that
 * comes first is the one the banker is about to be asked about.
 */
function openingItems(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions, relationship: string): BriefingItem[] {
  const dated = <T,>(rows: T[], at: (row: T) => string | null | undefined): T[] =>
    rows.filter((r) => dayDiff(at(r), opts.asOf) !== null).sort((a, b) => (dayDiff(at(a), opts.asOf) ?? 0) - (dayDiff(at(b), opts.asOf) ?? 0));

  const items: BriefingItem[] = [];
  const soonest = dated([...(bundle?.covenants?.covenants ?? [])], (c) => c.nextEvaluationDate)[0];
  if (soonest) {
    const named = covenantItems(bundle, opts, relationship).find((i) => i.what.includes(clean(soonest.covenantType)));
    if (named) items.push(named);
  }

  const facilities = scoped(bundle, opts.productPackageId ?? null);
  const maturing = dated([...facilities], (f) => f.maturityDate)[0];
  if (maturing) {
    items.push({
      what: `${facilityName(maturing, relationship, facilities)}, the next maturity on the relationship`,
      dueVerb: "matures",
      meansSentence:
        "A maturing facility is either renewed, repaid or extended, and the decision is the bank's to make before the date, not on it.",
      threshold: null,
      measured: isNum(maturing.outstanding) ? `${fmtMoney(maturing.outstanding)} drawn` : null,
      measuredSource: isNum(maturing.outstanding) ? "The facility's principal balance on Customer360Exposure" : null,
      measuredAsOf: isNum(maturing.outstanding) ? fmtDate(opts.asOf) : null,
      lastVerdict: clean(maturing.stage) ? `nCino stages it ${clean(maturing.stage)}` : null,
      nextTest: whenPhrase(maturing.maturityDate, opts.asOf),
      trend: null,
      associations: [
        facilityAssociation(maturing, relationship),
        ...packageAssociations(bundle, opts.history, new Set([clean(maturing.productPackageId)])),
      ],
    });
  }
  return items;
}

/* ------------------------------------------------------------ what changed */

/** The date the route measures "since" from, or null where the route has none.
 *  Undated lanes are stated as they stand and carry their own source instead. */
function sinceOf(route: RelRoute | null, bundle: BorrowerBundle | null | undefined): string | null {
  const snapshot = bundle?.snapshot as { lastReviewDate?: string } | undefined;
  if (route === "covenant") {
    const dates = (bundle?.covenants?.covenants ?? []).map((c) => clean(c.lastEvaluationDate)).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }
  if (route === "valuation") {
    const dates = (bundle?.collateralValuations ?? []).map((v) => clean(v.valuationDate)).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }
  if (route === "annual" || route === "rating") return clean(snapshot?.lastReviewDate) || null;
  if (route === "service") {
    const dates = (bundle?.requests ?? []).map((r) => clean(r.receivedAt)).filter(Boolean).sort();
    return dates.length ? dates[0] : null;
  }
  return null;
}

/** Words that make an inbox row about the financials or the covenants. Nothing
 *  else travels: the mailbox is the viewer's, and a briefing is not a reason to
 *  read out a message that has nothing to do with the credit. */
const INBOX_TERMS =
  /covenant|compliance\s*certificate|certificate\s*of\s*compliance|financial\s*statement|financials|audited|spread|borrowing\s*base|aging|appraisal|valuation|waiver|default/i;

function changeLanes(
  route: RelRoute | null,
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
  src: ReadSource,
  since: string | null,
): BriefingChange[] {
  const out: BriefingChange[] = [];
  const facts = buildRelationshipFacts(src);
  const after = (iso: string | null | undefined): boolean => {
    if (!since) return true;
    const d = dayDiff(iso, since);
    return d === null ? false : d >= 0;
  };
  const add = (sentence: string, lane: BriefingLane, source: string) => out.push({ sentence, lane, source });

  /* THE FINANCIALS. The spread is the lane that moves fastest and the only one
     carrying three points, so the direction is stated rather than the level. */
  const boom = bundle?.boom;
  const period = boomPeriod(bundle);
  const periods = (boom?.spread?.periods ?? []).filter((p) => clean(p.period) && isNum(p.revenue));
  if (periods.length >= 2) {
    const steps: string[] = [];
    for (let i = 1; i < periods.length; i += 1) {
      const before = periods[i - 1].revenue as number;
      const now = periods[i].revenue as number;
      const move = before === 0 ? 0 : ((now - before) / Math.abs(before)) * 100;
      steps.push(Math.abs(move) < 0.05 ? "level" : `${move > 0 ? "up" : "down"} ${fmtPct(Math.abs(move))}`);
    }
    add(
      `Revenue reads ${periods.map((p) => `${p.period} ${fmtMoney(p.revenue as number)}`).join(", ")}, ${steps.join(" then ")}.`,
      "financials",
      period.source,
    );
  }
  /* THE MARGIN AND THE TWO RATIOS IN ONE SENTENCE. Three separate lines about
     one spread is the duplication the founder read as flat; what a committee
     asks for is the direction and the two tests in the same breath. */
  const margins = (boom?.spread?.periods ?? []).filter((p) => isNum(p.margin) && clean(p.period));
  const ratios = boom?.ratios;
  const marginSaid = (() => {
    if (margins.length < 2) return isNum(ratios?.ebitdaMargin) ? `EBITDA margin ${fmtPct(ratios.ebitdaMargin)}` : null;
    const last = margins[margins.length - 1];
    const prior = margins[margins.length - 2];
    const points = (last.margin as number) - (prior.margin as number);
    const moved = Math.abs(points) < 0.05 ? "level with it" : `${points > 0 ? "up" : "down"} ${Math.abs(points).toFixed(1)} points`;
    /* THE PERIOD IS NAMED ONCE. The sentence already opens on the ratio set's
       own period, so repeating it on the margin reads as two periods. */
    const on = clean(last.period) === period.label ? "" : ` on ${last.period}`;
    return `EBITDA margin ${fmtPct(last.margin)}${on} against ${fmtPct(prior.margin)} on ${prior.period}, ${moved}`;
  })();
  const ratioSaid = [
    isNum(ratios?.totalLeverage) ? `total leverage ${fmtRatio(ratios.totalLeverage)}` : null,
    isNum(ratios?.interestCoverage) ? `interest coverage ${fmtRatio(ratios.interestCoverage)}, operating profit over interest expense` : null,
  ].filter(Boolean) as string[];
  if (marginSaid || ratioSaid.length) {
    add(
      `For ${period.label ?? "the newest period it spread"} Boom reads ${[marginSaid, ...ratioSaid].filter(Boolean).join(", ")}.`,
      "financials",
      period.source,
    );
  }

  /* THE EXPOSURE. One sum, printed by the one builder, with the scope on it. */
  if (facts?.exposure) {
    add(
      `nCino carries ${facts.exposure.committed} committed and ${facts.exposure.drawn} drawn across ${facts.exposure.facilities} active facilities ${facts.exposure.scope}, ${facts.exposure.available} available, read at ${fmtDate(opts.asOf)}.`,
      "exposure",
      "Customer360Exposure",
    );
  }
  const inScope = scoped(bundle, opts.productPackageId ?? null);
  const unbooked = inScope.filter((f) => clean(f.stage) && clean(f.stage) !== "Booked");
  if (unbooked.length) {
    add(
      `${unbooked.length === 1 ? "One facility is" : `${unbooked.length} facilities are`} staged short of Booked: ${unbooked
        .map((f) => `${facilityName(f, src.accountName, inScope)}, staged ${clean(f.stage)}`)
        .join("; ")}.`,
      "exposure",
      "Customer360Exposure, LLC_BI__Stage__c",
    );
  }

  /* THE SECURITY. The org's own relationship coverage, never a sum of the
     facility shares, which double-counts every cross-pledged asset. */
  const exposure = bundle?.exposure;
  if (isNum(exposure?.totalUniqueCollateralLendableValue)) {
    add(
      `The distinct collateral behind the relationship carries ${fmtMoney(exposure.totalUniqueCollateralLendableValue)} of lendable value across ${exposure.uniqueCollateralCount ?? "an uncounted number of"} records, and nCino computes relationship coverage at ${isNum(exposure.coverageRatio) ? fmtRatio(exposure.coverageRatio) : "no ratio it will state"}.`,
      "collateral",
      "Customer360Exposure",
    );
  }
  const short = inScope.filter((f) => f.coverageShortfall === true);
  if (short.length) {
    add(
      `${short.length === 1 ? "One facility carries" : `${short.length} facilities carry`} the org's own coverage shortfall flag: ${short
        .map((f) => `${facilityName(f, src.accountName, inScope)} at ${isNum(f.coverageRatio) ? fmtRatio(f.coverageRatio) : "a ratio the org does not state"}`)
        .join("; ")}.`,
      "collateral",
      "Customer360Exposure, the per-facility shortfall flag",
    );
  }
  const overdueValuations = overdueAssets(bundle, opts);
  if (overdueValuations.length) {
    add(
      `${overdueValuations.length === 1 ? "One valuation is" : `${overdueValuations.length} valuations are`} past their next revaluation date: ${overdueValuations.join(", ")}.`,
      "collateral",
      "LLC_BI__Collateral_Valuation__c, read beside the exposure",
    );
  }

  /* THE TRAIL. What this cockpit has already filed, and the version sitting
     unbooked with the org where the roster names one. */
  for (const row of inFlightRoster(src)) {
    add(
      `A version of ${row.packageName} is in flight with the org${row.version ? `, ${row.version}` : ""}${row.reason ? `: ${row.reason}` : ""}.`,
      "trail",
      "the package roster over the exposure read",
    );
  }
  const filed = [...(opts.history ?? [])].filter((r) => clean(r.summary) && after(r.executedAt ?? r.createdDate)).slice(0, 6);
  for (const row of filed) {
    add(
      `Filed ${row.executedAt ? fmtDate(row.executedAt) : "on a date the trail does not carry"}: ${clip(clean(row.summary), 150)}${clean(row.status) ? ` (${clean(row.status)})` : ""}.`,
      "trail",
      "Customer360ActionHistory",
    );
  }
  const said = new Set(filed.map((r) => clean(r.summary).toLowerCase()));
  const events = (bundle?.activity ?? [])
    .filter((a: ActivityEntry) => a.kind !== "REQUEST_RECEIVED" && clean(a.title) && after(a.ts))
    .filter((a) => !said.has(clean(a.summary).toLowerCase()))
    .slice(0, 6);
  for (const entry of events) {
    add(
      `${fmtDate(entry.ts)}: ${clip(clean(entry.title), 120)}${clean(entry.summary) ? `. ${clip(clean(entry.summary), 150)}` : "."}`,
      "trail",
      entry.orgConfirmed ? "the org's own action trail" : "the relationship activity trail",
    );
  }

  /* THE INBOX, where one was loaded, and only the rows about this credit. */
  for (const hit of (opts.inbox ?? []).filter((h) => INBOX_TERMS.test(`${h.subject ?? ""} ${h.preview ?? ""}`)).slice(0, 2)) {
    add(
      `${clip(clean(hit.from), 60) || "An unnamed sender"} wrote ${hit.receivedAt ? fmtDate(hit.receivedAt) : "on a date the row does not carry"}: ${clip(clean(hit.subject) || clean(hit.preview) || "a message the row carries no subject for", 110)}.`,
      "inbox",
      "the viewer's Microsoft 365 mailbox, one search hit",
    );
  }

  /* THE STRUCTURAL SIGNALS. */
  const signals = bundle?.signals;
  const watch = (signals?.maturityWatch ?? []).filter((m) => clean(m.maturityDate));
  if (watch.length) {
    const soonest = [...watch].sort((a, b) => (dayDiff(a.maturityDate, opts.asOf) ?? 0) - (dayDiff(b.maturityDate, opts.asOf) ?? 0))[0];
    add(
      `The maturity watch names ${watch.length} ${watch.length === 1 ? "facility" : "facilities"}, the first of them ${whenPhrase(soonest.maturityDate, opts.asOf)}.`,
      "signals",
      "Customer360StructuralSignals",
    );
  }
  const guarantors = new Map<string, string>();
  for (const g of signals?.guarantorSignals ?? []) {
    const name = clean(g.guarantorName);
    if (!name) continue;
    const grade = g.highestRiskGrade == null ? "" : String(g.highestRiskGrade);
    if (!guarantors.has(name) || (grade && !guarantors.get(name))) guarantors.set(name, grade);
  }
  if (guarantors.size) {
    add(
      `The guarantor signals name ${[...guarantors].map(([name, grade]) => `${name}${grade ? ` at grade ${grade}` : ", with no grade on the read"}`).join(", ")}.`,
      "signals",
      "Customer360StructuralSignals",
    );
  }
  if (signals?.modificationClusterFlag === true) {
    add(`The org has set the modification cluster flag on this relationship.`, "signals", "Customer360StructuralSignals");
  }

  /* THE MEMO, where one exists. */
  const memo = opts.memo;
  if (memo?.canon) {
    const action = memo.canon.creditAction;
    add(
      `A credit memo is on file for ${clean(action?.productPackageName) || "this relationship"}, credit event ${clean(action?.creditEvent) || "not stated"}, ${clean(action?.tier) || "tier not stated"} tier.`,
      "memo",
      "the memo dossier this session holds",
    );
  }

  /* THE PIPELINE, on the routes that look at the whole year. */
  if (route === "annual" || route === null) {
    for (const o of (bundle?.opportunities?.opportunities ?? []).slice(0, 2)) {
      if (!clean(o.name)) continue;
      add(
        `Open in the pipeline: ${clip(clean(o.name), 90)}${isNum(o.amount) ? `, ${fmtMoney(o.amount)}` : ""}${clean(o.stage) ? `, at ${clip(clean(o.stage), 60)}` : ""}${clean(o.closeDate) ? `, closing ${fmtDate(o.closeDate)}` : ""}.`,
        "pipeline",
        "Customer360Opportunities",
      );
    }
  }

  return out;
}

/** The assets whose next revaluation date has passed as at the snapshot. */
function overdueAssets(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions): string[] {
  const book: ValuationBook = valuationsOf(bundle);
  if (!book.size) return [];
  const now = Date.parse(opts.asOf);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of scoped(bundle, opts.productPackageId ?? null)) {
    for (const c of f.collateral ?? []) {
      const id = clean(c.collateralId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const v = assetValuation(c, book, Number.isNaN(now) ? undefined : now);
      if (v.overdue && v.nextDue) out.push(`${clean(c.collateralName) || clean(c.collateralType) || "an asset"} since ${v.nextDue}`);
    }
  }
  return out;
}

/* --------------------------------------------------------- what is needed */

/** How many changes the paragraph carries before the cut is NAMED. The room's
 *  opening is read in one breath; a twelfth sentence is a tab, not a briefing.
 *  Nothing is dropped silently: whatever the cut reaches is listed in `gaps`
 *  with the lanes it came off, the same contract `channel/deskAsk.ts` holds its
 *  own context cut to. */
export const CHANGE_CAP = 9;

/** At most this many sentences from any one lane, so a relationship with a long
 *  trail cannot crowd the spread and the security out of its own briefing. */
const LANE_CAP = 2;

/** THE ROUTE'S OWN LANE, AND THE TRAIL, EARN ONE MORE. A collateral valuation
 *  that cut the overdue revaluation out of its own briefing would have cut the
 *  one sentence it exists to say; and on the trail a version in flight, what was
 *  filed and what the org confirmed are three facts about the same week. */
const LEAD_CAP = 3;

/**
 * WHICH LANE THE BANKER NEEDS FIRST, PER ROUTE (golden rule 6, digestible
 * order). The cut takes from the BACK of this order, so what a covenant review
 * gives up last is the spread and the trail, and what a valuation gives up last
 * is the security. A lane absent from a route's order still travels, at the end.
 */
const LANE_ORDER: Record<string, readonly BriefingLane[]> = {
  covenant: ["financials", "trail", "exposure", "collateral", "inbox", "signals", "memo", "pipeline"],
  valuation: ["collateral", "exposure", "financials", "trail", "inbox", "signals", "memo", "pipeline"],
  annual: ["financials", "exposure", "collateral", "trail", "signals", "inbox", "memo", "pipeline"],
  rating: ["financials", "signals", "collateral", "exposure", "trail", "inbox", "memo", "pipeline"],
  service: ["inbox", "trail", "exposure", "financials", "collateral", "signals", "memo", "pipeline"],
  opening: ["exposure", "financials", "collateral", "trail", "signals", "inbox", "memo", "pipeline"],
};

const ALL_LANES: readonly BriefingLane[] = [
  "financials",
  "exposure",
  "collateral",
  "trail",
  "inbox",
  "signals",
  "memo",
  "pipeline",
];

/**
 * THE CHANGES, ORDERED FOR THE ROUTE AND CUT WITH THE CUT ACCOUNTED FOR.
 *
 * Both cuts are counted: the per-lane one and the total. A sentence dropped
 * inside a lane is as invisible to the banker as a sentence dropped off the
 * end, so `dropped` carries every lane either cut reached and the builder names
 * them in `gaps`. Nothing leaves this module silently.
 */
function orderChanges(
  route: RelRoute | null,
  changes: readonly BriefingChange[],
): { kept: BriefingChange[]; dropped: number; lanes: BriefingLane[] } {
  const order = LANE_ORDER[route ?? "opening"] ?? LANE_ORDER.opening;
  const lanes = [...order, ...ALL_LANES.filter((l) => !order.includes(l))];
  const ranked: BriefingChange[] = [];
  const lost = new Set<BriefingLane>();
  let dropped = 0;
  for (const lane of lanes) {
    const rows = changes.filter((c) => c.lane === lane);
    const cap = lane === "trail" || lane === lanes[0] ? LEAD_CAP : LANE_CAP;
    if (rows.length > cap) {
      dropped += rows.length - cap;
      lost.add(lane);
    }
    ranked.push(...rows.slice(0, cap));
  }
  const kept = ranked.slice(0, CHANGE_CAP);
  for (const cut of ranked.slice(CHANGE_CAP)) {
    dropped += 1;
    lost.add(cut.lane);
  }
  return { kept, dropped, lanes: [...lost] };
}

function covenantNeeds(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions): BriefingNeed[] {
  const covenants = bundle?.covenants?.covenants ?? [];
  if (!covenants.length) return [];
  const needs: BriefingNeed[] = [];
  const pendingPast = covenants.filter(
    (c) => /pending/i.test(clean(c.latestComplianceStatus)) && (dayDiff(c.nextEvaluationDate, opts.asOf) ?? 1) < 0,
  );
  const unmeasured = covenants.filter((c) => !isNum(c.actualValue));
  const period = boomPeriod(bundle);

  const measurable = covenants.filter((c) => boomMeasureFor(c, bundle) !== null || isNum(challengeFor(c, bundle)?.boomImplied?.value));
  if (measurable.length) {
    needs.push({
      ask: `Confirm ${period.label ? `the ${period.label} figure` : "the spread figure"} as the measure for ${measurable.map((c) => clean(c.covenantType)).join(", ")}, or give me the measured value for the period.`,
      why: `${period.source} holds a figure for ${measurable.length === 1 ? "that test" : "those tests"} and nCino holds its own last evaluation; the room files one of them and will not choose between them for you.`,
    });
  }

  const certificate = covenants.filter((c) => covenantNotDerivable(clean(c.covenantType)) !== null);
  if (certificate.length) {
    needs.push({
      ask: `Give me the measured value for ${certificate.map((c) => clean(c.covenantType)).join(", ")}, or the compliance certificate that carries it.`,
      why: `No spread measures ${certificate.length === 1 ? "it" : "them"}: ${covenantNotDerivable(clean(certificate[0].covenantType))}. Until a figure arrives the room can record a status and nothing measured.`,
    });
  } else if (unmeasured.length) {
    needs.push({
      ask: `Give me the measured value for ${unmeasured.map((c) => clean(c.covenantType)).join(", ")}.`,
      why: "nCino carries no tested value on the compliance row, so there is nothing to read the threshold against.",
    });
  }

  if (pendingPast.length) {
    needs.push({
      ask: `Decide the verdict on ${pendingPast.map((c) => clean(c.covenantType)).join(", ")}.`,
      why: `${pendingPast.length === 1 ? "That row is" : "Those rows are"} recorded Pending with a next evaluation date already behind the book as at ${fmtDate(opts.asOf)}, and a Pending row past its date reads as an exception on the committee's list.`,
    });
  }
  return needs.slice(0, 3);
}

function valuationNeeds(bundle: BorrowerBundle | null | undefined, opts: BriefingOptions): BriefingNeed[] {
  const overdue = overdueAssets(bundle, opts);
  const needs: BriefingNeed[] = [
    {
      ask: "Name the asset and give me the basis of value and the figure, with the source that struck it.",
      why: "A valuation is written against the collateral record and carries its own basis: a fair market value, an orderly liquidation value and a book value are three different numbers for one asset, and the coverage that follows is only as good as which one you file.",
    },
  ];
  if (overdue.length) {
    needs.push({
      ask: `Say whether the refreshed figure covers ${overdue.join(", ")}.`,
      why: "Those assets are past the next revaluation date the org itself recorded, so their lendable value is standing on a figure the bank's own cycle calls stale.",
    });
  }
  needs.push({
    ask: "Confirm the coverage this is meant to restore, facility by facility.",
    why: "The room reads the org's own coverage ratio before the filing and cannot compute the one after it until a figure exists; nothing here derives a coverage of its own.",
  });
  return needs.slice(0, 3);
}

function needsFor(route: RelRoute | null, bundle: BorrowerBundle | null | undefined, opts: BriefingOptions): BriefingNeed[] {
  if (route === "covenant") return covenantNeeds(bundle, opts);
  if (route === "valuation") return valuationNeeds(bundle, opts);
  if (route === "rating") {
    const current = clean(bundle?.snapshot?.primaryRiskRating);
    return [
      {
        ask: `Give me the grade you are proposing${current ? ` against the ${current} the org carries` : ""}, and the drivers behind it.`,
        why: "This cockpit computes no grade and stages none: the org's grade is read, and the one you decide is what the room files.",
      },
      {
        ask: "Say which of the drivers moved and which held.",
        why: "The review record carries the reasons, and a grade filed without them is a number the committee cannot re-derive.",
      },
    ];
  }
  if (route === "annual") {
    const covenants = bundle?.covenants?.covenants ?? [];
    return [
      {
        ask: "Confirm the period the review covers and the financials it stands on.",
        why: `The book carries ${bundle?.boom?.spread?.sourceFile ? `Boom's spread of ${bundle.boom.spread.sourceFile}` : "no spread"}, and a review filed against a period nobody named cannot be reconciled later.`,
      },
      {
        ask: `Give me the verdict on ${covenants.length} ${covenants.length === 1 ? "covenant" : "covenants"} and the grade you are carrying forward.`,
        why: "The annual review record carries both, and the covenant rows advance only where a verdict is filed against them.",
      },
    ];
  }
  if (route === "service") {
    const open = (bundle?.requests ?? []).length + (bundle?.activity ?? []).filter((a) => a.kind === "REQUEST_RECEIVED").length;
    return [
      {
        ask: "Tell me what the client asked for and which facility it lands on.",
        why: open
          ? `The relationship carries ${open} inbound ${open === 1 ? "ask" : "asks"} the read can see, and a case filed against the wrong facility routes to the wrong desk.`
          : "No inbound ask is on this read, so the room has nothing to open a case from until you say what it is.",
      },
    ];
  }
  return [
    {
      ask: "Pick the review you are running on this relationship.",
      why: "Each one files a different record against a different object, and the room collects different things for each; choosing first is what keeps it from asking you for all of them.",
    },
  ];
}

/* ----------------------------------------------------- what the committee asks

   THE SAME GUARD `spread/postRead.ts` HOLDS. Each line fires on a condition the
   figures themselves satisfy and names the figures that made it fire. Nothing
   here is a view: this cockpit carries no policy book, so it has no opinion on
   whether a cushion is comfortable. Two lines at most.                        */

function committeeLines(route: RelRoute | null, bundle: BorrowerBundle | null | undefined, opts: BriefingOptions): string[] {
  /* THE ROUTE'S OWN QUESTIONS FIRST. A collateral valuation that opens with a
     covenant question has answered someone else's room; the covenant rules
     still run underneath, because a breach is a breach in any room. */
  const onRoute: string[] = [];
  const out: string[] = [];
  const covenants = bundle?.covenants?.covenants ?? [];
  const exposure = bundle?.exposure;
  const inScope = scoped(bundle, opts.productPackageId ?? null);

  for (const c of covenants) {
    const type = clean(c.covenantType);
    const actual = c.actualValue;
    const threshold = c.thresholdValue;
    if (!isNum(actual) || !isNum(threshold) || threshold === 0) continue;
    if (Math.abs(actual - threshold) / Math.abs(threshold) > 0.1) continue;
    out.push(
      `The committee will ask about ${type}, which last tested at ${fmtCovVal(actual, type)} against its ${fmtCovThreshold(type, actual, threshold)} on ${fmtDate(c.lastEvaluationDate)}, inside a tenth of it.`,
    );
  }

  for (const c of covenants) {
    if (!/pending/i.test(clean(c.latestComplianceStatus))) continue;
    const days = dayDiff(c.nextEvaluationDate, opts.asOf);
    if (days === null || days >= 0) continue;
    out.push(
      `The committee will ask why the ${clean(c.covenantType)} test due ${fmtDate(c.nextEvaluationDate)} is still recorded Pending ${Math.abs(days)} days later.`,
    );
  }

  const verdicts = covenants.map((c) => classifyCovenant(c));
  const breaches = covenants.filter((_, i) => verdicts[i].financialBreach);
  if (breaches.length) {
    out.push(
      `The committee will ask about ${breaches.map((c) => clean(c.covenantType)).join(", ")}, which the org records as a measured breach.`,
    );
  }

  const short = inScope.filter((f) => f.coverageShortfall === true);
  if (short.length && isNum(exposure?.coverageRatio)) {
    const line = `The committee will ask why ${short.length} ${short.length === 1 ? "facility carries" : "facilities carry"} a coverage shortfall while the relationship's own ratio reads ${fmtRatio(exposure.coverageRatio)}.`;
    (route === "valuation" || route === "annual" || route === null ? onRoute : out).push(line);
  }

  const overdue = overdueAssets(bundle, opts);
  if (overdue.length) {
    const line = `The committee will ask why ${overdue.length === 1 ? "the valuation" : `${overdue.length} valuations`} the org itself dated is still outstanding: ${overdue.join(", ")}.`;
    (route === "valuation" ? onRoute : out).push(line);
  }

  const graded = [...new Set(inScope.map((f) => clean(f.riskGrade)).filter(Boolean))];
  const carried = clean(bundle?.snapshot?.primaryRiskRating);
  if (carried && graded.length && !graded.includes(carried)) {
    const line = `The committee will ask why the relationship carries grade ${carried} while its facilities are graded ${graded.join(", ")}.`;
    (route === "rating" ? onRoute : out).push(line);
  }

  return [...onRoute, ...out].slice(0, 2);
}

/* ------------------------------------------------------------------- gaps */

function gapsFor(
  route: RelRoute | null,
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
  src: ReadSource,
  due: BriefingItem[],
): string[] {
  const gaps: string[] = [];

  if (!bundle) {
    gaps.push("no relationship is staged on this read, so the briefing stands on nothing");
    return gaps;
  }

  /* THE INBOX. An inbox nobody searched and an inbox carrying nothing are two
     different facts and the room says which one it is holding. */
  if (opts.inbox == null) {
    gaps.push("no inbox rows are loaded on this relationship, so the room cannot say whether the compliance certificate or the statements have arrived");
  } else {
    const relevant = opts.inbox.filter((h) => INBOX_TERMS.test(`${h.subject ?? ""} ${h.preview ?? ""}`));
    if (!relevant.length) {
      gaps.push(
        opts.inbox.length
          ? `the compliance certificate is not among the ${opts.inbox.length} inbox ${opts.inbox.length === 1 ? "row" : "rows"} loaded for this relationship`
          : "the inbox search returned no rows for this relationship, so no client message stands behind this briefing",
      );
    }
  }

  if (!opts.memo) gaps.push("no credit memo is on file for this relationship in this session");
  if (!bundle.boom?.spread?.periods?.length) gaps.push("no Boom spread is on this bundle, so no financial period stands behind the figures");
  if (!(bundle.collateralValuations ?? []).length) {
    gaps.push("no valuation read is staged on this bundle, which means no read looked and never that the assets were never valued");
  }
  if (!(opts.history ?? []).length) gaps.push("no durable action trail is loaded, so what this cockpit filed before is not in front of the room");

  for (const item of due) {
    const subject = item.what.replace(/^The /, "");
    if (!item.meansSentence && route !== "valuation") {
      gaps.push(`the read does not say what ${subject} tests, and the room will not describe a test the bank wrote and this cockpit has not read`);
    }
    if (item.threshold === null && route === "covenant") gaps.push(`${subject} carries no threshold on this read`);
  }

  /* AN ASSET WITH NO BASIS OF VALUE. The pledge's own DESCRIPTION is on the
     read and the basis is not, so the item still says what the asset IS and
     the room still has to say what it cannot read: a lendable figure whose
     basis nobody stated is a number with no meaning attached to it. */
  if (route === "valuation") {
    const book = valuationsOf(bundle);
    const seen = new Set<string>();
    for (const f of scoped(bundle, opts.productPackageId ?? null)) {
      for (const c of f.collateral ?? []) {
        const id = clean(c.collateralId);
        const name = clean(c.collateralName) || clean(c.collateralType);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        if (clean(book.get(id)?.valuationType)) continue;
        gaps.push(`no basis of value is on this read for ${name}, so the room cannot say what its lendable figure would mean`);
      }
    }
  }

  if (route === "covenant") {
    if (due.length && due.every((i) => i.trend === null)) {
      gaps.push("no second measurement is carried for these tests, so no trend since the last test is stated");
    }
    gaps.push("what a breach of these covenants triggers is not on this read: no facility agreement terms are staged anywhere in the cockpit");
  }
  if (route === "valuation" && !due.length) gaps.push("no collateral is pledged to the facilities in scope, so there is nothing to value");
  if (route === "service" && !due.length) gaps.push("no inbound client request is on this relationship, so the room has no ask to open a case from");

  /* THE STANDING HONESTY LIST. The same words every other surface refuses with,
     built by the same derivation: `channel/relationshipContext.ts` owns it. */
  const facts = buildRelationshipFacts(src);
  gaps.push(...(facts?.notCarried ?? []));

  return [...new Set(gaps)];
}

/* --------------------------------------------------------------- the prose */

/**
 * ONE ITEM AS ONE CONNECTED PARAGRAPH.
 *
 * The BUILDER writes the prose and the component renders it, so a sentence and
 * the field under it can never drift apart, and a golden-rule scan can be run
 * over exactly what the banker reads. Every clause is conditional: an item the
 * read carries less of says less, and never says it with a blank in it.
 */
export function briefingItemSentence(item: BriefingItem): string {
  const said: string[] = [];
  said.push(item.nextTest ? `${item.what} ${item.dueVerb} ${item.nextTest}.` : `${item.what} carries no next date on this read.`);
  if (item.meansSentence) said.push(stop(item.meansSentence));
  if (item.threshold) said.push(`It is measured against ${item.threshold}.`);
  if (item.measured && item.measuredSource) {
    said.push(`${item.measuredSource} reads ${item.measured}${item.measuredAsOf ? ` as at ${item.measuredAsOf}` : ", on a date this read does not carry"}.`);
  }
  if (item.lastVerdict) said.push(stop(item.lastVerdict));
  if (item.trend) said.push(item.trend);
  if (item.associations.length) said.push(`It sits on ${list(item.associations)}.`);
  return said.join(" ");
}

/* ------------------------------------------------------------ the builder */

/** The routes that carry a briefing of their own. Everything else, including
 *  the version routes and the intake, opens on the neutral briefing: those
 *  routes author something new rather than reviewing what the book holds. */
function itemsFor(
  route: RelRoute | null,
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
  relationship: string,
): BriefingItem[] {
  if (!bundle) return [];
  switch (route) {
    case "covenant":
      return covenantItems(bundle, opts, relationship);
    case "valuation":
      return collateralItems(bundle, opts, relationship);
    case "rating":
      return gradeItem(bundle, opts, relationship);
    case "annual":
      return reviewItem(bundle, opts, relationship);
    case "service":
      return serviceItems(bundle, opts, relationship);
    default:
      return openingItems(bundle, opts, relationship);
  }
}

const OPENING_WORD: Record<string, string> = {
  covenant: "covenant review",
  valuation: "collateral valuation",
  annual: "annual review",
  rating: "risk-rating review",
  service: "service request",
};

/**
 * THE BRIEFING THE ROOM OPENS WITH.
 *
 * Pure, total, and safe on an empty bundle: a relationship the read staged
 * nothing for produces a briefing with no items, no changes and a gap saying
 * exactly that, which is the honest opening and not a crash.
 */
export function buildBriefing(
  route: RelRoute | null,
  bundle: BorrowerBundle | null | undefined,
  opts: BriefingOptions,
): Briefing {
  const relationship = clean(bundle?.snapshot?.name) || "this relationship";
  const src: ReadSource = {
    bundle: bundle ?? null,
    accountName: relationship,
    productPackageId: opts.productPackageId ?? null,
    generatedAt: opts.asOf,
    history: opts.history,
  };

  const due = itemsFor(route, bundle, opts, relationship);
  const since = sinceOf(route, bundle);
  const { kept, dropped, lanes } = orderChanges(route, bundle ? changeLanes(route, bundle, opts, src, since) : []);
  const gaps = gapsFor(route, bundle, opts, src, due);

  if (dropped > 0) {
    /* A NOUN PHRASE, like every other gap: the component reads the list out
       after "This briefing does not carry", so a gap written as a sentence of
       its own would land inside that one and break it. */
    gaps.unshift(
      `${dropped} further ${dropped === 1 ? "change" : "changes"} on the ${and(lanes)} ${lanes.length === 1 ? "lane" : "lanes"}, which ${dropped === 1 ? "sits" : "sit"} on the relationship tabs`,
    );
  }

  const word = route ? OPENING_WORD[route] : null;
  const opening = word
    ? `This is the ${word} on ${relationship}, read off the book as it stood at ${fmtDate(opts.asOf)}${since ? `, and measured against the last one on ${fmtDate(since)}` : ""}.`
    : `This is ${relationship}, read off the book as it stood at ${fmtDate(opts.asOf)}. Here is what is running on it before you choose a review.`;

  return {
    route,
    opening,
    due,
    changedSince: kept,
    needs: needsFor(route, bundle, opts),
    committee: committeeLines(route, bundle, opts),
    gaps,
  };
}
