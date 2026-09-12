/* =============================================================================
   THE BOOM ADAPTER: the one module that talks to Boom.

   Boom spreads statements. It classifies the file, finds the periods, maps every
   line to an account code, and an analyst verifies the result in Boom's own
   page. THIS LAYER DOES NOT RE-IMPLEMENT ANY OF THAT. It carries bytes in and
   Boom's spread out, and everything around the call (the pre-read, the governed
   plan, the post-read) lives elsewhere.

   TWO ADAPTERS, ONE INTERFACE (`BoomAdapter` in spread/types.ts):

     LIVE   four MCP tool calls to Noland's read + write Boom MCP server,
            addressed by connector DISPLAY NAME through the viewer's own grant,
            exactly like every other lane here. The server owns company upsert,
            presigned upload, the process trigger and polling; none of that
            appears in this file or anywhere in the cockpit.
     STUB   the adapter that is ACTIVE today, because the Boom connector does not
            exist yet. It walks Boom's real ladder with realistic timing and
            answers with a Boom-shaped spread BUILT FROM THE PRE-READ of the
            file the banker actually dropped, so the room shows that file's own
            numbers rather than a fixture. Every statement it returns is
            `not_validated`, carries no validation URL and is labelled
            provisional in words. IT NEVER RETURNS `verified`: verification is
            an analyst's act inside Boom and the cockpit may not imply one.

   WHEN THE REAL SERVER LANDS, the amendment is the mapping block below plus one
   constant. Nothing else in the cockpit changes.
   ============================================================================= */

import { callTool, describeFailure, SERVERS, TOOLS, unwrapJson, type CallOptions, type McpOk } from "./mcp";
import { mapLineCodes } from "../spread/lineMap";
import type {
  BoomAdapter,
  BoomFileStatus,
  BoomFinancialStatement,
  BoomUploadRequest,
  BoomUploadResult,
  FilePreRead,
  PreReadLine,
} from "../spread/types";

/* =============================================================================
   THE MAPPING NOLAND'S SERVER AMENDS
   -----------------------------------------------------------------------------
   Everything the cockpit assumes about the Boom connector is in this one block:
   four tool names and four argument shapes. They are written against what we
   EXPECT and have not been observed on a live connector, because there is not
   one yet. This block IS the contract handed to Noland.

     boom_upload_statement    the file goes in, Boom's file id comes back
       in   { company: { externalUniqueId, name, fullAddress? },
              file: { name, mime, base64, sha256 },
              externalUniqueId,           // the sha256: a re-drop is the same file
              statementQuality,           // cpa_audited | cpa_reviewed | cpa_compiled | internal
              fileGroupId? }
       out  { fileId, companyId, fileGroupId, status, message?,
              financialStatements?, validationUrl? }   // BoomUploadResult

     boom_upload_status       the same shape, for one file already sent
       in   { fileId }
       out  BoomUploadResult

     boom_create_file_group   one consolidated group per plan (optional)
       in   { companyExternalUniqueId }
       out  { fileGroupId }

     boom_validation_session  the analyst's verification page (optional)
       in   { fileId }
       out  { url, expiresAt }

   `status` is Boom's own File.status ladder, unchanged:
     waiting_for_upload -> processing -> failed | completed -> verified

   IDEMPOTENCY IS THE SERVER'S TO KEEP. `externalUniqueId` is the file's sha256,
   so the same bytes sent twice must resolve to the same Boom file and must
   never produce a second period. The cockpit relies on that and does not
   de-duplicate on its own.

   WHAT TO CHANGE WHEN THE REAL SERVER LANDS
     1. `SERVERS.boom` in channel/mcp.ts: "IDB Gateway" -> the Boom connector's
        display name, spelled exactly as the viewer's connector list spells it.
        The health line stops saying "via gateway" on its own.
     2. The four names in `TOOLS` (channel/mcp.ts) if his server spells them
        differently. Nothing outside that object holds a Boom tool name.
     3. The four `…Args` functions below if his argument names differ. Keep the
        cockpit-side shapes (`BoomUploadRequest`) intact: the room, the pre-read
        and the tests are all written against them.
     4. `readResult` below if his envelope differs from a plain JSON object.
        Anything the platform can put a result in is already handled by
        `unwrapJson`; a Salesforce-style invocable envelope is not, and would
        need `unwrapInvocableOne` instead.
     5. `BOOM_UPLOAD_LANE` to "live".
     6. Run the probe's Boom lane (design/probes/lib/stub-lanes.js) against the
        real names to confirm the wire shapes before shipping.
   ============================================================================= */

const BOOM_TOOLS = {
  upload: TOOLS.boomUpload,
  status: TOOLS.boomUploadStatus,
  createGroup: TOOLS.boomCreateFileGroup,
  validationSession: TOOLS.boomValidationSession,
} as const;

/** The upload call's arguments, from the cockpit's own request shape. */
export function uploadArgs(req: BoomUploadRequest): Record<string, unknown> {
  return {
    company: {
      externalUniqueId: req.company.externalUniqueId,
      name: req.company.name,
      ...(req.company.fullAddress ? { fullAddress: req.company.fullAddress } : {}),
    },
    file: { name: req.file.name, mime: req.file.mime, base64: req.file.base64, sha256: req.file.sha256 },
    externalUniqueId: req.externalUniqueId,
    statementQuality: req.statementQuality,
    ...(req.fileGroupId ? { fileGroupId: req.fileGroupId } : {}),
  };
}

export const statusArgs = (fileId: string): Record<string, unknown> => ({ fileId });
export const createGroupArgs = (companyExternalUniqueId: string): Record<string, unknown> => ({ companyExternalUniqueId });
export const validationSessionArgs = (fileId: string): Record<string, unknown> => ({ fileId });

/* ---------------------------------------------------------------- the lane */

/**
 * WHICH ADAPTER IS ACTIVE.
 *
 * "stub" until Noland's Boom connector exists. This is the flip, and it is
 * deliberately a constant and not a runtime setting: a cockpit that could be
 * talked into its stub by anything other than a code change is a cockpit that
 * can show a provisional spread while claiming a connector answered.
 */
export const BOOM_UPLOAD_LANE: "stub" | "live" = "stub";

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

/** Boom's answer, read off whatever the platform wrapped it in. */
function readResult(res: McpOk<unknown>, tool: string, fallbackFileId?: string): BoomUploadResult {
  const body = unwrapJson<Record<string, unknown>>(res);
  if (!body) {
    throw describeFailure({ code: "transform_error", message: `${tool} returned no object` }, SERVERS.boom, tool);
  }
  const fileId = typeof body.fileId === "string" ? body.fileId : typeof body.id === "string" ? body.id : fallbackFileId;
  if (!fileId) {
    throw describeFailure({ code: "transform_error", message: `${tool} returned no file id` }, SERVERS.boom, tool);
  }
  const status = body.status as BoomFileStatus | undefined;
  if (!status || !LADDER.includes(status)) {
    throw describeFailure(
      { code: "transform_error", message: `${tool} returned an unknown status: ${String(body.status)}` },
      SERVERS.boom,
      tool,
    );
  }
  return {
    fileId,
    companyId: typeof body.companyId === "string" ? body.companyId : null,
    fileGroupId: typeof body.fileGroupId === "string" ? body.fileGroupId : null,
    status,
    // BOOM'S OWN WORDS, VERBATIM. Boom has no structured failure reason (Q&A
    // tracker #14), so whatever the server says is what the banker reads.
    ...(typeof body.message === "string" ? { message: body.message } : {}),
    ...(Array.isArray(body.financialStatements)
      ? { financialStatements: body.financialStatements as BoomFinancialStatement[] }
      : {}),
    ...(typeof body.validationUrl === "string" ? { validationUrl: body.validationUrl } : {}),
  };
}

/**
 * The adapter that calls Noland's server.
 *
 * THE UPLOAD IS A WRITE and carries the write discipline: the longer deadline,
 * and NO automatic retry. A rejected upload is not proof the file did not
 * reach Boom, and re-sending it is the banker's gesture. (The sha256 travels as
 * `externalUniqueId` so a deliberate re-send is the same file to Boom, but that
 * is the server's guarantee to keep and not a licence for the page to retry.)
 * The status read is a READ and gets the read policy: three attempts, the
 * shorter deadline, which is what makes a poll survive an idle MCP session.
 *
 * Transport failures reject with the normalized `McpFailure` every other lane
 * throws, already recorded against the lane health line by `callTool`. A
 * failure BOOM ITSELF reports is not a transport failure: it comes back as a
 * result with `status: "failed"` and Boom's own message.
 */
export function liveBoomAdapter(call: BoomToolCall = callTool): BoomAdapter {
  return {
    async upload(req: BoomUploadRequest, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult> {
      const res = await call(SERVERS.boom, BOOM_TOOLS.upload, uploadArgs(req), { signal: opts?.signal });
      return readResult(res, BOOM_TOOLS.upload);
    },
    async status(fileId: string, opts?: { signal?: AbortSignal }): Promise<BoomUploadResult> {
      const res = await call(SERVERS.boom, BOOM_TOOLS.status, statusArgs(fileId), { read: true, signal: opts?.signal });
      return readResult(res, BOOM_TOOLS.status, fileId);
    },
    async createGroup(companyExternalId: string): Promise<{ fileGroupId: string }> {
      const res = await call(SERVERS.boom, BOOM_TOOLS.createGroup, createGroupArgs(companyExternalId));
      const body = unwrapJson<Record<string, unknown>>(res);
      const id = typeof body?.fileGroupId === "string" ? body.fileGroupId : typeof body?.id === "string" ? body.id : undefined;
      if (!id) {
        throw describeFailure(
          { code: "transform_error", message: `${BOOM_TOOLS.createGroup} returned no group id` },
          SERVERS.boom,
          BOOM_TOOLS.createGroup,
        );
      }
      return { fileGroupId: id };
    },
    async validationSession(fileId: string): Promise<{ url: string; expiresAt: string }> {
      const res = await call(SERVERS.boom, BOOM_TOOLS.validationSession, validationSessionArgs(fileId));
      const body = unwrapJson<Record<string, unknown>>(res);
      if (typeof body?.url !== "string" || typeof body?.expiresAt !== "string") {
        throw describeFailure(
          { code: "transform_error", message: `${BOOM_TOOLS.validationSession} returned no session` },
          SERVERS.boom,
          BOOM_TOOLS.validationSession,
        );
      }
      return { url: body.url, expiresAt: body.expiresAt };
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

    const rolled = new Map<string, { accountCode: string; accountName: string; periodValues: Record<string, number | null> }>();
    for (const item of lineItems) {
      if (!item.accountCode) continue;
      const row = rolled.get(item.accountCode) ?? {
        accountCode: item.accountCode,
        accountName: item.name,
        periodValues: Object.fromEntries(periods.map((p) => [p.id, null])) as Record<string, number | null>,
      };
      for (const p of periods) {
        const v = item.periodValues[p.id];
        if (typeof v !== "number") continue;
        row.periodValues[p.id] = (row.periodValues[p.id] ?? 0) + v;
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
 * cannot offer "Verify in Boom" yet.
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
