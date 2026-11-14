/**
 * Customer360PortfolioTest - book totals are the book.
 *
 * Pins the 2026-11-14 fix: outstanding on a package with no committed exposure (TCE 0 or null)
 * must not reach bookTotals, because dividing it by a committed figure it never contributed to is
 * how one Credit Underwriting package carrying $850M against TCE 0 put book utilisation at 356
 * percent. The excluded balance is still counted, in the note, so nothing is dropped silently.
 *
 * UNVERIFIED ASSUMPTION, check on the first deploy run: LLC_BI__TCE__c and LLC_BI__Outstanding__c
 * are written directly here. If nCino recomputes either on insert, the fixture values will not
 * survive and this test fails on its first assertion, which is the signal to seed them through
 * loans instead.
 */
@IsTest
private class Customer360PortfolioTest {

    @TestSetup
    static void seedTheBook() {
        C360TestFixture.armCalloutMock();
        Account booked = new Account(Name = 'ZZ-PORTFOLIO-TEST Booked');
        Account pipeline = new Account(Name = 'ZZ-PORTFOLIO-TEST Pipeline');
        Account legacy = new Account(Name = 'ZZ-PORTFOLIO-TEST Legacy');
        insert new List<Account>{ booked, pipeline, legacy };
        insert new List<LLC_BI__Product_Package__c>{
            pkg(booked.Id, 10000000, 8000000),
            pkg(pipeline.Id, 0, 850000000),
            pkg(legacy.Id, null, 0)
        };
    }

    private static LLC_BI__Product_Package__c pkg(Id accountId, Decimal tce, Decimal outstanding) {
        return new LLC_BI__Product_Package__c(
            Name = 'ZZ-PORTFOLIO-TEST Package',
            LLC_BI__Account__c = accountId,
            LLC_BI__Stage__c = 'Pending',
            LLC_BI__Status__c = 'New',
            LLC_BI__TCE__c = tce,
            LLC_BI__Outstanding__c = outstanding
        );
    }

    private static Customer360Portfolio.Response runWholeBook() {
        Customer360Portfolio.Request req = new Customer360Portfolio.Request();
        req.maxAccounts = 10;
        Test.startTest();
        List<Customer360Portfolio.Response> out = Customer360Portfolio.run(
            new List<Customer360Portfolio.Request>{ req });
        Test.stopTest();
        return out[0];
    }

    @IsTest
    static void totalsSpanOnlyAccountsWithCommittedExposure() {
        Customer360Portfolio.Response res = runWholeBook();

        System.assertEquals(10000000, res.bookTotals.totalCommitted, 'committed is the booked account only');
        System.assertEquals(8000000, res.bookTotals.totalOutstanding,
            'outstanding on a TCE-0 package must not reach the book total');
        System.assertEquals(80.0, res.bookTotals.utilizationPct, 'utilisation is 8M over 10M');
        System.assertEquals(1, res.bookTotals.accountCount, 'accountCount is the book, not every packaged account');
    }

    @IsTest
    static void excludedBalanceIsNamedInTheNote() {
        Customer360Portfolio.Response res = runWholeBook();

        System.assert(res.note.contains('out of 3 packaged accounts'), res.note);
        System.assert(res.note.contains('1 account(s) with outstanding balance but no committed exposure'), res.note);
    }

    @IsTest
    static void accountRowsStillListEveryPackagedAccount() {
        Customer360Portfolio.Response res = runWholeBook();

        System.assertEquals(3, res.accounts.size(),
            'the fix narrows the totals only; the account list is unchanged');
    }
}
