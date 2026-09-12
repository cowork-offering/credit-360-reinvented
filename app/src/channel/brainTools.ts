/* =============================================================================
   THE TWO CALL-OUTS — the only page functions the model may reach.

   A tool is not a lookup. It is another whole round: a three-round call on the
   default tier commonly takes 30 to 90 seconds, every round a separate paid
   request on the VIEWER's account. So the list is two, each narrow, and each
   description names the CHEAPER SOURCE the model should prefer, because models
   over-call and the prompt alone does not stop them.

   READS ONLY. THE WRITE FENCE IS ABSOLUTE. A call-out may READ. It may never
   WRITE. Every mutation stays on the governed path: propose, restate through
   proven phrasings, human confirm, single-use token, execute. This is the
   SR 11-7 fence and the whole reason a banker trusts the room, so it is not
   enforced by good intentions: {@link READ_DOORS} is an allow-list and
   `readDoor` refuses anything that is not on it, including by construction
   every `stage_*` and `execute_*` tool the connector exposes.

   THE SECOND TOOL IS THE N4 GAP, NAMED. The relationship graph read returns the
   union of the anchor's OWN involvement rows and every row on its loans, which
   is the read a banker means by "who guarantees what". A snapshot taken before
   a party moved does not carry it; this does.
   ============================================================================= */

import type { BrainReadBlocks } from "./brainLane";
import type { Connection, Covenant, Facility, LegalEntity } from "../data/contract";
import { fmtMoney } from "../data/format";
import { aggregateInvolvements, involvementRole } from "../data/graphAggregate";
import { classifyCovenant } from "../domain/covenantStatus";
import { callTool, SERVERS, TOOLS, unwrapInvocableOne } from "./mcp";
import type { SampleTool, SampleToolContext } from "./sampleDoor";

/**
 * THE ONLY DOORS A CALL-OUT MAY OPEN.
 *
 * Both are reads. Nothing is added to this set without the write fence being
 * re-argued: a read tool that could mutate is not exposed, and a set that grew
 * by habit would be exactly how the fence rots.
 */
export const READ_DOORS: ReadonlySet<string> = new Set<string>([
  TOOLS.boomRatios,
  TOOLS.graph,
  /* THE COUNTERPARTY'S OWN BOOK (2026-09-12, golden rule 1). Both are READS and
     both are already the cockpit's own doors for the anchor; what is new is the
     account they are pointed at, and that is the part `connectedPartyBook`
     fences: only an id the ANCHORED graph already connects. The fence is
     re-argued here rather than widened by habit. */
  TOOLS.exposure,
  TOOLS.covenants,
]);

/** The tool names this module builds, in order. The suite pins this list: a
 *  further tool is a design decision, never a drive-by.
 *
 *  `connectedPartyBook` is built ONLY where the room named an account (see
 *  {@link buildBrainTools}), because a downstream read with no anchor to bound
 *  it against is exactly the free wander across the book this module refuses. */
export const BRAIN_TOOL_NAMES = ["currentBoomRatios", "liveInvolvements", "connectedPartyBook"] as const;

export type BrainToolCall = (
  server: string,
  tool: string,
  input: unknown,
  options: { read: true; signal?: AbortSignal },
) => Promise<{ payload: unknown }>;

/** THE ONE GATE, on its own so the suite can point a write door at it directly.
 *  Throws before the connector is touched at all. */
export function assertReadDoor(tool: string): void {
  if (!READ_DOORS.has(tool)) {
    throw new Error(`${tool} is not a read door. Call-outs read; the governed path writes.`);
  }
}

/** Every call a tool makes goes through here. */
async function readDoor(
  call: BrainToolCall,
  server: string,
  tool: string,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  assertReadDoor(tool);
  const res = await call(server, tool, input, { read: true, signal });
  return res.payload;
}

export interface BrainToolsArgs {
  /** The relationship the room is standing in. Both tools are bound to it: the
   *  model never chooses which borrower to read, so it cannot read another. */
  anchor: { accountId: string | null; company: string | null };
  /** What the envelope already carries, so a tool can report itself as an
   *  OVER-CALL when the answer was already in front of the model. */
  reads?: BrainReadBlocks;
  /** Injected for the suite, and so this module never touches a global. */
  call?: BrainToolCall;
}

/**
 * THE TWO TOOLS, BUILT AND BOUND.
 *
 * Neither takes an argument: the relationship is the room's, not the model's,
 * and a tool with no input schema is a tool that cannot be pointed somewhere
 * else. Both return SMALL plain data, because every round re-reads everything
 * so far and a fat result is paid for again on the next round.
 */
export function buildBrainTools(args: BrainToolsArgs): SampleTool[] {
  const call: BrainToolCall = args.call ?? ((server, tool, input, options) => callTool(server, tool, input, options));
  const reads = args.reads;

  const boom: SampleTool = {
    name: "currentBoomRatios",
    description:
      "Current financial ratios (revenue, EBITDA, margin, total leverage, interest coverage) from the latest Boom spread. Use ONLY if the banker asks for figures more recent than the pricing and covenant actuals already in your context, which almost always answer the question for free. Costs the banker 30 to 90 seconds.",
    heldAlready: () => Boolean(reads?.covenants?.length || reads?.pricing?.length),
    execute: async (_input: Record<string, unknown>, context: SampleToolContext) => {
      const company = args.anchor.company;
      if (!company) return "No company is bound to this room, so the Boom door cannot be opened.";
      const payload = await readDoor(call, SERVERS.boom, TOOLS.boomRatios, { company }, context.signal);
      return shapeRatios(payload);
    },
  };

  const involvements: SampleTool = {
    name: "liveInvolvements",
    description:
      "Every party on this relationship RIGHT NOW, with their role: the union of the anchor account's own involvement rows and every row on its loans. Use ONLY when the banker asks whether something has changed since the snapshot, or names a facility your context's involvements block does not cover. The involvements already in your context answer the ordinary question instantly.",
    heldAlready: () => Boolean(reads?.involvements?.length),
    execute: async (_input: Record<string, unknown>, context: SampleToolContext) => {
      const accountId = args.anchor.accountId;
      if (!accountId) return "No account is bound to this room, so the relationship graph cannot be read.";
      const payload = await readDoor(
        call,
        SERVERS.customer360,
        TOOLS.graph,
        { inputs: [{ accountId }] },
        context.signal,
      );
      return shapeInvolvements(payload);
    },
  };

  /* ---------------------------------------------- the counterparty's own book

     RULE 1'S LAST MILE. The envelope's `group` block says WHO stands around this
     borrower: the parent, the affiliates, the owners and what they own. It has
     never said what any of them CARRIES, and `notCarried` refuses it by name
     for the honest reason that no read on this cockpit opens another
     relationship's book. This is that read, and it is the only one.

     THE BOUND IS THE ANCHOR'S OWN GRAPH. The id is checked against the
     connections of the RELATIONSHIP IN VIEW, read live in the same call, before
     a single figure is fetched. A party the graph does not connect is refused BY
     NAME, so this is a downstream step and never a walk across the book. */
  const connected: SampleTool = {
    name: "connectedPartyBook",
    description:
      "The OWN exposure and covenants of ONE counterparty this relationship's graph connects: a guarantor, the parent, an affiliate or an owner. Use ONLY when the banker asks what one of them carries on its own book, which your context's group block never says: that block names who they are, their ownership and their grade, and nothing about their lending. It refuses any party the anchored graph does not connect. Costs the banker 30 to 90 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: {
          type: "string",
          description:
            "The counterpartyId CONTEXT.reads.group carries for that party. Use its name from the same block only where the row carries no id: four parties on one relationship can share a name prefix, and the id never does.",
        },
      },
      required: ["accountId"],
    },
    // NEVER held already: no read on this cockpit carries another party's book,
    // which is why `notCarried` names it. This is the one tool that is never an
    // over-call when the question is actually asked.
    heldAlready: () => false,
    execute: async (input: Record<string, unknown>, context: SampleToolContext) => {
      const anchorId = args.anchor.accountId;
      if (!anchorId) return "No account is bound to this room, so no connected party can be resolved.";
      const asked = typeof input?.accountId === "string" ? input.accountId.trim() : "";
      if (!asked) return "Name the counterparty by the account id or the name CONTEXT.reads.group carries.";

      const graph = await readDoor(call, SERVERS.customer360, TOOLS.graph, { inputs: [{ accountId: anchorId }] }, context.signal);
      const slot = unwrapInvocableOne<{ connections?: Connection[] }>(graph);
      if (!slot.ok) return `The relationship graph could not be read, so nothing can be checked against it: ${slot.error}`;
      const connections = (slot.data.connections ?? []).filter((c) => c.isActive !== false);
      const match = connections.find(
        (c) => c.counterpartyId === asked || (c.counterpartyName ?? "").trim().toLowerCase() === asked.toLowerCase(),
      );
      if (!match) return `${asked} is not connected to this relationship, so its book is not readable from this room.${namesOf(connections)}`;
      if (!match.counterpartyId) {
        return `${match.counterpartyName ?? asked} is connected to this relationship, but the graph carries no account id for them, so no read can be pointed at their book.`;
      }

      const party = match.counterpartyId;
      const [exposure, covenants] = await Promise.all([
        readDoor(call, SERVERS.customer360, TOOLS.exposure, { inputs: [{ accountId: party }] }, context.signal),
        readDoor(call, SERVERS.customer360, TOOLS.covenants, { inputs: [{ accountId: party }] }, context.signal),
      ]);
      return shapeConnectedBook(match, exposure, covenants, reads);
    },
  };

  return args.anchor.accountId ? [boom, involvements, connected] : [boom, involvements];
}

/* ---------------------------------------------------------------- shaping

   SMALL, PLAIN, AND HONEST ABOUT WHAT IS MISSING. A tool that returned the raw
   envelope would spend the banker's next round re-reading it, and a tool that
   silently returned {} would let the model report an empty fact.            */

/** WHO THE ROOM COULD HAVE ASKED FOR, so a refusal is a route and not a wall.
 *  Bounded: a graph with thirty rows must not spend the next round being read
 *  back. */
function namesOf(connections: readonly Connection[]): string {
  const names = [...new Set(connections.map((c) => (c.counterpartyName ?? "").trim()).filter(Boolean))];
  if (!names.length) return "";
  const shown = names.slice(0, 6);
  return ` The graph connects ${shown.join(", ")}${names.length > shown.length ? ` and ${names.length - shown.length} more` : ""}.`;
}

/**
 * ONE COUNTERPARTY'S BOOK, SMALL ENOUGH TO QUOTE.
 *
 * Committed, outstanding, how many facilities, how the covenants stand and the
 * grade this cockpit already carries for them. Formatted through `fmtMoney` and
 * `classifyCovenant`, the same helpers the glass and the envelope print with, so
 * the tool's answer and the group row beside it cannot disagree.
 *
 * THE GRADE IS NOT RE-READ. `reads.group` already carries the party's own grade
 * where the structural signals hold one, so it comes off the envelope rather
 * than off a third door. Absent stays absent.
 */
function shapeConnectedBook(
  match: Connection,
  exposure: unknown,
  covenants: unknown,
  reads: BrainReadBlocks | undefined,
): unknown {
  const name = match.counterpartyName ?? match.counterpartyId ?? "The counterparty";
  const exp = unwrapInvocableOne<{
    totalCommitted?: number;
    totalOutstanding?: number;
    facilities?: Facility[];
  }>(exposure);
  const cov = unwrapInvocableOne<{ covenants?: Covenant[] }>(covenants);
  if (!exp.ok && !cov.ok) return `${name} is connected, but neither their exposure nor their covenants could be read: ${exp.error}`;

  const facilities = exp.ok ? (exp.data.facilities ?? []) : [];
  const rows = cov.ok ? (cov.data.covenants ?? []) : [];
  const verdicts = rows.map((c) => classifyCovenant(c));
  const breached = verdicts.filter((v) => v.severity === "breach").length;

  return {
    party: name,
    relation: (match.role ?? "").trim() || undefined,
    committed: exp.ok && typeof exp.data.totalCommitted === "number" ? fmtMoney(exp.data.totalCommitted) : "not carried on this read",
    outstanding:
      exp.ok && typeof exp.data.totalOutstanding === "number" ? fmtMoney(exp.data.totalOutstanding) : "not carried on this read",
    facilities: exp.ok ? facilities.length : "not carried on this read",
    covenants: !cov.ok
      ? `not carried on this read: ${cov.error}`
      : rows.length
        ? `${rows.length} on file, ${breached ? `${breached} in breach` : "none in breach"}: ${verdicts.map((v) => v.label).join(", ")}`
        : "none on file",
    grade: reads?.group?.find((g) => g.name === match.counterpartyName)?.grade,
    scope: "this counterparty's own book, not the relationship in view",
  };
}

function shapeRatios(payload: unknown): unknown {
  const p = (payload ?? {}) as { ratios?: Record<string, unknown> };
  const ratios = (p.ratios ?? p) as Record<string, unknown>;
  const pick = ["revenue", "ebitda", "ebitdaMargin", "totalLeverage", "interestCoverage"];
  const out: Record<string, unknown> = {};
  for (const key of pick) if (ratios[key] !== undefined && ratios[key] !== null) out[key] = ratios[key];
  if (!Object.keys(out).length) return "The Boom door answered, but it carried no ratio figures.";
  return out;
}

/**
 * ONE ROW PER PARTY PER ROLE, the same shape the envelope's own block carries.
 *
 * The org writes the involvement once per loan: the live read of Hartwell comes
 * back with 22 rows for 5 parties. Handed over raw, the model counts rows and
 * reports "14 guaranty rows" as though it were fourteen obligations, and the
 * live tool would contradict the aggregated block sitting in the same context.
 * Aggregating here is not a correction of the org - the loan ids all travel.
 */
function shapeInvolvements(payload: unknown): unknown {
  const slot = unwrapInvocableOne<{ legalEntities?: LegalEntity[] }>(payload);
  if (!slot.ok) return `The relationship graph could not be read: ${slot.error}`;
  const rows = slot.data.legalEntities ?? [];
  if (!rows.length) return "The relationship graph carries no involvement rows for this account.";
  // Capped, because every round re-reads everything so far and a fat result is
  // paid for again on the next one. The cap now bites on PARTIES, not on rows.
  return aggregateInvolvements(rows)
    .slice(0, 120)
    .map((r) => ({
      name: r.accountName ?? null,
      role: involvementRole(r),
      // No loan id at all is the org's own way of saying relationship level. It
      // is an answer, not a gap, so it travels as one.
      scope: r.loanIds.length ? `${r.loanIds.length} ${r.loanIds.length === 1 ? "facility" : "facilities"}` : "across the relationship",
      loanIds: r.loanIds.length ? r.loanIds : undefined,
      ownership: r.ownershipPercent,
      guaranty: r.guarantyAmountType ?? null,
    }));
}
