// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  awaitArgs,
  awaitDeadlineMs,
  BOOM_BASE64_CAP_BYTES,
  BOOM_MAX_FILE_BYTES,
  BOOM_READY,
  BOOM_UPLOAD_LANE,
  boomAdapter,
  createUploadArgs,
  ensureCompanyArgs,
  fileArgs,
  hierarchyFor,
  listFilesArgs,
  liveBoomAdapter,
  registerPreRead,
  resetStubBoom,
  SPREAD_STUB_PROCESSING_MS,
  statementsFromPreRead,
  stubBoomAdapter,
  stubBoomId,
  stubProcessingMs,
  STUB_FAILURE_MESSAGE,
  STUB_POISON_SHA256,
  STUB_PROVISIONAL_MESSAGE,
  uploadBytesArgs,
  type BoomToolCall,
} from "./boomUpload";
import { isBoomNotFound, readBoom, readBoomAnswer } from "./boom";
import { BOOM_AWAIT_SECONDS } from "../workroom/spreadEngine";
import {
  BOOM_FALLBACK_NAME,
  boomServer,
  discoverBoomServer,
  noteBoomServers,
  resetBoomServer,
} from "./boomLane";
import { BOOM_SIGNATURE_TOOLS, READ_DEADLINE_MS, SERVERS, TOOLS, type McpOk } from "./mcp";
import { normaliseBoom } from "../../../client-360/render/boom-normalise.mjs";
import { interestCoverageAt } from "../spread/coverage";
import { isProvisionalPeriod, publishSpread } from "../spread/publishSpread";

/* THE LIVE SERVER'S OWN ANSWERS, saved verbatim on 2026-09-15. */
import AWAIT from "../__fixtures__/boom-live/await-piedmont.json";
import FILE from "../__fixtures__/boom-live/file-piedmont.json";
import FILE_PROCESSING from "../__fixtures__/boom-live/file-processing.json";
import FILES from "../__fixtures__/boom-live/files-piedmont.json";
import NOT_FOUND from "../__fixtures__/boom-live/ratios-not-found.json";
import RATIOS from "../__fixtures__/boom-live/ratios-piedmont.json";
import SPREAD from "../__fixtures__/boom-live/spread-piedmont.json";

/** A fixture, in the shape `callTool` resolves with. */
const payload = (body: unknown): McpOk<unknown> => ({ payload: body, raw: {} });

/** The name Boom holds the Piedmont workbook under, off the live file list. */
const PIEDMONT_FILE_NAME = "Piedmont_Precision_Components_Financials_FY2023-2025.xlsx";
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
  resetBoomServer();
  __resetLaneHealthForTests();
  vi.useRealTimers();
  delete (window as unknown as { claude?: unknown }).claude;
});

/* ------------------------------------------------------------ the contract

   THE FIXTURES ARE THE REAL SERVER'S OWN ANSWERS. `src/__fixtures__/boom-live/`
   holds what `boom-mcp` returned on 2026-09-15, saved verbatim (the presigned
   downloadUrl redacted, because that is never staged): the Piedmont spread, its
   ratio set, the file rows for a verified and a processing file, the file list,
   the bounded wait's answer and Boom's own 404. Every assertion below runs on
   those, so a shape nobody typed is what the adapter is proved against.        */

describe("the contract the live server publishes", () => {
  it("names the ladder the cockpit walks, and the reads beside it", () => {
    expect(TOOLS.boomEnsureCompany).toBe("boom_ensure_company");
    expect(TOOLS.boomListFiles).toBe("boom_list_files");
    expect(TOOLS.boomCreateUpload).toBe("boom_create_upload");
    expect(TOOLS.boomUploadBytes).toBe("boom_upload_bytes");
    expect(TOOLS.boomProcessFile).toBe("boom_process_file");
    expect(TOOLS.boomAwaitFile).toBe("boom_await_file");
    expect(TOOLS.boomGetFile).toBe("boom_get_file");
    expect(TOOLS.boomOpenVerification).toBe("boom_open_verification");
  });

  it("carries neither Boom read on the old relay prefix any more", () => {
    // 0.9.28: Boom's own server publishes them under their own names.
    // 2026-09-15: IDB Gateway retired; the restate assist is session-door only,
    // so there is no relay connector left to tell Boom apart from.
    expect(TOOLS.boomRatios).toBe("boom_get_ratios");
    expect(TOOLS.boomSpread).toBe("boom_get_spread");
    expect(Object.values(SERVERS)).not.toContain("IDB Gateway");
  });

  it("keys every call the way the server's own schema does", () => {
    expect(ensureCompanyArgs(request())).toEqual({
      name: "Piedmont Precision Components, Inc.",
      salesforceRecordId: "001bb00001DLtRMAA1",
    });
    expect(ensureCompanyArgs(request({ company: { externalUniqueId: "001", name: "P", fullAddress: "1 Mill Road" } }))).toEqual({
      name: "P",
      salesforceRecordId: "001",
      fullAddress: "1 Mill Road",
    });
    expect(listFilesArgs("001")).toEqual({ salesforceRecordId: "001" });
    expect(createUploadArgs(request())).toEqual({
      fileName: "Piedmont_FY2025.xlsx",
      salesforceRecordId: "001bb00001DLtRMAA1",
      externalUniqueId: SHA,
    });
    expect(createUploadArgs(request({ fileGroupId: "g-1" })).fileGroupId).toBe("g-1");
    expect(uploadBytesArgs("f-1", request())).toEqual({
      fileId: "f-1",
      contentBase64: "UEsDBA==",
      fileName: "Piedmont_FY2025.xlsx",
    });
    expect(fileArgs("f-1")).toEqual({ fileId: "f-1" });
    expect(awaitArgs("f-1", 20)).toEqual({ fileId: "f-1", maxSeconds: 20 });
  });

  it("caps the file at what fits inside Boom's 3 MB of base64", () => {
    expect(BOOM_BASE64_CAP_BYTES).toBe(3 * 1024 * 1024);
    // Base64 costs four bytes for every three, so the file cap is three quarters.
    expect(BOOM_MAX_FILE_BYTES).toBe(2_359_296);
    expect(Math.ceil(BOOM_MAX_FILE_BYTES / 3) * 4).toBeLessThanOrEqual(BOOM_BASE64_CAP_BYTES);
  });

  it("treats completed and verified alike as readable", () => {
    // `verified` only adds that an analyst signed the spread off in Boom.
    expect([...BOOM_READY].sort()).toEqual(["completed", "verified"]);
  });
});

/* ------------------------------------------------------- the envelope */

describe("the envelope, on the server's own answers", () => {
  it("reads the file body out of its wrapper, with the source stamp", () => {
    const read = readBoomAnswer<Record<string, unknown>>(payload(FILE), "file")!;
    expect(read.envelope.source).toBe("BOOM-LIVE");
    expect(read.envelope.contractVersion).toBe("1.0");
    expect(read.body.id).toBe("cf677dcc-594c-45b5-b47d-c92c0b2ee909");
    expect(read.body.status).toBe("verified");
  });

  it("reads the spread body out of its wrapper, and the period it describes", () => {
    const read = readBoomAnswer<Record<string, unknown>>(payload(SPREAD), "spread")!;
    expect(read.envelope.asOf).toBe("2025-12-31");
    expect((read.body.financialStatements as unknown[]).length).toBe(3);
  });

  it("turns Boom's own 404 into a state, not a transport failure", () => {
    // Hartwell is genuinely not in Boom on the founder's org, and this is what
    // the server says about it.
    let thrown: unknown;
    try {
      readBoomAnswer(payload(NOT_FOUND));
    } catch (e) {
      thrown = e;
    }
    expect(isBoomNotFound(thrown)).toBe(true);
    expect((thrown as { message: string }).message).toMatch(/Company Not Found/);
  });
});

/* --------------------------------------------------------- the discovery */

describe("finding the Boom connector", () => {
  afterEach(() => resetBoomServer());

  it("takes the server that serves both Boom reads, whatever it is called", () => {
    expect(
      noteBoomServers(
        [
          { server: "Customer 360", tools: [{ name: "Customer360Snapshot" }] },
          { server: "Spreading", tools: [{ name: "boom_get_ratios" }, { name: "boom_get_spread" }] },
        ],
        BOOM_SIGNATURE_TOOLS,
      ),
    ).toBe("Spreading");
    expect(boomServer()).toBe("Spreading");
  });

  it("falls back to the name the manifest declares when nothing matches", () => {
    // Half the signature is not Boom: a server serving one read could be any
    // relay, and addressing the upload ladder at it would be a guess.
    expect(noteBoomServers([{ server: "Half", tools: [{ name: "boom_get_ratios" }] }], BOOM_SIGNATURE_TOOLS)).toBeNull();
    expect(boomServer()).toBe(BOOM_FALLBACK_NAME);
    expect(BOOM_FALLBACK_NAME).toBe("Boom");
  });

  it("asks the runtime once, however many surfaces ask it", async () => {
    const list = vi.fn().mockResolvedValue([{ server: "Boom MCP", tools: BOOM_SIGNATURE_TOOLS.map((name) => ({ name })) }]);
    const [a, b] = await Promise.all([
      discoverBoomServer(list, BOOM_SIGNATURE_TOOLS),
      discoverBoomServer(list, BOOM_SIGNATURE_TOOLS),
    ]);
    expect([a, b]).toEqual(["Boom MCP", "Boom MCP"]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("says the fallback where the runtime cannot enumerate servers at all", async () => {
    await expect(discoverBoomServer(async () => undefined, BOOM_SIGNATURE_TOOLS)).resolves.toBe(BOOM_FALLBACK_NAME);
  });
});

/* ----------------------------------------------------------- the live lane */

/** A connector that records what it was asked and answers per tool. */
function fakeCall(answers: Record<string, unknown>, thrown?: unknown) {
  const calls: Array<{ server: string; tool: string; input: unknown; options: unknown }> = [];
  const call: BoomToolCall = async (server, tool, input, options) => {
    calls.push({ server, tool, input, options });
    if (thrown) throw thrown;
    return { payload: answers[tool] ?? envelope({}), raw: {} } as McpOk<unknown>;
  };
  return { call, calls, tools: () => calls.map((c) => c.tool) };
}

/** The server's own envelope around a body. */
const envelope = (body: Record<string, unknown>) => ({
  contractVersion: "1.0",
  _source: "BOOM-LIVE",
  _provenance: { system: "Boom", record: "file", ids: {}, asOf: "2025-12-31" },
  ...body,
});

/** Every rung answering the way the live server does, with no file on file. */
const LADDER_ANSWERS = {
  boom_ensure_company: envelope({ company: { id: "70d9bd23-a4f7-46ab-92d8-9b784e034877" } }),
  boom_list_files: envelope({ files: [] }),
  boom_create_upload: envelope({ file: { id: "new-file-1", fileName: "Piedmont_FY2025.xlsx", status: "waiting_for_upload" } }),
  boom_upload_bytes: envelope({ fileId: "new-file-1" }),
  boom_process_file: envelope({ fileId: "new-file-1", status: "processing" }),
};

describe("the live adapter", () => {
  beforeEach(() => {
    resetBoomServer();
    (window as unknown as { claude?: unknown }).claude = {
      mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: async () => ({ servers: [] }), invalidate: async () => {} },
    };
  });
  afterEach(() => resetBoomServer());

  it("walks the four rungs in order, with the server's own argument names", async () => {
    const { call, calls, tools } = fakeCall(LADDER_ANSWERS);
    const res = await liveBoomAdapter(call).upload(request());
    expect(tools()).toEqual([
      "boom_ensure_company",
      "boom_list_files",
      "boom_create_upload",
      "boom_upload_bytes",
      "boom_process_file",
    ]);
    expect(calls.every((c) => c.server === SERVERS.boom)).toBe(true);
    expect(calls[0].input).toEqual(ensureCompanyArgs(request()));
    expect(calls[2].input).toEqual(createUploadArgs(request()));
    expect(calls[3].input).toEqual(uploadBytesArgs("new-file-1", request()));
    expect(res).toMatchObject({ fileId: "new-file-1", companyId: "70d9bd23-a4f7-46ab-92d8-9b784e034877", status: "processing" });
  });

  it("sends the write rungs as WRITES, so nothing auto-retries them", async () => {
    // A rejected upload is not proof the file never reached Boom.
    const { call, calls } = fakeCall(LADDER_ANSWERS);
    await liveBoomAdapter(call).upload(request());
    const write = calls.filter((c) => c.tool !== "boom_list_files");
    expect(write.every((c) => (c.options as { read?: boolean }).read === undefined)).toBe(true);
    expect((calls.find((c) => c.tool === "boom_list_files")!.options as { read?: boolean }).read).toBe(true);
  });

  it("reuses the file Boom already holds rather than reserving a second", async () => {
    const { call, tools } = fakeCall({ ...LADDER_ANSWERS, boom_list_files: FILES });
    const res = await liveBoomAdapter(call).upload(request({ file: { ...request().file, name: PIEDMONT_FILE_NAME } }));
    expect(tools()).toEqual(["boom_ensure_company", "boom_list_files"]);
    expect(res.reused).toBe(true);
    // The VERIFIED file, not the one still processing and not a second upload.
    expect(res.fileId).toBe("cf677dcc-594c-45b5-b47d-c92c0b2ee909");
    expect(res.status).toBe("verified");
  });

  it("does not reuse a file Boom failed on: that drop is a deliberate re-send", async () => {
    const failed = { ...FILES, files: [{ ...FILES.files[4], status: "failed" }] };
    const { call, tools } = fakeCall({ ...LADDER_ANSWERS, boom_list_files: failed });
    await liveBoomAdapter(call).upload(request({ file: { ...request().file, name: PIEDMONT_FILE_NAME } }));
    expect(tools()).toContain("boom_create_upload");
  });

  it("refuses a file past Boom's base64 cap in one sentence, before it sends anything", async () => {
    const { call, calls } = fakeCall(LADDER_ANSWERS);
    const oversize = request({ file: { ...request().file, base64: "A".repeat(BOOM_BASE64_CAP_BYTES + 1) } });
    await expect(liveBoomAdapter(call).upload(oversize)).rejects.toMatchObject({ code: "transform_error" });
    expect(calls).toHaveLength(0);
  });

  it("reads the file, then Boom's own spread once the file is readable", async () => {
    const { call, tools } = fakeCall({ boom_get_file: payload(FILE).payload, boom_get_spread: payload(SPREAD).payload });
    const res = await liveBoomAdapter(call).status("cf677dcc-594c-45b5-b47d-c92c0b2ee909");
    expect(tools()).toEqual(["boom_get_file", "boom_get_spread"]);
    expect(res.status).toBe("verified");
    expect(res.fileName).toBe("Piedmont_Precision_Components_Financials_FY2023-2025.xlsx");
    expect(res.financialStatements).toHaveLength(3);
  });

  it("does not read a spread out of a file that is still processing", async () => {
    const { call, tools } = fakeCall({ boom_get_file: payload(FILE_PROCESSING).payload });
    const res = await liveBoomAdapter(call).status("d6a2ecc3-5321-47c3-8615-a2879d629108");
    expect(tools()).toEqual(["boom_get_file"]);
    expect(res.status).toBe("processing");
    expect(res.financialStatements).toBeUndefined();
  });

  it("reads the bounded wait's own answer, and asks for no more seconds than the server takes", async () => {
    const { call, calls } = fakeCall({ boom_await_file: payload(AWAIT).payload });
    const res = await liveBoomAdapter(call).awaitSettled!("cf677dcc-594c-45b5-b47d-c92c0b2ee909", 10);
    expect(calls[0].input).toEqual({ fileId: "cf677dcc-594c-45b5-b47d-c92c0b2ee909", maxSeconds: 10 });
    expect((calls[0].options as { read?: boolean }).read).toBe(true);
    expect(res.status).toBe("verified");
  });

  /* THE DEFECT OF 2026-09-15 19:37 UTC, AT ITS ROOT. `boom_await_file` is a
     READ, and a read at the seam carries READ_DEADLINE_MS, fifteen seconds. The
     room asked Boom to BLOCK for twenty, so the page's own clock fired five
     seconds before the server could answer, every time, on every file. */
  it("carries its own wall clock, derived from the seconds it asked Boom for", async () => {
    const { call, calls } = fakeCall({ boom_await_file: payload(AWAIT).payload });
    await liveBoomAdapter(call).awaitSettled!("cf677dcc-594c-45b5-b47d-c92c0b2ee909", BOOM_AWAIT_SECONDS);
    const options = calls[0].options as { deadlineMs?: number };
    expect(options.deadlineMs).toBe(awaitDeadlineMs(BOOM_AWAIT_SECONDS));
    // Strictly longer than the block itself: the hop has to fit too.
    expect(options.deadlineMs!).toBeGreaterThan(BOOM_AWAIT_SECONDS * 1_000);
  });

  it("asks Boom for a wait that fits inside the seam's own read budget", () => {
    /* THE ARITHMETIC THAT WAS WRONG, PINNED. Even with no explicit deadline on
       the call, the seconds the room asks for plus one relay hop must fit the
       generic read budget: anything else is a page clock guaranteed to fire
       first, which is exactly what wrote "Failed" under three healthy files. */
    expect(awaitDeadlineMs(BOOM_AWAIT_SECONDS)).toBeLessThanOrEqual(READ_DEADLINE_MS);
    expect(BOOM_AWAIT_SECONDS * 1_000).toBeLessThan(READ_DEADLINE_MS);
  });

  it("reads back what Boom holds for a borrower, rungs only, off the live list", async () => {
    const { call, calls } = fakeCall({ boom_list_files: payload(FILES).payload });
    const rows = await liveBoomAdapter(call).listFiles!("001bb00001DLtRMAA1");
    expect(calls[0].input).toEqual({ salesforceRecordId: "001bb00001DLtRMAA1" });
    expect(rows).toHaveLength(FILES.files.length);
    // The one file the live org had in flight on 2026-09-15.
    const inFlight = rows.filter((r) => r.status === "processing");
    expect(inFlight.map((r) => r.fileId)).toEqual(["d6a2ecc3-5321-47c3-8615-a2879d629108"]);
    expect(inFlight[0].createdAt).toBe("2026-09-14T19:13:53.941+00:00");
    // Rungs only: nothing here pretends to carry a spread.
    expect(Object.keys(rows[0]).sort()).toEqual(["createdAt", "fileGroupId", "fileId", "fileName", "status"]);
  });

  it("refuses to invent a file id or a rung it was not given", async () => {
    await expect(
      liveBoomAdapter(fakeCall({ ...LADDER_ANSWERS, boom_create_upload: envelope({}) }).call).upload(request()),
    ).rejects.toMatchObject({ code: "transform_error" });
    await expect(
      liveBoomAdapter(fakeCall({ boom_get_file: envelope({ file: { id: "f", status: "spread" } }) }).call).status("f"),
    ).rejects.toMatchObject({ code: "transform_error" });
    await expect(liveBoomAdapter(fakeCall({ boom_get_file: envelope({}) }).call).status("f")).rejects.toMatchObject({
      code: "transform_error",
    });
  });

  it("reads the verification session off its own answer", async () => {
    const session = fakeCall({
      boom_open_verification: envelope({ url: "https://app.boom.build/x#token=y", expiresAt: "2026-09-15T13:00:00.000Z" }),
    });
    expect(await liveBoomAdapter(session.call).validationSession!("f")).toEqual({
      url: "https://app.boom.build/x#token=y",
      expiresAt: "2026-09-15T13:00:00.000Z",
    });
    await expect(liveBoomAdapter(fakeCall({}).call).validationSession!("f")).rejects.toMatchObject({
      code: "transform_error",
    });
  });

  it("offers no file group at all: Boom refuses them on this org", async () => {
    // Decision D4. The seam stays on the interface so the step can return.
    expect(liveBoomAdapter(fakeCall({}).call).createGroup).toBeUndefined();
  });

  it("surfaces a transport failure exactly as every other lane does", async () => {
    const { call } = fakeCall({}, { code: "needs_reauth", message: "session expired", retract: true });
    await expect(liveBoomAdapter(call).upload(request())).rejects.toMatchObject({ code: "needs_reauth" });
  });
});

/* ------------------------------------------------ the two reads, end to end */

describe("readBoom", () => {
  beforeEach(() => resetBoomServer());
  afterEach(() => resetBoomServer());

  it("asks by Salesforce record id, then reads the spread of the file the ratios name", async () => {
    const { call, calls } = fakeCall({ boom_get_ratios: payload(RATIOS).payload, boom_get_spread: payload(SPREAD).payload });
    const reads = await readBoom({ accountId: "001bb00001DLtRMAA1", company: "Piedmont" }, { call });
    expect(calls[0].input).toEqual({ salesforceRecordId: "001bb00001DLtRMAA1" });
    expect(calls[1].input).toEqual({ fileId: "cf677dcc-594c-45b5-b47d-c92c0b2ee909" });
    expect(reads.source).toBe("BOOM-LIVE");
    // The period the ratios describe rides onto the object the normaliser reads,
    // which is what binds EBITDA to one period and to no other.
    expect(reads.ratios?.asOf).toBe("2025-12-31");
    expect(reads.spread?.file.id).toBe("cf677dcc-594c-45b5-b47d-c92c0b2ee909");
  });

  it("falls back to the company name where the view carries no record id", async () => {
    const { call, calls } = fakeCall({ boom_get_ratios: payload(RATIOS).payload, boom_get_spread: payload(SPREAD).payload });
    await readBoom({ company: "Piedmont" }, { call });
    expect(calls[0].input).toEqual({ companyName: "Piedmont" });
  });

  it("degrades honestly on a borrower Boom has never heard of", async () => {
    const { call } = fakeCall({ boom_get_ratios: payload(NOT_FOUND).payload });
    await expect(readBoom({ accountId: "001bb00001I7FPNAA3" }, { call })).rejects.toSatisfy(isBoomNotFound);
  });

  it("keeps the ratio card where the spread read fails", async () => {
    // The spread is the second half. A borrower whose ratios answered still has
    // a ratio card, and the book's own statement table stands.
    const { call } = fakeCall({ boom_get_ratios: payload(RATIOS).payload });
    const reads = await readBoom({ accountId: "001bb00001DLtRMAA1" }, { call });
    expect(reads.ratios).toBeTruthy();
    expect(reads.spread).toBeUndefined();
  });

  it("refuses to ask Boom about nobody", async () => {
    await expect(readBoom({}, { call: fakeCall({}).call })).rejects.toSatisfy(isBoomNotFound);
  });
});

/* ------------------------------------ the server's ratios and ours, on Piedmont */

describe("the cockpit's coverage definition against the server's own", () => {
  it("strikes the same interest coverage off the live spread, to the digit", () => {
    // The whole raw-verbatim contract rests on this: the cockpit does not
    // recompute Boom's ratios, and where it restrikes one it must agree.
    const statements = SPREAD.spread.financialStatements as unknown as Parameters<typeof interestCoverageAt>[0];
    expect(interestCoverageAt(statements, "2025-12-31")).toBe(RATIOS.raw.interestCoverage);
    expect(RATIOS.raw.interestCoverage).toBe(2.637546468401487);
  });

  it("normalises the live spread into the shape the Financials tab reads", () => {
    const boom = normaliseBoom({ ratios: { ...RATIOS, asOf: "2025-12-31" }, spread: { file: SPREAD.spread } })!;
    expect(boom.ratios?.totalLeverage).toBe(3.8460068781047);
    // Boom emits margins as fractions; the tab prints percentages.
    expect(boom.ratios?.ebitdaMargin).toBeCloseTo(8.1164904, 6);
    expect(boom.spread?.periods?.map((p) => p.period)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(boom.spread?.periods?.at(-1)?.revenue).toBe(64486000);
    // EBITDA belongs to the ratios' own period and to no other: the chart has
    // no depreciation row to derive a prior year from.
    expect(boom.spread?.periods?.at(0)?.ebitda).toBeUndefined();
    expect(boom.spread?.periods?.at(-1)?.ebitda).toBe(5234000);
  });

  it("publishes the live spread onto the book with no provisional word on it", () => {
    const next = publishSpread({
      onFile: null,
      statements: SPREAD.spread.financialStatements as unknown as Parameters<typeof publishSpread>[0]["statements"],
      provenance: "boom",
    })!;
    expect(next.spread?.periods?.map((p) => p.period)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(next.spread?.periods?.some(isProvisionalPeriod)).toBe(false);
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

  beforeEach(() => resetBoomServer());

  it("records the Boom lane as live when the connector answers", async () => {
    installMcp(async (_s, tool) => ({ payload: LADDER_ANSWERS[tool as keyof typeof LADDER_ANSWERS] ?? {} }));
    await liveBoomAdapter().upload(request());
    // The runtime lists no server, so the lane is the fallback name.
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

  it("stops waiting on an upload rung that never answers, and stamps it ambiguous", async () => {
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
  it("is no longer the active lane, and is still here for the day it is", () => {
    // 0.9.28: Boom's connector exists, so the live adapter ships. The stub is
    // kept because the flip is one constant and an outage is not a reason to
    // lose the room.
    expect(BOOM_UPLOAD_LANE).toBe("live");
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
    // BOOM'S OWN PAIR SHAPE (observed live 2026-09-15): as given, as allowed.
    // The stand-in has no analyst adjustment to report, so the two agree.
    expect(rows.net_sales_revenue.periodValues["file-1-s1-p3"]).toEqual({ asGiven: 64486000, asAllowed: 64486000 });
    expect(rows.net_sales_revenue.accountName).toBe("Net Sales");
    expect(rows.interest_expense.periodValues["file-1-s1-p2"]).toEqual({ asGiven: -947000, asAllowed: -947000 });
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

  it("carries a row of its own, named for the connector that was found", async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (window as unknown as { claude?: unknown }).claude = {
      mcp: {
        callTool: vi.fn(),
        watchTool: vi.fn().mockReturnValue(() => {}),
        listTools: vi.fn().mockResolvedValue({
          servers: [{ server: "Boom MCP", authStatus: "connected", tools: BOOM_SIGNATURE_TOOLS.map((name) => ({ name })) }],
        }),
        invalidate: vi.fn(),
      },
    };
    // The lane has answered, so it has something to say and earns its row.
    act(() => noteLaneSuccess("Boom MCP", Date.UTC(2026, 8, 15, 12, 0, 0)));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(createElement(HealthLine)));
    await act(async () => {});

    /* RESTATED 0.9.28. The row used to read "Boom (via gateway)" because
       `SERVERS.boom` was the gateway's own display name and one connector
       carried both lanes. Boom is its own server now, discovered off
       `listTools()`, and the row is named for whatever the viewer called it. */
    const rows = [...container.querySelectorAll<HTMLElement>(".hl-lane-btn")].filter(
      (b) => b.getAttribute("data-lane") === "Boom MCP",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/^Boom MCP live/);
  });
});
