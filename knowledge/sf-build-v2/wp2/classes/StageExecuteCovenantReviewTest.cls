/**
 * StageExecuteCovenantReviewTest - the package-scoped bulk covenant pair, against REAL records.
 *
 * WHY THIS SUITE NOW CREATES COMPLIANCE ROWS, WHEN THE PREVIOUS ONE REFUSED TO.
 * The old suite injected a fake compliance record through a @TestVisible seam, because creating one
 * fires `acnpex_covenantApprovalProcess`, an ApprovalWorkflow with zero entry filters whose stage-1
 * step is assigned to a named human. That seam bought safety and cost the truth: it could not
 * exercise the traversal, the compliance-row selection, the Pending precondition, the per-item
 * isolation or the generation observation, which is to say it could not test anything this wave
 * added. The bulk tool reads the org in four places the seam cannot fake.
 *
 * The trade is made explicitly and it is bounded. Test DML rolls back, the fixture data is
 * throwaway, and this is a sandbox. The residual exposure is that a flow-based approval
 * orchestration's notification may not roll back with the transaction, which is the exact question
 * probe 8 declined to settle. It is settled here by decision rather than by assumption: the live
 * wire probe for this wave creates one throwaway compliance row deliberately, so the suite's
 * exposure is a subset of an effect already accepted.
 *
 * Fixture shape, and why it is shaped that way:
 *   - covenant A reaches the package ONLY through LLC_BI__Account_Covenant__c, with no loan junction
 *     at all. A loans-only traversal would miss it, and in this org 4 of the flagship relationship's
 *     6 covenants are exactly that.
 *   - covenant B reaches it ONLY through LLC_BI__Loan_Covenant__c, and its row sits at In Progress,
 *     which is the status that makes a write succeed and do nothing.
 *   - covenant C has no compliance row at all, which is the state every covenant in this org's
 *     flagship relationship is in.
 */
@IsTest
private class StageExecuteCovenantReviewTest {

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();
        Account a = C360Wave2Fixture.account();
        LLC_BI__Product_Package__c pkg = C360Wave2Fixture.productPackage(a.Id);
        LLC_BI__Loan__c loan = C360Wave2Fixture.loan(a.Id, pkg.Id);

        // Covenant2.Name is an auto-number and cannot be written, so the fixture identifies its
        // covenants through their type rather than through a name of our choosing.
        List<LLC_BI__Covenant_Type__c> types = new List<LLC_BI__Covenant_Type__c>{
            new LLC_BI__Covenant_Type__c(Name = 'ZZ-W2-COV-A'),
            new LLC_BI__Covenant_Type__c(Name = 'ZZ-W2-COV-B'),
            new LLC_BI__Covenant_Type__c(Name = 'ZZ-W2-COV-C')
        };
        insert types;

        List<LLC_BI__Covenant2__c> covenants = new List<LLC_BI__Covenant2__c>{
            new LLC_BI__Covenant2__c(LLC_BI__Account__c = a.Id, LLC_BI__Covenant_Type__c = types[0].Id,
                LLC_BI__Active__c = true, LLC_BI__Is_Template__c = false),
            new LLC_BI__Covenant2__c(LLC_BI__Account__c = a.Id, LLC_BI__Covenant_Type__c = types[1].Id,
                LLC_BI__Active__c = true, LLC_BI__Is_Template__c = false),
            new LLC_BI__Covenant2__c(LLC_BI__Account__c = a.Id, LLC_BI__Covenant_Type__c = types[2].Id,
                LLC_BI__Active__c = true, LLC_BI__Is_Template__c = false)
        };
        insert covenants;

        insert new List<SObject>{
            new LLC_BI__Account_Covenant__c(LLC_BI__Account__c = a.Id, LLC_BI__Covenant2__c = covenants[0].Id),
            new LLC_BI__Loan_Covenant__c(LLC_BI__Loan__c = loan.Id, LLC_BI__Covenant2__c = covenants[1].Id),
            new LLC_BI__Account_Covenant__c(LLC_BI__Account__c = a.Id, LLC_BI__Covenant2__c = covenants[2].Id)
        };

        insert new List<LLC_BI__Covenant_Compliance2__c>{
            new LLC_BI__Covenant_Compliance2__c(LLC_BI__Covenant__c = covenants[0].Id,
                LLC_BI__Status__c = 'Pending', LLC_BI__Due_Date__c = Date.today().addDays(30)),
            new LLC_BI__Covenant_Compliance2__c(LLC_BI__Covenant__c = covenants[1].Id,
                LLC_BI__Status__c = 'In Progress', LLC_BI__Due_Date__c = Date.today().addDays(45))
        };
    }

    private static LLC_BI__Covenant2__c covenant(String typeName) {
        return [SELECT Id, Name FROM LLC_BI__Covenant2__c WHERE LLC_BI__Covenant_Type__r.Name = :typeName LIMIT 1];
    }

    private static Id complianceOf(Id covenantId) {
        return [SELECT Id FROM LLC_BI__Covenant_Compliance2__c WHERE LLC_BI__Covenant__c = :covenantId ORDER BY CreatedDate ASC LIMIT 1].Id;
    }

    private static String why(StageCovenantReview.Response r) {
        return r.error == null ? '(no error reported)' : r.error.code + ' :: ' + r.error.message +
            (r.error.orgError == null ? '' : ' :: org said: ' + r.error.orgError);
    }

    private static StageCovenantReview.Assessment assess(Id covenantId, String status) {
        StageCovenantReview.Assessment a = new StageCovenantReview.Assessment();
        a.covenantId = covenantId;
        a.status = status;
        a.observedValue = 1.42;
        a.narrative = 'DSC of 1.42x against a 1.30x floor. Cushion holds.';
        a.comments = 'Tested against the Q2 spread.';
        return a;
    }

    private static StageCovenantReview.Request req(String key, List<StageCovenantReview.Assessment> assessments) {
        StageCovenantReview.Request r = new StageCovenantReview.Request();
        r.idempotencyKey = key;
        r.productPackageId = C360Wave2Fixture.existingPackage().Id;
        r.rationale = 'Quarterly covenant test across the package.';
        r.assessments = assessments;
        return r;
    }

    private static ExecuteCovenantReview.Response executeStaged(String key, StageCovenantReview.StageResult staged) {
        ExecuteCovenantReview.Request ex = new ExecuteCovenantReview.Request();
        ex.idempotencyKey = key;
        ex.stagingId = staged.stagingId;
        ex.planHash = staged.planHash;
        ex.decisionToken = staged.decisionToken;
        ex.approverUserId = UserInfo.getUserId();
        return ExecuteCovenantReview.run(new List<ExecuteCovenantReview.Request>{ ex })[0];
    }

    private static StageCovenantReview.PlannedCovenant find(StageCovenantReview.StageResult r, Id covenantId) {
        for (StageCovenantReview.PlannedCovenant p : r.covenants) {
            if (p.covenantId == String.valueOf(covenantId)) {
                return p;
            }
        }
        return null;
    }

    @IsTest
    static void stageWritesNoDomainRow() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Map<String, Integer> before = C360Wave2Fixture.domainRowCounts();

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-zero'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        Map<String, Integer> after = C360Wave2Fixture.domainRowCounts();
        for (String obj : before.keySet()) {
            System.assertEquals(before.get(obj), after.get(obj), 'stage_covenant_review wrote a row to ' + obj + '. A33.0.1 forbids it.');
        }
    }

    @IsTest
    static void theScopeIsTheUnionOfBothJunctionsNotJustTheLoanWalk() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id covB = covenant('ZZ-W2-COV-B').Id;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-union'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));
        System.assertEquals(3, res.result.scopeCount, 'The package aggregates all three covenants: two relationship-level, one loan-level');
        System.assertEquals('relationship', find(res.result, covA).attachment,
            'Covenant A has no loan junction at all, and a loans-only traversal would have missed it');
        System.assertEquals('loan', find(res.result, covB).attachment);
        System.assertEquals(1, res.result.assessedCount, 'Only the covenant carrying an assessment is written');
        System.assertEquals(C360Covenants.STATE_NOT_ASSESSED, find(res.result, covB).state,
            'A covenant in scope with no verdict is surveyed and reported, never written');
    }

    @IsTest
    static void aNonPendingRowIsRefusedPerItemAndThePendingOneStillRuns() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id covB = covenant('ZZ-W2-COV-B').Id;
        Id targetA = complianceOf(covA);
        Id targetB = complianceOf(covB);
        String key = C360Wave2Fixture.key('cov-bulk');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant'), assess(covB, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, staged.ok, 'One refused covenant must not discard the plan, got ' + why(staged));
        System.assertEquals(1, staged.result.assessedCount, 'Only the Pending row is planned');
        System.assertEquals(1, staged.result.refusedCount, 'The In Progress row is refused on its own');
        System.assertEquals(C360Covenants.STATE_NOT_PENDING, find(staged.result, covB).state);
        System.assert(find(staged.result, covB).reason.contains('In Progress'),
            'The refusal must name the status that caused it: ' + find(staged.result, covB).reason);
        System.assertEquals(5, staged.result.steps.size(), 'Five typed steps for the one planned covenant');

        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);
        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.code + ' ' + done.error.message));
        System.assertEquals(1, done.result.writtenCount);

        LLC_BI__Covenant_Compliance2__c writtenRow = [
            SELECT LLC_BI__Status__c, LLC_BI__Historic_Financial_Indicator__c, cm_Covenant_Compliance_Indicator_Value__c,
                   LLC_BI__Evaluation_Date__c, LLC_BI__Evaluated_By__c, LLC_BI__Covenant__c
            FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetA
        ];
        System.assertEquals('Compliant', writtenRow.LLC_BI__Status__c);
        System.assertEquals(1.42, writtenRow.LLC_BI__Historic_Financial_Indicator__c,
            'The observed value must reach the PACKAGED field: it is where nCino sources the covenant Last Evaluation Value from');
        System.assertEquals('1.42', writtenRow.cm_Covenant_Compliance_Indicator_Value__c, 'The bank-local audit field is mirrored, not replaced');
        System.assertEquals(Date.today(), writtenRow.LLC_BI__Evaluation_Date__c);
        System.assertEquals(UserInfo.getUserId(), writtenRow.LLC_BI__Evaluated_By__c);
        System.assertEquals(covA, writtenRow.LLC_BI__Covenant__c, 'The covenant lookup is set once at creation and is never rewritten');

        System.assertEquals('In Progress', [SELECT LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetB].LLC_BI__Status__c,
            'The refused covenant must be untouched, not half-written');
    }

    @IsTest
    static void allowNonPendingRecordsTheAssessmentAndSaysTheScheduleWillNotMove() {
        C360TestFixture.armCalloutMock();
        Id covB = covenant('ZZ-W2-COV-B').Id;
        Id targetB = complianceOf(covB);
        String key = C360Wave2Fixture.key('cov-allownp');

        StageCovenantReview.Request r = req(key, new List<StageCovenantReview.Assessment>{ assess(covB, 'Compliant') });
        r.allowNonPending = true;

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(true, staged.ok, 'stage should succeed, got ' + why(staged));
        System.assertEquals(1, staged.result.assessedCount);
        System.assertEquals(C360Covenants.STATE_PLANNED, find(staged.result, covB).state);
        Boolean saidSo = false;
        for (String w : staged.result.warnings) {
            saidSo = saidSo || w.contains('does NOT advance');
        }
        System.assertEquals(true, saidSo, 'An opt-in write onto a non-Pending row must say the schedule will not move');

        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);
        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.message));
        System.assertEquals('Compliant', [SELECT LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetB].LLC_BI__Status__c);
        System.assert(done.result.items[0].outcome.contains('did not advance'),
            'The outcome must say the schedule did not move: ' + done.result.items[0].outcome);
    }

    @IsTest
    static void waivedIsAFirstClassOutcome() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id targetA = complianceOf(covA);
        String key = C360Wave2Fixture.key('cov-waived');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Waived') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, staged.ok, 'Waived is one of nCino\'s three complete statuses, got ' + why(staged));
        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);
        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.message));
        System.assertEquals('Waived', [SELECT LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetA].LLC_BI__Status__c,
            'A banker who waives must be able to record it here rather than leaving the tool');
    }

    @IsTest
    static void anExceptionCarriesItsReasonAndIsNeverCalledABreachInProse() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id targetA = complianceOf(covA);
        String key = C360Wave2Fixture.key('cov-exception');

        StageCovenantReview.Assessment a = assess(covA, 'Exception');
        a.reasonForException = 'Overdue';

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ a })
        })[0];
        Test.stopTest();

        System.assertEquals(true, staged.ok, why(staged));
        System.assertEquals(false, staged.result.summary.contains('breach'),
            'nCino forces Exception on any overdue row, measured or not. No plan prose may call an Exception a breach: ' + staged.result.summary);

        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);
        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.message));

        LLC_BI__Covenant_Compliance2__c row = [
            SELECT LLC_BI__Status__c, LLC_BI__Reason_for_Exception__c, LLC_BI__Exception_Date__c
            FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetA
        ];
        System.assertEquals('Exception', row.LLC_BI__Status__c);
        System.assertEquals('Overdue', row.LLC_BI__Reason_for_Exception__c,
            'The caller\'s reason is honoured: an undelivered document is not a failed test');
        System.assertNotEquals(null, row.LLC_BI__Exception_Date__c);
    }

    @IsTest
    static void aCovenantWithNoComplianceRowIsReportedNotFixed() {
        C360TestFixture.armCalloutMock();
        Id covC = covenant('ZZ-W2-COV-C').Id;
        Integer before = [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c];

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-norow'), new List<StageCovenantReview.Assessment>{ assess(covC, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A plan that can write nothing is not staged');
        System.assert(res.error.message.contains('No compliance row exists'), 'The refusal must say why: ' + res.error.message);
        System.assertEquals(before, [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c],
            'Creating a compliance row is forbidden: a create is what raises the bank approval work item');
    }

    @IsTest
    static void theApprovalTrapWarningIsStructuralAndReadsTheCovenant() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        Test.startTest();
        StageCovenantReview.Response quiet = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-warn-quiet'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        // Give the covenant the exact configuration nCino's managed trigger needs to mint the next
        // compliance record: Active, a Frequency Template, and an Effective Date. The DML sits
        // outside the startTest window on purpose: the org's change-data triggers enqueue a
        // callout-making queueable per record, and jobs queued inside the window flush against
        // uncommitted DML.
        LLC_BI__Date_Template__c tmpl = new LLC_BI__Date_Template__c(
            Name = 'ZZ-W2-TEST One Time', LLC_BI__Template_Type__c = 'One-Time',
            LLC_BI__Status__c = 'Active', LLC_BI__Type__c = 'Covenants'
        );
        insert tmpl;
        update new LLC_BI__Covenant2__c(Id = covA, LLC_BI__Frequency_Template__c = tmpl.Id, LLC_BI__Effective_Date__c = Date.today().addDays(-90));

        StageCovenantReview.Response loud = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-warn-loud'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];

        System.assertEquals(true, quiet.ok, why(quiet));
        System.assertEquals(false, find(quiet.result, covA).generatesNextRow,
            'With no Frequency Template there is no configuration for nCino to mint a successor row from');
        System.assertEquals(true, String.join(quiet.result.warnings, ' ').contains('not expected to create a successor row'),
            'The quiet case still states the finding rather than staying silent');

        System.assertEquals(true, loud.ok, why(loud));
        System.assertEquals(true, find(loud.result, covA).generatesNextRow);
        String loudText = String.join(loud.result.warnings, ' ');
        System.assertEquals(true, loudText.contains('MAY MINT THE NEXT ONE'),
            'The approval trap is structural and must be warned before the banker confirms: ' + loudText);
        System.assertEquals(true, loudText.contains('ONE-TIME COVENANT'),
            'A One-Time template deactivates the covenant on a complete status, and that is not reversible here: ' + loudText);
    }

    @IsTest
    static void executeMeasuresGenerationInsteadOfAssertingIt() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        String key = C360Wave2Fixture.key('cov-generation');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, staged.ok, why(staged));
        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);

        System.assertEquals(true, done.ok, 'execute should succeed: ' + (done.error == null ? '' : done.error.message));
        System.assertNotEquals(null, done.result.approvalChainStarted,
            'The tool must ANSWER the approval-chain question, not skip it');
        Boolean reallyMinted = [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c WHERE LLC_BI__Covenant__c = :covA] > 1;
        System.assertEquals(reallyMinted, done.result.approvalChainStarted,
            'The reported answer must match the org, whichever way it went');
        System.assertEquals(reallyMinted, done.result.items[0].nextComplianceRowCreated);
    }

    @IsTest
    static void executeRefusesWhenTheRowIsNoLongerPending() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id targetA = complianceOf(covA);
        String key = C360Wave2Fixture.key('cov-moved');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        System.assertEquals(true, staged.ok, why(staged));
        Test.stopTest();

        // Org state moves between staging and execution: somebody else closed the row out.
        update new LLC_BI__Covenant_Compliance2__c(Id = targetA, LLC_BI__Status__c = 'Waived');

        ExecuteCovenantReview.Response done = executeStaged(key, staged.result);

        System.assertEquals(false, done.ok, 'A33.3.3: re-apply the precondition against re-read org state before any resumed write');
        System.assert(done.error.message.contains('Re-stage'), 'The refusal must say what to do: ' + done.error.message);
        System.assertEquals('Waived', [SELECT LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetA].LLC_BI__Status__c,
            'Nothing may be overwritten when the precondition fails');
    }

    @IsTest
    static void executeReplayReportsThePriorRunAndWritesNothing() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        String key = C360Wave2Fixture.key('cov-replay');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        System.assertEquals(true, staged.ok, why(staged));
        Test.stopTest();

        ExecuteCovenantReview.Response first = executeStaged(key, staged.result);
        System.assertEquals(true, first.ok, 'first execute should succeed');
        Integer rowsAfterFirst = [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c];

        ExecuteCovenantReview.Response again = executeStaged(key, staged.result);
        System.assertEquals(true, again.ok, 'A replay is a successful invocation, not a failure');
        System.assertEquals(true, again.result.replayed, 'The replay must declare itself');
        System.assertEquals(first.result.covenantComplianceId, again.result.covenantComplianceId);
        System.assertEquals(null, again.result.approvalChainStarted,
            'A replay observed nothing, so it must not restate the first run\'s generation answer as its own');
        System.assertEquals(rowsAfterFirst, [SELECT COUNT() FROM LLC_BI__Covenant_Compliance2__c], 'A replay writes nothing at all');
    }

    @IsTest
    static void executeRefusesMissingUsedAndMismatchedTokens() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id targetA = complianceOf(covA);
        String key = C360Wave2Fixture.key('cov-tokens');

        Test.startTest();
        StageCovenantReview.Response staged = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(key, new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        System.assertEquals(true, staged.ok, why(staged));
        Test.stopTest();

        ExecuteCovenantReview.Request noToken = new ExecuteCovenantReview.Request();
        noToken.idempotencyKey = key;
        noToken.stagingId = staged.result.stagingId;
        noToken.planHash = staged.result.planHash;
        noToken.decisionToken = null;
        noToken.approverUserId = UserInfo.getUserId();
        ExecuteCovenantReview.Response a1 = ExecuteCovenantReview.run(new List<ExecuteCovenantReview.Request>{ noToken })[0];

        ExecuteCovenantReview.Request badHash = new ExecuteCovenantReview.Request();
        badHash.idempotencyKey = key;
        badHash.stagingId = staged.result.stagingId;
        badHash.planHash = 'deadbeef' + staged.result.planHash.substring(8);
        badHash.decisionToken = staged.result.decisionToken;
        badHash.approverUserId = UserInfo.getUserId();
        ExecuteCovenantReview.Response a2 = ExecuteCovenantReview.run(new List<ExecuteCovenantReview.Request>{ badHash })[0];

        ExecuteCovenantReview.Request wrongApprover = new ExecuteCovenantReview.Request();
        wrongApprover.idempotencyKey = key;
        wrongApprover.stagingId = staged.result.stagingId;
        wrongApprover.planHash = staged.result.planHash;
        wrongApprover.decisionToken = staged.result.decisionToken;
        wrongApprover.approverUserId = null;
        ExecuteCovenantReview.Response a3 = ExecuteCovenantReview.run(new List<ExecuteCovenantReview.Request>{ wrongApprover })[0];

        System.assertEquals(false, a1.ok, 'A missing token is refused');
        System.assertEquals('TOKEN_REFUSED', a1.error.code);
        System.assertEquals(false, a2.ok, 'A stale plan hash is refused');
        System.assertEquals('TOKEN_REFUSED', a2.error.code);
        System.assertEquals(false, a3.ok, 'An execute with no named approver is refused');
        System.assertEquals('TOKEN_REFUSED', a3.error.code);
        System.assertEquals('Pending', [SELECT LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetA].LLC_BI__Status__c,
            'Nothing may be written on a refused execute');
    }

    @IsTest
    static void aStatusOutsideTheCompleteSetIsRefused() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        Test.startTest();
        List<StageCovenantReview.Response> out = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-badstatus'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Pending') }),
            req(C360Wave2Fixture.key('cov-badreason'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Exception') })
        });
        Test.stopTest();

        System.assertEquals(false, out[0].ok, 'Pending is where a row starts, never where a review leaves it');
        System.assert(out[0].error.message.contains('Compliant, Waived or Exception'),
            'The refusal should name what is allowed: ' + out[0].error.message);
        System.assertEquals(true, out[1].ok, 'Exception with the default reason is fine, got ' + why(out[1]));
    }

    @IsTest
    static void aCovenantOutsideThePackageIsRefused() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Covenant2__c stranger = new LLC_BI__Covenant2__c(LLC_BI__Active__c = true, LLC_BI__Is_Template__c = false);
        insert stranger;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-stranger'), new List<StageCovenantReview.Assessment>{ assess(stranger.Id, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'The plan is package-anchored: a covenant reaching it through neither junction is refused');
        System.assert(res.error.message.contains('not in scope'), 'The refusal should say why: ' + res.error.message);
    }

    @IsTest
    static void theAssessmentCapIsTwentyAndItSaysWhy() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        List<StageCovenantReview.Assessment> tooMany = new List<StageCovenantReview.Assessment>();
        for (Integer i = 0; i < 21; i++) {
            tooMany.add(assess(covA, 'Compliant'));
        }

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-cap'), tooMany)
        })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, '21 assessments is over the cap');
        System.assert(res.error.message.contains('the cap is 20'), 'The refusal must name the cap: ' + res.error.message);
        System.assert(res.error.message.contains('queueable'), 'The refusal must name the governor reason: ' + res.error.message);
    }

    @IsTest
    static void oneCovenantMayNotBeAssessedTwiceInOnePlan() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-dupe'), new List<StageCovenantReview.Assessment>{
                assess(covA, 'Compliant'), assess(covA, 'Exception')
            })
        })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'Two verdicts on one covenant would race each other onto the same compliance row');
        System.assert(res.error.message.contains('more than once'), 'The refusal should say why: ' + res.error.message);
    }

    @IsTest
    static void stageRefusesIncompleteRequests() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        List<StageCovenantReview.Assessment> one = new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') };

        StageCovenantReview.Request noPackage = req(C360Wave2Fixture.key('cov-b1'), one);
        noPackage.productPackageId = null;
        StageCovenantReview.Request noRationale = req(C360Wave2Fixture.key('cov-b2'), one);
        noRationale.rationale = null;
        StageCovenantReview.Request noAssessments = req(C360Wave2Fixture.key('cov-b3'), null);

        Test.startTest();
        List<StageCovenantReview.Response> out = StageCovenantReview.stage(
            new List<StageCovenantReview.Request>{ noPackage, noRationale, noAssessments });
        Test.stopTest();

        for (Integer i = 0; i < 3; i++) {
            System.assertEquals(false, out[i].ok, 'Element ' + i + ' is missing a required input');
            System.assertEquals('VALIDATION_FAILED', out[i].error.code);
        }
    }

    @IsTest
    static void executeRefusesIncompleteRequests() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        List<ExecuteCovenantReview.Request> bad = new List<ExecuteCovenantReview.Request>();
        for (Integer i = 0; i < 3; i++) {
            ExecuteCovenantReview.Request r = new ExecuteCovenantReview.Request();
            r.idempotencyKey = i == 0 ? null : 'k';
            r.stagingId = i == 1 ? null : '000000000000000AAA';
            r.planHash = i == 2 ? null : 'h';
            r.decisionToken = 't';
            r.approverUserId = UserInfo.getUserId();
            bad.add(r);
        }
        List<ExecuteCovenantReview.Response> out = ExecuteCovenantReview.run(bad);
        Test.stopTest();

        for (Integer i = 0; i < 3; i++) {
            System.assertEquals(false, out[i].ok, 'Element ' + i + ' is missing a required input and must be refused');
            System.assertEquals('VALIDATION_FAILED', out[i].error.code);
        }
    }

    // -------------------------------------------------------------------------------------------
    // Backlog row 49: the account is the anchor and a package is an association.
    // -------------------------------------------------------------------------------------------

    /** The same request, anchored on the relationship rather than on the deal. */
    private static StageCovenantReview.Request accountReq(String key, List<StageCovenantReview.Assessment> assessments) {
        StageCovenantReview.Request r = new StageCovenantReview.Request();
        r.idempotencyKey = key;
        r.accountId = C360Wave2Fixture.existingAccount().Id;
        r.rationale = 'Quarterly covenant test across the relationship.';
        r.assessments = assessments;
        return r;
    }

    @IsTest
    static void theRelationshipIsTheAnchorAndNeedsNoPackage() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            accountReq(C360Wave2Fixture.key('cov-acct'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'A covenant review needs no deal to exist, got ' + why(res));
        System.assertEquals(3, res.result.scopeCount,
            'Every covenant on the relationship is in scope: two through the account junction, one through a facility.');
        System.assertEquals(String.valueOf(C360Wave2Fixture.existingAccount().Id), res.result.accountId,
            'The staging row anchors on the relationship.');
        System.assertEquals(null, res.result.productPackageId,
            'Covenant A is tied to no facility, so this plan touches no package and there is no deal to deep-link to.');

        cm_Action_Staging__c row = [
            SELECT cm_Account__c, cm_Product_Package__c FROM cm_Action_Staging__c WHERE Id = :res.result.stagingId
        ];
        System.assertEquals(C360Wave2Fixture.existingAccount().Id, row.cm_Account__c);
        System.assertEquals(null, row.cm_Product_Package__c,
            'A package on the trail row would claim a narrowing nobody chose.');
    }

    @IsTest
    static void everyCovenantCarriesTheFacilitiesAndPackagesItIsTiedTo() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Id covB = covenant('ZZ-W2-COV-B').Id;
        LLC_BI__Loan__c fixtureLoan = C360Wave2Fixture.existingLoan();
        LLC_BI__Product_Package__c pkg = C360Wave2Fixture.existingPackage();

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            accountReq(C360Wave2Fixture.key('cov-assoc'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok, 'stage should succeed, got ' + why(res));

        StageCovenantReview.PlannedCovenant a = find(res.result, covA);
        System.assertEquals('[]', a.associations,
            'A relationship-level covenant with no facility junction carries an EMPTY association list. ' +
            'That is a real answer about the covenant, not a gap: ' + a.associations);

        StageCovenantReview.PlannedCovenant b = find(res.result, covB);
        System.assert(b.associations.contains(String.valueOf(fixtureLoan.Id)),
            'A loan-level covenant names the facility it is tied to: ' + b.associations);
        System.assert(b.associations.contains(String.valueOf(pkg.Id)),
            'And the package that facility sits on: ' + b.associations);
        System.assert(b.associations.contains(pkg.Name),
            'By name, because the row is read by a banker: ' + b.associations);
        System.assertEquals(C360Covenants.STATE_NOT_ASSESSED, b.state,
            'Covenant B is surveyed and reported, not written: the association is shown, never used to filter it out.');
    }

    @IsTest
    static void thePackageOnlyCallStillWorksAndDerivesTheBorrower() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{
            req(C360Wave2Fixture.key('cov-pkgonly'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') })
        })[0];
        Test.stopTest();

        System.assertEquals(true, res.ok,
            'The deployed cockpit sends the package alone, and breaking that would break the room: ' + why(res));
        System.assertEquals(String.valueOf(C360Wave2Fixture.existingAccount().Id), res.result.accountId,
            'The borrower is derived from the package, so the plan still anchors on the relationship.');
    }

    @IsTest
    static void aPackageOnAnotherRelationshipNarrowsNothingAndIsRefused() {
        C360TestFixture.armCalloutMock();
        Id covA = covenant('ZZ-W2-COV-A').Id;
        Account other = new Account(Name = 'ZZ-W2-TEST Other Borrower');
        insert other;
        LLC_BI__Product_Package__c theirs = C360Wave2Fixture.productPackage(other.Id);

        StageCovenantReview.Request r =
            accountReq(C360Wave2Fixture.key('cov-foreignpkg'), new List<StageCovenantReview.Assessment>{ assess(covA, 'Compliant') });
        r.productPackageId = theirs.Id;

        Test.startTest();
        StageCovenantReview.Response res = StageCovenantReview.stage(new List<StageCovenantReview.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A package on another relationship narrows nothing.');
        System.assertEquals('VALIDATION_FAILED', res.error.code);
        System.assert(res.error.message.contains('belongs to relationship'),
            'The refusal says which relationship the package actually sits on: ' + res.error.message);
    }
}
