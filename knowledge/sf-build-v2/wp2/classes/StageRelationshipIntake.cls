/**
 * StageRelationshipIntake - MCP tool: stage_relationship_intake.
 *
 * RELATIONSHIP LEVEL, NOT FACILITY LEVEL, and that is the whole reason this pair exists. The
 * modification arm creates covenants and assets on the CLONE of a facility and attaches them with
 * a loan junction; this tool creates them on the BORROWER and attaches nothing to any loan. A
 * relationship covenant carries no `LLC_BI__Loan_Covenant__c` row at all (research
 * covenant-testing-20260902 section 3: the package view is the UNION of the loan junction and the
 * relationship junction, and this org holds covenants that reach a package only through the
 * second). An asset owned by the borrower and not yet pledged is the same shape: legitimate,
 * common before close, and unreachable from any facility tool.
 *
 * So intake is intake. It files what the relationship holds. It does not lend against it, does not
 * pledge, does not price and does not open a credit action. Anything that would attach one of
 * these rows to a facility is refused by the per-tool fence in C360WriteGuard rather than left to
 * a code path that happens not to exist.
 *
 * A33.0.1: this tool performs ZERO domain-object DML. It validates every entry against the org's
 * own catalogs and picklists, computes the plan, and returns a plan hash with a plan id and a
 * single-use decision token. The only row it writes is the staging record.
 *
 * REFUSALS ARE PER ENTRY, NOT PER REQUEST. An intake list is a banker reading off a term sheet,
 * and one covenant type spelled the way the credit agreement spells it rather than the way this
 * org's catalog spells it must not discard the other nine. Every entry that cannot be written is
 * reported in `refusals` with its index and the ORG's reason, the rest are planned, and a request
 * where nothing survives is refused outright because a plan that promises no write is not a plan.
 *
 * THE CAP IS TEN PER LIST, and it is a governor budget rather than a business threshold. A full
 * plan writes up to five rows per entry across five objects (covenant, relationship junction,
 * asset, ownership junction, valuation), each insert on a change-data-captured object enqueues one
 * EventBridgeCallout queueable PER RECORD, and the platform allows 50 queued jobs per synchronous
 * transaction. Ten and ten is the budget. Stage the rest as a second plan.
 *
 * THE TWO-ROW CREATE STEP, stated rather than hidden. The wire contract names four step ids -
 * covenant_create_{i}, covenant_verify_{i}, collateral_create_{j}, collateral_verify_{j} - so a
 * create step here covers the record AND the junction that anchors it on the relationship, plus
 * the optional valuation on the collateral side. They are not separate steps because they are not
 * separately confirmable: `LLC_BI__Collateral__c` carries no account lookup of any kind on this
 * org, so an asset without its `LLC_BI__Account_Collateral__c` row belongs to nobody and cannot be
 * found from the relationship at all. The verify step re-queries every row the create step wrote
 * and reports the junction by count, so nothing is claimed that was not read back.
 *
 * Field names and picklists: read live over REST 2026-09-02, and mirrored from the create-then-
 * pledge block of ExecuteLoanModification so the two arms cannot drift.
 */
global with sharing class StageRelationshipIntake {

    /** Raised for a request-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /** Registry action id, and the per-tool key C360WriteGuard fences this pair by. */
    public static final String ACTION_ID = 'relationship-intake';

    /**
     * The per-list ceiling. See the class header: this is a queueable budget, not a policy
     * threshold, so it belongs in the code rather than in the policy pack.
     */
    public static final Integer MAX_PER_LIST = 10;

    /** Description is a 255-character textarea on this org. Refused at stage so the org never has to. */
    private static final Integer DESCRIPTION_MAX = 255;

    /**
     * The org's operator picklists, keyed by the symbol the caller sends. Two fields mirror each
     * other on every covenant in this org: Acnpex_Operator__c carries the symbol,
     * Financial_Indicator_Operator__c spells the words, including the org's own
     * 'Greater Tan or Equal To' typo, which is the ACTIVE picklist value and must be written as-is.
     */
    public static final Map<String, String> FI_OPERATOR = new Map<String, String>{
        '<' => 'Less Than',
        '<=' => 'Less Than or Equal To',
        '=' => 'Equals',
        '>=' => 'Greater Tan or Equal To',
        '>' => 'Greater Than'
    };

    global class Request {
        @InvocableVariable(label='Idempotency Key' description='Client-generated, stable across resume. Enforced by us, never assumed from the platform.' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Account Id' description='The borrowing relationship. Everything this plan files is anchored here and on nothing else: no facility, no package, no credit action.' required=true)
        global String accountId;
        @InvocableVariable(label='Rationale' description='Why these covenants and assets are being filed. Feeds the audit ledger. Required in practice, enforced in Apex so the refusal can say what it is for.')
        global String rationale;
        @InvocableVariable(label='Covenants JSON' description='Optional JSON array, max 10: [{"covenantTypeName" (exact LLC_BI__Covenant_Type__c Name), "operator" (< <= = >= >), "threshold" (number), "frequency" (LLC_BI__Frequency__c value), "effectiveDate"? (YYYY-MM-DD, defaults to today), "nextEvaluationDate"? (YYYY-MM-DD), "notes"?}]. Each entry becomes one covenant on the relationship plus its relationship junction. No loan junction is written.')
        global String covenantsJson;
        @InvocableVariable(label='Collateral JSON' description='Optional JSON array, max 10: [{"collateralType" (resolved against the org\'s own LLC_BI__Collateral_Type__c catalog), "description", "value" (number, greater than zero), "valuationBasis"? (LLC_BI__Type__c), "valuationSource"? (LLC_BI__Source__c), "valuationDate"? (YYYY-MM-DD), "address"? (an object: {"street"?, "city"?, "state"? (two-letter, from the org picklist), "zip"?} - the same four keys are also read from the top level of the entry when no address object is supplied), "ownerAccountId"? (defaults to accountId)}]. Each entry becomes one asset plus its ownership junction, and a valuation row when a basis, a source or a date is supplied.')
        global String collateralJson;
    }

    global class PlanStep {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type' description='write, verification, wait, handoff or observed_side_effect.')
        global String type;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='Object')
        global String objectName;
        @InvocableVariable(label='Fields')
        global List<String> fields;
        @InvocableVariable(label='Automation Woken')
        global List<String> automationWoken;
        @InvocableVariable(label='Verification')
        global String verification;
        @InvocableVariable(label='State')
        global String state;
    }

    global class ToolError {
        @InvocableVariable(label='Code')
        global String code;
        @InvocableVariable(label='Message')
        global String message;
        @InvocableVariable(label='Org Error')
        global String orgError;
        @InvocableVariable(label='Resumable')
        global Boolean resumable;
        @InvocableVariable(label='Idempotency Key')
        global String idempotencyKey;
    }

    /** One entry this plan will NOT write, with the org's own reason for it. */
    global class Refusal {
        @InvocableVariable(label='Index' description='Zero-based position in the list the entry came from, so the room can point at the right row.')
        global Integer index;
        @InvocableVariable(label='Kind' description='covenant or collateral.')
        global String kind;
        @InvocableVariable(label='Label' description='What the caller called it, echoed back so a refusal reads without the request beside it.')
        global String label;
        @InvocableVariable(label='Reason')
        global String reason;
    }

    global class PlannedCovenant {
        @InvocableVariable(label='Index')
        global Integer index;
        @InvocableVariable(label='Covenant Type Name')
        global String covenantTypeName;
        @InvocableVariable(label='Operator')
        global String operator;
        @InvocableVariable(label='Threshold')
        global Decimal threshold;
        @InvocableVariable(label='Frequency')
        global String frequency;
        @InvocableVariable(label='Effective Date')
        global Date effectiveDate;
        @InvocableVariable(label='Next Evaluation Date')
        global Date nextEvaluationDate;
        @InvocableVariable(label='Create Step Id')
        global String createStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
    }

    global class PlannedCollateral {
        @InvocableVariable(label='Index')
        global Integer index;
        @InvocableVariable(label='Collateral Type')
        global String collateralType;
        @InvocableVariable(label='Description')
        global String description;
        @InvocableVariable(label='Value')
        global Decimal value;
        @InvocableVariable(label='Files Valuation' description='True when a basis, a source or a date was supplied and the plan therefore also files a valuation row against the asset.')
        global Boolean filesValuation;
        @InvocableVariable(label='Owner Account Id')
        global String ownerAccountId;
        @InvocableVariable(label='Create Step Id')
        global String createStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
    }

    global class StageResult {
        @InvocableVariable(label='Plan Id' description='The staging handle. Present it again at execute time with the plan hash and the decision token.')
        global String planId;
        @InvocableVariable(label='Plan Hash')
        global String planHash;
        @InvocableVariable(label='Decision Token' description='Single use, bound to this plan id, plan hash and user. Null on an idempotent replay: the caller already holds it.')
        global String decisionToken;
        @InvocableVariable(label='Summary' description='What will be filed, in banker language. Drives the confirm gate copy.')
        global String summary;
        @InvocableVariable(label='Steps')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Account Id')
        global String accountId;
        @InvocableVariable(label='Account Name')
        global String accountName;
        @InvocableVariable(label='Covenants' description='One entry per covenant this plan will file, with the step ids that belong to it.')
        global List<PlannedCovenant> covenants;
        @InvocableVariable(label='Collateral' description='One entry per asset this plan will file, with the step ids that belong to it.')
        global List<PlannedCollateral> collateral;
        @InvocableVariable(label='Refusals' description='Every entry that will NOT be written, by index, with the org\'s reason. Reported rather than skipped.')
        global List<Refusal> refusals;
        @InvocableVariable(label='Covenant Count')
        global Integer covenantCount;
        @InvocableVariable(label='Collateral Count')
        global Integer collateralCount;
        @InvocableVariable(label='Refused Count')
        global Integer refusedCount;
        @InvocableVariable(label='Replayed')
        global Boolean replayed;
        @InvocableVariable(label='Token Rotated' description='True when this call re-issued the confirmation token for a plan the org already held at Staged: the earlier token, which the caller never received, is void. At most one valid token exists per staging row.')
        global Boolean tokenRotated;
    }

    global class Response {
        @InvocableVariable(label='OK' description='Discriminates the typed result. Domain failure is a successful invocation carrying ok = false.')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global StageResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /** One parsed covenant, resolved against the org's own type catalog and picklists. */
    private class CovenantIntake {
        Integer index;
        Id typeId;
        String typeName;
        String operator;
        Decimal threshold;
        String frequency;
        Date effectiveDate;
        Date nextEvaluationDate;
        String notes;
    }

    /** One parsed asset, resolved against the org's own collateral-type catalog and picklists. */
    private class CollateralIntake {
        Integer index;
        Id typeId;
        String typeName;
        String description;
        Decimal value;
        String valuationBasis;
        String valuationSource;
        Date valuationDate;
        String street;
        String city;
        String state;
        String zip;
        Id ownerAccountId;
        Boolean filesValuation;
    }

    /**
     * Stages a relationship intake. Writes no domain record.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request. A domain failure carries ok = false and does not
     *         contaminate its siblings.
     */
    @InvocableMethod(
        label='stage_relationship_intake'
        description='Validate net-new covenants and collateral for a BORROWING RELATIONSHIP against the org\'s own catalogs and return an immutable execution plan with a plan hash and a single-use decision token. Relationship level throughout: covenants are anchored on the account with a relationship junction and no loan junction, assets are anchored with an ownership junction and no pledge. Writes NO domain record: the rows are created only by execute_relationship_intake behind the token gate. Entries the org cannot accept are refused by index with the org\'s reason, and the rest are still planned.'
    )
    global static List<Response> stage(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = build(req);
                res.ok = true;
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (C360ActionStaging.StagingException e) {
                res.ok = false;
                res.error = err('STAGING_REFUSED', e.getMessage(), null, req.idempotencyKey);
            } catch (DmlException e) {
                res.ok = false;
                res.error = err('STAGING_WRITE_FAILED', 'The staging record could not be written.', e.getMessage(), req.idempotencyKey);
            } catch (QueryException e) {
                res.ok = false;
                res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), req.idempotencyKey);
            }
            out.add(res);
        }
        return out;
    }

    private static StageResult build(Request req) {
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger, which is what makes this action reviewable later.');
        }
        if (String.isBlank(req.accountId)) {
            throw new ToolException('accountId is required. It is the relationship this intake is filed against, and nothing here is anchored anywhere else.');
        }
        Id accountId = asAccountId(req.accountId, 'accountId');
        Account borrower = readAccount(accountId);

        List<Refusal> refusals = new List<Refusal>();
        List<CovenantIntake> covenants = parseCovenants(req.covenantsJson, refusals);
        List<CollateralIntake> assets = parseCollateral(req.collateralJson, accountId, refusals);

        if (covenants.isEmpty() && assets.isEmpty()) {
            throw new ToolException(
                refusals.isEmpty()
                    ? 'Nothing was supplied to file. Provide covenantsJson, collateralJson, or both.'
                    : 'None of the ' + refusals.size() + ' entries supplied can be written. ' + refusals[0].reason +
                      ' Nothing is staged, because a plan that promises no write is not a plan.'
            );
        }

        Map<String, Object> resolved = new Map<String, Object>{
            'accountId' => String.valueOf(accountId),
            'covenantCount' => covenants.size(),
            'collateralCount' => assets.size()
        };
        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        List<PlannedCovenant> plannedCovenants = new List<PlannedCovenant>();
        List<PlannedCollateral> plannedCollateral = new List<PlannedCollateral>();

        for (Integer i = 0; i < covenants.size(); i++) {
            CovenantIntake c = covenants[i];
            String n = String.valueOf(i);

            resolved.put('cov' + n + '.typeId', String.valueOf(c.typeId));
            resolved.put('cov' + n + '.typeName', c.typeName);
            resolved.put('cov' + n + '.operator', c.operator);
            resolved.put('cov' + n + '.threshold', c.threshold);
            resolved.put('cov' + n + '.frequency', c.frequency);
            resolved.put('cov' + n + '.effectiveDate', c.effectiveDate);
            resolved.put('cov' + n + '.nextEvaluationDate', c.nextEvaluationDate);
            resolved.put('cov' + n + '.notes', c.notes);

            steps.add(
                new C360Plan.Step(
                        'covenant_create_' + n,
                        C360Plan.TYPE_WRITE,
                        'File ' + c.typeName + ' ' + c.operator + ' ' + String.valueOf(c.threshold) +
                        ' on ' + borrower.Name + ', with its relationship junction and no loan junction'
                    )
                    .onObject(C360WriteGuard.OBJ_COVENANT, new List<String>{
                        'LLC_BI__Account__c', 'LLC_BI__Covenant_Type__c', 'LLC_BI__Financial_Indicator_Value__c',
                        'Acnpex_Threshold_Value__c', 'Financial_Indicator_Operator__c', 'Acnpex_Operator__c',
                        'LLC_BI__Frequency__c', 'LLC_BI__Effective_Date__c', 'LLC_BI__Next_Evaluation_Date__c',
                        'LLC_BI__Notes__c', 'LLC_BI__Covenant_Status__c', 'LLC_BI__Active__c'
                    })
                    .wakes(new List<String>{
                        'Change-data capture on LLC_BI__Covenant2__c: one EventBridgeCallout queueable per record, egressing the row to the bank\'s AWS endpoint',
                        'No approval: acnpex_covenantApprovalProcess fires on COMPLIANCE create, and a covenant insert mints no compliance row'
                    })
                    .provenBy('SELECT Id, Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c FROM LLC_BI__Covenant2__c WHERE Id = :newId')
            );
            steps.add(
                new C360Plan.Step(
                        'covenant_verify_' + n,
                        C360Plan.TYPE_VERIFICATION,
                        'Confirm ' + c.typeName + ' reads back at its threshold and carries exactly one relationship junction and no loan junction'
                    )
                    .onObject(C360WriteGuard.OBJ_COVENANT, new List<String>{
                        'LLC_BI__Financial_Indicator_Value__c', 'LLC_BI__Covenant_Status__c', 'LLC_BI__Active__c'
                    })
                    .provenBy(
                        'SELECT Id, LLC_BI__Financial_Indicator_Value__c FROM LLC_BI__Covenant2__c WHERE Id = :newId; ' +
                        'SELECT COUNT() FROM LLC_BI__Account_Covenant__c WHERE LLC_BI__Covenant2__c = :newId; ' +
                        'SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Covenant2__c = :newId'
                    )
            );

            PlannedCovenant p = new PlannedCovenant();
            p.index = c.index;
            p.covenantTypeName = c.typeName;
            p.operator = c.operator;
            p.threshold = c.threshold;
            p.frequency = c.frequency;
            p.effectiveDate = c.effectiveDate;
            p.nextEvaluationDate = c.nextEvaluationDate;
            p.createStepId = 'covenant_create_' + n;
            p.verifyStepId = 'covenant_verify_' + n;
            plannedCovenants.add(p);
        }

        for (Integer j = 0; j < assets.size(); j++) {
            CollateralIntake a = assets[j];
            String n = String.valueOf(j);

            resolved.put('col' + n + '.typeId', String.valueOf(a.typeId));
            resolved.put('col' + n + '.typeName', a.typeName);
            resolved.put('col' + n + '.description', a.description);
            resolved.put('col' + n + '.value', a.value);
            resolved.put('col' + n + '.ownerAccountId', String.valueOf(a.ownerAccountId));
            resolved.put('col' + n + '.street', a.street);
            resolved.put('col' + n + '.city', a.city);
            resolved.put('col' + n + '.state', a.state);
            resolved.put('col' + n + '.zip', a.zip);
            resolved.put('col' + n + '.filesValuation', a.filesValuation);
            resolved.put('col' + n + '.valuationBasis', a.valuationBasis);
            resolved.put('col' + n + '.valuationSource', a.valuationSource);
            resolved.put('col' + n + '.valuationDate', a.valuationDate);

            List<String> assetFields = new List<String>{
                'LLC_BI__Collateral_Type__c', 'LLC_BI__Value__c', 'LLC_BI__Description__c'
            };
            if (a.street != null) { assetFields.add('LLC_BI__Street_Address__c'); }
            if (a.city != null) { assetFields.add('LLC_BI__City__c'); }
            if (a.state != null) { assetFields.add('LLC_BI__State__c'); }
            if (a.zip != null) { assetFields.add('LLC_BI__Zip_Code__c'); }

            steps.add(
                new C360Plan.Step(
                        'collateral_create_' + n,
                        C360Plan.TYPE_WRITE,
                        'File the ' + a.typeName + ' asset "' + a.description + '" at ' + String.valueOf(a.value) +
                        ', owned by ' + borrower.Name + ' through the ownership junction' +
                        (a.filesValuation ? ', with its opening valuation' : '') + ', and pledged to nothing'
                    )
                    .onObject(C360WriteGuard.OBJ_COLLATERAL, assetFields)
                    .wakes(new List<String>{
                        'Change-data capture on LLC_BI__Collateral__c: one EventBridgeCallout queueable per record, egressing the row to the bank\'s AWS endpoint',
                        'LLC_BI__Lendable_Value__c is computed by the org from the collateral type\'s advance rate. It is never written here.'
                    })
                    .provenBy('SELECT Id, Name, LLC_BI__Value__c, LLC_BI__Lendable_Value__c FROM LLC_BI__Collateral__c WHERE Id = :newId')
            );
            steps.add(
                new C360Plan.Step(
                        'collateral_verify_' + n,
                        C360Plan.TYPE_VERIFICATION,
                        'Confirm "' + a.description + '" reads back at its value and carries exactly one ownership junction' +
                        (a.filesValuation ? ' and its valuation' : '') + ', and no pledge'
                    )
                    .onObject(C360WriteGuard.OBJ_COLLATERAL, new List<String>{ 'LLC_BI__Value__c', 'LLC_BI__Lendable_Value__c' })
                    .provenBy(
                        'SELECT Id, Name, LLC_BI__Value__c FROM LLC_BI__Collateral__c WHERE Id = :newId; ' +
                        'SELECT COUNT() FROM LLC_BI__Account_Collateral__c WHERE LLC_BI__Collateral__c = :newId; ' +
                        'SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Collateral__c = :newId'
                    )
            );

            PlannedCollateral p = new PlannedCollateral();
            p.index = a.index;
            p.collateralType = a.typeName;
            p.description = a.description;
            p.value = a.value;
            p.filesValuation = a.filesValuation;
            p.ownerAccountId = a.ownerAccountId;
            p.createStepId = 'collateral_create_' + n;
            p.verifyStepId = 'collateral_verify_' + n;
            plannedCollateral.add(p);
        }

        List<String> warnings = buildWarnings(accountId, borrower, covenants, assets, refusals);
        String summary = buildSummary(borrower, covenants, assets, refusals);

        Map<String, Object> provenance = new Map<String, Object>{
            'LLC_BI__Account__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => 'The relationship this intake was opened on.' },
            'LLC_BI__Covenant_Type__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => 'Resolved by exact name against this org\'s covenant type catalog.' },
            'LLC_BI__Collateral_Type__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => 'Resolved against this org\'s collateral type catalog, which also supplies the advance rate the lendable value is computed from.' },
            'LLC_BI__Financial_Indicator_Value__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Value__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Covenant_Status__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'A net-new covenant is born Pending: not yet evaluated. Any other birth status would be authored compliance history.' },
            'Financial_Indicator_Operator__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'The words form of the operator, mirrored from Acnpex_Operator__c the way every covenant in this org carries both.' }
        };

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash(ACTION_ID, steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            ACTION_ID, req.idempotencyKey, accountId, null, planJson, planHash
        );

        StageResult r = new StageResult();
        r.planId = staged.stagingId;
        r.planHash = staged.planHash;
        r.decisionToken = staged.decisionToken;
        r.replayed = staged.replayed;
        r.tokenRotated = staged.tokenRotated;
        r.summary = summary;
        r.warnings = warnings;
        r.provenanceJson = JSON.serialize(provenance);
        r.accountId = accountId;
        r.accountName = borrower.Name;
        r.covenants = plannedCovenants;
        r.collateral = plannedCollateral;
        r.refusals = refusals;
        r.covenantCount = plannedCovenants.size();
        r.collateralCount = plannedCollateral.size();
        r.refusedCount = refusals.size();
        r.steps = toWireSteps(steps);
        return r;
    }

    /* ------------------------------------------------------------------ covenants */

    /**
     * Parses and resolves the covenant list. Every entry that cannot be written lands in
     * `refusals` with its index and the org's reason; the rest come back planned.
     *
     * The type catalog is read in ONE query for the whole list rather than per entry: the org
     * holds a config table here, and a SOQL per covenant is how a ten-entry intake meets the
     * query governor on a busy transaction.
     */
    private static List<CovenantIntake> parseCovenants(String covenantsJson, List<Refusal> refusals) {
        List<CovenantIntake> out = new List<CovenantIntake>();
        List<Object> raw = readList(covenantsJson, 'covenantsJson');
        if (raw.isEmpty()) {
            return out;
        }

        Set<String> frequencies = C360Picklist.activeValues(C360WriteGuard.OBJ_COVENANT, 'LLC_BI__Frequency__c');
        Map<String, List<LLC_BI__Covenant_Type__c>> typesByName = covenantTypesByName(raw);

        for (Integer i = 0; i < raw.size(); i++) {
            Map<String, Object> m;
            try {
                m = (Map<String, Object>) raw[i];
            } catch (Exception e) {
                refusals.add(refusal(i, 'covenant', null, 'Entry ' + (i + 1) + ' of covenantsJson is not a JSON object.'));
                continue;
            }
            String typeName = text(m.get('covenantTypeName'));
            if (i >= MAX_PER_LIST) {
                refusals.add(refusal(i, 'covenant', typeName, capReason('covenantsJson', raw.size(), 'covenant')));
                continue;
            }

            CovenantIntake c = new CovenantIntake();
            c.index = i;
            c.typeName = typeName;
            c.operator = text(m.get('operator'));
            c.threshold = decimalOf(m.get('threshold'));
            c.frequency = text(m.get('frequency'));
            c.notes = text(m.get('notes'));

            if (String.isBlank(c.typeName)) {
                refusals.add(refusal(i, 'covenant', null, 'covenantTypeName is missing. The type is what the org tests against, so a covenant without one cannot be filed.'));
                continue;
            }
            List<LLC_BI__Covenant_Type__c> hits = typesByName.get(c.typeName.toLowerCase());
            if (hits == null || hits.isEmpty()) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'No covenant type named "' + c.typeName + '" exists in this org\'s catalog. The name must match the catalog exactly.'));
                continue;
            }
            if (hits.size() > 1) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'This org carries ' + hits.size() + ' covenant types named "' + c.typeName +
                    '". Nothing is filed for it, because picking one would be picking for the bank.'));
                continue;
            }
            c.typeId = hits[0].Id;
            c.typeName = hits[0].Name;

            if (c.threshold == null) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'threshold is missing. The threshold IS the covenant: without one there is nothing for a review cycle to test.'));
                continue;
            }
            if (String.isBlank(c.operator) || !FI_OPERATOR.containsKey(c.operator)) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'operator must be one of < <= = >= >, which is what this org\'s Acnpex_Operator__c offers. Supplied: ' +
                    (c.operator == null ? '(none)' : c.operator) + '.'));
                continue;
            }
            if (String.isBlank(c.frequency)) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'frequency is missing. It is the test schedule, and the org will not roll a covenant without one. Available: ' + sortedList(frequencies) + '.'));
                continue;
            }
            if (!frequencies.contains(c.frequency)) {
                refusals.add(refusal(i, 'covenant', c.typeName,
                    'LLC_BI__Frequency__c value \'' + c.frequency + '\' is not offered by this org. Available: ' + sortedList(frequencies) + '.'));
                continue;
            }

            Object effectiveRaw = m.get('effectiveDate');
            if (effectiveRaw == null || String.isBlank(String.valueOf(effectiveRaw))) {
                c.effectiveDate = Date.today();
            } else {
                c.effectiveDate = dateOf(effectiveRaw);
                if (c.effectiveDate == null) {
                    refusals.add(refusal(i, 'covenant', c.typeName, badDateReason('effectiveDate', effectiveRaw)));
                    continue;
                }
            }
            Object nextRaw = m.get('nextEvaluationDate');
            if (nextRaw != null && String.isNotBlank(String.valueOf(nextRaw))) {
                c.nextEvaluationDate = dateOf(nextRaw);
                if (c.nextEvaluationDate == null) {
                    refusals.add(refusal(i, 'covenant', c.typeName, badDateReason('nextEvaluationDate', nextRaw)));
                    continue;
                }
            }
            out.add(c);
        }
        return out;
    }

    /** The covenant types the list names, read in one query and keyed by lowercase name. */
    private static Map<String, List<LLC_BI__Covenant_Type__c>> covenantTypesByName(List<Object> raw) {
        Set<String> names = new Set<String>();
        for (Object o : raw) {
            if (o instanceof Map<String, Object>) {
                String n = text(((Map<String, Object>) o).get('covenantTypeName'));
                if (String.isNotBlank(n)) {
                    names.add(n);
                }
            }
        }
        Map<String, List<LLC_BI__Covenant_Type__c>> byName = new Map<String, List<LLC_BI__Covenant_Type__c>>();
        if (names.isEmpty()) {
            return byName;
        }
        for (LLC_BI__Covenant_Type__c t : [
            SELECT Id, Name FROM LLC_BI__Covenant_Type__c WHERE Name IN :names WITH USER_MODE LIMIT 500
        ]) {
            String k = t.Name.toLowerCase();
            if (!byName.containsKey(k)) {
                byName.put(k, new List<LLC_BI__Covenant_Type__c>());
            }
            byName.get(k).add(t);
        }
        return byName;
    }

    /* ----------------------------------------------------------------- collateral */

    /**
     * Parses and resolves the collateral list, the same way and with the same per-entry refusals.
     *
     * The collateral type is resolved exact-name first and then by containment, mirroring
     * StageLoanModification so a word that works on the modification arm works here. A type
     * carrying no advance rate of its own is refused before the org's
     * Advance_Rate_should_not_be_null rule fires, because that error surfaces on the ASSET insert
     * rather than on the type record, where nobody would think to look for it.
     */
    private static List<CollateralIntake> parseCollateral(String collateralJson, Id accountId, List<Refusal> refusals) {
        List<CollateralIntake> out = new List<CollateralIntake>();
        List<Object> raw = readList(collateralJson, 'collateralJson');
        if (raw.isEmpty()) {
            return out;
        }

        List<LLC_BI__Collateral_Type__c> types = [
            SELECT Id, Name, LLC_BI__Advance_Rate__c FROM LLC_BI__Collateral_Type__c WITH USER_MODE LIMIT 500
        ];
        Set<String> bases = C360Picklist.activeValues(C360WriteGuard.OBJ_VALUATION, 'LLC_BI__Type__c');
        Set<String> sources = C360Picklist.activeValues(C360WriteGuard.OBJ_VALUATION, 'LLC_BI__Source__c');
        Set<String> states = C360Picklist.activeValues(C360WriteGuard.OBJ_COLLATERAL, 'LLC_BI__State__c');
        Set<Id> ownerIds = ownerAccountIds(raw);
        Map<Id, Account> owners = ownerIds.isEmpty()
            ? new Map<Id, Account>()
            : new Map<Id, Account>([SELECT Id, Name FROM Account WHERE Id IN :ownerIds WITH USER_MODE]);

        for (Integer i = 0; i < raw.size(); i++) {
            Map<String, Object> m;
            try {
                m = (Map<String, Object>) raw[i];
            } catch (Exception e) {
                refusals.add(refusal(i, 'collateral', null, 'Entry ' + (i + 1) + ' of collateralJson is not a JSON object.'));
                continue;
            }
            String label = text(m.get('description'));
            if (i >= MAX_PER_LIST) {
                refusals.add(refusal(i, 'collateral', label, capReason('collateralJson', raw.size(), 'asset')));
                continue;
            }

            CollateralIntake a = new CollateralIntake();
            a.index = i;
            a.description = label;
            a.value = decimalOf(m.get('value'));
            a.valuationBasis = text(m.get('valuationBasis'));
            a.valuationSource = text(m.get('valuationSource'));
            /* THE ADDRESS TRAVELS AS ONE OBJECT. The contract words it as `address (optional:
               street, city, state, zip)` and the room asks for it as one line, so the nested
               object is the shape. The four flat keys are still read when no address object is
               supplied, because a caller that spells them at the top level means the same thing
               and a silently dropped address is a fact the org never hears. Nested wins where
               both are present: it is the shape the contract names. */
            Object addrRaw = m.get('address');
            Map<String, Object> addr = null;
            if (addrRaw != null) {
                if (!(addrRaw instanceof Map<String, Object>)) {
                    refusals.add(refusal(i, 'collateral', label,
                        'address must be a JSON object carrying street, city, state and zip. It cannot be read as one.'));
                    continue;
                }
                addr = (Map<String, Object>) addrRaw;
            }
            a.street = addressPart(m, addr, 'street');
            a.city = addressPart(m, addr, 'city');
            a.state = addressPart(m, addr, 'state');
            a.zip = addressPart(m, addr, 'zip');

            String typeWord = text(m.get('collateralType'));
            if (String.isBlank(typeWord)) {
                refusals.add(refusal(i, 'collateral', label,
                    'collateralType is missing. The type carries the advance rate the org computes lendable value from, so an asset cannot be filed without one.'));
                continue;
            }
            LLC_BI__Collateral_Type__c resolvedType = resolveCollateralType(typeWord, types, i, label, refusals);
            if (resolvedType == null) {
                continue;
            }
            a.typeId = resolvedType.Id;
            a.typeName = resolvedType.Name;

            if (String.isBlank(a.description)) {
                refusals.add(refusal(i, 'collateral', null,
                    'description is missing. Name is an autonumber on this object, so the description is the only human label the asset will ever carry.'));
                continue;
            }
            if (a.description.length() > DESCRIPTION_MAX) {
                refusals.add(refusal(i, 'collateral', label,
                    'description is ' + a.description.length() + ' characters; the org allows ' + DESCRIPTION_MAX + '.'));
                continue;
            }
            if (a.value == null || a.value <= 0) {
                refusals.add(refusal(i, 'collateral', label,
                    'value must be greater than zero. An asset filed at zero states a fact about the collateral that nobody established.'));
                continue;
            }

            if (String.isNotBlank(a.valuationBasis) && !bases.contains(a.valuationBasis)) {
                refusals.add(refusal(i, 'collateral', label,
                    'LLC_BI__Type__c value \'' + a.valuationBasis + '\' is not a valuation basis this org offers. Available: ' + sortedList(bases) + '.'));
                continue;
            }
            if (String.isNotBlank(a.valuationSource) && !sources.contains(a.valuationSource)) {
                refusals.add(refusal(i, 'collateral', label,
                    'LLC_BI__Source__c value \'' + a.valuationSource + '\' is not a valuation source this org offers. Available: ' + sortedList(sources) + '.'));
                continue;
            }
            if (String.isNotBlank(a.state) && !states.contains(a.state)) {
                refusals.add(refusal(i, 'collateral', label,
                    'state \'' + a.state + '\' is not offered by this org\'s LLC_BI__State__c picklist, which carries the two-letter US codes.'));
                continue;
            }

            Object dateRaw = m.get('valuationDate');
            Boolean hasDate = dateRaw != null && String.isNotBlank(String.valueOf(dateRaw));
            if (hasDate) {
                a.valuationDate = dateOf(dateRaw);
                if (a.valuationDate == null) {
                    refusals.add(refusal(i, 'collateral', label, badDateReason('valuationDate', dateRaw)));
                    continue;
                }
            }
            a.filesValuation = String.isNotBlank(a.valuationBasis) || String.isNotBlank(a.valuationSource) || hasDate;
            if (a.filesValuation && a.valuationDate == null) {
                a.valuationDate = Date.today();
            }

            String owner = text(m.get('ownerAccountId'));
            if (String.isBlank(owner)) {
                a.ownerAccountId = accountId;
            } else {
                Id ownerId;
                try {
                    ownerId = asAccountId(owner, 'ownerAccountId');
                } catch (ToolException e) {
                    refusals.add(refusal(i, 'collateral', label, e.getMessage()));
                    continue;
                }
                if (!owners.containsKey(ownerId)) {
                    refusals.add(refusal(i, 'collateral', label,
                        'ownerAccountId ' + ownerId + ' was not found, or is not visible to you.'));
                    continue;
                }
                a.ownerAccountId = ownerId;
            }
            out.add(a);
        }
        return out;
    }

    /** Exact name first, then containment, mirroring the modification arm's own resolution. */
    private static LLC_BI__Collateral_Type__c resolveCollateralType(
        String word,
        List<LLC_BI__Collateral_Type__c> types,
        Integer index,
        String label,
        List<Refusal> refusals
    ) {
        List<LLC_BI__Collateral_Type__c> hits = new List<LLC_BI__Collateral_Type__c>();
        for (LLC_BI__Collateral_Type__c t : types) {
            if (t.Name != null && t.Name.equalsIgnoreCase(word)) {
                hits = new List<LLC_BI__Collateral_Type__c>{ t };
                break;
            }
        }
        if (hits.isEmpty()) {
            for (LLC_BI__Collateral_Type__c t : types) {
                if (t.Name != null && t.Name.toLowerCase().contains(word.toLowerCase())) {
                    hits.add(t);
                }
            }
        }
        if (hits.isEmpty()) {
            refusals.add(refusal(index, 'collateral', label,
                '"' + word + '" is not a collateral type this org holds. The org offers: ' + typeNames(types) + '.'));
            return null;
        }
        if (hits.size() > 1) {
            refusals.add(refusal(index, 'collateral', label,
                '"' + word + '" matches ' + hits.size() + ' collateral types on this org: ' + typeNames(hits) + '. Name one of them exactly.'));
            return null;
        }
        if (hits[0].LLC_BI__Advance_Rate__c == null) {
            refusals.add(refusal(index, 'collateral', label,
                'Collateral type "' + hits[0].Name + '" carries no advance rate of its own, and the org\'s Advance_Rate_should_not_be_null rule ' +
                'refuses an asset created against it. The error surfaces on the ASSET insert rather than on the type, so it is refused here instead. ' +
                'Set the type\'s advance rate in the org, or name another type.'));
            return null;
        }
        return hits[0];
    }

    private static Set<Id> ownerAccountIds(List<Object> raw) {
        Set<Id> out = new Set<Id>();
        for (Object o : raw) {
            if (!(o instanceof Map<String, Object>)) {
                continue;
            }
            String v = text(((Map<String, Object>) o).get('ownerAccountId'));
            if (String.isBlank(v)) {
                continue;
            }
            try {
                Id parsed = Id.valueOf(v);
                if (parsed.getSObjectType() == Account.SObjectType) {
                    out.add(parsed);
                }
            } catch (Exception e) {
                // A malformed owner id is refused per entry in the main loop, with its index.
            }
        }
        return out;
    }

    /* -------------------------------------------------------- summary and warnings */

    private static String buildSummary(
        Account borrower,
        List<CovenantIntake> covenants,
        List<CollateralIntake> assets,
        List<Refusal> refusals
    ) {
        List<String> parts = new List<String>();
        if (!covenants.isEmpty()) {
            parts.add(
                String.valueOf(covenants.size()) + (covenants.size() == 1 ? ' covenant' : ' covenants') +
                ', born Pending and Active on ' + borrower.Name + ' with a relationship junction each and no loan junction'
            );
        }
        if (!assets.isEmpty()) {
            Integer valuations = 0;
            for (CollateralIntake a : assets) {
                if (a.filesValuation) {
                    valuations++;
                }
            }
            parts.add(
                String.valueOf(assets.size()) + (assets.size() == 1 ? ' asset' : ' assets') +
                ', each owned by ' + borrower.Name + ' through an ownership junction and pledged to nothing' +
                (valuations == 0 ? '' : ', ' + String.valueOf(valuations) + ' of them with an opening valuation')
            );
        }
        return 'Files ' + String.join(parts, ' and ') + '. ' +
            (refusals.isEmpty() ? '' : String.valueOf(refusals.size()) + ' further ' + (refusals.size() == 1 ? 'entry is' : 'entries are') +
                ' refused and listed with the reason. ') +
            'Nothing is lent, pledged, priced or approved: no facility, no package and no credit action is touched.';
    }

    private static List<String> buildWarnings(
        Id accountId,
        Account borrower,
        List<CovenantIntake> covenants,
        List<CollateralIntake> assets,
        List<Refusal> refusals
    ) {
        List<String> warnings = new List<String>();
        warnings.add(
            'This is RELATIONSHIP level. Nothing here reaches a facility: no loan junction is written beside a covenant and no pledge beside an asset, ' +
            'so none of it changes availability, coverage or any credit figure. Attaching any of it to a facility is a separate, confirmed action.'
        );
        if (!covenants.isEmpty()) {
            warnings.add(
                'Each covenant is created Pending and Active, which means not yet evaluated. That is the only honest birth status: any other would be ' +
                'compliance history nobody produced. No compliance row is minted, so the bank\'s covenant approval chain is not started.'
            );
        }
        if (!assets.isEmpty()) {
            warnings.add(
                'The asset\'s lendable value is computed by the org from the collateral type\'s advance rate and is never written here. ' +
                'An asset filed at a value is an asset on file, not collateral coverage: coverage comes from the pledge, which this action does not create.'
            );
        }
        Integer valuations = 0;
        for (CollateralIntake a : assets) {
            if (a.filesValuation) {
                valuations++;
            }
        }
        if (valuations > 0) {
            warnings.add(
                String.valueOf(valuations) + ' opening ' + (valuations == 1 ? 'valuation is' : 'valuations are') + ' filed alongside the ' +
                (valuations == 1 ? 'asset' : 'assets') + ', marked Active and the original value, which is what the first valuation of an asset ' +
                'created in this same transaction is. nCino binds the collateral auto-update to its own ' +
                'Add Valuation button and it does not fire headlessly, so the asset value is the one this plan supplies and no rollup is claimed.'
            );
        }
        warnings.addAll(duplicateCovenantWarnings(accountId, borrower, covenants));
        if (!refusals.isEmpty()) {
            warnings.add(
                String.valueOf(refusals.size()) + ' of the entries supplied will NOT be filed. Each carries its own reason and its index in the refusals list. ' +
                'They are reported rather than skipped, and nothing about them is fixed.'
            );
        }
        warnings.add(
            'Every row this plan writes egresses to the bank\'s AWS endpoint through the org\'s own change-data triggers, one queueable per record. ' +
            'That is the org\'s pipe, not ours, and it is why the plan is capped at ten entries per list.'
        );
        return warnings;
    }

    /**
     * Warns when the relationship ALREADY holds a covenant of a type this plan files again.
     *
     * A second covenant of the same type is legitimate (a stepped threshold, a replacement under a
     * new agreement) which is why it is a warning rather than a refusal. What is not legitimate is
     * filing one without the banker knowing the first exists.
     */
    private static List<String> duplicateCovenantWarnings(Id accountId, Account borrower, List<CovenantIntake> covenants) {
        List<String> out = new List<String>();
        if (covenants.isEmpty()) {
            return out;
        }
        Set<Id> typeIds = new Set<Id>();
        for (CovenantIntake c : covenants) {
            typeIds.add(c.typeId);
        }
        Map<Id, LLC_BI__Covenant2__c> existing = new Map<Id, LLC_BI__Covenant2__c>();
        for (LLC_BI__Account_Covenant__c j : [
            SELECT LLC_BI__Covenant2__c, LLC_BI__Covenant2__r.Name,
                   LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__c,
                   LLC_BI__Covenant2__r.LLC_BI__Financial_Indicator_Value__c
            FROM LLC_BI__Account_Covenant__c
            WHERE LLC_BI__Account__c = :accountId
              AND LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__c IN :typeIds
              AND LLC_BI__Covenant2__r.LLC_BI__Active__c = true
            WITH USER_MODE
        ]) {
            existing.put(j.LLC_BI__Covenant2__r.LLC_BI__Covenant_Type__c, j.LLC_BI__Covenant2__r);
        }
        for (CovenantIntake c : covenants) {
            LLC_BI__Covenant2__c prior = existing.get(c.typeId);
            if (prior != null) {
                out.add(
                    borrower.Name + ' ALREADY holds an active ' + c.typeName + ' covenant (' + prior.Name + ') at ' +
                    String.valueOf(prior.LLC_BI__Financial_Indicator_Value__c) + '. This plan files a SECOND one at ' +
                    c.operator + ' ' + String.valueOf(c.threshold) + '. That is a real instrument when the agreement steps the threshold, ' +
                    'and it is the wrong one when the existing covenant was meant to be amended.'
                );
            }
        }
        return out;
    }

    /* -------------------------------------------------------------------- helpers */

    private static Account readAccount(Id accountId) {
        List<Account> rows = [SELECT Id, Name FROM Account WHERE Id = :accountId WITH USER_MODE LIMIT 1];
        if (rows.isEmpty()) {
            throw new ToolException('Account ' + accountId + ' was not found, or is not visible to you.');
        }
        return rows[0];
    }

    private static Id asAccountId(String raw, String fieldName) {
        Id parsed;
        try {
            parsed = Id.valueOf(raw);
        } catch (Exception e) {
            throw new ToolException(fieldName + ' \'' + raw + '\' is not a record id.');
        }
        if (parsed.getSObjectType() != Account.SObjectType) {
            throw new ToolException(fieldName + ' ' + parsed + ' is not an Account id.');
        }
        return parsed;
    }

    /** The parameter is NOT called `json`: Apex is case-insensitive and that name shadows the JSON class. */
    private static List<Object> readList(String payload, String fieldName) {
        if (String.isBlank(payload)) {
            return new List<Object>();
        }
        try {
            return (List<Object>) JSON.deserializeUntyped(payload);
        } catch (Exception e) {
            throw new ToolException(fieldName + ' could not be read as a JSON list: ' + e.getMessage());
        }
    }

    private static String capReason(String fieldName, Integer supplied, String noun) {
        return fieldName + ' carries ' + supplied + ' entries; the cap is ' + MAX_PER_LIST + ' per plan, and this ' + noun +
            ' is past it. Every row inserted wakes a change-data trigger that enqueues one queueable per record against a platform ceiling ' +
            'of 50 per synchronous transaction, and exceeding it rolls the whole plan back rather than filing what it could. Stage the rest as a second plan.';
    }

    private static String badDateReason(String fieldName, Object supplied) {
        return fieldName + ' \'' + String.valueOf(supplied) + '\' is not a date the org can read. Use YYYY-MM-DD.';
    }

    private static Refusal refusal(Integer index, String kind, String label, String reason) {
        Refusal r = new Refusal();
        r.index = index;
        r.kind = kind;
        r.label = label;
        r.reason = reason;
        return r;
    }

    private static String text(Object v) {
        return v == null ? null : String.valueOf(v).trim();
    }

    /** One address part, from the nested object where there is one and from the flat key otherwise. */
    private static String addressPart(Map<String, Object> entry, Map<String, Object> address, String key) {
        if (address != null) {
            String nested = text(address.get(key));
            if (String.isNotBlank(nested)) {
                return nested;
            }
        }
        return text(entry.get(key));
    }

    private static Decimal decimalOf(Object v) {
        if (v == null || String.isBlank(String.valueOf(v))) {
            return null;
        }
        try {
            return Decimal.valueOf(String.valueOf(v));
        } catch (Exception e) {
            return null;
        }
    }

    private static Date dateOf(Object v) {
        try {
            return Date.valueOf(String.valueOf(v).trim().substring(0, 10));
        } catch (Exception e) {
            return null;
        }
    }

    private static String sortedList(Set<String> values) {
        List<String> s = new List<String>(values);
        s.sort();
        return String.join(s, ', ');
    }

    /** The org's own candidate list, for a refusal that can be acted on. */
    private static String typeNames(List<LLC_BI__Collateral_Type__c> types) {
        List<String> names = new List<String>();
        for (LLC_BI__Collateral_Type__c t : types) {
            if (t.Name != null) {
                names.add(t.Name);
            }
            if (names.size() == 40) {
                names.add('(and more)');
                break;
            }
        }
        names.sort();
        return String.join(names, ', ');
    }

    /** Maps the internal plan steps onto the wire shape. */
    private static List<PlanStep> toWireSteps(List<C360Plan.Step> steps) {
        List<PlanStep> out = new List<PlanStep>();
        for (C360Plan.Step s : steps) {
            PlanStep p = new PlanStep();
            p.id = s.id;
            p.type = s.type;
            p.label = s.label;
            p.objectName = s.objectName;
            p.fields = s.fields;
            p.automationWoken = s.automationWoken;
            p.verification = s.verification;
            p.state = s.state;
            out.add(p);
        }
        return out;
    }

    private static ToolError err(String code, String message, String orgError, String idempotencyKey) {
        ToolError e = new ToolError();
        e.code = code;
        e.message = message;
        e.orgError = orgError;
        e.resumable = false;
        e.idempotencyKey = idempotencyKey;
        return e;
    }
}
