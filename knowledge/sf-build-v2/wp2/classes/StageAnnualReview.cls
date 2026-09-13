/**
 * StageAnnualReview - MCP tool: stage_annual_review.
 *
 * A33.0.1: this tool performs ZERO domain-object DML. The Review is created only by
 * execute_annual_review, behind the token gate.
 *
 * Two facts from PROBE-LEDGER probe 3 shape this contract and both are counter-intuitive:
 *   1. LLC_BI__Status__c and LLC_BI__Review_Type__c both come back NULL on an insert that omits
 *      them. Nothing defaults them. A tool that omits them files a Review in no status and of no
 *      type, so both are required here and both are set explicitly at execute time.
 *   2. The org assigns the record type itself through the Review After Save flow. We never set
 *      RecordTypeId, and C360WriteGuard refuses it outright.
 *
 * The plan ends in a handoff, not a completion. A33.4.6(b) deleted the terminal transition: a
 * decision token proves a banker confirmed a plan, it is not a credit approval, and 'Complete' is
 * a post-approval state the org's own process mints. We create at In Progress and stop.
 *
 * Write object: LLC_BI__Review__c, which is a different object from LLC_BI__Annual_Review__c
 * (label "Risk Rating Review", A33.4.7). Org contract: A33.4.6.
 */
global with sharing class StageAnnualReview {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Account Id' description='The borrower relationship the review covers.' required=true)
        global String accountId;
        @InvocableVariable(label='Rationale' description='Why this review is being opened. Feeds the audit ledger.' required=true)
        global String rationale;
        @InvocableVariable(label='Review Type' description='Annual, AdHoc or Problem Loan. Required: nothing defaults it, and an omitted type files a review of no type.' required=true)
        global String reviewType;
        @InvocableVariable(label='Product Package Id' description='Optional. A package-scoped review, and the deep-link anchor.')
        global String productPackageId;
        @InvocableVariable(label='Narrative')
        global String narrative;
        @InvocableVariable(label='Relationship Summary')
        global String relationshipSummary;
        @InvocableVariable(label='Strengths Narrative')
        global String strengthsNarrative;
        @InvocableVariable(label='Weakness Narrative')
        global String weaknessNarrative;
        @InvocableVariable(label='Recommendation Narrative')
        global String recommendationNarrative;
        @InvocableVariable(label='Collateral Analysis Narrative')
        global String collateralAnalysisNarrative;
        @InvocableVariable(label='Financial Analyst Narrative')
        global String financialAnalystNarrative;
        @InvocableVariable(label='Guarantor Narrative')
        global String guarantorNarrative;
        @InvocableVariable(label='Risk Rating Comments')
        global String riskRatingComments;
        @InvocableVariable(label='Edited Narrative Fields' description='Field keys the banker revised on agent-drafted prose. Ledger-only: nothing is injected into the nCino field text.')
        global List<String> editedNarrativeFields;
    }

    global class PlanStep {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type')
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

    global class StageResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Plan Hash')
        global String planHash;
        @InvocableVariable(label='Decision Token')
        global String decisionToken;
        @InvocableVariable(label='Summary')
        global String summary;
        @InvocableVariable(label='Steps')
        global List<PlanStep> steps;
        @InvocableVariable(label='Warnings')
        global List<String> warnings;
        @InvocableVariable(label='Provenance JSON')
        global String provenanceJson;
        @InvocableVariable(label='Account Id')
        global String accountId;
        @InvocableVariable(label='Product Package Id')
        global String productPackageId;
        @InvocableVariable(label='Replayed')
        global Boolean replayed;
        @InvocableVariable(label='Token Rotated' description='True when this call re-issued the confirmation token for a plan the org already held at Staged: the earlier token, which the caller never received, is void. At most one valid token exists per staging row.')
        global Boolean tokenRotated;
    }

    global class Response {
        @InvocableVariable(label='OK')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global StageResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /**
     * Stages an annual review. Writes no Review.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_annual_review'
        description='Validate an annual review against the org contract and return an immutable execution plan with a plan hash and a single-use decision token. Writes NO Review: the Review is created only by execute_annual_review behind the token gate, at status In Progress, never Complete.'
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
        if (String.isBlank(req.accountId)) {
            throw new ToolException('accountId is required. A review hangs off the borrower relationship.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (String.isBlank(req.reviewType)) {
            throw new ToolException('reviewType is required. Probe 3 proved nothing defaults it, so an omitted type files a review of no type.');
        }

        Set<String> allowedTypes = C360Picklist.activeValues(C360WriteGuard.OBJ_REVIEW, 'LLC_BI__Review_Type__c');
        if (!allowedTypes.contains(req.reviewType)) {
            List<String> sorted = new List<String>(allowedTypes);
            sorted.sort();
            throw new ToolException('reviewType \'' + req.reviewType + '\' is not offered by this org. Available: ' + String.join(sorted, ', ') + '.');
        }

        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id = :req.accountId WITH USER_MODE LIMIT 1];
        if (accounts.isEmpty()) {
            throw new ToolException('Account ' + req.accountId + ' was not found, or is not visible to you.');
        }

        Id packageId = null;
        if (String.isNotBlank(req.productPackageId)) {
            List<LLC_BI__Product_Package__c> pkgs = [
                SELECT Id FROM LLC_BI__Product_Package__c WHERE Id = :req.productPackageId WITH USER_MODE LIMIT 1
            ];
            if (pkgs.isEmpty()) {
                throw new ToolException('Product package ' + req.productPackageId + ' was not found, or is not visible to you.');
            }
            packageId = pkgs[0].Id;
        }

        Map<String, Object> resolved = new Map<String, Object>{
            'LLC_BI__Account__c' => req.accountId,
            'LLC_BI__Product_Package__c' => packageId,
            'LLC_BI__Status__c' => 'In Progress',
            'LLC_BI__Review_Type__c' => req.reviewType,
            'LLC_BI__Is_Agentic_Review__c' => true,
            'LLC_BI__Narrative__c' => req.narrative,
            'cm_Relationship_Summary__c' => req.relationshipSummary,
            'cm_Strengths_Narrative__c' => req.strengthsNarrative,
            'cm_Weakness_Narrative__c' => req.weaknessNarrative,
            'cm_Recommendation_Narrative__c' => req.recommendationNarrative,
            'cm_Collateral_Analysis_Narrative__c' => req.collateralAnalysisNarrative,
            'cm_Financial_Analyst_Narrative__c' => req.financialAnalystNarrative,
            'cm_Guarantor_Narrative__c' => req.guarantorNarrative,
            'cm_Risk_Rating_Comments__c' => req.riskRatingComments
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        steps.add(
            new C360Plan.Step('write_review', C360Plan.TYPE_WRITE, 'Open a ' + req.reviewType + ' review on ' + accounts[0].Name + ' at In Progress')
                .onObject(C360WriteGuard.OBJ_REVIEW, new List<String>(resolved.keySet()))
                .wakes(new List<String>{ 'Review After Save (assigns the record type and populates the loan officer from the relationship owner)' })
                .provenBy('SELECT Id, Name, LLC_BI__Status__c, LLC_BI__Review_Type__c, RecordTypeId FROM LLC_BI__Review__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('verify_review', C360Plan.TYPE_VERIFICATION, 'Confirm the review landed with an explicit status and type')
                .onObject(C360WriteGuard.OBJ_REVIEW, new List<String>{ 'LLC_BI__Status__c', 'LLC_BI__Review_Type__c' })
                .provenBy('SELECT Id, LLC_BI__Status__c, LLC_BI__Review_Type__c, RecordTypeId FROM LLC_BI__Review__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('observe_after_save', C360Plan.TYPE_OBSERVED, 'The org assigns the record type and the loan officer')
                .wakes(new List<String>{ 'Review After Save' })
        );
        steps.add(
            new C360Plan.Step('handoff_approval', C360Plan.TYPE_HANDOFF, 'Control passes to nCino Submit for Approval')
                .wakes(new List<String>{ 'The org\'s own review approval process' })
        );

        List<String> warnings = new List<String>{
            'This tool creates the review at In Progress and stops. It never writes Complete, never writes cm_Review_Stage__c, and never sets the record type. The narrative is staged for a banker to submit through nCino\'s own Submit for Approval.',
            'Entities added to the borrowing structure after the review is created get no LLC_BI__Review_Account__c snapshot row and become invisible on this review.',
            'Package rollups recalculate based on the running user\'s record access, so a review opened by an identity with narrower sharing produces narrower rollups.',
            'Do not retry or refresh after this runs. The org is known to create two records on a retried credit action, which is why a resume re-queries first.'
        };

        Map<String, Object> provenance = new Map<String, Object>{
            'LLC_BI__Account__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => req.accountId },
            'LLC_BI__Status__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'PROBE-LEDGER probe 3: nothing defaults this field, so the tool sets it explicitly.' },
            'LLC_BI__Review_Type__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null }
        };
        Map<String, Object> attribution = narrativeAttribution(req);
        if (attribution != null) {
            provenance.put('narrativeAttribution', attribution);
        }

        String summary =
            'Opens one ' + req.reviewType + ' review on ' + accounts[0].Name + ' at status In Progress, with the drafted narrative attached. ' +
            'The org assigns the record type. Nothing is approved and nothing is completed: the last step hands off to nCino\'s Submit for Approval, ' +
            'and the org\'s own process mints Complete.';

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('annual-review', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'annual-review', req.idempotencyKey, req.accountId, packageId, planJson, planHash
        );

        StageResult r = new StageResult();
        r.stagingId = staged.stagingId;
        r.planHash = staged.planHash;
        r.decisionToken = staged.decisionToken;
        r.replayed = staged.replayed;
        r.tokenRotated = staged.tokenRotated;
        r.summary = summary;
        r.warnings = warnings;
        r.provenanceJson = JSON.serialize(provenance);
        r.accountId = req.accountId;
        r.productPackageId = packageId;
        r.steps = toWireSteps(steps);
        return r;
    }

    /**
     * A33.1.7: editing agent prose does not change its provenance. The honest record is
     * attribution, and attribution is ledger-only. Nothing here reaches the nCino field text:
     * the credit file holds clean final prose exactly as a banker would write it.
     */
    private static Map<String, Object> narrativeAttribution(Request req) {
        if (req.editedNarrativeFields == null || req.editedNarrativeFields.isEmpty()) {
            return null;
        }
        return new Map<String, Object>{
            'provenance' => 'AGENT',
            'editedBy' => UserInfo.getUserId(),
            'editedAt' => String.valueOf(System.now()),
            'editedFields' => req.editedNarrativeFields
        };
    }

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
