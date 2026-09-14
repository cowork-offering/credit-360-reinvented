/**
 * C360AggregateSweepTest - the in-transaction sweep of collateral aggregate shells a pledge write
 * mints and never links (backlog row 46, org proof 2026-09-14).
 *
 * THE FIXTURE IS DELIBERATELY TINY AND THE WINDOW IS THE POINT. `@TestSetup` runs in its own
 * transaction, so every row it writes is OUTSIDE the window a test method opens: that is exactly
 * the boundary the sweep depends on, and it is asserted rather than assumed. Each method then
 * builds the shells it cares about inside its own window and proves which of them the sweep may
 * touch.
 */
@IsTest
private class C360AggregateSweepTest {

    private static final String TOOL = 'loan-modification';
    private static final String BORROWER = 'ZZ-SWEEP-TEST Borrower';

    @TestSetup
    static void makeFixture() {
        C360TestFixture.armCalloutMock();
        Account a = new Account(Name = BORROWER);
        insert a;
        LLC_BI__Product_Package__c pkg = new LLC_BI__Product_Package__c(
            Name = 'ZZ-SWEEP-TEST Package', LLC_BI__Account__c = a.Id
        );
        insert pkg;

        // A shell that predates every window, carrying a facility. Nothing may ever sweep it.
        LLC_BI__Loan_Collateral_Aggregate__c old = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-SWEEP-TEST Settled Shell'
        );
        insert old;
        insert new LLC_BI__Loan__c(
            LLC_BI__Account__c = a.Id,
            LLC_BI__Product_Package__c = pkg.Id,
            LLC_BI__Stage__c = 'Qualification',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = 'ZZSWEEPP1',
            LLC_BI__Amount__c = 500000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__Loan_Collateral_Aggregate__c = old.Id
        );

        // A shell that predates every window and carries nothing at all. The one row that proves
        // the sweep is bounded by TIME and not only by references.
        insert new LLC_BI__Loan_Collateral_Aggregate__c(Name = 'ZZ-SWEEP-TEST Older Orphan');
    }

    private static Account borrower() {
        return [SELECT Id FROM Account WHERE Name = :BORROWER LIMIT 1];
    }

    /** Through the facility's own lookup, never by Name: the org rewrites names on save (lesson 16b). */
    private static Id packageId() {
        return [
            SELECT LLC_BI__Product_Package__c FROM LLC_BI__Loan__c WHERE LLC_BI__lookupKey__c = 'ZZSWEEPP1' LIMIT 1
        ].LLC_BI__Product_Package__c;
    }

    private static LLC_BI__Loan__c facility() {
        return [SELECT Id FROM LLC_BI__Loan__c WHERE LLC_BI__lookupKey__c = 'ZZSWEEPP1' LIMIT 1];
    }

    private static LLC_BI__Loan_Collateral_Aggregate__c shell(String name) {
        LLC_BI__Loan_Collateral_Aggregate__c a = new LLC_BI__Loan_Collateral_Aggregate__c(Name = name);
        insert a;
        return a;
    }

    private static Boolean alive(Id shellId) {
        return [SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id = :shellId] == 1;
    }

    @IsTest
    static void aShellMintedHereAndLinkedToNothingIsSweptAndTheReQueryProvesIt() {
        C360TestFixture.armCalloutMock();
        Datetime txStart = Datetime.now();
        Id orphan = shell('ZZ-SWEEP-TEST Orphan').Id;

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep(TOOL, txStart);
        Test.stopTest();

        System.assertEquals(true, r.verified, 'The sweep settles verified when nothing it targeted survives: ' + r.detail);
        System.assertEquals(1, r.swept, 'Exactly the one unlinked shell went: ' + r.detail);
        System.assertEquals(0, r.remaining, 'Nothing was left behind: ' + r.detail);
        System.assertEquals(false, alive(orphan), 'The orphan is gone, proven by re-query rather than by the result saying so.');
        System.assertEquals(C360Plan.STATE_VERIFIED, r.state(), 'A clean sweep settles its step verified.');
    }

    @IsTest
    static void aShellAPledgePointsAtIsNeverSwept() {
        C360TestFixture.armCalloutMock();
        Datetime txStart = Datetime.now();
        Id kept = shell('ZZ-SWEEP-TEST Pledged Shell').Id;

        LLC_BI__Collateral_Type__c ct = new LLC_BI__Collateral_Type__c(
            Name = 'ZZ-SWEEP-TEST Equipment', LLC_BI__Advance_Rate__c = 80
        );
        insert ct;
        LLC_BI__Collateral__c asset = new LLC_BI__Collateral__c(
            LLC_BI__Collateral_Type__c = ct.Id, LLC_BI__Description__c = 'ZZ-SWEEP-TEST asset'
        );
        insert asset;
        insert new LLC_BI__Loan_Collateral2__c(
            LLC_BI__Loan__c = facility().Id,
            LLC_BI__Collateral__c = asset.Id,
            LLC_BI__Loan_Collateral_Aggregate__c = kept,
            LLC_BI__Lien_Position__c = '1st',
            LLC_BI__Is_Primary__c = true,
            LLC_BI__Amount_Pledged__c = 100000
        );

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep(TOOL, txStart);
        Test.stopTest();

        System.assertEquals(true, r.verified, r.detail);
        System.assertEquals(true, alive(kept), 'A shell a pledge hangs off is live: the lookup CASCADES, so removing ' +
            'it would take the pledge with it. ' + r.detail);
        System.assertEquals(0, r.swept,
            'The only shell this transaction minted is the one the pledge hangs off, so nothing was swept: ' + r.detail);
    }

    @IsTest
    static void aShellAFacilityPointsAtIsNeverSwept() {
        C360TestFixture.armCalloutMock();
        Datetime txStart = Datetime.now();
        insert new LLC_BI__Loan__c(
            LLC_BI__Account__c = borrower().Id,
            LLC_BI__Product_Package__c = packageId(),
            LLC_BI__Stage__c = 'Qualification',
            LLC_BI__Status__c = 'Open',
            LLC_BI__lookupKey__c = 'ZZSWEEPP2',
            LLC_BI__Amount__c = 250000,
            LLC_BI__Product_Line__c = 'Commercial',
            LLC_BI__Product_Type__c = 'Term Loan',
            LLC_BI__Product__c = 'Equipment',
            LLC_BI__Loan_Collateral_Aggregate__c = shell('ZZ-SWEEP-TEST Facility Shell').Id
        );

        // Read the anchor the org settled on rather than the one this test proposed: the lookup is
        // set-once and nCino's own automation has the last word on it.
        Id anchored = [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan__c WHERE LLC_BI__lookupKey__c = 'ZZSWEEPP2' LIMIT 1
        ].LLC_BI__Loan_Collateral_Aggregate__c;

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep(TOOL, txStart);
        Test.stopTest();

        System.assertEquals(true, r.verified, r.detail);
        System.assertNotEquals(null, anchored, 'The facility carries a rollup anchor.');
        System.assertEquals(true, alive(anchored), 'A facility holding the shell is the reason the shell exists. ' + r.detail);
    }

    @IsTest
    static void aShellCarryingALookupKeyIsNeverSweptEvenWhenNothingPointsAtIt() {
        C360TestFixture.armCalloutMock();
        Datetime txStart = Datetime.now();
        LLC_BI__Loan_Collateral_Aggregate__c keyed = new LLC_BI__Loan_Collateral_Aggregate__c(
            Name = 'ZZ-SWEEP-TEST Keyed Shell',
            LLC_BI__lookupKey__c = 'ZZ-SWEEP-TEST-SEEDED'
        );
        insert keyed;

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep(TOOL, txStart);
        Test.stopTest();

        System.assertEquals(0, r.swept, 'A lookup key is the only field that says a human keyed this row. ' + r.detail);
        System.assertEquals(true, alive(keyed.Id), 'bankinggpt carries three seeded this way and none of them is ours.');
    }

    @IsTest
    static void aShellFromAnEarlierTransactionIsOutsideTheWindowAndIsLeftAlone() {
        C360TestFixture.armCalloutMock();
        Id older = [
            SELECT Id FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Name = 'ZZ-SWEEP-TEST Older Orphan' LIMIT 1
        ].Id;

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep(TOOL, Datetime.now());
        Test.stopTest();

        System.assertEquals(true, r.verified, r.detail);
        System.assertEquals(0, r.swept, 'The window is this transaction. An orphan from an earlier one is somebody ' +
            'else\'s to account for. ' + r.detail);
        System.assertEquals(true, alive(older), 'The older orphan stands.');
        System.assert(
            r.detail.contains('nothing to sweep'),
            'A window that minted nothing says so rather than reporting a count of zero deletions: ' + r.detail
        );
    }

    @IsTest
    static void aToolWithNoDeleteFenceIsRefusedAndTheRunIsToldRatherThanBroken() {
        C360TestFixture.armCalloutMock();
        Datetime txStart = Datetime.now();
        Id orphan = shell('ZZ-SWEEP-TEST Unfenced Orphan').Id;

        Test.startTest();
        C360AggregateSweep.Result r = C360AggregateSweep.sweep('covenant-review', txStart);
        Test.stopTest();

        System.assertEquals(false, r.verified, 'A refused sweep is never claimed as verified.');
        System.assertEquals(0, r.swept, 'Nothing was deleted.');
        System.assertEquals(true, alive(orphan), 'The shell stands, because the guard would not open the door.');
        System.assert(
            r.detail.contains('covenant-review'),
            'The step names the tool the fence refused: ' + r.detail
        );
        System.assertEquals(C360Plan.STATE_FAILED, r.state(), 'And the step reads failed rather than silently green.');
    }
}
