/**
 * StageExecuteAmendVersionTest - the amend-version pair, end to end.
 *
 * FOUR THINGS THIS FILE EXISTS TO ASSERT, in the order they matter.
 *
 *   1. THE GATE, on all four shapes it has to tell apart: a booked package (PACKAGE_BOOKED), a
 *      version one of whose members has reached Approval / Loan Committee (VERSION_NOT_EDITABLE),
 *      a version below it (accepted), and a package that is neither (NOT_A_VERSION). The gate is
 *      the whole safety story of this tool, so each answer is asserted by CODE rather than by the
 *      absence of a crash.
 *   2. WHERE THE WRITES LAND. Every arm lands on the VERSION'S OWN LOAN. There is no clone, so the
 *      assertion is direct: the record the plan named is the record that moved, and it is read back
 *      out of the org rather than trusted from the DML result.
 *   3. WHAT IS REFUSED BY NAME. A target outside the version, a request with no arm at all, and a
 *      borrowing-structure REMOVE, which on a version would be a real delete rather than the carry
 *      exclusion a modification can express.
 *   4. THAT THE GATE IS RE-READ AT EXECUTE. A plan staged against an editable version and executed
 *      after a member climbed to approval is refused with nothing written. That is the one
 *      assertion no amount of stage-time care can substitute for.
 *
 * ONE FIXTURE PER CLASS, not per method: every DML in this org flushes a change-data queueable, and
 * a Loan insert wakes five managed namespaces and 21 validation rules (probe 5). Per-method anchors
 * are how a suite of this size stops meeting the time limit instead of the assertion it came for.
 *
 * THE BOOKED FIXTURE IS INSERTED AT Booked, NOT MOVED THERE (LESSONS 15y). Loan_Validation_06 keys
 * on ISPICKVAL(PRIORVALUE(Stage)), which is blank on an insert, so a facility filed AT Booked with
 * LLC_BI__lookupKey__c set to satisfy LV05 never trips it. Insert-at-Booked and transition-to-Booked
 * are different questions with different answers, and only the first one is available here.
 */
@IsTest
private class StageExecuteAmendVersionTest {

    /**
     * ONE ACCOUNT PER SCENARIO, and the packages are found THROUGH it.
     *
     * The first cut keyed the packages by their own Name and every fixture lookup came back empty:
     * this org rewrites names on save, the way probe 5 proved it does on Loan, so a Name-keyed
     * fixture query silently returns zero rows and every dependent assertion dies somewhere that is
     * not the bug (LESSONS 16b). Account names survive. So each package hangs off an account of its
     * own and is read back through the relationship, which is the rule rather than a workaround.
     */
    private static final String ACCOUNT_NAME = 'ZZ-AV-TEST Borrower';
    private static final String LOCKED_ACCOUNT = 'ZZ-AV-TEST Locked Borrower';
    private static final String BOOKED_ACCOUNT = 'ZZ-AV-TEST Booked Borrower';
    private static final String DRAFT_ACCOUNT = 'ZZ-AV-TEST Draft Borrower';
    private static final String EMPTY_ACCOUNT = 'ZZ-AV-TEST Empty Borrower';
    private static final String COVENANT_TYPE_NAME = 'ZZ-AV-TEST Debt Service Coverage';
    private static final String COLLATERAL_TYPE_NAME = 'ZZ-AV-TEST Equipment';
    private static final String GUARANTOR_NAME = 'ZZ-AV-TEST Guarantor';
    private static final String APPROVAL_STAGE = 'Approval / Loan Committee';

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();

        Account borrower = new Account(Name = ACCOUNT_NAME);
        Account lockedOwner = new Account(Name = LOCKED_ACCOUNT);
        Account bookedOwner = new Account(Name = BOOKED_ACCOUNT);
        Account draftOwner = new Account(Name = DRAFT_ACCOUNT);
        Account emptyOwner = new Account(Name = EMPTY_ACCOUNT);
        Account guarantor = new Account(Name = GUARANTOR_NAME);
        insert new List<Account>{ borrower, lockedOwner, bookedOwner, draftOwner, emptyOwner, guarantor };

        insert new LLC_BI__Covenant_Type__c(Name = COVENANT_TYPE_NAME);
        // The org's Advance_Rate_should_not_be_null rule refuses a collateral created against a type
        // with no rate, and it surfaces on the ASSET insert rather than on the type.
        LLC_BI__Collateral_Type__c collType =
            new LLC_BI__Collateral_Type__c(Name = COLLATERAL_TYPE_NAME, LLC_BI__Advance_Rate__c = 50);
        insert collType;

        LLC_BI__Product_Package__c version = pkg('ZZ-AV-TEST Version', borrower.Id, 'Pending');
        LLC_BI__Product_Package__c locked = pkg('ZZ-AV-TEST Locked', lockedOwner.Id, 'Pending');
        LLC_BI__Product_Package__c booked = pkg('ZZ-AV-TEST Booked', bookedOwner.Id, 'In Review');
        LLC_BI__Product_Package__c draft = pkg('ZZ-AV-TEST Draft', draftOwner.Id, 'Pending');
        LLC_BI__Product_Package__c empty = pkg('ZZ-AV-TEST Empty', emptyOwner.Id, 'Pending');
        insert new List<LLC_BI__Product_Package__c>{ version, locked, booked, draft, empty };

        List<LLC_BI__Loan__c> loans = new List<LLC_BI__Loan__c>();
        // The version: two members, both below approval, both flagged as a modification. Either flag
        // or a chain row is enough to make a package a version; the flag is the one a fixture can
        // set without inventing a booked parent.
        loans.add(loan(borrower.Id, version.Id, 'Qualification', 5000000, true));
        loans.add(loan(borrower.Id, version.Id, 'Proposal', 3000000, true));
        // The version the org has taken. One member at the rung locks the whole package.
        loans.add(loan(lockedOwner.Id, locked.Id, APPROVAL_STAGE, 4000000, true));
        // Live business. Filed AT Booked with a lookup key, never moved there.
        LLC_BI__Loan__c bookedLoan = loan(bookedOwner.Id, booked.Id, 'Booked', 2000000, false);
        bookedLoan.LLC_BI__lookupKey__c = 'ZZ-AV-TEST-BOOKED-1';
        bookedLoan.LLC_BI__Status__c = 'Open';
        loans.add(bookedLoan);
        // A package the cockpit created: no modification flag anywhere, package stage before
        // approval, no booked member. The second of the gate's two accepted shapes.
        loans.add(loan(draftOwner.Id, draft.Id, 'Qualification', 1500000, false));
        insert loans;

        // An asset the borrower owns, for the pledge arm, plus the ownership junction that is the
        // asset's ONLY link to the relationship on this org.
        LLC_BI__Collateral__c asset = new LLC_BI__Collateral__c(
            LLC_BI__Collateral_Type__c = collType.Id,
            LLC_BI__Value__c = 1000000,
            LLC_BI__Description__c = 'ZZ-AV-TEST machining line'
        );
        insert asset;
        insert new LLC_BI__Account_Collateral__c(
            LLC_BI__Account__c = borrower.Id,
            LLC_BI__Collateral__c = asset.Id,
            LLC_BI__Ownership_Percentage__c = 100,
            LLC_BI__Primary_Owner__c = true
        );

        // A covenant the borrower already holds at relationship level: it carries an account
        // association and NO loan junction, which is exactly what the association arm is for.
        LLC_BI__Covenant2__c cov = new LLC_BI__Covenant2__c(
            LLC_BI__Account__c = borrower.Id,
            LLC_BI__Covenant_Type__c = [SELECT Id FROM LLC_BI__Covenant_Type__c WHERE Name = :COVENANT_TYPE_NAME LIMIT 1].Id,
            LLC_BI__Financial_Indicator_Value__c = 1.25,
            LLC_BI__Covenant_Status__c = 'Pending',
            LLC_BI__Active__c = true
        );
        insert cov;
        insert new LLC_BI__Account_Covenant__c(
            LLC_BI__Account__c = borrower.Id,
            LLC_BI__Covenant2__c = cov.Id
        );
    }

    private static LLC_BI__Product_Package__c pkg(String name, Id accountId, String stage) {
        return new LLC_BI__Product_Package__c(
            Name = name,
            LLC_BI__Account__c = accountId,
            LLC_BI__Stage__c = stage,
            LLC_BI__Status__c = 'New'
        );
    }

    private static LLC_BI__Loan__c loan(Id accountId, Id packageId, String stage, Decimal amount, Boolean isModification) {
        return new LLC_BI__Loan__c(
            LLC_BI__Account__c = accountId,
            LLC_BI__Product_Package__c = packageId,
            LLC_BI__Stage__c = stage,
            LLC_BI__Status__c = 'Open',
            LLC_BI__isRenewal__c = false,
            LLC_BI__Is_Modification__c = isModification,
            LLC_BI__Amount__c = amount,
            LLC_BI__Term_Months__c = 60
        );
    }

    /* ------------------------------------------------------------------ fixture lookups */

    private static Account accountNamed(String name) {
        List<Account> rows = [SELECT Id, Name FROM Account WHERE Name = :name];
        Assert.areEqual(1, rows.size(), 'Fixture account "' + name + '" missing or duplicated.');
        return rows[0];
    }

    private static Account borrower() {
        return accountNamed(ACCOUNT_NAME);
    }

    /** The one package on a scenario's own account. Read through the relationship, never by Name. */
    private static LLC_BI__Product_Package__c packageOf(String accountName) {
        List<LLC_BI__Product_Package__c> rows = [
            SELECT Id, Name, LLC_BI__Stage__c FROM LLC_BI__Product_Package__c
            WHERE LLC_BI__Account__c = :accountNamed(accountName).Id
        ];
        Assert.areEqual(1, rows.size(), 'Fixture package for "' + accountName + '" missing or duplicated.');
        return rows[0];
    }

    /**
     * Members of one scenario's package, ordered by commitment so the order is a FACT rather than a
     * string comparison: nCino rebuilds a loan's Name from its own commitment on every save (probe
     * 5), so ordering by Name would change under the very writes these tests make.
     */
    private static List<LLC_BI__Loan__c> membersOf(String accountName) {
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Amount__c, LLC_BI__InterestRate__c,
                   LLC_BI__Term_Months__c, LLC_BI__Amortized_Term_Months__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Product_Package__c = :packageOf(accountName).Id
            ORDER BY LLC_BI__Amount__c DESC
        ];
    }

    private static String key(String label) {
        return 'ZZ-AV-' + label + '-' + String.valueOf(Crypto.getRandomLong());
    }

    /** The tool's own refusal, so a failed assert names the cause instead of hiding it. */
    private static String why(StageAmendVersion.Response r) {
        return r.error == null ? '(no error reported)' : r.error.code + ' :: ' + r.error.message;
    }

    private static String why(ExecuteAmendVersion.Response r) {
        return r.error == null ? '(no error reported)' : r.error.code + ' :: ' + r.error.message;
    }

    private static StageAmendVersion.Request req(String k, Id versionPackageId) {
        StageAmendVersion.Request r = new StageAmendVersion.Request();
        r.idempotencyKey = k;
        r.versionPackageId = versionPackageId;
        r.rationale = 'Banker reshaped the version before it goes to committee.';
        return r;
    }

    private static StageAmendVersion.Response stage(StageAmendVersion.Request r) {
        return StageAmendVersion.stage(new List<StageAmendVersion.Request>{ r })[0];
    }

    private static ExecuteAmendVersion.Response executeStaged(String k, StageAmendVersion.StageResult staged) {
        ExecuteAmendVersion.Request ex = new ExecuteAmendVersion.Request();
        ex.idempotencyKey = k;
        ex.stagingId = staged.stagingId;
        ex.planHash = staged.planHash;
        ex.decisionToken = staged.decisionToken;
        ex.approverUserId = UserInfo.getUserId();
        return ExecuteAmendVersion.run(new List<ExecuteAmendVersion.Request>{ ex })[0];
    }

    private static String scalars(Id targetLoanId, String scalarKey, Object value) {
        return JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'key' => scalarKey, 'value' => value, 'targetLoanId' => targetLoanId }
        });
    }

    /* ================================================================== THE GATE */

    @IsTest
    static void gateRefusesABookedPackage() {
        String k = key('booked');
        StageAmendVersion.Request r = req(k, packageOf(BOOKED_ACCOUNT).Id);
        List<LLC_BI__Loan__c> members = membersOf(BOOKED_ACCOUNT);
        r.scalarChangesJson = scalars(members[0].Id, 'requestedRate', 7.10);

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isFalse(res.ok, 'A booked package must never be amendable. Got: ' + why(res));
        Assert.areEqual('PACKAGE_BOOKED', res.error.code, 'Wrong refusal code: ' + why(res));
        Assert.isTrue(
            res.error.message.contains('Booked'),
            'The refusal must carry the org\'s own stage so the banker can see why: ' + res.error.message
        );
        Assert.isTrue(
            res.error.message.contains('MODIFICATION'),
            'The refusal must name the action that IS available: ' + res.error.message
        );
    }

    @IsTest
    static void gateRefusesAVersionAtApproval() {
        String k = key('locked');
        StageAmendVersion.Request r = req(k, packageOf(LOCKED_ACCOUNT).Id);
        List<LLC_BI__Loan__c> members = membersOf(LOCKED_ACCOUNT);
        r.scalarChangesJson = scalars(members[0].Id, 'requestedRate', 7.10);

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isFalse(res.ok, 'A version at approval is out of the banker\'s hands. Got: ' + why(res));
        Assert.areEqual('VERSION_NOT_EDITABLE', res.error.code, 'Wrong refusal code: ' + why(res));
        Assert.isTrue(
            res.error.message.contains(APPROVAL_STAGE),
            'The refusal must name the rung, verbatim, as the org spells it: ' + res.error.message
        );
    }

    @IsTest
    static void gateAcceptsAVersionBeforeApproval() {
        String k = key('editable');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        List<LLC_BI__Loan__c> members = membersOf(ACCOUNT_NAME);
        r.scalarChangesJson = scalars(members[0].Id, 'requestedRate', 7.10);

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isTrue(res.ok, 'An editable version must stage. Got: ' + why(res));
        Assert.areEqual('in-flight version', res.result.versionKind, 'The gate mis-classified the package.');
        Assert.areEqual(2, res.result.memberCount, 'The version holds two facilities.');
        Assert.areEqual(1, res.result.facilityCount, 'Only the named facility is touched.');
        Assert.areEqual(members[0].Id, res.result.facilities[0].facilityId, 'The plan named the wrong facility.');
        Assert.isFalse(res.result.executionHeld, 'An amend is never held: it is refused or it runs.');
        Assert.isNotNull(res.result.decisionToken, 'A fresh stage mints a token.');

        // The from -> to report the contract asks for, on the one field that moves.
        Assert.areEqual(
            new List<String>{ 'LLC_BI__InterestRate__c' },
            res.result.facilities[0].fields,
            'The plan must name the field that moves.'
        );
        Assert.areEqual('7.10', res.result.facilities[0].toValues[0], 'The plan must carry the figure the banker confirmed.');
    }

    @IsTest
    static void gateAcceptsACockpitPackageBeforeApproval() {
        String k = key('draft');
        StageAmendVersion.Request r = req(k, packageOf(DRAFT_ACCOUNT).Id);
        r.scalarChangesJson = scalars(membersOf(DRAFT_ACCOUNT)[0].Id, 'requestedAmount', 1750000);

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isTrue(res.ok, 'A cockpit-created package before approval is amendable. Got: ' + why(res));
        Assert.areEqual(
            'cockpit package before approval', res.result.versionKind,
            'No member carries a modification flag, so this is the second accepted shape, not the first.'
        );
    }

    @IsTest
    static void gateRefusesAPackageWithNoFacility() {
        String k = key('empty');
        StageAmendVersion.Request r = req(k, packageOf(EMPTY_ACCOUNT).Id);
        r.fieldChangesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'field' => 'LLC_BI__Amortized_Term_Months__c', 'value' => 120 }
        });

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isFalse(res.ok, 'A package with no facility has nothing to amend. Got: ' + why(res));
        Assert.areEqual('NOT_A_VERSION', res.error.code, 'Wrong refusal code: ' + why(res));
    }

    @IsTest
    static void gateRefusesATargetOutsideTheVersion() {
        String k = key('foreign');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        // A real facility, on another package on the same relationship. The nastiest shape there is:
        // everything about it reads valid except the one thing that matters.
        r.scalarChangesJson = scalars(membersOf(DRAFT_ACCOUNT)[0].Id, 'requestedRate', 7.10);

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isFalse(res.ok, 'A facility outside the version is not this plan\'s to touch. Got: ' + why(res));
        Assert.areEqual('TARGET_NOT_IN_VERSION', res.error.code, 'Wrong refusal code: ' + why(res));
        Assert.isTrue(
            res.error.message.contains(membersOf(ACCOUNT_NAME)[0].Name),
            'The refusal must list the legal targets by name: ' + res.error.message
        );
    }

    @IsTest
    static void stageRefusesARequestCarryingNoArm() {
        String k = key('noarms');

        Test.startTest();
        StageAmendVersion.Response res = stage(req(k, packageOf(ACCOUNT_NAME).Id));
        Test.stopTest();

        Assert.isFalse(res.ok, 'An amend with no change is not an amend. Got: ' + why(res));
        Assert.areEqual('NO_ARMS', res.error.code, 'Wrong refusal code: ' + why(res));
    }

    @IsTest
    static void stageRefusesABorrowingStructureRemove() {
        String k = key('remove');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.involvementChangesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'op' => 'remove',
                'role' => 'Guarantor',
                'accountName' => GUARANTOR_NAME,
                'targetLoanId' => membersOf(ACCOUNT_NAME)[0].Id
            }
        });

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isFalse(res.ok, 'A remove on a version would be a real delete. Got: ' + why(res));
        Assert.isTrue(
            res.error.message.contains('delete'),
            'The refusal must say plainly that nothing in this package deletes: ' + res.error.message
        );
    }

    @IsTest
    static void stageWritesNoDomainRecord() {
        Integer loansBefore = [SELECT COUNT() FROM LLC_BI__Loan__c];
        Integer covenantsBefore = [SELECT COUNT() FROM LLC_BI__Covenant2__c];
        Integer feesBefore = [SELECT COUNT() FROM LLC_BI__Fee__c];

        String k = key('zerodml');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.scalarChangesJson = scalars(membersOf(ACCOUNT_NAME)[0].Id, 'requestedAmount', 6000000);
        r.covenantAddsJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'typeName' => COVENANT_TYPE_NAME, 'threshold' => 1.35, 'operator' => '>=',
                'targetLoanId' => membersOf(ACCOUNT_NAME)[0].Id
            }
        });

        Test.startTest();
        StageAmendVersion.Response res = stage(r);
        Test.stopTest();

        Assert.isTrue(res.ok, 'The plan must stage. Got: ' + why(res));
        Assert.areEqual(loansBefore, [SELECT COUNT() FROM LLC_BI__Loan__c], 'stage_* writes no facility.');
        Assert.areEqual(covenantsBefore, [SELECT COUNT() FROM LLC_BI__Covenant2__c], 'stage_* writes no covenant.');
        Assert.areEqual(feesBefore, [SELECT COUNT() FROM LLC_BI__Fee__c], 'stage_* writes no fee.');
    }

    /* ================================================================== THE WRITES */

    @IsTest
    static void executeMovesTheFiguresOnTheVersionLoanItself() {
        C360TestFixture.armCalloutMock();
        List<LLC_BI__Loan__c> members = membersOf(ACCOUNT_NAME);
        Id target = members[0].Id;
        Id untouched = members[1].Id;
        Decimal untouchedAmountBefore = members[1].LLC_BI__Amount__c;

        String k = key('figures');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.scalarChangesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'key' => 'requestedRate', 'value' => 7.10, 'targetLoanId' => target },
            new Map<String, Object>{ 'key' => 'requestedAmount', 'value' => 6500000, 'targetLoanId' => target }
        });
        r.fieldChangesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'field' => 'LLC_BI__Amortized_Term_Months__c', 'value' => 240, 'targetLoanId' => target
            }
        });

        Test.startTest();
        StageAmendVersion.Response staged = stage(r);
        Assert.isTrue(staged.ok, 'The plan must stage. Got: ' + why(staged));
        ExecuteAmendVersion.Response res = executeStaged(k, staged.result);
        Test.stopTest();

        Assert.isTrue(res.ok, 'The amend must execute. Got: ' + why(res));
        Assert.areEqual(C360Plan.TERMINAL_SUCCESS, res.result.terminalState,
            'Every step should verify. Outcome: ' + res.result.outcome);
        Assert.areEqual(1, res.result.facilityCount, 'One facility was amended.');
        Assert.areEqual(String.valueOf(target), res.result.facilities[0].facilityId,
            'The write must land on the version\'s own loan, not on anything else.');

        // THE PROOF IS THE RE-QUERY, never the result object.
        LLC_BI__Loan__c after = [
            SELECT Id, LLC_BI__Amount__c, LLC_BI__InterestRate__c, LLC_BI__Amortized_Term_Months__c
            FROM LLC_BI__Loan__c WHERE Id = :target
        ];
        Assert.areEqual(6500000, after.LLC_BI__Amount__c, 'The commitment did not land on the version loan.');
        Assert.areEqual(7.10, after.LLC_BI__InterestRate__c, 'The rate did not land on the version loan.');
        Assert.areEqual(240, after.LLC_BI__Amortized_Term_Months__c, 'The field wave did not land on the version loan.');

        // NO BROADCAST. The other member of the same version was never named and must not move.
        LLC_BI__Loan__c other = [SELECT Id, LLC_BI__Amount__c, LLC_BI__InterestRate__c FROM LLC_BI__Loan__c WHERE Id = :untouched];
        Assert.areEqual(untouchedAmountBefore, other.LLC_BI__Amount__c,
            'A figure aimed at one member must never reach another.');
        Assert.isNull(other.LLC_BI__InterestRate__c, 'A rate aimed at one member must never reach another.');

        // NO CLONE, NO NEW PACKAGE. The version still holds exactly its two members.
        Assert.areEqual(2, [
            SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :packageOf(ACCOUNT_NAME).Id
        ], 'An amend creates no clone and files no facility.');
        Assert.areEqual(1, [
            SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE LLC_BI__Account__c = :borrower().Id
        ], 'An amend mints no package version.');
    }

    @IsTest
    static void executeAuthorsEveryChildArmOnTheVersionLoan() {
        C360TestFixture.armCalloutMock();
        Id target = membersOf(ACCOUNT_NAME)[0].Id;
        Id assetId = [SELECT Id FROM LLC_BI__Collateral__c WHERE LLC_BI__Description__c = 'ZZ-AV-TEST machining line' LIMIT 1].Id;
        Id existingCovenantId = [SELECT Id FROM LLC_BI__Covenant2__c WHERE LLC_BI__Account__c = :borrower().Id LIMIT 1].Id;

        String k = key('arms');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.covenantAddsJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'typeName' => COVENANT_TYPE_NAME, 'threshold' => 1.40, 'operator' => '>=',
                'frequency' => 'Quarterly', 'effectiveDate' => '2026-10-01', 'targetLoanId' => target
            }
        });
        r.covenantAttachesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'covenantId' => existingCovenantId, 'targetLoanId' => target }
        });
        r.involvementChangesJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'op' => 'add', 'role' => 'Guarantor', 'accountName' => GUARANTOR_NAME,
                'ownership' => 100, 'targetLoanId' => target
            }
        });
        r.feeAddsJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'feeType' => 'Appraisal', 'description' => 'ZZ-AV-TEST appraisal fee',
                'calculationType' => 'Flat Amount', 'amount' => 4500, 'targetLoanId' => target
            }
        });
        r.pledgeAddsJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{ 'collateralId' => assetId, 'targetLoanId' => target }
        });

        Test.startTest();
        StageAmendVersion.Response staged = stage(r);
        Assert.isTrue(staged.ok, 'The plan must stage. Got: ' + why(staged));
        ExecuteAmendVersion.Response res = executeStaged(k, staged.result);
        Test.stopTest();

        Assert.isTrue(res.ok, 'The arms must execute. Got: ' + why(res));

        // Every one of these is read back OUT OF THE ORG against the version loan's own id.
        Assert.areEqual(2, [
            SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :target
        ], 'One covenant created and one associated makes two junctions on the version loan.');
        Assert.areEqual(1, [
            SELECT COUNT() FROM LLC_BI__Covenant2__c
            WHERE LLC_BI__Account__c = :borrower().Id AND LLC_BI__Financial_Indicator_Value__c = 1.40
        ], 'The net-new covenant must exist on the borrower.');
        Assert.areEqual(1, [
            SELECT COUNT() FROM LLC_BI__Legal_Entities__c
            WHERE LLC_BI__Loan__c = :target AND LLC_BI__Borrower_Type__c = 'Guarantor'
        ], 'The guarantor row must be on the version loan.');
        List<LLC_BI__Fee__c> fees = [
            SELECT Id, LLC_BI__Amount__c, LLC_BI__Fee_Type_Description__c FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :target
        ];
        Assert.areEqual(1, fees.size(), 'The fee must be on the version loan.');
        Assert.areEqual(4500, fees[0].LLC_BI__Amount__c, 'A flat fee carries the amount this plan staged.');
        List<LLC_BI__Loan_Collateral2__c> pledges = [
            SELECT Id, LLC_BI__Collateral__c, LLC_BI__Loan_Collateral_Aggregate__c, LLC_BI__Amount_Pledged__c
            FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :target
        ];
        Assert.areEqual(1, pledges.size(), 'The pledge must be on the version loan.');
        Assert.areEqual(assetId, pledges[0].LLC_BI__Collateral__c, 'The pledge must name the asset the plan named.');
        Assert.isNotNull(pledges[0].LLC_BI__Loan_Collateral_Aggregate__c,
            'A pledge needs THREE parents: the aggregate shell has to exist before the insert, because the lookup is not updateable afterwards.');

        // NOTHING LANDED ON THE OTHER MEMBER. The arms all named one facility.
        Id untouched = membersOf(ACCOUNT_NAME)[1].Id;
        Assert.areEqual(0, [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :untouched],
            'An arm aimed at one member must never reach another.');
        Assert.areEqual(0, [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :untouched],
            'An arm aimed at one member must never reach another.');
    }

    @IsTest
    static void executeReplaysWithoutWritingASecondTime() {
        C360TestFixture.armCalloutMock();
        Id target = membersOf(ACCOUNT_NAME)[0].Id;

        String k = key('replay');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.feeAddsJson = JSON.serialize(new List<Object>{
            new Map<String, Object>{
                'feeType' => 'Appraisal', 'description' => 'ZZ-AV-TEST replay fee',
                'calculationType' => 'Flat Amount', 'amount' => 1200, 'targetLoanId' => target
            }
        });

        Test.startTest();
        StageAmendVersion.Response staged = stage(r);
        Assert.isTrue(staged.ok, 'The plan must stage. Got: ' + why(staged));
        ExecuteAmendVersion.Response first = executeStaged(k, staged.result);
        Assert.isTrue(first.ok, 'The first run must execute. Got: ' + why(first));
        Integer afterFirst = [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :target];

        ExecuteAmendVersion.Response second = executeStaged(k, staged.result);
        Test.stopTest();

        Assert.isTrue(second.ok, 'A replay reports the prior run rather than failing. Got: ' + why(second));
        Assert.isTrue(second.result.replayed, 'The second call must report itself as a replay.');
        Assert.areEqual(afterFirst, [SELECT COUNT() FROM LLC_BI__Fee__c WHERE LLC_BI__Loan__c = :target],
            'A replay writes nothing. The platform produces duplicates on failed background Apex, so idempotency is ours to enforce.');
        Assert.areEqual(1, afterFirst, 'The first run filed exactly one fee.');
    }

    @IsTest
    static void executeRereadsTheGateAndRefusesAVersionThatClimbedToApproval() {
        C360TestFixture.armCalloutMock();
        List<LLC_BI__Loan__c> members = membersOf(ACCOUNT_NAME);
        Id target = members[0].Id;
        Decimal amountBefore = members[0].LLC_BI__Amount__c;

        String k = key('climbed');
        StageAmendVersion.Request r = req(k, packageOf(ACCOUNT_NAME).Id);
        r.scalarChangesJson = scalars(target, 'requestedAmount', 9000000);

        Test.startTest();
        StageAmendVersion.Response staged = stage(r);
        Assert.isTrue(staged.ok, 'The version was editable when the plan was staged. Got: ' + why(staged));

        // THE ORG MOVES UNDER THE PLAN. The banker confirmed a version they still owned; by the time
        // the confirm arrives the org has taken it. Through a FRESH sObject carrying only Id plus the
        // field being changed: re-updating one returned by a query can trip a set-once field.
        update new LLC_BI__Loan__c(Id = members[1].Id, LLC_BI__Stage__c = APPROVAL_STAGE);

        ExecuteAmendVersion.Response res = executeStaged(k, staged.result);
        Test.stopTest();

        Assert.isFalse(res.ok, 'The gate is re-read at execute, not assumed from stage time. Got: ' + why(res));
        Assert.areEqual('VERSION_NOT_EDITABLE', res.error.code, 'Wrong refusal code: ' + why(res));
        Assert.areEqual(amountBefore, [SELECT LLC_BI__Amount__c FROM LLC_BI__Loan__c WHERE Id = :target].LLC_BI__Amount__c,
            'A refused execute writes NOTHING. The figure must read exactly as it did before.');
    }

    @IsTest
    static void executeRefusesAPlanStagedByAnotherTool() {
        C360TestFixture.armCalloutMock();
        String k = key('wrongtool');

        Test.startTest();
        cm_Action_Staging__c foreign = new cm_Action_Staging__c(
            cm_Action_Id__c = 'loan-modification',
            cm_Idempotency_Key__c = k,
            cm_Plan_Hash__c = 'deadbeef',
            cm_Plan_JSON__c = '{"summary":"","steps":[],"warnings":[],"provenance":{},"values":{}}',
            cm_Status__c = 'Staged',
            cm_Actor_User__c = UserInfo.getUserId()
        );
        insert foreign;

        ExecuteAmendVersion.Request ex = new ExecuteAmendVersion.Request();
        ex.idempotencyKey = k;
        ex.stagingId = foreign.Id;
        ex.planHash = 'deadbeef';
        ex.decisionToken = 'not-a-real-token';
        ex.approverUserId = UserInfo.getUserId();
        ExecuteAmendVersion.Response res = ExecuteAmendVersion.run(new List<ExecuteAmendVersion.Request>{ ex })[0];
        Test.stopTest();

        Assert.isFalse(res.ok, 'Each execute tool runs its own action or none. Got: ' + why(res));
        Assert.areEqual('VALIDATION_FAILED', res.error.code, 'Wrong refusal code: ' + why(res));
        Assert.isTrue(
            res.error.message.contains('loan-modification'),
            'The refusal must name the action the plan actually holds: ' + res.error.message
        );
        Assert.isNull(
            [SELECT cm_Token_Consumed_At__c FROM cm_Action_Staging__c WHERE Id = :foreign.Id].cm_Token_Consumed_At__c,
            'The action-id check runs BEFORE the claim, so a plan for another tool never burns a token.'
        );
    }

    @IsTest
    static void executeRefusesAnUnknownStagingId() {
        C360TestFixture.armCalloutMock();
        ExecuteAmendVersion.Request ex = new ExecuteAmendVersion.Request();
        ex.idempotencyKey = key('nostaging');
        ex.stagingId = C360Wave2Fixture.fakeId(cm_Action_Staging__c.SObjectType);
        ex.planHash = 'deadbeef';
        ex.decisionToken = 'not-a-real-token';
        ex.approverUserId = UserInfo.getUserId();

        Test.startTest();
        ExecuteAmendVersion.Response res = ExecuteAmendVersion.run(new List<ExecuteAmendVersion.Request>{ ex })[0];
        Test.stopTest();

        Assert.isFalse(res.ok, 'There is no plan to run. Got: ' + why(res));
        Assert.areEqual('VALIDATION_FAILED', res.error.code, 'Wrong refusal code: ' + why(res));
    }
}
