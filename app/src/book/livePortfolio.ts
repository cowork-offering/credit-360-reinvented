import type { C360Data, Id, Portfolio } from "../data/contract";

/* =============================================================================
   THE BOOK THE ORG HAS TODAY, OVER THE BOOK THE SNAPSHOT BAKED.

   One merge point, applied once in the provider, so the queue, the KPI band,
   the palette and every pane read the same accounts. The Portfolio read that
   feeds it is the one the page already makes on open: no second call, no second
   watch, one more consumer of the same result.

   IDENTITY WHEN THERE IS NOTHING TO MERGE. Called on every provider render, so
   an unreachable connector, a refused read and a share link all return the SAME
   OBJECT the provider was given and every memo below sees the reference it
   always did. That is what makes "the read never landed" and "the page before
   this file existed" the same page.

   AND THE SAMPLES GO. Three of the five baked relationships are marked
   `_sample_only` and do not exist in the org. They are there so a cockpit with
   no connector still shows a book; the moment the org answers with its own,
   they are not a second opinion, they are fiction sitting next to fact. The
   read lands, they leave, and nothing else about the page moves.
   ============================================================================= */

/**
 * A cheap structural reading of a portfolio, so an unchanged book does not
 * churn the tree.
 *
 * FOUNDER CONDITION ONE: no latency, no stuck behaviour. The watch re-reads
 * every two minutes and delivers a fresh object each time, whether or not a
 * single figure moved. Swapping the identity of `data` on that timer would
 * invalidate every memo in the app twice an hour for nothing. The book does not
 * move minute to minute; this is how the page knows that.
 */
export function portfolioSignature(p: Portfolio | undefined): string {
  if (!p) return "";
  const rows = (p.accounts ?? [])
    .map((a) => `${a.accountId}|${a.tce ?? ""}|${a.outstanding ?? ""}|${a.riskRating ?? ""}|${a.stage ?? ""}`)
    .join(";");
  const s = p.signals;
  const sig = [
    (s?.covenantsDueSoon ?? []).map((c) => `${c.accountId}|${c.nextEvaluationDate ?? ""}|${c.overdue ?? ""}`).join(","),
    s?.breachedCount ?? "",
    (s?.maturitiesSoon ?? []).map((m) => `${m.accountId}|${m.maturityDate ?? ""}`).join(","),
  ].join("~");
  const t = p.bookTotals;
  return `${rows}#${sig}#${t?.totalCommitted ?? ""}|${t?.totalOutstanding ?? ""}|${t?.accountCount ?? ""}`;
}

/**
 * The cockpit's data, with the org's own book in it.
 *
 * The live portfolio REPLACES the baked one outright rather than being merged
 * row by row: a packaged account the org no longer returns is an account that
 * left the book, and a half-merge would leave it on the queue forever.
 */
export function mergeLivePortfolio(data: C360Data, live: Portfolio | undefined): C360Data {
  if (!live || !(live.accounts?.length ?? 0)) return data;

  const sampleIds = new Set<Id>(
    (data.portfolio?.accounts ?? []).filter((a) => a._sample_only === true).map((a) => a.accountId),
  );

  let borrowers = data.borrowers;
  if (sampleIds.size && borrowers) {
    const kept: Record<Id, typeof borrowers[string]> = {};
    for (const [id, bundle] of Object.entries(borrowers)) if (!sampleIds.has(id)) kept[id] = bundle;
    borrowers = kept;
  }

  /* THE BAKED MEMBERSHIP IS DROPPED, NOT OVERRULED ROW BY ROW. `worklist` is a
     list somebody's assembler wrote in July; with the org's own signals on the
     page there is nothing left for it to say, and leaving it would pin the
     queue to five ids while the book underneath it changed. Derivation takes
     over the moment this is gone. */
  return { ...data, portfolio: live, borrowers, worklist: undefined };
}
