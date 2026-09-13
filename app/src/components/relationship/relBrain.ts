import type { BrainEnvelope, BrainFacility, BrainFileable, BrainMail, BrainTurn } from "../../channel/brainLane";
import { capEnvelope } from "../../channel/brainLane";
import type { Facility } from "../../data/contract";
import { facilityProduct } from "../../data/facilityStage";
import { fmtMoney } from "../../data/format";
import { isActiveFacility } from "../../data/worklist";
import { buildReadBlocks, threadDigest } from "../workroom/readBlocks";
import type { ReadSource } from "../workroom/readCard";
import { relEntities, type RelBook } from "./relBook";
import { CREATE_GAPS, DUAL_RATING_NOT_CARRIED, OVERRIDE_NEEDS_A_REASON, type RelContext } from "./reviewFlows";
import { NO_PLEDGE_NO_LIEN } from "./intakeFlows";
import { FACILITY_HANDOFF, REL_ROUTE_WORD, type RelRoute } from "./relRoute";

/* =============================================================================
   THE RELATIONSHIP ROOM'S ENVELOPE.

   The same v2 envelope the facility room sends, in this room's own vocabulary:
   five routes rather than three, a governance ritual rather than a change set,
   and a FILEABLE MAP that matters more here than anywhere else.

   THE REFUSALS ARE THE POINT. This room's honesty is that it names what the org
   cannot file (a standalone covenant on the relationship, an owned but
   unpledged asset, a grade override with no observed wire name) instead of
   composing a payload nobody deployed. A desk answering for this room must
   refuse the SAME things BY NAME, so the map travels with every line. A brain
   that invented one of these capabilities would be worse than the deterministic
   room it replaced.
   ============================================================================= */

/**
 * The six routes, as words a reply may NAME while the question is open.
 *
 * THE TWO VERSION ROUTES ARE DELIBERATELY NOT HERE (0.9.23). A desk reply that
 * named one would bind a WRITE PATH onto an UNBOOKED package out of a sentence
 * the room never put in front of the banker, and the version routes refuse to
 * run at all unless the banker has picked the version off the package ask. They
 * are bound by a chip, or by a typed line this room reads itself, and by
 * nothing a model returned.
 */
export const REL_ROUTE_WORDS = new Set<string>(["annual", "covenant", "valuation", "rating", "service", "intake"]);

/** What each review produces, in the org's own terms. Read from the room's own
 *  route vocabulary rather than written a second time. */
const PRODUCES: Record<RelRoute, string> = {
  annual: "an annual review assessment against the product package",
  covenant: "an assessment on covenants that already exist",
  valuation: "a valuation on collateral that already exists",
  rating: "a risk-rating review against the relationship",
  service: "a service request case",
  intake:
    "a covenant authored on the relationship, or a collateral asset the borrower owns, each with its account junction and neither one touching a facility",
  versionCovenant:
    "a covenant attached to one facility on the UNBOOKED version in flight, authored or taken off the borrower's own book, with no credit action and no second version",
  versionPledge:
    "a collateral pledge onto one facility on the UNBOOKED version in flight, with the asset and its ownership filed first where it is new, and nothing on the booked package behind it moved",
};

/** The facilities the relationship carries, scoped to its package. The same
 *  scoping every read in the room uses, so the envelope and the glass agree. */
function facilitiesOf(ctx: RelContext): BrainFacility[] {
  return (ctx.bundle?.exposure?.facilities ?? [])
    .filter(isActiveFacility)
    .filter((f: Facility) => !ctx.productPackageId || f.productPackageId === ctx.productPackageId)
    .filter((f: Facility) => Boolean(f.loanId))
    .map((f: Facility) => ({
      loanId: f.loanId as string,
      label: facilityProduct(f, ctx.accountName) || "Facility",
      commitment: typeof f.committed === "number" ? fmtMoney(f.committed) : "not carried",
    }));
}

/** WHAT THIS ROUTE CAN AND CANNOT FILE, verbatim from the room's own gaps. */
function relFileable(route: RelRoute | null): BrainFileable {
  const cannot: BrainFileable["cannot"] = [
    { what: "any change to a facility", why: FACILITY_HANDOFF },
  ];
  /* THE TWO CREATE GAPS ARE THE COVENANT AND VALUATION ROUTES', NOT THE ROOM'S.
     They say that the route the desk is answering for cannot author, which is
     true of a review and false of the intake: the intake route exists precisely
     to file those two. Naming them on an intake line would have the desk refuse
     the thing the banker is standing in the middle of doing. */
  if (route === "covenant" || route === null) {
    cannot.push({ what: CREATE_GAPS.covenant.what, why: CREATE_GAPS.covenant.line });
  }
  if (route === "valuation" || route === null) {
    cannot.push({ what: CREATE_GAPS.collateral.what, why: CREATE_GAPS.collateral.line });
  }
  if (route === "intake") {
    cannot.push({ what: "a pledge, a lien or an advance rate", why: NO_PLEDGE_NO_LIEN });
    cannot.push({ what: "a threshold nobody gave you", why: "The threshold comes from the approved credit agreement. Propose what this relationship already tests; never set one." });
  }
  /* THE OVERRIDE IS OFF THIS LIST. It was on it, on the reasoning that the
     input's wire name had never been observed; it is deployed and tested, so
     the room collects it. What the desk must still refuse BY NAME is an
     override with no written reason, and a dual rating this org does not hold. */
  if (route === "rating" || route === null) {
    cannot.push({ what: "a grade override with no written reason", why: OVERRIDE_NEEDS_A_REASON });
    cannot.push({ what: "a probability of default or loss given default", why: DUAL_RATING_NOT_CARRIED });
  }
  return {
    files: route ? [PRODUCES[route]] : Object.values(PRODUCES),
    cannot,
  };
}

export function buildRelEnvelope(args: {
  line: string;
  route: RelRoute | null;
  ctx: RelContext;
  reads?: ReadSource;
  thread?: BrainTurn[];
  /** What the review has collected so far: the question, and the answer given. */
  collected: Array<{ title: string; target: string; after: string }>;
  /** THE CLIENT'S OWN MESSAGE, where this room found one. Top level on the
   *  envelope, never inside `reads`: it is a request, not a read, and no figure
   *  the room prints ever comes from it. */
  mail?: BrainMail | null;
  /** The book this relationship already carries, for the greeting's own rail. */
  book?: RelBook | null;
}): BrainEnvelope {
  const routeOpen = args.route === null;
  const mail = args.mail ?? undefined;
  const entities = args.book ? relEntities(args.book) : [];
  return capEnvelope({
    v: 2,
    line: args.line,
    room: "relationship",
    relationship: args.ctx.accountName,
    route: args.route ? REL_ROUTE_WORD[args.route] : "unbound",
    routeOpen: routeOpen || undefined,
    routeOptions: routeOpen ? [...REL_ROUTE_WORDS] : undefined,
    // This room is anchored on the RELATIONSHIP; the package is what its bulk
    // tools file against, and it is named rather than given a label of its own.
    packageName: args.ctx.productPackageId ? "the relationship's product package" : "no product package on this relationship",
    productPackageId: args.ctx.productPackageId,
    // NOTHING IS "SELECTED" IN A REVIEW. The ritual runs over the relationship,
    // and a facility named here would read as a target it does not have.
    selectedFacility: null,
    facilities: facilitiesOf(args.ctx),
    staged: args.collected,
    /* `hasMail` adds the one line to `notCarried` that lets a reply refuse a
       THREAD by name: this room reads one message, never a conversation. */
    reads: buildReadBlocks(args.reads, Boolean(mail)),
    mail,
    entities: entities.length ? entities : undefined,
    thread: args.thread ? threadDigest(args.thread) : undefined,
    fileable: relFileable(args.route),
    grounding: "plugin-skill:workroom-brain",
  });
}
