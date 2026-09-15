/**
 * StageExecuteDiscardVersionTest - the version discard, tested by building a real version and
 * taking it away.
 *
 * THE FIXTURE IS THE POINT. Everything here hangs off one `@TestSetup` that reproduces the shape
 * `ExecuteLoanModification` leaves behind in the org: a booked parent filed AT Booked with a core
 * lookup key (LV06 keys on PRIORVALUE, which is blank on an insert, so this is legal and is the
 * shape proved live on 2026-08-20), a version package, a clone at Qualification carrying
 * `Is_Modification` with the `_M1` key, BOTH `LLC_BI__LoanRenewal__c` rows (revision 0 self anchor,
 * revision 1 pointing at the clone), ONE `LLC_BI__Loan_Collateral_Aggregate__c` shell per facility
 * with the FACILITY holding the lookup (the shell has none back), a pledge on the clone, a covenant
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
    private static final String RELAY_URL = 'https://bot.connectry.io/c360-relay/relay';
    private static final String RELAY_SECRET = 'ZZ-TEST-SECRET-NOT-A-REAL-ONE';
    private static final String PATH_SELF = 'self';
    private static final String PATH_BOX = 'box';

    // -------------------------------------------------------------------------------------------
    // Fixture.
    // -------------------------------------------------------------------------------------------

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();

        // The relay leg reads this out of the application cache. It is set up here rather than in
        // each method so the relay tests perform NO DML of their own: a callout in a transaction
        // that has already written is refused by the platform, and that rule is the whole reason
        // the outer leg is read-only.
        cm_Relay_Config__c cfg = cm_Relay_Config__c.getOrgDefaults();
        cfg.cm_Relay_URL__c = RELAY_URL;
        cfg.cm_Shared_Secret__c = RELAY_SECRET;
        insert cfg;

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

        // The collateral chain, built before the facilities because the FACILITY holds the lookup to
        // its own aggregate shell. The type needs an advance rate before a collateral may exist
        // (Advance_Rate_should_not_be_null), and a pledge needs three parents including that shell
        // (lesson 15ac). BOTH facilities carry one, which is the shape nCino leaves behind: one
        // shell per loan, and the shell carries no lookup back.
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
        LLC_BI__Loan_Collateral_Aggregate__c parentAgg = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Parent Aggregate'
        );
        LLC_BI__Loan_Collateral_Aggregate__c cloneAgg = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Clone Aggregate'
        );
        insert new List<LLC_BI__Loan_Collateral_Aggregate__c>{ parentAgg, cloneAgg };

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
            LLC_BI__Is_Modification__c = false,
            LLC_BI__Loan_Collateral_Aggregate__c = parentAgg.Id
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
            LLC_BI__Is_Modification__c = true,
            LLC_BI__Loan_Collateral_Aggregate__c = cloneAgg.Id
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

        insert new LLC_BI__Loan_Collateral2__c(
            LLC_BI__Loan__c = clone.Id,
            LLC_BI__Collateral__c = asset.Id,
            LLC_BI__Loan_Collateral_Aggregate__c = cloneAgg.Id,
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

    private static LLC_BI__Loan_Collateral_Aggregate__c shellOf(LLC_BI__Loan__c loan) {
        Id shellId = [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan__c WHERE Id = :loan.Id
        ].LLC_BI__Loan_Collateral_Aggregate__c;
        return [
            SELECT Id, Name, LLC_BI__lookupKey__c FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id = :shellId
        ];
    }

    private static Integer shellsLeft(Set<Id> shellIds) {
        return [SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id IN :shellIds];
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

    private static ExecuteDiscardVersion.Request execRequest(String k, StageDiscardVersion.StageResult s) {
        ExecuteDiscardVersion.Request r = new ExecuteDiscardVersion.Request();
        r.idempotencyKey = k;
        r.stagingId = s.stagingId;
        r.planHash = s.planHash;
        r.decisionToken = s.decisionToken;
        r.approverUserId = UserInfo.getUserId();
        return r;
    }

    /**
     * An INLINE request: the shape the relay's inner leg sends, and what every test outside the
     * relay section drives. Since 2026-09-15 a request without this flag is relayed instead of run
     * here, because the MCP dispatcher context cannot host nCino's trigger (backlog row 66), so a
     * test of the chain itself has to say which leg it is testing.
     */
    private static ExecuteDiscardVersion.Response executeOf(String k, StageDiscardVersion.StageResult s) {
        ExecuteDiscardVersion.Request r = execRequest(k, s);
        r.inlineExecution = true;
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
        System.assert(
            res.error.message.contains('no action trail row'),
            'The refusal names both marks it looked for, the stage and the ledger: ' + res.error.message
        );
    }

    // -------------------------------------------------------------------------------------------
    // The package this cockpit CREATED rather than forked (backlog 58).
    //
    // `execute_new_facility` files a package from nothing, so it carries no chain, no
    // Is_Modification member and no booked parent. It is recognised by the opening stage
    // `create_package` writes and by its own trail row, and the live defect was that it had
    // neither: the stage was null and the row did not name the package, so the discard refused
    // NOT_A_VERSION and the promise that a created package rolls back to nothing was not kept.
    // The fixture below is that live shape exactly, ledger row included.
    // -------------------------------------------------------------------------------------------

    /**
     * Builds a package in the shape `execute_new_facility` leaves behind: no chain, no parent, one
     * facility at Qualification with no lookup key, its borrowing structure, a fee, a pledge and
     * the aggregate shell the facility points at, plus the trail row that names the package.
     *
     * The package stage is left NULL deliberately. That is the state of every package created
     * before this change, and it is the harder half of the defect: the ledger has to carry the
     * classification on its own.
     *
     * @return The created package id.
     */
    private static Id createdPackageFixture() {
        Account a = borrower();
        LLC_BI__Product_Package__c pkg = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Created Package',
            LLC_BI__Account__c = a.Id
        );
        insert pkg;
        pkg = [SELECT Id, CreatedDate FROM LLC_BI__Product_Package__c WHERE Id = :pkg.Id];

        LLC_BI__Loan_Collateral_Aggregate__c shell = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Created Aggregate'
        );
        insert shell;

        LLC_BI__Loan__c facility = new LLC_BI__Loan__c(
            LLC_BI__Account__c = a.Id,
            LLC_BI__Product_Package__c = pkg.Id,
            LLC_BI__Stage__c = 'Qualification',
            LLC_BI__Status__c = 'Open',
            LLC_BI__Amount__c = 750000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = false,
            LLC_BI__Loan_Collateral_Aggregate__c = shell.Id
        );
        insert facility;

        insert new LLC_BI__Legal_Entities__c(
            LLC_BI__Loan__c = facility.Id,
            LLC_BI__Product_Package__c = pkg.Id,
            LLC_BI__Account__c = a.Id,
            LLC_BI__Borrower_Type__c = 'Borrower',
            LLC_BI__Ownership__c = 100
        );
        insert new LLC_BI__Fee__c(
            LLC_BI__Loan__c = facility.Id,
            LLC_BI__Record_Type__c = 'Fees',
            LLC_BI__Fee_Type__c = 'Attorney',
            LLC_BI__Calculation_Type__c = 'Flat Amount',
            LLC_BI__Amount__c = 5000,
            LLC_BI__Status__c = 'Active'
        );
        insert new LLC_BI__Loan_Collateral2__c(
            LLC_BI__Loan__c = facility.Id,
            LLC_BI__Collateral__c = [SELECT Id FROM LLC_BI__Collateral__c LIMIT 1].Id,
            LLC_BI__Loan_Collateral_Aggregate__c = shell.Id,
            LLC_BI__Lien_Position__c = '1st',
            LLC_BI__Is_Primary__c = true,
            LLC_BI__Amount_Pledged__c = 250000
        );

        cm_Action_Staging__c ledger = new cm_Action_Staging__c(
            cm_Action_Id__c = 'new-facility-request',
            cm_Idempotency_Key__c = key('created-ledger'),
            cm_Plan_Hash__c = 'deadbeef',
            cm_Plan_JSON__c = '{}',
            cm_Status__c = 'Completed',
            cm_Account__c = a.Id,
            cm_Product_Package__c = pkg.Id,
            cm_Result_Record_Id__c = String.valueOf(facility.Id)
        );
        insert ledger;
        // The row is STAGED before the package exists and stamped after it is created, which is
        // what tells a creation apart from a facility filed on a package somebody else made. A
        // test transaction stamps every CreatedDate alike, so the two-transaction shape is set
        // here with the platform's own seam rather than assumed.
        Test.setCreatedDate(ledger.Id, pkg.CreatedDate.addMinutes(-5));
        return pkg.Id;
    }

    @IsTest
    static void aPackageTheLedgerSaysThisCockpitCreatedIsDiscardedToNothing() {
        C360TestFixture.armCalloutMock();
        Id pkgId = createdPackageFixture();
        Id facilityId = [SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :pkgId LIMIT 1].Id;
        Id shellId = [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan__c WHERE Id = :facilityId
        ].LLC_BI__Loan_Collateral_Aggregate__c;
        Id ledgerId = [
            SELECT Id FROM cm_Action_Staging__c WHERE cm_Product_Package__c = :pkgId AND cm_Action_Id__c = 'new-facility-request' LIMIT 1
        ].Id;
        Id assetId = [SELECT Id FROM LLC_BI__Collateral__c LIMIT 1].Id;
        String k = key('created');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, pkgId);
        System.assertEquals(true, staged.ok, 'The ledger says this cockpit created it, so it is discardable. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(null, staged.result.sourcePackageId, 'A created package was never forked, so it has no source.');

        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :pkgId], 'The created package is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :facilityId], 'Its facility is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Product_Package__c = :pkgId], 'The borrowing structure is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :facilityId], 'The fee is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :facilityId], 'The pledge is gone.');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id = :shellId], 'The aggregate shell goes with its facility.');
        System.assertEquals(0, res.result.remainingCount, 'Nothing was left behind: ' + res.result.outcome);

        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Collateral__c WHERE Id = :assetId], 'The asset survives its pledge, as on a version.');
        System.assertEquals(1, [SELECT COUNT() FROM cm_Action_Staging__c WHERE Id = :ledgerId], 'The creation row is KEPT. It is the audit of what was made.');

        Boolean offered = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c').contains(StageDiscardVersion.WITHDRAWN);
        cm_Action_Staging__c ledger = [SELECT Id, cm_Status__c FROM cm_Action_Staging__c WHERE Id = :ledgerId];
        System.assertEquals(
            offered ? StageDiscardVersion.WITHDRAWN : 'Completed', ledger.cm_Status__c,
            'The row that filed the package ends Withdrawn where the org offers the value, and is left as it stands where it does not.'
        );

        String created = null;
        for (String w : staged.result.warnings) {
            if (w.contains('created by this cockpit')) {
                created = w;
            }
        }
        System.assertNotEquals(null, created, 'The banker reads why a package with no chain is discardable at all.');
        System.assert(created.contains('no booked parents to restore'), 'And what a parentless discard means: ' + created);
    }

    @IsTest
    static void aForkedVersionIsStillClassifiedByItsChainAndCarriesNoCreationSentence() {
        C360TestFixture.armCalloutMock();
        Test.startTest();
        StageDiscardVersion.Response res = stage(key('forked'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'The version route is unchanged. ' + why(res));
        System.assertEquals(
            String.valueOf(bookedPackageId()), res.result.sourcePackageId,
            'A forked version still resolves its booked source through the chain.'
        );
        for (String w : res.result.warnings) {
            System.assert(!w.contains('created by this cockpit'), 'A forked version was not created outright: ' + w);
        }
    }

    @IsTest
    static void aBookedPackageIsRefusedEvenWhenTheLedgerNamesIt() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Product_Package__c booked = [
            SELECT Id, CreatedDate FROM LLC_BI__Product_Package__c WHERE Id = :bookedPackageId()
        ];
        Id bookedId = booked.Id;
        cm_Action_Staging__c ledger = new cm_Action_Staging__c(
            cm_Action_Id__c = 'new-facility-request',
            cm_Idempotency_Key__c = key('booked-ledger'),
            cm_Plan_Hash__c = 'deadbeef',
            cm_Plan_JSON__c = '{}',
            cm_Status__c = 'Completed',
            cm_Account__c = borrower().Id,
            cm_Product_Package__c = bookedId
        );
        insert ledger;
        Test.setCreatedDate(ledger.Id, booked.CreatedDate.addMinutes(-5));

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('bookedledger'), bookedId);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A booked facility is the bank\'s record of a loan it made.');
        System.assertEquals(
            'PACKAGE_BOOKED', res.error.code,
            'Ledger evidence answers "is this ours"; it never answers "is this still in flight". ' + why(res)
        );
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
        System.assertEquals(
            1, byObject.get('LLC_BI__Loan_Collateral_Aggregate__c'),
            'The clone facility\'s aggregate shell is on the list, and the booked parent\'s is not: ' + byObject
        );
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

    // -------------------------------------------------------------------------------------------
    // Item names. nCino's pricing engine writes a record's own id into its Name, and an id is not
    // a name a banker can read: the cockpit refused a live Sunbelt discard on exactly that
    // (2026-09-15, lesson 82).
    // -------------------------------------------------------------------------------------------

    /** The shape the cockpit's plan guard refuses, so these tests ask the client's own question. */
    private static final String RECORD_ID_SHAPE = '^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$';

    /**
     * A payment component carrying its own fifteen-character id in `Name`, which is what nCino's
     * pricing engine leaves behind. The id does not exist until the insert has run, so the Name is
     * stamped by a second DML rather than set on the way in.
     *
     * @param facility The version facility the component hangs off.
     * @return The component, with its Name equal to its own id.
     */
    private static LLC_BI__Pricing_Payment_Component__c componentNamedAfterItsOwnId(LLC_BI__Loan__c facility) {
        LLC_BI__Pricing_Stream__c stream = new LLC_BI__Pricing_Stream__c(
            Name = 'ZZ-DISCARD-TEST Payment Stream',
            LLC_BI__Loan__c = facility.Id,
            LLC_BI__Context_Id__c = String.valueOf(facility.Id)
        );
        insert stream;
        LLC_BI__Pricing_Payment_Component__c pc = new LLC_BI__Pricing_Payment_Component__c(
            LLC_BI__Pricing_Stream__c = stream.Id,
            cm_Loan__c = facility.Id
        );
        insert pc;
        pc.Name = String.valueOf(pc.Id).substring(0, 15);
        update pc;
        return pc;
    }

    /** A pricing stream the org holds with no Name at all. */
    private static LLC_BI__Pricing_Stream__c streamWithNoName(LLC_BI__Loan__c facility) {
        LLC_BI__Pricing_Stream__c stream = new LLC_BI__Pricing_Stream__c(
            LLC_BI__Loan__c = facility.Id,
            LLC_BI__Context_Id__c = String.valueOf(facility.Id)
        );
        insert stream;
        return stream;
    }

    private static StageDiscardVersion.InventoryItem itemFor(StageDiscardVersion.Response res, Id recordId) {
        for (StageDiscardVersion.InventoryItem i : res.result.items) {
            if (i.recordId == String.valueOf(recordId)) {
                return i;
            }
        }
        return null;
    }

    @IsTest
    static void aComponentNamedAfterItsOwnIdIsNamedAfterItsFacilityInstead() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Loan__c facility = cloneLoan();
        LLC_BI__Pricing_Payment_Component__c pc = componentNamedAfterItsOwnId(facility);

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('idname'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));
        StageDiscardVersion.InventoryItem item = itemFor(res, pc.Id);
        System.assertNotEquals(null, item, 'The payment component is on the delete list.');
        System.assertEquals(
            'Pricing payment component on ' + cloneLoan().Name,
            item.name,
            'A Name that is the record\'s own id is replaced by the object and the facility it hangs off.'
        );
    }

    @IsTest
    static void aPledgeWithARealNameKeepsIt() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Loan_Collateral2__c pledge = [
            SELECT Id, Name FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :cloneLoan().Id LIMIT 1
        ];

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('realname'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));
        StageDiscardVersion.InventoryItem item = itemFor(res, pledge.Id);
        System.assertNotEquals(null, item, 'The pledge is on the delete list.');
        System.assertEquals(
            pledge.Name, item.name, 'A real Name is the banker\'s own reference and is never rewritten.'
        );
    }

    @IsTest
    static void aRowWithNoNameIsNamedAfterItsObjectAndItsFacility() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Pricing_Stream__c stream = streamWithNoName(cloneLoan());

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('nullname'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));
        StageDiscardVersion.InventoryItem item = itemFor(res, stream.Id);
        System.assertNotEquals(null, item, 'The unnamed stream is on the delete list.');
        System.assertEquals(
            'Pricing stream on ' + cloneLoan().Name,
            item.name,
            'A null Name falls back to the object label and the facility, never to the id.'
        );
    }

    @IsTest
    static void noItemNameInTheWholeInventoryIsAnOrgRecordId() {
        C360TestFixture.armCalloutMock();
        LLC_BI__Loan__c facility = cloneLoan();
        componentNamedAfterItsOwnId(facility);
        streamWithNoName(facility);

        Test.startTest();
        StageDiscardVersion.Response res = stage(key('noids'), versionPackageId());
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Stage should succeed. ' + why(res));
        System.assert(!res.result.items.isEmpty(), 'The plan carries items to judge.');
        for (StageDiscardVersion.InventoryItem i : res.result.items) {
            System.assert(
                String.isNotBlank(i.name) && !Pattern.matches(RECORD_ID_SHAPE, i.name),
                'The cockpit refuses any item name that reads as an org record id: ' +
                i.objectName + ' was named ' + i.name
            );
        }
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
        Id cloneShellId = shellOf(cloneLoan()).Id;
        Id parentShellId = shellOf(parentLoan()).Id;
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
        System.assertEquals(
            0, [SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id = :cloneShellId],
            'The clone facility\'s aggregate shell goes with it. Leaving it behind is backlog row 46.'
        );

        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :bookedId], 'The BOOKED package is untouched.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :parentId], 'The BOOKED parent is untouched.');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Collateral__c WHERE Id = :assetId], 'The asset survives its pledge.');
        System.assertEquals(
            1, [SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id = :parentShellId],
            'The BOOKED parent keeps its own shell. Only the shells the version facilities pointed at go.'
        );
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
            'delete_fees', 'delete_involvements', 'delete_members', 'delete_aggregates', 'delete_package',
            'verify_parents', 'verify_version_gone', 'withdraw_trail', 'observe_aggregates'
        }) {
            System.assertNotEquals(null, steps.get(required), 'The plan carries the step ' + required);
        }
        for (String verified : new List<String>{
            'delete_chain', 'delete_pledges', 'delete_members', 'delete_aggregates', 'delete_package',
            'verify_parents', 'verify_version_gone'
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

    // -------------------------------------------------------------------------------------------
    // The collateral aggregate shells (backlog row 46).
    //
    // nCino mints one shell per facility and the FACILITY holds the lookup, so a discard that took
    // the facilities and left the shells left one empty row behind per clone. These four methods
    // fix the boundary: a shell the version owned goes, and a shell anything else can reach stays.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void everyVersionFacilityLosesItsShellAndTheReQueryProvesIt() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        LLC_BI__Loan_Collateral_Aggregate__c second = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Second Shell'
        );
        insert second;
        insert facilityOn(versionId, 'ZZDISCARDP1_M2', second.Id);
        Set<Id> shells = new Set<Id>{ shellOf(cloneLoan()).Id, second.Id };
        String k = key('twoshells');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            2, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'Both facilities\' shells are frozen at stage time, because the facility is the only thing that names one.'
        );
        System.assertEquals(0, shellsLeft(shells), 'Both shells are gone, proven by re-query rather than by the step saying so.');
        System.assertEquals(0, res.result.remainingCount, 'Nothing was left behind: ' + res.result.outcome);
    }

    @IsTest
    static void aShellCarryingALookupKeyIsNeverFrozenAndIsReportedAsObserved() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        LLC_BI__Loan_Collateral_Aggregate__c shell = shellOf(cloneLoan());
        shell.LLC_BI__lookupKey__c = 'ZZ-DISCARD-TEST-SEEDED';
        update shell;
        String k = key('keyedshell');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            0, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'A shell keyed outside this cockpit is never on the delete list, so the banker never confirms it.'
        );
        System.assertEquals(
            1, shellsLeft(new Set<Id>{ shell.Id }),
            'The keyed shell is still there. Bankinggpt carries three seeded this way and none of them is ours.'
        );

        ExecuteDiscardVersion.StepResult observed = stepOf(res, 'observe_aggregates');
        System.assertEquals(C360Plan.STATE_FILED_UNVERIFIED, observed.state, 'An observed side effect is never claimed as verified.');
        System.assert(
            observed.detail.contains('ZZ-DISCARD-TEST-SEEDED'),
            'The step names the shell it left standing and why: ' + observed.detail
        );
    }

    @IsTest
    static void aShellAFacilityOutsideTheVersionAlsoPointsAtIsRefused() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id shellId = shellOf(cloneLoan()).Id;
        // A facility on the BOOKED package pointing at the same shell. Deleting it would cascade
        // through LLC_BI__Loan_Collateral2__c into whatever that facility has pledged.
        insert facilityOn(bookedPackageId(), 'ZZDISCARDOUT1', shellId);
        String k = key('sharedshell');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            0, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'A shell something outside the version points at is not frozen, so it can never be deleted.'
        );
        System.assertEquals(1, shellsLeft(new Set<Id>{ shellId }), 'The shared shell stands. It is not the version\'s to remove.');
        System.assert(
            stepOf(res, 'observe_aggregates').detail.contains('Left standing'),
            'The refusal is reported rather than silent: ' + stepOf(res, 'observe_aggregates').detail
        );
    }

    @IsTest
    static void aShellSurvivesAStopBecauseItComesOffTheFrozenPlanRatherThanAFreshRead() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id shellId = shellOf(cloneLoan()).Id;
        String k = key('shellresume');

        // This method used to lift the package to Pending before staging, so that the RESUMED run
        // could still be ranked as a version once its chain rows and facilities were gone. That
        // workaround is deleted rather than kept: a resume no longer re-classifies the package, so
        // the fixture's own stage-less package is the honest shape here, and it is the shape the org
        // actually carries. aResumeTrustsTheFrozenPlanRatherThanTheHalfDeletedOrg owns that claim.
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        Test.startTest();
        // Stop ON the shells, which is the one place where stopping strands them: the facilities
        // are already deleted, so nothing in the org can name their shells any more.
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_aggregates';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer, not a fault. ' + whyExec(stopped));
        System.assertEquals(1, shellsLeft(new Set<Id>{ shellId }), 'The shell is still there, which is what the stop means.');
        System.assertEquals(
            0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :versionId],
            'The facilities went before the stop, so the shell is now unreachable by query.'
        );

        ExecuteDiscardVersion.Response resumed = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, resumed.ok, 'The resume should succeed. ' + whyExec(resumed));
        System.assertEquals(
            0, shellsLeft(new Set<Id>{ shellId }),
            'The resumed run still deletes the shell, because the plan named it before the facilities went.'
        );
    }

    @IsTest
    static void aShellThatWentWithItsCloneReadsAlreadyGoneAndTheChainCarriesOn() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id shellId = shellOf(cloneLoan()).Id;
        String k = key('cascadedshell');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        // nCino's managed delete handling reproduced: on 2026-09-14 the clone's shell went WITH the
        // clone inside delete_members, and the all-or-nothing delete then stopped the whole chain on
        // ENTITY_IS_DELETED with the version package still standing.
        ExecuteDiscardVersion.vanishBeforeGroup = 'delete_aggregates';
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            0, res.result.remainingCount,
            'A shell that is already gone reached this group\'s outcome, so nothing remains: ' + res.result.outcome
        );
        System.assertEquals(
            'already_gone', outcomeOf(res, shellId),
            'The item says what actually happened to it rather than claiming a delete this run did not perform.'
        );
        System.assertEquals(
            C360Plan.STATE_VERIFIED, stepOf(res, 'delete_aggregates').state,
            'The group settles verified: ' + stepOf(res, 'delete_aggregates').detail
        );
        System.assertEquals(
            C360Plan.STATE_VERIFIED, stepOf(res, 'delete_package').state,
            'And the chain carries on to the package, which is the whole point of tolerating it.'
        );
        System.assertEquals(
            0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'The version package is gone. Before this it was stranded with zero loans.'
        );
    }

    @IsTest
    static void anEmptyShellThisVersionsCreationMintedIsFrozenWithIt() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        // The shape nCino leaves behind on a version creation: minted while the version was built,
        // by the same user, and pointed at by nothing at all because the clone already had one.
        LLC_BI__Loan_Collateral_Aggregate__c orphan = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Creation Orphan'
        );
        insert orphan;
        String k = key('orphanshell');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            2, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'Both the clone\'s own shell and the orphan its creation minted are frozen, because no facility will be ' +
            'able to name either one once the facilities are gone.'
        );
        System.assertEquals(0, shellsLeft(new Set<Id>{ orphan.Id }), 'The orphan went with the version that caused it.');
        System.assertEquals(0, res.result.remainingCount, 'Nothing was left behind: ' + res.result.outcome);
    }

    @IsTest
    static void anEmptyShellInTheWindowCarryingALookupKeyIsNeverFrozen() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        LLC_BI__Loan_Collateral_Aggregate__c seeded = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Seeded In Window',
            LLC_BI__lookupKey__c = 'ZZ-DISCARD-TEST-WINDOW-SEED'
        );
        insert seeded;
        String k = key('windowseed');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            1, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'Only the clone\'s own shell is frozen. A lookup key is the one field that says a human keyed the row.'
        );
        System.assertEquals(1, shellsLeft(new Set<Id>{ seeded.Id }), 'The keyed row stands, whatever the window says.');
    }

    @IsTest
    static void anEmptyShellInTheWindowSomethingElsePointsAtIsNeverFrozen() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        LLC_BI__Loan_Collateral_Aggregate__c held = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-DISCARD-TEST Held In Window'
        );
        insert held;
        // A facility on the BOOKED package: born in the same window, and squarely somebody else's.
        insert facilityOn(bookedPackageId(), 'ZZDISCARDHELD1', held.Id);
        String k = key('windowheld');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, res.ok, 'Execute should succeed. ' + whyExec(res));
        System.assertEquals(
            1, countOf(staged.result.items, 'LLC_BI__Loan_Collateral_Aggregate__c'),
            'A shell something points at is not an orphan, whatever window it was born in.'
        );
        System.assertEquals(1, shellsLeft(new Set<Id>{ held.Id }), 'The referenced shell stands.');
    }

    /** The outcome the run recorded for one record, or null when it never named it. */
    private static String outcomeOf(ExecuteDiscardVersion.Response res, Id recordId) {
        for (ExecuteDiscardVersion.InventoryItem i : res.result.items) {
            if (i.recordId == String.valueOf(recordId)) {
                return i.outcome;
            }
        }
        return null;
    }

    /** An unbooked facility on the named package, carrying the named shell. Builds both the second
     *  version facility and the outside one that makes a shell shared. */
    private static LLC_BI__Loan__c facilityOn(Id packageId, String lookupKey, Id shellId) {
        return new LLC_BI__Loan__c(
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Product_Package__c = packageId,
            LLC_BI__Stage__c = 'Qualification',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = lookupKey,
            LLC_BI__Amount__c = 750000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = false,
            LLC_BI__Loan_Collateral_Aggregate__c = shellId
        );
    }

    private static Integer countOf(List<StageDiscardVersion.InventoryItem> items, String objectName) {
        Integer n = 0;
        for (StageDiscardVersion.InventoryItem i : items) {
            if (i.objectName == objectName) {
                n++;
            }
        }
        return n;
    }

    private static ExecuteDiscardVersion.StepResult stepOf(ExecuteDiscardVersion.Response res, String stepId) {
        for (ExecuteDiscardVersion.StepResult s : res.result.steps) {
            if (s.id == stepId) {
                return s;
            }
        }
        return null;
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
        r.inlineExecution = true;
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
        r.inlineExecution = true;
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
        r.inlineExecution = true;
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
    // The resume and the evidence the chain deletes (org proof 2026-09-14, staging row
    // STG-0000000157).
    //
    // assertIsDiscardableVersion ranks a package as a version from its LLC_BI__LoanRenewal__c chain
    // rows or its members' Is_Modification. The chain rows are group 1 and the members are group 5,
    // so every stop after delete_chain left a package that no longer looked like a version, and the
    // resume was refused NOT_A_VERSION by the progress its own first run made. These methods hold
    // the two halves of the rule: a RESUME trusts the frozen plan, a FIRST execute does not.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void aResumeTrustsTheFrozenPlanRatherThanTheHalfDeletedOrg() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id trailId = [SELECT Id FROM cm_Action_Staging__c WHERE cm_Action_Id__c = 'loan-modification' LIMIT 1].Id;
        String k = key('resumeclassify');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        // Both executes share ONE window, opened after the stage so the stage's reads do not eat
        // into the budget the two executes share (lesson 8j).
        Test.startTest();

        // Stop ON the shells, which is exactly where the live Hartwell discard stopped. By then the
        // chain rows are gone and the facilities with them, which is every piece of evidence the
        // version classification reads.
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_aggregates';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer, not a fault. ' + whyExec(stopped));
        System.assertEquals(C360Plan.TERMINAL_PARTIAL, stopped.result.terminalState, stopped.result.outcome);

        // The package now reads as nothing at all: no members, and a stage the gate does not
        // recognise as one this cockpit created. That is the shape the org was left in, and before
        // this change every resume under this key was refused NOT_A_VERSION.
        System.assertEquals(
            0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :versionId],
            'The facilities went before the stop, taking the fork evidence with them.'
        );
        String leftStage = [SELECT LLC_BI__Stage__c FROM LLC_BI__Product_Package__c WHERE Id = :versionId].LLC_BI__Stage__c;
        System.assert(
            leftStage != 'Pending' && leftStage != 'In Review',
            'And the package carries no cockpit stage to fall back on, which is the live shape: ' + String.valueOf(leftStage)
        );

        ExecuteDiscardVersion.Response resumed = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(
            true, resumed.ok,
            'A resume must never be refused by the evidence its own first run deleted. ' + whyExec(resumed)
        );
        System.assertEquals(false, resumed.result.replayed, 'This is a resume: there was work left to do.');
        System.assertEquals(
            0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'The version package went. It is the record the stranded run left standing on the org.'
        );

        Map<String, ExecuteDiscardVersion.StepResult> after = new Map<String, ExecuteDiscardVersion.StepResult>();
        for (ExecuteDiscardVersion.StepResult s : resumed.result.steps) {
            after.put(s.id, s);
        }
        System.assertEquals(C360Plan.STATE_VERIFIED, after.get('delete_aggregates').state, after.get('delete_aggregates').detail);
        System.assertEquals(C360Plan.STATE_VERIFIED, after.get('delete_package').state, after.get('delete_package').detail);
        System.assertEquals(C360Plan.STATE_VERIFIED, after.get('verify_version_gone').state, after.get('verify_version_gone').detail);

        // The trail is the last step, and whether it can be STAMPED is the org's picklist to decide.
        // The run is Completed only in the world where Withdrawn exists; in the other one it is
        // honestly partial, and that is unchanged by this fix.
        Boolean offered = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c').contains(StageDiscardVersion.WITHDRAWN);
        cm_Action_Staging__c row = [SELECT cm_Status__c FROM cm_Action_Staging__c WHERE Id = :staged.result.stagingId];
        if (offered) {
            System.assertEquals(C360Plan.TERMINAL_SUCCESS, resumed.result.terminalState, resumed.result.outcome);
            System.assertEquals('Completed', row.cm_Status__c, 'A finished resume closes the row it was resuming.');
            System.assertEquals(
                StageDiscardVersion.WITHDRAWN,
                [SELECT cm_Status__c FROM cm_Action_Staging__c WHERE Id = :trailId].cm_Status__c,
                'And the row that filed the version is withdrawn, as the first run would have done.'
            );
        } else {
            System.assertEquals(C360Plan.TERMINAL_PARTIAL, resumed.result.terminalState, resumed.result.outcome);
            System.assertEquals(
                C360Plan.STATE_SKIPPED, after.get('withdraw_trail').state,
                'The only unsettled step is the picklist one: ' + after.get('withdraw_trail').detail
            );
        }
    }

    @IsTest
    static void aFirstExecuteOnAPackageThatIsNotAVersionIsStillRefused() {
        C360TestFixture.armCalloutMock();
        // Staged while it reads Pending, which is what makes it a package this cockpit created, and
        // moved out of that stage before the click. A FIRST execute re-reads the gate in full, so
        // this is the refusal the resume exemption must not widen into.
        LLC_BI__Product_Package__c fresh = new LLC_BI__Product_Package__c(
            Name = 'ZZ-DISCARD-TEST Declassified Package',
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Stage__c = 'Pending',
            LLC_BI__Status__c = 'New'
        );
        insert fresh;
        Id freshId = fresh.Id;
        String k = key('declassified');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, freshId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));
        update new LLC_BI__Product_Package__c(Id = freshId, LLC_BI__Stage__c = 'Underwriting');
        ExecuteDiscardVersion.Response res = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(false, res.ok, 'A first execute still asks the org what this package is.');
        System.assertEquals('NOT_A_VERSION', res.error.code, 'Refusal code was ' + whyExec(res));
        System.assertEquals(
            1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :freshId], 'Nothing was deleted.'
        );
        System.assertEquals(
            'Failed',
            [SELECT cm_Status__c FROM cm_Action_Staging__c WHERE Id = :staged.result.stagingId].cm_Status__c,
            'And the refusal is written to the trail rather than leaving the row Executing.'
        );
    }

    @IsTest
    static void aResumeWhoseVersionIsAlreadyGoneFinishesTheRunRatherThanStrandingIt() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id shellId = shellOf(cloneLoan()).Id;
        String k = key('gonebyresume');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        Test.startTest();
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_aggregates';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer, not a fault. ' + whyExec(stopped));

        // Someone finished the job in Salesforce while the run was stopped. The resume meets an org
        // that is already in the state the plan wanted.
        delete new LLC_BI__Loan_Collateral_Aggregate__c(Id = shellId);
        delete new LLC_BI__Product_Package__c(Id = versionId);

        ExecuteDiscardVersion.Response resumed = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, resumed.ok, 'The resume reports the state rather than refusing. ' + whyExec(resumed));
        System.assertEquals(
            'already_gone', outcomeOf(resumed, versionId),
            'The package is named as already gone rather than claimed as a delete this run performed.'
        );
        System.assertEquals(
            C360Plan.STATE_VERIFIED, stepOf(resumed, 'delete_package').state,
            'The group reached the outcome it wanted: ' + stepOf(resumed, 'delete_package').detail
        );
        System.assertEquals(
            C360Plan.STATE_VERIFIED, stepOf(resumed, 'verify_version_gone').state,
            stepOf(resumed, 'verify_version_gone').detail
        );
        System.assertEquals(0, resumed.result.remainingCount, 'Nothing remains: ' + resumed.result.outcome);
    }

    @IsTest
    static void aResumeMustNameTheVersionTheStoppedRunWasDiscarding() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('retarget');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, 'Stage should succeed. ' + why(staged));

        Test.startTest();
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_chain';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer, not a fault. ' + whyExec(stopped));

        // The row is made to point at a different package. A resume trusts the frozen plan for WHAT
        // the package is, so the one thing it does re-derive is that the row and the plan are still
        // talking about the same version.
        update new cm_Action_Staging__c(Id = staged.result.stagingId, cm_Result_Record_Id__c = String.valueOf(bookedPackageId()));
        ExecuteDiscardVersion.Response resumed = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(false, resumed.ok, 'A row pointing somewhere else is a mix-up, not a run to carry on with.');
        System.assertEquals('VALIDATION_FAILED', resumed.error.code, 'Refusal code was ' + whyExec(resumed));
        System.assert(
            resumed.error.message.contains('does not retarget'),
            'The refusal says what it is protecting: ' + resumed.error.message
        );
        System.assertEquals(
            1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.'
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
            r.inlineExecution = true;
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

    // -------------------------------------------------------------------------------------------
    // Backlog row 45: the row that FILED the version is withdrawn too.
    // -------------------------------------------------------------------------------------------

    /**
     * A discard must withdraw BOTH shapes of trail row, and the fixture carries both.
     *
     * The @TestSetup row is anchored on the VERSION, which is every action a banker ran inside it.
     * The row added here is the other shape: the loan modification that FILED the version, anchored
     * on the SOURCE package because that is the package the banker was looking at, and tied to the
     * version only by `cm_Result_Record_Id__c` naming the clone this discard deletes. Before row 45
     * it stayed Completed, so the action that created a version nobody can open any more still read
     * as finished work.
     */
    @IsTest
    static void theRowThatFiledTheVersionIsWithdrawnBesideTheRowsAnchoredOnIt() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        Id cloneId = cloneLoan().Id;

        cm_Action_Staging__c filer = new cm_Action_Staging__c(
            cm_Action_Id__c = 'loan-modification',
            cm_Idempotency_Key__c = 'ZZ-DISCARD-TEST-filer-' + String.valueOf(Crypto.getRandomLong()),
            cm_Plan_Hash__c = 'feedface',
            cm_Plan_JSON__c = '{}',
            cm_Status__c = 'Completed',
            cm_Account__c = borrower().Id,
            cm_Product_Package__c = bookedPackageId(),
            cm_Result_Record_Id__c = String.valueOf(cloneId)
        );
        insert filer;
        Id anchoredId = [
            SELECT Id FROM cm_Action_Staging__c
            WHERE cm_Product_Package__c = :versionId AND cm_Action_Id__c = 'loan-modification' LIMIT 1
        ].Id;

        String k = key('row45');
        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, why(staged));

        Boolean saysTwo = false;
        for (String w : staged.result.warnings) {
            if (w.contains('2 action trail rows')) {
                saysTwo = true;
            }
        }
        System.assertEquals(true, saysTwo,
            'The banker confirms a count, so the plan must promise BOTH rows before the run touches either: ' +
            staged.result.warnings);

        // The stage's own reads stay outside the window: a stage plus a full execute do not fit one
        // governor budget otherwise (LESSONS 8j).
        Test.startTest();
        ExecuteDiscardVersion.Response done = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok, 'The discard should run, got ' + whyExec(done));
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Loan__c WHERE Id = :cloneId],
            'The clone is gone, which is what makes the filing row stale in the first place.');

        Map<Id, cm_Action_Staging__c> back = new Map<Id, cm_Action_Staging__c>([
            SELECT Id, cm_Status__c FROM cm_Action_Staging__c WHERE Id IN :new Set<Id>{ filer.Id, anchoredId }
        ]);
        System.assertEquals(2, back.size(), 'Neither row is ever deleted: the trail is the audit.');

        Boolean offered = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c')
            .contains(StageDiscardVersion.WITHDRAWN);
        if (offered) {
            System.assertEquals(StageDiscardVersion.WITHDRAWN, back.get(anchoredId).cm_Status__c,
                'The row anchored on the version is withdrawn, as it always was.');
            System.assertEquals(StageDiscardVersion.WITHDRAWN, back.get(filer.Id).cm_Status__c,
                'Row 45: the row that FILED the version is withdrawn too, though it is anchored on the source package.');
        } else {
            System.assertEquals('Completed', back.get(filer.Id).cm_Status__c,
                'With no Withdrawn value in the org the rows are left exactly as they stood, never restamped.');
        }
    }

    // -------------------------------------------------------------------------------------------
    // The relay leg, and its two doors (2026-09-15, backlog row 66).
    //
    // The MCP dispatcher context cannot host nCino's managed LoanTrigger, and deleting a revision-1
    // chain row wakes it on the booked parent, so a call that does not say inlineExecution is
    // relayed into a REST transaction instead of run here. Page.getContent() cannot be called from
    // a test method at all, so the session mint is reached through a seam. What is tested is the
    // DOOR ORDER and the safety rules around it: the outer leg writes NOTHING, refuses a bad token
    // before it costs a round trip, hands the inner answer back unedited, leaves the banker's
    // confirmation intact whenever the hop fails, and carries a RESUME through without consuming
    // anything a second time.
    // -------------------------------------------------------------------------------------------

    private static final String SELF_URL =
        URL.getOrgDomainUrl().toExternalForm() + '/services/data/v61.0/actions/custom/apex/ExecuteDiscardVersion';
    private static final String FAKE_SID = '00DDz000001qeO2!AQEAQFAKEsessionFORtestsONLY';

    /** The shape the MCP dispatcher sends: no inlineExecution, so the call is relayed. */
    private static ExecuteDiscardVersion.Response relayOf(String k, StageDiscardVersion.StageResult s) {
        return ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ execRequest(k, s) })[0];
    }

    /** A session mint that works. */
    private class GoodSession implements ExecuteDiscardVersion.SessionSource {
        public String sessionId() {
            return FAKE_SID;
        }
    }

    /** A session mint that does not, which is the whole reason a second door exists. */
    private class DeadSession implements ExecuteDiscardVersion.SessionSource {
        public String sessionId() {
            throw new CalloutException('getContent is not supported in this context');
        }
    }

    /**
     * Scripts both doors independently and records what each was sent.
     *
     * It answers anything that is NEITHER door with a bare 200, because only one mock can be armed
     * at a time and the CDC callout shield still has to hold underneath.
     */
    private class DoorMock implements HttpCalloutMock {
        Integer selfStatus = 200;
        String selfBody;
        Boolean selfThrows = false;
        Integer boxStatus = 200;
        String boxBody;
        Boolean boxThrows = false;
        HttpRequest sawSelf;
        HttpRequest sawBox;
        Integer selfCalls = 0;
        Integer boxCalls = 0;

        public HttpResponse respond(HttpRequest req) {
            HttpResponse r = new HttpResponse();
            if (req.getEndpoint() == SELF_URL) {
                selfCalls++;
                if (sawSelf == null) {
                    sawSelf = req;
                }
                if (selfThrows) {
                    throw new CalloutException('Read timed out');
                }
                r.setStatusCode(selfStatus);
                r.setBody(selfBody);
                return r;
            }
            if (req.getEndpoint() == RELAY_URL) {
                boxCalls++;
                if (sawBox == null) {
                    sawBox = req;
                }
                if (boxThrows) {
                    throw new CalloutException('Unable to tunnel through proxy');
                }
                r.setStatusCode(boxStatus);
                r.setBody(boxBody);
                return r;
            }
            r.setStatusCode(200);
            r.setBody('{}');
            return r;
        }
    }

    /** What the REST Actions API puts around an invocable's own answer. */
    private static String envelope(Object outputValues, Boolean isSuccess, Object errors) {
        return JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'actionName' => 'ExecuteDiscardVersion',
                'errors' => errors,
                'isSuccess' => isSuccess,
                'outputValues' => outputValues
            }
        });
    }

    /** A plausible inner success: enough of the real shape to prove the passthrough is faithful. */
    private static ExecuteDiscardVersion.Response innerSuccess(Id versionId) {
        ExecuteDiscardVersion.InventoryItem item = new ExecuteDiscardVersion.InventoryItem();
        item.objectName = 'LLC_BI__LoanRenewal__c';
        item.recordId = String.valueOf(C360Wave2Fixture.fakeId(LLC_BI__LoanRenewal__c.SObjectType));
        item.name = 'Renewal chain row on ZZ-INNER-CLONE';
        item.outcome = 'deleted';

        ExecuteDiscardVersion.StepResult step = new ExecuteDiscardVersion.StepResult();
        step.id = 'delete_chain';
        step.type = 'write';
        step.label = 'Remove the renewal chain rows';
        step.state = C360Plan.STATE_VERIFIED;
        step.detail = 'Every row in this group is gone.';

        ExecuteDiscardVersion.ExecuteResult r = new ExecuteDiscardVersion.ExecuteResult();
        r.versionPackageId = String.valueOf(versionId);
        r.deletedCount = 7;
        r.remainingCount = 0;
        r.terminalState = C360Plan.TERMINAL_SUCCESS;
        r.items = new List<ExecuteDiscardVersion.InventoryItem>{ item };
        r.steps = new List<ExecuteDiscardVersion.StepResult>{ step };
        r.parentsCleared = new List<String>{ 'ZZ-INNER-PARENT' };
        r.replayed = false;
        r.outcome = 'Version ' + versionId + ' discarded: 7 records deleted.';

        ExecuteDiscardVersion.Response answer = new ExecuteDiscardVersion.Response();
        answer.ok = true;
        answer.result = r;
        return answer;
    }

    /** Arms both seams and returns the mock, so each test says only what it is actually varying. */
    private static DoorMock doors(ExecuteDiscardVersion.SessionSource sess, Id versionId) {
        ExecuteDiscardVersion.sessionOverride = sess;
        DoorMock m = new DoorMock();
        m.selfBody = envelope(innerSuccess(versionId), true, null);
        m.boxBody = envelope(innerSuccess(versionId), true, null);
        Test.setMock(HttpCalloutMock.class, m);
        return m;
    }

    private static cm_Action_Staging__c rowState(Id stagingId) {
        return [
            SELECT cm_Status__c, cm_Token_Consumed_At__c, cm_Result_Record_Id__c
            FROM cm_Action_Staging__c WHERE Id = :stagingId
        ];
    }

    @IsTest
    static void theSelfDoorCarriesTheDiscardAndTheOuterLegWritesNothing() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('selfok');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        Test.stopTest();
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new GoodSession(), versionId);
        Integer dmlBefore = Limits.getDmlStatements();
        ExecuteDiscardVersion.Response done = relayOf(k, staged.result);
        Integer dmlAfter = Limits.getDmlStatements();

        System.assertNotEquals(null, m.sawSelf, 'A call without inlineExecution tries the org itself first');
        System.assertEquals('Bearer ' + FAKE_SID, m.sawSelf.getHeader('Authorization'),
            'The Visualforce session IS the credential: hosted MCP runs on a JWT that UserInfo.getSessionId cannot use');
        System.assertEquals(null, m.sawBox, 'The external relay is a fallback, not a first choice');
        System.assertEquals(PATH_SELF, done.result.relayPath, 'And the answer says which door carried it');
        System.assertEquals(1, m.selfCalls, 'A discard runs no engine, so it takes ONE hop, not the modification\'s two');

        // The inner leg is told to execute inline, which is also what stops it relaying again.
        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(m.sawSelf.getBody());
        Map<String, Object> input = (Map<String, Object>) ((List<Object>) sent.get('inputs'))[0];
        System.assertEquals(true, input.get('inlineExecution'), 'The recursion guard IS the inline flag on the inner call');
        System.assertEquals(staged.result.decisionToken, input.get('decisionToken'), 'The inner leg needs the token to burn it');
        System.assertEquals(k, input.get('idempotencyKey'));
        System.assertEquals(staged.result.stagingId, input.get('stagingId'));

        // The outer leg wrote nothing. Apex forbids DML before a callout, and a claim out here would
        // strand the row at Executing on a hop that never arrived.
        System.assertEquals(dmlBefore, dmlAfter, 'The relay leg performs no DML at all');
        cm_Action_Staging__c row = rowState(staged.result.stagingId);
        System.assertEquals(null, row.cm_Token_Consumed_At__c,
            'The OUTER leg never burns the token: the inner one does, inside the transaction that works');
        System.assertEquals('Staged', row.cm_Status__c, 'And it never moves the row either');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'It certainly deletes nothing');

        // The answer is the inner leg's answer.
        System.assertEquals(true, done.ok, 'The inner leg succeeded, so this call succeeded');
        System.assertEquals(C360Plan.TERMINAL_SUCCESS, done.result.terminalState);
        System.assertEquals(7, done.result.deletedCount, 'Counts survive the round trip');
        System.assertEquals('deleted', done.result.items[0].outcome, 'And so does every inventory line the banker reads');
        System.assertEquals('delete_chain', done.result.steps[0].id, 'And the tracker steps, which the panel renders');
    }

    @IsTest
    static void aSessionThatCannotBeMintedFallsThroughToTheBoxRelayWithItsSecretAndItsAction() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('nosession');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        Test.stopTest();
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new DeadSession(), versionId);
        ExecuteDiscardVersion.Response done = relayOf(k, staged.result);

        System.assertEquals(null, m.sawSelf, 'With no session there is nothing to send, so nothing is sent');
        System.assertNotEquals(null, m.sawBox, 'Which is exactly the case the box relay exists for');
        System.assertEquals(RELAY_SECRET, m.sawBox.getHeader('x-c360-relay-secret'),
            'The relay refuses anything unsigned, so an unsigned hop is a broken hop');
        System.assertEquals('ExecuteDiscardVersion', m.sawBox.getHeader('x-c360-action'),
            'The relay carries an allow-list now, so the hop has to name which action it wants');
        System.assertEquals(true, done.ok, whyExec(done));
        System.assertEquals(PATH_BOX, done.result.relayPath, 'The answer names the door that actually carried it');
    }

    @IsTest
    static void bothDoorsDownLeavesTheTokenGoodForARetryAndDeletesNothing() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('alldown');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        Test.stopTest();
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new GoodSession(), versionId);
        m.selfThrows = true;
        m.boxThrows = true;
        ExecuteDiscardVersion.Response res = relayOf(k, staged.result);

        System.assertEquals(false, res.ok);
        System.assertEquals('ORG_UNAVAILABLE', res.error.code);
        System.assertEquals(true, res.error.resumable, 'Nothing was attempted, so this same call is the retry');
        System.assert(res.error.message.contains('has not been used'),
            'The banker is told plainly the confirmation still stands: ' + res.error.message);
        System.assert(res.error.orgError.contains('self:') && res.error.orgError.contains('box:'),
            'Both doors report why they did not carry it: ' + res.error.orgError);

        cm_Action_Staging__c row = rowState(staged.result.stagingId);
        System.assertEquals(null, row.cm_Token_Consumed_At__c, 'And the confirmation does still stand');
        System.assertEquals('Staged', row.cm_Status__c, 'The row is exactly where the stage left it');
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void aDoorThatAnswersNon200IsReportedRatherThanRetriedThroughTheOther() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('self500');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        Test.stopTest();
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new GoodSession(), versionId);
        m.selfStatus = 500;
        m.selfBody = '[{"message":"An unexpected error occurred","errorCode":"UNKNOWN_EXCEPTION"}]';
        ExecuteDiscardVersion.Response res = relayOf(k, staged.result);

        System.assertEquals(null, m.sawBox,
            'A 500 landed on something that COULD have deleted. Trying the other door would be a second run, not a retry');
        System.assertEquals(false, res.ok);
        System.assertEquals('ORG_UNAVAILABLE', res.error.code, 'The path failed. The org refused nothing and neither did we');
        System.assertEquals(true, res.error.resumable, 'The token gate and the frozen plan make a retry safe even here');
        System.assert(res.error.orgError.contains('500'), 'The refusal carries what the door actually said: ' + res.error.orgError);
        System.assertEquals(null, rowState(staged.result.stagingId).cm_Token_Consumed_At__c);
    }

    @IsTest
    static void theRelayLegRefusesABadTokenBeforeItCostsARoundTrip() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('relaybadtoken');

        Test.startTest();
        StageDiscardVersion.Response staged = stage(k, versionId);
        Test.stopTest();
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new GoodSession(), versionId);
        ExecuteDiscardVersion.Request r = execRequest(k, staged.result);
        r.decisionToken = 'not-the-token-the-banker-was-given';
        ExecuteDiscardVersion.Response res = ExecuteDiscardVersion.run(new List<ExecuteDiscardVersion.Request>{ r })[0];

        System.assertEquals(false, res.ok);
        System.assertEquals('TOKEN_REFUSED', res.error.code, 'The token gate is enforced on the OUTER leg too, not only inside');
        System.assertEquals(null, m.sawSelf, 'A refused call must never reach a door');
        System.assertEquals(null, m.sawBox);
        System.assertEquals(1, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId], 'Nothing was deleted.');
    }

    @IsTest
    static void theInlineFlagRunsTheChainHereAndTouchesNoDoorAtAll() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('inline');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, why(staged));

        DoorMock m = doors(new GoodSession(), versionId);
        Test.startTest();
        ExecuteDiscardVersion.Response done = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, done.ok, whyExec(done));
        System.assertEquals(null, m.sawSelf, 'The inline flag IS the recursion guard: an inner leg never relays again');
        System.assertEquals(null, m.sawBox);
        System.assertEquals(null, done.result.relayPath, 'An inline run went through no door at all');
        System.assertEquals(0, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'And it really deleted the version, here, in this transaction');
    }

    @IsTest
    static void aRelayedReplayReportsThePriorRunWithoutHopping() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('relayreplay');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, why(staged));

        Test.startTest();
        ExecuteDiscardVersion.Response first = executeOf(k, staged.result);
        Test.stopTest();
        System.assertEquals(true, first.ok, 'first execute should succeed: ' + whyExec(first));

        DoorMock m = doors(new GoodSession(), versionId);
        ExecuteDiscardVersion.Response again = relayOf(k, staged.result);

        System.assertEquals(true, again.ok, 'A replay is a successful invocation on either leg');
        System.assertEquals(true, again.result.replayed);
        System.assertEquals(0, again.result.deletedCount, 'A replay deletes nothing');
        System.assertEquals(null, m.sawSelf, 'And answers it locally: a finished key is not worth a round trip');
        System.assertEquals(null, m.sawBox);
    }

    /**
     * The resume crosses the hop, which is the property the two legs could most easily have broken.
     *
     * A run that stopped mid-chain has ALREADY consumed its token, so an outer leg that checked
     * `assertClaimable` would refuse the banker's own resume as a spent token and never reach the
     * door. It checks `assertArmable` instead: the same token, the same plan and the same named
     * human against a row the first leg left open, consuming nothing.
     */
    @IsTest
    static void aStoppedRunResumesThroughTheDoorAndTheTokenIsNotSpentTwice() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('relayresume');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, why(staged));

        Test.startTest();
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_members';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        Test.stopTest();

        System.assertEquals(true, stopped.ok, 'A stopped chain is an answer, not a fault. ' + whyExec(stopped));
        System.assertEquals(C360Plan.TERMINAL_PARTIAL, stopped.result.terminalState, stopped.result.outcome);
        cm_Action_Staging__c open = rowState(staged.result.stagingId);
        System.assertEquals('Executing', open.cm_Status__c, 'The run stays open, which is what makes the key resumable');
        System.assertNotEquals(null, open.cm_Token_Consumed_At__c, 'And its token is already spent');

        DoorMock m = doors(new GoodSession(), versionId);
        ExecuteDiscardVersion.Response resumed = relayOf(k, staged.result);

        System.assertEquals(true, resumed.ok, whyExec(resumed));
        System.assertNotEquals(null, m.sawSelf, 'A resume is relayed like any other execute: the inner leg does the deleting');
        System.assertEquals(PATH_SELF, resumed.result.relayPath);
        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(m.sawSelf.getBody());
        Map<String, Object> input = (Map<String, Object>) ((List<Object>) sent.get('inputs'))[0];
        System.assertEquals(staged.result.decisionToken, input.get('decisionToken'),
            'The inner leg proves the same token again, and consumes nothing a second time');

        cm_Action_Staging__c after = rowState(staged.result.stagingId);
        System.assertEquals(open.cm_Token_Consumed_At__c, after.cm_Token_Consumed_At__c,
            'The outer leg re-asserted the token read-only: the consumption stamp is the one the first leg wrote');
        System.assertEquals('Executing', after.cm_Status__c, 'And the row is still the inner leg\'s to move');
    }

    /**
     * The hop fails on a resume. The token was spent by the leg that stopped, so "resumable" here
     * means the frozen plan and the open row are still exactly as they were, and the same call is
     * the retry once the path is back.
     */
    @IsTest
    static void aResumeWhoseDoorIsDownLeavesTheStoppedRunExactlyAsItStood() {
        C360TestFixture.armCalloutMock();
        Id versionId = versionPackageId();
        String k = key('resumedown');

        StageDiscardVersion.Response staged = stage(k, versionId);
        System.assertEquals(true, staged.ok, why(staged));

        Test.startTest();
        ExecuteDiscardVersion.refuseGroupOnce = 'delete_members';
        ExecuteDiscardVersion.Response stopped = executeOf(k, staged.result);
        Test.stopTest();
        System.assertEquals(true, stopped.ok, whyExec(stopped));
        Integer standing = [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId];
        cm_Action_Staging__c open = rowState(staged.result.stagingId);

        DoorMock m = doors(new GoodSession(), versionId);
        m.selfThrows = true;
        m.boxThrows = true;
        ExecuteDiscardVersion.Response res = relayOf(k, staged.result);

        System.assertEquals(false, res.ok);
        System.assertEquals('ORG_UNAVAILABLE', res.error.code);
        System.assertEquals(true, res.error.resumable, 'The stopped run is still resumable, and this call is the retry');
        cm_Action_Staging__c after = rowState(staged.result.stagingId);
        System.assertEquals(open.cm_Status__c, after.cm_Status__c, 'A hop that never landed changes nothing');
        System.assertEquals(open.cm_Result_Record_Id__c, after.cm_Result_Record_Id__c);
        System.assertEquals(standing, [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionId],
            'And deletes nothing further');
    }
}
