import { describe, expect, it } from "vitest";
import { bundleAfterDiscard } from "./syncSweep";
import { deskContext } from "./deskAsk";
import { discardTargetFor } from "../actions/discardTarget";
import { packageRoster } from "../book/packages";
import type { ActionHistoryRow, BorrowerBundle, C360Data, Facility } from "../data/contract";
import live from "../../../artifact/live-data.json";

/* =============================================================================
   THE BOOK AFTER THE UNDO, AND WHAT THE DESK SAYS ABOUT A VERSION.

   Two halves of one rule (spec 2b.4): the roster has to drop the version and
   the source has to unlock the moment the executor reports success, and the
   chat has to be able to answer what is IN the version while it is still there
   and what happened to it once it is gone.

   The fixture is Hartwell's real bundle with one fabricated version over it,
   built member-for-member the way nCino builds one, so the roster recognises it
   through its own mirror rather than through anything this test asserts.
   ============================================================================= */

const data = live as unknown as C360Data;
const HARTWELL = "001bb00001I7FPNAA3";
const NAME = "Hartwell Precision Manufacturing LLC";
const SOURCE = "a5Fbb000000IHFJEA4";
const VERSION = "a5Fbb0000009TESTV1";

function forked(stage = "Qualification"): BorrowerBundle {
  const base = structuredClone(data.borrowers![HARTWELL]) as BorrowerBundle;
  const members = (base.exposure?.facilities ?? []).filter((f) => f.productPackageId === SOURCE);
  const clones: Facility[] = members.map((f, i) => ({
    ...f,
    loanId: `a4Zbb000009CLONE${i}`,
    name: f.committed === 15_000_000 ? f.name?.replace("$15,000,000.00", "$20,000,000.00") : f.name,
    committed: f.committed === 15_000_000 ? 20_000_000 : f.committed,
    productPackageId: VERSION,
    stage,
    outstanding: 0,
  }));
  base.exposure = { ...base.exposure, facilities: [...(base.exposure?.facilities ?? []), ...clones] };
  return base;
}

/* --------------------------------------------------- the roster after a discard */

describe("the roster drops the version and the source unlocks", () => {
  it("reads the fork before the discard", () => {
    const roster = packageRoster(forked());
    expect(roster.find((e) => e.id === VERSION)?.inFlightVersion).toBe(true);
    expect(roster.find((e) => e.id === SOURCE)?.hasInFlightModification).toBe(true);
    expect(roster.find((e) => e.id === SOURCE)?.inFlightVersionId).toBe(VERSION);
  });

  it("drops every member of the version and nothing else", () => {
    const before = forked();
    const patch = bundleAfterDiscard(before, VERSION);
    const after = { ...before, ...patch } as BorrowerBundle;
    expect(after.exposure!.facilities!.some((f) => f.productPackageId === VERSION)).toBe(false);
    expect(after.exposure!.facilities).toHaveLength(before.exposure!.facilities!.length - 7);
    // Every booked facility the relationship had is still on the book.
    const booked = (f: Facility) => f.stage === "Booked";
    expect(after.exposure!.facilities!.filter(booked)).toEqual(before.exposure!.facilities!.filter(booked));
  });

  it("leaves the source unlocked and the version gone from the roster", () => {
    const after = { ...forked(), ...bundleAfterDiscard(forked(), VERSION) } as BorrowerBundle;
    const roster = packageRoster(after);
    expect(roster.find((e) => e.id === VERSION)).toBeUndefined();
    const source = roster.find((e) => e.id === SOURCE)!;
    expect(source.hasInFlightModification).toBe(false);
    expect(source.inFlightVersionId).toBeNull();
  });

  it("closes the door it was taken through", () => {
    const after = { ...forked(), ...bundleAfterDiscard(forked(), VERSION) } as BorrowerBundle;
    expect(discardTargetFor(after, null)).toBeNull();
    expect(discardTargetFor(after, SOURCE)).toBeNull();
  });

  it("re-sums the exposure totals, which counted the version's loans", () => {
    const before = forked();
    const patch = bundleAfterDiscard(before, VERSION);
    const kept = before.exposure!.facilities!.filter((f) => f.productPackageId !== VERSION);
    expect(patch.exposure!.totalCommitted).toBe(kept.reduce((n, f) => n + (f.committed ?? 0), 0));
    expect(patch.exposure!.totalOutstanding).toBe(kept.reduce((n, f) => n + (f.outstanding ?? 0), 0));
  });

  it("patches nothing where the bundle never named the version", () => {
    // A second session, or a replay: the read has already dropped the version,
    // so there is nothing to correct and no figure to touch.
    expect(bundleAfterDiscard(data.borrowers![HARTWELL], VERSION)).toEqual({});
    expect(bundleAfterDiscard(null, VERSION)).toEqual({});
  });
});

/* ------------------------------------------------------ the desk's own context */

describe("the desk names the version state and what is in it", () => {
  it("names the editable state in the cockpit's own words", () => {
    const said = deskContext(forked(), NAME);
    expect(said).toContain("Modification in Progress, editable until approval");
    expect(said).not.toContain("in approval, locked");
  });

  it("names the locked state once the org has taken the version", () => {
    const said = deskContext(forked("Approval / Loan Committee"), NAME);
    expect(said).toContain("in approval, locked");
    expect(said).not.toContain("editable until approval.");
  });

  it("carries the version's own members at the version's own figures", () => {
    const said = deskContext(forked(), NAME);
    // The line the modification moved, at the figure the VERSION carries, not
    // the $15,000,000.00 the booked package still carries.
    expect(said).toContain("On the version: Hartwell Precision Manufacturing LLC - Line of Credit - $20,000,000.00");
    expect(said).toContain("$20M committed");
    // And the member it did not move, so "what did we change" has both sides.
    expect(said).toContain("Hartwell Precision Manufacturing LLC - Line of Credit - $2,500,000.00");
  });

  it("does not list members of a version the banker can no longer shape", () => {
    expect(deskContext(forked("Approval / Loan Committee"), NAME)).not.toContain("On the version:");
  });

  it("says the version can be discarded, so the chat can name the next step", () => {
    expect(deskContext(forked(), NAME)).toContain("can be discarded from the cockpit");
  });

  it("says a discarded version is gone, with the date it went", () => {
    const history: ActionHistoryRow[] = [
      {
        stagingId: "a5Sbb000000STG01",
        actionId: "discard-version",
        status: "Completed",
        executedAt: "2026-09-13T09:41:00.000Z",
        productPackageId: SOURCE,
      },
    ];
    const said = deskContext(data.borrowers![HARTWELL], NAME, { history });
    expect(said).toContain("was discarded on");
    expect(said).toContain("the booked package it forked from was left untouched");
  });

  it("says nothing about a discard the org only staged", () => {
    const history: ActionHistoryRow[] = [
      { stagingId: "a5Sbb000000STG02", actionId: "discard-version", status: "Staged", productPackageId: SOURCE },
    ];
    expect(deskContext(data.borrowers![HARTWELL], NAME, { history })).not.toContain("was discarded on");
  });
});
