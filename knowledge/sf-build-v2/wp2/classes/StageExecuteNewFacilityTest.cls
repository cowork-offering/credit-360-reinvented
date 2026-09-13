/**
 * StageExecuteNewFacilityTest - the new-facility pair.
 *
 * The assertions that matter are the ones probe 5 made necessary: product is required because the
 * org self-populates Construction from a blank, the org rewrites the name so nothing may echo a
 * submitted one, and the Loan Detail arrives on an async path that does not exist in a test
 * transaction, so the wait step must land in filed_unverified rather than failing the run.
 */
@IsTest
private class StageExecuteNewFacilityTest {

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.account();
        C360Wave2Fixture.productPackage(a.Id);
    }

    private static String why(StageNewFacility.Response r) {
        return r.error == null ? '(no error reported)' : r.error.code + ' :: ' + r.error.message +
            (r.error.orgError == null ? '' : ' :: org said: ' + r.error.orgError);
    }

    private static StageNewFacility.Request req(Id packageId, String key) {
        StageNewFacility.Request r = new StageNewFacility.Request();
        r.idempotencyKey = key;
        r.productPackageId = packageId;
        r.rationale = 'Client asked for a new working capital line.';
        r.product = 'Line of Credit';
        r.amount = 750000;
        r.primaryLoanPurpose = 'business_credit_line';
        r.termMonths = 36;
        return r;
    }

    @IsTest
    static void stageWritesNoDomainRow() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Map<String, Integer> before = C360Wave2Fixture.domainRowCounts();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, C360Wave2Fixture.key('nf-zero')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        Map<String, Integer> after = C360Wave2Fixture.domainRowCounts();
        for (String obj : before.keySet()) {
            System.assertEquals(before.get(obj), after.get(obj), 'stage_new_facility wrote a row to ' + obj + '. A33.0.1 forbids it.');
        }
        System.assertEquals(false, JSON.serialize(res.result).contains('loanId'), 'A33.5.3: stage output carries no record id');
    }

    @IsTest
    static void productIsRequiredBecauseTheOrgSelfPopulatesIt() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        StageNewFacility.Request r = req(p.Id, C360Wave2Fixture.key('nf-noprod'));
        r.product = null;

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'Probe 5: a blank product ships a facility mislabelled Construction');
        System.assert(res.error.message.contains('Construction'), 'The refusal should name the trap: ' + res.error.message);
    }

    @IsTest
    static void purposeAndAmountAreRequiredForTheStageHop() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();

        StageNewFacility.Request noPurpose = req(p.Id, C360Wave2Fixture.key('nf-nopurpose'));
        noPurpose.primaryLoanPurpose = null;
        StageNewFacility.Request noAmount = req(p.Id, C360Wave2Fixture.key('nf-noamount'));
        noAmount.amount = null;

        Test.startTest();
        List<StageNewFacility.Response> out =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ noPurpose, noAmount });
        Test.stopTest();

        System.assertEquals(false, out[0].ok, 'LV12 needs the purpose, and the org leaves it null on the Loan Detail');
        System.assertEquals(false, out[1].ok, 'LV11 needs the amount');
    }

    @IsTest
    static void planCarriesTheWaitStepWithABudget() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, C360Wave2Fixture.key('nf-wait')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        Boolean sawWait = false;
        for (StageNewFacility.PlanStep s : res.result.steps) {
            if (s.type == C360Plan.TYPE_WAIT) {
                sawWait = true;
                System.assertNotEquals(null, s.waitBudgetMs, 'A wait step must declare its budget (A33.3.3)');
                System.assert(s.waitBudgetMs >= 10000 && s.waitBudgetMs <= 30000, 'Probe 5 backs a 10 to 30 second budget, got ' + s.waitBudgetMs);
            }
        }
        System.assertEquals(true, sawWait, 'The plan must carry the async Loan Detail wait step');
    }

    @IsTest
    static void executeCreatesTheFacilityAndReportsTheOrgAssignedName() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-happy');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));

        ExecuteNewFacility.Request ex = new ExecuteNewFacility.Request();
        ex.idempotencyKey = key;
        ex.stagingId = staged.result.stagingId;
        ex.planHash = staged.result.planHash;
        ex.decisionToken = staged.result.decisionToken;
        ex.approverUserId = UserInfo.getUserId();
        ExecuteNewFacility.Response done = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ ex })[0];
        Test.stopTest();

        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));

        LLC_BI__Loan__c filed = [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__isRenewal__c, LLC_BI__Is_Modification__c, LLC_BI__Product__c
            FROM LLC_BI__Loan__c WHERE Id = :done.result.loanId
        ];
        System.assertEquals('Open', filed.LLC_BI__Status__c);
        System.assertEquals(false, filed.LLC_BI__isRenewal__c, 'Cannot_Check_More_Than_One_Loan_Type: a new facility is neither');
        System.assertEquals(false, filed.LLC_BI__Is_Modification__c);
        System.assertEquals(
            filed.Name,
            done.result.recordName,
            'The tool must report the name the ORG assigned, never one anybody submitted (probe 5, finding 1)'
        );
        System.assertEquals(p.Name, done.result.anchorName, 'anchorName carries the product package');
    }

    @IsTest
    static void invocationOneFilesAndReturnsWithoutWaiting() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-inv1');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        Integer cpuBefore = Limits.getCpuTime();
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Integer cpuSpent = Limits.getCpuTime() - cpuBefore;
        Test.stopTest();

        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertEquals(C360Plan.TERMINAL_PARTIAL, done.result.terminalState, 'Invocation 1 is honestly partial: the plan is not finished');
        System.assertEquals(true, done.result.resumable, 'Invocation 1 must hand back a resumable action');
        System.assertNotEquals(null, done.result.resumeDescriptor, 'The caller must be told what to do next');
        System.assertNotEquals(null, done.result.loanId, 'The facility id comes back on invocation 1');
        System.assertNotEquals(null, done.result.recordName, 'The org-assigned name comes back on invocation 1');

        // Wave 4: a 6 s spin cost 6,511 ms of the 10,000 ms ceiling. Nothing here may burn CPU.
        System.assert(
            cpuSpent < 5000,
            'execute_new_facility must not busy-wait. CPU spent in the invocation: ' + cpuSpent + ' ms.'
        );

        Map<String, String> stateById = new Map<String, String>();
        for (ExecuteNewFacility.StepResult st : done.result.steps) {
            stateById.put(st.id, st.state);
        }
        System.assertEquals(C360Plan.STATE_VERIFIED, stateById.get('write_loan'));
        System.assertEquals(C360Plan.STATE_WAITING, stateById.get('wait_loan_detail'), 'The wait step is waiting, not failed and not unverified');
        System.assertEquals(C360Plan.STATE_PENDING, stateById.get('write_loan_purpose'), 'Phase 2 stays pending until the action continues');
        System.assertEquals(C360Plan.STATE_PENDING, stateById.get('hop_to_proposal'));
        System.assertEquals('Qualification', [SELECT LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = :done.result.loanId].LLC_BI__Stage__c);
    }

    @IsTest
    static void invocationTwoStaysWaitingWhenTheOrgHasNotCreatedTheChild() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-inv2');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'invocation 1 should succeed');

        // The after-commit flow does not run in a test transaction, so the child is absent here.
        // That is exactly the still-waiting branch, and it must never read as a failure.
        ExecuteNewFacility.Response second = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, second.ok, 'A still-waiting resume is a successful invocation');
        System.assertEquals(true, second.result.resumable, 'It stays resumable');
        System.assertNotEquals(C360Plan.TERMINAL_FAILED, second.result.terminalState, 'An absent child is not evidence of failure');
        System.assertEquals(first.result.loanId, second.result.loanId, 'The resume continues the same facility');
        System.assertEquals(
            1,
            [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :p.Id],
            'A resume never creates a second facility'
        );
        System.assertEquals('Qualification', [SELECT LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = :second.result.loanId].LLC_BI__Stage__c,
            'No hop happens while the Loan Detail is still absent');
    }

    @IsTest
    static void invocationTwoNeedsNoNewTokenButRefusesAForeignApprover() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-inv2auth');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'invocation 1 should succeed');

        // No token at all on the resume: the single-use token was consumed by invocation 1 and
        // covers the whole plan.
        ExecuteNewFacility.Request resume = new ExecuteNewFacility.Request();
        resume.idempotencyKey = key;
        resume.stagingId = staged.result.stagingId;
        resume.planHash = staged.result.planHash;
        resume.decisionToken = null;
        resume.approverUserId = UserInfo.getUserId();
        ExecuteNewFacility.Response ok = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ resume })[0];

        ExecuteNewFacility.Response foreign;
        List<User> others = [SELECT Id FROM User WHERE Id != :UserInfo.getUserId() AND IsActive = true LIMIT 1];
        if (!others.isEmpty()) {
            ExecuteNewFacility.Request r = new ExecuteNewFacility.Request();
            r.idempotencyKey = key;
            r.stagingId = staged.result.stagingId;
            r.planHash = staged.result.planHash;
            r.decisionToken = null;
            r.approverUserId = others[0].Id;
            foreign = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ r })[0];
        }
        Test.stopTest();

        System.assertEquals(true, ok.ok, 'The resume authenticates on stagingId, planHash, key and approver, not on a fresh token');
        if (foreign != null) {
            System.assertEquals(false, foreign.ok, 'A resume may not hand an authorized plan to a different human');
            System.assertEquals('VALIDATION_FAILED', foreign.error.code);
        }
    }

    @IsTest
    static void resumeAgainstAStalePlanHashIsRefused() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-inv2hash');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok);

        ExecuteNewFacility.Request r = new ExecuteNewFacility.Request();
        r.idempotencyKey = key;
        r.stagingId = staged.result.stagingId;
        r.planHash = 'deadbeef' + staged.result.planHash.substring(8);
        r.decisionToken = null;
        r.approverUserId = UserInfo.getUserId();
        ExecuteNewFacility.Response res = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A resume runs against the staged plan or not at all');
        System.assertEquals('VALIDATION_FAILED', res.error.code);
    }

    @IsTest
    static void executeRefusesAMissingToken() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-notoken');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        ExecuteNewFacility.Request ex = new ExecuteNewFacility.Request();
        ex.idempotencyKey = key;
        ex.stagingId = staged.result.stagingId;
        ex.planHash = staged.result.planHash;
        ex.decisionToken = null;
        ex.approverUserId = UserInfo.getUserId();
        ExecuteNewFacility.Response res = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ ex })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'No execute_* runs without a decision token');
        System.assertEquals('TOKEN_REFUSED', res.error.code);
    }

    private static ExecuteNewFacility.Response executeStaged(String key, StageNewFacility.StageResult staged) {
        ExecuteNewFacility.Request ex = new ExecuteNewFacility.Request();
        ex.idempotencyKey = key;
        ex.stagingId = staged.stagingId;
        ex.planHash = staged.planHash;
        ex.decisionToken = staged.decisionToken;
        ex.approverUserId = UserInfo.getUserId();
        return ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ ex })[0];
    }

    @IsTest
    static void repeatedInvocationsNeverCreateASecondFacility() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-replay');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'first execute should succeed');
        ExecuteNewFacility.Response again = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, again.ok, 'A continuing invocation is a successful invocation');
        System.assertEquals(first.result.loanId, again.result.loanId, 'It continues the same facility');
        System.assertEquals(first.result.recordName, again.result.recordName, 'The org-assigned name is stable across invocations');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :p.Id], 'One key, one facility, never two');
    }

    @IsTest
    static void executeRefusesAStalePlanHashAndAForeignApprover() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-refuse');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];

        ExecuteNewFacility.Request badHash = new ExecuteNewFacility.Request();
        badHash.idempotencyKey = key;
        badHash.stagingId = staged.result.stagingId;
        badHash.planHash = 'deadbeef' + staged.result.planHash.substring(8);
        badHash.decisionToken = staged.result.decisionToken;
        badHash.approverUserId = UserInfo.getUserId();
        ExecuteNewFacility.Response r1 = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ badHash })[0];

        ExecuteNewFacility.Response r2;
        List<User> others = [SELECT Id FROM User WHERE Id != :UserInfo.getUserId() AND IsActive = true LIMIT 1];
        if (!others.isEmpty()) {
            ExecuteNewFacility.Request foreign = new ExecuteNewFacility.Request();
            foreign.idempotencyKey = key;
            foreign.stagingId = staged.result.stagingId;
            foreign.planHash = staged.result.planHash;
            foreign.decisionToken = staged.result.decisionToken;
            foreign.approverUserId = others[0].Id;
            r2 = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ foreign })[0];
        }
        Test.stopTest();

        System.assertEquals(false, r1.ok, 'A stale plan hash is refused');
        System.assertEquals('TOKEN_REFUSED', r1.error.code);
        if (r2 != null) {
            System.assertEquals(false, r2.ok, 'An approver who is not the running identity is refused');
            System.assertEquals('TOKEN_REFUSED', r2.error.code);
        }
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :p.Id], 'Nothing may be written on a refused execute');
    }

    @IsTest
    static void executeRefusesWhenTheAnchorMovedSinceStaging() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-moved');

        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        delete p;

        Test.startTest();
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(false, done.ok, 'A33.3.3: re-query the anchor before any resumed write');
        System.assert(done.error.message.contains('Re-stage'), 'The refusal must say what to do: ' + done.error.message);
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan__c], 'Nothing may be written when the precondition fails');
    }

    @IsTest
    static void executeRefusesIncompleteRequests() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        List<ExecuteNewFacility.Request> bad = new List<ExecuteNewFacility.Request>();
        for (Integer i = 0; i < 3; i++) {
            ExecuteNewFacility.Request r = new ExecuteNewFacility.Request();
            r.idempotencyKey = i == 0 ? null : 'k';
            r.stagingId = i == 1 ? null : '000000000000000AAA';
            r.planHash = i == 2 ? null : 'h';
            r.decisionToken = 't';
            r.approverUserId = UserInfo.getUserId();
            bad.add(r);
        }
        List<ExecuteNewFacility.Response> out = ExecuteNewFacility.run(bad);
        Test.stopTest();

        for (Integer i = 0; i < 3; i++) {
            System.assertEquals(false, out[i].ok, 'Element ' + i + ' is missing a required input');
            System.assertEquals('VALIDATION_FAILED', out[i].error.code);
        }
    }

    @IsTest
    static void unknownProductIsRefusedAgainstTheOrgPicklist() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        StageNewFacility.Request r = req(p.Id, C360Wave2Fixture.key('nf-badprod'));
        r.product = 'Term';

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok,
            'LESSONS 15w: the Commercial Loan record type omits Term, the API would store it anyway, and it renders wrong in nCino');
        System.assertEquals('VALIDATION_FAILED', res.error.code);
        System.assert(res.error.message.contains('Commercial Loan record type'), 'The refusal names the scope: ' + res.error.message);
        System.assert(res.error.message.contains('Line of Credit'), 'The refusal lists the RT-valid values: ' + res.error.message);
        System.assertEquals(false, res.error.message.contains(', Term'), 'Term must not appear in the offered list: ' + res.error.message);
    }

    @IsTest
    static void everyRtValidProductIsAccepted() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        for (String product : new List<String>{ 'Construction', 'Equipment', 'Line of Credit', 'HELOC', 'Purchase', 'Deposit' }) {
            StageNewFacility.Request r = req(p.Id, C360Wave2Fixture.key('nf-rt-' + product));
            r.product = product;
            StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
            System.assertEquals(true, res.ok, 'RT-valid product refused: ' + product + ' :: ' + why(res));
        }
    }

    @IsTest
    static void executeAddsTheBorrowerToTheBorrowingStructure() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Account a = C360Wave2Fixture.existingAccount();
        String key = C360Wave2Fixture.key('nf-involve');

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertNotEquals(null, done.result.involvementId, 'A facility insert creates no involvement row, so the tool must');

        LLC_BI__Legal_Entities__c inv = [
            SELECT Id, LLC_BI__Account__c, LLC_BI__Loan__c, LLC_BI__Product_Package__c,
                   LLC_BI__Borrower_Type__c, LLC_BI__Ownership__c, LLC_BI__Contingent_Amount__c
            FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c = :done.result.loanId
        ];
        System.assertEquals(a.Id, inv.LLC_BI__Account__c, 'The borrower is the relationship');
        System.assertEquals(done.result.loanId, inv.LLC_BI__Loan__c);
        System.assertEquals(p.Id, inv.LLC_BI__Product_Package__c, 'Every real involvement row carries the package, and so does ours');
        System.assertEquals('Borrower', inv.LLC_BI__Borrower_Type__c, 'The role IS the flag: there is no primary-borrower boolean');
        System.assertEquals(100, inv.LLC_BI__Ownership__c);
        System.assertEquals(null, inv.LLC_BI__Contingent_Amount__c,
            'Ownership and Contingent Amount are mutually exclusive on one row, so we set Ownership only');
    }

    @IsTest
    static void planCarriesTheBorrowingStructureStep() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, C360Wave2Fixture.key('nf-plan-inv')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        Boolean sawInvolvement = false;
        for (StageNewFacility.PlanStep st : res.result.steps) {
            if (st.id == 'write_involvement') {
                sawInvolvement = true;
                System.assertEquals(C360Plan.TYPE_WRITE, st.type);
            }
        }
        System.assertEquals(true, sawInvolvement, 'The banker must see the borrowing-structure write before confirming');
    }

    @IsTest
    static void unknownPackageIsRefused() {
        C360TestFixture.armCalloutMock();
        StageNewFacility.Request r = req(C360Wave2Fixture.fakeId(LLC_BI__Product_Package__c.SObjectType), C360Wave2Fixture.key('nf-nopkg'));

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A package this tool cannot read is refused');
        System.assert(res.error.message.contains('not found'), 'The refusal should say so: ' + res.error.message);
    }

    private static StageNewFacility.Request reqNoPackage(Id accountId, String key) {
        StageNewFacility.Request r = new StageNewFacility.Request();
        r.idempotencyKey = key;
        r.accountId = accountId;
        r.rationale = 'New relationship, no credit package exists yet.';
        r.product = 'Line of Credit';
        r.amount = 400000;
        r.primaryLoanPurpose = 'business_credit_line';
        return r;
    }

    @IsTest
    static void planWithAPackageCarriesNoCreatePackageStep() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, C360Wave2Fixture.key('nf-haspkg')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        System.assertEquals(false, res.result.createsPackage, 'An existing package is used as-is');
        System.assertEquals(null, res.result.plannedPackageName);
        for (StageNewFacility.PlanStep st : res.result.steps) {
            System.assertNotEquals('create_package', st.id, 'No package step when one was supplied');
        }
        System.assertEquals('write_loan', res.result.steps[0].id, 'The loan write leads the plan');
    }

    @IsTest
    static void planWithoutAPackageCreatesOneFirstNamedToTheOrgConvention() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.existingAccount();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ reqNoPackage(a.Id, C360Wave2Fixture.key('nf-nopkg2')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        System.assertEquals(true, res.result.createsPackage, 'Package-first is the canonical nCino flow');
        System.assertEquals('create_package', res.result.steps[0].id, 'The package step comes BEFORE the loan step');
        System.assertEquals('write_loan', res.result.steps[1].id);

        String planned = res.result.plannedPackageName;
        System.assertNotEquals(null, planned, 'The planned package name must be visible before confirming');
        System.assert(planned.startsWith(a.Name), 'Convention is <Account> - <M/D/YYYY> - PP, got: ' + planned);
        System.assert(planned.endsWith(' - PP'), 'Convention is <Account> - <M/D/YYYY> - PP, got: ' + planned);
        System.assert(res.result.summary.contains('credit package'), 'The summary must say a package will be created: ' + res.result.summary);
    }

    @IsTest
    static void stageWithoutPackageOrAccountIsRefused() {
        C360TestFixture.armCalloutMock();
        StageNewFacility.Request r = reqNoPackage(null, C360Wave2Fixture.key('nf-neither'));
        r.accountId = null;

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'Without a package there is nothing to derive the borrower from');
        System.assertEquals('VALIDATION_FAILED', res.error.code);
    }

    @IsTest
    static void stageWithoutAPackageStillWritesNoDomainRow() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.existingAccount();
        Integer pkgBefore = [SELECT COUNT() FROM LLC_BI__Product_Package__c];
        Map<String, Integer> before = C360Wave2Fixture.domainRowCounts();

        Test.startTest();
        StageNewFacility.Response res =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ reqNoPackage(a.Id, C360Wave2Fixture.key('nf-pkgzero')) })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        System.assertEquals(pkgBefore, [SELECT COUNT() FROM LLC_BI__Product_Package__c], 'stage_* creates no package either. A33.0.1 is unconditional.');
        Map<String, Integer> after = C360Wave2Fixture.domainRowCounts();
        for (String obj : before.keySet()) {
            System.assertEquals(before.get(obj), after.get(obj), 'stage wrote a row to ' + obj);
        }
    }

    @IsTest
    static void executeCreatesThePackageThenTheFacilityUnderIt() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.existingAccount();
        String key = C360Wave2Fixture.key('nf-pkgexec');
        Integer pkgBefore = [SELECT COUNT() FROM LLC_BI__Product_Package__c];

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ reqNoPackage(a.Id, key) })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertEquals(true, done.result.packageCreated, 'This run created the package');
        System.assertNotEquals(null, done.result.productPackageId, 'The new package id comes back');
        System.assertEquals(pkgBefore + 1, [SELECT COUNT() FROM LLC_BI__Product_Package__c], 'Exactly one package created');

        LLC_BI__Product_Package__c pkg = [
            SELECT Id, Name, RecordTypeId, LLC_BI__Account__c FROM LLC_BI__Product_Package__c WHERE Id = :done.result.productPackageId
        ];
        System.assertEquals(a.Id, pkg.LLC_BI__Account__c, 'The package hangs off the borrower');
        System.assertEquals(null, pkg.RecordTypeId, 'Real packages in this org carry no record type, and neither does ours');
        System.assertEquals(staged.result.plannedPackageName, pkg.Name, 'The package carries the name the banker was shown at confirm');
        System.assertEquals(pkg.Name, done.result.anchorName);

        LLC_BI__Loan__c loan = [SELECT Id, LLC_BI__Product_Package__c FROM LLC_BI__Loan__c WHERE Id = :done.result.loanId];
        System.assertEquals(pkg.Id, loan.LLC_BI__Product_Package__c, 'The facility sits on the package this action created');
    }

    @IsTest
    static void idempotencyCoversThePackageAndFacilityPair() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.existingAccount();
        String key = C360Wave2Fixture.key('nf-pkgidem');
        Integer pkgBefore = [SELECT COUNT() FROM LLC_BI__Product_Package__c];

        Test.startTest();
        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ reqNoPackage(a.Id, key) })[0];
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'invocation 1 should succeed');
        ExecuteNewFacility.Response again = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, again.ok);
        System.assertEquals(first.result.loanId, again.result.loanId, 'Same facility');
        System.assertEquals(first.result.productPackageId, again.result.productPackageId, 'Same package');
        System.assertEquals(pkgBefore + 1, [SELECT COUNT() FROM LLC_BI__Product_Package__c], 'Never two packages');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :first.result.productPackageId], 'Never two facilities');
    }

    // -------------------------------------------------------------------------------------------
    // THE SECOND HALF OF INVOCATION 2, which no test could reach before.
    //
    // The Loan Detail is created by an after-commit flow that does not run in a test transaction, so
    // every resume this file drove stopped at "still waiting" and the purpose write, the hop to
    // Proposal and its verification were never executed by a test at all. They are the half of the
    // action a banker actually gets, and the field is writable, so the child is STOOD UP here and
    // the resume is driven through to the end.
    //
    // It is a fixture, not a claim about the org: the org creates this record itself, moments after
    // the filing, and what is proved here is what our code does once it exists.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void invocationTwoWritesThePurposeAndHopsToProposalOnceTheChildExists() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-inv2done');

        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        System.assertEquals(true, staged.ok, why(staged));
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'invocation 1 files the facility');
        Id loanId = (Id) first.result.loanId;

        // Stand the child up the way the org would have, then continue the same plan.
        LLC_BI__Loan_Detail__c detail = new LLC_BI__Loan_Detail__c(LLC_BI__Loan__c = loanId);
        insert detail;
        update new LLC_BI__Loan__c(Id = loanId, LLC_BI__Loan_Detail__c = detail.Id);

        ExecuteNewFacility.Response second = executeStaged(key, staged.result);

        System.assertEquals(true, second.ok, second.error == null ? '' : second.error.message);
        System.assertEquals(false, second.result.resumable, 'The plan is finished, so there is nothing left to resume');
        System.assertEquals(null, second.result.resumeDescriptor, 'And nothing to tell the caller to do next');
        System.assertEquals(detail.Id, (Id) second.result.loanDetailId, 'The result names the child it wrote against');
        System.assertEquals('Proposal', second.result.stage, 'The single allowlisted hop ran');
        System.assertEquals(C360Plan.TERMINAL_SUCCESS, second.result.terminalState,
            'Every step settles once the child is there: ' + JSON.serialize(second.result.steps));
        System.assertEquals('business_credit_line',
            [SELECT LLC_BI__Primary_Loan_Purpose__c FROM LLC_BI__Loan_Detail__c WHERE Id = :detail.Id].LLC_BI__Primary_Loan_Purpose__c,
            'The purpose the banker gave lands on the Loan Detail, which is the only object that holds it');
        System.assertEquals('Proposal', [SELECT LLC_BI__Stage__c FROM LLC_BI__Loan__c WHERE Id = :loanId].LLC_BI__Stage__c,
            'And the facility reads back one step on, never further: Booked needs a human');
    }

    @IsTest
    static void aResumeWhoseFacilityIsGoneIsRefusedRatherThanGuessedAt() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        String key = C360Wave2Fixture.key('nf-gone');

        StageNewFacility.Response staged =
            StageNewFacility.stage(new List<StageNewFacility.Request>{ req(p.Id, key) })[0];
        ExecuteNewFacility.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'invocation 1 files the facility');

        delete new LLC_BI__Loan__c(Id = (Id) first.result.loanId);

        ExecuteNewFacility.Response second = executeStaged(key, staged.result);
        System.assertEquals(false, second.ok, 'A resume against a facility that is no longer there writes nothing and says so');
        System.assertEquals('VALIDATION_FAILED', second.error.code);
        System.assert(second.error.message.contains('re-read at resume time'), second.error.message);
    }

    @IsTest
    static void executeAgainstAStagingIdThatDoesNotExistIsRefused() {
        C360TestFixture.armCalloutMock();
        ExecuteNewFacility.Request r = new ExecuteNewFacility.Request();
        r.idempotencyKey = C360Wave2Fixture.key('nf-nostaging');
        r.stagingId = C360Wave2Fixture.fakeId(cm_Action_Staging__c.SObjectType);
        r.planHash = 'h';
        r.decisionToken = 't';
        r.approverUserId = UserInfo.getUserId();

        Test.startTest();
        ExecuteNewFacility.Response res = ExecuteNewFacility.run(new List<ExecuteNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok);
        System.assertEquals('VALIDATION_FAILED', res.error.code);
        System.assert(res.error.message.contains('No staging record found'), res.error.message);
    }

    // -------------------------------------------------------------------------------------------
    // Backlog row 49, the arms: a facility can be opened WITH its covenant and its pledge.
    //
    // One decision, one plan, one confirmation. The arms are the modification's, parsed by its own
    // public parsers, and they land on a facility that has no id until execute time: the plan names
    // it `new:1` and the execute resolves that to the facility it just created.
    // -------------------------------------------------------------------------------------------

    private static Id armCovenantTypeId() {
        LLC_BI__Covenant_Type__c t = new LLC_BI__Covenant_Type__c(Name = 'ZZ-NF-ARM-DSCR');
        insert t;
        return t.Id;
    }

    private static Id armCollateralId() {
        LLC_BI__Collateral_Type__c ct = new LLC_BI__Collateral_Type__c(
            Name = 'ZZ-NF-ARM Type', LLC_BI__Advance_Rate__c = 50);
        insert ct;
        LLC_BI__Collateral__c c = new LLC_BI__Collateral__c(
            LLC_BI__Collateral_Type__c = ct.Id,
            LLC_BI__Value__c = 1000000,
            LLC_BI__Description__c = 'ZZ-NF-ARM asset'
        );
        insert c;
        insert new LLC_BI__Account_Collateral__c(
            LLC_BI__Account__c = C360Wave2Fixture.existingAccount().Id,
            LLC_BI__Collateral__c = c.Id,
            LLC_BI__Ownership_Percentage__c = 100,
            LLC_BI__Primary_Owner__c = true
        );
        return c.Id;
    }

    @IsTest
    static void theArmsPlanAgainstTheLabelBecauseTheFacilityHasNoIdYet() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Id covTypeId = armCovenantTypeId();

        StageNewFacility.Request r = req(p.Id, C360Wave2Fixture.key('nf-armplan'));
        r.covenantAddsJson = '[{"typeId":"' + covTypeId + '","threshold":1.25,"operator":">=","frequency":"Quarterly"}]';

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        System.assertEquals(1, res.result.covenantAddCount);
        System.assertEquals('new:1', res.result.newFacilityLabel,
            'The arms target a facility whose id is minted at execute time, so the plan needs a stable handle for it.');

        Boolean namedByLabel = false;
        for (StageNewFacility.PlanStep st : res.result.steps) {
            if (st.id == 'covenant_attach_0' && st.label.contains('new:1')) {
                namedByLabel = true;
            }
        }
        System.assertEquals(true, namedByLabel,
            'The banker reads what the covenant attaches to, and before the org names the facility that is the label: ' +
            JSON.serialize(res.result.steps));
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Covenant2__c], 'A33.0.1: staging writes no covenant.');
    }

    @IsTest
    static void executeFilesTheFacilityAndItsArmsInOneTransaction() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Id covTypeId = armCovenantTypeId();
        Id collateralId = armCollateralId();
        String key = C360Wave2Fixture.key('nf-armexec');

        StageNewFacility.Request r = req(p.Id, key);
        r.covenantAddsJson = '[{"typeId":"' + covTypeId + '","threshold":1.25,"operator":">=","frequency":"Quarterly"}]';
        r.pledgeAddsJson = '[{"collateralId":"' + collateralId + '","amountPledged":250000}]';
        StageNewFacility.Response staged = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));

        Test.startTest();
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok,
            'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertEquals(1, done.result.covenantsCreated);
        System.assertEquals(1, done.result.pledgesCreated);
        System.assertEquals(0, done.result.assetsCreated, 'The borrower already owned the asset.');

        Id loanId = done.result.loanId;
        System.assertEquals(1,
            [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :loanId],
            'The covenant is junctioned onto the facility this action created, not onto anything else.');
        System.assertEquals(1,
            [SELECT COUNT() FROM LLC_BI__Account_Covenant__c],
            'And onto the borrower, the way nCino\'s own UI does it.');
        LLC_BI__Covenant2__c cov = [
            SELECT Id, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c, LLC_BI__Active__c
            FROM LLC_BI__Covenant2__c LIMIT 1
        ];
        System.assertEquals(1.25, cov.LLC_BI__Financial_Indicator_Value__c);
        System.assertEquals(true, cov.LLC_BI__Active__c);
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c],
            'A covenant create mints NO compliance row, which is what keeps the org\'s unrecallable approval out of this.');

        List<LLC_BI__Loan_Collateral2__c> pledges = [
            SELECT Id, LLC_BI__Collateral__c, LLC_BI__Amount_Pledged__c, LLC_BI__Loan_Collateral_Aggregate__c
            FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :loanId
        ];
        System.assertEquals(1, pledges.size(), 'One pledge on the new facility.');
        System.assertEquals(collateralId, pledges[0].LLC_BI__Collateral__c);
        System.assertEquals(250000, pledges[0].LLC_BI__Amount_Pledged__c);
        System.assertNotEquals(null, pledges[0].LLC_BI__Loan_Collateral_Aggregate__c,
            'A pledge needs three parents, and the aggregate shell is the one nothing else creates (LESSONS 15ac).');

        Map<String, ExecuteNewFacility.StepResult> steps = new Map<String, ExecuteNewFacility.StepResult>();
        for (ExecuteNewFacility.StepResult st : done.result.steps) {
            steps.put(st.id, st);
        }
        System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('covenant_verify_0').state,
            'The proof is the re-read, never the insert: ' + steps.get('covenant_verify_0').detail);
        System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('pledge_verify_0').state,
            steps.get('pledge_verify_0').detail);
        System.assert(steps.get('pledge_verify_0').detail.contains('advance rate'),
            'The advance rate is a formula the org resolves, so it is REPORTED from the row rather than asserted: ' +
            steps.get('pledge_verify_0').detail);
    }

    @IsTest
    static void theArmBudgetIsFivePerKindAndItSaysWhy() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Id covTypeId = armCovenantTypeId();

        List<String> six = new List<String>();
        for (Integer i = 0; i < 6; i++) {
            six.add('{"typeId":"' + covTypeId + '","threshold":' + (1 + i) + ',"operator":">="}');
        }
        StageNewFacility.Request r = req(p.Id, C360Wave2Fixture.key('nf-armcap'));
        r.covenantAddsJson = '[' + String.join(six, ',') + ']';

        Test.startTest();
        StageNewFacility.Response res = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'Six covenants plus the facility chain will not fit one transaction.');
        System.assert(res.error.message.contains('the cap is 5'), 'The refusal names the cap: ' + res.error.message);
        System.assert(res.error.message.contains('queueable'), 'And the governor reason behind it: ' + res.error.message);
    }

    /**
     * The other two shapes an arm can take, on one run: a covenant the borrower ALREADY holds
     * associated by junction only, and a pledge of an asset that does not exist yet.
     */
    @IsTest
    static void executeAssociatesAnExistingCovenantAndAuthorsTheAssetItPledges() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Account a = C360Wave2Fixture.existingAccount();

        LLC_BI__Covenant2__c held = new LLC_BI__Covenant2__c(
            LLC_BI__Account__c = a.Id,
            LLC_BI__Covenant_Type__c = armCovenantTypeId(),
            LLC_BI__Financial_Indicator_Value__c = 1.10,
            LLC_BI__Active__c = true,
            LLC_BI__Is_Template__c = false
        );
        insert held;
        LLC_BI__Collateral_Type__c ct = new LLC_BI__Collateral_Type__c(
            Name = 'ZZ-NF-NEWASSET Type', LLC_BI__Advance_Rate__c = 60);
        insert ct;

        String key = C360Wave2Fixture.key('nf-armnew');
        StageNewFacility.Request r = req(p.Id, key);
        r.covenantAttachesJson = '[{"covenantId":"' + held.Id + '"}]';
        r.pledgeAddsJson = '[{"newCollateral":{"description":"ZZ-NF new machine line",' +
            '"collateralType":"' + ct.Id + '","value":800000},"advanceRate":60,' +
            '"advanceRateReason":"Field exam of the machine line, July."}]';
        StageNewFacility.Response staged = StageNewFacility.stage(new List<StageNewFacility.Request>{ r })[0];
        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        System.assertEquals(1, staged.result.covenantAttachCount);
        System.assertEquals(1, staged.result.pledgeAddCount);

        Test.startTest();
        ExecuteNewFacility.Response done = executeStaged(key, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok,
            'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertEquals(0, done.result.covenantsCreated, 'An association creates no covenant.');
        System.assertEquals(1, done.result.covenantsAssociated);
        System.assertEquals(1, done.result.assetsCreated, 'The asset did not exist, so this run authored it.');
        System.assertEquals(1, done.result.pledgesCreated);

        Id loanId = done.result.loanId;
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Covenant2__c],
            'The held covenant is junctioned, never copied.');
        System.assertEquals(1,
            [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :loanId AND LLC_BI__Covenant2__c = :held.Id]);

        LLC_BI__Collateral__c asset = [
            SELECT Id, LLC_BI__Value__c, LLC_BI__Description__c FROM LLC_BI__Collateral__c
            WHERE LLC_BI__Collateral_Type__c = :ct.Id LIMIT 1
        ];
        System.assertEquals(800000, asset.LLC_BI__Value__c);
        System.assertEquals(1,
            [SELECT COUNT() FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = :asset.Id AND LLC_BI__Account__c = :a.Id],
            'LLC_BI__Collateral__c carries no account lookup, so the ownership junction is the asset\'s only link to the relationship.');
        System.assertEquals(1,
            [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :loanId AND LLC_BI__Collateral__c = :asset.Id]);

        Map<String, ExecuteNewFacility.StepResult> steps = new Map<String, ExecuteNewFacility.StepResult>();
        for (ExecuteNewFacility.StepResult st : done.result.steps) {
            steps.put(st.id, st);
        }
        System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('covenant_associate_verify_0').state,
            steps.get('covenant_associate_verify_0').detail);
        System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('collateral_create_0').state);
        System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('collateral_own_0').state);
    }

    @IsTest
    static void theArmBudgetBindsEveryArmAndTheWarningsNameWhatIsComing() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Account a = C360Wave2Fixture.existingAccount();

        // SIX DISTINCT covenants: the same one six times is refused earlier, as a duplicate
        // junction, and would never reach the budget the test is about.
        List<LLC_BI__Covenant2__c> heldSix = new List<LLC_BI__Covenant2__c>();
        for (Integer i = 0; i < 6; i++) {
            heldSix.add(new LLC_BI__Covenant2__c(
                LLC_BI__Account__c = a.Id, LLC_BI__Active__c = true, LLC_BI__Is_Template__c = false));
        }
        insert heldSix;
        LLC_BI__Covenant2__c held = heldSix[0];

        List<String> sixAttaches = new List<String>();
        for (LLC_BI__Covenant2__c c : heldSix) {
            sixAttaches.add('{"covenantId":"' + c.Id + '"}');
        }
        StageNewFacility.Request overAttaches = req(p.Id, C360Wave2Fixture.key('nf-capattach'));
        overAttaches.covenantAttachesJson = '[' + String.join(sixAttaches, ',') + ']';

        StageNewFacility.Request okAttach = req(p.Id, C360Wave2Fixture.key('nf-okattach'));
        okAttach.covenantAttachesJson = '[{"covenantId":"' + held.Id + '"}]';

        Test.startTest();
        List<StageNewFacility.Response> out = StageNewFacility.stage(
            new List<StageNewFacility.Request>{ overAttaches, okAttach });
        Test.stopTest();

        System.assertEquals(false, out[0].ok, 'Six associations is over the per-transaction budget.');
        System.assert(out[0].error.message.contains('covenant associations'),
            'The refusal names the arm that broke the budget: ' + out[0].error.message);

        System.assertEquals(true, out[1].ok, 'One association is well inside it, got ' + why(out[1]));
        Boolean saidJunctionOnly = false;
        for (String w : out[1].result.warnings) {
            if (w.contains('junction only')) {
                saidJunctionOnly = true;
            }
        }
        System.assertEquals(true, saidJunctionOnly,
            'The banker is told an association creates no covenant before confirming: ' + out[1].result.warnings);
    }

    @IsTest
    static void aPledgeOverTheLendableValueIsRefusedUnlessTheBankerAuthorisesIt() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c p = C360Wave2Fixture.existingPackage();
        Id collateralId = armCollateralId();

        StageNewFacility.Request over = req(p.Id, C360Wave2Fixture.key('nf-overpledge'));
        over.pledgeAddsJson = '[{"collateralId":"' + collateralId + '","amountPledged":900000}]';

        StageNewFacility.Request authorised = req(p.Id, C360Wave2Fixture.key('nf-authpledge'));
        authorised.pledgeAddsJson =
            '[{"collateralId":"' + collateralId + '","amountPledged":900000,"authoriseOverPledge":true}]';

        Test.startTest();
        List<StageNewFacility.Response> out = StageNewFacility.stage(
            new List<StageNewFacility.Request>{ over, authorised });
        Test.stopTest();

        System.assertEquals(false, out[0].ok,
            'The asset is worth 1,000,000 at a 50 percent advance rate, so 900,000 is over its lendable value.');
        System.assert(out[0].error.message.contains('Authorize'),
            'The refusal names the org\'s own escape rather than leaving the banker guessing: ' + out[0].error.message);
        System.assertEquals(true, out[1].ok,
            'The banker may authorise the over-pledge on the entry, and then it stages: ' + why(out[1]));
    }
}
