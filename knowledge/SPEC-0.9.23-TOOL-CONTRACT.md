# 0.9.23 tool contract: amend_version and discard_version (frozen 2026-09-13)

Two new stage/execute pairs on the Customer 360 server. Same envelope, same discipline as every
existing pair (`StageLoanModification` / `ExecuteLoanModification` are the reference: positional
invocable envelope, `ok` discriminator, `stagingId` + `decisionToken` minted server-side, idempotency
key enforced by us, verification by re-query, `cm_Action_Staging__c` row per stage, action history
row per execute). Apex lives in `knowledge/sf-build-v2/wp2/classes/`, registered in
`knowledge/sf-build-v2/Customer360.mcpServerDefinition-meta.xml` as `aa:apex-<ClassName>`.

## Why two pairs, not five
`StageLoanModification` already carries every authoring arm a version needs (scalar changes, field
changes, covenant adds, covenant attaches, pledge adds, fee adds, involvement changes, exclusions),
all landing on the CLONE. Amending an EXISTING version is the same arms landing on the version's own
loans, without the credit action. So `amend_version` reuses those request shapes verbatim, and the
relationship room's "add a covenant" / "pledge collateral" on a version are `amend_version` calls
carrying one arm. Discard is its own pair because it deletes.

## Pair 1: `stage_amend_version` / `execute_amend_version`
Classes `StageAmendVersion`, `ExecuteAmendVersion`.

Request (stage):
- `idempotencyKey` (required), `rationale` (required)
- `versionPackageId` (required): the UNBOOKED package to amend. Accepted when (a) it is an in-flight
  version (members carry `LLC_BI__Is_Modification__c` true or a renewal chain row) whose members are
  all before `Approval / Loan Committee` on the org's own ladder, or (b) it is a cockpit-created
  package still before approval (package stage Pending / In Review, no member Booked / Complete).
  Anything else is refused with the org's stage in the reason (`VERSION_NOT_EDITABLE`,
  `PACKAGE_BOOKED`, `NOT_A_VERSION`).
- Arms, same JSON shapes and same descriptions as `StageLoanModification`: `scalarChangesJson`
  (requestedAmount | requestedMaturityDate | requestedRate | requestedTermMonths, per targetLoanId),
  `fieldChangesJson`, `covenantAddsJson`, `covenantAttachesJson`, `pledgeAddsJson`, `feeAddsJson`,
  `involvementChangesJson` (add only; a remove on a version is a real delete and is refused here).
  Every `targetLoanId` must be a member of `versionPackageId`; a target outside it is refused by name.
  At least one arm must carry an entry.
- No broadcast scalars: on an amend every figure names its loan.

Stage result: `StagedOutput` with `facilities[]` (one per touched member: id, name, the fields that
move, from → to), `plan[]` steps (write / verification), `provenanceJson`, `executionHeld` +
`heldReason` where the org says so, `decisionToken`.

Execute: `stagingId`, `decisionToken`. Re-reads the ladder gate at execute time (a version that
climbed to approval between stage and execute is refused, nothing written). Writes the scalar and
field changes directly on the version loans (`LLC_BI__Amount__c`, `LLC_BI__Interest_Rate__c`,
`LLC_BI__Term_Months__c`, `LLC_BI__Maturity_Date__c`, amortised term, first payment date, through
`C360WriteGuard` OP_UPDATE), authors covenants / junctions / pledges / fees exactly as the
modification's execute does on the clone, verifies each by re-query, writes the action history row
`actionId = "amend-version"` with `productPackageId = versionPackageId` and the summary sentence.
Result: `ExecuteResult` with `facilities[]` and `steps[]`.

## Pair 2: `stage_discard_version` / `execute_discard_version`
Classes `StageDiscardVersion`, `ExecuteDiscardVersion`.

Request (stage): `idempotencyKey`, `rationale`, `versionPackageId`.
Stage discovers the DELETE SET by query and returns it as the plan, refusing when:
- the package is not an unbooked version or cockpit-created package (as above), or any member is at
  or past `Approval / Loan Committee` (`VERSION_IN_APPROVAL`);
- the version carries children the cockpit did not create: an `ApprovalSubmission` / approval
  process instance, an `LLC_BI__Document_Placeholder__c` with content, an `LLC_BI__Review__c`
  (`HAS_FOREIGN_CHILDREN`, listing them by name; the banker withdraws those in Salesforce first).
Inventory (returned as `items[]`, each with object, id, name, and the reason it goes):
1. `LLC_BI__LoanRenewal__c` rows where `LLC_BI__RenewalLoanId__c` is a member of the version OR
   `LLC_BI__ParentLoanId__c` is a booked parent of one and the row belongs to this version's chain
   (both revisions; this is what flips the parents' `hasRenewal` formula back);
2. `LLC_BI__Loan_Collateral2__c` pledges on the version loans (the copies; the assets and the
   `LLC_BI__Account_Collateral__c` ownership rows stay);
3. `LLC_BI__Loan_Covenant__c` junctions on the version loans (covenant records stay);
4. `LLC_BI__Pricing_Rate_Component__c`, `LLC_BI__Pricing_Payment_Component__c`, then
   `LLC_BI__Pricing_Stream__c` on the version loans; `LLC_BI__Fee__c`; `LLC_BI__Legal_Entities__c`
   (involvements) on the version loans; `LLC_BI__Loan_Detail__c` if not cascade;
5. the version loans (`LLC_BI__Loan__c`);
6. the version package (`LLC_BI__Product_Package__c`);
7. `cm_Action_Staging__c` rows anchored on the version: NOT deleted, `cm_Status__c` set to
   `Withdrawn` (the trail is the audit).
Before writing the class: probe the org for a managed undo (`nFORCE.CallableApi_v1` `verify`, and
whether deleting the renewal loan through nCino's own path cascades the chain) and record the answer
in `knowledge/LESSONS-NCINO-APEX.md`; if a managed path undoes cleanly, call it in-process and keep
this chain as the verified fallback. Check the integration user's delete rights on every object above
(`PermissionSetAssignment` / object permissions) BEFORE the first deploy and record the result.

Execute: `stagingId`, `decisionToken`. Re-runs the gate, deletes in the order above with
verification between groups (a failure stops the chain and reports exactly what is gone and what
remains, resumable under the same idempotency key), then verifies: every booked parent reads
`LLC_BI__hasRenewal__c = false`, the version package id no longer resolves, and writes the action
history row `actionId = "discard-version"`, `productPackageId` = the SOURCE booked package where one
exists (so the trail lands on the package the banker will look at), summary naming the counts.
Result: `ExecuteResult` with `steps[]` and `items[]` (what went), plus `sourcePackageId`.

## Cockpit side (frozen names)
`WRITE_TOOLS["amend-version"]` = `{ stage: "stage_amend_version", execute: "execute_amend_version" }`,
`WRITE_TOOLS["discard-version"]` = `{ stage: "stage_discard_version", execute: "execute_discard_version" }`.
Action ids on the trail: `amend-version`, `discard-version`. The roster (`book/packages.ts`) reads a
discard as: the version is gone and the source is unlocked on the next sweep.
