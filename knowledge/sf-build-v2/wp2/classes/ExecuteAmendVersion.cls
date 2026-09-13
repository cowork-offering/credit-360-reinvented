/**
 * ExecuteAmendVersion - MCP tool: execute_amend_version.
 *
 * Runs the plan stage_amend_version staged, behind the single-use decision token. The token is
 * evidence that a named human saw a specific plan and pressed confirm (A33.5.4). It is not a credit
 * approval: this tool shapes a version nobody has approved, and that version still reaches the bank
 * through nCino's own Submit for Approval.
 *
 * ONE TRANSACTION, AND WHY THAT IS ENOUGH HERE. ExecuteLoanModification splits into two hops and
 * relays each one back into the org over REST, for two reasons that are both about nCino's credit
 * action: the hosted-MCP context cannot host the managed engine at all (UserInfo.getSessionId() is
 * unusable under a JWT token), and the engine plus the arm together blow the LLC_BI namespace's own
 * hundred-query budget. NEITHER APPLIES TO AN AMEND. No engine runs, nothing clones, no package is
 * minted: this is an ordinary update of unapproved records plus the same child authoring the
 * modification's arm performs. So it runs inline, wherever it is called from, and the whole relay is
 * absent rather than carried unused.
 *
 * THE GATE IS RE-READ, NOT ASSUMED. StageAmendVersion.gate() runs again here, before the first
 * write, against the org as it stands now. A version that climbed to Approval / Loan Committee
 * between the confirm gate and the confirm is refused with VERSION_NOT_EDITABLE and nothing is
 * written; so is a package that reached a booked member in between. Every staged target is then
 * re-checked for membership, because a facility moved to another package between stage and execute
 * is not the facility the banker confirmed.
 *
 * WHAT IT WRITES, AND WHERE. The scalars and the field wave land in ONE update per facility through
 * C360WriteGuard OP_UPDATE - the guard's allowlist already admits every one of those fields, and it
 * is the guard rather than this class that refuses a stage hop or a forbidden field. Covenants,
 * their account associations, covenant junctions, borrowing involvements, fees and collateral
 * pledges are authored exactly as ExecuteLoanModification authors them on a clone, with the
 * version's own loan standing where the clone stood.
 *
 * THE AGGREGATE SHELL IS REUSED WHERE ONE EXISTS. LLC_BI__Loan_Collateral2__c needs THREE parents
 * (LESSONS 15ac) and the aggregate lookup is not updateable afterwards, so it has to be right at
 * insert. A version loan carried its parent's pledges when the modification created it, so it
 * usually ALREADY has an aggregate; that one is reused, and a shell is minted only for a facility
 * that has none. One aggregate per loan is the org's own convention and a second would split the
 * facility's collateral rollups in two.
 *
 * NOTHING IS CLAIMED THAT WAS NOT READ BACK. Every write is proven by re-query and a step that
 * could not be proven reads filed_unverified rather than verified. The advance rate on a pledge and
 * the money on a percentage fee are the ORG'S answers - both are derived by nCino from the facility
 * itself - so they are reported as the org's rather than asserted against a figure this plan
 * supplied.
 *
 * Contract: knowledge/SPEC-0.9.23-TOOL-CONTRACT.md, frozen 2026-09-13.
 */
global with sharing class ExecuteAmendVersion {

    /** Raised for a domain-level failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    private static final String ACTION_ID = 'amend-version';

    /**
     * The org's operator picklists, keyed by the symbol the plan carries. Two fields mirror each
     * other on every covenant in this org: Financial_Indicator_Operator__c spells the words (with
     * the org's own 'Greater Tan or Equal To' typo, which is the ACTIVE picklist value and must be
     * written as-is), Acnpex_Operator__c carries the symbol.
     */
    private static final Map<String, String> FI_OPERATOR = new Map<String, String>{
        '<' => 'Less Than',
        '<=' => 'Less Than or Equal To',
        '=' => 'Equals',
        '>=' => 'Greater Tan or Equal To',
        '>' => 'Greater Than'
    };

    /** The loan field each scalar key writes. The same table StageAmendVersion reports from. */
    private static final Map<String, String> SCALAR_FIELD = new Map<String, String>{
        'requestedAmount' => 'LLC_BI__Amount__c',
        'requestedMaturityDate' => 'LLC_BI__Maturity_Date__c',
        'requestedRate' => 'LLC_BI__InterestRate__c',
        'requestedTermMonths' => 'LLC_BI__Term_Months__c'
    };

    private static final String APPROVAL_HANDOFF =
        'The version is shaped, not approved. It reaches the bank through nCino\'s own Submit for Approval with real ' +
        'approvers; nothing here has been approved and no facility on any booked package was touched.';

    global class Request {
        @InvocableVariable(label='Idempotency Key' description='The same key the stage call used. Enforced by us: a replay reports the prior result and writes nothing.' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Staging Id' required=true)
        global String stagingId;
        @InvocableVariable(label='Plan Hash' description='Binds execution to the exact plan the banker confirmed. A mismatch is refused.' required=true)
        global String planHash;
        @InvocableVariable(label='Decision Token' description='Single use. Proves a named human confirmed this plan. Not a credit approval.' required=true)
        global String decisionToken;
        @InvocableVariable(label='Approver User Id' description='Required on every execute without exception. Must be the running identity.' required=true)
        global String approverUserId;
    }

    global class StepResult {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type')
        global String type;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='State' description='pending, verified, filed_unverified, failed or skipped_not_attempted.')
        global String state;
        @InvocableVariable(label='Detail')
        global String detail;
    }

    global class ToolError {
        @InvocableVariable(label='Code' description='VERSION_NOT_EDITABLE, PACKAGE_BOOKED, NOT_A_VERSION and TARGET_NOT_IN_VERSION are the gate\'s own refusals, re-read here rather than assumed from stage time; VALIDATION_FAILED, TOKEN_REFUSED, ALLOWLIST_REFUSED, ORG_REJECTED_WRITE and READ_FAILED are the shared ones every execute_* carries.')
        global String code;
        @InvocableVariable(label='Message')
        global String message;
        @InvocableVariable(label='Org Error')
        global String orgError;
        @InvocableVariable(label='Step')
        global String step;
        @InvocableVariable(label='Resumable')
        global Boolean resumable;
        @InvocableVariable(label='Idempotency Key')
        global String idempotencyKey;
    }

    /** One member of the version this run amended, and what actually landed on it. */
    global class FacilityResult {
        @InvocableVariable(label='Facility Id' description='The version\'s own loan. There is no clone: this is the record that was written.')
        global String facilityId;
        @InvocableVariable(label='Facility Name' description='The org-assigned name, read back AFTER the write: a commitment change rewrites a loan name in this org.')
        global String facilityName;
        @InvocableVariable(label='Facility Stage')
        global String facilityStage;
        @InvocableVariable(label='Applied Changes' description='The staged figures as they read back off the facility, or why they did not.')
        global String appliedChanges;
        @InvocableVariable(label='Outcome' description='Per-facility result in banker language.')
        global String outcome;
    }

    /** One field-wave change this run applied. */
    global class FieldChangeResult {
        @InvocableVariable(label='Field')
        global String field;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='Value')
        global String value;
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One covenant this run created or associated, and the facility it landed on. */
    global class CovenantResult {
        @InvocableVariable(label='Covenant Id')
        global String covenantId;
        @InvocableVariable(label='Covenant Name' description='The org-assigned auto-number, read back.')
        global String covenantName;
        @InvocableVariable(label='Type')
        global String typeName;
        @InvocableVariable(label='Threshold')
        global Decimal threshold;
        @InvocableVariable(label='Operator')
        global String operator;
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One borrowing-structure row this run added to the version. */
    global class InvolvementResult {
        @InvocableVariable(label='Op' description='Always add. A remove on a version would be a delete and is refused at stage.')
        global String op;
        @InvocableVariable(label='Account Name')
        global String accountName;
        @InvocableVariable(label='Role')
        global String role;
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Record Id')
        global String recordId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One net-new fee this run authored on the version. */
    global class FeeResult {
        @InvocableVariable(label='Fee Id')
        global String feeId;
        @InvocableVariable(label='Fee Name' description='The org-assigned autonumber (FEE-00000n), read back. Nothing submits a fee name.')
        global String feeName;
        @InvocableVariable(label='Fee Type')
        global String feeType;
        @InvocableVariable(label='Description' description='The human label, which is where it has to live: Name on a fee is an autonumber.')
        global String description;
        @InvocableVariable(label='Calculation Type' description='Percentage or Flat Amount.')
        global String calculationType;
        @InvocableVariable(label='Percentage' description='Null on a flat fee.')
        global Decimal percentage;
        @InvocableVariable(label='Amount' description='On a PERCENTAGE fee this is what the org computed from the facility\'s commitment, not a figure anybody sent.')
        global Decimal amount;
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    /** One collateral pledge this run authored on the version, and the asset behind it. */
    global class PledgeResult {
        @InvocableVariable(label='Pledge Id')
        global String pledgeId;
        @InvocableVariable(label='Collateral Id' description='The asset. Newly created on this run where the plan said so, otherwise one the borrower already owned.')
        global String collateralId;
        @InvocableVariable(label='Collateral Name' description='The org-assigned autonumber (COL-000nnn), read back.')
        global String collateralName;
        @InvocableVariable(label='Asset Label' description='The description, which is the asset\'s only readable identity: Name is an autonumber.')
        global String assetLabel;
        @InvocableVariable(label='Created The Asset')
        global Boolean createdAsset;
        @InvocableVariable(label='Ownership Id' description='The LLC_BI__Account_Collateral__c row tying a NEW asset to the borrower. Null when the asset was already owned.')
        global String ownershipId;
        @InvocableVariable(label='Amount Pledged')
        global Decimal amountPledged;
        @InvocableVariable(label='Advance Rate' description='What the ORG resolved: the override where one was stated, the auto-applied rate, or the collateral type\'s default. A formula, never a figure anybody sent.')
        global Decimal advanceRate;
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Verification')
        global String verification;
    }

    global class ExecuteResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Product Package Id' description='The version that was amended. The action trail row carries the same id.')
        global String productPackageId;
        @InvocableVariable(label='Version Package Id')
        global String versionPackageId;
        @InvocableVariable(label='Record Name' description='The org-assigned name of the version package, read back. Null EXACTLY when the read-back failed.')
        global String recordName;
        @InvocableVariable(label='Anchor Name' description='The borrower this version belongs to.')
        global String anchorName;
        @InvocableVariable(label='Facilities' description='One entry per amended member, with what read back off it.')
        global List<FacilityResult> facilities;
        @InvocableVariable(label='Facility Count')
        global Integer facilityCount;
        @InvocableVariable(label='Field Changes')
        global List<FieldChangeResult> fieldChanges;
        @InvocableVariable(label='Covenants' description='One entry per covenant this run created or associated on the version.')
        global List<CovenantResult> covenants;
        @InvocableVariable(label='Involvements')
        global List<InvolvementResult> involvements;
        @InvocableVariable(label='Fees')
        global List<FeeResult> fees;
        @InvocableVariable(label='Pledges')
        global List<PledgeResult> pledges;
        @InvocableVariable(label='Terminal State' description='success, partial or failed.')
        global String terminalState;
        @InvocableVariable(label='Steps')
        global List<StepResult> steps;
        @InvocableVariable(label='Outcome' description='Banker-language result. Says plainly that nothing is approved.')
        global String outcome;
        @InvocableVariable(label='Approval Handoff' description='What still has to happen in nCino, by a human, for this version to be approved.')
        global String approvalHandoff;
        @InvocableVariable(label='Replayed' description='True when this idempotency key had already produced a run. Nothing was written.')
        global Boolean replayed;
    }

    global class Response {
        @InvocableVariable(label='OK')
        global Boolean ok;
        @InvocableVariable(label='Result')
        global ExecuteResult result;
        @InvocableVariable(label='Error')
        global ToolError error;
    }

    /**
     * Executes a staged amendment of an unbooked version.
     *
     * @param requests One request per execution. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='execute_amend_version'
        description='Execute a plan staged by stage_amend_version, behind the single-use decision token. Re-reads the editability gate against the org before the first write: a version that reached Approval / Loan Committee, or a package that gained a booked member, since the plan was staged is refused with nothing written. Writes the staged scalars and field changes directly onto the version\'s own loans through the write guard, and authors the staged covenants, covenant associations, borrowing involvements, fees and collateral pledges on them. No credit action runs, no clone is created and no package version is minted. Every write is verified by re-query and nothing is claimed that could not be read back. The version still requires nCino\'s Submit for Approval.'
    )
    global static List<Response> run(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = execute(req);
                res.ok = true;
            } catch (StageAmendVersion.RefusalException e) {
                res.ok = false;
                res.error = err(e.code, e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360ActionStaging.StagingException e) {
                res.ok = false;
                res.error = err('TOKEN_REFUSED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360WriteGuard.GuardException e) {
                res.ok = false;
                res.error = err('ALLOWLIST_REFUSED', e.getMessage(), null, 'apply_changes_0', false, req.idempotencyKey);
            } catch (DmlException e) {
                res.ok = false;
                res.error = err('ORG_REJECTED_WRITE', 'The org refused a write this plan depends on.', e.getMessage(), 'apply_changes_0', true, req.idempotencyKey);
            } catch (QueryException e) {
                res.ok = false;
                res.error = err('READ_FAILED', 'A record this plan depends on could not be read.', e.getMessage(), null, true, req.idempotencyKey);
            }
            out.add(res);
        }
        return out;
    }

    private static ExecuteResult execute(Request req) {
        if (String.isBlank(req.idempotencyKey)) {
            throw new ToolException('idempotencyKey is required and must match the key used at stage time.');
        }
        if (String.isBlank(req.stagingId)) {
            throw new ToolException('stagingId is required.');
        }
        if (String.isBlank(req.planHash)) {
            throw new ToolException('planHash is required.');
        }

        cm_Action_Staging__c prior = C360ActionStaging.findCompleted(req.idempotencyKey);
        if (prior != null) {
            return replay(prior);
        }

        // The action-id check runs BEFORE the claim on purpose. Consuming a single-use token and only
        // then discovering the plan belongs to another tool would burn the banker's confirmation on a
        // call that was never going to run.
        cm_Action_Staging__c staged = readStaging(req.stagingId);
        if (staged == null) {
            throw new ToolException('No staging record found for stagingId ' + req.stagingId + '.');
        }
        if (staged.cm_Action_Id__c != ACTION_ID) {
            throw new ToolException(
                'Staging record ' + req.stagingId + ' holds a ' + staged.cm_Action_Id__c + ' plan, not a version amend. ' +
                'Each execute tool runs its own action or none.'
            );
        }

        cm_Action_Staging__c stg = C360ActionStaging.claimForExecute(
            req.stagingId, req.planHash, req.decisionToken, C360Plan.asId(req.approverUserId)
        );

        List<C360Plan.Step> steps = C360Plan.deserializeSteps(stg.cm_Plan_JSON__c);
        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);

        Id packageId = C360Plan.asId(v.get('versionPackageId'));
        if (packageId == null) {
            String detail = 'The staged plan names no version package. Re-stage the action.';
            C360Plan.markRefused(steps, detail);
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw new ToolException(detail);
        }

        // THE GATE, RE-READ (A33.3.3 resume precondition). A version that climbed to approval or
        // gained a booked member since the plan was staged is refused HERE, before the first write,
        // and the refusal carries the org's own stage.
        StageAmendVersion.VersionGate g;
        try {
            g = StageAmendVersion.gate(packageId);
        } catch (StageAmendVersion.RefusalException e) {
            C360Plan.markRefused(steps, e.getMessage());
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw e;
        }
        Map<Id, LLC_BI__Loan__c> memberById = new Map<Id, LLC_BI__Loan__c>(g.members);

        Integer facilityCount = intCount(v.get('facilityCount'));
        List<Id> targets = new List<Id>();
        for (Integer i = 0; i < facilityCount; i++) {
            Id fid = C360Plan.asId(v.get('facility' + i + '.loanId'));
            if (fid == null) {
                String detail = 'The staged plan is missing facility ' + i + '. Re-stage the action.';
                C360Plan.markRefused(steps, detail);
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw new ToolException(detail);
            }
            if (!memberById.containsKey(fid)) {
                String detail = 'Facility ' + fid + ' is no longer a member of ' + g.pkg.Name +
                    ', so the plan the banker confirmed is not the plan this run would execute. Nothing was written. ' +
                    'Re-stage the action against the version as it stands now.';
                C360Plan.markRefused(steps, detail);
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw refusal('TARGET_NOT_IN_VERSION', detail);
            }
            targets.add(fid);
        }

        Id accountId = g.pkg.LLC_BI__Account__c;

        // ---- THE FIGURES LAND FIRST, one update per facility carrying its scalars AND its field
        // wave. The order matters for the same reason it matters on a modification: a commitment
        // change wakes the fee aggregate, the collateral aggregate and the exposure rollups over
        // everything already hanging off the loan, and it is cheaper before this run adds more. It
        // also means a percentage fee added below is computed by the org against the commitment the
        // banker actually asked for, first time.
        Integer scalarCount = intCount(v.get('scalarChangeCount'));
        Integer fieldCount = intCount(v.get('fieldChangeCount'));

        Map<Id, Map<String, Object>> movesByTarget = new Map<Id, Map<String, Object>>();
        for (Integer i = 0; i < scalarCount; i++) {
            Id t = C360Plan.asId(v.get('scalarChange' + i + '.targetLoanId'));
            String key = C360Plan.asString(v.get('scalarChange' + i + '.key'));
            if (t == null || key == null || !SCALAR_FIELD.containsKey(key)) {
                continue;
            }
            Object value = key == 'requestedMaturityDate'
                ? (Object) C360Plan.asDate(v.get('scalarChange' + i + '.value'))
                : (Object) C360Plan.asDecimal(v.get('scalarChange' + i + '.value'));
            moves(movesByTarget, t).put(SCALAR_FIELD.get(key), value);
        }
        for (Integer i = 0; i < fieldCount; i++) {
            Id t = C360Plan.asId(v.get('fieldChange' + i + '.targetLoanId'));
            if (t == null) {
                continue;
            }
            moves(movesByTarget, t).put(
                String.valueOf(v.get('fieldChange' + i + '.field')),
                coerceStagedFieldValue(
                    String.valueOf(v.get('fieldChange' + i + '.type')),
                    String.valueOf(v.get('fieldChange' + i + '.valueJson'))
                )
            );
        }

        List<LLC_BI__Loan__c> toUpdate = new List<LLC_BI__Loan__c>();
        for (Id t : targets) {
            Map<String, Object> writeFields = movesByTarget.containsKey(t)
                ? movesByTarget.get(t) : new Map<String, Object>();
            // The fence runs even where no figure moves: it is the single gate every domain write in
            // this package passes through, and it is what refuses a forbidden field or a stage hop
            // if this method ever grows one.
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN, C360WriteGuard.OP_UPDATE, writeFields);
            if (writeFields.isEmpty()) {
                continue;
            }
            LLC_BI__Loan__c row = new LLC_BI__Loan__c(Id = t);
            for (String f : writeFields.keySet()) {
                row.put(f, writeFields.get(f));
            }
            toUpdate.add(row);
        }
        if (!toUpdate.isEmpty()) {
            update as user toUpdate;
        }

        // ---- COVENANTS: created on the borrower, attached to the version's own loan, and
        // associated to the account the way nCino's own UI does. Probed safe 2026-08-30: a
        // Covenant2 insert plus its junction mints no compliance row, starts no approval and sends
        // no email. The unrecallable acnpex approval fires on COMPLIANCE create only.
        Integer covenantAddCount = intCount(v.get('covenantAddCount'));
        List<CovenantResult> covenantResults = new List<CovenantResult>();
        for (Integer i = 0; i < covenantAddCount; i++) {
            String cs = String.valueOf(i);
            CovenantResult cr = new CovenantResult();
            cr.typeName = C360Plan.asString(v.get('covenantAdd' + cs + '.typeName'));
            cr.threshold = C360Plan.asDecimal(v.get('covenantAdd' + cs + '.threshold'));
            cr.operator = C360Plan.asString(v.get('covenantAdd' + cs + '.operator'));
            covenantResults.add(cr);

            Id typeId = C360Plan.asId(v.get('covenantAdd' + cs + '.typeId'));
            Id target = C360Plan.asId(v.get('covenantAdd' + cs + '.targetLoanId'));
            if (target == null || !memberById.containsKey(target) || typeId == null || cr.threshold == null) {
                String why = target == null || !memberById.containsKey(target)
                    ? 'The facility this covenant targets is not on the version any more, so the covenant was not created.'
                    : 'The staged covenant add is incomplete (type or threshold missing), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_create_' + cs, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'covenant_attach_' + cs, C360Plan.STATE_SKIPPED, null);
                C360Plan.setState(steps, 'covenant_verify_' + cs, C360Plan.STATE_FAILED, why);
                cr.verification = why;
                continue;
            }
            cr.facilityId = target;

            Map<String, Object> covFields = new Map<String, Object>{
                'LLC_BI__Account__c' => accountId,
                'LLC_BI__Covenant_Type__c' => typeId,
                'LLC_BI__Financial_Indicator_Value__c' => cr.threshold,
                'Acnpex_Threshold_Value__c' => cr.threshold,
                'Financial_Indicator_Operator__c' => FI_OPERATOR.get(cr.operator),
                'Acnpex_Operator__c' => cr.operator,
                'LLC_BI__Frequency__c' => C360Plan.asString(v.get('covenantAdd' + cs + '.frequency')),
                'LLC_BI__Effective_Date__c' => C360Plan.asDate(v.get('covenantAdd' + cs + '.effectiveDate')),
                'LLC_BI__Covenant_Status__c' => 'Pending',
                'LLC_BI__Active__c' => 'true'
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COVENANT, C360WriteGuard.OP_CREATE, covFields);
            LLC_BI__Covenant2__c cov = new LLC_BI__Covenant2__c(
                LLC_BI__Account__c = accountId,
                LLC_BI__Covenant_Type__c = typeId,
                LLC_BI__Financial_Indicator_Value__c = cr.threshold,
                Acnpex_Threshold_Value__c = cr.threshold,
                Financial_Indicator_Operator__c = FI_OPERATOR.get(cr.operator),
                Acnpex_Operator__c = cr.operator,
                LLC_BI__Frequency__c = (String) covFields.get('LLC_BI__Frequency__c'),
                LLC_BI__Effective_Date__c = (Date) covFields.get('LLC_BI__Effective_Date__c'),
                LLC_BI__Covenant_Status__c = 'Pending',
                LLC_BI__Active__c = true
            );
            insert as user cov;
            C360Plan.setState(steps, 'covenant_create_' + cs, C360Plan.STATE_VERIFIED,
                'Covenant ' + cov.Id + ' created: ' + cr.typeName + ' ' + cr.operator + ' ' + String.valueOf(cr.threshold) + '.');

            Map<String, Object> attachFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => target,
                'LLC_BI__Covenant2__c' => cov.Id
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE, attachFields);
            LLC_BI__Loan_Covenant__c attach = new LLC_BI__Loan_Covenant__c(
                LLC_BI__Loan__c = target,
                LLC_BI__Covenant2__c = cov.Id
            );
            insert as user attach;

            Map<String, Object> acctCovFields = new Map<String, Object>{
                'LLC_BI__Covenant2__c' => cov.Id,
                'LLC_BI__Account__c' => accountId
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COVENANT, C360WriteGuard.OP_CREATE, acctCovFields);
            LLC_BI__Account_Covenant__c acctCov = new LLC_BI__Account_Covenant__c(
                LLC_BI__Covenant2__c = cov.Id,
                LLC_BI__Account__c = accountId
            );
            insert as user acctCov;
            C360Plan.setState(steps, 'covenant_attach_' + cs, C360Plan.STATE_VERIFIED,
                'Junction ' + attach.Id + ' attaches it to ' + memberById.get(target).Name +
                '; account association ' + acctCov.Id + ' anchors it on the borrower.');

            // The proof is the re-read, never the insert result.
            List<LLC_BI__Covenant2__c> covBack = [
                SELECT Id, Name, LLC_BI__Financial_Indicator_Value__c, LLC_BI__Covenant_Status__c
                FROM LLC_BI__Covenant2__c WHERE Id = :cov.Id WITH USER_MODE LIMIT 1
            ];
            Integer attachBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :target AND LLC_BI__Covenant2__c = :cov.Id
                WITH USER_MODE
            ];
            Integer acctBack = [
                SELECT COUNT() FROM LLC_BI__Account_Covenant__c
                WHERE LLC_BI__Account__c = :accountId AND LLC_BI__Covenant2__c = :cov.Id
                WITH USER_MODE
            ];
            Boolean proven = !covBack.isEmpty()
                && covBack[0].LLC_BI__Financial_Indicator_Value__c == cr.threshold
                && attachBack == 1
                && acctBack == 1;
            cr.covenantId = cov.Id;
            cr.covenantName = covBack.isEmpty() ? null : covBack[0].Name;
            cr.verification = covBack.isEmpty()
                ? 'The covenant could not be read back after creation.'
                : 'Covenant ' + covBack[0].Name + ' reads back at ' + String.valueOf(covBack[0].LLC_BI__Financial_Indicator_Value__c) +
                  ', status ' + covBack[0].LLC_BI__Covenant_Status__c + ', with ' + attachBack + ' junction on ' +
                  memberById.get(target).Name + ' and ' + acctBack + ' account association on the borrower.';
            C360Plan.setState(steps, 'covenant_verify_' + cs,
                proven ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, cr.verification);
        }

        // ---- COVENANT ASSOCIATIONS: a junction-only create for a covenant the borrower ALREADY
        // holds. No LLC_BI__Covenant2__c is inserted, nothing is amended and nothing is deleted. The
        // account association is minted only where the covenant does not already carry one.
        Integer covenantAttachCount = intCount(v.get('covenantAttachCount'));
        for (Integer i = 0; i < covenantAttachCount; i++) {
            String ats = String.valueOf(i);
            CovenantResult ar = new CovenantResult();
            ar.covenantId = C360Plan.asString(v.get('covenantAttach' + ats + '.covenantId'));
            ar.covenantName = C360Plan.asString(v.get('covenantAttach' + ats + '.covenantName'));
            ar.typeName = C360Plan.asString(v.get('covenantAttach' + ats + '.typeName'));
            ar.threshold = C360Plan.asDecimal(v.get('covenantAttach' + ats + '.threshold'));
            ar.operator = C360Plan.asString(v.get('covenantAttach' + ats + '.operator'));
            covenantResults.add(ar);

            Id covenantId = C360Plan.asId(v.get('covenantAttach' + ats + '.covenantId'));
            Id target = C360Plan.asId(v.get('covenantAttach' + ats + '.targetLoanId'));
            if (target == null || !memberById.containsKey(target) || covenantId == null) {
                String why = target == null || !memberById.containsKey(target)
                    ? 'The facility this association targets is not on the version any more, so the junction was not created.'
                    : 'The staged association is incomplete (no resolved covenant), so nothing was created. Re-stage the action.';
                C360Plan.setState(steps, 'covenant_associate_' + ats, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'covenant_associate_verify_' + ats, C360Plan.STATE_FAILED, why);
                ar.verification = why;
                continue;
            }
            ar.facilityId = target;

            Map<String, Object> associateFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => target,
                'LLC_BI__Covenant2__c' => covenantId
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_LOAN_COVENANT, C360WriteGuard.OP_CREATE, associateFields);
            LLC_BI__Loan_Covenant__c associate = new LLC_BI__Loan_Covenant__c(
                LLC_BI__Loan__c = target,
                LLC_BI__Covenant2__c = covenantId
            );
            insert as user associate;

            Integer acctCovExisting = [
                SELECT COUNT() FROM LLC_BI__Account_Covenant__c
                WHERE LLC_BI__Account__c = :accountId AND LLC_BI__Covenant2__c = :covenantId
                WITH USER_MODE
            ];
            if (acctCovExisting == 0) {
                Map<String, Object> assocAcctFields = new Map<String, Object>{
                    'LLC_BI__Covenant2__c' => covenantId,
                    'LLC_BI__Account__c' => accountId
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_ACCOUNT_COVENANT, C360WriteGuard.OP_CREATE, assocAcctFields);
                insert as user new LLC_BI__Account_Covenant__c(
                    LLC_BI__Covenant2__c = covenantId,
                    LLC_BI__Account__c = accountId
                );
            }
            C360Plan.setState(steps, 'covenant_associate_' + ats, C360Plan.STATE_VERIFIED,
                'Junction ' + associate.Id + ' associates ' + ar.covenantName + ' to ' + memberById.get(target).Name +
                (acctCovExisting == 0 ? '; the account association was minted beside it.' : '; the covenant already carried its account association.'));

            Integer attachedBack = [
                SELECT COUNT() FROM LLC_BI__Loan_Covenant__c
                WHERE LLC_BI__Loan__c = :target AND LLC_BI__Covenant2__c = :covenantId
                WITH USER_MODE
            ];
            ar.verification = attachedBack == 1
                ? ar.covenantName + ' reads back on ' + memberById.get(target).Name + ', once, with the covenant record unchanged.'
                : 'Not proven: the facility reads ' + attachedBack + ' junctions for this covenant.';
            C360Plan.setState(steps, 'covenant_associate_verify_' + ats,
                attachedBack == 1 ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, ar.verification);
        }

        // ---- BORROWING STRUCTURE: adds only. A remove on a version would be a real delete rather
        // than the carry exclusion a modification can express, and stage refuses one by name.
        Integer involvementCount = intCount(v.get('involvementChangeCount'));
        List<InvolvementResult> involvementResults = new List<InvolvementResult>();
        for (Integer i = 0; i < involvementCount; i++) {
            String vs = String.valueOf(i);
            InvolvementResult ir = new InvolvementResult();
            ir.op = C360Plan.asString(v.get('involvement' + vs + '.op'));
            ir.role = C360Plan.asString(v.get('involvement' + vs + '.role'));
            ir.accountName = C360Plan.asString(v.get('involvement' + vs + '.accountName'));
            involvementResults.add(ir);

            Id involvedAccountId = C360Plan.asId(v.get('involvement' + vs + '.accountId'));
            Decimal ownership = C360Plan.asDecimal(v.get('involvement' + vs + '.ownership'));
            Id target = C360Plan.asId(v.get('involvement' + vs + '.targetLoanId'));
            if (target == null || !memberById.containsKey(target) || involvedAccountId == null || ir.op != 'add') {
                String why = target == null || !memberById.containsKey(target)
                    ? 'The facility this change targets is not on the version any more, so nothing was done.'
                    : 'The staged change is incomplete or is not an add, so nothing was done. Re-stage the action.';
                C360Plan.setState(steps, 'involvement_change_' + vs, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'involvement_verify_' + vs, C360Plan.STATE_FAILED, why);
                ir.verification = why;
                continue;
            }
            ir.facilityId = target;

            Map<String, Object> invFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => target,
                'LLC_BI__Product_Package__c' => packageId,
                'LLC_BI__Account__c' => involvedAccountId,
                'LLC_BI__Borrower_Type__c' => ir.role,
                'LLC_BI__Ownership__c' => ownership
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_INVOLVEMENT, C360WriteGuard.OP_CREATE, invFields);
            LLC_BI__Legal_Entities__c row = new LLC_BI__Legal_Entities__c(
                LLC_BI__Loan__c = target,
                LLC_BI__Product_Package__c = packageId,
                LLC_BI__Account__c = involvedAccountId,
                LLC_BI__Borrower_Type__c = ir.role,
                LLC_BI__Ownership__c = ownership
            );
            insert as user row;
            ir.recordId = row.Id;
            C360Plan.setState(steps, 'involvement_change_' + vs, C360Plan.STATE_VERIFIED,
                'Involvement ' + row.Id + ' created: ' + ir.accountName + ' as ' + ir.role + ' on ' +
                memberById.get(target).Name + '.');

            Integer back = [
                SELECT COUNT() FROM LLC_BI__Legal_Entities__c
                WHERE LLC_BI__Loan__c = :target AND LLC_BI__Account__c = :involvedAccountId
                      AND LLC_BI__Borrower_Type__c = :ir.role
                WITH USER_MODE
            ];
            ir.verification = back >= 1
                ? ir.accountName + ' reads back as ' + ir.role + ' on ' + memberById.get(target).Name + '.'
                : 'The involvement did not read back on the facility after creation.';
            C360Plan.setState(steps, 'involvement_verify_' + vs,
                back >= 1 ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, ir.verification);
        }

        // ---- FEES. ONE DML for the whole plan: a fee insert wakes nCino's fee aggregate and the
        // financed-fee calculation, which spend the LLC_BI namespace's query budget rather than
        // ours, and that automation is bulkified.
        Integer feeAddCount = intCount(v.get('feeAddCount'));
        List<FeeResult> feeResults = new List<FeeResult>();
        List<LLC_BI__Fee__c> feeRows = new List<LLC_BI__Fee__c>();
        List<Integer> feeIndexOfRow = new List<Integer>();
        for (Integer i = 0; i < feeAddCount; i++) {
            String fs = String.valueOf(i);
            FeeResult fr = new FeeResult();
            fr.feeType = C360Plan.asString(v.get('feeAdd' + fs + '.feeType'));
            fr.description = C360Plan.asString(v.get('feeAdd' + fs + '.description'));
            fr.calculationType = C360Plan.asString(v.get('feeAdd' + fs + '.calculationType'));
            fr.percentage = C360Plan.asDecimal(v.get('feeAdd' + fs + '.percentage'));
            feeResults.add(fr);

            Id target = C360Plan.asId(v.get('feeAdd' + fs + '.targetLoanId'));
            if (target == null || !memberById.containsKey(target)) {
                String why = 'The facility this fee targets is not on the version any more, so the fee was not created.';
                C360Plan.setState(steps, 'fee_add_' + fs, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'fee_verify_' + fs, C360Plan.STATE_FAILED, why);
                fr.verification = why;
                continue;
            }
            fr.facilityId = target;

            String recordType = C360Plan.asString(v.get('feeAdd' + fs + '.recordType'));
            String status = C360Plan.asString(v.get('feeAdd' + fs + '.status'));
            String paidBy = C360Plan.asString(v.get('feeAdd' + fs + '.paidBy'));
            String basisSource = C360Plan.asString(v.get('feeAdd' + fs + '.basisSource'));
            Boolean isIncome = v.get('feeAdd' + fs + '.isIncome') == true;
            // A PERCENTAGE fee carries its rate and its basis and NO amount: the org derives the
            // money. Stage refuses an amount on one, so nothing here has to choose between two.
            Decimal amount = C360Plan.asDecimal(v.get('feeAdd' + fs + '.amount'));

            Map<String, Object> feeFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => target,
                'LLC_BI__Record_Type__c' => recordType,
                'LLC_BI__Fee_Type__c' => fr.feeType,
                'LLC_BI__Fee_Type_Description__c' => fr.description,
                'LLC_BI__Calculation_Type__c' => fr.calculationType,
                'LLC_BI__Basis_Source__c' => basisSource,
                'LLC_BI__Percentage__c' => fr.percentage,
                'LLC_BI__Amount__c' => amount,
                'LLC_BI__Status__c' => status,
                'LLC_BI__Paid_By__c' => paidBy,
                'LLC_BI__Is_Income__c' => isIncome
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_FEE, C360WriteGuard.OP_CREATE, feeFields);
            feeRows.add(new LLC_BI__Fee__c(
                LLC_BI__Loan__c = target,
                LLC_BI__Record_Type__c = recordType,
                LLC_BI__Fee_Type__c = fr.feeType,
                LLC_BI__Fee_Type_Description__c = fr.description,
                LLC_BI__Calculation_Type__c = fr.calculationType,
                LLC_BI__Basis_Source__c = basisSource,
                LLC_BI__Percentage__c = fr.percentage,
                LLC_BI__Amount__c = amount,
                LLC_BI__Status__c = status,
                LLC_BI__Paid_By__c = paidBy,
                LLC_BI__Is_Income__c = isIncome
            ));
            feeIndexOfRow.add(i);
        }
        if (!feeRows.isEmpty()) {
            insert as user feeRows;
        }
        verifyFees(steps, feeResults, feeRows, feeIndexOfRow, memberById);

        // ---- COLLATERAL. The asset and its ownership junction are two DMLs of their own, bulked
        // across the plan: a pledge needs the collateral's id, and nothing else here creates one.
        // Each of those objects carries an org-local change-stream trigger that enqueues a callout
        // per DML, against a ceiling of 50 queued jobs, which is why stage caps the plan at five.
        Integer pledgeAddCount = intCount(v.get('pledgeAddCount'));
        List<PledgeResult> pledgeResults = new List<PledgeResult>();
        List<LLC_BI__Loan_Collateral2__c> pledgeRows = new List<LLC_BI__Loan_Collateral2__c>();
        List<Integer> pledgeIndexOfRow = new List<Integer>();
        if (pledgeAddCount > 0) {
            composeCollateralChain(steps, v, accountId, memberById, pledgeAddCount, pledgeResults, pledgeRows, pledgeIndexOfRow);
            if (!pledgeRows.isEmpty()) {
                insert as user pledgeRows;
            }
            verifyPledges(steps, pledgeResults, pledgeRows, pledgeIndexOfRow);
        }

        // ---- THE READ-BACK. One query over the facilities this run touched, covering the scalars
        // and every field the wave moved, and the proof of both.
        Set<String> readFields = new Set<String>{
            'Id', 'Name', 'LLC_BI__Stage__c', 'LLC_BI__Amount__c', 'LLC_BI__InterestRate__c',
            'LLC_BI__Term_Months__c', 'LLC_BI__Maturity_Date__c'
        };
        for (Integer i = 0; i < fieldCount; i++) {
            readFields.add(String.valueOf(v.get('fieldChange' + i + '.field')));
        }
        Map<Id, SObject> after = new Map<Id, SObject>();
        if (!targets.isEmpty()) {
            Set<Id> targetSet = new Set<Id>(targets);
            String q = 'SELECT ' + String.join(new List<String>(readFields), ', ') +
                ' FROM LLC_BI__Loan__c WHERE Id IN :targetSet WITH USER_MODE';
            for (SObject row : Database.query(q)) {
                after.put((Id) row.get('Id'), row);
            }
        }

        List<FieldChangeResult> fieldChangeResults = new List<FieldChangeResult>();
        for (Integer i = 0; i < fieldCount; i++) {
            String fi = String.valueOf(i);
            FieldChangeResult fcr = new FieldChangeResult();
            fcr.field = C360Plan.asString(v.get('fieldChange' + fi + '.field'));
            fcr.label = C360Plan.asString(v.get('fieldChange' + fi + '.label'));
            Object expected = coerceStagedFieldValue(
                String.valueOf(v.get('fieldChange' + fi + '.type')),
                String.valueOf(v.get('fieldChange' + fi + '.valueJson'))
            );
            fcr.value = String.valueOf(expected);
            Id target = C360Plan.asId(v.get('fieldChange' + fi + '.targetLoanId'));
            fieldChangeResults.add(fcr);
            if (target == null || !after.containsKey(target)) {
                fcr.verification = 'No facility on the version could be read back for the target of this change.';
                C360Plan.setState(steps, 'field_change_' + fi, C360Plan.STATE_FAILED, fcr.verification);
                continue;
            }
            fcr.facilityId = target;
            Object actual = after.get(target).get(fcr.field);
            Boolean landed = actual == expected || String.valueOf(actual) == String.valueOf(expected);
            fcr.verification = landed
                ? fcr.label + ' reads back at ' + String.valueOf(actual) + ' on the version.'
                : fcr.label + ' did not land: staged ' + String.valueOf(expected) + ', reads back ' + String.valueOf(actual) + '.';
            C360Plan.setState(steps, 'field_change_' + fi,
                landed ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, fcr.verification);
        }

        List<FacilityResult> facilityResults = new List<FacilityResult>();
        for (Integer i = 0; i < targets.size(); i++) {
            String s = String.valueOf(i);
            Id t = targets[i];
            FacilityResult fr = new FacilityResult();
            fr.facilityId = t;
            facilityResults.add(fr);

            SObject back = after.get(t);
            if (back == null) {
                fr.facilityName = memberById.get(t).Name;
                fr.appliedChanges = 'The facility could not be read back after the changes were written, so nothing is claimed for it.';
                C360Plan.setState(steps, 'apply_changes_' + s, C360Plan.STATE_FAILED, fr.appliedChanges);
                C360Plan.setState(steps, 'verify_apply_' + s, C360Plan.STATE_FAILED, fr.appliedChanges);
                fr.outcome = fr.appliedChanges;
                continue;
            }
            // The org rewrites a loan's name from its commitment, so this is re-read rather than
            // carried over from the gate's pre-change read.
            fr.facilityName = String.valueOf(back.get('Name'));
            fr.facilityStage = String.valueOf(back.get('LLC_BI__Stage__c'));
            fr.appliedChanges = applied(back, movesByTarget.get(t));
            Boolean everythingLanded = !fr.appliedChanges.contains('did not land');
            C360Plan.setState(steps, 'apply_changes_' + s,
                everythingLanded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, fr.appliedChanges);
            C360Plan.setState(steps, 'verify_apply_' + s,
                everythingLanded ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED,
                fr.facilityName + ' was re-read after the write. ' + fr.appliedChanges);
            fr.outcome = fr.facilityName + ' amended in place on ' + g.pkg.Name + ' at stage ' + fr.facilityStage +
                '. ' + fr.appliedChanges + ' No booked facility was touched.';
        }

        C360Plan.setState(steps, 'observe_side_effects', C360Plan.STATE_VERIFIED,
            'The org\'s own loan automation ran on these updates. Nothing here polled it and nothing here claims what it did.');

        String terminal = C360Plan.terminalState(steps);
        C360ActionStaging.recordOutcome(stg, steps, terminal, String.valueOf(packageId));

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.productPackageId = packageId;
        out.versionPackageId = packageId;
        out.recordName = g.pkg.Name;
        out.anchorName = g.pkg.LLC_BI__Account__r == null ? null : g.pkg.LLC_BI__Account__r.Name;
        out.facilities = facilityResults;
        out.facilityCount = facilityResults.size();
        out.fieldChanges = fieldChangeResults;
        out.covenants = covenantResults;
        out.involvements = involvementResults;
        out.fees = feeResults;
        out.pledges = pledgeResults;
        out.terminalState = terminal;
        out.steps = toWireSteps(steps);
        out.replayed = false;
        out.approvalHandoff = APPROVAL_HANDOFF;
        out.outcome = outcomeSentence(g, facilityResults, fieldChangeResults, covenantResults,
            involvementResults, feeResults, pledgeResults);
        return out;
    }

    // -----------------------------------------------------------------------------------------
    // The collateral chain, and the two verifications that prove what the org derived.
    // -----------------------------------------------------------------------------------------

    /**
     * Authors every staged asset and ownership junction and composes the pledge rows.
     *
     * THE ORDER IS THE MODEL'S, not a preference. `LLC_BI__Collateral__c` carries no account lookup
     * of any kind on this org, so an asset created without its `LLC_BI__Account_Collateral__c` row
     * belongs to nobody and cannot be found from the relationship at all.
     *
     * THE AGGREGATE IS THE FACILITY'S OWN. `LLC_BI__Loan_Collateral2__c` needs three parents
     * (LESSONS 15ac) and the aggregate lookup is not updateable afterwards, so it is settled before
     * the pledge is composed: the aggregate the facility's existing pledges already hang off where
     * there is one, a freshly minted shell where there is not. One per loan is the org's convention.
     *
     * @param pledgeRows Filled with the composed pledges, in insert order.
     * @param indexOfRow Which `results` entry each composed pledge belongs to.
     */
    private static void composeCollateralChain(
        List<C360Plan.Step> steps,
        Map<String, Object> v,
        Id accountId,
        Map<Id, LLC_BI__Loan__c> memberById,
        Integer pledgeAddCount,
        List<PledgeResult> results,
        List<LLC_BI__Loan_Collateral2__c> pledgeRows,
        List<Integer> indexOfRow
    ) {
        List<LLC_BI__Collateral__c> newAssets = new List<LLC_BI__Collateral__c>();
        List<Integer> assetIndexOfRow = new List<Integer>();
        List<Id> targetOf = new List<Id>();

        for (Integer i = 0; i < pledgeAddCount; i++) {
            String ps = String.valueOf(i);
            PledgeResult pr = new PledgeResult();
            pr.assetLabel = C360Plan.asString(v.get('pledgeAdd' + ps + '.assetLabel'));
            pr.createdAsset = v.get('pledgeAdd' + ps + '.isNew') == true;
            pr.amountPledged = C360Plan.asDecimal(v.get('pledgeAdd' + ps + '.amountPledged'));
            results.add(pr);
            targetOf.add(null);

            Id target = C360Plan.asId(v.get('pledgeAdd' + ps + '.targetLoanId'));
            if (target == null || !memberById.containsKey(target)) {
                String why = 'The facility this pledge targets is not on the version any more, so nothing was created.';
                C360Plan.setState(steps, 'collateral_create_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'collateral_own_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'pledge_add_' + ps, C360Plan.STATE_FAILED, why);
                C360Plan.setState(steps, 'pledge_verify_' + ps, C360Plan.STATE_FAILED, why);
                pr.verification = why;
                continue;
            }
            pr.facilityId = target;
            targetOf[i] = target;

            if (pr.createdAsset) {
                Map<String, Object> assetFields = new Map<String, Object>{
                    'LLC_BI__Collateral_Type__c' => C360Plan.asId(v.get('pledgeAdd' + ps + '.collateralTypeId')),
                    'LLC_BI__Value__c' => C360Plan.asDecimal(v.get('pledgeAdd' + ps + '.newValue')),
                    'LLC_BI__Description__c' => C360Plan.asString(v.get('pledgeAdd' + ps + '.description'))
                };
                C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_COLLATERAL, C360WriteGuard.OP_CREATE, assetFields);
                newAssets.add(new LLC_BI__Collateral__c(
                    LLC_BI__Collateral_Type__c = (Id) assetFields.get('LLC_BI__Collateral_Type__c'),
                    LLC_BI__Value__c = (Decimal) assetFields.get('LLC_BI__Value__c'),
                    LLC_BI__Description__c = (String) assetFields.get('LLC_BI__Description__c')
                ));
                assetIndexOfRow.add(i);
            } else {
                pr.collateralId = C360Plan.asString(v.get('pledgeAdd' + ps + '.collateralId'));
            }
        }

        if (!newAssets.isEmpty()) {
            insert as user newAssets;
            List<LLC_BI__Account_Collateral__c> ownerships = new List<LLC_BI__Account_Collateral__c>();
            for (Integer k = 0; k < newAssets.size(); k++) {
                Integer i = assetIndexOfRow[k];
                results[i].collateralId = newAssets[k].Id;
                C360Plan.setState(steps, 'collateral_create_' + i, C360Plan.STATE_VERIFIED,
                    'Asset created for "' + results[i].assetLabel + '".');
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
                Integer i = assetIndexOfRow[k];
                results[i].ownershipId = ownerships[k].Id;
                C360Plan.setState(steps, 'collateral_own_' + i, C360Plan.STATE_VERIFIED,
                    'The borrower is recorded as sole owner of "' + results[i].assetLabel + '".');
            }
        }

        // The aggregate per facility: reused where the version loan already carries one, minted
        // where it does not. The lookup is not updateable after insert, so this cannot be deferred.
        Set<Id> pledgeTargets = new Set<Id>();
        for (Id t : targetOf) {
            if (t != null) {
                pledgeTargets.add(t);
            }
        }
        Map<Id, Id> aggByFacility = new Map<Id, Id>();
        if (!pledgeTargets.isEmpty()) {
            for (LLC_BI__Loan_Collateral2__c existing : [
                SELECT LLC_BI__Loan__c, LLC_BI__Loan_Collateral_Aggregate__c
                FROM LLC_BI__Loan_Collateral2__c
                WHERE LLC_BI__Loan__c IN :pledgeTargets AND LLC_BI__Loan_Collateral_Aggregate__c != NULL
                WITH USER_MODE
            ]) {
                aggByFacility.put(existing.LLC_BI__Loan__c, existing.LLC_BI__Loan_Collateral_Aggregate__c);
            }
        }
        Map<Id, LLC_BI__Loan_Collateral_Aggregate__c> minted = new Map<Id, LLC_BI__Loan_Collateral_Aggregate__c>();
        for (Id t : pledgeTargets) {
            if (!aggByFacility.containsKey(t)) {
                minted.put(t, new LLC_BI__Loan_Collateral_Aggregate__c(Name = 'Collateral Aggregate'));
            }
        }
        if (!minted.isEmpty()) {
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE_AGGREGATE, C360WriteGuard.OP_CARRY,
                new Map<String, Object>{ 'Name' => null });
            insert as user minted.values();
            for (Id t : minted.keySet()) {
                aggByFacility.put(t, minted.get(t).Id);
            }
        }

        for (Integer i = 0; i < pledgeAddCount; i++) {
            String ps = String.valueOf(i);
            PledgeResult pr = results[i];
            if (targetOf[i] == null || pr.collateralId == null) {
                continue;
            }
            Decimal rateOverride = C360Plan.asDecimal(v.get('pledgeAdd' + ps + '.advanceRate'));
            String overrideReason = C360Plan.asString(v.get('pledgeAdd' + ps + '.advanceRateReason'));
            String lien = C360Plan.asString(v.get('pledgeAdd' + ps + '.lienPosition'));
            Boolean authorise = C360Plan.asBool(v.get('pledgeAdd' + ps + '.authoriseOverPledge'));
            Id collId = C360Plan.asId(pr.collateralId);
            Map<String, Object> pledgeFields = new Map<String, Object>{
                'LLC_BI__Loan__c' => targetOf[i],
                'LLC_BI__Collateral__c' => collId,
                'LLC_BI__Pledged_Status__c' => C360Plan.asString(v.get('pledgeAdd' + ps + '.pledgedStatus')),
                'LLC_BI__Active__c' => true,
                'LLC_BI__Amount_Pledged__c' => pr.amountPledged,
                'LLC_BI__Lien_Position__c' => lien,
                'LLC_BI__Advance_Rate_Override__c' => rateOverride,
                'LLC_BI__Override_Reason__c' => overrideReason,
                'LLC_BI__Authorize__c' => authorise
            };
            C360WriteGuard.assertAllowed(C360WriteGuard.OBJ_PLEDGE, C360WriteGuard.OP_CREATE, pledgeFields);
            pledgeRows.add(new LLC_BI__Loan_Collateral2__c(
                LLC_BI__Loan__c = targetOf[i],
                LLC_BI__Collateral__c = collId,
                LLC_BI__Loan_Collateral_Aggregate__c = aggByFacility.get(targetOf[i]),
                LLC_BI__Pledged_Status__c = C360Plan.asString(v.get('pledgeAdd' + ps + '.pledgedStatus')),
                LLC_BI__Active__c = true,
                LLC_BI__Amount_Pledged__c = pr.amountPledged,
                LLC_BI__Lien_Position__c = lien,
                LLC_BI__Advance_Rate_Override__c = rateOverride,
                LLC_BI__Override_Reason__c = overrideReason,
                LLC_BI__Authorize__c = authorise
            ));
            indexOfRow.add(i);
        }
    }

    /**
     * Re-reads the net-new fees and settles their two steps each.
     *
     * On a PERCENTAGE fee the money is the ORG'S answer - Basis_Amount and Amount are derived by
     * nCino's FeeTrigger from the facility's own commitment - so it is REPORTED rather than
     * asserted against a figure nobody staged. On a flat fee the amount is ours and is compared.
     */
    private static void verifyFees(
        List<C360Plan.Step> steps,
        List<FeeResult> results,
        List<LLC_BI__Fee__c> rows,
        List<Integer> indexOfRow,
        Map<Id, LLC_BI__Loan__c> memberById
    ) {
        if (rows.isEmpty()) {
            return;
        }
        Set<Id> feeIds = new Set<Id>();
        for (LLC_BI__Fee__c f : rows) {
            if (f.Id != null) {
                feeIds.add(f.Id);
            }
        }
        Map<Id, LLC_BI__Fee__c> back = new Map<Id, LLC_BI__Fee__c>([
            SELECT Id, Name, LLC_BI__Loan__c, LLC_BI__Fee_Type__c, LLC_BI__Fee_Type_Description__c,
                   LLC_BI__Calculation_Type__c, LLC_BI__Percentage__c, LLC_BI__Basis_Amount__c, LLC_BI__Amount__c
            FROM LLC_BI__Fee__c WHERE Id IN :feeIds WITH USER_MODE
        ]);

        for (Integer k = 0; k < rows.size(); k++) {
            String fs = String.valueOf(indexOfRow[k]);
            FeeResult fr = results[indexOfRow[k]];
            LLC_BI__Fee__c row = rows[k].Id == null ? null : back.get(rows[k].Id);
            if (row == null) {
                fr.verification = 'The fee could not be read back after creation, so nothing is claimed for it.';
                C360Plan.setState(steps, 'fee_add_' + fs, C360Plan.STATE_FILED_UNVERIFIED, fr.verification);
                C360Plan.setState(steps, 'fee_verify_' + fs, C360Plan.STATE_FAILED, fr.verification);
                continue;
            }
            fr.feeId = row.Id;
            fr.feeName = row.Name;
            fr.amount = row.LLC_BI__Amount__c;
            String onWhat = memberById.containsKey(row.LLC_BI__Loan__c)
                ? memberById.get(row.LLC_BI__Loan__c).Name : String.valueOf(row.LLC_BI__Loan__c);
            C360Plan.setState(steps, 'fee_add_' + fs, C360Plan.STATE_VERIFIED,
                'Fee ' + row.Name + ' created on ' + onWhat + ': ' + fr.description + '.');

            Boolean flat = fr.calculationType != 'Percentage';
            Boolean landed = row.LLC_BI__Fee_Type__c == fr.feeType
                && row.LLC_BI__Fee_Type_Description__c == fr.description
                && row.LLC_BI__Calculation_Type__c == fr.calculationType
                && (flat ? row.LLC_BI__Amount__c == rows[k].LLC_BI__Amount__c : row.LLC_BI__Percentage__c == fr.percentage);
            fr.verification = flat
                ? (landed
                    ? 'Fee ' + row.Name + ' reads back as ' + fr.feeType + ' at ' + String.valueOf(row.LLC_BI__Amount__c) + ' flat on ' + onWhat + '.'
                    : 'Not proven: the fee reads back as ' + row.LLC_BI__Fee_Type__c + ' at ' +
                      String.valueOf(row.LLC_BI__Amount__c) + ', not ' + fr.feeType + ' at ' + String.valueOf(rows[k].LLC_BI__Amount__c) + '.')
                : (landed
                    ? 'Fee ' + row.Name + ' reads back as ' + fr.feeType + ' at ' + String.valueOf(fr.percentage) +
                      '%, and the org computed ' +
                      (row.LLC_BI__Amount__c == null
                          ? 'no amount yet: nCino\'s own fee calculation owns that figure and had not settled it when this was read'
                          : String.valueOf(row.LLC_BI__Amount__c) + ' against a basis of ' + String.valueOf(row.LLC_BI__Basis_Amount__c)) + '.'
                    : 'Not proven: the fee reads back as ' + row.LLC_BI__Fee_Type__c + ' rather than ' + fr.feeType + '.');
            C360Plan.setState(steps, 'fee_verify_' + fs,
                landed ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, fr.verification);
        }
    }

    /**
     * Re-reads the pledges and settles their steps.
     *
     * The ADVANCE RATE is not compared against anything: `LLC_BI__Advance_Rate__c` is a formula
     * resolving the override, then the auto-applied value, then the collateral type's default
     * (LESSONS 29), so it is the org's answer and it is REPORTED as the org's. What is compared is
     * what was ours: the loan, the collateral and the pledged amount.
     */
    private static void verifyPledges(
        List<C360Plan.Step> steps,
        List<PledgeResult> results,
        List<LLC_BI__Loan_Collateral2__c> rows,
        List<Integer> indexOfRow
    ) {
        if (rows.isEmpty()) {
            return;
        }
        Set<Id> pledgeIds = new Set<Id>();
        for (LLC_BI__Loan_Collateral2__c p : rows) {
            if (p.Id != null) {
                pledgeIds.add(p.Id);
            }
        }
        Map<Id, LLC_BI__Loan_Collateral2__c> back = new Map<Id, LLC_BI__Loan_Collateral2__c>([
            SELECT Id, LLC_BI__Loan__c, LLC_BI__Collateral__c, LLC_BI__Collateral__r.Name,
                   LLC_BI__Amount_Pledged__c, LLC_BI__Advance_Rate__c, LLC_BI__Current_Lendable_Value__c,
                   LLC_BI__Pledged_Status__c
            FROM LLC_BI__Loan_Collateral2__c WHERE Id IN :pledgeIds WITH USER_MODE
        ]);

        for (Integer k = 0; k < rows.size(); k++) {
            String ps = String.valueOf(indexOfRow[k]);
            PledgeResult pr = results[indexOfRow[k]];
            LLC_BI__Loan_Collateral2__c row = rows[k].Id == null ? null : back.get(rows[k].Id);
            if (row == null) {
                pr.verification = 'The pledge could not be read back after creation, so nothing is claimed for it.';
                C360Plan.setState(steps, 'pledge_add_' + ps, C360Plan.STATE_FILED_UNVERIFIED, pr.verification);
                C360Plan.setState(steps, 'pledge_verify_' + ps, C360Plan.STATE_FAILED, pr.verification);
                continue;
            }
            pr.pledgeId = row.Id;
            pr.collateralName = row.LLC_BI__Collateral__r.Name;
            pr.advanceRate = row.LLC_BI__Advance_Rate__c;
            C360Plan.setState(steps, 'pledge_add_' + ps, C360Plan.STATE_VERIFIED,
                'Pledge created on version facility ' + row.LLC_BI__Loan__c + ' over ' + row.LLC_BI__Collateral__r.Name + '.');

            Boolean landed = row.LLC_BI__Loan__c == rows[k].LLC_BI__Loan__c
                && row.LLC_BI__Collateral__c == rows[k].LLC_BI__Collateral__c
                && row.LLC_BI__Amount_Pledged__c == rows[k].LLC_BI__Amount_Pledged__c;
            pr.verification = landed
                ? row.LLC_BI__Collateral__r.Name + ' ("' + pr.assetLabel + '") is pledged to the version facility at ' +
                  String.valueOf(row.LLC_BI__Amount_Pledged__c) + ', and the org resolved the advance rate to ' +
                  (row.LLC_BI__Advance_Rate__c == null
                      ? 'no figure: nothing set an override, an auto-applied rate or a type default'
                      : String.valueOf(row.LLC_BI__Advance_Rate__c) + '% for a lendable value of ' +
                        String.valueOf(row.LLC_BI__Current_Lendable_Value__c)) +
                  (pr.createdAsset ? '. The asset and its ownership row were created by this run.' : '.')
                : 'Not proven: the pledge reads back against collateral ' + row.LLC_BI__Collateral__c + ' on loan ' +
                  row.LLC_BI__Loan__c + ' at ' + String.valueOf(row.LLC_BI__Amount_Pledged__c) +
                  ', which is not what this plan composed.';
            C360Plan.setState(steps, 'pledge_verify_' + ps,
                landed ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FILED_UNVERIFIED, pr.verification);
        }
    }

    // -----------------------------------------------------------------------------------------
    // Replay, reads and small helpers.
    // -----------------------------------------------------------------------------------------

    /**
     * Reports a run this idempotency key already produced, writing nothing.
     *
     * The platform is known to produce duplicates on failed background Apex, so idempotency is ours
     * to enforce and cannot be assumed from the org (A33.3.5).
     */
    private static ExecuteResult replay(cm_Action_Staging__c prior) {
        ExecuteResult out = new ExecuteResult();
        out.stagingId = prior.Id;
        out.productPackageId = prior.cm_Result_Record_Id__c;
        out.versionPackageId = prior.cm_Result_Record_Id__c;
        out.replayed = true;
        out.terminalState = prior.cm_Status__c == 'Completed'
            ? C360Plan.TERMINAL_SUCCESS
            : (prior.cm_Status__c == 'Partial' ? C360Plan.TERMINAL_PARTIAL : C360Plan.TERMINAL_FAILED);
        out.approvalHandoff = APPROVAL_HANDOFF;
        out.facilityCount = 0;
        if (String.isNotBlank(prior.cm_Tracker_JSON__c)) {
            out.steps = toWireSteps(
                (List<C360Plan.Step>) JSON.deserialize(prior.cm_Tracker_JSON__c, List<C360Plan.Step>.class)
            );
        }
        // THE KEY IS NOT NAMED HERE. C360ActionStaging.findCompleted does not select
        // cm_Idempotency_Key__c, and reading a field a query did not ask for throws SObjectException
        // at runtime while compiling perfectly. The caller already holds the key it sent.
        out.outcome = 'This amendment already ran under this idempotency key. Nothing was written by this call: the ' +
            'earlier run\'s tracker is reported as it stands. ' + APPROVAL_HANDOFF;
        return out;
    }

    private static cm_Action_Staging__c readStaging(String stagingId) {
        List<cm_Action_Staging__c> rows = [
            SELECT Id, cm_Action_Id__c
            FROM cm_Action_Staging__c
            WHERE Id = :stagingId
            WITH USER_MODE
            LIMIT 1
        ];
        return rows.isEmpty() ? null : rows[0];
    }

    /** Mints a gate-shaped refusal from the execute side, so the code reads the same either way. */
    private static StageAmendVersion.RefusalException refusal(String code, String message) {
        StageAmendVersion.RefusalException e = new StageAmendVersion.RefusalException(message);
        e.code = code;
        return e;
    }

    private static Map<String, Object> moves(Map<Id, Map<String, Object>> byTarget, Id target) {
        if (!byTarget.containsKey(target)) {
            byTarget.put(target, new Map<String, Object>());
        }
        return byTarget.get(target);
    }

    private static Integer intCount(Object raw) {
        Decimal d = C360Plan.asDecimal(raw);
        return d == null ? 0 : Integer.valueOf(d);
    }

    /** Restores the Apex type a staged field value lost on its JSON round trip. */
    private static Object coerceStagedFieldValue(String fieldType, String valueJson) {
        if (String.isBlank(valueJson)) {
            return null;
        }
        if (fieldType == 'DATE') {
            return Date.valueOf(String.valueOf(JSON.deserializeUntyped(valueJson)).substring(0, 10));
        }
        if (fieldType == 'BOOLEAN') {
            return valueJson.trim().toLowerCase() == 'true';
        }
        if (fieldType == 'CURRENCY' || fieldType == 'DOUBLE' || fieldType == 'PERCENT' || fieldType == 'INTEGER') {
            return Decimal.valueOf(String.valueOf(JSON.deserializeUntyped(valueJson)));
        }
        return String.valueOf(JSON.deserializeUntyped(valueJson));
    }

    /** What one facility took, compared field by field against what the org now holds. */
    private static String applied(SObject back, Map<String, Object> staged) {
        if (staged == null || staged.isEmpty()) {
            return 'No figure was staged for this facility: the arms aimed at it authored records beside it, and its ' +
                'commitment, rate, maturity and term are exactly as they were.';
        }
        List<String> landed = new List<String>();
        List<String> missed = new List<String>();
        for (String f : staged.keySet()) {
            Object want = staged.get(f);
            Object got = back.get(f);
            if (got == want || String.valueOf(got) == String.valueOf(want)) {
                landed.add(f + ' reads ' + String.valueOf(got));
            } else {
                missed.add(f + ' did not land: staged ' + String.valueOf(want) + ', reads ' + String.valueOf(got));
            }
        }
        return (landed.isEmpty() ? '' : String.join(landed, '; ') + '.') +
            (missed.isEmpty() ? '' : (landed.isEmpty() ? '' : ' ') + String.join(missed, '; ') + '.');
    }

    private static String outcomeSentence(
        StageAmendVersion.VersionGate g,
        List<FacilityResult> facilities,
        List<FieldChangeResult> fieldChanges,
        List<CovenantResult> covenants,
        List<InvolvementResult> involvements,
        List<FeeResult> fees,
        List<PledgeResult> pledges
    ) {
        return
            g.pkg.Name + ' amended in place: ' + facilities.size() + ' ' +
            (facilities.size() == 1 ? 'facility' : 'facilities') + ' on the version written directly, no credit action ' +
            'and no clone' +
            (fieldChanges.isEmpty() ? '' : ', ' + fieldChanges.size() + ' field change' +
                (fieldChanges.size() == 1 ? '' : 's')) +
            (covenants.isEmpty() ? '' : ', ' + covenants.size() + ' covenant' +
                (covenants.size() == 1 ? '' : 's') + ' on the version') +
            (involvements.isEmpty() ? '' : ', ' + involvements.size() + ' borrowing-structure row' +
                (involvements.size() == 1 ? '' : 's')) +
            (fees.isEmpty() ? '' : ', ' + fees.size() + ' net-new fee' + (fees.size() == 1 ? '' : 's')) +
            (pledges.isEmpty() ? '' : ', ' + pledges.size() + ' collateral pledge' + (pledges.size() == 1 ? '' : 's')) +
            '. ' +
            (facilities.size() == 1 && facilities[0].outcome != null
                ? facilities[0].outcome
                : 'See each facility for what read back off it.') +
            ' ' + APPROVAL_HANDOFF;
    }

    private static List<StepResult> toWireSteps(List<C360Plan.Step> steps) {
        List<StepResult> out = new List<StepResult>();
        for (C360Plan.Step s : steps) {
            StepResult r = new StepResult();
            r.id = s.id;
            r.type = s.type;
            r.label = s.label;
            r.state = s.state;
            r.detail = s.detail;
            out.add(r);
        }
        return out;
    }

    private static ToolError err(
        String code, String message, String orgError, String step, Boolean resumable, String idempotencyKey
    ) {
        ToolError e = new ToolError();
        e.code = code;
        e.message = message;
        e.orgError = orgError;
        e.step = step;
        e.resumable = resumable;
        e.idempotencyKey = idempotencyKey;
        return e;
    }
}
