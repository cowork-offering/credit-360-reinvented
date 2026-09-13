import type { BorrowerBundle, C360Data, Covenant } from "../../data/contract";
import { dayDiff } from "../../data/time";
import { classifyCovenant } from "../../domain/covenantStatus";

/* =============================================================================
   THE RELATIONSHIP ROUTER — WHICH REVIEW TAKES THE SESSION.

   ONE ROOM, FIVE ROUTES. Annual review, covenant review, collateral valuation,
   risk-rating review and service request are the same room; what differs is
   which staged flow is behind it and what the room has to collect before it can
   stage. The room's FIRST QUESTION decides, and this module is everything that
   question needs: the neutral form, the five chips, the governance signal
   derived from the deal, and the thin shim that reads a route out of a typed
   line.

   PRESENTATION ORCHESTRATION, NOT A FLOW. Nothing here stages and nothing here
   writes. It decides which review the banker is running; `reviewFlows.ts` then
   drives the staged flow the ActionPanel has always driven, unchanged.

   NO SECOND NLP LAYER. The route words below are the coarsest possible read:
   which of the five reviews is this. Once the route is bound the room asks for
   the parameters that route needs, in its own guided steps, and never tries to
   pull them out of the sentence that named the route.

   THE CHANNEL-NONE DOCTRINE APPLIES TO THE GREETING SLOT. A signal is derived
   only from data the read actually carries. Two things a banker would expect to
   see here are DELIBERATELY ABSENT because nothing in the contract backs them:
   time since the last annual review (no review date is read anywhere) and a
   stale collateral valuation (`Collateral` carries no valuation date). Leading
   on either would be a suggestion the data never made.
   ============================================================================= */

export type RelRoute =
  | "annual"
  | "covenant"
  | "valuation"
  | "rating"
  | "service"
  | "intake"
  | "versionCovenant"
  | "versionPledge";

/** The neutral form, when the relationship gives the room nothing to lead on.
 *  It names the register the room is in rather than listing five nouns: the
 *  chips below carry the list, and a question that also read it out would spend
 *  the opening view's whole budget saying the same thing twice. */
export const NEUTRAL_QUESTION =
  "Which review are we running on this relationship?";

/** The chip a governance signal offers instead of the yes it is proposing. */
export const SOMETHING_ELSE = "Something else";

export interface RelRouteChip {
  label: string;
  route: RelRoute;
}

/** The five routes, in the room's own option-pill style. The order is the order
 *  the governance calendar imposes them: the periodic review of the whole
 *  relationship, then the tests inside it, then the security behind it, then the
 *  rating that follows from all three, then the servicing ask that is none of
 *  them. */
export const REL_ROUTE_CHIPS: readonly RelRouteChip[] = [
  { label: "Annual review", route: "annual" },
  { label: "Covenant review", route: "covenant" },
  { label: "Collateral valuation", route: "valuation" },
  { label: "Risk-rating review", route: "rating" },
  { label: "Service request", route: "service" },
  /* THE SIXTH IS NOT A REVIEW AND IT SITS LAST FOR THAT REASON. The five above
     act on what the org already holds; this one puts a covenant or an asset onto
     the relationship. A banker scanning the chips for a review should meet the
     five first, and the one that authors after them. */
  { label: "Add a covenant or an asset", route: "intake" },
  /* AND THE TWO THAT SHAPE THE VERSION IN FLIGHT (0.9.23). They are last
     because they are the narrowest: neither runs at all unless the relationship
     carries an editable version or a package the cockpit created and nobody has
     booked. Both write through `amend_version`, which lands on the version's
     OWN loans and takes no credit action, so neither is a review and neither
     forks anything. Where the relationship carries nothing amendable the chips
     stay and are disabled with that reason (A27.3). */
  { label: "Add a covenant to this version", route: "versionCovenant" },
  { label: "Pledge collateral to this version", route: "versionPledge" },
];

/** The two routes that land on an unbooked version rather than on the book. */
export const VERSION_ROUTES: readonly RelRoute[] = ["versionCovenant", "versionPledge"];

/** TRUE where the route shapes a version in place rather than reviewing a book. */
export function isVersionRoute(route: RelRoute | null): boolean {
  return route === "versionCovenant" || route === "versionPledge";
}

/** The room's own word for a route, for the sentence that refuses to switch and
 *  for the sentence that hands facility work back to the facility room. */
export const REL_ROUTE_WORD: Record<RelRoute, string> = {
  annual: "annual review",
  covenant: "covenant review",
  valuation: "collateral valuation",
  rating: "risk-rating review",
  service: "service request",
  intake: "relationship intake",
  versionCovenant: "covenant on the version",
  versionPledge: "collateral pledge on the version",
};

/* ------------------------------------------------------------ smart opening */

export interface RelOpening {
  /** The insight. A fact the read carries, then the question it implies. */
  line: string;
  /** The route the yes-chip binds. */
  route: RelRoute;
  yesLabel: string;
  /** The covenant the insight named, so binding the yes opens the brief on it.
   *  Null where the signal names no single covenant. */
  covenantId: string | null;
}

/** "Due soon", for a covenant test. The SAME window `nextMove.ts` and
 *  `worklist.ts` use, so "due soon" means one thing across the cockpit. */
export const COVENANT_DUE_DAYS = 45;

function dayWord(d: number): string {
  if (d === 0) return "today";
  if (d === 1) return "in 1 day";
  return `in ${d} days`;
}

function agoWord(d: number): string {
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** The noun phrase for a covenant, in the org's own words. The fallback has to
 *  replace the WHOLE phrase: a bare `|| "covenant"` on the type reads as "the
 *  covenant test", which is not a thing anyone calls anything. */
function subjectFor(cov: Covenant): string {
  const type = (cov.covenantType ?? "").trim();
  return type ? `${type} test` : "covenant test";
}

/**
 * THE GOVERNANCE SIGNAL THE RELATIONSHIP CARRIES, or null.
 *
 * Three tiers, ranked by what a credit officer would want raised first:
 *
 *   1. a covenant in FINANCIAL BREACH — the org's own answer, via the shared
 *      classifier, never inferred from an administrative Exception. A breach is
 *      the trigger for reassessing the rating, so it opens the RATING route.
 *   2. a covenant test OVERDUE — its next evaluation date has passed and the
 *      test is neither breached nor waived. That is covenant-review work.
 *   3. a covenant test DUE inside the window. Same route, quieter clock.
 *
 * NULL IS THE COMMON CASE AND IT IS NOT A FAILURE. No signal means the neutral
 * five-way question, never an invented one. `today` is `meta.generatedAt`;
 * nothing here reaches a clock.
 */
export function relOpeningFor(args: { data: C360Data; bundle: BorrowerBundle | null }): RelOpening | null {
  const today = args.data.meta?.generatedAt ?? "";
  if (!today || dayDiff(today, today) === null) return null;
  const covenants = args.bundle?.covenants?.covenants ?? [];
  if (!covenants.length) return null;

  const judged = covenants.map((c) => ({ c, verdict: classifyCovenant(c), d: dayDiff(c.nextEvaluationDate, today) }));

  /* Tier 1 — a financial breach. Ties break on the covenant type name so the
     pick is deterministic over no other signal to break on. */
  const breached = judged
    .filter((x) => x.verdict.financialBreach)
    .sort((a, b) => (a.c.covenantType ?? "").localeCompare(b.c.covenantType ?? ""));
  if (breached.length) {
    const { c } = breached[0];
    return {
      line: `The ${subjectFor(c)} is in breach. Run the risk-rating review?`,
      route: "rating",
      yesLabel: "Open the risk-rating review",
      covenantId: c.covenantId ?? null,
    };
  }

  const testable = judged.filter(
    (x): x is { c: Covenant; verdict: ReturnType<typeof classifyCovenant>; d: number } =>
      x.d !== null && x.verdict.kind !== "breach" && x.verdict.kind !== "waived",
  );

  /* Tier 2 — overdue. The MOST overdue leads: an undelivered test from two
     months ago is a louder governance fact than one that slipped last week. */
  const overdue = testable.filter((x) => x.d < 0).sort((a, b) => a.d - b.d);
  if (overdue.length) {
    const { c, d } = overdue[0];
    return {
      line: `The ${subjectFor(c)} was due ${agoWord(-d)}. Run the covenant review?`,
      route: "covenant",
      yesLabel: "Open the covenant review",
      covenantId: c.covenantId ?? null,
    };
  }

  /* Tier 3 — due inside the window. The NEAREST leads. */
  const due = testable
    .filter((x) => x.d >= 0 && x.d <= COVENANT_DUE_DAYS)
    .sort((a, b) => a.d - b.d || (a.c.covenantType ?? "").localeCompare(b.c.covenantType ?? ""));
  if (due.length) {
    const { c, d } = due[0];
    return {
      line: `The ${subjectFor(c)} is due ${dayWord(d)}. Run the covenant review?`,
      route: "covenant",
      yesLabel: "Open the covenant review",
      covenantId: c.covenantId ?? null,
    };
  }

  return null;
}

/* -------------------------------------------------------------- route words */

/** "annual review", "the yearly review", "review the relationship". */
const ANNUAL = /\b(annual|yearly|periodic)\s+(review|credit\s+review)\b|\bannual\s+review\b|\breview\s+the\s+relationship\b/i;
/** "covenant review", "test the covenants", "covenant compliance". */
const COVENANT = /\bcovenant/i;
/** "revalue the collateral", "collateral valuation", "value the collateral",
 *  "appraisal". The bare verb "value" only counts WITH its object: "the value
 *  is fine" is an observation, not a request to open a valuation. */
const VALUATION =
  /\b(valuation|revalue|re-?value|appraisal|appraise)\b|\bcollateral\s+(value|review)\b|\bvalue\s+(the\s+|these\s+|this\s+)?(collateral|assets?|security)\b/i;
/** "risk rating", "re-rate", "downgrade", "upgrade the grade". */
const RATING = /\b(risk[-\s]?rating|re-?rate|re-?rating|downgrade|upgrade|regrade)\b|\brating\s+review\b/i;
/**
 * A LINE THAT PUTS SOMETHING ONTO THE RELATIONSHIP.
 *
 * BOTH HALVES ARE REQUIRED: a create verb, and the thing being created. That is
 * what keeps this off the five reviews. "covenant review" carries no create verb
 * and "add the certificate to the file" names nothing this room authors, so
 * neither reaches here.
 *
 * IT IS READ FIRST, ahead of every review word, because "add a relationship
 * covenant" is a create that happens to contain the word covenant and the
 * covenant review would otherwise take it. A line that names a review EXPLICITLY
 * ("run the covenant review and add one") still reads as the create it opens
 * with, which is the same specificity rule the rest of this reader follows.
 */
const INTAKE_VERB = /\b(add|adds|adding|create|creates|creating|author|file|register|record|put|set\s+up|new)\b/i;
const INTAKE_NOUN =
  /\b(covenants?|tests?|collateral|assets?|security|equipment|inventory|receivables?|property|real\s*estate|building|vehicle|machinery)\b/i;
/** Words that make a create line facility work rather than relationship intake.
 *  A pledge, a lien and a facility are the facility room's, and the handoff that
 *  already exists says so. */
const INTAKE_NOT_HERE = /\b(pledge\w*|lien|secure\s+the|facility|loan|line\s+of\s+credit|clone|renewal)\b/i;

/**
 * THE LINE NAMES THE UNBOOKED VERSION, not the booked package behind it.
 *
 * Two words and only two: "version" and "in flight". Both name the thing nCino
 * forks when a modification is filed, and neither appears in any of the six
 * reviews' own vocabulary, so this reader can run FIRST without shadowing one.
 * It deliberately does NOT read "the modification": "run the covenant review on
 * the modification" is a review a banker is asking for by name, and taking it
 * as a version amendment would pick a WRITE PATH out of a word the sentence did
 * not settle.
 *
 * THE NOUN DECIDES WHICH OF THE TWO. A covenant word takes the covenant route;
 * anything else that names security takes the pledge route. A line that names
 * the version and neither returns null, because "open the version" is not a
 * request to write on it.
 */
const VERSION_WORD = /\bversions?\b|\bin[-\s]?flight\b/i;
const VERSION_COVENANT_NOUN = /\bcovenants?\b/i;
const VERSION_PLEDGE_NOUN = /\b(pledg\w*|collateral|assets?|security)\b/i;

/** Which version route a typed line binds, or null where it names none. */
export function readVersionRoute(text: string): RelRoute | null {
  const line = text.trim();
  if (!line || !VERSION_WORD.test(line)) return null;
  if (VERSION_COVENANT_NOUN.test(line)) return "versionCovenant";
  return VERSION_PLEDGE_NOUN.test(line) ? "versionPledge" : null;
}

/** "service request", "raise a ticket", "the client asked for a payoff quote". */
const SERVICE = /\b(service\s+request|servicing\s+request|raise\s+a\s+(ticket|request)|payoff|statement\s+request|open\s+a\s+ticket)\b/i;

/* ------------------------------------------- the client's ask, unrouted

   THE DRIVE'S LINE 13 NAMES NO ROUTE. "james wants the june certificate" and
   "send them the payoff letter" are the commonest thing a banker types into
   this room, and only the second binds: `SERVICE` matches "payoff" and nothing
   in the first is a route word at all. So the first fell to the five-way
   sentence, which lists the annual review, the covenant review, a valuation and
   the rating back at a banker who is plainly not running any of them.

   THIS IS NOT A SIXTH ROUTE WORD, and it deliberately does not bind. Guessing
   here picks a WRITE PATH, which is the rule this module opens with. It offers
   the service request as ONE CHIP and keeps "Something else" beside it, so the
   banker confirms in one click what the room can only infer.

   BOTH HALVES ARE REQUIRED: somebody asking, and a thing a servicing team
   files. "the client wants a covenant waiver" never reaches here, because the
   route read runs first and `COVENANT` binds it. */

/** Somebody outside the bank asking for something. */
const REQUEST_VERB =
  /\b(wants?|wanted|needs?|asked|asking|requests?|requested|requesting|chasing|would\s+like|send\s+(them|him|her|it|over|through)|get\s+(them|him|her)\b)\b/i;

/** A thing a servicing team produces. Documents and account services only: no
 *  word here names a review, so this set cannot shadow one of the five. */
const SERVICE_NOUN =
  /\b(certificate|statement|letter|copy|copies|document|paperwork|payoff|pay-?off|balance|invoice|receipt|confirmation|schedule|amortisation|amortization|form|wire\s+instructions?|lien\s+release|subordination|estoppel|reference)\b/i;

/**
 * TRUE where an unbound line reads as a CLIENT'S REQUEST for a document or a
 * service, rather than as a review anybody named.
 *
 * Only ever consulted AFTER `readRelRouteIntent` has returned null, so a line
 * that names one of the five is never seen here.
 */
export function readsAsClientRequest(text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  return REQUEST_VERB.test(line) && SERVICE_NOUN.test(line);
}

/** The one line the room answers such a request with. It states what it read,
 *  and it does not claim to have routed anything. */
export const CLIENT_REQUEST_OFFER =
  "That reads as something the client asked us for, which is a service request on this relationship rather than one of the reviews.";

/** The chip that takes the offer. */
export const RAISE_A_SERVICE_REQUEST = "Raise a service request";

/**
 * A LINE THAT NAMES FACILITY WORK. This room does not do it, and it says so
 * rather than routing a pledge into a valuation.
 *
 * The four words are the ones that name a FACILITY-CONTEXT change: pledging
 * security to a loan, cloning a covenant onto a renewal, modifying or renewing
 * what is booked. Creating a covenant on the ACCOUNT and creating a collateral
 * asset the relationship owns both live here (founder, 2026-08-31), so "create"
 * and "add" on their own are deliberately NOT in this set.
 */
const FACILITY_WORK =
  /\b(pledge\w*|unpledge\w*|release\s+the\s+(lien|collateral)|renew\w*|modif\w*|amend\w*|restructur\w*|new\s+facility|structure\s+a\s+(new\s+)?(facility|loan|line))\b/i;

/**
 * THE ROUTE A TYPED LINE BINDS, before any route is bound.
 *
 * FREE TEXT ALWAYS WINS: a banker who knows which review they are running types
 * it, the room binds, and the question retires without ever being answered. Null
 * where the line names no route at all — the room then repeats the question
 * rather than guessing, because guessing here picks a WRITE PATH.
 *
 * ORDER IS SPECIFICITY, not preference. "annual covenant review" is an annual
 * review that mentions covenants, and "collateral valuation" contains neither
 * word the rating test looks for. The narrowest phrase wins first.
 */
export function readRelRouteIntent(text: string): RelRoute | null {
  const line = text.trim();
  if (!line) return null;
  /* THE VERSION IS READ FIRST, ahead of the intake and ahead of every review
     word, on the same specificity rule the intake is read ahead of the covenant
     review: "add a covenant to this version" is a covenant add on an unbooked
     package, and both the intake and the covenant review would otherwise take
     it and file it somewhere the banker did not ask for. */
  const version = readVersionRoute(line);
  if (version) return version;
  if (readsAsIntake(line)) return "intake";
  if (SERVICE.test(line)) return "service";
  if (VALUATION.test(line)) return "valuation";
  if (RATING.test(line)) return "rating";
  if (ANNUAL.test(line)) return "annual";
  return COVENANT.test(line) ? "covenant" : null;
}

/** TRUE where a line asks this room to AUTHOR a covenant or an asset. */
export function readsAsIntake(text: string): boolean {
  const line = text.trim();
  if (!line) return false;
  if (INTAKE_NOT_HERE.test(line)) return false;
  return INTAKE_VERB.test(line) && INTAKE_NOUN.test(line);
}

/**
 * A LINE ASKING FOR A DIFFERENT REVIEW, inside a room already bound to one.
 *
 * Deliberately the same read as `readRelRouteIntent` and then a difference
 * test. Unlike the facility room there is no fallback tier to narrow away from:
 * every route word here already names a review explicitly, so a covenant review
 * that mentions "the collateral behind it" does not move the room unless the
 * banker says "valuation".
 */
export function readRelRouteSwitch(
  text: string,
  current: RelRoute,
  opts: { openTextStep?: boolean } = {},
): RelRoute | null {
  const route = readRelRouteIntent(text);
  if (!route || route === current) return null;
  /* A ROUTE WORD INSIDE AN ANSWER IS NOT A REQUEST TO CHANGE REVIEW.
     "Copy of the June covenant compliance certificate" is the SUBJECT of a
     service request and it re-routed the room to the covenant review, because
     the switch read ran ahead of the open text step that had just asked for it.
     Caught by the headless drive on 2026-09-02, line 13.

     A banker switching review says so in a few words: "covenant review", "run
     the covenant review instead". A banker answering an open question writes a
     sentence. Over an OPEN TEXT STEP the short form still switches and the
     sentence is the answer; everywhere else the read is unchanged. */
  if (opts.openTextStep && !isRouteNaming(text)) return null;
  return route;
}

/** Past this it is an ANSWER that mentions a review, not a request for one. */
const ROUTE_NAMING_WORD_CAP = 5;

function isRouteNaming(text: string): boolean {
  return text.trim().replace(/[?.!,]+$/, "").split(/\s+/).filter(Boolean).length <= ROUTE_NAMING_WORD_CAP;
}

/**
 * TWO FIXED PHRASES THAT NAME A DOCUMENT RATHER THAN AN AMENDMENT.
 *
 * "the amended and restated credit agreement" and "the facility as amended" are
 * what a banker calls the paper the terms are written on. `FACILITY_WORK` reads
 * `amend\w*`, so a covenant note citing the agreement it came from was answered
 * with the facility handoff and the note was dropped. Caught by the intake drive
 * on 2026-09-03, on the one step where a banker quotes the agreement by name.
 *
 * THE PHRASES ARE REMOVED BEFORE THE TEST, not added to an exception list, so a
 * line that asks for an amendment AND cites the agreement still hands off:
 * "amend the equipment loan, see the amended and restated agreement" keeps its
 * own verb.
 */
const DOCUMENT_AMENDMENT = /\bamended\s+and\s+restated\b|\bas\s+amended\b/gi;

/**
 * THE FACILITY THE WORK WOULD BE DONE TO.
 *
 * Over an OPEN TEXT STEP the verb on its own is not a request. "Renew at
 * current terms." IS the annual review's recommendation, "Amend the covenant
 * package at renewal." IS its narrative, and both were thrown away and answered
 * with the facility handoff while the step stayed live. A banker asking this
 * room for facility work names the thing to be worked on.
 */
const FACILITY_OBJECT = /\b(facilit(?:y|ies)|loans?|lines?|notes?|collateral|security|liens?|pledges?|assets?)\b/i;

/**
 * TRUE where the line asks for FACILITY work this room does not do. The room
 * answers with the handoff rather than routing it into the nearest review.
 *
 * `openTextStep` is the same guard `readRelRouteSwitch` takes and for the same
 * reason: a question that asked for a sentence owns the sentence it gets. Over
 * one, the handoff fires only on a SHORT line that also names the facility or
 * the security it would act on.
 */
export function asksForFacilityWork(text: string, opts: { openTextStep?: boolean } = {}): boolean {
  const line = text.trim();
  if (!line) return false;
  /* SHAPING THE VERSION IS THIS ROOM'S WORK NOW (0.9.23). `FACILITY_WORK` reads
     `pledge\w*`, so "pledge collateral to this version" met the handoff and was
     sent to a room that cannot take it: a credit action runs against a BOOKED
     loan and a version holds none. A line that names the version is the version
     routes', and they are in this room. */
  if (readVersionRoute(line)) return false;
  const stripped = line.replace(DOCUMENT_AMENDMENT, " ");
  if (!FACILITY_WORK.test(stripped)) return false;
  if (!opts.openTextStep) return true;
  return isRouteNaming(line) && FACILITY_OBJECT.test(stripped);
}

/** The one-line handoff, in the room's own register. Facility-context creation
 *  (a covenant on a clone, create-then-pledge) stays in the facility room; this
 *  room says where it lives rather than half-doing it. */
export const FACILITY_HANDOFF =
  "That is facility work. Pledging security onto a booked facility, cloning a covenant onto a renewal and reshaping a booked facility all run in Facility Actions on this relationship. " +
  "This room takes the six reviews. It also shapes the version already in flight, where there is one.";
