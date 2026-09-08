/* PROBE HARNESS ONLY: THE ORG'S BOOK, AS THE PORTFOLIO READ WOULD ANSWER IT.

   Shared by the lane drive (scenario 10, the live queue) and the look gate (the
   `landing-live` surface), so the two are looking at the same twelve
   relationships and a change to one is a change to both.

   Nothing here ships. */

/* ----------------------------------------------------- the live queue's book

   TWELVE PACKAGED ACCOUNTS, which is a book, not a demo set: the two real
   relationships the snapshot bakes plus ten the org holds and the snapshot has
   never heard of. The signals are deliberately mixed so the ORDER is readable
   off the screen rather than asserted from the inside.

   WHAT THE PORTFOLIO READ CAN AND CANNOT SAY. `covenantsDueSoon` carries an
   account id and an `overdue` flag; `breachedCount` is book-wide and names
   nobody. So a BREACH ranks first only where a staged bundle carries it, and an
   account breaching with no bundle still earns its row here as an overdue or
   due test. Nothing is missed; the loudest word waits for the detail read. */
export const PIEDMONT = "001bb00001DLtRMAA1";
export const HARTWELL = "001bb00001I7FPNAA3";

const LIVE_ACCOUNTS = [
  { accountId: PIEDMONT, name: "Piedmont Precision Components, Inc.", industry: "Manufacturing", tce: 12500000, outstanding: 4250000, riskRating: "5" },
  { accountId: HARTWELL, name: "Hartwell Precision Manufacturing LLC", industry: "Manufacturing", tce: 54000000, outstanding: 31000000, riskRating: "6" },
  { accountId: "001LIVE00000001", name: "Meridian Coastal Logistics", industry: "Transportation", tce: 31000000, outstanding: 19000000, riskRating: "6" },
  { accountId: "001LIVE00000002", name: "Blue Ridge Orthopedic Partners", industry: "Healthcare", tce: 22000000, outstanding: 12000000, riskRating: "5" },
  { accountId: "001LIVE00000003", name: "Sunbelt Hospitality Group", industry: "Hospitality", tce: 18500000, outstanding: 14000000, riskRating: "7" },
  { accountId: "001LIVE00000004", name: "Prairie Ag Holdings", industry: "Agriculture", tce: 16000000, outstanding: 9000000, riskRating: "5" },
  { accountId: "001LIVE00000005", name: "Cascade Software Solutions", industry: "Technology", tce: 14000000, outstanding: 6000000, riskRating: "4" },
  { accountId: "001LIVE00000006", name: "Lakeshore Dental Supply Distributors", industry: "Wholesale", tce: 11000000, outstanding: 7500000, riskRating: "5" },
  { accountId: "001LIVE00000007", name: "Northgate Multifamily Investors", industry: "Real Estate", tce: 9500000, outstanding: 8100000, riskRating: "6" },
  { accountId: "001LIVE00000008", name: "Ridgeline Metal Fabricators", industry: "Manufacturing", tce: 7200000, outstanding: 3100000, riskRating: "4" },
  { accountId: "001LIVE00000009", name: "Harbor Point Marine Services", industry: "Marine", tce: 5400000, outstanding: 2200000, riskRating: "5" },
  { accountId: "001LIVE00000010", name: "Cedar Grove Property Trust", industry: "Real Estate", tce: 4100000, outstanding: 1900000, riskRating: "4" },
];

/** The book's clock is the SNAPSHOT's (`meta.generatedAt`, 2026-07-25), which is
 *  what every day count on the page measures against. These dates are written
 *  around it on purpose. */
export const LIVE_PORTFOLIO = {
  accounts: LIVE_ACCOUNTS,
  bookTotals: { totalCommitted: 205200000, totalOutstanding: 118050000, accountCount: 12, utilizationPct: 57.5 },
  signals: {
    breachedCount: 2,
    covenantsDueSoon: [
      // Two already past due, and the org says so.
      { accountId: "001LIVE00000003", accountName: "Sunbelt Hospitality Group", covenantType: "Debt Service Coverage Ratio", nextEvaluationDate: "2026-07-02", daysUntilNextEvaluation: -23, overdue: true },
      { accountId: PIEDMONT, accountName: "Piedmont Precision Components, Inc.", covenantType: "Minimum Liquidity", nextEvaluationDate: "2026-07-11", daysUntilNextEvaluation: -14, overdue: true },
      // Three merely due inside the org's own window.
      { accountId: "001LIVE00000001", accountName: "Meridian Coastal Logistics", covenantType: "Fixed Charge Coverage", nextEvaluationDate: "2026-09-30", daysUntilNextEvaluation: 67, overdue: false },
      { accountId: "001LIVE00000002", accountName: "Blue Ridge Orthopedic Partners", covenantType: "Maximum Leverage", nextEvaluationDate: "2026-10-05", daysUntilNextEvaluation: 72, overdue: false },
      { accountId: HARTWELL, accountName: "Hartwell Precision Manufacturing LLC", covenantType: "Minimum Liquidity", nextEvaluationDate: "2026-10-12", daysUntilNextEvaluation: 79, overdue: false },
    ],
    maturitiesSoon: [
      { loanId: "a1XLIVE0000004", loanName: "Prairie Ag Term Loan", accountId: "001LIVE00000004", accountName: "Prairie Ag Holdings", maturityDate: "2026-09-20", daysUntilMaturity: 57 },
      { loanId: "a1XLIVE0000005", loanName: "Cascade Revolver", accountId: "001LIVE00000005", accountName: "Cascade Software Solutions", maturityDate: "2026-10-18", daysUntilMaturity: 85 },
    ],
  },
};
