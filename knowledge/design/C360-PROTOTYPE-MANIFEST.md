# Commercial Credit 360 — Prototype Manifest
> Hand this to the design/build agent verbatim. Single HTML file, no frameworks, no iframes.

---

## Global rules

| Rule | Value |
|---|---|
| Design system | Accenture Reinvention — light mode. Load Inter from Google Fonts. |
| Purple accent `#6B1CC4` | Sparingly: nav pill, active tab underline, CTA button, key badges only. |
| Semantic palette | Green `#047857` / Amber `#92400E` / Red `#991B1B` — BHI, status, trend. |
| Background | `#F4F3F8` (barely-warm white). Cards `#FFFFFF`, box-shadow only, no borders. |
| Typography | Inter 800 for KPI numbers, 700 for headings, 500 body, 400 detail. `font-variant-numeric: tabular-nums` on all financial figures. |
| Reactive | Every row and card gets a hover state (subtle bg shift). Animated SVG arcs draw in on load. Level transitions slide (CSS transform). Tab switches are instant (no reload). |
| Nav | Sticky frosted glass. Accenture logo PNG (`accenture-logo.png`) → `Reinvention` pill → product name. |
| Illustrative data | Use the Piedmont / Meridian / Norton / Cascade / Hargrove / Apex borrower set throughout. |

---

## Two levels

- **Level 1** — Portfolio home (entry). Clicking any borrower row slides to Level 2.
- **Level 2** — Credit 360 cockpit for that borrower. Back button returns to Level 1.

---

## LEVEL 1 — Portfolio Home

### Nav
`[Accenture logo] | [Reinvention pill] | Commercial Credit 360` · right: `Sarah Chen · Jun 30, 2026` + avatar `SC`

### KPI Strip — 4 cards, full-width grid
| Metric | Value | Detail |
|---|---|---|
| Managed Exposure | $387.5M | Committed · 47 relationships |
| Drawn Balance | $214.8M | 55.4% utilisation |
| EWS Active | **3** (amber) | 2 Watch · 1 Critical |
| Reviews Due (30d) | **8** (amber) | 3 overdue · 5 upcoming |

### EWS Alert Strip — 3 horizontal cards, top-border colored by severity
1. **Meridian Logistics** (red border) — DSCR at 1.28×, 3bps above 1.25× floor. Covenant test in **8 days**. Waiver memo required. · `2h ago`
2. **Piedmont Precision** (amber border) — EBITDA margin compressed 340bps YoY. DSC cushion thinning. · `Yesterday`
3. **Norton Group** (amber border) — Annual review overdue by **14 days**. No extension. $28.5M fully drawn. · `3d ago`

### Main Grid — 2 columns `[1fr] [360px]`

**Left — Work Queue panel**
Ranked rows. Each row: `rank badge | company name + signal text | animated BHI arc | chevron ›`

| # | Company | Signal | BHI | Tier |
|---|---|---|---|---|
| 01 | Meridian Logistics Group | DSCR 3bps above floor — covenant test Thursday | 34 | Critical (red) |
| 02 | Norton Group Holdings | Review 14 days overdue. No extension. Fully drawn. | 51 | Watch (amber) |
| 03 | Piedmont Precision Industries | EBITDA margin −340bps. DSC thinning. $0 wallet. | 58 | Watch (amber) |
| 04 | Cascade Industrial Supply | Revolver 94% utilisation, 60+ consecutive days | 63 | Watch (amber) |
| 05 | Hargrove Manufacturing LLC | Modification expires in 45 days. No extension agreed. | 72 | Healthy (green) |

**Right column — stacked two panels**

*BHI Rail panel* — one row per borrower: `[SVG arc with score] [name + one-line signal] [trend arrow]`

| Company | BHI | Arc | Trend |
|---|---|---|---|
| Apex Renewables | 81 | green | ↑ +4 |
| Hargrove Manufacturing | 76 | green | — 0 |
| Cascade Industrial | 63 | amber | ↓ −7 |
| Piedmont Precision | 58 | amber | ↓ −13 |
| Norton Group | 51 | amber | ↓ −9 |
| Meridian Logistics | 34 | red | ↓ −23 |

*Book Concentration panel* — 5 horizontal bars

| Sector | % |
|---|---|
| Manufacturing | 31% |
| Logistics & Transport | 24% |
| Energy & Renewables | 18% |
| Industrial Supply | 14% |
| Other | 13% |

---

## LEVEL 2 — Credit 360 Cockpit

### Nav (same, back button replaces context)
`[Accenture logo] | [Reinvention pill] | Commercial Credit 360` · `← Portfolio` button · avatar

### Verdict Bar — always visible above tabs
**Left:** breadcrumb → large borrower name → one-sentence verdict → 4 anchor chips  
**Right:** BHI score (large, colored) + label + trend · `Draft Credit Memo →` CTA button (purple)

**Default anchors (Piedmont):**
- Rating: Grade 5 / Pass/Watch
- Committed: $12.5M / $4.25M drawn
- DSC: 1.61× / Floor 1.25× ↓
- Coverage: 1.42× / Collateral

### Tab Bar — 8 tabs
`Overview | Relationships | Exposure & Collateral | Deposits & Treasury | Financials | Risk & Covenants | KYC & Compliance | Opportunities & EWS`

---

### TAB 1 — Overview
**Top row: 6 KPI cards (3×2 grid)**
- Risk Rating: `Grade 5` + `Pass/Watch badge`
- Total Committed: `$12.5M` + `$4.25M drawn · $8.25M available`
- Debt Service Coverage: `1.61×` + `Floor 1.25× · Cushion 0.36× · amber badge ↓ Compressing`
- Revenue (LTM): `$64.5M` + `+3.2% YoY · EBITDA $5.2M`
- Total Leverage: `3.85×` + `Debt/EBITDA · Covenant max 4.5× · green badge`
- Operating Wallet: `$0` (red) + `Est. $4.2M wallet · purple badge Cross-sell opportunity`

**Watch callout (amber):** Key Watch Item — EBITDA margin compressed 11.5% → 8.1% driven by input cost inflation. At current trajectory DSCR reaches the 1.25× floor within two testing cycles.

**NBA callout (purple):** Next Best Action — Piedmont holds zero operating balances against $12.5M credit. Addressable wallet `$4.2M` (large number). A treasury conversation is overdue.

---

### TAB 2 — Relationships
**Two panels side by side or stacked.**

**Panel A: Household & Ownership Tree — pixel-perfect SVG/HTML tree diagram**
Not a text list. Render as a proper top-down tree:
```
┌─────────────────────────────┐
│   Piedmont Holdings Group   │  ← Root / 100% owner [Guarantor badge]
└──────────┬──────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
[R. Piedmont Jr.] [Piedmont Family Trust]
72% beneficial    28% beneficial
[Key Person]
    │
    ▼
[Piedmont Precision Industries LLC]  ← BORROWER (highlighted node)
NAICS 3320 · Manufacturing
```
Nodes are styled boxes. The borrower node has a purple/accent ring. Guarantor and Key Person tags appear as inline chips. Lines are clean SVG paths.

**Panel B: Decision Ledger — vertical timeline**
Each entry: colored dot + date + body text + attributed author.  
- Mar 2026: Rating held Grade 5 P/W. EBITDA watch flagged. Johnson, M.  
- Sep 2025: Revolver increased $8M → $12.5M on contract pipeline. Chen, S.  
- Mar 2025: Grade 5 confirmed. Margin 11.5%. Treasury intro discussed, not progressed. Johnson, M.

---

### TAB 3 — Exposure & Collateral
**Not a stub. Show real data visually.**

**Top: 3 anchor chips** — Committed $12.5M / Drawn $4.25M / Coverage 1.42×

**Panel A: Committed vs Drawn — horizontal stacked bar (facility-level)**
Visual bar showing: `[████ DRAWN $4.25M ████][░░░░░ AVAILABLE $8.25M ░░░░░]` total $12.5M  
Below: single facility row — `Revolver · $12.5M commitment · $4.25M drawn · Rate SOFR+200bps · Maturity Mar 2027`

**Panel B: Collateral Coverage — two-column layout**
Left: `Lendable collateral $6.0M` with breakdown list:
- A/R eligible: $3.2M
- Inventory: $1.8M  
- Equipment: $1.0M

Right: Coverage ratio dial or simple fraction visual — `$6.0M / $4.25M = 1.42×` — green status

**Panel C: Facility Table**
| Facility | Type | Commitment | Drawn | Rate | Maturity | Status |
|---|---|---|---|---|---|---|
| LLC_BI__Loan - 001 | Revolver | $12.5M | $4.25M | SOFR+200 | Mar 2027 | Active |

---

### TAB 4 — Deposits & Treasury
**Not a stub. Show the wallet gap as a visual.**

**Panel A: Wallet Gap visual — two vertical bars side by side**
```
[Credit given]    [Deposits held]
$12.5M           $0
████████          (empty / red outline)
```
Label beneath: `Estimated addressable wallet: $4.2M`

**Panel B: Product Penetration grid — 3-col checklist**
| Product | Status |
|---|---|
| Operating Account | ✗ Not held |
| Payroll Processing | ✗ Not held |
| Treasury Management | ✗ Not held |
| Foreign Exchange | ✗ Not held |
| Credit Card | ✗ Not held |
| Trade Finance | ✗ Not held |

**Panel C: NBA callout (purple)**
"Capture the $4.2M operating wallet. First step: introduce treasury team at next credit review."

---

### TAB 5 — Financials
**Not a stub. Show 3 years of financial data as real charts.**

**Panel A: Revenue & EBITDA — 3-year grouped bar/area chart (SVG)**
| Year | Revenue | EBITDA | Margin |
|---|---|---|---|
| FY2022 | $54.2M | $6.5M | 12.0% |
| FY2023 | $59.1M | $6.8M | 11.5% |
| FY2024 | $62.4M | $7.2M | 11.5% |
| LTM | $64.5M | $5.2M | 8.1% ↓ |

Revenue bars + EBITDA line overlay. Margin % in a secondary row. The LTM margin bar/dot should be amber to signal compression.

**Panel B: Leverage & Coverage — 2 mini gauges or bar pairs**
- Total Leverage: `3.85×` vs covenant `4.5×` — bar shows headroom
- Interest Coverage: `2.64×` vs floor `2.0×` — bar shows cushion

**Panel C: Income Statement summary table (LTM vs PY)**
| Line | LTM | FY2024 | Change |
|---|---|---|---|
| Revenue | $64.5M | $62.4M | +3.4% |
| Gross Profit | $16.1M | $17.5M | −8.0% |
| EBITDA | $5.2M | $7.2M | −27.8% ↓ |
| Net Income | $2.8M | $4.1M | −31.7% ↓ |
| Capex | $1.1M | $1.4M | −21.4% |
| Free Cash Flow | $4.1M | $5.8M | −29.3% ↓ |

Negative/worsening rows highlighted amber.

---

### TAB 6 — Risk & Covenants
**Top: 4 anchor chips** — Rating Grade 5 / PD 2.14% / Last Rated Mar 2026 / Migration Stable

**Covenant compliance table — full width, each row has cushion bar**

| Covenant | Actual | Threshold | Cushion | Bar | Trend | Next Test |
|---|---|---|---|---|---|---|
| Debt Service Coverage | 1.61× | ≥ 1.25× | 0.36× | amber 29% | ↓ Compressing | 60 days |
| Total Leverage | 3.85× | ≤ 4.50× | 0.65× | green 58% | → Stable | 60 days |
| Minimum Liquidity | $3.2M | ≥ $1.5M | $1.7M | green 75% | ↑ Improving | Quarterly |
| Capex Limit | $1.1M | ≤ $2.0M | $0.9M | green 62% | → On track | Annual |

Cushion bar: thin 3px bar, filled proportionally, green/amber/red. "Next Test" as a chip/pill.

**Watch box (amber):** "DSCR cushion has compressed from 0.85× (Mar 2025) to 0.36× (LTM). Two more cycles of current trajectory breaches the floor."

---

### TAB 7 — KYC & Compliance
**Two panels.**

**Panel A: UBO / Screening status — checklist layout**
| Check | Status | Last Run |
|---|---|---|
| Beneficial Ownership Verified | ✓ Clear | Jan 2026 |
| OFAC / Sanctions Screening | ✓ Clear | Jan 2026 |
| PEP Screening | ✓ Clear | Jan 2026 |
| Adverse Media | ✓ Clear | Jan 2026 |
| EDD Required | No | — |

Green check icons for clear. Red × for any flag.

**Panel B: UBO List table**
| Name | Role | Ownership | Nationality | Verified |
|---|---|---|---|---|
| R. Piedmont Jr. | Director / UBO | 72% | US | ✓ Jan 2026 |
| Piedmont Family Trust | Owner | 28% | US | ✓ Jan 2026 |

**Status chip at top:** `Cleared to bank` (green) · `Next refresh due Jan 2027`

---

### TAB 8 — Opportunities & EWS
**Three panels.**

**Panel A: NBA Stack — ranked list of opportunities**
1. **Capture operating wallet** · Priority: High · $4.2M addressable · Action: Treasury intro at next review
2. **Revolver renewal** · Priority: Medium · Expires Mar 2027 · Action: Begin renewal conversation Sep 2026
3. **FX hedging** · Priority: Low · Import exposure visible in P&L · Action: Introduce trade finance

Each row: rank number + title + priority badge + estimated value + action chip.

**Panel B: EWS Signal Timeline — vertical event timeline**
Most recent at top, older below. Each entry: date dot + signal name + severity badge + one-line detail.
- Jun 2026: EBITDA Margin Compression · Watch · −340bps YoY, accelerating
- May 2026: DSC Ratio Trend · Watch · 3 consecutive quarters of compression
- Mar 2026: Review flagged margin risk · Informational · Annual review noted watch item

**Panel C: Renewal Clock**
Visual countdown ring or progress arc. "Renewal due Mar 2027 — 9 months prior = Jun 2026 (now). Begin immediately." Arc colored amber since the window is open.

---

## Component inventory (all must be reactive)

| Component | Behavior |
|---|---|
| SVG Arc (BHI) | Draws in on mount (CSS/SVG animation). Green/amber/red by score. Score number centered. |
| Work queue row | Hover: bg shift + chevron slides right 3px |
| BHI rail row | Hover: bg shift |
| Alert pill | Static (no hover needed) |
| Tab bar | Active tab: accent underline + color. Click: instant panel swap. |
| Verdict bar anchors | Static chips, no interaction |
| Draft Credit Memo button | Hover: deepen purple + lift shadow. Click: toast notification. |
| Household tree | Static SVG. Borrower node has subtle pulse ring on load. |
| Stacked bar (exposure) | Drawn segment animates width in on tab open. |
| Bar chart (financials) | Bars animate height in on tab open. |
| Covenant cushion bars | Animate width in on tab open. |
| Level transition | Slide right (v1 → v2) / slide left (v2 → v1). CSS transform, 400ms ease. |
| Toast | Slides up from bottom-right, auto-dismisses after 4s. |

---

## Interaction map

```
Portfolio Home (L1)
  └─ Click work queue row → openC360(key) → Level 2 slides in
  └─ Click BHI rail row → openC360(key) → Level 2 slides in

Level 2 (L2)
  └─ ← Portfolio button → goBack() → Level 1 slides in
  └─ Click tab → showTab(id) → panel swap (no animation needed)
  └─ Draft Credit Memo → toast "Invoking Credit Memo Agent for [name]…"
```

---

## File / asset references

- `accenture-logo.png` — in same folder as the HTML file
- No external dependencies except Google Fonts (Inter)
- No frameworks, no iframes, pure HTML/CSS/JS
- Single file deliverable
