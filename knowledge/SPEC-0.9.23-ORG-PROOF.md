# 0.9.23 org proof, on bankinggpt-at

Run this line by line. Every id below was read off the live org on 2026-09-13; nothing here is from
memory. The Apex was validated against the org before this file was written (see section 0), so a
failure at any step is an org fact rather than a compile surprise.

**Section A (amend-version) is complete. Section B (discard-version) is A2's and is appended below
it.** The two share one deploy and one revert.

---

## 0. What is already proven, and what is not

`sf project deploy validate` (a read-only validation deploy that runs the tests on the org and saves
nothing) was run on 2026-09-13 and succeeded:

```
Deploy ID: 0Afbb00000DvXarCAF      Status: Succeeded
Components: 4/4      Test Results Summary: Passing 82, Failing 0, Total 82 (57.7s)
StageAmendVersion      coverage 597/674  = 88.58%
ExecuteAmendVersion    coverage 589/744  = 79.17%
StageLoanModification  coverage 1411/1643 = 85.88%   (its own suite, unchanged, still green)
```

What that does NOT prove, and what this file is for: a real version on a real relationship, amended
through the wire, read back out of the org.

---

## 1. The deploy

Two steps, in this order, and the order is a platform rule rather than a preference: the API catalog
only knows an Apex class AFTER it is deployed, so a server-definition deploy that names a class the
org has not compiled fails with `No "aa:apex-X" identifier found for source "API_CATALOG"`
(LESSONS 5).

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/sf-build-v2
```

**Step 1, the classes.** `StageLoanModification` is in this deploy and WILL land as `Changed`. That
is expected and it is additive: thirteen arm parsers moved from `private static` to `public static`
so `StageAmendVersion` can call them instead of carrying a second copy. No body changed, and its own
suite (67 tests) runs in this same deploy to prove it.

```bash
sf project deploy start -o bankinggpt-at \
  -m ApexClass:StageLoanModification \
  -m ApexClass:StageAmendVersion \
  -m ApexClass:ExecuteAmendVersion \
  -m ApexClass:StageExecuteAmendVersionTest \
  -m ApexClass:StageDiscardVersion \
  -m ApexClass:ExecuteDiscardVersion \
  -m ApexClass:StageExecuteDiscardVersionTest \
  -l RunSpecifiedTests \
  -t StageExecuteAmendVersionTest \
  -t StageExecuteDiscardVersionTest \
  -t StageExecuteLoanModificationTest
```

Expect `Changed` on `StageLoanModification` and `Created` on the other six. A `Changed` receipt on
anything else is a STOP (LESSONS section 3c).

*Amend-only fallback, if the discard pair is not ready:* drop the three `DiscardVersion` lines and
the `-t StageExecuteDiscardVersionTest`, and skip step 2 until it is: the server definition now
carries all four tool rows and cannot deploy until all four classes exist.

**Step 2, the server definition**, which adds the four tool rows (`StageAmendVersion`,
`ExecuteAmendVersion`, `StageDiscardVersion`, `ExecuteDiscardVersion`):

```bash
sf project deploy start -o bankinggpt-at -m McpServerDefinition:Customer360
```

---

## 2. Section A, the amend proof

### 2.0 Environment

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented
read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"
export TOK INST

export HARTWELL_ACCOUNT=001bb00001I7FPNAA3
export BOOKED_PKG=a5Fbb000000IHFJEA4          # Hartwell's booked anchor package, 7 members
export BOOKED_LOC=a4Zbb0000027MaYEAU          # the $15M Line of Credit, Booked/Open, rate 7.60
export APPROVER=005bb00000ftouDAAQ
export DSC_TYPE=a3Gbb000000PLNqEAO            # LLC_BI__Covenant_Type__c "Debt Service Coverage of Borrower"
export ASSET=a35bb0000019cv8AAA               # COL-000774, Zeiss CMM et al, value 2,100,000, owned by Hartwell

api() { curl -sS -X POST "$INST/services/data/v67.0/actions/custom/apex/$1" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$2"; }
```

Baseline before anything runs (keep this output):

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT')"
```

Expect **1 package, 7 loans, 0 chain rows**.

### 2.1 The NEGATIVE case first, because it writes nothing

`stage_amend_version` against Hartwell's BOOKED package. This runs before anything is created, so a
failure here costs nothing and a pass proves the gate refuses live business.

```bash
api StageAmendVersion '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-amend-booked",
  "versionPackageId":"'"$BOOKED_PKG"'",
  "rationale":"Org proof: the gate must refuse a booked package.",
  "scalarChangesJson":"[{\"key\":\"requestedRate\",\"value\":7.10,\"targetLoanId\":\"'"$BOOKED_LOC"'\"}]"
}]}' | python3 -m json.tool
```

**Expect** `isSuccess: true` at the platform level (the tool refuses inside its own envelope, it does
not fault) with `outputValues.ok = false` and:

```
error.code    = PACKAGE_BOOKED
error.message = "... carries Hartwell Precision Manufacturing LLC - Line of Credit - $15,000,000.00
                 at stage Booked, so this package is live business ... A change to a booked facility
                 is a MODIFICATION ..."
```

Prove nothing was staged:

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c = 'zz-orgproof-20260913-amend-booked'"
```

Expect **0**.

### 2.2 Create the version (the deployed modification pair, unchanged)

```bash
api StageLoanModification '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-mod",
  "productPackageId":"'"$BOOKED_PKG"'",
  "facilityIds":["'"$BOOKED_LOC"'"],
  "rationale":"Org proof: create a version to amend.",
  "scalarChangesJson":"[{\"key\":\"requestedAmount\",\"value\":16000000,\"targetLoanId\":\"'"$BOOKED_LOC"'\"}]"
}]}' | python3 -m json.tool
```

Capture `stagingId`, `planHash`, `decisionToken` from the response, then:

```bash
export MOD_STAGING=<stagingId>
export MOD_HASH=<planHash>
export MOD_TOKEN=<decisionToken>

api ExecuteLoanModification '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-mod",
  "stagingId":"'"$MOD_STAGING"'",
  "planHash":"'"$MOD_HASH"'",
  "decisionToken":"'"$MOD_TOKEN"'",
  "approverUserId":"'"$APPROVER"'"
}]}' | python3 -m json.tool
```

Capture from the response:

```bash
export NEW_PKG=<outputPackageId>                  # the new package VERSION
export CLONE=<facilities[0].cloneLoanId>          # the clone of the $15M line, on NEW_PKG
```

**Expect** `terminalState` `success` or `partial` with `armState` `relayed`, `outputPackageId`
different from `$BOOKED_PKG`, and six members rolled. Confirm the version and its editability:

```bash
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__Is_Modification__c, LLC_BI__Amount__c, LLC_BI__InterestRate__c FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$NEW_PKG' ORDER BY LLC_BI__Amount__c DESC"
```

**Expect** every member at `Qualification`, `Is_Modification__c` true, none at
`Approval / Loan Committee`. That is the state `stage_amend_version` requires.

### 2.3 The amend: rate 7.10, one covenant add, one pledge add

One call, one plan, one decision token, three arms, all aimed at the CLONE.

```bash
api StageAmendVersion '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-amend",
  "versionPackageId":"'"$NEW_PKG"'",
  "rationale":"Org proof: shape the version in place before committee.",
  "scalarChangesJson":"[{\"key\":\"requestedRate\",\"value\":7.10,\"targetLoanId\":\"'"$CLONE"'\"}]",
  "covenantAddsJson":"[{\"typeId\":\"'"$DSC_TYPE"'\",\"threshold\":1.30,\"operator\":\">=\",\"frequency\":\"Quarterly\",\"effectiveDate\":\"2026-10-01\",\"targetLoanId\":\"'"$CLONE"'\"}]",
  "pledgeAddsJson":"[{\"collateralId\":\"'"$ASSET"'\",\"targetLoanId\":\"'"$CLONE"'\"}]"
}]}' | python3 -m json.tool
```

**Expect** `ok = true`, `versionKind` `in-flight version`, `facilityCount` 1, `executionHeld` false,
`facilities[0].fields = ["LLC_BI__InterestRate__c"]` with `toValues = ["7.10"]` and `fromValues`
carrying whatever the clone reads now, and a `decisionToken`. Capture:

```bash
export AMEND_STAGING=<stagingId>
export AMEND_HASH=<planHash>
export AMEND_TOKEN=<decisionToken>
```

Prove staging wrote no domain record (A33.0.1):

```bash
sf data query -o bankinggpt-at -q "SELECT LLC_BI__InterestRate__c FROM LLC_BI__Loan__c WHERE Id = '$CLONE'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = '$CLONE'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = '$CLONE' AND LLC_BI__Collateral__c = '$ASSET'"
```

The rate is still the pre-amend figure and the covenant count is unchanged. Now execute:

```bash
api ExecuteAmendVersion '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-amend",
  "stagingId":"'"$AMEND_STAGING"'",
  "planHash":"'"$AMEND_HASH"'",
  "decisionToken":"'"$AMEND_TOKEN"'",
  "approverUserId":"'"$APPROVER"'"
}]}' | python3 -m json.tool
```

**Expect** `ok = true`, `terminalState` `success`, `facilityCount` 1, `facilities[0].facilityId`
equal to `$CLONE` (there is no clone of a clone: the amend writes to the version's own loan), one
entry in `covenants[]` with its org-assigned `covenantName`, and one in `pledges[]` carrying the
advance rate the ORG resolved.

### 2.4 The SOQL that proves each arm

```bash
# (a) the rate landed on the version loan itself
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__InterestRate__c, LLC_BI__Amount__c, LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = '$CLONE'"
#     EXPECT LLC_BI__InterestRate__c = 7.10, stage still Qualification.

# (b) the covenant exists on the BORROWER, is junctioned to the version loan, and carries its
#     account association. Three rows, three questions.
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c, LLC_BI__Active__c, LLC_BI__Account__c FROM LLC_BI__Covenant2__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT' AND LLC_BI__Financial_Indicator_Value__c = 1.30 ORDER BY CreatedDate DESC LIMIT 1"
sf data query -o bankinggpt-at -q "SELECT Id, LLC_BI__Loan__c, LLC_BI__Covenant2__c, LLC_BI__Covenant2__r.Name FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = '$CLONE'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Account_Covenant__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT' AND LLC_BI__Covenant2__c = '<the covenant id from above>'"
#     EXPECT the covenant Pending/Active at 1.30, exactly one junction on $CLONE, exactly one account row.

# (c) the pledge is on the version loan, over the named asset, with an aggregate and the org's own
#     advance rate and lendable value (both formulas: they are REPORTED, never asserted).
sf data query -o bankinggpt-at -q "SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Collateral__r.Name, LLC_BI__Amount_Pledged__c, LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c, LLC_BI__Loan_Collateral_Aggregate__c, LLC_BI__Pledged_Status__c FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = '$CLONE' AND LLC_BI__Collateral__c = '$ASSET'"
#     EXPECT one row, Pledged_Status Active, Loan_Collateral_Aggregate NOT null.

# (d) NOTHING moved on the booked parent, or on the booked package.
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Amount__c, LLC_BI__InterestRate__c, LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = '$BOOKED_LOC'"
#     EXPECT amount 15,000,000, rate 7.6, stage Booked. Unchanged.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = '$BOOKED_LOC'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = '$BOOKED_LOC' AND LLC_BI__Collateral__c = '$ASSET'"
#     EXPECT both unchanged from the baseline: an amend touches the version and nothing else.

# (e) NO new package version and NO new facility. An amend versions nothing.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
#     EXPECT 2: the booked package and the one version the MODIFICATION created. Not 3.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$NEW_PKG'"
#     EXPECT the same count as section 2.2 read.

# (f) the action trail row, which is the cm_Action_Staging__c record itself.
sf data query -o bankinggpt-at -q "SELECT Id, cm_Action_Id__c, cm_Status__c, cm_Product_Package__c, cm_Account__c, cm_Result_Record_Id__c, cm_Approver_User__c, cm_Executed_At__c FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c = 'zz-orgproof-20260913-amend'"
#     EXPECT cm_Action_Id__c = 'amend-version', cm_Product_Package__c = $NEW_PKG (the contract's
#     "productPackageId = versionPackageId"), cm_Status__c Completed, approver set, executed_at set.
```

### 2.5 Idempotency, on the wire

Re-send the EXACT same execute call from 2.3.

```bash
api ExecuteAmendVersion '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-amend",
  "stagingId":"'"$AMEND_STAGING"'",
  "planHash":"'"$AMEND_HASH"'",
  "decisionToken":"'"$AMEND_TOKEN"'",
  "approverUserId":"'"$APPROVER"'"
}]}' | python3 -m json.tool
```

**Expect** `ok = true` with `replayed = true`, and then:

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = '$CLONE'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = '$CLONE' AND LLC_BI__Collateral__c = '$ASSET'"
```

Both must read exactly what 2.4 read. A second covenant or a second pledge is the defect this fence
exists for.

### 2.6 Optional but cheap: the gate re-read at execute

Stage a second amend, move one member of the version to approval, then execute. Nothing must land.

```bash
api StageAmendVersion '{"inputs":[{
  "idempotencyKey":"zz-orgproof-20260913-amend-climb",
  "versionPackageId":"'"$NEW_PKG"'",
  "rationale":"Org proof: the gate is re-read at execute.",
  "scalarChangesJson":"[{\"key\":\"requestedAmount\",\"value\":17000000,\"targetLoanId\":\"'"$CLONE"'\"}]"
}]}' | python3 -m json.tool
# capture the token, then move ANOTHER member of $NEW_PKG (not $CLONE) to approval:
sf data update record -o bankinggpt-at -s LLC_BI__Loan__c -i <another member of $NEW_PKG> \
  -v "LLC_BI__Stage__c='Approval / Loan Committee'"
# then execute with the captured values. EXPECT ok=false, error.code VERSION_NOT_EDITABLE.
sf data query -o bankinggpt-at -q "SELECT LLC_BI__Amount__c FROM LLC_BI__Loan__c WHERE Id = '$CLONE'"
#     EXPECT the commitment UNCHANGED: a refused execute writes nothing.
# put the member back before the revert:
sf data update record -o bankinggpt-at -s LLC_BI__Loan__c -i <the same member> -v "LLC_BI__Stage__c='Qualification'"
```

*(This step performs two `sf data update` writes on throwaway clone records that the revert deletes.
Skip it if the run is being kept minimal; the unit suite covers the same behaviour.)*

---

## 3. Section B, the discard proof

*(A2 appends here. The discard run should be the LAST thing executed, because a clean discard of
`$NEW_PKG` is also the revert for section A: it removes the version package, the clone loans, the
chain rows and the copied pledges, and flips every booked parent's `hasRenewal` formula back.)*

---

## 4. The revert

If section B ran and succeeded, the version is already gone: verify and stop.

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__hasRenewal__c FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$BOOKED_PKG'"
```

Expect **1 package, 7 loans, `hasRenewal` false on every booked member**.

Otherwise use the standing scripts. `NEW_COVENANTS` matters here: a covenant the amend minted lives
on the ACCOUNT and survives a package-only revert.

```bash
export NEW_PKG=<the version package id>
export NEW_COVENANTS=<the covenant id the amend reported>
python3 knowledge/sf-build-v2/tools/revert-hartwell.py
python3 knowledge/sf-build-v2/tools/revert-finish.py
```

The pledge the amend authored hangs off a clone loan and goes with it. The ASSET (`$ASSET`,
COL-000774) and its `LLC_BI__Account_Collateral__c` ownership row are pre-existing Hartwell records
and must NOT be deleted: the amend pledged an asset the borrower already owned and created neither.

Finally, sweep the proof's own trail rows if the run is not being kept as evidence:

```bash
sf data query -o bankinggpt-at -q "SELECT Id, cm_Action_Id__c, cm_Status__c FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c LIKE 'zz-orgproof-20260913-%'"
```

---

## 5. Record the result here

| | |
|---|---|
| deploy receipt | |
| version package created | |
| clone amended | |
| rate read back | |
| covenant created / junctioned | |
| pledge created, org advance rate | |
| booked parent unchanged | |
| PACKAGE_BOOKED refusal | |
| replay wrote nothing | |
| revert verified | |

---

# Section B, the discard proof (A2)

Section A creates a version and amends it. Section B takes that same version away and proves the
relationship is back to the booked package only. **Run Section A first and do NOT run its revert
scripts**: the version Section A leaves behind IS the proof version for this section. A discard that
has to be set up by hand proves less than one that undoes a version the cockpit really made.

Record the version package id Section A created here before starting:

```
Proof version package id:  ______________________  (Section A's $NEW_PKG)
Booked source package id:  a5Fbb000000IHFJEA4      (Hartwell Industrial C&I Credit Package)
```

---

## B0. STOP: four things to settle before the deploy

### B0.1 The server definition in this repo is a 12-tool SUBSET of a 28-tool org. Do not deploy it as it stands.

Retrieved read-only from bankinggpt-at on 2026-09-13:

```
sf project retrieve start -o bankinggpt-at -m McpServerDefinition:Customer360 \
  --target-metadata-dir <a scratch dir>
```

The LIVE `Customer360` definition carries **28 tool rows**: the 9 reads plus
`stage_collateral_valuation`, `execute_collateral_valuation`, `stage_service_request`,
`execute_service_request`, `stage_annual_review`, `execute_annual_review`, `stage_new_facility`,
`execute_new_facility`, `stage_risk_rating_review`, `execute_risk_rating_review`,
`stage_covenant_review`, `execute_covenant_review`, `stage_loan_modification`,
`execute_loan_modification`, `stage_renewal`, `stage_relationship_intake`,
`execute_relationship_intake`, `complete_new_facility_detail`.

`knowledge/sf-build-v2/Customer360.mcpServerDefinition-meta.xml` carries **12**: eight reads plus the
four rows 0.9.23 appended. A `McpServerDefinition` deploy REPLACES the whole definition, exactly as a
StandardValueSet does (LESSONS 6). Deploying that file as it stands would **remove sixteen live tool
rows, including every deployed write tool**, and the cockpit would lose modification, renewal, new
facility, covenant review, collateral valuation, annual review, risk rating, service request and
intake in one command.

**The procedure for step 2 is therefore retrieve, merge, deploy, never deploy the repo copy:**

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/sf-build-v2
# 1. take the live definition
sf project retrieve start -o bankinggpt-at -m McpServerDefinition:Customer360 --target-metadata-dir /tmp/mcp-live
unzip -o /tmp/mcp-live/unpackaged.zip -d /tmp/mcp-live
grep -c '<tools>' /tmp/mcp-live/unpackaged/mcpServerDefinitions/Customer360.mcpServerDefinition   # EXPECT 28
# 2. append the FOUR new blocks onto that file, leaving all 28 in place
# 3. deploy the merged file, then prove the count went 28 -> 32 and nothing was lost
```

### B0.2 The four new tool rows must be snake_case, and two of them are not.

Every write tool in the live definition uses a snake_case `toolName`
(`stage_loan_modification`, `execute_loan_modification`), and the frozen contract fixes the cockpit
side as `WRITE_TOOLS["amend-version"] = { stage: "stage_amend_version", execute: "execute_amend_version" }`
and `WRITE_TOOLS["discard-version"] = { stage: "stage_discard_version", execute: "execute_discard_version" }`.
The `toolName` is the name the MCP client calls; `apiIdentifier` and `operation` carry the Apex class
name.

In the repo file today the discard rows are correct
(`stage_discard_version`, `execute_discard_version`, `aa:apex-StageDiscardVersion`,
`aa:apex-ExecuteDiscardVersion`) and the amend rows carry `StageAmendVersion` / `ExecuteAmendVersion`
as their `toolName`. Left as they are, the cockpit's `stage_amend_version` call finds no tool.
**Fix the amend rows to `stage_amend_version` / `execute_amend_version` before step 2.** A2 did not
edit A1's blocks.

The live rows also carry five behaviour flags the repo's read rows omit. The discard rows follow the
live shape, and `execute_discard_version` is the first tool in this server to declare
`<destructive>true</destructive>`, which is the truth about it.

### B0.3 The deploy command for the discard pair

The classes A2 validated (deploy id `0Afbb00000DvY2HCAV`) are the five below. A1's section 1 already
carries a combined command; if the two pairs ship separately, this is the discard half, and note that
it includes `C360WriteGuard`, which WILL land as `Changed`. That is expected and additive: one new
per-tool DELETE table plus three object constants, no existing row altered, and its own suite runs in
the same deploy to prove it (LESSONS section 3c).

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented/knowledge/sf-build-v2
sf project deploy start -o bankinggpt-at \
  -m ApexClass:StageDiscardVersion \
  -m ApexClass:ExecuteDiscardVersion \
  -m ApexClass:StageExecuteDiscardVersionTest \
  -m ApexClass:C360WriteGuard \
  -m ApexClass:C360WriteGuardTest \
  -l RunSpecifiedTests -t StageExecuteDiscardVersionTest -t C360WriteGuardTest
```

Expect `Changed` on `C360WriteGuard` and `C360WriteGuardTest`, `Created` on the other three. A
`Changed` receipt on anything else is a STOP.

Alternatively, because the validation above already passed on exactly this source, the same work can
be committed without re-running the tests:

```bash
sf project deploy quick --job-id 0Afbb00000DvY2HCAV -o bankinggpt-at
```

Only use the quick deploy if nothing has been edited since; a validation is bound to the source it
zipped.

### B0.4 The trail cannot be marked Withdrawn until the picklist says so.

`cm_Action_Staging__c.cm_Status__c` is a **restricted** picklist offering exactly
`Staged, Executing, Completed, Partial, Failed`. The contract's step 7 wants the version's trail rows
marked `Withdrawn`, and the org would refuse that write with
`INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`. `ExecuteDiscardVersion` reads the value off the org at run
time and, when it is absent, leaves the rows exactly as they stand and reports the step as
`skipped_not_attempted`, naming the missing value. **The run then reports `partial`, and that is
correct rather than a defect.**

A2 did not add the picklist value: adding one to our own object is a founder call. To make the proof
come back `success`, add `Withdrawn` to `cm_Status__c` first (the org's own Loan status picklist
already offers the word). Otherwise expect `partial` at step B5 and check the trail-step detail says
why.

---

## B1. Validation receipt (A2, verbatim)

`sf project deploy validate` on bankinggpt-at, 2026-09-13. A validation deploy runs the tests on the
org and saves nothing.

```
sf project deploy validate -o bankinggpt-at \
  -m ApexClass:StageDiscardVersion \
  -m ApexClass:ExecuteDiscardVersion \
  -m ApexClass:StageExecuteDiscardVersionTest \
  -m ApexClass:C360WriteGuard \
  -m ApexClass:C360WriteGuardTest \
  -l RunSpecifiedTests -t StageExecuteDiscardVersionTest -t C360WriteGuardTest
```

```
   > Successful: 55/55 (100%)
 Status: Succeeded
 Deploy ID: 0Afbb00000DvY2HCAV
 Target Org: fabian.goetzens@accenture.com.bankinggpt
 Elapsed Time: 4m 11.69s

Test Results Summary
Passing: 55
Failing: 0
Total: 55
Time: 46252

Successfully validated the deployment (0Afbb00000DvY2HCAV).
Run "sf project deploy quick --job-id 0Afbb00000DvY2HCAV" to execute this deploy
```

Components 5/5, 0 component errors. Coverage on the three classes this deploy touches:

```
StageDiscardVersion     439/497 = 88.33%
ExecuteDiscardVersion   278/326 = 85.28%
C360WriteGuard          173/202 = 85.64%
```

What that receipt does NOT prove, and what the rest of this section is for: a real version on a real
relationship, discarded through the wire and read back out of the org.

---

## B2. Environment

Section A's environment, plus the version it left behind.

```bash
cd /opt/connectry/projects/commercial-credit-reinvented/customer-360-reinvented
read TOK INST <<< "$(~/.local/bin/bankinggpt-rest)"
export TOK INST

export HARTWELL_ACCOUNT=001bb00001I7FPNAA3
export BOOKED_PKG=a5Fbb000000IHFJEA4
export APPROVER=005bb00000ftouDAAQ
export VERSION_PKG=<Section A's $NEW_PKG>
export DKEY="zz-orgproof-discard-$(date +%s)"

api() { curl -sS -X POST "$INST/services/data/v67.0/actions/custom/apex/$1" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$2"; }
```

Baseline, taken immediately before the discard and kept:

```bash
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Is_Modification__c, LLC_BI__lookupKey__c FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$VERSION_PKG'"
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__ParentLoanId__r.Name, LLC_BI__RevisionNumber__c, LLC_BI__RevisionStatus__c, LLC_BI__HasActiveRenewalLoan__c FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT')"
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$BOOKED_PKG' ORDER BY Name"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$VERSION_PKG')"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Opportunity_History__c WHERE LLC_BI__Loan__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$VERSION_PKG')"
```

EXPECT: the version's clone facilities at Qualification with `Is_Modification` true and `_M1` keys;
two chain rows per rolled parent (revision 0 self-anchor, revision 1 with
`HasActiveRenewalLoan = true`); the rolled booked parent(s) reading **`hasRenewal = true`,
`Number_Of_Renewals = 1`**; one pledge if section A added one; and **one or more Opportunity History
rows on each clone** (nCino mints them at facility creation, and B5 is where they matter).

---

## B3. The NEGATIVE cases first, because they write nothing

Three refusals, run before the real one. Each returns `ok: false` with its own code, and none of
them touches a record.

```bash
# (a) PACKAGE_BOOKED. The booked source package is not a version and is never discardable.
api stage_discard_version '{"inputs":[{"idempotencyKey":"zz-neg-booked-1","rationale":"negative case","versionPackageId":"'$BOOKED_PKG'"}]}'
# EXPECT ok=false, error.code = PACKAGE_BOOKED, message naming a facility and the stage "Booked".

# (b) NOT_A_VERSION. A facility id where a package id belongs, fail closed (LESSONS 4b).
api stage_discard_version '{"inputs":[{"idempotencyKey":"zz-neg-notpkg-1","rationale":"negative case","versionPackageId":"a4Zbb0000027MaYEAU"}]}'
# EXPECT ok=false, error.code = VALIDATION_FAILED, message "is not a product package id".

# (c) the rationale gate. This action deletes, so it never runs without a reason on the record.
api stage_discard_version '{"inputs":[{"idempotencyKey":"zz-neg-norat-1","rationale":" ","versionPackageId":"'$VERSION_PKG'"}]}'
# EXPECT ok=false, error.code = VALIDATION_FAILED, message "rationale is required".
```

Prove they wrote nothing:

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c LIKE 'zz-neg-%'"
```

EXPECT the package count unchanged, and **0** staging rows: a refusal never stages a plan.

---

## B4. The stage: the inventory the banker confirms

```bash
api stage_discard_version '{"inputs":[{"idempotencyKey":"'$DKEY'","rationale":"The borrower withdrew the request; put the relationship back to the booked package.","versionPackageId":"'$VERSION_PKG'"}]}' | tee /tmp/discard-stage.json
```

**Paste the whole response into this file.** It is the single most important artefact of this
section: it is the list a banker sees before a delete, and it is the thing the execute is measured
against.

Read off it and export:

```bash
export DSTAGING=$(python3 -c "import json;print(json.load(open('/tmp/discard-stage.json'))[0]['outputValues']['Result']['stagingId'])")
export DHASH=$(python3   -c "import json;print(json.load(open('/tmp/discard-stage.json'))[0]['outputValues']['Result']['planHash'])")
export DTOKEN=$(python3  -c "import json;print(json.load(open('/tmp/discard-stage.json'))[0]['outputValues']['Result']['decisionToken'])")
```

Check the stage result against these, one by one:

| Check | Expect |
|---|---|
| `ok` | true |
| `sourcePackageId` | `a5Fbb000000IHFJEA4`, the BOOKED Hartwell package, derived from the chain rather than passed in |
| `items[]` includes `LLC_BI__LoanRenewal__c` | one row per revision-1 chain row, plus the self-anchors this fork minted |
| `items[]` includes `LLC_BI__Loan__c` | exactly the version's clone facilities, and no booked facility |
| `items[]` includes `LLC_BI__Product_Package__c` | exactly one, `$VERSION_PKG`, and never `$BOOKED_PKG` |
| `items[]` includes `LLC_BI__Loan_Collateral2__c` | the pledges on the version facilities, if section A added one |
| `items[]` does NOT include | `LLC_BI__Collateral__c`, `LLC_BI__Account_Collateral__c`, `LLC_BI__Covenant2__c`, `LLC_BI__Account_Covenant__c`, `cm_Action_Staging__c` |
| every `items[].reason` | non-empty, in banker language |
| `warnings[]` | says how many records go, names the parents that will read hasRenewal false, mentions the Opportunity History rows, and (until B0.3 is done) says the trail cannot be marked `Withdrawn` |
| `summary` | ends "Nothing booked is touched." |
| `decisionToken` | present |

And prove the stage wrote no domain record:

```bash
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$VERSION_PKG'"
sf data query -o bankinggpt-at -q "SELECT Id, cm_Action_Id__c, cm_Product_Package__c, cm_Status__c FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c = '$DKEY'"
```

EXPECT the facility count unchanged, and exactly one staging row at `Staged` whose
`cm_Product_Package__c` is **`$BOOKED_PKG`**, not the version: the audit row anchors on the package
the banker will still be looking at tomorrow.

---

## B5. The execute

```bash
api execute_discard_version '{"inputs":[{"idempotencyKey":"'$DKEY'","stagingId":"'$DSTAGING'","planHash":"'$DHASH'","decisionToken":"'$DTOKEN'","approverUserId":"'$APPROVER'"}]}' | tee /tmp/discard-exec.json
```

**Paste the whole response.** Then read `terminalState` and the `steps[]`:

- `success` when B0.3 was done (the picklist has `Withdrawn`).
- `partial` when it was not, with `withdraw_trail` at `skipped_not_attempted` and a detail naming the
  missing value. Every other step must still be `verified`.

**If `steps[].delete_members` is `failed`** with an Opportunity History error, that is finding 39 in
LESSONS section 8 firing: nCino did NOT clear its own history rows on the delete path. The action has
behaved correctly (it stopped, it said where, and it reported what is gone and what remains). Clear
the rows and re-run the SAME command with the SAME `$DKEY` to resume:

```bash
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Loan__r.Name FROM LLC_BI__Opportunity_History__c WHERE LLC_BI__Loan__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$VERSION_PKG')"
# delete those rows, then:
api execute_discard_version '{"inputs":[{"idempotencyKey":"'$DKEY'","stagingId":"'$DSTAGING'","planHash":"'$DHASH'","decisionToken":"'$DTOKEN'","approverUserId":"'$APPROVER'"}]}'
# EXPECT ok=true, replayed=false, the remaining groups verified. Record BOTH responses: the stop and
# the resume are the evidence that the chain is restartable, and that is the property this release
# needs most.
```

---

## B6. The SOQL that proves it

```bash
# (a) EVERY booked parent is back to hasRenewal false. This is the one that matters: a parent stuck
#     at true refuses every later credit action with "The request contains invalid facilities".
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c, LLC_BI__Stage__c, LLC_BI__Amount__c FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$BOOKED_PKG' ORDER BY Name"
#     EXPECT hasRenewal false and Number_Of_Renewals 0 on all seven, stages still Booked, amounts
#     unchanged from the B2 baseline.

# (b) the version id no longer resolves.
sf data query -o bankinggpt-at -q "SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = '$VERSION_PKG'"
#     EXPECT 0 rows.

# (c) the chain is gone from the relationship.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT')"
#     EXPECT 0.

# (d) the relationship is back to ONE package and SEVEN facilities.
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Stage__c FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
#     EXPECT exactly the B2 baseline of section A: 1 package, 7 loans.

# (e) WHAT SURVIVED. The discard deletes what the cockpit made and nothing else, and this is where
#     that claim is checked rather than asserted.
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Collateral_Value__c FROM LLC_BI__Collateral__c WHERE Id = 'a35bb0000019cv8AAA'"
#     EXPECT 1 row. The asset section A pledged onto the version is untouched.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = 'a35bb0000019cv8AAA'"
#     EXPECT unchanged: the ownership junction is the borrower's, not the version's.
sf data query -o bankinggpt-at -q "SELECT Id, Name, LLC_BI__Covenant_Status__c FROM LLC_BI__Covenant2__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Account_Covenant__c WHERE LLC_BI__Account__c = '$HARTWELL_ACCOUNT'"
#     EXPECT the covenant section A minted still on the BORROWER with its account association. Only
#     its loan junction went, with the facility it was attached to.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c IN (SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = '$BOOKED_PKG')"
#     EXPECT the B2 baseline: the BOOKED facilities' own pledges are untouched.

# (f) the trail. KEPT, never deleted.
sf data query -o bankinggpt-at -q "SELECT Id, cm_Action_Id__c, cm_Status__c, cm_Product_Package__c, cm_Executed_At__c, cm_Approver_User__c FROM cm_Action_Staging__c WHERE cm_Product_Package__c = '$VERSION_PKG' OR cm_Idempotency_Key__c = '$DKEY' ORDER BY CreatedDate"
#     EXPECT: section A's amend and modification rows STILL PRESENT (this query still finds them by
#     package id even though the package is gone: cm_Product_Package__c keeps the id), marked
#     Withdrawn if B0.3 was done and left at their prior status if it was not; PLUS this action's own
#     row with cm_Action_Id__c = 'discard-version', cm_Product_Package__c = $BOOKED_PKG (the SOURCE,
#     per the contract), cm_Status__c Completed or Partial, cm_Executed_At__c set, approver set.

# (g) the aggregate residue, reported rather than hidden.
sf data query -o bankinggpt-at -q "SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c"
#     EXPECT this count to be HIGHER than it was before section A by the number of clone facilities
#     that carried a pledge. Those shells are the residue LESSONS 45 describes: inert, not on the
#     frozen inventory, and deliberately not deleted. Record the number.
```

---

## B7. Idempotency, on the wire

```bash
api execute_discard_version '{"inputs":[{"idempotencyKey":"'$DKEY'","stagingId":"'$DSTAGING'","planHash":"'$DHASH'","decisionToken":"'$DTOKEN'","approverUserId":"'$APPROVER'"}]}'
```

EXPECT `ok=true`, `replayed=true`, `deletedCount=0`, and an outcome saying this key already discarded
that version. Then re-run B6 (d): the counts must be **identical**. A replay that deleted a second
time would be the worst possible defect in this release, and this is the check that rules it out.

Two more wire refusals worth one minute each:

```bash
# a token that was not minted for this plan
api execute_discard_version '{"inputs":[{"idempotencyKey":"zz-tok-1","stagingId":"'$DSTAGING'","planHash":"'$DHASH'","decisionToken":"not-the-token","approverUserId":"'$APPROVER'"}]}'
# EXPECT ok=false, error.code = TOKEN_REFUSED.

# an approver who is not the running identity
api execute_discard_version '{"inputs":[{"idempotencyKey":"zz-appr-1","stagingId":"'$DSTAGING'","planHash":"'$DHASH'","decisionToken":"'$DTOKEN'","approverUserId":"005bb00000I8VXJAA3"}]}'
# EXPECT ok=false, error.code = TOKEN_REFUSED, message naming the running-identity rule.
```

---

## B8. After the discard, there is nothing to revert

That is the point of this section. The discard IS the revert: Hartwell is back to one booked package
and seven booked facilities, and `revert-hartwell.py` / `revert-finish.py` have nothing left to do.

Two things the discard deliberately did NOT remove and that a clean org still wants swept:

```bash
# 1. the covenant section A minted on the BORROWER (it is not the version's to delete)
export NEW_COVENANTS=<the covenant id the amend reported>
# delete its account junction and then the covenant, exactly as revert-hartwell.py's opt-in arm does

# 2. the proof's own trail rows, if this run is not being kept as evidence
sf data query -o bankinggpt-at -q "SELECT Id, cm_Action_Id__c FROM cm_Action_Staging__c WHERE cm_Idempotency_Key__c LIKE 'zz-orgproof-%' OR cm_Idempotency_Key__c LIKE 'zz-neg-%' OR cm_Idempotency_Key__c LIKE 'zz-tok-%' OR cm_Idempotency_Key__c LIKE 'zz-appr-%'"
```

Leave the orphaned `LLC_BI__Loan_Collateral_Aggregate__c` shells alone unless a founder says
otherwise: sweeping them is what the open question in LESSONS 45 is about.

---

## B9. Record the discard result here

| | |
|---|---|
| validate receipt (deploy id, tests, coverage) | |
| server definition merged from the live 28 rows, count after deploy | |
| `Withdrawn` added to `cm_Status__c` before the run? | |
| PACKAGE_BOOKED refusal | |
| NOT_A_VERSION refusal | |
| rationale refusal | |
| stage wrote no domain record | |
| stage inventory (item count, objects) | |
| sourcePackageId derived correctly | |
| execute terminalState | |
| chain stopped and resumed? (Opportunity History) | |
| every booked parent hasRenewal false | |
| version id no longer resolves | |
| relationship back to 1 package / 7 loans | |
| asset, ownership junction, covenant, account covenant all survived | |
| trail rows KEPT, discard row on the SOURCE package | |
| replay deleted nothing | |
| aggregate shells left behind (count) | |

## C. RESULT, run by the orchestrator on bankinggpt-at, 2026-09-13 (verbatim figures)

Deploys: amend pair 0Afbb00000DvXhJCAV (quick deploy of validation 0Afbb00000DvXarCAF, 82/82 tests);
discard pair + write guard 0Afbb00000DvYALCA3 (quick deploy of 0Afbb00000DvY2HCAV, 55/55);
`cm_Action_Staging__c.cm_Status__c` gained the restricted value `Withdrawn` (field deployed from the
retrieved metadata, copy in `wp2/objects/cm_Action_Staging__c/fields/`); `McpServerDefinition`
`Customer360` rebuilt from the LIVE org (28 tools) plus the four new rows in snake_case = 32 tools,
deployed from `wp2/mcpServerDefinitions/` and re-retrieved to confirm (the folder-root copy is
kept in sync; the package directory is what deploys).

Baseline on Hartwell before anything ran: 2 packages, 9 loans, 2 chain rows (the two revision-0
self-anchors A2 documented; the doc's "1/7/0" was written before that finding).

Section A (amend):
- 2.1 negative: `stage_amend_version` on the booked package `a5Fbb000000IHFJEA4` refused
  `PACKAGE_BOOKED` ("carries Hartwell Precision Manufacturing LLC - Construction - $12,000,000.00 at
  stage Booked, so this package is live business rather than a version the banker still owns. A change
  to a booked facility is a MODIFICATION"), 0 staging rows.
- 2.2 version created through the deployed modification pair: stage 3.7 s, execute 32.1 s,
  `terminalState success`, version package `a5Fbb000000JGyjEAG`, clone `a4Zbb000002KmPAEA0`
  ($15M line to $16M), six members at Qualification, `Is_Modification` true, chain row RL-00000841.
- 2.3 amend staged in 2.5 s: facilities[0] fields `LLC_BI__InterestRate__c` from 7.60 to 7.10,
  `versionKind in-flight version`, token minted; after stage the clone still read 7.6 and no covenant
  junction (nothing written by staging). Execute 6.6 s, `success`: rate reads 7.10000000 on the
  version's own loan; covenant COV-000727 (Debt Service Coverage of Borrower >= 1.30, Quarterly,
  effective 2026-10-01) created Pending with one junction on the clone and one account association;
  pledge LC row a4Rbb0000027guDEAQ of COL-000774 at 1,680,000 (org resolved 80% advance rate).
- 2.4 SOQL: clone `LLC_BI__InterestRate__c` 7.1, `LLC_BI__Amount__c` 16,000,000; the booked parent
  `a4Zbb0000027MaYEAU` untouched at 7.6 / 15,000,000; trail row STG-0000000152 `amend-version`
  Completed anchored on the version package.

Section B (discard):
- B3 negatives: booked package refused (PACKAGE_BOOKED, names the Construction facility at Booked);
  a loan id refused `VALIDATION_FAILED` "is not a product package id"; a blank rationale is refused
  by the platform itself (`REQUIRED_FIELD_MISSING: rationale`); 0 staging rows for the three.
- B4 stage 4.0 s: `sourcePackageId a5Fbb000000IHFJEA4` derived from the chain; inventory 66 records in
  10 groups: 12 LoanRenewal (6 revision-1 + the 6 self-anchors this fork minted), 7 pledges,
  3 covenant junctions, 6 payment components, 6 pricing streams, 4 fees, 21 involvements, 6 version
  loans, 1 version package; every item with a banker reason; warnings name the parents that will read
  hasRenewal false and the 7 Opportunity History rows; summary ends "Nothing booked is touched."
  Staging row STG-0000000153 anchored on the BOOKED package.
- B5 execute 17.9 s, `terminalState success`: every delete group verified by re-query, parents
  verified, "Version package a5Fbb000000JGyjEAG no longer resolves", `withdraw_trail` 1 of 1 read
  back at Withdrawn; `observe_aggregates` filed_unverified (the pledge aggregate shells stay: founder
  call, backlog 46).
- B6 SOQL: all seven booked members `hasRenewal false`, `Number_Of_Renewals 0`, stages and amounts
  as before; version package count 0, version loans 0; account back to 2 packages, 9 loans, 2 chain
  rows (the baseline); COL-000774 and COV-000727 still exist; trail rows: STG-151 loan-modification
  Completed, STG-152 amend-version Withdrawn, STG-153 discard-version Completed.
- B7 execute replay under the same key: `replayed true`, "This idempotency key already discarded
  version a5Fbb000000JGyjEAG. Nothing was deleted."

Follow-ups found by the proof: the loan-modification row that FILED the version (STG-151) is not
marked Withdrawn, only the amend row anchored on the version is (backlog 45); pledge aggregate shells
(backlog 46). Raw responses: `knowledge/proofs/0923-discard-stage.json`, `0923-discard-exec.json`.

## D. 0.9.24 org proof, account-anchored reviews (orchestrator, 2026-09-13, evening)

Deploy 0Afbb00000Dvb8DCAR (quick deploy of validation 0Afbb00000DvaorCAB, 216/216 tests): StageCovenantReview
and StageCollateralValuation anchored on `accountId` with `productPackageId` optional; `associations` per
item; covenant / pledge arms on StageNewFacility (+ execute) and StageRenewal (held); C360FacilityArms;
discard marks the filing modification row Withdrawn.
- `stage_covenant_review` with `accountId` only + one assessment (COV-000646 Compliant 1.38): `scopeCount 7`
  across BOTH Hartwell packages (six original covenants plus the proof covenant then still on the book), each
  with its associations (COV-000646 to the $6.5M Purchase on the Real Estate package; COV-000650 to the $15M
  Line of Credit on the C&I package; COV-000651 to the Construction; relationship-level rows `[]`), planned 1,
  refused 0, staging row anchored on the account with the single touched package set, summary naming the
  package. Stage only; row removed afterwards. Note: `assessments` is a LIST of Assessment records on the
  invocable, not a JSON string (a string is refused by the platform as a malformed SObject).
- `stage_collateral_valuation` with `accountId` only (COL-000774 at 2,100,000, 2026-09-13): ok, associations
  to the $1.5M Equipment on the Real Estate package, staging row anchored on the account. Stage only; row removed.
- Residue removed: the proof covenant COV-000727 (created by the amend proof in section C; the discard keeps
  covenant records by design) deleted by hand; Hartwell back to six covenants.

## E. 0.9.25 aggregate sweep proof (2026-09-14, orchestrator)

Version a5Fbb000000JHI5EAO created from `$BOOKED_PKG` (StageLoanModification / ExecuteLoanModification, key
`zz-orgproof-20260914-agg-mod`, 6 clones, 5 aggregates on the clones). Discard staged (STG-0000000157,
69 items, 5 aggregates frozen by A4's build) and executed: `partial`, stopped at `delete_aggregates` with
`ENTITY_IS_DELETED` on a4Sbb00000GYcBmEAL. Findings:

1. nCino's managed `LLC_BI.LoanTrigger` cascades a clone loan's aggregate when the loan is deleted, so the
   frozen list is already gone by the time our step runs. The step must read that as `already_gone`.
2. Five NEW orphan shells (a4Sbb00000GYfva..GYfve) carry CreatedDate 02:31:23Z, inside the modification
   EXECUTE, a minute before the discard was staged. The shells backlog 46 complains about are minted at
   version CREATION (pledge copy onto the clones), orphaned from birth; a discard that freezes only the
   clones' own aggregates never sees them. The 18 shells hand-deleted this morning were three versions' worth.
   Fix goes to the source (in-transaction sweep after the pledge copy) plus a bounded stage-time bucket in the
   discard. Partial result saved at `proofs/0925-discard-aggregates-exec.json`. Resume of STG-0000000157 is
   the proof of the fix.

Result after A5 (0Afbb00000DvdBdCAJ) and A6 (0Afbb00000DvdLJCAZ), cycle 2 (keys `zz-orgproof-20260914-agg2-*`):
`ExecuteLoanModification` step `sweep_aggregates` verified: "This transaction minted 5 collateral aggregate
shells: 0 carry a facility or a pledge and stay, 5 were orphaned on creation and were removed, proven gone
by re-query." Org count 70 → 75 (the 5 clone aggregates only). `StageDiscardVersion` froze 5 aggregates
(69 items); `ExecuteDiscardVersion` landed `success` in one pass: `delete_aggregates` 5 `already_gone`
(nCino's cascade), `delete_package` verified, 6 parents back to hasRenewal false, org count back to 70.
Saved: `proofs/0925-discard-aggregates-clean.json`. The A6 resume path is unit-proven (36 tests) but not
live-proven: the cycle-1 row STG-0000000157 had already been marked Failed and its token consumed by the
NOT_A_VERSION refusal, so it could not be resumed. Residue removed by hand: the stranded package
a5Fbb000000JHI5EAO, the 5 cycle-1 shells, the 4 proof staging rows. Org after: 65 aggregates (62 referenced,
3 seed), 0 staging rows, Hartwell booked package untouched.
