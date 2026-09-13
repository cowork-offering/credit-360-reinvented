/**
 * StageRiskRatingReview - MCP tool: stage_risk_rating_review.
 *
 * A33.0.1: ZERO domain DML. The Risk Rating Review is created only by execute_risk_rating_review.
 *
 * Write object is LLC_BI__Annual_Review__c, whose LABEL is "Risk Rating Review". It is a different
 * object from LLC_BI__Review__c (A33.4.7). No object in this org carries "Rating" in its API name.
 *
 * PROBE 4 FACTS (PROBE-LEDGER wave 3):
 *   - One field suffices to insert: LLC_BI__Account__c. It is nillable false and cascade-delete.
 *   - LLC_BI__Status__c DEFAULTS TO 'Not Approved'. That is worse than Review's null, because an
 *     omitted status reads as a DECISION rather than as an absent value. Execute sets 'In Review'
 *     explicitly and C360WriteGuard refuses any other create state.
 *   - The object has NO RecordTypeId and NO OwnerId field at all. Setting either fails outright.
 *   - LLC_BI__Final_Risk_Grade__c is a formula and is never written.
 *
 * Validation rule mirrored client-side: Mandatory_comment, no bypass. Any
 * LLC_BI__Overridden_Risk_Grade_Value__c greater than zero requires a comment. The describe
 * reports the rule's error field as LLC_BI__Override_Comment__c while the formula tests
 * LLC_BI__Comments__c. We write the FORMULA's field, because that is the one the rule reads.
 *
 * Naming trap carried from A33.4.7: LLC_BI__Cash_Flow_Coverage_actual__c is the writable input and
 * the bare LLC_BI__Cash_Flow_Coverage__c is the read-only formula. Every score below is the
 * _actual__c or _RG__c form.
 *
 * Scale note (A28/A26): the review scale here is 1 to 12. The package field LLC_BI__Risk_Rating__c
 * is 1 to 10, and on Loan the field is LLC_BI__Risk_Grade__c. Any panel naming a rating must say
 * which surface and which scale it means.
 */
global with sharing class StageRiskRatingReview {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Account Id' description='The object\'s one hard-required field. A risk rating review hangs off the account, not the loan.' required=true)
        global String accountId;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='Loan Id' description='Optional. This object is account-anchored and the loan lookup is nillable.')
        global String loanId;
        @InvocableVariable(label='Computed Risk Grade Value' description='The model output, on the 1 to 12 review scale.')
        global Decimal computedRiskGradeValue;
        @InvocableVariable(label='Overridden Risk Grade Value' description='Any value above zero triggers the Mandatory_comment rule and makes the comment required.')
        global Decimal overriddenRiskGradeValue;
        @InvocableVariable(label='Comments' description='Required whenever an override is present. Written to LLC_BI__Comments__c, the field the validation rule formula actually tests.')
        global String comments;
        @InvocableVariable(label='Cash Flow Coverage (actual)')
        global Decimal cashFlowCoverageActual;
        @InvocableVariable(label='Credit Score (actual)')
        global Decimal creditScoreActual;
        @InvocableVariable(label='Management Experience (actual)')
        global Decimal managementExperienceActual;
        @InvocableVariable(label='Revenue Growth (actual)')
        global Decimal revenueGrowthActual;
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
     * Stages a risk rating review. Writes no record.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_risk_rating_review'
        description='Validate a risk rating review against the org contract and return an immutable execution plan with a plan hash and a single-use decision token. Writes NO record: the review is created only by execute_risk_rating_review behind the token gate, at status In Review.'
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
            throw new ToolException('accountId is required. It is the one hard-required field on this object.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }

        // Mandatory_comment, mirrored client-side so the banker is told before the org refuses.
        Boolean overriding = req.overriddenRiskGradeValue != null && req.overriddenRiskGradeValue > 0;
        if (overriding && String.isBlank(req.comments)) {
            throw new ToolException(
                'comments is required whenever the overridden risk grade is above zero. The org rule Mandatory_comment has ' +
                'no bypass and applies to this tool exactly as it does to a banker.'
            );
        }

        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id = :req.accountId WITH USER_MODE LIMIT 1];
        if (accounts.isEmpty()) {
            throw new ToolException('Account ' + req.accountId + ' was not found, or is not visible to you.');
        }

        Id loanId = null;
        if (String.isNotBlank(req.loanId)) {
            List<LLC_BI__Loan__c> loans = [SELECT Id FROM LLC_BI__Loan__c WHERE Id = :req.loanId WITH USER_MODE LIMIT 1];
            if (loans.isEmpty()) {
                throw new ToolException('Loan ' + req.loanId + ' was not found, or is not visible to you.');
            }
            loanId = loans[0].Id;
        }

        Map<String, Object> resolved = new Map<String, Object>{
            'LLC_BI__Account__c' => req.accountId,
            'LLC_BI__Loan__c' => loanId,
            'LLC_BI__Status__c' => 'In Review',
            'LLC_BI__Computed_Risk_Grade_Value__c' => req.computedRiskGradeValue,
            'LLC_BI__Overridden_Risk_Grade_Value__c' => req.overriddenRiskGradeValue,
            'LLC_BI__Comments__c' => req.comments,
            'LLC_BI__Cash_Flow_Coverage_actual__c' => req.cashFlowCoverageActual,
            'LLC_BI__Credit_Score_actual__c' => req.creditScoreActual,
            'LLC_BI__Management_Experience_actual__c' => req.managementExperienceActual,
            'LLC_BI__Revenue_Growth_actual__c' => req.revenueGrowthActual
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        steps.add(
            new C360Plan.Step('write_risk_rating', C360Plan.TYPE_WRITE, 'Open a risk rating review on ' + accounts[0].Name + ' at In Review')
                .onObject(C360WriteGuard.OBJ_RISK_RATING, new List<String>(resolved.keySet()))
                .wakes(new List<String>{ 'Risk Rating (Annual) Review After Save, which writes back onto the Loan when the product line is Commercial' })
                .provenBy('SELECT Id, Name, LLC_BI__Status__c, LLC_BI__Final_Risk_Grade__c FROM LLC_BI__Annual_Review__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('verify_risk_rating', C360Plan.TYPE_VERIFICATION, 'Confirm the review landed at In Review rather than at a decision')
                .onObject(C360WriteGuard.OBJ_RISK_RATING, new List<String>{ 'LLC_BI__Status__c' })
                .provenBy('SELECT Id, LLC_BI__Status__c, LLC_BI__Final_Risk_Grade__c FROM LLC_BI__Annual_Review__c WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('observe_loan_writeback', C360Plan.TYPE_OBSERVED, 'The org may write the grade back onto the loan')
                .wakes(new List<String>{ 'Risk Rating (Annual) Review After Save' })
        );

        List<String> warnings = new List<String>{
            'This review is created at In Review. Approved and Declined belong to the org\'s own RiskRatingReviewDecisioned path and are never written here.',
            'The final risk grade is a formula. This action writes the inputs; the org computes the grade.',
            'A risk rating review launched from a loan can hang with no error when the account violates a validation rule, so this plan verifies by re-query rather than trusting a synchronous success.',
            'Account.LLC_BI__Highest_Risk_Grade__c has a maximum length of two characters. A grade label rather than a number would be refused, so this action never writes it.'
        };
        if (overriding) {
            warnings.add('An override is present, so the comment is mandatory and will be written to the field the org\'s rule reads.');
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'LLC_BI__Account__c' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => req.accountId },
            'LLC_BI__Status__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'Probe 4: the field defaults to Not Approved, which reads as a decision. Set explicitly.' },
            'LLC_BI__Computed_Risk_Grade_Value__c' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'Model output on the 1 to 12 review scale.' }
        };

        String summary =
            'Opens one risk rating review on ' + accounts[0].Name + ' at status In Review, with the scoring inputs attached. ' +
            'The org computes the final grade from those inputs. No decision is recorded: this action never writes Approved or Declined.';

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('risk-rating-review', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'risk-rating-review', req.idempotencyKey, req.accountId, null, planJson, planHash
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
        r.steps = toWireSteps(steps);
        return r;
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
