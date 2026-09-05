/* =============================================================================
   Typed cockpit operations over the connector layer.

   Each function owns ONE proven tool call plus its envelope unwrapping, so the
   components never touch `window.claude.mcp` or an envelope shape directly.
   Failures reject as {@link McpFailure} — already branchable, already carrying
   the fix copy for the affected section.
   ============================================================================= */

import type { ActionChangeCounts, ActionHistoryRow, ActionStep, BorrowerBundle, C360Data, Id } from "../data/contract";
import { buildGroundedPrompt } from "../data/grounding";
import { callTool, SERVERS, TOOLS, unwrapInvocable, unwrapLlm, unwrapMail, type LlmAnswer } from "./mcp";
import { readThroughEitherLane } from "./gateway/lane";

/* ------------------------------------------------------------------ chat */

/** Ask the credit copilot. The prompt is GROUNDED in the staged bundle so the
 *  model answers from the cockpit's figures, never from general knowledge. */
export async function askCopilot(args: {
  data: C360Data;
  bundle: BorrowerBundle | null;
  accountName: string | null;
  tab: string | null;
  question: string;
  signal?: AbortSignal;
}): Promise<LlmAnswer> {
  const prompt = buildGroundedPrompt(args);
  const res = await callTool(SERVERS.gateway, TOOLS.llm, { prompt }, { read: true, signal: args.signal });
  return unwrapLlm(res.payload);
}

/* ------------------------------------------------------------------ boom */

/** Refresh Boom financials for one company. Ratios are the proven call; the
 *  spread follows the same connector pattern and is best-effort. */
export async function refreshBoom(company: string): Promise<{ ratios?: unknown; spread?: unknown; storedAt?: number }> {
  const [ratios, spread] = await Promise.allSettled([
    callTool(SERVERS.gateway, TOOLS.boomRatios, { company }, { read: true, cache: { staleTime: 30_000 } }),
    callTool(SERVERS.gateway, TOOLS.boomSpread, { company }, { read: true, cache: { staleTime: 30_000 } }),
  ]);
  const out: { ratios?: unknown; spread?: unknown; storedAt?: number } = {};
  if (ratios.status === "fulfilled") {
    out.ratios = ratios.value.payload;
    out.storedAt = ratios.value.cache?.storedAt;
  }
  if (spread.status === "fulfilled") out.spread = spread.value.payload;
  // Both failing is a real failure; one failing is a partial the caller can show.
  if (ratios.status === "rejected" && spread.status === "rejected") throw ratios.reason;
  return out;
}

/* -------------------------------------------------------- action history */

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Salesforce hands datetimes back space-separated ("2026-07-25 20:18:36"), not
 * as ISO instants. The whole timeline sorts and renders on ISO, so normalise
 * here, at the seam, rather than teaching every consumer two formats.
 *
 * The API returns UTC, so the normalised value is stamped Z. Anything already
 * carrying a zone is left alone, and anything unrecognisable is dropped: a
 * fabricated timestamp would place a real event at the wrong point in the trail.
 */
export function normalizeStamp(raw: unknown): string | undefined {
  const v = text(raw);
  if (!v) return undefined;
  const spaced = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(v);
  if (spaced) return `${spaced[1]}T${spaced[2]}${spaced[3] ?? ""}Z`;
  return Number.isNaN(Date.parse(v)) ? undefined : v;
}

/** A finite number or nothing. The org returns null for a count it could not
 *  derive, and NaN in a memo would be worse than a missing figure. */
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Map one executed plan step. A step without an id cannot be addressed by the
 *  memo's section provenance, so it is dropped rather than rendered anonymously. */
function toStep(raw: Record<string, unknown>): ActionStep | null {
  const id = text(raw.id);
  if (!id) return null;
  return {
    id,
    type: text(raw.type),
    label: text(raw.label),
    objectName: text(raw.objectName),
    targetLoanId: text(raw.targetLoanId),
    targetLabel: text(raw.targetLabel),
    field: text(raw.field),
    before: text(raw.before),
    after: text(raw.after),
    verification: text(raw.verification),
    state: text(raw.state),
    orgRecordId: text(raw.orgRecordId),
  };
}

/** The requested/derived split, or nothing. An action whose plan shape carries
 *  no counts returns null, which is not the same fact as "it changed nothing". */
function toChangeCounts(raw: unknown): ActionChangeCounts | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const requested = num(r.requested);
  const derived = num(r.derived);
  return requested === undefined && derived === undefined ? undefined : { requested, derived };
}

/** Map one wire row defensively. A row without a stagingId cannot be deduped
 *  against the session echo, so it is dropped rather than double-rendered. */
function toHistoryRow(raw: Record<string, unknown>): ActionHistoryRow | null {
  const stagingId = text(raw.stagingId);
  if (!stagingId) return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((s) => toStep((s ?? {}) as Record<string, unknown>)).filter((s): s is ActionStep => s !== null)
    : undefined;
  return {
    stagingId,
    actionId: text(raw.actionId),
    status: text(raw.status),
    actorUserId: text(raw.actorUserId),
    approverUserId: text(raw.approverUserId),
    executedAt: normalizeStamp(raw.executedAt),
    createdDate: normalizeStamp(raw.createdDate),
    resultRecordId: text(raw.resultRecordId),
    resultRecordName: text(raw.resultRecordName),
    accountId: text(raw.accountId),
    productPackageId: text(raw.productPackageId),
    collateralId: text(raw.collateralId),
    planHashPresent: raw.planHashPresent === true,
    summary: text(raw.summary),
    steps,
    stepCount: num(raw.stepCount),
    changeCounts: toChangeCounts(raw.changeCounts),
  };
}

/**
 * The durable action trail for one account, newest first.
 *
 * THE INPUT KEY IS `maxResults` (live-verified 2026-09-03, org bankinggpt-at).
 * It was `limit` here from the day this was seamed, and the org answered every
 * call with INVALID_INPUT: "An invocable variable wasn't found for Apex action
 * Customer360ActionHistory: limit". The sweep drops a failing tool silently, so
 * the durable trail never loaded and the cockpit showed the session echo alone
 * — which read exactly like a tool that had not deployed yet. It had.
 */
export async function fetchActionHistory(
  accountId: Id,
  limit = 25,
  /**
   * THE TWO INPUTS THE READ GAINED WITH THE STEP DETAIL (Phase B, 9434378).
   *
   * `includeSteps` lifts the 90-day window the read otherwise applies to step
   * detail; `productPackageId` narrows the trail to one package and the
   * versions it forked into. Both are sent ONLY when a caller asks for them, so
   * the sweep's own call stays byte-identical to the one it has always made:
   * an org one deploy behind refuses an unknown invocable variable and takes
   * the whole trail down with it (the `limit` defect, 2026-09-03).
   */
  opts: { includeSteps?: boolean; productPackageId?: string | null } = {},
): Promise<{ rows: ActionHistoryRow[]; storedAt?: number }> {
  const inputs: Record<string, unknown> = { accountId, maxResults: limit };
  if (opts.includeSteps) inputs.includeSteps = true;
  if (opts.productPackageId) inputs.productPackageId = opts.productPackageId;
  /* EITHER DOOR, and the INPUTS OBJECT ABOVE IS UNTOUCHED. The `maxResults` vs
     `limit` defect (2026-09-03) lives in that object, not in the call, and the
     backup passes the inputs array through as it stands: an unknown invocable
     variable fails identically on both lanes, which is the only honest way for
     a mirror to behave. */
  const { value: res } = await readThroughEitherLane(TOOLS.actionHistory, [inputs], { cache: { staleTime: 15_000 } });
  const slot = unwrapInvocable<Record<string, unknown>>(res.payload, 1)[0];
  if (!slot.ok) throw { code: "tool_error", message: slot.error, fix: slot.error };

  // OBSERVED SHAPE: a READ tool, so outputValues carries accountId / count /
  // entries directly. There is no ok/result wrapper — that belongs to the write
  // tools, whose outcome is a thing that either happened or did not.
  const raw = (slot.data as { entries?: unknown }).entries;
  const rows = Array.isArray(raw)
    ? raw.map((r) => toHistoryRow((r ?? {}) as Record<string, unknown>)).filter((r): r is ActionHistoryRow => r !== null)
    : [];
  return { rows, storedAt: res.cache?.storedAt };
}

/** The statuses the staging record only reaches once the run is over. Anything
 *  else — Staged, Executing — means the org is still writing. `Executing` is
 *  reached the moment the token is consumed and STAYS there across the engine
 *  hop's interim write, which is why a poller may not settle on it. */
const TERMINAL_STATUS = new Set(["Completed", "Partial", "Failed"]);

export function isTerminalStatus(status: string | undefined): boolean {
  return !!status && TERMINAL_STATUS.has(status);
}

/**
 * ONE staging row, read fresh, for a room waiting on a filing it lost the answer to.
 *
 * Uncached and un-retried on purpose. `fetchActionHistory` holds its answer for
 * 15 seconds because the activity tab has no reason to ask more often; a poller
 * asking every three seconds and being handed the same cached row would watch a
 * finished run forever.
 *
 * Returns undefined when the row is not on the trail yet, which is a state and
 * not an error: the trail is Private to the acting banker and a row that has not
 * committed is a row nobody can see.
 *
 * AND THAT IS WHY IT NEVER GOES THROUGH THE READ BACKUP, even though it calls a
 * mirrored tool. The backup reads as one service identity; the row this poller
 * waits on was filed by the banker's own session and is Private to them, so the
 * backup would read a different trail and the poller would wait forever on a
 * row it cannot see.
 */
export async function readActionState(accountId: Id, stagingId: string): Promise<ActionHistoryRow | undefined> {
  const res = await callTool(
    SERVERS.customer360,
    TOOLS.actionHistory,
    { inputs: [{ accountId, maxResults: 25 }] },
    { cache: false },
  );
  const slot = unwrapInvocable<Record<string, unknown>>(res.payload, 1)[0];
  if (!slot.ok) throw { code: "tool_error", message: slot.error, fix: slot.error };
  const raw = (slot.data as { entries?: unknown }).entries;
  if (!Array.isArray(raw)) return undefined;
  for (const r of raw) {
    const row = toHistoryRow((r ?? {}) as Record<string, unknown>);
    if (row && row.stagingId === stagingId) return row;
  }
  return undefined;
}

/* --------------------------------------------------------------- mailbox */

export interface MailHit {
  id?: string;
  subject?: string;
  from?: string;
  receivedAt?: string;
  preview?: string;
  webLink?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Microsoft Graph returns `from` as `{emailAddress:{name,address}}`, not a
 * string, so a string-only reader rendered every sender blank. Both shapes are
 * real depending on which surface answered; parse both.
 */
export function readSender(v: unknown): string | undefined {
  const direct = str(v);
  if (direct) return direct;
  const obj = v as { emailAddress?: { name?: unknown; address?: unknown }; name?: unknown; address?: unknown } | null;
  const email = obj?.emailAddress ?? obj;
  return str(email?.name) ?? str(email?.address);
}

/**
 * Search the viewer's mailbox for a query the CALLER owns.
 *
 * Scoping to a borrower is a decision about the QUERY, not about the search, so
 * it lives one layer up in {@link searchMailbox}. A prospect does not exist in
 * the book yet and has no account name to derive a token from, so the intake
 * wizard passes what the banker typed straight through. The call, the envelope
 * unwrapping and the hit mapping are identical either way — there is one mail
 * reader in this cockpit, not two.
 */
export async function searchMailboxRaw(query: string): Promise<{ hits: MailHit[]; storedAt?: number }> {
  const res = await callTool(
    SERVERS.m365,
    TOOLS.mailSearch,
    { query },
    { read: true, cache: { staleTime: 60_000 } },
  );
  const rows = unwrapMail(res.payload);
  const hits: MailHit[] = rows.slice(0, 25).map((m) => ({
    id: str(m.id) ?? str(m.messageId),
    subject: str(m.subject),
    // `sender` is the observed field and arrives as a plain address string; the
    // Graph object shape is kept because both surfaces are real.
    from: readSender(m.sender) ?? readSender(m.from) ?? str(m.fromAddress),
    receivedAt: str(m.receivedDateTime) ?? str(m.sentDateTime) ?? str(m.receivedAt) ?? str(m.date),
    // OBSERVED: the body preview arrives as `summary`. The older keys stay as
    // fallbacks for whichever surface answers, but summary is the one this
    // search actually sends, and reading it wrong left every preview blank AND
    // hid the body text from the matcher.
    preview: str(m.summary) ?? str(m.bodyPreview) ?? str(m.preview) ?? str(m.snippet),
    webLink: str(m.webLink) ?? str(m.link),
  }));
  return { hits, storedAt: res.cache?.storedAt };
}

/** Search the viewer's mailbox for messages naming this account.
 *  An empty array is an honest "nothing found", never an error. */
export async function searchMailbox(accountName: string): Promise<{ hits: MailHit[]; storedAt?: number }> {
  // Ask for the DISTINCTIVE token, not the full legal name: nobody types
  // "Hartwell Precision Manufacturing LLC" in a subject line.
  return searchMailboxRaw(mailboxQuery(accountName));
}

/**
 * Words that name a KIND of business, not a business.
 *
 * "Precision", "Manufacturing", "Holdings" are shared by half a commercial book,
 * so an email containing only these tells us nothing about which relationship it
 * belongs to. Hartwell Precision Manufacturing and Piedmont Precision Components
 * both answer to "precision"; attaching a mail to either on that basis would be
 * a guess wearing a match's clothes.
 */
const GENERIC_NAME_WORDS = new Set([
  "precision", "manufacturing", "industrial", "logistics", "components", "holdings",
  "group", "services", "solutions", "systems", "partners", "associates", "enterprises",
  "international", "national", "global", "capital", "financial", "investments",
  "properties", "brands", "foods", "works", "supply", "trading", "consulting",
  "technologies", "equipment", "materials", "products",
]);

/** Legal-form suffixes: they identify a company's wrapper, never the company. */
const LEGAL_SUFFIXES = /\b(inc|llc|ltd|co|corp|corporation|company|plc|lp|llp|sa|nv|bv|gmbh|ag)\b/g;

const cleanName = (accountName: string) =>
  accountName.toLowerCase().replace(/[.,]/g, "").replace(LEGAL_SUFFIXES, "").replace(/\s+/g, " ").trim();

/**
 * The one word that actually identifies this relationship.
 *
 * The lead token of the cleaned name, as long as it is long enough to be
 * distinctive and is not a word every other borrower shares. Returns null when
 * the name yields nothing distinctive, and a null token NEVER matches: no token,
 * no attachment.
 */
export function distinctiveToken(accountName: string): string | null {
  for (const token of cleanName(accountName).split(" ")) {
    if (token.length >= 5 && !GENERIC_NAME_WORDS.has(token)) return token;
  }
  return null;
}

/** What to ask the mailbox for. The full legal name matches almost nothing a
 *  human would actually type in a subject line. */
export function mailboxQuery(accountName: string): string {
  return distinctiveToken(accountName) ?? cleanName(accountName) ?? accountName;
}

/**
 * Does this message belong to this relationship?
 *
 * TWO TIERS, both conservative:
 *   STRONG  the full cleaned name appears as a phrase;
 *   TOKEN   the distinctive token appears in the subject, the preview or the
 *           sender.
 *
 * A generic word alone can never attach a message to anything. "Test for
 * Hartwell" belongs to Hartwell; "precision components" belongs to nobody.
 */
export function matchesAccount(hit: MailHit, accountName: string): boolean {
  const full = cleanName(accountName);
  const hay = `${hit.subject ?? ""} ${hit.preview ?? ""} ${hit.from ?? ""}`.toLowerCase();

  if (full.length >= 4 && hay.includes(full)) return true;

  const token = distinctiveToken(accountName);
  if (!token) return false;
  // Word-boundary, so "hartwellian" does not attach to Hartwell.
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay);
}

