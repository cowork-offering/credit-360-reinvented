# Peer Aggregation Methodology

How to build a 5-7 public peer comp set and compute medians. The peer set positions the borrower within its industry — it's not an aspirational "best-in-class" set.

> **Source: the CapIQ/IBIS market-data MCP** (`market_get_peer_medians`, `market_get_peer_detail`,
> `market_get_industry_outlook`) — this **replaces the old EDGAR web-fetch path** (slow, 403-prone,
> unstructured). Until the OOTB MCP lands, the assembler reads `${CLAUDE_PLUGIN_ROOT}/assets/peers_placeholder.json`.
> The MCP returns structured JSON (per-peer + medians); the "fetch from EDGAR / 403 fallback" steps
> below are retained only as historical context and are not the active path.

---

## Step 1 — Identify the borrower's NAICS

From `Account.NAICS_Code__c` (verify field name in sandbox). If primary + secondary listed, use primary unless segment mix says otherwise.

Start at the **6-digit NAICS** (most specific). If fewer than 5 clean public peers exist, broaden to 4-digit. If still insufficient, use 3-digit and flag the loose match.

---

## Step 2 — Build the candidate list

Criteria for inclusion:
1. Files with SEC (10-K and 10-Q)
2. Has the borrower's NAICS as primary business
3. Revenue within roughly **½× to 3× the borrower** (relax to ¼× to 5× if scarce)
4. Not in distress (no bankruptcy, no going-concern qualified opinion, trading active)

Sources for candidates: EDGAR full-text search by NAICS (`https://efts.sec.gov/LATEST/search-index?q=&forms=10-K&naics=<NAICS>`); the borrower's own 10-K Competition section if public; recent peer earnings transcripts; industry research.

---

## Step 3 — Fetch peer financials

For each peer, pull the most recent 10-Q (for current quarter) and most recent 10-K (for trended history).

EDGAR direct fetches frequently return 403 (User-Agent restrictions). Fallbacks:
1. Company IR pages (press releases, earnings tables) — fast but unofficial
2. EDGAR JSON API via authenticated request
3. Yahoo Finance / Stock Titan / Seeking Alpha for headline metrics — lowest trust, never primary source

Always identify the **filing accession number** for each peer for Exhibit D (Source Inventory).

---

## Step 4 — Compute peer ratios

Per peer, compute the same ratio set defined in `ratio-definitions.md` from the most recent 10-Q (LTM) or 10-K (FY). Capture at minimum: Revenue (LTM), Adj. EBITDA (LTM), EBITDA Margin, Total Funded Debt, Net Debt, Total Leverage, Net Leverage, FCCR (or Interest Coverage if FCCR not reported), Current Ratio, Gross Margin, Operating Margin, Revenue YoY.

Skip peers that lack data for a metric — don't include partial peers in that metric's median. Document the skip in Exhibit B.

---

## Step 5 — Compute medians

Per metric, across all peers with valid data: report min, 25th, median, 75th, max. Use **median** (not mean) — credit analysis cares about "typical," and means are skewed by outliers (an $8B peer distorts the mean for a $400M comp).

---

## Step 6 — Compare borrower to peer median

Peer Comparison table format:

| Metric | Min | Q1 | Median | Q3 | Max | **Borrower** | Variance | Flag |

Variance = (Borrower − Median) / Median, as %. Flag green / red / neutral per the convention in `ratio-definitions.md`.

---

## Step 7 — Write the narrative

After the table, 2-3 paragraphs interpreting:
- Where is the borrower above peer median? Why?
- Where below? Why?
- Are differences explained by scale, business model, capital structure, or sector concentration?
- Call out any peer with loose NAICS match or missing data

Explain *why* — not just that the borrower differs from median.

---

## Atlas demo peer roster

For NAICS 423830 (Industrial Machinery & Equipment Merchant Wholesalers):

| Ticker | Name | Revenue (LTM) | Notes |
|---|---|---|---|
| FAST | Fastenal Company | ~$8.0B | Largest, scale benchmark |
| MSM | MSC Industrial Direct | ~$3.8B | Closest pure-play |
| AIT | Applied Industrial Technologies | ~$4.5B | Bearings/power transmission |
| DXPE | DXP Enterprises | ~$2.0B | Closest scale match |
| DSGR | Distribution Solutions Group | ~$1.7B | Roll-up vehicle |
| TRNS | Transcat | ~$280M | Smaller, niche calibration |

Atlas ($420M) sits in the lower third. Note relative size positioning in narrative.

---

## Failure modes

- **Selection bias.** Don't pick peers to make the borrower look favorable. Stay strict on NAICS. If the strict set is unfavorable, that's the narrative.
- **Mixing public with private peers in the median.** Public-only for the published comp set.
- **Outdated peer data.** 10-K from 18+ months ago is not LTM. If most recent 10-Q is 6+ months old, flag staleness.
- **Mean instead of median.** Outliers skew means.
- **Different fiscal year ends.** Note any mismatch — comparing borrower's Q1 calendar to a peer's Q3 fiscal isn't apples-to-apples.
- **Segment-reporting peers treated as pure plays.** If the relevant segment is only 40% of a peer's revenue, the consolidated ratios aren't a clean comp — use segment data if disclosed, otherwise flag the dilution.
