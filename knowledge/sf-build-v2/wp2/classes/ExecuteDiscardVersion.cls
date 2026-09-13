/**
 * ExecuteDiscardVersion - MCP tool: execute_discard_version.
 *
 * Runs the plan `stage_discard_version` staged, behind the single-use decision token. This is the
 * only class in this package that deletes, and every property that makes that safe is enforced
 * here rather than assumed.
 *
 * THE GATE IS RE-RUN, NOT REPLAYED. `StageDiscardVersion.discover()` is called again at execute
 * time, so a version that climbed to Approval / Loan Committee between the confirm gate and the
 * click is refused with nothing written, and a version that grew a new child in the same window is
 * refused too. The staged inventory is the CEILING: a record that was not on the list the banker
 * confirmed is never deleted, whatever the fresh query returns. A record that WAS on the list and
 * is already gone is not an error, it is a resumed run.
 *
 * THE ORDER IS THE SAFETY, AND IT IS THE ORG'S ORDER RATHER THAN A PREFERENCE.
 *   1. `LLC_BI__LoanRenewal__c` chain rows. First, because they are what keeps the booked parents
 *      reading hasRenewal true, and because `LLC_BI__RenewalLoanId__c` is a plain lookup: deleting
 *      the clone would strand them (proven by hand, 2026-09-11).
 *   2. `LLC_BI__Loan_Collateral2__c` pledges. Before the facilities, because that lookup carries
 *      restrictedDelete and the platform refuses the facility while a pledge stands.
 *   3. `LLC_BI__Loan_Covenant__c` junctions, then the pricing components, the pricing streams, the
 *      fees and the entity involvements.
 *   4. The version facilities. Their `LLC_BI__Loan_Detail__c` and `LLC_BI__LLC_LoanDocument__c`
 *      children are master-detail and cascade; they are reported as cascading rather than claimed
 *      as deletes of ours.
 *   5. The version package.
 *   6. The trail, which is MARKED and never removed.
 *
 * A FAILURE STOPS THE CHAIN AND SAYS WHERE. Each group is one DML in USER_MODE inside its own try,
 * verified by a count re-query before the next group starts. The first group that does not come
 * back empty ends the run: the remaining steps are marked not attempted, the progress is written to
 * the staging record with the run still open, and the result carries what is gone and what remains.
 * Re-invoking with the SAME idempotency key resumes from there. Nothing is half-claimed.
 *
 * WHAT IT NEVER DELETES, restated here because a reader of this class should not have to open
 * another one: the booked source package, any booked parent facility, `LLC_BI__Collateral__c`
 * assets, `LLC_BI__Account_Collateral__c` ownership junctions, `LLC_BI__Covenant2__c` covenant
 * records, `LLC_BI__Account_Covenant__c` relationship junctions, and the `cm_Action_Staging__c`
 * trail. It also never deletes a `LLC_BI__Loan_Collateral_Aggregate__c` shell: those are per-loan
 * rollup anchors, a booked parent's loan can point at one, and the frozen inventory does not name
 * them. The shells the pledge deletes orphan are reported as an observed side effect instead.
 *
 * THE DELETE FENCE. Every delete passes `C360WriteGuard.assertAllowedForTool('discard-version', ...)`
 * with `OP_DELETE`. The bare `assertAllowed` entry point still refuses a delete on every object it
 * knows, unchanged, so the per-tool door is the ONLY door and a tool that has not been named on
 * the guard's delete table cannot delete anything at all.
 *
 * Org contract: SPEC-0.9.23-TOOL-CONTRACT.md pair 2.
 */
global with sharing class ExecuteDiscardVersion {

    /** Raised for a domain-level failure. Surfaces as ok:false, never as a fault. */
    public class ToolException extends Exception {}

    /**
     * One string, two registries, and they coincide deliberately: it is the action id on the trail
     * (`cm_Action_Id__c`) and the tool key on the write guard's delete table. The trail and the fence
     * name the same action, so they name it the same way.
     */
    private static final String ACTION_ID = 'discard-version';

    /**
     * THE REFUSAL SEAM, and why a delete chain needs one.
     *
     * The stop-and-resume behaviour below is the most important property in this class: a group that
     * the org refuses must end the run, name where it stopped, and leave the same idempotency key
     * able to carry on. Proving it needs a delete that fails.
     *
     * A REAL failing delete cannot be used in a test on this org. Ten unmanaged CDC triggers enqueue
     * `EventBridgeCallout`, a `Database.AllowsCallouts` queueable that POSTs to AWS, and Apex flushes
     * queued jobs at the end of every test method. A method that leaves a CAUGHT `DmlException`
     * behind makes that flush throw
     * `System.CalloutException: You have uncommitted work pending` from inside the managed queueable,
     * which fails the test for a reason that has nothing to do with this class. Three shapes were
     * tried against the org on 2026-09-13 (stopTest early, startTest with no stop, no window at all)
     * and all three reproduced it.
     *
     * So the refusal is INJECTED instead, the same way `ExecuteLoanModification` stubs nCino's
     * credit-action engine. The field is null in every non-test context, so the branch it opens
     * cannot be reached in production, and it consumes itself on first use so a resumed run behaves
     * exactly as a real one does. What it does NOT stub is the chain: every other group really
     * deletes, the verification really re-queries, and the resume really re-discovers.
     */
    @TestVisible
    private static String refuseGroupOnce;

    // ---------------------------------------------------------------------------------------
    // Wire types. Lesson 16: wire types are never shared across classes, duplication accepted.
    // ---------------------------------------------------------------------------------------

    global class Request {
        @InvocableVariable(label='Idempotency Key' required=true)
        global String idempotencyKey;
        @InvocableVariable(label='Staging Id' required=true)
        global String stagingId;
        @InvocableVariable(label='Plan Hash' required=true)
        global String planHash;
        @InvocableVariable(label='Decision Token' required=true)
        global String decisionToken;
        @InvocableVariable(label='Approver User Id' required=true)
        global String approverUserId;
    }

    global class InventoryItem {
        @InvocableVariable(label='Object')
        global String objectName;
        @InvocableVariable(label='Record Id')
        global String recordId;
        @InvocableVariable(label='Name')
        global String name;
        @InvocableVariable(label='Outcome' description='deleted, already_gone, kept, or not_attempted.')
        global String outcome;
    }

    global class StepResult {
        @InvocableVariable(label='Step Id')
        global String id;
        @InvocableVariable(label='Type')
        global String type;
        @InvocableVariable(label='Label')
        global String label;
        @InvocableVariable(label='State')
        global String state;
        @InvocableVariable(label='Detail')
        global String detail;
    }

    global class ToolError {
        @InvocableVariable(label='Code')
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

    global class ExecuteResult {
        @InvocableVariable(label='Staging Id')
        global String stagingId;
        @InvocableVariable(label='Version Package Id' description='The version that was discarded. It no longer resolves on a successful run.')
        global String versionPackageId;
        @InvocableVariable(label='Source Package Id' description='The booked package the relationship returns to, and the package the audit row is anchored on.')
        global String sourcePackageId;
        @InvocableVariable(label='Deleted Count')
        global Integer deletedCount;
        @InvocableVariable(label='Remaining Count')
        global Integer remainingCount;
        @InvocableVariable(label='Parents Cleared' description='Booked parents confirmed by re-query to read hasRenewal false.')
        global List<String> parentsCleared;
        @InvocableVariable(label='Items')
        global List<InventoryItem> items;
        @InvocableVariable(label='Steps')
        global List<StepResult> steps;
        @InvocableVariable(label='Terminal State')
        global String terminalState;
        @InvocableVariable(label='Outcome')
        global String outcome;
        @InvocableVariable(label='Replayed')
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

    // ---------------------------------------------------------------------------------------
    // The invocable.
    // ---------------------------------------------------------------------------------------

    /**
     * Executes a staged version discard.
     *
     * @param requests One request per execution. Element i of the response belongs to input i.
     * @return One response per request.
     */
    @InvocableMethod(
        label='execute_discard_version'
        description='Execute a plan staged by stage_discard_version, behind the single-use decision token. Re-runs the gate, then deletes the version chain rows, pledges, junctions, pricing, fees, involvements, facilities and package in that order, verifying between groups. Marks the version action trail Withdrawn rather than deleting it, and verifies every booked parent reads hasRenewal false. A failure stops the chain and is resumable under the same idempotency key.'
    )
    global static List<Response> run(List<Request> requests) {
        List<Response> out = new List<Response>();
        for (Request req : requests) {
            Response res = new Response();
            try {
                res.result = execute(req);
                res.ok = true;
            } catch (StageDiscardVersion.GateException e) {
                res.ok = false;
                res.error = err(e.code, e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (StageDiscardVersion.ToolException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360Facilities.SelectionException e) {
                res.ok = false;
                res.error = err('VALIDATION_FAILED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360ActionStaging.StagingException e) {
                res.ok = false;
                res.error = err('TOKEN_REFUSED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (C360WriteGuard.GuardException e) {
                res.ok = false;
                res.error = err('ALLOWLIST_REFUSED', e.getMessage(), null, null, false, req.idempotencyKey);
            } catch (DmlException e) {
                res.ok = false;
                res.error = err('ORG_REJECTED_WRITE', 'The org refused part of the discard.', e.getMessage(), null, true, req.idempotencyKey);
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

        Id approver = C360Plan.asId(req.approverUserId);

        // The resume fork, and the whole of it turns on the staging status.
        //
        //   Executing + a result id  = a chain that stopped mid-way. assertArmable admits exactly
        //                              that shape: the same token and the same plan proved again,
        //                              consumed only once, by the leg that started the run.
        //   Completed / Partial / Failed = terminal. The key has had its run and a second call
        //                              reports it rather than deleting anything twice.
        //   nothing                  = a first run.
        cm_Action_Staging__c prior = C360ActionStaging.findCompleted(req.idempotencyKey);
        Boolean resuming = false;
        cm_Action_Staging__c stg;
        if (prior != null && prior.cm_Status__c == 'Executing') {
            stg = C360ActionStaging.assertArmable(req.stagingId, req.planHash, req.decisionToken, approver);
            resuming = true;
        } else if (prior != null) {
            return replay(prior);
        } else {
            stg = C360ActionStaging.claimForExecute(req.stagingId, req.planHash, req.decisionToken, approver);
        }

        if (stg.cm_Action_Id__c != ACTION_ID) {
            throw new ToolException(
                'Staging record ' + stg.Id + ' was staged for ' + String.valueOf(stg.cm_Action_Id__c) +
                ', not for ' + ACTION_ID + '. A token is bound to the plan it was minted for.'
            );
        }

        List<C360Plan.Step> steps = C360Plan.deserializeSteps(stg.cm_Plan_JSON__c);
        Map<String, Object> v = C360Plan.deserializeValues(stg.cm_Plan_JSON__c);
        Id versionPackageId = C360Plan.asId(v.get('versionPackageId'));
        String stagedInventory = C360Plan.asString(v.get('inventory'));
        Set<String> confirmed = confirmedKeys(stagedInventory);
        Set<Id> confirmedTrail = idsFrom(C360Plan.asString(v.get('trail')));

        // A version that is already gone is a completed run whose outcome was never written: the
        // package delete landed and the transaction died before recordOutcome. Report it as such
        // rather than refusing on a package that cannot be read.
        Boolean versionResolves = [
            SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionPackageId WITH USER_MODE
        ] > 0;

        StageDiscardVersion.Inventory inv = null;
        if (versionResolves) {
            // A refusal here happens AFTER the token was consumed, so the staging row has to be left
            // saying what happened. Without this the run reads Executing forever, the banker gets a
            // refusal with no trail behind it, and the next attempt is refused by the token gate for
            // a reason that has nothing to do with why this one stopped.
            try {
                inv = StageDiscardVersion.discover(String.valueOf(versionPackageId));
                assertNothingNew(inv, confirmed);
            } catch (Exception e) {
                C360Plan.markRefused(steps, e.getMessage());
                C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
                throw e;
            }
        } else if (!resuming) {
            C360Plan.markRefused(steps, 'Version package ' + versionPackageId + ' no longer resolves, and this run never started.');
            C360ActionStaging.recordOutcome(stg, steps, C360Plan.TERMINAL_FAILED, null);
            throw new ToolException(
                'Version package ' + versionPackageId + ' no longer exists. Someone else discarded it. Nothing was written.'
            );
        }

        ExecuteResult out = new ExecuteResult();
        out.stagingId = stg.Id;
        out.versionPackageId = String.valueOf(versionPackageId);
        String staged = C360Plan.asString(v.get('sourcePackageId'));
        out.sourcePackageId = String.isBlank(staged) ? null : staged;
        out.replayed = false;
        out.items = new List<InventoryItem>();
        out.parentsCleared = new List<String>();
        out.deletedCount = 0;
        out.remainingCount = 0;

        // The parents to verify come off the STAGED plan, not off the fresh inventory. On a resumed
        // run the chain rows are already gone, so a fresh discovery would find no parents at all and
        // the verification that matters most would quietly report nothing to check.
        List<Id> parentIds = new List<Id>(idsFrom(C360Plan.asString(v.get('parents'))));
        String stoppedAt = runGroups(inv, steps, out);

        if (stoppedAt == null) {
            verifyParents(parentIds, steps, out);
            verifyVersionGone(versionPackageId, steps, out);
            withdrawTrail(confirmedTrail, steps, out);
        } else {
            C360Plan.setState(
                steps, 'verify_parents', C360Plan.STATE_SKIPPED,
                'The chain stopped at ' + stoppedAt + ', so the parents were not re-read.'
            );
            C360Plan.setState(
                steps, 'verify_version_gone', C360Plan.STATE_SKIPPED,
                'The chain stopped at ' + stoppedAt + ', so the version was never expected to be gone.'
            );
            C360Plan.setState(
                steps, 'withdraw_trail', C360Plan.STATE_SKIPPED,
                'The chain stopped at ' + stoppedAt + '. The trail is left untouched until the discard completes.'
            );
        }

        C360Plan.setState(
            steps, 'observe_aggregates', C360Plan.STATE_FILED_UNVERIFIED,
            'Deleting a pledge leaves its LLC_BI__Loan_Collateral_Aggregate__c shell behind. Those shells are not on the ' +
            'frozen inventory and are not deleted here: a booked parent can point at one, and this action never deletes ' +
            'what it did not put there. They are inert rollup anchors.'
        );

        String terminal = C360Plan.terminalState(steps);
        out.terminalState = terminal;
        out.steps = toWireSteps(steps);

        if (stoppedAt == null && terminal != C360Plan.TERMINAL_FAILED) {
            C360ActionStaging.recordOutcome(stg, steps, terminal, String.valueOf(versionPackageId));
            out.outcome = 'Version ' + versionPackageId + ' discarded: ' + out.deletedCount + ' record' +
                (out.deletedCount == 1 ? '' : 's') + ' deleted, ' + out.parentsCleared.size() +
                ' booked parent' + (out.parentsCleared.size() == 1 ? '' : 's') + ' confirmed back to hasRenewal false' +
                (out.sourcePackageId == null ? '' : ', the relationship back to package ' + out.sourcePackageId) + '.';
        } else {
            // The run stays OPEN. Status Executing plus a result id is what makes the same
            // idempotency key resumable rather than replayable.
            C360ActionStaging.recordProgress(stg, steps, String.valueOf(versionPackageId));
            out.outcome = 'The discard stopped at ' + String.valueOf(stoppedAt) + '. ' + out.deletedCount + ' record' +
                (out.deletedCount == 1 ? '' : 's') + ' are gone and ' + out.remainingCount +
                ' remain. Re-run execute_discard_version with the same idempotency key to resume from where it stopped.';
        }
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // The chain.
    // ---------------------------------------------------------------------------------------

    /**
     * Deletes each group in order, verifying between them.
     *
     * @param inv The freshly discovered inventory, or null when the version no longer resolves.
     *        assertNothingNew has already measured it against the confirmed list, so every id in it
     *        is one the banker saw.
     * @param steps The plan steps, mutated in place.
     * @param out The result, accumulating counts and item outcomes.
     * @return The step id the chain stopped at, or null when every group settled.
     */
    private static String runGroups(
        StageDiscardVersion.Inventory inv,
        List<C360Plan.Step> steps,
        ExecuteResult out
    ) {
        List<StageDiscardVersion.DeleteGroup> groups = inv == null
            ? new List<StageDiscardVersion.DeleteGroup>()
            : inv.groups;
        Map<String, StageDiscardVersion.Item> byKey = new Map<String, StageDiscardVersion.Item>();
        if (inv != null) {
            for (StageDiscardVersion.Item i : inv.items) {
                byKey.put(i.objectName + ':' + i.recordId, i);
            }
        }

        String stoppedAt = null;
        for (StageDiscardVersion.DeleteGroup g : groups) {
            if (stoppedAt != null) {
                C360Plan.setState(steps, g.stepId, C360Plan.STATE_SKIPPED, 'The chain stopped at ' + stoppedAt + '.');
                C360Plan.setState(steps, g.stepId + '_verify', C360Plan.STATE_SKIPPED, 'The chain stopped at ' + stoppedAt + '.');
                for (Id rid : g.ids) {
                    item(out, g.objectName, rid, byKey, 'not_attempted');
                    out.remainingCount++;
                }
                continue;
            }

            // Every id here is already known to be on the confirmed list: these groups come from the
            // SAME inventory assertNothingNew measured against it, before any DML ran. A per-id
            // re-check would be a branch that cannot be reached and therefore cannot be tested.
            List<Id> targets = g.ids;

            if (targets.isEmpty()) {
                C360Plan.setState(steps, g.stepId, C360Plan.STATE_VERIFIED, 'Nothing to delete on this group.');
                C360Plan.setState(steps, g.stepId + '_verify', C360Plan.STATE_VERIFIED, 'Confirmed empty.');
                continue;
            }

            C360WriteGuard.assertAllowedForTool(ACTION_ID, g.objectName, C360WriteGuard.OP_DELETE, new Map<String, Object>());

            String orgRefusal = null;
            if (g.stepId == refuseGroupOnce) {
                refuseGroupOnce = null;
                orgRefusal = 'DELETE_FAILED: the org is holding a record on this group (injected refusal).';
            } else {
                try {
                    List<SObject> rows = new List<SObject>();
                    for (Id rid : targets) {
                        rows.add(rid.getSObjectType().newSObject(rid));
                    }
                    delete as user rows;
                } catch (DmlException e) {
                    orgRefusal = e.getMessage();
                }
            }

            if (orgRefusal != null) {
                C360Plan.setState(
                    steps, g.stepId, C360Plan.STATE_FAILED,
                    'The org refused this delete: ' + orgRefusal
                );
                C360Plan.setState(
                    steps, g.stepId + '_verify', C360Plan.STATE_SKIPPED,
                    'Not attempted: the delete itself was refused.'
                );
                for (Id rid : targets) {
                    item(out, g.objectName, rid, byKey, 'not_attempted');
                    out.remainingCount++;
                }
                stoppedAt = g.stepId;
                continue;
            }

            C360Plan.setState(
                steps, g.stepId, C360Plan.STATE_VERIFIED,
                'Deleted ' + targets.size() + ' ' + g.objectName + ' record' + (targets.size() == 1 ? '' : 's') + '.'
            );

            Set<Id> left = survivingIds(g.objectName, targets);
            for (Id rid : targets) {
                if (left.contains(rid)) {
                    item(out, g.objectName, rid, byKey, 'not_attempted');
                    out.remainingCount++;
                } else {
                    item(out, g.objectName, rid, byKey, 'deleted');
                    out.deletedCount++;
                }
            }
            if (!left.isEmpty()) {
                C360Plan.setState(
                    steps, g.stepId + '_verify', C360Plan.STATE_FAILED,
                    left.size() + ' of ' + targets.size() + ' ' + g.objectName +
                    ' records read back after the delete. The chain stops here.'
                );
                stoppedAt = g.stepId;
                continue;
            }

            C360Plan.setState(
                steps, g.stepId + '_verify', C360Plan.STATE_VERIFIED,
                'Re-query confirms all ' + targets.size() + ' gone.'
            );
        }
        return stoppedAt;
    }

    /**
     * Refuses when the fresh inventory carries a record the banker never saw.
     *
     * The staged list is the ceiling. A pledge or a covenant junction that arrived between the
     * confirm gate and the click is a change of facts, and a delete that swept it up would be
     * deleting something nobody confirmed.
     */
    private static void assertNothingNew(StageDiscardVersion.Inventory inv, Set<String> confirmed) {
        List<String> arrivals = new List<String>();
        for (StageDiscardVersion.Item i : inv.items) {
            if (!confirmed.contains(i.objectName + ':' + i.recordId)) {
                arrivals.add(i.objectName + ' ' + i.name);
            }
        }
        if (!arrivals.isEmpty()) {
            throw new ToolException(
                'This version has changed since it was staged: ' + String.join(arrivals, ', ') +
                ' ' + (arrivals.size() == 1 ? 'was' : 'were') + ' not on the list that was confirmed. ' +
                'Nothing was deleted. Re-stage the discard so the banker sees the current inventory.'
            );
        }
    }

    /**
     * Which of a deleted batch still read back. An empty set is the only acceptable answer, and the
     * IDS matter rather than a count: a partial delete has to name the rows that survived, or the
     * resumed run has nothing to aim at.
     *
     * The object name is not caller-supplied text. It comes off the inventory's own group table,
     * which is a fixed list of API names written in this package, so the dynamic query has no
     * untrusted input in it.
     */
    private static Set<Id> survivingIds(String objectApiName, List<Id> ids) {
        Set<Id> out = new Set<Id>();
        String soql = 'SELECT Id FROM ' + objectApiName + ' WHERE Id IN :ids';
        for (SObject s : Database.query(soql, AccessLevel.USER_MODE)) {
            out.add((Id) s.get('Id'));
        }
        return out;
    }

    /**
     * Re-reads every booked parent and proves the rollup went back to zero.
     *
     * `LLC_BI__hasRenewal__c` is a formula over `LLC_BI__Number_Of_Renewals__c`, which is a rollup
     * this code cannot see the filter of. So both are read and both are reported: a parent still
     * counting a renewal is a failed verification, and it is the one that matters most, because a
     * parent stuck at hasRenewal true refuses every later fork.
     */
    private static void verifyParents(List<Id> parentIds, List<C360Plan.Step> steps, ExecuteResult out) {
        if (parentIds.isEmpty()) {
            C360Plan.setState(
                steps, 'verify_parents', C360Plan.STATE_VERIFIED,
                'This version had no booked parents, so there is no hasRenewal flag to clear.'
            );
            return;
        }
        List<String> stuck = new List<String>();
        for (LLC_BI__Loan__c p : [
            SELECT Id, Name, LLC_BI__hasRenewal__c, LLC_BI__Number_Of_Renewals__c
            FROM LLC_BI__Loan__c WHERE Id IN :parentIds WITH USER_MODE
        ]) {
            if (p.LLC_BI__hasRenewal__c == true) {
                stuck.add(p.Name + ' still reads hasRenewal true with ' + String.valueOf(p.LLC_BI__Number_Of_Renewals__c) + ' renewals');
            } else {
                out.parentsCleared.add(p.Name);
            }
        }
        if (stuck.isEmpty()) {
            C360Plan.setState(
                steps, 'verify_parents', C360Plan.STATE_VERIFIED,
                String.join(out.parentsCleared, ', ') + ' read hasRenewal false and can be forked again.'
            );
        } else {
            C360Plan.setState(
                steps, 'verify_parents', C360Plan.STATE_FAILED,
                String.join(stuck, '; ') + '. A parent stuck this way refuses every later credit action.'
            );
        }
    }

    /** Proves the version id no longer resolves. A package that reads back is a failed discard. */
    private static void verifyVersionGone(Id versionPackageId, List<C360Plan.Step> steps, ExecuteResult out) {
        Integer left = [SELECT COUNT() FROM LLC_BI__Product_Package__c WHERE Id = :versionPackageId WITH USER_MODE];
        if (left == 0) {
            C360Plan.setState(
                steps, 'verify_version_gone', C360Plan.STATE_VERIFIED,
                'Version package ' + versionPackageId + ' no longer resolves.'
            );
        } else {
            C360Plan.setState(
                steps, 'verify_version_gone', C360Plan.STATE_FAILED,
                'Version package ' + versionPackageId + ' still reads back after the delete.'
            );
        }
    }

    /**
     * Marks the version's trail rows Withdrawn. They are never deleted: the trail is the audit of
     * what the banker asked for, and it outlives the thing it audited.
     *
     * THE SET IS THE CONFIRMED ONE, and since 2026-09-13 it is a union of two (backlog row 45): the
     * rows anchored on the version in `cm_Product_Package__c`, and the row that FILED the version,
     * which is anchored on the SOURCE package and is tied to this version only by
     * `cm_Result_Record_Id__c` naming one of the facilities about to be deleted. It comes off the
     * STAGED plan rather than off a fresh query for the same reason the parents do: by the time a
     * stopped run is resumed those facilities are already gone, and a fresh query on their ids would
     * find nothing and quietly leave the row reading Completed for a version nobody can open.
     *
     * `cm_Status__c` is a RESTRICTED picklist and this org does not offer Withdrawn as of
     * 2026-09-13, so the value is read from the org first. When it is absent the rows are LEFT AS
     * THEY STAND and the step is reported as not attempted, naming the missing value. Stamping a
     * status that means something else would be worse than leaving the trail alone, and the run
     * reads partial, which is the true state.
     */
    private static void withdrawTrail(Set<Id> trailIds, List<C360Plan.Step> steps, ExecuteResult out) {
        if (trailIds.isEmpty()) {
            C360Plan.setState(steps, 'withdraw_trail', C360Plan.STATE_VERIFIED, 'This version carried no action trail rows.');
            return;
        }

        Boolean offered = C360Picklist.activeValues('cm_Action_Staging__c', 'cm_Status__c')
            .contains(StageDiscardVersion.WITHDRAWN);

        if (offered) {
            List<cm_Action_Staging__c> rows = new List<cm_Action_Staging__c>();
            for (Id t : trailIds) {
                rows.add(new cm_Action_Staging__c(Id = t, cm_Status__c = StageDiscardVersion.WITHDRAWN));
            }
            update as user rows;
        }

        // The re-read runs either way: the rows are reported as KEPT whether or not they could be
        // stamped, because keeping them is the part of this step that is not negotiable.
        Integer marked = 0;
        for (cm_Action_Staging__c r : [
            SELECT Id, cm_Status__c FROM cm_Action_Staging__c WHERE Id IN :trailIds WITH USER_MODE
        ]) {
            if (r.cm_Status__c == StageDiscardVersion.WITHDRAWN) {
                marked++;
            }
            InventoryItem w = new InventoryItem();
            w.objectName = 'cm_Action_Staging__c';
            w.recordId = String.valueOf(r.Id);
            w.name = String.valueOf(r.Id);
            w.outcome = 'kept';
            out.items.add(w);
        }

        String state = !offered
            ? C360Plan.STATE_SKIPPED
            : (marked == trailIds.size() ? C360Plan.STATE_VERIFIED : C360Plan.STATE_FAILED);
        String detail = !offered
            ? ('cm_Action_Staging__c.cm_Status__c does not offer ' + StageDiscardVersion.WITHDRAWN +
               ' in this org and is a restricted picklist, so the org would refuse the write. The ' + trailIds.size() +
               ' trail row(s) are KEPT exactly as they stand rather than stamped with a status that means something ' +
               'else. Add ' + StageDiscardVersion.WITHDRAWN + ' to the picklist to close this step.')
            : (marked + ' of ' + trailIds.size() + ' trail row(s) read back at ' + StageDiscardVersion.WITHDRAWN +
               ' and were kept.');
        C360Plan.setState(steps, 'withdraw_trail', state, detail);
    }

    // ---------------------------------------------------------------------------------------
    // Helpers.
    // ---------------------------------------------------------------------------------------

    /** An idempotent replay reports the prior run and writes nothing. */
    private static ExecuteResult replay(cm_Action_Staging__c prior) {
        ExecuteResult r = new ExecuteResult();
        r.stagingId = prior.Id;
        r.versionPackageId = prior.cm_Result_Record_Id__c;
        r.terminalState = prior.cm_Status__c == 'Completed'
            ? C360Plan.TERMINAL_SUCCESS
            : (prior.cm_Status__c == 'Failed' ? C360Plan.TERMINAL_FAILED : C360Plan.TERMINAL_PARTIAL);
        r.replayed = true;
        r.deletedCount = 0;
        r.remainingCount = 0;
        r.items = new List<InventoryItem>();
        r.parentsCleared = new List<String>();
        r.outcome = 'This idempotency key already discarded version ' + prior.cm_Result_Record_Id__c +
            '. Nothing was deleted.';
        r.steps = prior.cm_Tracker_JSON__c == null
            ? new List<StepResult>()
            : toWireSteps((List<C360Plan.Step>) JSON.deserialize(prior.cm_Tracker_JSON__c, List<C360Plan.Step>.class));
        return r;
    }

    private static Set<String> confirmedKeys(String inventory) {
        Set<String> out = new Set<String>();
        if (String.isBlank(inventory)) {
            return out;
        }
        for (String k : inventory.split(',')) {
            if (String.isNotBlank(k)) {
                out.add(k.trim());
            }
        }
        return out;
    }

    /** Reads one of the plan's comma-joined id lists back into typed ids. */
    private static Set<Id> idsFrom(String csv) {
        Set<Id> out = new Set<Id>();
        if (String.isBlank(csv)) {
            return out;
        }
        for (String k : csv.split(',')) {
            if (String.isNotBlank(k)) {
                out.add(Id.valueOf(k.trim()));
            }
        }
        return out;
    }

    private static void item(
        ExecuteResult out,
        String objectName,
        Id recordId,
        Map<String, StageDiscardVersion.Item> byKey,
        String outcome
    ) {
        StageDiscardVersion.Item src = byKey.get(objectName + ':' + recordId);
        InventoryItem w = new InventoryItem();
        w.objectName = objectName;
        w.recordId = String.valueOf(recordId);
        w.name = src == null ? String.valueOf(recordId) : src.name;
        w.outcome = outcome;
        out.items.add(w);
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

    private static ToolError err(String code, String message, String orgError, String step, Boolean resumable, String idempotencyKey) {
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
