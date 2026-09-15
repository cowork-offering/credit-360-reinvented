/**
 * ExecuteDiscardVersion - MCP tool: execute_discard_version.
 *
 * Runs the plan `stage_discard_version` staged, behind the single-use decision token. This is the
 * only class in this package that deletes, and every property that makes that safe is enforced
 * here rather than assumed.
 *
 * THE GATE IS RE-RUN, NOT REPLAYED, ON A FIRST EXECUTE. `StageDiscardVersion.discover()` is called
 * again, so a version that climbed to Approval / Loan Committee between the confirm gate and the
 * click is refused with nothing written, and a version that grew a new child in the same window is
 * refused too. The staged inventory is the CEILING: a record that was not on the list the banker
 * confirmed is never deleted, whatever the fresh query returns. A record that WAS on the list and
 * is already gone is not an error, it is a resumed run.
 *
 * A RESUME DOES NOT RE-CLASSIFY THE PACKAGE, and that exception is the price of deleting in the
 * org's order. The version classification reads the `LLC_BI__LoanRenewal__c` chain rows and the
 * members' `Is_Modification`, which are the first and fifth things this chain deletes, so a run
 * that stopped anywhere after `delete_chain` meets a package that no longer looks like a version
 * and is refused NOT_A_VERSION under its own key for ever (org proof 2026-09-14, staging row
 * STG-0000000157: stopped at `delete_aggregates` with 63 of 69 records gone). On a resume the
 * frozen plan is the authority on WHAT the package is, `discoverForResume` skips that one check,
 * and everything else still runs: the foreign-children refusal, the ceiling measurement, the
 * per-group verification and the token gate are all unchanged.
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
 *   5. The `LLC_BI__Loan_Collateral_Aggregate__c` shells the version owns: the ones its facilities
 *      pointed at, AFTER the facilities because the facility is the parent that holds the lookup,
 *      plus the empty ones its own creation minted and nothing ever used. nCino's managed delete
 *      handling takes a shell WITH its clone, so this group tolerates `ENTITY_IS_DELETED` per row
 *      as `already_gone` rather than stopping the chain on a row that reached the outcome it wanted
 *      (org proof 2026-09-14: all five frozen shells went with `delete_members`, and the
 *      all-or-nothing delete then stranded the version package).
 *   6. The version package.
 *   7. The trail, which is MARKED and never removed.
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
 * trail. Nor any `LLC_BI__Loan_Collateral_Aggregate__c` shell the version did not own: a shell goes
 * only when a VERSION facility pointed at it at stage time, or when the version's own creation
 * minted it and nothing anywhere points at it; either way it carries no `LLC_BI__lookupKey__c`. The rest are reported as an observed side
 * effect, which is what every shell was before 2026-09-14 (backlog row 46).
 *
 * THE SHELLS COME OFF THE STAGED PLAN RATHER THAN OFF THE FRESH DISCOVERY, and that is the same
 * rule the parents and the trail already follow: the facility holds the lookup, so the moment the
 * facilities are deleted nothing can name their shells again, and a run that stopped between the
 * facilities and the package would strand them for good on the resume.
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

    /**
     * Deletes a group's targets immediately BEFORE the group's own delete runs, which is the
     * managed cascade reproduced: on 2026-09-14 nCino's own `LLC_BI.LoanTrigger` took every clone's
     * collateral aggregate with the clone inside `delete_members`, and `delete_aggregates` then met
     * `ENTITY_IS_DELETED` on all five rows. A unit fixture has no managed trigger, so this seam is
     * the only honest way to put the tolerant path under test.
     */
    @TestVisible
    private static String vanishBeforeGroup;

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

        // THE ONE THING A RESUME RE-DERIVES, and it is about identity rather than about state. The
        // row records the version it stopped on in `cm_Result_Record_Id__c`, written by
        // recordProgress; the plan on that same row names the version it was staged for. A resume
        // continues the run that stopped, so those two must be the same package, and a row pointing
        // somewhere else is a mix-up rather than a run to carry on with. Everything else about what
        // this package IS comes off the frozen plan: see StageDiscardVersion.discoverForResume.
        if (resuming && String.valueOf(versionPackageId) != stg.cm_Result_Record_Id__c) {
            throw new ToolException(
                'Staging record ' + stg.Id + ' stopped part way through discarding ' +
                String.valueOf(stg.cm_Result_Record_Id__c) + ', and the plan on it names version ' +
                versionPackageId + '. A resume continues the run that stopped; it does not retarget it.'
            );
        }

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
                // A FIRST execute re-runs the whole gate. A RESUME does not re-classify the package
                // as a version, because the chain rows and the members that classification reads are
                // the first and fifth things this chain deletes: every stop after `delete_chain`
                // would otherwise be un-resumable. discoverForResume carries the reasoning.
                inv = resuming
                    ? StageDiscardVersion.discoverForResume(versionPackageId)
                    : StageDiscardVersion.discover(String.valueOf(versionPackageId));
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
        String stoppedAt;
        if (inv == null) {
            settleAlreadyGone(steps, out, versionPackageId);
            stoppedAt = null;
        } else {
            retargetAggregates(inv, idsFrom(C360Plan.asString(v.get('aggregates'))), out);
            stoppedAt = runGroups(inv, steps, out);
        }

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
            inv == null || inv.refusedAggregates.isEmpty()
                ? 'Every collateral aggregate shell this version owned was on the frozen inventory and went with its ' +
                  'facility. None was left standing.'
                : 'Left standing: ' + String.join(inv.refusedAggregates, '; ') +
                  '. A shell keyed outside this cockpit, or one something outside the version still points at, is not ' +
                  'this action\'s to remove.'
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
     * @param inv The freshly discovered inventory. assertNothingNew has already measured it against
     *        the confirmed list, so every id in it is one the banker saw.
     * @param steps The plan steps, mutated in place.
     * @param out The result, accumulating counts and item outcomes.
     * @return The step id the chain stopped at, or null when every group settled.
     */
    private static String runGroups(
        StageDiscardVersion.Inventory inv,
        List<C360Plan.Step> steps,
        ExecuteResult out
    ) {
        Map<String, StageDiscardVersion.Item> byKey = itemsByKey(inv);

        String stoppedAt = null;
        for (StageDiscardVersion.DeleteGroup g : inv.groups) {
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

            // THE SHELLS TOLERATE A ROW THAT HAS ALREADY GONE, AND ONLY THEY DO (org proof
            // 2026-09-14). nCino's managed delete handling takes a clone's collateral aggregate
            // WITH the clone, inside `delete_members`, so by the time `delete_aggregates` runs the
            // frozen list can be entirely deleted already and an all-or-nothing delete stops the
            // chain on `ENTITY_IS_DELETED` with the version package still standing. A row that is
            // already gone is the outcome this group wanted, so it is `already_gone` rather than a
            // stop. Every OTHER error on the group, and every other group, still stops the chain:
            // the tolerance is for one status code on one object, not for failure in general.
            Boolean tolerant = g.stepId == StageDiscardVersion.AGGREGATE_STEP_ID;
            String orgRefusal = null;
            String partialRefusal = null;
            Set<Id> alreadyGone = new Set<Id>();
            List<SObject> rows = new List<SObject>();
            for (Id rid : targets) {
                rows.add(rid.getSObjectType().newSObject(rid));
            }

            if (g.stepId == vanishBeforeGroup) {
                vanishBeforeGroup = null;
                List<SObject> cascade = new List<SObject>();
                for (Id rid : targets) {
                    cascade.add(rid.getSObjectType().newSObject(rid));
                }
                delete as user cascade;
            }

            if (g.stepId == refuseGroupOnce) {
                refuseGroupOnce = null;
                orgRefusal = 'DELETE_FAILED: the org is holding a record on this group (injected refusal).';
            } else if (tolerant) {
                List<String> refusals = new List<String>();
                List<Database.DeleteResult> results = Database.delete(rows, false, AccessLevel.USER_MODE);
                for (Integer i = 0; i < results.size(); i++) {
                    if (results[i].isSuccess()) {
                        continue;
                    }
                    Boolean gone = true;
                    for (Database.Error e : results[i].getErrors()) {
                        if (e.getStatusCode() != StatusCode.ENTITY_IS_DELETED) {
                            gone = false;
                            refusals.add(e.getMessage());
                        }
                    }
                    if (gone) {
                        alreadyGone.add(targets[i]);
                    }
                }
                // A partial delete is NOT reported as a refused delete: some rows went, and saying
                // otherwise would mark a deleted record not_attempted. The survivors are counted by
                // the re-read below, which is what stops the chain and what carries the org's words.
                if (!refusals.isEmpty()) {
                    partialRefusal = String.join(refusals, '; ');
                }
            } else {
                try {
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

            Set<Id> left = survivingIds(g.objectName, targets);
            Integer wasGone = 0;
            Integer removed = 0;
            for (Id rid : targets) {
                if (left.contains(rid)) {
                    item(out, g.objectName, rid, byKey, 'not_attempted');
                    out.remainingCount++;
                } else if (alreadyGone.contains(rid)) {
                    // Counted in neither total: this run did not delete it, and it is not remaining.
                    item(out, g.objectName, rid, byKey, 'already_gone');
                    wasGone++;
                } else {
                    item(out, g.objectName, rid, byKey, 'deleted');
                    out.deletedCount++;
                    removed++;
                }
            }

            C360Plan.setState(
                steps, g.stepId, C360Plan.STATE_VERIFIED,
                'Deleted ' + removed + ' ' + g.objectName + ' record' + (removed == 1 ? '' : 's') +
                (wasGone == 0
                    ? '.'
                    : ', and ' + wasGone + ' of the ' + targets.size() + ' on the plan had already gone with the ' +
                      'facility that pointed at it. nCino\'s own delete handling takes a shell with its clone, so a ' +
                      'shell that is already gone is this group\'s outcome rather than its failure.')
            );
            if (!left.isEmpty()) {
                C360Plan.setState(
                    steps, g.stepId + '_verify', C360Plan.STATE_FAILED,
                    left.size() + ' of ' + targets.size() + ' ' + g.objectName +
                    ' records read back after the delete. The chain stops here.' +
                    (partialRefusal == null ? '' : ' The org said: ' + partialRefusal)
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
     * Points the aggregate group at the FROZEN shells rather than at the fresh discovery, and
     * filters that list down to what may still go.
     *
     * WHY THE FROZEN LIST. `LLC_BI__Loan__c` holds the lookup to its shell and the shell carries no
     * lookup back, so a fresh discovery can only see a shell while its facility is alive. A run
     * that stopped between `delete_members` and `delete_package` would resume with no facilities,
     * find no shells, mark the group empty and strand them for good. Same rule the parents and the
     * trail already follow: a set the chain needs after the delete is read before it.
     *
     * TWO FILTERS, both re-reads rather than assumptions. A shell that no longer resolves is
     * `already_gone`, which is a resumed run rather than an error. A shell a SURVIVING facility or
     * pledge still points at is `kept`: the version's own members are excluded from those reads
     * because they are about to be deleted in this same run, so whatever is left pointing at a
     * shell is outside the version. That second filter is not decoration:
     * `LLC_BI__Loan_Collateral2__c.LLC_BI__Loan_Collateral_Aggregate__c` is a CASCADE lookup, so
     * deleting a shared shell would take a stranger's pledge with it without saying so.
     *
     * @param inv The freshly discovered inventory, carrying the group to retarget.
     * @param frozen The shell ids the banker confirmed at stage time.
     * @param out The result, which records the shells that are already gone or deliberately kept.
     */
    private static void retargetAggregates(
        StageDiscardVersion.Inventory inv,
        Set<Id> frozen,
        ExecuteResult out
    ) {
        StageDiscardVersion.DeleteGroup shells = null;
        for (StageDiscardVersion.DeleteGroup g : inv.groups) {
            if (g.stepId == StageDiscardVersion.AGGREGATE_STEP_ID) {
                shells = g;
            }
        }
        if (shells == null) {
            return;
        }
        shells.ids.clear();
        if (frozen.isEmpty()) {
            return;
        }

        List<Id> frozenIds = new List<Id>(frozen);
        frozenIds.sort();
        Set<Id> alive = new Set<Id>();
        for (LLC_BI__Loan_Collateral_Aggregate__c a : [
            SELECT Id FROM LLC_BI__Loan_Collateral_Aggregate__c WHERE Id IN :frozenIds WITH USER_MODE
        ]) {
            alive.add(a.Id);
        }
        Set<Id> heldOutside = new Set<Id>();
        for (LLC_BI__Loan__c l : [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :frozenIds AND Id NOT IN :inv.memberIds
            WITH USER_MODE
        ]) {
            heldOutside.add(l.LLC_BI__Loan_Collateral_Aggregate__c);
        }
        for (LLC_BI__Loan_Collateral2__c p : [
            SELECT LLC_BI__Loan_Collateral_Aggregate__c FROM LLC_BI__Loan_Collateral2__c
            WHERE LLC_BI__Loan_Collateral_Aggregate__c IN :frozenIds AND LLC_BI__Loan__c NOT IN :inv.memberIds
            WITH USER_MODE
        ]) {
            heldOutside.add(p.LLC_BI__Loan_Collateral_Aggregate__c);
        }

        Map<String, StageDiscardVersion.Item> byKey = itemsByKey(inv);
        for (Id a : frozenIds) {
            if (!alive.contains(a)) {
                item(out, shells.objectName, a, byKey, 'already_gone');
            } else if (heldOutside.contains(a)) {
                item(out, shells.objectName, a, byKey, 'kept');
                inv.refusedAggregates.add(
                    'shell ' + a + ' is still pointed at from outside this version, so it was left where it stands'
                );
            } else {
                shells.ids.add(a);
            }
        }
    }

    /**
     * Settles a RESUME whose version package no longer resolves.
     *
     * The chain reached `delete_package` and landed it, and the transaction died before the outcome
     * was written; or the org took the package with something else while the run was stopped. Either
     * way the state the org is in is the state this plan wanted, so every group still reading
     * pending is settled from the FROZEN PLAN rather than from a discovery that has nothing left to
     * find. Leaving them pending is what would keep the staging row reading Executing for good,
     * which is the same failure the resume gate had: a run that cannot finish and cannot be retried.
     *
     * The verifications are NOT settled here. They run straight after this and prove the package is
     * gone, the booked parents read hasRenewal false, and the trail is marked, which is the whole
     * point of finishing the run rather than abandoning it.
     *
     * @param steps The plan steps, mutated in place.
     * @param out The result, which records the package as already gone.
     * @param versionPackageId The version off the frozen plan.
     */
    private static void settleAlreadyGone(List<C360Plan.Step> steps, ExecuteResult out, Id versionPackageId) {
        for (C360Plan.Step s : steps) {
            if (s.state == C360Plan.STATE_PENDING) {
                s.state = C360Plan.STATE_VERIFIED;
                s.detail = 'Version package ' + versionPackageId + ' and everything on it were already gone when ' +
                    'this run resumed, so this group had nothing left to remove.';
            }
        }
        item(out, 'LLC_BI__Product_Package__c', versionPackageId, new Map<String, StageDiscardVersion.Item>(), 'already_gone');
    }

    /** The inventory's items, keyed the way the plan hash keys them. */
    private static Map<String, StageDiscardVersion.Item> itemsByKey(StageDiscardVersion.Inventory inv) {
        Map<String, StageDiscardVersion.Item> byKey = new Map<String, StageDiscardVersion.Item>();
        for (StageDiscardVersion.Item i : inv.items) {
            byKey.put(i.objectName + ':' + i.recordId, i);
        }
        return byKey;
    }

    /**
     * Refuses when the fresh inventory carries a record the banker never saw.
     *
     * The staged list is the ceiling. A pledge or a covenant junction that arrived between the
     * confirm gate and the click is a change of facts, and a delete that swept it up would be
     * deleting something nobody confirmed.
     *
     * THE SHELLS ARE THE ONE OBJECT THIS CANNOT MEASURE, and leaving them in would refuse runs it
     * has no reason to refuse. `retargetAggregates` CLEARS the shell group and refills it from the
     * frozen plan, so a shell the fresh discovery found and the banker never confirmed can never be
     * deleted by any path: the ceiling is already absolute for that group, enforced by construction
     * rather than by this check. Counting them here would instead refuse a legitimate RESUME of a
     * plan staged before the orphan bucket existed, because the fresh discovery now names shells
     * that plan's inventory could not carry.
     */
    private static void assertNothingNew(StageDiscardVersion.Inventory inv, Set<String> confirmed) {
        List<String> arrivals = new List<String>();
        for (StageDiscardVersion.Item i : inv.items) {
            if (i.objectName == C360WriteGuard.OBJ_PLEDGE_AGGREGATE) {
                continue;
            }
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
            SELECT Id, Name, cm_Status__c FROM cm_Action_Staging__c WHERE Id IN :trailIds WITH USER_MODE
        ]) {
            if (r.cm_Status__c == StageDiscardVersion.WITHDRAWN) {
                marked++;
            }
            InventoryItem w = new InventoryItem();
            w.objectName = 'cm_Action_Staging__c';
            w.recordId = String.valueOf(r.Id);
            w.name = StageDiscardVersion.bankerName('cm_Action_Staging__c', r.Name, r.Id, null);
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
        w.name = src == null ? StageDiscardVersion.bankerName(objectName, null, recordId, null) : src.name;
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
