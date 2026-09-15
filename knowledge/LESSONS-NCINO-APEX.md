# Lessons Learned: nCino + Apex + MCP on bankinggpt

**Purpose.** Every empirically earned lesson from the WP1/WP2 build wave (2026-07-25/26), written down
so wave 2 (modification, renewal, new facility, covenant review, risk rating) does not re-learn any of
it the hard way. Companion to `PROBE-LEDGER.md` (evidence) and `A33-DRAFT.md` (spec). Read this BEFORE
building any new tool.

**Standing prime directive: no interference.** Every deploy to bankinggpt must land as `Created`, never
`Changed`, unless the change to an existing component was explicitly founder-gated (so far exactly one
is planned: the additive `McpServerDefinition` tool rows). The deploy output is the receipt; keep it.

---

## 1. Platform truths that cost us time tonight

1. **Metadata API deploys grant FLS to NOBODY.** A new custom object deploys with object CRUD for the
   admin profile but ZERO FieldPermissions rows, System Administrator included. Under `WITH USER_MODE`
   every custom field is invisible and reads fail with `No such column`. RULE: every new object or
   field ships WITH its permission set in the same deploy, and the permission set is assigned to the
   tool-running identity AND the test-running identity before any test run.

2. **`No such column` does not mean the field does not exist.** It usually means FLS-invisible.
   The false-disproof trap: anonymous Apex compiles against the calling user's field visibility, so a
   "system mode" snippet also fails; REST describe is also FLS-filtered. GROUND TRUTH for field
   existence is the Tooling API (`SELECT ... FROM CustomField`). Order of diagnosis: Tooling API for
   existence, then FieldPermissions for visibility, then code.

3. **The org's describe endpoints strip permission facts** (`sobject-sf` MCP `getObjectSchema` showed
   0 createable fields to a sysadmin who then inserted successfully). Writability claims require an
   insert probe. Never conclude from a describe, in either direction.

4. **Autonumber Names are not Ids.** Review `R-100004`, Case `00101324` are Name values; casting them
   to `Id` throws `System.StringException: Invalid id`. Resolve records by returned Id, never by Name.

4b. **Names and ids must never share a field — the pattern struck twice in one night.** First the Apex
    ternary coerced a Case number through `Id.valueOf()`; then the panel sent `meta.user` (the display
    name "Fabian Goetzens") as `approverUserId`, and the running-identity precondition refused every
    live confirm for a whole session. RULES: id-typed fields carry validated 15/18-char ids only
    (resolve with a prefix-checked helper that fails closed); display names live in fields named as
    names; any contract with both carries both fields (`user` + `userId`).

4a. **Never mix `Id` and `String` branches in an Apex ternary.** Apex infers the ternary's type from
    its operands and coerces the `String` branch through `Id.valueOf()`, which throws on any non-Id
    string (found in two outcome-message builders: `(name == null ? record.Id : name)` blew up on
    `00101324`). Wrap the Id branch: `String.valueOf(record.Id)`. Sweep new classes for mixed-type
    ternaries before deploy.

5. **`McpServerDefinition` facts:**
   - Tools are EXPLICIT rows (`toolName` + `apiIdentifier` = `aa:apex-{ClassName}`, source
     `API_CATALOG`). No auto-discovery: a new invocable class does NOT appear as a tool.
   - The API catalog only knows a class AFTER it is deployed, so exposure is a strict two-step:
     deploy classes first, then deploy the server definition. A combined or premature definition
     deploy fails with `No "aa:apex-X" identifier found for source "API_CATALOG"`.
   - The metadata type is not retrievable at sourceApiVersion 64.0; use 67.0+.
   - snake_case toolName values parse fine.

6. **StandardValueSet changes are retrieve-append-deploy.** Deploying replaces the whole set, so always
   retrieve the current one first and append. Verify afterwards with `sf sobject describe` (picklist
   values), not with the deploy status alone.

## 2. Test-context traps

7. **Fixture DML wakes managed automation.** Every Case insert fires `FinServ.CaseTrigger` and
   `slackv2.caseTrigger`; every Review insert fires `Review After Save`. Per-method fixture inserts
   multiplied that until the whole run was killed on time ("Your request exceeded the time limit").
   RULES: `@TestSetup` once per class; minimal fixture DML; run per class (`--synchronous` where
   possible); never one giant run while managed triggers are in play.

8. **Test-context callouts are blocked**, so the Slack trigger cannot actually post during tests. But
   absence of a side effect in a test proves nothing about production behavior (the Slack watch probe
   remains open for that reason).

9. **Fixtures must satisfy validation rules the probes never saw.** Probes reuse existing records;
   fixtures build the whole chain from scratch and hit creation-time VRs. Discovered tonight:
   `LLC_BI__Collateral_Type__c` has active VR `Advance_Rate_should_not_be_null` ("Please enter an
   advance rate for the collateral type") and the error surfaces on the COLLATERAL insert, not on the
   type record. Fixture fix: `LLC_BI__Advance_Rate__c = 50` on the type.

10. **Assertion messages must carry the tool's own error.** A bare `Assert(stage should succeed)` made
    finding 2 undiagnosable; asserts now print error code + message + verbatim org error. Keep that
    pattern in every new test class.

## 3. nCino object facts (verified, org = bankinggpt)

11. **Review (`LLC_BI__Review__c`):** insert with only the account lookup succeeds; record type is
    auto-assigned by `Review After Save` (NEVER set `RecordTypeId`); `LLC_BI__Status__c` and
    `LLC_BI__Review_Type__c` do NOT default and must be set explicitly. The field
    `LLC_BI__reviewStatus__c` does NOT exist on Review (it belongs to `LLC_BI__LLC_LoanDocument__c`).

12. **Collateral Valuation:** two fields suffice (`LLC_BI__Collateral__c` + `LLC_BI__Value__c`);
    booleans default false so a revaluation sets `Active`/`Primary` explicitly; whether the insert
    rolls up onto the Collateral is UNPROVEN (nCino binds the auto-update to the Add Valuation button);
    the tracker must verify the rollup by re-query and report honestly.

13. **Case:** zero validation rules; `Service Request` (Type) and `Agent` (Origin) are live picklist
    values as of 2026-07-26; the Slack trigger's outbound behavior on insert is unproven.

14. **Loan/LoanRenewal (wave 2 relevant):** `LLC_BI__LoanRenewal__c` has 0 VRs, 0 triggers, 0 flows —
    nothing corrects a malformed row and failures are silent. `LLC_BI__ParentLoanId__c` is set-once.
    nCino async credit-action failure reverts silently with records in the Recycle Bin
    (PDI-00017266) and failed background Apex is known to produce duplicate modification loans, so
    idempotency is OURS and verification re-queries are mandatory. `ACNPEX_ AccountOwnerAsLoanOfficer`
    overwrites `LLC_BI__Loan_Officer__c` before save: report loan officer as org-assigned.
    `PPCacheCreation` and `ProductPackageBaselineCaptureTrigger` swallow failures to `System.debug`:
    mark their steps "org-side, unverifiable".

15. **Stage authority (founder decision):** Loan stages are the lifecycle that matters; the package
    field is the managed `LLC_BI__Stage__c`; `cm_Credit_Stage__c` is never an authority and a mismatch
    is a data-quality finding.

## 3b. nCino object facts added by the WP3 probe campaign (2026-07-26, PROBE-LEDGER wave 3)

Every item below is probe-backed. Ledger rows: Probes 4 to 9.

15a. **The org REWRITES the Loan `Name`, and self-populates `LLC_BI__Product__c`.** A before-save flow
     rebuilds `Name` as `<Account> - <Product> - <Amount>`; a before-save trigger sets `Product` to
     `Construction` when you leave it blank. We submitted `ZZ-PROBE-20260726 Facility` and the org
     stored `ZZ-PROBE-20260726 DO NOT USE - Construction - $0`. RULE: never echo back the name you
     submitted. Report the org-assigned name, the way `execute_collateral_valuation` reports
     `recordName`. And collect Product at stage time or ship loans mislabelled `Construction`.

15b. **The Loan Detail is created by an ASYNC-PATH FLOW, in about 4 seconds, not by Apex.** Separate
     transaction, elements `Loan_Detail_Exists` → `Create_Loan_Detail` →
     `Update_Loan_with_New_Loan_Details_Record`. **No `AsyncApexJob` row is produced**, so anything that
     polls `AsyncApexJob` to detect completion will wait forever. Poll the Loan's
     `LLC_BI__Loan_Detail__c` lookup instead. A `waitBudgetMs` of 10 to 30 s is evidence-backed for a
     single-record insert. Of the two fields LV12/LV13 gate, the org pre-fills
     `LLC_BI__Application_Method__c` (`Online`) and leaves `LLC_BI__Primary_Loan_Purpose__c` null, so
     only the purpose must be collected.

15c. **A Loan insert passes 21 validation rules and wakes five namespaces.** `LLC_BI`, `nFORCE`,
     `nCino`, `NDOC`, `nCRED`, with 42 `VALIDATION_PASS` and zero failures at Qualification/Open from a
     six-field payload. The insert transaction ran 6.4 s and produced a 562 KB log. Budget for that:
     it is not a cheap write.

15d. **`LLC_BI__RootLoanId__c` DOES NOT EXIST on `LLC_BI__Loan__c` in this org**, and
     `LLC_BI__ChildLoanId__c` does not exist on `LLC_BI__LoanRenewal__c`. A33.4.1(a) names
     `RootLoanId` as the chain anchor; that is wrong for bankinggpt. Re-source any chain-walking design
     before writing it.

15e. **`LLC_BI__Annual_Review__c` has no `RecordTypeId` and no `OwnerId`**, and is a cascade-delete child
     of Account. `LLC_BI__Status__c` **defaults to `Not Approved`** (proven by insert). That is worse
     than Review's null: an omitted status reads as a *decision*. Always set `In Review` explicitly.

15f. **The collateral rollup does not exist headlessly, and there is no flag that turns it on.** A
     valuation insert leaves `LLC_BI__Collateral__c.LLC_BI__Value__c` untouched, and setting
     `LLC_BI__Collateral_Type__c.LLC_BI__Auto_Update_Collateral_Value__c = true` changes nothing (both
     arms probed; all 43 collateral types in the org have it `false` anyway). nCino binds the update to
     the **Add Valuation** button. `LLC_BI__Lendable_Value__c` is a formula on the collateral's own
     value and is equally unmoved. Never claim coverage improvement from a filed valuation.

15g. **`slackv2` posts are gated on `slackv2__Subscription__c`, and the gate is queryable.** The trigger
     runs on every Case insert (25 managed-package entries) but our probe produced `0` callouts, `0`
     future calls, `0` queueable jobs, `0` email invocations and no follow-on transaction, because both
     of its `Subscription__c` decision queries returned zero rows. The org holds exactly five
     subscriptions, one `Assigned to Me` per standard object; the Case one belongs to user
     `005bb00000I8VXJAA3`. **A Case created for or assigned to that user WILL attempt a post.** Run the
     subscription query pre-flight and make the warning conditional instead of permanent. This does not
     cover Slack-side subscriptions outside Apex (CDC, platform events), which stay unproven.

15h. **`acnpex_covenantApprovalProcess` fires on CREATE ONLY, with zero entry filters.** It is a
     flow-based `ApprovalWorkflow` (`301bb00000T6YxZAAV`), the only one in the org:
     `triggerType RecordAfterSave`, `recordTriggerType Create`, `filters []`, `exitRules []`. **It never
     fires on an update** — not on status, not on narrative fields. Since A33 forbids creating
     compliance records, **our tools cannot start the bank's chain by construction**. Two corollaries:
     zero filters means **no `Exclude_Flow` bypass is consulted**, so on a create nothing stops it; and
     the classic `CCAP100 Covenant Compliance Approval` process is `Obsolete`, so `ProcessInstance` is
     the **wrong object** to verify this chain against.

15i. **A "valid facility" for a credit action is Booked + Open + non-null `LLC_BI__lookupKey__c`.**
     Every parent loan on every `LLC_BI__LoanRenewal__c` row in the org matches that shape. Anything
     else returns `The request contains invalid facilities`, at any pre-approval stage, for both
     `Renewal` and `Modification`.

15j. **`Loan_Validation_06` makes `Booked` unreachable by API, with no bypass.** Verbatim: *"You Cannot
     Manually Change the Loan to a Post Approval Stage. The Loan Must be Approved by pressing the
     'Submit for Approval' Button at the top of the page. - LV06"*, alongside *"A Loan Number is
     Required Prior to Changing the Loan Stage to 'Booked' - LV05"*. Combined with 15i this makes the
     loan-clone probe **unrunnable on throwaway data**: reaching Booked means running a real approval
     process with real approvers. **Modification and renewal are phase-limited: `stage_*` shippable,
     `execute_*` HELD.**

15k. **The Qualification → Proposal hop works headlessly.** Set
     `LLC_BI__Primary_Loan_Purpose__c` on the Loan Detail, then PATCH the Loan stage; LV11/LV12/LV13/LV14
     are satisfied by amount, that purpose, the org-defaulted `Application_Method` and the org-assigned
     loan officer. A33.4.3 phase 2 is evidence-backed.

15l. **A Product Package CAN be created; the `Deal_Proposal` gap is a labelling problem.**
     `Deal_Proposal` is `IsActive false` and `Treasury_Maintenance` is `IsActive true`, but **neither is
     `available` to the running profile** — only `Master` is. An insert with no `RecordTypeId` succeeds
     on `Master`. A33.4.3(d)'s stated blocker is not a write blocker.

15m. **⚠️ `acnpex_CreditActionRequestSample` is a landmine: it ignores its inputs and runs a real
     `Renewal` against hardcoded ids** (`contextId = 'a5Fbb0000001C9kEAE'`, loan `a4Zbb000000xykvEAA`,
     `isAsync = true`). Never invoke it to inspect a request shape. Read the class instead.

15n. **`acnpex_CreditActionRequest` swallows the credit action's real failure reason.** Its unguarded
     tail query (`newLoan = [... limit 1]`) assumes a clone exists, so every no-output failure surfaces
     as `System.QueryException: List has no rows for assignment to SObject` while `failureReasons` is
     discarded. Call `performAction()` directly and read the result object, or bankers get a platform
     stack trace instead of the bank's own refusal. Note also that **no `LLC_BI__*CreditAction*`
     invocable is exposed in the Actions API at all** — the only route is this local wrapper.

15p. **An after-commit async flow can NEVER be awaited inside the transaction that triggered it, and
     Apex has no sleep, so a "bounded wait" in a synchronous invocable is an anti-pattern.** Wave 4
     proved both halves on the Loan Detail: a 6 s in-transaction spin left the lookup `null`, the same
     loan showed the child populated after commit, and the spin itself burned 6,511 ms of the
     10,000 ms synchronous CPU limit. A 30,000 ms declared budget is 3x the entire ceiling, so the
     platform fault fires before the tool's own `filed_unverified` fallback can ever be reached.
     RULE: never spin-wait in Apex. A tool that depends on an after-commit side effect must **return**
     with the record id and a `filed_unverified` wait step, and let the caller re-invoke behind the
     idempotency fence. Measure before blaming the payload: the loan insert itself cost only 681 ms CPU,
     so the insert was never the problem.

15r. **The two-invocation resume is the correct shape for any after-commit dependency, and it is
     live-proven.** Invocation 1 writes, commits and returns `partial` + `resumable`; invocation 2 does
     ONE re-read and either completes or stays `waiting`. Measured on the redeployed
     `execute_new_facility`: 6 s then 4 s, zero CPU exposure, all six steps `verified`, one resume
     sufficed after a 12 s gap. The token is consumed exactly once, by invocation 1. **Never make an
     absent async child a failure** — `waiting` and `resumable` are the honest states.

15s. **`required=true` on an `@InvocableVariable` is enforced by the Actions API BEFORE Apex runs, so a
     "pass null on resume" contract cannot be expressed.** `"decisionToken": null` and omitting the key
     both return `REQUIRED_FIELD_MISSING: Missing required input parameter: decisionToken`, even though
     the Apex resume path never reads the field. Any optional-on-resume parameter must either be
     declared `required=false` or be given a non-blank placeholder by the caller. Check this whenever a
     tool has more than one call shape: the Apex contract and the wire contract can disagree silently
     until a live call proves it.

15t. **Some success paths are unreachable in test context and can only be proven by probe.** The
     `execute_new_facility` invocation-2 success path depends on an after-commit flow that test context
     never runs, so unit tests can only cover the still-waiting branch. Green tests will not catch a
     regression there. Record such paths as probe-verified in the ledger and re-run the live check after
     any refactor. Coverage is not the same as evidence.

15y. **Product Packages in this org carry NO record type, and follow a wizard naming convention.**
     Live SOQL 2026-07-26: the 12 most recent packages all have `RecordTypeId` null, including ones
     nCino's own wizard created, and 516 of 518 are named `<Account Name> - <M/D/YYYY> - PP`. Create
     packages that way and agent-created packages are indistinguishable from wizard-created ones in a
     list view. **A33.4.3(d)'s `Deal_Proposal`-inactive concern is moot**: probe 9 already showed only
     `Master` is available to the running profile and an insert with no `RecordTypeId` succeeds.
     Package creation wakes `PPCacheCreation` and `ProductPackageBaselineCaptureTrigger`, both of which
     swallow failures to `System.debug`, so those steps are org-side unverifiable by construction.

15z. **Refuse at stage what the org can never execute.** `stage_loan_modification` and `stage_renewal`
     now refuse a facility that is not `Booked` + `Open`, in banker copy naming the rule and the
     facility's actual stage. Staging a plan the credit action would reject is dishonest staging.
     Consequence to accept rather than engineer around: the successful plan shape becomes untestable,
     because `Booked` is unreachable through the API (LV05/LV06, no bypass). Do not contrive a fake
     booked loan to recover the coverage; that tests the mock, not the org.

15q. **A platform LimitException rolls the whole invocable back cleanly, and a well-built fence
     survives it.** When `execute_new_facility` died on CPU, no Loan was created and the staging row
     stayed `Staged` with the token unconsumed and the plan resumable. Verify this property deliberately
     after any fault: an uncaught fault that leaves a half-consumed token is a far worse defect than the
     fault itself.

15u. **Borrowing structure lives on `LLC_BI__Legal_Entities__c` (label "Entity Involvement"), and a Loan
     insert does NOT create one.** One hard-required field (`LLC_BI__Account__c`, cascade-delete from
     the account); both `LLC_BI__Loan__c` and `LLC_BI__Product_Package__c` are populated on every real
     row. The role field is **`LLC_BI__Borrower_Type__c`**: `Borrower, Guarantor, Limited Guarantor,
     Co-Borrower, Related Entity, Grantor, Contractor`. **There is no primary-borrower boolean** — the
     role is the flag, and `Is_Borrower__c` / `Is_Guarantor__c` / `Is_CoBorrower__c` / `Is_Grantor__c` /
     `Is_Related_Entity__c` are **formulas** derived from it: never write them. Proven with a control
     (the Loan Detail appeared, involvement rows did not): **any tool that creates a facility must also
     create the borrower row, or the facility has no borrowing structure at all.**

15v. **`LLC_BI__Ownership__c` and `LLC_BI__Contingent_Amount__c` are mutually exclusive on one
     involvement row.** VR `Contingent_Amount_and_Contingent_Percent` fires whenever both exceed zero;
     its only escape tests for `Household` in the role, and **no active role value contains
     `Household`**, so the rule is unconditional in practice. Every real row in the org sets Ownership
     (usually 100) and leaves Contingent Amount null. Also: `Ownership_Less_Than_0` tests
     `LLC_BI__Ownership__c` but its message says "Contingent Percentage" — **mirror the formula's field,
     never the message's noun** (same defect class as `Mandatory_comment` on Risk Rating Review).

15w. **RECORD-TYPE PICKLIST SCOPING IS NOT ENFORCED BY THE API, and the global describe lies about what
     is offerable.** On `LLC_BI__Loan__c`, the Commercial Loan record type omits `Term` from Product,
     `Complete` from Stage, and all four `Pre-*` values from Status — yet a PATCH writing
     `Product = 'Term'` onto a Commercial-RT loan returned 204 and stored it (all three picklists are
     `restrictedPicklist: false`). **We already shipped this bug**: the wave-4b `stage_new_facility`
     probe passed `Term` and created a loan carrying a value its own record type does not offer. RULES:
     read offerable values from
     `/services/data/v67.0/ui-api/object-info/{obj}/picklist-values/{recordTypeId}/{field}`, never from
     the describe; and validate the value server-side, because nothing on the platform will.

15x. **Check `dependentPicklist` before assuming a picklist chain exists.** (Independently confirmed
     by the wave-2.1 build round, which reached the same conclusion from the tool side and whose
     duplicate entry was merged into this one.) The Product
     Line/Type/Product fields *look* like a hierarchy and are three independent, unrestricted picklists
     with no controller. bankinggpt has exactly three dependent picklists, all on Loan
     (`Lead_Specifics` ← `LeadSource`, `Lost_To` ← `Status`, `Structure_Hierarchy` ← `Structure`), and
     **none is on any write list our tools use**. Decode `validFor` (base64 bitmap, bit index = the
     controller's value position, MSB first per byte) rather than guessing. Package, Entity Involvement
     and Collateral Valuation have none at all.

15y. **A `PRIORVALUE`-based validation rule does NOT fire on insert, so "post-approval stages are
     unreachable" is only true of UPDATES.** `Loan_Validation_06` (and `Review_Validation_01/02`) test
     `ISPICKVAL(PRIORVALUE(Stage),...)`, which is blank on an insert. A loan can therefore be **created**
     directly at `Booked` with no bypass, as long as `LLC_BI__lookupKey__c` is supplied to satisfy LV05.
     Six facilities were migrated this way with the `Exclude_Validation` fence untouched. This does NOT
     weaken the wave-3 finding that LV06 blocks a *stage hop* to Booked, which is what the credit-action
     path needs: **insert-at-Booked and transition-to-Booked are different questions with different
     answers.** Always test the insert path separately.

15z. **Never trust a subagent's static reading of a validation rule over an empirical test.** The
     loan-children research agent read LV05/LV06 and concluded they "will block a migration that sets
     Stage = Booked directly." They do not. Acting on that would have meant granting
     `Exclude_Validation` on a shared sandbox for no reason. Agent output is a hypothesis; the org is the
     authority.

15aa. **Record-type ASSIGNMENT and RESTRICTED picklists are hard walls; unrestricted picklists are not.**
     Refines 15w. Writing a `RecordTypeId` the running profile is not assigned fails with
     `INVALID_CROSS_REFERENCE_KEY`; writing a restricted picklist value outside the record type fails
     with `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`; writing an **unrestricted** picklist value outside
     the record type **silently succeeds**. Check `restrictedPicklist` and the profile's record-type
     assignments before planning any migration payload.

15ab. **Model a commercial family group with `LLC_BI__Connection__c`, never a Household.** In bankinggpt
     the FSC household machinery is installed and structurally complete but unused: all 5 households are
     test artifacts with zero rollups, 0 of 208 Connections use household roles, and `Account.ParentId`
     is null on all 762 accounts. Insert only the detail-bearing connection direction and let
     `LLC_BI.ConnectionTrigger` create the mirror; populate `LLC_BI__UID__c` = `FromId+ToId+RoleId`.

15ac. **`LLC_BI__Loan_Collateral2__c` requires THREE parents.** `Collateral`, `Loan`, **and**
     `LLC_BI__Loan_Collateral_Aggregate__c`, which must be created first (no required fields, one per
     loan by org convention). Keep `Amount_Pledged <= Current_Lendable_Value` and
     `Pledge_More_Than_Lendable_Value` never fires, so `LLC_BI__Authorize__c` never has to be set. Any
     advance rate other than the collateral type's default needs `Advance_Rate_Override__c` **plus** a
     written `Override_Reason__c`.

15ad. **Migration field-length traps in the nCino model:** `LLC_BI__Collateral__c.LLC_BI__Description__c`
     is 255 (use `LLC_BI__Collateral_Legal_Description__c`, 32k, for the real narrative);
     `LLC_BI__Policy_Exception__c.LLC_BI__Mitigation_Reason_1..3__c` are 100 each;
     `LLC_BI__Legal_Entities__c` has **no** `Description` field at all (the narrative field is
     `LLC_BI__Notes__c`, and `Migration_ID__c` / `Integration_Source__c` exist for provenance).

15ae. **Build permanent data through an idempotent registry, not a straight script.** Every insert keyed
     into a local `registry.json` and skipped if the key already existed. Six payload errors were hit
     during the Hartwell migration (derived field, formula field, restricted picklist, unavailable
     record type, two length overflows) and each rerun resumed cleanly with **zero duplicate records**.
     For permanent data a partial failure must never force a choice between duplicates and manual
     cleanup.

15o. **Deploy-free instrumentation pattern.** When a probe needs trigger-level evidence, create your own
     `DebugLevel` and `TraceFlag` on the probe actor, pull the log with `sf apex get log`, then delete
     both and verify. Never reuse or edit an existing one. The high-value greps: `ENTERING_MANAGED_PKG`
     for the namespace census, `VALIDATION_RULE` for the rule inventory, `FLOW_ELEMENT_BEGIN` for flow
     identity (element names are far more legible than flow ids, which resolve poorly), and the
     `LIMIT_USAGE_FOR_NS` block for the callout/future/queueable/email counts that settle whether
     anything left the org.

## 3c. Campaign doctrine: what "do not touch the existing build" protects

**Standing rule, founder-approved 2026-07-26. Do not re-litigate this per round.**

The no-touch prime directive protects the org's **pre-existing build**: nCino, managed packages,
other teams' config, and standing data. It does **not** freeze the components this campaign created.

- **Never touched:** anything that existed before this campaign. Probes run on throwaway data.
- **May evolve ADDITIVELY, with a quoted receipt:** our own components. That is the four-class
  engine (`C360Plan`, `C360WriteGuard`, `C360ActionStaging`, `C360Picklist`), `cm_Action_Staging__c`,
  our tool classes, and the `Customer360` server definition's tool rows.
- **The receipt is the control.** A `Changed` receipt on one of our components is fine when the diff
  is additive and quoted. A `Changed` receipt on anything else is a STOP.

Worked example: wave 2 extended `C360WriteGuard` with three new object rows (109 added lines, no
existing row altered, no branch removed) and the server definition from 15 to 23 tool rows. Both
deployed as `Changed (our component, additive, approved)`.

Corollary that follows from the same logic: extending the allowlist in `C360WriteGuard` is
MANDATORY, not optional. Rule 18 forbids inlining a fence in a tool class, so a new write target
always means a `Changed` receipt on the guard. Plan for it rather than treating it as a blocker.

## 4. Apex patterns locked in (follow them in wave 2)

16. **One `@InvocableMethod` per class** — it is the MCP exposure contract, not a style choice.
    `global with sharing`, positional `List<Response> run(List<Request>)`, all wire-visible types as
    global inner classes, wire types NOT shared across classes (duplication accepted: it is the only
    serialization shape proven in this org). API version 67.0.

16aa. **`@InvocableVariable(required=true)` is enforced by the REST Actions API BEFORE your Apex runs,
     and NO Apex unit test can see it.** Direct invocation from a test calls the method with whatever
     you construct; the platform's required-field check only exists on the wire. Consequence: a tool
     that grows an ALTERNATIVE input shape must drop `required=true` from every field the new shape
     supersedes, and enforce requiredness in Apex instead.

     Shipped defect, 2026-07-27: `stage_collateral_valuation` gained `items[]` for bulk while its flat
     `collateralId`/`value` kept `required=true`. An items-only call was refused by the platform with
     `REQUIRED_FIELD_MISSING: Missing required input parameter: collateralId` and our Apex never
     executed. The suite was 141/141 green throughout, because it structurally cannot reach that layer.

     RULES: (1) any either-or input pair is `required=false` on both sides, validated in Apex, which
     can also name WHICH item of a batch is wrong; (2) the nested Apex-defined type gets the same
     treatment, since enforcement on nested required flags is unproven and Apex validation is strictly
     better; (3) **observe the envelope on the wire after any input-shape change** — a green suite is
     not evidence about the invocable contract. Audit with:
     `grep -oP "@InvocableVariable\(label='\K[^']+(?=[^)]*required=true)" *.cls`

     **Audit caveat (2026-07-27).** That grep cannot tell an ATTRIBUTE from the same characters inside
     a `description=` string literal, so a field documented as "not flagged required=true" reports as
     required. It fired a false positive on `stage_loan_modification` and `stage_renewal`, whose
     descriptions were then reworded to "not flagged required on the invocable".
     **`StageCollateralValuation` still carries the tripping prose on `collateralId` and `value`** and
     will keep reporting as a false hit until someone rewords it. Confirm every hit by reading the
     line before acting on it.

16a. **NEVER mix `Id` and `String` in a ternary.** Apex infers the expression type from the operands,
    so `(name == null ? record.Id : name)` resolves to `Id` and coerces the String branch through
    `Id.valueOf()`, which throws `System.StringException: Invalid id: CV-0000000004` at runtime on a
    perfectly good record. It costs a full test round every time. Always `String.valueOf(record.Id)`.
    This bug shipped once, was fixed, and **recurred in all three wave-2 execute classes**, so it is
    a rule now rather than an anecdote.

16c. **Some coverage is legitimately unreachable, and padding it is worse than reporting it.**
    `ExecuteNewFacility` sits at 77.1% because its phase-2 success path cannot run in a test
    transaction: nCino creates the Loan Detail through an async-path FLOW in a separate transaction
    (probe 5), which does not fire inside a test, so the poller always takes the timeout branch and
    the purpose-write plus stage-hop lines never execute. The timeout branch IS tested and asserts
    the correct behaviour (`filed_unverified`, dependent steps `skipped_not_attempted`, facility left
    at Qualification). Clearing the rest needs a live run, not a cleverer test. Document the gap and
    leave it; do not contrive a fake to colour it in.

16b. **Fixture lookups go through the RELATIONSHIP, never through `Name`.** nCino rewrites names on
    save (probe 5 proved it on Loan), so a Name-keyed fixture query silently returns zero rows and
    every dependent test dies with "List has no rows for assignment to SObject".

17. **Security stack on every write path:** `WITH USER_MODE` on queries, `insert as user`,
    `Security.stripInaccessible` PLUS a must-survive assertion on fields whose silent stripping would
    corrupt semantics (a stripped `LLC_BI__Status__c` files a Review in no status — probe 3's trap).

18. **The A33 fence mechanics:** stage_* = zero domain DML, plan + hash + staging record only, no
    record id in stage output. execute_* = token-gated (single-use, hash-stored, bound to
    stagingId + planHash + user, approver must BE the running identity), idempotency key enforced on
    both sides, transition allowlist enforced in `C360WriteGuard` (extend the allowlist there, never
    inline in a tool). Reuse the four-class engine (`C360Plan`, `C360WriteGuard`, `C360ActionStaging`,
    `C360Picklist`); a new action is two thin tool classes + one test class.

19. **Bypass fence:** `Exclude_Flow`/`Exclude_Trigger` per action per the A33.5.5 matrix (modification
    and renewal WITH, new facility WITHOUT — its design depends on the async Loan Detail flow),
    `Exclude_Validation` NEVER. VRs carrying no `$Permission` apply to the agent exactly as to bankers;
    that is correct, do not fight it.

20. **Re-run write-contract describes as the service identity before shipping** — createable/updateable
    are FLS-scoped, and missing FLS on the renewal/modification flag fields mis-types loans silently.

## 5. Probe discipline (unchanged, now with teeth)

21. Every write object gets an insert (or update) probe before its tool is built; evidence goes to
    PROBE-LEDGER.md with verbatim request, returned ids, verification query + result, and deletion
    verification by re-query. Loan-shaped probes run against throwaway `ZZ-PROBE-<date>` accounts,
    never Piedmont or any demo-visible account, cleanup verified by query.

22. **Wave 2 blocking probes, in order:** covenant approval-chain entry criteria (which field write
    starts `acnpex_covenantApprovalProcess` — every covenant tool is HELD until this lands),
    `LLC_BI__Annual_Review__c` insert, collateral rollup behavior, Slack watch on Case insert, and
    LAST, isolated: the loan clone through the nCino invocable.
    **STATUS after the WP3 campaign, 2026-07-26:** covenant entry criteria **CONFIRMED** (Create-only,
    zero filters, settled from Flow metadata with no writes); `LLC_BI__Annual_Review__c` insert
    **CONFIRMED**; collateral rollup **CONFIRMED negative**; Slack watch **CONFIRMED** (trigger runs,
    emits nothing, gated on a queryable subscription); loan clone **HELD**, blocked by LV06. Also
    confirmed en route: `LLC_BI__Loan__c` insert, Product Package creation, and the
    Qualification → Proposal hop. See `PROBE-LEDGER.md` wave 3.

23. **HELD is a result, and it is the discipline working.** Two of the six WP3 probes were held. Both
    holds are load-bearing: the covenant write arm because the only throwaway route fires an approval
    step at a named human, the loan clone because LV06 puts the required stage out of API reach. A probe
    that stops at the prime directive and records the exact blocking fact has produced more usable
    engineering truth than one that improvises around it. Record the reason verbatim, then stop.

24. **Settle it from metadata before you settle it with a write.** The covenant question had been the
    single gating unknown for every covenant tool, and it was answered in one Tooling API read of the
    flow's `start` element. Order of attack for any "what starts X" question: read the automation's
    definition first, use a write only for what the definition cannot tell you (defaults, overwrites,
    async timing, rollups). Writes are for behaviour, not for configuration.

25. **`select` is a reserved identifier in Apex, and the compiler blames the wrong line for it.**
    A shared helper `C360Facilities.select(String, List<Id>, String)` produced twelve cascading errors
    on the DECLARATION line: `Unexpected token '<'`, `Identifier name is reserved: List`,
    `Method does not exist or incorrect signature: void isNotBlank(String) from the type List<Id>`.
    None of them names `select`. The parser gives up on the method signature, then misattributes every
    downstream expression. Same trap applies to any SOQL keyword used as a method or variable name.
    Corollary found in the same round: a local variable that shares its name with a private method in
    the same class (`String ref = ref(i, n)`) shadows the method. Rename the local, not the method.
    RULE: when a fresh class explodes with a dozen parse errors all pointing at one line, read that
    line for a reserved word before reading anything else.

26. **An either-or input pair needs the flat shape to survive the platform's empty-list ambiguity.**
    When `stage_loan_modification` and `stage_renewal` grew `facilityIds` alongside the flat `loanId`,
    the obvious rule ("an explicitly supplied but empty `facilityIds` is refused") is only safe when
    the flat shape is absent. It is not settled whether the Actions API delivers an omitted List as
    `null` or as an empty List, and by lesson 16aa no Apex test can settle it. If the platform hands
    Apex an empty list for an omitted key, a rule that refuses `loanId` + `[]` breaks EVERY
    back-compat call on the wire while the suite stays green. So: refuse the empty list only when no
    flat value was supplied, and let flat + empty take the flat path. The refusal the spec wants is
    preserved for the case that matters; the back-compat shape never depends on an unobserved
    platform behaviour. Generalise: when adding an alternative shape, make the OLD shape's success
    independent of any assumption about how the platform serialises the new one.

27. **A package-anchored tool must actually check package membership, and the check has to be
    Id-to-Id.** The pre-`facilityIds` `stage_loan_modification` took `productPackageId` and `loanId`
    and never verified the loan was on that package, so a caller could stage a plan anchored on a
    package the facility has nothing to do with, and the deep link would point at the wrong deal.
    The fix is one comparison, but it must be `Id != Id`: comparing the loan's 18-char
    `LLC_BI__Product_Package__c` against the caller's raw String refuses every 15-char id. Parse the
    anchor through `Id.valueOf` plus a `getSObjectType()` check first (lesson 4b, fail closed), then
    compare typed values. Verified live: the Hartwell LoC refused against a foreign package id and
    named where it actually belongs.

## 6. Platform/cockpit side (for completeness)

23. The claude.ai artifact-connector bridge has a per-page-session trust budget burning on call volume
    AND payload shape; prompts from a page to an LLM tool must be short banker prose (600-char cap,
    sanitizer); the block wording blames "organisation policy" but is platform metering; quarantine is
    per-connector and account-wide for pages; recovery = fresh page grant or time. Demo doctrine:
    under 10 asks per beat, reload between segments.

24. Capability pages: no polling (staleness-based refresh only), callTool on user gesture only, one
    observed request/response pair per tool before publish.

## 7. Collateral coverage correctness (2026-07-28, Apex lane)

28. **The pledge's `LLC_BI__Current_Lendable_Value__c` is the WHOLE collateral's lendable value, not
    the facility's slice — so it must never be summed across facilities.** It is a plain currency
    field (not a formula) and it equals `Collateral_Value x the pledge's advance rate` on 14 of the
    org's 15 pledges. Three of Hartwell's four assets are pledged to two facilities each, so the
    old `Σ per-pledge Current_Lendable_Value` claimed 59.2MM of a 31.6MM pool. The facility's own
    share is **`LLC_BI__Amount_Pledged__c`**, and `LLC_BI__Unique_Id__c` on the pledge
    (`<aggregateId> - <collateralId>`) confirms the pledge is a per-collateral allocation row.
    RULE: facility-level math divides Amount_Pledged; relationship-level math dedupes by
    `LLC_BI__Collateral__c` and counts each asset's lendable value once. Never mix the two.

29. **`LLC_BI__Loan_Collateral2__c.LLC_BI__Advance_Rate__c` is the single source of truth for the
    advance rate, and it is a formula that already resolves the precedence.** Verbatim:
    `IF(NOT(ISBLANK(Advance_Rate_Override__c) || ...==0), Advance_Rate_Override__c,
    IF(NOT(ISBLANK(Auto_Applied_Advance_Rate__c) || ...==0), Auto_Applied_Advance_Rate__c,
    Collateral__r.Collateral_Type__r.Advance_Rate__c))`. The COLLATERAL record carries a different
    formula (the type's rate only), which reads 80% in this org on assets whose pledges are
    overridden to 50% and 75%. A surface reading the collateral side shows a different lendable
    value for the same asset than one reading the pledge side. Read the pledge side, always, and
    report which arm won so the number is auditable.

30. **`LLC_BI__AmountOutstanding__c` is dead in bankinggpt and `LLC_BI__Principal_Balance__c` is the
    live balance.** 1 of 542 loans has AmountOutstanding, and on that one it reads 0 against a real
    124,887 Principal Balance. 203 loans have Principal Balance. 0 loans have Principal Balance null
    AND AmountOutstanding non-null, so the fallback is insurance that has never fired. Two
    independent org-side confirmations: summing Principal Balance across Hartwell reproduces the
    package rollup exactly (31,030,000 / 14,970,000 unused), and nCino's own `LLC_BI__Current_LTV__c`
    formula divides `Principal_Balance + Total_Superior_Lien_Amount` for booked non-LoC facilities.
    Corollary: `LLC_BI__Amount_Available__c` is a formula over AmountOutstanding and is therefore
    blank wherever the balance actually lives — compute availability, never read it.

31. **A missing basis is not a zero basis. Return null with a reason.** Exactly 1 of 15 pledges
    org-wide has a null `Amount_Pledged`, and that row's `Original_Lendable_Value` (34,000) and
    `Current_Lendable_Value` (80,788.50) disagree, so nothing in the data licenses the inference
    "null means the whole asset". The read returns `coverageRatio = null` plus a `coverageNote`
    naming which pledges lack a share. Same treatment where all pledges are Excluded: the facility
    says "all N pledges are flagged Excluded or Abundance-of-Caution", rather than showing an empty
    collateral table with no explanation. That means filtering the excluded pledges in APEX, not in
    the SOQL WHERE clause — a filtered-away row cannot be counted or explained.

32. **Re-updating an sObject returned by `insert` fails on any set-once field it carries.**
    `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` is `updateable: false`, so
    `p = pledge(...); p.LLC_BI__Is_Excluded__c = true; update p;` dies with
    `System.DmlException: Operation failed due to fields being inaccessible on Sobject
    LLC_BI__Loan_Collateral2__c` — an error that names the object but not the offending field, and
    points at the DML line, not the field assignment. Cost two test failures on the first validate.
    RULE: update through a FRESH sObject carrying only `Id` plus the fields you are changing.

33. **Linking `LLC_BI__Loan__c.LLC_BI__Loan_Collateral_Aggregate__c` is inert at staging time, and
    `LLC_BI__Is_Secured__c` does NOT follow from it.** Six Hartwell loans linked per nCino KB
    `kAHHu000000XabhOAC`; `Total_Collateral_Value__c`, `Current_Total_Lendable_Value__c` and
    `Current_LTV__c` populated instantly (they are formulas through the lookup), but `Is_Secured__c`
    stayed `false` on all six because it is a **plain writable boolean, not a formula** — the
    standing docs had this wrong. `stage_renewal` on the same facility returned a byte-identical
    response before and after (same `planHash`), and no pledge, collateral or aggregate record was
    written. The KB `kAHHu000000XadDOAS` DUPLICATE_VALUE risk is an EXECUTION-time risk only.
    Two live data points on it: 2 of the org's 43 renewals have a parent loan carrying an aggregate,
    both succeeded, and one of the two cloned the pointer onto its child — producing exactly the
    shared-aggregate shape KI `kAHPY0000005A1x4AE` warns about. The org's own
    `Fields_To_Not_Clone_Renewal` field set (org-local, unmanaged, 15 fields) already excludes
    `LLC_BI__Fee_Loan_Aggregate__c` but NOT `LLC_BI__Loan_Collateral_Aggregate__c`. Do not change
    that field set: it is pre-existing org config. Re-probe when `execute_renewal` unblocks.

---

## 8. The version discard: probe answers before the first delete (2026-09-13, A2 lane, 0.9.23)

Every item here is read-only evidence from bankinggpt-at, taken BEFORE `StageDiscardVersion` /
`ExecuteDiscardVersion` were written, in answer to the four probes the 0.9.23 contract demanded.
Nothing in this section was settled from the spec's wording.

### 8a. There is NO managed undo we can call. The delete chain is the route, not the fallback.

34. **`LLC_BI.ActionedLoansRollbackProcessor` exists and is unreachable from Apex.** The org carries
    `ActionedLoansRollbackProcessor`, `...Aura`, `...Remote` and their tests. None is callable:
    - the Tooling API returns `SymbolTable = null` for all of them, and the SAME query returns a
      populated SymbolTable for `nFORCE.BeanFactory`, `nFORCE.ACrossPackageService` and
      `nFORCE.CallableApi_v1`. **That control is what makes the null meaningful**: a null SymbolTable
      on a managed class is the Tooling API's way of saying "not global", not a blanket behaviour.
    - none appears among the org's **174** invocable Apex actions
      (`/services/data/v62.0/actions/custom/apex`); the only `LLC_BI__*` entries are `*Invoker`
      loaders and savers plus `CreateCreditReviewInvoker`, `GenerateDocument`, `LoanAutoDecision`,
      `MemoController`, `QueuedFlow`, `RLTVCalculatorInvoker`, `TotalExposureInvocable`.
    - `/services/data/vXX/tooling/completions?type=apex` returns **standard namespaces only** (170 of
      them, zero managed), so it is useless for this question. Do not waste a round on it.
    - `nFORCE__Bean_Registry__c` is an installed CustomObject that the data API refuses
      (`sObject type 'nFORCE__Bean_Registry__c' is not supported`), so the registered bean list
      cannot be enumerated read-only. The one credit-action bean we know of is
      `LLC_BI.InvokableCreditActionXPkg`, and it performs actions rather than undoing them.
35. **nCino's rollback is a different thing from a banker's undo anyway.** PDI-00018042 describes the
    AUTOMATIC rollback of a FAILED credit action, gated on the "Credit Actions Delete" permission
    set. It is not a supported way to remove a credit action that succeeded. The Aura and Remote
    variants are the entry points for nCino's own Rollback button, which is UI-bound.
    **Remaining unproven leg:** `nFORCE.CallableApi_v1`'s `verify` action could enumerate registered
    services, but it needs an executeAnonymous. That is a one-line read-only reflection probe for
    whoever runs the org proof; our chain is correct either way.

### 8b. Delete rights: the integration user already has all of them.

36. **"Credit Actions Delete" EXISTS and IS ASSIGNED.** `LLC_BI__Product_Package_Credit_Actions_Delete`
    (label `Credit Actions Delete`, id `0PSbb000000EEWZGA4`) is one of four permission sets assigned
    to `fabian.goetzens@accenture.com.bankinggpt` (`005bb00000ftouDAAQ`), alongside
    `LLC_BI__Credit_Actions_and_Reviews_User` and `C360_Action_Staging_Access`. `ObjectPermissions`
    over every assigned parent shows `PermissionsDelete = true` on all twelve objects in the discard
    inventory, granted by the System Administrator profile. There is no permissions blocker.

### 8c. Cascade behaviour: read it off `childRelationships`, not off the field describe.

37. **The Loan's `childRelationships` is the fastest complete answer to "what blocks a delete".** One
    `sf sobject describe -s LLC_BI__Loan__c` carries `cascadeDelete` and `restrictedDelete` for every
    child. For `LLC_BI__Loan__c` in this org:
    - **CASCADE (go with the facility, never deleted by us):** `LLC_BI__Loan_Covenant__c`,
      `LLC_BI__Fee__c`, `LLC_BI__Loan_Detail__c`, `LLC_BI__LLC_LoanDocument__c`,
      `LLC_BI__Covenant__c`, `LLC_BI__Loan_Collateral__c`, `LLC_BI__Pricing_Option__c`,
      `ProcessInstance`, and `LLC_BI__LoanRenewal__c` **through `ParentLoanId` only**.
    - **RESTRICTED (block the facility delete):** `LLC_BI__Loan_Collateral2__c`,
      `LLC_BI__Loan_Compliance__c`, `LLC_BI__Opportunity_History__c`, `LLC_BI__Repayment_Vehicle__c`,
      `LLC_BI__Spread__c`, `LLC_BI__Statistic__c`, `AuthFormRequestRecord`,
      `DocChkItemValidatedTarget`, `RecordAlert`.
    - **PLAIN LOOKUP (must be deleted explicitly):** `LLC_BI__Pricing_Stream__c`,
      `LLC_BI__Legal_Entities__c`, `LLC_BI__Pricing_Rate_Component__c` and
      `LLC_BI__Pricing_Payment_Component__c` (both through the org-local `cm_Loan__c`, and both are
      master-detail on `LLC_BI__Pricing_Stream__c` as well), `LLC_BI__LoanRenewal__c` through
      `RenewalLoanId`, and `LLC_BI__Loan__c.LLC_BI__Product_Package__c`.
    On `LLC_BI__Product_Package__c` the only `LLC_BI__*` restricted child is
    `LLC_BI__Opportunity_History__c`; its loans are a plain lookup, so a package delete neither
    cascades to nor is blocked by its members.
38. **`LLC_BI__LoanRenewal__c.RenewalLoanId` is a PLAIN LOOKUP while `ParentLoanId` is the
    master-detail leg.** That single asymmetry is the whole reason the 2026-09-11 manual chain was
    needed: deleting the clone strands the row on the booked parent, and a stranded row makes every
    later credit action fail with "The request contains invalid facilities". Chain rows go FIRST.
39. **`LLC_BI__Opportunity_History__c` is a trap that must NOT become a refusal.** It carries
    `restrictedDelete` against both the Loan and the Product Package, AND nCino mints one at loan
    CREATION (observed to the second: loan `a4Zbb000002ICnxEAG` created at `13:07:29`, OH-00035535
    created at `13:07:29`). All nine Hartwell facilities carry at least one. Refusing on it would
    refuse EVERY discard, and the 2026-09-11 manual run deleted its clone loans successfully with
    those rows present, so nCino's own delete handling clears them. Treat it as an expected org-side
    clearance, warn about it in the plan, and let a failure stop the chain honestly. The other four
    restricted children hold **zero rows org-wide**, which is what makes their presence a banker
    artefact worth refusing on.

### 8d. `hasRenewal` is a formula over a rollup, and the self-anchor does not feed it.

40. **`LLC_BI__hasRenewal__c` is `LLC_BI__Number_Of_Renewals__c > 0`** (read off the describe's
    `calculatedFormula`), and `Number_Of_Renewals__c` is a rollup whose filter is managed and
    therefore unreadable. Live rows settle what it counts:

    | Parent | chain rows | Number_Of_Renewals | hasRenewal |
    |---|---|---|---|
    | Hartwell `a4Zbb000002ICnxEAG` and `ICnyEAG` | one revision-0 self-anchor each, `HasActiveRenewalLoan=false` | 0 | false |
    | Piedmont `a4Zbb000001vavpEAA` | self-anchor plus revision-1 `Superseded`, `HasActiveRenewalLoan=true` | 1 | true |
    | EverPetal `a4Zbb000000xTy5EAE` | self-anchor plus revision-1 `In Progress`, `HasActiveRenewalLoan=true` | 1 | true |

    **Only the revision row that points at a clone counts.** The 0.9.23 contract's parenthetical
    "both revisions; this is what flips the parents' hasRenewal formula back" is therefore half
    right: the revision row flips it, the self-anchor is bookkeeping.
    **Consequence for any future undo:** delete the revision rows always, and delete a self-anchor
    ONLY when the same fork minted it (`CreatedDate` not earlier than the version package's). A
    parent that already carried a self-anchor (Hartwell's Real Estate pair do) would otherwise have
    pre-existing data destroyed for no gain.
41. **`LLC_BI__LoanRenewal__c` has THREE hard-required createable fields**, not one:
    `LLC_BI__ParentLoanId__c`, `LLC_BI__PreviousVersionStage__c`, `LLC_BI__PreviousVersionStatus__c`.
    The two version fields are absent from every doc and cost a validation round on the first
    fixture. All 45 live rows carry `Booked` and `Open`, which is what the parent was before the fork.

### 8e. The contract's step 7 cannot be honoured yet: there is no `Withdrawn`.

42. **`cm_Action_Staging__c.cm_Status__c` is a RESTRICTED picklist offering exactly
    `Staged, Executing, Completed, Partial, Failed`.** `Withdrawn` is not among them, and
    `restrictedPicklist: true` means the org REFUSES the write rather than storing it silently
    (contrast lesson 15w, which is about unrestricted picklists). Adding a picklist value to our own
    object is a founder call, so `ExecuteDiscardVersion` reads the value off the org at run time:
    where it is offered the rows are marked and verified, where it is not the rows are LEFT AS THEY
    STAND, the step reports `skipped_not_attempted` naming the missing value, and the run reads
    PARTIAL. **Proposal on the table: add `Withdrawn` to `cm_Status__c`.** Note the org's LOAN status
    picklist already offers `Withdrawn`, so the word is the org's own.

### 8f. Two object-model corrections the contract's wording needs.

43. **There is no loan-side document placeholder in this org.**
    `LLC_BI__Document_Placeholder__c` exists but carries NO `LLC_BI__Loan__c` and NO
    `LLC_BI__Product_Package__c` lookup (its parents are DocClass, DocType, DocTab, DocManager,
    Requirement, Closing Checklist, Document Store Index, plus NDOC's account, collateral and
    deposit legs). The loan-side document object is `LLC_BI__LLC_LoanDocument__c`, it is
    **master-detail on the Loan (cascade)**, and "with content" is `LLC_BI__Has_File__c`. Because it
    cascades, a filed document would be destroyed silently by a facility delete, which is exactly why
    it is a refusal. `Has_File__c` is a FORMULA and is not createable, so that refusal branch cannot
    be unit-tested; it is a live-probe item.
44. **A settled approval must not be a refusal.** `ProcessInstance` keeps its row forever: of this
    org's 62, **42 read `Removed`**, 13 `Rejected`, 6 `Approved`, 1 `Started`. `ApprovalSubmission`
    offers `Approved, Canceled, Errored, InProgress, Recalled, Rejected, Suspended`. Refusing on the
    mere existence of an approval row would make a recall a one-way door: the banker pulls the
    version back and can then never discard it. Refuse on LIVE only (`Pending` or `Started` on
    ProcessInstance, `InProgress` or `Suspended` on ApprovalSubmission) and warn on the rest.

### 8g. Residue the frozen inventory does not cover.

45. **A pledge delete orphans its `LLC_BI__Loan_Collateral_Aggregate__c` shell, and the 0.9.23
    inventory does not name the shells.** `revert-hartwell.py` had to sweep orphans in a loop for
    exactly this reason. `ExecuteDiscardVersion` reports them as an observed side effect and does NOT
    delete them: the aggregate is a per-loan rollup anchor, a booked parent's facility can point at
    one (lesson 33 records a renewal that cloned the pointer), and this action never removes what it
    did not put there. **Open for the founder:** add the clone-owned shells to the inventory, or
    accept inert orphans.

### 8h. The delete fence, and why it is a second door rather than a wider one.

46. **`C360WriteGuard.assertAllowed(object, OP_DELETE, ...)` still refuses EVERY object.** 0.9.23 did
    not widen it, and `deleteIsRefusedEverywhere` passes unchanged. The discard reaches its deletes
    through `assertAllowedForTool('discard-version', object, OP_DELETE, ...)`, answered against a
    separate `TOOL_DELETE_OBJECTS` table and never falling through to the object gate. The reason is
    not style: every object on the delete list is one this package also CREATES or CARRIES in some
    other arm, so an object-level delete permission would silently hand the delete to the
    modification arm too. The question worth answering is "may THIS action remove THIS object".

### 8i. The amend pair, 2026-09-13 (A1: `stage_amend_version` / `execute_amend_version`).

47. **`JSON` is shadowed by any local called `json`, and the compiler blames the call site rather than
    the declaration.** A method that took an arm's payload into `String json` and then called
    `JSON.deserializeUntyped(json)` failed to compile with `Method does not exist or incorrect
    signature: void deserializeUntyped(String) from the type String`. Apex identifiers are
    case-insensitive, so `JSON` resolved to the local and the system class became unreachable inside
    that method. Same family as lesson 25, and it costs a full validate round the same way. RULE:
    never name a local `json`, `blob`, `date`, `system`, `test`, `limits` or `database`; when a call
    to a system class reports a signature that makes no sense, read the local declarations first.

48. **A validate deploy that names a CALLER without its CHANGED callee compiles against the callee's
    OLD shape.** `sf project deploy validate -m ApexClass:StageAmendVersion` failed with "Method is
    not visible" on thirteen parsers that were already `public` in the working tree, because the
    payload carried only the new classes and the org still held the previous `StageLoanModification`.
    A validation deploy compiles against the ORG plus exactly what is in the payload. RULE: every
    class whose source changed goes in the `-m` list, even when the change is one visibility keyword,
    and its own test class goes in `-t` beside it so the same run proves it did not regress.

49. **Order fixture members by a field the org does not derive.** nCino rebuilds a loan's `Name` from
    its own commitment on every save (15a), so `ORDER BY Name` in a test helper is unstable across the
    very writes the test makes: a test that moves an amount re-orders its own fixture underneath
    itself. Order by the commitment, or by anything else the org stores rather than computes. Related
    and worth recording as a NEGATIVE: `LLC_BI__Product_Package__c.Name` is stored verbatim (live SOQL
    over the twelve most recent packages), so the rewrite behaviour is Loan's, not the model's.

50. **A refusal that describes a RESOLUTION failure must never stand in front of a refusal that
    describes the INSTRUCTION.** A borrowing-structure REMOVE on a version would be a real delete
    (there is no carry for it to be an exclusion of), so the amend refuses it outright. The first cut
    refused it after the shared parser ran, and the parser got there first with "that party is not
    involved on this facility": accurate, and exactly the sentence that sends a banker off to ADD the
    party so the remove will work. The instruction-level refusal now runs before the parser.

51. **Reading a field the query did not select throws at RUNTIME and compiles clean.**
    `C360ActionStaging.findCompleted` does not select `cm_Idempotency_Key__c`, and a replay sentence
    that named the key back to the caller died with `System.SObjectException: SObject row was
    retrieved via SOQL without querying the requested field`. Nothing about the expression looks
    wrong. RULE: when a helper hands back an sObject it queried itself, read its SELECT list before
    touching a field on it.

52. **An amend needs no relay and no second hop, and that is a fact about the ENGINE rather than about
    writes.** `ExecuteLoanModification` splits into two transactions and calls back into the org over
    REST for two reasons, both of them nCino's credit action: a hosted-MCP context cannot host the
    managed engine (JWT, no session id), and the engine plus the arm together spend more than the
    LLC_BI namespace's own hundred-query budget. `ExecuteAmendVersion` runs the same arm code against
    records that already exist, invokes no engine, and therefore runs inline in one transaction with
    the relay ABSENT rather than carried unused. Measured: fifteen test methods, two of which write
    every arm, in 18 seconds.

53. **The loan stage ladder is ELEVEN rungs and the approval rung is spelled `Approval / Loan
    Committee`.** Off the describe, 2026-09-13: Qualification, Proposal, Credit Underwriting, Final
    Review, Approval / Loan Committee, Processing, Doc Prep, Closing, Boarding, Booked, Complete.
    "Past approval" is a POSITION on that list rather than a word, and a stage the list does not name
    must fail closed rather than rank as early. The PACKAGE stage picklist is three values only
    (Pending, In Review, Complete), which is why a package-level "before approval" test has to read
    `cm_Credit_Stage__c` beside it even though that field is never an authority.

54. **The write guard already admitted the amend's whole field set, and reading the table beat
    assuming.** `UPDATE_TRANSITIONS` constrains only the fields it LISTS (on Loan, just the one legal
    Stage hop to Proposal) and admits any other non-forbidden field, so commitment, rate, term,
    maturity, amortised term and first payment date pass `OP_UPDATE` with no guard change at all. The
    one shape a new tool did have to borrow is the collateral aggregate shell, which lives in
    `CARRY_OBJECTS` and not in `CREATE_STATES`: it is minted under `OP_CARRY`, exactly as the
    modification's arm mints one for its own AUTHORED pledges. A new write target does not always
    mean a `Changed` receipt on the guard. Read the table before planning one.

55. **Sharing a parser is cheaper than sharing a wire type, and the two have opposite rules.** Lesson
    16 keeps wire types duplicated per class because that is the only serialization shape proven in
    this org. The ARM PARSERS are the other way round: `stage_amend_version` takes the same seven JSON
    arms as `stage_loan_modification` by contract, and a second copy of roughly fifteen hundred lines
    of org resolution (covenant type catalog, fee picklists, collateral types and their advance rates,
    account names, the field-wave describe) is duplication that drifts the first time a picklist
    moves. The change to the existing class was thirteen `private static` keywords becoming `public
    static`, no body touched, and its own 67-test suite ran green in the same validation.

### 8j. A CAUGHT `DmlException` makes the org's CDC queueable unmockable, so a failing delete cannot be tested.

47. **`EventBridgeCallout` is a `Database.AllowsCallouts` Queueable that eleven unmanaged CDC
    triggers enqueue, and Apex flushes queued jobs at the END OF EVERY TEST METHOD, not only at
    `Test.stopTest()`.** The triggers are org-local: `LoanCDC`, `ProductPackageCDC`,
    `LoanCollateral2CDC`, `LoanCovenantCDC`, `LegalEntitiesCDC`, `Covenant2CDC`, `CollateralCDC`,
    `AccountCollateralCDC`, `AccountCovenantCDC`, `CollateralValuationCDC`, `PolicyExceptionCDC`.
    The job does a plain `new Http().send(req)` to an AWS API Gateway endpoint.

    **The discriminator is a CAUGHT `DmlException`, not the amount of DML.** Every execute test in
    the discard suite deletes pledges, junctions, involvements, facilities and a package, and they
    all pass with `C360TestFixture.armCalloutMock()` armed: the flush is served by the mock. The ONE
    method that provoked a real delete failure (a restricted `LLC_BI__Opportunity_History__c` child
    on the clone) and caught it failed every time with
    `System.CalloutException: You have uncommitted work pending` raised from
    `EventBridgeCallout.execute` line 18. Three arrangements were tried against the org on
    2026-09-13 and all three reproduced it: `Test.stopTest()` moved before the second execute,
    `Test.startTest()` with no `stopTest`, and no window at all. Dropping the window also surfaced a
    second failure mode on the way, `System.LimitException: Too many SOQL queries: 101`, because a
    stage plus two full executes do not fit one governor budget.

    **RULE: a delete chain's stop-and-resume path must be proven with an INJECTED refusal, never a
    real one.** `ExecuteDiscardVersion` carries a `@TestVisible private static String
    refuseGroupOnce` that names one plan step, is null in every non-test context, and consumes
    itself on first use. Same shape as `ExecuteLoanModification.engineOverride`, and for the same
    reason: the seam stubs the thing the org will not let a test do, and stubs nothing else. Every
    other group in that test really deletes, every verification really re-queries, and the resume
    really re-discovers.

    Corollary for the governor budget: open the `Test.startTest()` window AFTER the stage, so the
    stage's own reads do not eat into the budget the two executes share.

### 8k. Token rotation on an untouched replay, 2026-09-13 (A3: the relay-502 gap).

56. **A single-use token and a lossy channel need ROTATION, not withholding, and the two are not in
    tension.** `stagePlan` returned `decisionToken = null` on every idempotency-key hit, on the
    reasoning that re-minting would hand out a second token for a plan the banker already confirmed.
    That reasoning holds only for a row that was USED. When the artifact-to-connector relay lost the
    stage answer after the org had already staged it (the 502 seen today), the row existed at
    `Staged` and the page held nothing: the same-key re-ask got the plan with no token, could not
    execute, and the cockpit re-staged under a derived key `<key>#r2`, minting a second row and
    stranding the first at `Staged` forever. The fix is to rotate on an UNTOUCHED replay: mint a new
    token, overwrite `cm_Decision_Token_Hash__c` on the SAME row, return it with `replayed` and the
    new `tokenRotated` both true. Because the row stores one digest and rotation REPLACES it, exactly
    one token is valid per staging row at any moment and it is the one the caller holds; the digest
    the page never received stops claiming the instant the new one lands. Single use is preserved by
    the definition of untouched: status `Staged`, `cm_Token_Consumed_At__c` null, `cm_Executed_At__c`
    null, `cm_Result_Record_Id__c` null. `Executing`, `Completed`, `Partial`, `Failed` and
    `Withdrawn` all still return null, unchanged. GENERALISE: when a single-use credential travels a
    channel that can drop the response, the invariant worth defending is "one valid credential at a
    time", not "one mint per lifetime". Withholding on replay does not make the system safer, it
    makes the client mint a second row.

57. **Rotation has to be bound to the identity that staged, or it widens the gate.** The digest binds
    token + planHash + user, so rotating for whoever presents the idempotency key would mint a token
    bound to a SECOND banker for a plan the first one staged, and `execute_*` would accept it because
    `approverUserId` would equal that banker's running identity. The untouched test therefore carries
    `cm_Actor_User__c == UserInfo.getUserId()` as its fifth condition, typed `Id` to `Id` per lesson
    27. A replay by a different identity gets a null token exactly as before.

58. **An existing test that asserts the behaviour you are deliberately changing is not a regression,
    and it must be rewritten rather than preserved.** `repeatedStageOnOneKeyReturnsOnePlanAndOneToken`
    asserted `second.decisionToken == null` in so many words, with a comment citing A33.5.4. Keeping
    it green would have meant not shipping the rule. It became
    `anUntouchedReplayRotatesTheTokenAndVoidsTheOldOne`, which keeps every claim the old test made
    that still holds (one row, one plan hash, the replay declares itself) and replaces the token
    assertion with the stronger pair: the new token executes, and the old one is refused by
    `assertClaimable`. RULE: when changing a rule, grep the suite for the OLD rule's sentence before
    writing the new test, and rewrite that method in place so the diff shows the claim changing.

### 8l. The relationship anchor and the shared arms, 2026-09-13 (A4: rows 49 and 45, 0.9.24).

59. **Moving an anchor is a scope change and a refusal-ORDER change, and the second one is what
    breaks tests.** `stage_collateral_valuation` went from "prove this asset belongs to the named
    package" to "prove it reaches the named relationship". The scope rule was easy; the ordering was
    not. A stranger's asset used to be refused with "not part of product package X", and an
    ownership-first rule refuses it earlier with a different sentence, so an existing test asserting
    the package wording fails for a reason that has nothing to do with the change. The fix is not to
    reword either refusal but to notice that the package scope is a strict SUBSET of the relationship
    scope - a package's loans are the relationship's loans and its borrower is the relationship - so
    where the caller narrowed, the NARROWER test is the only one that needs to run, and the refusal
    keeps naming the deal the banker is working with. One test rewritten would have been acceptable
    (lesson 58); zero tests rewritten and a sharper refusal is better. GENERALISE: when two
    membership rules nest, run the inner one alone and say so, rather than running both and making
    the banker read the outer one's vaguer sentence.

60. **An optional anchor and a required one are the same field with different `required=true`, and
    the platform will not let you have both.** `productPackageId` was `required=true` on
    `stage_covenant_review`. Row 49 makes it optional and `accountId` the anchor, but the deployed
    cockpit 0.9.23 sends the package alone, so neither field can carry `required=true`: the Actions
    API enforces it before Apex runs (lesson 16aa) and either flag would refuse one of the two live
    shapes. Both are `required=false` and Apex enforces "at least one, and if both, they must agree".
    The agreement check is worth its lines: a package belonging to another relationship would
    otherwise anchor the trail row on a borrower the caller never named.

61. **An ASSOCIATION is data on the row, and the moment it becomes a query filter the founder's rule
    is broken.** Both tools now read the facility junctions for every item in scope and return
    `[{loanId, loanName, productPackageId, packageName}]` per item. The temptation is to constrain
    that read to the package the caller named, which is one line shorter and hides exactly the
    cross-deal ties the room exists to show: three of Hartwell's four assets are pledged to two
    facilities each. The association read is deliberately UNCONSTRAINED by the caller's narrowing.
    Corollary for the staging row: `cm_Product_Package__c` is written only when the items touch
    exactly ONE package, and is null otherwise. A plan spanning two deals has no deal to deep-link
    to, and picking one of them would make the trail claim a narrowing nobody chose.

62. **`JSON.serialize` drops nulls, which is what makes a JSON-string wire field survivable.** An
    `@InvocableVariable` cannot carry a list of Apex-defined types inside another Apex-defined type,
    so the associations travel as a serialised string on the item. An empty list serialises as `[]`,
    which is a real answer ("this covenant is tied to no facility") rather than blank space, and a
    null package name is omitted rather than rendered as the four-character string `null`. Build the
    association through one factory that keeps nulls as nulls: `String.valueOf(null)` is `'null'` and
    the next reader will try to resolve it as an id.

63. **Sharing a PARSER is cheap; sharing a WRITER is not, and the discriminator is how many targets
    it has.** Lesson 55 made `StageLoanModification`'s arm parsers `public static` and
    `stage_amend_version` reused them. `stage_new_facility` and `stage_renewal` now reuse the same
    three, but the AUTHORING could not be reused from `ExecuteLoanModification`: its arm hop runs
    against a clone map, across two transactions, behind a relay. So `C360FacilityArms` carries the
    plan half and a SINGLE-TARGET authoring half, which is the only shape a new-facility plan can
    have, and the modification keeps its own multi-target one. Duplicating the plan STEPS would have
    been the real drift risk and that is what the shared class removes: step ids and value prefixes
    are byte-identical across all four tools, so a room that renders one renders them all.

64. **A parser that reads the borrower off `facilities[0]` cannot serve a tool that selects no
    facility, and the fix is a field the wire never sees.** `stage_new_facility` lands its arms on a
    facility it is about to create, and on the package-first path there is no package to read a
    borrower from either. `StageLoanModification.Request` gained `public Id armBorrowerId` with NO
    `@InvocableVariable`: it is a legal public field on a global inner class, invisible to the
    Actions API, and it is consulted only when `facilities` is empty. Same shape for the default
    target: an arm naming no `targetLoanId` falls through to the sole net-new facility's label when
    nothing is selected, and to the existing single-selection rule otherwise. Additive on both
    counts, so the modification's 67-test suite ran green unchanged in the same validation.

65. **Arms authored INLINE need their own governor budget, and it is smaller than the modification's.**
    `execute_new_facility` writes the facility, its package, its borrower row and then every arm in
    ONE transaction, and each row wakes a *CDC trigger that enqueues a queueable against a ceiling of
    50. A covenant add is three rows, a pledge up to four. `C360FacilityArms.ARM_MAX_PER_KIND = 5`
    caps each arm at stage time with the reason in banker copy; the modification's arm hop runs in a
    transaction of its own and keeps its own caps. A cap that exists only in the execute is a cap the
    banker discovers by having a confirmed plan fail.

66. **Authoring the arms in invocation 1 rather than on the resume is a correctness choice, not a
    performance one.** The obvious reading of "file the facility, then attach its covenant" puts the
    arms after the stage hop, which is after the after-commit Loan Detail wait. That wait can be slow
    or never satisfied (lesson 15t), and a banker who asked for "this facility with this covenant"
    would get the facility alone with no failure to read. The arms therefore land in the same
    transaction as the facility: all of it or none of it, and an arm failure rolls the facility back
    with it, which is the fence behaving exactly as lesson 15q describes.

67. **A trail row can belong to a thing without being anchored on it, and a delete that reads only
    the anchor leaves a lie behind (row 45).** `ExecuteDiscardVersion` withdrew the rows carrying
    `cm_Product_Package__c = <version>`, which is every action a banker ran INSIDE the version. The
    action that CREATED the version - the loan modification that filed it - is anchored on the SOURCE
    package, because that is the package the banker was looking at; what ties it to the version is
    `cm_Result_Record_Id__c` naming one of the loans about to be deleted. It stayed `Completed`
    forever. The union is now computed at STAGE time, in `StageDiscardVersion.buildTrail`, for two
    reasons: the plan's count, its warning and its `withdraw_trail` step then promise what the run
    actually does, and the set survives a resume, where the version loans are already gone and a
    fresh query on their ids would find nothing. Same argument the parents already carry (they come
    off the staged plan, never off a fresh discovery), and it is worth stating as a rule: ANY set a
    delete chain needs after the delete is read before it.


### 8m. The collateral aggregate shell, and why a delete chain must read it before it deletes (2026-09-14, A4: row 46, 0.9.24).

> **Read 71a FIRST.** 68 and 69 were written before the org proof of the very run they describe.
> Both are partly wrong: nCino DOES cascade the shell with its clone, and the shells backlog row 46
> complains about are minted at version CREATION rather than left behind by the discard.

68. **PARTLY WRONG, corrected by 71a. The lookup runs ONE way and the two legs cascade differently.**
    `LLC_BI__Loan__c.LLC_BI__Loan_Collateral_Aggregate__c` is a PLAIN lookup (cascadeDelete false),
    so deleting a facility leaves its shell standing and empty; the shell carries no lookup back, so
    after the facility is gone nothing in the org can say which shell belonged to it. But
    `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` is CASCADE, so deleting a
    shell silently takes any pledge still hanging off it. Both facts are read off the aggregate's
    own `childRelationships` (lesson 37's method). Consequence for the discard: shells go AFTER the
    facilities and are refused whenever a facility OR a pledge outside the version still points at
    one. A shell is otherwise a nine-field row with six read-only rollups, `Name` and
    `LLC_BI__lookupKey__c`.

69. **Right about the frozen list, wrong about what it covers (see 71a). A set the chain needs
    after a delete is read before it, and this is the case where the rule bites.** Lesson 67 made that argument for the trail rows.
    The shells are stronger: the trail can at least be re-found by anchor, while a shell whose
    facility is gone is unreachable by any query. So `StageDiscardVersion` freezes the shell ids into
    the plan as their own `aggregates` bucket and `ExecuteDiscardVersion` retargets the group onto
    that list, filtering by two re-reads (still resolves, nothing outside still points at it) rather
    than by a fresh discovery. A run that stopped between `delete_members` and `delete_package`
    would otherwise resume, find no facilities, mark the group empty and strand the shells for good.
    Proven by injecting the refusal ON that group and resuming.

70. **The gate's own fork evidence disappears with the facilities, which makes ANY stop after
    `delete_members` fragile.** `assertIsDiscardableVersion` ranks a package as a version from its
    chain rows or its members' `Is_Modification`, and both are gone by then, so the resumed run falls
    back to the PACKAGE stage reading `Pending` or `In Review`. A version package that reads neither
    cannot be resumed past that point and is refused NOT_A_VERSION. This predates the shells and is
    not fixed here: the resume test sets the package stage deliberately and says so.

71a. **CORRECTION to 68 and 69, from the org proof of the run those two lessons describe
    (2026-09-14, A5). BOTH halves of the shell story were wrong in a way the design depended on.**

    **The lookup is plain, but the delete is NOT left to us.** 68 read `cascadeDelete: false` off the
    describe and concluded that deleting a facility leaves its shell standing. The org does not
    behave that way: nCino's managed `LLC_BI.LoanTrigger` (and/or `nCRED`'s `loan_AfterDelete`)
    removes the clone's aggregate WITH the clone, inside `delete_members`. On the live discard of
    Hartwell's version `a5Fbb000000JHI5EAO` all five frozen shells
    (`a4Sbb00000GYcBmEAL`, `GYcBnEAL`, `GYcBoEAL`, `GYcBpEAL`, `GYcBqEAL`) were gone by the time
    `delete_aggregates` ran, and the all-or-nothing `delete as user` failed the whole group with
    `ENTITY_IS_DELETED, entity is deleted: [] on row 0 id a4Sbb00000GYcBmEAL`. The chain stopped
    there and reported `partial`, "63 gone and 6 remain", leaving the version package standing with
    zero loans and the staging row `STG-0000000157` (`a8abb00001Od7GxAAJ`) at `Executing`. The
    `retargetAggregates` re-read that was supposed to catch this could not: it runs BEFORE
    `delete_members`, so it sees the shells alive. **RULE: a describe's `cascadeDelete` flag
    describes the PLATFORM's cascade, not a managed package's triggers. A delete group whose rows a
    managed trigger may also remove has to tolerate `ENTITY_IS_DELETED` per row.**
    `delete_aggregates` now uses `Database.delete(list, false, AccessLevel.USER_MODE)` and reads
    that one status code as `already_gone`; every other error, and every other group, still stops
    the chain.

    **And the shells backlog row 46 complained about are not the ones a facility points at.** Five
    NEW shells (`a4Sbb00000GYfvaEAD`, `GYfvbEAD`, `GYfvcEAD`, `GYfvdEAD`, `GYfveEAD`) appeared at
    `2026-09-14T02:31:23Z`, CreatedBy the integration user, lookup key null, pledged count 0, value
    0, referenced by no loan and by no pledge. 02:31:23 is inside `ExecuteLoanModification`, during
    the version CREATION, a full minute BEFORE the discard was even staged. The version had 6 clone
    loans and 5 copied pledges: the carry mints one shell per clone and sets it on each pledge, and
    nCino's own pledge/loan automation mints a second one that nothing is ever pointed at. **They
    are orphans FROM BIRTH, so a discard that reads shells off the version's facilities can never
    see them** - which is why 18 of them had to be swept by hand that morning (three earlier
    versions' worth). 69's argument was right about the frozen list and wrong about what the list
    covers.

    **Two fixes, and the first one is where it belongs.** `C360AggregateSweep` runs in the SAME
    transaction that mints them, from `ExecuteLoanModification`, `ExecuteAmendVersion` and
    `ExecuteNewFacility`, as a reported `sweep_aggregates` step: every shell born since the run
    started, under the running user, with no lookup key, with zero rollups and with no facility and
    no pledge pointing at it. Zero rows is a `verified` outcome. `StageDiscardVersion` then freezes
    a SECOND bucket for versions created before that shipped, found by the version's own BUILD
    WINDOW: same creator as the version package, `CreatedDate` between the package's own and the
    last row the build wrote plus two minutes, empty rollups, no lookup key, referenced by nothing.
    Capped at 25, and a seed row or a referenced row is never in it.

    **`txStart` takes NO back-margin.** The first cut used `Datetime.now().addSeconds(-1)` to
    absorb clock granularity, and a validate run caught it reaching into the transaction that ran
    before: the sweep removed a row the test's own `@TestSetup` had written, in a different
    transaction, one second earlier. `CreatedDate` is stamped at DML time and is therefore always
    after a reading taken before the first write, so the exact `Datetime.now()` is both correct and
    the only safe choice. **RULE: an in-transaction time window must never be widened backwards.**

71b. **What the fixture does NOT reproduce, stated rather than assumed.** A test transaction that
    inserts a pledge does NOT get a second shell from nCino: two validate runs settle it
    (`aShellAPledgePointsAtIsNeverSwept` sweeps zero). The first of those runs appeared to show the
    managed mint, and that reading was the `-1` second margin picking up the fixture's own orphan.
    So the tolerant delete path is put under test by `ExecuteDiscardVersion.vanishBeforeGroup`, a
    seam that deletes a group's targets immediately before the group runs, which is the live cascade
    reproduced rather than asserted. Same discipline as lesson 16c: a branch a unit fixture cannot
    reach is named, not faked into a false green.

72. **`LLC_BI__Loan_Collateral_Aggregate__c` is plainly createable and deletable from Apex, and
    `LLC_BI__lookupKey__c` is writeable.** No managed trigger blocks a fixture, so the id-list
    workaround a test would otherwise need is unnecessary: the discard suite builds one shell per
    facility directly, which is also the shape nCino leaves behind. The live org carried 65 shells on
    2026-09-14, 62 of them referenced by a loan and 3 seeded with lookup keys
    (`Piedmont-WC-Aggregate`, `Piedmont-Equipment-Aggregate`, `HWTEST-AGG-1`), which is what makes a
    non-null `lookupKey` the right refusal: it is the only field that says a human keyed this row.

### 8n. A resume must never re-derive from evidence the plan itself deletes (2026-09-14, A6: the `NOT_A_VERSION` wall on `STG-0000000157`).

73. **`ExecuteDiscardVersion` re-ran the version CLASSIFICATION on every resume, and the discard
    deletes the very rows that classification reads.** `assertIsDiscardableVersion` ranks a package
    as a version from its `LLC_BI__LoanRenewal__c` chain rows or its members'
    `LLC_BI__Is_Modification__c`, falling back to a package stage of `Pending` or `In Review`. The
    chain rows are delete group 1 and the members are group 5. So the moment a run gets past
    `delete_chain`, the org can no longer answer the question the gate asks, and a version package
    whose stage is neither Pending nor In Review is refused `NOT_A_VERSION` under its own
    idempotency key for ever. Live proof: the Hartwell discard of `a5Fbb000000JHI5EAO` stopped
    `partial` at `delete_aggregates` with 63 of 69 records gone (row `STG-0000000157`,
    `a8abb00001Od7GxAAJ`, key `zz-orgproof-20260914-agg-discard`, still `Executing`), and every
    re-run with the same key, stagingId, planHash and decisionToken came back
    `ok:false / NOT_A_VERSION`, quoting a package that "carries no modification or renewal chain,
    and its stage is null". EVERY partial discard stopping after `delete_chain` was un-resumable.
    This is the general rule, and it outranks the instinct that re-reading is always safer: **a
    resume must never re-derive a fact from evidence the plan itself deletes. Where the plan is the
    only surviving witness, the plan is the authority.** Lesson 67 said it for a SET the chain needs
    after the delete (read it before), and lesson 70 NAMED this exact hole and left it open; 73 is
    the same rule applied to a GATE rather than to a set, and closing it is what makes a stopped
    discard finishable.

74. **The exemption is one check wide, and drawing the line matters more than making it.**
    `StageDiscardVersion.discoverForResume` skips `assertIsDiscardableVersion` and nothing else.
    Still re-read on a resume, because none of it depends on rows the chain removes:
    `assertNoForeignChildren` (a live approval or a filed document that arrived during the stop
    still stops the resume), the `assertNothingNew` ceiling measurement, the per-group verification
    re-queries, and the whole token gate. And the resume re-derives exactly ONE thing about
    identity: the staging row's `cm_Result_Record_Id__c`, which `recordProgress` stamped with the
    version it stopped on, must equal the `versionPackageId` on the frozen plan. A resume continues
    the run that stopped; it does not retarget it. A FIRST execute (row still `Staged`) re-runs the
    full gate exactly as before, which is the property the new test
    `aFirstExecuteOnAPackageThatIsNotAVersionIsStillRefused` exists to hold.

75. **A resume that arrives to find the package already gone has to FINISH the run, not report it.**
    The old code left `inv` null, ran no groups, left every delete step at `pending`, and wrote
    `recordProgress` again, so the row stayed `Executing` for ever: the same dead end as the gate
    refusal, reached a different way. `settleAlreadyGone` now settles every still-pending step from
    the frozen plan, lands the package as `already_gone`, and then lets the verifications run for
    real. The run closes, the booked parents are proved back to `hasRenewal false`, and the filing
    modification row is marked `Withdrawn` as the first run would have done. RULE: a step whose
    desired outcome is already the org's state is `already_gone` and the run carries on. The only
    honest reasons to leave a staging row open are work still to do and a refusal that says why.

76. **A workaround in a test is a bug report nobody filed.**
    `aShellSurvivesAStopBecauseItComesOffTheFrozenPlanRatherThanAFreshRead` began by lifting the
    version package to `Pending` before staging, with a comment saying the fork evidence goes with
    the facilities and "that is a property of the gate rather than of this change". That line was
    the defect, written down, a day before the org proved it. The `update` is now deleted rather
    than kept (lesson 58: rewrite the method whose claim changed), and the workaround's comment is
    replaced by a pointer to the method that owns the claim. When a test has to arrange the org into
    a shape the production caller cannot guarantee, the finding is about the production code.

---

*Maintained by the orchestrator. Add to this file in the same build wave a lesson is learned; a lesson
that lives only in a session transcript does not exist.*

## 8o. `LLC_BI__Default_App__c` decides whether the nCino Loan page renders at all (2026-09-14)

77. nCino's Loan record page is nFORCE's UI container; it resolves the route from
    `LLC_BI__Loan__c.LLC_BI__Default_App__c`. In bankinggpt-at only `loans.dashboard-loan` resolves; the
    value `loan.dashboard-loan` (the bulk seed's value, and what nCino's insert default produced on the
    cockpit's own net-new facilities on 2026-09-04) renders the path bar and an EMPTY body, no Aura or
    Apex error anywhere (the only console error, `LoanController.getLoanRecord`, appears on working
    pages too). Found by a full-field odd-one-out diff of Sunbelt against Piedmont and Hartwell; record
    types, owners, page visibility rules, loan details and child records were all equal.
78. Clones copy the parent's value, so fixing booked parents fixes every later modification; a net-new
    facility does not inherit anything and must set the field explicitly (backlog 55).
79. A record-triggered nCino flow ("Loan After Save") can refuse every update on a seed whose email
    alert has no recipient (EverPetal); the API error is CANNOT_EXECUTE_FLOW_TRIGGER, not a validation
    rule. Check the owner and loan team before blaming the field.
80. The fix (2026-09-14, backlog 55): every facility this package writes now carries
    `LLC_BI__Default_App__c = 'loans.dashboard-loan'` explicitly. The literal is ONE constant,
    `C360NewFacilities.LOAN_DEFAULT_APP`, and it lives there because `C360NewFacilities.newLoan` and
    `loanFields` are already the single shape three tools author a facility through
    (`execute_new_facility`, the modification's net-new arm, the narrated renewal): a second copy of a
    value this subtle drifts, and drift here is invisible until a banker opens an empty page. Both
    read-backs report it, so a regression shows in the tracker rather than on the screen:
    `execute_new_facility`'s `verify_loan` detail ends "Default App loans.dashboard-loan", and the
    modification's `new_facility_verify_*` lists it beside the commitment and says plainly that a wrong
    value renders the page empty. The stage plans list the field on their loan write steps; the write
    guard and the cockpit allowlist are both deny-lists on fields, so neither needed a change.

81. **A package this cockpit CREATED is recognised by the LEDGER, not by its stage, and the stage is
    the weaker of the two marks (2026-09-14, B4: backlog 58).** `StageDiscardVersion` ranked a
    package as the cockpit's own from `LLC_BI__Stage__c` reading `Pending` or `In Review`, which is
    what nCino's credit action leaves on a version. `ExecuteNewFacility.create_package` wrote Name
    and Account only, so a package the New-facility room created read stage NULL and was refused
    `NOT_A_VERSION` for ever: live proof on Piedmont package `a5Fbb000000JIXVEA4` (facility
    `a4Zbb000002KwhpEAC`, row `STG-0000000163`), which broke the 0.9.23 promise that a package the
    cockpit created rolls back to nothing. Two halves to the fix and the ORDER of their strength is
    the lesson. The create now files the package at the org's own opening value, `Pending`, read off
    the live picklist (`Pending, In Review, Complete`, unrestricted) and pinned in
    `C360WriteGuard.CREATE_STATES` so it is the ONLY value a create may carry; the field stays on
    `FORBIDDEN_FIELDS` so an UPDATE still cannot move a package through its lifecycle, and the create
    branch now skips the forbidden test for a field the create state pins, which is the one place
    those two tables would otherwise contradict each other. But a stage is a field: the org, a flow
    or a banker can move it, and every package created before this shipped still reads null. So the
    classifier's real evidence is the ACTION TRAIL: `execute_new_facility` stamps
    `cm_Product_Package__c` on its own staging row through `C360ActionStaging.recordOutcome`, and a
    `new-facility-request` row naming the package is proof the cockpit made it whatever the record
    says today. Accepted statuses are `Completed`, `Partial` and `Withdrawn`, and each is deliberate:
    `Partial` is the ORDINARY resting state of a new facility between its two invocations, when the
    package already exists; `Withdrawn` is there for the reason lesson 73 gives, because this same
    action marks the creation row Withdrawn when it finishes, and without it a discard that stopped
    part way would delete the evidence its own gate reads and refuse every retry. `Staged` is absent
    because nothing has been created yet, and the stamp only lands at execute time anyway.
    NAMING A PACKAGE IS NOT MAKING ONE, and that is the sharp edge of this design: the same field is
    stamped on the supplied-package path too, where it means a facility was FILED ON a package
    somebody else made, which is no licence to delete it. The two are told apart by WHEN, with no
    new field: a staging row is written at STAGE time, and on the package-first path the package
    does not exist yet, so the creation row is OLDER than the package it names, while a
    supplied-package row is always younger. `creationRow` reads that comparison. A test transaction
    stamps every `CreatedDate` alike, so the fixture reproduces the two-transaction shape with
    `Test.setCreatedDate` rather than loosening the comparison to `<=`.
    GENERALISE: when a gate has to answer "did WE make this", prefer the immutable record of what the
    system did over any mutable field on the thing itself. Nothing else about the discard changed:
    `PACKAGE_BOOKED`, `VERSION_IN_APPROVAL` and `HAS_FOREIGN_CHILDREN` all still run in the same
    order and still outrank the evidence (a booked package naming a creation row is still refused
    `PACKAGE_BOOKED`, and there is a test that says so), and the ordered delete needed no new group:
    a created package has no chain rows, its facilities carry a null `LLC_BI__lookupKey__c`, and the
    Loan Detail is master-detail CASCADE on the Loan (re-read off `childRelationships` 2026-09-14,
    with the fees), so it is reported as cascading rather than deleted. The one thing the banker
    gains is prose: the plan now says the package was created by this cockpit, names the trail row,
    and says there are no booked parents to restore.

82. **nCino's pricing engine sets `Name` = `Id`, so a plan item name must never be a raw `Name`
    pass-through (2026-09-15, D1, live defect).** On `LLC_BI__Pricing_Payment_Component__c` and
    `LLC_BI__Pricing_Stream__c` the engine writes the record's own fifteen-character id into `Name`:
    Sunbelt version `a5Fbb000000JIR3EAO` carried `a4ybb000002kean`, `a4ybb000002keao` and
    `a50bb00000vQIwZ`. `StageDiscardVersion` passed `Name` straight through to the inventory item's
    `name` (its only fallback fired on null), so the plan reached the cockpit carrying an id as a
    name and `assertNoRecordIds` in `app/src/actions/stagedPlan.ts` refused the whole discard with
    `items[12].name looks like an org record id (a4ybb000002kean)`. The staging rows
    `STG-0000000165` and `STG-0000000166` were fine; the plan they carried was unreadable. The
    client's rule is right and the fix belongs in the org: a banker confirming a DELETE has to be
    able to read every line of what goes. Every item is now named through one helper,
    `StageDiscardVersion.bankerName(objectApiName, rawName, recordId, facilityName)`, which returns
    the raw `Name` only when it is a real name (not null, not blank, not matching the cockpit's own
    `^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$`) and otherwise returns `<object label> on <facility name>`,
    or `<object label> on this version` where no facility owns the row. GENERALISE: an org-side field
    a managed package populates is not a banker-facing string until something has judged it, and the
    judging belongs at the ONE place the item is constructed rather than at each of the thirteen call
    sites that build one. Two smaller notes: a Salesforce id is by construction fifteen or eighteen
    alphanumerics, so the shape test already covers "the Name is literally its own id" and a second
    equality comparison would be unreachable code; and the facility name used in the fallback is put
    through the same test, so the fallback cannot smuggle an id in from the other side.
