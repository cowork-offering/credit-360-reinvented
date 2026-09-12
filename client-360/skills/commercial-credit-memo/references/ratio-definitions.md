# Ratio Definitions

Formulas, inputs, and notes. When a credit agreement defines a ratio differently, the agreement controls — these are the defaults.

Use **covenant EBITDA** (per the credit agreement's add-back menu) when testing covenants. Use **Adjusted EBITDA per the spread** for performance ratios. Note any difference in the EBITDA bridge.

---

## Leverage

### Total Leverage
**Total Funded Debt / LTM Adjusted EBITDA**

Total Funded Debt: Long-Term Debt + Current Portion of LTD + Short-Term Debt + Capital Leases + Subordinated Debt + Seller Notes. *Excludes*: trade payables, accrued expenses, deferred revenue, operating leases (unless credit agreement includes them).

Reference: ≤2.5x low; 2.5-3.5x typical middle-market; 3.5-4.5x elevated/sponsor; >4.5x high.

### Funded Debt / EBITDA
Same as Total Leverage. Some credit agreements distinguish Funded (drawn) from Committed (drawn + undrawn). Verify against agreement.

### Net Leverage
**(Total Funded Debt − Cash) / LTM Adjusted EBITDA**

Some agreements cap netting (e.g., "up to $25M unrestricted cash"). Verify.

### Senior Secured Leverage
**Senior Secured Debt / LTM Adjusted EBITDA**

Senior Secured Debt = Total Funded Debt − Subordinated Debt − Junior Liens − Unsecured Notes − Subordinated Seller Notes. For borrowers with only senior bank debt, equals Total Leverage; for borrowers with sub debt or seller notes, the spread matters.

---

## Coverage

### DSCR
**(LTM EBITDA − CapEx − Cash Taxes) / (LTM Interest + LTM Scheduled Principal)**

Numerator is "Cash Available for Debt Service" (CADS). Some agreements use EBITDA only or subtract maintenance CapEx only — check definition.

Reference: >1.50x comfortable; 1.20-1.50x covenant zone; <1.20x concerning.

### FCCR
**(LTM EBITDA − CapEx − Cash Taxes − Distributions) / (LTM Interest + LTM Scheduled Principal + LTM Rent/Op Lease)**

Adds operating lease/rent to denominator. Broader than DSCR; preferred by many bank covenants.

### Interest Coverage
**LTM EBITDA / LTM Interest Expense**

Sanity check and high-yield benchmark. Reference: >5x very strong; 3-5x comfortable; 2-3x adequate; <2x stretched.

---

## Liquidity

### Current Ratio
**Current Assets / Current Liabilities** — Reference: >1.5x comfortable; 1.0-1.5x adequate; <1.0x WC deficit.

### Quick Ratio (Acid Test)
**(Cash + A/R) / Current Liabilities** — Excludes inventory. For inventory-heavy distributors, compare to peers rather than absolute threshold.

### Liquidity ($)
**Cash + Undrawn Revolver Availability** — What banks usually mean by "liquidity" in a covenant context. For ABL revolvers, availability = `min(commitment, borrowing base) − outstandings`.

---

## Profitability

| Ratio | Formula |
|---|---|
| Gross Margin | Gross Profit / Revenue |
| Operating Margin | Operating Income / Revenue |
| EBITDA Margin | Adj. EBITDA / Revenue |
| Net Margin | Net Income / Revenue |
| ROA | Net Income / Average Total Assets |
| ROE | Net Income / Average Stockholders' Equity |

EBITDA margin is the most-watched margin for credit. Flag any compression >200bps YoY. For sponsor-backed borrowers with thin equity, interpret ROE alongside leverage — high ROE can be financial engineering, not operating performance.

---

## Efficiency

| Ratio | Formula | Note |
|---|---|---|
| DSO | (A/R / Revenue) × Days | B2B distributors typically 45-60 days. Trend matters. |
| DPO | (A/P / COGS) × Days | Extreme DPO can signal supplier strain. |
| DIO | (Inventory / COGS) × Days | Central metric for distributors. Rising = demand softness or mix shift. |
| Cash Conversion Cycle | DSO + DIO − DPO | Days of WC the business funds. Rising CCC consumes cash. |

---

## Growth

| Metric | Formula | Note |
|---|---|---|
| Revenue YoY | (Current Period / Prior Year Period) − 1 | Compare same-period to same-period. **Decompose into same-store, acquisition, divestiture, FX.** |
| Revenue 3-Yr CAGR | (Yr3 / Yr0)^(1/3) − 1 | Smooths single-period volatility. |
| EBITDA YoY | Same formula as Revenue YoY | Track alongside revenue — slower EBITDA = margin compression. |

When the borrower acquired a business mid-period, decompose growth explicitly. Don't let acquired EBITDA roll forward as organic.

---

## Display

Ratio dashboard table: columns are Q1 2026 / LTM / FY 2025 / FY 2024 / FY 2023 / Peer Median. Color-code the borrower's column against peer median:

- **Green**: more favorable than median by ≥10%
- **Red**: less favorable than median by ≥10%
- **Neutral**: within ±10%

For "higher is better" (margins, coverage, liquidity, growth, ROA, ROE) green = above median. For "lower is better" (leverage, DSO, DIO, CCC) green = below median. DPO is context-dependent (not auto-colored).

## Trace

When citing a ratio in the memo, footnote or trace it. Example:

> Total Leverage of 2.64x reflects $128.9M Total Funded Debt¹ over $48.8M LTM Adjusted EBITDA².
>
> ¹ Boom file `bf_xxxxx`, BS: Long-Term Debt + Current Portion of LTD + Subordinated Seller Notes + Revolver Outstanding.
> ² Boom file `bf_xxxxx`, IS, see EBITDA reconciliation in Exhibit A.

Detailed trace lives in Exhibit C; abbreviated form in the body.
