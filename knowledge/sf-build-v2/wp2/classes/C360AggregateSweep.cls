/**
 * C360AggregateSweep - removes the `LLC_BI__Loan_Collateral_Aggregate__c` shells a pledge write
 * mints and never links, in the SAME transaction that minted them.
 *
 * WHY THIS EXISTS, from the org proof of 2026-09-14 (backlog row 46). When a version is created,
 * the arm inserts the copied pledges with an explicit per-clone shell on each. nCino's own managed
 * collateral automation mints a SECOND shell per pledge insert, and nothing ever points at it: the
 * clone already carries ours. Five such rows were left behind by one Hartwell version creation
 * (a4Sbb00000GYfva..ve, all `CreatedDate` 2026-09-14T02:31:23Z, pledged count 0, value 0, lookup
 * key null, referenced by no loan and no pledge). They are orphans FROM BIRTH, so the discard can
 * never see them: a discard reads shells off the version's own facilities, and no facility ever
 * pointed at these. The only place that can name them is the transaction that caused them.
 *
 * THE WINDOW IS THE TRANSACTION, AND THE PROOF IS THE RE-READ. The sweep takes the moment the
 * caller started, reads back every shell born since then under the running user with no lookup key,
 * subtracts every shell a loan or a pledge points at, and deletes what is left. A shell a human
 * keyed (`LLC_BI__lookupKey__c` is the only field that says so) and a shell anything at all still
 * references are both left where they stand. Zero rows is a perfectly good answer and reads
 * `verified`, because "nothing was orphaned" is what a healthy run looks like.
 *
 * IT NEVER FAILS THE CALLER. A version the bank asked for is worth more than a tidy shell table, so
 * every failure is caught and reported on the step rather than thrown: the run reads partial and
 * names the rows it could not remove.
 *
 * The delete passes `C360WriteGuard.assertAllowedForTool(<tool>, ..., OP_DELETE, ...)`, so a tool
 * that has not been named on the guard's delete table cannot sweep anything at all.
 */
public with sharing class C360AggregateSweep {

    /** The step every caller settles from this sweep. Declared by each tool's stage plan. */
    public static final String STEP_ID = 'sweep_aggregates';

    /**
     * More unlinked shells than one transaction should ever mint. Past this the sweep reports and
     * deletes nothing: a number that large is a data problem, and a delete is the wrong answer to
     * one.
     */
    private static final Integer MAX_SWEEP = 50;

    /** What the sweep did, in the shape a plan step needs. */
    public class Result {
        /** Shells deleted and proven gone by re-query. */
        public Integer swept = 0;
        /** Shells the sweep asked the org to remove that read back afterwards. */
        public Integer remaining = 0;
        /** True when nothing the sweep targeted is still standing. */
        public Boolean verified = true;
        /** Banker-readable account of what happened, for the step detail. */
        public String detail;

        /** The plan state this result settles its step to. */
        public String state() {
            return verified ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FAILED;
        }
    }

    /**
     * Sweeps the shells this transaction minted and left unlinked.
     *
     * @param toolId The calling tool's action id, which must be named on the guard's delete table.
     * @param txStart The moment the caller started, captured before its first write.
     * @return What the sweep removed, and what it could not.
     */
    public static Result sweep(String toolId, Datetime txStart) {
        Result r = new Result();
        try {
            r = run(toolId, txStart);
        } catch (Exception e) {
            r.verified = false;
            r.detail = 'The collateral aggregate sweep could not run: ' + e.getMessage() +
                ' Any shell this transaction minted and left unlinked is still standing.';
        }
        return r;
    }

    private static Result run(String toolId, Datetime txStart) {
        Result r = new Result();
        Id me = UserInfo.getUserId();

        List<LLC_BI__Loan_Collateral_Aggregate__c> born = [
            SELECT Id, Name, LLC_BI__Collateral_Pledged_Count__c, LLC_BI__Total_Collateral_Value__c,
                   LLC_BI__Total_Collateral_Pledged__c
            FROM LLC_BI__Loan_Collateral_Aggregate__c
            WHERE CreatedDate >= :txStart AND CreatedById = :me AND LLC_BI__lookupKey__c = NULL
            WITH USER_MODE
        ];
        if (born.isEmpty()) {
            r.detail = 'No collateral aggregate shell was minted in this transaction, so there was nothing to sweep.';
            return r;
        }

        Map<Id, LLC_BI__Loan_Collateral_Aggregate__c> byId = new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>(born);
        Set<Id> referenced = referencedShells(byId.keySet());

        List<LLC_BI__Loan_Collateral_Aggregate__c> unlinked = new List<LLC_BI__Loan_Collateral_Aggregate__c>();
        for (LLC_BI__Loan_Collateral_Aggregate__c a : born) {
            if (referenced.contains(a.Id) || !isEmptyShell(a)) {
                continue;
            }
            unlinked.add(a);
        }

        Integer linked = born.size() - unlinked.size();
        if (unlinked.isEmpty()) {
            r.detail = 'This transaction minted ' + born.size() + ' collateral aggregate shell' +
                (born.size() == 1 ? '' : 's') + ' and a facility or a pledge points at every one of them. ' +
                'Nothing was orphaned and nothing was swept.';
            return r;
        }
        if (unlinked.size() > MAX_SWEEP) {
            r.verified = false;
            r.remaining = unlinked.size();
            r.detail = unlinked.size() + ' collateral aggregate shells minted here are unlinked, past the ' + MAX_SWEEP +
                ' this sweep will remove in one transaction. That is a data problem rather than a tidy-up, and nothing ' +
                'was deleted.';
            return r;
        }

        C360WriteGuard.assertAllowedForTool(
            toolId, C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OP_DELETE, new Map<String, Object>()
        );
        List<String> refused = new List<String>();
        for (Database.DeleteResult dr : Database.delete(unlinked, false, AccessLevel.USER_MODE)) {
            if (dr.isSuccess()) {
                continue;
            }
            for (Database.Error e : dr.getErrors()) {
                refused.add(e.getMessage());
            }
        }

        Set<Id> targeted = new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>(unlinked).keySet();
        Integer left = [
            SELECT COUNT() FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id IN :targeted WITH USER_MODE
        ];
        r.swept = unlinked.size() - left;
        r.remaining = left;
        r.verified = left == 0;
        r.detail = 'This transaction minted ' + born.size() + ' collateral aggregate shell' +
            (born.size() == 1 ? '' : 's') + ': ' + linked + ' carry a facility or a pledge and stay, ' +
            r.swept + ' were orphaned on creation and were removed, proven gone by re-query' +
            (left == 0 ? '.' : ', and ' + left + ' read back afterwards. The org said: ' + String.join(refused, '; '));
        return r;
    }

    /**
     * The shells something points at. Both legs, because either one makes a shell live: a facility
     * holds its own rollup anchor, and
     * `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` is a CASCADE lookup, so
     * deleting a shell a pledge points at would take the pledge with it.
     *
     * @param ids The shells born in this transaction.
     * @return The subset anything at all references.
     */
    private static Set<Id> referencedShells(Set<Id> ids) {
        Set<Id> held = new Set<Id>();
        for (LLC_BI__Loan__c l : [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :ids WITH USER_MODE
        ]) {
            held.add(l.LLC_BI__Loan_Collateral_Aggregate__c);
        }
        for (LLC_BI__Loan_Collateral2__c p : [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan_Collateral2__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :ids WITH USER_MODE
        ]) {
            held.add(p.LLC_BI__Loan_Collateral_Aggregate__c);
        }
        return held;
    }

    /**
     * A shell carrying nothing. The rollups are the org's own answer and read null on a row no
     * pledge has ever touched, so null and zero are the same statement here.
     *
     * @param a The shell.
     * @return True when it holds no pledge and no value.
     */
    public static Boolean isEmptyShell(LLC_BI__Loan_Collateral_Aggregate__c a) {
        return zero(a.LLC_BI__Collateral_Pledged_Count__c)
            && zero(a.LLC_BI__Total_Collateral_Value__c)
            && zero(a.LLC_BI__Total_Collateral_Pledged__c);
    }

    private static Boolean zero(Decimal d) {
        return d == null || d == 0;
    }
}
