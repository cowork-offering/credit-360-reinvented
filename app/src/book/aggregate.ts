import type { AccountRow, ActionHistoryRow, BorrowerBundle, Id } from "../data/contract";
import { DETAIL_TOOLS, TOOLS, unwrapInvocable, type McpFailure, type McpOk } from "../channel/mcp";
import { readThroughEitherLane, type LaneResult } from "../channel/gateway/lane";
import { fetchActionHistory } from "../channel/cockpitTools";
import { createPacer, LAUNCH_GAP_MS, MAX_IN_FLIGHT } from "../channel/syncSweep";
import type { AccountMatch } from "./search";

/* =============================================================================
   READING A RELATIONSHIP THE SNAPSHOT NEVER BAKED.

   THE SAME EIGHT READS THE SYNC SWEEP RUNS, at the SAME pacing. Two calls in
   flight, spaced by a small gap: the artifact-connector bridge does not like a
   burst and this is the module that already knows it (`createPacer`, exported
   from syncSweep so there is ONE pacing rule rather than two that agree today).

   THE GRAPH IS THE SLOW ONE, and this is honest about it rather than making the
   banker wait for the whole set. `onReady` fires the moment the FAST reads have
   landed, so the room can open on a relationship whose graph is still in
   flight, and `onLand` fires again when it arrives. Nothing is invented for a
   read that has not come back: the slice is simply absent, which every tab in
   this cockpit already renders as an honest gap.

   NOTHING HERE WRITES. Eight reads and a shape. The bundle it builds is exactly
   the shape `artifact/live-data.json` stores under `borrowers.<id>`, so
   everything downstream — the workspace, the workroom's engines, the
   relationship room's reader — stands on it without knowing where it came from.
   ============================================================================= */

/** Bundle keys the six detail tools map onto, in DETAIL_TOOLS order. */
const DETAIL_KEYS = ["snapshot", "graph", "exposure", "covenants", "opportunities", "signals"] as const;

/** The reads a room can open without. The graph is the heaviest and the most
 *  id-dense call in the set, and the one the founder saw fail most often. */
const SLOW = new Set<string>(["graph"]);

export interface AggregateProgress {
  /** How many of the eight have returned, failed or been refused. */
  done: number;
  total: number;
  /** The read that just settled, in banker language. */
  label: string;
}

export interface AggregatedBorrower {
  accountId: Id;
  name: string;
  bundle: BorrowerBundle;
  row: AccountRow;
  /** The org's durable trail, where the tool is in this view. */
  history?: ActionHistoryRow[];
  /** Reads that did not come back. Their slices are absent, never guessed. */
  missing: string[];
}

const LABELS: Record<string, string> = {
  snapshot: "relationship snapshot",
  graph: "relationship graph",
  exposure: "exposure and collateral",
  covenants: "covenant positions",
  opportunities: "open opportunities",
  signals: "structural signals",
  portfolio: "portfolio position",
  history: "actions on record",
};

/** The eight, in the order the console reports them. */
export const READ_KEYS = ["snapshot", "exposure", "covenants", "opportunities", "signals", "portfolio", "history", "graph"] as const;
export const READ_COUNT = READ_KEYS.length;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * THE PACKAGE ANCHOR, DERIVED THE WAY THE FIXTURE SCRIPT DERIVES IT.
 *
 * `scripts/anchor-snapshot-packages.mjs`, exactly: the distinct
 * `productPackageId` over the facilities, and ONLY where there is precisely
 * one. Zero is a relationship with no package on its exposure and more than one
 * is a real ambiguity — both leave the anchor absent, and the rooms then ask
 * rather than standing on a package nobody chose.
 */
export function anchorPackageId(bundle: BorrowerBundle): string | undefined {
  const ids = [...new Set((bundle.exposure?.facilities ?? []).map((f) => f.productPackageId).filter(Boolean))];
  return ids.length === 1 ? (ids[0] as string) : undefined;
}

/** The worklist / palette row for a relationship read live. Figures come from
 *  the snapshot the org just returned, never from the search hit's guess. */
function rowFor(accountId: Id, match: AccountMatch | null, bundle: BorrowerBundle): AccountRow {
  const s = bundle.snapshot ?? { accountId };
  const row: AccountRow = { accountId, name: s.name ?? match?.name ?? accountId };
  const industry = s.industry ?? match?.industry;
  const naicsCode = s.naicsCode ?? match?.naicsCode;
  const revenue = s.annualRevenue ?? match?.annualRevenue;
  if (industry) row.industry = industry;
  if (naicsCode) row.naicsCode = naicsCode;
  if (revenue !== undefined) row.annualRevenue = revenue;
  if (s.totalCreditExposure !== undefined) row.tce = s.totalCreditExposure;
  if (s.totalBorrowerExposure !== undefined) row.tbe = s.totalBorrowerExposure;
  if (s.totalObligorExposure !== undefined) row.toe = s.totalObligorExposure;
  if (s.totalOutstanding !== undefined) row.outstanding = s.totalOutstanding;
  if (s.primaryRiskRating) row.riskRating = s.primaryRiskRating;
  if (s.primaryStage) row.stage = s.primaryStage;
  if (s.packageCount !== undefined) row.packageCount = s.packageCount;
  return row;
}

/** Codes that mean the connector is simply not part of this view. Same rule the
 *  sweep applies: skip silently, never render it as a failure. */
const ABSENT = new Set([
  "server_not_connected",
  "server_not_found",
  "not_in_manifest",
  "not_granted",
  "capability_disabled",
  "capability_removed",
]);
const isAbsent = (e: unknown) => Boolean((e as McpFailure)?.noCapability) || ABSENT.has(String((e as McpFailure)?.code ?? ""));

/**
 * Read one relationship out of the org and build its bundle.
 *
 * @throws the normalized {@link McpFailure} when the SNAPSHOT itself cannot be
 *         read. Every other read is best-effort: a relationship with no
 *         snapshot is not a relationship this cockpit can open, and one with no
 *         opportunities read simply has no opportunities pane.
 */
export async function aggregateBorrower(args: {
  accountId: Id;
  /** The search hit, where the palette had one. Fallback labels only. */
  match?: AccountMatch | null;
  onProgress?: (p: AggregateProgress) => void;
  /** The fast reads have landed; the room may open. */
  onReady?: (partial: AggregatedBorrower) => void;
  /** Test seams. Nothing in the app passes these. */
  sleep?: (ms: number) => Promise<void>;
  launchGapMs?: number;
  maxInFlight?: number;
}): Promise<AggregatedBorrower> {
  const { accountId } = args;
  const sleep = args.sleep ?? wait;
  const pace = createPacer({
    gap: args.launchGapMs ?? LAUNCH_GAP_MS,
    limit: args.maxInFlight ?? MAX_IN_FLIGHT,
    sleep,
  });

  const settled = <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e) => ({ ok: false as const, e }));
  /* EITHER DOOR, with `pace()` outside the fallback exactly as the sweep has
     it: the backup rides the same relay and costs the same budget. */
  const read = (tool: (typeof DETAIL_TOOLS)[number]) =>
    settled(pace(() => readThroughEitherLane(tool, [{ accountId }], { cache: { staleTime: 15_000 } })));

  /* ALL EIGHT ARE LAUNCHED ON THE ONE GESTURE, paced. The order of the array is
     the order the pacer launches them, so the slow graph goes LAST and the six
     the room actually opens on are already coming back while it runs. */
  const details = DETAIL_TOOLS.map((tool, i) => (DETAIL_KEYS[i] === "graph" ? null : read(tool)));
  const portfolio = settled(
    pace(() => readThroughEitherLane(TOOLS.portfolio, [{}], { cache: { staleTime: 15_000 } })),
  );
  const history = settled(pace(() => fetchActionHistory(accountId)));
  const graphIndex = DETAIL_KEYS.indexOf("graph" as (typeof DETAIL_KEYS)[number]);
  const graph = read(DETAIL_TOOLS[graphIndex]);

  const bundle = { snapshot: { accountId } } as BorrowerBundle;
  const missing: string[] = [];
  let done = 0;
  const tick = (key: string) => {
    done += 1;
    args.onProgress?.({ done, total: READ_COUNT, label: LABELS[key] ?? key });
  };

  const land = async (
    key: string,
    call: Promise<{ ok: true; v: LaneResult<McpOk<unknown>> } | { ok: false; e: unknown }>,
  ) => {
    const outcome = await call;
    if (!outcome.ok) {
      // Absent connector and failed read are DIFFERENT facts, and neither is a
      // slice this cockpit may invent. Both leave the key off the bundle.
      if (!isAbsent(outcome.e)) missing.push(key);
      tick(key);
      return;
    }
    const slot = unwrapInvocable(outcome.v.value.payload, 1)[0];
    if (!slot.ok) {
      missing.push(key);
      tick(key);
      return;
    }
    (bundle as unknown as Record<string, unknown>)[key] = slot.data;
    tick(key);
  };

  for (let i = 0; i < DETAIL_KEYS.length; i++) {
    const key = DETAIL_KEYS[i];
    const call = details[i];
    if (!call || SLOW.has(key)) continue;
    await land(key, call);
  }

  // The portfolio read confirms the book around the relationship; nothing is
  // patched from it, exactly as in the sweep.
  await portfolio;
  tick("portfolio");

  const hist = await history;
  const historyRows = hist.ok ? hist.v.rows : undefined;
  tick("history");

  /* THE ACCOUNT ID IS THE ONE FIELD THIS MODULE OWNS. The snapshot read
     replaces the whole slice, and a read that came back without an id would
     leave the bundle unable to say which relationship it is. */
  bundle.snapshot = { ...bundle.snapshot, accountId };

  if (!bundle.snapshot.name && !(bundle.exposure?.facilities ?? []).length) {
    // NO NAME AND NO FACILITY is not a thin read, it is no relationship. An
    // empty envelope from every tool looks exactly like this, which is the case
    // that must never reach a room.
    throw {
      code: "tool_error",
      message: `the org returned nothing for ${accountId}`,
      fix: "That relationship could not be read. Check the account id, or open it from the worklist.",
    } as Partial<McpFailure>;
  }

  const anchor = anchorPackageId(bundle);
  if (anchor && !bundle.snapshot.productPackageId) bundle.snapshot.productPackageId = anchor;

  const partial: AggregatedBorrower = {
    accountId,
    name: bundle.snapshot.name ?? args.match?.name ?? accountId,
    bundle,
    row: rowFor(accountId, args.match ?? null, bundle),
    history: historyRows,
    missing: [...missing, "graph"],
  };
  args.onReady?.(partial);

  /* AND THE GRAPH, WHEN IT LANDS. The room is already open on the six; this
     fills the relationship graph behind it. A graph that never comes back
     leaves the tab saying so, which is what it says for a baked bundle whose
     graph read failed. */
  await land("graph", graph);
  const withGraph: AggregatedBorrower = {
    ...partial,
    bundle,
    row: rowFor(accountId, args.match ?? null, bundle),
    missing,
  };
  return withGraph;
}
