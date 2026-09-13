import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAP_FILES_LINE,
  cardFacts,
  cardFootnote,
  cardWarnings,
  DEGRADED_FOOTNOTE,
  provisionalBrief,
  SPREAD_STEPS,
  spreadGuidance,
  spreadSteps,
  type SpreadStage,
  MAX_FILES,
  PRE_READ_BEAT_MS,
  POLL_EVERY_MS,
  SETTLE_BUDGET_MS,
  createSpreadEngine,
  duplicateLine,
  leftWithBoomLine,
  planSummary,
  tooBigLine,
  type SpreadDeps,
  type SpreadEngine,
} from "./spreadEngine";
import type {
  BoomAdapter,
  BoomFinancialStatement,
  BoomUploadResult,
  DroppedFile,
  ExtractedDocument,
  FilePreRead,
  ProvisionalRead,
} from "../spread/types";
import { MODEL_FAILED_NOTE, unitsStatedNote, type RelationshipSpreadContext } from "../spread/preRead";

/* =============================================================================
   THE SPREADING ROOM'S ENGINE, AS A MACHINE.

   Every transition, both caps, the sha256 identity, the one-ask-at-a-time
   invariant, the ladder's own clock and the stall. Nothing here reaches a
   connector or a browser API: the extraction, the two reads and the adapter are
   all injected, which is the whole reason the engine takes them.
   ============================================================================= */

const CTX: RelationshipSpreadContext = {
  accountId: "001Hartwell",
  company: "Hartwell Precision",
  onFilePeriods: ["FY2023", "FY2024"],
  covenants: [{ name: "Fixed charge coverage", operator: ">=", threshold: 1.25, current: 1.31 }],
  obligorGroup: [{ name: "Hartwell Holdings LLC", role: "Parent" }],
};

const file = (name: string, size = 1_000): File => ({ name, size }) as unknown as File;

const dropped = (name: string, sha: string): DroppedFile => ({
  id: name,
  name,
  mime: "application/pdf",
  bytes: 1_000,
  base64: "AAAA",
  sha256: sha,
  kind: "pdf-text",
});

const doc = (fileId: string): ExtractedDocument => ({
  fileId,
  kind: "pdf-text",
  text: "Revenue 71,200",
  tables: [],
  pages: 12,
  isScan: false,
  warnings: [],
});

/** A pre-read that settles everything: the room goes straight to the plan. */
const complete = (fileId: string, over: Partial<FilePreRead> = {}): FilePreRead => ({
  fileId,
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [{ label: "Revenue", accountCode: "net_sales_revenue", values: { FY2025: 71_200_000 }, confidence: "high" }],
    },
  ],
  company: "Hartwell Precision",
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1,
  statementQuality: "cpa_audited",
  quality: [],
  confidence: "high",
  ...over,
});

const STATEMENT: BoomFinancialStatement = {
  id: "st1",
  statementType: "income_statement",
  endDate: "2025-12-31",
  validationStatus: "not_validated",
  periods: [{ id: "p1", endDate: "2025-12-31", periodType: "annual" }],
  lineItems: [
    {
      id: "l1",
      name: "Net sales",
      hierarchy: "line_item",
      accountCode: "net_sales_revenue",
      flipSign: false,
      periodValues: { p1: 71_200_000 },
    },
  ],
};

function stubAdapter(over: Partial<BoomAdapter> = {}): BoomAdapter {
  return {
    async upload(): Promise<BoomUploadResult> {
      return { fileId: "boom1", companyId: "c1", fileGroupId: null, status: "processing" };
    },
    async status(): Promise<BoomUploadResult> {
      return {
        fileId: "boom1",
        companyId: "c1",
        fileGroupId: null,
        status: "completed",
        financialStatements: [STATEMENT],
        validationUrl: "https://boom.example/validate/boom1",
      };
    },
    ...over,
  };
}

function makeDeps(over: Partial<SpreadDeps> = {}): SpreadDeps {
  let n = 0;
  return {
    readDroppedFile: async (f: File) => dropped(f.name, `sha-${++n}`),
    extractDocument: async (d) => doc(d.id),
    preReadFile: async (d) => complete(d.fileId),
    provisionalRead: () => null,
    postRead: async () => [],
    adapter: stubAdapter(),
    ...over,
  };
}

function engineWith(over: Partial<SpreadDeps> = {}): SpreadEngine {
  return createSpreadEngine({ ctx: CTX, deps: makeDeps(over) });
}

/** The live lane, for the one assertion that is ABOUT the lane: only Boom's own
 *  adapter takes the provisional label off the panel. */
function liveEngineWith(over: Partial<SpreadDeps> = {}): SpreadEngine {
  return createSpreadEngine({ ctx: CTX, deps: makeDeps({ lane: "live", ...over }) });
}

let live: SpreadEngine | null = null;
afterEach(() => {
  live?.dispose();
  live = null;
  vi.useRealTimers();
});

describe("the stages", () => {
  it("opens on the drop zone with nothing read and nothing asked", () => {
    const engine = (live = engineWith());
    const s = engine.getState();
    expect(s.stage).toBe("idle");
    expect(s.cards).toEqual([]);
    expect(s.ask).toBeNull();
    expect(s.plan).toBeNull();
  });

  /* PIN MOVED 2026-09-13 (founder: the card was "a wall of eleven lines with
     duplicates"). The card fills with FACTS now, one to a beat, and the beat
     itself is unchanged: it is the same pump over a richer unit. */
  it("makes a card the moment a file lands and fills it in place, one fact to a beat", async () => {
    vi.useFakeTimers();
    const engine = (live = engineWith());
    const drop = engine.drop([file("hartwell-fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;

    const card = engine.getState().cards[0];
    expect(card.name).toBe("hartwell-fy2025.pdf");
    expect(card.phase).toBe("read");
    // The first fact is out the instant the read has it; the rest wait a beat.
    expect(card.facts.map((f) => f.key)).toEqual(["read"]);
    await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS);
    expect(engine.getState().cards[0].facts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 6);
    const facts = engine.getState().cards[0].facts;
    expect(facts.map((f) => f.key)).toEqual(["read", "statements", "periods", "company", "quality", "units"]);
    expect(facts.find((f) => f.key === "periods")?.value).toBe("FY2025");
    expect(facts.find((f) => f.key === "read")?.value).toBe("PDF with a text layer, 12 pages");
  });

  it("goes straight to the plan when the pre-read settled everything", async () => {
    const engine = (live = engineWith());
    await engine.drop([file("hartwell-fy2025.pdf")]);
    const s = engine.getState();
    expect(s.stage).toBe("plan");
    expect(s.ask).toBeNull();
    expect(s.plan?.summary).toBe("1 statement to Boom, Hartwell Precision: FY2025 audited income statement.");
  });

  it("says so on the card when the file prints no name it can read, and names what it spreads under", async () => {
    vi.useFakeTimers();
    const engine = (live = engineWith({
      preReadFile: async (d) => complete(d.fileId, { company: null, companyMatchesRelationship: null }),
    }));
    const drop = engine.drop([file("scan-of-fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;
    await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 10);

    const s = engine.getState();
    /* PIN MOVED 2026-09-13: the sentence "Printed name not found in this file;
       it spreads under X unless you say otherwise" is now the Printed name row
       and its tag, which says the same thing in the column a banker is already
       reading down. */
    const printed = s.cards[0].facts.find((f) => f.key === "company");
    expect(printed?.value).toBe("Not printed");
    expect(printed?.tag).toBe("spreads under Hartwell Precision");
    // A scan already asks three things. This is a row, not a fourth ask.
    expect(s.asks.some((a) => a.field === "company")).toBe(false);
    // And the plan the banker confirms repeats the relationship it goes under.
    expect(s.plan?.summary).toContain("Hartwell Precision");
  });

  it("names every statement in one governed sentence", () => {
    expect(
      planSummary(
        [
          {
            fileId: "f1",
            name: "annual.pdf",
            mime: "application/pdf",
            base64: "",
            sha256: "s",
            statementTypes: ["income_statement", "balance_sheet", "cash_flow_statement"],
            periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
            statementQuality: "cpa_audited",
          },
        ],
        "Hartwell Precision",
      ),
    ).toBe("3 statements to Boom, Hartwell Precision: FY2025 audited income statement, balance sheet, cash flow.");
  });
});

describe("the caps and the identity", () => {
  it("refuses a file over five megabytes in words, and reads nothing", async () => {
    const readDroppedFile = vi.fn();
    const engine = (live = engineWith({ readDroppedFile }));
    await engine.drop([file("scan.pdf", 6 * 1024 * 1024)]);
    expect(engine.getState().cards).toEqual([]);
    expect(engine.getState().refusals).toContain(tooBigLine("scan.pdf", 6 * 1024 * 1024));
    expect(readDroppedFile).not.toHaveBeenCalled();
    expect(engine.getState().stage).toBe("idle");
  });

  it("takes ten files and says why the eleventh is not in the plan", async () => {
    const engine = (live = engineWith());
    await engine.drop(Array.from({ length: 11 }, (_, i) => file(`f${i}.pdf`)));
    expect(engine.getState().cards).toHaveLength(MAX_FILES);
    expect(engine.getState().refusals).toContain(CAP_FILES_LINE);
  });

  it("recognises a re-drop of the same file by its hash rather than duplicating it", async () => {
    const engine = (live = engineWith({ readDroppedFile: async (f) => dropped(f.name, "same-hash") }));
    await engine.drop([file("fy2025.pdf")]);
    await engine.drop([file("fy2025-copy.pdf")]);
    expect(engine.getState().cards).toHaveLength(1);
    expect(engine.getState().refusals).toContain(duplicateLine("fy2025-copy.pdf"));
  });

  it("keeps a file the browser could not read out of the plan, in the room's own words", async () => {
    const engine = (live = engineWith({
      readDroppedFile: async () => {
        throw new Error("no");
      },
    }));
    await engine.drop([file("locked.pdf")]);
    expect(engine.getState().cards[0].phase).toBe("rejected");
    expect(engine.getState().cards[0].refusal).toContain("could not be read in the browser");
    expect(engine.getState().plan).toBeNull();
  });
});

describe("one ask at a time", () => {
  const scanned = () =>
    engineWith({ preReadFile: async (d) => complete(d.fileId, { statements: [], statementQuality: null }) });

  it("puts exactly one question in front of the banker and counts the rest", async () => {
    const engine = (live = scanned());
    await engine.drop([file("scan.pdf")]);
    const s = engine.getState();
    expect(s.stage).toBe("asking");
    expect(s.ask?.field).toBe("statementType");
    // What it is, which period, what quality: the three facts a scan gives the
    // room none of. One on screen, two counted.
    expect(s.asks).toHaveLength(3);
    expect(s.ask?.lead).toContain("scan.pdf");
  });

  it("ignores an answer to anything but the question on screen", async () => {
    const engine = (live = scanned());
    await engine.drop([file("scan.pdf")]);
    const later = engine.getState().asks[1].id;
    engine.answer(later, "FY2025");
    expect(engine.getState().ask?.field).toBe("statementType");
    expect(engine.getState().answers).toEqual({});
  });

  it("never re-asks what has been answered, and stages the plan when nothing is left", async () => {
    const engine = (live = scanned());
    await engine.drop([file("scan.pdf")]);
    const first = engine.getState().ask!.id;
    engine.answer(first, "balance_sheet");
    expect(engine.getState().ask?.field).toBe("periods");
    // A second click on the question that has gone lands nowhere.
    engine.answer(first, "income_statement");
    expect(engine.getState().answers[first]).toBe("balance_sheet");

    engine.answer(engine.getState().ask!.id, "FY2025");
    expect(engine.getState().ask?.field).toBe("statementQuality");
    engine.answer(engine.getState().ask!.id, "internal");
    expect(engine.getState().ask).toBeNull();
    expect(engine.getState().stage).toBe("plan");
    expect(engine.getState().plan?.summary).toContain("balance sheet");
  });

  it("recommends only what another file in the drop grounds, and says which file", async () => {
    /* An annual package: the opinion and the period end are on the cover PDF,
       the schedule that follows carries neither. */
    const engine = (live = engineWith({
      preReadFile: async (d) =>
        d.fileId.includes("schedule")
          ? complete(d.fileId, { statements: [], statementQuality: null })
          : complete(d.fileId),
    }));
    await engine.drop([file("cover.pdf"), file("schedule.pdf")]);

    engine.answer(engine.getState().ask!.id, "balance_sheet");
    const periods = engine.getState().ask!;
    expect(periods.field).toBe("periods");
    const rec = periods.chips.find((c) => c.recommended);
    expect(rec?.value).toBe("FY2025");
    expect(rec?.why).toBe("read from cover.pdf");
    // The book's own periods are offered and never recommended.
    expect(periods.chips.filter((c) => c.recommended)).toHaveLength(1);
    expect(periods.chips.map((c) => c.value)).toContain("FY2024");
  });

  it("states a company mismatch without recommending either side of it", async () => {
    const engine = (live = engineWith({
      preReadFile: async (d) =>
        complete(d.fileId, { company: "Hartwell Holdings LLC", companyMatchesRelationship: false }),
    }));
    await engine.drop([file("consolidated.pdf")]);
    const ask = engine.getState().ask!;
    expect(ask.field).toBe("company");
    expect(ask.lead).toContain("Hartwell Holdings LLC");
    expect(ask.chips.some((c) => c.recommended)).toBe(false);
  });

  it("ends every clause of the mismatch on one full stop, legal name or not", async () => {
    /* "piedmont-fy2025.pdf reads as Piedmont Precision Components, Inc.. The
       relationship in view is ..." was on the founder's screenshot of
       2026-09-13. A legal name ends in a period more often than not. */
    const engine = (live = engineWith({
      preReadFile: async (d) =>
        complete(d.fileId, { company: "Piedmont Precision Components, Inc.", companyMatchesRelationship: false }),
    }));
    await engine.drop([file("piedmont-fy2025.pdf")]);
    expect(engine.getState().ask!.lead).toBe(
      "piedmont-fy2025.pdf reads as Piedmont Precision Components, Inc. The relationship in view is Hartwell Precision.",
    );
  });

  /* ------------------------------------------------------------ the units

     THE FILE THAT SAYS SO IS NOT ASKED. The 2026-09-12 browser run asked a
     banker about the scale of a statement that prints "(in thousands)" twice on
     its face, and told them the statement did not say so plainly. It does, and
     the room now reads it and says so instead. */

  /** A read whose figures are printed small: thousands and dollars both fit. */
  const smallFigures = (fileId: string, over: Partial<FilePreRead> = {}): FilePreRead =>
    complete(fileId, {
      confidence: "low",
      statements: [
        {
          statementType: "income_statement",
          periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
          lines: [{ label: "Net sales revenue", accountCode: "net_sales_revenue", values: { FY2025: 71_200 }, confidence: "medium" }],
        },
      ],
      ...over,
    });

  it("does not ask about a scale the statement states plainly", async () => {
    const engine = (live = engineWith({
      preReadFile: async (d) =>
        smallFigures(d.fileId, {
          unitsMultiplier: 1_000,
          quality: [{ level: "info", text: unitsStatedNote(1_000) }],
          statements: [
            {
              statementType: "income_statement",
              periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
              lines: [
                { label: "Net sales revenue", accountCode: "net_sales_revenue", values: { FY2025: 71_200_000 }, confidence: "medium" },
              ],
            },
          ],
        }),
    }));
    await engine.drop([file("piedmont-fy2025.csv")]);
    expect(engine.getState().asks.some((a) => a.field === "units")).toBe(false);
    expect(engine.getState().stage).toBe("plan");
  });

  it("asks about the scale where the statement states none and the figures read either way", async () => {
    const engine = (live = engineWith({ preReadFile: async (d) => smallFigures(d.fileId) }));
    await engine.drop([file("export.csv")]);
    const ask = engine.getState().ask!;
    expect(ask.field).toBe("units");
    expect(ask.lead).toContain("the statement does not say so plainly");
    expect(ask.chips.find((c) => c.recommended)?.value).toBe("1");
  });

  it("does not ask about a scale where the figures are already at dollar scale", async () => {
    // Nothing states the scale, but $71.2m is not a figure a statement prints
    // in thousands, so there is nothing to ask.
    const engine = (live = engineWith({ preReadFile: async (d) => complete(d.fileId, { confidence: "low" }) }));
    await engine.drop([file("export.csv")]);
    expect(engine.getState().asks.some((a) => a.field === "units")).toBe(false);
  });

  it("takes a file out of the plan when the banker leaves it out", async () => {
    const engine = (live = engineWith({
      preReadFile: async (d) =>
        complete(d.fileId, { company: "Hartwell Holdings LLC", companyMatchesRelationship: false }),
    }));
    await engine.drop([file("consolidated.pdf")]);
    engine.answer(engine.getState().ask!.id, "exclude");
    expect(engine.getState().cards[0].excluded).toBe(true);
    expect(engine.getState().plan).toBeNull();
  });
});

describe("the ladder", () => {
  beforeEach(() => vi.useFakeTimers());

  it("lights one rung at a time and lands on Boom's own spread", async () => {
    let polls = 0;
    const engine = (live = liveEngineWith({
      adapter: stubAdapter({
        async status(): Promise<BoomUploadResult> {
          polls += 1;
          return polls < 3
            ? { fileId: "boom1", companyId: "c1", fileGroupId: null, status: "processing" }
            : {
                fileId: "boom1",
                companyId: "c1",
                fileGroupId: null,
                status: "completed",
                financialStatements: [STATEMENT],
                validationUrl: "https://boom.example/validate/boom1",
              };
        },
      }),
    }));

    const drop = engine.drop([file("fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;
    expect(engine.getState().stage).toBe("plan");

    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.getState().stage).toBe("sending");
    expect(engine.getState().rows[0].state).toBe("processing");

    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 2);
    expect(engine.getState().rows[0].state).toBe("processing");

    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    await run;
    const s = engine.getState();
    expect(s.rows[0].state).toBe("completed");
    expect(s.stage).toBe("spread");
    expect(s.statements).toHaveLength(1);
    expect(s.validationStatus).toBe("not_validated");
    expect(s.validationUrl).toBe("https://boom.example/validate/boom1");
    expect(s.figuresProvisional).toBe(false);
    expect(s.figures.revenue).toBe(71_200_000);
    expect(s.newPeriod).toBe("FY2025");
  });

  it("keeps the provisional label on while the stub lane is what answered", async () => {
    const engine = (live = engineWith());
    const drop = engine.drop([file("fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;
    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    await run;
    expect(engine.getState().statements).toHaveLength(1);
    expect(engine.getState().figuresProvisional).toBe(true);
  });

  it("shows Boom's own words on a failure and never calls it something else", async () => {
    const engine = (live = engineWith({
      adapter: stubAdapter({
        async upload(): Promise<BoomUploadResult> {
          return {
            fileId: "boom1",
            companyId: null,
            fileGroupId: null,
            status: "failed",
            message: "Unsupported file type",
          };
        },
      }),
    }));
    const drop = engine.drop([file("notes.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;
    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(0);
    await run;
    expect(engine.getState().rows[0].state).toBe("failed");
    expect(engine.getState().rows[0].message).toBe("Unsupported file type");
    expect(engine.getState().statements).toEqual([]);
  });

  it("says Boom is still spreading rather than freezing, and offers the two real options", async () => {
    const engine = (live = engineWith({
      adapter: stubAdapter({
        async status(): Promise<BoomUploadResult> {
          return { fileId: "boom1", companyId: "c1", fileGroupId: null, status: "processing" };
        },
      }),
    }));
    const drop = engine.drop([file("fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;

    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(SETTLE_BUDGET_MS + POLL_EVERY_MS);
    const stall = engine.getState().stall;
    expect(stall).not.toBeNull();
    expect(stall?.line).toContain("Boom is still spreading fy2025.pdf");
    expect(engine.getState().rows[0].state).toBe("processing");

    engine.leaveWithBoom();
    await vi.advanceTimersByTimeAsync(0);
    await run;
    expect(engine.getState().stall).toBeNull();
    expect(engine.getState().rows[0].stalled).toBe(true);
    expect(engine.getState().refusals).toContain(leftWithBoomLine("fy2025.pdf"));
    expect(engine.getState().stage).toBe("spread");
  });

  it("keeps waiting when the banker says so, and settles on the next answer", async () => {
    let polls = 0;
    const engine = (live = engineWith({
      adapter: stubAdapter({
        async status(): Promise<BoomUploadResult> {
          polls += 1;
          return polls > 40
            ? {
                fileId: "boom1",
                companyId: "c1",
                fileGroupId: null,
                status: "verified",
                financialStatements: [{ ...STATEMENT, validationStatus: "validated" }],
              }
            : { fileId: "boom1", companyId: "c1", fileGroupId: null, status: "processing" };
        },
      }),
    }));
    const drop = engine.drop([file("fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;

    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(SETTLE_BUDGET_MS + POLL_EVERY_MS);
    expect(engine.getState().stall).not.toBeNull();

    engine.keepWaiting();
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS * 6);
    await run;
    expect(engine.getState().rows[0].state).toBe("verified");
    expect(engine.getState().validationStatus).toBe("validated");
  });

  it("refuses a drop while Boom has the plan, in one sentence", async () => {
    const engine = (live = engineWith());
    const drop = engine.drop([file("fy2025.pdf")]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;
    const run = engine.confirm();
    await vi.advanceTimersByTimeAsync(POLL_EVERY_MS);
    await run;
    await engine.drop([file("more.pdf")]);
    expect(engine.getState().cards).toHaveLength(1);
    expect(engine.getState().refusals.join(" ")).toContain("Boom has this plan");
  });
});

/* =============================================================================
   THE GUIDED FLOW (founder, 2026-09-13, after driving the shipped room:
   "more streamlined, more guidance, more intuitive"; "the sent-to-Boom path is
   misleading"; the card was "a wall of eleven lines with duplicates").

   The spine, the one sentence that leads each stage, the curated card and the
   four-line brief the confirm carries are all pure functions of state, so they
   are proved here rather than in a DOM.
   ============================================================================= */

describe("the five-step spine", () => {
  it("lights exactly one step, ticks the ones behind it, and never runs backwards", () => {
    const stages: SpreadStage[] = ["idle", "reading", "asking", "plan", "sending", "spread"];
    for (const stage of stages) {
      const states = spreadSteps(stage);
      expect(states).toHaveLength(SPREAD_STEPS.length);
      expect(states.filter((s) => s === "on")).toHaveLength(1);
      const on = states.indexOf("on");
      expect(states.slice(0, on).every((s) => s === "done")).toBe(true);
      expect(states.slice(on + 1).every((s) => s === "idle")).toBe(true);
    }
    // Reading and asking are ONE step: the banker is looking at what the file
    // said and answering the one thing it did not.
    expect(spreadSteps("reading")).toEqual(spreadSteps("asking"));
    expect(SPREAD_STEPS.map((s) => s.label)).toEqual(["Drop", "Read", "Confirm", "Boom", "Financials"]);
  });

  it("walks the spine as the engine walks the stages", async () => {
    const engine = (live = engineWith());
    expect(spreadSteps(engine.getState().stage)[0]).toBe("on");
    await engine.drop([file("hartwell-fy2025.pdf")]);
    expect(engine.getState().stage).toBe("plan");
    expect(spreadSteps(engine.getState().stage)[2]).toBe("on");
    await engine.confirm();
    expect(spreadSteps(engine.getState().stage)[4]).toBe("on");
  });
});

describe("the one sentence that leads each stage", () => {
  const said = (stage: SpreadStage, ask: boolean = false) =>
    spreadGuidance({ stage, ask: ask ? ({} as never) : null, company: "Hartwell Precision" });

  it("names the relationship at the door and at the spread", () => {
    expect(said("idle")).toContain("Hartwell Precision");
    expect(said("spread")).toContain("Hartwell Precision");
  });

  it("says nothing has left the cockpit at the moment of the confirm", () => {
    expect(said("plan")).toContain("Nothing has left the cockpit yet");
  });

  it("asks for the answer only where there is a question on the glass", () => {
    expect(said("asking", true)).toContain("answer the one question below");
    expect(said("reading")).not.toContain("question");
  });

  it("is one sober line everywhere, with no em dash and no exclamation", () => {
    for (const stage of ["idle", "reading", "asking", "plan", "sending", "spread"] as SpreadStage[]) {
      for (const ask of [true, false]) {
        const line = spreadGuidance({ stage, ask: ask ? ({} as never) : null, company: "Hartwell Precision" });
        expect(line).not.toMatch(/—|!/);
        expect(line.length).toBeLessThan(160);
      }
    }
  });
});

describe("the card carries each fact once", () => {
  /** A pre-read that trips every note the deterministic read can write: a name
   *  that is not the relationship's, a period already on file, an auditor's
   *  report, a stated scale, and a desk that never answered. */
  const noisy = (fileId: string): FilePreRead =>
    complete(fileId, {
      company: "Piedmont Precision Components, Inc.",
      companyMatchesRelationship: false,
      unitsMultiplier: 1_000,
      statements: [
        {
          statementType: "income_statement",
          periods: [
            { key: "FY2024", endDate: "2024-12-31", periodType: "annual" },
            { key: "FY2025", endDate: "2025-12-31", periodType: "annual" },
          ],
          lines: [],
        },
      ],
      quality: [
        { level: "info", text: MODEL_FAILED_NOTE },
        {
          level: "info",
          text:
            'Read as audited: "Independent Auditor\'s Report: In our opinion, the financial statements present fairly, in all material respects, the financial position of the Company."',
        },
        { level: "info", text: unitsStatedNote(1_000) },
        {
          level: "warn",
          text: "This reads as Piedmont Precision Components, Inc., not Hartwell Precision. Confirm which borrower it is spread under.",
        },
        {
          level: "info",
          text: "FY2024 is already on file from the last spread. Boom keys the file on its hash, so the same document does not fork a second period.",
        },
      ],
    });

  const cardOf = () => {
    const pre = noisy("f1");
    return {
      pre,
      facts: cardFacts({ pre, kind: "pdf-text", pages: 1, ctx: CTX }),
      warnings: cardWarnings(pre),
      footnote: cardFootnote(pre),
    };
  };

  it("says the printed name once, and never twice", () => {
    const card = cardOf();
    const everything = [...card.facts.map((f) => [f.value, f.tag, f.quote].filter(Boolean).join(" ")), ...card.warnings];
    expect(everything.filter((line) => /Piedmont/.test(line))).toHaveLength(1);
    expect(card.facts.find((f) => f.key === "company")?.tag).toBe("differs from the relationship");
  });

  it("says the periods once, and puts what is already on file on the period itself", () => {
    const card = cardOf();
    const everything = [...card.facts.map((f) => [f.value, f.tag].filter(Boolean).join(" ")), ...card.warnings];
    expect(everything.filter((line) => /FY20\d\d|period/i.test(line))).toHaveLength(1);
    const periods = card.facts.find((f) => f.key === "periods");
    expect(periods?.value).toBe("FY2024, FY2025");
    expect(periods?.tag).toBe("FY2024 already on file");
  });

  it("quotes the auditor's report rather than printing the whole opinion", () => {
    const quote = cardOf().facts.find((f) => f.key === "quality")?.quote ?? "";
    expect(quote).toContain("Independent Auditor's Report");
    expect(quote.length).toBeLessThanOrEqual(81);
    expect(quote.endsWith("…")).toBe(true);
  });

  it("turns the desk's absence into one muted footnote in banker words", () => {
    const card = cardOf();
    expect(card.footnote).toBe(DEGRADED_FOOTNOTE);
    expect(card.footnote).not.toMatch(/desk/i);
    expect(card.warnings.join(" ")).not.toContain("desk");
  });

  it("keeps what the read could not do, which is not a fact restated", () => {
    const pre = complete("f2", {
      statements: [],
      statementQuality: null,
      quality: [{ level: "warn", text: "Sheet 2 is empty." }],
    });
    expect(cardWarnings(pre)).toEqual(["Sheet 2 is empty."]);
  });
});

describe("the four lines the confirm carries", () => {
  const read = (lines: string[]): ProvisionalRead => ({
    period: "FY2025",
    figures: {},
    onFile: {},
    onFilePeriod: "LTM",
    lines,
    provisional: true,
  });

  it("takes the top line, the ratios that move a test and the foot check, in that order", () => {
    const brief = provisionalBrief(
      read([
        "Revenue $71.20M against $64.20M LTM on file, up 10.9%.",
        "EBITDA is not stated: this file carries no depreciation and amortisation line.",
        "Provisional interest coverage 3.09x against 2.95x on file, operating profit over interest expense.",
        "Provisional leverage 2.10x against 2.42x on file.",
        "The balance sheet foots: total assets $52.00M against liabilities and equity of $52.00M.",
      ]),
    );
    expect(brief).toEqual([
      "Revenue $71.20M against $64.20M LTM on file, up 10.9%.",
      "Provisional interest coverage 3.09x against 2.95x on file, operating profit over interest expense.",
      "Provisional leverage 2.10x against 2.42x on file.",
      "The balance sheet foots: total assets $52.00M against liabilities and equity of $52.00M.",
    ]);
  });

  it("never runs past four lines, whatever the read placed", () => {
    expect(provisionalBrief(read(Array.from({ length: 12 }, (_, i) => `Line ${i}.`)))).toHaveLength(4);
  });

  it("has nothing to say where the read placed nothing", () => {
    expect(provisionalBrief(null)).toEqual([]);
    expect(provisionalBrief(read([]))).toEqual([]);
  });
});
