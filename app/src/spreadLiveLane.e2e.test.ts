// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { SpreadingRoom } from "./components/workroom/SpreadingRoom";
import { liveBoomAdapter } from "./channel/boomUpload";
import { resetBoomServer } from "./channel/boomLane";
import type { McpOk } from "./channel/mcp";
import { forgetBoomFile, pendingBoomFiles, rememberBoomFile, resetBoomFiles } from "./components/workroom/spreadSession";
import { interestCoverageAt } from "./spread/coverage";
import { isProvisionalPeriod } from "./spread/publishSpread";
import { provisionalRead } from "./spread/provisional";
import { applySpreadEvent } from "./state/spreadPublish";
import {
  BOOM_AWAIT_SECONDS,
  BOOM_WAIT_BUDGET_MS,
  createSpreadEngine,
  MAX_FILE_BYTES,
  tooBigLine,
  type SpreadDeps,
  type SpreadEngine,
} from "./workroom/spreadEngine";
import type { RelationshipSpreadContext } from "./spread/preRead";
import type { Boom, BorrowerBundle } from "./data/contract";
import type { DroppedFile, ExtractedDocument, FilePreRead } from "./spread/types";

import AWAIT from "./__fixtures__/boom-live/await-piedmont.json";
import FILE from "./__fixtures__/boom-live/file-piedmont.json";
import FILES from "./__fixtures__/boom-live/files-piedmont.json";
import FILE_PROCESSING from "./__fixtures__/boom-live/file-processing.json";
import RATIOS from "./__fixtures__/boom-live/ratios-piedmont.json";
import SPREAD from "./__fixtures__/boom-live/spread-piedmont.json";

/* =============================================================================
   THE LIVE BOOM LANE, END TO END, ON BOOM'S OWN ANSWERS.

   The room drops a file, walks the four-call ladder, waits on the server's own
   bounded wait and lands the spread. Every answer in this file is what
   `boom-mcp` actually returned on 2026-09-15, saved verbatim under
   `src/__fixtures__/boom-live/`, so the parser under test is the one the live
   server hits and not a shape somebody typed.

   WHAT THIS PINS THAT NOTHING ELSE DOES:
     the spread that lands is BOOM'S, so nothing on the glass says provisional;
     it reaches `bundle.boom` through the same publish the stub lane used, which
     is what the Financials tab, the memo's Boom graph and the covenant
     challenge all read;
     the wait is the room's own two-minute clock spent in the server's own
     twenty-second calls, and it survives a room that closes.
   ============================================================================= */

const ACCOUNT = "001bb00001DLtRMAA1";
const COMPANY = "Piedmont Precision Components, Inc.";
const SHA = "a".repeat(64);
const FILE_ID = "cf677dcc-594c-45b5-b47d-c92c0b2ee909";
const FILE_NAME = "Piedmont_Precision_Components_Financials_FY2023-2025.xlsx";

const CTX: RelationshipSpreadContext = {
  accountId: ACCOUNT,
  company: COMPANY,
  onFilePeriods: ["FY2024"],
  covenants: [{ name: "Interest coverage", operator: ">=", threshold: 1.25, current: 2.64 }],
  obligorGroup: [],
};

const DROPPED: DroppedFile = {
  id: "f1",
  name: FILE_NAME,
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  bytes: 8_192,
  base64: "UEsDBA==",
  sha256: SHA,
  kind: "xlsx",
};

const DOC: ExtractedDocument = { fileId: "f1", kind: "xlsx", text: "Net Sales\t64486000", tables: [], isScan: false, warnings: [] };

const PRE_READ: FilePreRead = {
  fileId: "f1",
  statements: [
    {
      statementType: "income_statement",
      periods: [{ key: "FY2025", endDate: "2025-12-31", periodType: "annual" }],
      lines: [{ label: "Net Sales", accountCode: "net_sales_revenue", values: { FY2025: 64_486_000 }, confidence: "high" }],
    },
  ],
  company: COMPANY,
  companyMatchesRelationship: true,
  currency: "USD",
  unitsMultiplier: 1,
  statementQuality: "cpa_audited",
  quality: [],
  confidence: "high",
};

/** The server's own envelope around a body. */
const envelope = (body: Record<string, unknown>) => ({
  contractVersion: "1.0",
  _source: "BOOM-LIVE",
  _provenance: { system: "Boom", record: "file", ids: {}, asOf: "2025-12-31" },
  ...body,
});

/** A Boom connector under the test's control: every rung answers what it is
 *  told to, and the wait turns over when the test says Boom has finished. */
function boomServerStub(options: { spreading?: boolean; existing?: unknown[] } = {}) {
  const state = { spreading: options.spreading ?? false };
  const tools: string[] = [];
  const answers = (tool: string): unknown => {
    switch (tool) {
      case "boom_ensure_company":
        return envelope({ company: { id: "70d9bd23-a4f7-46ab-92d8-9b784e034877" } });
      case "boom_list_files":
        return envelope({ files: options.existing ?? [] });
      case "boom_create_upload":
        return envelope({ file: { id: FILE_ID, fileName: FILE_NAME, status: "waiting_for_upload" } });
      case "boom_upload_bytes":
        return envelope({ fileId: FILE_ID });
      case "boom_process_file":
        return envelope({ fileId: FILE_ID, status: "processing" });
      case "boom_await_file":
        return envelope({ fileId: FILE_ID, status: state.spreading ? "processing" : "verified", done: !state.spreading });
      case "boom_get_file":
        return state.spreading ? FILE_PROCESSING : FILE;
      case "boom_get_spread":
        return SPREAD;
      case "boom_get_ratios":
        return RATIOS;
      default:
        return envelope({});
    }
  };
  const inputs: Array<{ tool: string; input: unknown }> = [];
  const call = async (_server: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
    tools.push(tool);
    inputs.push({ tool, input });
    return { payload: answers(tool), raw: {} };
  };
  return { call, tools, inputs, state };
}

function deps(over: Partial<SpreadDeps> = {}): SpreadDeps {
  return {
    readDroppedFile: async () => DROPPED,
    extractDocument: async () => DOC,
    preReadFile: async () => PRE_READ,
    provisionalRead,
    postRead: async () => [],
    adapter: liveBoomAdapter(boomServerStub().call),
    lane: "live",
    ...over,
  };
}

const droppedFile = () => new File(["x"], FILE_NAME, { type: DROPPED.mime });

let engine: SpreadEngine | null = null;

beforeEach(() => {
  resetBoomServer();
  resetBoomFiles();
  (window as unknown as { claude?: unknown }).claude = {
    mcp: { callTool: vi.fn(), watchTool: vi.fn(), listTools: async () => ({ servers: [] }), invalidate: async () => {} },
  };
});

afterEach(() => {
  engine?.dispose();
  engine = null;
  resetBoomServer();
  resetBoomFiles();
  vi.useRealTimers();
  delete (window as unknown as { claude?: unknown }).claude;
});

/** Drop, confirm and let the ladder run to the end. */
async function runToSpread(over: Partial<SpreadDeps> = {}): Promise<SpreadEngine> {
  const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps(over) }));
  await e.drop([droppedFile()]);
  await e.confirm();
  return e;
}

describe("the room on the live lane", () => {
  it("walks the ladder, waits on the server's own wait, and lands Boom's spread", async () => {
    const server = boomServerStub();
    const e = await runToSpread({ adapter: liveBoomAdapter(server.call) });
    const state = e.getState();

    expect(server.tools.slice(0, 5)).toEqual([
      "boom_ensure_company",
      "boom_list_files",
      "boom_create_upload",
      "boom_upload_bytes",
      "boom_process_file",
    ]);
    expect(state.stage).toBe("spread");
    expect(state.rows[0].state).toBe("verified");
    // Boom's own three statements, not one built from the pre-read.
    expect(state.statements.map((s) => s.statementType)).toEqual([
      "cash_flow_statement",
      "income_statement",
      "balance_sheet",
    ]);
    // THE SPREAD IS BOOM'S, so the panel carries no provisional word at all.
    expect(state.figuresProvisional).toBe(false);
    expect(state.validationStatus).toBe("validated");
  });

  it("publishes that spread to the Financials tab, the memo graph and the covenant challenge", async () => {
    // One object, `bundle.boom`, is what all three read. This is the same
    // publish the stub lane used; what changed is the provenance on it.
    const e = await runToSpread();
    const patches: Array<{ accountId: string; patch: Partial<BorrowerBundle> }> = [];
    const applied = applySpreadEvent({
      event: {
        accountId: ACCOUNT,
        company: COMPANY,
        summary: "1 statement to Boom",
        planKey: SHA,
        fileCount: 1,
        statements: e.getState().statements,
        provenance: "boom",
        system: "Boom",
        signedOff: true,
        failure: null,
        phase: "completed",
      },
      onFileBoom: null,
      dispatch: (action) => {
        if (action.type === "PATCH_BUNDLE") patches.push(action);
      },
    });

    const boom = patches[0].patch.boom as Boom;
    expect(boom.spread?.periods?.map((p) => p.period)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(boom.spread?.periods?.at(-1)?.revenue).toBe(64_486_000);
    // NOT provisional: a period Boom spread is not one the cockpit read.
    expect(boom.spread?.periods?.some(isProvisionalPeriod)).toBe(false);
    expect(applied.period).toBe("FY2025");
    // The covenant challenge recomputes off the raw file, which travels whole.
    const raw = boom.spread!.file as { financialStatements: Parameters<typeof interestCoverageAt>[0] };
    expect(interestCoverageAt(raw.financialStatements, "2025-12-31")).toBe(RATIOS.raw.interestCoverage);
    // And the trail names Boom, never a stub.
    expect(applied.entry.summary).not.toMatch(/stub/i);
  });

  it("reuses the file Boom already holds, and says so", async () => {
    const server = boomServerStub({ existing: [{ id: FILE_ID, fileName: FILE_NAME, status: "verified", fileGroupId: null }] });
    const e = await runToSpread({ adapter: liveBoomAdapter(server.call) });
    expect(server.tools).not.toContain("boom_create_upload");
    expect(e.getState().rows[0].reused).toBe(true);
    expect(e.getState().refusals.join(" ")).toContain("Boom already holds");
  });

  it("refuses a file past Boom's cap before it reads a byte, naming the cap", async () => {
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps() }));
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "annual-report.pdf", { type: "application/pdf" });
    await e.drop([big]);
    expect(e.getState().cards).toHaveLength(0);
    expect(e.getState().refusals[0]).toBe(tooBigLine("annual-report.pdf", MAX_FILE_BYTES + 1));
    expect(e.getState().refusals[0]).toContain("3 MB");
  });
});

describe("the wait, across the room's own clock", () => {
  it("spends its budget in the server's own bounded calls, then says it is still checking", async () => {
    vi.useFakeTimers();
    const server = boomServerStub({ spreading: true });
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps({ adapter: liveBoomAdapter(server.call) }) }));
    const drop = e.drop([droppedFile()]);
    await vi.advanceTimersByTimeAsync(0);
    await drop;

    const run = e.confirm();
    await vi.advanceTimersByTimeAsync(BOOM_WAIT_BUDGET_MS + 1_000);
    // A statement, not a question: Boom routinely takes longer than this.
    expect(e.getState().stall).toBeNull();
    expect(e.getState().notice).toBe(`Boom is still processing ${FILE_NAME}. I will keep checking.`);
    expect(server.tools.filter((t) => t === "boom_await_file").length).toBeGreaterThan(1);

    server.state.spreading = false;
    await vi.advanceTimersByTimeAsync(2_000);
    await run;
    expect(e.getState().stage).toBe("spread");
    expect(e.getState().statements).toHaveLength(3);
  });

  it("asks the server for fewer seconds than its own ceiling", () => {
    // `boom_await_file` is capped at 25s by the server's design; a room asking
    // for more would be asking the page's clock to fire instead of the server's.
    expect(BOOM_AWAIT_SECONDS).toBeLessThan(25);
  });

  it("writes the file handle down the moment a file id exists, and clears it when it settles", async () => {
    const e = (engine = createSpreadEngine({
      ctx: CTX,
      deps: deps({
        rememberFile: (handle) => rememberBoomFile(ACCOUNT, handle),
        forgetFile: (fileId) => forgetBoomFile(ACCOUNT, fileId),
      }),
    }));
    await e.drop([droppedFile()]);
    await e.confirm();
    // Settled, so the receipt is gone: nothing to resume.
    expect(pendingBoomFiles(ACCOUNT)).toEqual([]);
  });

  it("resumes from the file Boom still holds rather than sending the bytes again", async () => {
    const server = boomServerStub();
    rememberBoomFile(ACCOUNT, { fileId: FILE_ID, companyId: null, fileName: FILE_NAME, startedAt: Date.now() - 400_000 });
    const e = (engine = createSpreadEngine({
      ctx: CTX,
      deps: deps({
        adapter: liveBoomAdapter(server.call),
        forgetFile: (fileId) => forgetBoomFile(ACCOUNT, fileId),
      }),
    }));
    await e.resume(pendingBoomFiles(ACCOUNT));

    // NOTHING WAS SENT. Only the reads: where the file got to, its spread, and
    // the ratio support that says which line feeds which headline figure.
    expect(server.tools).toEqual(["boom_get_file", "boom_get_spread", "boom_get_ratios"]);
    expect(e.getState().stage).toBe("spread");
    expect(e.getState().statements).toHaveLength(3);
    expect(e.getState().refusals.join(" ")).toContain("still with Boom from earlier");
    expect(pendingBoomFiles(ACCOUNT)).toEqual([]);
  });
});

/* =============================================================================
   HARTWELL, 2026-09-15 19:37 UTC: THE THREE FILES, AND COMING BACK FOR THEM.

   Three statements went to Boom in one drop, all three landed at `processing`,
   and the room reported three failures. Every answer below is the live server's
   own, off `src/__fixtures__/boom-live/`, and what is pinned is the whole of
   what the founder's run needed and did not have: three receipts rather than
   one, a wait that survives a rejected call, and a re-entry that finds the
   files through `boom_list_files` when the page itself has been reloaded and
   the receipts are gone.
   ============================================================================= */
describe("three files left with Boom, and the way back to them", () => {
  const NAMES = ["Hartwell_FY2024_compiled.pdf", "Hartwell_company_prepared.pdf", "Hartwell_TB.xlsx"];
  const IDS = ["0a07bf4e-0001-4000-8000-000000000001", "0a07bf4e-0002-4000-8000-000000000002", "0a07bf4e-0003-4000-8000-000000000003"];

  /** Boom's own `boom_await_file` answer on a file it is still spreading, the
   *  shape the founder read off the live tools a minute after the drop. */
  const AWAITING = (fileId: string) => ({ ...AWAIT, fileId, status: "processing", done: false });

  it("keeps one receipt per file rather than letting the third overwrite the first", async () => {
    const handles = IDS.map((fileId, i) => ({ fileId, companyId: null, fileName: NAMES[i], startedAt: Date.now() }));
    for (const h of handles) rememberBoomFile(ACCOUNT, h);
    expect(pendingBoomFiles(ACCOUNT).map((h) => h.fileId)).toEqual(IDS);

    forgetBoomFile(ACCOUNT, IDS[1]);
    expect(pendingBoomFiles(ACCOUNT).map((h) => h.fileId)).toEqual([IDS[0], IDS[2]]);
  });

  it("rejoins all three waits on re-entry, sends nothing, and calls none of them failed", async () => {
    vi.useFakeTimers();
    const state = { spreading: true };
    const tools: string[] = [];
    const call = async (_s: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
      tools.push(tool);
      const fileId = (input as { fileId?: string } | undefined)?.fileId ?? "";
      if (tool === "boom_await_file") {
        return { payload: state.spreading ? AWAITING(fileId) : { ...AWAIT, fileId, status: "verified", done: true }, raw: {} };
      }
      if (tool === "boom_get_file") return { payload: state.spreading ? FILE_PROCESSING : FILE, raw: {} };
      if (tool === "boom_get_spread") return { payload: SPREAD, raw: {} };
      if (tool === "boom_get_ratios") return { payload: RATIOS, raw: {} };
      return { payload: {}, raw: {} };
    };
    for (const [i, fileId] of IDS.entries()) {
      rememberBoomFile(ACCOUNT, { fileId, companyId: null, fileName: NAMES[i], startedAt: Date.now() - 60_000 });
    }
    const e = (engine = createSpreadEngine({
      ctx: CTX,
      deps: deps({ adapter: liveBoomAdapter(call), forgetFile: (id) => forgetBoomFile(ACCOUNT, id) }),
    }));

    const resumed = e.resume(pendingBoomFiles(ACCOUNT));
    await vi.advanceTimersByTimeAsync(5_000);
    // Three rows, all three still with Boom, none of them called Failed.
    expect(e.getState().rows.map((r) => r.name)).toEqual(NAMES);
    expect(e.getState().rows.every((r) => r.state === "processing")).toBe(true);
    expect(e.getState().rows.every((r) => r.message === null)).toBe(true);
    // NOTHING WAS SENT: no rung of the upload ladder appears at all.
    expect(tools).not.toContain("boom_create_upload");
    expect(tools).not.toContain("boom_upload_bytes");
    expect(tools).not.toContain("boom_process_file");

    state.spreading = false;
    await vi.advanceTimersByTimeAsync(20_000);
    await resumed;
    expect(e.getState().stage).toBe("spread");
    expect(e.getState().statements.length).toBeGreaterThan(0);
    // Every receipt is cleared, because every file settled.
    expect(pendingBoomFiles(ACCOUNT)).toEqual([]);
  });

  it("finds the files through boom_list_files when the page was reloaded and the receipts are gone", async () => {
    vi.useFakeTimers();
    const tools: string[] = [];
    const call = async (_s: string, tool: string): Promise<McpOk<unknown>> => {
      tools.push(tool);
      if (tool === "boom_list_files") return { payload: FILES, raw: {} };
      if (tool === "boom_get_file") return { payload: FILE, raw: {} };
      if (tool === "boom_get_spread") return { payload: SPREAD, raw: {} };
      if (tool === "boom_get_ratios") return { payload: RATIOS, raw: {} };
      return { payload: {}, raw: {} };
    };
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps({ adapter: liveBoomAdapter(call) }) }));

    // No receipts at all: exactly the state a reloaded cockpit is in.
    expect(pendingBoomFiles(ACCOUNT)).toEqual([]);
    const resumed = e.resume(pendingBoomFiles(ACCOUNT));
    await vi.advanceTimersByTimeAsync(20_000);
    await resumed;

    expect(tools[0]).toBe("boom_list_files");
    /* ONLY THE FILE THAT WAS IN FLIGHT. The live list carries six files for this
       borrower, including two `completed` and one `verified` from May and June.
       Resuming onto those would put a months-old spread on the glass unasked. */
    expect(e.getState().rows.map((r) => r.boomFileId)).toEqual([
      "f8c8bd3b-255a-4a37-81bd-ad0829b7c87b",
      "78b4bae4-2aeb-4570-924e-97582544b10e",
      "f17f6915-5c56-421f-8e60-afb72037a534",
      "d6a2ecc3-5321-47c3-8615-a2879d629108",
    ]);
    expect(tools).not.toContain("boom_create_upload");
  });

  it("opens on the drop zone, not a wait, when Boom is holding nothing in flight", async () => {
    const call = async (_s: string, tool: string): Promise<McpOk<unknown>> => {
      if (tool === "boom_list_files") return { payload: { ...FILES, files: [] }, raw: {} };
      return { payload: {}, raw: {} };
    };
    const e = (engine = createSpreadEngine({ ctx: CTX, deps: deps({ adapter: liveBoomAdapter(call) }) }));
    await e.resume([]);
    expect(e.getState().stage).toBe("idle");
    expect(e.getState().rows).toEqual([]);
    expect(e.getState().refusals).toEqual([]);
  });

  it("does not call a resumed file failed when the read of it misses", async () => {
    vi.useFakeTimers();
    let misses = 2;
    const call = async (_s: string, tool: string): Promise<McpOk<unknown>> => {
      if (tool === "boom_get_file") {
        if (misses > 0) {
          misses -= 1;
          // The relay's own shape: an object, never an Error.
          throw { code: "server_unavailable", message: "request failed (502)", retryable: false };
        }
        return { payload: FILE, raw: {} };
      }
      if (tool === "boom_await_file") throw { code: "cancelled", message: "timeout after 15000ms", timedOut: true };
      if (tool === "boom_get_spread") return { payload: SPREAD, raw: {} };
      if (tool === "boom_get_ratios") return { payload: RATIOS, raw: {} };
      return { payload: {}, raw: {} };
    };
    rememberBoomFile(ACCOUNT, { fileId: FILE_ID, companyId: null, fileName: FILE_NAME, startedAt: Date.now() });
    const e = (engine = createSpreadEngine({
      ctx: CTX,
      deps: deps({ adapter: liveBoomAdapter(call), forgetFile: (id) => forgetBoomFile(ACCOUNT, id) }),
    }));

    const resumed = e.resume(pendingBoomFiles(ACCOUNT));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(e.getState().rows[0].state).not.toBe("failed");
    expect(e.getState().rows[0].message).not.toBe("[object Object]");

    await vi.advanceTimersByTimeAsync(30_000);
    await resumed;
    expect(e.getState().stage).toBe("spread");
    expect(e.getState().statements.length).toBeGreaterThan(0);
  });
});

/* =============================================================================
   THE BASIS IS A RE-READ (design 0.9.28, gate note on the register).

   Boom holds two reads of the same file and the register asks for one. What is
   pinned here is that the room ASKS: the switch reaches the server with the
   basis on it, and the statements on the glass afterwards are the server's
   answer and not a figure derived from the other read.
   ============================================================================= */
describe("the adjusted basis", () => {
  it("re-reads the file on the server rather than filtering what it holds", async () => {
    const server = boomServerStub();
    const e = await runToSpread({ adapter: liveBoomAdapter(server.call) });
    expect(e.getState().adjusted).toBe(true);
    expect(e.getState().adjustable).toBe(true);

    await e.setAdjusted(false);

    const asked = server.inputs.filter((c) => c.tool === "boom_get_spread").pop();
    expect(asked?.input).toEqual({ fileId: FILE_ID, adjusted: false });
    expect(e.getState().adjusted).toBe(false);
    expect(e.getState().statements).toHaveLength(3);
  });

  it("offers no switch at all on a lane that cannot re-read", async () => {
    const e = await runToSpread({ adapter: { ...liveBoomAdapter(boomServerStub().call), readSpread: undefined } });
    expect(e.getState().adjustable).toBe(false);
    await e.setAdjusted(false);
    expect(e.getState().adjusted).toBe(true);
  });

  it("carries Boom's own support lines to the register", async () => {
    const e = await runToSpread();
    expect(e.getState().support.map((l) => l.figure)).toContain("revenue");
  });
});

/* =============================================================================
   THE SPREAD SECTION, ON THE GLASS, WITH BOOM BEHIND IT.

   The room's finale carries the figures once and the statements once: the tiles
   and the trend are the headline read, the register is every line under it, and
   the two doors are the only way out. A second register, a second set of tiles
   or a third door would each be the same fact or the same decision twice. And
   because the spread is Boom's, nothing on the section says provisional.
   ============================================================================= */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the room's spread section", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    document.body.className = "";
  });

  /** Drop, answer whatever the room asks, confirm, and let Boom answer. */
  async function spreadInTheRoom(over: Partial<SpreadDeps> = {}): Promise<HTMLElement> {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      /* `createElement` and not JSX: this suite is the lane's own file and stays
         a .ts. One call site is not worth a second fixture set in a .tsx. */
      root!.render(
        createElement(SpreadingRoom, {
          ctx: CTX,
          onFileBoom: null,
          trend: [
            { period: "FY2023", revenue: 56_266_000 },
            { period: "FY2024", revenue: 59_915_000 },
          ],
          deps: deps(over),
          onDraftMemo: () => {},
          onClose: () => {},
        }),
      );
    });
    const room = document.querySelector<HTMLElement>('[data-room="spread"]')!;
    const zone = room.querySelector<HTMLElement>(".sp-drop")!;
    await act(async () => {
      zone.dispatchEvent(
        Object.assign(new Event("drop", { bubbles: true }), { dataTransfer: { files: [droppedFile()] } }),
      );
    });
    for (let i = 0; i < 8 && !room.querySelector(".sp-go"); i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      const chip = room.querySelector<HTMLElement>(".sp-ask .sp-chip");
      if (chip && !room.querySelector(".sp-go")) await act(async () => chip.click());
    }
    await act(async () => {
      room.querySelector<HTMLElement>(".sp-go")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    return room;
  }

  it("carries one register, one set of tiles, one trend, two doors and no provisional word", async () => {
    const room = await spreadInTheRoom();
    const section = room.querySelector<HTMLElement>(".sp-fin")!;

    expect(section.querySelectorAll(".rg")).toHaveLength(1);
    expect(section.querySelectorAll(".sp-tiles")).toHaveLength(1);
    expect(section.querySelectorAll(".sp-tile")).toHaveLength(5);
    expect(section.querySelectorAll(".sp-trend")).toHaveLength(1);
    expect(room.querySelectorAll(".wk-sheet-acts")).toHaveLength(1);
    expect(room.querySelector(".wk-sheet-acts")!.children).toHaveLength(2);
    expect(room.textContent ?? "").not.toMatch(/provisional/i);
  });

  it("says the validation once, in the register, and leaves the file-level pair behind", async () => {
    const room = await spreadInTheRoom();
    const head = room.querySelector<HTMLElement>(".sp-fin-head")!;

    expect(head.querySelector(".sp-badge")).toBeNull();
    expect(head.querySelector(".sp-verify")).toBeNull();
    // Three statements, each carrying its own word, and the link back into Boom
    // is the register's footer citation.
    expect(room.querySelectorAll(".rg-line .sp-badge")).toHaveLength(1);
    expect(room.querySelector(".rg-line .sp-badge")!.textContent).toBe("Validated in Boom");
  });

  it("offers the basis switch, and marks only the lines behind a headline ratio", async () => {
    const room = await spreadInTheRoom();
    expect(room.querySelector(".rg-adj")).not.toBeNull();
    const feeds = [...room.querySelectorAll(".rg-feeds")].map((n) => n.textContent);
    expect(feeds).toEqual(["feeds revenue", "feeds operating income", "feeds interest expense"]);
  });

  /* ---------------------------------------------------------------- row 61

     "OPEN IN BOOM NEVER RENDERS". The footer's link hung on `state.validationUrl`
     and nothing in the lane ever filled it: `liveBoomAdapter.status()` returns
     none and `boom_open_verification` was not called from anywhere. The control
     therefore did not exist on any spread the live lane landed.

     THE SESSION IS MINTED ON THE CLICK, AND ONLY THERE. It is a 60-minute token;
     spending one at render, for every banker who opened a spread to read it,
     would be spending most of them on nobody. */
  it("draws Open in Boom as a control, and calls nothing until the banker clicks it", async () => {
    const tools: string[] = [];
    const server = boomServerStub();
    const call = async (s: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
      tools.push(tool);
      if (tool === "boom_open_verification") {
        return {
          payload: envelope({ url: "https://app.boom.build/file-validation/x#token=bvs_1", expiresAt: "2026-09-15T21:00:00Z" }),
          raw: {},
        };
      }
      return server.call(s, tool, input);
    };
    const room = await spreadInTheRoom({ adapter: liveBoomAdapter(call) });

    const control = room.querySelector<HTMLButtonElement>("button.rg-provlink")!;
    expect(control).not.toBeNull();
    expect(control.textContent).toBe("Open in Boom");
    // NOT CALLED AT RENDER: the token is unspent until somebody asks for it.
    expect(tools).not.toContain("boom_open_verification");
    // And there is no anchor to click yet, because there is no URL to put in it.
    expect(room.querySelector("a.rg-provlink")).toBeNull();

    await act(async () => {
      control.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(tools.filter((t) => t === "boom_open_verification")).toHaveLength(1);
    const link = room.querySelector<HTMLAnchorElement>("a.rg-provlink")!;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://app.boom.build/file-validation/x#token=bvs_1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(room.querySelector("button.rg-provlink")).toBeNull();
  });

  it("asks for the verification page by the FILE Boom spread", async () => {
    const asked: unknown[] = [];
    const server = boomServerStub();
    const call = async (s: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
      if (tool === "boom_open_verification") {
        asked.push(input);
        return { payload: envelope({ url: "https://app.boom.build/file-validation/x", expiresAt: "2026-09-15T21:00:00Z" }), raw: {} };
      }
      return server.call(s, tool, input);
    };
    const room = await spreadInTheRoom({ adapter: liveBoomAdapter(call) });
    await act(async () => {
      room.querySelector<HTMLButtonElement>("button.rg-provlink")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(asked).toEqual([{ fileId: FILE_ID }]);
  });

  it("says Boom's own words on a refusal and offers no dead link", async () => {
    const server = boomServerStub();
    const call = async (s: string, tool: string, input?: unknown): Promise<McpOk<unknown>> => {
      if (tool === "boom_open_verification") {
        // The relay's own shape: a plain object, never an Error.
        throw { code: "server_unavailable", message: "request failed (502)", retryable: false };
      }
      return server.call(s, tool, input);
    };
    const room = await spreadInTheRoom({ adapter: liveBoomAdapter(call) });
    await act(async () => {
      room.querySelector<HTMLButtonElement>("button.rg-provlink")!.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    const footer = room.querySelector<HTMLElement>(".rg-prov")!;
    expect(footer.textContent).toContain("Boom did not open the verification page: request failed (502)");
    // No link at all, and certainly not the defect.
    expect(room.querySelector("a.rg-provlink")).toBeNull();
    expect(footer.textContent).not.toContain("[object Object]");
  });
});
