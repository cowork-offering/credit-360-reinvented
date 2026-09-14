/**
 * C360WriteGuardTest - the A33.3.1 transition allowlist, tested by attempting each refusal.
 *
 * BUILD-BRIEF-V2 WP2 criterion 4 is explicit that this must be "tested by attempting each and
 * asserting refusal, not by never trying". Every method here calls the same entry point the
 * execute tools call, with the value the allowlist forbids.
 */
@IsTest
private class C360WriteGuardTest {

    @IsTest
    static void reviewCompleteIsRefused() {
        C360TestFixture.armCalloutMock();
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed(
                C360WriteGuard.OBJ_REVIEW,
                C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'Complete' }
            );
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
            System.assert(e.getMessage().contains('In Progress'), 'The refusal should name the only permitted state: ' + e.getMessage());
        }
        System.assertEquals(true, refused, 'A33.4.6(b) deleted the Complete transition. It must be refused.');
    }

    @IsTest
    static void reviewPendingApprovalIsRefused() {
        C360TestFixture.armCalloutMock();
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed(
                C360WriteGuard.OBJ_REVIEW,
                C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'Pending Approval' }
            );
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
        }
        System.assertEquals(true, refused, 'Only In Progress is on the allowlist. Pending Approval belongs to the org.');
    }

    @IsTest
    static void reviewStageWriteIsRefusedForAnyValue() {
        C360TestFixture.armCalloutMock();
        for (String value : new List<String>{ 'Qualification', 'Approval', 'Complete' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(
                    C360WriteGuard.OBJ_REVIEW,
                    C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Status__c' => 'In Progress', 'cm_Review_Stage__c' => value }
                );
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
                System.assert(e.getMessage().contains('cm_Review_Stage__c'), 'The refusal should name the field: ' + e.getMessage());
            }
            System.assertEquals(true, refused, 'cm_Review_Stage__c is read and labelled, never written. Value tried: ' + value);
        }
    }

    @IsTest
    static void reviewRecordTypeIsRefused() {
        C360TestFixture.armCalloutMock();
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed(
                C360WriteGuard.OBJ_REVIEW,
                C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'In Progress', 'RecordTypeId' => '012000000000000AAA' }
            );
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
        }
        System.assertEquals(true, refused, 'Probe 3: the Review After Save flow assigns the record type. We never set it.');
    }

    @IsTest
    static void caseStatusOtherThanNewIsRefused() {
        C360TestFixture.armCalloutMock();
        for (String value : new List<String>{ 'Closed', 'Escalated', 'In Progress' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(
                    C360WriteGuard.OBJ_CASE,
                    C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'Status' => value }
                );
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Case may be created at New only. Value tried: ' + value);
        }
    }

    @IsTest
    static void caseUpdateAndDeleteAreRefused() {
        C360TestFixture.armCalloutMock();
        for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_CASE, op, new Map<String, Object>{ 'Status' => 'New' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
                System.assert(e.getMessage().contains(op), 'The refusal should name the operation: ' + e.getMessage());
            }
            System.assertEquals(true, refused, 'Case takes no status transition and no closure from this tool. Operation: ' + op);
        }
    }

    @IsTest
    static void valuationUpdateAndDeleteAreRefused() {
        C360TestFixture.armCalloutMock();
        for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_VALUATION, op, new Map<String, Object>());
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'A33.3.1 refuses updates and deletes on the valuation object. Operation: ' + op);
        }
    }

    @IsTest
    static void valuationLendableValueIsRefused() {
        C360TestFixture.armCalloutMock();
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed(
                C360WriteGuard.OBJ_VALUATION,
                C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Lendable_Value__c' => 100 }
            );
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
        }
        System.assertEquals(true, refused, 'Lendable value is a formula on the parent. The value goes on the valuation child.');
    }

    @IsTest
    static void objectOutsideTheAllowlistIsRefused() {
        C360TestFixture.armCalloutMock();
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed('LLC_BI__LoanRenewal__c', C360WriteGuard.OP_CREATE, new Map<String, Object>());
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
            System.assert(e.getMessage().contains('no transition allowlist'), 'The refusal should say why: ' + e.getMessage());
        }
        System.assertEquals(
            true,
            refused,
            'The chain junction is on no allowlist. Nothing in any wave may write to it.'
        );
    }

    @IsTest
    static void permittedCreatesPass() {
        C360TestFixture.armCalloutMock();
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_CASE, C360WriteGuard.OP_CREATE, new Map<String, Object>{ 'Status' => 'New' });
        C360WriteGuard.assertAllowed(
            C360WriteGuard.OBJ_REVIEW,
            C360WriteGuard.OP_CREATE,
            new Map<String, Object>{ 'LLC_BI__Status__c' => 'In Progress' }
        );
        C360WriteGuard.assertAllowed(
            C360WriteGuard.OBJ_VALUATION,
            C360WriteGuard.OP_CREATE,
            new Map<String, Object>{ 'LLC_BI__Value__c' => 100 }
        );
    }

    @IsTest
    static void loanCreateStateIsFencedToQualificationOpen() {
        C360TestFixture.armCalloutMock();
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_CREATE, new Map<String, Object>{
            'LLC_BI__Stage__c' => 'Qualification', 'LLC_BI__Status__c' => 'Open',
            'LLC_BI__isRenewal__c' => false, 'LLC_BI__Is_Modification__c' => false
        });
        for (String stage : new List<String>{ 'Proposal', 'Booked', 'Credit Underwriting' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_CREATE, new Map<String, Object>{
                    'LLC_BI__Stage__c' => stage, 'LLC_BI__Status__c' => 'Open',
                    'LLC_BI__isRenewal__c' => false, 'LLC_BI__Is_Modification__c' => false
                });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'A facility may only be created at Qualification. Tried: ' + stage);
        }
    }

    @IsTest
    static void loanMayHopOnlyToProposal() {
        C360TestFixture.armCalloutMock();
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_UPDATE, new Map<String, Object>{ 'LLC_BI__Stage__c' => 'Proposal' });
        for (String stage : new List<String>{ 'Booked', 'Credit Underwriting', 'Qualification' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_UPDATE, new Map<String, Object>{ 'LLC_BI__Stage__c' => stage });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Exactly one hop is allowlisted. Tried: ' + stage);
        }
    }

    @IsTest
    static void loanFormulaAndAbsentFieldsAreRefused() {
        C360TestFixture.armCalloutMock();
        for (String f : new List<String>{ 'LLC_BI__hasRenewal__c', 'LLC_BI__Number_Of_Renewals__c', 'LLC_BI__RootLoanId__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_CREATE, new Map<String, Object>{
                    'LLC_BI__Stage__c' => 'Qualification', 'LLC_BI__Status__c' => 'Open',
                    'LLC_BI__isRenewal__c' => false, 'LLC_BI__Is_Modification__c' => false, f => 'x'
                });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Formula, rollup and non-existent fields are refused. Tried: ' + f);
        }
    }

    @IsTest
    static void riskRatingCreateStateIsFencedToInReview() {
        C360TestFixture.armCalloutMock();
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_RISK_RATING, C360WriteGuard.OP_CREATE, new Map<String, Object>{ 'LLC_BI__Status__c' => 'In Review' });
        for (String status : new List<String>{ 'Not Approved', 'Approved', 'Declined' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_RISK_RATING, C360WriteGuard.OP_CREATE, new Map<String, Object>{ 'LLC_BI__Status__c' => status });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Probe 4: the default reads as a decision, so only In Review is allowed. Tried: ' + status);
        }
    }

    @IsTest
    static void riskRatingRejectsFieldsTheObjectDoesNotHave() {
        C360TestFixture.armCalloutMock();
        for (String f : new List<String>{ 'RecordTypeId', 'OwnerId', 'LLC_BI__Final_Risk_Grade__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_RISK_RATING, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Status__c' => 'In Review', f => 'x' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Probe 4 proved this object has no RecordTypeId and no OwnerId. Tried: ' + f);
        }
    }

    @IsTest
    static void covenantComplianceIsUpdateOnlyAndNeverCreated() {
        C360TestFixture.armCalloutMock();
        Boolean refusedCreate = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_CREATE, new Map<String, Object>());
        } catch (C360WriteGuard.GuardException e) {
            refusedCreate = true;
            System.assert(e.getMessage().contains('approval chain'), 'The refusal should name the reason: ' + e.getMessage());
        }
        System.assertEquals(true, refusedCreate, 'Probe 8: a create is what fires the bank approval chain. It is refused outright.');

        // nCino's three complete statuses, all three on the allowlist. Waived joined them in the
        // bulk-review wave: it is one of the default Record Create Trigger Statuses and a real
        // outcome of a covenant review, and an allowlist that could not express it pushed the
        // banker out of the tool with the decision unrecorded.
        for (String status : new List<String>{ 'Compliant', 'Waived', 'Exception' }) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_UPDATE, new Map<String, Object>{ 'LLC_BI__Status__c' => status });
        }

        for (String status : new List<String>{ 'Pending', 'In Progress', 'Non-Compliant' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_UPDATE, new Map<String, Object>{ 'LLC_BI__Status__c' => status });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused,
                'Pending and In Progress are where a row starts, never where a review leaves it, and this org\'s compliance status picklist ' +
                'carries no Non-Compliant value at all. Tried: ' + status);
        }
    }

    @IsTest
    static void theExceptionReasonIsFencedToTheOrgsTwoValues() {
        C360TestFixture.armCalloutMock();
        for (String reason : new List<String>{ 'Breached', 'Overdue' }) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_UPDATE,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'Exception', 'LLC_BI__Reason_for_Exception__c' => reason });
        }
        Boolean refused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_UPDATE,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'Exception', 'LLC_BI__Reason_for_Exception__c' => 'Vibes' });
        } catch (C360WriteGuard.GuardException e) {
            refused = true;
        }
        System.assertEquals(true, refused,
            'Reason for Exception is the field that separates a failed test from an undelivered document. It takes the org\'s two values and nothing else.');
    }

    @IsTest
    static void covenantSetOnceAndScheduleFieldsAreRefused() {
        C360TestFixture.armCalloutMock();
        for (String f : new List<String>{ 'LLC_BI__Covenant__c', 'LLC_BI__Effective_Date__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, C360WriteGuard.OP_UPDATE,
                    new Map<String, Object>{ 'LLC_BI__Status__c' => 'Compliant', f => 'x' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Set-once and schedule-corrupting fields are refused. Tried: ' + f);
        }
    }

    @IsTest
    static void deleteIsRefusedEverywhere() {
        C360TestFixture.armCalloutMock();
        for (String obj : new List<String>{ C360WriteGuard.OBJ_CASE, C360WriteGuard.OBJ_LOAN, C360WriteGuard.OBJ_RISK_RATING, C360WriteGuard.OBJ_COVENANT_COMPLIANCE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(obj, C360WriteGuard.OP_DELETE, new Map<String, Object>());
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'No tool deletes anything. Tried: ' + obj);
        }
    }

    @IsTest
    static void packageMayBeCreatedWithNameAndAccountOnly() {
        C360TestFixture.armCalloutMock();
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{ 'Name' => 'ACME - 7/26/2026 - PP', 'LLC_BI__Account__c' => '001000000000000AAA' });

        for (String f : new List<String>{ 'RecordTypeId', 'LLC_BI__Stage__c', 'LLC_BI__Status__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'Name' => 'x', f => 'y' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused,
                'Real packages in this org carry no record type, and stage/status belong to the org\'s package automation. Tried: ' + f);
        }
    }

    @IsTest
    static void packageTakesTheNameRepairButNoFencedFieldAndNoDelete() {
        C360TestFixture.armCalloutMock();

        // The one permitted update: the versioning Name repair (2026-08-30). The engine names the
        // new package version itself and can leave the account prefix blank; the caller repairs it
        // to the org convention, and that repair must pass the gate.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_UPDATE,
            new Map<String, Object>{ 'Name' => 'ACME - 8/30/2026 - PP' });

        for (String f : new List<String>{ 'RecordTypeId', 'LLC_BI__Stage__c', 'LLC_BI__Status__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_UPDATE,
                    new Map<String, Object>{ f => 'y' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused,
                'Record type, stage and status stay the org\'s own, on update as on create. Tried: ' + f);
        }

        Boolean deleteRefused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PRODUCT_PACKAGE, C360WriteGuard.OP_DELETE, new Map<String, Object>());
        } catch (C360WriteGuard.GuardException e) {
            deleteRefused = true;
        }
        System.assertEquals(true, deleteRefused, 'No tool of ours ever deletes a package.');
    }

    @IsTest
    static void covenantIsBornPendingAndActiveOrNotAtAll() {
        C360TestFixture.armCalloutMock();

        // The net-new covenant doorway (2026-08-30): Pending and Active are the only birth state.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Covenant_Status__c' => 'Pending', 'LLC_BI__Active__c' => 'true',
                'LLC_BI__Financial_Indicator_Value__c' => 3.5
            });

        Boolean statusRefused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Covenant_Status__c' => 'Compliant', 'LLC_BI__Active__c' => 'true' });
        } catch (C360WriteGuard.GuardException e) {
            statusRefused = true;
        }
        System.assertEquals(true, statusRefused, 'A covenant born Compliant would be authored compliance history');

        for (String f : new List<String>{ 'LLC_BI__Breached__c', 'LLC_BI__Last_Evaluation_Value__c', 'LLC_BI__Is_Template__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Covenant_Status__c' => 'Pending', 'LLC_BI__Active__c' => 'true', f => 'x' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Evaluation outcomes belong to the org\'s review cycle. Tried: ' + f);
        }

        // The attach doorway: two lookups, no state fence, and never an update or delete.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{ 'LLC_BI__Loan__c' => 'a', 'LLC_BI__Covenant2__c' => 'b' });
        for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, op, new Map<String, Object>());
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Every field on this junction is non-updateable in the org. Operation: ' + op);
        }
    }

    @IsTest
    static void involvementRolesAreTheBorrowingStructureSetAndNothingElse() {
        C360TestFixture.armCalloutMock();
        // The borrowing-structure amendment arm (2026-08-30): the full role set files. Every one of
        // these is a role Hartwell's own involvement rows carry live.
        for (String role : new List<String>{ 'Borrower', 'Co-Borrower', 'Guarantor', 'Limited Guarantor', 'Related Entity' }) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Borrower_Type__c' => role, 'LLC_BI__Ownership__c' => 100 });
        }

        for (String role : new List<String>{ 'Grantor', 'Contractor', 'Trustee' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Borrower_Type__c' => role });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Grantor and Contractor are collateral and construction semantics, not borrowing structure. Tried: ' + role);
        }
    }

    @IsTest
    static void involvementFormulaFieldsAndContingentAmountAreRefused() {
        C360TestFixture.armCalloutMock();
        for (String f : new List<String>{ 'LLC_BI__Is_Borrower__c', 'LLC_BI__Is_Guarantor__c',
                                          'LLC_BI__Is_CoBorrower__c', 'LLC_BI__Contingent_Amount__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Borrower_Type__c' => 'Borrower', f => 1 });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused,
                'Is_* are formulas derived from Borrower_Type, and Contingent Amount is XOR with Ownership. Tried: ' + f);
        }
    }

    @IsTest
    static void aFeeIsBornActiveAndNeverCarriesARecordTypeIdOrADerivedBasis() {
        C360TestFixture.armCalloutMock();

        // The net-new fee doorway (2026-08-31). Both calculation shapes pass the gate: the
        // percentage/flat rules are the STAGE's business, and this fence is about state and fields.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Loan__c' => 'a', 'LLC_BI__Status__c' => 'Active',
                'LLC_BI__Fee_Type__c' => 'Loan Origination', 'LLC_BI__Calculation_Type__c' => 'Percentage',
                'LLC_BI__Basis_Source__c' => 'LLC_BI__Amount__c', 'LLC_BI__Percentage__c' => 1
            });
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Loan__c' => 'a', 'LLC_BI__Status__c' => 'Active',
                'LLC_BI__Fee_Type__c' => 'Attorney', 'LLC_BI__Calculation_Type__c' => 'Flat Amount',
                'LLC_BI__Amount__c' => 5000
            });

        Boolean statusRefused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CREATE,
                new Map<String, Object>{ 'LLC_BI__Loan__c' => 'a', 'LLC_BI__Status__c' => 'Inactive' });
        } catch (C360WriteGuard.GuardException e) {
            statusRefused = true;
        }
        System.assertEquals(true, statusRefused, 'An inactive fee is a fee nobody charges, which is not what adding one means');

        // RecordTypeId is refused by the ORG (INVALID_CROSS_REFERENCE_KEY: no Fee record type is on
        // the integration user's profile), Name is an autonumber, and Basis Amount is what nCino's
        // FeeTrigger derives from the loan's commitment.
        for (String f : new List<String>{ 'RecordTypeId', 'Name', 'LLC_BI__Basis_Amount__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Loan__c' => 'a', 'LLC_BI__Status__c' => 'Active', f => 'x' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'The org assigns it, or derives it, or refuses it outright. Tried: ' + f);
        }

        // A fee is created and never touched again: amending one that already exists is a different
        // arm, and the guard is what makes that a refusal rather than a convention.
        for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, op,
                    new Map<String, Object>{ 'LLC_BI__Amount__c' => 1 });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'This wave adds fees and stops. Operation: ' + op);
        }
    }

    @IsTest
    static void theCollateralChainIsAdmittedOnCreateAndNowhereElse() {
        C360TestFixture.armCalloutMock();

        // The three objects a pledge needs, in the order the arm writes them. The asset and the
        // ownership junction carry no state fence: `LLC_BI__Collateral__c.LLC_BI__Status__c` has no
        // verified active value on this org, and a fence on a guess refuses a legal write.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Collateral_Type__c' => 'a', 'LLC_BI__Value__c' => 2000000,
                'LLC_BI__Description__c' => 'New piece of equipment'
            });
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Account__c' => 'a', 'LLC_BI__Collateral__c' => 'b',
                'LLC_BI__Ownership_Percentage__c' => 100, 'LLC_BI__Primary_Owner__c' => true
            });
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Loan__c' => 'a', 'LLC_BI__Collateral__c' => 'b',
                'LLC_BI__Pledged_Status__c' => 'Active', 'LLC_BI__Active__c' => true,
                'LLC_BI__Amount_Pledged__c' => 1600000, 'LLC_BI__Advance_Rate_Override__c' => 80,
                'LLC_BI__Override_Reason__c' => 'Stated by the approver on this modification.'
            });

        // A pledge is born Active in both senses: security nobody is claiming is not security.
        for (Map<String, Object> dead : new List<Map<String, Object>>{
            new Map<String, Object>{ 'LLC_BI__Pledged_Status__c' => 'Inactive', 'LLC_BI__Active__c' => true },
            new Map<String, Object>{ 'LLC_BI__Pledged_Status__c' => 'Active', 'LLC_BI__Active__c' => false }
        }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE, dead);
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'A pledge is born Active. Tried: ' + dead);
        }

        // Name is an autonumber; Lendable Value and the asset's Advance Rate are the org's formulas.
        for (String f : new List<String>{ 'Name', 'RecordTypeId', 'LLC_BI__Lendable_Value__c', 'LLC_BI__Advance_Rate__c' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{ 'LLC_BI__Value__c' => 1, f => 'x' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'The org assigns it or derives it. Tried: LLC_BI__Collateral__c.' + f);
        }

        // AUTHORIZE IS THE BANKER'S CHECKBOX AND IT IS WRITABLE (2026-09-03). It is the only escape
        // from the org's Pledge_More_Than_Lendable_Value rule, and the fence that refused it left a
        // banker who wanted to lend past an asset's lendable value with no way to say so. It passes
        // the guard now; what keeps it honest is stage_loan_modification, which sets it only on an
        // explicit authoriseOverPledge and only where the amount genuinely exceeds the lendable
        // value. The guard's job here is to prove the field is no longer walled off.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE,
            new Map<String, Object>{
                'LLC_BI__Pledged_Status__c' => 'Active', 'LLC_BI__Active__c' => true,
                'LLC_BI__Amount_Pledged__c' => 900000, 'LLC_BI__Authorize__c' => true
            });

        for (String f : new List<String>{
            'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c', 'LLC_BI__Unique_Id__c'
        }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{
                        'LLC_BI__Pledged_Status__c' => 'Active', 'LLC_BI__Active__c' => true, f => 'x'
                    });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'Derived by the org, or a decision that is not a tool\'s. Tried: ' + f);
        }

        // The chain is created and never touched again: releasing a pledge or revaluing an asset are
        // different arms, and the guard is what makes that a refusal rather than a convention.
        for (String obj : new List<String>{
            C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, C360WriteGuard.OBJ_PLEDGE
        }) {
            for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
                Boolean refused = false;
                try {
                    C360WriteGuard.assertAllowed(obj, op, new Map<String, Object>{ 'LLC_BI__Active__c' => false });
                } catch (C360WriteGuard.GuardException e) {
                    refused = true;
                }
                System.assertEquals(true, refused, 'This wave adds security and stops. ' + obj + ' / ' + op);
            }
        }

        // The carry side is untouched by any of that: a replicated pledge still passes OP_CARRY.
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CARRY,
            new Map<String, Object>{ 'LLC_BI__Loan__c' => null, 'LLC_BI__Collateral__c' => null });
        // And the asset itself is NOT a carryable junction: the carry re-points pledges at the
        // collateral the parent already had, and never copies the asset.
        Boolean carryRefused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'LLC_BI__Value__c' => null });
        } catch (C360WriteGuard.GuardException e) {
            carryRefused = true;
        }
        System.assertEquals(true, carryRefused, 'A clone shares its parent\'s assets; it does not get copies of them');
    }

    @IsTest
    static void aPolicyExceptionIsAdmittedOnCreateInAnyOfItsThreeDecisions() {
        C360TestFixture.armCalloutMock();

        // ALL THREE STATUSES ARE LEGAL BIRTHS. Waived, mitigated and standing unmitigated are three
        // real outcomes of logging an exception, and an allowlist expressing only one would force
        // the banker out of the tool with the decision unrecorded.
        for (String status : new List<String>{ 'Waived', 'Mitigated', 'Unmitigated' }) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OP_CREATE,
                new Map<String, Object>{
                    'Name' => 'Advance rate above guideline',
                    'LLC_BI__Type__c' => 'Policy',
                    'LLC_BI__Status__c' => status,
                    'LLC_BI__Loan__c' => 'a', 'LLC_BI__Relationship__c' => 'b',
                    'LLC_BI__Mitigation_Reason_1__c' => 'A personal guaranty'
                });
        }

        // THE STATUS MUST BE PRESENT, which is the point of fencing it at all: the org defaults a
        // new row to Unmitigated, and a defaulted Unmitigated reads as a decision nobody made.
        // And the type is "Policy", which is what all 81 rows in this org carry.
        for (Map<String, Object> wrong : new List<Map<String, Object>>{
            new Map<String, Object>{ 'LLC_BI__Type__c' => 'Policy' },
            new Map<String, Object>{ 'LLC_BI__Type__c' => 'Policy', 'LLC_BI__Status__c' => 'Tolerated' },
            new Map<String, Object>{ 'LLC_BI__Status__c' => 'Waived' },
            new Map<String, Object>{ 'LLC_BI__Type__c' => 'Exception', 'LLC_BI__Status__c' => 'Waived' }
        }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OP_CREATE, wrong);
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'An exception is born Policy plus a stated decision. Tried: ' + wrong);
        }

        // Automatically_Added is the org's own provenance flag: a tool-authored exception claiming
        // to be one of the 76 auto-generated exposure rows would misstate where it came from.
        // RecordTypeId does not exist on this object at all.
        for (String f : new List<String>{ 'LLC_BI__Automatically_Added__c', 'RecordTypeId' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OP_CREATE,
                    new Map<String, Object>{
                        'LLC_BI__Type__c' => 'Policy', 'LLC_BI__Status__c' => 'Waived', f => 'x'
                    });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'The org owns it, or it does not exist. Tried: ' + f);
        }

        // Logged and never touched again: amending an exception someone already filed is a
        // different arm, and every write on this object costs an egress.
        for (String op : new List<String>{ C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_DELETE }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, op,
                    new Map<String, Object>{ 'LLC_BI__Status__c' => 'Waived' });
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(true, refused, 'This wave logs exceptions and stops. Operation: ' + op);
        }

        // AND IT IS NOT CARRYABLE. An exception records what the bank decided about the facility as
        // it stands; replicating one onto a version nobody has approved would restate a decision
        // about terms that do not exist yet.
        Boolean carryRefused = false;
        try {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'LLC_BI__Status__c' => 'Mitigated' });
        } catch (C360WriteGuard.GuardException e) {
            carryRefused = true;
        }
        System.assertEquals(true, carryRefused, 'A clone carries only the exceptions this plan logs on it');
    }

    // -------------------------------------------------------------------------------------------
    // THE DELETE DOOR (0.9.23, the version lifecycle).
    //
    // The object gate above still refuses every delete, and deleteIsRefusedEverywhere still proves
    // it on the objects it always did. What is new is a SECOND, narrower door: assertAllowedForTool
    // with OP_DELETE, answered against a per-tool delete table. These methods attempt each refusal
    // rather than relying on never trying, the same discipline as every method above.
    // -------------------------------------------------------------------------------------------

    @IsTest
    static void theDiscardMayDeleteItsOwnSetAndEveryMemberOfItIsNamed() {
        C360TestFixture.armCalloutMock();
        for (String obj : new List<String>{
            'LLC_BI__LoanRenewal__c', C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OBJ_LOAN_COVENANT,
            'LLC_BI__Pricing_Rate_Component__c', 'LLC_BI__Pricing_Payment_Component__c',
            C360WriteGuard.OBJ_PRICING_STREAM, C360WriteGuard.OBJ_FEE, C360WriteGuard.OBJ_INVOLVEMENT,
            C360WriteGuard.OBJ_LOAN, C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OBJ_PRODUCT_PACKAGE
        }) {
            C360WriteGuard.assertAllowedForTool(
                'discard-version', obj, C360WriteGuard.OP_DELETE, new Map<String, Object>()
            );
        }
    }

    @IsTest
    static void theDiscardMayNotDeleteWhatTheVersionMerelyPointedAt() {
        C360TestFixture.armCalloutMock();
        // The asset, the ownership junction, the covenant record, the relationship covenant
        // junction and the audit trail. Each one is a thing a banker would still expect to find
        // tomorrow, and each refusal is proved by asking for it.
        //
        // The collateral aggregate SHELL is deliberately not on this list any more (2026-09-14,
        // backlog row 46): it is a per-facility rollup anchor with no lookup back, so a discard
        // that kept it left an empty row behind for good. It is now on the discard's delete set and
        // is proved above.
        for (String obj : new List<String>{
            C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, C360WriteGuard.OBJ_COVENANT,
            C360WriteGuard.OBJ_ACCOUNT_COVENANT, 'cm_Action_Staging__c',
            C360WriteGuard.OBJ_LOAN_DETAIL, C360WriteGuard.OBJ_REVIEW, C360WriteGuard.OBJ_CASE,
            C360WriteGuard.OBJ_POLICY_EXCEPTION, C360WriteGuard.OBJ_RISK_RATING
        }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowedForTool(
                    'discard-version', obj, C360WriteGuard.OP_DELETE, new Map<String, Object>()
                );
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
                System.assert(
                    e.getMessage().contains('may not delete'),
                    'The refusal should say the action does not delete this object: ' + e.getMessage()
                );
            }
            System.assertEquals(true, refused, 'The discard keeps this on purpose. Tried: ' + obj);
        }
    }

    @IsTest
    static void aToolWithNoDeclaredDeleteSetDeletesNothing() {
        C360TestFixture.armCalloutMock();
        // 'loan-modification' left this list on 2026-09-14: it now deletes exactly one object, the
        // collateral aggregate shell its own pledge write orphans, and that is proved below.
        for (String toolId : new String[]{ 'relationship-intake', 'covenant-review', 'not-a-tool' }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowedForTool(
                    toolId, C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_DELETE, new Map<String, Object>()
                );
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
                System.assert(
                    e.getMessage().contains('deletes nothing'),
                    'The refusal should say this action deletes nothing at all: ' + e.getMessage()
                );
            }
            System.assertEquals(true, refused, 'Nothing deletes by default. Tried: ' + toolId);
        }
    }

    @IsTest
    static void thePledgeWritingToolsMayDeleteTheShellTheyOrphanAndNothingElse() {
        C360TestFixture.armCalloutMock();
        // Each of these inserts LLC_BI__Loan_Collateral2__c, and nCino answers that insert with a
        // collateral aggregate of its own that nothing ever points at. The fence is exactly one
        // object wide for each of them: they clean up after themselves and reach nothing else.
        for (String toolId : new String[]{ 'loan-modification', 'amend-version', 'new-facility-request' }) {
            C360WriteGuard.assertAllowedForTool(
                toolId, C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OP_DELETE, new Map<String, Object>()
            );
            for (String obj : new List<String>{
                C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OBJ_LOAN, C360WriteGuard.OBJ_PRODUCT_PACKAGE,
                C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OBJ_FEE, C360WriteGuard.OBJ_INVOLVEMENT
            }) {
                Boolean refused = false;
                try {
                    C360WriteGuard.assertAllowedForTool(
                        toolId, obj, C360WriteGuard.OP_DELETE, new Map<String, Object>()
                    );
                } catch (C360WriteGuard.GuardException e) {
                    refused = true;
                    System.assert(
                        e.getMessage().contains('may not delete'),
                        'The refusal should name the object this tool may not delete: ' + e.getMessage()
                    );
                }
                System.assertEquals(
                    true, refused,
                    'A sweep is not a licence to delete. Tried ' + obj + ' as ' + toolId
                );
            }
        }
    }

    @IsTest
    static void theObjectGateStillRefusesEveryDeleteInTheDiscardSet() {
        C360TestFixture.armCalloutMock();
        // The whole point of putting the delete on a per-tool door is that the object door did not
        // move. An anonymous caller asking the object gate to delete a loan is refused exactly as
        // it was before 0.9.23 existed.
        for (String obj : new List<String>{
            'LLC_BI__LoanRenewal__c', C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OBJ_LOAN_COVENANT,
            C360WriteGuard.OBJ_PRICING_STREAM, C360WriteGuard.OBJ_FEE, C360WriteGuard.OBJ_INVOLVEMENT,
            C360WriteGuard.OBJ_LOAN, C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OBJ_PRODUCT_PACKAGE
        }) {
            Boolean refused = false;
            try {
                C360WriteGuard.assertAllowed(obj, C360WriteGuard.OP_DELETE, new Map<String, Object>());
            } catch (C360WriteGuard.GuardException e) {
                refused = true;
            }
            System.assertEquals(
                true, refused,
                'The object gate never permits a delete, whatever the per-tool table says. Tried: ' + obj
            );
        }
    }

    @IsTest
    static void theDeleteOnlyObjectsAreStillOnNoCreateAndNoUpdateTable() {
        C360TestFixture.armCalloutMock();
        // Adding LLC_BI__LoanRenewal__c and the two pricing components to the delete table must not
        // have made them writable by any other route.
        for (String obj : new List<String>{
            'LLC_BI__LoanRenewal__c', 'LLC_BI__Pricing_Rate_Component__c', 'LLC_BI__Pricing_Payment_Component__c'
        }) {
            for (String op : new List<String>{ C360WriteGuard.OP_CREATE, C360WriteGuard.OP_UPDATE, C360WriteGuard.OP_CARRY }) {
                Boolean refused = false;
                try {
                    C360WriteGuard.assertAllowed(obj, op, new Map<String, Object>());
                } catch (C360WriteGuard.GuardException e) {
                    refused = true;
                }
                System.assertEquals(true, refused, 'Nothing authors ' + obj + '. Operation: ' + op);
            }
        }
    }
}
