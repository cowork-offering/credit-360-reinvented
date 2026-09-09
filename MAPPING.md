# Credit 360 Artifact — Data Mapping Contract (v1, 2026-07-02)

**This file is the build contract.** The artifact is the reference mockup
(`/opt/connectry/Accenture & Truist/Commercial Credit 360.dc.html`) rewired from hardcoded data to a
live-injected `window.C360_DATA` object. The agent (not the artifact) fetches all data — Customer360
Salesforce-hosted MCP (per-user OAuth, 7 tools) + Boom MCP — and bakes the JSON in at render/update.
No fetch() in the artifact. Interactivity: `window.sendPrompt(...)` → agent re-fetches →
`update_artifact` (full HTML replace).

Decisions locked by Fabian 2026-07-02:
1. **L1 Portfolio Home = slim live** — as of 2026-07-02 served by ONE `Customer360Portfolio` call
   (was SearchAccounts + Snapshot loop). BHI/work-queue dropped; reviews-due + EWS cells now HAVE a
   source (the `signals` block) — template wiring pending.
2. **Boom MCP wired in** for the Financials tab
3. **Honest gap states** — never render unsourced numbers; "not in source system" chips; where the org's
   truth IS the story (Piedmont $0 deposits) show the real zero with provenance.

---

## 1. The injected data contract

```js
window.C360_DATA = {
  meta: { user, dateISO, generatedAt, orgAlias: "bankinggpt", anchorAccountId },
  portfolio: {
    // one entry per account from Customer360SearchAccounts, enriched by Customer360Snapshot
    accounts: [{ accountId, name, industry, naicsCode, annualRevenue,
                 tce, tbe, toe, outstanding, riskRating, stage, packageCount }]
    // ribbon totals + concentration computed CLIENT-SIDE from accounts[] (never hand-authored)
  },
  borrower: {   // the anchor account, raw tool responses verbatim (response[0] of each)
    snapshot:      { /* Customer360Snapshot */ },
    graph:         { /* Customer360RelationshipGraph: connections[], legalEntities[], note */ },
    exposure:      { /* Customer360Exposure: totals + facilities[] each with collateral[] */ },
    covenants:     { /* Customer360Covenants: covenants[], note */ },
    opportunities: { /* Customer360Opportunities: opportunities[], note */ },
    signals:       { /* Customer360StructuralSignals: modifications[], modificationClusterFlag,
                        renewals[], maturityWatch[], guarantorSignals[], note */ },
    boom:          { ratios: {/* boom_get_ratios */}, spread: {/* boom_get_spread */} } | null,
    verdict:       "agent-composed banker's sentence (synthesis from live figures, cites nothing invented)",
    anchors:       [{ label, value, sub, dir }]  // agent-composed FROM live figures only
  }
}
```

Rules:
- Tool responses are embedded **verbatim** (field names unchanged) so the artifact renders what the
  server returned — no agent-side re-shaping of figures.
- Dates arrive as ISO strings (`YYYY-MM-DD`). `coverageRatio` can be **null** (≠ 0) — render "—".
- Every tool's `note` field renders as a small provenance caption in its section.
- All display formatting (currency $x.xM, %, day counts, bar widths, arc offsets) is client-side.

## 2. Per-tab mapping (L2 Credit 360)

### Verdict bar (sticky header)
| Element | Source |
|---|---|
| Borrower name / sector breadcrumb | `snapshot.name`, `snapshot.industry`, `snapshot.naicsCode` |
| Verdict sentence | `borrower.verdict` (agent-composed; concludes rating + exposure + watch item + NBA in one banker's sentence) |
| Anchor chips (4) | `borrower.anchors` — composed from: rating (`snapshot.primaryRiskRating`), committed/drawn (`exposure.totalCommitted`/`totalOutstanding`), DSC covenant (actual vs threshold from `covenants`), collateral coverage (`exposure.facilities[].coverageRatio`) |
| **BHI ring gauge** | **GAP — no source. Replace** with risk-rating badge (grade + stage). Never render a BHI number. |
| Draft Credit Memo btn | `sendPrompt("Draft the credit memo for <name> (<accountId>)")` |
| Generate Spreading btn | `sendPrompt("Generate the financial spread for <name>")` |

### Tab 1 — Overview (6 KPI cards + watch banner + NBA card)
| KPI | Source |
|---|---|
| Risk Rating | `snapshot.primaryRiskRating` (value); sub = `snapshot.primaryStage` |
| Total Committed | `exposure.totalCommitted`; sub = drawn `totalOutstanding` · available `totalAvailable` |
| Debt Service Coverage | covenants row where `covenantType` matches DSC: `actualValue` vs `thresholdValue`; cushion = actual − threshold (computed client-side); badge tone from `lastEvaluationStatus`/`breached` |
| Revenue (LTM) | `snapshot.annualRevenue`; sub EBITDA + margin from `boom.ratios` |
| Total Leverage | `boom.ratios` leverage; sub = covenant threshold if a leverage covenant exists in `covenants` |
| Operating Wallet | **Real zero with provenance**: "$0 — no deposit relationship on file" (verified org truth). NO invented wallet size. Cross-sell badge stays. |
| Watch banner | agent-composed ONLY from live signals (e.g. Boom margin trend, covenant cushion); omit if none |
| NBA card | headline from `opportunities.opportunities[0]` + the deposits-zero story; big value = opp `amount` if present |

### Tab 2 — Relationships
| Panel | Source |
|---|---|
| Ownership tree | `graph.connections[]`: counterpartyName, role, ownershipPercent/totalOwnershipPercent, direction. Guarantor chips from `graph.legalEntities[]` (`borrowerType`) |
| Decision Ledger | **GAP v1** — lives in experience-mcp/Snowflake (`recall_decisions`), not wired in this artifact. Render "Decision ledger not wired in this artifact — lives in the deal workspace" chip. |
| KYC caption | `graph.note` verbatim (it carries the "screening not modeled — treat as not-on-file" language) |

### Tab 3 — Exposure & Collateral  *(full live match)*
| Panel | Source |
|---|---|
| Stat strip | `exposure.totalCommitted` / `totalOutstanding` / `totalAvailable`; drawnPct computed |
| Facilities table | `exposure.facilities[]`: name, productType, committed, outstanding, available, interestRate, maturityDate, riskGrade |
| Collateral list | per facility `collateral[]`: collateralType, collateralValue, advanceRate, currentLendableValue, lienPosition, pledgedStatus, isPrimary |
| Coverage dial | facility `coverageRatio` (null → "—"); shortfall flag `coverageShortfall` → red state |
| Caption | `exposure.note` |

### Tab 4 — Deposits & Treasury  *(honest gap tab)*
No backing tool. Render: real headline "No deposit or treasury relationship on file for this borrower
(source: bankinggpt org — 0 Deposit records)" + the cross-sell framing. NO wallet-size number, NO
product-penetration marks. Keep the tab (it carries the Piedmont story), design a proper empty-state.

### Tab 5 — Products & Loans
| Panel | Source |
|---|---|
| Stat strip | facilities count (`exposure.facilities.length`), committed, drawn; packages `snapshot.packageCount` |
| Facilities list w/ bars | `exposure.facilities[]` (outstanding/committed per bar) |
| Product package grid | package rollups from `snapshot` (TCE/TBE/TOE/Outstanding). Bank-product penetration grid = **GAP chip** (deposit products not in source) |

### Tab 6 — Financials  *(Boom-fed)*
| Panel | Source |
|---|---|
| Revenue & EBITDA chart | `boom.spread` periods (FY + LTM revenue, EBITDA, margin) |
| Leverage gauge | `boom.ratios` totalLeverage vs leverage covenant threshold (from `covenants`) if present |
| Interest coverage gauge | `boom.ratios` interestCoverage |
| Income statement table | `boom.spread` line items (LTM vs prior FY, change % computed) |
| Caption | "Source: Boom spreading — <file/date>" |
If `borrower.boom` is null → whole tab renders gap state "Boom spread not fetched this session".

### Tab 7 — Risk & Covenants
| Panel | Source |
|---|---|
| Stat strip | Rating `snapshot.primaryRiskRating`; **PD / Last rated / Migration = GAP chips** (Snowflake owns these; not wired v1) |
| Covenant table | `covenants.covenants[]`: covenantType, thresholdValue, actualValue, lastEvaluationStatus, lastEvaluationDate, nextEvaluationDate, daysUntilNextEvaluation, frequency, breached, covenantStatus. Cushion + cushion-bar % computed client-side (actual vs threshold, direction-aware ≥/≤). **Trend column: omit** (no source). |
| Watch banner | breached rows or thin cushions only; agent-composed; else omit |
| Caption | `covenants.note` |

### Tab 8 — KYC & Compliance
| Panel | Source |
|---|---|
| Status pill | **NEVER "Cleared to bank".** Render "Screening not on file in source org" (per `graph.note`) |
| Screening table | GAP — replace 5-row mock with a single honest empty-state row |
| UBO table | `graph.connections[]` where ownershipPercent > 0: name, role, totalOwnershipPercent; verified column = GAP ("—") |

### Tab 9 — Opportunities & EWS
| Panel | Source |
|---|---|
| Next best actions | `opportunities.opportunities[]`: name, stage, amount, closeDate, probability, ownerName (+ the deposits cross-sell as a standing item) |
| EWS timeline | `signals`: modifications[] (+ `modificationClusterFlag` → escalated severity), renewals[], guarantorSignals[] (riskStatus/highestRiskGrade), breached covenants from `covenants` |
| Renewal clock | `signals.maturityWatch[]`: nearest `daysUntilMaturity`; arc = 1 − days/window (window from request, default 270); text from name + maturityDate |
| Caption | `signals.note` (says covenant/financial/behavioral EWS live elsewhere in the fleet) |

## 3. L1 Portfolio Home (ONE live call — `Customer360Portfolio`)
**Source (2026-07-02): the entire L1 home is served by a single `Customer360Portfolio` call**
(deployed to bankinggpt, Deploy ID 0Afbb00000CremnCAB). It kills the SearchAccounts + N×Snapshot
loop: one response carries `accounts[]` (package-rolled, TCE-desc, truncated to `maxAccounts`),
`bookTotals` (totalCommitted/totalOutstanding/accountCount/utilizationPct), and a bounded book-wide
`signals` block. Request fields (all optional): `industry`, `maxAccounts` (default 25, cap 100),
`signalWindowDays` (default 90). ≤4 SOQL total (live-verified: 3/100).

| Element | Source |
|---|---|
| KPI ribbon (4) | `portfolio.bookTotals`: totalCommitted (Managed Exposure), totalOutstanding (Drawn), utilizationPct, accountCount. Server-computed now (was client-side); still safe to recompute client-side from `accounts[]` as a cross-check. |
| Account list (replaces work queue) | `portfolio.accounts[]` (already sorted tce desc): accountId, name, industry, naicsCode, annualRevenue, tce, tbe, toe, outstanding, riskRating badge, stage, packageCount. Row click → `sendPrompt("Open Credit 360 for <name> (<accountId>)")` → agent fetches → `update_artifact` |
| BHI rail | **dropped** (no source) |
| Book concentration | computed client-side: industry × Σtce from `portfolio.accounts[]` |
| Reviews-due ribbon cell | **NOW AVAILABLE** — `portfolio.signals.covenantsDueSoon[]` (accountId, accountName, covenantType, nextEvaluationDate, daysUntilNextEvaluation, overdue). Capped 25, bounded by `signalWindowDays`. Overdue = past-due but still active (nCino not yet re-evaluated), flagged `overdue:true` with negative day count. (Template wiring is a separate step — not done here.) |
| EWS ribbon cell | **NOW AVAILABLE** — `portfolio.signals.breachedCount` (active + breached across book) + `portfolio.signals.maturitiesSoon[]` (loanId, loanName, accountId, accountName, maturityDate, daysUntilMaturity; capped 25, within window). (Template wiring is a separate step — not done here.) |
| Upcoming reviews rail | previously "dropped v1"; the data now exists via `signals.covenantsDueSoon` + `maturitiesSoon`. Rail rendering is a separate template-wiring step. |

## 4. Fetch sequence (the skill teaches this)
1. **L1 Portfolio Home: one `Customer360Portfolio` call** → `accounts[]` + `bookTotals` + `signals`
   (replaces the old SearchAccounts + per-account Snapshot loop). `Customer360SearchAccounts` stays
   ONLY for name-based lookup ("open Credit 360 for <name>"). `Customer360Snapshot` is now the
   per-anchor detail tool, not the portfolio driver.
3. Anchor account: `Snapshot` + `RelationshipGraph` + `Exposure` + `Covenants` + `Opportunities` + `StructuralSignals` (maturityWindowDays 270)
4. Boom: `boom_get_ratios` + `boom_get_spread` for the borrower
5. Compose `verdict` + `anchors` from live figures only → bake `C360_DATA` → `create_artifact`
6. On `sendPrompt` events: re-fetch only what changed → `update_artifact` (full replace)

## 4b. "Explain this" AI panel (added 2026-07-02, Fabian)
Every major component (each L2 tab section + verdict bar) gets an ⓘ "Explain" affordance opening a
slide-in side panel:
- **Static layer (instant, baked at build):** per-component explainer — what the section shows, how to
  read it, and its data provenance (which tool/object it comes from). No round-trip.
- **AI layer:** 2–3 suggested questions tailored to the component + a free-text input. Submit fires
  `window.sendPrompt(JSON.stringify({type:"explain", component:"<id>", question:"<text>"}))`. The agent
  answers grounded ONLY in the fetched live data (may re-call Customer360/Boom tools for depth), then
  re-renders via update_artifact with the answer appended to the panel thread.
- **State contract:** `C360_DATA.aiPanel = { componentId, thread: [{q, a}] } | null` — injected on every
  render so the open panel + conversation history survive the full-replace re-render. Artifact must
  restore active tab + scroll + open panel from this state on load.
- Constraint: no streaming in-panel; one round-trip per answer. Show a "thinking" state after
  sendPrompt fires (optimistically append the question to the thread client-side).
- Grounding rule: answers cite the live figures/tool provenance; never invent. Same hard rules as §5.

## 5. Hard rules
- No invented figures, ever. A number renders only if it traces to a tool response field.
- Gap ≠ blank: every gap renders its provenance ("not in source system" / "not wired v1 — lives in X").
- Mockup's 8 demo borrowers, BHI, PD values, KYC "Cleared" pills, deposit wallets, decision ledger
  entries, review dates: ALL replaced or gap-stated. Zero survivors from the hardcoded `data{}` block.
- Accenture branding/theme (#6B1CC4, layout, DCLogic engine) is KEPT — that's the reference design.
- Piedmont demo anchor: Account `001bb00001DLtRMAA1`, Package `a5Fbb000000HA1NEAW`, org `bankinggpt`.
