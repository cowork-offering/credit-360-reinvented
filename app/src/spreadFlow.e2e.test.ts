import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* THE CONNECTOR IS MOCKED SO IT CAN BE PROVED UNUSED.
   `callTool` is the ONE door out of this page to a connector. The stub lane must
   never touch it, and the only way to hold that is to own the door and assert it
   was never opened. Everything else in `channel/mcp` is the real module. */
const { callTool } = vi.hoisted(() => ({ callTool: vi.fn() }));
vi.mock("./channel/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./channel/mcp")>();
  return { ...actual, callTool };
});

import { normaliseBoom } from "../../client-360/render/boom-normalise.mjs";
import { createSpreadEngine, PRE_READ_BEAT_MS, type SpreadDeps, type SpreadEngine } from "./workroom/spreadEngine";
import { extractDocument, readDroppedFile } from "./spread/extract";
import { preReadFile, type RelationshipSpreadContext } from "./spread/preRead";
import { provisionalRead } from "./spread/provisional";
import { postRead } from "./spread/postRead";
import {
  stubBoomAdapter,
  registerPreRead,
  resetStubBoom,
  STUB_PROVISIONAL_MESSAGE,
} from "./channel/boomUpload";
import { publishSpread } from "./spread/publishSpread";
import type { Boom } from "./data/contract";

/* =============================================================================
   THE SPREAD, END TO END, ON THE LANE THAT ACTUALLY SHIPS.

   Three agents built the three halves of this flow against each other's
   interfaces. This is the one test that runs them TOGETHER, from a real file's
   bytes to a period on the relationship's book, with only two things faked: the
   session door (a model is not a fixture) and the clock.

   REAL: `readDroppedFile` over real bytes, `extractDocument` over a real CSV,
   the pre-read's own validation, the provisional read, the STUB Boom adapter
   with its own ladder and its own timing, the post-read's deterministic half,
   and `publishSpread` onto the book.

   FAKED: the session door, which answers with the JSON the contract specifies;
   and the timers, so the stub's four-to-eight seconds are spent instantly.

   NOT USED, AND PROVED NOT USED: the connector. There is no Boom connector
   today and the stub lane must not pretend otherwise, so `callTool` is mocked
   and asserted never called.

   THE FIGURES ARE PIEDMONT'S OWN, from client-360/assets/boom-spread.json. The
   book carries FY2023 and FY2024; the banker drops the FY2025 column.
   ============================================================================= */

const COMPANY = "Piedmont Precision Components, Inc.";
const ACCOUNT = "001bb00001DLtRMAA1";

/* --------------------------------------------------------------- the file */

/** The FY2025 income statement and balance sheet, as a banker's export. */
const CSV = [
  `${COMPANY}`,
  "Consolidated Financial Statements",
  "Fiscal year ended December 31, 2025",
  "",
  "Income Statement,FY2025",
  "Net Sales,64486000",
  "Cost of Sales,50422000",
  "Gross Profit,14064000",
  "Operating Expenses,11226000",
  "Income from Operations,2838000",
  "Interest Expense,-1076000",
  "Net Income,1390000",
  "",
  "Balance Sheet,FY2025",
  "Total Assets,46761000",
  "Total Liabilities,27891000",
  "Line of Credit and Current Portion of LTD,5674000",
  "Long-Term Debt Net of Current Portion,14456000",
  "Total Stockholders Equity,18870000",
  "",
].join("\n");

const droppedCsv = (): File =>
  new File([CSV], "piedmont-fy2025.csv", { type: "text/csv" });

/* ------------------------------------------------------------- the desk */

/** What the session door answers. The contract's own shape, nothing more: the
 *  validator in `preRead.ts` is what decides whether it is usable. */
const DESK_REPLY = JSON.stringify({
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [
        { label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2025: 64486000 }, confidence: "high" },
        { label: "Cost of Sales", accountCode: "cost_of_sales", values: { FY2025: 50422000 }, confidence: "high" },
        { label: "Gross Profit", accountCode: "gross_profit", values: { FY2025: 14064000 }, confidence: "high" },
        { label: "Income from Operations", accountCode: "operating_profit", values: { FY2025: 2838000 }, confidence: "high" },
        { label: "Interest Expense", accountCode: "interest_expense", values: { FY2025: -1076000 }, confidence: "high" },
        { label: "Net Income", accountCode: "net_income", values: { FY2025: 1390000 }, confidence: "high" },
      ],
    },
    {
      statementType: "balance_sheet",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [
        { label: "Total Assets", accountCode: "total_assets", values: { FY2025: 46761000 }, confidence: "high" },
        { label: "Total Liabilities", accountCode: "total_liabilities", values: { FY2025: 27891000 }, confidence: "high" },
        { label: "Line of Credit and Current Portion of LTD", accountCode: "st_loans_payable_bank", values: { FY2025: 5674000 }, confidence: "high" },
        { label: "Long-Term Debt", accountCode: "long_term_debt_bank", values: { FY2025: 14456000 }, confidence: "high" },
        { label: "Total Stockholders Equity", accountCode: "total_equity", values: { FY2025: 18870000 }, confidence: "high" },
      ],
    },
  ],
  company: COMPANY,
  currency: "USD",
  unitsMultiplier: 1,
  // NOT STATED IN THE FILE. This is what leaves exactly one question for the
  // banker, which is the invariant the room is built on.
  statementQuality: null,
  quality: [],
  confidence: "high",
});

/* --------------------------------------------------------------- the book */

const period = (id: string, endDate: string) => ({ id, endDate, periodType: "annual" as const });
const line = (id: string, name: string, accountCode: string, values: Record<string, number>) => ({
  id,
  name,
  hierarchy: "line_item" as const,
  accountCode,
  flipSign: false,
  periodValues: values,
});

/** Piedmont as Boom spread it through FY2024. */
function bookThroughFy2024(): Boom {
  return normaliseBoom({
    ratios: {
      asOf: "2024-12-31",
      raw: {
        revenue: 56_266_000,
        ebitda: 6_874_000,
        ebitdaMargin: 0.1222,
        totalDebt: 15_187_000,
        leverage: 2.21,
        interestCoverage: 4.95,
      },
    },
    spread: {
      file: {
        id: "file-on-book",
        fileName: "Piedmont_Precision_Components_Financials_FY2023-2024.xlsx",
        financialStatements: [
          {
            id: "book-is",
            statementType: "income_statement",
            endDate: "2024-12-31",
            validationStatus: "validated",
            periods: [period("book-p2023", "2023-12-31"), period("book-p2024", "2024-12-31")],
            lineItems: [
              line("book-is-1", "Net Sales", "net_sales_revenue", { "book-p2023": 59_915_000, "book-p2024": 56_266_000 }),
              line("book-is-2", "Income from Operations", "operating_profit", { "book-p2023": 3_555_000, "book-p2024": 4_685_000 }),
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
    { name: "Interest coverage", operator: ">=", threshold: 1.25, current: 4.95 },
    { name: "Debt service coverage", operator: ">=", threshold: 1.2, current: 1.44 },
  ],
  obligorGroup: [],
};

/* -------------------------------------------------------------- the wiring */

function deps(): SpreadDeps {
  return {
    readDroppedFile,
    extractDocument,
    // The door is the ONLY fake in the pre-read: every field it returns still
    // goes through the contract's own validation before the room sees it.
    preReadFile: (doc, ctx) => preReadFile(doc, ctx, { ask: async () => DESK_REPLY, available: () => true }),
    provisionalRead,
    // The deterministic half of the post-read: no door, so the facts stand
    // exactly as the module composes them.
    postRead: (args) => postRead(args, { available: () => false }),
    /* PINNED TO THE STUB LANE (0.9.28). `BOOM_UPLOAD_LANE` is "live" now,
       and what these cases are about is the ROOM's flow over a file's own
       numbers, with no connector in the path at all. The live lane is driven
       against Boom's own answers in spreadLiveLane.e2e.test.ts. */
    adapter: stubBoomAdapter(),
    lane: "stub" as const,
    registerPreRead,
    resetStub: resetStubBoom,
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

/** Drop the file and let every pre-read beat land. */
async function dropAndRead(e: SpreadEngine): Promise<void> {
  const drop = e.drop([droppedCsv()]);
  await vi.advanceTimersByTimeAsync(0);
  await drop;
  await vi.advanceTimersByTimeAsync(PRE_READ_BEAT_MS * 12);
}

describe("one file, one question, one plan, one spread", () => {
  it("walks the whole flow on the stub lane without ever calling a connector", async () => {
    const onFileBoom = bookThroughFy2024();
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps(), onFileBoom }));

    /* ---------------------------------------------------------- the card */
    await dropAndRead(e);
    const card = e.getState().cards[0];
    expect(card.phase).toBe("read");
    // THE SHA IS THE IDENTITY: the card is keyed on the content, not on the
    // order of the drop, which is the key Boom is asked to dedupe on.
    expect(card.id).toBe(`f_${card.sha256!.slice(0, 12)}`);

    /* THE SPEC'S ORDER: what the file is, then what it holds, then which
       periods, then whose it is. PIN MOVED 2026-09-13 (founder: the card read
       as a wall of duplicated sentences): the order is unchanged, the unit is a
       labelled fact instead of a sentence. */
    expect(card.facts.slice(0, 4).map((f) => [f.key, f.value])).toEqual([
      ["read", "CSV"],
      ["statements", "Income statement, balance sheet"],
      ["periods", "FY2025"],
      ["company", COMPANY],
    ]);

    /* ----------------------------------------------------------- the ask */
    expect(e.getState().stage).toBe("asking");
    const ask = e.getState().ask!;
    expect(ask.field).toBe("statementQuality");
    expect(ask.lead).toContain("piedmont-fy2025.csv");
    // ONE at a time, and this one is the only one.
    expect(e.getState().asks).toHaveLength(1);
    expect(ask.chips.map((c) => c.value)).toEqual(["cpa_audited", "cpa_reviewed", "cpa_compiled", "internal"]);
    // Nothing in the drop grounds a quality, so nothing is recommended.
    expect(ask.chips.some((c) => c.recommended)).toBe(false);

    /* ---------------------------------------------------------- the plan */
    e.answer(ask.id, "cpa_audited");
    expect(e.getState().ask).toBeNull();
    expect(e.getState().stage).toBe("plan");
    expect(e.getState().plan?.summary).toBe(
      `2 statements to Boom, ${COMPANY}: FY2025 audited income statement, balance sheet.`,
    );

    /* ------------------------------- the provisional read, before it goes */
    const provisional = e.getState().provisional!;
    expect(provisional.period).toBe("FY2025");
    expect(provisional.figures.revenue).toBe(64_486_000);
    expect(provisional.figures.interestCoverage).toBeCloseTo(2.6375, 3);
    expect(provisional.lines.join(" ")).toContain("against $56.27M FY2024 on file");
    expect(provisional.lines.join(" ")).toContain("The balance sheet foots");

    /* -------------------------------------------------------- the ladder */
    const run = e.confirm();
    await vi.advanceTimersByTimeAsync(30_000);
    await run;

    const state = e.getState();
    expect(state.stage).toBe("spread");
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].state).toBe("completed");
    expect(state.rows[0].message).toBe(STUB_PROVISIONAL_MESSAGE);
    expect(state.stall).toBeNull();

    /* ------------------------------------- the panel, on the same figures */
    // The stub builds its spread FROM the pre-read, so the panel's figures are
    // the pre-read's figures and nothing was invented on the way through.
    expect(state.figures.revenue).toBe(provisional.figures.revenue);
    expect(state.figures.coverage).toBeCloseTo(provisional.figures.interestCoverage!, 6);
    // No depreciation line in an income statement and a balance sheet, so no
    // EBITDA is claimed for the new period, here or anywhere.
    expect(state.figures.ebitda).toBe(onFileBoom.ratios?.ebitda);
    expect(state.figuresProvisional).toBe(true);
    expect(state.validationStatus).toBe("not_validated");
    expect(state.validationUrl).toBeNull();
    expect(state.newPeriod).toBe("FY2025");

    /* ------------------------------------------------------ the post-read */
    const post = state.postRead.join(" ");
    expect(post).toContain(`Boom has spread FY2025 for ${COMPANY}`);
    // THE COVENANT THAT MOVES IS NAMED, with the test it moves against.
    expect(post).toContain("Interest coverage tests at 2.64x on this spread against its 1.25x floor, above it.");
    expect(post).toContain("The last test nCino carries is 4.95x.");
    // And the one this spread cannot recompute says so rather than staying silent.
    expect(post).toContain("Debt service coverage is not recomputable from this spread");
    expect(post).toContain("not yet verified in Boom");

    /* --------------------------------------------------------- the book */
    const published = publishSpread({
      onFile: onFileBoom,
      statements: state.statements,
      provenance: "stub-provisional",
    });
    expect((published?.spread?.periods ?? []).map((p) => p.period)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect((published?.spread?.periods ?? []).at(-1)?.revenue).toBe(64_486_000);

    /* ----------------------------------------------- and no connector call */
    expect(callTool).not.toHaveBeenCalled();
  });
});
