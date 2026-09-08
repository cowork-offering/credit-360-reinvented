import type { AccountRow, BookTotals, C360Data, Id, Portfolio } from "../data/contract";

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

/* =============================================================================
   WHAT COUNTS AS THE BOOK.

   MEASURED IN THE ORG, 2026-09-08 (TEST-PORTFOLIO-DESIGN.md, appendix B). The
   sandbox holds 115 packaged accounts. About 105 of them are legacy demo rows
   left behind by years of other people's demos: Vertex, Horizon, Bright,
   Summit, Quantum, BlueSky, Global, NextGen, Pinnacle, "Test Business
   account". They carry TCE 0, no outstanding and no risk rating, and ancient
   covenants whose next test fell due in 2025. ONE of them, "Bright Logistics",
   also carries a credit stage on one of its ten empty packages; the rule below
   does not admit it, because a stage without a commitment or a grade is not
   a credit relationship.

   WHAT THAT DID TO A PAGE THAT BELIEVED THE READ. `bookTotals` came back at
   354 percent utilisation, $1.09B drawn against $308M committed, because the
   outstanding of a decade of abandoned demos is summed against a committed
   figure that is mostly zero. The 25-row signal block came back full of
   Quantum Partners (fourteen rows) and Cy LTD at 452 days overdue, so the
   seeded relationships' real misses (Blue Ridge at 20 days, Lakeshore at 25)
   never reached the page at all. A banker would have opened the cockpit and
   found the top of their queue occupied by companies that do not exist.

   THE RULE (narrowed by the founder, 2026-09-08: "accurate clients in the
   book"). A relationship is ON THE BOOK when the bank has a credit judgement
   or exposure against it: committed exposure, a drawn balance, or a risk
   rating. A newly approved package with nothing drawn still carries its
   commitment, and a graded relationship between facilities keeps its grade,
   so both stay on the book. A package STAGE on its own is not enough: that is
   what keeps Bright Logistics and its ten empty, unrated packages off the
   landing. Nothing else is on the book: not on the queue, not under "the rest
   of the book", not in the totals, and not named by a signal the page will
   honour.

   IT IS NOT A NAME LIST. Filtering on "Quantum" and "Vertex" would work this
   afternoon and rot the first time somebody seeds a real Summit. The rule is
   about what the org has booked, which is the same question a banker asks.
   ============================================================================= */

/** Does the org have anything booked against this account? */
export function carriesExposure(a: AccountRow): boolean {
  if ((a.tce ?? 0) > 0) return true;
  if ((a.outstanding ?? 0) > 0) return true;
  if (typeof a.riskRating === "string" && a.riskRating.trim() !== "") return true;
  return false;
}

/**
 * The book's own totals, summed from the rows the page is showing.
 *
 * NEVER `bookTotals`, and that is the whole point: the org's rollup spans every
 * packaged account including the 105 that are not a book, and there is no
 * server-side figure that excludes them. Summed here, the four numbers in the
 * KPI band and the rows underneath it are arithmetic on the same list, so they
 * cannot disagree.
 *
 * ONE HONEST LIMIT: the Portfolio read is asked for the highest-TCE 60
 * accounts, so a real book past 60 relationships would sum only what came back.
 * That is the same list the queue and the divider are counted from, so the page
 * stays internally consistent; it is a reason to raise the read's cap, never a
 * reason to reach back for a polluted total.
 */
export function bookTotalsOf(rows: AccountRow[]): BookTotals {
  let committed = 0;
  let outstanding = 0;
  for (const a of rows) {
    committed += a.tce ?? 0;
    outstanding += a.outstanding ?? 0;
  }
  return {
    totalCommitted: committed,
    totalOutstanding: outstanding,
    accountCount: rows.length,
    utilizationPct: committed > 0 ? Math.round((outstanding / committed) * 1000) / 10 : undefined,
  };
}

/**
 * The org's Portfolio read, confined to the book.
 *
 * Rows that carry no exposure are dropped, the totals are re-summed from what
 * is left, and every signal naming an account that is no longer there goes with
 * them. `breachedCount` is the org's own book-wide count and is left alone: it
 * names nobody, so it cannot put a legacy relationship on the queue, and
 * inventing a smaller number here would be a figure the org never stated.
 */
export function confineToBook(p: Portfolio): Portfolio {
  const rows = (p.accounts ?? []).filter(carriesExposure);
  const onBook = new Set<Id>(rows.map((a) => a.accountId));
  const sig = p.signals;
  return {
    ...p,
    accounts: rows,
    bookTotals: bookTotalsOf(rows),
    signals: sig
      ? {
          ...sig,
          covenantsDueSoon: (sig.covenantsDueSoon ?? []).filter((c) => c.accountId && onBook.has(c.accountId)),
          maturitiesSoon: (sig.maturitiesSoon ?? []).filter((m) => m.accountId && onBook.has(m.accountId)),
        }
      : sig,
  };
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

  /* CONFINED BEFORE IT IS BELIEVED. Everything below this line, and every
     consumer downstream of it, sees a book and not a demo graveyard.

     AN EMPTY BOOK IS NOTHING TO MERGE, exactly as an empty read is. An org that
     answers with 115 rows and not one carrying exposure has told the page
     nothing it can put on a queue, and blanking the landing on that is a
     worse answer than the first paint it already had. */
  const confined = confineToBook(live);
  if (!confined.accounts.length) return data;

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
  return { ...data, portfolio: confined, borrowers, worklist: undefined };
}
