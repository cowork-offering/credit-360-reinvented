# Conditionality Engine

How the memo decides which modules render. This is the "80+ templates → 1" mechanism: a single
`module-manifest.json` evaluated against a **deal-context flag set** produces an ordered **render
plan**. The agent never authors-then-deletes sections — suppression is declarative and auditable
(SR 11-7: every module traces to a predicate + flag).

## Step 1 — Derive the flag set (from nCino, before any rendering)

Build the flag object from the Product Package + loans pulled via the Salesforce/nCino MCP. Each
flag is computable from the system of record:

| Flag | Derivation |
|---|---|
| `credit_event` | The credit-action type on the Product Package: `annual_review` / `existing_nonmaterial` / `existing_material` / `new_relationship`. |
| `tier` | `enhanced` if ANY of: `is_syndicated`, `is_peg`, `is_lft`, `is_public`, or `exposure_total` > $250M; else `core`. |
| `has_new_money` | Any loan in the package is new money (new facility or `New_Money__c > 0`). |
| `has_revolver` | Any loan is a Revolving Line of Credit. |
| `has_revolver_increase` | A revolver's proposed commitment > existing commitment. |
| `has_guarantor` | ≥1 guarantor record. `guarantor_types` = distinct types (corporate/personal/parent). |
| `has_financial_covenants` | ≥1 active covenant of type Financial. |
| `collateral_types` | Distinct collateral types: `blanket_lien`, `specific_ucc`, `equipment`, `real_estate`, `unsecured`. |
| `has_real_estate` | `'real_estate'` in `collateral_types`. |
| `has_deposits` | A deposit/DDA relationship exists (nCino or AFS). |
| `is_syndicated` / `is_peg` / `is_lft` / `is_public` | From package/account flags. |
| `segment` | C&I / CRE / Dealer / Muni / NFP / etc. |
| `exposure_total` | Sum of proposed loan commitments. |
| `sbe_threshold_breached` | Single-Borrower-Exposure check. |
| `has_retained_earnings_adj` | An AFS-flagged material retained-earnings adjustment exists. |

For the demo the flag set is derived from the bundled nCino snapshot (`${CLAUDE_PLUGIN_ROOT}/assets/ncino-demo-data.json`); in production it is derived live from nCino.

## Step 2 — Evaluate `renderWhen`

Predicate grammar (see manifest `predicateGrammar`):
- `"always"` → true
- `"flag"` → flag is truthy · `"!flag"` → falsy
- `"flag==value"` / `"flag!=value"` → equality (used for `credit_event`, `tier`, `segment`)
- `"arrayFlag includes 'x'"` → membership
- array of clauses → AND · `{"any":[...]}` → OR

A module renders iff its `renderWhen` is true. Components inherit the parent result, then apply their own `renderWhen`. A module whose every component is false AND has no own body is dropped.

## Step 3 — Emit the render plan

Sort surviving modules by `order`; generate the Table of Contents from the survivors (never hand-listed). Suppressed modules emit a visible HTML comment in the output: `<!-- SUPPRESSED: <module> (<reason flag>) -->` — a deliberate technical-audience touch that shows the engine is reasoning, not omitting silently.

**Suppressed ≠ gap.** A module suppressed by *flag* (e.g. Real Estate collateral when `has_real_estate=false`) emits nothing but the comment. A module that should render but whose *data is missing* renders with `[not in source system; flagged for RM]` — that is a gap, surfaced, never fabricated.

> Reference implementation: `test/build-memo.mjs` implements Steps 1–3 exactly (predicate evaluator + resolver + renderer). The orchestrator runs the same renderer. Run it to see the resolved plan for any flag set: `node test/build-memo.mjs --flags has_deposits=true,is_syndicated=true`.

## Resolved plan for the Piedmont demo (Existing-Relationship Material, 2-loan package)

**Updated 2026-08-21** for the genericized-template restructure (14 approved items — see
`module-manifest.json`'s `_CHANGELOG_2026-08-21`): the former Trend Reporting, Financial
Model/Sensitivity, and Global Cash Flow modules no longer exist as standalone modules — their
content lives inside Covenant and Conditions, Risk Rating (internal), and Financial Analysis (see
those modules' `_note` fields in the manifest). The walkthrough below reflects the current manifest.

Piedmont Precision Components — Working Capital Line ($7.5M, secured renewal) + Equipment Term Loan
($5.0M, new money).

Flag set: `credit_event=existing_material`, `tier=core`, `has_new_money=true`, `has_revolver=true`, `has_revolver_increase=true`, `has_guarantor=true` (individual), `has_financial_covenants=true`, `collateral_types=[blanket_lien, equipment]`, `has_real_estate=false`, `has_deposits=false`, `is_syndicated=false`, `is_peg=false`, `is_lft=false`.

**RENDER (16 ON):** Relationship Name/TBE · Table of Contents · Executive Summary [existing exposure, proposed exposure, change in exposure, credit approval summary, compliance & due diligence, commentary] · Credit Request / Transaction Overview [purpose, sources & uses] · Collateral [blanket lien, equipment] · Covenant and Conditions [covenant compliance table, conditions & monitoring] · Borrower/Company Profile [general summary, strengths/risks/mitigants, key changes, csg feedback] · Management Ownership & Overview [overview, key changes] · Industry & Peer Analysis [market outlook, industry changes, peer comparison] · Risk Rating (internal) · Financial Analysis [key metrics table, spreading trends, **revolver usage trend**, sensitivity analysis, cash flow analysis] · Guarantor Profile · Risk and Mitigants · Due Diligence Summary · Account Summary and Credit Recommendation · Appendix.

**SUPPRESS (15 OFF) — the proof the engine works:**
- Financial Analysis → Current Balance Trend — `has_deposits=false`
- Collateral → Real Estate (`has_real_estate=false`), Specific UCC & Unsecured (not in `collateral_types`)
- Executive Summary → Global Exposure / SBE Inclusion / Tall Tree-ratings (`tier==core`); PEG exposure (`is_peg=false`)
- Credit Request / Transaction Overview → Capitalization Table (`tier==core`)
- Due Diligence Summary → Public Debt Ratings (private borrower) · Real Estate Taxes (`has_real_estate=false`)
- Adjustment to Retained Earnings (`has_retained_earnings_adj=false`)
- PEG Assessment (`is_peg=false`) · Leveraged Finance EV Memo (`is_lft=false`) · Syndications (`is_syndicated=false`)

Note: Industry & Peer Analysis's `peer_comparison` component now renders `always` (it was the
`key_peer_comparison` component of the retired Trend Reporting module, previously `tier==enhanced`
and `priority: low`) — the genericized template treats peer comparison as standard content for
every deal, not an enhanced-tier extra.

**Demo proof:** flip flags and watch the memo change. Default resolves to **16 ON / 15 suppressed**;
`--flags has_deposits=true,is_syndicated=true,is_peg=true` brings back Current Balance Trend
(Financial Analysis), adds the Syndications module, and promotes `tier` to enhanced (adding Global
Exposure, SBE, Tall Tree, Capitalization Table), plus PEG Assessment and PEG exposure from
`is_peg=true`. Same manifest, different memo.
