// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  BOOM_UPLOAD_LANE,
  boomAdapter,
  createGroupArgs,
  hierarchyFor,
  liveBoomAdapter,
  registerPreRead,
  resetStubBoom,
  SPREAD_STUB_PROCESSING_MS,
  statementsFromPreRead,
  statusArgs,
  stubBoomAdapter,
  stubBoomId,
  stubProcessingMs,
  STUB_FAILURE_MESSAGE,
  STUB_POISON_SHA256,
  STUB_PROVISIONAL_MESSAGE,
  uploadArgs,
  validationSessionArgs,
  type BoomToolCall,
} from "./boomUpload";
import { SERVERS, TOOLS, type McpOk } from "./mcp";
import { __resetLaneHealthForTests, laneOf, noteLaneSuccess } from "./laneHealth";
import { HealthLine } from "../components/HealthLine";
import type { BoomUploadRequest, FilePreRead } from "../spread/types";

/* =============================================================================
   THE BOOM ADAPTER.

   Two things are pinned here. THE CONTRACT: the tool names and argument shapes
   the cockpit asks Noland's server for, so the message handed to him and the
   code cannot drift apart silently. And THE STUB: Boom's real ladder, the
   pre-read mapped into Boom's own output shape, and the two sentences a banker
   reads over it. The stub is what ships until the Boom connector exists, so its
   honesty (provisional, never verified, no validation URL) is a test and not a
   comment.
   ============================================================================= */

/* ------------------------------------------------------- the on-file shape */

/** A pre-read of the Piedmont income statement, in the shape and figures the
 *  cockpit's on-file Boom spread carries (client-360/assets/boom-spread.json,
 *  Boom file 8b941a16…, FY2023-2025). The stub has to turn THIS into Boom's
 *  output shape, so the fixture is the real one rather than a toy. */
const PIEDMONT_PRE_READ: FilePreRead = {
  fileId: "f1",
  company: "Piedmont Precision Components, Inc.",
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1,
  statementQuality: "cpa_audited",
  quality: [],
  confidence: "high",
  statements: [
    {
      statementType: "income_statement",
      periods: [
        { key: "FY2023", endDate: "2023-12-31", periodType: "annual" },
        { key: "FY2024", endDate: "2024-12-31", periodType: "annual" },
        { key: "FY2025", endDate: "2025-12-31", periodType: "annual" },
      ],
      lines: [
        { label: "Net Sales", accountCode: "net_sales_revenue", confidence: "high", values: { FY2023: 59915000, FY2024: 56266000, FY2025: 64486000 } },
        { label: "Cost of Sales", accountCode: "cost_of_sales", confidence: "high", values: { FY2023: 45371000, FY2024: 40829000, FY2025: 50422000 } },
        { label: "Gross Profit", accountCode: "gross_profit", confidence: "high", values: { FY2023: 14544000, FY2024: 15437000, FY2025: 14064000 } },
        { label: "Operating Expenses", accountCode: "operating_expenses", confidence: "high", values: { FY2023: 10989000, FY2024: 10752000, FY2025: 11226000 } },
        { label: "Income from Operations", accountCode: "operating_profit", confidence: "high", values: { FY2023: 3555000, FY2024: 4685000, FY2025: 2838000 } },
        { label: "Interest Expense", accountCode: "interest_expense", confidence: "high", values: { FY2023: -1019000, FY2024: -947000, FY2025: -1076000 } },
        { label: "Net Income", accountCode: "net_income", confidence: "high", values: { FY2023: 1868000, FY2024: 2873000, FY2025: 1390000 } },
        // The pre-read could not place this one. It still belongs on the
        // statement; it simply rolls up nowhere.
        { label: "Other income", accountCode: null, confidence: "low", values: { FY2025: 41000 } },
      ],
    },
  ],
};

const SHA = "a".repeat(64);

const request = (over: Partial<BoomUploadRequest> = {}): BoomUploadRequest => ({
  accountId: "001bb00001DLtRMAA1",
  company: { externalUniqueId: "001bb00001DLtRMAA1", name: "Piedmont Precision Components, Inc." },
  file: { name: "Piedmont_FY2025.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: "UEsDBA==", sha256: SHA },
  externalUniqueId: SHA,
  statementQuality: "cpa_audited",
  ...over,
});

beforeEach(() => {
  resetStubBoom();
  __resetLaneHealthForTests();
});

afterEach(() => {
  resetStubBoom();
  __resetLaneHealthForTests();
  vi.useRealTimers();
  delete (window as unknown as { claude?: unknown }).claude;
});

/* ------------------------------------------------------------ the contract */

describe("the contract handed to Noland", () => {
  it("names the four tools the cockpit will ask for", () => {
    expect(TOOLS.boomUpload).toBe("boom_upload_statement");
    expect(TOOLS.boomUploadStatus).toBe("boom_upload_status");
    expect(TOOLS.boomCreateFileGroup).toBe("boom_create_file_group");
    expect(TOOLS.boomValidationSession).toBe("boom_validation_session");
  });

  it("addresses Boom at the gateway until Boom has a connector of its own", () => {
    // The flip is one line in mcp.ts. Until it happens the two Boom reads and
    // the upload lane share a door, which is what the health line says.
    expect(SERVERS.boom).toBe(SERVERS.gateway);
  });

  it("sends the file, the company and the sha256 as the file's external id", () => {
    const args = uploadArgs(request());
    expect(args).toEqual({
      company: { externalUniqueId: "001bb00001DLtRMAA1", name: "Piedmont Precision Components, Inc." },
      file: {
        name: "Piedmont_FY2025.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64: "UEsDBA==",
        sha256: SHA,
      },
      externalUniqueId: SHA,
      statementQuality: "cpa_audited",
    });
  });

  it("carries the address and the file group only when the plan has them", () => {
    const bare = uploadArgs(request());
    expect(bare).not.toHaveProperty("fileGroupId");
    expect((bare.company as Record<string, unknown>).fullAddress).toBeUndefined();
    const full = uploadArgs(
      request({
        company: { externalUniqueId: "001", name: "Piedmont", fullAddress: "1 Mill Road, Greensboro NC" },
        fileGroupId: "g-1",
      }),
    );
    expect((full.company as Record<string, unknown>).fullAddress).toBe("1 Mill Road, Greensboro NC");
    expect(full.fileGroupId).toBe("g-1");
  });

  it("keys the other three calls the way the message says", () => {
    expect(statusArgs("file-1")).toEqual({ fileId: "file-1" });
    expect(createGroupArgs("001")).toEqual({ companyExternalUniqueId: "001" });
    expect(validationSessionArgs("file-1")).toEqual({ fileId: "file-1" });
  });
});

/* ----------------------------------------------------------- the live lane */

/** A connector that records what it was asked and answers what it is told. */
function fakeCall(answer: (tool: string) => unknown, thrown?: unknown) {
  const calls: Array<{ server: string; tool: string; input: unknown; options: unknown }> = [];
  const call: BoomToolCall = async (server, tool, input, options) => {
    calls.push({ server, tool, input, options });
    if (thrown) throw thrown;
    return { payload: answer(tool), raw: {} } as McpOk<unknown>;
  };
  return { call, calls };
}

describe("the live adapter", () => {
  const completed = {
    fileId: "8b941a16-e697-4fea-8ff5-3bcc1e29e442",
    companyId: "c-1",
    fileGroupId: null,
    status: "completed",
    message: "Spread complete.",
    financialStatements: [],
    validationUrl: "https://app.boom.build/file-validation/8b941a16#token=bvs_x",
  };

  it("calls the Boom connector by display name, with the mapped arguments", async () => {
    const { call, calls } = fakeCall(() => completed);
    const res = await liveBoomAdapter(call).upload(request());
    expect(calls[0].server).toBe(SERVERS.boom);
    expect(calls[0].tool).toBe("boom_upload_statement");
    expect(calls[0].input).toEqual(uploadArgs(request()));
    expect(res.fileId).toBe(completed.fileId);
    expect(res.validationUrl).toBe(completed.validationUrl);
  });

  it("sends the upload as a WRITE: no read policy, so nothing auto-retries it", async () => {
    // A rejected upload is not proof the file never reached Boom.
    const { call, calls } = fakeCall(() => completed);
    await liveBoomAdapter(call).upload(request());
    expect((calls[0].options as { read?: boolean }).read).toBeUndefined();
  });

  it("polls status as a READ, so an idle connector session re-handshakes", async () => {
    const { call, calls } = fakeCall(() => ({ ...completed, status: "processing" }));
    const res = await liveBoomAdapter(call).status("file-1");
    expect(calls[0].tool).toBe("boom_upload_status");
    expect(calls[0].input).toEqual({ fileId: "file-1" });
    expect((calls[0].options as { read?: boolean }).read).toBe(true);
    expect(res.status).toBe("processing");
  });

  it("shows Boom's own words verbatim on a failure Boom reports", async () => {
    const { call } = fakeCall(() => ({ fileId: "f", status: "failed", message: "Unsupported file type: .pages" }));
    const res = await liveBoomAdapter(call).status("f");
    expect(res.status).toBe("failed");
    expect(res.message).toBe("Unsupported file type: .pages");
  });

  it("refuses to invent a fileId or a rung it was not given", async () => {
    await expect(liveBoomAdapter(fakeCall(() => "fine").call).upload(request())).rejects.toMatchObject({ code: "transform_error" });
    await expect(
      liveBoomAdapter(fakeCall(() => ({ fileId: "f", status: "spread" })).call).status("f"),
    ).rejects.toMatchObject({ code: "transform_error" });
    await expect(
      liveBoomAdapter(fakeCall(() => ({ status: "completed" })).call).upload(request()),
    ).rejects.toMatchObject({ code: "transform_error" });
  });

  it("falls back to the polled fileId when the answer omits it", async () => {
    const { call } = fakeCall(() => ({ status: "processing" }));
    expect((await liveBoomAdapter(call).status("file-9")).fileId).toBe("file-9");
  });

  it("reads the group id and the validation session off their own answers", async () => {
    const group = fakeCall(() => ({ fileGroupId: "grp-7" }));
    expect(await liveBoomAdapter(group.call).createGroup!("001")).toEqual({ fileGroupId: "grp-7" });
    const session = fakeCall(() => ({ url: "https://app.boom.build/x#token=y", expiresAt: "2026-09-12T13:00:00.000Z" }));
    expect(await liveBoomAdapter(session.call).validationSession!("f")).toEqual({
      url: "https://app.boom.build/x#token=y",
      expiresAt: "2026-09-12T13:00:00.000Z",
    });
    await expect(liveBoomAdapter(fakeCall(() => ({})).call).validationSession!("f")).rejects.toMatchObject({
      code: "transform_error",
    });
  });

  it("surfaces a transport failure exactly as every other lane does", async () => {
    const { call } = fakeCall(() => ({}), { code: "needs_reauth", message: "session expired", retract: true });
    await expect(liveBoomAdapter(call).upload(request())).rejects.toMatchObject({ code: "needs_reauth" });
  });
});

describe("the live adapter through the real call seam", () => {
  /** The runtime the page actually finds, pre-injected the way every channel
   *  test stubs it, so the deadline and the lane health line are the real ones. */
  function installMcp(callTool: (server: string, tool: string, input: unknown) => Promise<unknown>) {
    const calls: Array<[string, string, unknown]> = [];
    (window as unknown as { claude?: unknown }).claude = {
      mcp: {
        callTool: (server: string, tool: string, input: unknown) => {
          calls.push([server, tool, input]);
          return callTool(server, tool, input);
        },
        watchTool: () => () => {},
        listTools: async () => ({ servers: [] }),
        invalidate: async () => {},
      },
    };
    return calls;
  }

  it("records the Boom lane as live when the connector answers", async () => {
    installMcp(async () => ({ payload: { fileId: "f", status: "processing" } }));
    await liveBoomAdapter().upload(request());
    expect(laneOf(SERVERS.boom)?.state).toBe("live");
  });

  it("records the lane as unreachable and keeps the platform's own code", async () => {
    installMcp(async () => {
      throw { code: "server_not_connected", message: "no such connector" };
    });
    await expect(liveBoomAdapter().status("f")).rejects.toMatchObject({ code: "server_not_connected" });
    expect(laneOf(SERVERS.boom)?.state).toBe("unreachable");
    expect(laneOf(SERVERS.boom)?.grant).toBe("not-granted");
  });

  it("stops waiting on an upload that never answers, and stamps it ambiguous", async () => {
    // A write that runs out its clock may still have run. Nothing may retry it.
    vi.useFakeTimers();
    installMcp(() => new Promise(() => {}));
    const pending = liveBoomAdapter().upload(request());
    const seen = pending.catch((e) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(seen).resolves.toMatchObject({ timedOut: true, ambiguous: true, retryable: false });
  });
});

/* ----------------------------------------------------------- the stub lane */

describe("the stub adapter", () => {
  it("is the active lane today", () => {
    expect(BOOM_UPLOAD_LANE).toBe("stub");
    // The room asks for the adapter, never for a particular implementation.
    expect(typeof boomAdapter().upload).toBe("function");
    expect(typeof boomAdapter().status).toBe("function");
  });

  it("processes for four to eight seconds, fixed per file", () => {
    expect(SPREAD_STUB_PROCESSING_MS).toEqual([4000, 8000]);
    for (const seed of ["a", "b", "c", "d", SHA, STUB_POISON_SHA256]) {
      const ms = stubProcessingMs(stubBoomId(seed));
      expect(ms).toBeGreaterThanOrEqual(4000);
      expect(ms).toBeLessThanOrEqual(8000);
    }
    expect(stubProcessingMs("x")).toBe(stubProcessingMs("x"));
  });

  it("walks Boom's ladder: processing, then completed with the spread", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, PIEDMONT_PRE_READ);

    const sent = await boom.upload(request());
    expect(sent.status).toBe("processing");
    expect(sent.fileId).toBe(stubBoomId(SHA));
    expect(sent.financialStatements).toBeUndefined();

    const ms = stubProcessingMs(sent.fileId);
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect((await boom.status(sent.fileId)).status).toBe("processing");

    await vi.advanceTimersByTimeAsync(1);
    const done = await boom.status(sent.fileId);
    expect(done.status).toBe("completed");
    expect(done.financialStatements).toHaveLength(1);
    expect(done.message).toBe(STUB_PROVISIONAL_MESSAGE);
  });

  it("labels the spread provisional and never claims a verification", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, PIEDMONT_PRE_READ);
    const sent = await boom.upload(request());
    await vi.advanceTimersByTimeAsync(8000);
    const done = await boom.status(sent.fileId);
    expect(done.status).not.toBe("verified");
    expect(done.validationUrl).toBeNull();
    expect(done.financialStatements![0].validationStatus).toBe("not_validated");
    expect(done.message).toMatch(/Boom verification pending/);
    // There is no Boom page to send an analyst to, so the room must not offer one.
    expect(stubBoomAdapter().validationSession).toBeUndefined();
  });

  it("is idempotent: the same file is one file, one clock, one set of periods", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, PIEDMONT_PRE_READ);
    const first = await boom.upload(request());
    const ms = stubProcessingMs(first.fileId);
    await vi.advanceTimersByTimeAsync(ms - 1);
    // The re-drop must not put the file back at the start of the ladder.
    const second = await boom.upload(request());
    expect(second.fileId).toBe(first.fileId);
    await vi.advanceTimersByTimeAsync(1);
    const done = await boom.status(first.fileId);
    expect(done.status).toBe("completed");
    expect(done.financialStatements).toHaveLength(1);
    expect(done.financialStatements![0].periods).toHaveLength(3);
  });

  it("derives the file id from the sha256, so two different files never collide", async () => {
    const boom = stubBoomAdapter();
    const a = await boom.upload(request());
    const b = await boom.upload(request({ file: { ...request().file, sha256: "b".repeat(64) }, externalUniqueId: "b".repeat(64) }));
    expect(a.fileId).not.toBe(b.fileId);
    expect(stubBoomId(SHA)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("fails, in an upstream voice, when it has nothing to build a spread from", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    // No pre-read was ever registered for this file.
    const sent = await boom.upload(request());
    await vi.advanceTimersByTimeAsync(8000);
    const done = await boom.status(sent.fileId);
    expect(done.status).toBe("failed");
    expect(done.message).toBe(STUB_FAILURE_MESSAGE);
    expect(done.financialStatements).toBeUndefined();
  });

  it("fails on the poison sha256 even when a pre-read is in hand", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(STUB_POISON_SHA256, PIEDMONT_PRE_READ);
    const sent = await boom.upload(
      request({ file: { ...request().file, sha256: STUB_POISON_SHA256 }, externalUniqueId: STUB_POISON_SHA256 }),
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect((await boom.status(sent.fileId)).status).toBe("failed");
  });

  it("a pre-read with no placed lines is not a spread", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, { ...PIEDMONT_PRE_READ, statements: [{ statementType: "balance_sheet", periods: [], lines: [] }] });
    const sent = await boom.upload(request());
    await vi.advanceTimersByTimeAsync(8000);
    expect((await boom.status(sent.fileId)).status).toBe("failed");
  });

  it("a pre-read whose lines print no figure is not a spread either", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, {
      ...PIEDMONT_PRE_READ,
      statements: [
        {
          statementType: "balance_sheet",
          periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
          lines: [{ label: "Total Assets", accountCode: null, confidence: "low", values: { FY2025: null } }],
        },
      ],
    });
    const sent = await boom.upload(request());
    await vi.advanceTimersByTimeAsync(8000);
    const done = await boom.status(sent.fileId);
    expect(done.status).toBe("failed");
    expect(done.message).toBe(STUB_FAILURE_MESSAGE);
  });

  it("spreads a pre-read whose lines carry figures but no codes, because Boom maps", async () => {
    vi.useFakeTimers();
    const boom = stubBoomAdapter();
    registerPreRead(SHA, {
      ...PIEDMONT_PRE_READ,
      statements: [
        {
          statementType: "balance_sheet",
          periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
          lines: [{ label: "Total Assets", accountCode: null, confidence: "low", values: { FY2025: 52_000_000 } }],
        },
      ],
    });
    const sent = await boom.upload(request());
    await vi.advanceTimersByTimeAsync(8000);
    const done = await boom.status(sent.fileId);
    expect(done.status).toBe("completed");
    const [statement] = done.financialStatements ?? [];
    expect(statement.lineItems[0].accountCode).toBe("total_assets");
    expect(statement.aggregatedFinancials?.[0].accountCode).toBe("total_assets");
  });

  it("says so plainly when asked about a file it never took", async () => {
    const done = await stubBoomAdapter().status("no-such-file");
    expect(done.status).toBe("failed");
    expect(done.message).toBe("Boom has no file with that id.");
  });

  it("mints a group id per company, the same one every time", async () => {
    const boom = stubBoomAdapter();
    expect(await boom.createGroup!("001")).toEqual(await boom.createGroup!("001"));
    expect((await boom.createGroup!("001")).fileGroupId).not.toBe((await boom.createGroup!("002")).fileGroupId);
  });
});

/* --------------------------------------------- the pre-read, in Boom's shape */

describe("pre-read to BoomFinancialStatement", () => {
  const [statement] = statementsFromPreRead("file-1", PIEDMONT_PRE_READ);

  it("keeps Boom's statement shape, keyed by generated period ids", () => {
    expect(statement.id).toBe("file-1-s1");
    expect(statement.statementType).toBe("income_statement");
    expect(statement.endDate).toBe("2025-12-31");
    expect(statement.periods).toEqual([
      { id: "file-1-s1-p1", endDate: "2023-12-31", periodType: "annual" },
      { id: "file-1-s1-p2", endDate: "2024-12-31", periodType: "annual" },
      { id: "file-1-s1-p3", endDate: "2025-12-31", periodType: "annual" },
    ]);
  });

  it("carries the file's own figures onto the period ids", () => {
    const sales = statement.lineItems.find((l) => l.accountCode === "net_sales_revenue")!;
    expect(sales.name).toBe("Net Sales");
    expect(sales.periodValues).toEqual({ "file-1-s1-p1": 59915000, "file-1-s1-p2": 56266000, "file-1-s1-p3": 64486000 });
    // A period the line does not print is null, not absent and not zero.
    const other = statement.lineItems.find((l) => l.name === "Other income")!;
    expect(other.periodValues).toEqual({ "file-1-s1-p1": null, "file-1-s1-p2": null, "file-1-s1-p3": 41000 });
  });

  it("infers Boom's hierarchy from the account code the pre-read placed", () => {
    const hierarchy = Object.fromEntries(statement.lineItems.map((l) => [l.name, l.hierarchy]));
    expect(hierarchy["Net Sales"]).toBe("line_item");
    expect(hierarchy["Gross Profit"]).toBe("subtotal");
    expect(hierarchy["Income from Operations"]).toBe("subtotal");
    expect(hierarchy["Other income"]).toBe("line_item");
    expect(hierarchyFor("total_assets")).toBe("total");
    expect(hierarchyFor(null)).toBe("line_item");
  });

  it("never claims a sign convention it was not told", () => {
    expect(statement.lineItems.every((l) => l.flipSign === false)).toBe(true);
  });

  it("rolls the placed lines up by account code, and leaves the unplaced ones out", () => {
    const rows = Object.fromEntries((statement.aggregatedFinancials ?? []).map((r) => [r.accountCode, r]));
    expect(rows.net_sales_revenue.periodValues["file-1-s1-p3"]).toBe(64486000);
    expect(rows.net_sales_revenue.accountName).toBe("Net Sales");
    expect(rows.interest_expense.periodValues["file-1-s1-p2"]).toBe(-947000);
    // Seven of the eight lines carry a code; the eighth rolls up nowhere.
    expect(Object.keys(rows)).toHaveLength(7);
  });

  it("maps the rows the pre-read left unplaced, the way Boom would", () => {
    /* THE STAND-IN MAPS. Boom classifies, extracts and maps (BOOM-UPLOAD-SPEC
       section 3), so a stand-in that only passed codes through would fail on
       exactly the files the session door could not read. */
    const [placed] = statementsFromPreRead("file-3", {
      ...PIEDMONT_PRE_READ,
      statements: [
        {
          statementType: "income_statement",
          periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
          lines: [
            { label: "Net sales revenue", accountCode: null, confidence: "low", values: { FY2025: 71_200_000 } },
            { label: "Deferred rent", accountCode: null, confidence: "low", values: { FY2025: 12_000 } },
          ],
        },
      ],
    });
    expect(placed.lineItems.map((l) => l.accountCode)).toEqual(["net_sales_revenue", null]);
    // And the roll-up carries only what was placed, as before.
    expect((placed.aggregatedFinancials ?? []).map((r) => r.accountCode)).toEqual(["net_sales_revenue"]);
  });

  it("keeps every statement in a file that carries several", () => {
    const both = statementsFromPreRead("file-2", {
      ...PIEDMONT_PRE_READ,
      statements: [
        PIEDMONT_PRE_READ.statements[0],
        {
          statementType: "balance_sheet",
          periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
          lines: [{ label: "Total Assets", accountCode: "total_assets", confidence: "high", values: { FY2025: 46761000 } }],
        },
      ],
    });
    expect(both.map((s) => s.statementType)).toEqual(["income_statement", "balance_sheet"]);
    expect(both[1].id).toBe("file-2-s2");
    expect(both[1].lineItems[0].hierarchy).toBe("total");
  });
});

/* -------------------------------------------------------- the health line */

describe("the Boom row on the health line", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("reads 'Boom (via gateway)' on ONE row, because the two names are one lane", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as unknown as { claude?: unknown }).claude = {
      mcp: {
        callTool: vi.fn(),
        watchTool: vi.fn().mockReturnValue(() => {}),
        listTools: vi.fn().mockResolvedValue({ servers: [{ server: SERVERS.gateway, authStatus: "connected", tools: [] }] }),
        invalidate: vi.fn(),
      },
    };
    // The lane has answered, so it has something to say and earns its row.
    act(() => noteLaneSuccess(SERVERS.boom, Date.UTC(2026, 8, 12, 12, 0, 0)));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(HealthLine)));
    await act(async () => {});

    const rows = [...container.querySelectorAll<HTMLElement>(".hl-lane-btn")].filter(
      (b) => b.getAttribute("data-lane") === SERVERS.gateway,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/^Boom \(via gateway\) live/);
  });
});
