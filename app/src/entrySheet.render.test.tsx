// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import live from "../../artifact/live-data.json";
import { Workroom, neutralAsk, type WorkroomRouter } from "./components/workroom/Workroom";
import { entryRecapText, entryStateLine } from "./components/workroom/EntrySheet";
import { RelationshipRoom, neutralRelAsk, type RelRouter } from "./components/relationship/RelationshipRoom";
import { relContextFor } from "./components/relationship/reviewFlows";
import { createModifyEngine } from "./workroom/modifyEngine";
import { clearComposed } from "./workroom/engine";
import { workroomContextFor } from "./workroom/openWorkroom";
import { IN_FLIGHT_REFUSAL, NOT_AMENDABLE_REFUSAL, amendablePackage, packageRoster } from "./book/packages";
import { VERSION_AMEND_REFUSAL } from "./workroom/amendEngine";
import { resetSessionDoor } from "./channel/sampleDoor";
import { resetCatalog } from "./channel/catalog";
import type { BorrowerBundle, C360Data, Facility } from "./data/contract";

/* =============================================================================
   THE ENTRY SHEET, IN BOTH ROOMS.

   FOUNDER, design-intent gate 2026-09-14 (knowledge/DESIGN-0.9.24-ENTRY.md):
   "the first thing on the glass is what there is to act on and the three doors,
   not a greeting bubble with pills under it."

   WHAT IS HELD HERE, and it is the whole of what the gate approved:

     the sheet     the relationship by name, ONE line of state, the doors, the
                   read chips under them, and in the relationship room the
                   briefing UNDER the doors.
     the doors     one per route the room offers TODAY, on this book. A route
                   the book has shut stays on the sheet, disabled, carrying the
                   book's own reason verbatim (A27.3).
     the fold      picking a door leaves one recap line and the room's own flow
                   under it.

   THREE BOOKS, NOT ONE (founder, 2026-09-13: "it is not only Hartwell, it needs
   to work everywhere"). Hartwell carries two packages and, in the fork fixture,
   a version in flight; Kingsley is one package; Piedmont has nothing booked.
   Every expectation below is DERIVED from the book the case opens, so a case is
   never a transcription of one relationship's figures.
   ============================================================================= */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const KINGSLEY = "001SAMPLE0000KGSL";
const PIEDMONT = "001bb00001DLtRMAA1";
/** Hartwell's booked C&I package, and the version the fork fixture builds. */
const SOURCE = "a5Fbb000000IHFJEA4";
const VERSION = "a5Fbb000000J6PtEAK";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  resetSessionDoor();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  clearComposed();
  resetCatalog();
});

const text = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const doors = (room: HTMLElement) => [...room.querySelectorAll<HTMLButtonElement>(".wk-entry-door")];
const doorIds = (room: HTMLElement) => doors(room).map((d) => d.dataset.door);
const door = (room: HTMLElement, id: string) => doors(room).find((d) => d.dataset.door === id)!;
const doorLine = (room: HTMLElement, id: string) => text(door(room, id).querySelector(".wk-entry-dw"));
const state = (room: HTMLElement) => text(room.querySelector(".wk-entry-state"));

/** The org's own shape for a modification version: every booked member copied
 *  at an unbooked stage. The published Hartwell bundle predates the real one. */
function withVersion(bundle: BorrowerBundle): BorrowerBundle {
  const next = JSON.parse(JSON.stringify(bundle)) as BorrowerBundle;
  const booked = (bundle.exposure?.facilities ?? []).filter((f) => f.productPackageId === SOURCE && f.stage === "Booked");
  const copies: Facility[] = booked.map((f, i) => ({
    ...(JSON.parse(JSON.stringify(f)) as Facility),
    loanId: `a4Zbb000002IEp${i}EAG`,
    productPackageId: VERSION,
    stage: "Qualification",
  }));
  next.exposure!.facilities = [...booked, ...copies];
  return next;
}

/* -------------------------------------------------------- the facility room */

function openFacility(opts: {
  accountId: string;
  bundle?: BorrowerBundle;
  productPackageId?: string | null;
  /** Null is a BOUND room: the sheet has been answered and folded. */
  question?: ReturnType<typeof neutralAsk> | null;
  memo?: boolean;
}) {
  const bundle = opts.bundle ?? data.borrowers![opts.accountId];
  const bound: string[] = [];
  const context = workroomContextFor({
    mode: "modify",
    data,
    bundle,
    accountId: opts.accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: opts.productPackageId ?? null,
  });
  const router: WorkroomRouter = {
    question: opts.question === undefined ? neutralAsk() : opts.question,
    say: null,
    onBind: (route) => bound.push(route),
    onRestart: () => {},
    ...(opts.memo ? { onMemo: () => bound.push("memo") } : {}),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Workroom
        context={context}
        engine={createModifyEngine({ context, data, bundle })}
        router={router}
        reads={{
          bundle,
          accountName: context.accountName,
          productPackageId: context.productPackageId,
          generatedAt: data.meta?.generatedAt,
        }}
        onClose={() => {}}
      />,
    );
  });
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound, bundle };
}

describe("the entry sheet, in the facility room", () => {
  it("names the relationship and states what there is to act on, once", () => {
    const { room, bundle } = openFacility({ accountId: HARTWELL });
    expect(text(room.querySelector(".wk-entry .wk-sheet-t"))).toBe(bundle.snapshot!.name);
    // Derived, never transcribed: the same clauses off the same read.
    expect(state(room)).toBe(
      entryStateLine({
        grade: bundle.snapshot!.primaryRiskRating,
        committed: bundle.exposure!.totalCommitted,
        packages: packageRoster(bundle),
      }),
    );
    expect(state(room)).toContain("Booked at Grade 4");
    // ONE headline, and it is the sheet's: no greeting bubble at the opening.
    expect(room.querySelector(".wk-openbub")).toBeNull();
    expect(room.querySelectorAll(".wk-entry")).toHaveLength(1);
  });

  it("puts the read chips under the doors and the explainer in the corner", () => {
    const { room } = openFacility({ accountId: HARTWELL });
    const reads = room.querySelector(".wk-entry-reads")!;
    expect(reads.querySelectorAll(".wk-srcchip").length).toBeGreaterThan(0);
    // The reads come AFTER the doors on the sheet: the decision leads.
    expect(room.querySelector(".wk-entry-doors")!.compareDocumentPosition(reads)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(room.querySelector(".wk-entry > .wk-whybtn")).toBeTruthy();
  });

  it("offers three routes and the memo on a book with nothing in flight (Kingsley, one package)", () => {
    const { room, bundle } = openFacility({ accountId: KINGSLEY, memo: true });
    expect(doorIds(room)).toEqual(["modify", "renew", "create", "memo"]);
    // Nothing is shut: Kingsley carries one package and no version.
    expect(doors(room).every((d) => !d.disabled)).toBe(true);
    expect(packageRoster(bundle).some((p) => p.inFlightVersion)).toBe(false);
    expect(state(room)).not.toContain("in flight");
  });

  it("states a book with nothing booked as exactly that (Piedmont)", () => {
    const { room, bundle } = openFacility({ accountId: PIEDMONT });
    const roster = packageRoster(bundle);
    const booked = roster.reduce((n, p) => n + p.booked, 0);
    expect(booked).toBe(0);
    expect(state(room)).toContain("nothing booked yet");
    // And the routes are still offered: what a credit action can run against is
    // the engine's call, made in the room, not a door quietly removed here.
    // The amend door is on the sheet too, and correctly: a package the cockpit
    // can still shape in place is exactly a package nobody has booked.
    expect(doorIds(room)).toEqual(["modify", "renew", "create", "amend"]);
  });

  it("shuts the two forking routes on a book with a version in flight (Hartwell)", () => {
    const bundle = withVersion(data.borrowers![HARTWELL]);
    const { room } = openFacility({ accountId: HARTWELL, bundle, productPackageId: SOURCE });

    expect(door(room, "modify").disabled).toBe(true);
    expect(doorLine(room, "modify")).toBe(IN_FLIGHT_REFUSAL);
    expect(door(room, "renew").disabled).toBe(true);
    expect(doorLine(room, "renew")).toBe(IN_FLIGHT_REFUSAL);
    // A new facility joins a package, it does not fork one, so its door is open.
    expect(door(room, "create").disabled).toBe(false);
    // NEVER HIDDEN (A27.3): the map of what exists stays in front of the banker.
    expect(doorIds(room)).toContain("modify");
  });

  it("offers Shape this version, and shuts the forks, standing IN the version", () => {
    const bundle = withVersion(data.borrowers![HARTWELL]);
    const { room } = openFacility({ accountId: HARTWELL, bundle, productPackageId: VERSION });

    expect(packageRoster(bundle).filter(amendablePackage).map((p) => p.id)).toContain(VERSION);
    expect(doorIds(room)).toEqual(["modify", "renew", "create", "amend"]);
    expect(door(room, "amend").disabled).toBe(false);
    expect(doorLine(room, "amend")).toBe("Shapes the version the org already holds.");
    expect(doorLine(room, "modify")).toBe(VERSION_AMEND_REFUSAL);
    expect(state(room)).toContain("a modification in flight, editable until approval");
  });

  it("binds the route the door names, and nothing else", () => {
    const { room, bound } = openFacility({ accountId: KINGSLEY });
    act(() => door(room, "renew").click());
    expect(bound).toEqual(["renew"]);
  });

  it("folds into one recap line, with the room's own flow under it", () => {
    // A bound room: the door was taken and the question is answered.
    const { room } = openFacility({ accountId: KINGSLEY, question: null });
    expect(room.querySelector(".wk-entry")).toBeNull();
    const recap = room.querySelector('[data-recap="entry"]')!;
    expect(recap).toBeTruthy();
    expect(text(recap)).toBe(entryRecapText("Modify"));
    expect(text(recap)).toBe("Modify, chosen");
    // It carries no control: the sheet asked one question and this is the answer.
    expect(recap.tagName).toBe("DIV");
    // And today's flow is under it, starting with the room's own position.
    const bubble = room.querySelector(".wk-openbub")!;
    expect(bubble).toBeTruthy();
    expect(recap.compareDocumentPosition(bubble)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("lands the scoped package question under the fold where the route needs one", () => {
    const { room } = openFacility({ accountId: HARTWELL, question: null });
    // Hartwell stages more than one package and none is anchored, so the bound
    // room asks which one this modification runs in.
    expect(text(room.querySelector(".wk-headline"))).toContain("Which package does this run in?");
  });
});

/* ---------------------------------------------------- the relationship room */

function openRelationship(accountId: string, opts: { bound?: boolean } = {}) {
  const bundle = data.borrowers![accountId] as BorrowerBundle;
  const ctx = relContextFor({
    data,
    bundle,
    accountId,
    accountName: bundle.snapshot!.name!,
    productPackageId: null,
  });
  const bound: string[] = [];
  const neutral = () => neutralRelAsk({ data, accountId, packages: ctx.packages });
  const router: RelRouter = {
    question: opts.bound ? null : neutral(),
    say: null,
    preselectCovenantId: null,
    neutral,
    onBind: (route) => bound.push(route),
    onRestart: () => {},
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <RelationshipRoom
        ctx={ctx}
        route={opts.bound ? "covenant" : null}
        router={router}
        onClose={() => {}}
      />,
    );
  });
  act(() => {
    vi.advanceTimersByTime(4000);
  });
  return { room: document.querySelector<HTMLElement>(".wk-room")!, bound, ctx, bundle };
}

describe("the entry sheet, in the relationship room", () => {
  it("carries the briefing UNDER the doors, on the same sheet", () => {
    const { room } = openRelationship(HARTWELL);
    const sheet = room.querySelector(".wk-entry")!;
    const briefing = sheet.querySelector(".bf")!;
    const row = sheet.querySelector(".wk-entry-doors")!;
    expect(briefing).toBeTruthy();
    // The doors are on the first screen; the briefing is the why beneath them
    // (gate 2026-09-14: above the doors it pushed every door below the fold).
    expect(row.compareDocumentPosition(briefing)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // One briefing, not one on the sheet and one beside it.
    expect(room.querySelectorAll(".bf")).toHaveLength(1);
  });

  it("offers the six reviews and the two version routes, every time", () => {
    const { room } = openRelationship(HARTWELL);
    expect(doorIds(room)).toEqual([
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

  it("shuts the version routes, saying of the relationship what the registry says of a package", () => {
    const { room, ctx } = openRelationship(HARTWELL);
    expect(ctx.packages.some(amendablePackage)).toBe(false);
    for (const id of ["versionCovenant", "versionPledge"]) {
      expect(door(room, id).disabled).toBe(true);
      // No package is chosen on this sheet, so the registry's "this package is
      // booked" is restated at relationship level (gate 2026-09-14).
      expect(doorLine(room, id)).toBe(
        "Nothing on this relationship is in flight to amend: every package is booked. Open Modify on a facility and the plan versions it.",
      );
      expect(doorLine(room, id)).not.toBe(NOT_AMENDABLE_REFUSAL);
    }
    // And a shut door is still on the sheet: the map is what the banker came for.
    expect(doorIds(room)).toContain("versionPledge");
  });

  it("states the relationship on the sheet, on a one-package book too (Kingsley)", () => {
    const { room, bundle } = openRelationship(KINGSLEY);
    expect(text(room.querySelector(".wk-entry .wk-sheet-t"))).toBe(bundle.snapshot!.name);
    expect(state(room)).toBe(
      entryStateLine({
        grade: bundle.snapshot!.primaryRiskRating,
        committed: bundle.exposure!.totalCommitted,
        packages: packageRoster(bundle),
      }),
    );
  });

  it("binds the review the door names", () => {
    const { room, bound } = openRelationship(KINGSLEY);
    act(() => door(room, "valuation").click());
    expect(bound).toEqual(["valuation"]);
  });

  it("folds into one recap line once a review is bound", () => {
    const { room } = openRelationship(HARTWELL, { bound: true });
    expect(room.querySelector(".wk-entry")).toBeNull();
    expect(text(room.querySelector('[data-recap="entry"]'))).toBe("Covenant review, chosen");
  });
});

/* ------------------------------------------------------------- the state line

   A PURE COMPOSITION, so the clause rules are held without a room around them.
   Every clause is present only where the read carries it: the channel-none
   doctrine, applied to the first line the banker sees.                       */

describe("the sheet's one line of state", () => {
  const booked = packageRoster(data.borrowers![KINGSLEY] as BorrowerBundle);

  it("says nothing it did not read", () => {
    expect(entryStateLine({ packages: [] })).toBe(
      "The read carries no grade and no committed total for this relationship.",
    );
  });

  it("names the grade only where the read carries one", () => {
    expect(entryStateLine({ committed: 22_000_000, packages: booked })).toBe("$22M committed.");
    expect(entryStateLine({ grade: "4", committed: 22_000_000, packages: booked })).toBe(
      "Booked at Grade 4, $22M committed.",
    );
  });

  it("never prints a placeholder for a committed total it does not have", () => {
    // `fmtMoney` answers an absent figure with a dash, which is not a fact.
    expect(entryStateLine({ grade: "5", packages: [] })).toBe("Graded 5, nothing booked yet.");
  });

  it("carries the deal signal on the same line, where the room opened on one", () => {
    expect(
      entryStateLine({ grade: "4", committed: 22_000_000, packages: booked, signal: "The $15M line matures in 38 days." }),
    ).toBe("Booked at Grade 4, $22M committed. The $15M line matures in 38 days.");
  });
});
