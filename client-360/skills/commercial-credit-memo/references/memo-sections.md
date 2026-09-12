# Memo Section Specification

13 sections in this order. Each section: what it contains, source data, length.

Style rules (apply to all sections): active voice; specific quantities (no "approximately" when a precise figure exists); no marketing language; no exclamation points; no emojis; every figure cites a source.

---

## 1. Cover page

- Acme Bank wordmark logo, top-left
- Title: "Commercial Credit Memo" (22pt, primary)
- Subtitle: memo type ("Annual Review" / "Renewal" / "Interim Review" / "New Money Request")
- Borrower name, legal form, HQ, NAICS
- Loan ID(s), commitment, outstanding
- RM, Credit Officer
- Memo date, period covered
- Classification banner: `INTERNAL — DRAFT, PENDING CREDIT COMMITTEE REVIEW`

**Source**: `Account`, `LLC_BI__Loan__c`, `User`, system date. **Length**: one page.

---

## 2. Executive Summary

Four short paragraphs, lead-with-conclusion:

1. **Recommendation lead** — proposed action, proposed risk rating, change vs. on file
2. **Headline metrics** — Revenue (Q + LTM, YoY), Adj. EBITDA (Q + LTM, margin), Total Leverage, FCCR, Liquidity. Each with prior-period comparison.
3. **Covenant compliance summary** — all green / amber flags named / red flags named and led-with
4. **Key risks and mitigants** — 2-3 short bullets, each pair risk + mitigant

**Source**: synthesizes from all later sections. **Length**: 250-350 words, one page max. Lead with conclusion every paragraph; no hedging.

---

## 3. Loan Request and Use of Proceeds

- Action requested (renewal / amendment / new money / annual review only)
- Facility structure table (each tranche: type, commitment, outstanding, maturity, pricing)
- Use of proceeds
- Origination fees, closing date target, conditions precedent (if applicable)

**Source**: `LLC_BI__Loan__c`, user prompt. **Length**: half to one page. Tabular for facility structure. For amendments, show existing vs. proposed in a 2-column comparison.

---

## 4. Borrower Overview

- **History** — founding, milestones, transformative transactions
- **Ownership** — closely-held / public / sponsor-backed; sponsor name and %
- **Segments** — name, % of revenue, brief description
- **End markets** — concentration by customer industry, with %
- **Geography** — primary states/regions/international
- **Customer concentration** — top customer %, top 10 % (if disclosed)
- **Management** — CEO, CFO, COO; tenure; recent changes
- **Headcount** — total, recent trend

**Source**: `Account` fields, borrower materials, public filings, web research as needed. **Length**: one to two pages. Factual, not promotional. Cite source for non-public claims.

---

## 5. Industry / Macro Analysis

- Industry definition (NAICS code, sub-sector positioning)
- Industry size, growth, cyclicality
- Competitive landscape (fragmented / consolidated; named competitors that appear in peer set)
- Macro indicators table — minimum: Fed Funds, 10Y Treasury, ISM Manufacturing PMI (if industrials), Industrial Production Index (if relevant), CPI/PPI components (if relevant)

**Source**: NAICS from `Account`, FRED via web fetch, EDGAR/industry research, recent peer earnings transcripts. **Length**: half to one page. Connect each macro point to the borrower — generic commentary is dead weight.

---

## 6. Financial Analysis

The longest section. Four subsections:

**6a. Income Statement Analysis** — 3-year trended IS with Q1 + LTM columns. Revenue (total + by segment, YoY%, 3Y CAGR), Gross Profit + Margin, Operating Income + Margin, Adj. EBITDA + Margin (with bridge from reported), Net Income + Margin. Decompose same-store vs. acquisition contribution when M&A occurred.

**6b. Balance Sheet Analysis** — most recent BS with comparable prior period. Working capital position (A/R, inventory, A/P, accrued). Debt schedule (each tranche: outstanding, maturity, pricing, security). Equity structure. Off-balance-sheet items if material.

**6c. Cash Flow Analysis** — 3-year trended CF with Q1 + LTM. OCF with reconciliation to EBITDA. Working capital changes. CapEx (maintenance vs. growth split if disclosed). FCF. Investing and financing activities.

**6d. Ratio Dashboard** — full ratio set per `ratio-definitions.md`. Columns: Q1 2026 / LTM / FY 2025 / FY 2024 / FY 2023 / Peer Median. Color-code against peer median (green/red/neutral).

**Source**: Boom spread (IS, BS, CF, equity), `LLC_BI__Loan__c` debt schedule, public filings for trended history. **Length**: 3-5 pages depending on complexity. Tabular for data, narrative for explanation. Each table has a 2-4 sentence caption naming the key insight.

---

## 7. Peer Comparison

- Peer set: 5-7 public companies, same NAICS, comparable revenue (½× to 3× borrower)
- Per peer: name, ticker, NAICS, revenue (LTM), EBITDA margin, leverage, FCCR
- Median row across peers
- Borrower row, color-coded variance from median
- 1-2 paragraph narrative interpretation
- Note any peer with loose NAICS match or missing data

**Source**: EDGAR (10-K, 10-Q per peer), Boom spread. **Length**: one page (table) + half page narrative.

---

## 8. Collateral Analysis

- Collateral package summary (first/second lien; carve-outs)
- Borrowing base if asset-based (eligible A/R %, eligible inventory %, advance rates, ineligibles)
- Most recent BBC or asset valuation
- LTV if relevant
- Guarantor structure
- Collateral coverage ratio if computable

**Source**: `LLC_BI__Loan__c` collateral fields, credit agreement, recent BBC. **Length**: half to one page. For unsecured facilities, shorter — note unsecured status, summarize negative covenants protecting position.

---

## 9. Covenant Compliance

- Compliance table: Covenant / Test / Trigger / Actual / Cushion / Flag (green/amber/red per `covenant-checks.md`)
- Narrative paragraph for each amber or red flag
- Affirmative covenant status (reporting cadence, insurance, KYC)
- Negative covenant exceptions or waivers requested
- Any prior waivers or amendments

**Source**: `LLC_BI__Loan_Covenant__c`, Boom spread for computed actuals, prior memos for waiver history. **Length**: one page (table) + narrative for amber/red. Green rows speak for themselves; no narrative needed.

---

## 10. Risk Rating

- Proposed rating (Acme Bank 1-9 scale: 1 Pass-Excellent through 9 Loss)
- Comparison to rating on file (no change / upgrade / downgrade)
- Rationale: 4-6 supporting points covering leverage, coverage, liquidity, business profile, sector, ownership/governance
- "Why not one notch better"
- "Why not one notch worse"
- Trigger conditions for downgrade

**Source**: all prior sections; current rating from `LLC_BI__Loan__c`. **Length**: half to one page. The "why not better, why not worse" bracket is essential — a rating without it looks arbitrary.

---

## 11. RM Commentary

Placeholder block (tinted background, italic) for the RM to fill before committee submission. Suggested topics: relationship history, recent management interactions, qualitative read on management, competing bank dialogues, customer references, industry intelligence.

**Source**: RM-authored. **Length**: half to one page when filled.

---

## 12. Recommendation

- Proposed action — exact language ("Recommend renewal of the $X facility on existing terms, with maturity extended to...")
- Proposed risk rating (re-stated from Section 10)
- Conditions for approval (reporting, covenants, fees)
- Discussion items for committee
- Next memo trigger (annual review / earlier if covenant trips / etc.)

**Source**: synthesizes from prior sections. **Length**: half to one page. Crisp, committee-ready. End with "Recommended for committee approval."

---

## 13. Exhibits

- **A — Full Spread**: full Boom-spread IS, BS, CF, equity reconciliation
- **B — Peer Detail**: per-peer financial detail behind the medians
- **C — Covenant Detail**: full covenant test computations with line-item traces
- **D — Source Inventory**: every source document used (email subject + sender, Boom file IDs, Salesforce record IDs, EDGAR accession numbers, FRED series IDs, dates pulled)
- **E — Methodology Notes**: deviations from standard methodology or judgment calls

**Source**: prior sections. **Length**: 3-8 pages depending on complexity. Exhibit D is mandatory for SR 11-7 audit trail.
