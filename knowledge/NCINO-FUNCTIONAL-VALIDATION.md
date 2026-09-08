# nCino Functional Validation — Hartwell vs Piedmont vs the org

**Date:** 2026-07-27
**Org:** `bankinggpt` / `00DDz000001qeO2MAI` (sandbox), queried as `fabian.goetzens@accenture.com.bankinggpt`
**Mode:** STRICTLY READ-ONLY. No DML, no deploys, no records created, no metadata touched. Every number below
came from a `SELECT`, a `describe`, or a Tooling-API metadata read.
**Symptom under investigation (Fabian):** *"on Hartwell nothing is displayed in the actual coverage, same for covenants"*

---

## 0. Executive summary

The headline finding overturns the working assumption. **Hartwell's nCino data is not the problem.** On both
surfaces the org holds correct, populated values, and on covenants Hartwell is measurably *richer* than
Piedmont, the org's own reference relationship. Three of the four causes of the blank cockpit are in our read
tool and our React layer; the fourth is a one-field-per-loan nCino linkage that nCino itself documents as the
fix for exactly this symptom.

### Top gaps, ranked by demo impact

| # | Gap | Where it lives | Demo impact | Fix cost | Founder decision? |
|---|---|---|---|---|---|
| **1** | `Customer360Exposure` reads `LLC_BI__AmountOutstanding__c`, which is **null on 187 of 187 booked loans org-wide**. The org's populated balance field is `LLC_BI__Principal_Balance__c`. Outstanding therefore returns 0, and the cockpit's coverage guard `drawn > 0` blanks the coverage ratio to `—` / "Not computable". | Our Apex read tool | **Critical.** Kills coverage on *every* relationship, Piedmont included. Also shows "$0 drawn" and full availability against $31.03MM of real debt. | 1 line of Apex + republish | No |
| **2** | The covenant facility-group section renders a 6-column grid with only 3 children and **no header row**. It is only reachable when `attachedLoans` is non-empty — which Hartwell is the first relationship in the org to have. Two of Hartwell's six covenants get pulled out of the properly-columned table into this stripped section. | Cockpit `CovenantsTab.tsx` | **Critical.** This is almost certainly the literal "nothing displayed for covenants": values sitting under nothing. | React fix | No |
| **3** | `LLC_BI__Loan_Collateral_Aggregate__c` is **null on all 6 Hartwell loans** although 6 correctly-rolled-up aggregate records exist. Every nCino-native loan collateral field (`Total_Collateral_Value__c`, `Current_Total_Lendable_Value__c`, `Current_LTV__c`, `Is_Secured__c`) is a formula through that lookup, so all read 0/false. | nCino data | **High** for anyone opening the loan in nCino; **low** for the cockpit today (our tool computes coverage from pledges, not from these fields). | 6 field updates, no automation fires | No |
| **4** | Coverage numerator **double-counts**. `Σ facilities.totalLendableValue` = $59.2MM against $31.6MM of unique collateral, because 3 of 4 collateral records are pledged to two facilities each and `LLC_BI__Current_Lendable_Value__c` on the pledge carries the *collateral's* full lendable value, not the pledged share. Even after fix #1 the ratio would be ~1.9x too generous. | Our Apex + React | **High.** An overstated coverage number in a credit demo is worse than a blank one. | Use `LLC_BI__Amount_Pledged__c` for the facility share; dedupe by `collateralId` for relationship totals | **Yes** — which number is "coverage" is a credit-policy call |
| **5** | Zero covenant compliance rows for Hartwell. **This is correct and should stay that way.** Evidence below shows compliance rows in this org carry *no actual values at all* (0 of 140), so creating them would add nothing visible while firing an unrecallable approval at a real human. | nCino data (deliberate) | Blocks `stage_covenant_review` only | See §1 | **Yes** — but the recommendation is "do nothing" |
| **6** | Units bug: the Accounts Receivable covenant (`actualValue: 80`, a **percent** advance test) renders as `"80.00×"` and `"≥ 80.00×"`. Not blank, but wrong on screen. | Cockpit `finance.ts` | Medium (visible nonsense in a demo) | React fix | No |
| **7** | Completeness gaps vs Piedmont: **`LLC_BI__Account_Collateral__c` 0 vs 5** (collateral ownership junction) and **`LLC_BI__Account_Covenant__c` 0 vs 4** (relationship-covenant junction). | nCino data | Low today (no tool reads them), but they are real nCino model gaps | 4 + 6 inserts | No |

**Not a gap:** deposits, treasury, profitability, relationship risk review, spreads-on-loans, participations,
fees. All are **zero across the entire org**, Piedmont included. Hartwell is not behind the org here.

---

## 1. Covenant actuals and compliance

### 1.1 What nCino documents

**Source: "How to Use Covenant Management and Servicing"**, nCino technical documentation (Paligo),
Solution *Covenant Management and Servicing*, release `2025_06` / Latest, published 2026-07-09,
mapId `JcmtOww8Pe03jJQFdMSeHA`. Verbatim, from the *Covenant Compliance Automation* section:

> "Compliance records generate automatically on active covenants with a **frequency template, effective date,
> and due date**."

And from *Covenant Management Fields*:

> "**Last Evaluation Value**: The system updates this field with the Historic Financial Indicator Value from
> the most recently tested covenant compliance. Users can see this historical value on the current Covenant
> Mgmt record."
>
> "**Last Evaluation Status**: This field updates based on the status of the most recent covenant compliance record."
>
> "**Last Evaluation Date**: This field updates based on the Evaluation Date on the most recent covenant compliance record."

And from *Covenant Compliance Fields*:

> "**Historic Financial Indicator Value**: The Financial Indicator Value of the associated Covenant when the
> Covenant Compliance record was set to compliant."

And from *Access Covenant Details* → *Performance Rules Details*:

> "Displays details for all performance rule details on the covenant. The table displays the Operator,
> **FI Value (value from Spreads)**, and End Date fields."

So the documented model is: **Spread → Performance Rule → Covenant Compliance → (on approval) Covenant's
Last_Evaluation_\* fields.** The covenant's own "actual" is a *denormalised echo* of a compliance record, not
an independently-authored value.

Also documented, and directly relevant to us: **"Covenant Servicing does not yet support Spreads."**

### 1.2 What Hartwell has

All six covenants carry actuals. Verbatim, from
`SELECT Id, Name, LLC_BI__Covenant_Type__r.Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Last_Evaluation_Value__c, LLC_BI__Last_Evaluation_Status__c, LLC_BI__Last_Evaluation_Date__c, LLC_BI__Next_Evaluation_Date__c, LLC_BI__Frequency__c, LLC_BI__Breached__c, LLC_BI__Covenant_Status__c FROM LLC_BI__Covenant2__c WHERE LLC_BI__Account__c='001bb00001I7FPNAA3'`:

| Id | Name | Type | Threshold | **Actual** | Status | Last eval | Next eval | Freq |
|---|---|---|---|---|---|---|---|---|
| `a3Bbb000000S0UvEAK` | COV-000646 | Debt Service Coverage of Borrower | 1.25 | **1.38** | Compliant | 2026-06-30 | 2026-09-30 | Quarterly |
| `a3Bbb000000S0WXEA0` | COV-000647 | Maximum Debt to Worth | 3 | **2.42** | Compliant | 2026-06-30 | 2026-09-30 | Quarterly |
| `a3Bbb000000S0Y9EAK` | COV-000648 | Minimum Liquidity | 5000000 | **6800000** | Compliant | 2026-06-30 | 2026-09-30 | Quarterly |
| `a3Bbb000000S0ZlEAK` | COV-000649 | DSC with and without Distributions | 1.15 | **1.22** | Compliant | 2026-06-30 | 2026-09-30 | Quarterly |
| `a3Bbb000000S0bNEAS` | COV-000650 | Accounts Receivable | 80 | **80** | Compliant | 2026-06-30 | 2026-07-31 | Monthly |
| `a3Bbb000000S0czEAC` | COV-000651 | Term Covenants | *(null)* | *(null)* | *(null)* | *(null)* | 2026-11-01 | One-Off |

Only COV-000651 (the Kokomo completion covenant) has a null actual, and that is semantically correct — a
completion milestone has no financial indicator value. Its `LLC_BI__Covenant_Status__c` is `In Progress`.

**Field-by-field diff against Piedmont's 4 covenants** (all 65 queryable fields on `LLC_BI__Covenant2__c`,
populated-on-either comparison):

```
LLC_BI__Covenant2__c   Hartwell rows: 6   Piedmont rows: 4
  --- POPULATED ON PIEDMONT, EMPTY/ABSENT ON HARTWELL (0) ---
  --- POPULATED ON HARTWELL, EMPTY ON PIEDMONT (8) ---
    Acnpex_Category__c, Acnpex_Statement_Frequency__c, LLC_BI__Compliance_Days_Prior__c,
    LLC_BI__Document_Source__c, LLC_BI__Grace_Days__c, LLC_BI__Required__c,
    LastReferencedDate, LastViewedDate
```

**Zero fields are populated on Piedmont and empty on Hartwell.** Hartwell's covenant records are a strict
superset of the org's reference relationship.

### 1.3 The one thing Hartwell (and Piedmont) genuinely lacks: a Frequency Template

`LLC_BI__Frequency_Template__c` is a lookup to **`LLC_BI__Date_Template__c`** (confirmed by describe:
`LLC_BI__Frequency_Template__c -> ['LLC_BI__Date_Template__c'] | createable: True | updateable: True`).
It is **null on all 6 Hartwell covenants and all 4 Piedmont covenants**. Hartwell instead uses the
descriptive `LLC_BI__Frequency__c` picklist (Quarterly / Monthly / One-Off), which the generator does not read.

The correlation is perfect and org-wide:

```
covenants WITH  LLC_BI__Frequency_Template__c : 16
covenants WITHOUT                              : 623
compliance rows whose covenant HAS a template  : 140
compliance rows whose covenant has NO template : 0
LLC_BI__Date_Template__c records available     : 8
```

Every one of the org's 140 compliance rows belongs to one of the 16 templated covenants. Not a single
untemplated covenant has ever generated one. Verbatim comparison of the automation drivers:

```
Account                    Name        Frequency_Template  Template   Frequency  Effective   Due Date    Grace  Active  Required
ABC Manufacturing          COV-000005  a3Ubb000000UOEhEAO  Quarterly  (null)     2027-03-31  2027-04-15  15     true    false
Flowers For Dreams         COV-000001  a3Ubb000000UOEfEAO  Quarterly… (null)     2025-08-31  2025-09-30  30     true    true
Hartwell Precision Mfg     COV-000646  (null)              (null)     Quarterly  2024-03-15  2024-04-14  30     true    true
Hartwell Precision Mfg     COV-000650  (null)              (null)     Monthly    2024-03-15  2024-03-25  10     true    true
Piedmont Precision         COV-000637  (null)              (null)     Quarterly  2024-07-15  2024-07-15  (null) true    false
```

Hartwell satisfies two of nCino's three documented preconditions (Active + Effective Date + Due Date + Grace
Days). **The missing precondition is the Frequency Template lookup.** That is the complete, evidence-backed
answer to "what would nCino need for a covenant to generate compliance".

### 1.4 The decisive finding: compliance rows in this org carry no actuals

Before recommending we create compliance rows, I checked what compliance rows in this org actually contain.

```
Total LLC_BI__Covenant_Compliance2__c                              : 140
  with LLC_BI__Historic_Financial_Indicator__c populated           :   0 / 140
  with LLC_BI__Evaluated_Rule__c (performance rule) populated      :   0 / 140
  with LLC_BI__Associated_Spread_Statement_Period__c populated     :   0 / 140
  with LLC_BI__Approved_By__c populated                            :   5 / 140

Status distribution:  Exception 101 | Pending 31 | Compliant 2 | (blank) 6
```

Sample rows, verbatim:

```
Name       Account            Status     Effective    Due Date     Eval Date   HistoricFI  AutoTestStatus
COMP-0468  BlueSky Group      Pending    2026-07-07   2026-08-06   (null)      (null)      (null)
COMP-0464  ABC Manufacturing  Pending    2026-07-31   2026-08-15   (null)      (null)      (null)
COMP-0461  BlueSky Group      Exception  2026-06-23   2026-07-23   2026-07-24  (null)      (null)
```

**Compliance rows in `bankinggpt` are pure due-date ticklers.** They carry no measured value, no evaluated
rule, no spread linkage. Per the nCino doc quoted in §1.1, `Last_Evaluation_Value` is written *from*
`Historic Financial Indicator Value` — which is null on all 140 rows. Creating compliance rows for Hartwell
would therefore add **zero** visible actuals.

Worse: 101 of 140 existing rows sit at `Exception` because their due date passed. Hartwell's covenants carry
2024 effective dates. Generating its schedule would immediately manufacture a wall of `Exception` rows and
make the flagship demo relationship look non-compliant.

`LLC_BI__Spread_Statement_Record__c` has **2,433 rows org-wide**, but **0 covenants** anywhere in the org link
to one via `LLC_BI__Linked_Spread_Statement_Record__c`. The documented Spread → Performance Rule → FI Value
chain has never been exercised in this org.

### 1.5 `acnpex_covenantApprovalProcess` — trigger-condition analysis

Read from the Tooling API (`SELECT Metadata FROM Flow WHERE Id='301bb00000T6YxZAAV'`).

- **FlowDefinition:** `300bb00000MKZmXAAX`, DeveloperName `acnpex_covenantApprovalProcess`, ManageableState **`unmanaged`** (org-local, not nCino managed), NamespacePrefix empty
- **Active version:** `301bb00000T6YxZAAV`, VersionNumber **3**, Status **`Active`**, ProcessType **`ApprovalWorkflow`** (Approval Orchestration)

Verbatim `start` node, with every gating field shown:

```json
{
  "object": "LLC_BI__Covenant_Compliance2__c",
  "recordTriggerType": "Create",
  "triggerType": "RecordAfterSave",
  "filters": [],
  "filterLogic": null,
  "filterFormula": null,
  "conditions": [],
  "conditionLogic": null,
  "doesRequireRecordChangedToMeetCriteria": null,
  "connector": { "targetReference": "Stage_1" }
}
```

Stage and step gating:

```
STAGE: Stage_1        entryConditions: null   entryConditionLogic: None   exitConditions: []
  STEP: RM_s_Approval   stepSubtype: ApprovalStep   actionType: stepApproval
                        actionName: standard_approvals__EvaluateApproval
                        entryConditions: []   logic: and
                        ASSIGNEE: assigneeType "User", stringValue "robert.mcclaren@outlook.com"  (hard-coded)
                        INPUT: ActionInput__RecordId <- $Record.Id
  STEP: Field_Update    stepSubtype: BackgroundStep   actionType: stepBackground
                        actionName: acnpex_covenantManagementRecupdate
                        entryConditions: [ RM_s_Approval.Status EqualTo "Completed" ]
```

**Answer to the key question (1b): NO.** There is no field value, no status, no record shape, and no field
combination that lets a `LLC_BI__Covenant_Compliance2__c` row be created without firing the approval.
`filters` is an empty array, `filterFormula` and `filterLogic` are both null, `conditions` is empty, the
stage has `entryConditions: null`, and the approval step itself has `entryConditions: []`. **Every insert,
unconditionally, assigns an approval to `robert.mcclaren@outlook.com`.** The only levers are (a) deactivate
the flow — a metadata change in a shared sandbox, already rejected and correctly so, (b) do not create the
rows, (c) get out-of-band agreement from the real human.

Note the second-order effect: the `Field_Update` step (which runs `acnpex_covenantManagementRecupdate`, the
flow that writes back to the Covenant Mgmt record) only executes **after** Robert approves. So even a
successful compliance insert would leave the covenant's `Last_Evaluation_*` fields untouched until a human
acts. Hartwell already has those fields populated directly, which is functionally *ahead* of where a fresh
compliance row would leave it.

### 1.6 Covenant fields Hartwell leaves empty that nCino UIs populate

| Field | Hartwell | Piedmont | Org-wide | Consequence |
|---|---|---|---|---|
| `LLC_BI__Frequency_Template__c` | null ×6 | null ×4 | 16 of 639 | No compliance generation (§1.3) |
| `LLC_BI__Linked_Spread_Statement_Record__c` | null ×6 | null ×4 | 0 of 639 | No FI Value source; Performance Rules panel empty |
| `LLC_BI__Proposed_Effective_Date__c` / `_Frequency_Template__c` | null | null | rare | "Propose Updates" panel empty. Documented as origination/credit-action support. |
| `LLC_BI__Overdue__c` | false ×6 | false ×4 | — | Correct: derived, and nothing is overdue |
| `LLC_BI__Is_Template__c` | false | false | — | Correct |
| `Acnpex_Approval_Status__c` | null | null | — | Populated by the approval flow only |

Hartwell **does** carry `LLC_BI__Required__c = true` on all six (Piedmont: false on all four), which per the
doc is the correct state for covenants on booked loans.

### 1.7 Why the cockpit shows nothing for covenants

The data reaches the cockpit intact. From `artifact/live-data.json`, `borrowers["001bb00001I7FPNAA3"]`:

```json
{"covenantType":"Debt Service Coverage of Borrower","actualValue":1.38,"thresholdValue":1.25,"latestComplianceId":null,"lastEvaluationStatus":"Compliant","attachedLoans":[]}
{"covenantType":"Accounts Receivable","actualValue":80,"thresholdValue":80,"latestComplianceId":null,"attachedLoans":[{"loanName":"Hartwell … - Line of Credit - $15,000,000.00","loanId":"a4Zbb0000027MaYEAU"}]}
{"covenantType":"Term Covenants","actualValue":null,"thresholdValue":null,"covenantStatus":"In Progress","attachedLoans":[{"loanName":"Hartwell … - Construction - $12,000,000.00","loanId":"a4Zbb0000027Mp3EAE"}]}
```

Three cockpit-side defects blank or corrupt the display:

**C1 — the facility-covenant section has no headers and drops half its columns.**
`app/src/components/tabs/CovenantsTab.tsx:182–192` builds a `COV_COLS` six-column grid and supplies only
three children — covenant type, actual, threshold. No Cushion, no headroom bar, no Next test, **and no column
header row for the section**. Values sit under nothing. This section is only reached when `attachedLoans` is
non-empty; `app/src/data/collateralRecords.ts:129–130` switches on
`rows.some((c) => Array.isArray(c.attachedLoans))`, pulls the two facility-level covenants out of the
properly-columned table, and leaves 4 of 6 rows behind. **Hartwell is the first relationship in the org with
loan-attached covenants** (Piedmont's four are all `attachedLoans: []`), so this path has never rendered
before. This is the most likely literal cause of "nothing displayed … for covenants".

**C2 — units mismatch.** `app/src/data/finance.ts:18–22`:

```ts
export function fmtCovVal(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return fmtMoneyLocal(n);
  return Number(n).toFixed(2) + "×";
}
```

The Accounts Receivable covenant is a **percent** advance test (`actualValue: 80`). It renders `"80.00×"`
against a threshold of `"≥ 80.00×"`. The tool sends no unit hint, and the formatter's only heuristic is
magnitude.

**C3 — cushion bar collapses at zero cushion.** `finance.ts:84` clamps
`pct = Math.max(0, Math.min(100, Math.round((cushion / denom) * 100)))`. The AR covenant has cushion exactly
0, so the headroom bar renders empty despite being compliant.

**C4 (write path, not display) — covenant review cannot stage.** `app/src/actions/schemas.ts:687–712` looks
for `cov.complianceId` and, finding none, emits `blocksStaging: true`. `ActionPanel.tsx:638–639` returns null
without one. Note the naming split: the read tool sends `latestComplianceId`; the write path reads
`complianceId`. Given §1.4, the honest fix is a visible, explained HELD state, not a fabricated compliance row.

---

## 2. Collateral coverage

### 2.1 What nCino documents

**Source: "How Does nCino Calculate Loan to Value?"**, nCino Help Documentation, article `kAHHu000000Xb1JOAS`.
Verbatim:

> "Calculating an accurate LTV within nCino: 1. **Pledge Amount** must be populated on Collateral Pledge record
> – this populates Lien Amount. 2. **Lien Position** must be entered on Collateral Pledge records for Total
> Superior Lien Amounts to calculate correctly…"
>
> "Current LTV Calculation when Loan Books: … **( Principal Balance + Total Superior Lien Amount ) / Total
> Collateral Value = CURRENT LTV**"
>
> "Line of Credit LTV Calculation: … Original Loan Amount / ( Collateral Value from all Collateral – Total
> Prior Lien Amount from all Collateral ) = CURRENT LTV"
>
> "Total Superior Lien Amount on a loan calculates from a field of the same name on a behind the scenes object
> called **'Loan Collateral Aggregate.'**"

Note that **nCino's own booked-loan LTV uses Principal Balance**, not AmountOutstanding. That independently
validates gap #1.

**Source: "LTV, Gross Collateral Value, Current Gross Lendable Value, or Other Collateral Related Fields Are
Not Calculating on the Loan"**, article `kAHHu000000XabhOAC`. This article describes Hartwell's exact symptom
and prescribes the exact fix:

> "**There is no error message. However, fields such as LTV, Gross Collateral Value, and Current Gross
> Lendable Value are not calculated on a loan that has collateral pledged to it. Those fields appear as a $0
> amount.**"
>
> "Resolution: This issue can occur as a result of having an incorrect Loan Collateral Aggregate record ID on
> the loan. … 1. Run: `Select id, Name, LLC_BI__Loan_Collateral_Aggregate__c from LLC_BI__Loan_Collateral2__c
> where LLC_BI__Loan__c = '(Insert Loan ID)'` 2. Copy the value of the desired
> `LLC_BI__Loan_Collateral_Aggregate__c` field from the Collateral Pledged record. 3. Navigate back to the Loan
> record and ensure that the value of that field and the value of the desired Loan Collateral Aggregate record
> match. If they do not, paste the value onto the `LLC_BI__Loan_Collateral_Aggregate__c` field on the Loan record."

**Source: "How to Use Relationship LTV (Loan to Value)"**, nCino technical documentation (Paligo),
Solution *Commercial Banking*, mapId `QPwoIf4xqKIUySoPW47YaQ`. Verbatim:

> "**No calculation records exist until you click Recalculate.** When you click Recalculate, the system looks
> at the configuration records, reviews the loans and collateral, performs the calculations, and sends the LTV
> values to the summary card."
>
> "If your financial institution does not already use Total Exposure, you must populate the exposure fields
> that the system uses to calculate the LTV."
>
> Troubleshooting: "Ensure collateral exists. Ensure pledged collateral exists. Ensure the pledged collateral
> is not inactive. **Ensure there is a value in the chosen exposure field.** Ensure the criteria you chose for
> Borrower Type, Stage, Status, and Collateral Association applies to the relationship."

This is the documented confirmation of our platform truth *"collateral rollup never fires headlessly"*:
Relationship LTV is an explicitly **user-initiated, UI-only** recalculation. No API path exists. And the
troubleshooting list names the exposure field — our gap #1 again.

Related known issues, noted but not triggered here:
`kAHPY0000005A1x4AE` (multiple loans referencing the *same* aggregate → wrong LTV — Hartwell is clean, see
§2.4), `kAHHu000000XamWOAS` (pledge attached to the wrong aggregate), `kAHHu000000XadDOAS`
(`Renewal_Fields_To_clone` must include the loan collateral aggregate field, or renewal throws
`DUPLICATE_VALUE` on `LLC_BI__Unique_Id__c` — **a live side-effect risk for `stage_renewal` once we link the
aggregates**).

### 2.2 What Hartwell has — pledges are complete

`SELECT … FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__r.LLC_BI__Account__c='001bb00001I7FPNAA3'`
(7 rows, all fields the cockpit reads):

| Pledge Id | Loan | Collateral | Type | Coll. Value | Adv. Rate | Amount Pledged | Current Lendable | Lien | Status | Excluded | AoC |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `a4Rbb0000026scTEAQ` | HW1001 | COL-000762 | UCC-Accounts | 12,000,000 | 80 | 8,000,000 | 9,600,000 | 1st | Active | false | false |
| `a4Rbb0000026se5EAA` | HW1001 | COL-000763 | UCC-Inventory | 8,000,000 | 50 | 4,000,000 | 4,000,000 | 1st | Active | false | false |
| `a4Rbb0000026sfhEAA` | HW1006 | COL-000762 | UCC-Accounts | 12,000,000 | 80 | 1,600,000 | 9,600,000 | 1st | Active | false | false |
| `a4Rbb0000026shJEAQ` | HW1002 | COL-000764 | UCC-Equipment | 10,000,000 | 75 | 5,900,000 | 7,500,000 | 1st | Active | false | false |
| `a4Rbb0000026sivEAA` | HW1005 | COL-000764 | UCC-Equipment | 10,000,000 | 75 | 1,600,000 | 7,500,000 | 1st | Active | false | false |
| `a4Rbb0000026skXEAQ` | HW1004 | COL-000765 | Real Estate-Warehouse | 14,000,000 | 75 | 5,000,000 | 10,500,000 | 1st | Active | false | false |
| `a4Rbb0000026sm9EAA` | HW1003 | COL-000765 | Real Estate-Warehouse | 14,000,000 | 75 | 5,500,000 | 10,500,000 | 1st | Active | false | false |

Every field the tool selects is populated, all descriptions are real prose, all pledges are `Active`, none is
`Is_Excluded__c` or `Abundance_of_Caution__c`. Compare Piedmont, where **3 of 5 pledges are
`Is_Excluded__c = true` and 3 of 5 are `Inactive`/`Pending`** — the tool drops them:

```
a4Rbb0000025WEDEA2  LoC $5,000,000  COL-000755  UCC-Accounts   6800000  80  4400000  5440000  1st  Inactive  Excluded=true
a4Rbb0000025WFpEAM  LoC $5,000,000  COL-000756  UCC-Inventory  4200000  80  2000000  3360000  1st  Inactive  Excluded=true
a4Rbb0000025WHREA2  LoC $5,000,000  COL-000758  UCC-Equipment 12500000  80  2000000 10000000  1st  Inactive  Excluded=true
a4Rbb0000025WJ3EAM  Equip $5,000,000 COL-000758 UCC-Equipment 12500000  80  5000000 10000000  1st  Active    Excluded=false
a4Rbb0000025WKfEAM  Equip $5,000,000 COL-000757 UCC-Equipment  5000000  80  4250000  4000000  1st  Pending   Excluded=false
```

**On the pledge surface Hartwell is materially cleaner than Piedmont.**

### 2.3 Collateral asset records — Hartwell is also ahead

`SELECT … FROM LLC_BI__Collateral__c`:

| Id | Name | Value | Adv | Lendable | Status | Total Pledge Amt | Total Active Loans | Total Lien | LTV % | Combined % Pledged | Rollup Value | Rollup Lendable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `a35bb0000013xz3AAA` | COL-000762 | 12,000,000 | 80 | 9,600,000 | Available | 9,600,000 | 17,500,000 | 9,600,000 | 145.83 | 80 | *(null)* | *(null)* |
| `a35bb0000013y0fAAA` | COL-000763 | 8,000,000 | 80 | 6,400,000 | Available | 4,000,000 | 15,000,000 | 4,000,000 | 187.5 | 50 | *(null)* | *(null)* |
| `a35bb0000013y2HAAQ` | COL-000764 | 10,000,000 | 80 | 8,000,000 | Available | 7,500,000 | 11,500,000 | 7,500,000 | 115 | 75 | *(null)* | *(null)* |
| `a35bb0000013y3tAAA` | COL-000765 | 14,000,000 | 80 | 11,200,000 | Available | 10,500,000 | 17,000,000 | 10,500,000 | 121.43 | 75 | *(null)* | *(null)* |

Piedmont's equivalents show `Total_Pledge_Amount__c = 0` and `Total_Active_Loans_Value__c = 0` on two of four,
`Loans_To_Value__c = 0` on two of four. **Hartwell's asset-level rollups all fired.**

Two observations worth carrying forward:

1. `LLC_BI__Advance_Rate__c` on the *collateral* is a formula
   (`LLC_BI__Collateral_Type__r.LLC_BI__Advance_Rate__c`) and reads **80 on all four**, because all 43 org
   collateral types default to 80%. `LLC_BI__Lendable_Value__c` (formula, value × 80%) therefore gives
   9.6 / 6.4 / 8.0 / 11.2 MM, which **disagrees** with the pledge-level 9.6 / 4.0 / 7.5 / 10.5 MM produced by
   the `Advance_Rate_Override` on the pledge. Both are "correct" within their own object. Any surface mixing
   them will show two different lendable values for the same asset.
2. `LLC_BI__Total_Collateral_Rollup_Value__c` and `_Lendable_Value__c` are **null on Hartwell and on Piedmont
   alike**. These are plain (non-formula) currency fields written by an nCino batch job that has never run in
   this org. Org-wide condition, not a Hartwell gap.

### 2.4 The nCino-native gap: the aggregate is never linked from the Loan

Six `LLC_BI__Loan_Collateral_Aggregate__c` records exist for Hartwell and **their roll-ups are correct**:

```
Id                  Pledged Count  Total Collateral Value  Total Collateral Pledged  Current Total Lendable
a4Sbb00000FSJgbEAH  2              20,000,000              12,000,000                13,600,000
a4Sbb00000FSJiDEAX  1              10,000,000               5,900,000                 7,500,000
a4Sbb00000FSJjpEAH  1              14,000,000               5,500,000                10,500,000
a4Sbb00000FSJlREAX  1              14,000,000               5,000,000                10,500,000
a4Sbb00000FSJgcEAH  1              10,000,000               1,600,000                 7,500,000
a4Sbb00000FSJn3EAH  1              12,000,000               1,600,000                 9,600,000
```

And the pledge → aggregate → loan mapping is clean and one-to-one (no shared aggregate, so known issue
`kAHPY0000005A1x4AE` does not apply):

```
Loan Id               lookupKey  Aggregate Id          Collateral
a4Zbb0000027MaYEAU    HW1001     a4Sbb00000FSJgbEAH    COL-000762, COL-000763
a4Zbb0000027MnREAU    HW1002     a4Sbb00000FSJiDEAX    COL-000764
a4Zbb0000027Mp3EAE    HW1003     a4Sbb00000FSJjpEAH    COL-000765
a4Zbb0000027MqfEAE    HW1004     a4Sbb00000FSJlREAX    COL-000765
a4Zbb0000027MsHEAU    HW1005     a4Sbb00000FSJgcEAH    COL-000764
a4Zbb0000027MttEAE    HW1006     a4Sbb00000FSJn3EAH    COL-000762
```

But the **Loan** side of the link is empty. `SELECT … FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c='001bb00001I7FPNAA3'`:

```
lookupKey  Amount     Is_Secured  Loan_Collateral_Aggregate  Total_Collateral_Value  Current_Total_Lendable  Current_LTV  Original_LTV
HW1001     15000000   false       (null)                     0                       0                       0            (null)
HW1002      8000000   false       (null)                     0                       0                       0            (null)
HW1003     12000000   false       (null)                     0                       0                       0            (null)
HW1004      5000000   false       (null)                     0                       0                       0            (null)
HW1005      3500000   false       (null)                     0                       0                       0            (null)
HW1006      2500000   false       (null)                     0                       0                       0            (null)
```

Describe confirms the dependency chain:

```
LLC_BI__Loan_Collateral_Aggregate__c     calc=False createable=True updateable=True  ref=['LLC_BI__Loan_Collateral_Aggregate__c']
LLC_BI__Total_Collateral_Value__c        calc=True  createable=False  fml=LLC_BI__Loan_Collateral_Aggregate__r.LLC_BI__Total_Collateral_Value__c
LLC_BI__Current_Total_Lendable_Value__c  calc=True  createable=False  fml=LLC_BI__Loan_Collateral_Aggregate__r.LLC_BI__Current_Total_Lendable_Value__c
LLC_BI__Current_LTV__c                   calc=True  createable=False  fml=IF(LLC_BI__Total_Collateral_Value__c - LLC_BI__Total_Superior_Lien_Amount__c == 0, 0, …)
```

Every nCino-native collateral figure on the Loan is a formula through the null lookup. This is org-wide, not
Hartwell-specific: only **3 of ~190 loans** in the entire org have the aggregate linked (all three are
BlueSky/Flowers test junk), and `LLC_BI__Is_Secured__c = true` on exactly those same 3. Piedmont has 2
aggregate records and **also** leaves all three of its loans unlinked. Hartwell is at parity with the org's
reference and behind nCino's documented intent.

### 2.5 Why the cockpit shows nothing for coverage — the actual root cause

The cockpit does **not** read any of the fields in §2.4. `Customer360Exposure` computes coverage itself:

```apex
f.outstanding = ln.LLC_BI__AmountOutstanding__c != null ? ln.LLC_BI__AmountOutstanding__c : 0;
…
f.coverageRatio = (f.outstanding > 0 && lendableTotal > 0)
    ? (lendableTotal / f.outstanding).setScale(2) : null;
f.coverageShortfall = (f.outstanding > 0) && (lendableTotal < f.outstanding);
```

And `LLC_BI__AmountOutstanding__c` is empty everywhere:

```
booked loans with LLC_BI__AmountOutstanding__c > 0 :   0
booked loans total                                 : 187
```

Hartwell's balances live in `LLC_BI__Principal_Balance__c`, which is what the package rollup uses:

```
lookupKey  Amount     Principal_Balance  AmountOutstanding  Amount_Available  Stage   Status
HW1001     15000000   9200000            (null)             (null)            Booked  Open
HW1002      8000000   5900000            (null)             (null)            Booked  Open
HW1003     12000000   7350000            (null)             (null)            Booked  Open
HW1004      5000000   4420000            (null)             (null)            Booked  Open
HW1005      3500000   3010000            (null)             (null)            Booked  Open
HW1006      2500000   1150000            (null)             (null)            Booked  Open
```

`LLC_BI__Amount_Available__c` is a formula
(`IF(ISBLANK(LLC_BI__Availability_From_Core__c), LLC_BI__Amount__c - LLC_BI__AmountOutstanding__c, …)`) and is
therefore also blank.

The package rollup, by contrast, is correct — it rolls up Principal Balance:

```
Id                  Name                                    TCE       TBE       TOE       Outstanding  Total Facilities  Unused     Risk  Stage    Status
a5Fbb000000IHFJEA4  Hartwell Industrial C&I Credit Package  46000000  46000000  31030000  31030000     46000000          14970000   4     Complete Approved
a5Fbb000000HA1NEAW  Piedmont Precision C&I Credit Package   12500000  12500000   4250000   4250000     12500000           8250000   5     Credit Underwriting Rejected
```

**This is why the relationship header shows $31.03MM but every facility shows $0 drawn and `—` coverage.**
The Snapshot tool reads the package rollup; the Exposure tool reads the loan field. They disagree because
they read different fields.

Confirmed in the shipped bundle. `artifact/live-data.json`, Hartwell exposure:

```json
{"accountId":"001bb00001I7FPNAA3","totalCommitted":46000000,"totalOutstanding":0,"totalAvailable":0}
{"name":"… Line of Credit - $15,000,000.00","committed":15000000,"outstanding":0,"totalLendableValue":13600000,"coverageRatio":null,"coverageShortfall":false}
{"name":"… Construction - $12,000,000.00","committed":12000000,"outstanding":0,"totalLendableValue":10500000,"coverageRatio":null,"coverageShortfall":false}
{"name":"… Purchase - $5,000,000.00","committed":5000000,"outstanding":0,"totalLendableValue":10500000,"coverageRatio":null,"coverageShortfall":false}
```

And the React guard that turns that into a blank, `app/src/components/tabs/ExposureTab.tsx:35, 47–50`:

```ts
  const drawn = exp.totalOutstanding ?? 0;
  …
  const aggCoverage = hasLendable && drawn > 0 ? totalLendable / drawn : null;
  const covLabel  = aggCoverage == null ? "—" : fmtRatio(aggCoverage);
  const covStatus = aggCoverage == null ? "Not computable" : aggCoverage < 1 ? "Under-covered" : "Covered";
```

The same `drawn > 0` guard blanks the deal-ticket coverage delta (`app/src/actions/dealTicket.ts:169`) and the
chat grounding sentence (`app/src/data/grounding.ts:160`).

Two further cockpit facts worth recording:

- **`facility.coverageRatio` is never rendered anywhere.** The org-computed per-facility ratio exists in the
  contract (`contract.ts:364`) and the delta map (`delta.ts:51`) but has no visual. There is no LTV surface at
  all. The only coverage the banker sees is a client-derived aggregate.
- **This is not Hartwell-specific.** `AppShell.tsx:13` prefers `data.borrowers[accountId]` over the legacy
  `data.borrower` fallback. The `borrowers` entry for Piedmont also has `totalOutstanding: 0`, so **opening
  Piedmont in the cockpit renders `—` coverage too.** The only bundle in the file where coverage has ever
  worked is the unreachable `data.borrower` legacy anchor
  (`totalOutstanding: 4250000`, `coverageRatio: 1.92 / 2.06`).
- Our own validator already flags this: `render/validate-c360.mjs:242–245` emits
  `code: "coverage-null"`, *"Facility … has pledged collateral but coverageRatio is null."*

### 2.6 The double-count, which fixing #1 would expose

`Σ facilities.totalLendableValue` = **$59.2MM**. The four *unique* collateral records total **$31.6MM** of
lendable value. COL-000762, COL-000764 and COL-000765 are each pledged to two facilities, and
`LLC_BI__Current_Lendable_Value__c` on the pledge carries the **collateral's whole** lendable value, not the
pledged share. HW1006 is the clearest case: a $1.15MM facility with a $1.6MM pledge shows
`currentLendableValue: 9,600,000`.

`collateralRecords()` dedupes by `collateralId` for the Collateral table (4 rows) but the coverage math and
the "Collateral breakdown" card do not (7 rows). Fixing `totalOutstanding` alone would produce
59.2 / 31.03 = **1.91x** where the defensible number is closer to 31.6 / 31.03 = **1.02x**. Shipping the
first fix without the second would replace a blank with an overstatement — worse in a credit demo.

The facility-level pledged share is available and correct: `LLC_BI__Amount_Pledged__c`
(8.0 / 4.0 / 1.6 / 5.9 / 1.6 / 5.0 / 5.5 MM = $31.6MM, matching lendable to the dollar), and
`LLC_BI__Loan_Collateral_Aggregate__c.LLC_BI__Total_Collateral_Pledged__c` already sums it per facility.

---

## 3. Sweep — every other object, Hartwell vs Piedmont vs the org

Counts from `SELECT COUNT(Id)` per object, anchored on the OpCo (`001bb00001I7FPNAA3`) and Piedmont
(`001bb00001DLtRMAA1`).

| Object | Hartwell | Piedmont | Org | Read by a tool? | Verdict |
|---|---|---|---|---|---|
| `LLC_BI__Product_Package__c` | 1 | 1 | — | Snapshot, Portfolio, Exposure | Parity. Hartwell richer (Complete/Approved vs Credit Underwriting/**Rejected**) |
| `LLC_BI__Loan__c` | 6 | 3 | 187 booked | Exposure, Signals, Portfolio | Hartwell ahead |
| `LLC_BI__Loan_Collateral2__c` | 7 | 5 (3 excluded) | — | Exposure | Hartwell ahead |
| `LLC_BI__Collateral__c` | 4 | 4 | — | Exposure (via pledge) | Parity, Hartwell's rollups better |
| `LLC_BI__Collateral_Valuation__c` | 8 | 2 | 10 | — | Hartwell ahead |
| `LLC_BI__Loan_Collateral_Aggregate__c` | 6 (unlinked) | 2 (unlinked) | 12 | — | **Gap #3** (both) |
| `LLC_BI__Lien__c` | 4 | 15 | 20 | — | Piedmont ahead in count; Hartwell is 1-per-collateral which matches the LN1000 pattern |
| `LLC_BI__Covenant2__c` | 6 | 4 | 639 | Covenants, Portfolio | Hartwell ahead |
| `LLC_BI__Loan_Covenant__c` | 2 | **0** | 109 | Covenants (attachedLoans) | Hartwell ahead — and the first to exercise this path |
| `LLC_BI__Covenant_Compliance2__c` | **0** | **0** | 140 | Covenants (latestComplianceId) | Deliberate. See §1.4 — do not fill |
| `LLC_BI__Account_Covenant__c` | **0** | **4** | 133 | — | **Completeness gap.** Relationship-covenant junction. |
| `LLC_BI__Account_Collateral__c` | **0** | **5** | 9 | — | **Completeness gap.** Collateral *ownership* junction (Owner / %, `Pledging_Authority`). Named in the LTV troubleshooting list ("Collateral Association" filter). |
| `LLC_BI__Legal_Entities__c` | 21 | 4 | 56 | Graph, Signals | Hartwell far ahead |
| `LLC_BI__Connection__c` (from OpCo) | 4 | 1 | 222 | Graph | Hartwell ahead |
| `LLC_BI__Review__c` | 1 | 1 | 5 | ActionHistory | Parity |
| `LLC_BI__Policy_Exception__c` | 1 | 0 | 81 | — | Hartwell ahead |
| `LLC_BI__LoanRenewal__c` | **0** | **2** | 43 | Signals | **Completeness gap.** No renewal history → Signals' renewal path never exercised on Hartwell |
| `LLC_BI__Loan_Modification__c` | 0 | 0 | **0** | Signals | Org-wide empty. Not a gap |
| `Opportunity` | 1 | 1 | 10 | Opportunities | Parity |
| `Case` | 2 | 0 | 93 | — | Hartwell ahead |
| `Task` | 0 | 0 | 144 | — | Parity |
| `LLC_BI__Deposit__c` | 0 | 0 | 5 | — | Org-wide near-empty |
| `LLC_BI__Treasury_Service__c` | 0 | 0 | **0** | — | Org-wide empty |
| `LLC_BI__Profitability__c` | 0 | 0 | **0** | — | Org-wide empty |
| `LLC_BI__Relationship_Risk_Review__c` | 0 | 0 | **0** | — | Org-wide empty |
| `LLC_BI__Excluded_Exposure__c` | 0 | 0 | **0** | — | Org-wide empty |
| `LLC_BI__Spread__c` (on loans) | 0 | 0 | **0** | — | Org-wide empty. `Spread_Statement_Record__c` has 2,433 rows but 0 covenant links |
| `LLC_BI__Collateral_Group__c` | 0 | 0 | **0** | — | Org-wide empty — no cross-company guarantee groups (relevant to Relationship LTV) |

Account-level fields the tools read:

```
Id                  Name                Risk_Status  Highest_Risk_Grade  Committed_Direct_Exposure  Total_Deposits  Relationship_Class  Bank_Segment                    RM
001bb00001DLtRMAA1  Piedmont Precision  (null)       5                   (null)                     (null)          N/A                 Mid Size Commercial ($10-$50MM) (null)
001bb00001I7FPNAA3  Hartwell Precision  (null)       4                   (null)                     (null)          Gold                Large Corporate (>$50MM)        (null)
```

`Risk_Status__c` is null on both (StructuralSignals reads it for guarantor distress — that path returns
nothing for either relationship). The denormalised Account exposure rollups are null on both, as
SCHEMA-VERIFIED.md already established. `Bank_Relationship_Manager__c` is unset on both.

**Objects Piedmont has that Hartwell lacks entirely: three.** `LLC_BI__Account_Collateral__c` (5),
`LLC_BI__Account_Covenant__c` (4), `LLC_BI__LoanRenewal__c` (2). Nothing else.

---

## 4. Lifecycle: what a real relationship would have done, and what our migration skipped

| Stage | nCino step | Record artifacts a real run leaves | Hartwell |
|---|---|---|---|
| **Origination** | Deal created, package assembled, facilities added | Product Package, Loans at `Prospect`→`Underwriting`, Entity Involvement | **Skipped.** Inserted directly at `Booked`. Legal by LV05/LV06 (both key on `PRIORVALUE`), but no stage history exists. |
| | Spreads captured | `LLC_BI__Spread__c`, `Spread_Statement_Record__c`, statement periods | **Skipped.** Org-wide empty on loans. |
| | Risk rating | Package `Risk_Rating__c`, Loan `Risk_Grade__c`, rating history | **Partially done.** Grades set (4/5). No history object exists in this org. |
| | Collateral taken, valued, pledged | Collateral, Valuation (Original), Loan_Collateral2, Lien, **Loan.Loan_Collateral_Aggregate set** | **Done except the aggregate link.** 4 collateral, 8 valuations, 7 pledges, 4 liens. Gap #3. |
| | Covenants drafted with a **Frequency Template** | Covenant2 with `Frequency_Template__c`, `Effective_Date`, `Due Date`; Performance Rules for FI covenants | **Template skipped.** Everything else present. Gap in §1.3. |
| | Policy exceptions | `LLC_BI__Policy_Exception__c` | **Done** (1, Major/Mitigated on HW1003). |
| | Credit approval | Approval history, package `Status = Approved` | Status set to `Approved`; no approval process instance. Piedmont's is `Rejected`. |
| **Booking** | Loan → `Booked`, `lookupKey` assigned, covenants activate | `LLC_BI__Active__c = true`, `Required__c = true` on covenants | **Done.** Matches the doc ("A covenant activates after the loan updates to a booked status"). |
| | Core sync populates balances | `LLC_BI__AmountOutstanding__c`, `Availability_From_Core__c` | **Skipped — and skipped org-wide.** 0 of 187 booked loans. Balances live in `Principal_Balance__c`. |
| **Servicing: covenant monitoring** | Compliance records auto-generate each period | `Covenant_Compliance2__c` per period, `Status = Pending`→`Compliant`/`Exception` | **Skipped, deliberately and correctly.** §1.4/§1.5. |
| | Covenant tested against a spread | `Evaluated_Rule__c`, `Associated_Spread_Statement_Period__c`, `Historic_Financial_Indicator__c` | **Skipped.** Never exercised anywhere in the org (0 of 140). |
| | Approval writes back | `Approved_By__c`, then `acnpex_covenantManagementRecupdate` sets `Last_Evaluation_*` | **Bypassed.** We wrote `Last_Evaluation_*` directly, which is where the values would have ended up anyway. |
| **Servicing: collateral valuation** | Periodic re-appraisal | New `Collateral_Valuation__c` flagged `Active`+`Primary`, prior demoted | **Done.** 8 valuations, 2 per asset, 2023-04-20 → 2026-06-30. |
| | Relationship LTV recalculated | LTV calculation records — **only via the Recalculate button** | **Impossible headlessly.** Documented UI-only (§2.1). |
| **Servicing: annual review** | Review record through its stages | `LLC_BI__Review__c` with narrative sections | **Done** (1, `Complete`, five sections). Inserted at Complete; a real run would leave stage history. |
| **Servicing: renewal / modification** | Renewal or mod credit action | `LLC_BI__LoanRenewal__c`, `Loan_Modification__c` | **Skipped.** Piedmont has 2 renewals; Hartwell 0. |
| **Relationship maintenance** | Ownership junctions maintained | `Account_Collateral__c`, `Account_Covenant__c` | **Skipped.** Piedmont has 5 + 4. |

---

## 5. Remediation plan

**Nothing below has been executed.** Ordered by demo impact per unit of risk.

| # | Step | Records / fields | Side effects | Risk | Founder decision? |
|---|---|---|---|---|---|
| **R1** | Fix the outstanding-balance read in `Customer360Exposure`. Read `LLC_BI__Principal_Balance__c` with `LLC_BI__AmountOutstanding__c` as fallback (or `COALESCE` semantics in Apex). Matches nCino's own booked-loan LTV formula, which uses Principal Balance. | Apex only. `Customer360Exposure.getExposure()` line ~167. No org data touched. | None in the org. Deploy + republish. Changes `outstanding`, `available`, `coverageRatio`, `coverageShortfall` for **every** relationship — re-run the per-borrower QA matrix. | **Low** | No |
| **R2** | Fix the covenant facility-group section: add the header row and restore the missing three columns (Cushion, headroom bar, Next test) in `CovenantsTab.tsx:182–192`. | React only. | None. Add a per-borrower test covering non-empty `attachedLoans` — Hartwell is currently the only fixture that exercises it. | **Low** | No |
| **R3** | Decide and implement the coverage denominator/numerator. Options: (a) facility coverage = `Σ Amount_Pledged` (or aggregate `Total_Collateral_Pledged__c`) ÷ facility outstanding; (b) relationship coverage = dedupe by `collateralId` then sum lendable ÷ total outstanding. Today's `Σ totalLendableValue` double-counts 3 of 4 assets. **Half of this shipped and the dedupe picked the wrong row: §5.1 has the Northgate case, where the relationship reads 0.11x against facilities that all read above 1.0x.** | Apex + React. No org data touched. | Changes the headline coverage number on every relationship. Must ship **with** R1, never after it. | **Medium** — a wrong number is worse than a blank | **YES.** Which figure is "collateral coverage" is a credit-policy call, not an engineering one. Recommend co-gating with Clawdy. |
| **R4** | Fix `fmtCovVal` / `fmtCovThreshold` unit handling so percent covenants (AR advance test, `80`) do not render as `"80.00×"`. Needs a unit hint — either a `covenantUnit` field added to `Customer360Covenants` (derived from `Acnpex_Category__c` / `Financial_Indicator_Operator__c`) or a client-side type map. | React, optionally 1 Apex field. | If Apex changes, re-observe the wire envelope before pinning (lesson 16aa). | **Low** | No |
| **R5** | Link the collateral aggregate on the six Hartwell loans: set `LLC_BI__Loan__c.LLC_BI__Loan_Collateral_Aggregate__c` to the value already on that loan's pledge rows (mapping table in §2.4). This is nCino's own documented resolution (`kAHHu000000XabhOAC`). | 6 field updates on `LLC_BI__Loan__c`. No inserts. | Populates `Total_Collateral_Value__c`, `Current_Total_Lendable_Value__c`, `Current_LTV__c`, `Total_Superior_Lien_Amount__c`, `Is_Secured__c` (formulas — instant, no batch). **No email, no approval, no async flow.** Loan is at `Booked`; LV06 keys on `PRIORVALUE` of `Stage`, which is unchanged, so it cannot fire. **Watch:** article `kAHHu000000XadDOAS` — once the aggregate is set, `Renewal_Fields_To_clone` must include the aggregate field or `stage_renewal`/`execute_renewal` will throw `DUPLICATE_VALUE` on `LLC_BI__Unique_Id__c`. Probe `stage_renewal` on ZZ-PROBE data after this lands. | **Low-Medium** (the renewal interaction is the only real risk) | **YES** — it modifies six pre-existing Hartwell records, and the standing order is "never touch pre-existing without permission". Hartwell is ours, but the renewal side-effect deserves a explicit yes. |
| **R6** | Render `facility.coverageRatio` (the org-computed per-facility number) somewhere, and add an LTV surface. Today the contract carries both and the UI shows neither. | React. | None. | **Low** | No |
| **R7** | Replace the covenant-review staging block with an honest, visible HELD state explaining that no compliance record exists and why (doctrine §7.3: "HELD states are visible and explained"). Also reconcile the `latestComplianceId` (read) vs `complianceId` (write) naming split. | React + `schemas.ts`. | None. | **Low** | No |
| **R8** | Add `LLC_BI__Account_Collateral__c` ownership rows (4, one per collateral: OpCo as `Owner`, 100%, `Pledging_Authority` set) to match Piedmont's 5. | 4 inserts. | None known. Named in the Relationship LTV troubleshooting list ("Collateral Association" filter), so it matters if we ever wire Relationship LTV. Verify no trigger on the object before inserting. | **Low** | **YES** — new permanent records on the flagship relationship |
| **R9** | Add `LLC_BI__Account_Covenant__c` junction rows (6) linking the OpCo to its covenants, to match Piedmont's 4. | 6 inserts. | Verify no trigger. Note `LLC_BI__Loan_Covenant__c.LLC_BI__Active__c` is a formula and must not be written (already a documented lesson). | **Low** | **YES** |
| **R10** | Add `LLC_BI__Frequency_Template__c` (a `LLC_BI__Date_Template__c`, 8 exist) to Hartwell's covenants **so nCino generates compliance schedules**. | 6 field updates. | **SEVERE.** Generation fires `acnpex_covenantApprovalProcess` on *every* generated row — unconditional, unrecallable, assigned to `robert.mcclaren@outlook.com`. Effective dates are 2024, so the generator will backfill and, per the org's own pattern (101 of 140 rows are `Exception`), immediately mark the flagship relationship non-compliant. **And it buys nothing visible: 0 of 140 compliance rows in this org carry an actual value.** | **HIGH** | **YES — and the recommendation is DO NOT.** |
| **R11** | Insert a single hand-built compliance row to unblock `execute_covenant_review`. | 1 insert. | Fires the approval at Robert. No way to avoid it (§1.5: zero entry criteria, verbatim). Adds no actual. | **HIGH** | **YES — recommend deferring** in favour of R7 (honest HELD state). |
| **R12** | Backfill `LLC_BI__AmountOutstanding__c` on the six Hartwell loans to match Principal Balance. | 6 field updates. | Would make Hartwell the only relationship in a 187-loan org with this field set, and would make the cockpit "work" for Hartwell while every other relationship stayed blank — masking R1 rather than fixing it. `Amount_Available__c` would start computing. | **Medium** | **YES — recommend NOT doing this.** Fix the read (R1), not the data. |
| **R13** | Add `LLC_BI__LoanRenewal__c` history to reach Piedmont parity. | 2+ inserts. | Renewal triggers unknown; `LLC_BI__Unique_Id__c` collision risk (see R5). Probe first. | **Medium** | **YES** |
| **R14** | Relationship LTV recalculation. | — | **Not possible.** Documented as UI-only: *"No calculation records exist until you click Recalculate."* No API path. | n/a | Out of scope unless someone clicks it in the org UI |

### 5.1 R3, the case that names the number: Northgate reads 0.11x on facilities that all read above 1.0x

Written 2026-09-08 off the seven seeded relationships. **This is a read-class defect, not seed
data.** Every pledge, advance rate and valuation below is what the design intends and what the
org accepted; the arithmetic on top of them is what is wrong. Nothing in the org was changed to
write this section.

Both halves of R3 are now in `Customer360Exposure`, and the tool says so in its own note:

> "Facility coverage divides the facility's PLEDGED SHARE (`LLC_BI__Amount_Pledged__c`), never
> the whole collateral's lendable value, which every pledge of a cross-pledged asset repeats.
> Relationship coverage divides the lendable value of the DISTINCT collateral, deduped by
> collateral id."

The facility half is right. The relationship half dedupes to ONE pledge row per collateral id and
keeps whichever row it lands on, and a second-position pledge carries the JUNIOR SLICE as its
lendable value, not the asset's. Northgate Multifamily Investors LLC (`001bb00001LcuL8AAJ`) pledges
three of its four assets twice, once to the mortgage and once to that property's capex or
renovation line, and every one of the three keeps the junior row:

| Collateral | Senior pledge | Junior pledge | Kept by the dedupe |
|---|---|---|---|
| Ridge property `a35bb0000019qy5AAA` ($31.4MM) | `a4Rbb0000027b9rEAA` 1st, 70 percent, lendable **$21,980,000** | `a4Rbb0000027b9sEAA` 2nd, 5 percent, lendable $1,570,000 | the junior, $1,570,000 |
| Park Place property `a35bb0000019qy6AAA` ($23.0MM) | `a4Rbb0000027b9tEAA` 1st, 70 percent, lendable **$16,100,000** | `a4Rbb0000027b9uEAA` 2nd, 4 percent, lendable $920,000 | the junior, $920,000 |
| Crossing property `a35bb0000019qzhAAA` ($16.8MM) | `a4Rbb0000027b9vEAA` 1st, 68 percent, lendable **$11,424,000** | `a4Rbb0000027b9wEAA` 2nd, 14 percent, lendable $2,352,000 | the junior, $2,352,000 |
| Crossing solar `a35bb0000019qy7AAA` ($890K) | `a4Rbb0000027bCzEAI` 1st, 75 percent, lendable $667,500 | none | $667,500, correctly |

`totalUniqueCollateralLendableValue` comes back as **$5,509,500**, which is those four kept rows to
the dollar, and `uniqueCollateralCount` as 4, which is right. Against `totalOutstanding`
$51,983,000 that is **`coverageRatio` 0.11 with `coverageShortfall` true**, on a relationship where
every secured facility reads 1.00x to 1.54x:

```
Purchase   $22,000,000  a4Zbb000002J6a1EAC  out 21,250,000  pledged share 21,980,000  1.03
Purchase   $16,000,000  a4Zbb000002J6a3EAC  out 15,530,000  pledged share 16,000,000  1.03
Purchase   $11,400,000  a4Zbb000002J6a5EAC  out 11,372,000  pledged share 11,400,000  1.00
Construct   $2,200,000  a4Zbb000002J6a6EAC  out  1,540,000  pledged share  2,200,000  1.43
Line        $1,500,000  a4Zbb000002J6a2EAC  out    975,000  pledged share  1,500,000  1.54
Line          $800,000  a4Zbb000002J6a4EAC  out    520,000  pledged share    800,000  1.54
Equipment     $650,000  a4Zbb000002J6a7EAC  out    556,000  pledged share    650,000  1.17
Line          $400,000  a4Zbb000002J6a8EAC  out    240,000  unsecured                 null
```

Two defensible relationship numbers exist and neither is 0.11. Summing the SENIOR lendable per
distinct asset gives $50,171,500 and **0.97x**. Summing `LLC_BI__Amount_Pledged__c` across the
seven included pledges gives $54,530,000 and **1.05x**, which is the figure the facility half
already uses and the one that is consistent with it. The gap between 0.11 and either of them is
the whole judgement: at 0.11 a banker reads a relationship that is barely secured, and it is a
CRE book at roughly one times.

**This is not Northgate alone.** Four of the seven read below 1.0x at relationship level for the
same reason: Northgate 0.11, Cascade 0.26 (`001bb00001Ld14VAAR`, receivables, IP and TopCo equity
each carried on two facilities), Lakeshore 0.42 (`001bb00001LcIAeAAN`), Meridian 0.60
(`001bb00001Ld0ZqAAJ`). The three that read at or above 1.0 are the three the defect cannot reach:
Blue Ridge 1.01 and Sunbelt 1.08 pledge every asset exactly once, and Prairie Ag 1.35 pledges its
equipment schedule to two facilities at the SAME 75 percent advance rate, so whichever row the
dedupe keeps carries the same lendable value. **What makes the number wrong is not the second
pledge, it is the second pledge at a different advance rate**, which is how a junior lien is
modelled and therefore how every second-position facility in the book behaves.

The founder call R3 has been waiting for is therefore narrower than it was: not "which figure is
coverage" in the abstract, but **when one asset carries a senior and a junior pledge, does the
relationship count the asset's senior lendable value, or the sum of what is actually pledged
against it.** The seeded portfolio can now show either answer against a real book.

### Recommended sequence

1. **R1 + R3 together, then R2 and R4.** These four restore the two surfaces the founder reported, cost no org
   data, and fix Piedmont and the three sample borrowers at the same time. R3 needs the founder's call on which
   coverage definition ships.
2. **R5** once the `Renewal_Fields_To_clone` interaction is probed on throwaway data. This makes Hartwell
   render correctly inside nCino itself, which matters the moment anyone clicks through from the cockpit.
3. **R7, R6** for honesty and completeness.
4. **R8, R9** as low-risk completeness work.
5. **R10, R11, R12, R13** stay queued behind an explicit founder decision. R10 and R11 both have a documented
   recommendation of *no*.

### What must not be done

- Do not deactivate `acnpex_covenantApprovalProcess`. It is an unmanaged, active flow in a shared sandbox;
  during any deactivation window another user's compliance record would silently skip the chain. This was the
  right call on 2026-07-26 and remains right.
- Do not fabricate compliance rows to make a UI light up. The org's own 140 rows prove they would carry no
  actual, and the flow proves a real human gets paged.
- Do not backfill `AmountOutstanding` on Hartwell alone. That hides an org-wide read-tool defect behind one
  relationship and violates doctrine §7.2 (display correctness is a contract for **all** relationships).

---

## 6. Corrections to standing documentation

Three statements in the current docs are contradicted by live evidence and should be amended:

1. **`HANDOFF-2026-07-27.md` §5** says *"Piedmont (`001bb00001DLtRMAA1`) has 140 compliance rows — that's where
   covenant-review anchors populate."* **Piedmont has ZERO.** `SELECT COUNT(Id) FROM
   LLC_BI__Covenant_Compliance2__c WHERE LLC_BI__Covenant__r.LLC_BI__Account__c='001bb00001DLtRMAA1'` → **0**.
   The 140 belong to six other accounts: Flowers For Dreams (38), ABC Manufacturing (34), Ironclad Group (28),
   BlueSky Group (23), Cy LTD (10), EverPetal Logistics (7). `DEMO-RELATIONSHIP.md` §4 has this right; the
   handoff has it wrong. **`stage_covenant_review` has no working anchor on Piedmont either.**

2. **`HANDOFF-2026-07-27.md` §8** says *"collateral rollup never fires headlessly (valuations don't move
   collateral value)."* True but incomplete, and the incompleteness is load-bearing. The Loan Collateral
   Aggregate roll-up **did** fire for Hartwell — all six aggregates carry correct counts and totals. What is
   missing is the **`Loan.Loan_Collateral_Aggregate__c` pointer**, which is a plain writable lookup, not a
   rollup, and which nCino documents as a one-field manual fix. Separately, *Relationship* LTV genuinely
   cannot fire headlessly (UI Recalculate button only) — that part is confirmed by documentation.

3. **`DEMO-RELATIONSHIP.md` §"Covenant compliance rows: DELIBERATELY NOT CREATED"** gives three reasons. All
   three hold, and this validation adds a fourth and stronger one: **creating them would add no actual value
   at all**, because 0 of the org's 140 compliance rows carry `LLC_BI__Historic_Financial_Indicator__c`. The
   decision was right for better reasons than the ones recorded.

---

## 7. Documentation consulted

| Source | Id / mapId | Used for |
|---|---|---|
| "How to Use Covenant Management and Servicing" (nCino technical docs, Paligo; Solution *Covenant Management and Servicing*; release 2025_06/Latest; published 2026-07-09) | `JcmtOww8Pe03jJQFdMSeHA` | Compliance auto-generation preconditions; Last_Evaluation_* write-back direction; Historic Financial Indicator Value; Performance Rules / FI Value from Spreads; Frequency Template semantics; Active-on-booking |
| "How to Use Relationship LTV (Loan to Value)" (nCino technical docs; Solution *Commercial Banking*) | `QPwoIf4xqKIUySoPW47YaQ` | Relationship LTV is UI-Recalculate-only; exposure-field prerequisite; troubleshooting checklist |
| "How Does nCino Calculate Loan to Value?" (nCino Help) | `kAHHu000000Xb1JOAS` | LTV formulas; booked-loan LTV uses **Principal Balance**; Pledge Amount + Lien Position prerequisites; Loan Collateral Aggregate as the source of Total Superior Lien Amount |
| "LTV, Gross Collateral Value, Current Gross Lendable Value, or Other Collateral Related Fields Are Not Calculating on the Loan" (nCino Help) | `kAHHu000000XabhOAC` | Exact symptom match + the documented one-field resolution (R5) |
| "Error Message When Renewing a Loan: DUPLICATE_VALUE … `LLC_BI__Unique_Id__c`" (nCino Help) | `kAHHu000000XadDOAS` | `Renewal_Fields_To_clone` must include the aggregate field — the R5 side-effect |
| "Incorrect LTV Calculation Due to Multiple Loans Referencing the Same Loan Collateral Aggregate Record" (nCino Help) | `kAHPY0000005A1x4AE` | Checked and **not applicable** — Hartwell's 6 aggregates are one-to-one with its 6 loans |
| "How to Troubleshoot Incorrect LTV Values in Collateral Summary UI" (nCino Help) | `kAHHu000000XamWOAS` | Pledge-to-aggregate attachment verification |
| "How to Use Automated Covenant Testing" (nCino technical docs) | `FE_EonXfEU5WbW_VcgN7kw` | Located; **not read** — the org has 0 performance rules and 0 spread-linked covenants, so automated testing is not in play here. Listed for completeness, no claims drawn from it. |

The nCino documentation MCP tools (`knowledge-tools___search_help_documentation`,
`knowledge-tools___search_technical_documentation`, `knowledge-tools___get_*`) worked normally. No fallback to
schema-only inference was needed for any documented claim above.

---

*Read-only validation. No DML, no deploys, no metadata changes, no records created or modified.
Every figure re-derivable from the queries quoted inline.*
