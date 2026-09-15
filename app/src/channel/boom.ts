/* =============================================================================
   WHAT COMES BACK THROUGH THE BOOM DOOR.

   Boom is its own read + write MCP server now (`boom-mcp`, observed live
   2026-09-15), and its answers carry an envelope the gateway's relay never did:

     { contractVersion, _source, _provenance{system, record, ids, asOf}, ...body }

   with the body under its own key on the shapes that have one (`{file:{}}`,
   `{spread:{}}`). `_source` is "BOOM-LIVE" where the server read Boom itself and
   names a fixture otherwise, and it is CARRIED to the glass rather than assumed.

   A REFUSAL IS ALSO AN ANSWER. A borrower Boom has never heard of comes back as
   `{ code: "NOT_FOUND", message, boomStatus: 404 }`, so the reads below tell
   "not in Boom" apart from "Boom is unreachable" and each surface says the one
   that is true. Hartwell is exactly that case on the founder's own org.

   THE RATIOS ARE THE SERVER'S. `raw` passes through verbatim (contract.ts,
   `borrower.boom.ratios.raw`) and nothing here recomputes a figure: Boom's own
   `raw` matched the cockpit's on-file snapshot to the digit for Piedmont on
   2026-09-15 (leverage 3.8460068781047, coverage 2.637546468401487), which is
   what makes the verbatim contract safe to keep.

   WHICH CONNECTOR these calls are addressed to is `channel/boomLane.ts`.
   ============================================================================= */

import { discoverBoomServer } from "./boomLane";
import { BOOM_SIGNATURE_TOOLS, callTool, listConnectorServers, TOOLS, unwrapJson, type CallOptions, type McpOk } from "./mcp";

/** WHICH CONNECTOR BOOM IS, asked once, through the acquired namespace. Every
 *  Boom call in the cockpit goes through this rather than through a name. */
export function boomConnector(): Promise<string> {
  return discoverBoomServer(listConnectorServers, BOOM_SIGNATURE_TOOLS);
}

/* -------------------------------------------------------- the envelope */

/** Boom knows nothing about this borrower. Not a transport failure and not a
 *  bug: a relationship that has never been spread is a state the glass says. */
export interface BoomNotFound {
  notFound: true;
  /** Boom's own words, shown where a banker needs the detail. */
  message: string;
}

export function isBoomNotFound(e: unknown): e is BoomNotFound {
  return (e as BoomNotFound | null | undefined)?.notFound === true;
}

/** What every Boom answer carries beside its body. */
export interface BoomEnvelope {
  contractVersion?: string;
  /** "BOOM-LIVE" when the server read Boom itself; a fixture name otherwise. */
  source?: string;
  /** The date the body describes, where the answer is about a period. */
  asOf?: string;
}

export interface BoomBody<T> {
  body: T;
  envelope: BoomEnvelope;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Read one Boom answer: the envelope off the wrapper, the body from `key`
 * where the shape has one.
 *
 * Throws {@link BoomNotFound} on Boom's own 404 body, so a caller branches on a
 * missing borrower rather than on a message it had to match by hand. Returns
 * undefined where nothing object-shaped came back at all, which every caller
 * treats as a failed read.
 */
export function readBoomAnswer<T = Record<string, unknown>>(res: McpOk<unknown>, key?: string): BoomBody<T> | undefined {
  const outer = unwrapJson<Record<string, unknown>>(res);
  if (!outer) return undefined;
  if (str(outer.code) === "NOT_FOUND" || outer.boomStatus === 404) {
    throw { notFound: true, message: str(outer.message) ?? "Boom holds no record for this borrower." } satisfies BoomNotFound;
  }
  const provenance = isObj(outer._provenance) ? outer._provenance : undefined;
  const envelope: BoomEnvelope = {
    contractVersion: str(outer.contractVersion),
    source: str(outer._source),
    asOf: str(provenance?.asOf),
  };
  const body = key ? outer[key] : outer;
  return isObj(body) ? { body: body as T, envelope } : undefined;
}

/* ------------------------------------------------------------ the reads */

/** How a borrower is named to Boom. The Salesforce record id is the join Boom
 *  itself stores (`externalUniqueId`), so it is preferred over the name, which
 *  only ever matches by luck. */
export interface BoomBorrower {
  accountId?: string | null;
  company?: string | null;
}

/** The identifier arguments the two reads take. Empty where neither is known,
 *  which the callers refuse rather than send. */
export function boomBorrowerArgs(who: BoomBorrower): Record<string, string> {
  if (who.accountId) return { salesforceRecordId: who.accountId };
  if (who.company) return { companyName: who.company };
  return {};
}

/** The period a ratio set describes, in the shape `boom-normalise.mjs` binds
 *  EBITDA to. The server states it on `_provenance.asOf` and again on
 *  `support.periodEnd`; the support line is the one struck from the spread. */
function ratiosAsOfOf(body: Record<string, unknown>, envelope: BoomEnvelope): string | undefined {
  const support = isObj(body.support) ? body.support : undefined;
  return str(support?.periodEnd) ?? str(envelope.asOf);
}

/** What the cockpit's book holds for one borrower, ready for `normaliseBoom`. */
export interface BoomReads {
  /** `boom_get_ratios`, with `asOf` lifted onto the object the normaliser reads. */
  ratios?: Record<string, unknown>;
  /** `boom_get_spread`, wrapped the way `bundle.boom.spread` carries it. */
  spread?: { file: Record<string, unknown> };
  /** "BOOM-LIVE", or the fixture the server answered from. */
  source?: string;
  /** When the served answer was stored, where it came off the cache. */
  storedAt?: number;
}

/** The seam a test hands a fake connector. */
export type BoomCall = (server: string, tool: string, input?: unknown, options?: CallOptions) => Promise<McpOk<unknown>>;

const READ: CallOptions = { read: true, cache: { staleTime: 30_000 } };

/**
 * The two reads the Financials tab and the memo stand on.
 *
 * RATIOS FIRST, AND THE SPREAD OFF ITS ANSWER. `boom_get_spread` takes a FILE
 * id and nothing else, so there is no borrower-shaped call to make: the ratio
 * set names the file it was struck from (`support.fileId`) and that is the file
 * whose spread belongs beside it. Reading any other file would print a ratio
 * set and a statement table struck from two different documents.
 *
 * A borrower Boom has never heard of rejects with {@link BoomNotFound}. A
 * spread that fails where the ratios answered is a partial, not a failure: the
 * tab's ratio card is the half a banker reads first.
 */
export async function readBoom(
  who: BoomBorrower,
  opts: { call?: BoomCall; signal?: AbortSignal } = {},
): Promise<BoomReads> {
  const call = opts.call ?? callTool;
  const args = boomBorrowerArgs(who);
  if (!Object.keys(args).length) {
    throw { notFound: true, message: "No borrower is bound to this view, so Boom cannot be asked." } satisfies BoomNotFound;
  }
  const server = await boomConnector();

  const res = await call(server, TOOLS.boomRatios, args, { ...READ, signal: opts.signal });
  const answer = readBoomAnswer<Record<string, unknown>>(res);
  if (!answer) throw { notFound: true, message: "Boom returned no ratio set for this borrower." } satisfies BoomNotFound;

  const asOf = ratiosAsOfOf(answer.body, answer.envelope);
  const out: BoomReads = {
    ratios: { ...answer.body, ...(asOf ? { asOf } : {}) },
    source: answer.envelope.source,
    storedAt: res.cache?.storedAt,
  };

  const support = isObj(answer.body.support) ? answer.body.support : undefined;
  const fileId = str(support?.fileId);
  if (!fileId) return out;

  try {
    const spreadRes = await call(server, TOOLS.boomSpread, { fileId }, { ...READ, signal: opts.signal });
    const spread = readBoomAnswer<Record<string, unknown>>(spreadRes, "spread");
    if (spread) out.spread = { file: spread.body };
  } catch {
    // The ratio card stands on its own. A spread that did not answer leaves the
    // statement table on whatever the book already held.
  }
  return out;
}
