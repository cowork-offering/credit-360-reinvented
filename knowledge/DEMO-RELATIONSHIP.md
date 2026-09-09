# The Hartwell Industrial Group: flagship demo relationship

**Org:** `bankinggpt`, `00DDz000001qeO2MAI`, sandbox.
**Built:** 2026-07-26, migration-style, by `fabian.goetzens@accenture.com.bankinggpt` (`005bb00000ftouDAAQ`).
**Status:** PERMANENT. These records are the deliverable. **Nothing here is to be deleted.**

This relationship is the reference C&I borrower for demos, for the Credit 360 cockpit, and for the
standing test dataset. It was modelled field-for-field on Piedmont Precision Components, Inc.
(`001bb00001DLtRMAA1`), which the discovery pass established is the only fully-modelled commercial
borrower in the org. **No existing record was modified at any point.**

---

## The story

Hartwell Industrial Group is a Midwest precision-manufacturing family group, second generation, two
Indiana plants.

- **Hartwell Precision Manufacturing LLC** is the operating company and the primary borrower. Founded
  2001 by James Hartwell. NAICS 332710 (Machine Shops), 340 employees, FY2025 revenue $85.0MM on EBITDA
  of $11.4MM. AS9100D, ISO 9001:2015, ITAR. Aerospace, defence, heavy-truck and medical-device
  programmes. Banking relationship since 2012.
- **Hartwell Industrial Holdings LLC** is the family holding company and the corporate guarantor. No
  independent operations; holds 100% of both operating entities. Consolidated FY2025 revenue $92.4MM.
- **Hartwell Logistics LLC** is the sister company, formed 2014, 22 tractors and 41 trailers out of
  Kokomo. Roughly 78% of its revenue is intercompany freight. It is a **related entity** on the
  construction facility and is neither a borrower nor a guarantor.
- **James Hartwell** (60%) is founder, President and CEO, the control person, unlimited personal
  guarantor. **Elena Hartwell** (40%) is EVP and CFO, limited guarantor on the two largest facilities.

Credit position: **six booked facilities, $46.0MM of commitments against $31.03MM outstanding**, risk
grade 4, secured by a blanket lien on receivables, inventory and equipment plus a first mortgage on both
properties. The live story thread is the **$12MM Kokomo plant expansion**, 61% complete at the June 2026
inspection, and a **Fixed Charge Coverage cushion of 7 bps** which is the thinnest number in the
covenant package.

---

## Discovery decisions taken before any permanent insert

Five questions were settled empirically first. Each decision below is evidence-backed, not preference.

### 1. No `Exclude_Validation` bypass was needed, and none was granted

The founder authorised a migration-mode bypass. **It turned out to be unnecessary and was never used.
The `Exclude_Validation` fence is completely untouched.**

`Loan_Validation_06` keys on `PRIORVALUE`:

```
AND( OR( ISPICKVAL(PRIORVALUE(LLC_BI__Stage__c),'Qualification') || ... 'Final Review')
     && ( ISPICKVAL(LLC_BI__Stage__c,'Processing') || ... 'Booked')
     && $Permission.LLC_BI__Exclude_Validation = FALSE)
```

On an **insert** `PRIORVALUE` of a picklist is blank, so every `ISPICKVAL(PRIORVALUE(...))` is false and
the rule cannot fire. `Loan_Validation_05` is the only rule that bites, and it is satisfied by supplying
a `lookupKey`:

```
AND( ISPICKVAL(LLC_BI__Stage__c,'Booked'), ISBLANK(LLC_BI__lookupKey__c), !$Permission.LLC_BI__Exclude_Validation)
```

Proved on a throwaway loan before touching permanent data: insert at `Booked` **with** a lookupKey
succeeded; the identical insert **without** one returned *"A Loan Number is Required Prior to Changing
the Loan Stage to 'Booked' - LV05"*. Throwaway fixture deleted.

Worth recording: the loan-children discovery agent read these same two rules statically and concluded
they "will block a migration that sets `LLC_BI__Stage__c = 'Booked'` directly." **The empirical test
disproved that.** A static read of a `PRIORVALUE` rule cannot tell you what happens on insert.

### 2. Household: modelled via Connections, NOT a household record

**Decision: no household record was created.** The org's household machinery is installed and
structurally complete but demonstrably unused.

Evidence: all 5 existing Household accounts are test artifacts ("Test", "Household ARC",
"Timothy's Household(C)") with **every FinServ rollup at 0**, no addresses, no descriptions. Only 1 of 8
`FinServ__AccountAccountRelation__c` pairs uses the Household roles. **Zero of 208
`LLC_BI__Connection__c` rows** use `Household` or `Household Member`. `Account.ParentId` is null on all
762 accounts. The org's real, exercised commercial spine is `LLC_BI__Connection__c` plus
`LLC_BI__Legal_Entities__c`, which is exactly what Piedmont uses.

A household would have been a foreign object in that graph. The family is instead expressed through the
connection roles and the shared residential address on the two person accounts.

### 3. lookupKey series

Real booked loans carry `LP###` (181 of 181 booked loans have a key; highest `LP500`); Piedmont uses
`LN####`. The field is `externalId` but **not unique**. Hartwell uses a distinct **`HW100x`** series to
avoid any collision and to be self-identifying.

### 4. Covenant compliance rows: DELIBERATELY NOT CREATED

**Decision (b): covenants built in full, compliance rows skipped.** The approval flow was **not**
deactivated and no metadata was touched.

Three independent reasons, in order of weight:

1. **Piedmont, the model for this build, has ZERO compliance rows.** Verified:
   `SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c WHERE LLC_BI__Covenant__r.LLC_BI__Account__c='001bb00001DLtRMAA1'`
   → **0**. Only 6 accounts org-wide carry any, none of them the flagship. The org convention for a
   reference relationship is to carry the compliance story on the covenant's own
   `LLC_BI__Last_Evaluation_Date__c` / `_Status__c` / `_Value__c` and `Notes` fields. Hartwell does
   exactly that.
2. **Creating one fires a real approval at a real human.** Wave 3 probe 8 proved
   `acnpex_covenantApprovalProcess` is `recordTriggerType: Create` with **zero entry filters**, and its
   `RM_s_Approval` step is a `stepApproval` assigned to `robert.mcclaren@outlook.com`. Unrecallable.
3. **Deactivating the flow would have been worse than the gap it closed.** It is a metadata change in a
   shared sandbox, and during the window *any other user's* compliance record would silently skip the
   chain. That is an unacceptable trade for garnish the reference relationship does not itself have.

The covenants therefore carry full evaluation history in their own fields and read as a complete,
compliant package without a single compliance row.

### 5. Record-type assignment is enforced; picklist scoping is not

Two failures during the build, worth keeping:

- `RecordTypeId` on Collateral was **refused**: `INVALID_CROSS_REFERENCE_KEY: Record Type ID: this ID
  value isn't valid for the user: 012bb000000NNdjAAG`. The running profile has no assignment for the UCC
  or Real Estate collateral record types. **Documented deviation:** the four Hartwell collateral records
  land on `Master`, while Piedmont's sit on `UCC`. Remediation is a one-line profile change plus a
  `RecordTypeId` patch; this build makes no metadata changes, so it was left as-is.
- `Acnpex_Statement_Frequency__c` was **refused** for `Quarterly`:
  `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`. That field is a **restricted** picklist and the Financial
  Ratio record type offers only `Annual` / `Not Annual`. Quarterly covenants therefore carry
  `Not Annual`. This refines wave-5 lesson 15w: **restricted picklists ARE enforced against the record
  type; unrestricted ones are not.**

---

## The id registry

84 records created directly, plus 7 org-generated (6 Loan Details, 7 mirrored Connections). Every id
below was captured at insert and re-verified after the build.

### Accounts (5)

| Key | Id | Name | Record type |
|---|---|---|---|
| `acct_opco` | `001bb00001I7FPNAA3` | Hartwell Precision Manufacturing LLC | Business |
| `acct_holdco` | `001bb00001I7NZkAAN` | Hartwell Industrial Holdings LLC | Business |
| `acct_sister` | `001bb00001I7VCHAA3` | Hartwell Logistics LLC | Business |
| `acct_james` | `001bb00001I7V2cAAF` | James Hartwell | Person Account |
| `acct_elena` | `001bb00001I7BC0AAN` | Elena Hartwell | Person Account |

### Connections (7 inserted, 7 auto-mirrored = 14, `C-00000222` to `C-00000235`)

| Key | Id | From → To | Role | Ownership |
|---|---|---|---|---|
| `conn_hold_jim` | `a38bb000001UxTVAA0` | Holdings → James | Owner | 60% direct |
| `conn_hold_ele` | `a38bb000001UxV7AAK` | Holdings → Elena | Co-Owner | 40% direct |
| `conn_hold_opco` | `a38bb000001UxWjAAK` | Holdings → OpCo | Parent | 100% |
| `conn_hold_sis` | `a38bb000001UxYLAA0` | Holdings → Logistics | Parent | 100% |
| `conn_opco_sis` | `a38bb000001UxZxAAK` | OpCo → Logistics | Affiliated Company | — |
| `conn_opco_jim` | `a38bb000001UxbZAAS` | OpCo → James | Owner | 60% indirect |
| `conn_opco_ele` | `a38bb000001UxdBAAS` | OpCo → Elena | Co-Owner | 40% indirect |

Only the detail-bearing direction was inserted. `LLC_BI.ConnectionTrigger` created every mirror
(`Parent`→`Child`, `Owner`/`Co-Owner`→`Company`, `Affiliated Company`→itself), verified. `LLC_BI__UID__c`
was populated as `FromId+ToId+RoleId` per the org's dedupe convention.

**First use in this org** of the `Parent` and `Affiliated Company` connection roles: 30 of 35 configured
roles had zero rows, including these. Semantically correct and pre-configured, but flagged as new ground.

### Product Package (1)

`a5Fbb000000IHFJEA4` — **Hartwell Industrial C&I Credit Package**. Stage `Complete`, Status `Approved`,
Risk Rating 4, 6 facilities, $46.0MM total / $31.03MM outstanding / $14.97MM unused.

Note: org automation renamed it on insert to `Hartwell Precision Manufacturing LLC - 7/26/2026 - PP`.
It was patched back afterwards; the rename fires only on insert, so the demo name is stable.

### The six facilities — all Booked, Open, lookupKey populated, Commercial record type

| Key | Id | lookupKey | Product | Commitment | Outstanding | Rate | Close | Maturity | Grade |
|---|---|---|---|---|---|---|---|---|---|
| `loan_revolver` | `a4Zbb0000027MaYEAU` | HW1001 | Line of Credit | 15,000,000 | 9,200,000 | 7.60 (SOFR+275) | 2024-03-15 | 2027-03-15 | 4 |
| `loan_equip1` | `a4Zbb0000027MnREAU` | HW1002 | Equipment | 8,000,000 | 5,900,000 | 6.85 fixed | 2023-09-20 | 2030-09-20 | 4 |
| `loan_constr` | `a4Zbb0000027Mp3EAE` | HW1003 | Construction | 12,000,000 | 7,350,000 | 8.10 (SOFR+325) | 2024-11-01 | 2026-11-01 | 5 |
| `loan_purchase` | `a4Zbb0000027MqfEAE` | HW1004 | Purchase | 5,000,000 | 4,420,000 | 6.25 fixed | 2023-05-10 | 2028-05-10 | 4 |
| `loan_equip2` | `a4Zbb0000027MsHEAU` | HW1005 | Equipment | 3,500,000 | 3,010,000 | 7.35 fixed | 2025-02-18 | 2030-02-18 | 4 |
| `loan_seasonal` | `a4Zbb0000027MttEAE` | HW1006 | Line of Credit | 2,500,000 | 1,150,000 | 7.85 (SOFR+300) | 2025-06-30 | 2026-06-30 | 5 |

**Totals verified by aggregate query: 46,000,000 committed / 31,030,000 outstanding across 6 rows**,
matching the package rollup exactly.

### Loan Details (6, org-created, then enriched)

`a4Wbb000001Gm9lEAC`, `a4Wbb000001GmBNEA0`, `a4Wbb000001GmCzEAK`, `a4Wbb000001GmEbEAK`,
`a4Wbb000001GmGDEA0`, `a4Wbb000001GmHpEAK` — one per facility, created by the org's after-commit flow
within ~4 seconds, then patched with `Primary_Loan_Purpose`, `Application_Method` and `Rate_Reference`.
Deliberately kept thin: Piedmont's own Loan Detail carries only two fields, and over-filling would
depart from org convention.

### Entity Involvement (21) — the borrowing structure

Per facility: OpCo as **Borrower** (order 1), Holdings as **Guarantor** (order 2), James as
**Guarantor** (order 3). Plus Elena as **Limited Guarantor** on the two largest, and Logistics as
**Related Entity** on the construction facility.

| Role | Rows | Detail |
|---|---|---|
| Borrower | 6 | OpCo, `Entity_Type = Operating Company`, ownership 100 |
| Guarantor | 12 | Holdings ×6 (`EPC`, Unlimited) and James ×6 (`Individual`, Unlimited, Married) |
| Limited Guarantor | 2 | Elena on HW1001 (limit $5.0MM) and HW1003 (limit $4.0MM) |
| Related Entity | 1 | Logistics on HW1003 |

Ids `a4Lbb000000NJBdEAO` … `a4Lbb000000NJefEAG` (21 rows, keys `inv_00` … `inv_20` in the build
registry).

**Rules honoured:** `LLC_BI__Ownership__c` set to 100 and `LLC_BI__Contingent_Amount__c` never set, since
`Contingent_Amount_and_Contingent_Percent` makes them mutually exclusive (its `Household` escape matches
no active role value). The `LLC_BI__Is_Borrower__c` / `Is_Guarantor__c` family are formulas and were
never written; they derive correctly.

**`Entity_Type` substitution:** the picklist has no `Holding Company` value (only `Operating Company`,
`Sole Proprietorship`, `EPC`, `Individual`). Holdings carries **`EPC`** (Eligible Passive Company), the
closest existing fit. Adding a value would be a metadata change and was not made.

### Covenants (6 + 2 loan junctions)

| Key | Id | Covenant | Threshold | Actual | Frequency | Status |
|---|---|---|---|---|---|---|
| `cov_dscr` | `a3Bbb000000S0UvEAK` | Debt Service Coverage | ≥ 1.25x | **1.38x** | Quarterly | Compliant |
| `cov_dtw` | `a3Bbb000000S0WXEA0` | Debt to Worth | ≤ 3.00x | **2.42x** | Quarterly | Compliant |
| `cov_liq` | `a3Bbb000000S0Y9EAK` | Minimum Liquidity | ≥ $5.0MM | **$6.8MM** | Quarterly | Compliant |
| `cov_fccr` | `a3Bbb000000S0ZlEAK` | Fixed Charge Coverage | ≥ 1.15x | **1.22x** | Quarterly | Compliant (7 bps cushion) |
| `cov_bbc` | `a3Bbb000000S0bNEAS` | Borrowing base certificate | 80% AR / 50% inv | compliant | Monthly | Compliant |
| `cov_completion` | `a3Bbb000000S0czEAC` | Kokomo completion | 2026-11-01 | 61% complete | One-Off | In Progress |

Junctions: `cov_bbc_junction` `a4Vbb000000pNIjEAM` (→ HW1001), `cov_completion_junction`
`a4Vbb000000pNKLEA2` (→ HW1003).

Each carries the full Piedmont field surface: `Acnpex_Clause__c` (real credit-agreement prose),
`Acnpex_Description__c`, `Acnpex_Operator__c`, `Acnpex_Threshold_Value__c`, `Calculation_Logic__c`,
`LLC_BI__Detail__c`, `LLC_BI__Notes__c` (analyst narrative with the actual figures),
`LLC_BI__Last_Evaluation_*`, `LLC_BI__Next_Evaluation_Date__c`, `Grace_Days`, `Compliance_Days_Prior`,
`Document_Source`.

**Covenant type substitutions** (no exact config row exists; the meaning is carried in the text fields):
Fixed Charge Coverage → `Debt Service Coverage with and without Distributions`; borrowing base →
`Accounts Receivable`; completion → `Term Covenants`. DSCR, Debt-to-Worth and Minimum Liquidity are exact
matches. **No new Covenant Type config rows were created.**

**`LLC_BI__Effective_Date__c` was set at creation** and must never be updated afterwards: PDI-00023403
says updating it corrupts the whole compliance schedule. Setting it once on a new covenant is what every
real row does; the standing prohibition is about updates.

### Collateral (4), valuations (8), aggregates (6), pledges (7), liens (4)

| Key | Id | Collateral | Value | Advance | Lendable |
|---|---|---|---|---|---|
| `col_ar` | `a35bb0000013xz3AAA` | Eligible Accounts Receivable | 12,000,000 | 80% | 9,600,000 |
| `col_inv` | `a35bb0000013y0fAAA` | Inventory (RM, WIP, FG) | 8,000,000 | 50% | 4,000,000 |
| `col_equip` | `a35bb0000013y2HAAQ` | Equipment fleet | 10,000,000 | 75% | 7,500,000 |
| `col_re` | `a35bb0000013y3tAAA` | Fort Wayne campus + Kokomo plant | 14,000,000 | 75% | 10,500,000 |

**Existing org collateral types were reused; no new config was created.** All 43 org types default to an
80% advance rate, so three pledges carry `LLC_BI__Advance_Rate_Override__c` with a written
`LLC_BI__Override_Reason__c`, satisfying the `Advance_Rate_Override` rule.

**Pledges** (`a4Rbb0000026scTEAQ` … `a4Rbb0000026sm9EAA`), each with its own aggregate
(`a4Sbb00000FSJgbEAH` … `a4Sbb00000FSJn3EAH`, one per facility per org convention):

| Facility | Collateral | Pledged | Lendable | Lien |
|---|---|---|---|---|
| HW1001 | AR | 8,000,000 | 8,000,000 | 1st |
| HW1001 | Inventory | 4,000,000 | 4,000,000 | 1st |
| HW1006 | AR | 1,600,000 | 1,600,000 | 1st |
| HW1002 | Equipment | 5,900,000 | 5,900,000 | 1st |
| HW1005 | Equipment | 1,600,000 | 1,600,000 | 1st |
| HW1004 | Real estate | 5,000,000 | 5,000,000 | 1st |
| HW1003 | Real estate | 5,500,000 | 5,500,000 | 1st |

**`LLC_BI__Authorize__c` was never set**, because `Amount_Pledged` never exceeds
`Current_Lendable_Value` on any row. Verified by aggregate: pledges per collateral total exactly 9.6MM /
4.0MM / 7.5MM / 10.5MM, matching lendable value to the dollar. Cross-collateralisation is deliberate and
realistic (AR shared across both lines, equipment across both equipment loans, real estate across the
purchase and construction facilities).

**Valuations**, two per collateral, earliest flagged `Original_Value`, latest flagged `Active` +
`Primary`: `a34bb0000039AzJAAU`, `a34bb0000039B0vAAE`, `a34bb0000039B2XAAU`, `a34bb0000039B49AAE`,
`a34bb0000039B5lAAE`, `a34bb0000039B7NAAU`, `a34bb0000039B8zAAE`, `a34bb0000039BAbAAM`. Dates run
2023-04-20 to 2026-06-30, all before today, with sources and types drawn from the org's own picklists
(Receivables Aging, Inventory Report, Appraisal; Balance Sheet, Book Value, FMV Real Estate, FMV
Equipment, Orderly Liquidation Value).

**Liens** (`a4Mbb0000019zuvEAA`, `a4Mbb0000019zwXEAQ`, `a4Mbb0000019zy9EAA`, `a4Mbb0000019zzlEAA`), one
per collateral, 1st position, institution named, UCC expiry 2029-03-15. Mirrors the LN1000 pattern where
15 of the org's 16 liens sit.

### Loan children built, and the ones deliberately skipped

| Concept | Built? | Evidence |
|---|---|---|
| Covenant junctions | **yes**, 2 | 107 real rows org-wide |
| Collateral pledges | **yes**, 7 | v2 model, 8 real rows |
| Liens | **yes**, 4 | 16 real rows |
| Policy exception | **yes**, 1 | `a4rbb000003NxldAAC` on HW1003, Major / Mitigated, 3 mitigation reasons |
| Pricing streams | **yes**, 2 | `a50bb00000sVlMvAAK` (HW1001), `a50bb00000sVlOXAA0` (HW1006) |
| **Fees** | **NO** | `LLC_BI__Fee__c` has **0 rows in the entire org**; `LLC_BI__Fee_Loan_Aggregate__c` also 0. Fees are not modelled as records here. Inline loan fee fields are null on every loan sampled. Clean negative. |
| **Participations** | **NO** | `LLC_BI__Participation__c` 0 rows org-wide |
| **Disbursements / draw schedules** | **NO** | `LLC_BI__Projected_Draw_Schedule__c` and `_Event__c` 0 rows |
| **Payment / amortisation schedules** | **NO** | no schedule child of Loan exists; terms live on the loan fields, which are filled |
| **Statements / spreads** | **NO** | `LLC_BI__Spread__c` has 0 rows attached to any loan; the tree is disconnected from loans in this org |
| **Opportunity History** | not seeded | trigger-written; the org generated its own rows |

The two pricing streams are the one place this build is **better** than the org's own examples: the two
pre-existing streams left `Is_Rate_Stream__c` and `Is_Payment_Stream__c` false with `All_In_Rate` 0.
Hartwell's are built correctly (Adjustable period type, monthly term unit, both flags true, effective
and end dates matching the facility). Flagged so nobody mistakes the difference for an error.

### Insight garnish (4)

| Type | Id | Detail |
|---|---|---|
| Case | `500bb00000qpyllAAA` | Closed. Add Hartwell Logistics to consolidated treasury reporting. |
| Case | `500bb00000qprFhAAI` | Closed. Borrowing base certificate template clarification. |
| Opportunity | `006bb00000tsmeNAAQ` | Treasury Services Expansion, Proposal, $185,000, close 2026-10-30 |
| Review | `a5nbb00000kasAgAAI` | FY2025 annual credit review, Status **Complete**, five narrative sections |

The Review inserted cleanly at `Complete`: `Review_Validation_01/02` are `PRIORVALUE`-shaped like LV06
and do not fire on insert. That is correct for a migration of a historical completed review, and it is
**not** a licence for the standing tools to write `Complete` — A33.4.6 removed that transition
deliberately, and this is a one-off migration of a record that was already complete.

The Opportunity uses the **General** record type: `Treasury Management` is not available to the running
profile. The treasury intent is carried in the name, type and description.

---

## Field-population policy applied throughout

**Filled:** everything a realistic migration would carry, mirrored from the real reference rows.
Accounts got the full Piedmont surface (46 writable fields: addresses billing and shipping, phone,
website, NAICS code and description, SIC, employees, revenue, incorporation and customer-since dates,
tax ID, state of incorporation, fiscal year end, DBA, segment, lifecycle, legal status, relationship
class, plus three narrative fields). Loans got amounts, balances, rates, spreads, terms, amortisation,
close, closed, booked and maturity dates, accrual method, payment type, loan class, risk grade, product
line and type, product reference, and a written description.

**Left to the org, never written:**

| Field | Why |
|---|---|
| `LLC_BI__Loan__c.Name` | a before-save flow rebuilds it as `Account - Product - Amount` |
| `LLC_BI__Loan__c.LLC_BI__Loan_Officer__c` | `ACNPEX_ AccountOwnerAsLoanOfficer` overwrites it from the account owner |
| `LLC_BI__Loan__c.LLC_BI__Loan_Detail__c` | the after-commit flow creates and links the child |
| `LLC_BI__Legal_Entities__c.LLC_BI__Is_*__c` | formulas derived from `Borrower_Type` |
| `LLC_BI__Loan_Covenant__c.LLC_BI__Active__c` | formula (refused on insert, as expected) |
| `Account.Billing_Address__c` | derived (refused on insert, as expected) |
| `LLC_BI__Collateral__c.LLC_BI__Lendable_Value__c` | formula off value × advance rate |
| Opportunity History, Product Package Parent Loan History | trigger-written audit trails |

**Deliberately empty:** `LLC_BI__Loan_Number__c` on all six facilities. It is a unique external-id
double, and **all 181 real booked loans in the org leave it null** while carrying the key in
`lookupKey`. Following org convention rather than inventing numbers.

---

## Verification sweep

Run after the build, independently of the insert responses, with 60 seconds allowed for org rollups.

| Object | Expected | Found |
|---|---|---|
| Accounts (`Hartwell%` or LastName `Hartwell`) | 5 | **5** |
| Connections created today | 14 (7 + 7 mirrors) | **14** |
| Product Package on OpCo | 1 | **1** |
| Loans on the package | 6 | **6** |
| Loans that are Booked **and** Open **and** have a lookupKey | 6 | **6** |
| Loan Details | 6 | **6** |
| Entity Involvement on the package | 21 | **21** |
| Covenants on OpCo | 6 | **6** |
| Loan Covenant junctions | 2 | **2** |
| Collateral (`Hartwell%`) | 4 | **4** |
| Collateral Valuations | 8 | **8** |
| Pledges | 7 | **7** |
| Liens | 4 | **4** |
| Policy Exceptions | 1 | **1** |
| Pricing Streams | 2 | **2** |
| Cases | 2 | **2** |
| Opportunities | 1 | **1** |
| Reviews | 1 | **1** |

**Coherence checks that passed:**

- `SELECT SUM(LLC_BI__Amount__c), SUM(LLC_BI__Principal_Balance__c), COUNT(Id)` over the package →
  **46,000,000 / 31,030,000 / 6**, matching the package's `Total_Loan_Facilities_Amount__c`,
  `Outstanding__c` and `Loan_Facilities_Count__c` exactly, and `Unused__c` = 14,970,000 = the difference.
- Pledged amounts per collateral sum to exactly the lendable value of each: 9.6MM / 4.0MM / 7.5MM /
  10.5MM. No pledge exceeds lendable, so no `Authorize` override exists anywhere in the tree.
- Every outstanding balance is below its commitment on all six facilities.
- All valuation dates precede today; every covenant's last evaluation (2026-06-30) precedes its next
  (2026-09-30 quarterly, 2026-07-31 monthly).
- Covenant actuals are consistent with the balance sheet implied by the loans: $31.03MM of bank debt
  inside $47.1MM total liabilities against $19.5MM tangible net worth gives the stated 2.42x.

**Bypass permissions: none were ever granted, so none needed removal.** Confirmed by the fact that both
LV05 and LV06 passed on their own terms. `LLC_BI__Exclude_Validation` was never assigned to any user
during this build, and the standing rule that the shipped tools never hold it is untouched.

---

## Known deviations, stated plainly

1. **Collateral record types are `Master`, not `UCC` / `Real Estate`.** The running profile has no
   assignment for those record types and assigning them is a metadata change. One-line fix when someone
   with the profile change wants it: assign the record types, then patch `RecordTypeId` on the four
   collateral records.
2. **Holdings carries `Entity_Type = EPC`**, because the picklist has no `Holding Company` value.
3. **Three covenant types are near-matches**, not exact: Fixed Charge Coverage, borrowing base and
   completion. The precise meaning lives in `Acnpex_Clause__c` and `LLC_BI__Detail__c`.
4. **Quarterly covenants carry `Acnpex_Statement_Frequency__c = Not Annual`**, the only non-annual value
   the Financial Ratio record type offers on that restricted picklist.
5. **No compliance rows**, by the reasoned decision above.
6. **`Parent` and `Affiliated Company` connection roles are used here first** in this org.

---

*Built 2026-07-26. Evidence for every decision is in `PROBE-LEDGER.md` (waves 3 to 6) and
`LESSONS-NCINO-APEX.md`. Do not delete these records.*
