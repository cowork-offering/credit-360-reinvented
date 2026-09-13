/**
 * StageExecuteDiscardVersionTest - the version discard, tested by building a real version and
 * taking it away.
 *
 * THE FIXTURE IS THE POINT. Everything here hangs off one `@TestSetup` that reproduces the shape
 * `ExecuteLoanModification` leaves behind in the org: a booked parent filed AT Booked with a core
 * lookup key (LV06 keys on PRIORVALUE, which is blank on an insert, so this is legal and is the
 * shape proved live on 2026-08-20), a version package, a clone at Qualification carrying
 * `Is_Modification` with the `_M1` key, BOTH `LLC_BI__LoanRenewal__c` rows (revision 0 self anchor,
 * revision 1 pointing at the clone), a pledge on the clone with its own aggregate shell, a covenant
 * junction on the clone, a pricing stream, a fee, an involvement, and a `cm_Action_Staging__c` row
 * anchored on the version. A Loan insert wakes five managed namespaces and 21 validation rules, so
 * the whole fixture is built ONCE (lesson 7) and the methods read it back through relationships
 * rather than by name (lesson 16b: the org rewrites Loan and Package names on save).
 *
 * WHAT THIS SUITE CANNOT REACH, stated rather than papered over (lesson 16c):
 *   - `LLC_BI__LLC_LoanDocument__c.LLC_BI__Has_File__c` is a FORMULA over the document store index
 *     and is not createable, so the "a document with content refuses the discard" branch cannot be
 *     exercised by a unit test. The refusal is covered here through the review arm of the same
 *     check, which reaches the identical HAS_FOREIGN_CHILDREN throw, and the document arm is a
 *     live-probe item.
 *   - The Opportunity History rows nCino mints on a real facility insert do not exist in a test
 *     transaction, so the "the org kept a restricted child and the chain stopped" path is exercised
 *     here by a fabricated survivor rather than by the org's own automation.
 */
@IsTest
private class StageExecuteDiscardVersionTest {

    private static final String BORROWER = 'ZZ-DISCARD-TEST Borrower';
    private static final String PARENT_KEY = 'ZZDISCARDP1';
    private static final String CLONE_KEY = 'ZZDISCARDP1_M1';

    // -------------------------------------------------------------------------------------------
    // Fixture.
    // -------------------------------------------------------------------------------------------

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();
        Account a = new Account(Name = BORROWER);
        insert a;

        LLC_BI__Product_Package__c booked = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Booked Package',
            LLC_BI__Account__c = a.Id
        );
        LLC_BI__Product_Package__c version = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Version Package',
            LLC_BI__Account__c = a.Id
        );
        insert new List<LLC_BI__Product_Package__c>{ booked, version };

        LLC_BI__Loan__c parent = new LLC_BI__Loan__c(
            LLC_BI__Account__c = a.Id,
            LLC_BI__Product_Package__c = booked.Id,
            LLC_BI__Stage__c = 'Booked',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = PARENT_KEY,
            LLC_BI__Amount__c = 1000000,
            LLC_BI__Principal_Balance__c = 500000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = false
        );
        LLC_BI__Loan__c clone = new LLC_BI__Loan__c(
            LLC_BI__Account__c = a.Id,
            LLC_BI__Product_Package__c = version.Id,
            LLC_BI__Stage__c = 'Qualification',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = CLONE_KEY,
            LLC_BI__Amount__c = 1200000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = true
        );
        insert new List<LLC_BI__Loan__c>{ parent, clone };

        // The chain nCino writes: revision 0 anchors the parent to itself, revision 1 points at the
        // clone. The revision-1 row is the one that feeds the renewals rollup behind hasRenewal.
        //
        // PreviousVersionStage and PreviousVersionStatus are HARD REQUIRED on this object and were
        // not in the class's first fixture, which cost a validation round. Every one of the org's
        // 45 live chain rows carries 'Booked' and 'Open', which is what the parent was before the
        // fork, so that is what a faithful fixture carries.
        insert new List<LLC_BI__LoanRenewal__c>{
            new LLC_BI__LoanRenewal__c(
                LLC_BI__ParentLoanId__c = parent.Id,
                LLC_BI__RenewalLoanId__c = parent.Id,
                LLC_BI__RevisionNumber__c = 0,
                LLC_BI__RevisionStatus__c = 'Available',
                LLC_BI__PreviousVersionStage__c = 'Booked',
                LLC_BI__PreviousVersionStatus__c = 'Open',
                LLC_BI__Original_Product_Package__c = booked.Id
            ),
            new LLC_BI__LoanRenewal__c(
                LLC_BI__ParentLoanId__c = parent.Id,
                LLC_BI__RenewalLoanId__c = clone.Id,
                LLC_BI__RevisionNumber__c = 1,
                LLC_BI__RevisionStatus__c = 'In Progress',
                LLC_BI__PreviousVersionStage__c = 'Booked',
                LLC_BI__PreviousVersionStatus__c = 'Open',
                LLC_BI__Original_Product_Package__c = booked.Id
            )
        };

        // The collateral chain. The type needs an advance rate before a collateral may exist
        // (Advance_Rate_should_not_be_null), and a pledge needs three parents including its own
        // aggregate shell (lesson 15ac).
        LLC_BI__Collateral_Type__c colType = new LLC_BI__Collateral_Type__c(
            Name = 'ZZ-DISCARD-TEST Equipment',
            LLC_BI__Advance_Rate__c = 80
        );
        insert colType;
        LLC_BI__Collateral__c asset = new LLC_BI__Collateral__c(
            LLC_BI__Collateral_Type__c = colType.Id,
            LLC_BI__Description__c = 'ZZ-DISCARD-TEST equipment'
        );
        insert asset;
        LLC_BI__Loan_Collateral_Aggregate__c agg = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Clone Aggregate'
        );
        insert agg;
        insert new LLC_BI__Loan_Collateral2__c(
            LLC_BI__Loan__c = clone.Id,
            LLC_BI__Collateral__c = asset.Id,
            LLC_BI__Loan_Collateral_Aggregate__c = agg.Id,
            LLC_BI__Lien_Position__c = '1st',
            LLC_BI__Is_Primary__c = true,
            LLC_BI__Amount_Pledged__c = 400000
        );

        LLC_BI__Covenant2__c cov = new LLC_BI__Covenant2__c(LLC_BI__Account__c = a.Id);
        insert cov;
        insert new LLC_BI__Loan_Covenant__c(LLC_BI__Loan__c = clone.Id, LLC_BI__Covenant2__c = cov.Id);
        insert new LLC_BI__Account_Covenant__c(LLC_BI__Covenant2__c = cov.Id, LLC_BI__Account__c = a.Id);

        insert new LLC_BI__Pricing_Stream__c(
            Name = 'ZZ-DISCARD-TEST Stream',
            LLC_BI__Loan__c = clone.Id,
            LLC_BI__Context_Id__c = String.valueOf(clone.Id),
            LLC_BI__Is_Rate_Stream__c = true
        );
        insert new LLC_BI__Fee__c(
            LLC_BI__Loan__c = clone.Id,
            LLC_BI__Record_Type__c = 'Fees',
            LLC_BI__Fee_Type__c = 'Attorney',
            LLC_BI__Calculation_Type__c = 'Flat Amount',
            LLC_BI__Amount__c = 15000,
            LLC_BI__Status__c = 'Active'
        );
        insert new LLC_BI__Legal_Entities__c(
            LLC_BI__Loan__c = clone.Id,
            LLC_BI__Product_Package__c = version.Id,
            LLC_BI__Account__c = a.Id,
            LLC_BI__Borrower_Type__c = 'Borrower',
            LLC_BI__Ownership__c = 100
        );

        // The trail row the discard must KEEP. It is a prior action on the version, not this one.
        insert new cm_Action_Staging__c(
            cm_Action_Id__c = 'loan-modification',
            cm_Idempotency_Key__c = 'ZZ-DISCARD-TEST-prior-trail',
            cm_Plan_Hash__c = 'deadbeef',
            cm_Plan_JSON__c = '{}',
            cm_Status__c = 'Completed',
            cm_Account__c = a.Id,
            cm_Product_Package__c = version.Id
        );
    }

    // -------------------------------------------------------------------------------------------
    // Fixture readers. Through relationships, never through Name (lesson 16b).
    // -------------------------------------------------------------------------------------------

    private static Account borrower() {
        return [SELECT Id, Name FROM Account WHERE Name = :BORROWER LIMIT 1];
    }

    private static LLC_BI__Loan__c parentLoan() {
        return [
            SELECT Id, Name, LLC_BI__Product_Package__c, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Account__c = :borrower().Id AND LLC_BI__lookupKey__c = :PARENT_KEY
            LIMIT 1
        ];
    }

    private static LLC_BI__Loan__c cloneLoan() {
        return [
            SELECT Id, Name, LLC_BI__Product_Package__c, LLC_BI__Stage__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Account__c = :borrower().Id AND LLC_BI__lookupKey__c = :CLONE_KEY
            LIMIT 1
        ];
    }

    private static Id versionPackageId() {
        return cloneLoan().LLC_BI__Product_Package__c;
    }

    private static Id bookedPackageId() {
        return parentLoan().LLC_BI__Product_Package__c;
    }

    private static String key(String label) {
        return 'ZZ-DISCARD-' + label + '-' + String.valueOf(Crypto.getRandomLong());
    }

    private static StageDiscardVersion.Request stageReq(String k, Id versionId) {
        StageDiscardVersion.Request r = new StageDiscardVersion.Request();
        r.idempotencyKey = k;
        r.rationale = 'The banker changed their mind about this modification.';
        r.versionPackageId = String.valueOf(versionId);
        return r;
    }

    private static StageDiscardVersion.Response stage(String k, Id versionId) {
        return StageDiscardVersion.stage(new List<StageDiscardVersion.Request>{ stageReq(k, versionId) })[0];
    }

    private static ExecuteDiscardVersion.Response executeOf(String k, StageDiscardVersion.StageResult s) {
        ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
        r.idempotencyKey = k;
        r.stagingId = s.stagingId;
        r.planHash = s.planHash;
        r.decisionToken = s.decisionToken;
        r.approverUserId = UserInfo.getUserId();
        return ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0];
    }

    private static String why(StageDiscardVersion.Response res) {
        return res.error == null ? '(no error)' : res.error.code + ': ' + res.error.message;
    }

    private static String whyExec(ExecuteDiscardVersion.Response res) {
        return res.error == null ? '(no error)' : res.error.code + ': ' + res.error.message +
            ' | org: ' + String.valueOf(res.error.orgError);
    }

    // -------------------------------------------------------------------------------------------
    // The gate.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void theBookedSourcePackageIsNotAVersion() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        StageDiscardVersion.Response res = stage(key('notversion'), bookedPackageId());
        Test.stopTest();

        System.assertEquals(false, res.ok, 'The booked source package must never be discardable.');
        System.assertEquals('PACKAGE_BOOKED', res.error.code, 'Refusal code was ' + why(res));
        System.assert(
            res.error.message.contains('Booked'),
            'The refusal names the facility stage that decided it: ' + res.error.message
        );
    }

    @IsTest
    static void aPlainPackageWithNoChainAndNoCockpitStageIsRefused() {
        C360TestFixture.armCalloutMock();
        Account a = borrower();
        LLC_BI__Product_Package__c plain = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Plain Package',
            LLC_BI__Account__c = a.Id,
            LLC_BI__Stage__c = 'Underwriting'
        );
        insert plain;

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('plain'), plain.Id);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A package that is not a version is not a thing this tool deletes.');
        System.assertEquals('NOT_A_VERSION', res.error.code, 'Refusal code was ' + why(res));
    }

    @IsTest
    static void aVersionAtApprovalIsRefused() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Loan__c c = cloneLoan();
        update new LLC_BI__Loan__c(Id = c.Id, LLC_BI__Stage__c = 'Approval / Loan Committee');

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('approval'), versionPackageId());
        Test.stopTest();

        System.assertEquals(false, res.ok, 'From Approval / Loan Committee the org owns the version.');
        System.assertEquals('VERSION_IN_APPROVAL', res.error.code, 'Refusal code was ' + why(res));
        System.assert(
            res.error.message.contains('Approval / Loan Committee'),
            'The refusal quotes the org\'s own rung name: ' + res.error.message
        );
    }

    @IsTest
    static void aMemberPastApprovalIsRefusedToo() {
        C360TestFixture.armCalloutMock();
        // Loan_Validation_06 keys on PRIORVALUE, so a post-approval stage cannot be reached by an
        // UPDATE but CAN be filed on an INSERT (lesson 15y). A second member arriving at Doc Prep is
        // therefore the only honest way to test a version past the approval rung, and it is a
        // realistic one: the org moved that facility, not us.
        insert new LLC_BI__Loan__c(
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Product_Package__c = versionPackageId(),
            LLC_BI__Stage__c = 'Doc Prep',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = 'ZZDISCARDP2_M1',
            LLC_BI__Amount__c = 300000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = true
        );

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('docprep'), versionPackageId());
        Test.stopTest();

        System.assertEquals(false, res.ok, 'Doc Prep is past approval and is refused for the same reason.');
        System.assertEquals('VERSION_IN_APPROVAL', res.error.code, 'Refusal code was ' + why(res));
        System.assert(res.error.message.contains('Doc Prep'), 'The refusal names the stage: ' + res.error.message);
    }

    @IsTest
    static void aVersionCarryingAReviewIsRefused() {
        C360TestFixture.armCalloutMock();
        insert new LLC_BI__Review__c(
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Product_Package__c = versionPackageId(),
            LLC_BI__Status__c = 'In Progress',
            LLC_BI__Review_Type__c = 'Annual Review'
        );

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('review'), versionPackageId());
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A review is something the cockpit did not create. It refuses.');
        System.assertEquals('HAS_FOREIGN_CHILDREN', res.error.code, 'Refusal code was ' + why(res));
        System.assert(
            res.error.message.contains('review'),
            'The refusal names what is in the way so the banker can go and withdraw it: ' + res.error.message
        );
    }

    // -------------------------------------------------------------------------------------------
    // The inventory.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void stageInventoriesEveryPartOfTheVersionAndWritesNoDomainRecord() {
        C360TestFixture.armCalloutMock();
        Integer loansBefore = [SELECT COUNT() FROM LLC_BI__Loan__c];
        Integer pledgesBefore = [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c];
        Integer chainBefore = [SELECT COUNT() FROM LLC_BI__LoanRenewal__c];

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('inventory'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));

        System.assertEquals(loansBefore, [SELECT COUNT() FROM LLC_BI__Loan__c], 'A33.0.1: stage deletes no facility.');
        System.assertEquals(pledgesBefore, [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c], 'A33.0.1: stage deletes no pledge.');
        System.assertEquals(chainBefore, [SELECT COUNT() FROM LLC_BI__LoanRenewal__c], 'A33.0.1: stage deletes no chain row.');

        Map<String, Integer> byObject = new Map<String, Integer>();
        for (StageDiscardVersion.InventoryItem i : res.result.items) {
            Integer n = byObject.containsKey(i.objectName) ? byObject.get(i.objectName) : 0;
            byObject.put(i.objectName, n + 1);
            System.assert(String.isNotBlank(i.reason), 'Every item carries the reason it goes: ' + i.objectName + ' ' + i.recordId);
            System.assert(String.isNotBlank(i.name), 'Every item carries a name a banker can read: ' + i.objectName + ' ' + i.recordId);
        }

        System.assertEquals(2, byObject.get('LLC_BI__LoanRenewal__c'), 'Both chain rows are on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Loan_Collateral2__c'), 'The copied pledge is on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Loan_Covenant__c'), 'The covenant junction is on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Pricing_Stream__c'), 'The cloned pricing stream is on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Fee__c'), 'The fee is on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Legal_Entities__c'), 'The involvement is on the list: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Loan__c'), 'The clone is on the list, and only the clone: ' + byObject);
        System.assertEquals(1, byObject.get('LLC_BI__Product_Package__c'), 'The version package is on the list: ' + byObject);

        System.assertEquals(
            null, byObject.get('LLC_BI__Collateral__c'),
            'The ASSET is never on the delete list. Only the pledge that points at it goes.'
        );
        System.assertEquals(
            null, byObject.get('LLC_BI__Covenant2__c'),
            'The COVENANT is never on the delete list. Only the junction goes.'
        );
        System.assertEquals(
            null, byObject.get('LLC_BI__Account_Covenant__c'),
            'The relationship covenant junction belongs to the borrower and is never on the delete list.'
        );
        System.assertEquals(
            null, byObject.get('cm_Action_Staging__c'),
            'The trail is marked, never deleted, so it is not an item on the delete list.'
        );

        System.assertEquals(
            String.valueOf(bookedPackageId()), res.result.sourcePackageId,
            'The source package is derived from the chain, so the audit row lands where the banker will look.'
        );
        System.assert(res.result.summary.contains('Nothing booked is touched'), 'The summary says what stays: ' + res.result.summary);
        System.assertNotEquals(null, res.result.decisionToken, 'A stage mints a single-use token.');
    }

    @IsTest
    static void theStagedTrailRowIsKeptAndIsNotThisActionsOwnRow() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        StageDiscardVersion.Response res = stage(key('trail'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));
        Boolean saysKept = false;
        for (String w : res.result.warnings) {
            if (w.contains('trail row') && w.contains('Withdrawn')) {
                saysKept = true;
            }
        }
        System.assertEquals(true, saysKept, 'The banker is told the trail is kept: ' + res.result.warnings);

        List<cm_Action_Staging__c> own = [
            SELECT Id, cm_Action_Id__c, cm_Product_Package__c FROM cm_Action_Staging__c WHERE cm_Action_Id__c = 'discard-version'
        ];
        System.assertEquals(1, own.size(), 'The discard staged exactly one row of its own.');
        System.assertEquals(
            bookedPackageId(), own[0].cm_Product_Package__c,
            'The discard\'s own trail row anchors on the SOURCE package, because the version is about to stop resolving.'
        );
    }

    // -------------------------------------------------------------------------------------------
    // The execute.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void executeDeletesTheWholeVersionInOrderAndLeavesTheBookedSideAlone() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id cloneId = cloneLoan().Id;
        Id parentId = parentLoan().Id;
        Id bookedId = bookedPackageId();
        Id assetId = [SELECT Id FROM LLC_BI__Collateral__c LIMIT 1].Id;
        Id covenantId = [SELECT Id FROM LLC_BI__Covenant2__c LIMIT 1].Id;
        String k = key('execute');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));

        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'The version package is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :cloneId], 'The clone is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c = :parentId], 'Both chain rows are gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :cloneId], 'The pledge is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :cloneId], 'The covenant junction is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Pricing_Stream__c WHERE LLC_BI__Loan__c = :cloneId], 'The pricing stream is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :cloneId], 'The fee is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Product_Package__c = :versionId], 'The involvement is gone.');

        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :bookedId], 'The BOOKED package is untouched.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :parentId], 'The BOOKED parent is untouched.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Collateral__c WHERE Id = :assetId], 'The asset survives its pledge.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Covenant2__c WHERE Id = :covenantId], 'The covenant survives its junction.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Account_Covenant__c WHERE LLC_BI__Covenant2__c = :covenantId], 'The relationship covenant junction survives.');

        LLC_BI__Loan__c after = [
            SELECT Id, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c FROM LLC_BI__Loan__c WHERE Id = :parentId
        ];
        System.assertEquals(
            false, after.LLC_BI__hasRenewal__c,
            'The parent must read hasRenewal false, or every later credit action on it is refused. Renewals rollup: ' +
            String.valueOf(after.LLC_BI__Number_Of_Renewals__c)
        );

        System.assertEquals(String.valueOf(bookedId), res.result.sourcePackageId, 'The result names the package the relationship returns to.');
        System.assertEquals(0, res.result.remainingCount, 'Nothing was left behind: ' + res.result.outcome);
        System.assert(res.result.deletedCount >= 8, 'Every group deleted something: ' + res.result.deletedCount);
    }

    @IsTest
    static void everyStepIsSettledAndTheTrailStepTellsTheTruthAboutThePicklist() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id trailId = [SELECT Id FROM cm_Action_Staging__c WHERE cm_Action_Id__c = 'loan-modification' LIMIT 1].Id;
        String k = key('steps');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));

        Map<String, ExecuteDiscardVersion.StepResult> steps = new Map<String, ExecuteDiscardVersion.StepResult>();
        for (ExecuteDiscardVersion.StepResult s : res.result.steps) {
            steps.put(s.id, s);
        }
        for (String required : new List<String>{
            'delete_chain', 'delete_pledges', 'delete_covenant_junctions', 'delete_pricing_streams',
            'delete_fees', 'delete_involvements', 'delete_members', 'delete_package',
            'verify_parents', 'verify_version_gone', 'withdraw_trail'
        }) {
            System.assertNotEquals(null, steps.get(required), 'The plan carries the step ' + required);
        }
        for (String verified : new List<String>{
            'delete_chain', 'delete_pledges', 'delete_members', 'delete_package', 'verify_parents', 'verify_version_gone'
        }) {
            System.assertEquals(
                C360Plan.STATE_VERIFIED, steps.get(verified).state,
                'Step ' + verified + ' must be proven by re-query, not assumed: ' + steps.get(verified).detail
            );
        }

        // The trail is kept either way. Whether it can be STAMPED depends on the org's picklist, and
        // the step reports which of those two worlds it is in rather than pretending.
        Boolean offered = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c').contains(StageDiscardVersion.WITHDRAWN);
        cm_Action_Staging__c trail = [SELECT Id, cm_Status__c FROM cm_Action_Staging__c WHERE Id = :trailId];
        System.assertNotEquals(null, trail, 'The trail row is KEPT. It is the audit.');
        if (offered) {
            System.assertEquals(C360Plan.STATE_VERIFIED, steps.get('withdraw_trail').state, steps.get('withdraw_trail').detail);
            System.assertEquals(StageDiscardVersion.WITHDRAWN, trail.cm_Status__c, 'The kept row is marked Withdrawn.');
            System.assertEquals(C360Plan.TERMINAL_SUCCESS, res.result.terminalState, 'Every step settled.');
        } else {
            System.assertEquals(
                C360Plan.STATE_SKIPPED, steps.get('withdraw_trail').state,
                'With no Withdrawn value the step is not attempted, and it says so: ' + steps.get('withdraw_trail').detail
            );
            System.assert(
                steps.get('withdraw_trail').detail.contains(StageDiscardVersion.WITHDRAWN),
                'The detail names the missing picklist value: ' + steps.get('withdraw_trail').detail
            );
            System.assertEquals('Completed', trail.cm_Status__c, 'The row is left exactly as it stood, not restamped.');
            System.assertEquals(
                C360Plan.TERMINAL_PARTIAL, res.result.terminalState,
                'A step that could not run makes the run partial. That is the honest state, not a failure to hide.'
            );
        }
    }

    @IsTest
    static void aReplayUnderTheSameKeyDeletesNothingASecondTime() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Integer loansBefore = [SELECT COUNT() FROM LLC_BI__Loan__c];
        String k = key('replay');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        ExecuteDiscardVersion.Response first = executeOf(k, staged.result);
        System.assertEquals(true, first.ok, 'The first execute should succeed. ' + whyExec(first));
        Integer loansAfterFirst = [SELECT COUNT() FROM LLC_BI__Loan__c];

        ExecuteDiscardVersion.Response second = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, second.ok, 'A replay is an answer, not an error. ' + whyExec(second));
        System.assertEquals(true, second.result.replayed, 'The second call reports itself as a replay.');
        System.assertEquals(0, second.result.deletedCount, 'A replay deletes nothing.');
        System.assertEquals(
            loansAfterFirst, [SELECT COUNT() FROM LLC_BI__Loan__c],
            'The second call left the facility count exactly where the first one put it.'
        );
        System.assertEquals(loansBefore - 1, loansAfterFirst, 'Exactly one facility, the clone, was ever deleted.');
        System.assert(
            second.result.outcome.contains('already discarded'),
            'The replay says plainly that this key has had its run: ' + second.result.outcome
        );
    }

    @IsTest
    static void executeRefusesAChildThatArrivedAfterTheBankerConfirmed() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id cloneId = cloneLoan().Id;
        String k = key('drift');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        LLC_BI__Covenant2__c late = new LLC_BI__Covenant2__c(LLC_BI__Account__c = borrower().Id);
        insert late;
        insert new LLC_BI__Loan_Covenant__c(LLC_BI__Loan__c = cloneId, LLC_BI__Covenant2__c = late.Id);

        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A version that grew a child since the confirm gate is refused.');
        System.assertEquals('VALIDATION_FAILED', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assert(
            res.error.message.contains('changed since it was staged'),
            'The refusal says what changed: ' + res.error.message
        );
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :cloneId], 'Nothing was deleted.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void executeRefusesAForeignTokenAndDeletesNothing() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('token');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
        r.idempotencyKey = k;
        r.stagingId = staged.result.stagingId;
        r.planHash = staged.result.planHash;
        r.decisionToken = 'not-the-token-that-was-minted';
        r.approverUserId = UserInfo.getUserId();
        ExecuteDiscardVersion.Response res = ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A token that does not match the plan is refused.');
        System.assertEquals('TOKEN_REFUSED', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void executeRefusesAPlanHashThatNoLongerMatches() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('hash');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
        r.idempotencyKey = k;
        r.stagingId = staged.result.stagingId;
        r.planHash = 'a-hash-the-banker-never-saw';
        r.decisionToken = staged.result.decisionToken;
        r.approverUserId = UserInfo.getUserId();
        ExecuteDiscardVersion.Response res = ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A plan is never executed against figures the banker did not see.');
        System.assertEquals('TOKEN_REFUSED', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void executeReRunsTheGateSoAVersionThatClimbedToApprovalIsRefused() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id cloneId = cloneLoan().Id;
        String k = key('climbed');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        update new LLC_BI__Loan__c(Id = cloneId, LLC_BI__Stage__c = 'Approval / Loan Committee');

        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'The gate is re-read at execute, not replayed from the plan.');
        System.assertEquals('VERSION_IN_APPROVAL', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :cloneId], 'Nothing was deleted.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void theApproverMustBeTheRunningIdentity() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('approver');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
        r.idempotencyKey = k;
        r.stagingId = staged.result.stagingId;
        r.planHash = staged.result.planHash;
        r.decisionToken = staged.result.decisionToken;
        r.approverUserId = String.valueOf(C360Wave2Fixture.fakeId(User.SObjectType));
        ExecuteDiscardVersion.Response res = ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0];
        Test.stopTest();

        System.assertEquals(false, res.ok, 'The token binds a named human and this server runs as-user.');
        System.assertEquals('TOKEN_REFUSED', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    // -------------------------------------------------------------------------------------------
    // Input handling.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void theRequiredInputsAreEnforcedInApex() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        StageDiscardVersion.Request noPackage = stageReq(key('nopkg'), versionPackageId());
        noPackage.versionPackageId = null;
        StageDiscardVersion.Response a = StageDiscardVersion.stage(new List<StageDiscardVersion.Request>{ noPackage })[0];

        StageDiscardVersion.Request noRationale = stageReq(key('norat'), versionPackageId());
        noRationale.rationale = '   ';
        StageDiscardVersion.Response b = StageDiscardVersion.stage(new List<StageDiscardVersion.Request>{ noRationale })[0];

        StageDiscardVersion.Request notAPackage = stageReq(key('notapkg'), versionPackageId());
        notAPackage.versionPackageId = String.valueOf(cloneLoan().Id);
        StageDiscardVersion.Response c = StageDiscardVersion.stage(new List<StageDiscardVersion.Request>{ notAPackage })[0];
        Test.stopTest();

        System.assertEquals(false, a.ok, 'versionPackageId is required.');
        System.assertEquals('VALIDATION_FAILED', a.error.code, why(a));
        System.assertEquals(false, b.ok, 'rationale is required: this action deletes.');
        System.assertEquals('VALIDATION_FAILED', b.error.code, why(b));
        System.assertEquals(false, c.ok, 'A facility id is not a package id and is refused, fail closed.');
        System.assertEquals('VALIDATION_FAILED', c.error.code, why(c));
        System.assert(
            c.error.message.contains('product package'),
            'The refusal says what kind of id it wanted: ' + c.error.message
        );
    }

    @IsTest
    static void theStageLadderRanksTheOrgsOwnValuesAndRefusesWhatItCannotRank() {
        C360TestFixture.armCalloutMock();
        System.assertEquals(0, StageDiscardVersion.rung('Qualification'), 'Qualification is the first rung.');
        System.assertEquals(4, StageDiscardVersion.rung('Approval / Loan Committee'), 'Approval is the fifth rung.');
        System.assertEquals(9, StageDiscardVersion.rung('Booked'), 'Booked is the tenth rung.');
        System.assertEquals(10, StageDiscardVersion.rung('Complete'), 'Complete is the last rung.');
        System.assertEquals(1, StageDiscardVersion.rung('  proposal  '), 'The ladder is read case and space insensitively.');
        System.assertEquals(-1, StageDiscardVersion.rung('Underwriting'), 'A stage this org does not name ranks nowhere.');
        System.assertEquals(-1, StageDiscardVersion.rung(null), 'A null stage ranks nowhere and is never treated as early.');
        System.assertEquals(11, StageDiscardVersion.STAGE_LADDER.size(), 'The org offers eleven Loan stages.');
    }

    @IsTest
    static void anUnrankableStageOnAVersionIsRefusedRatherThanAssumedEarly() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Loan__c c = cloneLoan();
        update new LLC_BI__Loan__c(Id = c.Id, LLC_BI__Stage__c = 'Underwriting');

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('unrankable'), versionPackageId());
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A stage this org does not name is refused, not assumed to be early.');
        System.assertEquals('VERSION_IN_APPROVAL', res.error.code, 'Refusal code was ' + why(res));
        System.assert(
            res.error.message.contains('not on this org'),
            'The refusal says the stage is off the ladder: ' + res.error.message
        );
    }

    // -------------------------------------------------------------------------------------------
    // The chain stopping, and resuming.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void aRestrictedChildStopsTheChainAndTheSameKeyResumesFromThere() {
        C360TestFixture.armCalloutMock();
        String k = key('stopresume');

        // The fixture is read in ONE pass rather than through the per-record helpers, each of which
        // re-reads the account: this method runs two full executes and the queries are counted.
        Id cloneId, parentId, versionId;
        for (LLC_BI__Loan__c l : [
            SELECT Id, LLC_BI__Product_Package__c, LLC_BI__lookupKey__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__lookupKey__c IN (:PARENT_KEY, :CLONE_KEY)
        ]) {
            if (l.LLC_BI__lookupKey__c == CLONE_KEY) {
                cloneId = l.Id;
                versionId = l.LLC_BI__Product_Package__c;
            } else {
                parentId = l.Id;
            }
        }
        System.assertNotEquals(null, cloneId, 'Fixture clone missing.');
        System.assertNotEquals(null, parentId, 'Fixture parent missing.');

        // The refusal is INJECTED rather than provoked. A real failing delete (a restricted
        // LLC_BI__Opportunity_History__c child on the clone is the org's own version of this) leaves
        // a caught DmlException in the transaction, and the end-of-method flush of the org's
        // EventBridgeCallout queueable then throws "You have uncommitted work pending" from inside
        // the managed job, failing the method for a reason that is not this class. See the seam's
        // ApexDoc in ExecuteDiscardVersion. Everything else here is real: the other groups delete,
        // the verifications re-query, and the resume re-discovers.
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        // Both executes share ONE window, opened after the stage so its reads do not eat into it.
        // Two full discover-and-delete passes plus a stage do not fit in a single 100-query budget.
        Test.startTest();

        // The org refuses the FACILITY group. That is the live scenario finding 39 describes:
        // LLC_BI__Opportunity_History__c carries restrictedDelete against the Loan, nCino mints one
        // at facility creation, and it is deliberately not a stage refusal because refusing on it
        // would refuse every discard.
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_members';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);

        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer with an inventory, not a fault. ' + whyExec(stopped));
        System.assertEquals(
            C360Plan.TERMINAL_PARTIAL, stopped.result.terminalState,
            'The run is partial: some groups landed and one did not. ' + stopped.result.outcome
        );
        System.assert(
            stopped.result.outcome.contains('same idempotency key to resume'),
            'The outcome tells the banker how to carry on: ' + stopped.result.outcome
        );
        System.assert(stopped.result.deletedCount > 0, 'The earlier groups did land: ' + stopped.result.deletedCount);
        System.assert(stopped.result.remainingCount > 0, 'And the rest are reported as still standing.');

        Map<String, ExecuteDiscardVersion.StepResult> before = new Map<String, ExecuteDiscardVersion.StepResult>();
        for (ExecuteDiscardVersion.StepResult st : stopped.result.steps) {
            before.put(st.id, st);
        }
        System.assertEquals(C360Plan.STATE_VERIFIED, before.get('delete_chain').state, 'The chain rows went first and landed.');
        System.assertEquals(C360Plan.STATE_VERIFIED, before.get('delete_pledges').state, 'The pledges went before the facility.');
        System.assertEquals(C360Plan.STATE_FAILED, before.get('delete_members').state, before.get('delete_members').detail);
        System.assertEquals(C360Plan.STATE_SKIPPED, before.get('delete_package').state, 'Nothing after the stop is attempted.');
        System.assertEquals(C360Plan.STATE_SKIPPED, before.get('withdraw_trail').state, 'The trail is left alone until the discard completes.');

        System.assertEquals(
            1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'The version package is still there, and so is the facility the chain stopped on.'
        );

        // The banker clears the blocker and runs the same action again. Same key, same token, and
        // the run picks up where it stopped rather than starting over or refusing as a duplicate.
        // The seam consumed itself on the first run, so this one meets no refusal.
        ExecuteDiscardVersion.Response resumed = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, resumed.ok, 'The resume should succeed. ' + whyExec(resumed));
        System.assertEquals(false, resumed.result.replayed, 'This is a resume, not a replay: there was work left to do.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'The version package went.');
        // One query answers both remaining questions: the clone is gone and the parent is clear.
        List<LLC_BI__Loan__c> left = [
            SELECT Id, LLC_BI__hasRenewal__c FROM LLC_BI__Loan__c WHERE Id IN (:cloneId, :parentId)
        ];
        System.assertEquals(1, left.size(), 'Only the booked parent survives the resumed run.');
        System.assertEquals(parentId, left[0].Id, 'And the survivor is the parent, not the clone.');
        System.assertEquals(false, left[0].LLC_BI__hasRenewal__c, 'The parent is free to be forked again.');

        Map<String, ExecuteDiscardVersion.StepResult> after = new Map<String, ExecuteDiscardVersion.StepResult>();
        for (ExecuteDiscardVersion.StepResult st : resumed.result.steps) {
            after.put(st.id, st);
        }
        System.assertEquals(
            C360Plan.STATE_VERIFIED, after.get('delete_chain').state,
            'A group that was already empty is verified, not failed: ' + after.get('delete_chain').detail
        );
        System.assertEquals(C360Plan.STATE_VERIFIED, after.get('delete_members').state, after.get('delete_members').detail);
        System.assertEquals(C360Plan.STATE_VERIFIED, after.get('verify_version_gone').state, after.get('verify_version_gone').detail);
        System.assertEquals(
            C360Plan.STATE_VERIFIED, after.get('verify_parents').state,
            'The parents are verified off the STAGED list, so a resumed run still checks them: ' + after.get('verify_parents').detail
        );
    }

    // -------------------------------------------------------------------------------------------
    // A cockpit-created package with no chain behind it.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void aCockpitCreatedPackageBeforeApprovalIsDiscardableAndHasNoParents() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c fresh = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Cockpit Package',
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Stage__c = 'Pending',
            LLC_BI__Status__c = 'New'
        );
        insert fresh;
        String k = key('cockpit');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, fresh.Id);
        System.assertEquals(true, staged.ok, 'A package this cockpit created before approval is discardable. ' + why(staged));
        System.assertEquals(null, staged.result.sourcePackageId, 'It forked from nothing, so there is no source to return to.');
        System.assertEquals(1, staged.result.items.size(), 'The only thing to delete is the package itself.');

        Boolean saysNoSource = false;
        for (String w : staged.result.warnings) {
            if (w.contains('no booked source package')) {
                saysNoSource = true;
            }
        }
        System.assertEquals(true, saysNoSource, 'The banker is told the audit row anchors on the version: ' + staged.result.warnings);

        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :fresh.Id], 'The package is gone.');
        System.assertEquals(0, res.result.parentsCleared.size(), 'There were no booked parents to clear.');

        for (ExecuteDiscardVersion.StepResult st : res.result.steps) {
            if (st.id == 'verify_parents') {
                System.assertEquals(
                    C360Plan.STATE_VERIFIED, st.state,
                    'No parents is a real answer, not an unsettled step: ' + st.detail
                );
            }
            if (st.id == 'delete_chain') {
                System.assertEquals(C360Plan.STATE_VERIFIED, st.state, 'An empty group is verified empty: ' + st.detail);
            }
        }
    }

    @IsTest
    static void executeRefusesWhenSomeoneElseAlreadyDiscardedTheVersion() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c fresh = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Raced Package',
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Stage__c = 'Pending',
            LLC_BI__Status__c = 'New'
        );
        insert fresh;
        Id freshId = fresh.Id;
        String k = key('raced');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, freshId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        delete fresh;
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A version that is already gone is not something to delete again.');
        System.assertEquals('VALIDATION_FAILED', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assert(
            res.error.message.contains('no longer exists'),
            'The refusal says plainly what happened: ' + res.error.message
        );
        System.assertEquals(
            'Failed',
            [SELECT cm_Status__c FROM cm_Action_Staging__c WHERE Id = :staged.result.stagingId].cm_Status__c,
            'A refusal after the token was consumed still leaves the trail saying so, rather than Executing forever.'
        );
    }

    @IsTest
    static void executeRefusesItsOwnBlankInputsBeforeTouchingTheToken() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('blanks');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);

        List<ExecuteDiscardVersion.Response> out = new List<ExecuteDiscardVersion.Response>();
        for (String missing : new List<String>{ 'idempotencyKey', 'stagingId', 'planHash' }) {
            ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
            r.idempotencyKey = missing == 'idempotencyKey' ? null : k;
            r.stagingId = missing == 'stagingId' ? null : staged.result.stagingId;
            r.planHash = missing == 'planHash' ? '  ' : staged.result.planHash;
            r.decisionToken = staged.result.decisionToken;
            r.approverUserId = UserInfo.getUserId();
            out.add(ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0]);
        }
        Test.stopTest();

        for (ExecuteDiscardVersion.Response res : out) {
            System.assertEquals(false, res.ok, 'Every one of the three is required in Apex, not only on the wire.');
            System.assertEquals('VALIDATION_FAILED', res.error.code, 'Refusal code was ' + whyExec(res));
        }
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void oneCallCarriesManyRequestsAndElementIMatchesInputI() {
        C360TestFixture.armCalloutMock();
        // The positional envelope is the invocable contract, and a batch that silently reordered its
        // answers would be worse than one that refused. Two requests, one good and one refused.
        StageDiscardVersion.Request good = stageReq(key('batchgood'), versionPackageId());
        StageDiscardVersion.Request bad = stageReq(key('batchbad'), bookedPackageId());

        Test.startTest();
        List<StageDiscardVersion.Response> res = StageDiscardVersion.stage(
            new List<StageDiscardVersion.Request>{ good, bad }
        );
        Test.stopTest();

        System.assertEquals(2, res.size(), 'One response per request.');
        System.assertEquals(true, res[0].ok, 'Element 0 belongs to the version. ' + why(res[0]));
        System.assertEquals(String.valueOf(versionPackageId()), res[0].result.versionPackageId, 'And it names that version.');
        System.assertEquals(false, res[1].ok, 'Element 1 belongs to the booked package.');
        System.assertEquals('PACKAGE_BOOKED', res[1].error.code, 'Refusal code was ' + why(res[1]));
    }
}
