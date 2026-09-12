import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* THE CONNECTOR IS MOCKED SO IT CAN BE PROVED UNUSED, exactly as in
   spreadFlow.e2e.test.ts: the stub lane must never open the one door out. */
const { callTool } = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock("./channel/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./channel/mcp")>();
  return { ...actual, callTool };
});

import { normaliseBoom } from "../../client-360/render/boom-normalise.mjs";
import { createSpreadEngine, PRE_READ_BEAT_MS, type SpreadDeps, type SpreadEngine } from "./workroom/spreadEngine";
import { extractDocument, readDroppedFile } from "./spread/extract";
import { MODEL_FAILED_NOTE, preReadFile, type RelationshipSpreadContext } from "./spread/preRead";
import { provisionalRead } from "./spread/provisional";
import { postRead } from "./spread/postRead";
import {
  BOOM_UPLOAD_LANE,
  boomAdapter,
  registerPreRead,
  resetStubBoom,
  STUB_FAILURE_MESSAGE,
  STUB_PROVISIONAL_MESSAGE,
} from "./channel/boomUpload";
import type { BoomFinancialStatement, ExtractedDocument } from "./spread/types";
import type { Boom } from "./data/contract";

/* =============================================================================
   THE SPREAD WITH NO MODEL IN THE PATH.

   This is the run that failed on stage on 2026-09-12: the release build, the
   probe's stub SAMPLE door, which answers `{}` to every ask. The pre-read's two
   attempts both came back unusable, the read carried no lines, and the stand-in
   for Boom answered "Boom could not read this file. Nothing in it could be
   placed on a statement." about a clean two-statement CSV that prints its own
   scale twice on its face.

   Boom classifies, extracts and maps (BOOM-UPLOAD-SPEC section 3). The layer
   that stands in for Boom has to do the same, and the room has to read a file
   that states "(in thousands)" rather than asking a banker what scale it is in.

   REAL: the bytes, the extraction, the deterministic pre-read, the provisional
   read, the stub adapter with its own ladder, the deterministic post-read.
   FAKED: the session door, which answers exactly what the stub door answers,
   and the clock.
   ============================================================================= */

const COMPANY = "Piedmont Precision Components, Inc.";
const ACCOUNT = "001bb00001DLtRMAA1";

/** The file the browser run dropped, character for character. */
const CSV = [
  "Piedmont Precision Components, Inc.",
  "Income Statement (in thousands)",
  "Fiscal year ended December 31,2025,2024",
  "Net sales revenue,71200,64486",
  "Cost of sales,49840,45140",
  "Gross profit,21360,19346",
  "Operating expenses,15960,14100",
  "Operating profit,5400,5246",
  "Interest expense,1750,1989",
  "Net income,2700,2400",
  "",
  "Balance Sheet (in thousands)",
  "As of December 31,2025,2024",
  "Total assets,52000,50000",
  "Total liabilities,32000,31500",
  "Total equity,20000,18500",
  "",
].join("\n");

const droppedCsv = (): File => new File([CSV], "piedmont-fy2025.csv", { type: "text/csv" });

/** WHAT THE STUB SAMPLE DOOR ANSWERS: an empty object, every time. */
const EMPTY_DOOR = async (): Promise<string> => "{}";

/* --------------------------------------------------------------- the book */

const period = (id: string, endDate: string) => ({ id, endDate, periodType: "annual" as const });

/** Piedmont as Boom spread it through FY2024. */
function bookThroughFy2024(): Boom {
  return normaliseBoom({
    ratios: {
      asOf: "2024-12-31",
      raw: {
        revenue: 64_486_000,
        ebitda: 6_874_000,
        ebitdaMargin: 0.1066,
        totalDebt: 15_187_000,
        leverage: 2.21,
        interestCoverage: 2.64,
      },
    },
    spread: {
      file: {
        id: "file-on-book",
        fileName: "Piedmont_FY2023-2024.xlsx",
        financialStatements: [
          {
            id: "book-is",
            statementType: "income_statement",
            endDate: "2024-12-31",
            validationStatus: "validated",
            periods: [period("book-p2024", "2024-12-31")],
            lineItems: [
              {
                id: "book-is-1",
                name: "Net Sales",
                hierarchy: "line_item" as const,
                accountCode: "net_sales_revenue",
                flipSign: false,
                periodValues: { "book-p2024": 64_486_000 },
              },
            ],
          },
        ],
      },
    },
  }) as Boom;
}

const CTX: RelationshipSpreadContext = {
  accountId: ACCOUNT,
  company: COMPANY,
  onFilePeriods: ["FY2023", "FY2024"],
  covenants: [
    { name: "Interest coverage", operator: ">=", threshold: 1.25, current: 2.64 },
    { name: "Debt service coverage", operator: ">=", threshold: 1.2, current: 1.44 },
  ],
  obligorGroup: [],
};

/* -------------------------------------------------------------- the wiring */

function deps(over: Partial<SpreadDeps> = {}): SpreadDeps {
  return {
    readDroppedFile,
    extractDocument,
    // The door is THERE and answers `{}`, which is what the probe's stub sample
    // door does. Both attempts fail validation and the deterministic read stands.
    preReadFile: (doc, ctx) => preReadFile(doc, ctx, { ask: EMPTY_DOOR, available: () => true }),
    provisionalRead,
    postRead: (args) => postRead(args, { available: () => false }),
    adapter: boomAdapter(),
    lane: BOOM_UPLOAD_LANE,
    registerPreRead,
    resetStub: resetStubBoom,
    ...over,
  };
}

let engine: SpreadEngine | null = null;

beforeEach(() => {
  resetStubBoom();
  callTool.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  engine?.dispose();
  engine = null;
  vi.useRealTimers();
  resetStubBoom();
});

async function dropAndRead(e: SpreadEngine, file: File): Promise<void> {
  const drop = e.drop([file]);
  await vi.advanceTimersByTimeAsync(0);
  await drop;
  await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 16);
}

/** The value of one account code at the newest period the spread carries. */
function valueOf(statements: BoomFinancialStatement[], accountCode: string): number | null {
  for (const statement of statements) {
    const newest = statement.periods
      .filter((p) => p.endDate)
      .sort((a, b) => (a.endDate as string).localeCompare(b.endDate as string))
      .at(-1);
    if (!newest) continue;
    const item = statement.lineItems.find((l) => l.accountCode === accountCode);
    const value = item?.periodValues[newest.id];
    if (typeof value === "number") return value;
  }
  return null;
}

describe("a clean statement spreads with no model in the path", () => {
  it("reads the file itself, asks nothing about a scale it printed, and lands a spread", async () => {
    const onFileBoom = bookThroughFy2024();
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps(), onFileBoom }));

    /* ---------------------------------------------------------- the card */
    await dropAndRead(e, droppedCsv());
    const card = e.getState().cards[0];
    expect(card.phase).toBe("read");
    expect(card.lines.slice(0, 3)).toEqual([
      "CSV, 0.0 MB",
      "2 statements: income statement, balance sheet",
      "Periods: FY2025, FY2024",
    ]);
    // The desk answered with nothing usable, twice, and the card says so in
    // words that are now true: the lines below were placed from the text.
    expect(card.lines).toContain(MODEL_FAILED_NOTE);
    // AND THE SCALE IS READ, NOT ASKED.
    expect(card.lines).toContain("Figures in thousands, as the statement says.");
    expect(card.pre?.unitsMultiplier).toBe(1_000);

    /* ----------------------------------------------------------- the ask */
    // The file carries no auditor's report, so the quality is the ONE question.
    // The units question the 2026-09-12 run raised is gone.
    expect(e.getState().asks.map((a) => a.field)).toEqual(["statementQuality"]);

    /* ------------------------------- the provisional read, before it goes */
    const provisional = e.getState().provisional!;
    expect(provisional.period).toBe("FY2025");
    expect(provisional.figures.revenue).toBe(71_200_000);
    expect(provisional.figures.totalAssets).toBe(52_000_000);
    expect(provisional.figures.interestCoverage).toBeCloseTo(3.0857, 3);
    expect(provisional.lines.join(" ")).toContain("Revenue $71.20M against $64.49M FY2024 on file");
    expect(provisional.lines.join(" ")).toContain("The balance sheet foots");

    /* ---------------------------------------------------------- the plan */
    e.answer(e.getState().ask!.id, "cpa_audited");
    expect(e.getState().stage).toBe("plan");
    expect(e.getState().plan?.summary).toBe(
      `2 statements to Boom, ${COMPANY}: FY2025, FY2024 audited income statement, balance sheet.`,
    );

    /* -------------------------------------------------------- the ladder */
    const run = e.confirm();
    await vi.advanceTimersByTimeAsync(30_000);
    await run;

    const state = e.getState();
    expect(state.stage).toBe("spread");
    expect(state.rows[0].state).toBe("completed");
    expect(state.rows[0].message).toBe(STUB_PROVISIONAL_MESSAGE);

    /* ------------------------------------------------------ the spread */
    expect(state.statements.map((s) => s.statementType)).toEqual(["income_statement", "balance_sheet"]);
    // THE FIGURES THE CSV PRINTS, AT THE SCALE IT STATES.
    expect(valueOf(state.statements, "net_sales_revenue")).toBe(71_200_000);
    expect(valueOf(state.statements, "total_assets")).toBe(52_000_000);
    expect(valueOf(state.statements, "total_liabilities")).toBe(32_000_000);
    expect(valueOf(state.statements, "total_equity")).toBe(20_000_000);
    expect(state.statements.every((s) => s.validationStatus === "not_validated")).toBe(true);
    expect(state.validationUrl).toBeNull();

    /* ---------------------------------------------------------- the panel */
    expect(state.figures.revenue).toBe(71_200_000);
    expect(state.figures.coverage).toBeCloseTo(3.0857, 3);
    expect(state.figuresProvisional).toBe(true);
    expect(state.newPeriod).toBe("FY2025");

    /* ------------------------------------------------------ the post-read */
    const post = state.postRead.join(" ");
    expect(post).toContain(`Boom has spread FY2025 for ${COMPANY}`);
    expect(post).toContain("Interest coverage tests at 3.09x on this spread against its 1.25x floor, above it.");
    expect(post).toContain("not yet verified in Boom");

    /* ----------------------------------------------- and no connector call */
    expect(callTool).not.toHaveBeenCalled();
  });
});

describe("what still goes to the banker, and what still fails", () => {
  const scan = (fileId: string): ExtractedDocument => ({
    fileId,
    kind: "pdf-scan",
    text: "",
    tables: [],
    pages: 3,
    isScan: true,
    warnings: [],
  });

  it("routes a scan to the three asks and fails honestly when nothing in it can be placed", async () => {
    const e = (engine = createSpreadEngine({
      ctx: CTX,
      deps: deps({ extractDocument: async (d) => scan(d.id) }),
      onFileBoom: bookThroughFy2024(),
    }));

    await dropAndRead(e, new File(["scanned bytes"], "piedmont-scan.pdf", { type: "application/pdf" }));

    // A scan gives the room nothing, so the banker answers the three facts Boom
    // needs. Nothing is placed and nothing is claimed.
    expect(e.getState().asks.map((a) => a.field)).toEqual(["statementType", "periods", "statementQuality"]);
    expect(e.getState().provisional).toBeNull();

    e.answer(e.getState().ask!.id, "balance_sheet");
    e.answer(e.getState().ask!.id, "FY2025");
    e.answer(e.getState().ask!.id, "internal");
    expect(e.getState().stage).toBe("plan");

    const run = e.confirm();
    await vi.advanceTimersByTimeAsync(30_000);
    await run;

    const state = e.getState();
    expect(state.rows[0].state).toBe("failed");
    expect(state.rows[0].message).toBe(STUB_FAILURE_MESSAGE);
    expect(state.statements).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });
});
