/**
 * StageCovenantReview - MCP tool: stage_covenant_review.
 *
 * RELATIONSHIP-ANCHORED BULK. One call, one plan, one plan hash, one decision token, N covenant
 * assessments. The anchor is the ACCOUNT and the unit of action is the covenant.
 *
 * THE ANCHOR MOVED, 2026-09-13 (founder: "covenants and collateral are driven from the
 * relationship; a package is an association, never a filter"). Until this wave the tool REQUIRED a
 * product package, which made the room ask "which deal?" before it could show a banker a covenant
 * test that has nothing to do with a deal. nCino itself says the package is a read aggregation:
 * "the product package shows an aggregated list of the covenants included in the loans within the
 * package. The user still needs to manage the covenants at the individual loan or Relationship
 * level" (kb:kAHHu000000XZTaOAO). So `accountId` is the anchor, `productPackageId` is OPTIONAL and,
 * when given, is a narrowing THE CALLER CHOSE. Each covenant in the result carries its
 * ASSOCIATIONS - the facilities it is junctioned to and the packages those facilities sit on - as
 * data the room shows on the row. An association is never a filter and never a control.
 *
 * BACK-COMPAT IS DELIBERATE AND IT IS NOT A SECOND SHAPE. A caller that still sends
 * `productPackageId` alone keeps working: the borrower is DERIVED from the package's own
 * LLC_BI__Account__c and becomes the anchor, and the package narrows the scope exactly as it did
 * before. The deployed cockpit 0.9.23 sends the package, so breaking that would break the room in
 * production for no gain. Sending both is legal and means "this relationship, narrowed to this
 * deal"; the package must belong to the account or the request is refused by name.
 *
 * Resolution and the write precondition live in C360Covenants, shared with execute_covenant_review
 * so the two cannot drift.
 *
 * THE OLD SINGLE SHAPE IS GONE, DELIBERATELY. `accountId` + `covenantComplianceId` + `result` were
 * dropped rather than kept alongside the bulk shape. Keeping them was not cheap: the old shape
 * anchors on a compliance ROW and names no covenant, so it cannot carry the parent-covenant reads
 * this wave added (Active, Frequency Template, Effective Date), which are what make the
 * approval-trap warning and the Pending precondition possible at all. A back-compat path would have
 * been a second plan shape with a second execute branch that silently skipped both new guards, which
 * is worse than a breaking change. Lesson 16aa applies to the removal too: the superseded fields
 * carried `required=true`, and leaving them would have made the new shape unreachable on the wire.
 * Callers move to accountId (or productPackageId) + assessments[]. `accountId` is back on the
 * request as of 2026-09-13, and it is a DIFFERENT field from the one dropped here: it names the
 * relationship the survey runs over, not a compliance row's account.
 *
 * WHAT CHANGED IN THE SAFETY ARGUMENT, AND WHY THE OLD HEADER WAS WRONG.
 * The previous header asserted "OUR TOOLS CANNOT START THE BANK'S APPROVAL CHAIN BY CONSTRUCTION",
 * on the ground that `acnpex_covenantApprovalProcess` is create-triggered and this tool only updates.
 * That is true of our DML and false of the transaction. Three vendor sources say that moving a
 * compliance row into a complete status is what makes nCino CREATE the next compliance row:
 * kb:kAHHu000000XZRJOA4 ("new Compliances will create when the previous Compliance is moved to a
 * status outlined in the Record Create Trigger Statuses system property"), PDI-00023403 ("marks the
 * current Pending Covenant Compliance as Compliant, the system generates the next Covenant
 * Compliance record"), and kb:kAHPY00000055lR4AQ ("The system treats Exception as a complete,
 * terminal status. As a result, the system creates the next Covenant Compliance record"). The claim
 * is now STRUCTURAL and per covenant: the plan reads Active + Frequency Template + Effective Date
 * and warns when that combination is present, and execute MEASURES whether a successor row appeared
 * instead of asserting it did not.
 *
 * THE PENDING PRECONDITION. kb:kAHHu000000XZOTOA4: only a `Pending` to complete transition advances
 * the covenant. A write onto an `In Progress` row succeeds and is inert. This tool refuses such a
 * covenant per item, naming the current status, unless the caller sets `allowNonPending`.
 *
 * EXCEPTION IS NOT A SYNONYM FOR BREACH. nCino's exception batch forces `Exception` onto any row
 * whose Due Date has passed, measured or not; 101 of the 140 rows read in this org sit at Exception
 * with no measured value at all. No prose in this plan calls an Exception a breach. The distinction
 * is carried in data instead, by `LLC_BI__Reason_for_Exception__c` (Breached or Overdue), which the
 * caller supplies.
 *
 * A33.0.1: ZERO domain DML. The compliance rows are updated only by execute_covenant_review.
 * Org contract: A33.4.4.
 */
global with sharing class StageCovenantReview {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /** One covenant assessment in a batch. */
    global class Assessment {
        @InvocableVariable(label='Covenant Id' description='The covenant being assessed. Must be a covenant of the named product package. Required in Apex; see the class header on Actions-API enforcement.')
        global String covenantId;
        @InvocableVariable(label='Status' description='Compliant, Waived or Exception. Those are nCino\'s three complete statuses. This org holds no separate non-compliant value: a failed test is Exception with Reason for Exception = Breached.')
        global String status;
        @InvocableVariable(label='Observed Value' description='The tested figure. Written to the packaged Historic Financial Indicator field, which is where nCino sources the covenant Last Evaluation Value from, and mirrored to the bank-local audit field.')
        global Decimal observedValue;
        @InvocableVariable(label='Reason For Exception' description='Breached or Overdue. Defaults to Breached on an Exception. Overdue records an undelivered document rather than a failed test.')
        global String reasonForException;
        @InvocableVariable(label='Narrative' description='The assessment, written to the agent response field.')
        global String narrative;
        @InvocableVariable(label='Comments')
        global String comments;
    }

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Account Id' description='THE ANCHOR. The relationship whose covenants are under review: every covenant on the borrower and every covenant of its facilities, across every package. Required in Apex unless productPackageId is supplied, in which case the borrower is derived from the package. It is not flagged required on the invocable because the package-only shape the deployed cockpit sends must keep working.')
        global String accountId;
        @InvocableVariable(label='Product Package Id' description='OPTIONAL NARROWING, never an anchor. Supply it to work one deal and the scope becomes the covenants the package aggregates: the union of its loans\' junctions and its borrowers\' junctions. Omit it and every covenant on the relationship is surveyed. Each covenant reports the packages it is associated with either way; the association is shown, never used to filter.')
        global String productPackageId;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='Covenant Ids' description='Optional member selection. Omit it and every covenant in scope is surveyed, which is the whole relationship unless productPackageId narrowed it.')
        global List<Id> covenantIds;
        @InvocableVariable(label='Assessments' description='One entry per covenant to assess. A covenant in scope with no assessment is surveyed and reported, never written.')
        global List<Assessment> assessments;
        @InvocableVariable(label='Allow Non Pending' description='Explicit opt-in to recording an assessment on a compliance row that is not Pending. Such a write succeeds and does NOT advance the covenant schedule. Default false, and a non-Pending row is refused per covenant.')
        global Boolean allowNonPending;
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

    /** One covenant in package scope. Every covenant found is reported, planned or not. */
    global class PlannedCovenant {
        @InvocableVariable(label='Covenant Id')
        global String covenantId;
        @InvocableVariable(label='Covenant Name')
        global String covenantName;
        @InvocableVariable(label='Covenant Type')
        global String covenantType;
        @InvocableVariable(label='Attachment' description='loan, relationship, or both. An empty loan junction is the fact that the covenant is relationship-level, not a gap.')
        global String attachment;
        @InvocableVariable(label='Associations' description='The facilities and packages this covenant is tied to, as JSON: [{"loanId","loanName","productPackageId","packageName"}]. An empty list means the covenant carries no facility junction at all, which is a real answer about a relationship-level covenant rather than a gap. This is DATA THE ROOM SHOWS on the row; it is never a filter and never a narrowing control.')
        global String associations;
        @InvocableVariable(label='Covenant Compliance Id' description='The row a review would act on: the open one with the earliest due date, or the most recent row when none is open.')
        global String covenantComplianceId;
        @InvocableVariable(label='Current Compliance Status' description='The row status BEFORE this plan runs. Only Pending advances the schedule.')
        global String currentComplianceStatus;
        @InvocableVariable(label='Assessed Status' description='The status this plan would write, or null when the covenant is surveyed only.')
        global String assessedStatus;
        @InvocableVariable(label='State' description='planned, not_assessed, or one of the not_assessable_* refusals.')
        global String state;
        @InvocableVariable(label='Reason' description='Why this covenant is not being written, when it is not.')
        global String reason;
        @InvocableVariable(label='Generates Next Row' description='True when the covenant is Active with a Frequency Template and an Effective Date, the configuration nCino uses to mint the next compliance record on a complete status.')
        global Boolean generatesNextRow;
        @InvocableVariable(label='Write Step Id')
        global String writeStepId;
        @InvocableVariable(label='Status Step Id')
        global String statusStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
        @InvocableVariable(label='Generation Step Id')
        global String generationStepId;
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
        @InvocableVariable(label='Account Id' description='The relationship this plan is anchored on, and the anchor the staging row carries.')
        global String accountId;
        @InvocableVariable(label='Product Package Id' description='The single package this plan touches, where the covenants it writes are all associated with exactly one. Null where they span several packages or none: there is then no one deal to deep-link to, and the staging row carries no package either.')
        global String productPackageId;
        @InvocableVariable(label='Covenants' description='Every covenant in scope, planned or refused, each with its own state, reason and associations.')
        global List<PlannedCovenant> covenants;
        @InvocableVariable(label='Assessed Count' description='Covenants this plan will write.')
        global Integer assessedCount;
        @InvocableVariable(label='Refused Count' description='Covenants carrying an assessment that cannot be written, with a reason each.')
        global Integer refusedCount;
        @InvocableVariable(label='Scope Count' description='Covenants the package aggregates, before any selection.')
        global Integer scopeCount;
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
     * Stages a package-scoped covenant review. Writes no domain record.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_covenant_review'
        description='Survey the covenants of a RELATIONSHIP - every covenant on the borrower and every covenant of its facilities, across every package - and return an immutable execution plan for N covenant assessments under one plan hash and one single-use decision token. accountId is the anchor; productPackageId is an OPTIONAL narrowing the caller chooses, never a requirement, and a caller that sends only a package still works because the borrower is derived from it. Every covenant reports the facilities and packages it is associated with, as data to show rather than as a filter. Writes nothing. Updates only existing compliance records; never creates one. Refuses per covenant when the compliance row is not Pending, because only a Pending row advances the nCino schedule.'
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
            } catch (C360Covenants.ResolutionException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, req.idempotencyKey);
            } catch (C360Facilities.SelectionException e) {
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
        if (String.isBlank(req.accountId) && String.isBlank(req.productPackageId)) {
            throw new ToolException(
                'accountId is required. It is the anchor: covenants are driven from the relationship, and a productPackageId ' +
                'is only a narrowing the caller chooses. Supply accountId, or supply productPackageId alone and the borrower is derived from it.'
            );
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (req.assessments == null || req.assessments.isEmpty()) {
            throw new ToolException(
                'assessments is required and must carry at least one covenant. A review with no verdict on any covenant would stage a plan that writes nothing. ' +
                'It is not flagged required on the invocable because requiredness enforced there cannot say WHICH entry is wrong, so the check lives in Apex.'
            );
        }
        if (req.assessments.size() > C360Covenants.MAX_ASSESSMENTS) {
            throw new ToolException(
                'assessments carries ' + req.assessments.size() + ' covenants; the cap is ' + C360Covenants.MAX_ASSESSMENTS +
                ' per plan. Each status write enqueues a change-data queueable, and a complete status may make nCino insert the NEXT compliance row, ' +
                'which enqueues a second one, against a platform ceiling of 50 queued jobs per transaction. Stage the rest as a second plan.'
            );
        }

        Id packageId = String.isBlank(req.productPackageId) ? null : C360Facilities.packageId(req.productPackageId);
        Id accountId = anchorAccount(req, packageId);
        Boolean allowNonPending = req.allowNonPending == true;

        List<C360Covenants.Resolved> scope = C360Covenants.resolveScope(accountId, packageId, req.covenantIds);
        if (scope.isEmpty()) {
            throw new ToolException(
                packageId == null
                    ? ('Relationship ' + accountId + ' holds no covenants. nCino attaches a covenant to the borrower and to facilities, ' +
                       'so an empty scope means this account carries none on its own record, none through an account junction, and none on any of its facilities.')
                    : ('Product package ' + packageId + ' aggregates no covenants. nCino attaches covenants to loans and to relationships, not to the package itself, ' +
                       'so an empty scope means neither junction reaches this package. Omit productPackageId to survey the whole relationship.')
            );
        }
        Map<Id, C360Covenants.Resolved> byCovenant = new Map<Id, C360Covenants.Resolved>();
        for (C360Covenants.Resolved r : scope) {
            byCovenant.put(r.covenantId, r);
        }

        // Validate the verdicts and bind each to its covenant, before any plan is built.
        Map<Id, Assessment> assessmentByCovenant = new Map<Id, Assessment>();
        List<Id> assessmentOrder = new List<Id>();
        for (Integer i = 0; i < req.assessments.size(); i++) {
            Assessment a = req.assessments[i];
            String itemRef = ' (assessment ' + (i + 1) + ' of ' + req.assessments.size() + ')';
            if (String.isBlank(a.covenantId)) {
                throw new ToolException('covenantId is required' + itemRef + '.');
            }
            Id cid;
            try {
                cid = Id.valueOf(a.covenantId);
            } catch (Exception e) {
                throw new ToolException('covenantId ' + a.covenantId + ' is not a record id' + itemRef + '.');
            }
            if (cid.getSObjectType() != LLC_BI__Covenant2__c.SObjectType) {
                throw new ToolException('covenantId ' + cid + ' is not a covenant id' + itemRef + '.');
            }
            if (assessmentByCovenant.containsKey(cid)) {
                throw new ToolException(
                    'Covenant ' + cid + ' is assessed more than once' + itemRef + '. One verdict per covenant per plan: two would race each other onto the same compliance row.'
                );
            }
            if (!byCovenant.containsKey(cid)) {
                throw new ToolException(
                    'Covenant ' + cid + ' is not in scope for this plan' + itemRef + '. It is either not a covenant of ' +
                    (packageId == null ? ('relationship ' + accountId) : ('package ' + packageId)) +
                    ', a covenant template, or it was excluded by covenantIds.'
                );
            }
            C360Covenants.assertStatus(a.status, itemRef);
            C360Covenants.assertReason(a.reasonForException, itemRef);
            assessmentByCovenant.put(cid, a);
            assessmentOrder.add(cid);
        }

        // Apply the precondition per covenant. A refusal is per item and never discards the plan.
        List<C360Covenants.Resolved> planned = new List<C360Covenants.Resolved>();
        Integer refused = 0;
        for (Id cid : assessmentOrder) {
            C360Covenants.Resolved r = byCovenant.get(cid);
            if (C360Covenants.applyPrecondition(r, allowNonPending)) {
                planned.add(r);
            } else {
                refused++;
            }
        }
        if (planned.isEmpty()) {
            throw new ToolException(
                'None of the ' + req.assessments.size() + ' covenants assessed can be written. ' + firstReasons(scope) +
                ' Nothing is staged, because a plan that promises no write is not a plan.'
            );
        }

        // THE PACKAGES THIS PLAN TOUCHES, read off the associations rather than off the request.
        // The staging row anchors on the ACCOUNT and names a package only where exactly one is
        // touched: a covenant review that spans two deals has no single deal to deep-link to, and
        // writing one of them onto the row would make the trail claim a narrowing nobody chose.
        Map<Id, String> touchedPackages = C360Covenants.packagesTouched(planned);
        Id anchorPackageId = touchedPackages.size() == 1
            ? new List<Id>(touchedPackages.keySet())[0]
            : null;

        Map<String, Object> resolved = new Map<String, Object>{
            'accountId' => String.valueOf(accountId),
            'productPackageId' => packageId == null ? null : String.valueOf(packageId),
            'anchorPackageId' => anchorPackageId == null ? null : String.valueOf(anchorPackageId),
            'itemCount' => planned.size(),
            'allowNonPending' => allowNonPending
        };
        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        List<String> assessedNames = new List<String>();

        for (Integer i = 0; i < planned.size(); i++) {
            C360Covenants.Resolved r = planned[i];
            Assessment a = assessmentByCovenant.get(r.covenantId);
            String n = String.valueOf(i);
            Boolean isException = a.status == 'Exception';
            String reason = isException ? (String.isBlank(a.reasonForException) ? 'Breached' : a.reasonForException) : null;
            assessedNames.add(r.covenantName);

            resolved.put('item' + n + '.covenantId', String.valueOf(r.covenantId));
            resolved.put('item' + n + '.targetId', String.valueOf(r.complianceId));
            resolved.put('item' + n + '.sourceStatus', r.complianceStatus);
            resolved.put('item' + n + '.LLC_BI__Status__c', a.status);
            resolved.put('item' + n + '.LLC_BI__Historic_Financial_Indicator__c', a.observedValue);
            resolved.put('item' + n + '.Agentic_AI_Response__c', a.narrative);
            resolved.put('item' + n + '.LLC_BI__Comments__c', a.comments);
            resolved.put('item' + n + '.LLC_BI__Reason_for_Exception__c', reason);

            steps.add(
                new C360Plan.Step('find_compliance_' + n, C360Plan.TYPE_VERIFICATION,
                        'Re-read the compliance row on ' + r.covenantName + ', currently ' + String.valueOf(r.complianceStatus))
                    .onObject(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, new List<String>{ 'LLC_BI__Status__c', 'LLC_BI__Due_Date__c' })
                    .provenBy('SELECT Id, LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetId')
            );
            steps.add(
                new C360Plan.Step('write_assessment_' + n, C360Plan.TYPE_WRITE, 'Record the assessment and observed value on ' + r.covenantName)
                    .onObject(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, new List<String>{
                        'Agentic_AI_Response__c', 'LLC_BI__Comments__c',
                        'LLC_BI__Historic_Financial_Indicator__c', 'cm_Covenant_Compliance_Indicator_Value__c'
                    })
                    .wakes(new List<String>{
                        'Three triggers on update (LLC_BI, nCino, nCRED.covenantCompliance_BeforeUpdate)',
                        'ACNPEX_Covenant Mgmt Calculation Logic Update on the parent, which carries no bypass'
                    })
                    .provenBy('SELECT Id, LLC_BI__Historic_Financial_Indicator__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetId')
            );
            steps.add(
                new C360Plan.Step('write_status_' + n, C360Plan.TYPE_WRITE, 'Move the compliance status on ' + r.covenantName + ' to ' + a.status)
                    .onObject(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, isException
                        ? new List<String>{ 'LLC_BI__Status__c', 'LLC_BI__Reason_for_Exception__c', 'LLC_BI__Exception_Date__c', 'LLC_BI__Evaluation_Date__c', 'LLC_BI__Evaluated_By__c' }
                        : new List<String>{ 'LLC_BI__Status__c', 'LLC_BI__Evaluation_Date__c', 'LLC_BI__Evaluated_By__c' })
                    .provenBy('SELECT Id, LLC_BI__Status__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetId')
            );
            steps.add(
                new C360Plan.Step('verify_' + n, C360Plan.TYPE_VERIFICATION, 'Confirm the compliance row on ' + r.covenantName + ' reads back at ' + a.status)
                    .onObject(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, new List<String>{ 'LLC_BI__Status__c' })
                    .provenBy('SELECT Id, LLC_BI__Status__c, LLC_BI__Historic_Financial_Indicator__c FROM LLC_BI__Covenant_Compliance2__c WHERE Id = :targetId')
            );
            steps.add(
                new C360Plan.Step('observe_generation_' + n, C360Plan.TYPE_OBSERVED,
                        'Re-query ' + r.covenantName + ' for a compliance row nCino created in response to this write')
                    .onObject(C360WriteGuard.OBJ_COVENANT_COMPLIANCE, new List<String>{ 'CreatedDate' })
                    .wakes(new List<String>{
                        'nCino managed trigger: creates the next compliance record when this one reaches a complete status',
                        'acnpex_covenantApprovalProcess: fires on that create, with zero entry filters, at a named human'
                    })
                    .provenBy('SELECT Id, CreatedDate FROM LLC_BI__Covenant_Compliance2__c WHERE LLC_BI__Covenant__c = :covenantId AND Id != :targetId')
            );
        }

        List<String> warnings = new List<String>();
        warnings.addAll(C360Covenants.generationWarnings(planned));
        warnings.add(
            'This action updates existing compliance records and creates none. The parent covenant\'s Effective Date is never written: changing it in the same transaction as a status transition corrupts the compliance schedule, and that defect is open at the vendor.'
        );
        warnings.add(
            'Exception in nCino is not a synonym for a breach. The platform\'s own batch forces Exception onto any row whose due date has passed, measured or not. ' +
            'What separates a failed test from an undelivered document is Reason for Exception, which this plan writes explicitly.'
        );
        if (refused > 0) {
            warnings.add(
                String.valueOf(refused) + ' of the ' + req.assessments.size() + ' covenants assessed will NOT be written. ' +
                'Each carries its own reason in the covenants list. They are reported rather than skipped, and nothing about them is fixed.'
            );
        }
        if (planned.size() > 1) {
            warnings.add(
                'This is one plan over ' + planned.size() + ' covenants on the same package, under a single confirmation and a single decision token. ' +
                'Each covenant carries its own read, write, verification and generation-observation step, so a failure on one is reported against that covenant ' +
                'and does not silently discard the others.'
            );
        }
        if (allowNonPending) {
            warnings.add(
                'allowNonPending was set. An assessment recorded on a row that is not Pending is stored, and the covenant schedule does NOT advance: ' +
                'nCino pushes the next evaluation date only on a Pending to complete transition.'
            );
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'accountId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.valueOf(accountId) },
            'productPackageId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => packageId == null ? 'No package was named: the scope is the whole relationship.' : String.valueOf(packageId) },
            'targetId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => 'Open compliance rows resolved from the covenant scope, which is the relationship unless the caller narrowed it.' },
            'LLC_BI__Status__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'LLC_BI__Historic_Financial_Indicator__c' => new Map<String, String>{ 'prefill' => 'BANKER', 'provenance' => null, 'citation' => null },
            'Agentic_AI_Response__c' => new Map<String, String>{ 'prefill' => 'AGENT_NARRATIVE', 'provenance' => 'AGENT', 'citation' => 'Agent-drafted assessment.' }
        };

        List<String> packageNames = new List<String>();
        for (Id p : touchedPackages.keySet()) {
            packageNames.add(touchedPackages.get(p) == null ? String.valueOf(p) : touchedPackages.get(p));
        }
        packageNames.sort();

        String summary =
            'Records ' + planned.size() + (planned.size() == 1 ? ' covenant assessment' : ' covenant assessments') +
            ' on the relationship\'s covenants: ' + String.join(assessedNames, ', ') + '. ' +
            (packageNames.isEmpty()
                ? 'None of them is tied to a facility, so no product package is touched. '
                : (packageNames.size() == 1
                    ? 'They are associated with package ' + packageNames[0] + '. '
                    : 'They are associated with ' + packageNames.size() + ' packages: ' + String.join(packageNames, ', ') + '. ')) +
            (packageId == null ? '' : 'The caller narrowed the survey to one package; the associations above are what each covenant is actually tied to. ') +
            (refused > 0 ? String.valueOf(refused) + ' further assessed covenants are refused and reported with a reason each. ' : '') +
            'Each assessment updates one existing compliance record with the narrative, the observed value and the status. ' +
            'No compliance record is created by this tool, and no credit decision is made or implied.';

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('covenant-review', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'covenant-review', req.idempotencyKey, accountId, anchorPackageId, planJson, planHash
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
        r.accountId = accountId;
        r.productPackageId = anchorPackageId;
        r.covenants = toWireCovenants(scope, assessmentByCovenant, planned);
        r.assessedCount = planned.size();
        r.refusedCount = refused;
        r.scopeCount = scope.size();
        r.steps = toWireSteps(steps);
        return r;
    }

    /**
     * The relationship this plan anchors on.
     *
     * The caller's `accountId` where one was sent. Otherwise the package's own borrower, which is
     * what keeps the deployed cockpit's package-only call working without a second plan shape. When
     * BOTH arrive they must agree: a package on another relationship is refused by name rather than
     * silently anchored on one of the two, because the trail row would then claim a borrower the
     * caller never named.
     *
     * @param req The staged request.
     * @param packageId The caller's narrowing, already parsed, or null.
     * @return The anchor account.
     */
    private static Id anchorAccount(Request req, Id packageId) {
        Id said = null;
        if (String.isNotBlank(req.accountId)) {
            try {
                said = Id.valueOf(req.accountId);
            } catch (Exception e) {
                throw new ToolException('accountId ' + req.accountId + ' is not a record id.');
            }
            if (said.getSObjectType() != Account.SObjectType) {
                throw new ToolException('accountId ' + said + ' is not an account id.');
            }
        }
        if (packageId == null) {
            return said;
        }

        List<LLC_BI__Product_Package__c> pkgs = [
            SELECT Id, Name, LLC_BI__Account__c FROM LLC_BI__Product_Package__c WHERE Id = :packageId WITH USER_MODE LIMIT 1
        ];
        if (pkgs.isEmpty()) {
            throw new ToolException('Product package ' + packageId + ' was not found, or is not visible to you.');
        }
        Id owner = pkgs[0].LLC_BI__Account__c;
        if (said == null) {
            if (owner == null) {
                throw new ToolException(
                    'Product package ' + pkgs[0].Name + ' carries no account, so no relationship can be derived from it. Supply accountId.'
                );
            }
            return owner;
        }
        if (owner != said) {
            throw new ToolException(
                'Product package ' + pkgs[0].Name + ' belongs to relationship ' + owner + ', not to ' + said +
                '. A package is a narrowing WITHIN a relationship, so one that sits on another relationship narrows nothing.'
            );
        }
        return said;
    }

    /** The refusal reasons, so a wholly-refused plan says why rather than just refusing. */
    private static String firstReasons(List<C360Covenants.Resolved> scope) {
        List<String> parts = new List<String>();
        for (C360Covenants.Resolved r : scope) {
            if (r.reason != null && parts.size() < 3) {
                parts.add(r.covenantName + ': ' + r.reason);
            }
        }
        return parts.isEmpty() ? '' : String.join(parts, ' ');
    }

    private static List<PlannedCovenant> toWireCovenants(
        List<C360Covenants.Resolved> scope,
        Map<Id, Assessment> assessmentByCovenant,
        List<C360Covenants.Resolved> planned
    ) {
        Map<Id, Integer> stepIndex = new Map<Id, Integer>();
        for (Integer i = 0; i < planned.size(); i++) {
            stepIndex.put(planned[i].covenantId, i);
        }

        List<PlannedCovenant> out = new List<PlannedCovenant>();
        for (C360Covenants.Resolved r : scope) {
            PlannedCovenant p = new PlannedCovenant();
            p.covenantId = r.covenantId;
            p.covenantName = r.covenantName;
            p.covenantType = r.covenantType;
            p.attachment = r.loanLevel == true && r.relationshipLevel == true
                ? 'both'
                : (r.loanLevel == true ? 'loan' : 'relationship');
            p.covenantComplianceId = r.complianceId;
            p.currentComplianceStatus = r.complianceStatus;
            p.state = r.state;
            p.reason = r.reason;
            p.generatesNextRow = r.generatesNextRow;
            Assessment a = assessmentByCovenant.get(r.covenantId);
            p.assessedStatus = a == null ? null : a.status;
            p.associations = C360Covenants.associationsJson(r);
            if (stepIndex.containsKey(r.covenantId)) {
                String n = String.valueOf(stepIndex.get(r.covenantId));
                p.writeStepId = 'write_assessment_' + n;
                p.statusStepId = 'write_status_' + n;
                p.verifyStepId = 'verify_' + n;
                p.generationStepId = 'observe_generation_' + n;
            }
            out.add(p);
        }
        return out;
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
