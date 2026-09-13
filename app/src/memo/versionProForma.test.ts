/* =============================================================================
   THE MEMO READS THE VERSION IN FLIGHT (0.9.23, spec 2a.6).

   THE GAP. nCino files a modification as a NEW package version holding a copy
   of every member, and `Customer360Exposure` returns the booked facilities AND
   their clones in one list. The memo builder mapped that list straight onto
   `canon.loans`, so a relationship with a version a day old produced a memo
   that:

     listed the booked Purchase facility AND its clone as two separate loans;
     summed both into the existing column and both into the proposed column;
     printed NO Pro forma column at all, because `movesDebt` reads EXECUTED plan
     steps and a fork executes none.

   Every figure in it was wrong in the same direction, and the one table whose
   job is to say what this action does to leverage said nothing about it.

   THE FIXTURE IS THE REAL HARTWELL BOOK with a version fabricated onto it, in
   exactly the shape `book/packages.test.ts` fabricates one: the two booked
   loans of package a5Fbb000000J6BNEA0 cloned into a new package at
   Qualification, with the clone of the facility the filing moved renamed the
   way nCino renames it ($6,500,000.00 became $12,000,000.00). That is the shape
   the roster reads a fork off, so the memo and the roster are looking at the
   same thing.
   ============================================================================= */

import { describe, expect, it } from "vitest";
import live from "../../../artifact/live-data.json";
import type { BorrowerBundle, Facility } from "../data/contract";
import { PER_THE_VERSION, buildMemoDossier, versionOverlayFor } from "./dossier";
import { keyMetricsFrom } from "./overrides";
import type { MemoChange } from "./types";

const borrowers = live.borrowers as unknown as Record<string, BorrowerBundle>;
const HARTWELL = borrowers["001bb00001I7FPNAA3"];

/** The booked package the version forks. Two Booked loans, the org's own. */
const SOURCE = "a5Fbb000000J6BNEA0";
/** The unbooked package the fork creates, as the org names one. */
const VERSION = "a5Fbb000000JFzREAW";

const PURCHASE = "a4Zbb000002ICnxEAG";
const EQUIPMENT = "a4Zbb000002ICnyEAG";

/**
 * Hartwell, with a version in flight over the two facilities of `SOURCE`.
 *
 * THE CLONES CARRY NO BALANCE. That is the org's own shape, not a convenience:
 * nCino clones a loan at an unbooked stage and the drawn balance stays on the
 * booked facility until the version books. It is the reason the memo must not
 * take the outstanding off the clone.
 *
 * THE PURCHASE CLONE IS RENAMED. The filing that moved the commitment rewrote
 * the money on the end of the loan's own name, which is the only thing that
 * differs between a clone and its parent and the only signal the pairing has.
 */
function withVersion(over: { stage?: string; added?: Facility } = {}): BorrowerBundle {
  const stage = over.stage ?? "Qualification";
  const clones: Facility[] = [
    {
      loanId: "a4Zbb000002KFD4EAO",
      status: "Open",
      productPackageId: VERSION,
      stage,
      name: "Hartwell Precision Manufacturing LLC - Purchase - $12,000,000.00",
      productType: "Real Estate",
      committed: 12_000_000,
      outstanding: 0,
      maturityDate: "2036-01-31",
      interestRate: 6.85,
    },
    {
      loanId: "a4Zbb000002KFD3EAO",
      status: "Open",
      productPackageId: VERSION,
      stage,
      name: "Hartwell Precision Manufacturing LLC - Equipment - $1,500,000.00",
      productType: "Non-Real Estate",
      committed: 1_500_000,
      outstanding: 0,
      maturityDate: "2033-01-31",
      interestRate: 6.6,
    },
  ];
  if (over.added) clones.push(over.added);
  const facilities = [...(HARTWELL.exposure?.facilities ?? []), ...clones];
  /* THE ORG'S OWN TOTAL COUNTS THE CLONES, summed the way
     `Customer360Exposure.cls` sums it: over every loan it returns, which is
     every loan whose status is not Closed. That is the read the cockpit has to
     correct, so the fixture must not correct it first. */
  return {
    ...HARTWELL,
    exposure: {
      ...HARTWELL.exposure,
      totalCommitted: facilities.reduce((sum, f) => sum + (f.committed ?? 0), 0),
      totalOutstanding: facilities.reduce((sum, f) => sum + (f.outstanding ?? 0), 0),
      facilities,
    },
  } as BorrowerBundle;
}

/**
 * Piedmont, booked, with a version in flight over all three facilities.
 *
 * HARTWELL'S BOOK IS DISPLAY-ONLY: it carries revenue and EBITDA and no balance
 * sheet, so its pro forma leverage cell is the gap whatever moves the
 * commitment (that is `proFormaLeverageFrom`'s own doctrine). Piedmont carries a
 * real Boom file with a balance sheet, which is what makes it the fixture for a
 * pro forma multiple that is actually stated. Its three facilities sit at Final
 * Review on the shipped book; a version forks a BOOKED package, so they are
 * booked here.
 */
const PIEDMONT_VERSION = "a5Fbb000000HA9ZEAW";
const PIEDMONT_EQUIPMENT = "a4Zbb000001vaxREAQ";

function piedmontWithVersion(): BorrowerBundle {
  const base = borrowers["001bb00001DLtRMAA1"];
  const booked = (base.exposure?.facilities ?? []).map((f) => ({ ...f, stage: "Booked" }));
  /* THE EQUIPMENT FACILITY IS THE ONE THE FILING MOVED, and it is chosen
     because its name is unique on this package: the two Lines of Credit differ
     only by the money on the end of their names, which is the one thing a
     filing rewrites. */
  const clones: Facility[] = booked.map((f, i) => ({
    ...f,
    loanId: `clone-${i}`,
    productPackageId: PIEDMONT_VERSION,
    stage: "Qualification",
    outstanding: 0,
    ...(f.loanId === PIEDMONT_EQUIPMENT
      ? {
          committed: 8_000_000,
          name: "Piedmont Precision Components, Inc. - Equipment - $8,000,000.00",
        }
      : {}),
  }));
  const facilities = [...booked, ...clones];
  return {
    ...base,
    exposure: {
      ...base.exposure,
      totalCommitted: facilities.reduce((sum, f) => sum + (f.committed ?? 0), 0),
      totalOutstanding: facilities.reduce((sum, f) => sum + (f.outstanding ?? 0), 0),
      facilities,
    },
  } as BorrowerBundle;
}

const parentOf = (bundle: BorrowerBundle, loanId: string): Facility =>
  (bundle.exposure?.facilities ?? []).find((f) => f.loanId === loanId)!;

/* -----------------------------------------------------------------------------
   THE OVERLAY
   ----------------------------------------------------------------------------- */

describe("the version overlay", () => {
  it("is null on the book as it ships, so every memo today renders unchanged", () => {
    expect(versionOverlayFor(HARTWELL)).toBeNull();
    expect(versionOverlayFor(borrowers["001bb00001DLtRMAA1"])).toBeNull();
    expect(versionOverlayFor(null)).toBeNull();
  });

  it("pairs each clone to the booked facility it restates, through nCino's own renaming", () => {
    const overlay = versionOverlayFor(withVersion())!;
    expect(overlay.versionPackageId).toBe(VERSION);
    expect(overlay.sourcePackageId).toBe(SOURCE);
    // The Equipment clone matches its parent's name exactly; the Purchase clone
    // matches only once the money on the end of the name is stripped.
    expect(overlay.byParent.get(PURCHASE)?.loanId).toBe("a4Zbb000002KFD4EAO");
    expect(overlay.byParent.get(EQUIPMENT)?.loanId).toBe("a4Zbb000002KFD3EAO");
    expect(overlay.added).toEqual([]);
    expect(overlay.pairs).toHaveLength(2);
  });

  it("reads a clone that restates nothing as a facility the version ADDS", () => {
    const overlay = versionOverlayFor(
      withVersion({
        added: {
          loanId: "a4Zbb000002KFD9EAO",
          status: "Open",
          productPackageId: VERSION,
          stage: "Qualification",
          name: "Hartwell Precision Manufacturing LLC - Line of Credit - $4,000,000.00",
          committed: 4_000_000,
          outstanding: 0,
        },
      }),
    );
    /* THE MIRROR IS WHAT MAKES A FORK A FORK, and a package holding one more
       member than the one it mirrors is not a member-for-member copy. The
       roster says so, so there is no version here at all, and the memo reads
       the package exactly as it reads any other. That is the fail-closed
       reading: a version the roster cannot prove is never one this builder
       will restate a booked package against. */
    expect(overlay).toBeNull();
  });

  it("is null once the org has taken the version to approval", () => {
    // From `Approval / Loan Committee` up the version is the org's, not the
    // banker's, and its figures are read exactly as any other package's.
    expect(versionOverlayFor(withVersion({ stage: "Approval / Loan Committee" }))).toBeNull();
    expect(versionOverlayFor(withVersion({ stage: "Doc Prep" }))).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
   THE DOSSIER
   ----------------------------------------------------------------------------- */

describe("the dossier over a version in flight", () => {
  const dossier = buildMemoDossier({ bundle: withVersion(), productPackageName: "Hartwell credit package" });
  const canon = dossier.canon;
  const bundle = withVersion();

  it("lists each booked facility once, with the version as its proposed side", () => {
    const ids = canon.loans.map((l) => l.ncinoId);
    // The two clones are NOT loans of their own.
    expect(ids).not.toContain("a4Zbb000002KFD4EAO");
    expect(ids).not.toContain("a4Zbb000002KFD3EAO");
    const purchase = canon.loans.find((l) => l.ncinoId === PURCHASE)!;
    expect(purchase.existing.commitment).toBe(6_500_000);
    expect(purchase.proposed.commitment).toBe(12_000_000);
    expect(purchase.isIncrease).toBe(true);
    expect(purchase.isNewMoney).toBe(false);
    expect(purchase.isRenewal).toBe(true);
  });

  it("keeps the drawn balance on the booked facility, because a clone carries none", () => {
    const purchase = canon.loans.find((l) => l.ncinoId === PURCHASE)!;
    const booked = parentOf(bundle, PURCHASE);
    // The clone reads zero outstanding. Printing it would say the borrower
    // repaid the line.
    expect(purchase.proposed.outstanding).toBe(booked.outstanding);
    expect(purchase.existing.outstanding).toBe(booked.outstanding);
  });

  it("sums both exposure columns off the pairing, not off the org's own total", () => {
    // `Customer360Exposure` sums every loan it returns, clones included, so its
    // total ($57.0M) over-states both sides at once.
    const existing = canon.exposureSummary.existing.commitment as number;
    const proposed = canon.exposureSummary.proposed.commitment as number;
    // The org's own total is $70.5M: the nine real facilities plus the two
    // clones. Neither column is that figure, and the difference between the two
    // columns is exactly what the version moves.
    expect(bundle.exposure!.totalCommitted).toBe(70_500_000);
    expect(existing).toBe(57_000_000);
    expect(proposed).toBe(62_500_000);
    expect(canon.exposureSummary.changeInExposure.commitment).toBe(5_500_000);
  });

  it("marks the callout with where the proposed column came from", () => {
    const note = canon.exposureSummary.changeInExposure.note;
    expect(note).toContain(PER_THE_VERSION);
    expect(note).toContain("Nobody has booked it");
    expect(note).toContain("the booked package behind it is unchanged");
    // And it REPLACES the step sentence, which is false on this memo.
    expect(note).not.toContain("existing and proposed exposure are the same figures");
  });

  it("names the version on the dossier, so the seam can read it", () => {
    expect(canon.versionInFlight).toEqual({
      versionPackageId: VERSION,
      sourcePackageId: SOURCE,
      versionName: expect.any(String),
      restated: 2,
      added: 0,
      commitmentDelta: 5_500_000,
      note: PER_THE_VERSION,
    });
  });

  it("states the amount and the rate the version moves, per member, in the narrative's figures", () => {
    const signals = canon.context?.signals ?? [];
    const moved = signals.find((line) => /Purchase/.test(line))!;
    expect(moved).toContain("commitment $6.50M to $12M");
    expect(moved).toContain("rate 6.35% to 6.85%");
    expect(moved).toContain(PER_THE_VERSION);
    // The Equipment clone moved nothing, so it earns no line: a list of
    // unchanged facilities is noise in a prompt about what is changing.
    expect(signals.some((line) => /Equipment/.test(line))).toBe(false);
  });

  it("leaves a memo with no version exactly as it was", () => {
    const plain = buildMemoDossier({ bundle: HARTWELL, productPackageName: "Hartwell credit package" });
    expect(plain.canon.versionInFlight).toBeUndefined();
    expect(plain.canon.exposureSummary.proposed.commitment).toBe(HARTWELL.exposure?.totalCommitted);
    expect(plain.canon.exposureSummary.changeInExposure.note).toContain(
      "No executed plan step was handed to this memo",
    );
  });
});

/* -----------------------------------------------------------------------------
   KEY METRICS
   ----------------------------------------------------------------------------- */

describe("the Key Metrics pro forma over a version in flight", () => {
  const PRO_FORMA = "Pro forma";
  const LEVERAGE = "Debt ÷ EBITDA";

  it("opens the pro forma column off the version, with no executed step at all", () => {
    const spec = keyMetricsFrom(buildMemoDossier({ bundle: withVersion() }), []);
    // The column is what says a change is being proposed at all, and before
    // 0.9.23 a memo written over a version had none.
    expect(spec.columns.at(-1)).toBe(PRO_FORMA);
  });

  it("states the pro forma multiple off the version, where the book carries a balance sheet", () => {
    const dossier = buildMemoDossier({ bundle: piedmontWithVersion() });
    expect(dossier.canon.versionInFlight?.commitmentDelta).toBe(3_000_000);
    const spec = keyMetricsFrom(dossier, []);
    expect(spec.columns.at(-1)).toBe(PRO_FORMA);
    const pro = spec.rows.find((r) => r.label === LEVERAGE)!.cells.at(-1);
    expect(pro).not.toBeNull();
    expect(pro!.unit).toBe("x");
    /* THE MULTIPLE IS THE AS OF PERIOD'S DEBT PLUS WHAT THE VERSION MOVES, over
       the as of period's EBITDA, which is the same arithmetic an executed step
       gets and the same the renderer would have done. It is HIGHER than the
       measured multiple, because the version adds $3.0M of commitment. */
    const measured = spec.rows.find((r) => r.label === LEVERAGE)!.cells.find((c, i) => c != null && i < spec.columns.length - 1);
    expect(measured).not.toBeNull();
    expect(pro!.value).toBeGreaterThan(measured!.value);
  });

  it("names the version in the footnote, so nobody reads it as a booked figure", () => {
    const spec = keyMetricsFrom(buildMemoDossier({ bundle: withVersion() }), []);
    const note = spec.footnotes.find((f) => f.includes(PRO_FORMA))!;
    expect(note).toContain("the version in flight");
    expect(note).toContain("which nobody has booked");
    expect(note).not.toContain("the executed step");
  });

  it("still says 'the executed step' where a step is what moved the debt", () => {
    const change: MemoChange = {
      id: "step-1",
      label: "Increase the line of credit to $15.0M",
      target: { kind: "LLC_BI__Loan__c", id: "a4Zbb0000027MaYEAU", name: "Line of Credit" },
      before: { commitment: 12_000_000 },
      after: { commitment: 15_000_000 },
    };
    const dossier = buildMemoDossier({ bundle: HARTWELL, changes: [change] });
    const spec = keyMetricsFrom(dossier, [change]);
    const note = spec.footnotes.find((f) => f.includes(PRO_FORMA))!;
    expect(note).toContain("the executed step");
    expect(note).not.toContain("the version in flight");
  });

  it("opens no pro forma column where the version moves no commitment", () => {
    /* A VERSION THAT RESTATES THE SAME FIGURES is a fork nobody has changed
       anything on yet, and it changes no leverage. The column is the claim, so
       there is no column. */
    const flat = {
      ...HARTWELL,
      exposure: {
        ...HARTWELL.exposure,
        facilities: [
          ...(HARTWELL.exposure?.facilities ?? []),
          {
            loanId: "a4Zbb000002KFD4EAO",
            status: "Open",
            productPackageId: VERSION,
            stage: "Qualification",
            name: "Hartwell Precision Manufacturing LLC - Purchase - $6,500,000.00",
            committed: 6_500_000,
            outstanding: 0,
          },
          {
            loanId: "a4Zbb000002KFD3EAO",
            status: "Open",
            productPackageId: VERSION,
            stage: "Qualification",
            name: "Hartwell Precision Manufacturing LLC - Equipment - $1,500,000.00",
            committed: 1_500_000,
            outstanding: 0,
          },
        ],
      },
    } as BorrowerBundle;
    const dossier = buildMemoDossier({ bundle: flat });
    expect(dossier.canon.versionInFlight?.commitmentDelta).toBe(0);
    expect(keyMetricsFrom(dossier, []).columns).not.toContain(PRO_FORMA);
  });
});
