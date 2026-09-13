/**
 * StageRenewal - MCP tool: stage_renewal.
 *
 * STAGE ONLY. There is no execute_renewal in this wave, for the same probe-established reason as
 * modification (PROBE-LEDGER wave 3, probe 9): a credit action accepts only a Booked, Open,
 * core-keyed facility, and Loan_Validation_06 makes Booked unreachable through the API with no
 * permission bypass. nCino requires a human Submit for Approval. Execution is HELD.
 *
 * Renewal deltas from modification (A33.4.2): the flag flipped is LLC_BI__isRenewal__c with
 * LLC_BI__Is_Modification__c false; the action is maturity-driven so a new maturity date is
 * required; a new Opportunity is auto-created on every renewal, which the plan surfaces as an
 * observed side effect rather than a surprise; and LLC_BI__Renewal_Number__c must be set explicitly
 * or left to the invocable, because a blank number yields a facility named _Rnull and breaks core
 * sync. Only three loans org-wide carry isRenewal true, so this path has little local precedent.
 *
 * The covenant junction clones on a renewal, which feeds the A33.2.4(c) carryover suggestion. An
 * empty carryover list is a real answer and renders as "no loan-level covenants attached", never as
 * blank space.
 *
 * PACKAGE VERSIONING (founder correction, 2026-08-30, same as StageLoanModification). nCino package
 * methodology: a credit action NEVER versions a loan alone. It mints the next VERSION of the whole
 * package: every Booked/Open member is cloned onto the new package with its junction graph, the
 * selected members then take the renewal terms, the rest carry unchanged, and anything not
 * Booked/Open is NAMED as staying on the current version rather than silently skipped. The engine
 * facts behind the plan's promises were probed live on this org (EVIDENCE-SEPT4.md "PACKAGE
 * VERSIONING"): isNewPackage=true mints the package and clones every facilityAction member; the
 * engine ignores newPackageName and leaves the account null, so the name and account are repaired
 * post-engine; and the engine copies ZERO junction rows, so the carry is the caller's to compose
 * and prove by re-query. Execution of a renewal is still held, so this plan NARRATES that roll —
 * membership computed and named, carry counts read and promised — and any future execute wave
 * inherits the plan shape it must honor rather than a single-loan story it must contradict.
 *
 * PACKAGE-ANCHORED, MULTI-FACILITY (ACTIONS-DESIGN 5.1/5.2 anchor correction, Fabian, 2026-07-25).
 * The anchor is the PRODUCT PACKAGE: nCino's CreditActionSoaXPkg takes the package id plus a list of
 * (booked facility, action) pairs, so a facility is a member selection within the package rather
 * than the anchor. This tool takes `facilityIds` as that package-anchored shape and keeps the flat
 * `loanId` as the single-facility back-compat shape. Exactly one shape per call. One call produces
 * ONE plan, ONE plan hash and ONE decision token, carrying N per-facility typed steps. The selection
 * contract lives in C360Facilities, shared with stage_loan_modification so the two cannot drift.
 *
 * NET-NEW FACILITIES (founder, 2026-09-03: "Do we allow new loans to be created as part of the
 * modification and renewal? This should be fully possible."). The renewal takes `newFacilitiesJson`
 * on the same shape the modification does, validated by C360NewFacilities so the two cannot drift,
 * and NARRATES it: execution of a renewal is held, so the facilities are planned, hashed and
 * confirmed rather than filed. The modification is the route that executes one today.
 *
 * INPUT SHAPE AND THE required=true TRAP (lesson 16aa). `required=true` on an @InvocableVariable is
 * enforced by the REST Actions API BEFORE Apex runs, and NO Apex unit test can see it, because a
 * direct test invocation constructs the Request itself. A tool that grows an alternative input shape
 * must therefore drop required=true from every field the new shape supersedes, or the platform
 * refuses the new shape and our Apex never executes. `loanId` is no longer flagged required;
 * requiredness is enforced in Apex, where it can also say WHICH facility is wrong. `idempotencyKey`,
 * `productPackageId`, `rationale` and `newMaturityDate` keep required=true: both shapes need them.
 */
global with sharing class StageRenewal {

    /** Raised for a domain-level validation failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Product Package Id' description='The deal anchor. Every selected facility must be a member of it.' required=true)
        global String productPackageId;
        @InvocableVariable(label='Loan Id' description='Single-facility path. Supply this OR facilityIds, never both. Not flagged required on the invocable because facilityIds supersedes it; requiredness is enforced in Apex.')
        global String loanId;
        @InvocableVariable(label='Facility Ids' description='Package-anchored path: the member facilities of this package to renew, in one plan under one decision token. Omit it and the single loanId above is used.')
        global List<Id> facilityIds;
        @InvocableVariable(label='Rationale' required=true)
        global String rationale;
        @InvocableVariable(label='New Maturity Date' description='Required. A renewal is maturity-driven.' required=true)
        global Date newMaturityDate;
        @InvocableVariable(label='Requested Rate' description='Optional repricing.')
        global Decimal requestedRate;
        @InvocableVariable(label='New Facilities JSON' description='Optional. NET-NEW FACILITIES filed on the NEW package version this renewal creates: [{"label"? ("new:1", defaulted by position), "product" (an exact Commercial Loan record-type product: Construction, Deposit, Equipment, HELOC, Line of Credit, Purchase), "amount", "termMonths", "purpose", "amortizedTermMonths"?, "firstPaymentDate"? (YYYY-MM-DD)}]. A renewal versions the whole package, and new money on the version being approved is ordinary nCino practice. EXECUTION OF A RENEWAL IS HELD, so this plan NARRATES the facilities rather than filing them: the shape is validated against the org here so a future execute wave inherits a plan it can honour rather than a story it has to contradict.')
        global String newFacilitiesJson;
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

    /** One selected facility, with the plan step ids that belong to it. */
    global class PlannedFacility {
        @InvocableVariable(label='Facility Id')
        global String facilityId;
        @InvocableVariable(label='Facility Name' description='The org-assigned name. The org rewrites loan names on save, so this is read back, never echoed.')
        global String facilityName;
        @InvocableVariable(label='Credit Action Step Id')
        global String creditActionStepId;
        @InvocableVariable(label='Verify Step Id')
        global String verifyStepId;
        @InvocableVariable(label='Apply Changes Step Id')
        global String applyStepId;
        @InvocableVariable(label='Covenant Carryover Count' description='Loan Covenant junction rows on this facility that would clone onto its renewal.')
        global Integer covenantCarryoverCount;
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
        @InvocableVariable(label='Execution Held' description='Always true in this wave. Execution needs a Booked facility and Booked is unreachable through the API.')
        global Boolean executionHeld;
        @InvocableVariable(label='Held Reason')
        global String heldReason;
        @InvocableVariable(label='Covenant Carryover Count' description='Loan Covenant junction rows that would clone, totalled across every selected facility. An empty list is a real answer, not blank space.')
        global Integer covenantCarryoverCount;
        @InvocableVariable(label='Facilities' description='One entry per selected facility, with the plan step ids that belong to it.')
        global List<PlannedFacility> facilities;
        @InvocableVariable(label='Facility Count')
        global Integer facilityCount;
        @InvocableVariable(label='New Facility Count' description='Net-new facilities this plan would file on the new package version. Zero is the ordinary answer.')
        global Integer newFacilityCount;
        @InvocableVariable(label='New Facility Labels' description='The labels the plan names them by, in the order they were sent.')
        global List<String> newFacilityLabels;
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
     * Stages a renewal. Writes no domain record, and execution is held.
     *
     * @param requests One request per staged action. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='stage_renewal'
        description='Validate a package-anchored facility renewal and return an immutable execution plan with a plan hash. Takes either the single loanId or facilityIds, the member facilities of the package, never both. NET-NEW FACILITIES may ride the same request in newFacilitiesJson and are validated against the org\'s own product catalog, though a renewal NARRATES them rather than filing them. Writes nothing. Execution is HELD in this wave: a credit action requires a Booked facility, and Booked is unreachable through the API because nCino requires a human Submit for Approval.'
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
            } catch (C360NewFacilities.NewFacilityException e) {
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
        if (String.isBlank(req.productPackageId)) {
            throw new ToolException('productPackageId is required. It is the deal anchor.');
        }
        if (String.isBlank(req.rationale)) {
            throw new ToolException('rationale is required. It feeds the audit ledger.');
        }
        if (req.newMaturityDate == null) {
            throw new ToolException('newMaturityDate is required. A renewal is maturity-driven.');
        }

        Id packageId = C360Facilities.packageId(req.productPackageId);
        List<Id> selected = C360Facilities.resolve(req.loanId, req.facilityIds, 'renewal');
        List<LLC_BI__Loan__c> facilities =
            C360Facilities.validate(readFacilities(selected), selected, packageId, 'Renewals');
        Map<Id, Integer> carryoverByFacility = C360Facilities.covenantCarryover(selected);
        // NET-NEW FACILITIES ON THE NEW VERSION (founder, 2026-09-03). Validated against the org's
        // own product catalog here, exactly as the modification validates them, so the two routes
        // cannot answer the same request differently.
        List<C360NewFacilities.NewFacility> newFacilities =
            C360NewFacilities.parse(req.newFacilitiesJson, 'renewal');

        // nCino package methodology (founder correction, 2026-08-30): a renewal never versions a
        // loan alone. The credit action rolls the WHOLE package: every eligible member is cloned
        // into the next package version, the selected ones then take the new maturity, the rest
        // carry unchanged. Eligibility mirrors nCino's own wizard rule, observed live on this org:
        // Booked and Open roll; anything else (a Proposal-stage member, a closed loan) stays on the
        // current version and is NAMED in the plan rather than silently skipped.
        List<String> rollIds = new List<String>();
        List<String> rollNames = new List<String>();
        List<String> excludedNames = new List<String>();
        for (LLC_BI__Loan__c m : readPackageMembers(packageId)) {
            if (m.LLC_BI__Stage__c == 'Booked' && m.LLC_BI__Status__c == 'Open') {
                rollIds.add(String.valueOf(m.Id));
                rollNames.add(m.Name);
            } else {
                excludedNames.add(m.Name + ' (' + m.LLC_BI__Stage__c + ')');
            }
        }

        Integer n = facilities.size();
        Integer carryover = 0;
        Map<String, Object> resolved = new Map<String, Object>{
            'productPackageId' => packageId,
            'actionType' => 'Renewal',
            'facilityCount' => n,
            'rollMemberIds' => String.join(rollIds, ','),
            'rollMemberCount' => rollIds.size(),
            'excludedMemberCount' => excludedNames.size(),
            'newMaturityDate' => req.newMaturityDate,
            'requestedRate' => req.requestedRate
        };

        List<C360Plan.Step> steps = new List<C360Plan.Step>();
        List<PlannedFacility> planned = new List<PlannedFacility>();
        List<String> facilityNames = new List<String>();

        steps.add(
            new C360Plan.Step('roll_package', C360Plan.TYPE_WRITE,
                'Create the next package version: one credit action rolls all ' + String.valueOf(rollIds.size()) +
                ' eligible members into a new package' +
                (excludedNames.isEmpty() ? '' : ', leaving ' + String.join(excludedNames, ', ') + ' on the current version'))
                .onObject('LLC_BI__Product_Package__c', new List<String>{ 'new package version created by nCino' })
                .wakes(new List<String>{
                    'nCino clones every rolled member and writes its LLC_BI__LoanRenewal__c chain row synchronously; ' +
                    'the junction graph does NOT copy itself (verified live 2026-08-30) and is carried by the ' +
                    'carry_junctions step of this same plan'
                })
                .provenBy('SELECT COUNT() FROM LLC_BI__Loan__c WHERE LLC_BI__Product_Package__c = :outputPackageId')
        );

        for (Integer i = 0; i < n; i++) {
            LLC_BI__Loan__c loan = facilities[i];
            String s = String.valueOf(i);
            Integer own = carryoverByFacility.containsKey(loan.Id) ? carryoverByFacility.get(loan.Id) : 0;
            carryover += own;
            facilityNames.add(loan.Name);
            resolved.put('facility' + s + '.loanId', String.valueOf(loan.Id));

            steps.add(
                new C360Plan.Step('credit_action_' + s, C360Plan.TYPE_WRITE, 'Roll ' + loan.Name + ' into the new package version (its clone is the one this plan renews)')
                    .onObject('LLC_BI__Loan__c', new List<String>{ 'clone created by nCino on the new package version' })
                    .wakes(new List<String>{
                        'nCino clones the facility onto the new package, sets the loan-type flag and creates the LLC_BI__LoanRenewal__c junction row'
                    })
                    .provenBy('SELECT Id, LLC_BI__ParentLoanId__c FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c = :loanId')
            );
            steps.add(
                new C360Plan.Step('verify_clone_' + s, C360Plan.TYPE_VERIFICATION, 'Re-query for the new facility cloned from ' + loan.Name + ' and its junction row')
                    .onObject('LLC_BI__LoanRenewal__c', new List<String>{ 'LLC_BI__ParentLoanId__c' })
                    .provenBy('SELECT Id, LLC_BI__ParentLoanId__c FROM LLC_BI__LoanRenewal__c WHERE LLC_BI__ParentLoanId__c = :loanId')
            );
            steps.add(
                new C360Plan.Step('apply_changes_' + s, C360Plan.TYPE_WRITE, 'Apply the requested changes to the new facility cloned from ' + loan.Name)
                    .onObject('LLC_BI__Loan__c', new List<String>{ 'LLC_BI__Maturity_Date__c', 'LLC_BI__Interest_Rate__c' })
                    .provenBy('SELECT Id, LLC_BI__Amount__c, LLC_BI__Maturity_Date__c FROM LLC_BI__Loan__c WHERE Id = :cloneId')
            );

            PlannedFacility pf = new PlannedFacility();
            pf.facilityId = loan.Id;
            pf.facilityName = loan.Name;
            pf.creditActionStepId = 'credit_action_' + s;
            pf.verifyStepId = 'verify_clone_' + s;
            pf.applyStepId = 'apply_changes_' + s;
            pf.covenantCarryoverCount = own;
            planned.add(pf);
        }

        steps.add(
            new C360Plan.Step('verify_package', C360Plan.TYPE_VERIFICATION,
                'Verify the new package version: it exists, it is not the current package, and every rolled member reads back as a clone on it')
                .onObject('LLC_BI__Product_Package__c', new List<String>{ 'Id', 'Name' })
                .provenBy('SELECT Id, Name FROM LLC_BI__Product_Package__c WHERE Id = :outputPackageId')
        );

        // The carry counts, read now so the banker confirms a NUMBERED promise. nCino's engine
        // copies no junction rows in this org (verified live 2026-08-30), so whatever executes this
        // plan must replicate each member's graph itself and prove the counts by re-query. Execution
        // of a renewal is held, and the counts are still read here: a staged renewal narrates the
        // same roll a modification performs, so a future execute wave inherits the promise.
        Integer pledgeCount = [SELECT COUNT() FROM LLC_BI__Loan_Collateral2__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer involvementCount = [SELECT COUNT() FROM LLC_BI__Legal_Entities__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        Integer covenantJunctionCount = [SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :rollIds WITH USER_MODE];
        steps.add(
            new C360Plan.Step('carry_junctions', C360Plan.TYPE_WRITE,
                'Carry each rolled member\'s junction graph onto its clone: ' + covenantJunctionCount +
                ' covenant junction' + (covenantJunctionCount == 1 ? '' : 's') + ', ' + pledgeCount +
                ' collateral pledge' + (pledgeCount == 1 ? '' : 's') + ', ' + involvementCount +
                ' borrowing involvement' + (involvementCount == 1 ? '' : 's'))
                .onObject('LLC_BI__Loan_Covenant__c', new List<String>{ 'replicas retargeted at the clones, verified by count' })
                .provenBy('SELECT COUNT() FROM LLC_BI__Loan_Covenant__c WHERE LLC_BI__Loan__c IN :cloneIds')
        );
        for (Integer i = 0; i < newFacilities.size(); i++) {
            C360NewFacilities.NewFacility nf = newFacilities[i];
            C360NewFacilities.putResolved(resolved, i, nf);
            steps.addAll(C360NewFacilities.steps(i, nf, 'the new package version'));
        }
        resolved.put('newFacilityCount', newFacilities.size());

        steps.add(
            new C360Plan.Step('observe_side_effects', C360Plan.TYPE_OBSERVED, 'A new Opportunity is auto-created on every renewal')
                .wakes(new List<String>{ 'nCino renewal automation' })
        );
        steps.add(
            new C360Plan.Step('held_execution', C360Plan.TYPE_HANDOFF, 'HELD: execution needs an approved facility')
                .wakes(new List<String>{ 'nCino Submit for Approval, driven by a human' })
        );

        List<String> warnings = new List<String>{
            'EXECUTION IS HELD. ' + (n == 1 ? 'This facility is' : 'These facilities are') +
                ' booked and open, which is what a credit action requires, but no execute tool ships in this wave.' +
                C360Facilities.lookupKeyWarning(facilities),
            'nCino package methodology: a renewal versions the whole package, never a loan alone. Executing this plan would create a ' +
                'NEW package version holding clones of all ' + String.valueOf(rollIds.size()) + ' eligible members (' +
                String.join(rollNames, ', ') + '); the current package and every original loan stay exactly as they are.',
            'nCino\'s engine copies NO junction rows in this org (verified live 2026-08-30: every related-lists copy default ' +
                'flipped on, engine run, zero rows landed). Whatever executes this plan must therefore carry each member\'s covenant ' +
                'junctions, collateral pledges and borrowing involvements onto its clone itself, and prove the counts by re-query.',
            'Booked cannot be reached through the API. Loan_Validation_06 requires nCino\'s Submit for Approval button and carries no permission bypass.',
            'The junction object has no validation rules, no triggers and no flows, so a malformed row would fail silently. Any future execution verifies by re-query only.',
            'The platform is known to produce duplicate modification loans on failed background Apex, so idempotency is enforced by this tool rather than assumed.',
            carryover == 0
                ? 'No loan-level covenants are attached to ' + (n == 1 ? 'this facility' : 'these facilities') + ', so nothing would carry over.'
                : String.valueOf(carryover) + ' loan-level covenant junction rows would clone onto the new ' + (n == 1 ? 'facility' : 'facilities') +
                  '. nCino clones the junction, not the covenant, and its own guidance says a business process must decide what happens to each one.'
        };
        warnings.add(
            n == 1
                ? 'A renewal auto-creates a new Opportunity and is effectively irreversible once run.'
                : 'Each renewal auto-creates a new Opportunity, so this plan would produce ' + n + ' of them, and a renewal is effectively irreversible once run.'
        );
        warnings.add('LLC_BI__Renewal_Number__c must be set explicitly or left to the invocable. A blank number yields a facility named _Rnull and breaks core sync.');
        warnings.addAll(C360NewFacilities.warnings(newFacilities, 'the new package version'));
        if (!newFacilities.isEmpty()) {
            warnings.add(
                'EXECUTION IS HELD, so the ' + String.valueOf(newFacilities.size()) + ' net-new ' +
                (newFacilities.size() == 1 ? 'facility above is' : 'facilities above are') +
                ' PLANNED and not filed. The shape was validated against the org\'s own product catalog at stage time, ' +
                'so the plan a future execute wave runs is the one confirmed here. To file a new facility today, run it ' +
                'as a modification, which executes, or as its own new-facility action against the current package.'
            );
        }
        if (n > 1) {
            warnings.add(
                'This is one plan over ' + n + ' facilities on the same package, under a single confirmation and a single decision token. ' +
                'Each facility carries its own credit action, verification and apply step, so a failure on one is reported against that facility ' +
                'and does not silently discard the others.'
            );
            warnings.add(
                'The new maturity date applies to every selected facility. Stage them separately if they renew onto different dates.'
            );
        }

        Map<String, Object> provenance = new Map<String, Object>{
            'facilityIds' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.join(selected, ', ') },
            'productPackageId' => new Map<String, String>{ 'prefill' => 'NCINO_RECORD', 'provenance' => 'NCINO', 'citation' => String.valueOf(packageId) }
        };

        String heldReason =
            'A credit action requires a Booked, core-keyed facility, and Loan_Validation_06 makes Booked unreachable through the API with no bypass. ' +
            'Reaching it needs nCino\'s Submit for Approval with real approvers. This plan is staged and persisted so it can be executed once that path exists.';

        String summary =
            'Plans the next VERSION of the package, nCino package methodology: one credit action rolls all ' +
            String.valueOf(rollIds.size()) + ' eligible members into a new package with their junction graphs. ' +
            (n == 1
                ? facilityNames[0] + ' is the member being renewed'
                : String.valueOf(n) + ' members are being renewed: ' + String.join(facilityNames, ', ')) +
            '; the rest carry unchanged' +
            (excludedNames.isEmpty() ? '. ' : ', and ' + String.join(excludedNames, ', ') + ' stays on the current version because it is not Booked/Open. ') +
            'The new maturity applies to the ' + (n == 1 ? 'clone' : 'clones') + ' only; every original loan and the current package stay untouched. ' +
            (newFacilities.isEmpty() ? '' : String.valueOf(newFacilities.size()) + ' NET-NEW ' +
                (newFacilities.size() == 1 ? 'facility is' : 'facilities are') + ' planned on the new version beside the clones: ' +
                C360NewFacilities.labelList(newFacilities) + '. ') +
            'NOTHING IS WRITTEN AND NOTHING WILL BE: execution is held. ' + heldReason;

        String planJson = C360Plan.serializePlan(summary, steps, warnings, provenance, resolved);
        String planHash = C360Plan.hash('renewal', steps, resolved);

        C360ActionStaging.Staged staged = C360ActionStaging.stagePlan(
            'renewal', req.idempotencyKey, facilities[0].LLC_BI__Account__c, packageId, planJson, planHash
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
        r.accountId = facilities[0].LLC_BI__Account__c;
        r.productPackageId = packageId;
        r.executionHeld = true;
        r.heldReason = heldReason;
        r.covenantCarryoverCount = carryover;
        r.facilities = planned;
        r.facilityCount = n;
        r.newFacilityCount = newFacilities.size();
        r.newFacilityLabels = new List<String>();
        for (C360NewFacilities.NewFacility nf : newFacilities) {
            r.newFacilityLabels.add(nf.label);
        }
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


    /**
     * Seam: the facility read, injectable for tests only.
     *
     * Staging requires Booked + Open facilities, and Booked is unreachable through the API (LV05 and
     * LV06, no permission bypass, only nCino's Submit for Approval with real approvers). A fixture
     * therefore cannot produce a stageable facility, which left the entire plan-building body
     * untested. This seam supplies them so the plan shape is asserted, exactly as
     * ExecuteCovenantReview does for a record it must not create. The wire path is unchanged: a real
     * unbooked facility still reaches the same refusal.
     */
    @TestVisible
    private static List<LLC_BI__Loan__c> seamFacilities;

    @TestVisible
    private static List<LLC_BI__Loan__c> readFacilities(List<Id> facilityIds) {
        if (seamFacilities != null) {
            return C360Facilities.fromSeam(seamFacilities, facilityIds);
        }
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c, LLC_BI__lookupKey__c,
                   LLC_BI__Account__c, LLC_BI__Account__r.Name, LLC_BI__Product_Package__c,
                   LLC_BI__Amount__c, LLC_BI__Maturity_Date__c, LLC_BI__Is_Modification__c, LLC_BI__isRenewal__c
            FROM LLC_BI__Loan__c
            WHERE Id IN :facilityIds
            WITH USER_MODE
        ];
    }

    /**
     * Every member of the package, for the roll computation. Honors the same seam as
     * readFacilities so the plan-shape tests see a consistent package: in the seam world the
     * injected facilities ARE the package membership.
     */
    private static List<LLC_BI__Loan__c> readPackageMembers(Id packageId) {
        if (seamFacilities != null) {
            return seamFacilities;
        }
        return [
            SELECT Id, Name, LLC_BI__Stage__c, LLC_BI__Status__c
            FROM LLC_BI__Loan__c
            WHERE LLC_BI__Product_Package__c = :packageId
            WITH USER_MODE
            ORDER BY LLC_BI__Amount__c DESC
        ];
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
