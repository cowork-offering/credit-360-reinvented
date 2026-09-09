# Credit 360 Cockpit — Capability Map (Accenture blueprint aligned, 2026-06-28, Fabian)

The confirmed focus: a **commercial credit** relationship cockpit whose spine is the credit lifecycle
(originate then maintain/monitor), with **KYC, collateral monitoring, and covenant monitoring first-class**,
and deposits/wallet + portfolio + profitability as supporting relationship context. Aligned to the Accenture
commercial-lending functional blueprint (the canonical 6-stage lifecycle, `preview-site/truist-brain/index.html?view=functional`).

## The blueprint lifecycle (canonical, from the functional blueprint STAGES)
"The recognized lifecycle of commercial lending, from first lead to a live, monitored facility. Six stages."

| # | Stage (system) | Sub-capabilities |
|---|---|---|
| 01 | **Prospecting** (Salesforce) | Lead identification · Clustering & scanning · RM assignment · Pipeline & opportunity · Batch-rating |
| 02 | **Sales** (nCino) | Onboarding · Application preparation · **Pre-scoring & KYC** · Mandates |
| 03 | **Credit Analysis** (Boom · Credit Memo) **[BUILT]** | **Financial spreading** · **Collateral estimation** · **KYC & due diligence** · CA preparation |
| 04 | **Approval** | Agreement drafting · Pricing & terms · **Covenants finalization** · Approval decision · Signatures |
| 05 | **Offering & Set-up** (Core banking) | Drawdown · Account & limit set-up · **Covenant tracking** · **Collateral valuation** · Documentation |
| 06 | **Servicing & Monitoring** (Early Warning) | Portfolio monitoring · EWS · **Covenant monitoring** · Limit & exposure · Collections & recoveries · Regulatory reporting |

Rollout: the brain proves on **Credit Analysis** (the memo) first; Approval, Offering & Set-up, and Servicing
& Monitoring come online around it in governed phases; eventually the whole blueprint sits on one brain.

## How the cockpit relates to the blueprint
The Credit 360 cockpit is the **relationship-level surface that spans all six stages**; the deal-level credit
memo is the deep-dive on stages 03 to 04. Both sit on one nCino Product Package spine, Boom is the shared
spreading system of record. The cockpit concludes per stage and per persona, drills to source, and lets the
human act inside their lane.

## Capability map: blueprint stage to cockpit capability

| Stage | Cockpit capability / section | Data anchors (verified) | Owning persona(s) |
|---|---|---|---|
| 01 Prospecting | Whitespace / pipeline + Book / Work-Queue + batch context | `Opportunity`, `Account`, `cm_Portfolio_Manager__c`, `LLC_BI__Product_Package__c` (prospect) | RM, PM/Exec (batch) |
| 02 Sales | **KYC & compliance** (pre-scoring/KYC) + entity & ownership + application exposure | `KYC__c`, `Compliance_Check__c`, `LLC_BI__Connection__c` (beneficial owner), `Opportunity`→Package | RM, Analyst |
| 03 Credit Analysis **[BUILT]** | **Financial spread** (Boom) + **collateral assessment** + **KYC & DD** + risk/exposure → seeds the memo | `boom_get_spread`/`boom_get_ratios`, `LLC_BI__Loan_Collateral2__c`, `KYC__c`, `LLC_BI__Covenant2__c`, `deal_covenant_grade` | Analyst (owns), PM, Officer |
| 04 Approval | **Authority / routing** + approval + covenant-package finalization + risk verdict | `ncino_approve_package`, `LLC_BI__Covenant2__c`, delegated-authority model | Credit Officer (decision), Analyst (drafting) |
| 05 Offering & Set-up | **Boarding reconcile** + limit set-up + **covenant tracking starts** + **collateral valuation** + documentation | `create_workpackage`, `reserve_obligation_number`, `LLC_BI__Loan_Collateral2__c`/`Collateral_Valuation__c`, `LLC_BI__Covenant2__c` | Loan Ops |
| 06 Servicing & Monitoring | **Work Queue / Tickler** + **EWS** + **covenant monitoring** + **collateral monitoring** + **portfolio roll-up** + limit & exposure + **exam/QC pack** | `LLC_BI__Covenant2__c`/`Covenant_Compliance2__c`, `Collateral_Valuation__c`, AFS `revolver_utilization`/`payment_history`, `LLC_BI__Relationship_Risk_Review__c` | PM, RM, Exec, Loan Ops |

## The three through-lines (Fabian's first-class capabilities)
- **KYC**: stages 02 (Pre-scoring & KYC) + 03 (KYC & due diligence) for origination clearance, + 06 periodic
  refresh / sanctions re-screen. Cockpit reads `KYC__c` / `Compliance_Check__c` + beneficial ownership from
  `LLC_BI__Connection__c` (Piedmont: Margaret Holloway 100%) + OFAC / adverse media. Verify live data on build;
  if empty, conclude "unverified, blocks decisioning," never fake clearance.
- **Collateral**: stage 03 estimation → 05 valuation → 06 monitoring. From `LLC_BI__Loan_Collateral2__c`
  (advance rate, lendable value, lien, abundance-of-caution) + `LLC_BI__Collateral_Valuation__c` (revaluation
  date). Maintenance value = revaluation-due, advance/lendable drift, insurance/UCC/flood expiry, coverage erosion.
  Piedmont: 5 pledges, 80% advance, 1st lien, lendable to ~$10M.
- **Covenant**: stage 04 finalization → 05 tracking → 06 monitoring. From `LLC_BI__Covenant2__c` (threshold
  `Financial_Indicator_Value__c`, actual `Last_Evaluation_Value__c`, status, `Frequency__c`, next-eval-date) +
  `Covenant_Compliance2__c` history, deterministic `deal_covenant_grade`. Maintenance value = next-test ticklers,
  cushion, breach-trending before the test date. Piedmont: 4 covenants all Compliant, DSC 1.42x/1.25x thinnest.

## The 7 role-research gaps, placed in the lifecycle (all to fold in)
1. **Work Queue / Tickler** → stage 06 (and 05): the maintenance home screen (covenant tests, reviews, collateral revals, KYC refresh, UCC/insurance expiry due/overdue).
2. **Portfolio roll-up tier** → stage 06: book-level concentration vs limit, grade migration, aggregated deterioration; drills into the single-customer 360.
3. **Authority / routing model** → stage 04: required-approval-level vs acting-officer limit, approve-within-authority vs route-to-committee, server-enforced.
4. **Boarding reconcile** → stage 05: approved-package terms vs booked-to-core, mismatch-flagged, handoff gated on conditions.
5. **Event / trigger feed** → cross-stage (01 pipeline, 05 booking, 06 EWS): fires on package book/close/renewal, drives timing of cross-sell + monitoring.
6. **Exam / QC provenance pack** → stage 06 (Regulatory reporting): exportable examiner-ready audit + Boom→Snowflake→nCino lineage, AI-proposed vs human-attested.
7. **Persona-scoped FLS + partial-view marker** → cross-cutting: field-level scoping + "N entities not visible to you" honesty, named as a primitive.

## Supporting relationship context (not the spine, but present)
Deposits / treasury share-of-wallet + cross-sell (the $0-wallet NBA), entity & ownership graph, profitability.
These ride the relationship across all stages; they are the growth lens for RM/TMO, secondary to the credit spine.

## Build priority (mirrors the blueprint rollout)
Build the **Credit Analysis (03)** relationship deep-dive and the **Servicing & Monitoring (06)** capabilities
first, on the RM-and-PM-on-Piedmont slice, because that is where the cockpit's relationship value and the real
Piedmont data both concentrate (exposure, collateral, covenants, risk, the wallet gap, the watch item). The
Approval (04) and Offering & Set-up (05) write paths phase in next, as in the blueprint.
