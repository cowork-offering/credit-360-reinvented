import { describe, expect, it } from "vitest";
import type { BorrowerBundle, C360Data, Covenant } from "../../data/contract";
import {
  FACILITY_HANDOFF,
  NEUTRAL_QUESTION,
  REL_ROUTE_CHIPS,
  REL_ROUTE_WORD,
  asksForFacilityWork,
  isVersionRoute,
  readRelRouteIntent,
  readVersionRoute,
  readRelRouteSwitch,
  readsAsClientRequest,
  relOpeningFor,
} from "./relRoute";

/* =============================================================================
   THE RELATIONSHIP ROUTER.

   Which of the five reviews takes the session, and what the room is allowed to
   open on. The channel-none doctrine is the load-bearing rule here: a signal is
   derived from data the read actually carries or it is null, and null opens the
   neutral question rather than an invented one.
   ============================================================================= */

const TODAY = "2026-08-31";

function dataWith(covenants: Covenant[], generatedAt: string | null = TODAY): {
  data: C360Data;
  bundle: BorrowerBundle;
} {
  const bundle = {
    snapshot: { accountId: "001X", name: "Testco", primaryRiskRating: "4" },
    covenants: { covenants },
  } as unknown as BorrowerBundle;
  const data = {
    meta: generatedAt ? { generatedAt } : {},
    portfolio: { accounts: [] },
    borrower: bundle,
    borrowers: { "001X": bundle },
  } as unknown as C360Data;
  return { data, bundle };
}

/** A covenant due in `days`, clean. */
function due(days: number, type = "Debt Service Coverage", id = "cov-1"): Covenant {
  const d = new Date(Date.UTC(2026, 7, 31));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    covenantId: id,
    covenantType: type,
    nextEvaluationDate: d.toISOString().slice(0, 10),
    lastEvaluationStatus: "Compliant",
    latestComplianceStatus: "Pending",
  };
}

describe("the eight routes", () => {
  /* THE FIVE REVIEWS IN THE GOVERNANCE CALENDAR'S ORDER, then the one that
     AUTHORS, then the two that SHAPE THE VERSION (0.9.23). The intake is not a
     review and sits after the five for that reason: a banker scanning for a
     review meets the five first. The two version routes sit last because they
     are the narrowest: neither runs at all unless the relationship carries an
     editable version, or a package the cockpit created that nobody has booked. */
  it("offers exactly eight, the five reviews first and the two version routes last", () => {
    expect(REL_ROUTE_CHIPS.map((c) => c.route)).toEqual([
      "annual",
      "covenant",
      "valuation",
      "rating",
      "service",
      "intake",
      "versionCovenant",
      "versionPledge",
    ]);
  });

  it("names the two version routes in the founder's own words", () => {
    const byRoute = new Map(REL_ROUTE_CHIPS.map((c) => [c.route, c.label]));
    expect(byRoute.get("versionCovenant")).toBe("Add a covenant to this version");
    expect(byRoute.get("versionPledge")).toBe("Pledge collateral to this version");
    expect(isVersionRoute("versionCovenant")).toBe(true);
    expect(isVersionRoute("versionPledge")).toBe(true);
    for (const route of ["annual", "covenant", "valuation", "rating", "service", "intake"] as const) {
      expect(isVersionRoute(route), route).toBe(false);
    }
    expect(isVersionRoute(null)).toBe(false);
  });

  it("names each route in banker grammar", () => {
    expect(REL_ROUTE_WORD.annual).toBe("annual review");
    expect(REL_ROUTE_WORD.valuation).toBe("collateral valuation");
    expect(REL_ROUTE_WORD.service).toBe("service request");
  });

  it("asks the neutral question without naming the five twice", () => {
    // The chips carry the list. A question that also read it out would spend
    // the opening view's whole budget saying the same thing twice.
    for (const chip of REL_ROUTE_CHIPS) expect(NEUTRAL_QUESTION).not.toContain(chip.label);
  });

  it("keeps house style: no em dashes, no exclamation points", () => {
    const copy = [NEUTRAL_QUESTION, FACILITY_HANDOFF, ...Object.values(REL_ROUTE_WORD)].join(" ");
    expect(copy).not.toMatch(/[—!]/);
  });
});

describe("the smart opening", () => {
  it("is null with no covenants at all, so the room asks the neutral question", () => {
    const { data, bundle } = dataWith([]);
    expect(relOpeningFor({ data, bundle })).toBeNull();
  });

  it("is null with no clock, rather than guessing one", () => {
    const { data, bundle } = dataWith([due(6)], null);
    expect(relOpeningFor({ data, bundle })).toBeNull();
  });

  it("leads on a test due soon, and routes it to the covenant review", () => {
    const { data, bundle } = dataWith([due(6)]);
    const opening = relOpeningFor({ data, bundle })!;
    expect(opening.line).toBe("The Debt Service Coverage test is due in 6 days. Run the covenant review?");
    expect(opening.route).toBe("covenant");
    expect(opening.covenantId).toBe("cov-1");
  });

  it("says today rather than in 0 days", () => {
    const { data, bundle } = dataWith([due(0)]);
    expect(relOpeningFor({ data, bundle })!.line).toContain("is due today.");
  });

  it("leads on the NEAREST of several due tests", () => {
    const { data, bundle } = dataWith([due(30, "Fixed Charge Coverage", "far"), due(4, "Leverage", "near")]);
    expect(relOpeningFor({ data, bundle })!.covenantId).toBe("near");
  });

  it("ignores a test due beyond the window", () => {
    const { data, bundle } = dataWith([due(120)]);
    expect(relOpeningFor({ data, bundle })).toBeNull();
  });

  it("leads on an OVERDUE test before a due one, and says how long", () => {
    const { data, bundle } = dataWith([due(3, "Leverage", "soon"), due(-12, "Fixed Charge Coverage", "late")]);
    const opening = relOpeningFor({ data, bundle })!;
    expect(opening.line).toBe("The Fixed Charge Coverage test was due 12 days ago. Run the covenant review?");
    expect(opening.covenantId).toBe("late");
  });

  it("leads on a FINANCIAL BREACH above everything, and routes it to the rating review", () => {
    const { data, bundle } = dataWith([
      due(2, "Leverage", "soon"),
      { covenantId: "bad", covenantType: "Debt Service Coverage", breached: true, latestComplianceStatus: "Exception" },
    ]);
    const opening = relOpeningFor({ data, bundle })!;
    expect(opening.line).toBe("The Debt Service Coverage test is in breach. Run the risk-rating review?");
    expect(opening.route).toBe("rating");
  });

  it("does NOT read an administrative Exception as a breach", () => {
    // nCino forces Exception onto any row whose due date has passed, measured or
    // not. Reading that as a breach would overstate deterioration on most of the
    // book, so the shared classifier's answer is the one that counts.
    const { data, bundle } = dataWith([
      { covenantId: "adm", covenantType: "Leverage", latestComplianceStatus: "Exception", nextEvaluationDate: "2026-09-05" },
    ]);
    const opening = relOpeningFor({ data, bundle })!;
    expect(opening.route).toBe("covenant");
    expect(opening.line).not.toContain("breach");
  });

  it("never leads on a waived test", () => {
    const { data, bundle } = dataWith([
      { covenantId: "w", covenantType: "Leverage", covenantStatus: "Waived", nextEvaluationDate: "2026-09-05" },
    ]);
    expect(relOpeningFor({ data, bundle })).toBeNull();
  });

  it("replaces the whole noun phrase when the covenant type is missing", () => {
    const { data, bundle } = dataWith([{ covenantId: "x", nextEvaluationDate: "2026-09-05", lastEvaluationStatus: "Compliant" }]);
    const line = relOpeningFor({ data, bundle })!.line;
    expect(line).toContain("The covenant test is due");
    expect(line).not.toContain("covenant covenant");
  });
});

describe("reading a route out of a typed line", () => {
  it("binds each of the five from the words a banker uses", () => {
    expect(readRelRouteIntent("run the annual review")).toBe("annual");
    expect(readRelRouteIntent("let's do the covenant review")).toBe("covenant");
    expect(readRelRouteIntent("revalue the collateral")).toBe("valuation");
    expect(readRelRouteIntent("re-rate this borrower")).toBe("rating");
    expect(readRelRouteIntent("raise a ticket for a payoff quote")).toBe("service");
  });

  it("reads the narrowest phrase first, so a valuation is not a rating", () => {
    // "collateral valuation" contains neither word the rating test looks for,
    // and the valuation test runs before the rating one regardless.
    expect(readRelRouteIntent("collateral valuation")).toBe("valuation");
    expect(readRelRouteIntent("review the risk rating")).toBe("rating");
  });

  it("reads 'annual covenant review' as the COVENANT review, and that is the honest read", () => {
    // A banker who says this means the covenant review that falls due annually,
    // not the periodic review of the whole relationship. The annual test looks
    // for "annual review" as a phrase precisely so this line does not steal it.
    expect(readRelRouteIntent("annual covenant review")).toBe("covenant");
    expect(readRelRouteIntent("run the annual review")).toBe("annual");
  });

  it("is null where the line names no review, so the room asks again", () => {
    // Guessing here picks a WRITE PATH, which is not a guess worth making.
    expect(readRelRouteIntent("what is going on with this client")).toBeNull();
    expect(readRelRouteIntent("")).toBeNull();
  });
});

describe("switching route mid-session", () => {
  it("moves only on a DIFFERENT review", () => {
    expect(readRelRouteSwitch("run the covenant review", "covenant")).toBeNull();
    expect(readRelRouteSwitch("actually value the collateral", "covenant")).toBe("valuation");
  });

  it("does not move on a line that merely mentions the other subject", () => {
    expect(readRelRouteSwitch("the collateral behind it is fine", "covenant")).toBeNull();
  });
});

describe("facility work", () => {
  it("recognises the four things this room does not do", () => {
    expect(asksForFacilityWork("pledge the receivables to the LoC")).toBe(true);
    expect(asksForFacilityWork("renew the revolver")).toBe(true);
    expect(asksForFacilityWork("modify the term loan")).toBe(true);
    expect(asksForFacilityWork("structure a new facility")).toBe(true);
  });

  it("does NOT claim a relationship-level create as facility work", () => {
    // Creating a covenant on the Account and creating a collateral the borrower
    // owns both live in THIS room, so "create" and "add" are deliberately not
    // facility words.
    expect(asksForFacilityWork("add a covenant on the relationship")).toBe(false);
    expect(asksForFacilityWork("create a new collateral asset")).toBe(false);
  });

  /* THE INTAKE DRIVE CAUGHT THIS, 2026-09-03. A covenant note citing the paper
     the terms are written on is not a request to amend a facility, and the
     handoff was eating the note. */
  it("reads the agreement's own NAME as a document, not as an amendment", () => {
    expect(asksForFacilityWork("from the amended and restated credit agreement")).toBe(false);
    expect(asksForFacilityWork("the facility as amended in June")).toBe(false);
    // A line that asks for an amendment AND cites the agreement still hands off.
    expect(asksForFacilityWork("amend the equipment loan, see the amended and restated agreement")).toBe(true);
    expect(asksForFacilityWork("amend the covenant on the equipment loan")).toBe(true);
  });

  it("hands off in one professional line that names where the work lives", () => {
    expect(FACILITY_HANDOFF).toContain("Facility Actions");
    expect(FACILITY_HANDOFF).not.toMatch(/[—!]/);
  });

  /* PERMANENT COVER (backlog item 13). The handoff counted FIVE reviews after
     the intake route made six, and it is the most frequently fired string in
     the room: three push sites. The count and the room's own route vocabulary
     are asserted together, so adding a seventh route fails here rather than in
     front of a banker. */
  it("counts the reviews this room actually takes", () => {
    expect(Object.keys(REL_ROUTE_WORD)).toHaveLength(8);
    /* THE HANDOFF STILL COUNTS SIX REVIEWS, and that stays exact: the two
       version routes are not reviews, they shape a package nobody has booked.
       What the handoff gained is the second sentence naming them, because this
       room pledges collateral now and a handoff that sent every pledge to
       Facility Actions would send the banker to a room that cannot take it. */
    expect(FACILITY_HANDOFF).toContain("This room takes the six reviews.");
    expect(FACILITY_HANDOFF).toContain("It also shapes the version already in flight");
    expect(FACILITY_HANDOFF).toContain("Pledging security onto a booked facility");
  });
});

describe("a route word inside an ANSWER is not a request to change review", () => {
  /* THE HEADLESS DRIVE CAUGHT THIS on 2026-09-02, line 13. "Copy of the June
     covenant compliance certificate" is the SUBJECT of a service request, and
     it re-routed the room to the covenant review: the switch read ran ahead of
     the open text step that had just asked for it. */
  it("keeps the room on the service request while a text step is open", () => {
    expect(
      readRelRouteSwitch("Copy of the June covenant compliance certificate", "service", { openTextStep: true }),
    ).toBeNull();
    expect(
      readRelRouteSwitch("The covenants are clean and the collateral is current.", "annual", { openTextStep: true }),
    ).toBeNull();
  });

  it("still switches on the short form a banker actually uses", () => {
    expect(readRelRouteSwitch("covenant review", "service", { openTextStep: true })).toBe("covenant");
    expect(readRelRouteSwitch("run the covenant review", "service", { openTextStep: true })).toBe("covenant");
  });

  it("is unchanged everywhere else: a chips or number step switches on any form", () => {
    expect(readRelRouteSwitch("Copy of the June covenant compliance certificate", "service")).toBe("covenant");
    expect(readRelRouteSwitch("covenant review", "annual")).toBe("covenant");
    expect(readRelRouteSwitch("covenant review", "covenant")).toBeNull();
  });
});

/* =============================================================================
   THE CLIENT'S ASK, WHICH NAMES NO REVIEW.

   The commonest line in this room binds nothing: "james wants the june
   certificate" carries no route word at all, so it fell to the five-way, which
   reads the annual review and the rating back at a banker running neither. The
   read below offers the service request and never binds it.
   ============================================================================= */

describe("a plain client request is read as one, and still not routed", () => {
  it("reads a request for a document or a service", () => {
    for (const line of [
      "james wants the june certificate",
      "send them the payoff letter",
      "the client asked for a copy of the statement",
      "they are chasing the lien release",
      "he needs wire instructions",
      "would like a balance confirmation",
    ]) {
      expect(readsAsClientRequest(line), line).toBe(true);
    }
  });

  it("needs BOTH halves: somebody asking, and a thing servicing files", () => {
    for (const line of [
      "james wants a downgrade", // asking, but for no document
      "the june certificate", // a document, but nobody asking
      "run the annual review",
      "",
    ]) {
      expect(readsAsClientRequest(line), line).toBe(false);
    }
  });

  it("never binds a route, and never shadows one that does", () => {
    // The route read runs FIRST, so a request naming one of the five is that
    // review, not a service request. These lines never reach the client read.
    expect(readRelRouteIntent("the client wants a covenant waiver")).toBe("covenant");
    // And where BOTH reads match, the route read runs first and wins: this one
    // is a valuation, not a service request, although a client is asking for a
    // copy of something.
    expect(readsAsClientRequest("they want a copy of the appraisal")).toBe(true);
    expect(readRelRouteIntent("they want a copy of the appraisal")).toBe("valuation");
    // And the line that started this returns null: the offer is a chip, not a
    // binding.
    expect(readRelRouteIntent("james wants the june certificate")).toBeNull();
    // "payoff" is already a service word, so this one binds without the offer.
    expect(readRelRouteIntent("send them the payoff letter")).toBe("service");
  });
});

/* =============================================================================
   THE VERSION READ (0.9.23): a line that names the UNBOOKED version.

   The reader runs FIRST in `readRelRouteIntent`, ahead of the intake and ahead
   of every review word, on the same specificity rule that puts the intake ahead
   of the covenant review. Two words carry it and only two, and the tests below
   are as much about what it does NOT take as about what it does.
   ============================================================================= */

describe("the version routes read off a typed line", () => {
  it("binds the covenant add and the pledge, from the room's own chip labels", () => {
    // THE COMPOSER'S OWN TEMPLATE. `relationshipTopics()` writes
    // `run the <label>` for every chip, so the chip label has to bind.
    expect(readRelRouteIntent("run the add a covenant to this version")).toBe("versionCovenant");
    expect(readRelRouteIntent("run the pledge collateral to this version")).toBe("versionPledge");
  });

  it("binds the way a banker actually writes it", () => {
    expect(readVersionRoute("add a covenant to the version")).toBe("versionCovenant");
    expect(readVersionRoute("put a covenant on the in-flight modification")).toBe("versionCovenant");
    expect(readVersionRoute("pledge the warehouse to the version")).toBe("versionPledge");
    expect(readVersionRoute("add collateral to the in flight version")).toBe("versionPledge");
  });

  it("takes no line that does not name the version", () => {
    expect(readVersionRoute("add a covenant to this relationship")).toBeNull();
    expect(readVersionRoute("pledge the equipment to the 8M loan")).toBeNull();
    expect(readVersionRoute("")).toBeNull();
    // Named the version and asked for nothing to be written on it.
    expect(readVersionRoute("open the version")).toBeNull();
  });

  it("does not shadow the six routes it runs ahead of", () => {
    expect(readRelRouteIntent("run the covenant review")).toBe("covenant");
    expect(readRelRouteIntent("add a relationship covenant: minimum tangible net worth of 12M")).toBe("intake");
    expect(readRelRouteIntent("collateral valuation")).toBe("valuation");
    // "the modification" is a word a banker uses for a review's SUBJECT, so it
    // is deliberately not a version word: guessing here picks a write path.
    expect(readVersionRoute("run the covenant review on the modification")).toBeNull();
  });

  it("keeps a version pledge out of the facility handoff", () => {
    // `FACILITY_WORK` reads `pledge\w*`, so this line used to be sent to a room
    // that cannot take it: a credit action runs against a BOOKED loan and a
    // version holds none.
    expect(asksForFacilityWork("pledge collateral to this version")).toBe(false);
    // And a pledge onto a booked facility still hands off, unchanged.
    expect(asksForFacilityWork("pledge the equipment to the 8M loan")).toBe(true);
  });
});
