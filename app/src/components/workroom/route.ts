import type { BorrowerBundle, C360Data, Facility } from "../../data/contract";
import { mustChoosePackage } from "../../book/packages";
import { bookedFacilities, facilityProduct } from "../../data/facilityStage";
import { fmtMoney } from "../../data/format";
import { isActiveFacility } from "../../data/worklist";
import { deriveNextMove, type NextMove, type NextMoveKind } from "../../workroom/nextMove";
import type { WorkroomMode } from "../../workroom/types";

/* =============================================================================
   THE ROUTER — WHICH ENGINE TAKES THE SESSION.

   ONE ROOM, THREE ROUTES (founder, 2026-08-31). Renewal, modification and new
   facility are the same room; what differs is which engine is behind it. The
   room's FIRST QUESTION decides, and this module is everything that question
   needs: the neutral form, the three chips, the smart opening derived from the
   deal, and the thin shim that reads a route out of a typed line.

   PRESENTATION ORCHESTRATION, NOT AN ENGINE. Nothing here parses a change, and
   nothing here writes. It decides which engine the banker is talking to; the
   engine then does what it has always done with the words. `app/src/workroom/`
   is not touched by any of it — `deriveNextMove` is READ, never edited.

   NO SECOND NLP LAYER. The route words below are the coarsest possible read:
   is this a renewal, a new facility, or a change to what exists. The moment the
   route is bound the real parser takes every line, including the one that bound
   it. A shim that tried to understand more than the route would be a second
   parser drifting away from the first.
   ============================================================================= */

/** The neutral form, when the deal gives the room nothing to lead on. */
export const NEUTRAL_QUESTION =
  "What are we doing with this relationship - modifying, renewing, or structuring something new?";

/** The chip a smart opening offers instead of the yes it is proposing. */
export const SOMETHING_ELSE = "Something else";

/**
 * THE THREE ROUTES A SENTENCE CAN NAME.
 *
 * AMEND IS NEVER ONE OF THEM (0.9.23). Shaping a version in place is a route
 * the ROOM offers on a version it is already standing in: it depends on WHERE
 * the banker is, not on what they typed, and a line read as an amendment in a
 * room standing on a booked package would bind an engine with nothing to shape.
 * So the coarse read answers with the original three, and the amend chip is
 * added by the room from the roster.
 */
export type TypedRoute = Exclude<WorkroomMode, "amend">;

export interface RouteChip {
  label: string;
  route: TypedRoute;
}

/** The three routes, in the room's own option-pill style. The order is the
 *  order a banker meets the work in: reshape what exists, roll what matures,
 *  structure what does not exist yet. */
export const ROUTE_CHIPS: readonly RouteChip[] = [
  { label: "Modify", route: "modify" },
  { label: "Renew", route: "renew" },
  { label: "New facility", route: "create" },
];

/* ------------------------------------------------------------ smart opening */

/**
 * THE ROUTE A DEAL SIGNAL SUGGESTS.
 *
 * `deriveNextMove` ranks three tiers. Two of them are facility work this room
 * can take:
 *
 *   maturity    → renew. The renewal clock is the loudest fact the room carries.
 *   utilization → modify. Headroom is a change to what is already booked.
 *
 * The third is deliberately absent. A covenant test due soon is the COVENANT
 * REVIEW satellite's work, not one of this room's three routes, so a covenant
 * move yields no suggestion and the room asks the neutral question instead.
 * Routing a covenant signal into a modification would be a suggestion the data
 * never made.
 */
const ROUTE_FOR_KIND: Partial<Record<NextMoveKind, TypedRoute>> = {
  maturity: "renew",
  utilization: "modify",
};

/** The yes-chip's label, in banker grammar, for each route a signal can open. */
const YES_LABEL: Partial<Record<NextMoveKind, string>> = {
  maturity: "Start the renewal",
  utilization: "Open the modification",
};

export interface SmartOpening {
  /** The insight, VERBATIM from `deriveNextMove`. The room never rewrites the
   *  engine's sentence: the chip answers the question it asks. */
  line: string;
  /** The route the yes-chip binds. */
  route: TypedRoute;
  yesLabel: string;
  /** The member the insight names, so binding the yes also preselects it.
   *  Null where the signal names no single facility (utilization is a package
   *  fact, not a facility one). */
  memberId: string | null;
}

function total(facilities: Facility[], key: "committed" | "outstanding"): number {
  return facilities.reduce((n, f) => n + (typeof f[key] === "number" ? f[key]! : 0), 0);
}

/**
 * WHICH FACILITY THE INSIGHT NAMED, resolved from the engine's own sentence.
 *
 * `deriveNextMove` returns a line, not a record. Re-deriving "the nearest
 * qualifying maturity" here would be the same ranking written twice, and the
 * header comment on nextMove.ts is explicit that writing it twice is how the
 * two drift. So this reads the answer back out of the sentence the engine
 * composed, using the engine's own naming: `${fmtMoney(committed)} ${product}`.
 * A rename inside nextMove.ts stops matching here and yields null — no
 * preselection — rather than silently preselecting the wrong loan.
 */
function memberNamedBy(move: NextMove, facilities: Facility[], relationship: string): string | null {
  if (move.kind !== "maturity") return null;
  for (const f of facilities) {
    const product = facilityProduct(f, relationship);
    const named = typeof f.committed === "number" ? `${fmtMoney(f.committed)} ${product}` : product;
    if (move.line.startsWith(`The ${named} matures `)) return f.loanId ?? null;
  }
  return null;
}

/**
 * The room's opening move, or null.
 *
 * NULL IS THE COMMON CASE AND IT IS NOT A FAILURE — it is the channel-none
 * doctrine applied to the greeting slot. No signal means the neutral question,
 * never an invented one. Everything is derived from the cockpit's own read and
 * from `meta.generatedAt`; nothing here reaches a clock.
 */
export function smartOpeningFor(args: {
  data: C360Data;
  bundle: BorrowerBundle | null;
  accountName: string;
  /** The package the room is anchored on, where it is anchored on one. */
  productPackageId: string | null;
}): SmartOpening | null {
  const today = args.data.meta?.generatedAt ?? "";
  if (!today) return null;
  /* A SIGNAL RANKED ACROSS EVERY PACKAGE IS NOT A SIGNAL (2026-09-02). With no
     anchor the package filter below narrows nothing, so `deriveNextMove` ranked
     maturity and utilisation over the WHOLE relationship and printed the winner
     as "The package is drawn to 90% of commitment" on a book drawn to 8.9%. A
     relationship staging several packages opens on the neutral question until
     the banker says which one this runs in, which is what null already means. */
  if (!args.productPackageId && mustChoosePackage(args.bundle, null)) return null;
  // BOOKED AND ACTIVE, scoped to the package the room stands in. A maturity on
  // a proposal is not a renewal this room can start, and a paid-off facility
  // has no maturity worth raising.
  const facilities = bookedFacilities(args.bundle)
    .filter(isActiveFacility)
    .filter((f) => !args.productPackageId || f.productPackageId === args.productPackageId);
  const move = deriveNextMove(
    {
      facilities,
      covenants: args.bundle?.covenants?.covenants ?? [],
      committed: total(facilities, "committed"),
      outstanding: total(facilities, "outstanding"),
      relationship: args.accountName,
    },
    today,
  );
  if (!move) return null;
  const route = ROUTE_FOR_KIND[move.kind];
  const yesLabel = YES_LABEL[move.kind];
  if (!route || !yesLabel) return null;
  return { line: move.line, route, yesLabel, memberId: memberNamedBy(move, facilities, args.accountName) };
}

/* -------------------------------------------------------------- route words */

/** "renew the revolver", "roll this over". */
const RENEW = /\b(renew|renews|renewal|renewing|roll(?:ing)?\s+(?:this|the|it)?\s*(?:over|forward))\b/i;
/** "new 5M equipment facility", "structure a new line". The noun form only:
 *  "add a covenant" is a MODIFICATION and must not be read as a new facility. */
const CREATE =
  /\bnew\s+(?:\$?[\d.,]+\s*(?:mm?|k|million)?\s+)?(?:[a-z]+\s+)?(?:facility|loan|line|revolver|package|term\s+loan|equipment|note)\b|\b(?:structure|originate)\s+(?:a|an|another)\b/i;
/** "modify the package", "amend the terms", "restructure this". */
const MODIFY = /\b(modify|modifies|modification|amend|amends|amendment|restructure|restructuring|reshape)\b/i;
/**
 * A CHANGE TO WHAT EXISTS, named without the word "modification".
 *
 * "increase the LoC to 20M" is a modification and a banker will never call it
 * one out loud. This is the fallback tier and it runs LAST, so an explicit
 * route word always wins over it.
 */
const CHANGE =
  /\b(increase|decrease|reduce|raise|lower|extend|shorten|change|set|move|bump|adjust|waive|drop|reprice[sd]?|add|remove|pledge|release)\b/i;

/**
 * THE ROUTE A TYPED LINE BINDS, before any route is bound.
 *
 * FREE TEXT ALWAYS WINS (founder, 2026-08-31): a banker who knows what they are
 * doing types it, the room binds, and the question retires without ever being
 * answered. Null where the line names no route at all — the room then repeats
 * the question rather than guessing, because guessing here picks an ENGINE.
 */
export function readRouteIntent(text: string): TypedRoute | null {
  const line = text.trim();
  if (!line) return null;
  if (RENEW.test(line)) return "renew";
  if (CREATE.test(line)) return "create";
  if (MODIFY.test(line)) return "modify";
  return CHANGE.test(line) ? "modify" : null;
}

/**
 * A LINE ASKING FOR A DIFFERENT ROUTE, inside a room already bound to one.
 *
 * Deliberately narrower than `readRouteIntent`: EXPLICIT route words only. A
 * renewal legitimately contains "increase the commitment to $20M", and reading
 * that as a request to leave the renewal room would take the banker out of the
 * room mid-sentence. Only the words that name a route can move the room, and
 * only when they name a different one.
 */
export function readRouteSwitch(text: string, current: WorkroomMode): TypedRoute | null {
  const line = text.trim();
  if (!line) return null;
  /* "AMEND THE COMMITMENT" INSIDE AN AMENDMENT IS NOT A ROUTE SWITCH (0.9.23).
     The modification words and the amendment words are the same words, so a
     banker doing exactly what the amend room is for would otherwise be offered
     the door out of it on every line. In an amend room an amendment word is
     the work, and only an explicit renewal or new-facility word moves them. */
  if (current === "amend" && AMEND_WORD.test(line) && !RENEW.test(line) && !CREATE.test(line)) return null;
  const route = RENEW.test(line) ? "renew" : CREATE.test(line) ? "create" : MODIFY.test(line) ? "modify" : null;
  return route && route !== current ? route : null;
}

/** The room's own word for a route, for the sentence that refuses to switch. */
export const ROUTE_WORD: Record<WorkroomMode, string> = {
  modify: "modification",
  renew: "renewal",
  create: "new facility",
  amend: "amendment",
};

/* ------------------------------------------------------- the amend route

   THE FOURTH CHIP IS CONDITIONAL, and that is the whole of its rule: it appears
   only where the room is standing in something that can be shaped in place (an
   editable in-flight version, or a package the cockpit created that is still
   before approval). `amendablePackage` in `book/packages.ts` is the single
   judgement; this module only carries the words.                            */

/** The amendment words, so a line inside an amend room is not read as a request
 *  to leave it. Deliberately the same family the modification regex matches. */
const AMEND_WORD = /\b(amend|amends|amendment|amending|shape|reshape|shaping)\b/i;

/** The amend chip, for a room whose anchor can carry one. It is NOT a
 *  `RouteChip`: that type is the three a sentence can name.
 *
 *  THE LABEL SAYS WHAT THE BANKER GETS (founder, 2026-09-13), in their words,
 *  rather than naming the write pair behind it. */
export const AMEND_CHIP: { label: string; route: WorkroomMode } = { label: "Shape this version", route: "amend" };
