import { describe, expect, it } from "vitest";
import {
  deltaM,
  shortPackageName,
  filedStamp,
  filedTitle,
  moneyM,
  shortRecordId,
  renewedTo,
  sheetExposure,
  sheetCoverage,
  whoActsNext,
} from "./filedSheet";
import type { FiledLine } from "./FiledList";
import type { WorkroomChallenge } from "../../workroom/types";

/* =============================================================================
   THE FILED SHEET'S OWN ARITHMETIC AND ITS OWN SENTENCES.

   Everything the sheet says is composed here, from what the room already holds,
   which is the whole reason the sheet can be on the glass inside a second. What
   is under test is that it says the right thing per mode, that it never invents
   a fact it was not given, and that a block with nothing in it is absent rather
   than empty.
   ============================================================================= */

const line = (over: Partial<FiledLine>): FiledLine => ({ key: "d1", icon: "commit", title: "Commitment", ...over });

describe("what the sheet calls the filing", () => {
  const where = { accountName: "Hartwell Precision Manufacturing LLC", packageName: "C&I Credit Package" };

  it("files a modification, on the account, the package and the version", () => {
    expect(filedTitle({ mode: "modify", ...where, version: "a5Fbb000000J61hEAC" })).toBe(
      "Filed on Hartwell Precision Manufacturing LLC, C&I Credit Package, version a5Fbb000000J61hEAC",
    );
  });

  it("says what a renewal renewed TO, because that is what a renewal is read for", () => {
    expect(filedTitle({ mode: "renew", ...where, version: "a5F1", renewedTo: "30 Jun 2027" })).toBe(
      "Renewed to 30 Jun 2027 on Hartwell Precision Manufacturing LLC, C&I Credit Package, version a5F1",
    );
  });

  it("proposes a new facility rather than claiming it was booked", () => {
    expect(filedTitle({ mode: "create", ...where, version: "a5F1" })).toMatch(/^Proposed on /);
  });

  /* ====================== A CREATE'S NEW PACKAGE (founder, 2026-09-06)

     A new facility creates a new package, so the package the sheet names did not
     exist when the room opened. The execute returns its ID and no name, the
     org names a package on its own schedule and `recordName` on that result is
     the FACILITY's, so the sheet says the id, cut in the middle, and never a
     label this room made up or a planned name it never confirmed. */
  it("shortens an org id rather than dressing it up as a name", () => {
    expect(shortRecordId("a5Fbb000000J61hEAC")).toBe("a5Fbb0\u2026hEAC");
    // Short enough to read whole is left whole.
    expect(shortRecordId("a5Fbb0")).toBe("a5Fbb0");
    expect(shortRecordId("")).toBe("");
  });

  it("names the created package once, never as both the package and the version", () => {
    /* A CREATION'S NEW PACKAGE IS THE VERSION THE FILING MADE. Saying both would
       print one org id in two clauses of the same sentence. */
    const said = filedTitle({
      mode: "create",
      accountName: "Hartwell Precision Manufacturing LLC",
      packageName: "new package a5Fbb0…hEAC",
      version: "a5Fbb000000J61hEAC",
    });
    expect(said).toBe("Proposed on Hartwell Precision Manufacturing LLC, new package a5Fbb0…hEAC");
    expect(said).not.toContain("version");
  });

  it("still names the version where the package is a different record", () => {
    expect(
      filedTitle({
        mode: "create",
        accountName: "Hartwell Precision Manufacturing LLC",
        packageName: "C&I Credit Package",
        version: "a5Fbb000000J61hEAC",
      }),
    ).toBe("Proposed on Hartwell Precision Manufacturing LLC, C&I Credit Package, version a5Fbb000000J61hEAC");
  });

  it("omits the version where the org returned none, rather than guessing one", () => {
    const said = filedTitle({ mode: "modify", ...where, version: null });
    expect(said).toBe("Filed on Hartwell Precision Manufacturing LLC, C&I Credit Package");
    expect(said).not.toMatch(/version/);
  });

  it("falls back to a plain renewal where no row moved a maturity", () => {
    expect(filedTitle({ mode: "renew", ...where, renewedTo: null })).toMatch(/^Renewed on /);
    expect(renewedTo([line({ title: "Commitment amount", after: "$18,000,000" })])).toBeNull();
    expect(renewedTo([line({ title: "Maturity date", after: "30 Jun 2027" })])).toBe("30 Jun 2027");
  });

  it("does not say the relationship's name twice in one line", () => {
    /* nCino NAMES A PACKAGE AFTER THE BORROWER, so the org's own label repeats
       the account four words after the heading already said it. */
    const said = filedTitle({
      mode: "modify",
      accountName: "Hartwell Precision Manufacturing LLC",
      packageName: "Hartwell Precision Manufacturing LLC credit package",
      version: "a5F1",
    });
    expect(said).toBe("Filed on Hartwell Precision Manufacturing LLC, credit package, version a5F1");
  });

  it("stamps the clock and the banker in the seat", () => {
    expect(filedStamp(new Date(2026, 8, 6, 9, 7), "Fabian Goetzens")).toBe("09:07, by Fabian Goetzens");
    // No banker named is a clock and nothing else, never "by undefined".
    expect(filedStamp(new Date(2026, 8, 6, 14, 30), null)).toBe("14:30");
  });
});

describe("the exposure block", () => {
  it("states before, after and the movement in the KPI band's own voice", () => {
    const x = sheetExposure(46, 49.5, "pending");
    expect([x.before, x.after, x.delta]).toEqual(["$46.0M", "$49.5M", "+$3.5M"]);
  });

  it("carries pending until the org has confirmed, and drops it when it has", () => {
    expect(sheetExposure(46, 49.5, "pending").pending).toBe(true);
    expect(sheetExposure(46, 49.5, "unconfirmed").pending).toBe(true);
    expect(sheetExposure(46, 49.5, "confirmed").pending).toBe(false);
  });

  it("shows no movement where nothing moved, rather than a zero", () => {
    expect(sheetExposure(46, 46, "confirmed").delta).toBeNull();
    expect(deltaM(0)).toBe("no change");
    expect(deltaM(-1.2)).toBe("-$1.2M");
    expect(moneyM(46)).toBe("$46.0M");
  });
});

describe("terms and collateral", () => {
  const challenge = (rows: [string, string, string?][]): WorkroomChallenge =>
    ({ id: "c", verdict: "", tone: "ok", kicker: "", line: "", rows, say: "" }) as WorkroomChallenge;

  it("quotes the coverage the room already stated, rather than computing a second one", () => {
    expect(
      sheetCoverage([
        challenge([
          ["Lendable collateral", "$44,000,000"],
          ["Coverage if fully drawn", "0.95x → 0.72x", "sum"],
        ]),
      ]),
    ).toEqual({ label: "Coverage if fully drawn", value: "0.95x → 0.72x" });
  });

  it("takes the LAST check that spoke, because that is the one the banker acknowledged", () => {
    const said = sheetCoverage([
      challenge([["Base coverage of commitment", "0.80x", "key"]]),
      challenge([["Base coverage of commitment", "0.67x", "key"]]),
    ]);
    expect(said?.value).toBe("0.67x");
  });

  it("is null where no check carried a coverage figure, so the block is omitted", () => {
    expect(sheetCoverage([])).toBeNull();
    expect(sheetCoverage([challenge([["Borrowing base, gross", "$13,600,000"]])])).toBeNull();
    // A row that mentions coverage without a ratio is prose, not a figure.
    expect(sheetCoverage([challenge([["Coverage note", "see the borrowing base"]])])).toBeNull();
  });
});

describe("who acts next", () => {
  it("names the org's own queue where it gave one", () => {
    expect(whoActsNext("Loan Committee", "Booking runs through nCino.")).toBe("Loan Committee");
  });

  it("falls back to the org's own handoff sentence, which says the same thing", () => {
    expect(whoActsNext(null, "Booking runs through nCino's own Submit for Approval.")).toBe(
      "Booking runs through nCino's own Submit for Approval.",
    );
  });

  it("is null where the org said neither, so the sheet omits the block", () => {
    expect(whoActsNext(null, undefined)).toBeNull();
    expect(whoActsNext("  ", "")).toBeNull();
  });
});

describe("the package, as a heading names it", () => {
  const ACCOUNT = "Hartwell Precision Manufacturing LLC";

  it("drops the relationship's own name off the front, and the separator with it", () => {
    expect(shortPackageName(ACCOUNT, `${ACCOUNT} credit package`)).toBe("credit package");
    expect(shortPackageName(ACCOUNT, `${ACCOUNT} · credit package`)).toBe("credit package");
    expect(shortPackageName(ACCOUNT, `${ACCOUNT}, credit package`)).toBe("credit package");
  });

  it("leaves a package that is not named after the relationship exactly as the org wrote it", () => {
    expect(shortPackageName(ACCOUNT, "C&I Core Package")).toBe("C&I Core Package");
    expect(shortPackageName(null, "C&I Core Package")).toBe("C&I Core Package");
  });

  it("trims the middle where it still runs long, on word boundaries and never at the end", () => {
    const said = shortPackageName(ACCOUNT, `${ACCOUNT} credit package · Non-Real Estate and Real Estate`);
    expect(said).toBe("credit package…and Real Estate");
    // The tail is what tells two packages on one relationship apart; it stays.
    expect(said.endsWith("Real Estate")).toBe(true);
    expect(said.length).toBeLessThanOrEqual(40);
  });

  it("never returns nothing: a package named exactly after the account keeps its label", () => {
    expect(shortPackageName(ACCOUNT, ACCOUNT)).toBe(ACCOUNT);
  });
});
