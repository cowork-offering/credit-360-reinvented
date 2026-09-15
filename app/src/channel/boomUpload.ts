/* =============================================================================
   THE BOOM ADAPTER: the one module that talks to Boom.

   Boom spreads statements. It classifies the file, finds the periods, maps every
   line to an account code, and an analyst verifies the result in Boom's own
   page. THIS LAYER DOES NOT RE-IMPLEMENT ANY OF THAT. It carries bytes in and
   Boom's spread out, and everything around the call (the pre-read, the governed
   plan, the post-read) lives elsewhere.

   TWO ADAPTERS, ONE INTERFACE (`BoomAdapter` in spread/types.ts):

     LIVE   the ladder below against Noland's Boom MCP server (`boom-mcp`),
            addressed by the connector DISPLAY NAME the viewer gave it, which
            `channel/boomLane.ts` discovers. The server owns company upsert,
            the reserved file, the process trigger and the wait; none of Boom's
            own REST surface appears in this file or anywhere in the cockpit.
            THIS IS THE ACTIVE LANE (`BOOM_UPLOAD_LANE`).
     STUB   the lane that stood in while the Boom connector did not exist. It
            walks the same ladder with realistic timing and answers with a
            Boom-shaped spread BUILT FROM THE PRE-READ of the file the banker
            actually dropped. Every statement it returns is `not_validated`,
            carries no validation URL and is labelled provisional in words. IT
            NEVER RETURNS `verified`: verification is an analyst's act inside
            Boom and the cockpit may not imply one. Kept because the flip is one
            constant and a server outage is not a reason to lose the room.
   ============================================================================= */

import { callTool, describeFailure, TOOLS, type CallOptions, type McpOk } from "./mcp";
import { boomServer } from "./boomLane";
import { boomConnector, readBoomAnswer } from "./boom";
import { mapLineCodes } from "../spread/lineMap";
import type {
  BoomAdapter,
  BoomFileStatus,
  BoomFinancialStatement,
  BoomRatioSupportLine,
  BoomUploadRequest,
  BoomUploadResult,
  FilePreRead,
  PreReadLine,
} from "../spread/types";

/* =============================================================================
   THE LADDER, AND WHAT IS OBSERVED OF IT
   -----------------------------------------------------------------------------
   There is NO single upload tool. A file reaches Boom by four calls, and the
   wait is a bounded blocking read of its own (founder decision D2, 2026-09-15):

     boom_ensure_company  { name, salesforceRecordId, fullAddress? }
                          idempotent: the borrower Boom already holds comes back
     boom_list_files      { salesforceRecordId }  ->  { files: [ File, … ] }
                          asked BEFORE a new upload is reserved, so a re-drop of
                          the same file resolves to the file Boom already has
     boom_create_upload   { fileName, salesforceRecordId, externalUniqueId }
                          `externalUniqueId` is the sha256: the reservation is
                          idempotent on the bytes
     boom_upload_bytes    { fileId, contentBase64, fileName }   3 MB of base64
     boom_process_file    { fileId }

   and then, until the file is somewhere terminal:

     boom_await_file      { fileId, maxSeconds<=25 }  ->  { fileId, status, done }
     boom_get_file        { fileId }                  ->  { file: File }
     boom_get_spread      { fileId }                  ->  { spread: { … } }

   Boom's own File.status ladder is unchanged:
     waiting_for_upload -> processing -> failed | completed -> verified
   and BOTH `completed` and `verified` are ready: `verified` only adds that an
   analyst has signed the spread off in Boom's own page.

   WHAT IS OBSERVED AND WHAT IS NOT. The reads were taken off the live server on
   2026-09-15 and their answers are saved verbatim under `src/__fixtures__/
   boom-live/`; the unit tests run on those and not on a shape anybody typed.
   The four WRITE rungs are NOT observed, deliberately: the founder tests uploads
   himself against his own org. So every one of them is read defensively: a file
   id is taken from `file.id`, `fileId` or `id`, whichever the server puts it in,
   and a rung the server does not name defaults to the rung the ladder is on.

   FILE GROUPS ARE SKIPPED (decision D4). Boom refuses them on this org ("File
   groups require files-only mode") and a single-file spread needs none, so the
   live adapter implements no `createGroup`; the optional method stays on the
   interface so the step can return without the room changing.
   ============================================================================= */

/** Boom caps `boom_upload_bytes` at 3 MB OF BASE64, which is the encoded size. */
export const BOOM_BASE64_CAP_BYTES = 3 * 1024 * 1024;

/** The largest FILE that fits inside that cap, since base64 costs four bytes
 *  for every three. The room refuses anything larger before a byte is read. */
export const BOOM_MAX_FILE_BYTES = Math.floor(BOOM_BASE64_CAP_BYTES / 4) * 3;

const BOOM_TOOLS = {
  ensureCompany: TOOLS.boomEnsureCompany,
  listFiles: TOOLS.boomListFiles,
  createUpload: TOOLS.boomCreateUpload,
  uploadBytes: TOOLS.boomUploadBytes,
  processFile: TOOLS.boomProcessFile,
  awaitFile: TOOLS.boomAwaitFile,
  getFile: TOOLS.boomGetFile,
  getSpread: TOOLS.boomSpread,
  getRatios: TOOLS.boomRatios,
  openVerification: TOOLS.boomOpenVerification,
} as const;

/* ------------------------------------------------------- the argument shapes */

/** The borrower, as Boom stores it: the Salesforce Account id is Boom's own
 *  `externalUniqueId`, so the same borrower never forks. */
export function ensureCompanyArgs(req: BoomUploadRequest): Record<string, unknown> {
  return {
    name: req.company.name,
    salesforceRecordId: req.company.externalUniqueId,
    ...(req.company.fullAddress ? { fullAddress: req.company.fullAddress } : {}),
  };
}

export const listFilesArgs = (salesforceRecordId: string): Record<string, unknown> => ({ salesforceRecordId });

/** The reservation. `externalUniqueId` is the FILE's sha256, so reserving the
 *  same bytes twice is one reservation on Boom's side as well as on ours. */
export function createUploadArgs(req: BoomUploadRequest): Record<string, unknown> {
  return {
    fileName: req.file.name,
    salesforceRecordId: req.company.externalUniqueId,
    externalUniqueId: req.externalUniqueId,
    ...(req.fileGroupId ? { fileGroupId: req.fileGroupId } : {}),
  };
}

export const uploadBytesArgs = (fileId: string, req: BoomUploadRequest): Record<string, unknown> => ({
  fileId,
  contentBase64: req.file.base64,
  fileName: req.file.name,
});

export const fileArgs = (fileId: string): Record<string, unknown> => ({ fileId });
/** The spread read on an explicit basis. Boom defaults `adjusted` to true, and
 *  the cockpit says which basis it asked for rather than leaning on a default. */
export const spreadArgs = (fileId: string, adjusted: boolean): Record<string, unknown> => ({ fileId, adjusted });
export const awaitArgs = (fileId: string, maxSeconds: number): Record<string, unknown> => ({ fileId, maxSeconds });

/* ---------------------------------------------------------------- the lane */

/**
 * WHICH ADAPTER IS ACTIVE.
 *
 * "live" since 0.9.28: Boom's connector exists. Deliberately a constant and not
 * a runtime setting, for the same reason it always was: a cockpit that could be
 * talked into its stub by anything other than a code change is a cockpit that
 * can show a provisional spread while claiming a connector answered.
 */
export const BOOM_UPLOAD_LANE: "stub" | "live" = "live";

/**
 * How long the stub spends in `processing`, milliseconds, inclusive range.
 *
 * The room's ladder is paced against this, so it lives here rather than in the
 * room: the stub owns its own timing and the room reads it. Per file the
 * duration is DETERMINISTIC (derived from the file id), so a test with fake
 * timers knows exactly when the rung turns over.
 */
export const SPREAD_STUB_PROCESSING_MS: [number, number] = [4000, 8000];

/** The adapter the cockpit uses. One call site, one flip. */
export function boomAdapter(): BoomAdapter {
  return BOOM_UPLOAD_LANE === "live" ? liveBoomAdapter() : stubBoomAdapter();
}

/* ------------------------------------------------------------ the live lane */

/** The call seam, so a test can hand this adapter a fake connector. */
export type BoomToolCall = (
  server: string,
  tool: string,
  input?: unknown,
  options?: CallOptions,
) => Promise<McpOk<unknown>>;

const LADDER: readonly BoomFileStatus[] = ["waiting_for_upload", "processing", "failed", "completed", "verified"];

/** Boom's statuses that mean the file is somewhere terminal and readable. */
export const BOOM_READY: ReadonlySet<BoomFileStatus> = new Set<BoomFileStatus>(["completed", "verified"]);

const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The file id, wherever this rung's answer carries it. The four write rungs are
 *  unobserved, so all three spellings the server's own reads use are accepted
 *  rather than one being guessed at. */
function fileIdOf(body: Record<string, unknown> | undefined, fallback?: string): string | undefined {
  if (!body) return fallback;
  const file = body.file as Record<string, unknown> | undefined;
  return (
    asString(body.fileId) ??
    asString(file && typeof file === "object" ? file.id : undefined) ??
    asString(body.id) ??
    fallback
  );
}

/** A rung the server named, or nothing. An unknown word is a refusal, never a
 *  guess: a status the cockpit invented would move a banker's file on the glass. */
function statusOf(body: Record<string, unknown> | undefined, tool: string): BoomFileStatus | undefined {
  const raw = asString(body?.status);
  if (raw === undefined) return undefined;
  if (!LADDER.includes(raw as BoomFileStatus)) {
    throw describeFailure(
      { code: "transform_error", message: `${tool} returned an unknown status: ${raw}` },
      boomServer(),
      tool,
    );
  }
  return raw as BoomFileStatus;
}

function transformError(tool: string, message: string): never {
  throw describeFailure({ code: "transform_error", message }, boomServer(), tool);
}

/**
 * The adapter that calls Noland's server.
 *
 * THE FOUR UPLOAD RUNGS ARE WRITES and carry the write discipline: the longer
 * deadline, and NO automatic retry. A rejected upload is not proof the file did
 * not reach Boom, and re-sending it is the banker's gesture. The status read,
 * the wait and the spread read are READS and get the read policy: three
 * attempts and the shorter deadline, which is what makes a poll survive an idle
 * MCP session.
 *
 * Transport failures reject with the normalized `McpFailure` every other lane
 * throws, already recorded against the lane health line by `callTool`. A failure
 * BOOM ITSELF reports is not a transport failure: it comes back as a result with
 * `status: "failed"` and Boom's own message.
 */
export function liveBoomAdapter(call: BoomToolCall = callTool): BoomAdapter {
  const write = (signal?: AbortSignal): CallOptions => ({ signal });
  const read = (signal?: AbortSignal): CallOptions => ({ read: true, signal });

  /** One rung's body, envelope already off it. */
  const body = async (tool: string, args: unknown, options: CallOptions, key?: string) => {
    const res = await call(boomServer(), tool, args, options);
    return readBoomAnswer<Record<string, unknown>>(res, key)?.body;
  };

  /** The file Boom already holds for these bytes, or nothing.
   *
   *  IDEMPOTENCY IS KEPT ON BOTH SIDES. `boom_create_upload` is idempotent on
   *  the sha256 it is handed, and this asks first anyway: a re-drop that found a
   *  file already processing must not reserve a second one, and the room says in
   *  words that it is reusing it. A `failed` file is NOT reused: that is a file
   *  the banker is deliberately sending again. */
  async function existingFile(req: BoomUploadRequest, signal?: AbortSignal): Promise<BoomUploadResult | null> {
    const listed = await body(BOOM_TOOLS.listFiles, listFilesArgs(req.company.externalUniqueId), read(signal));
    const files = Array.isArray(listed?.files) ? (listed.files as Array<Record<string, unknown>>) : [];
    for (const file of files) {
      if (asString(file.fileName) !== req.file.name) continue;
      const status = asString(file.status);
      if (!status || status === "failed" || !LADDER.includes(status as BoomFileStatus)) continue;
      const id = asString(file.id);
      if (!id) continue;
      return {
        fileId: id,
        companyId: null,
        fileGroupId: asString(file.fileGroupId) ?? null,
        status: status as BoomFileStatus,
        reused: true,
      };
    }
    return null;
  }

  return {
    async upload(req: BoomUploadRequest, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult> {
      const signal = opts?.signal;
      if (req.file.base64.length > BOOM_BASE64_CAP_BYTES) {
        transformError(BOOM_TOOLS.uploadBytes, `the encoded file is ${req.file.base64.length} bytes, past Boom's ${BOOM_BASE64_CAP_BYTES}-byte cap`);
      }
      // The connector name is wanted before the first call, not after it.
      await boomConnector();

      const ensured = await body(BOOM_TOOLS.ensureCompany, ensureCompanyArgs(req), write(signal));
      const companyId =
        asString(ensured?.companyId) ??
        asString((ensured?.company as Record<string, unknown> | undefined)?.id) ??
        asString(ensured?.id) ??
        null;

      const already = await existingFile(req, signal);
      if (already) return { ...already, companyId: already.companyId ?? companyId };

      const reserved = await body(BOOM_TOOLS.createUpload, createUploadArgs(req), write(signal));
      const fileId = fileIdOf(reserved);
      if (!fileId) transformError(BOOM_TOOLS.createUpload, `${BOOM_TOOLS.createUpload} returned no file id`);

      await body(BOOM_TOOLS.uploadBytes, uploadBytesArgs(fileId, req), write(signal));
      const processing = await body(BOOM_TOOLS.processFile, fileArgs(fileId), write(signal));

      return {
        fileId,
        companyId,
        fileGroupId: asString(reserved?.fileGroupId) ?? req.fileGroupId ?? null,
        // The rung the server named, or the rung the ladder is on: the bytes are
        // in and processing has been asked for.
        status: statusOf(processing, BOOM_TOOLS.processFile) ?? "processing",
      };
    },

    /** Where the file has got to, with Boom's own spread once it is readable. */
    async status(fileId: string, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult> {
      const signal = opts?.signal;
      const file = await body(BOOM_TOOLS.getFile, fileArgs(fileId), read(signal), "file");
      if (!file) transformError(BOOM_TOOLS.getFile, `${BOOM_TOOLS.getFile} returned no file`);
      const status = statusOf({ status: file.status }, BOOM_TOOLS.getFile);
      if (!status) transformError(BOOM_TOOLS.getFile, `${BOOM_TOOLS.getFile} returned no status`);

      const result: BoomUploadResult = {
        fileId: asString(file.id) ?? fileId,
        companyId: null,
        fileGroupId: asString(file.fileGroupId) ?? null,
        status,
        fileName: asString(file.fileName),
      };
      if (!BOOM_READY.has(status)) return result;

      const spread = await body(BOOM_TOOLS.getSpread, fileArgs(fileId), read(signal), "spread");
      const statements = Array.isArray(spread?.financialStatements)
        ? (spread.financialStatements as BoomFinancialStatement[])
        : [];
      return { ...result, fileGroupId: asString(spread?.fileGroupId) ?? result.fileGroupId, financialStatements: statements };
    },

    /** ONE BOUNDED WAIT. The server blocks at most 25 seconds by its own design,
     *  so waiting longer than that is the ROOM's business (`spreadEngine.ts`),
     *  not a longer argument here. */
    async awaitSettled(fileId: string, maxSeconds: number, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult> {
      const waited = await body(BOOM_TOOLS.awaitFile, awaitArgs(fileId, maxSeconds), read(opts?.signal));
      const status = statusOf(waited, BOOM_TOOLS.awaitFile);
      if (!status) transformError(BOOM_TOOLS.awaitFile, `${BOOM_TOOLS.awaitFile} returned no status`);
      return { fileId: fileIdOf(waited, fileId)!, companyId: null, fileGroupId: null, status };
    },

    /** THE SAME FILE, ON THE OTHER BASIS. Boom holds both reads and the register
     *  asks for one; nothing here derives an as-given figure from an adjusted
     *  one, which is the whole reason this is a call and not a filter. */
    async readSpread(fileId: string, opts?: { adjusted?: boolean; signal?: AbortSignal }): Promise<BoomFinancialStatement[]> {
      const spread = await body(
        BOOM_TOOLS.getSpread,
        spreadArgs(fileId, opts?.adjusted ?? true),
        read(opts?.signal),
        "spread",
      );
      return Array.isArray(spread?.financialStatements) ? (spread.financialStatements as BoomFinancialStatement[]) : [];
    },

    /** WHICH LINE FED WHICH FIGURE, Boom's own answer. Asked by FILE, so the
     *  support lines belong to the spread on the glass and not to whatever file
     *  the borrower's latest ratio set happens to name. */
    async ratioSupport(fileId: string, opts?: { signal?: AbortSignal }): Promise<BoomRatioSupportLine[]> {
      const ratios = await body(BOOM_TOOLS.getRatios, { fileId }, read(opts?.signal));
      const support = ratios?.support as { lines?: unknown } | undefined;
      return Array.isArray(support?.lines) ? (support.lines as BoomRatioSupportLine[]) : [];
    },

    async validationSession(fileId: string): Promise<{ url: string; expiresAt: string }> {
      const opened = await body(BOOM_TOOLS.openVerification, fileArgs(fileId), read());
      const url = asString(opened?.url) ?? asString((opened?.session as Record<string, unknown> | undefined)?.url);
      const expiresAt =
        asString(opened?.expiresAt) ?? asString((opened?.session as Record<string, unknown> | undefined)?.expiresAt);
      if (!url || !expiresAt) transformError(BOOM_TOOLS.openVerification, `${BOOM_TOOLS.openVerification} returned no session`);
      return { url, expiresAt };
    },
  };
}

/* ------------------------------------------------------------ the stub lane */

/* THE PRE-READ SIDE CHANNEL.

   `BoomAdapter.upload` takes bytes, not understanding, and that signature is
   the contract with Noland's server: the pre-read is OUR reading of the file
   and nothing the real Boom would ever be sent. But the stub has no spreading
   engine, and a stub that answered with a fixture would put another company's
   figures on stage. So the room hands the pre-read to the stub BESIDE the
   upload, keyed by the file's sha256, and the stub builds its provisional
   spread from it.

   This is a documented STUB-ONLY channel. It disappears with the stub, and
   nothing in the live lane reads it. */

const preReads = new Map<string, FilePreRead>();

/** Give the stub the pre-read for one file, before or after its upload. */
export function registerPreRead(sha256: string, preRead: FilePreRead): void {
  preReads.set(sha256, preRead);
}

/** Forget everything the stub was told. Room teardown and tests. */
export function resetStubBoom(): void {
  preReads.clear();
  stubFiles.clear();
}

/** A sha256 the stub always fails on, so the room's failure path can be driven
 *  from a test or a probe without a broken file to hand. */
export const STUB_POISON_SHA256 = "f".repeat(64);

/** What the stub says when it has nothing to build a spread from. Written the
 *  way an upstream message reads, because that is what the room renders. */
export const STUB_FAILURE_MESSAGE =
  "Boom could not read this file. Nothing in it could be placed on a statement.";

/** What the stub says over every spread it returns. It is not Boom's spread and
 *  the room must never present it as one. */
export const STUB_PROVISIONAL_MESSAGE = "Provisional spread from the pre-read. Boom verification pending.";

interface StubFile {
  fileId: string;
  sha256: string;
  companyId: string;
  fileGroupId: string | null;
  startedAt: number;
  processingMs: number;
}

const stubFiles = new Map<string, StubFile>();

/* Deterministic ids, so the same file is the same file. FNV-1a over the seed,
   four salted passes for thirty-two hex digits, shaped like the uuids Boom
   returns. A sha256 is already thirty-two hex digits' worth of itself and is
   used directly, which is what makes the fileId idempotent by construction. */
function fnv1a(seed: string, salt: number): string {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function hex32(seed: string): string {
  return /^[0-9a-f]{32,}$/i.test(seed)
    ? seed.slice(0, 32).toLowerCase()
    : fnv1a(seed, 1) + fnv1a(seed, 2) + fnv1a(seed, 3) + fnv1a(seed, 4);
}

/** A uuid-shaped id derived from a seed. Same seed, same id, always. */
export function stubBoomId(seed: string): string {
  const h = hex32(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** How long THIS file spends processing: inside the range, fixed per file. */
export function stubProcessingMs(fileId: string): number {
  const [min, max] = SPREAD_STUB_PROCESSING_MS;
  const span = Math.max(1, max - min + 1);
  return min + (parseInt(fnv1a(fileId, 7), 16) % span);
}

/* ------------------------------------------------ pre-read -> Boom's shapes */

/** Boom's own hierarchy, inferred from the account code the pre-read placed.
 *  BOOM'S ANSWER WINS when the real server is in: this is the stub reasoning
 *  about codes, not a rule anyone should carry forward. */
export function hierarchyFor(accountCode: string | null): BoomFinancialStatement["lineItems"][number]["hierarchy"] {
  if (!accountCode) return "line_item";
  if (accountCode === "gross_profit" || accountCode === "operating_profit") return "subtotal";
  if (accountCode.startsWith("total_")) return "total";
  return "line_item";
}

/**
 * The pre-read of one file, in Boom's output shape.
 *
 * Period ids are generated here (the pre-read keys its values by the room's
 * display key, "FY2025"), every line keeps the account code the pre-read
 * placed, and the account-code roll-up is the plain sum the ratios read from.
 * `flipSign` is false throughout: the pre-read has no sign convention to
 * report, and claiming one would corrupt the roll-up.
 */
export function statementsFromPreRead(fileId: string, preRead: FilePreRead): BoomFinancialStatement[] {
  return preRead.statements.map((st, si) => {
    const statementId = `${fileId}-s${si + 1}`;
    /* BOOM MAPS. So the stand-in maps, with the same dictionary the pre-read
       uses, over the rows the pre-read left unplaced. Anything the read already
       placed is kept exactly as it placed it. */
    const lines = mapLineCodes(st.lines);
    const periods = st.periods.map((p, pi) => ({
      id: `${statementId}-p${pi + 1}`,
      endDate: p.endDate,
      periodType: p.periodType,
    }));
    const idOfKey = new Map(st.periods.map((p, pi) => [p.key, periods[pi].id]));
    const valuesOf = (line: PreReadLine): Record<string, number | null> => {
      const out: Record<string, number | null> = {};
      for (const p of st.periods) out[idOfKey.get(p.key)!] = line.values[p.key] ?? null;
      return out;
    };

    const lineItems = lines.map((line, li) => ({
      id: `${statementId}-l${li + 1}`,
      name: line.label,
      hierarchy: hierarchyFor(line.accountCode),
      accountCode: line.accountCode,
      flipSign: false,
      periodValues: valuesOf(line),
    }));

    /* BOOM'S OWN ROLL-UP SHAPE: a pair per period, as given and as allowed. The
       stand-in has no analyst adjustment to report, so the two are the same
       figure; what matters is that the shape is Boom's and not a second one. */
    type Rolled = NonNullable<BoomFinancialStatement["aggregatedFinancials"]>[number];
    const rolled = new Map<string, Rolled>();
    for (const item of lineItems) {
      if (!item.accountCode) continue;
      const row: Rolled = rolled.get(item.accountCode) ?? {
        accountCode: item.accountCode,
        accountName: item.name,
        periodValues: Object.fromEntries(periods.map((p) => [p.id, { asGiven: null, asAllowed: null }])),
      };
      for (const p of periods) {
        const v = item.periodValues[p.id];
        if (typeof v !== "number") continue;
        const sum = (row.periodValues[p.id].asGiven ?? 0) + v;
        row.periodValues[p.id] = { asGiven: sum, asAllowed: sum };
      }
      rolled.set(item.accountCode, row);
    }

    const endDates = periods.map((p) => p.endDate).filter((d): d is string => typeof d === "string");
    return {
      id: statementId,
      statementType: st.statementType,
      endDate: endDates.length ? endDates.slice().sort().at(-1)! : null,
      // NEVER `validated`, and never a validation URL. Validation is an
      // analyst's act inside Boom, and the stub has no Boom to send them to.
      validationStatus: "not_validated" as const,
      periods,
      lineItems,
      aggregatedFinancials: [...rolled.values()],
    };
  });
}

/**
 * Did the pre-read give the stand-in anything to build a statement from?
 *
 * ONE NUMERIC FIGURE IS ENOUGH, and the bar is deliberately that low. Boom
 * classifies and maps a file the cockpit could barely read; a stand-in that
 * refused every file whose lines arrived unmapped would fail exactly when the
 * session door is absent, which is the one moment it exists to cover. A file
 * with no figure in it at all is a different thing and still fails.
 */
function usable(preRead: FilePreRead | undefined): preRead is FilePreRead {
  return Boolean(
    preRead?.statements.some((s) =>
      s.lines.some((l) => Object.values(l.values).some((v) => typeof v === "number" && Number.isFinite(v))),
    ),
  );
}

function stubResult(file: StubFile, status: BoomFileStatus, extra: Partial<BoomUploadResult> = {}): BoomUploadResult {
  return {
    fileId: file.fileId,
    companyId: file.companyId,
    fileGroupId: file.fileGroupId,
    status,
    validationUrl: null,
    ...extra,
  };
}

/**
 * The stub adapter: Boom's ladder, this file's own numbers, nothing verified.
 *
 * `upload` answers immediately at `processing`, which is what a server that
 * takes bytes and spreads them behind itself does. `status` then walks the
 * clock: `processing` until this file's own duration is spent, then `completed`
 * with the provisional spread, or `failed` with an upstream-shaped message when
 * there was nothing to build from.
 *
 * IDEMPOTENT. The file id is derived from the sha256, so the same file dropped
 * twice is one file, one clock and one set of periods.
 *
 * `validationSession` is deliberately ABSENT: there is no Boom page to send an
 * analyst to, and an optional method that is missing is how the room learns it
 * cannot offer "Verify in Boom" yet. `readSpread` and `ratioSupport` are absent
 * for the same reason: the stand-in holds one read of the file and no ratio
 * support at all, so the register offers no basis switch and marks no line as
 * feeding a headline figure rather than inventing either.
 */
export function stubBoomAdapter(): BoomAdapter {
  return {
    async upload(req: BoomUploadRequest): Promise<BoomUploadResult> {
      const fileId = stubBoomId(req.file.sha256);
      const existing = stubFiles.get(fileId);
      // A re-drop does not restart the clock and does not make a second file.
      const file: StubFile = existing ?? {
        fileId,
        sha256: req.file.sha256,
        companyId: stubBoomId(`company:${req.company.externalUniqueId}`),
        fileGroupId: req.fileGroupId ?? null,
        startedAt: Date.now(),
        processingMs: stubProcessingMs(fileId),
      };
      stubFiles.set(fileId, file);
      return stubResult(file, "processing");
    },

    async status(fileId: string): Promise<BoomUploadResult> {
      const file = stubFiles.get(fileId);
      if (!file) {
        return {
          fileId,
          companyId: null,
          fileGroupId: null,
          status: "failed",
          message: "Boom has no file with that id.",
          validationUrl: null,
        };
      }
      if (Date.now() - file.startedAt < file.processingMs) return stubResult(file, "processing");

      const preRead = preReads.get(file.sha256);
      if (file.sha256 === STUB_POISON_SHA256 || !usable(preRead)) {
        return stubResult(file, "failed", { message: STUB_FAILURE_MESSAGE });
      }
      return stubResult(file, "completed", {
        message: STUB_PROVISIONAL_MESSAGE,
        financialStatements: statementsFromPreRead(file.fileId, preRead),
      });
    },

    async createGroup(companyExternalId: string): Promise<{ fileGroupId: string }> {
      return { fileGroupId: stubBoomId(`group:${companyExternalId}`) };
    },
  };
}
