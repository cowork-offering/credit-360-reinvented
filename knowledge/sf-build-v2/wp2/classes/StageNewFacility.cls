/**
 * StageNewFacility - MCP tool: stage_new_facility.
 *
 * A33.0.1: ZERO domain DML. The Loan is created only by execute_new_facility, behind the token.
 *
 * THREE PROBE FACTS SHAPE THIS CONTRACT (PROBE-LEDGER wave 3, probe 5):
 *
 *   1. The org REWRITES the Loan Name. A before-save flow rebuilds it as
 *      "<Account> - <Product> - <Amount>". We submitted "ZZ-PROBE-20260726 Facility" and the org
 *      stored "ZZ-PROBE-20260726 DO NOT USE - Construction - $0". So this tool does not collect a
 *      name, does not send one, and never echoes one back. The execute step reports the
 *      org-assigned name as `recordName`, the way the collateral tool already does.
 *
 *   2. LLC_BI__Product__c SELF-POPULATES to 'Construction' when left blank, and the name is then
 *      built from it. A tool that does not collect Product ships every facility mislabelled
 *      Construction. Product is therefore REQUIRED here, and validated against the org picklist.
 *
 *   3. The Loan Detail is created by an AFTER-COMMIT async flow in about 4 seconds, in a separate
 *      transaction, and produces NO AsyncApexJob row. It is structurally invisible to the inserting
 *      transaction, so the action is TWO INVOCATIONS: execute files the facility and returns, then
 *      the caller continues the same plan to verify the child and finish the hop. Nothing waits
 *      inside a transaction; wave 4 proved a spin-wait burns the CPU limit and can never succeed.
 *
 * Of the two fields LV12 and LV13 gate, the org pre-fills LLC_BI__Application_Method__c ('Online')
 * and leaves LLC_BI__Primary_Loan_Purpose__c null, so only the purpose must be collected.
 *
 * THE ARMS, 2026-09-13 (backlog row 49, founder). A banker opening a facility with a covenant on it
 * or an asset pledged to it used to need two actions and two confirmations for one decision. This
 * tool now takes `covenantAddsJson`, `covenantAttachesJson` and `pledgeAddsJson`, the SAME three
 * arms and the same JSON shapes `stage_loan_modification` takes, parsed by its own public parsers so
 * the two cannot answer the same payload differently (LESSONS 55). They land on the facility THIS
 * plan creates, which has no id until execute time, so the plan names it by the label `new:1` the
 * way the modification names the facilities it creates. An entry may leave `targetLoanId` out
 * entirely: this plan creates exactly one facility, so an arm that names no target can only mean
 * that one.
 *
 * Org contract: A33.4.3. Bypass: WITHOUT Exclude_Flow (A33.5.5) because the two-phase design
 * DEPENDS on the async Loan Detail flow; suppressing it would break the action, not protect it.
 */
global with sharing class StageNewFacility {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /**
     * Probe 5 timed the Loan Detail flow at about 4 seconds. This is the expected elapsed gap the
     * panel shows the banker, NOT an in-transaction wait: wave 4 proved the child is created after
     * commit and is invisible to the inserting transaction, so execute_new_facility returns and the
     * caller continues the action rather than waiting (LESSONS 15p).
     */
    /**
     * Values the COMMERCIAL LOAN RECORD TYPE actually offers, read from
     * /ui-api/object-info/LLC_BI__Loan__c/picklist-values/012bb000000NfLpAAK/LLC_BI__Product__c
     * on 2026-07-26 and recorded in PROBE-LEDGER wave 5.
     *
     * MAINTAINED CONSTANT, not a live read, and the trade is deliberate: ui-api is not callable from
     * Apex without a callout, and a callout on the stage path would make planning depend on network
     * availability. The cost is that a record-type picklist change in Setup silently drifts from this
     * list, so it is cited to the ledger and belongs in the re-runnable bank-rules scan.
     *
     * WHY IT EXISTS: record-type scoping is NOT enforced by the API. All three Loan picklists are
     * restrictedPicklist false, so a PATCH writing Product = 'Term' onto a Commercial-RT loan returns
     * 204 and stores it. We already shipped that bug: the wave-4b probe created a facility carrying a
     * value its own record type does not offer, and it renders wrong in nCino. Nothing on the
     * platform catches this, so the tool must (LESSONS 15w).
     */
    private static final Set<String> RT_PRODUCT_VALUES = C360NewFacilities.RT_PRODUCT_VALUES;

    /**
     * Confirmed RT-valid in the same read: the Commercial Loan record type offers Qualification
     * among its 10 stages and Open among its 7 statuses. It omits Complete from Stage and all four
     * Pre-* values from Status, none of which this tool writes.
     *
     * SHARED WITH THE MODIFICATION'S OWN new-facility arm since 2026-09-03. Three tools now author a
     * facility and C360NewFacilities holds the one answer, for the reason C360Facilities holds the
     * selection contract: two copies of a subtle rule drift, and record-type scoping is not enforced
     * by the API at all.
     */
    private static final String RT_CREATE_STAGE = C360NewFacilities.RT_CREATE_STAGE;
    private static final String RT_CREATE_STATUS = C360NewFacilities.RT_CREATE_STATUS;

    private static final Integer LOAN_DETAIL_WAIT_MS = 30000;

    /**
     * How the plan names the facility before the org does.
     *
     * The arms target a facility whose id is minted at execute time, so the plan needs a stable
     * handle for it. `new:1` is the same spelling the modification's own net-new arm uses, which is
     * what lets the shared parsers and the shared plan builder treat both routes identically.
     */
    private static final String NEW_FACILITY_LABEL = 'new:1';

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Product Package Id' description='Optional. Omit it and the plan creates a new credit package for the relationship first, which is the package-first flow nCino treats as canonical.')
        global String productPackageId;
        @InvocableVariable(label='Account Id' description='Required when no productPackageId is supplied, because there is then no package to derive the borrower from.')
        global String accountId;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='Product' description='Required. The org self-populates Construction when this is blank and then builds the loan name from it, so an omitted product ships a mislabelled facility.' required=true)
        global String product;
        @InvocableVariable(label='Amount' description='Gates LV11 on the Qualification to Proposal hop.' required=true)
        global Decimal amount;
        @InvocableVariable(label='Primary Loan Purpose' description='Required. Gates LV12. The org leaves this null on the Loan Detail it creates; Application Method it pre-fills for us.' required=true)
        global String primaryLoanPurpose;
        @InvocableVariable(label='Term Months')
        global Decimal termMonths;
        @InvocableVariable(label='Covenant Adds JSON' description='Optional. JSON list of net-new covenants to create and attach to the facility this plan files: [{"typeName" or "typeId", "threshold", "operator" (< <= = >= >), "frequency"?, "effectiveDate"? (YYYY-MM-DD), "targetLoanId"?}]. Each is created Pending/Active on the borrower account and attached to the new facility. targetLoanId may be omitted, and normally is: this plan creates exactly one facility, so an arm that names no target lands on it.')
        global String covenantAddsJson;
        @InvocableVariable(label='Covenant Attaches JSON' description='Optional. ASSOCIATE AN EXISTING COVENANT to the facility this plan files: [{"covenantId", "targetLoanId"?}]. A junction-only create. No covenant is inserted, nothing is deleted: an LLC_BI__Loan_Covenant__c row ties a covenant the borrower already holds to the new facility, which is the instrument for a relationship-level covenant that carries no loan junction. The covenant must belong to the borrower. targetLoanId may be omitted.')
        global String covenantAttachesJson;
        @InvocableVariable(label='Pledge Adds JSON' description='Optional. COLLATERAL PLEDGES authored on the facility this plan files: [{"collateralId"? (an existing LLC_BI__Collateral__c the BORROWER owns), "newCollateral"? {"description", "collateralType", "value"}, "advanceRate"?, "advanceRateReason"?, "amountPledged"?, "authoriseOverPledge"?, "lienPosition"?, "targetLoanId"?}]. EXACTLY ONE of collateralId and newCollateral per entry. An existing collateral must be owned by the borrower through LLC_BI__Account_Collateral__c (LLC_BI__Collateral__c carries no account lookup at all). A newCollateral is authored as asset, then ownership junction, then pledge; its collateralType takes a collateral-type record id or the type\'s exact name, and advanceRate is REQUIRED on a create. amountPledged defaults to the asset\'s lendable value at the rate the pledge resolves to; a figure above it is refused unless the same entry sends "authoriseOverPledge": true. targetLoanId may be omitted.')
        global String pledgeAddsJson;
    }

    global class PlanStep {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type')
        global String type;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='Object')
        global String objectName;
        @InvocableVariable(label='Fields')
        global List<String> fields;
        @InvocableVariable(label='Automation Woken')
        global List<String> automationWoken;
        @InvocableVariable(label='Verification')
        global String verification;
        @InvocableVariable(label='Wait Budget Ms')
        global Integer waitBudgetMs;
        @InvocableVariable(label='State')
        global String state;
    }

    global class ToolError {
        @InvocableVariable(label='Code')
        global String code;
        @InvocableVariable(label='Message')
        global String message;
        @InvocableVariable(label='Org Error')
        global String orgError;
        @InvocableVariable(label='Resumable')
        global Boolean resumable;
        @InvocableVariable(label='Idempotency Key')
        global String idempotencyKey;
    }

    global class StageResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Plan Hash')
        global String planHash;
        @InvocableVariable(label='Decision Token')
        global String decisionToken;
        @InvocableVariable(label='Summary')
        global String summary;
        @InvocableVariable(label='Steps')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Account Id')
        global String accountId;
        @InvocableVariable(label='Product Package Id')
        global String productPackageId;
        @InvocableVariable(label='Creates Package' description='True when no package was supplied and the plan will create one first.')
        global Boolean createsPackage;
        @InvocableVariable(label='Planned Package Name' description='The name the new package will carry, built to the org convention.')
        global String plannedPackageName;
        @InvocableVariable(label='Covenant Add Count' description='Net-new covenants this plan creates on the borrower and attaches to the new facility. Zero is the ordinary answer.')
        global Integer covenantAddCount;
        @InvocableVariable(label='Covenant Attach Count' description='Existing covenants this plan associates to the new facility by junction only.')
        global Integer covenantAttachCount;
        @InvocableVariable(label='Pledge Add Count' description='Collateral pledges this plan authors on the new facility.')
        global Integer pledgeAddCount;
        @InvocableVariable(label='New Facility Label' description='How this plan names the facility before the org has named it. The arms target it by this label, because its id is minted at execute time.')
        global String newFacilityLabel;
        @InvocableVariable(label='Replayed')
        global Boolean replayed;
        @InvocableVariable(label='Token Rotated' description='True when this call re-issued the confirmation token for a plan the org already held at Staged: the earlier token, which the caller never received, is void. At most one valid token exists per staging row.')
        global Boolean tokenRotated;
    }

    global class Response {
        @InvocableVariable(label='OK')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global StageResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /**
     * Stages a new facility. Writes no Loan.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_new_facility'
        description='Validate a new commercial facility against the org contract and return an immutable execution plan with a plan hash and a single-use decision token. NET-NEW COVENANTS, EXISTING-COVENANT ASSOCIATIONS AND COLLATERAL PLEDGES may ride the same request in covenantAddsJson, covenantAttachesJson and pledgeAddsJson, in the same JSON shapes stage_loan_modification takes, and they land on the facility this plan files: one decision, one plan, one confirmation. Writes NO Loan: the facility and its arms are created only by execute_new_facility behind the token gate.'
    )
    global static List<Response> stage(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = build(req);
                res.ok = true;
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (StageLoanModification.ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (C360NewFacilities.NewFacilityException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (C360FacilityArms.BudgetException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (C360ActionStaging.StagingException e) {
                res.ok = false;
                res.error = err('STAGING_REFUSED', e.getMessage(), null, req.idempotencyKey);
            } catch (DmlException e) {
                res.ok = false;
                res.error = err('STAGING_WRITE_FAILED', 'The staging record could not be written.', e.getMessage(), req.idempotencyKey);
            } catch (QueryException e) {
                res.ok = false;
                res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), req.idempotencyKey);
            }
            out.add(res);
        }
        return out;
    }

    private static StageResult build(Request req) {
        if (String.isBlank(req.productPackageId) && String.isBlank(req.accountId)) {
            throw new ToolException(
                'Supply either productPackageId to file under an existing package, or accountId to create a new credit package for the relationship first.'
            );
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (String.isBlank(req.product)) {
            throw new ToolException(
                'product is required. The org self-populates Construction when it is blank and rebuilds the loan name from it, ' +
                'so an omitted product ships a facility labelled Construction.'
            );
        }
        if (req.amount == null || req.amount <= 0) {
            throw new ToolException('amount is required and must be greater than zero. It gates LV11 on the stage hop.');
        }
        if (String.isBlank(req.primaryLoanPurpose)) {
            throw new ToolException('primaryLoanPurpose is required. It gates LV12, and the org leaves it null on the Loan Detail it creates.');
        }

        if (!RT_PRODUCT_VALUES.contains(req.product)) {
            List<String> sorted = new List<String>(RT_PRODUCT_VALUES);
            sorted.sort();
            throw new ToolException(
                'product \'' + req.product + '\' is not offered by the Commercial Loan record type. Available: ' +
                String.join(sorted, ', ') + '. The API would accept the value and store it, and it would then render wrong in nCino.'
            );
        }

        Boolean createPackage = String.isBlank(req.productPackageId);
        Id accountId;
        String packageLabel;

        if (createPackage) {
            List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id = :req.accountId WITH USER_MODE LIMIT 1];
            if (accounts.isEmpty()) {
                throw new ToolException('Account ' + req.accountId + ' was not found, or is not visible to you.');
            }
            accountId = accounts[0].Id;
            packageLabel = packageName(accounts[0].Name);
        } else {
            List<LLC_BI__Product_Package__c> pkgs = [
                SELECT Id, Name, LLC_BI__Account__c, LLC_BI__Account__r.Name
                FROM LLC_BI__Product_Package__c
                WHERE Id = :req.productPackageId
                WITH USER_MODE
                LIMIT 1
            ];
            if (pkgs.isEmpty()) {
                throw new ToolException('Product package ' + req.productPackageId + ' was not found, or is not visible to you.');
            }
            accountId = pkgs[0].LLC_BI__Account__c;
            if (accountId == null) {
                throw new ToolException('Product package ' + pkgs[0].Name + ' has no account. A facility needs a borrower.');
            }
            packageLabel = pkgs[0].Name;
        }

        // THE ARMS. The facility this plan files is the only thing they can land on, and it has no
        // id yet, so it is named by the label the modification's own arm resolver already
        // understands. The parsers are the modification's: they carry the org resolution, and a
        // second copy of the covenant-type catalog and the collateral-type catalog would drift the
        // first time a picklist moves (LESSONS 55).
        C360NewFacilities.NewFacility nf = new C360NewFacilities.NewFacility();
        nf.label = NEW_FACILITY_LABEL;
        nf.product = req.product;
        nf.amount = req.amount;
        nf.termMonths = req.termMonths;
        nf.purpose = req.primaryLoanPurpose;
        List<C360NewFacilities.NewFacility> newFacilities = new List<C360NewFacilities.NewFacility>{ nf };

        StageLoanModification.Request armReq = new StageLoanModification.Request();
        armReq.idempotencyKey = req.idempotencyKey;
        armReq.productPackageId = req.productPackageId;
        armReq.rationale = req.rationale;
        armReq.covenantAddsJson = req.covenantAddsJson;
        armReq.covenantAttachesJson = req.covenantAttachesJson;
        armReq.pledgeAddsJson = req.pledgeAddsJson;
        // No facility is selected, so the parsers cannot read the borrower off one. On the
        // package-first path there is not even a package to read it off: the relationship is the
        // only thing this plan knows, and it is what the arms resolve against.
        armReq.armBorrowerId = accountId;

        List<String> armWarnings = new List<String>();
        List<LLC_BI__Loan__c> noFacilities = new List<LLC_BI__Loan__c>();
        List<StageLoanModification.CovenantAdd> covenantAdds =
            StageLoanModification.parseCovenantAdds(armReq, noFacilities, newFacilities, armWarnings);
        List<StageLoanModification.CovenantAttach> covenantAttaches =
            StageLoanModification.parseCovenantAttaches(armReq, noFacilities, newFacilities, armWarnings);
        List<StageLoanModification.PledgeAdd> pledgeAdds =
            StageLoanModification.parsePledgeAdds(armReq, noFacilities, newFacilities);
        C360FacilityArms.assertBudget(covenantAdds, covenantAttaches, pledgeAdds);

        // Name is deliberately absent: the org rebuilds it and any value we send is discarded.
        Map<String, Object> resolved = new Map<String, Object>{
            'LLC_BI__Account__c' => accountId,
            'LLC_BI__Product_Package__c' => req.productPackageId,
            'createPackage' => createPackage,
            'packageName' => packageLabel,
            'LLC_BI__Stage__c' => RT_CREATE_STAGE,
            'LLC_BI__Status__c' => RT_CREATE_STATUS,
            'LLC_BI__isRenewal__c' => false,
            'LLC_BI__Is_Modification__c' => false,
            'LLC_BI__Product__c' => req.product,
            'LLC_BI__Amount__c' => req.amount,
            'LLC_BI__Term_Months__c' => req.termMonths,
            'primaryLoanPurpose' => req.primaryLoanPurpose
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        if (createPackage) {
            steps.add(
                new C360Plan.Step('create_package', C360Plan.TYPE_WRITE, 'Create the credit package ' + packageLabel)
                    .onObject(C360WriteGuard.OBJ_PRODUCT_PACKAGE, new List<String>{ 'Name', 'LLC_BI__Account__c' })
                    .wakes(new List<String>{
                        'PPCacheCreation and ProductPackageBaselineCaptureTrigger, which swallow their own failures to System.debug and are therefore org-side unverifiable'
                    })
                    .provenBy('SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = :newPackageId')
            );
        }
        steps.add(
            new C360Plan.Step('write_loan', C360Plan.TYPE_WRITE, 'Create the facility at Qualification on ' + packageLabel)
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{
                    'LLC_BI__Account__c', 'LLC_BI__Product_Package__c', 'LLC_BI__Stage__c', 'LLC_BI__Status__c',
                    'LLC_BI__isRenewal__c', 'LLC_BI__Is_Modification__c', 'LLC_BI__Product__c', 'LLC_BI__Amount__c',
                    'LLC_BI__Default_App__c'
                })
                .wakes(new List<String>{
                    'Five managed namespaces (LLC_BI, nFORCE, nCino, NDOC, nCRED) and 21 validation rules',
                    'A before-save flow that REBUILDS the loan name as Account - Product - Amount',
                    'ACNPEX_ AccountOwnerAsLoanOfficer, which assigns the loan officer'
                })
                .provenBy('SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Product__c FROM LLC_BI__Loan__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('write_involvement', C360Plan.TYPE_WRITE, 'Add the borrower to the facility\'s borrowing structure')
                .onObject(C360WriteGuard.OBJ_INVOLVEMENT, new List<String>{
                    'LLC_BI__Account__c', 'LLC_BI__Loan__c', 'LLC_BI__Product_Package__c',
                    'LLC_BI__Borrower_Type__c', 'LLC_BI__Ownership__c'
                })
                .provenBy('SELECT Id, LLC_BI__Borrower_Type__c FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :newId')
        );
        steps.add(
            new C360Plan.Step('verify_loan', C360Plan.TYPE_VERIFICATION, 'Read back the facility and report the name the org assigned')
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{ 'Name', 'LLC_BI__Stage__c', 'LLC_BI__Product__c' })
                .provenBy('SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Product__c FROM LLC_BI__Loan__c WHERE Id = :newId')
        );
        // THE ARMS LAND WITH THE FACILITY, in the same transaction that files it, which is why they
        // sit here rather than after the stage hop. Two reasons, and both are about honesty. The
        // Loan Detail is created by an after-commit flow that can be slow or absent, and hanging a
        // covenant off that wait would mean a banker who asked for "this facility with this
        // covenant" could get the facility alone and never be told. And a failure in an arm rolls
        // the facility back with it, so the plan is all-or-nothing the way the banker read it.
        C360FacilityArms.plan(
            resolved, steps, new Map<Id, String>(), newFacilities, covenantAdds, covenantAttaches, pledgeAdds
        );

        // The shells a pledge insert causes and nobody uses (backlog row 46, org proof 2026-09-14).
        // nCino answers every pledge insert with a collateral aggregate of its own, and the
        // facility already carries the one this run reused or minted, so nCino's is an orphan from
        // birth that no later discard can name: a discard reads shells off the facilities, and no
        // facility ever pointed at these. The transaction that caused them is the only place that
        // still can, so it removes them and says how many it found. Zero is the healthy answer.
        steps.add(
            new C360Plan.Step(C360AggregateSweep.STEP_ID, C360Plan.TYPE_WRITE,
                'Remove any collateral aggregate shell this run mints and leaves unlinked, and only those')
                .onObject('LLC_BI__Loan_Collateral_Aggregate__c', new List<String>{ 'Id' })
                .wakes(new List<String>{ 'nCino managed delete handling on LLC_BI__Loan_Collateral_Aggregate__c' })
                .provenBy('SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id IN :swept')
        );

        steps.add(
            new C360Plan.Step('wait_loan_detail', C360Plan.TYPE_WAIT, 'nCino creates the Loan Detail, then this action continues')
                .onObject('LLC_BI__Loan_Detail__c', new List<String>())
                .wakes(new List<String>{ 'An async-path flow: Loan_Detail_Exists, Create_Loan_Detail, Update_Loan_with_New_Loan_Details_Record' })
                .provenBy('SELECT Id, LLC_BI__Loan_Detail__c FROM LLC_BI__Loan__c WHERE Id = :newId (re-read on the continuing call, never awaited in-transaction)')
                .waitingUpTo(LOAN_DETAIL_WAIT_MS)
        );
        steps.add(
            new C360Plan.Step('write_loan_purpose', C360Plan.TYPE_WRITE, 'Set the primary loan purpose on the Loan Detail')
                .onObject('LLC_BI__Loan_Detail__c', new List<String>{ 'LLC_BI__Primary_Loan_Purpose__c' })
                .provenBy('SELECT Id, LLC_BI__Primary_Loan_Purpose__c FROM LLC_BI__Loan_Detail__c WHERE Id = :loanDetailId')
        );
        steps.add(
            new C360Plan.Step('hop_to_proposal', C360Plan.TYPE_WRITE, 'Move the facility from Qualification to Proposal')
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{ 'LLC_BI__Stage__c' })
                .wakes(new List<String>{ 'The LV11 to LV14 validation ladder' })
                .provenBy('SELECT Id, LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('verify_hop', C360Plan.TYPE_VERIFICATION, 'Confirm the facility now reads Proposal')
                .onObject(C360WriteGuard.OBJ_LOAN, new List<String>{ 'LLC_BI__Stage__c' })
                .provenBy('SELECT Id, LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('observe_loan_officer', C360Plan.TYPE_OBSERVED, 'The org assigns the loan officer')
                .wakes(new List<String>{ 'ACNPEX_ AccountOwnerAsLoanOfficer' })
        );

        List<String> warnings = new List<String>{
            'The org rewrites the facility name as "Account - Product - Amount". The name you see after creation is the org\'s, not one this panel chose.',
            'The Loan Detail is created by the org moments after the facility is filed, in its own transaction. This action files the facility and returns; continuing it verifies the Loan Detail and completes the move to Proposal. Nothing is lost in between, and no second confirmation is needed.',
            'The loan officer is assigned by org automation from the account owner, not by this panel.',
            'This action does not suppress org automation. Its two-phase design depends on the async Loan Detail flow.',
            'A borrower row is added to the facility\'s borrowing structure as part of this action. A facility insert creates none on its own, so without this step the facility would have no borrowing structure at all.'
        };
        warnings.addAll(C360FacilityArms.warnings(covenantAdds, covenantAttaches, pledgeAdds, 'the new facility'));
        warnings.addAll(armWarnings);
        if (createPackage) {
            warnings.add(
                'A new credit package will be created for this relationship first, named to the org\'s own convention. ' +
                'Its creation wakes PPCacheCreation and ProductPackageBaselineCaptureTrigger, which report nothing back on failure, ' +
                'so those effects are surfaced as org-side and unverifiable rather than claimed as done.'
            );
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'LLC_BI__Account__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.valueOf(accountId) },
            'LLC_BI__Product_Package__c' => createPackage
                ? new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'New package, named to the org convention <Account> - <M/D/YYYY> - PP.' }
                : new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => req.productPackageId },
            'LLC_BI__Product__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Amount__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Stage__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'A33.3.1: the only state this tool may create with.' }
        };

        String summary =
            'Adds the borrower to the facility\'s borrowing structure at 100 percent ownership. ' +
            (createPackage
                ? 'Creates a new credit package for this relationship, named ' + packageLabel + ' to the org\'s own convention, then files one facility on it'
                : 'Creates one facility on ' + packageLabel) +
            ' at stage Qualification, status Open, product ' + req.product +
            ', amount ' + String.valueOf(req.amount) + '. The org names the record and assigns the loan officer. ' +
            (covenantAdds.isEmpty() && covenantAttaches.isEmpty() && pledgeAdds.isEmpty()
                ? ''
                : 'In the same breath it files ' +
                  armPhrase(covenantAdds.size(), covenantAttaches.size(), pledgeAdds.size()) +
                  ' onto that facility, so the whole decision lands together or not at all. ') +
            'Once nCino has created the Loan Detail, the purpose is written and the facility moves one step to Proposal. ' +
            'Nothing is approved: post-approval stages are unreachable through this panel.';

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('new-facility-request', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'new-facility-request', req.idempotencyKey, accountId, req.productPackageId, planJson, planHash
        );

        StageResult r = new StageResult();
        r.stagingId = staged.stagingId;
        r.planHash = staged.planHash;
        r.decisionToken = staged.decisionToken;
        r.replayed = staged.replayed;
        r.tokenRotated = staged.tokenRotated;
        r.summary = summary;
        r.warnings = warnings;
        r.provenanceJson = JSON.serialize(provenance);
        r.accountId = accountId;
        r.productPackageId = req.productPackageId;
        r.createsPackage = createPackage;
        r.plannedPackageName = createPackage ? packageLabel : null;
        r.covenantAddCount = covenantAdds.size();
        r.covenantAttachCount = covenantAttaches.size();
        r.pledgeAddCount = pledgeAdds.size();
        r.newFacilityLabel = NEW_FACILITY_LABEL;
        r.steps = toWireSteps(steps);
        return r;
    }

    /** The arms this plan carries, in banker language, for the summary. */
    private static String armPhrase(Integer adds, Integer attaches, Integer pledges) {
        List<String> said = new List<String>();
        if (adds > 0) {
            said.add(adds + ' net-new covenant' + (adds == 1 ? '' : 's'));
        }
        if (attaches > 0) {
            said.add(attaches + ' existing covenant' + (attaches == 1 ? '' : 's') + ' associated to it');
        }
        if (pledges > 0) {
            said.add(pledges + ' collateral pledge' + (pledges == 1 ? '' : 's'));
        }
        return String.join(said, ', ');
    }

    /**
     * Builds the package name to the convention this org actually uses.
     *
     * Live SOQL, 2026-07-26: 516 of 518 packages end in " - PP", and the recent ones read
     * "<Account Name> - <M/D/YYYY> - PP", including the packages nCino's own wizard created. A tool
     * that invents its own naming makes agent-created packages visibly foreign in a list view.
     */
    private static String packageName(String accountName) {
        Date d = Date.today();
        return accountName + ' - ' + d.month() + '/' + d.day() + '/' + d.year() + ' - PP';
    }

    private static List<PlanStep> toWireSteps(List<C360Plan.Step> steps) {
        List<PlanStep> out = new List<PlanStep>();
        for (C360Plan.Step s : steps) {
            PlanStep p = new PlanStep();
            p.id = s.id;
            p.type = s.type;
            p.label = s.label;
            p.objectName = s.objectName;
            p.fields = s.fields;
            p.automationWoken = s.automationWoken;
            p.verification = s.verification;
            p.waitBudgetMs = s.waitBudgetMs;
            p.state = s.state;
            out.add(p);
        }
        return out;
    }

    private static ToolError err(String code, String message, String orgError, String idempotencyKey) {
        ToolError e = new ToolError();
        e.code = code;
        e.message = message;
        e.orgError = orgError;
        e.resumable = false;
        e.idempotencyKey = idempotencyKey;
        return e;
    }
}
