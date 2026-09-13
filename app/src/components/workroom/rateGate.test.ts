import { describe, expect, it } from "vitest";
import {
  rateAsk,
  rateFigureAsk,
  rateHeldLine,
  rateIndexAsk,
  rateIndexNote,
  rateLabel,
  rateOnFile,
  rateSay,
  readRateFreeText,
  readRateHold,
  readRateHoldLabel,
  readRateIndexOpen,
  readRateIndexPick,
  readRateNew,
  asksRateOptions,
  RATE_EXAMPLE,
  RATE_NO_INDEX,
} from "./rateGate";
import type { ElicitMember } from "./elicit";
import type { Facility } from "../../data/contract";

/* =============================================================================
   THE RATE GATE.

   FOUNDER, 2026-09-03, driving the ninth publish. The room asked "What all-in
   rate applies to the $15.0MM line?" with no figures on the question, told him
   twice that the org stores no index name, took "I have a new all-in rate" as a
   SUPPLIED RATE and reported "All-in rate updated on file" with no number
   anywhere. Then, when he typed "Yes, 7.25% all-in", it asked again.

   WHAT THESE HOLD:

     FIGURES ON THE ASK   the rate on file is a chip the banker can take in one
                          click, and the question carries an example.
     NOTHING WITHOUT A    "I have a new rate" is a choice of route, not a rate.
     NUMBER               Only a figure stages, and the sentence that stages
                          carries it.
     EVERY FORM           "Yes, 7.25% all-in", "7.25", "7.25 percent", "up 25
                          bps", "prime plus 1". A line with the figure in it is
                          never answered with the question again.
     NOT A RATE           a bare integer is an amortisation, and it reaches this
                          lane from the same composer.
     THE ASIDE ONCE       the no-index sentence is said once per facility, and
                          never as the answer to "what options do I have".
   ============================================================================= */

const LOC15 = "a4Zbb0000027MaYEAU";

const member: ElicitMember = {
  id: LOC15,
  key: "Line of Credit",
  label: "$15.0MM Line of Credit",
  orgName: "Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00",
  shortName: "Line of Credit - $15,000,000.00",
  committed: 15_000_000,
};

const facility = (over: Record<string, unknown> = {}): Facility =>
  ({ loanId: LOC15, name: "Line of Credit", ...over }) as unknown as Facility;

/* ------------------------------------------------------------ what is on file */

describe("the rate the read carries", () => {
  it("prefers a stream's own rate component, with its basis and its frequency", () => {
    const on = rateOnFile(facility({ streams: [{ rate: 7.6, rateType: "Fixed", frequency: "Monthly" }] }));
    expect(on).toEqual({ pct: 7.6, basis: "fixed", frequency: "monthly", from: "stream" });
    expect(rateLabel(on!)).toBe("7.60% fixed, paid monthly");
  });

  it("falls back to the loan's own rate where the read carries no streams", () => {
    expect(rateOnFile(facility({ interestRate: 6.25 }))).toEqual({
      pct: 6.25,
      basis: null,
      frequency: null,
      from: "loan",
    });
  });

  it("skips an inactive stream rather than quoting a rate nobody is paying", () => {
    const on = rateOnFile(
      facility({ streams: [{ rate: 9.1, active: false }, { rate: 7.6, rateType: "Fixed" }] }),
    );
    expect(on?.pct).toBe(7.6);
  });

  it("INVENTS NOTHING. No stream and no loan rate is no rate on file", () => {
    expect(rateOnFile(facility())).toBeNull();
    expect(rateOnFile(facility({ interestRate: null }))).toBeNull();
    expect(rateOnFile(null)).toBeNull();
  });
});

/* -------------------------------------------------------------------- the ask */

describe("the question carries the figures (founder, 2026-09-03)", () => {
  const on = { pct: 7.6, basis: "fixed", frequency: "monthly", from: "stream" as const };

  it("offers the rate on file as a chip, beside the two ways of changing it", () => {
    const ask = rateAsk(member, on, false);
    expect(ask.options.map((o) => o.label)).toEqual(["Hold 7.60% fixed, paid monthly", "New all-in rate", "Index + spread"]);
    // The figure is IN the question too, not only on the chip.
    expect(ask.text).toContain("7.60% fixed, paid monthly");
    expect(ask.text).toContain(RATE_EXAMPLE);
  });

  it("says the aside once, and never again on the same facility", () => {
    expect(rateAsk(member, on, false).text).toContain(RATE_NO_INDEX);
    expect(rateAsk(member, on, true).text).not.toContain(RATE_NO_INDEX);
  });

  /* THE WAY OUT IS ALWAYS THE FIRST CHIP (founder, 2026-09-03: "I also get
     forced to fill this out"). With a rate on file it names the figure; with
     none it says plainly what it does. Either way it stages nothing. */
  it("offers the plain keep where the read carries no rate, and says so", () => {
    const ask = rateAsk(member, null, false);
    expect(ask.options.map((o) => o.label)).toEqual(["Keep the rate as booked", "New all-in rate", "Index + spread"]);
    expect(ask.text).toContain("no rate on it");
  });

  it("names the indexes without ever naming a level", () => {
    const ask = rateIndexAsk(member);
    expect(ask.options.map((o) => o.label)).toEqual(["Prime", "SOFR"]);
    expect(ask.text).toContain("no index level");
    expect(ask.text).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("asks for the figure with the example on it, and names the index back", () => {
    expect(rateFigureAsk(member, null)).toContain(RATE_EXAMPLE);
    expect(rateFigureAsk(member, "Prime")).toContain("over Prime");
    expect(rateIndexNote("SOFR")).toContain("travels as a note");
  });

  it("says what holding means, with the figure that is being held", () => {
    expect(rateHeldLine(member, on)).toContain("7.60% fixed, paid monthly");
    expect(rateHeldLine(member, null)).toContain("keeps the rate the org holds");
  });
});

/* ---------------------------------------------------- the answer, in every form */

describe("a line with the figure in it is never answered with the question again", () => {
  const read = (text: string, onFile: number | null = 7.6) => readRateFreeText(text, { onFile });

  it("takes the founder's own line: an affirmation in front of a rate", () => {
    expect(read("Yes, 7.25% all-in")).toEqual({ pct: "7.25", index: null });
    expect(read("yep 7.25%")).toEqual({ pct: "7.25", index: null });
    expect(read("sure, 7.25 percent")).toEqual({ pct: "7.25", index: null });
  });

  it("takes a bare percentage, with or without the mark and the basis", () => {
    expect(read("7.25%")).toEqual({ pct: "7.25", index: null });
    expect(read("7.25")).toEqual({ pct: "7.25", index: null });
    expect(read("7.25% fixed, paid monthly")).toEqual({ pct: "7.25", index: null });
    expect(read("actually 6.9%")).toEqual({ pct: "6.90", index: null });
  });

  it("takes a MOVE on the rate on file, in points or in basis points", () => {
    expect(read("up 25 bps")).toEqual({ pct: "7.85", index: null });
    expect(read("down 50 basis points")).toEqual({ pct: "7.10", index: null });
    expect(read("+0.4%")).toEqual({ pct: "8.00", index: null });
  });

  it("refuses a move with no rate on file rather than doing arithmetic on nothing", () => {
    expect(read("up 25 bps", null)).toBeNull();
  });

  it("takes an INDEX as half an answer: the figure is the next question", () => {
    expect(read("prime plus 1")).toEqual({ pct: null, index: "Prime" });
    expect(read("SOFR + 2.25")).toEqual({ pct: null, index: "SOFR" });
    expect(read("prime")).toEqual({ pct: null, index: "Prime" });
  });

  it("REFUSES A BARE INTEGER. It is an amortisation, and the same composer sends it", () => {
    expect(read("240")).toBeNull();
    expect(read("84")).toBeNull();
    // And a figure no commercial rate could be.
    expect(read("95%")).toBeNull();
    expect(read("0%")).toBeNull();
  });

  it("refuses an instruction that happens to carry a number", () => {
    expect(read("move the construction loan maturity to 2029-06-30")).toBeNull();
    expect(read("add a 1% origination fee")).toBeNull();
  });
});

describe("the chips read back as themselves", () => {
  const members = [member];

  it("reads the hold, the new rate and the index, each on its own facility", () => {
    expect(readRateHold("hold the rate on the $15.0MM Line of Credit", members)).toBe(LOC15);
    expect(readRateNew("set the rate on the $15.0MM Line of Credit myself", members)).toBe(LOC15);
    expect(readRateIndexOpen("price the $15.0MM Line of Credit off an index", members)).toBe(LOC15);
    expect(readRateIndexPick("price the $15.0MM Line of Credit off Prime", members)).toEqual({
      memberId: LOC15,
      index: "Prime",
    });
  });

  it("stages through the ORG's own loan name, which resolves exactly one member", () => {
    expect(rateSay(member, "7.25")).toBe(
      "move the Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00 rate to 7.25%",
    );
  });

  it("reads a question about the OFFER as a question about the offer", () => {
    expect(asksRateOptions("what index and rate options do I have")).toBe(true);
    expect(asksRateOptions("what are my options")).toBe(true);
    expect(asksRateOptions("which indexes can I use?")).toBe(true);
    // Not a question about the offer.
    expect(asksRateOptions("7.25%")).toBe(false);
    expect(asksRateOptions("increase the 15M line of credit to 20M")).toBe(false);
  });
});

/* =============================================================================
   THE CHIP'S OWN LABEL, TYPED (founder bug bug-1789294443785). The room offered
   "Hold 6.58%", the banker typed "Hold 6.58%", and the room answered "I could
   not match that to anything on this package".
   ============================================================================= */

describe("the hold chip, typed back word for word", () => {
  const onFile = { pct: 6.58, basis: null, frequency: null, from: "loan" as const };

  it("takes the label the room printed, in the forms a banker types it", () => {
    expect(readRateHoldLabel("Hold 6.58%", onFile)).toBe(true);
    expect(readRateHoldLabel("hold 6.58", onFile)).toBe(true);
    expect(readRateHoldLabel("keep it at 6.58%", onFile)).toBe(true);
    expect(readRateHoldLabel("Hold 6.58% fixed, paid monthly", onFile)).toBe(true);
  });

  it("is a hold only where the figure is the one on file", () => {
    // A different figure is a NEW rate, and the free-text reader stages it.
    expect(readRateHoldLabel("hold 7.25%", onFile)).toBe(false);
    // With no rate on the read there is nothing to hold.
    expect(readRateHoldLabel("hold 6.58%", null)).toBe(false);
    // And an instruction is never one of these.
    expect(readRateHoldLabel("hold the construction loan at its maturity", onFile)).toBe(false);
  });
});

describe("a change of mind, in the verbs a banker uses", () => {
  const read = (text: string) => readRateFreeText(text, { onFile: 6.58 });

  it("reads the figure behind an increase, a raise or a cut", () => {
    expect(read("yes increase to 7.25%")).toEqual({ pct: "7.25", index: null });
    expect(read("raise it to 7.25%")).toEqual({ pct: "7.25", index: null });
    expect(read("lower the rate to 6.10%")).toEqual({ pct: "6.10", index: null });
  });

  it("still refuses a line that carries no rate behind the verb", () => {
    expect(read("increase the 15M line of credit to 35M")).toBeNull();
    expect(read("increase the commitment")).toBeNull();
    // A bare integer is an amortisation, and the same composer reaches this lane.
    expect(read("increase to 240")).toBeNull();
  });
});
