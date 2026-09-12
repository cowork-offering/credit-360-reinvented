# Data Contracts — module → source → field, and the deal-dossier handoff

Two things live here: (1) the **deal dossier** the orchestrator assembles and feeds to the
**renderer** (`assemble-memo.mjs` → `render-memo.mjs`), and (2) the **module → data-source → field
map** that says which MCP/system feeds each module.

> *Note (Phase-3): the renderer was formerly run by a separate `memo-writer` subagent; it is now folded
> into the orchestrator. References to "memo-writer" below mean "the orchestrator running the renderer."
> The data-source-blind discipline is unchanged — the renderer only ever sees the dossier.*

## Sources (the demo's data layer)

| Source | What it owns | How accessed |
|---|---|---|
| **nCino** (Salesforce Hosted MCP, user-level) | System of record: Product Package, loans, terms, pricing, purpose, covenant thresholds, collateral, guarantors, NAICS, ownership, narrative fields | `soqlQuery`, `getRelatedRecords`, etc. |
| **Boom** (`boom-*` MCP) | **Spreading engine** — raw IS/BS/CF line items by `accountCode` | `boom_lookup_company` → `boom_get_spread` / `boom_get_line_items` |
| **AFS** (`afs-mcp` MCP) | Servicing behavior — revolver usage, payment history, loan summary | `revolver_utilization` / `payment_history` / `loan_summary` (+ `afs_show_summary` widget, `create_workpackage` write) |
| **AFS** (placeholder → MCP) | **Analytics layer** — risk-rating trend + PD, covenant actual-vs-required + flags, ratios, sensitivity | reads `${CLAUDE_PLUGIN_ROOT}/assets/ic_placeholder.json`; later the AFS MCP |
| **CapIQ/IBIS** (placeholder → OOTB MCP) | Peer medians + industry outlook (low priority) | reads `${CLAUDE_PLUGIN_ROOT}/assets/peers_placeholder.json`; later the OOTB MCP |

### Boom ↔ AFS rule (one writer per field)
**Boom owns raw line items; AFS owns derived ratios/ratings/covenant grades** (AFS consumes Boom).
Need a statement figure (revenue, EBITDA line, total debt) → **Boom**. Need a ratio, rating, PD, or
covenant pass/fail → **AFS**. Never take a ratio from Boom or a raw line item from AFS.

## Module → source → fields

| Module / component | Source(s) | Fields |
|---|---|---|
| Relationship Name / TBE | nCino | Account.Name, Product Package name, NAICS, RM, Credit Officer |
| Exec Summary → Existing Exposure | nCino | per loan: Facility, Borrower, Purpose, Acme Bank Exposure (existing commitment), Outstanding, Maturity, PRISM rating |
| Exec Summary → Proposed Exposure | nCino | proposed commitment/outstanding/maturity per loan (new TL + increased revolver) |
| Exec Summary → Change in Exposure | derived (nCino) | proposed − existing, per facility + total |
| Exec Summary → Credit Approval Summary | nCino | HRB designation, HVCRE applicability, URE exceptions, past-due financial statements |
| Exec Summary → Compliance & Due Diligence | nCino | CSG feedback complete?, flags? |
| Exec Summary → Global Exposure / SBE / Tall Tree (Enhanced) | nCino + CLG | global exposure rollup, SBE inclusion, ratings/agent (only when tier=enhanced) |
| Request Details → Purpose / Sources & Uses | nCino | Use_of_Proceeds, amounts, fees; S&U built from new-money TL |
| Borrower Description | nCino | History/Ownership/Segments/EndMarkets/Geographic/CustomerConcentration/Management/IndustryContext/Competitive narrative fields |
| Industry Analysis | CapIQ/IBIS (+ nCino NAICS) | industry outlook, drivers, market size, CAGR; mode 'C' for existing |
| Management & Ownership | nCino | Management_Description, Ownership_Description, Contacts |
| Trend → Risk Rating Trends | **AFS** | last 6 events {period, rating, band, pdPct} + proposed |
| Trend → Covenant Compliance Trends | **AFS** (actuals + flags) + nCino (thresholds) | per covenant: trigger, operator, last-6 actuals, perPeriod flags (▲▼/⚠/breach), cushion% |
| Trend → Spreading Trends | **Boom** (line items) + **AFS** (ratios) | revenue/EBITDA/margins from Boom; leverage/FCCR/liquidity trend from AFS |
| Trend → Revolver Usage | **AFS** | 12-mo utilization, high/low/avg, days-at-zero |
| Trend → Payment History | **AFS** | buckets 30-60/60-90/90+, events |
| Financial Model / Sensitivity | **AFS** | scenarios {name, leverage, fccr, breaches} |
| Financial Commentary | Boom + AFS + nCino | period deltas (Boom), ratio context (AFS), current-event rationale (nCino) |
| Collateral → Blanket Lien / Equipment | nCino | collateral records: type, description, appraised value, lien position, advance rate |
| Guarantor Profile | nCino (+ Boom/AFS if spread) | guarantor name/type/guaranty; corporate → narrative-only |
| Forward Looking / Recommendation | synthesis | proposed action, conditions, next review |

## The deal dossier (orchestrator → memo-writer handoff)

The orchestrator assembles ONE structured object and passes it to `memo-writer`. The writer is
**data-source-blind** — it only sees the dossier, so it can't re-pull or contradict upstream. Every
numeric value is a **cited value**: `{ value, source, record, asOf }` (and `derivedFrom[]` for AFS
ratios). Missing values become `{ value: null, status: "missing" }` → rendered as the gap marker.

```jsonc
{
  "flags": { /* the deal-context flag set */ },
  "renderPlan": [ /* ordered module/component ids from the manifest */ ],
  "borrower": { "name", "naics", "naicsDesc", "segment", "salesforceUrl" },
  "exposure": { "existing":[...loans], "proposed":[...loans], "change":{...} },
  "creditApproval": { "hrb", "hvcre", "ureExceptions", "pastDue", "csgComplete", "csgFlags" },
  "requestDetails": { "purpose", "sourcesAndUses":[...] },
  "borrowerDescription": { "generalSummary", "strengths", "risks", "mitigants", "keyChanges" },
  "industry": { "outlook", "drivers", "marketSize", "cagrPct" },
  "management": { "overview", "keyChanges", "contacts":[...] },
  "trends": {
    "riskRating": { "events":[...], "proposed":{...} },
    "covenants": [ { "name","trigger","operator","unit","perPeriod":[...],"currentFlag","cushionPct" } ],
    "spreading": { "periods":[], "revenue":[], "ebitda":[], "leverage":[], "fccr":[] },
    "revolver": { "months":[], "utilizationPct":[], "high","low","average","daysAtZero" },
    "paymentHistory": { "buckets":{...}, "events":[...] }
  },
  "sensitivity": { "scenarios":[...] },
  "collateral": [ { "type","description","appraisedValue","lienPosition" } ],
  "guarantor": { "type","name","guarantyType","narrative" },
  "recommendation": { "proposedAction", "conditions":[...], "nextReview" },
  "sourceInventory": [ { "system","record","asOf" } ]   // auto-built from all cited values → Exhibit
}
```

The orchestrator only fills dossier keys whose module is in the render plan; the writer renders only
those. Citation policy (carried from the Experience MCP write path): **hyperlink** Account / Product Package / Loan;
**cite by ID inline** for everything else (Boom files, AFS events, junctions).

> The block above is the **logical/cited view** — how each value is sourced and traced. It is *not*
> the literal argument the renderer takes. The renderer's executable contract is below.

## Renderer input contract (what `render/render-memo.mjs` actually consumes)

`memo-writer` does not hand the renderer the normalized object above. It hands it the **source-shaped
bundle** — one key per system, each in that system's native shape — written to a JSON file and passed
as `--dossier`. This is deliberate: the renderer reads straight from the systems of record, so there's
no lossy "normalize then re-expand" step where figures could drift.

```jsonc
{
  "canon": { /* nCino-derived deal facts (atlas.json shape) */
    "borrower":   { "name", "naics", "naicsDesc", "currentRiskRating", ... },
    "loans":      [ { "name","purpose","isNewMoney","isIncrease","riskRating",
                      "existing":{"commitment","outstanding","maturity"},
                      "proposed":{"commitment","outstanding","maturity"} } ],
    "exposureSummary":       { "existing":{...}, "proposed":{...}, "changeInExposure":{...} },
    "creditApprovalSummary": { "hrbDesignation","hvcreApplicable","ureExceptions",
                               "pastDueFinancialStatements","csgFeedbackComplete","csgFlags" },
    "guarantor":  { "name","guarantyType" },
    "creditAction": { "productPackageName","creditEvent","tier","flags":{ /* the flag set */ } }
  },
  "boom":  { "files": { "<fileId>": { "financialStatements":[                 // Boom MCP / boom_get_spread
              { "statementType":"income_statement","lineItems":[
                { "accountCode":"sales_revenue","name":..,"periodValues":{ "FY2023":.., "LTM-Q1-2026":.. } } ] } ] } } },
  "afs":   { "_source", "revolverUsage":{ "commitment","months":[],"utilizationPct":[],
              "highPct","averagePct","lowPct","daysAtZero" },
            "paymentHistory":{ "buckets":{ "d30_60","d60_90","d90_plus" } } },        // AFS MCP
  "ic":  { "_source", "ratios":[{ "period","totalLeverage",.. }],                   // AFS (placeholder→MCP)
            "covenantCompliance":[{ "name","type","unit","operator","trigger",
              "quarters":[],"actuals":[],"perPeriod":[{ "value","flag","arrow" }] }],
            "riskRatingTrend":{ "events":[{ "period","rating","band","pdPct","proposed" }] },
            "sensitivity":{ "scenarios":[{ "name","leverage","fccr","covenantBreaches":[] }] } },
  "peers": { "_source", "industryOutlook":{ "outlook","marketSize","cagrPct","cyclicality" } }, // CapIQ/IBIS
  "flagOverrides": { /* optional — force a flag for a what-if; merged over canon.creditAction.flags */ },
  "attestation": {                              // optional — per-section human-in-the-loop sign-off
    "<moduleId>": { "status": "ai-drafted | approved | edited",
                    "approvedBy", "approvedRole", "approvedDate", "editNote" } }
}
```

### Attestation contract (human-in-the-loop sign-off)

`attestation` is an optional map keyed by **module id** (the manifest `id` / renderer `R.*` key, e.g.
`executive_summary`, `request_details`). Each entry records the reviewer's verification of the
AI-drafted section:

- `status` — `ai-drafted` (default/pending if the key is absent), `approved` (reviewed as-is), or
  `edited` (content was changed, then approved).
- `approvedBy` / `approvedRole` — **from the authenticated session (`getUserInfo`), never free-typed.**
- `approvedDate` — ISO date (`YYYY-MM-DD`).
- `editNote` — short reason, only for `status: edited`.

The renderer prints a per-section badge from this and a cover summary ("N of M reviewed (E edited) ·
P pending"). **Section attestation = preparer/reviewer verification; it is NOT credit-committee
approval** — the cover note and the `DRAFT — PENDING CREDIT COMMITTEE REVIEW` banner stay regardless.
Omit `attestation` entirely and every section renders "AI-drafted · Pending reviewer verification"
(the correct freshly-drafted state). See SKILL.md → "Per-section attestation" for the live-updating
review flow.

Each key maps 1:1 to a data-layer owner: `canon`→nCino, `boom`→Boom MCP, `afs`→AFS MCP, `ic`→AFS,
`peers`→CapIQ/IBIS. The renderer derives the **flag set + render plan** from `canon.creditAction`
(plus any `flagOverrides`), so the agent does **not** pass a `renderPlan` — the engine computes it.
For the offline demo these are exactly the generated fixtures (`seed/generate.mjs`); in the live flow
the orchestrator builds `canon` from nCino SOQL and the other four come straight off their MCPs.

> **Why two shapes?** The cited/normalized view (first block) is the *governance* model — it's how
> `sourceInventory` and per-figure citations are reasoned about. The source-shaped bundle (this block)
> is the *execution* contract `renderMemo` validates. `test/build-memo.mjs` loads the fixtures into
> exactly this bundle and calls the same `renderMemo`, so the contract is continuously exercised.
