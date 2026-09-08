# The relationship JSON

One file describes one relationship completely. `seed_relationship.py` reads it,
`seed/examples/meridian.json` is relationship 1 of the design doc written in it, and
`seed/examples/zz-recipe-proof.json` is the throwaway the recipe was proved on.

JSON carries no comments, so the annotation lives here. Every field below is what
the seed script actually reads; anything not listed is ignored.

## Keys

Every record carries a `key`: a short slug, unique inside its own object, that the
manifest maps to the org id. Keys are how one record points at another (`"account":
"meridian-holdings"`, `"collateral": "ar-inventory"`) and how a re-run knows what it
already built. **Never change a key after a run**: the manifest would stop matching
and the re-run would build a second copy.

## Top level

| field | required | meaning |
|---|---|---|
| `slug` | yes | names the manifest, `seed/manifests/<slug>.json`. One per relationship. |
| `anchorKey` | yes | the account key the whole relationship hangs off. Every read tool is called with this account's id. |
| `accounts` | yes | the borrower and its household. |
| `connections` | yes | the ownership graph. |
| `collateral` | yes | the assets, their owners and their valuations. |
| `covenants` | yes | account-level covenants, their loan attachments and their history. |
| `packages` | yes | the product packages and the facilities inside them. |
| `reviews`, `riskRatingReviews`, `policyExceptions`, `opportunities`, `cases` | no | governance and CRM. |

## accounts[]

| field | meaning |
|---|---|
| `key`, `name` | identity. |
| `kind` | `business` (default) or `person`. A person account is created with FirstName/LastName; `name` is split on the first space. |
| `industry` | standard Account.Industry picklist. |
| `naics` | free text on `NAICS_Code__c`. The snapshot reads it. |
| `annualRevenue` | currency. The snapshot reads it. |
| `riskGrade` | text on `LLC_BI__Highest_Risk_Grade__c`. StructuralSignals reads it for guarantor distress. |
| `riskStatus` | `Low`, `Medium` or `High`. Also a guarantor-distress signal. |
| `nextReviewDate`, `lastReviewDate` | the relationship's review clock. The snapshot reads both; leave them off the anchor and the review card renders empty. |
| `billingCity`, `billingState`, `billingCountry` | address. |
| `description` | prose; the seed tag is appended to it. |

## connections[]

The ownership graph, `LLC_BI__Connection__c`.

| field | meaning |
|---|---|
| `key`, `from`, `to` | account keys. Direction matters: the owner is `from`, the owned is `to`. |
| `roleName` | must match a `LLC_BI__Connection_Role__c` record by name. The catalog is in `seed/reference/hartwell-LLC_BI__Connection_Role__c.json`. Useful ones: `Owner`, `Co-Owner`, `Parent`, `Subsidiary`, `Affiliated Company`, `Beneficial Owner`, `Officer`. |
| `ownershipPercent` | direct ownership. |
| `indirectOwnershipPercent` | ownership held through another entity. |
| `officialTitle`, `authorizedSigner`, `controlProng` | KYC colour. |
| `description` | prose; tagged. |

**The rule that decides whether the household card is right.** `Customer360RelationshipGraph`
returns only edges where the anchor is `from` or `to`. An owner who owns the borrower
through a holding company therefore does not appear at all. Give every household member
a DIRECT edge to the anchor carrying `indirectOwnershipPercent`, exactly the way Hartwell
does, on top of the structural edge that states the real chain.

## collateral[]

| field | meaning |
|---|---|
| `key`, `name` | identity. `name` lands on `LLC_BI__Collateral_Name__c`. |
| `typeName` | must match a `LLC_BI__Collateral_Type__c` record by name; see `seed/reference/hartwell-LLC_BI__Collateral_Type__c.json`. Every type in this org carries an 80 percent default advance rate, so a realistic LTV comes from the pledge override, not from here. |
| `value`, `liquidationValue` | currency. |
| `assessmentMethod` | `Appraisal`, `Net Book Value`, `Property Tax Assessment`, `Internal Valuation`, `Sales Invoice`. |
| `status` | `Pending`, `Available`, `Released`. Default `Available`. |
| `heldBy` | `None`, `Lender`, `Other Holder`. |
| `appraisalDate`, `nextRevaluationDate`, `valuationFrequency` | the revaluation clock. |
| `uccFiled`, `uccState`, `city`, `state` | filing and location. |
| `description`, `legalDescription` | prose; `description` is tagged. |
| `owners[]` | `account` (key), `association` (`Owner`, `Lessee`, `Lienholder`, ...), `percent`, `pledgingAuthority`, `primary`, `startDate`. **At least one is mandatory**: an asset with no `LLC_BI__Account_Collateral__c` row belongs to nobody. |
| `valuations[]` | `key`, `date`, `value`, `source`, `type`, `primary`, `active`, `original`, `description`. |

## covenants[]

| field | meaning |
|---|---|
| `key`, `typeName` | `typeName` must match a `LLC_BI__Covenant_Type__c` record. Nine names appear twice in the 71-entry catalog; where one does, add `typeId` with the id you mean or the run refuses rather than guessing. |
| `recordType` | `Financial Ratio` (default), `Financial Statements`, `Information`. |
| `threshold` | the number the test is against. Read by the cockpit as the threshold. |
| `operator` | `Greater Than`, `Less Than`, `Equals`, `Greater Tan or Equal To`, `Less Than or Equal To`. The fourth is spelled that way in the org; it is not a typo here. |
| `acnpexOperator` | the symbol form: `<`, `<=`, `=`, `>=`, `>`. |
| `frequency` | `Annually`, `Semi-Annually`, `Quarterly`, `Every 2 Months`, `Monthly`, `One-Off`, `Custom`. |
| `effectiveDate`, `dueDate`, `nextEvaluationDate` | the test clock. `nextEvaluationDate` drives the cockpit's days-remaining figure. |
| `lastEvaluationDate`, `lastEvaluationValue`, `lastEvaluationStatus` | what the last test found. The cockpit shows threshold against actual from these. |
| `covenantStatus` | `Compliant`, `In Progress`, `Exception`, `Waived`, `Pending`, ... |
| `breached`, `overdue` | booleans. |
| `graceDays`, `complianceDaysPrior` | `complianceDaysPrior` is a picklist of `7`, `14`, `30` as strings. |
| `detail`, `clause`, `notes` | prose; `notes` is tagged. |
| `loans[]` | loan keys. Creates a `LLC_BI__Loan_Covenant__c` junction per loan, which is what makes a covenant loan-level as well as relationship-level. |
| `evaluations[]` | `key`, `status` (`Compliant`, `Exception`, `In Progress`, `Pending`, `Waived`), `dueDate`, `effectiveDate`, `evaluationDate`, `value`, `exceptionReason` (`Breached` or `Overdue`), `comments`. |

The account association (`LLC_BI__Account_Covenant__c`) is created automatically beside
every covenant. It is not optional and it is not in the schema.

## packages[]

| field | meaning |
|---|---|
| `key`, `name` | nCino renames a package on insert; the script writes `name` back afterwards. |
| `stage` | `Pending`, `In Review`, `Complete`. A booked package is `Complete`. |
| `creditStage` | `Application`, `Credit Underwriting`, `Final Review`, `Credit Decisioning`, `Approved`, `Fulfillment`, `Booked`. A booked package is `Booked`. |
| `status` | `Approved` on a booked package. |
| `riskRating` | `1` to `10`. **The org's package picklist stops at 10**, so a design asking for a 12 cannot be held here; the review object goes to 12 and is where a 11 or 12 belongs. |
| `primaryEntity` | account key. Use the entity that really borrows on this package. |
| `description` | prose; tagged. |
| `tce`, `tbe`, `toe`, `outstanding` | optional overrides. Left off, they are derived from the loans: TCE and TBE are the sum of commitments, TOE and Outstanding the sum of balances. These are plain writable currency fields, **not** rollups the org maintains, and `Customer360Snapshot` sums them: leave them unset and the relationship reports zero exposure. |
| `loans[]` | see below. |

An unapproved package is `"stage": "Pending"`, `"creditStage": "Credit Underwriting"`,
`"status": "New"`, with its loan at `"stage": "Proposal"`. Never put a Proposal loan in
a booked package.

## packages[].loans[]

| field | meaning |
|---|---|
| `key`, `name`, `lookupKey` | `lookupKey` is **mandatory**: Loan_Validation_05 refuses the Booked stage without one. Keep it unique across the org; a per-relationship prefix works. |
| `product` | `Construction`, `Equipment`, `Line of Credit`, `HELOC`, `Purchase`, `Deposit`, `Term`. Note `Term`, not "Term Loan". |
| `productType` | `Real Estate`, `Non-Real Estate`, `Consumer Real Estate`, ... |
| `stage` | `Booked` on a booked package, `Proposal` in an unapproved one. **A loan must be born at its final stage**; see MODEL.md. |
| `status` | `Open` (default). `Closed` removes it from every cockpit read. |
| `riskGrade` | `0` to `15` on the loan (wider than the package's `1` to `10`). |
| `amount` | the commitment. |
| `outstanding` | the drawn balance. **Required for anything the cockpit should show as live**: `LLC_BI__Amount_Available__c` is a formula over commitment minus outstanding, so a loan without it reports no availability. On a line, keep it under `amount`. |
| `rate`, `noteRate` | `rate` is the current rate the cockpit shows; `noteRate` the note rate. |
| `index` | `Fixed`, `WSJ Prime`, `LIBOR`, `ARM`, the Treasury Constant Maturity series. |
| `spread` | percent over the index. |
| `termMonths`, `amortMonths` | term and amortisation. A balloon is a term shorter than the amortisation. |
| `applicationDate`, `closeDate`, `bookedDate`, `firstPaymentDate`, `maturityDate` | the dates. A first payment before the close date is refused. |
| `paymentSchedule` | `Weekly`, `Bi-Monthly`, `Monthly`, `Quarterly`, `Semi-Annual`, `Annual`, `Single Pay`. |
| `paymentType` | `Installment`, `Single Pay`, `Balloon`, `Draw Down Line Of Credit`, `Principal+Interest`, `Irregular`, `Generic Non-Disclosable`, `Construction Permanent`, `Revolving Line Of Credit`. |
| `interestAccrualMethod` | `30_360`, `Actual_360`, `Actual_365`, ... |
| `loanClass` | `New Loan`, `Secured Renewal`, `Unsecured Renewal`, `Refinance Existing Loan With Lender`. |
| `balloon`, `isSecured` | booleans. |
| `purpose` | a RESTRICTED picklist on the Loan Detail child. The legal values are listed in MODEL.md; a value outside them is refused. |
| `description` | prose; tagged. |
| `involvements[]` | `key`, `account`, `borrowerType` (`Borrower`, `Co-Borrower`, `Guarantor`, `Limited Guarantor`, `Related Entity`, `Grantor`, `Contractor`), `entityType` (`Operating Company`, `Sole Proprietorship`, `EPC`, `Individual`), `relationshipType`, `contingentType`, `ownership`, `guarantyType` (`Unlimited`, `Amount of Note`, `Limited`), `guarantyLimit`, `order`, `notes`. |
| `pledges[]` | `key`, `collateral` (key), `lienPosition` (`1st`, `2nd`, `3rd`, `Other`), `pledgedStatus`, `isPrimary`, `advanceRate`, `amountPledged`, `startDate`, `overrideReason`. |
| `fees[]` | `key`, `feeType`, `recordType` (`Fees`, `Costs`, `Adjustments`), `percentage` OR `amount`, `paidBy`, `payoutFrequency`, `isIncome`, `description`. A percentage fee never carries an amount: the org computes it from the basis. |
| `pricing` | `rateType` (`Fixed`, `Fixed with Index`, `Floating with Index`), `index`, `spread`, `rate`, `amortises`, `effectiveDate`, `endDate`, `termLength`, `amortMonths`, `paymentAmount`. The payment is computed if not given. |

## reviews[], riskRatingReviews[], policyExceptions[], opportunities[], cases[]

| object | fields |
|---|---|
| `reviews[]` | `key`, `type` (`Annual`, `AdHoc`, `Problem Loan`), `package`, `currentGrade` and `recommendedGrade` (`1` to `12` as strings), `narrative`, `summary`, `recommendation`, `riskComments`, `strengths`, `weaknesses`, `covenantsTested`, `covenantsPassed`, `toCommittee`. **`status` is ignored: RV02 refuses a review born at a post-approval stage**, so every seeded review is created In Progress. |
| `riskRatingReviews[]` | `key`, `status` (`Not Approved`, `Approved`, `Declined`, `In Review`), `computedGrade`, `cashFlowCoverage`, `creditScore`, `revenueGrowth`, `managementYears`, `year1`..`year3`, `comments`. `finalGrade` is accepted in the JSON and not written: the field is read-only for the integration profile. |
| `policyExceptions[]` | `key`, `name`, `type` (free text, `Policy` is the usual), `code`, `status` (`Waived`, `Mitigated`, `Unmitigated`), `severity` (free text, `Minor`/`Major`/`Critical`), `severityValue`, `loan`, `collateral`, `mitigation[]` (up to three reasons). |
| `opportunities[]` | `key`, `name`, `stage`, `amount`, `closeDate`, `type`, `probability`, `leadSource`, `nextStep`, `description`. |
| `cases[]` | `key`, `subject`, `status`, `priority`, `origin`, `type`, `description`. |
