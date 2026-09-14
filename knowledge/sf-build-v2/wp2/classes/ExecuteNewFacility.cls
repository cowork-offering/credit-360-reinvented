/**
 * ExecuteNewFacility - MCP tool: execute_new_facility.
 *
 * TWO INVOCATIONS, NEVER A WAIT INSIDE A TRANSACTION (A33.4.3 two-step, as originally specced).
 *
 *   Invocation 1: insert the Loan at Qualification/Open, commit, RETURN IMMEDIATELY with the loan
 *                 id and the name the ORG assigned. write_loan and verify_loan land verified;
 *                 wait_loan_detail lands `waiting` with resumable true; the purpose-write and the
 *                 stage hop stay pending. Terminal state is `partial`, which is the honest answer.
 *   Invocation 2: a RESUME on the same stagingId. Re-reads the Loan's Loan Detail lookup ONCE. If
 *                 it is there, writes the purpose, performs the single allowlisted hop to Proposal,
 *                 verifies, and finishes `success`. If it is not there yet, returns still-waiting
 *                 and resumable again. Never failed: an absent child is not evidence of failure.
 *
 * WHY THIS SHAPE, AND WHY THE PREVIOUS ONE WAS WRONG (PROBE-LEDGER wave 4, LESSONS 15p).
 * The Loan Detail is created by an AFTER-COMMIT async flow. It is structurally invisible to the
 * transaction that inserted the loan, so no amount of waiting inside that transaction can ever see
 * it. The first build spin-waited to honour a declared budget; Apex has no sleep, so the spin burned
 * 6,511 ms of the 10,000 ms synchronous CPU ceiling in six seconds and the platform LimitException
 * fired long before the tool's own filed_unverified fallback could be reached. The fence held (clean
 * rollback, token unconsumed) but the action could never succeed. There is no version of an
 * in-transaction wait that works here.
 *
 * TOKEN SEMANTICS ACROSS THE TWO CALLS. The single-use decision token is consumed by invocation 1,
 * because the banker's confirm authorized THE WHOLE PLAN, not one third of it. Invocation 2 is the
 * same plan continuing, so it authenticates on stagingId + planHash + idempotencyKey + the same
 * approver identity, and is gated on the staging row actually being in the partial state. It cannot
 * start a fresh action, it cannot run against a different plan, and it cannot be driven by a
 * different human than the one who confirmed.
 *
 * THE ARMS (backlog row 49, founder 2026-09-13). When the staged plan carries net-new covenants,
 * covenant associations or collateral pledges, invocation 1 authors them onto the facility it just
 * created, in the SAME transaction, and proves every row by re-query. The authoring lives in
 * C360FacilityArms, which is also what stage_new_facility and stage_renewal build their plans from,
 * so the plan and the write cannot describe different things. A failure in an arm rolls the facility
 * back with it: the banker confirmed one decision and gets all of it or none of it.
 *
 * BORROWING STRUCTURE. A Loan insert creates NO involvement row: proven with a control, where the
 * Loan Detail appeared and involvement rows did not (LESSONS 15u). A facility filed without one has
 * no borrowing structure at all, so invocation 1 also writes the Borrower row on
 * LLC_BI__Legal_Entities__c and verifies it by re-query.
 *
 * CALL THE ORG'S FLOW OR INSERT DIRECTLY? Decided on evidence: DIRECT INSERT. The org-authored
 * AutoLaunchedFlow "Create Involvement Tool" (301bb00001H95auAAB) was read read-only and is not a
 * sane surface for this:
 *   - it never sets LLC_BI__Product_Package__c, which every real involvement row in the org carries;
 *   - it hardcodes LLC_BI__Contingent_Type__c to 'Joint & Several' whether or not that is true;
 *   - it maps LLC_BI__Ownership__c from a variable named contingentPercentage while separately
 *     assigning LLC_BI__Contingent_Amount__c, so a caller supplying both writes both and trips the
 *     mutual-exclusion rule the flow does not guard.
 * We set Ownership only, never Contingent Amount, which keeps the XOR rule satisfied by
 * construction (LESSONS 15v). The Is_* fields are formulas derived from Borrower_Type and are on the
 * guard's forbidden list.
 *
 * PACKAGE-FIRST. When the staged plan carries no product package, invocation 1 creates one for the
 * relationship BEFORE the loan, named to the convention this org actually uses. Package creation
 * wakes PPCacheCreation and ProductPackageBaselineCaptureTrigger, both of which swallow their own
 * failures to System.debug, so their effects are reported as org-side and unverifiable rather than
 * claimed as done. Idempotency covers the pair: a replay returns both ids and creates neither twice.
 *
 * Booked stays unreachable. LV06 carries no bypass and nCino requires a human Submit for Approval.
 * This tool advances the facility exactly one step and stops.
 *
 * Org contract: A33.4.3. Write evidence: PROBE-LEDGER wave 3 probes 5 and 9, wave 4 defect pass.
 */
global with sharing class ExecuteNewFacility {

    /** Raised for a domain-level failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /** The registry action id this tool runs, and the key its delete fence is declared under. */
    private static final String ACTION_ID = 'new-facility-request';

    private static final String RESUME_DESCRIPTOR =
        'Continue this action to verify the Loan Detail and complete the move to Proposal. ' +
        'No new confirmation is needed: the same plan is still running.';

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Staging Id' required=true)
        global String stagingId;
        @InvocableVariable(label='Plan Hash' required=true)
        global String planHash;
        @InvocableVariable(label='Decision Token' required=true)
        global String decisionToken;
        @InvocableVariable(label='Approver User Id' required=true)
        global String approverUserId;
    }

    global class StepResult {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type')
        global String type;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='State')
        global String state;
        @InvocableVariable(label='Detail')
        global String detail;
    }

    global class ToolError {
        @InvocableVariable(label='Code')
        global String code;
        @InvocableVariable(label='Message')
        global String message;
        @InvocableVariable(label='Org Error')
        global String orgError;
        @InvocableVariable(label='Step')
        global String step;
        @InvocableVariable(label='Resumable')
        global Boolean resumable;
        @InvocableVariable(label='Idempotency Key')
        global String idempotencyKey;
    }

    global class ExecuteResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Loan Id')
        global String loanId;
        @InvocableVariable(label='Record Name' description='The name the ORG assigned. A before-save flow rebuilds it as Account - Product - Amount, so this is never the name anybody submitted.')
        global String recordName;
        @InvocableVariable(label='Anchor Name' description='The product package the facility hangs off.')
        global String anchorName;
        @InvocableVariable(label='Product Package Id' description='The package the facility sits on, whether supplied or created by this action.')
        global String productPackageId;
        @InvocableVariable(label='Package Created' description='True when this action created the package rather than filing under an existing one.')
        global Boolean packageCreated;
        @InvocableVariable(label='Involvement Id' description='The borrowing-structure row this action created. A facility insert creates none on its own.')
        global String involvementId;
        @InvocableVariable(label='Loan Detail Id')
        global String loanDetailId;
        @InvocableVariable(label='Covenants Created' description='Net-new covenants this action created on the borrower and attached to the facility, each proved by re-query.')
        global Integer covenantsCreated;
        @InvocableVariable(label='Covenants Associated' description='Existing covenants this action junctioned onto the facility. No covenant record was created or amended.')
        global Integer covenantsAssociated;
        @InvocableVariable(label='Pledges Created' description='Collateral pledges this action authored on the facility.')
        global Integer pledgesCreated;
        @InvocableVariable(label='Assets Created' description='Collateral records this action created, with the borrower recorded as owner. Zero where every pledge named an asset the borrower already held.')
        global Integer assetsCreated;
        @InvocableVariable(label='Stage' description='The facility stage after this run. Proposal on a full success, Qualification when the Loan Detail did not arrive in budget.')
        global String stage;
        @InvocableVariable(label='Terminal State')
        global String terminalState;
        @InvocableVariable(label='Steps')
        global List<StepResult> steps;
        @InvocableVariable(label='Outcome')
        global String outcome;
        @InvocableVariable(label='Resumable' description='True when the action is mid-plan and a second invocation should continue it. Invocation 2 needs no new token.')
        global Boolean resumable;
        @InvocableVariable(label='Resume Descriptor' description='What the caller should do next, in banker language.')
        global String resumeDescriptor;
        @InvocableVariable(label='Replayed')
        global Boolean replayed;
    }

    global class Response {
        @InvocableVariable(label='OK')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global ExecuteResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /**
     * Executes a staged new facility.
     *
     * @param requests One request per execution. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='execute_new_facility'
        description='Execute a plan staged by stage_new_facility, behind the single-use decision token. Creates the facility at Qualification, authors any net-new covenants, covenant associations and collateral pledges the plan carries onto it in the same transaction and verifies each by re-query, waits for nCino to create the Loan Detail, then performs the single allowlisted hop to Proposal. Never reaches a post-approval stage.'
    )
    global static List<Response> run(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = execute(req);
                res.ok = true;
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360ActionStaging.StagingException e) {
                res.ok = false;
                res.error = err('TOKEN_REFUSED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360WriteGuard.GuardException e) {
                res.ok = false;
                res.error = err('ALLOWLIST_REFUSED', e.getMessage(), null, 'write_loan', false, req.idempotencyKey);
            } catch (DmlException e) {
                res.ok = false;
                res.error = err('ORG_REJECTED_WRITE', 'The org refused the facility write.', e.getMessage(), 'write_loan', true, req.idempotencyKey);
            } catch (QueryException e) {
                res.ok = false;
                res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), null, true, req.idempotencyKey);
            }
            out.add(res);
        }
        return out;
    }

    private static ExecuteResult execute(Request req) {
        if (String.isBlank(req.idempotencyKey)) {
            throw new ToolException('idempotencyKey is required and must match the key used at stage time.');
        }
        if (String.isBlank(req.stagingId)) {
            throw new ToolException('stagingId is required.');
        }
        if (String.isBlank(req.planHash)) {
            throw new ToolException('planHash is required.');
        }

        cm_Action_Staging__c stg = readStaging(req.stagingId);
        if (stg == null) {
            throw new ToolException('No staging record found for stagingId ' + req.stagingId + '.');
        }

        // A fresh run goes through claimForExecute, which owns the token and plan-hash refusals so
        // every execute_* tool reports the same code for the same failure. Only the continuing
        // paths check the hash here, because they run without a token by design.
        Boolean continuing = stg.cm_Status__c == 'Completed'
            || (stg.cm_Status__c == 'Partial' && String.isNotBlank(stg.cm_Result_Record_Id__c));
        if (!continuing) {
            return invocationOne(req, stg);
        }

        if (stg.cm_Plan_Hash__c != req.planHash) {
            throw new ToolException('planHash does not match the staged plan. A resume runs against the staged plan or not at all.');
        }
        if (stg.cm_Idempotency_Key__c != req.idempotencyKey) {
            throw new ToolException('idempotencyKey does not match the staged action.');
        }
        return stg.cm_Status__c == 'Completed' ? replay(stg) : resume(req, stg);
    }

    /**
     * Invocation 1: create the facility, commit, and return. No wait of any kind.
     */
    private static ExecuteResult invocationOne(Request req, cm_Action_Staging__c staged) {
        // The moment this run began, taken before its first write so every row it causes reads back
        // inside the window the aggregate sweep uses. EXACT, with no slack: a back-margin reaches
        // into the transaction that ran before this one.
        Datetime txStart = Datetime.now();

        cm_Action_Staging__c stg = C360ActionStaging.claimForExecute(
            req.stagingId, req.planHash, req.decisionToken, C360Plan.asId(req.approverUserId)
        );

        List<C360Plan.Step> steps = C360Plan.deserializeSteps(stg.cm_Plan_JSON__c);
        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);
        Id packageId = C360Plan.asId(v.get('LLC_BI__Product_Package__c'));

        Boolean createPackage = C360Plan.asBool(v.get('createPackage'));
        Id accountId = C360Plan.asId(v.get('LLC_BI__Account__c'));
        List<LLC_BI__Product_Package__c> anchor;

        if (createPackage) {
            Map<String, Object> pkgFields = new Map<String, Object>{
                'Name' => C360Plan.asString(v.get('packageName')),
                'LLC_BI__Account__c' => accountId
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_CREATE, pkgFields);

            LLC_BI__Product_Package__c pkg = new LLC_BI__Product_Package__c(
                Name = (String) pkgFields.get('Name'),
                LLC_BI__Account__c = accountId
            );
            LLC_BI__Product_Package__c cleanPkg = (LLC_BI__Product_Package__c) C360WriteGuard.stripAndVerify(
                pkg, new Set<String>{ 'Name', 'LLC_BI__Account__c' }
            );
            insert as user cleanPkg;
            packageId = cleanPkg.Id;

            anchor = [SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1];
            C360Plan.setState(
                steps,
                'create_package',
                anchor.isEmpty() ? C360Plan.STATE_FILED_UNVERIFIED : C360Plan.STATE_VERIFIED,
                anchor.isEmpty()
                    ? 'The package insert returned success but the record could not be read back.'
                    : 'Credit package ' + anchor[0].Name + ' created. PPCacheCreation and ProductPackageBaselineCaptureTrigger ran org-side and report nothing back.'
            );
            if (anchor.isEmpty()) {
                C360Plan.markRefused(steps, 'The new credit package could not be read back. Re-stage the action.');
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw new ToolException('The credit package this plan created could not be read back. Re-stage the action.');
            }
        } else {
            anchor = [
                SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1
            ];
            if (anchor.isEmpty()) {
                C360Plan.markRefused(steps, 'The product package no longer exists or is no longer visible. Re-stage the action.');
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw new ToolException('The product package this plan targets could not be re-read at execute time. Re-stage the action.');
            }
        }

        // THE FIELD SET IS SHARED (2026-09-03). C360NewFacilities owns the shape a facility is
        // written with, because the modification's own new-facility arm writes the same one and two
        // copies of it would drift. The plan values are read here and the record is built there.
        C360NewFacilities.NewFacility nf = new C360NewFacilities.NewFacility();
        nf.product = C360Plan.asString(v.get('LLC_BI__Product__c'));
        nf.amount = C360Plan.asDecimal(v.get('LLC_BI__Amount__c'));
        nf.termMonths = C360Plan.asDecimal(v.get('LLC_BI__Term_Months__c'));
        nf.purpose = C360Plan.asString(v.get('primaryLoanPurpose'));

        Map<String, Object> writeFields = C360NewFacilities.loanFields(accountId, packageId, nf.product, nf.amount);
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_CREATE, writeFields);

        LLC_BI__Loan__c clean = (LLC_BI__Loan__c) C360WriteGuard.stripAndVerify(
            C360NewFacilities.newLoan(accountId, packageId, nf), C360NewFacilities.LOAN_MUST_SURVIVE
        );
        insert as user clean;
        C360Plan.setState(steps, 'write_loan', C360Plan.STATE_VERIFIED, 'Facility ' + clean.Id + ' created at Qualification.');

        // Borrowing structure. Ownership only: pairing it with a contingent amount on one row
        // trips Contingent_Amount_and_Contingent_Percent, whose only escape tests for a Household
        // role value that does not exist in this org.
        Map<String, Object> involvementFields = C360NewFacilities.involvementFields(accountId, clean.Id, packageId);
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE, involvementFields);

        LLC_BI__Legal_Entities__c cleanInvolvement = (LLC_BI__Legal_Entities__c) C360WriteGuard.stripAndVerify(
            C360NewFacilities.newInvolvement(accountId, clean.Id, packageId),
            C360NewFacilities.INVOLVEMENT_MUST_SURVIVE
        );
        insert as user cleanInvolvement;

        List<LLC_BI__Legal_Entities__c> involvementBack = [
            SELECT Id, LLC_BI__Borrower_Type__c, LLC_BI__Ownership__c
            FROM LLC_BI__Legal_Entities__c
            WHERE LLC_BI__Loan__c = :clean.Id
            WITH USER_MODE
            LIMIT 1
        ];
        C360Plan.setState(
            steps,
            'write_involvement',
            involvementBack.isEmpty() ? C360Plan.STATE_FILED_UNVERIFIED : C360Plan.STATE_VERIFIED,
            involvementBack.isEmpty()
                ? 'The borrower row was inserted but could not be read back.'
                : 'Borrower added to the borrowing structure at ' + String.valueOf(involvementBack[0].LLC_BI__Ownership__c) + ' percent ownership.'
        );

        LLC_BI__Loan__c filed = readLoan(clean.Id);
        String orgName = filed == null ? null : filed.Name;
        C360Plan.setState(
            steps,
            'verify_loan',
            filed == null ? C360Plan.STATE_FILED_UNVERIFIED : C360Plan.STATE_VERIFIED,
            filed == null
                ? 'The insert returned success but the facility could not be read back.'
                // The Default App is reported because it decides whether the nCino Loan page renders
                // at all (LESSONS 8o). A regression shows here rather than on the banker's screen.
                : 'The org named this facility ' + orgName + ' and set product ' + filed.LLC_BI__Product__c +
                  '. Default App ' + filed.LLC_BI__Default_App__c + '.'
        );

        // THE ARMS, IN THIS TRANSACTION (backlog row 49, founder 2026-09-13). The facility exists
        // and has been read back, which is everything a covenant junction or a pledge needs. They
        // are authored here rather than on the resume for two reasons: the Loan Detail is an
        // after-commit child that can be slow or absent, and hanging a covenant off that wait would
        // let a banker who asked for "this facility with this covenant" get the facility alone; and
        // a failure in an arm rolls the facility back with it, which is the all-or-nothing the plan
        // promised. Every row is proved by re-query inside C360FacilityArms, never by the insert.
        C360FacilityArms.Authored armed = C360FacilityArms.author(
            steps, v, accountId, clean.Id, orgName == null ? String.valueOf(clean.Id) : orgName
        );

        // The shells the arm's pledge insert causes and nobody uses (backlog row 46, org proof
        // 2026-09-14). nCino answers a pledge insert with a collateral aggregate of its own; the
        // facility already carries the one the arm minted, so nCino's is an orphan from birth that
        // no later discard can name. It is removed here, where it can still be identified. The
        // sweep also catches the arm's own shell on a plan whose pledges all failed to resolve an
        // asset, which is the one way this tool can strand one of its own.
        C360AggregateSweep.Result swept = C360AggregateSweep.sweep(ACTION_ID, txStart);
        C360Plan.setState(steps, C360AggregateSweep.STEP_ID, swept.state(), swept.detail);

        // The Loan Detail is created AFTER this transaction commits, so it is not observable from
        // here at all. Returning is the only correct move (LESSONS 15p).
        C360Plan.setState(
            steps,
            'wait_loan_detail',
            C360Plan.STATE_WAITING,
            'nCino creates the Loan Detail moments after this filing, in a separate transaction. It cannot be seen from here.'
        );

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.loanId = clean.Id;
        out.recordName = orgName;
        out.anchorName = anchor[0].Name;
        out.productPackageId = packageId;
        out.packageCreated = createPackage;
        out.involvementId = involvementBack.isEmpty() ? null : involvementBack[0].Id;
        out.stage = filed == null ? null : filed.LLC_BI__Stage__c;
        out.replayed = false;
        out.resumable = true;
        out.resumeDescriptor = RESUME_DESCRIPTOR;
        out.covenantsCreated = armed.covenantsCreated;
        out.covenantsAssociated = armed.covenantsAssociated;
        out.pledgesCreated = armed.pledgesCreated;
        out.assetsCreated = armed.assetsCreated;
        return finish(stg, steps, out,
            (createPackage ? 'Credit package ' + anchor[0].Name + ' created. ' : '') +
            'Facility ' + (orgName == null ? String.valueOf(clean.Id) : orgName) + ' filed at Qualification. ' +
            (armed.sentence == null ? '' : armed.sentence + ' ') +
            'The org creates the Loan Detail moments after filing, in its own transaction. ' + RESUME_DESCRIPTOR);
    }

    /**
     * Invocation 2: the same plan continuing. One read, no spin, no new token.
     */
    private static ExecuteResult resume(Request req, cm_Action_Staging__c stg) {
        Id approver = C360Plan.asId(req.approverUserId);
        if (approver == null) {
            throw new ToolException('approverUserId is required on every execute_* without exception.');
        }
        if (approver != UserInfo.getUserId()) {
            throw new ToolException('approverUserId does not match the running identity. This server runs as-user.');
        }
        if (stg.cm_Approver_User__c != null && stg.cm_Approver_User__c != approver) {
            throw new ToolException(
                'This action was confirmed by a different person. A resume continues the same plan for the same human, ' +
                'and is not a way to hand an authorized plan to someone else.'
            );
        }

        List<C360Plan.Step> steps = C360Plan.deserializeSteps(stg.cm_Plan_JSON__c);
        if (String.isNotBlank(stg.cm_Tracker_JSON__c)) {
            steps = (List<C360Plan.Step>) JSON.deserialize(stg.cm_Tracker_JSON__c, List<C360Plan.Step>.class);
        }
        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);
        Id loanId = C360Plan.asId(stg.cm_Result_Record_Id__c);

        LLC_BI__Loan__c loan = readLoan(loanId);
        if (loan == null) {
            throw new ToolException('The facility this plan created could not be re-read at resume time. Re-stage the action.');
        }

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.loanId = loanId;
        out.recordName = loan.Name;
        out.productPackageId = loan.LLC_BI__Product_Package__c;
        out.stage = loan.LLC_BI__Stage__c;
        out.replayed = false;

        // One read. If the org has not created the child yet, say so and stay resumable.
        if (loan.LLC_BI__Loan_Detail__c == null) {
            C360Plan.setState(
                steps,
                'wait_loan_detail',
                C360Plan.STATE_WAITING,
                'The Loan Detail has not appeared yet. This is not a failure: the org creates it asynchronously.'
            );
            out.resumable = true;
            out.resumeDescriptor = RESUME_DESCRIPTOR;
            return finish(stg, steps, out,
                'Facility ' + loan.Name + ' is filed and still waiting on the Loan Detail. Nothing has failed. ' + RESUME_DESCRIPTOR);
        }

        out.loanDetailId = loan.LLC_BI__Loan_Detail__c;
        C360Plan.setState(steps, 'wait_loan_detail', C360Plan.STATE_VERIFIED, 'nCino created Loan Detail ' + loan.LLC_BI__Loan_Detail__c + '.');

        // THE SAME WRITE, THROUGH THE SAME FENCE (2026-09-03). The Loan Detail
        // joined C360WriteGuard when complete_new_facility_detail was built, and
        // this is the other place in the package that writes the purpose. Two
        // writes to one field with only one of them fenced is how a fence stops
        // being one.
        String purpose = C360Plan.asString(v.get('primaryLoanPurpose'));
        C360WriteGuard.assertAllowed(
            C360WriteGuard.OBJ_LOAN_DETAIL,
            C360WriteGuard.OP_UPDATE,
            new Map<String, Object>{ 'LLC_BI__Primary_Loan_Purpose__c' => purpose }
        );
        update as user new LLC_BI__Loan_Detail__c(Id = loan.LLC_BI__Loan_Detail__c, LLC_BI__Primary_Loan_Purpose__c = purpose);
        C360Plan.setState(steps, 'write_loan_purpose', C360Plan.STATE_VERIFIED, 'Primary loan purpose set to ' + purpose + '.');

        Map<String, Object> hopFields = new Map<String, Object>{ 'LLC_BI__Stage__c' => 'Proposal' };
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_UPDATE, hopFields);
        update as user new LLC_BI__Loan__c(Id = loanId, LLC_BI__Stage__c = 'Proposal');
        C360Plan.setState(steps, 'hop_to_proposal', C360Plan.STATE_VERIFIED, 'Stage moved from Qualification to Proposal.');

        LLC_BI__Loan__c after = readLoan(loanId);
        out.stage = after == null ? null : after.LLC_BI__Stage__c;
        out.recordName = after == null ? loan.Name : after.Name;
        C360Plan.setState(
            steps,
            'verify_hop',
            after != null && after.LLC_BI__Stage__c == 'Proposal' ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
            after == null ? 'The facility could not be read back after the hop.' : 'Facility reads back at stage ' + after.LLC_BI__Stage__c + '.'
        );
        C360Plan.setState(
            steps,
            'observe_loan_officer',
            C360Plan.STATE_FILED_UNVERIFIED,
            'The loan officer was assigned by org automation from the account owner. This tool did not set it.'
        );

        out.resumable = false;
        out.resumeDescriptor = null;
        return finish(stg, steps, out,
            'Facility ' + (out.recordName == null ? String.valueOf(loanId) : out.recordName) + ' completed and moved to Proposal. ' +
            'The org assigned the name and the loan officer. Nothing has been approved: reaching Booked requires nCino\'s Submit for Approval.');
    }

    /** Reads the staging row with everything both invocations need. */
    private static cm_Action_Staging__c readStaging(String stagingId) {
        List<cm_Action_Staging__c> rows = [
            SELECT Id, cm_Plan_Hash__c, cm_Plan_JSON__c, cm_Tracker_JSON__c, cm_Status__c,
                   cm_Result_Record_Id__c, cm_Idempotency_Key__c, cm_Approver_User__c
            FROM cm_Action_Staging__c
            WHERE Id = :stagingId
            WITH USER_MODE
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    private static LLC_BI__Loan__c readLoan(Id loanId) {
        List<LLC_BI__Loan__c> rows = [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Product__c, LLC_BI__Loan_Detail__c,
                   LLC_BI__Product_Package__c, LLC_BI__Default_App__c
            FROM LLC_BI__Loan__c
            WHERE Id = :loanId
            WITH USER_MODE
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    private static ExecuteResult finish(cm_Action_Staging__c stg, List<C360Plan.Step> steps, ExecuteResult out, String outcome) {
        String terminal = C360Plan.terminalState(steps);
        C360ActionStaging.recordOutcome(stg, steps, terminal, out.loanId);
        out.terminalState = terminal;
        out.steps = toWireSteps(steps);
        out.outcome = outcome;
        return out;
    }

    /** An idempotent replay reports the prior run and writes nothing. */
    private static ExecuteResult replay(cm_Action_Staging__c prior) {
        ExecuteResult r = new ExecuteResult();
        r.stagingId = prior.Id;
        r.loanId = prior.cm_Result_Record_Id__c;
        r.recordName = nameOf(prior.cm_Result_Record_Id__c);
        r.terminalState = prior.cm_Status__c == 'Completed' ? C360Plan.TERMINAL_SUCCESS : C360Plan.TERMINAL_PARTIAL;
        r.replayed = true;
        r.outcome = 'This idempotency key already produced facility ' + prior.cm_Result_Record_Id__c + '. Nothing was written.';
        r.steps = prior.cm_Tracker_JSON__c == null
            ? new List<StepResult>()
            : toWireSteps((List<C360Plan.Step>) JSON.deserialize(prior.cm_Tracker_JSON__c, List<C360Plan.Step>.class));
        return r;
    }

    /** The org-assigned name of an already-created facility, so a replay stamps the same label. */
    private static String nameOf(String recordId) {
        if (String.isBlank(recordId)) {
            return null;
        }
        List<LLC_BI__Loan__c> rows = [SELECT Id, Name FROM LLC_BI__Loan__c WHERE Id = :recordId WITH USER_MODE LIMIT 1];
        return rows.isEmpty() ? null : rows[0].Name;
    }

    private static List<StepResult> toWireSteps(List<C360Plan.Step> steps) {
        List<StepResult> out = new List<StepResult>();
        for (C360Plan.Step s : steps) {
            StepResult r = new StepResult();
            r.id = s.id;
            r.type = s.type;
            r.label = s.label;
            r.state = s.state;
            r.detail = s.detail;
            out.add(r);
        }
        return out;
    }

    private static ToolError err(String code, String message, String orgError, String step, Boolean resumable, String idempotencyKey) {
        ToolError e = new ToolError();
        e.code = code;
        e.message = message;
        e.orgError = orgError;
        e.step = step;
        e.resumable = resumable;
        e.idempotencyKey = idempotencyKey;
        return e;
    }
}
