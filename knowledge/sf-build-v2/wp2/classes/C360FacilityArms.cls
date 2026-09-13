/**
 * C360FacilityArms - the covenant and collateral arms, wherever a facility plan carries them.
 *
 * BACKLOG ROW 49, SECOND HALF (founder, 2026-09-13). `stage_loan_modification` and
 * `stage_amend_version` could already take a net-new covenant, a covenant association and a
 * collateral pledge in the same plan as the change they were making. `stage_new_facility` and
 * `stage_renewal` could not, so a banker opening a new facility with a covenant on it had to stage
 * two actions and confirm two plans for one decision. This class is what lets the other two carry
 * the same three arms without a fourth copy of the plan shape.
 *
 * THE PARSERS ARE NOT HERE, AND THAT IS DELIBERATE. `StageLoanModification` owns them and they are
 * `public static` for exactly this reason (LESSONS 55): they carry the org resolution - the covenant
 * type catalog, the collateral type catalog and its duplicate names, the advance-rate precedence,
 * the ownership junction - and a second copy would drift the first time a picklist moves. What lives
 * here is the PLAN half and the AUTHORING half around them, which the modification cannot share
 * because its own version runs against a clone map and a relay across two transactions.
 *
 * TWO ENTRY POINTS:
 *   plan()   appends the plan steps and the plan values for any number of targets, booked or
 *            net-new. Step ids and value prefixes are byte-identical to the amend's, so a room that
 *            can render one renders the other.
 *   author() writes them, for ONE target facility, and verifies every row by re-query. That is the
 *            shape `execute_new_facility` needs: the facility it just created is the only target a
 *            new-facility plan can have.
 *
 * A RENEWAL PLANS AND DOES NOT AUTHOR. There is no execute_renewal, so stage_renewal calls plan()
 * and says in the plan that execution is not deployed. The arms are still validated against the org
 * at stage time, so a future execute wave inherits a plan it can honour rather than a story it has
 * to contradict.
 */
public with sharing class C360FacilityArms {

    /** What one authoring run did, for the outcome sentence and the tool's own result fields. */
    public class Authored {
        public Integer covenantsCreated = 0;
        public Integer covenantsAssociated = 0;
        public Integer pledgesCreated = 0;
        public Integer assetsCreated = 0;
        /** Null when nothing was authored, which is the ordinary answer. */
        public String sentence;
    }

    /**
     * Raised when a plan asks one transaction to author more rows than the org's change stream
     * leaves room for. The calling tool maps it to ok:false.
     */
    public class BudgetException extends Exception {}

    /**
     * THE PER-TRANSACTION ARM BUDGET.
     *
     * Every object these arms touch carries an org-local *CDC trigger that enqueues one
     * EventBridgeCallout queueable PER ROW, against a platform ceiling of 50 queued jobs in one
     * synchronous transaction; exceeding it rolls the whole run back rather than filing what it
     * could. A covenant add is three rows (the covenant, its loan junction, its account junction), a
     * pledge is up to four (asset, ownership, aggregate shell, pledge) and the facility itself plus
     * its package and its borrower row are three more. Five of each kind is 5x3 + 5x1 + 5x4 = 40,
     * which leaves headroom for the platform's own async work on the same objects.
     *
     * This is a governor budget rather than a business threshold, which is why it lives in code and
     * why the refusal says so. It binds the routes that author their arms INLINE, in the same
     * transaction as the facility; the modification's arm hop runs in a transaction of its own and
     * keeps its own caps.
     */
    public static final Integer ARM_MAX_PER_KIND = 5;

    /**
     * Refuses a plan whose arms will not fit one transaction, naming the arm and the cap.
     *
     * @param covenantAdds Net-new covenants.
     * @param covenantAttaches Junction-only associations.
     * @param pledgeAdds Collateral pledges.
     */
    public static void assertBudget(
        List<StageLoanModification.CovenantAdd> covenantAdds,
        List<StageLoanModification.CovenantAttach> covenantAttaches,
        List<StageLoanModification.PledgeAdd> pledgeAdds
    ) {
        assertOne(covenantAdds.size(), 'net-new covenants');
        assertOne(covenantAttaches.size(), 'covenant associations');
        assertOne(pledgeAdds.size(), 'collateral pledges');
    }

    private static void assertOne(Integer n, String what) {
        if (n <= ARM_MAX_PER_KIND) {
            return;
        }
        throw new BudgetException(
            'This plan carries ' + n + ' ' + what + '; the cap is ' + ARM_MAX_PER_KIND +
            ' per plan on a route that authors them in the same transaction as the facility. Each row wakes a ' +
            'change-data trigger that enqueues one queueable, against a platform ceiling of 50 in one transaction, and ' +
            'exceeding it rolls the whole run back rather than filing what it could. Stage the rest as a modification.'
        );
    }

    /** nCino's own operator vocabulary on the covenant's Financial Indicator field. */
    private static final Map<String, String> FI_OPERATOR = new Map<String, String>{
        '<' => 'Less Than',
        '<=' => 'Less Than or Equal To',
        '=' => 'Equal To',
        '>=' => 'Greater Than or Equal To',
        '>' => 'Greater Than'
    };

    // -------------------------------------------------------------------------------- the plan

    /**
     * Appends the arm steps and the arm plan values for every entry, whatever it targets.
     *
     * The target is recorded TWICE and neither is redundant: `targetLoanId` for an arm aimed at a
     * facility that already exists, `targetLabel` for one aimed at a facility this plan creates and
     * whose id is minted at execute time. Exactly one of them is non-null on any entry.
     *
     * @param resolved The plan's resolved-values map, mutated in place.
     * @param steps The plan's steps, appended to.
     * @param facilityNameById The selected facilities, for the banker copy on each step.
     * @param newFacilities The facilities this plan creates, for the same.
     * @param covenantAdds Net-new covenants, already resolved against the org.
     * @param covenantAttaches Existing covenants to junction on.
     * @param pledgeAdds Collateral pledges, already resolved against the org.
     */
    public static void plan(
        Map<String, Object> resolved,
        List<C360Plan.Step> steps,
        Map<Id, String> facilityNameById,
        List<C360NewFacilities.NewFacility> newFacilities,
        List<StageLoanModification.CovenantAdd> covenantAdds,
        List<StageLoanModification.CovenantAttach> covenantAttaches,
        List<StageLoanModification.PledgeAdd> pledgeAdds
    ) {
        for (Integer i = 0; i < covenantAdds.size(); i++) {
            StageLoanModification.CovenantAdd a = covenantAdds[i];
            String s = String.valueOf(i);
            String targetName = nameOf(a.targetLoanId, a.targetNewLabel, facilityNameById, newFacilities);
            resolved.put('covenantAdd' + s + '.typeId', a.typeId == null ? null : String.valueOf(a.typeId));
            resolved.put('covenantAdd' + s + '.typeName', a.typeName);
            resolved.put('covenantAdd' + s + '.threshold', a.threshold);
            resolved.put('covenantAdd' + s + '.operator', a.operator);
            resolved.put('covenantAdd' + s + '.frequency', a.frequency);
            resolved.put('covenantAdd' + s + '.effectiveDate', a.effectiveDate);
            resolved.put('covenantAdd' + s + '.targetLoanId', a.targetLoanId == null ? null : String.valueOf(a.targetLoanId));
            resolved.put('covenantAdd' + s + '.targetLabel', a.targetNewLabel);

            steps.add(
                new C360Plan.Step('covenant_create_' + s, C360Plan.TYPE_WRITE,
                    'Create net-new covenant on the borrower: ' + a.typeName + ' ' + a.operator + ' ' +
                    String.valueOf(a.threshold) + ', tested ' + a.frequency + ', effective ' +
                    String.valueOf(a.effectiveDate) + ', born Pending and Active')
                    .onObject(C360WriteGuard.OBJ_COVENANT, new List<String>{
                        'LLC_BI__Covenant_Type__c', 'LLC_BI__Financial_Indicator_Value__c', 'Financial_Indicator_Operator__c',
                        'LLC_BI__Frequency__c', 'LLC_BI__Effective_Date__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Financial_Indicator_Value__c FROM LLC_BI__Covenant2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_attach_' + s, C360Plan.TYPE_WRITE,
                    'Attach it to ' + targetName + ', and associate it to the borrower account the way nCino\'s own UI does')
                    .onObject(C360WriteGuard.OBJ_LOAN_COVENANT, new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c',
                        'LLC_BI__Account_Covenant__c: LLC_BI__Account__c + LLC_BI__Covenant2__c'
                    })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :createdId')
            );
            steps.add(
                new C360Plan.Step('covenant_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the covenant and its junction on ' + targetName)
                    .onObject(C360WriteGuard.OBJ_COVENANT, new List<String>{ 'Id', 'LLC_BI__Financial_Indicator_Value__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :createdId')
            );
        }
        resolved.put('covenantAddCount', covenantAdds.size());

        for (Integer i = 0; i < covenantAttaches.size(); i++) {
            StageLoanModification.CovenantAttach ca = covenantAttaches[i];
            String s = String.valueOf(i);
            String targetName = nameOf(ca.targetLoanId, ca.targetNewLabel, facilityNameById, newFacilities);
            resolved.put('covenantAttach' + s + '.covenantId', ca.covenantId == null ? null : String.valueOf(ca.covenantId));
            resolved.put('covenantAttach' + s + '.covenantName', ca.covenantName);
            resolved.put('covenantAttach' + s + '.typeName', ca.typeName);
            resolved.put('covenantAttach' + s + '.threshold', ca.threshold);
            resolved.put('covenantAttach' + s + '.operator', ca.operator);
            resolved.put('covenantAttach' + s + '.targetLoanId', ca.targetLoanId == null ? null : String.valueOf(ca.targetLoanId));
            resolved.put('covenantAttach' + s + '.targetLabel', ca.targetNewLabel);

            steps.add(
                new C360Plan.Step('covenant_associate_' + s, C360Plan.TYPE_WRITE,
                    'Associate the existing covenant ' + ca.covenantName + ' (' + ca.typeName + ') to ' + targetName +
                    ': a junction only, no covenant is created and none is amended')
                    .onObject(C360WriteGuard.OBJ_LOAN_COVENANT, new List<String>{ 'LLC_BI__Loan__c', 'LLC_BI__Covenant2__c' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :covenantId')
            );
            steps.add(
                new C360Plan.Step('covenant_associate_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the junction on ' + targetName + ' and prove the covenant record itself is unchanged')
                    .onObject(C360WriteGuard.OBJ_LOAN_COVENANT, new List<String>{ 'Id' })
                    .provenBy('SELECT Id FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :covenantId')
            );
        }
        resolved.put('covenantAttachCount', covenantAttaches.size());

        for (Integer i = 0; i < pledgeAdds.size(); i++) {
            StageLoanModification.PledgeAdd pa = pledgeAdds[i];
            String s = String.valueOf(i);
            String targetName = nameOf(pa.targetLoanId, pa.targetNewLabel, facilityNameById, newFacilities);
            // NULL STAYS NULL. String.valueOf(null) is the four-character string 'null', and
            // C360Plan.asId on the other side would try to make a record id out of it.
            resolved.put('pledgeAdd' + s + '.isNew', pa.isNew);
            resolved.put('pledgeAdd' + s + '.collateralId', pa.collateralId == null ? null : String.valueOf(pa.collateralId));
            resolved.put('pledgeAdd' + s + '.description', pa.description);
            resolved.put('pledgeAdd' + s + '.collateralTypeId', pa.collateralTypeId == null ? null : String.valueOf(pa.collateralTypeId));
            resolved.put('pledgeAdd' + s + '.collateralTypeName', pa.collateralTypeName);
            resolved.put('pledgeAdd' + s + '.newValue', pa.newValue);
            resolved.put('pledgeAdd' + s + '.advanceRate', pa.advanceRate);
            resolved.put('pledgeAdd' + s + '.advanceRateReason', pa.advanceRateReason);
            resolved.put('pledgeAdd' + s + '.amountPledged', pa.amountPledged);
            resolved.put('pledgeAdd' + s + '.authoriseOverPledge', pa.authoriseOverPledge);
            resolved.put('pledgeAdd' + s + '.lienPosition', pa.lienPosition);
            resolved.put('pledgeAdd' + s + '.pledgedStatus', pa.pledgedStatus);
            resolved.put('pledgeAdd' + s + '.assetLabel', pa.assetLabel);
            resolved.put('pledgeAdd' + s + '.targetLoanId', pa.targetLoanId == null ? null : String.valueOf(pa.targetLoanId));
            resolved.put('pledgeAdd' + s + '.targetLabel', pa.targetNewLabel);

            if (pa.isNew == true) {
                steps.add(
                    new C360Plan.Step('collateral_create_' + s, C360Plan.TYPE_WRITE,
                        'Create the asset "' + pa.description + '" as ' + pa.collateralTypeName + ', valued at ' +
                        String.valueOf(pa.newValue) +
                        '. Name on a collateral is an autonumber, so the description is its readable identity')
                        .onObject(C360WriteGuard.OBJ_COLLATERAL, new List<String>{
                            'LLC_BI__Collateral_Type__c', 'LLC_BI__Value__c', 'LLC_BI__Description__c'
                        })
                        .provenBy('SELECT Id, Name, LLC_BI__Value__c FROM LLC_BI__Collateral__c WHERE Id = :createdId')
                );
                steps.add(
                    new C360Plan.Step('collateral_own_' + s, C360Plan.TYPE_WRITE,
                        'Record the borrower as owner of "' + pa.description +
                        '". LLC_BI__Collateral__c carries NO account lookup, so this junction is the asset\'s only ' +
                        'link to the relationship')
                        .onObject(C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, new List<String>{
                            'LLC_BI__Account__c', 'LLC_BI__Collateral__c', 'LLC_BI__Ownership_Percentage__c', 'LLC_BI__Primary_Owner__c'
                        })
                        .provenBy('SELECT Id FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = :createdId')
                );
            }
            steps.add(
                new C360Plan.Step('pledge_add_' + s, C360Plan.TYPE_WRITE,
                    'Pledge ' + pa.assetLabel + ' to ' + targetName + ': ' + StageLoanModification.pledgePhrase(pa))
                    .onObject(C360WriteGuard.OBJ_PLEDGE, new List<String>{
                        'LLC_BI__Loan__c', 'LLC_BI__Collateral__c', 'LLC_BI__Loan_Collateral_Aggregate__c',
                        'LLC_BI__Pledged_Status__c', 'LLC_BI__Active__c', 'LLC_BI__Amount_Pledged__c',
                        'LLC_BI__Lien_Position__c', 'LLC_BI__Advance_Rate_Override__c', 'LLC_BI__Override_Reason__c'
                    })
                    .wakes(new List<String>{
                        'nCino collateral aggregate automation: the pledge hangs off the facility\'s own ' +
                        'LLC_BI__Loan_Collateral_Aggregate__c, reused where the facility already carries one and minted ' +
                        'where it does not, because the lookup is not updateable afterwards'
                    })
                    .provenBy('SELECT Id, LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c FROM LLC_BI__Loan_Collateral2__c WHERE Id = :createdId')
            );
            steps.add(
                new C360Plan.Step('pledge_verify_' + s, C360Plan.TYPE_VERIFICATION,
                    'Re-read the pledge on ' + targetName +
                    ', with the advance rate the org resolved and the lendable value it derived from it')
                    .onObject(C360WriteGuard.OBJ_PLEDGE, new List<String>{
                        'Id', 'LLC_BI__Collateral__c', 'LLC_BI__Advance_Rate__c', 'LLC_BI__Current_Lendable_Value__c'
                    })
                    .provenBy('SELECT Id, LLC_BI__Collateral__c, LLC_BI__Advance_Rate__c FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c = :targetLoanId')
            );
        }
        resolved.put('pledgeAddCount', pledgeAdds.size());
    }

    /**
     * The warnings the three arms earn, in banker language.
     *
     * @param covenantAdds Net-new covenants.
     * @param covenantAttaches Junction-only associations.
     * @param pledgeAdds Collateral pledges.
     * @param anchorPhrase How the calling tool names what the arms land on.
     * @return The warnings, empty when no arm is carried.
     */
    public static List<String> warnings(
        List<StageLoanModification.CovenantAdd> covenantAdds,
        List<StageLoanModification.CovenantAttach> covenantAttaches,
        List<StageLoanModification.PledgeAdd> pledgeAdds,
        String anchorPhrase
    ) {
        List<String> out = new List<String>();
        if (!covenantAdds.isEmpty()) {
            out.add(
                String.valueOf(covenantAdds.size()) + ' net-new covenant' + (covenantAdds.size() == 1 ? '' : 's') +
                ' will be created on the borrower and attached to ' + anchorPhrase + ', born Pending and Active. ' +
                'A covenant create mints NO compliance record, so it starts no approval and sends no email: the org\'s ' +
                'unrecallable covenant approval fires on a COMPLIANCE create, which this action never performs.'
            );
        }
        if (!covenantAttaches.isEmpty()) {
            out.add(
                String.valueOf(covenantAttaches.size()) + ' existing covenant' + (covenantAttaches.size() == 1 ? '' : 's') +
                ' will be associated to ' + anchorPhrase + ' by junction only. No covenant record is created, amended or deleted.'
            );
        }
        Integer created = StageLoanModification.newCollaterals(pledgeAdds);
        if (!pledgeAdds.isEmpty()) {
            out.add(
                String.valueOf(pledgeAdds.size()) + ' collateral pledge' + (pledgeAdds.size() == 1 ? '' : 's') +
                ' will be authored on ' + anchorPhrase +
                (created == 0
                    ? ', against assets the borrower already owns.'
                    : ', and ' + created + ' new asset' + (created == 1 ? '' : 's') +
                      ' will be created with the borrower recorded as owner: LLC_BI__Collateral__c carries no account ' +
                      'lookup, so the ownership junction is the only link the asset has to the relationship.') +
                ' The advance rate a pledge resolves to is a FORMULA on the org side, so the lendable value is reported ' +
                'from the re-read row rather than claimed from the figure staged here.'
            );
        }
        return out;
    }

    /** How the plan names an arm's target, whether it exists or is about to. */
    private static String nameOf(
        Id targetLoanId,
        String targetNewLabel,
        Map<Id, String> facilityNameById,
        List<C360NewFacilities.NewFacility> newFacilities
    ) {
        if (targetNewLabel == null) {
            return facilityNameById.containsKey(targetLoanId) ? facilityNameById.get(targetLoanId) : String.valueOf(targetLoanId);
        }
        return targetNewLabel + ', ' + C360NewFacilities.phrase(
            C360NewFacilities.byLabel(targetNewLabel, newFacilities, 'plan step')
        );
    }

    // ------------------------------------------------------------------------------ the writes

    /**
     * Authors every arm on ONE facility, and proves each row by re-query.
     *
     * SINGLE TARGET, BY CONSTRUCTION. A new-facility plan creates exactly one facility, so every arm
     * it carries lands there and the staged target - a label, since the id did not exist at stage
     * time - resolves to the facility this run just created. Nothing here reads a target off the
     * plan, which is why a stale target cannot send a covenant somewhere nobody confirmed.
     *
     * THE PROOF IS ALWAYS THE RE-READ. An insert returning an id says the DML succeeded; the row
     * reading back with the value on it is what says the org kept it. A row that cannot be read back
     * lands `filed_unverified` rather than `verified`, which is the honest state.
     *
     * @param steps The plan steps, mutated in place.
     * @param v The staged plan values.
     * @param accountId The borrower every covenant and every owned asset hangs off.
     * @param targetLoanId The facility every arm lands on.
     * @param targetName That facility's org-assigned name, for the step detail.
     * @return What was authored, with the sentence the outcome uses.
     */
    public static Authored author(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        Id accountId,
        Id targetLoanId,
        String targetName
    ) {
        Authored out = new Authored();

        Integer covenantAddCount = intCount(v.get('covenantAddCount'));
        for (Integer i = 0; i < covenantAddCount; i++) {
            String s = String.valueOf(i);
            Id typeId = C360Plan.asId(v.get('covenantAdd' + s + '.typeId'));
            Decimal threshold = C360Plan.asDecimal(v.get('covenantAdd' + s + '.threshold'));
            String operator = C360Plan.asString(v.get('covenantAdd' + s + '.operator'));
            String typeName = C360Plan.asString(v.get('covenantAdd' + s + '.typeName'));
            if (typeId == null || threshold == null) {
                String why = 'The staged covenant add is incomplete (type or threshold missing), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_create_' + s, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'covenant_attach_' + s, C360Plan.STATE_SKIPPED, why);
                C360Plan.setState(steps, 'covenant_verify_' + s, C360Plan.STATE_FAILED, why);
                continue;
            }

            Map<String, Object> covFields = new Map<String, Object>{
                'LLC_BI__Account__c' => accountId,
                'LLC_BI__Covenant_Type__c' => typeId,
                'LLC_BI__Financial_Indicator_Value__c' => threshold,
                'Acnpex_Threshold_Value__c' => threshold,
                'Financial_Indicator_Operator__c' => FI_OPERATOR.get(operator),
                'Acnpex_Operator__c' => operator,
                'LLC_BI__Frequency__c' => C360Plan.asString(v.get('covenantAdd' + s + '.frequency')),
                'LLC_BI__Effective_Date__c' => C360Plan.asDate(v.get('covenantAdd' + s + '.effectiveDate')),
                'LLC_BI__Covenant_Status__c' => 'Pending',
                'LLC_BI__Active__c' => 'true'
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE, covFields);
            LLC_BI__Covenant2__c cov = new LLC_BI__Covenant2__c(
                LLC_BI__Account__c = accountId,
                LLC_BI__Covenant_Type__c = typeId,
                LLC_BI__Financial_Indicator_Value__c = threshold,
                Acnpex_Threshold_Value__c = threshold,
                Financial_Indicator_Operator__c = FI_OPERATOR.get(operator),
                Acnpex_Operator__c = operator,
                LLC_BI__Frequency__c = (String) covFields.get('LLC_BI__Frequency__c'),
                LLC_BI__Effective_Date__c = (Date) covFields.get('LLC_BI__Effective_Date__c'),
                LLC_BI__Covenant_Status__c = 'Pending',
                LLC_BI__Active__c = true
            );
            insert as user cov;
            out.covenantsCreated++;
            C360Plan.setState(steps, 'covenant_create_' + s, C360Plan.STATE_VERIFIED,
                'Covenant ' + cov.Id + ' created: ' + typeName + ' ' + operator + ' ' + String.valueOf(threshold) + '.');

            attachCovenant(cov.Id, accountId, targetLoanId);
            C360Plan.setState(steps, 'covenant_attach_' + s, C360Plan.STATE_VERIFIED,
                'Attached to ' + targetName + ', with the account association beside it on the borrower.');

            List<LLC_BI__Covenant2__c> covBack = [
                SELECT Id, Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c
                FROM LLC_BI__Covenant2__c WHERE Id = :cov.Id WITH USER_MODE LIMIT 1
            ];
            Integer attachBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :cov.Id WITH USER_MODE
            ];
            Boolean proven = !covBack.isEmpty()
                && covBack[0].LLC_BI__Financial_Indicator_Value__c == threshold
                && attachBack == 1;
            C360Plan.setState(steps, 'covenant_verify_' + s,
                proven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                covBack.isEmpty()
                    ? 'The covenant could not be read back after creation.'
                    : 'Covenant ' + covBack[0].Name + ' reads back at ' +
                      String.valueOf(covBack[0].LLC_BI__Financial_Indicator_Value__c) + ', status ' +
                      covBack[0].LLC_BI__Covenant_Status__c + ', with ' + attachBack + ' junction on ' + targetName + '.');
        }

        Integer covenantAttachCount = intCount(v.get('covenantAttachCount'));
        for (Integer i = 0; i < covenantAttachCount; i++) {
            String s = String.valueOf(i);
            Id covenantId = C360Plan.asId(v.get('covenantAttach' + s + '.covenantId'));
            String covenantName = C360Plan.asString(v.get('covenantAttach' + s + '.covenantName'));
            if (covenantId == null) {
                String why = 'The staged association is incomplete (no resolved covenant), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_associate_' + s, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'covenant_associate_verify_' + s, C360Plan.STATE_FAILED, why);
                continue;
            }
            attachCovenant(covenantId, accountId, targetLoanId);
            out.covenantsAssociated++;
            C360Plan.setState(steps, 'covenant_associate_' + s, C360Plan.STATE_VERIFIED,
                covenantName + ' associated to ' + targetName + ': a junction only, the covenant record untouched.');

            Integer attachedBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :targetLoanId AND LLC_BI__Covenant2__c = :covenantId WITH USER_MODE
            ];
            C360Plan.setState(steps, 'covenant_associate_verify_' + s,
                attachedBack == 1 ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                attachedBack == 1
                    ? covenantName + ' reads back on ' + targetName + ', once, with the covenant record unchanged.'
                    : 'Not proven: the facility reads ' + attachedBack + ' junctions for this covenant.');
        }

        authorPledges(steps, v, accountId, targetLoanId, targetName, out);
        out.sentence = sentence(out, targetName);
        return out;
    }

    /**
     * The covenant's two junctions: onto the facility, and onto the borrower.
     *
     * nCino's own UI writes both, and the account association is what makes the covenant appear on
     * the relationship at all. It is minted only where the covenant does not already carry one.
     */
    private static void attachCovenant(Id covenantId, Id accountId, Id targetLoanId) {
        Map<String, Object> attachFields = new Map<String, Object>{
            'LLC_BI__Loan__c' => targetLoanId,
            'LLC_BI__Covenant2__c' => covenantId
        };
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE, attachFields);
        insert as user new LLC_BI__Loan_Covenant__c(
            LLC_BI__Loan__c = targetLoanId,
            LLC_BI__Covenant2__c = covenantId
        );

        Integer existing = [
            SELECT COUNT() FROM LLC_BI__Account_Covenant__c
            WHERE LLC_BI__Account__c = :accountId AND LLC_BI__Covenant2__c = :covenantId WITH USER_MODE
        ];
        if (existing > 0) {
            return;
        }
        Map<String, Object> acctFields = new Map<String, Object>{
            'LLC_BI__Covenant2__c' => covenantId,
            'LLC_BI__Account__c' => accountId
        };
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COVENANT, C360WriteGuard.OP_CREATE, acctFields);
        insert as user new LLC_BI__Account_Covenant__c(
            LLC_BI__Covenant2__c = covenantId,
            LLC_BI__Account__c = accountId
        );
    }

    /**
     * The collateral chain: asset, ownership junction, aggregate shell, pledge, in that order.
     *
     * `LLC_BI__Loan_Collateral2__c` requires THREE parents (LESSONS 15ac), and the aggregate lookup
     * is not updateable after insert, so the shell has to exist before the pledge row is built. A
     * new facility carries no pledges yet, so there is never one to reuse and one is always minted.
     */
    private static void authorPledges(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        Id accountId,
        Id targetLoanId,
        String targetName,
        Authored out
    ) {
        Integer pledgeAddCount = intCount(v.get('pledgeAddCount'));
        if (pledgeAddCount == 0) {
            return;
        }

        List<LLC_BI__Collateral__c> newAssets = new List<LLC_BI__Collateral__c>();
        List<Integer> assetIndexOfRow = new List<Integer>();
        List<Id> collateralOf = new List<Id>();

        for (Integer i = 0; i < pledgeAddCount; i++) {
            String s = String.valueOf(i);
            collateralOf.add(null);
            if (v.get('pledgeAdd' + s + '.isNew') == true) {
                Map<String, Object> assetFields = new Map<String, Object>{
                    'LLC_BI__Collateral_Type__c' => C360Plan.asId(v.get('pledgeAdd' + s + '.collateralTypeId')),
                    'LLC_BI__Value__c' => C360Plan.asDecimal(v.get('pledgeAdd' + s + '.newValue')),
                    'LLC_BI__Description__c' => C360Plan.asString(v.get('pledgeAdd' + s + '.description'))
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OP_CREATE, assetFields);
                newAssets.add(new LLC_BI__Collateral__c(
                    LLC_BI__Collateral_Type__c = (Id) assetFields.get('LLC_BI__Collateral_Type__c'),
                    LLC_BI__Value__c = (Decimal) assetFields.get('LLC_BI__Value__c'),
                    LLC_BI__Description__c = (String) assetFields.get('LLC_BI__Description__c')
                ));
                assetIndexOfRow.add(i);
            } else {
                collateralOf[i] = C360Plan.asId(v.get('pledgeAdd' + s + '.collateralId'));
            }
        }

        if (!newAssets.isEmpty()) {
            insert as user newAssets;
            out.assetsCreated = newAssets.size();
            List<LLC_BI__Account_Collateral__c> ownerships = new List<LLC_BI__Account_Collateral__c>();
            for (Integer k = 0; k < newAssets.size(); k++) {
                Integer i = assetIndexOfRow[k];
                collateralOf[i] = newAssets[k].Id;
                C360Plan.setState(steps, 'collateral_create_' + i, C360Plan.STATE_VERIFIED,
                    'Asset created for "' + C360Plan.asString(v.get('pledgeAdd' + i + '.assetLabel')) + '".');
                Map<String, Object> ownFields = new Map<String, Object>{
                    'LLC_BI__Account__c' => accountId,
                    'LLC_BI__Collateral__c' => newAssets[k].Id,
                    'LLC_BI__Ownership_Percentage__c' => 100,
                    'LLC_BI__Primary_Owner__c' => true
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COLLATERAL, C360WriteGuard.OP_CREATE, ownFields);
                ownerships.add(new LLC_BI__Account_Collateral__c(
                    LLC_BI__Account__c = accountId,
                    LLC_BI__Collateral__c = newAssets[k].Id,
                    LLC_BI__Ownership_Percentage__c = 100,
                    LLC_BI__Primary_Owner__c = true
                ));
            }
            insert as user ownerships;
            for (Integer k = 0; k < ownerships.size(); k++) {
                C360Plan.setState(steps, 'collateral_own_' + assetIndexOfRow[k], C360Plan.STATE_VERIFIED,
                    'The borrower is recorded as sole owner of "' +
                    C360Plan.asString(v.get('pledgeAdd' + assetIndexOfRow[k] + '.assetLabel')) + '".');
            }
        }

        LLC_BI__Loan_Collateral_Aggregate__c agg = new LLC_BI__Loan_Collateral_Aggregate__c(Name = 'Collateral Aggregate');
        C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OP_CARRY,
            new Map<String, Object>{ 'Name' => null });
        insert as user agg;

        List<LLC_BI__Loan_Collateral2__c> pledgeRows = new List<LLC_BI__Loan_Collateral2__c>();
        List<Integer> indexOfRow = new List<Integer>();
        for (Integer i = 0; i < pledgeAddCount; i++) {
            String s = String.valueOf(i);
            if (collateralOf[i] == null) {
                String why = 'The staged pledge names no asset, so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'pledge_add_' + s, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'pledge_verify_' + s, C360Plan.STATE_FAILED, why);
                continue;
            }
            Decimal rateOverride = C360Plan.asDecimal(v.get('pledgeAdd' + s + '.advanceRate'));
            String overrideReason = C360Plan.asString(v.get('pledgeAdd' + s + '.advanceRateReason'));
            String lien = C360Plan.asString(v.get('pledgeAdd' + s + '.lienPosition'));
            Boolean authorise = C360Plan.asBool(v.get('pledgeAdd' + s + '.authoriseOverPledge'));
            Decimal amountPledged = C360Plan.asDecimal(v.get('pledgeAdd' + s + '.amountPledged'));
            Map<String, Object> pledgeFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => targetLoanId,
                'LLC_BI__Collateral__c' => collateralOf[i],
                'LLC_BI__Pledged_Status__c' => C360Plan.asString(v.get('pledgeAdd' + s + '.pledgedStatus')),
                'LLC_BI__Active__c' => true,
                'LLC_BI__Amount_Pledged__c' => amountPledged,
                'LLC_BI__Lien_Position__c' => lien,
                'LLC_BI__Advance_Rate_Override__c' => rateOverride,
                'LLC_BI__Override_Reason__c' => overrideReason,
                'LLC_BI__Authorize__c' => authorise
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE, pledgeFields);
            pledgeRows.add(new LLC_BI__Loan_Collateral2__c(
                LLC_BI__Loan__c = targetLoanId,
                LLC_BI__Collateral__c = collateralOf[i],
                LLC_BI__Loan_Collateral_Aggregate__c = agg.Id,
                LLC_BI__Pledged_Status__c = C360Plan.asString(v.get('pledgeAdd' + s + '.pledgedStatus')),
                LLC_BI__Active__c = true,
                LLC_BI__Amount_Pledged__c = amountPledged,
                LLC_BI__Lien_Position__c = lien,
                LLC_BI__Advance_Rate_Override__c = rateOverride,
                LLC_BI__Override_Reason__c = overrideReason,
                LLC_BI__Authorize__c = authorise
            ));
            indexOfRow.add(i);
        }
        if (pledgeRows.isEmpty()) {
            return;
        }
        insert as user pledgeRows;
        out.pledgesCreated = pledgeRows.size();

        Map<Id, LLC_BI__Loan_Collateral2__c> back = new Map<Id, LLC_BI__Loan_Collateral2__c>([
            SELECT Id, LLC_BI__Collateral__c, LLC_BI__Amount_Pledged__c,
                   LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c
            FROM LLC_BI__Loan_Collateral2__c WHERE Id IN :pledgeRows WITH USER_MODE
        ]);
        for (Integer k = 0; k < pledgeRows.size(); k++) {
            Integer i = indexOfRow[k];
            String s = String.valueOf(i);
            LLC_BI__Loan_Collateral2__c row = back.get(pledgeRows[k].Id);
            String label = C360Plan.asString(v.get('pledgeAdd' + s + '.assetLabel'));
            if (row == null) {
                C360Plan.setState(steps, 'pledge_add_' + s, C360Plan.STATE_FILED_UNVERIFIED,
                    'The pledge was inserted but could not be read back.');
                C360Plan.setState(steps, 'pledge_verify_' + s, C360Plan.STATE_FAILED,
                    'The pledge could not be read back, so nothing about it is proven.');
                continue;
            }
            C360Plan.setState(steps, 'pledge_add_' + s, C360Plan.STATE_VERIFIED,
                label + ' pledged to ' + targetName + '.');
            C360Plan.setState(steps, 'pledge_verify_' + s, C360Plan.STATE_VERIFIED,
                label + ' reads back with an amount pledged of ' + String.valueOf(row.LLC_BI__Amount_Pledged__c) +
                ', the org resolving the advance rate to ' + String.valueOf(row.LLC_BI__Advance_Rate__c) +
                ' percent and the lendable value to ' + String.valueOf(row.LLC_BI__Current_Lendable_Value__c) +
                '. The advance rate is a formula over the override, the auto-applied rate and the type default, so it is ' +
                'reported from the org rather than asserted against the figure staged.');
        }
    }

    /** The outcome half-sentence, or null when this plan carried no arm at all. */
    private static String sentence(Authored a, String targetName) {
        List<String> said = new List<String>();
        if (a.covenantsCreated > 0) {
            said.add(a.covenantsCreated + ' net-new covenant' + (a.covenantsCreated == 1 ? '' : 's'));
        }
        if (a.covenantsAssociated > 0) {
            said.add(a.covenantsAssociated + ' existing covenant' + (a.covenantsAssociated == 1 ? '' : 's') + ' associated');
        }
        if (a.pledgesCreated > 0) {
            said.add(a.pledgesCreated + ' collateral pledge' + (a.pledgesCreated == 1 ? '' : 's') +
                (a.assetsCreated == 0 ? '' : ' (' + a.assetsCreated + ' new asset' + (a.assetsCreated == 1 ? '' : 's') + ')'));
        }
        return said.isEmpty() ? null : String.join(said, ', ') + ' filed on ' + targetName + '.';
    }

    /** A count out of the plan values, which deserialise as Decimal. */
    private static Integer intCount(Object raw) {
        Decimal d = C360Plan.asDecimal(raw);
        return d == null ? 0 : Integer.valueOf(d);
    }
}
