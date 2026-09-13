/**
 * StageServiceRequest - MCP tool: stage_service_request.
 *
 * A33.0.1: this tool performs ZERO domain-object DML. The Case is created only by
 * execute_service_request, behind the token gate.
 *
 * Type and Origin are read from the org, never carried as literals (WP1 criterion 3). The org
 * now offers 'Service Request' and 'Agent', so the degraded branch is unreachable in bankinggpt,
 * but it stays in the code for an org that has not deployed those values. When it does fire, the
 * confirm summary declares the substitution: the tool never claims a case is typed as a service
 * request when it is not.
 *
 * Org contract: A33.4.8. Write evidence: PROBE-LEDGER.md probe 2 (CONFIRMED, 2026-07-25).
 */
global with sharing class StageServiceRequest {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    private static final String PREFERRED_TYPE = 'Service Request';
    private static final String FALLBACK_TYPE = 'Question';
    private static final String PREFERRED_ORIGIN = 'Agent';
    private static final String FALLBACK_ORIGIN = 'Web';

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Account Id' description='The borrower relationship the request is raised against.' required=true)
        global String accountId;
        @InvocableVariable(label='Rationale' description='Why this request is being raised. Feeds the audit ledger.' required=true)
        global String rationale;
        @InvocableVariable(label='Request Type' description='Banker-language description of what the client asked for. Becomes the case subject.' required=true)
        global String requestType;
        @InvocableVariable(label='Summary' description='The request in full, as the servicing team needs to read it.' required=true)
        global String summary;
        @InvocableVariable(label='Reference Kind' description='Where the request came from, for example m365-message.')
        global String referenceKind;
        @InvocableVariable(label='Reference Id' description='The source message id. The citation behind a CLIENT_REQUEST prefill.')
        global String referenceId;
        @InvocableVariable(label='Reference Web Link')
        global String referenceWebLink;
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
        @InvocableVariable(label='Degraded Type Mode' description='True when the org does not offer the honest Type and Origin values and the tool substituted the probe-proven pair.')
        global Boolean degradedTypeMode;
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
     * Stages a service request. Writes no Case.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_service_request'
        description='Validate a service request against the org contract and return an immutable execution plan with a plan hash and a single-use decision token. Writes NO Case: the Case is created only by execute_service_request behind the token gate.'
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
            throw new ToolException('accountId is required. A service request hangs off the borrower relationship.');
        }
        if (String.isBlank(req.requestType)) {
            throw new ToolException('requestType is required. It becomes the case subject.');
        }
        if (String.isBlank(req.summary)) {
            throw new ToolException('summary is required. A case with no description is not actionable by the servicing team.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }

        List<Account> accounts = [SELECT Id, Name FROM Account WHERE Id = :req.accountId WITH USER_MODE LIMIT 1];
        if (accounts.isEmpty()) {
            throw new ToolException('Account ' + req.accountId + ' was not found, or is not visible to you.');
        }

        String caseType = C360Picklist.preferredOrFallback(C360WriteGuard.OBJ_CASE, 'Type', PREFERRED_TYPE, FALLBACK_TYPE);
        String caseOrigin = C360Picklist.preferredOrFallback(C360WriteGuard.OBJ_CASE, 'Origin', PREFERRED_ORIGIN, FALLBACK_ORIGIN);
        Boolean degraded = caseType != PREFERRED_TYPE || caseOrigin != PREFERRED_ORIGIN;

        // The package is the deep-link anchor only. A Case is account-anchored (A33.5.7).
        Id packageId = null;
        for (LLC_BI__Product_Package__c pkg : [
            SELECT Id FROM LLC_BI__Product_Package__c
            WHERE LLC_BI__Account__c = :req.accountId
            WITH USER_MODE
            ORDER BY LastModifiedDate DESC
            LIMIT 1
        ]) {
            packageId = pkg.Id;
        }

        Map<String, Object> resolved = new Map<String, Object>{
            'AccountId' => req.accountId,
            'Type' => caseType,
            'Origin' => caseOrigin,
            'Status' => 'New',
            'Subject' => req.requestType,
            'Description' => describeWithSource(req)
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        steps.add(
            new C360Plan.Step('write_case', C360Plan.TYPE_WRITE, 'Raise the service request against ' + accounts[0].Name)
                .onObject(C360WriteGuard.OBJ_CASE, new List<String>(resolved.keySet()))
                .wakes(new List<String>{
                    'FinServ.CaseTrigger (before insert, before update)',
                    'slackv2.caseTrigger (after insert, after update, before delete)'
                })
                .provenBy('SELECT Id, CaseNumber, Status, Type, Origin FROM Case WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('verify_case', C360Plan.TYPE_VERIFICATION, 'Confirm the case landed at status New with the intended type and origin')
                .onObject(C360WriteGuard.OBJ_CASE, new List<String>{ 'Status', 'Type', 'Origin' })
                .provenBy('SELECT Id, CaseNumber, Status, Type, Origin FROM Case WHERE Id = :newId')
        );
        steps.add(
            new C360Plan.Step('observe_slack', C360Plan.TYPE_OBSERVED, 'The org may post this case to Slack')
                .wakes(new List<String>{ 'slackv2.caseTrigger' })
        );

        List<String> warnings = new List<String>{
            'slackv2.caseTrigger fires on insert and may post to Slack. Probe 2 observed no side effect, but nothing in that probe watched Slack, so this is absence of observation and not proof of absence.',
            'The case is created at status New and takes no transition and no closure from this tool. Everything after New belongs to the servicing process.'
        };
        if (degraded) {
            warnings.add(
                'Declared type mismatch: this org does not offer Type = \'' + PREFERRED_TYPE + '\' and Origin = \'' + PREFERRED_ORIGIN +
                '\', so the case will be filed as Type = \'' + caseType + '\' and Origin = \'' + caseOrigin +
                '\'. It is a service request in substance and is not typed as one in the data.'
            );
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'AccountId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => req.accountId },
            'Subject' => new Map<String, String>{ 'prefill' => 'CLIENT_REQUEST', 'provenance' => 'DERIVED', 'citation' => req.referenceId },
            'Description' => new Map<String, String>{ 'prefill' => 'CLIENT_REQUEST', 'provenance' => 'DERIVED', 'citation' => req.referenceId },
            'Type' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'Read from the Case.Type picklist in this org, not carried as a literal.' },
            'Origin' => new Map<String, String>{ 'prefill' => 'COMPUTED', 'provenance' => 'DERIVED', 'citation' => 'Read from the Case.Origin picklist in this org, not carried as a literal.' }
        };

        String summary =
            'Raises one Case against ' + accounts[0].Name + ' at status New, typed \'' + caseType + '\' with origin \'' + caseOrigin +
            '\'. No status is transitioned, nothing is closed, and no credit decision is made or implied.' +
            (degraded ? ' The type substitution above is declared, not hidden.' : '');

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('create-service-request', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'create-service-request', req.idempotencyKey, req.accountId, packageId, planJson, planHash
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
        r.degradedTypeMode = degraded;
        r.steps = toWireSteps(steps);
        return r;
    }

    /**
     * Case has no field for the source reference, so it rides in the description as a labelled
     * line. A33.4.8(a) requires the reference to be written; this is the only place on the object
     * that can hold it, and a banker reading the case can see where the request came from.
     */
    private static String describeWithSource(Request req) {
        String body = req.summary;
        if (String.isNotBlank(req.referenceId)) {
            body += '\n\nSource: ' + (String.isBlank(req.referenceKind) ? 'reference' : req.referenceKind) + ' ' + req.referenceId;
            if (String.isNotBlank(req.referenceWebLink)) {
                body += '\n' + req.referenceWebLink;
            }
        }
        return body;
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
