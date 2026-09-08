# The nCino model this recipe writes

Derived from the reference relationship, Hartwell Precision Manufacturing LLC
(`001bb00001I7FPNAA3`), dumped field-for-field into `seed/reference/` on 2026-09-08, and
from the live describes in the same directory. Nothing here is remembered: every picklist
value, record type id and validation rule below was read off the bankinggpt sandbox
(`00DDz000001qeO2MAI`) or hit during the proof run.

Re-dump with `python3 seed/tools/dump-hartwell.py` and
`python3 seed/tools/describe-objects.py` when the org moves.

## 1. The objects, and who reads them

The read classes decide the shape. `knowledge/sf-build-v2/Customer360*.cls` are the
authority; a field no read class touches is decoration, and a field one of them filters
on is load bearing.

| Object | Written by the seed | Which read class needs it |
|---|---|---|
| `Account` | anchor + household | Snapshot (name, industry, NAICS, revenue, review dates), Signals (guarantor risk) |
| `LLC_BI__Connection__c` | ownership graph | RelationshipGraph (household) |
| `LLC_BI__Product_Package__c` | one per package | Snapshot (TCE/TBE/TOE/Outstanding, risk rating, credit stage) |
| `LLC_BI__Loan__c` | one per facility | Exposure (everything), Signals (maturity, package) |
| `LLC_BI__Loan_Detail__c` | **org-minted**, patched | loan purpose; carried in the manifest so cleanup can remove it |
| `LLC_BI__Legal_Entities__c` | involvements | RelationshipGraph (borrower/guarantor roles), Signals (guarantor distress) |
| `LLC_BI__Pricing_Stream__c` + rate + payment components | one set per loan | facility room pricing detail |
| `LLC_BI__Fee__c` | per loan | facility room fee list |
| `LLC_BI__Collateral__c` | per asset | Exposure, through the pledge |
| `LLC_BI__Account_Collateral__c` | ownership of the asset | association law: an asset with no owner row belongs to nobody |
| `LLC_BI__Loan_Collateral2__c` | pledges | Exposure (coverage ratio and shortfall) |
| `LLC_BI__Loan_Collateral_Aggregate__c` | **org-minted** | required master of the pledge; manifest-recorded |
| `LLC_BI__Collateral_Valuation__c` | per valuation | collateral valuation history |
| `LLC_BI__Covenant2__c` | account-level covenants | Covenants (the whole card) |
| `LLC_BI__Account_Covenant__c` | one per covenant | the association nCino's own UI writes |
| `LLC_BI__Loan_Covenant__c` | junction | makes a covenant loan-level |
| `LLC_BI__Covenant_Compliance2__c` | evaluation history | covenant history |
| `LLC_BI__Review__c` | annual review | governance signal |
| `LLC_BI__Annual_Review__c` | risk rating review | governance signal |
| `LLC_BI__Policy_Exception__c` | exceptions | exception list |
| `Opportunity` | whitespace | Opportunities |
| `Case` | service request | inbound trail |

Read but never written by the seed: `LLC_BI__Loan_Modification__c`, `LLC_BI__LoanRenewal__c`
(Signals reads both; a seeded relationship has neither, which is correct for a book that
has not yet been modified), `cm_Action_Staging__c` (ActionHistory; written by the cockpit).

Deliberately not written: `FinServ__AccountAccountRelation__c` (RelationshipGraph does not
query it; 8 rows org-wide), `KYC__c`, `Compliance_Check__c` (near-empty org-wide, and the
graph class says so in its own header).

## 2. Creation order, and why each edge exists

```
 1  Account                              anchor first, then the household
 2  LLC_BI__Connection__c                needs both accounts
      -> nCino MINTS the reciprocal edge (async)
 3  LLC_BI__Product_Package__c           needs the anchor account
      -> nCino RENAMES it on insert; the name is written back
 4  LLC_BI__Loan__c                      needs the package; born at its final stage
      -> nCino MINTS LLC_BI__Loan_Detail__c (async); purpose patched onto it
 5  LLC_BI__Legal_Entities__c            needs loan + package + account
 6  LLC_BI__Pricing_Stream__c            needs the loan
 7  rate + payment components            need the stream
 8  LLC_BI__Fee__c                       needs the loan
 9  LLC_BI__Collateral__c                independent
10  LLC_BI__Account_Collateral__c        needs collateral + account
11  LLC_BI__Collateral_Valuation__c      needs collateral
12  LLC_BI__Loan_Collateral2__c          needs loan + collateral
      -> nCino MINTS LLC_BI__Loan_Collateral_Aggregate__c and back-fills the pledge
13  LLC_BI__Covenant2__c                 needs the account
14  LLC_BI__Account_Covenant__c          needs the covenant
15  LLC_BI__Loan_Covenant__c             needs covenant + loan
16  LLC_BI__Covenant_Compliance2__c      needs the covenant
17  Review / Annual_Review / Policy_Exception / Opportunity / Case
18  package TCE/TBE/TOE/Outstanding      LAST: derived from the loans, so every loan is in
```

Cleanup is the manifest's own order reversed. It is generated, not hardcoded, so it cannot
drift from the creation order.

## 3. Record types

Only these are available to the integration profile. Everything else on these objects is
`available: false` and naming one is rejected outright.

| Object | Record type | Id |
|---|---|---|
| Account | Business | `012bb000000NNdRAAW` (Hartwell's; a second Business RT `012Hp000002JdCsIAK` also exists) |
| Account | Person Account | `012Hp000002JdDmIAK` |
| `LLC_BI__Loan__c` | Commercial Loan Record Type | `012bb000000NfLpAAK` |
| `LLC_BI__Covenant2__c` | Financial Ratio / Financial Statements / Information | `012bb000001SSLlAAO` / `012bb000001SSNNAA4` / `012bb000001SSOzAAO` |
| `LLC_BI__Review__c` | Account Review Complete / In Progress | `012bb000000NNeJAAW` / `012bb000000NNeKAAW` |
| `LLC_BI__Collateral__c` | **none: pass no RecordTypeId.** Every named type is unavailable | |
| `LLC_BI__Fee__c` | **none: use the `LLC_BI__Record_Type__c` PICKLIST** (`Fees`, `Costs`, `Adjustments`) | |
| Everything else | Master, the default | |

## 4. Picklists in use

**Package.** `LLC_BI__Stage__c`: Pending, In Review, Complete. `cm_Credit_Stage__c`:
Application, Credit Underwriting, Final Review, Credit Decisioning, Approved, Fulfillment,
Booked. `LLC_BI__Status__c`: New, In Review, Intermediately Approved, Approved,
Intermediately Rejected, Rejected, Recalled, Declined, Open, Complete, Hold, Lost,
Withdrawn, Approval Step 1 to 4. `LLC_BI__Approval_Status__c`: Not Submitted, Pending,
Ready. `LLC_BI__Deal_Type__c`: Loan Onboarding, Handover Loans. `LLC_BI__Risk_Rating__c`:
**1 to 10 only**. `LLC_BI__Review_Frequency__c`: Annually, Semi-Annually, Quarterly, Every
2 Months, Monthly.

A booked package is `Complete` / `Booked` / `Approved` / `Ready`. An unapproved package is
`Pending` / `Credit Underwriting` / `New` / `Not Submitted`, which is exactly the joinable
window `app/src/data/packageStage.ts` defines (package stage in {Pending, In Review}, credit
stage in {Application, Credit Underwriting, Final Review}, and no Booked or Complete
facility inside).

**Loan.** `LLC_BI__Stage__c`: Qualification, Proposal, Credit Underwriting, Final Review,
Approval / Loan Committee, Processing, Doc Prep, Closing, Boarding, Booked, Complete.
`LLC_BI__Status__c`: Hold, Withdrawn, Open, Paid Out, Declined, Charge-Off, Lost,
Pre-approval, Pre-approved, Pre-qualification, Pre-qualified. **Exposure filters
`Status != 'Closed'`, and `Closed` is not in that list**: the statuses that retire a
facility from the cockpit are the `isActiveFacility` set in `app/src/data/worklist.ts`.
`LLC_BI__Product__c`: Construction, Equipment, Line of Credit, HELOC, Purchase, Deposit,
**Term** (not "Term Loan"). `LLC_BI__Product_Type__c`: Real Estate, Non-Real Estate,
Consumer Real Estate, Consumer Non-Real Estate, Deposit. `LLC_BI__Payment_Type__c`:
Installment, Single Pay, Balloon, Draw Down Line Of Credit, Principal+Interest, Irregular,
Generic Non-Disclosable, Construction Permanent, Revolving Line Of Credit.
`LLC_BI__Payment_Schedule__c`: Weekly, Bi-Monthly, Monthly, Quarterly, Semi-Annual, Annual,
Single Pay. `LLC_BI__Index__c`: ARM, Fixed, LIBOR, WSJ Prime, Treasury Constant Maturity
1/2/3/5/7/10 Year +. `LLC_BI__Interest_Accrual_Method__c`: 30_360, Actual_360, Actual_365,
Actual_Actual and eleven more. `LLC_BI__Loan_Class__c`: New Loan, Secured Renewal,
Unsecured Renewal, Refinance Existing Loan With Lender. `LLC_BI__Risk_Grade__c`: 0 to 15.

**Loan purpose** (`LLC_BI__Loan_Detail__c.LLC_BI__Primary_Loan_Purpose__c`, RESTRICTED, 23
values): motor_vehicle, business_startup, business_expansion, business_acquisition,
construction_owner_occupied, construction_non_owner_occupied,
consumer_credit_line_unsecured, real_estate_purchase_owner_occupied,
real_estate_purchase_non_owner_occupied, business_credit_line,
business_credit_line_increase, home_equity_credit_line, home_equity_loan,
property_improvement_owner_occupied, property_improvement_non_owner_occupied, other,
pay_taxes_liens, equipment, refinance_other_lender, refinance_our_loan, unknown,
consumer_loan_unsecured, overdraft.

**Involvement.** `LLC_BI__Borrower_Type__c`: Borrower, Guarantor, Limited Guarantor,
Co-Borrower, Related Entity, Grantor, Contractor. `LLC_BI__Entity_Type__c`: Operating
Company, Sole Proprietorship, EPC, Individual. `LLC_BI__Guaranty_Amount__c`: Unlimited,
Amount of Note, Limited. `LLC_BI__Contingent_Type__c`: Joint & Several, Pro Rata, Assign
Specific. `LLC_BI__Relationship_Type__c`: Primary Owner, Secondary Owner, Joint Owner,
Deposit Household, Related Entity.

**Covenant.** `LLC_BI__Frequency__c`: Annually, Semi-Annually, Quarterly, Every 2 Months,
Monthly, One-Off, Custom. `Financial_Indicator_Operator__c`: Equals, Greater Than, Less
Than, **Greater Tan or Equal To** (the org's spelling), Less Than or Equal To.
`Acnpex_Operator__c`: `<`, `<=`, `=`, `>=`, `>`. `LLC_BI__Covenant_Status__c`: Pending, In
Progress, Compliant, Waived, Exception, breached, overdue, `<10% headroom`, `>10% headroom`,
Active, Pass, Fail. `LLC_BI__Compliance_Days_Prior__c`: 7, 14, 30 (as strings).
`LLC_BI__Covenant_Compliance2__c.LLC_BI__Status__c`: Compliant, Exception, In Progress,
Pending, Waived. `LLC_BI__Reason_for_Exception__c`: Breached, Overdue.

**Collateral.** `LLC_BI__Assessment_Method__c`: Appraisal, Net Book Value, Property Tax
Assessment, Internal Valuation, Sales Invoice. `LLC_BI__Status__c`: Pending, Available,
Released. `LLC_BI__Held_By__c`: None, Lender, Other Holder. `LLC_BI__Valuation_Frequency__c`:
Daily, Weekly, Monthly, Quarterly, Semi-Annually, Annually, Biennial.
`LLC_BI__Account_Collateral__c.LLC_BI__Collateral_Association__c`: Owner, Construction,
Landlord, Lessee, Lessor, Lienholder, Tenant, Buyer, Seller, Trustee, Assignee.
`LLC_BI__Loan_Collateral2__c.LLC_BI__Lien_Position__c`: 1st, 2nd, 3rd, Other;
`LLC_BI__Pledged_Status__c`: Active, Inactive, Pending.
`LLC_BI__Collateral_Valuation__c.LLC_BI__Source__c`: Account Balance / Statement, Appraisal,
Credit Officer, Financial Statement, Insurance Agent, Internal Valuation, Inventory Report,
Invoice / Bill of Sale, Real Estate Abundance of Caution, Receivables Aging, Real Estate;
`LLC_BI__Type__c`: Actual Cash Value, As Complete Value, As Is Value, As Stabilized Value,
Balance Sheet, Book Value, Cash Balance, Contents Value, Fair Market Value - Real Estate,
Fair Market Value - Equipment / Transportation, Net Orderly Liquidation Value, Orderly
Liquidation Value and others.

**Fee.** `LLC_BI__Fee_Type__c` is a residential and TRID list: Appraisal, Attorney, Credit
Report, Flood Insurance, Government Recording, **Loan Origination**, Settlement/Close,
Survey, Title Insurance, Title Search, **Other**, and twenty-odd consumer entries. There is
**no unused-commitment entry**, so an unused fee is booked as `Other` with the intent in
`LLC_BI__Fee_Type_Description__c` (founder call, 2026-08-31, carried forward here).
`LLC_BI__Calculation_Type__c`: Flat Amount, Percentage. `LLC_BI__Record_Type__c`: Fees,
Costs, Adjustments. `LLC_BI__Paid_By__c`: Bank Paid, Financed from Proceeds, Paid Outside
Closing, Paid by Seller, Waived.

**Governance.** `LLC_BI__Review__c.LLC_BI__Review_Type__c`: Annual, AdHoc, Problem Loan;
`LLC_BI__Status__c`: In Progress, Pending Approval, Complete; `cm_Review_Stage__c`:
Qualification, Underwriting, Final Review, Approval, Complete;
`cm_Current_Relationship_Risk_Rating__c` and `cm_Recommend_Relationship_Rating__c`: **1 to
12** (wider than the package's 1 to 10, which is where an 11 or 12 has to live).
`LLC_BI__Annual_Review__c.LLC_BI__Status__c`: Not Approved, Approved, Declined, In Review.
`LLC_BI__Policy_Exception__c.LLC_BI__Status__c`: Waived, Mitigated, Unmitigated
(`LLC_BI__Type__c` and `LLC_BI__Severity__c` are free TEXT, not picklists).
`Opportunity.StageName`: Qualification, Needs Analysis, Proposal, Negotiation, Closed Won,
Closed Lost, Credit Underwriting, Final Review, Approval / Loan Committee, Processing, Doc
Prep, Closing. `Case.Type`: Problem, Feature Request, Question, Complaint, Vehicle
Maintenance, Service Request.

## 5. Catalogs the seed resolves by name

Resolved at run time against the org, refused loudly when absent, and refused when
ambiguous rather than guessing.

- **`LLC_BI__Covenant_Type__c`, 71 records.** Nine names are duplicated (Business Financial
  Statement, Personal Financial Statement, Lease Information, Tax Returns, Global Debt
  Service Coverage, Fixed Asset Purchases, Limiting Compensation, Minimum Times Interest
  Earned, Minimum Working Capital, Debt Service Coverage with and without Distributions).
  Naming one of those requires `typeId`. Useful unambiguous ones: `Debt Service Coverage of
  Borrower` (`a3Gbb000000PLNqEAO`), `Maximum Debt to Worth` (`a3Gbb000000PLNuEAO`),
  `Minimum Liquidity` (`a3Gbb000000PLNyEAO`), `Minimum Current Ratio` (`a3Gbb000000PLO1EAO`),
  `Accounts Receivable` (`a3Gbb000000PdkXEAS`), `Leverage` (`a3Gbb000000a2OHEAY`),
  `Minimum Working Capital Ratio` (`a3Gbb000000PLNtEAO`), `Debt to Equity`
  (`a3Gbb000000PLNpEAO`), `Term Covenants` (`a3Gbb000000PdkaEAC`), `EBITDA`
  (`a3Gbb000000PLO3EAO`), `Net Worth` (`a3Gbb000000PLNxEAO`), `Rent Roll`
  (`a3Gbb000000PLO9EAO`), `Collateral Insurance` (`a3Gbb000000PdkZEAS`).
- **`LLC_BI__Collateral_Type__c`, 43 records.** `Real Estate-Construction` appears twice
  (80 and 90 percent). **Every type carries an 80 percent default advance rate** except that
  one, so a realistic LTV comes from `LLC_BI__Advance_Rate_Override__c` on the pledge and
  from nowhere else. The set spans Real Estate (Warehouse, Office, Retail, Multi-Family,
  Land, Farm Land, Lot, 1-4 Family, Other RE, Construction), UCC (Accounts, Inventory,
  Equipment, Crops, Livestock, Farm Products, Farm Equipment, General Intangibles, Fixtures,
  Chattel Paper, Minerals Oil and Gas, Standing Timber, Tort Claim, Consumer Goods),
  Possessory (Savings/CDs, Securities, Life Insurance, Letter of Credit, Note/Instrument,
  Receipts/Bills, Other) and Titled (Motor Vehicle, Trailer, Aircraft, Ship, Vessel,
  Pleasure Boat, Mobile Home, Other).
- **`LLC_BI__Connection_Role__c`, 35 records.** `Original Account`, `Portal Enabled Account`
  and `Duplicate Account` each appear twice. Unambiguous and useful: `Owner`
  (`a37bb000000fAy2AAE`), `Co-Owner` (`a37bb000000fAy8AAE`), `Parent`, `Subsidiary`,
  `Affiliated Company`, `Beneficial Owner`, `Officer`, `Household Member`, `Spouse`,
  `Business Partner`, `Related`.

## 6. Validation rules and triggers that bit

Every one of these was hit for real during the proof run or is recorded from the earlier
Hartwell builds. This is the list an agent should expect to meet.

| # | What happens | Why | What the recipe does |
|---|---|---|---|
| 1 | `Loan_Validation_05`: Booked stage refused when `LLC_BI__lookupKey__c` is blank | booking needs a servicing key | `lookupKey` is mandatory in the schema and the validator refuses a Booked loan without one |
| 2 | `Loan_Validation_06`: a MOVE to Booked from any pre-approval stage is refused | it reads PRIORVALUE, so it fires on update and never on insert. A facility reaches servicing through Submit for Approval, not a PATCH | **loans are born Booked.** Create-then-promote cannot work |
| 3 | `RV02`: "You Cannot Manually Change the Review to a Post Approval Stage" | a review is approved by pressing Submit for Approval | every seeded `LLC_BI__Review__c` is created **In Progress** at Qualification. The design's "one completed annual review" is a shortfall the agent reports; it is not forced |
| 4 | `INVALID_FIELD_FOR_INSERT_UPDATE` on `LLC_BI__Legal_Entities__c.LLC_BI__Limited_Guaranty_Amount__c` | field-level security for the integration profile, despite `createable: true` on the describe | dropped. `LLC_BI__Guarantee_Limit__c` carries the cap |
| 5 | Same, on `LLC_BI__Fee__c.LLC_BI__Is_Paid_By_Borrower__c` | as above | dropped |
| 6 | Same, on `LLC_BI__Annual_Review__c.LLC_BI__Final_Risk_Grade__c` | the org derives it | only `LLC_BI__Computed_Risk_Grade_Value__c` is written |
| 7 | `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST` on the loan purpose | 23-value restricted picklist; "real_estate_improvement_owner_occupied" is not one of them | the validator checks purpose offline against the describe |
| 8 | `DUPLICATE_VALUE` on a `lookupKey` derived from a record key | those fields are UNIQUE EXTERNAL IDS **org-wide**, and a record key is only promised to be unique inside its own spec. The first shape, `C360-SEED-2026-09/<key>`, held for one relationship at a time and broke the moment seven were built side by side: four specs named an asset `receivables` or `inventory`, so Meridian took `receivables-0` and Blue Ridge, Cascade, Prairie Ag and Lakeshore were each refused a row against a record they could not see | the derived value is `C360-SEED-2026-09/<slug>/<key>`, minted in ONE place (`unique_key` in seed_relationship.py) and imported by the validator so the two cannot drift. It covers `LLC_BI__Account_Collateral__c`, `LLC_BI__Loan_Collateral2__c` and the pricing stream with both its components. `validate_spec.py --all` compares the derived values ACROSS specs, which is the only place this collision is visible before it costs a run. **Records already created under the older shape are never renamed**: the seed resolves by manifest id first and only mints a key for a record it is about to create |
| 9 | `INVALID_FIELD`: no `LLC_BI__Floor_Rate__c` on `LLC_BI__Pricing_Rate_Component__c` | it does not exist in this org | dropped; a floor belongs in the note or the covenant |
| 10 | A package comes back named "`<account>` - `<date>` - PP", and a LOAN comes back named "`<account>` - `<product>` - `<amount>`" | nCino's own flows rename both on insert, off the ACCOUNT LOOKUP. Every loan carries the ANCHOR account (fact 3 in section 7), so a subsidiary's note reads under the anchor's name: Lakeshore's distribution centre mortgage was written as "Lakeshore Logistics LLC - Purchase - $5,900,000.00" and is stored as "Lakeshore Dental Supply Distributors Inc - Purchase - $5,900,000.00". Blue Ridge and Northgate read the same way for every subsidiary facility | the PACKAGE name is PATCHed back immediately after create. **The LOAN name is left exactly as the org wrote it.** Patching it would fight the org's own naming on every re-run and on every renewal, and the real borrower is not lost: it is on the involvement row (`LLC_BI__Legal_Entities__c`, Borrower at order 1) and on the package's `LLC_BI__Primary_Entity__c`, which is where `Customer360RelationshipGraph` and the facility room read it |
| 11 | `LLC_BI__Loan_Detail__c` query right after the loan insert returns nothing | the flow that mints it is ASYNCHRONOUS | polled with backoff, then recorded in the manifest and patched with the purpose. Recording it matters: an unrecorded detail is an orphan cleanup is not allowed to delete |
| 12 | **Zero or one** second `LLC_BI__Connection__c` appears for each one created | nCino mints the reciprocal edge asynchronously, and only for the roles that have one. `Owner`, `Co-Owner` and `Officer` mirror as `Company`; `Partner` and `Affiliated Company` mirror as themselves; **`Beneficial Owner` mirrors as nothing at all**, which is why Sunbelt's eight edges produced four mirrors and Cascade's seven produced six | polled and recorded as derived, however many turn up. The poll waits for one per edge and then settles for what the org gave, so a relationship built on `Beneficial Owner` edges costs a few seconds of waiting and records the truth. Skipping this entirely would drift the org by the number of household members |
| 13 | `LLC_BI__Loan_Collateral_Aggregate__c` is required on the pledge describe, and a pledge inserts fine without it | a before-insert trigger mints and back-fills it | never authored; read back off the pledges and recorded as derived |
| 14 | `ENTITY_IS_DELETED` during cleanup | master-detail cascades. Deleting an aggregate takes its pledges; deleting a connection takes its reciprocal | cleanup counts it as success, not failure |
| 15 | A pledge above current lendable value is refused: "You are trying to pledge more than the current lendable value of this collateral. You must check the Authorize Pledge Amount checkbox to continue." | the org will not invent coverage the appraisal does not support | pledge at or below value x advance rate, and **the validator now does that arithmetic offline** so the spec fails on the desk instead of at insert. A pledge with no `advanceRate` is measured against the org's 80 percent default. A junior lien carries its own slice as its advance rate rather than being netted against the senior one, which is what the org accepted on all seven |
| 16 | A `LLC_BI__Collateral__c` create naming any non-Master record type is rejected | every named RT is unavailable to this profile | no RecordTypeId is sent |
| 17 | `LLC_BI__Fee__c` refuses `RecordTypeId` | same | the object's own `LLC_BI__Record_Type__c` picklist is used |
| 18 | A percentage fee refuses a supplied Amount | the org computes it from `LLC_BI__Basis_Source__c` and `LLC_BI__Percentage__c` | percentage and amount are mutually exclusive; the validator enforces it |
| 19 | A first payment date before the projected close date is refused | | the validator checks it offline |
| 20 | An org-local `PolicyExceptionCDC` trigger relays every `LLC_BI__Policy_Exception__c` create to an external AWS endpoint | sandbox EventBridge relay, probed 2026-08-31: no approval process, no email | accepted knowingly; nothing seeded is real customer data |
| 21 | `STRING_TOO_LONG` on four fields, every one of them hit by the seven runs | a credit officer's sentence is longer than the field. The two the seed tags lose twenty more characters to ` [C360-SEED-2026-09]` | hard limits in `validate_spec.py`, listed below the table. The prose has to be cut in the spec, never at run time: a spec that says one thing and an org record that says a shorter one is a relationship nobody can reproduce |

**The four fields, and what fits in them.**

| Field | Holds | Budget in the spec | Why the budget is smaller |
|---|---|---|---|
| `LLC_BI__Policy_Exception__c.LLC_BI__Mitigation_Reason_1__c` (and `_2`, `_3`) | 100 | **100** | not tagged. One clause per reason, three reasons available |
| `LLC_BI__Fee__c.LLC_BI__Fee_Type_Description__c` | 255 | **230** | the seed appends the tag here |
| `LLC_BI__Collateral__c.LLC_BI__Description__c` | 255 | **235** | the seed appends the tag here |
| `LLC_BI__Collateral_Valuation__c.LLC_BI__Valuation_Description__c` | 255 | **255** | not tagged; the tag goes on `LLC_BI__Comments__c`, a long text area |

The mitigation reasons are the tightest and the most often over: 100 characters is one sentence, and the
argument for a waiver wants three. Meridian's live records are the shape that fits, one clause each: the
cause, the guaranty that survives it, the number that did not move.

## 7. The four field facts that decide whether the cockpit looks right

1. **`LLC_BI__Product_Package__c.LLC_BI__TCE__c` and friends are plain writable currency
   fields, not rollups.** `Customer360Snapshot` sums them across the packages. Leave them
   unset and a nine-facility relationship reports zero exposure. The seed derives them from
   the loans and writes them last.
2. **`LLC_BI__Loan__c.LLC_BI__Amount_Available__c` is a FORMULA** over commitment minus
   `LLC_BI__AmountOutstanding__c`. A loan with no outstanding balance therefore reports no
   availability, and the cockpit's drawn-against-committed line renders empty. Hartwell's
   original seven carry `LLC_BI__Principal_Balance__c` and no `AmountOutstanding`, which is
   why they read as fully available; the recipe writes both.
3. **Every loan's `LLC_BI__Account__c` is the ANCHOR account**, even where the story's
   borrower is a household entity. `Customer360Exposure` and `Customer360StructuralSignals`
   both filter loans by that lookup, so a facility hung off a subsidiary is invisible to the
   cockpit. The entity that really borrows is carried on its involvement row, which is where
   nCino models it and where `Customer360RelationshipGraph` reads it. The package's
   `LLC_BI__Primary_Entity__c` names it too.
4. **`Customer360RelationshipGraph` returns only edges that TOUCH the anchor.** An owner who
   owns the borrower through a holding company has no edge to the borrower and does not
   appear at all: the first proof run lost two of four owners this way. Every household
   member needs a DIRECT edge to the anchor carrying `indirectOwnershipPercent`, on top of
   the structural edge stating the real chain. Hartwell does exactly this.

## 8. Where the seed tag lives

Every record carries `C360-SEED-2026-09` in a free-text field:

| Object | Field |
|---|---|
| Account, Connection, Product Package, Loan, Collateral | `Description` / `LLC_BI__Description__c` |
| Legal Entities, Covenant2 | `LLC_BI__Notes__c` |
| Covenant Compliance2, Annual Review, Collateral Valuation | `LLC_BI__Comments__c` |
| Review | `LLC_BI__Narrative__c` |
| Fee | `LLC_BI__Fee_Type_Description__c` |
| Policy Exception | `LLC_BI__Code__c` |
| Opportunity, Case | `Description` |
| Pricing Stream + both components, Account Collateral, Loan Collateral2 | `lookupKey` fields, as `C360-SEED-2026-09/<slug>/<key>` because they are unique ORG-WIDE, not per relationship (section 6, row 8) |

**The tag is a marker for a person reading the record, not a query key.** Several of the
fields it lands in are long text areas the org refuses to filter on
(`Account.Description` among them), so `WHERE ... LIKE '%C360-SEED-2026-09%'` fails outright
on some objects and is never how anything is found. The manifest is the index.

**Two objects carry no tag and cannot**: `LLC_BI__Account_Covenant__c` and
`LLC_BI__Loan_Covenant__c` expose no createable text field of any kind. They are
manifest-only, and they are reachable from their covenant and their loan, so nothing about
them is unfindable. The manifest, not the tag, is what cleanup uses.

## 9. What the org cannot hold from the design doc

| The design asks for | The org's answer |
|---|---|
| a risk grade on the 1 to 12 scale | the **package** picklist stops at 10; the **loan** goes to 15; the **review**'s relationship rating goes to 12. Put an 11 or 12 on the review and keep the package inside 1 to 10 |
| one **completed** annual review | RV02 refuses a review born at a post-approval stage. Seeded reviews are In Progress |
| an unused commitment fee | the Fee Type picklist is residential and TRID and has no such entry. Booked as `Other`, intent in the description |
| inbound requests in the trail | there is no inbound-request object; `Case` is the nearest and is what the recipe writes |
| a rate floor on the pricing component | no floor field exists on `LLC_BI__Pricing_Rate_Component__c` in this org |
| a facility named for the entity that borrows it | nCino renames every loan off its ACCOUNT LOOKUP, which is always the anchor. A subsidiary's note reads under the anchor's name; the borrower survives on the involvement row and the package's primary entity (section 6, row 10) |
| the argument for a waiver, in full | `LLC_BI__Mitigation_Reason_1..3__c` hold 100 characters each (section 6, row 21) |


## HARD RULE added 2026-09-08: no compliance rows

Do not seed `LLC_BI__Covenant_Compliance2__c`. Every insert fires `acnpex_covenantApprovalProcess` unconditionally at a hard-coded human. The seed script skips the `evaluations` block unless `ALLOW_COMPLIANCE_ROWS=1`; leave `evaluations` in the spec only as documentation, and put the covenant's history on `lastEvaluationValue`, `lastEvaluationStatus`, `lastEvaluationDate` and `nextEvaluationDate` of the covenant itself. The covenant review room will report 'no open test period' on these relationships; that is expected and must be logged as such, not as a defect.
