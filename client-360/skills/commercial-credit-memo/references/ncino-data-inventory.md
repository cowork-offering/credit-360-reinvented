# nCino Data Inventory

Every Salesforce + nCino object and field the agent queries when drafting a credit memo. This is the raw material — the agent reads all of it before composing prose, computing ratios, or rendering the template.

What's NOT in nCino comes from MCP servers: **Boom** for spread line items, **AFS** for risk ratings / covenant actuals / ratios / sensitivity, **AFS** for revolver usage / payment history / balances, **CapIQ/IBIS** for peer + industry data. The agent synthesizes across all sources. (See `data-contracts.md` for the full module → source map.)

---

## What lives where

| Information | Source |
|---|---|
| Borrower identity, ownership, business description, segments, end markets, management, key customers | **Salesforce Account** (standard + custom fields) |
| Loan facilities, commitment, outstanding, maturity, pricing, use of proceeds | **LLC_BI__Loan__c** |
| Covenant tests, triggers, frequency, last test result | **LLC_BI__Loan_Covenant__c** |
| Collateral package and asset detail | **LLC_BI__Collateral__c** |
| Guarantor structure | **LLC_BI__Guarantor__c** |
| Current and historical risk ratings | **LLC_BI__Risk_Rating__c** (or risk rating fields on Loan) |
| RM, credit officer, borrower contacts | **Contact**, **User** |
| Prior credit memos, credit agreements, exception logs | **LLC_BI__Document__c** + **ContentVersion** |
| Exceptions and waivers granted | **LLC_BI__Exception__c** |
| Pricing grid and tier history | **LLC_BI__Loan_Pricing__c** (or pricing fields on Loan) |
| Origination and ongoing fees | **LLC_BI__Loan_Fee__c** |
| Spread line items (IS, BS, CF by accountCode) | **Boom MCP** (`boom_*`) — spreading engine |
| Risk-rating trend + PD, covenant actual-vs-required, ratios, sensitivity | **AFS MCP** (placeholder until it lands) |
| Revolver usage, payment history, loan summary | **AFS MCP** (`revolver_utilization` / `payment_history` / `loan_summary`) |
| Peer medians + industry outlook | **CapIQ/IBIS MCP** (placeholder; replaces EDGAR/FRED) |

---

## Account (the borrower)

Standard Salesforce fields the agent reads:

| Field | Type | Used for |
|---|---|---|
| `Name` | Text | Borrower name on cover, throughout memo |
| `BillingCity`, `BillingState`, `BillingCountry` | Text | HQ location on cover |
| `Industry` | Picklist | Industry positioning |
| `NumberOfEmployees` | Number | Borrower Overview headcount |
| `AnnualRevenue` | Currency | Cross-check vs. spread |
| `Phone`, `Website` | Text | Reference |
| `Description` | Long Text Area | High-level borrower description |
| `OwnerId` | Lookup → User | RM identification |

Custom nCino fields (standard nCino package):

| Field | Type | Used for |
|---|---|---|
| `NAICS_Code__c` | Text | Industry classification, peer NAICS lookup. **In the BankingGPT sandbox, the populated field is `NAICS_Code__c` (custom org field), NOT the nCino-managed `LLC_BI__Naics_Code__c` which is null on most accounts.** Verified for Piedmont Precision: `NAICS_Code__c = "332710"`, `LLC_BI__Naics_Code__c = null`. |
| `LLC_BI__NaicsDesc__c` | Text | NAICS description (e.g., "Machine Shops") — paired with `NAICS_Code__c` |
| `LLC_BI__Legal_Form__c` | Picklist | Cover page borrower form (LLC, Inc., LP) |
| `LLC_BI__Date_Established__c` | Date | Founding year on Borrower Overview |
| `LLC_BI__Tax_ID__c` | Text | Reference (not displayed in memo) |
| `LLC_BI__Account_Status__c` | Picklist | Active / Watch / Workout indicator |

Custom Acme Bank-specific fields to add (for the narrative raw material):

| Field | Type | Used for |
|---|---|---|
| `History_Description__c` | Long Text Area (32K) | Borrower Overview — history paragraph raw material |
| `Ownership_Description__c` | Long Text Area | Borrower Overview — ownership/sponsor description |
| `Segments_Description__c` | Long Text Area | Borrower Overview — segment narrative |
| `End_Markets_Description__c` | Long Text Area | Borrower Overview — end-market exposure |
| `Geographic_Footprint_Description__c` | Long Text Area | Borrower Overview — geography |
| `Customer_Concentration_Description__c` | Long Text Area | Borrower Overview — top customers |
| `Management_Description__c` | Long Text Area | Borrower Overview — management team bios |
| `Industry_Context_Description__c` | Long Text Area | Industry section — sector dynamics raw material |
| `Competitive_Landscape_Description__c` | Long Text Area | Industry section — competitive positioning |
| `Credit_Officer__c` | Lookup → User | Credit officer identification |
| `Region__c` | Text | Cover page region (e.g., "Texas / Gulf Coast") |
| `Industry_Vertical__c` | Text | Internal vertical assignment |

The agent treats these long-text fields as **raw material**, not finished prose. It reads them, weaves in fresh data (current quarter's results, peer context, macro), and composes the final memo paragraph.

### Child objects on Account

- **`LLC_BI__Account_Trade_Reference__c`** — trade reference records (if used)
- Custom **`Business_Segment__c`** (recommended for demo) — one record per operating segment with `Name`, `Pct_Revenue__c` (Percent), `Description__c` (Long Text), `End_Market__c` (Text)

---

## LLC_BI__Loan__c (loan facility)

The agent queries all loan records where `LLC_BI__Account__c = <borrower account ID>`.

Standard nCino fields the agent reads:

| Field | Type | Used for |
|---|---|---|
| `Name` | Text | Loan name on cover (e.g., "Atlas Industrial — RCF") |
| `LLC_BI__Loan_Type__c` | Picklist | Facility type (Revolving Line / Term Loan / Letter of Credit) |
| `LLC_BI__Product_Type__c` | Text | More specific product (Senior Secured RCF, TLA, TLB) |
| `LLC_BI__Original_Loan_Amount__c` | Currency | Commitment amount |
| `LLC_BI__Net_Balance__c` | Currency | Current outstanding |
| `LLC_BI__Available_Amount__c` | Currency | Undrawn capacity (revolvers) |
| `LLC_BI__Origination_Date__c` | Date | Loan origination |
| `LLC_BI__Maturity_Date__c` | Date | Loan maturity |
| `LLC_BI__Interest_Rate__c` | Number | All-in current rate |
| `LLC_BI__Rate_Index__c` | Picklist | Base index (SOFR, Prime, Fixed) |
| `LLC_BI__Rate_Spread__c` | Number | Spread over index (bps) |
| `LLC_BI__Amortization_Type__c` | Picklist | Bullet / Amortizing / Interest-Only |
| `LLC_BI__Amortization_Years__c` | Number | If amortizing |
| `LLC_BI__Use_of_Proceeds__c` | Long Text | Use of proceeds narrative |
| `LLC_BI__Collateral_Type__c` | Picklist | High-level collateral category |
| `LLC_BI__Collateral_Description__c` | Long Text | Collateral package detail |
| `LLC_BI__Lien_Position__c` | Picklist | 1st / 2nd / Unsecured |
| `LLC_BI__Risk_Rating__c` | Picklist (1-9) | **Current risk rating on file** |
| `LLC_BI__Loan_Status__c` | Picklist | Active / Past Due / Default / Workout |
| `LLC_BI__Stage__c` | Picklist | Workflow stage |
| `LLC_BI__Loan_Officer__c` | Lookup → User | RM on the loan |
| `LLC_BI__Approval_Date__c` | Date | Most recent credit approval |
| `LLC_BI__Annual_Review_Date__c` | Date | Last annual review |
| `LLC_BI__Next_Review_Date__c` | Date | Next scheduled review |
| `LLC_BI__Last_Payment_Date__c` | Date | Payment history reference |
| `LLC_BI__Days_Past_Due__c` | Number | DPD indicator |

Custom Acme Bank-specific fields to consider:

| Field | Type | Used for |
|---|---|---|
| `Pricing_Grid_Description__c` | Long Text Area | Pricing tier grid (e.g., "200-275 bps based on leverage") |
| `Borrowing_Base_Description__c` | Long Text Area | For ABL — advance rates, eligibles, ineligibles |
| `Conditions_Precedent__c` | Long Text Area | New money / amendment conditions |

---

## LLC_BI__Loan_Covenant__c (covenants)

The agent queries all covenants where `LLC_BI__Loan__c = <loan ID>`. One record per covenant.

| Field | Type | Used for |
|---|---|---|
| `Name` | Text | Covenant name (e.g., "Maximum Total Leverage") |
| `LLC_BI__Covenant_Type__c` | Picklist | Financial / Affirmative / Negative / Reporting |
| `LLC_BI__Test_Frequency__c` | Picklist | Quarterly / Semi-Annually / Annually / Event-Driven |
| `LLC_BI__Trigger__c` | Number | Numeric trigger value |
| `LLC_BI__Trigger_Operator__c` | Picklist | ≤ / ≥ / = / < / > |
| `LLC_BI__Trigger_Units__c` | Picklist | x (multiple) / % / $ |
| `LLC_BI__Direction__c` | Picklist | Maximum / Minimum |
| `LLC_BI__Currently_Active__c` | Checkbox | Whether the covenant is currently testing (some are conditional) |
| `LLC_BI__Description__c` | Long Text | Full covenant test definition from credit agreement |
| `LLC_BI__Last_Test_Date__c` | Date | Most recent compliance check |
| `LLC_BI__Last_Test_Result__c` | Picklist | Pass / Pass-Watch / Fail |
| `LLC_BI__Last_Actual_Value__c` | Number | Most recent computed actual |
| `LLC_BI__Notes__c` | Long Text | Compliance notes |
| `LLC_BI__Waived_Through_Date__c` | Date | If currently waived |

The agent computes the current period's actual from the Boom spread, compares to `LLC_BI__Trigger__c`, classifies green/amber/red per `covenant-checks.md`.

---

## LLC_BI__Collateral__c (collateral)

Queries where `LLC_BI__Loan__c = <loan ID>`. One record per collateral item.

| Field | Used for |
|---|---|
| `LLC_BI__Collateral_Type__c` | A/R, Inventory, Equipment, Real Estate, Stock Pledge, All Assets |
| `LLC_BI__Description__c` | Free-form description |
| `LLC_BI__Appraised_Value__c` | Most recent value |
| `LLC_BI__Appraisal_Date__c` | Valuation date |
| `LLC_BI__Lien_Position__c` | 1st / 2nd / Junior |
| `LLC_BI__Advance_Rate__c` | For ABL — % advanced against eligibles |

---

## LLC_BI__Guarantor__c (guarantors)

Queries where `LLC_BI__Loan__c = <loan ID>`. One record per guarantor.

| Field | Used for |
|---|---|
| `LLC_BI__Guarantor_Type__c` | Personal / Corporate / Parent / Subsidiary |
| `LLC_BI__Guarantor_Name__c` | Name |
| `LLC_BI__Guaranty_Amount__c` | Capped amount, if limited |
| `LLC_BI__Guaranty_Type__c` | Limited / Unlimited / Performance / Continuing |
| `LLC_BI__Net_Worth__c` | For personal guarantors |

---

## LLC_BI__Risk_Rating__c (rating history)

Queries where `LLC_BI__Loan__c = <loan ID>`, ordered by `LLC_BI__Rating_Date__c` descending.

| Field | Used for |
|---|---|
| `LLC_BI__Rating_Date__c` | Date of rating assignment |
| `LLC_BI__Rating__c` | The rating (1-9) |
| `LLC_BI__Rating_Rationale__c` | Why this rating was assigned |
| `LLC_BI__Assigned_By__c` | User who assigned |
| `LLC_BI__Trigger__c` | What caused the rating change (annual review, covenant breach, etc.) |

The agent reads the rating history to give the Risk Rating section context — has the rating moved? Why?

---

## LLC_BI__Exception__c (waivers and exceptions)

Queries where `LLC_BI__Loan__c = <loan ID>`. One record per exception or waiver.

| Field | Used for |
|---|---|
| `LLC_BI__Exception_Type__c` | Covenant Waiver / Documentation Exception / Reporting Exception |
| `LLC_BI__Description__c` | What's being waived/excepted |
| `LLC_BI__Effective_Date__c` | When granted |
| `LLC_BI__Expiration_Date__c` | When it ends |
| `LLC_BI__Approved_By__c` | Approving credit officer |

---

## Contact and User

**Contact**: borrower-side contacts (CFO, CEO, treasurer) where `AccountId = <borrower account>`. Fields: `Name`, `Title`, `Email`, `Phone`.

**User**: bank-side personnel. The agent identifies the RM via `Account.OwnerId` or `LLC_BI__Loan__c.LLC_BI__Loan_Officer__c`. Credit officer via custom `Credit_Officer__c` lookup. Fields: `Name`, `Title`, `Email`.

---

## LLC_BI__Document__c (DocMan documents)

Queries where the document is linked to either the borrower's Account or a Loan record. The agent reads document metadata to find:
- The most recent **credit agreement** (for covenant definitions and pricing terms)
- The most recent **prior credit memo** (for narrative continuity)
- The most recent **borrowing base certificate** (for ABL revolvers)

Key fields:
| Field | Used for |
|---|---|
| `LLC_BI__Document_Type__c` | Classification (Credit Memo, Credit Agreement, BBC, etc.) |
| `LLC_BI__Document_Category__c` | Folder grouping |
| `LLC_BI__Document_Date__c` | Effective date |
| `LLC_BI__Description__c` | Description |

For the memo upload step (memo PDF → nCino), the agent creates:
- `ContentVersion` (the file)
- `ContentDocumentLink` linking the resulting `ContentDocumentId` to `LLC_BI__Loan__c`
- Updates `LLC_BI__Document__c.LLC_BI__Document_Type__c` to "Credit Memo" or whatever the Acme Bank taxonomy uses

---

## What the agent does with all this

Reading order, when drafting a memo:

1. **Account** — establish borrower identity, NAICS, narrative raw material
2. **LLC_BI__Loan__c** (all linked) — full facility structure for the Loan Request section
3. **LLC_BI__Loan_Covenant__c** (all linked to loans) — for Covenant Compliance section
4. **LLC_BI__Collateral__c**, **LLC_BI__Guarantor__c** — for Collateral Analysis section
5. **LLC_BI__Risk_Rating__c** (history) — for Risk Rating section context
6. **LLC_BI__Exception__c** — for covenant narrative (any prior waivers)
7. **LLC_BI__Document__c** — locate credit agreement, prior memo, recent BBC
8. **Contact + User** — RM, credit officer, borrower contact names

Then it pulls (via MCP):
- Boom (spread line items)
- AFS (risk rating, covenant actuals, ratios, sensitivity — placeholder until it lands)
- AFS (revolver usage, payment history, balances)
- CapIQ/IBIS (peers + industry — placeholder; replaces EDGAR/FRED)

Then it composes the memo, using nCino narrative fields as raw material and synthesizing analysis from the current period's spread + computed ratios + peer comp + covenant tests.

---

## SOQL query patterns

The agent's query pattern, abstracted (real SOQL via the Salesforce Hosted MCP):

```sql
-- Account
SELECT Id, Name, BillingCity, BillingState, Industry, NumberOfEmployees,
       Description, OwnerId,
       NAICS_Code__c, LLC_BI__NaicsDesc__c, LLC_BI__Legal_Form__c, LLC_BI__Date_Established__c,
       History_Description__c, Ownership_Description__c, Segments_Description__c,
       End_Markets_Description__c, Geographic_Footprint_Description__c,
       Customer_Concentration_Description__c, Management_Description__c,
       Industry_Context_Description__c, Competitive_Landscape_Description__c,
       Credit_Officer__c, Region__c, Industry_Vertical__c
FROM Account WHERE Id = :borrowerId

-- Loans
SELECT Id, Name, LLC_BI__Loan_Type__c, LLC_BI__Product_Type__c,
       LLC_BI__Original_Loan_Amount__c, LLC_BI__Net_Balance__c,
       LLC_BI__Available_Amount__c, LLC_BI__Maturity_Date__c,
       LLC_BI__Interest_Rate__c, LLC_BI__Rate_Index__c, LLC_BI__Rate_Spread__c,
       LLC_BI__Use_of_Proceeds__c, LLC_BI__Collateral_Description__c,
       LLC_BI__Risk_Rating__c, LLC_BI__Loan_Officer__c
FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = :borrowerId

-- Covenants
SELECT Id, Name, LLC_BI__Covenant_Type__c, LLC_BI__Test_Frequency__c,
       LLC_BI__Trigger__c, LLC_BI__Trigger_Operator__c, LLC_BI__Direction__c,
       LLC_BI__Description__c, LLC_BI__Currently_Active__c,
       LLC_BI__Last_Test_Date__c, LLC_BI__Last_Actual_Value__c
FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :loanIds
```

(Field names may need verification against the actual BankingGPT sandbox schema — confirm before relying on these exact API names.)

---

## Failure modes

- **Querying with the wrong field name.** The nCino field API names listed here are the standard package names. Acme Bank's overlay may rename or add fields. Verify in sandbox via `getObjectSchema` before running production queries.
- **Missing the conditional-covenant flag.** `LLC_BI__Currently_Active__c` may be False for covenants that aren't currently testing — the agent must respect this.
- **Stale loan data.** The agent should pull the loan record fresh; if a cached version is used, an amendment or paydown could be missed.
- **Multiple loans on one Account, agent picks the wrong one.** Always ask the user to disambiguate if multiple `LLC_BI__Loan__c` records exist on the borrower's Account and the user's prompt didn't specify.
- **Missing narrative fields.** If the custom narrative fields are empty in the sandbox, the agent should write `[not in source system; flagged for RM verification]` rather than generate the narrative from thin air. Surface the gap so the sandbox owner can add the content.
